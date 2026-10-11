import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { RealtimePayload } from '@/types'

const tableCallbacks: Array<{ table: string; cb: (payload: RealtimePayload) => void }> = []

vi.mock('@/lib/supabase-realtime', () => ({
  createRealtimeChannel: vi.fn(() => ({})),
  subscribeToTable: vi.fn((_channel: unknown, table: string, _event: string, cb: (p: RealtimePayload) => void) => {
    tableCallbacks.push({ table, cb })
  }),
  activateChannel: vi.fn(() => Promise.resolve()),
  removeChannel: vi.fn(),
}))

const getById = vi.fn()
vi.mock('@/services/campaignService', () => ({
  campaignService: { getById: (id: string) => getById(id) },
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: toastMock }))

import { getCampaignFinalTransition, useRealtimeNotifications } from '@/hooks/useRealtimeNotifications'

function campaignUpdate(
  next: Record<string, unknown>,
  prev: Record<string, unknown> | null
): RealtimePayload {
  return {
    schema: 'public',
    table: 'campaigns',
    commit_timestamp: '',
    eventType: 'UPDATE',
    new: next,
    old: prev,
    errors: null,
  }
}

function emit(payload: RealtimePayload) {
  for (const { table, cb } of tableCallbacks) {
    if (table === payload.table) cb(payload)
  }
}

beforeEach(() => {
  tableCallbacks.length = 0
  getById.mockReset()
  Object.values(toastMock).forEach((fn) => fn.mockReset())
})

describe('getCampaignFinalTransition', () => {
  it('detecta transição para Concluído e Falhou', () => {
    expect(
      getCampaignFinalTransition(campaignUpdate({ id: 'c1', status: 'Concluído' }, { id: 'c1', status: 'Enviando' }))
    ).toEqual({ id: 'c1', status: 'Concluído' })
    expect(
      getCampaignFinalTransition(campaignUpdate({ id: 'c1', status: 'Falhou' }, { id: 'c1', status: 'Enviando' }))
    ).toEqual({ id: 'c1', status: 'Falhou' })
  })

  it('detecta conclusão por completed_at preenchido', () => {
    expect(
      getCampaignFinalTransition(
        campaignUpdate(
          { id: 'c1', status: 'Concluído', completed_at: '2026-10-11T10:00:00Z' },
          { id: 'c1', status: 'Concluído', completed_at: null }
        )
      )
    ).toEqual({ id: 'c1', status: 'Concluído' })
  })

  it('não trata update de contadores depois da conclusão como transição', () => {
    expect(
      getCampaignFinalTransition(
        campaignUpdate(
          { id: 'c1', status: 'Concluído', delivered: 10, completed_at: '2026-10-11T10:00:00Z' },
          { id: 'c1', status: 'Concluído', delivered: 9, completed_at: '2026-10-11T10:00:00Z' }
        )
      )
    ).toBeNull()
  })

  it('ignora INSERT, status não final e payload sem id', () => {
    expect(
      getCampaignFinalTransition({ ...campaignUpdate({ id: 'c1', status: 'Concluído' }, null), eventType: 'INSERT' })
    ).toBeNull()
    expect(getCampaignFinalTransition(campaignUpdate({ id: 'c1', status: 'Enviando' }, null))).toBeNull()
    expect(getCampaignFinalTransition(campaignUpdate({ status: 'Concluído' }, null))).toBeNull()
  })
})

describe('useRealtimeNotifications (payload sem PII)', () => {
  it('busca o nome pela API autenticada e mostra o toast', async () => {
    getById.mockResolvedValue({ id: 'c1', name: 'Black Friday', status: 'Concluído' })
    renderHook(() => useRealtimeNotifications({ enabled: true }))

    emit(campaignUpdate({ id: 'c1', status: 'Concluído' }, { id: 'c1', status: 'Enviando' }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1))
    expect(getById).toHaveBeenCalledWith('c1')
    expect(toastMock.success).toHaveBeenCalledWith('Campanha "Black Friday" concluída!', { id: 'campaign:c1:Concluído' })
  })

  it('evento forjado (API não confirma o status) não gera toast', async () => {
    getById.mockResolvedValue({ id: 'c1', name: 'Black Friday', status: 'Enviando' })
    renderHook(() => useRealtimeNotifications({ enabled: true }))

    emit(campaignUpdate({ id: 'c1', status: 'Falhou' }, { id: 'c1', status: 'Enviando' }))

    await waitFor(() => expect(getById).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('não busca nada para updates que não são transição e deduplica', async () => {
    getById.mockResolvedValue({ id: 'c1', name: 'X', status: 'Concluído' })
    renderHook(() => useRealtimeNotifications({ enabled: true }))

    emit(campaignUpdate({ id: 'c1', status: 'Enviando', sent: 5 }, { id: 'c1', status: 'Enviando', sent: 4 }))
    expect(getById).not.toHaveBeenCalled()

    const done = campaignUpdate({ id: 'c1', status: 'Concluído' }, { id: 'c1', status: 'Enviando' })
    emit(done)
    emit(done)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1))
    expect(getById).toHaveBeenCalledTimes(1)

    emit(done)
    await new Promise((r) => setTimeout(r, 10))
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })
})
