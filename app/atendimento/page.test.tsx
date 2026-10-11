import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttendantProvider } from '@/components/attendant/AttendantProvider'
import AtendimentoPage from '@/app/atendimento/page'

/**
 * PWA de atendente (/atendimento) com o banco oscilando: 503 no validate ou no
 * polling NÃO pode virar "Acesso Negado / solicite um novo link".
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/hooks/useTemplatesWithButtons', () => ({
  useTemplatesWithButtons: () => ({ templates: [] }),
}))

const ATTENDANT = {
  id: 'att-1',
  name: 'Ana',
  permissions: { canView: true, canReply: true, canHandoff: false },
}

const CONVERSATIONS = {
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

function jsonResponse(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => data,
  } as unknown as Response
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

function renderPage() {
  // retryDelay mínimo: o teste não espera o backoff padrão do react-query
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } })
  return render(
    <QueryClientProvider client={client}>
      <AttendantProvider token={null}>
        <AtendimentoPage />
      </AttendantProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AtendimentoPage com o banco indisponível', () => {
  // Cenário do achado: reload da PWA durante a oscilação → GET validate 503.
  // Antes: "Acesso Negado ... solicite um novo link de acesso ao administrador".
  it('validate 503 ao restaurar a sessão: mostra "Reconectando", não "Acesso Negado"', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { valid: false, error: 'Banco indisponível' }, { 'Retry-After': '5' })
    )

    renderPage()

    expect(await screen.findByText('Reconectando...')).toBeTruthy()
    expect(screen.queryByText('Acesso Negado')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tentar agora' })).toBeTruthy()
  })

  it('polling com 503 depois de logado: mantém a lista e mostra a faixa de reconexão', async () => {
    let conversationsStatus = 200
    fetchMock.mockImplementation(async (input) => {
      if (String(input).startsWith('/api/attendants/validate')) {
        return jsonResponse(200, { valid: true, attendant: ATTENDANT })
      }
      return conversationsStatus === 200 ? jsonResponse(200, CONVERSATIONS) : jsonResponse(503, {})
    })

    renderPage()
    expect(await screen.findByText('Maria')).toBeTruthy()

    conversationsStatus = 503
    // Força um refetch (como o polling faria) pelo botão "Atualizar"
    fireEvent.click(screen.getByTitle('Atualizar'))

    await waitFor(() => expect(screen.getByText('Conexão instável. Tentando reconectar...')).toBeTruthy())
    expect(screen.getByText('Maria')).toBeTruthy()
    expect(screen.queryByText('Acesso Negado')).toBeNull()
    expect(screen.queryByText('Sua sessão expirou ou o acesso foi revogado')).toBeNull()

    // O banco voltou: a faixa some no próximo ciclo
    conversationsStatus = 200
    fireEvent.click(screen.getByTitle('Atualizar'))
    await waitFor(() => expect(screen.queryByText('Conexão instável. Tentando reconectar...')).toBeNull())
  })

  it('validate 401 (token revogado): aí sim "Acesso Negado"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { valid: false, error: 'Token inválido ou expirado' }))

    renderPage()

    expect(await screen.findByText('Acesso Negado')).toBeTruthy()
    expect(screen.getByText('Token inválido ou expirado')).toBeTruthy()
  })
})
