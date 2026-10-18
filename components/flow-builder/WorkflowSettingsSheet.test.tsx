import React from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sheet "Configurações do workflow": reentrada, parar ao responder e janela de
 * horário. Aqui a API é mockada; o que acontece quando ESTE body chega na rota real
 * está em WorkflowSettingsSheet.route.test.ts (BUG settings-never-save).
 */

const apiMock = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/lib/builder/api-client', () => ({ api: { workflow: apiMock } }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: toastMock }))

import WorkflowSettingsSheet from '@/components/flow-builder/WorkflowSettingsSheet'
import type { WorkflowSettings } from '@/lib/builder/workflow-settings'

function renderSheet(initialSettings: WorkflowSettings = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['builder-workflow', 'wf'], { id: 'wf', name: 'Fluxo', nodes: [{ id: 'keep' }], edges: [], settings: initialSettings })
  const onClose = vi.fn()
  const utils = render(
    <QueryClientProvider client={client}>
      <WorkflowSettingsSheet workflowId="wf" initialSettings={initialSettings} onClose={onClose} />
    </QueryClientProvider>
  )
  return { ...utils, client, onClose }
}

const toggle = (label: string) => screen.getByText(label).closest('[role="switch"]') as HTMLButtonElement
const day = (label: string) => screen.getByRole('button', { name: label })
const isDayActive = (label: string) => day(label).className.includes('bg-primary-500')
const saveBtn = () => screen.getByRole('button', { name: /Salvar configurações/ })
const timeInputs = () => [...document.querySelectorAll('input[type="time"]')] as HTMLInputElement[]

beforeEach(() => {
  apiMock.update.mockReset()
  Object.values(toastMock).forEach((m) => m.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── WS-01 ─────────────────────────────────────────────────────────────────────

describe('WS-01 estado e validação local', () => {
  it('defaults: reentrada ligada, parar ao responder desligado, janela desligada', () => {
    renderSheet({})
    expect(screen.getByText('Configurações do workflow')).toBeInTheDocument()
    expect(toggle('Permitir reentrada')).toHaveAttribute('aria-checked', 'true')
    expect(toggle('Parar ao responder')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Janela de horário')).toHaveAttribute('aria-checked', 'false')
    expect(timeInputs()).toHaveLength(0)
  })

  it('ligar a janela mostra 09:00–18:00 e seg–sex', () => {
    renderSheet({})
    fireEvent.click(toggle('Janela de horário'))
    expect(toggle('Janela de horário')).toHaveAttribute('aria-checked', 'true')
    expect(timeInputs().map((i) => i.value)).toEqual(['09:00', '18:00'])
    expect(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].filter(isDayActive)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex'])
    expect(screen.getByText(/America\/Sao_Paulo/)).toBeInTheDocument()
  })

  it('settings existentes são refletidos', () => {
    renderSheet({ allowReentry: false, stopOnResponse: true, timeWindow: { enabled: true, start: '08:30', end: '12:00', days: [0, 6] } })
    expect(toggle('Permitir reentrada')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Parar ao responder')).toHaveAttribute('aria-checked', 'true')
    expect(timeInputs().map((i) => i.value)).toEqual(['08:30', '12:00'])
    expect(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].filter(isDayActive)).toEqual(['Dom', 'Sáb'])
  })

  it('os toggles alternam aria-checked', () => {
    renderSheet({})
    fireEvent.click(toggle('Permitir reentrada'))
    fireEvent.click(toggle('Parar ao responder'))
    expect(toggle('Permitir reentrada')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Parar ao responder')).toHaveAttribute('aria-checked', 'true')
  })

  it('janela sem nenhum dia → toast.error e nenhuma chamada à API', () => {
    const { onClose } = renderSheet({})
    fireEvent.click(toggle('Janela de horário'))
    for (const d of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']) fireEvent.click(day(d))
    fireEvent.click(saveBtn())
    expect(toastMock.error).toHaveBeenCalledWith('Selecione pelo menos um dia da semana para a janela')
    expect(apiMock.update).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('janela DESLIGADA sem dias não bloqueia o save', async () => {
    apiMock.update.mockResolvedValue({ settings: {} })
    renderSheet({ timeWindow: { enabled: false, start: '09:00', end: '18:00', days: [] } })
    fireEvent.click(saveBtn())
    await waitFor(() => expect(apiMock.update).toHaveBeenCalled())
  })

  it('Cancelar e backdrop fecham sem salvar', () => {
    const { onClose } = renderSheet({})
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar configurações' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(apiMock.update).not.toHaveBeenCalled()
  })
})

// ─── WS-02 ─────────────────────────────────────────────────────────────────────

describe('WS-02 salvar com a API mockada', () => {
  it('envia {settings} completo, atualiza só settings no cache, toast e fecha', async () => {
    const saved = { allowReentry: false, stopOnResponse: true, timeWindow: { enabled: true, start: '10:00', end: '17:00', days: [0, 1, 2, 3, 4, 5] } }
    apiMock.update.mockResolvedValue({ id: 'wf', settings: saved, nodes: [] })
    const { client, onClose } = renderSheet({})
    fireEvent.click(toggle('Permitir reentrada'))
    fireEvent.click(toggle('Parar ao responder'))
    fireEvent.click(toggle('Janela de horário'))
    fireEvent.change(timeInputs()[0], { target: { value: '10:00' } })
    fireEvent.change(timeInputs()[1], { target: { value: '17:00' } })
    fireEvent.click(day('Dom'))
    await act(async () => fireEvent.click(saveBtn()))

    expect(apiMock.update).toHaveBeenCalledTimes(1)
    // exatamente o body que a rota PATCH recebe (ver WorkflowSettingsSheet.route.test.ts)
    expect(apiMock.update).toHaveBeenCalledWith('wf', { settings: saved })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastMock.success).toHaveBeenCalledWith('Configurações salvas')
    expect(client.getQueryData(['builder-workflow', 'wf'])).toEqual({ id: 'wf', name: 'Fluxo', nodes: [{ id: 'keep' }], edges: [], settings: saved })
  })

  it('dias ficam ordenados ao religar', async () => {
    apiMock.update.mockResolvedValue({ settings: {} })
    renderSheet({})
    fireEvent.click(toggle('Janela de horário'))
    fireEvent.click(day('Seg'))
    fireEvent.click(day('Sáb'))
    fireEvent.click(day('Seg'))
    await act(async () => fireEvent.click(saveBtn()))
    expect(apiMock.update.mock.calls[0][1].settings.timeWindow.days).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('erro da API: toast.error, a sheet continua aberta e o botão volta', async () => {
    let reject!: (e: unknown) => void
    apiMock.update.mockReturnValue(new Promise((_, r) => (reject = r)))
    const { onClose } = renderSheet({})
    fireEvent.click(saveBtn())
    expect(saveBtn()).toBeDisabled()
    await act(async () => reject(new Error('O fluxo deve ter exatamente um node de gatilho (encontrado 0)')))
    expect(toastMock.error).toHaveBeenCalledWith('Falha ao salvar as configurações')
    expect(onClose).not.toHaveBeenCalled()
    expect(saveBtn()).not.toBeDisabled()
  })
})
