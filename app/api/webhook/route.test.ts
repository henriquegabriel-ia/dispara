// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

/**
 * /api/webhook (Meta): GET handshake fail-closed e POST com assinatura verificada
 * ANTES de qualquer processamento.
 */

const settings = vi.hoisted(() => new Map<string, string>())
const adminFrom = vi.hoisted(() => ({ fn: null as null | ((table: string) => unknown) }))

// Algumas dependências do pipeline importam 'server-only' (só existe no bundle do Next).
vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    get: vi.fn(async (key: string) => settings.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      settings.set(key, value)
    }),
  },
}))
vi.mock('@/lib/supabase', () => {
  const client = {
    from: vi.fn((table: string) => {
      if (adminFrom.fn) return adminFrom.fn(table)
      throw new Error(`unexpected table access: ${table}`)
    }),
  }
  return {
    getSupabaseAdmin: vi.fn(() => client),
    supabase: { from: client.from, rpc: vi.fn() },
    isSupabaseConfigured: vi.fn(() => true),
  }
})
vi.mock('@/lib/meta-app-credentials', () => ({
  getStoredMetaAppSecret: vi.fn(async () => null),
}))

import { GET, POST } from '@/app/api/webhook/route'
import { getStoredMetaAppSecret } from '@/lib/meta-app-credentials'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resetMetaSignatureState } from '@/lib/meta-webhook-signature'

const APP_SECRET = 'webhook-app-secret'
const NON_WABA_BODY = JSON.stringify({ object: 'page', entry: [] })

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

function verifyRequest(params: Record<string, string>): NextRequest {
  const url = new URL('https://dispara.test/api/webhook')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function postRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://dispara.test/api/webhook', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  resetMetaSignatureState()
  settings.clear()
  adminFrom.fn = null
  vi.mocked(getSupabaseAdmin).mockClear()
  vi.mocked(getStoredMetaAppSecret).mockReset()
  vi.mocked(getStoredMetaAppSecret).mockResolvedValue(null)
  vi.stubEnv('META_APP_SECRET', '')
  vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', '')
  vi.stubEnv('WEBHOOK_VERIFY_TOKEN', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/webhook (verify token)', () => {
  it('fail-closed sem verify token configurado: o sentinela nunca casa', async () => {
    for (const sentinel of ['token-not-found-readonly', 'error-retrieving-token', '']) {
      const res = await GET(
        verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': sentinel, 'hub.challenge': 'abc' })
      )
      expect(res.status).toBe(403)
    }
  })

  it('não gera token novo no handshake (readonly)', async () => {
    await GET(verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'abc' }))
    expect(settings.has('webhook_verify_token')).toBe(false)
  })

  it('token correto devolve o challenge', async () => {
    settings.set('webhook_verify_token', 'verify-123')
    const res = await GET(
      verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-123', 'hub.challenge': 'abc' })
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc')
  })

  it('token errado, ausente ou mode diferente → 403', async () => {
    settings.set('webhook_verify_token', 'verify-123')
    const wrong = await GET(verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-124' }))
    expect(wrong.status).toBe(403)
    const missing = await GET(verifyRequest({ 'hub.mode': 'subscribe' }))
    expect(missing.status).toBe(403)
    const mode = await GET(verifyRequest({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-123' }))
    expect(mode.status).toBe(403)
  })

  it('aceita o token da env como fallback', async () => {
    vi.stubEnv('WEBHOOK_VERIFY_TOKEN', 'env-verify')
    const res = await GET(
      verifyRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'env-verify', 'hub.challenge': 'ok' })
    )
    expect(res.status).toBe(200)
  })
})

describe('POST /api/webhook (assinatura)', () => {
  it('enforced (env): sem assinatura → 401 sem processar nada', async () => {
    vi.stubEnv('META_APP_SECRET', APP_SECRET)
    const tables: string[] = []
    adminFrom.fn = (table) => {
      tables.push(table)
      const limit = vi.fn().mockResolvedValue({ data: [], error: null })
      return {
        select: () => ({ like: () => ({ eq: () => ({ limit }) }) }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }
    }

    const res = await POST(postRequest(JSON.stringify({ object: 'whatsapp_business_account', entry: [] })))
    expect(res.status).toBe(401)
    // Só o account_alert é tocado; nada do pipeline (settings, workflows, inbox...).
    expect(tables.every((t) => t === 'account_alerts')).toBe(true)
    expect(settings.size).toBe(0)
  })

  it('enforced (secret salvo pela UI): assinatura inválida → 401 e registra account_alert', async () => {
    vi.mocked(getStoredMetaAppSecret).mockResolvedValue(APP_SECRET)
    const upsert = vi.fn().mockResolvedValue({ error: null })
    adminFrom.fn = (table) => {
      expect(table).toBe('account_alerts')
      const limit = vi.fn().mockResolvedValue({ data: [], error: null })
      return { select: () => ({ like: () => ({ eq: () => ({ limit }) }) }), upsert }
    }

    const res = await POST(postRequest(NON_WABA_BODY, { 'x-hub-signature-256': sign(NON_WABA_BODY, 'outro') }))
    expect(res.status).toBe(401)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toMatchObject({ type: 'auth' })
  })

  it('enforced: assinatura válida segue para o pipeline', async () => {
    vi.stubEnv('META_APP_SECRET', APP_SECRET)
    const res = await POST(postRequest(NON_WABA_BODY, { 'X-Hub-Signature-256': sign(NON_WABA_BODY) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ignored' })
  })

  it('unsigned_allowed (sem App Secret): aceita sem assinatura', async () => {
    const res = await POST(postRequest(NON_WABA_BODY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ignored' })
  })

  it("META_WEBHOOK_REQUIRE_SIGNATURE='true' sem App Secret → 401", async () => {
    vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'true')
    adminFrom.fn = () => {
      const limit = vi.fn().mockResolvedValue({ data: [], error: null })
      return {
        select: () => ({ like: () => ({ eq: () => ({ limit }) }) }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }
    }
    const res = await POST(postRequest(NON_WABA_BODY))
    expect(res.status).toBe(401)
  })

  it('falha ao ler o App Secret → 503 (Meta reentrega), sem processar', async () => {
    vi.mocked(getStoredMetaAppSecret).mockRejectedValue(new Error('db down'))
    const res = await POST(postRequest(NON_WABA_BODY))
    expect(res.status).toBe(503)
    expect(vi.mocked(getSupabaseAdmin)).not.toHaveBeenCalled()
  })

  it('body vazio com assinatura válida → 400', async () => {
    vi.stubEnv('META_APP_SECRET', APP_SECRET)
    const res = await POST(postRequest('', { 'x-hub-signature-256': sign('') }))
    expect(res.status).toBe(400)
  })
})
