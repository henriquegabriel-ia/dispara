// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * Testa o módulo REAL de verificação de assinatura da Meta
 * (lib/meta-webhook-signature.ts), usado por /api/webhook e /api/flows/endpoint.
 *
 * Referência: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */

vi.mock('@/lib/meta-app-credentials', () => ({
  getStoredMetaAppSecret: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => null),
}))

import {
  verifyMetaSignature,
  evaluateMetaSignature,
  getMetaAppSecret,
  getMetaSignatureStatus,
  reportMetaSignatureFailure,
  clearMetaAppSecretCache,
  resetMetaSignatureState,
  META_SIGNATURE_HEADER,
} from '@/lib/meta-webhook-signature'
import { getStoredMetaAppSecret } from '@/lib/meta-app-credentials'
import { getSupabaseAdmin } from '@/lib/supabase'

const mockedStoredSecret = vi.mocked(getStoredMetaAppSecret)
const mockedGetSupabaseAdmin = vi.mocked(getSupabaseAdmin)

const ENV_SECRET = 'env-meta-app-secret-123'
const SETTINGS_SECRET = 'settings-meta-app-secret-456'
const BODY = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '123', changes: [] }],
})

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

beforeEach(() => {
  resetMetaSignatureState()
  mockedStoredSecret.mockReset()
  mockedStoredSecret.mockResolvedValue(null)
  mockedGetSupabaseAdmin.mockReset()
  mockedGetSupabaseAdmin.mockReturnValue(null)
  vi.stubEnv('META_APP_SECRET', '')
  vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('verifyMetaSignature', () => {
  it('aceita assinatura HMAC-SHA256 correta', () => {
    expect(verifyMetaSignature(BODY, sign(ENV_SECRET, BODY), ENV_SECRET)).toBe(true)
  })

  it('aceita body vazio e unicode quando a assinatura confere', () => {
    expect(verifyMetaSignature('', sign(ENV_SECRET, ''), ENV_SECRET)).toBe(true)
    const unicode = JSON.stringify({ message: 'Olá, como você está? 🇧🇷' })
    expect(verifyMetaSignature(unicode, sign(ENV_SECRET, unicode), ENV_SECRET)).toBe(true)
  })

  it('aceita hex maiúsculo e espaços nas pontas do header', () => {
    const sig = sign(ENV_SECRET, BODY)
    expect(verifyMetaSignature(BODY, `  sha256=${sig.slice(7).toUpperCase()}  `, ENV_SECRET)).toBe(true)
  })

  it('rejeita assinatura incorreta', () => {
    expect(verifyMetaSignature(BODY, `sha256=${'0'.repeat(64)}`, ENV_SECRET)).toBe(false)
  })

  it('rejeita quando o body foi alterado', () => {
    expect(verifyMetaSignature(`${BODY} `, sign(ENV_SECRET, BODY), ENV_SECRET)).toBe(false)
  })

  it('rejeita quando o secret é diferente', () => {
    expect(verifyMetaSignature(BODY, sign('outro-secret', BODY), ENV_SECRET)).toBe(false)
  })

  it('rejeita header ausente ou vazio', () => {
    expect(verifyMetaSignature(BODY, null, ENV_SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, '', ENV_SECRET)).toBe(false)
  })

  it('rejeita header malformado (sem prefixo, curto, não-hex, algoritmo errado)', () => {
    const hex = sign(ENV_SECRET, BODY).slice('sha256='.length)
    expect(verifyMetaSignature(BODY, hex, ENV_SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, 'sha256=abc', ENV_SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, `sha256=${'z'.repeat(64)}`, ENV_SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, `sha1=${hex}`, ENV_SECRET)).toBe(false)
    expect(verifyMetaSignature(BODY, `sha256=${hex}00`, ENV_SECRET)).toBe(false)
  })

  it('rejeita quando o secret está vazio (nunca "verifica" contra secret vazio)', () => {
    expect(verifyMetaSignature(BODY, sign('', BODY), '')).toBe(false)
  })
})

describe('getMetaAppSecret', () => {
  it('env META_APP_SECRET tem precedência sobre settings (nem consulta o banco)', async () => {
    vi.stubEnv('META_APP_SECRET', `  ${ENV_SECRET}  `)
    mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)

    await expect(getMetaAppSecret()).resolves.toEqual({ secret: ENV_SECRET, source: 'env' })
    expect(mockedStoredSecret).not.toHaveBeenCalled()
  })

  it('usa o secret salvo pela UI quando não há env', async () => {
    mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
    await expect(getMetaAppSecret()).resolves.toEqual({ secret: SETTINGS_SECRET, source: 'settings' })
  })

  it('retorna source null quando nada está configurado', async () => {
    await expect(getMetaAppSecret()).resolves.toEqual({ secret: null, source: null })
  })

  it('cacheia a leitura das settings por 60s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)

    await getMetaAppSecret()
    await getMetaAppSecret()
    expect(mockedStoredSecret).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-10-11T12:01:01Z'))
    await getMetaAppSecret()
    expect(mockedStoredSecret).toHaveBeenCalledTimes(2)
  })

  it('clearMetaAppSecretCache força nova leitura (secret salvo/removido pela UI)', async () => {
    mockedStoredSecret.mockResolvedValueOnce(null).mockResolvedValueOnce(SETTINGS_SECRET)
    await expect(getMetaAppSecret()).resolves.toEqual({ secret: null, source: null })
    clearMetaAppSecretCache()
    await expect(getMetaAppSecret()).resolves.toEqual({ secret: SETTINGS_SECRET, source: 'settings' })
  })

  it('em falha de leitura reaproveita o último valor conhecido (mesmo expirado)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    mockedStoredSecret.mockResolvedValueOnce(SETTINGS_SECRET)
    await getMetaAppSecret()

    vi.setSystemTime(new Date('2026-10-11T12:05:00Z'))
    mockedStoredSecret.mockRejectedValueOnce(new Error('db down'))
    await expect(getMetaAppSecret()).resolves.toEqual({ secret: SETTINGS_SECRET, source: 'settings' })
  })

  it('lança quando a leitura falha e não há valor anterior', async () => {
    mockedStoredSecret.mockRejectedValue(new Error('db down'))
    await expect(getMetaAppSecret()).rejects.toThrow('db down')
  })
})

