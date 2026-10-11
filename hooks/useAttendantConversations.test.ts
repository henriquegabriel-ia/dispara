import { describe, expect, it } from 'vitest'
import { AttendantApiError, isAttendantAuthError } from '@/hooks/useAttendantConversations'

describe('isAttendantAuthError', () => {
  it('reconhece 401 e 403 da API do atendimento (sessão caiu / sem permissão)', () => {
    expect(isAttendantAuthError(new AttendantApiError('x', 401))).toBe(true)
    expect(isAttendantAuthError(new AttendantApiError('x', 403))).toBe(true)
  })

  it('não trata outros erros como erro de auth (continua o polling/retry)', () => {
    expect(isAttendantAuthError(new AttendantApiError('x', 500))).toBe(false)
    expect(isAttendantAuthError(new AttendantApiError('x', 404))).toBe(false)
    expect(isAttendantAuthError(new Error('x'))).toBe(false)
    expect(isAttendantAuthError(null)).toBe(false)
  })

  it('preserva o status no erro', () => {
    const error = new AttendantApiError('Falha ao carregar conversas', 401)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Falha ao carregar conversas')
    expect(error).toBeInstanceOf(Error)
  })
})
