// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * /api/meta/diagnostics expõe se a assinatura do webhook está 'enforced' ou
 * 'unsigned_allowed' (com ação recomendada).
 */

vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentials: vi.fn(async () => null),
}))
vi.mock('@/lib/verify-token', () => ({
  getVerifyToken: vi.fn(async () => 'verify-token-123'),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
  getSupabaseAdmin: vi.fn(() => null),
}))
vi.mock('@/lib/meta-app-credentials', () => ({
  getMetaAppCredentials: vi.fn(async () => null),
  getStoredMetaAppSecret: vi.fn(async () => null),
}))

import { GET } from '@/app/api/meta/diagnostics/route'
import { getStoredMetaAppSecret } from '@/lib/meta-app-credentials'
import { resetMetaSignatureState } from '@/lib/meta-webhook-signature'

type Check = { id: string; status: string; message: string; actions?: Array<{ href?: string }> }

async function diagnostics() {
  const res = await GET()
  return (await res.json()) as {
    checks: Check[]
    webhook: { signature: { mode: string; secretSource: string | null; recommendedAction: string | null } }
  }
}

beforeEach(() => {
  resetMetaSignatureState()
  vi.mocked(getStoredMetaAppSecret).mockReset()
  vi.mocked(getStoredMetaAppSecret).mockResolvedValue(null)
  vi.stubEnv('META_APP_SECRET', '')
  vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('diagnóstico da assinatura do webhook', () => {
  it('sem App Secret → unsigned_allowed (warn) com ação recomendada', async () => {
    const data = await diagnostics()
    const check = data.checks.find((c) => c.id === 'webhook_signature')
    expect(check?.status).toBe('warn')
    expect(check?.actions?.[0]?.href).toBe('/settings')
    expect(data.webhook.signature.mode).toBe('unsigned_allowed')
    expect(data.webhook.signature.recommendedAction).toMatch(/App Secret/)
  })

  it('App Secret salvo pela UI → enforced (pass)', async () => {
    vi.mocked(getStoredMetaAppSecret).mockResolvedValue('s3cr3t')
    const data = await diagnostics()
    const check = data.checks.find((c) => c.id === 'webhook_signature')
    expect(check?.status).toBe('pass')
    expect(data.webhook.signature).toMatchObject({ mode: 'enforced', secretSource: 'settings' })
    expect(JSON.stringify(data)).not.toContain('s3cr3t')
  })

  it('exige assinatura sem App Secret → fail', async () => {
    vi.stubEnv('META_WEBHOOK_REQUIRE_SIGNATURE', 'true')
    const data = await diagnostics()
    expect(data.checks.find((c) => c.id === 'webhook_signature')?.status).toBe('fail')
  })
})
