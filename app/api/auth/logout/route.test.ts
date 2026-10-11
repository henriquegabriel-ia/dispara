// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ logoutUser: vi.fn() }))

vi.mock('@/lib/user-auth', () => ({ logoutUser: mocks.logoutUser }))

import { POST } from './route'

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    mocks.logoutUser.mockReset()
    mocks.logoutUser.mockResolvedValue(undefined)
  })

  it('revoga a sessão e também apaga o cookie de atendente do mesmo navegador', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mocks.logoutUser).toHaveBeenCalledTimes(1)

    // Antes: só a sessão do dono saía; /atendimento continuava aberto para a próxima pessoa.
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toMatch(/dispara_attendant=;/)
    expect(setCookie).toMatch(/Max-Age=0/)
    expect(setCookie).toMatch(/Path=\//)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('erro no logout → 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.logoutUser.mockRejectedValue(new Error('boom'))
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
