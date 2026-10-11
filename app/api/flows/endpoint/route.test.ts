// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  publicEncrypt,
  randomBytes,
} from 'node:crypto'
import { NextRequest } from 'next/server'

/**
 * POST /api/flows/endpoint — assinatura antes de decifrar e auto-regeneração das
 * chaves RSA só com assinatura verificada (antes: qualquer POST lixo regenerava
 * e re-registrava as chaves a cada 10 min).
 */

const store = vi.hoisted(() => new Map<string, string>())

vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  },
}))
vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentials: vi.fn(async () => ({ accessToken: 'tok', phoneNumberId: '123' })),
}))
vi.mock('@/lib/meta-flows-api', () => ({
  metaSetEncryptionPublicKey: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/whatsapp/flow-endpoint-handlers', () => ({
  handleFlowAction: vi.fn(async () => ({ version: '3.0', screen: 'NEXT', data: { ok: true } })),
}))
vi.mock('@/lib/meta-app-credentials', () => ({
  getStoredMetaAppSecret: vi.fn(async () => null),
}))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => null),
}))

import { POST } from '@/app/api/flows/endpoint/route'
import { settingsDb } from '@/lib/supabase-db'
import { metaSetEncryptionPublicKey } from '@/lib/meta-flows-api'
import { handleFlowAction } from '@/lib/whatsapp/flow-endpoint-handlers'
import { generateKeyPair } from '@/lib/whatsapp/flow-endpoint-crypto'
import {
  FLOW_LAST_KEY_REGEN_SETTING,
  FLOW_PRIVATE_KEY_SETTING,
  FLOW_PUBLIC_KEY_SETTING,
} from '@/lib/whatsapp/flow-endpoint-keys'
import { resetMetaSignatureState } from '@/lib/meta-webhook-signature'

const APP_SECRET = 'flows-app-secret'
let keys: { publicKey: string; privateKey: string }

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

function buildEnvelope(publicKey: string, payload: Record<string, unknown>) {
  const aesKey = randomBytes(16)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  const encryptedAesKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey
  )
  return {
    body: JSON.stringify({
      encrypted_flow_data: encrypted.toString('base64'),
      encrypted_aes_key: encryptedAesKey.toString('base64'),
      initial_vector: iv.toString('base64'),
    }),
    aesKey,
    iv,
  }
}

function decryptResponse(text: string, aesKey: Buffer, iv: Buffer): unknown {
  const buf = Buffer.from(text, 'base64')
  const flipped = Buffer.from(iv.map((b) => b ^ 0xff))
  const decipher = createDecipheriv('aes-128-gcm', aesKey, flipped)
  decipher.setAuthTag(buf.subarray(-16))
  const plain = Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

/** Envelope com AES key aleatória: a decifração RSA-OAEP falha ("oaep decoding error"). */
function garbageBody(): string {
  return JSON.stringify({
    encrypted_flow_data: randomBytes(64).toString('base64'),
    encrypted_aes_key: randomBytes(256).toString('base64'),
    initial_vector: randomBytes(16).toString('base64'),
  })
}

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new NextRequest('https://dispara.test/api/flows/endpoint', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    })
  )
}

function keyWrites(): string[] {
  return vi
    .mocked(settingsDb.set)
    .mock.calls.map(([key]) => key)
    .filter((key) => key === FLOW_PRIVATE_KEY_SETTING || key === FLOW_PUBLIC_KEY_SETTING)
}

beforeAll(() => {
  keys = generateKeyPair()
})