describe('evaluateMetaSignature', () => {
  describe('modo enforced (há App Secret)', () => {
    it('aceita assinatura válida (env)', async () => {
      vi.stubEnv('META_APP_SECRET', ENV_SECRET)
      await expect(evaluateMetaSignature(BODY, sign(ENV_SECRET, BODY))).resolves.toEqual({
        ok: true,
        mode: 'enforced',
      })
    })

    it('aceita assinatura válida com o secret salvo pela UI (settings)', async () => {
      mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
      await expect(evaluateMetaSignature(BODY, sign(SETTINGS_SECRET, BODY))).resolves.toEqual({
        ok: true,
        mode: 'enforced',
      })
    })

    it('rejeita assinatura inválida', async () => {
      mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
      await expect(evaluateMetaSignature(BODY, sign('outro', BODY))).resolves.toEqual({
        ok: false,
        mode: 'enforced',
        reason: 'invalid_signature',
      })
    })

    it('rejeita assinatura ausente (fail-closed)', async () => {
      mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
      await expect(evaluateMetaSignature(BODY, null)).resolves.toEqual({
        ok: false,
        mode: 'enforced',
        reason: 'missing_signature',
      })
      await expect(evaluateMetaSignature(BODY, '   ')).resolves.toMatchObject({ ok: false, reason: 'missing_signature' })
    })

    it('rejeita header malformado', async () => {
      mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
      await expect(evaluateMetaSignature(BODY, 'sha256=xyz')).resolves.toEqual({
        ok: false,
        mode: 'enforced',
        reason: 'malformed_signature',
      })
    })

    it('precedência env > settings: assinatura feita com o secret das settings é rejeitada quando há env', async () => {
      vi.stubEnv('META_APP_SECRET', ENV_SECRET)
      mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)

      await expect(evaluateMetaSignature(BODY, sign(SETTINGS_SECRET, BODY))).resolves.toMatchObject({
        ok: false,
        reason: 'invalid_signature',
      })
      await expect(evaluateMetaSignature(BODY, sign(ENV_SECRET, BODY))).resolves.toMatchObject({ ok: true })
    })

    it('META_WEBHOOK_REQUIRE_SIGNATURE não muda nada quando há secret', async () => {
      vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'true')
      mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
      await expect(evaluateMetaSignature(BODY, sign(SETTINGS_SECRET, BODY))).resolves.toEqual({
        ok: true,
        mode: 'enforced',
      })
    })
  })

  describe('sem App Secret', () => {
    it('aceita sem assinatura em modo unsigned_allowed', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await expect(evaluateMetaSignature(BODY, null)).resolves.toEqual({
        ok: true,
        mode: 'unsigned_allowed',
        reason: 'no_app_secret',
      })
    })

    it('ignora qualquer header (não há o que verificar)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await expect(evaluateMetaSignature(BODY, 'sha256=lixo')).resolves.toMatchObject({
        ok: true,
        mode: 'unsigned_allowed',
      })
    })

    it('loga o warning uma vez por janela, não a cada request', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await evaluateMetaSignature(BODY, null)
      await evaluateMetaSignature(BODY, null)
      await evaluateMetaSignature(BODY, null)
      expect(warn).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date('2026-10-11T12:16:00Z'))
      await evaluateMetaSignature(BODY, null)
      expect(warn).toHaveBeenCalledTimes(2)
    })

    it("META_WEBHOOK_REQUIRE_SIGNATURE='true' rejeita (fail-closed total)", async () => {
      vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'true')
      await expect(evaluateMetaSignature(BODY, sign('qualquer', BODY))).resolves.toEqual({
        ok: false,
        mode: 'enforced',
        reason: 'app_secret_required',
      })
    })

    it("META_WEBHOOK_REQUIRE_SIGNATURE diferente de 'true' mantém unsigned_allowed", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'false')
      await expect(evaluateMetaSignature(BODY, null)).resolves.toMatchObject({ ok: true, mode: 'unsigned_allowed' })
      vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', '1')
      await expect(evaluateMetaSignature(BODY, null)).resolves.toMatchObject({ ok: true, mode: 'unsigned_allowed' })
    })
  })

  it('falha ao ler o App Secret → rejeita (nunca abre por erro de banco)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedStoredSecret.mockRejectedValue(new Error('db down'))
    await expect(evaluateMetaSignature(BODY, null)).resolves.toEqual({
      ok: false,
      mode: 'enforced',
      reason: 'secret_unavailable',
    })
  })

  it('expõe o nome do header em minúsculas (Headers.get é case-insensitive)', () => {
    expect(META_SIGNATURE_HEADER).toBe('x-hub-signature-256')
  })
})

