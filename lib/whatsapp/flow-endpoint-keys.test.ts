import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase-db', () => ({
  settingsDb: { get: vi.fn(), set: vi.fn() },
}))
vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentials: vi.fn(),
}))
vi.mock('@/lib/meta-flows-api', () => ({
  metaSetEncryptionPublicKey: vi.fn(),
}))

import {
  FLOW_KEY_REGEN_COOLDOWN_MS,
  decideFlowKeyRecovery,
  isOaepDecryptError,
} from '@/lib/whatsapp/flow-endpoint-keys'

const NOW = 1_800_000_000_000

describe('decideFlowKeyRecovery', () => {
  it('nunca gera/regenera sem assinatura verificada (anti-DoS)', () => {
    for (const trigger of ['missing_key', 'oaep_error'] as const) {
      expect(decideFlowKeyRecovery({ signatureVerified: false, trigger, lastRegenAt: 0, now: NOW })).toBe('unverified')
    }
  })

  it('regenera com assinatura verificada fora do cooldown', () => {
    expect(decideFlowKeyRecovery({ signatureVerified: true, trigger: 'oaep_error', lastRegenAt: 0, now: NOW })).toBe('regenerate')
    expect(decideFlowKeyRecovery({ signatureVerified: true, trigger: 'missing_key', lastRegenAt: 0, now: NOW })).toBe('regenerate')
  })

  it('respeita o cooldown de 10 min', () => {
    const recent = NOW - FLOW_KEY_REGEN_COOLDOWN_MS + 1000
    expect(decideFlowKeyRecovery({ signatureVerified: true, trigger: 'oaep_error', lastRegenAt: recent, now: NOW })).toBe('cooldown')
    const old = NOW - FLOW_KEY_REGEN_COOLDOWN_MS - 1
    expect(decideFlowKeyRecovery({ signatureVerified: true, trigger: 'oaep_error', lastRegenAt: old, now: NOW })).toBe('regenerate')
  })

  it('erro que não é de chave nunca regenera', () => {
    expect(decideFlowKeyRecovery({ signatureVerified: true, trigger: 'other_error', lastRegenAt: 0, now: NOW })).toBe('not_applicable')
  })

  it('lastRegenAt inválido conta como nunca regenerado', () => {
    expect(decideFlowKeyRecovery({ signatureVerified: true, trigger: 'oaep_error', lastRegenAt: Number.NaN, now: NOW })).toBe('regenerate')
  })
})

describe('isOaepDecryptError', () => {
  it('detecta erro OAEP do OpenSSL', () => {
    expect(isOaepDecryptError(new Error('error:02000079:rsa routines::oaep decoding error'))).toBe(true)
    expect(isOaepDecryptError('OAEP failure')).toBe(true)
    expect(isOaepDecryptError(new Error('Unsupported state or unable to authenticate data'))).toBe(false)
  })
})
