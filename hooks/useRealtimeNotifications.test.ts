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

import {
  __resetCampaignConfirmationsForTests,
  CAMPAIGN_CONFIRM_BUDGET,
  CAMPAIGN_CONFIRM_BUDGET_WINDOW_MS,
  CAMPAIGN_CONFIRM_NEGATIVE_TTL_MS,
  confirmCampaignStatus,
  getCampaignFinalTransition,
  useRealtimeNotifications,
} from '@/hooks/useRealtimeNotifications'

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
  __resetCampaignConfirmationsForTests()
  vi.restoreAllMocks()
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

  it('evento forjado repetido para um id inexistente (404) busca a API uma vez só (cache negativo)', async () => {
    getById.mockResolvedValue(undefined)
    renderHook(() => useRealtimeNotifications({ enabled: true }))

    const forged = campaignUpdate({ id: 'c_forged', status: 'Concluído' }, null)
    for (let i = 0; i < 50; i++) {
      emit(forged)
      await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 10))

    expect(getById).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('flood com ids aleatórios fica limitado ao orçamento de buscas por janela', async () => {
    getById.mockResolvedValue(undefined)
    renderHook(() => useRealtimeNotifications({ enabled: true }))

    for (let i = 0; i < 100; i++) {
      emit(campaignUpdate({ id: `c_random_${i}`, status: i % 2 ? 'Concluído' : 'Falhou' }, null))
    }
    await new Promise((r) => setTimeout(r, 10))

    expect(getById).toHaveBeenCalledTimes(CAMPAIGN_CONFIRM_BUDGET)
  })
})

describe('confirmCampaignStatus', () => {
  it('deduplica a busca em curso por id (status diferentes reaproveitam a mesma requisição)', async () => {
    let resolveLookup: (value: unknown) => void = () => {}
    getById.mockReturnValue(new Promise((resolve) => (resolveLookup = resolve)))

    const done = confirmCampaignStatus('c1', 'Concluído')
    const failed = confirmCampaignStatus('c1', 'Falhou')
    expect(getById).toHaveBeenCalledTimes(1)

    resolveLookup({ id: 'c1', name: 'X', status: 'Concluído' })
    await expect(done).resolves.toMatchObject({ id: 'c1', status: 'Concluído' })
    await expect(failed).resolves.toBeNull()
  })

  it('cache negativo expira depois do TTL', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    getById.mockResolvedValue({ id: 'c1', name: 'X', status: 'Enviando' })

    await expect(confirmCampaignStatus('c1', 'Concluído')).resolves.toBeNull()
    await expect(confirmCampaignStatus('c1', 'Concluído')).resolves.toBeNull()
    expect(getById).toHaveBeenCalledTimes(1)

    // A campanha concluiu de verdade depois: passado o TTL, confirma de novo
    now.mockReturnValue(1_000_000 + CAMPAIGN_CONFIRM_NEGATIVE_TTL_MS + 1)
    getById.mockResolvedValue({ id: 'c1', name: 'X', status: 'Concluído' })
    await expect(confirmCampaignStatus('c1', 'Concluído')).resolves.toMatchObject({ status: 'Concluído' })
    expect(getById).toHaveBeenCalledTimes(2)
  })

  it('orçamento esgotado não entra no cache negativo e volta na janela seguinte', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    getById.mockResolvedValue(undefined)
    for (let i = 0; i < CAMPAIGN_CONFIRM_BUDGET; i++) {
      await confirmCampaignStatus(`c_${i}`, 'Concluído')
    }
    expect(getById).toHaveBeenCalledTimes(CAMPAIGN_CONFIRM_BUDGET)

    getById.mockResolvedValue({ id: 'c_real', name: 'Real', status: 'Concluído' })
    await expect(confirmCampaignStatus('c_real', 'Concluído')).resolves.toBeNull()
    expect(getById).toHaveBeenCalledTimes(CAMPAIGN_CONFIRM_BUDGET)

    now.mockReturnValue(5_000_000 + CAMPAIGN_CONFIRM_BUDGET_WINDOW_MS)
    await expect(confirmCampaignStatus('c_real', 'Concluído')).resolves.toMatchObject({ name: 'Real' })
  })
})
