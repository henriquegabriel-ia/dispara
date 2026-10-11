// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/attendants/validate — sessão do atendente via cookie httpOnly.
 * POST valida o token do link e grava o cookie; GET restaura do cookie; DELETE apaga.
 */

type QueryResult = { data: unknown; error: unknown }

const mocks = vi.hoisted(() => {
  const state: { tokenRow: QueryResult; updateResult: QueryResult } = {
    tokenRow: { data: null, error: null },
    updateResult: { data: null, error: null },
  }
  const update = vi.fn()
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.maybeSingle = vi.fn(() => Promise.resolve(state.tokenRow))
    builder.update = vi.fn((values: unknown) => {
      update(values)
      const updateBuilder: Record<string, unknown> = {}
      updateBuilder.eq = vi.fn(() => Promise.resolve(state.updateResult))
      return updateBuilder
    })
    return builder
  })
  return {
    state,
    update,
    from,
    resolveAttendantToken: vi.fn(),
  }
})

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}))

vi.mock('@/lib/attendant-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attendant-auth')>()
  return { ...actual, resolveAttendantToken: mocks.resolveAttendantToken }
})

import { DELETE, GET, POST } from '@/app/api/attendants/validate/route'
import { ATTENDANT_COOKIE_NAME } from '@/lib/attendant-auth'

const TOKEN = '0123456789abcdef0123456789abcdef'
const THIRTY_DAYS = 60 * 60 * 24 * 30