beforeEach(() => {
  resetMetaSignatureState()
  store.clear()
  store.set(FLOW_PRIVATE_KEY_SETTING, keys.privateKey)
  store.set(FLOW_PUBLIC_KEY_SETTING, keys.publicKey)
  vi.mocked(settingsDb.set).mockClear()
  vi.mocked(settingsDb.get).mockClear()
  vi.mocked(metaSetEncryptionPublicKey).mockClear()
  vi.mocked(handleFlowAction).mockClear()
  vi.stubEnv('META_APP_SECRET', '')
  vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('modo unsigned_allowed (sem App Secret)', () => {
  it('lixo com erro OAEP → 421 e NUNCA regenera/re-registra as chaves', async () => {
    const res = await post(garbageBody())
    expect(res.status).toBe(421)
    expect(keyWrites()).toEqual([])
    expect(metaSetEncryptionPublicKey).not.toHaveBeenCalled()
    expect(store.get(FLOW_PRIVATE_KEY_SETTING)).toBe(keys.privateKey)
  })

  it('várias requests lixo seguidas continuam sem regenerar', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await post(garbageBody())).status).toBe(421)
    }
    expect(keyWrites()).toEqual([])
    expect(metaSetEncryptionPublicKey).not.toHaveBeenCalled()
  })

  it('sem chave privada salva → 421 sem gerar chaves', async () => {
    store.delete(FLOW_PRIVATE_KEY_SETTING)
    const res = await post(garbageBody())
    expect(res.status).toBe(421)
    expect(keyWrites()).toEqual([])
    expect(metaSetEncryptionPublicKey).not.toHaveBeenCalled()
  })

  it('request válida continua funcionando (compat)', async () => {
    const { body, aesKey, iv } = buildEnvelope(keys.publicKey, { version: '3.0', action: 'ping' })
    const res = await post(body)
    expect(res.status).toBe(200)
    expect(decryptResponse(await res.text(), aesKey, iv)).toEqual({ data: { status: 'active' } })
  })

  it('JSON inválido → 400', async () => {
    expect((await post('not-json')).status).toBe(400)
    expect((await post(JSON.stringify({ encrypted_flow_data: 'x' }))).status).toBe(400)
  })
})

describe('modo enforced (App Secret configurado)', () => {
  beforeEach(() => {
    vi.stubEnv('META_APP_SECRET', APP_SECRET)
  })

  it('sem assinatura → 432 antes de decifrar (nem lê a chave privada)', async () => {
    const res = await post(garbageBody())
    expect(res.status).toBe(432)
    expect(vi.mocked(settingsDb.get).mock.calls.map(([k]) => k)).not.toContain(FLOW_PRIVATE_KEY_SETTING)
    expect(keyWrites()).toEqual([])
  })

  it('assinatura inválida → 432', async () => {
    const body = garbageBody()
    const res = await post(body, { 'x-hub-signature-256': sign(body, 'outro-secret') })
    expect(res.status).toBe(432)
    expect(handleFlowAction).not.toHaveBeenCalled()
  })

  it('assinatura verificada + request válida → 200 e chama o handler', async () => {
    const { body, aesKey, iv } = buildEnvelope(keys.publicKey, {
      version: '3.0',
      action: 'data_exchange',
      screen: 'START',
      data: {},
    })
    const res = await post(body, { 'x-hub-signature-256': sign(body) })
    expect(res.status).toBe(200)
    expect(handleFlowAction).toHaveBeenCalledTimes(1)
    expect(decryptResponse(await res.text(), aesKey, iv)).toMatchObject({ screen: 'NEXT' })
  })

  it('assinatura verificada + erro OAEP → regenera e re-registra (uma vez, depois cooldown)', async () => {
    const first = garbageBody()
    const res1 = await post(first, { 'x-hub-signature-256': sign(first) })
    expect(res1.status).toBe(421)
    expect(keyWrites().sort()).toEqual([FLOW_PRIVATE_KEY_SETTING, FLOW_PUBLIC_KEY_SETTING].sort())
    expect(store.get(FLOW_LAST_KEY_REGEN_SETTING)).toBeTruthy()
    expect(store.get(FLOW_PRIVATE_KEY_SETTING)).not.toBe(keys.privateKey)
    expect(metaSetEncryptionPublicKey).toHaveBeenCalledTimes(1)

    const second = garbageBody()
    const res2 = await post(second, { 'x-hub-signature-256': sign(second) })
    expect(res2.status).toBe(421)
    expect(metaSetEncryptionPublicKey).toHaveBeenCalledTimes(1)
  })

  it('assinatura verificada + sem chave privada → gera e registra', async () => {
    store.delete(FLOW_PRIVATE_KEY_SETTING)
    const body = garbageBody()
    const res = await post(body, { 'x-hub-signature-256': sign(body) })
    expect(res.status).toBe(421)
    expect(store.get(FLOW_PRIVATE_KEY_SETTING)).toBeTruthy()
    expect(metaSetEncryptionPublicKey).toHaveBeenCalledTimes(1)
  })
})

describe("META_WEBHOOK_REQUIRE_SIGNATURE='true' sem App Secret", () => {
  it('rejeita com 432', async () => {
    vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'true')
    const { body } = buildEnvelope(keys.publicKey, { version: '3.0', action: 'ping' })
    expect((await post(body)).status).toBe(432)
  })
})