describe('getMetaSignatureStatus', () => {
  it('enforced via env', async () => {
    vi.stubEnv('META_APP_SECRET', ENV_SECRET)
    await expect(getMetaSignatureStatus()).resolves.toMatchObject({
      mode: 'enforced',
      secretSource: 'env',
      rejectsAll: false,
      recommendedAction: null,
    })
  })

  it('enforced via settings', async () => {
    mockedStoredSecret.mockResolvedValue(SETTINGS_SECRET)
    await expect(getMetaSignatureStatus()).resolves.toMatchObject({ mode: 'enforced', secretSource: 'settings' })
  })

  it('unsigned_allowed com ação recomendada', async () => {
    const status = await getMetaSignatureStatus()
    expect(status).toMatchObject({ mode: 'unsigned_allowed', secretSource: null, rejectsAll: false })
    expect(status.recommendedAction).toMatch(/App Secret/)
  })

  it('exige assinatura sem secret → rejectsAll', async () => {
    vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'true')
    await expect(getMetaSignatureStatus()).resolves.toMatchObject({
      mode: 'enforced',
      requireSignature: true,
      rejectsAll: true,
    })
  })

  it('erro de leitura vira status com error (sem lançar)', async () => {
    mockedStoredSecret.mockRejectedValue(new Error('db down'))
    await expect(getMetaSignatureStatus()).resolves.toMatchObject({ mode: 'enforced', error: 'db down' })
  })
})

describe('reportMetaSignatureFailure', () => {
  function makeDb(activeAlerts: Array<{ id: string }> = []) {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const limit = vi.fn().mockResolvedValue({ data: activeAlerts, error: null })
    const eq = vi.fn(() => ({ limit }))
    const like = vi.fn(() => ({ eq }))
    const select = vi.fn(() => ({ like }))
    const from = vi.fn(() => ({ select, upsert }))
    return { db: { from }, from, upsert, like }
  }

  const invalid = { ok: false, mode: 'enforced', reason: 'invalid_signature' } as const

  it('cria account_alert deduplicado por hora (upsert ignoreDuplicates)', async () => {
    const { db, upsert, like } = makeDb()
    mockedGetSupabaseAdmin.mockReturnValue(db as never)

    await reportMetaSignatureFailure({ evaluation: invalid, endpoint: 'webhook' })

    expect(like).toHaveBeenCalledWith('id', 'alert_meta_signature_%')
    expect(upsert).toHaveBeenCalledTimes(1)
    const [row, options] = upsert.mock.calls[0]
    expect(row.id).toMatch(/^alert_meta_signature_\d+$/)
    expect(row.type).toBe('auth')
    expect(JSON.parse(row.details)).toMatchObject({ reason: 'invalid_signature', endpoint: 'webhook' })
    expect(options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
  })

  it('rate limit por instância: segunda falha logo em seguida não grava de novo', async () => {
    const { db, upsert } = makeDb()
    mockedGetSupabaseAdmin.mockReturnValue(db as never)

    await reportMetaSignatureFailure({ evaluation: invalid, endpoint: 'webhook' })
    await reportMetaSignatureFailure({ evaluation: invalid, endpoint: 'webhook' })
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('não cria se já existe alerta de assinatura ativo', async () => {
    const { db, upsert } = makeDb([{ id: 'alert_meta_signature_1' }])
    mockedGetSupabaseAdmin.mockReturnValue(db as never)

    await reportMetaSignatureFailure({ evaluation: invalid, endpoint: 'flows_endpoint' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('não registra em modo unsigned_allowed, em sucesso nem em falha de leitura do secret', async () => {
    const { db, from } = makeDb()
    mockedGetSupabaseAdmin.mockReturnValue(db as never)

    await reportMetaSignatureFailure({
      evaluation: { ok: true, mode: 'unsigned_allowed', reason: 'no_app_secret' },
      endpoint: 'webhook',
    })
    await reportMetaSignatureFailure({ evaluation: { ok: true, mode: 'enforced' }, endpoint: 'webhook' })
    await reportMetaSignatureFailure({
      evaluation: { ok: false, mode: 'enforced', reason: 'secret_unavailable' },
      endpoint: 'webhook',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('é best-effort: erro do banco não propaga', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedGetSupabaseAdmin.mockReturnValue({
      from: () => {
        throw new Error('boom')
      },
    } as never)

    await expect(reportMetaSignatureFailure({ evaluation: invalid, endpoint: 'webhook' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})
