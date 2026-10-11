import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttendantProvider, useAttendant } from '@/components/attendant/AttendantProvider'

/**
 * AttendantProvider: com ?token valida via POST (servidor grava o cookie);
 * sem ?token restaura a sessão via GET (cookie httpOnly, invisível ao JS).
 */

const ATTENDANT = {
  id: 'att-1',
  name: 'Ana',
  permissions: { canView: true, canReply: true, canHandoff: false },
}

type FetchCall = [input: string, init?: RequestInit]

function jsonResponse(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response
}

function Probe() {
  const ctx = useAttendant()
  return (
    <div>
      <span data-testid="ready">{String(ctx.isReady)}</span>
      <span data-testid="validating">{String(ctx.isValidating)}</span>
      <span data-testid="auth">{String(ctx.isAuthenticated)}</span>
      <span data-testid="name">{ctx.attendant?.name ?? ''}</span>
      <span data-testid="error">{ctx.error ?? ''}</span>
      <span data-testid="canReply">{String(ctx.canReply)}</span>
      <span data-testid="canHandoff">{String(ctx.canHandoff)}</span>
      <button type="button" onClick={() => void ctx.logout()}>
        sair
      </button>
    </div>
  )
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

function calls(): FetchCall[] {
  return fetchMock.mock.calls as FetchCall[]
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AttendantProvider', () => {
  it('sem ?token: restaura a sessão pelo cookie (GET)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { valid: true, attendant: ATTENDANT }))

    render(
      <AttendantProvider token={null}>
        <Probe />
      </AttendantProvider>
    )

    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = calls()[0]
    expect(url).toBe('/api/attendants/validate')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(screen.getByTestId('ready').textContent).toBe('true')
    expect(screen.getByTestId('validating').textContent).toBe('false')
    expect(screen.getByTestId('name').textContent).toBe('Ana')
    expect(screen.getByTestId('canReply').textContent).toBe('true')
    expect(screen.getByTestId('canHandoff').textContent).toBe('false')
    expect(screen.getByTestId('error').textContent).toBe('')
  })

  it('sem ?token e sem cookie válido: não autentica e mostra o erro do servidor', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { valid: false, error: 'Sessão de atendente não encontrada.' })
    )

    render(
      <AttendantProvider token={null}>
        <Probe />
      </AttendantProvider>
    )

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    expect(screen.getByTestId('auth').textContent).toBe('false')
    expect(screen.getByTestId('error').textContent).toBe('Sessão de atendente não encontrada.')
  })

  it('com ?token: valida via POST (o servidor grava o cookie)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { valid: true, attendant: ATTENDANT }))

    render(
      <AttendantProvider token="abc123">
        <Probe />
      </AttendantProvider>
    )

    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = calls()[0]
    expect(url).toBe('/api/attendants/validate')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ token: 'abc123' })
    expect(screen.getByTestId('name').textContent).toBe('Ana')
  })

  it('navegação interna sem ?token depois do login: não revalida (segue pelo cookie)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { valid: true, attendant: ATTENDANT }))

    const { rerender } = render(
      <AttendantProvider token="abc123">
        <Probe />
      </AttendantProvider>
    )
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'))

    rerender(
      <AttendantProvider token={null}>
        <Probe />
      </AttendantProvider>
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('auth').textContent).toBe('true')
  })

  it('voltar para o link com ?token já autenticado: revalida sem voltar para o loading', async () => {
    const upgraded = { ...ATTENDANT, permissions: { ...ATTENDANT.permissions, canHandoff: true } }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { valid: true, attendant: ATTENDANT }))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { valid: true, attendant: upgraded }))

    const { rerender } = render(
      <AttendantProvider token={null}>
        <Probe />
      </AttendantProvider>
    )
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'))

    rerender(
      <AttendantProvider token="abc123">
        <Probe />
      </AttendantProvider>
    )

    expect(screen.getByTestId('validating').textContent).toBe('false')
    await waitFor(() => expect(screen.getByTestId('canHandoff').textContent).toBe('true'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(calls()[1][1]?.method).toBe('POST')
    expect(screen.getByTestId('auth').textContent).toBe('true')
  })

  it('com ?token inválido: não autentica e mantém a mensagem do servidor', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { valid: false, error: 'Token inválido ou expirado' }))

    render(
      <AttendantProvider token="bad-token-bad-token">
        <Probe />
      </AttendantProvider>
    )

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    expect(screen.getByTestId('auth').textContent).toBe('false')
    expect(screen.getByTestId('error').textContent).toBe('Token inválido ou expirado')
  })

  it('falha de rede: não autentica', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AttendantProvider token={null}>
        <Probe />
      </AttendantProvider>
    )

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    expect(screen.getByTestId('auth').textContent).toBe('false')
    expect(screen.getByTestId('error').textContent).toBe('Erro ao validar token')
    spy.mockRestore()
  })

  it('logout: apaga o cookie (DELETE) e zera a sessão', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { valid: true, attendant: ATTENDANT }))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true }))

    render(
      <AttendantProvider token={null}>
        <Probe />
      </AttendantProvider>
    )
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'))

    await act(async () => {
      screen.getByRole('button', { name: 'sair' }).click()
    })

    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('false'))
    const [url, init] = calls()[1]
    expect(url).toBe('/api/attendants/validate')
    expect(init?.method).toBe('DELETE')
    expect(screen.getByTestId('name').textContent).toBe('')
    expect(screen.getByTestId('canReply').textContent).toBe('false')
  })
})