const ATTENDANT = {
  id: 'att-1',
  name: 'Ana',
  permissions: { canView: true, canReply: true, canHandoff: false },
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/attendants/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function getRequest(cookie?: string): NextRequest {
  const headers = new Headers()
  if (cookie !== undefined) headers.set('cookie', `${ATTENDANT_COOKIE_NAME}=${cookie}`)
  return new NextRequest('http://localhost/api/attendants/validate', { method: 'GET', headers })
}

describe('/api/attendants/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.tokenRow = { data: { access_count: 4, expires_at: null }, error: null }
    mocks.state.updateResult = { data: null, error: null }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('POST', () => {
    it('valida o token, registra o acesso e grava o cookie httpOnly', async () => {
      mocks.resolveAttendantToken.mockResolvedValue(ATTENDANT)

      const res = await POST(postRequest({ token: TOKEN }))
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data).toEqual({ valid: true, attendant: ATTENDANT })
      expect(JSON.stringify(data)).not.toContain(TOKEN)
      expect(mocks.resolveAttendantToken).toHaveBeenCalledWith(TOKEN)

      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ access_count: 5, last_used_at: expect.any(String) })
      )

      const cookie = res.cookies.get(ATTENDANT_COOKIE_NAME)
      expect(cookie?.value).toBe(TOKEN)
      expect(cookie?.httpOnly).toBe(true)
      expect(cookie?.sameSite).toBe('lax')
      expect(cookie?.path).toBe('/')
      expect(cookie?.maxAge).toBe(THIRTY_DAYS)
      expect(cookie?.secure).toBe(false)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('em produção o cookie é Secure', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      mocks.resolveAttendantToken.mockResolvedValue(ATTENDANT)

      const res = await POST(postRequest({ token: TOKEN }))

      expect(res.cookies.get(ATTENDANT_COOKIE_NAME)?.secure).toBe(true)
    })

    it('limita o maxAge ao expires_at do token quando ele vence antes de 30 dias', async () => {
      const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      mocks.state.tokenRow = { data: { access_count: 0, expires_at: inOneHour }, error: null }
      mocks.resolveAttendantToken.mockResolvedValue(ATTENDANT)

      const res = await POST(postRequest({ token: TOKEN }))
      const maxAge = res.cookies.get(ATTENDANT_COOKIE_NAME)?.maxAge ?? 0

      expect(res.status).toBe(200)
      expect(maxAge).toBeGreaterThan(3500)
      expect(maxAge).toBeLessThanOrEqual(3600)
    })

    it('recusa se o token venceu entre a validação (cacheada) e agora', async () => {
      const past = new Date(Date.now() - 1000).toISOString()
      mocks.state.tokenRow = { data: { access_count: 0, expires_at: past }, error: null }
      mocks.resolveAttendantToken.mockResolvedValue(ATTENDANT)

      const res = await POST(postRequest({ token: TOKEN }))

      expect(res.status).toBe(401)
      expect(res.cookies.get(ATTENDANT_COOKIE_NAME)?.maxAge).toBe(0)
    })

    it('token inexistente, inativo ou expirado: 401 com mensagem única e sem cookie', async () => {
      mocks.resolveAttendantToken.mockResolvedValue(null)

      const res = await POST(postRequest({ token: TOKEN }))
      const data = await res.json()

      expect(res.status).toBe(401)
      expect(data).toEqual({ valid: false, error: 'Token inválido ou expirado' })
      expect(res.cookies.get(ATTENDANT_COOKIE_NAME)).toBeUndefined()
      expect(mocks.update).not.toHaveBeenCalled()
    })

    it('sem token (ou body inválido): 400', async () => {
      const noToken = await POST(postRequest({}))
      const badBody = await POST(postRequest('not-json'))
      const notString = await POST(postRequest({ token: 123 }))

      expect(noToken.status).toBe(400)
      expect(badBody.status).toBe(400)
      expect(notString.status).toBe(400)
      expect(mocks.resolveAttendantToken).not.toHaveBeenCalled()
    })

    it('falha ao registrar o acesso não bloqueia o login', async () => {
      mocks.state.updateResult = { data: null, error: { message: 'boom' } }
      mocks.resolveAttendantToken.mockResolvedValue(ATTENDANT)
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await POST(postRequest({ token: TOKEN }))

      expect(res.status).toBe(200)
      expect(res.cookies.get(ATTENDANT_COOKIE_NAME)?.value).toBe(TOKEN)
      spy.mockRestore()
    })
  })

  describe('GET (restaurar sessão pelo cookie)', () => {
    it('restaura a sessão a partir do cookie e renova o cookie', async () => {
      mocks.resolveAttendantToken.mockResolvedValue(ATTENDANT)

      const res = await GET(getRequest(TOKEN))
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data).toEqual({ valid: true, attendant: ATTENDANT })
      expect(mocks.resolveAttendantToken).toHaveBeenCalledWith(TOKEN)
      expect(res.cookies.get(ATTENDANT_COOKIE_NAME)?.value).toBe(TOKEN)
      expect(res.cookies.get(ATTENDANT_COOKIE_NAME)?.maxAge).toBe(THIRTY_DAYS)
    })

    it('sem cookie: 401 sem consultar o banco', async () => {
      const res = await GET(getRequest())
      const data = await res.json()

      expect(res.status).toBe(401)
      expect(data.valid).toBe(false)
      expect(mocks.resolveAttendantToken).not.toHaveBeenCalled()
    })

    it('cookie com token revogado: 401 e apaga o cookie', async () => {
      mocks.resolveAttendantToken.mockResolvedValue(null)

      const res = await GET(getRequest(TOKEN))

      expect(res.status).toBe(401)
      const cookie = res.cookies.get(ATTENDANT_COOKIE_NAME)
      expect(cookie?.value).toBe('')
      expect(cookie?.maxAge).toBe(0)
    })
  })

  describe('DELETE (logout)', () => {
    it('apaga o cookie do atendente', async () => {
      const res = await DELETE()
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data).toEqual({ success: true })
      const cookie = res.cookies.get(ATTENDANT_COOKIE_NAME)
      expect(cookie?.value).toBe('')
      expect(cookie?.maxAge).toBe(0)
      expect(cookie?.path).toBe('/')
      expect(cookie?.httpOnly).toBe(true)
    })
  })
})
