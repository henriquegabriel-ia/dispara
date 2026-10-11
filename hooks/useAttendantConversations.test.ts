import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AttendantApiError,
  attendantPollingInterval,
  isAttendantAuthError,
  isAttendantTransientError,
  shouldRetryAttendantQuery,
  useAttendantConversations,
} from '@/hooks/useAttendantConversations'
import { computeReconnectDelay, isTransientHttpStatus } from '@/components/attendant/attendant-reconnect'

describe('isAttendantAuthError', () => {
  it('reconhece 401 e 403 da API do atendimento (sessão caiu / sem permissão)', () => {
    expect(isAttendantAuthError(new AttendantApiError('x', 401))).toBe(true)
    expect(isAttendantAuthError(new AttendantApiError('x', 403))).toBe(true)
  })

  it('não trata outros erros como erro de auth (continua o polling/retry)', () => {
    expect(isAttendantAuthError(new AttendantApiError('x', 500))).toBe(false)
    expect(isAttendantAuthError(new AttendantApiError('x', 503))).toBe(false)
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

describe('isAttendantTransientError', () => {
  it('503 (banco indisponível), outros 5xx, 408/429 e falha de rede são transitórios', () => {
    expect(isAttendantTransientError(new AttendantApiError('x', 503))).toBe(true)
    expect(isAttendantTransientError(new AttendantApiError('x', 500))).toBe(true)
    expect(isAttendantTransientError(new AttendantApiError('x', 502))).toBe(true)
    expect(isAttendantTransientError(new AttendantApiError('x', 408))).toBe(true)
    expect(isAttendantTransientError(new AttendantApiError('x', 429))).toBe(true)
    expect(isAttendantTransientError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('401/403/404 e erros genéricos não são transitórios', () => {
    expect(isAttendantTransientError(new AttendantApiError('x', 401))).toBe(false)
    expect(isAttendantTransientError(new AttendantApiError('x', 403))).toBe(false)
    expect(isAttendantTransientError(new AttendantApiError('x', 404))).toBe(false)
    expect(isAttendantTransientError(new Error('x'))).toBe(false)
    expect(isAttendantTransientError(null)).toBe(false)
  })
})

describe('polling/retry das queries da PWA', () => {
  it('503 mantém o polling e o retry; 401/403 param', () => {
    expect(attendantPollingInterval(new AttendantApiError('x', 503), 10_000)).toBe(10_000)
    expect(attendantPollingInterval(new TypeError('Failed to fetch'), 10_000)).toBe(10_000)
    expect(attendantPollingInterval(null, 10_000)).toBe(10_000)
    expect(attendantPollingInterval(new AttendantApiError('x', 401), 10_000)).toBe(false)
    expect(attendantPollingInterval(new AttendantApiError('x', 403), 10_000)).toBe(false)

    expect(shouldRetryAttendantQuery(0, new AttendantApiError('x', 503))).toBe(true)
    expect(shouldRetryAttendantQuery(3, new AttendantApiError('x', 503))).toBe(false)
    expect(shouldRetryAttendantQuery(0, new AttendantApiError('x', 401))).toBe(false)
  })
})

describe('attendant-reconnect', () => {
  it('isTransientHttpStatus: 5xx, 408 e 429', () => {
    expect([500, 502, 503, 504, 408, 429].every(isTransientHttpStatus)).toBe(true)
    expect([200, 400, 401, 403, 404].some(isTransientHttpStatus)).toBe(false)
  })

  it('computeReconnectDelay: backoff exponencial com teto de 30s e piso no Retry-After', () => {
    expect(computeReconnectDelay(0)).toBe(1_000)
    expect(computeReconnectDelay(1)).toBe(2_000)
    expect(computeReconnectDelay(2)).toBe(4_000)
    expect(computeReconnectDelay(10)).toBe(30_000)
    expect(computeReconnectDelay(0, '5')).toBe(5_000)
    expect(computeReconnectDelay(4, '5')).toBe(16_000)
    expect(computeReconnectDelay(0, '120')).toBe(30_000)
    expect(computeReconnectDelay(0, 'Wed, 21 Oct 2026 07:28:00 GMT')).toBe(1_000)
  })
})

// =============================================================================
// Hook: o polling sobrevive a um 503 do proxy (banco oscilando)
// =============================================================================

describe('useAttendantConversations (polling)', () => {
  const fetchMock = vi.fn<(input: string) => Promise<Response>>()
  const OK_BODY = {
    conversations: [
      {
        id: 'c1',
        contactName: 'Maria',
        contactPhone: '+5511999999999',
        status: 'human_active',
        lastMessage: 'Oi',
        lastMessageAt: '2026-10-11T00:00:00.000Z',
        unreadCount: 0,
      },
    ],
    counts: { total: 1, urgent: 0, ai: 0, human: 1, resolved: 0 },
  }

  function response(status: number, body: unknown = {}): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
  }

  function wrapper() {
    // retryDelay mínimo para o teste não esperar o backoff padrão do react-query
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } })
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Cenário do achado da revisão: o proxy responde 503 enquanto o banco oscila.
  // O polling não pode parar nem virar "sessão expirada".
  it('503 é transitório: marca reconectando, segue o polling e recupera quando o banco volta', async () => {
    let healthy = false
    fetchMock.mockImplementation(async () => (healthy ? response(200, OK_BODY) : response(503)))

    const { result } = renderHook(() => useAttendantConversations({ refetchInterval: 20 }), {
      wrapper: wrapper(),
    })

    await waitFor(() => expect(result.current.error).toBeInstanceOf(AttendantApiError))
    expect(isAttendantAuthError(result.current.error)).toBe(false)
    expect(result.current.isReconnecting).toBe(true)
    const callsWhileDown = fetchMock.mock.calls.length
    // 1 tentativa + 3 retries
    expect(callsWhileDown).toBeGreaterThanOrEqual(4)

    healthy = true
    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    expect(result.current.isReconnecting).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsWhileDown)
  })

  it('401 para o polling (sessão encerrada) e não faz retry', async () => {
    fetchMock.mockResolvedValue(response(401))

    const { result } = renderHook(() => useAttendantConversations({ refetchInterval: 20 }), {
      wrapper: wrapper(),
    })

    await waitFor(() => expect(isAttendantAuthError(result.current.error)).toBe(true))
    expect(result.current.isReconnecting).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
