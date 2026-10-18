import React from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Painel do GATILHO (ConfigPanel → TriggerPanelBody): trocar o tipo (Sem gatilho /
 * Palavra-chave / Respondeu ao disparo), keywords uma por linha, "Salvar gatilho" x
 * "Cancelar". O card do gatilho no canvas (TriggerNode alimentado por layoutFlow) só
 * pode mudar DEPOIS de salvar — o painel guarda estado local.
 */

const services = vi.hoisted(() => ({
  campaigns: vi.fn(),
  templates: vi.fn(),
  tags: vi.fn(),
}))
vi.mock('@/services/campaignService', () => ({ campaignService: { getAll: services.campaigns } }))
vi.mock('@/services/templateService', () => ({ templateService: { getAll: services.templates } }))
vi.mock('@/services/contactService', () => ({ contactService: { getTags: services.tags } }))
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

import ConfigPanel from '@/components/flow-builder/ConfigPanel'
import TriggerNode from '@/components/flow-builder/nodes/TriggerNode'
import { TRIGGER_SELECTION_ID, useFlowBuilderStore } from '@/components/flow-builder/store'
import { compileFlow } from '@/lib/builder/flow/compile'
import { layoutFlow } from '@/lib/builder/flow/layout'
import { createEmptyFlow } from '@/lib/builder/flow/operations'
import type { Flow, FlowTrigger } from '@/lib/builder/flow/types'

const store = () => useFlowBuilderStore.getState()

/** Card do gatilho como o canvas desenha (data vindo de layoutFlow do store). */
function LiveTrigger() {
  const flow = useFlowBuilderStore((s) => s.flow)
  if (!flow) return null
  const data = layoutFlow(flow).nodes[0].data
  return <TriggerNode {...({ id: '__trigger', type: 'trigger', data, selected: false } as unknown as NodeProps)} />
}

function renderTriggerPanel(flow: Flow) {
  store().loadFlow(flow)
  store().select(TRIGGER_SELECTION_ID)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <div data-testid="panel">
        <ConfigPanel />
      </div>
      <div data-testid="canvas">
        <LiveTrigger />
      </div>
    </QueryClientProvider>
  )
  const panel = within(screen.getByTestId('panel'))
  const canvas = within(screen.getByTestId('canvas'))
  const panelRoot = screen.getByTestId('panel').firstElementChild as HTMLElement
  return { ...utils, panel, canvas, panelRoot, client }
}

const flowWith = (trigger: FlowTrigger): Flow => ({ ...createEmptyFlow({ id: 'wf', name: 'Fluxo' }), trigger })

const optionButton = (panel: ReturnType<typeof within>, label: string) => panel.getByText(label, { selector: 'p' }).closest('button') as HTMLButtonElement
const isActive = (btn: HTMLElement) => btn.className.includes('ring-2')
const activeOption = (panel: ReturnType<typeof within>) =>
  ['Sem gatilho', 'Palavra-chave', 'Respondeu ao disparo'].filter((l) => isActive(optionButton(panel, l)))
const textarea = (root: HTMLElement) => root.querySelector('textarea') as HTMLTextAreaElement
const campaignSelect = (root: HTMLElement) => root.querySelector('select') as HTMLSelectElement
const filterInput = (root: HTMLElement) => root.querySelector('input[placeholder="ex.: quero"]') as HTMLInputElement

beforeEach(() => {
  store().reset()
  useFlowBuilderStore.setState({ saveMode: 'config' })
  services.campaigns.mockReset().mockResolvedValue([{ id: 'c1', name: 'Black Friday' }, { id: 'c2', name: 'Natal' }])
  services.templates.mockReset().mockResolvedValue([])
  services.tags.mockReset().mockResolvedValue([])
})

afterEach(() => cleanup())

// ─── TP-01 ─────────────────────────────────────────────────────────────────────

describe('TP-01 painel abre e reflete o tipo atual', () => {
  it.each<[string, FlowTrigger, string]>([
    ['none', { type: 'none', label: '', keywords: [] }, 'Sem gatilho'],
    ['keywords', { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }, 'Palavra-chave'],
    ['campaign_reply', { type: 'campaign_reply', label: 'Respondeu ao disparo', keywords: [] }, 'Respondeu ao disparo'],
    ['sem type (legado) = keywords', { label: 'Palavras-chave', keywords: ['oi'] }, 'Palavra-chave'],
  ])('%s', (_, trigger, active) => {
    const { panel, panelRoot } = renderTriggerPanel(flowWith(trigger))
    expect(panel.getByText('Gatilho do fluxo')).toBeInTheDocument()
    expect(panel.getByText('Define como os contatos entram neste workflow')).toBeInTheDocument()
    expect(activeOption(panel)).toEqual([active])
    expect(panelRoot.className).toContain('translate-x-0')
    expect(panel.getByRole('button', { name: 'Salvar gatilho' })).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('keywords existentes aparecem uma por linha', () => {
    const { panelRoot } = renderTriggerPanel(flowWith({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi', 'quero comprar'] }))
    expect(textarea(panelRoot).value).toBe('oi\nquero comprar')
  })

  it('sem seleção o painel fica fechado (translate-x-full) e vazio', () => {
    store().loadFlow(createEmptyFlow())
    const client = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={client}>
        <ConfigPanel />
      </QueryClientProvider>
    )
    expect((container.firstElementChild as HTMLElement).className).toContain('translate-x-full')
    expect(screen.queryByText('Gatilho do fluxo')).not.toBeInTheDocument()
  })
})

// ─── TP-02 / TP-03 ─────────────────────────────────────────────────────────────

describe('TP-02 o canvas só reflete o gatilho depois de salvar', () => {
  it('trocar o tipo e digitar não muda store nem card; "Salvar gatilho" muda', () => {
    const { panel, canvas, panelRoot } = renderTriggerPanel(createEmptyFlow({ id: 'wf', name: 'Fluxo' }))
    const before = store().flow!.trigger
    expect(canvas.getByText('Adicionar novo gatilho')).toBeInTheDocument()

    fireEvent.click(optionButton(panel, 'Palavra-chave'))
    fireEvent.change(textarea(panelRoot), { target: { value: 'oi\nquero' } })
    expect(store().flow!.trigger).toBe(before)
    expect(store()).toMatchObject({ rev: 0, past: [] })
    expect(canvas.getByText('Adicionar novo gatilho')).toBeInTheDocument()
    expect(canvas.queryByText('2 palavras-chave')).not.toBeInTheDocument()

    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi', 'quero'] })
    expect(store()).toMatchObject({ rev: 1, saveMode: 'config' })
    expect(canvas.getByText('Palavras-chave')).toBeInTheDocument()
    expect(canvas.getByText('2 palavras-chave')).toBeInTheDocument()
  })
})

describe('TP-03 keywords uma por linha e normalização', () => {
  it('trim, sem linhas vazias; o textarea re-sincroniza; o compile junta com \\n', () => {
    const { panel, canvas, panelRoot } = renderTriggerPanel(createEmptyFlow({ id: 'wf', name: 'Fluxo' }))
    fireEvent.click(optionButton(panel, 'Palavra-chave'))
    fireEvent.change(textarea(panelRoot), { target: { value: '  Oi \n\nQuero comprar\n  ' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ type: 'keywords', label: 'Palavras-chave', keywords: ['Oi', 'Quero comprar'] })
    expect(textarea(panelRoot).value).toBe('Oi\nQuero comprar')
    expect(canvas.getByText('2 palavras-chave')).toBeInTheDocument()
    const trigger = compileFlow(store().flow!).nodes.find((n) => n.id === '__trigger')!
    expect(trigger.data).toMatchObject({ label: 'Palavras-chave', config: { triggerType: 'Keywords', keywordList: 'Oi\nQuero comprar' } })
  })

  it('uma palavra só → "1 palavra-chave"; zero → "Definir palavras-chave"', () => {
    const { panel, canvas, panelRoot } = renderTriggerPanel(createEmptyFlow({ id: 'wf', name: 'Fluxo' }))
    fireEvent.click(optionButton(panel, 'Palavra-chave'))
    fireEvent.change(textarea(panelRoot), { target: { value: 'oi' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(canvas.getByText('1 palavra-chave')).toBeInTheDocument()
    fireEvent.change(textarea(panelRoot), { target: { value: '   \n ' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger.keywords).toEqual([])
    expect(canvas.getByText('Definir palavras-chave')).toBeInTheDocument()
  })

  it('a dica promete match exato normalizado (contrato com o webhook — ver CT-01)', () => {
    const { panel } = renderTriggerPanel(flowWith({ type: 'keywords', label: 'Palavras-chave', keywords: [] }))
    expect(panel.getByText(/match exato, normalizado/)).toBeInTheDocument()
  })
})

// ─── TP-04 / TP-05 ─────────────────────────────────────────────────────────────

describe('TP-04 Cancelar descarta a edição local', () => {
  it('volta aos valores do store sem mexer no store', () => {
    const { panel, panelRoot } = renderTriggerPanel(flowWith({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }))
    fireEvent.change(textarea(panelRoot), { target: { value: 'outra' } })
    fireEvent.click(optionButton(panel, 'Respondeu ao disparo'))
    expect(activeOption(panel)).toEqual(['Respondeu ao disparo'])
    fireEvent.click(panel.getByRole('button', { name: 'Cancelar' }))
    expect(activeOption(panel)).toEqual(['Palavra-chave'])
    expect(textarea(panelRoot).value).toBe('oi')
    expect(store()).toMatchObject({ rev: 0, past: [] })
    expect(store().flow!.trigger.keywords).toEqual(['oi'])
  })
})

describe('TP-05 Sem gatilho', () => {
  it('a partir de keywords: instrução de inscrição manual, card "Adicionar novo gatilho" e compile None', () => {
    const { panel, canvas } = renderTriggerPanel(flowWith({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }))
    expect(canvas.getByText('1 palavra-chave')).toBeInTheDocument()
    fireEvent.click(optionButton(panel, 'Sem gatilho'))
    expect(panel.getByText(/O fluxo não dispara sozinho/)).toBeInTheDocument()
    expect(panel.getByText('Adicionar ao workflow')).toBeInTheDocument()
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ type: 'none', label: '' })
    // as keywords antigas ficam guardadas (o compile as ignora)
    expect(store().flow!.trigger.keywords).toEqual(['oi'])
    expect(canvas.getByText('Adicionar novo gatilho')).toBeInTheDocument()
    expect(canvas.getByText('Sem gatilho — inscrição manual pela lista de contatos')).toBeInTheDocument()
    const trigger = compileFlow(store().flow!).nodes.find((n) => n.id === '__trigger')!
    expect(trigger.data).toMatchObject({ label: 'Sem gatilho (entrada manual)', config: { triggerType: 'None' } })
  })
})

// ─── TP-06 / TP-07 ─────────────────────────────────────────────────────────────

describe('TP-06 Respondeu ao disparo: campanha e filtro', () => {
  it('campanhas só carregam no tipo campaign_reply; salvar grava id, nome e filtro', async () => {
    const { panel, canvas, panelRoot } = renderTriggerPanel(flowWith({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }))
    expect(services.campaigns).not.toHaveBeenCalled()

    fireEvent.click(optionButton(panel, 'Respondeu ao disparo'))
    await waitFor(() => expect(panel.getByRole('option', { name: 'Black Friday' })).toBeInTheDocument())
    expect(services.campaigns).toHaveBeenCalledTimes(1)
    expect(panel.getByRole('option', { name: 'Qualquer disparo' })).toBeInTheDocument()

    fireEvent.change(campaignSelect(panelRoot), { target: { value: 'c1' } })
    fireEvent.change(filterInput(panelRoot), { target: { value: '  quero  ' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({
      type: 'campaign_reply',
      label: 'Respondeu ao disparo',
      campaignId: 'c1',
      campaignName: 'Black Friday',
      replyFilter: 'quero',
    })
    expect(canvas.getByText('Respondeu ao disparo')).toBeInTheDocument()
    expect(canvas.getByText('Campanha: Black Friday · contém "quero"')).toBeInTheDocument()
    expect(compileFlow(store().flow!).nodes[0].data.config).toEqual({
      triggerType: 'CampaignReply',
      campaignId: 'c1',
      campaignName: 'Black Friday',
      replyFilter: 'quero',
    })

    // "Qualquer disparo"
    fireEvent.change(campaignSelect(panelRoot), { target: { value: '' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ campaignId: null, campaignName: '' })
    expect(canvas.getByText('Resposta a qualquer disparo · contém "quero"')).toBeInTheDocument()
    expect(compileFlow(store().flow!).nodes[0].data.config).toMatchObject({ triggerType: 'CampaignReply', campaignId: '' })
  })

  it('select desabilitado enquanto carrega, com a dica "Carregando campanhas..."', async () => {
    let release!: (v: unknown) => void
    services.campaigns.mockReturnValueOnce(new Promise((r) => (release = r)))
    const { panel, panelRoot } = renderTriggerPanel(flowWith({ type: 'campaign_reply', label: 'Respondeu ao disparo', keywords: [] }))
    expect(campaignSelect(panelRoot)).toBeDisabled()
    expect(panel.getByText('Carregando campanhas...')).toBeInTheDocument()
    await act(async () => release([{ id: 'c1', name: 'Black Friday' }]))
    await waitFor(() => expect(campaignSelect(panelRoot)).not.toBeDisabled())
    expect(panel.getByRole('option', { name: 'Black Friday' })).toBeInTheDocument()
  })
})

describe('TP-07 campaign_reply → keywords limpa os filtros', () => {
  it('campaignId null, campaignName "" e replyFilter ""; keywords preservadas', async () => {
    const { panel, panelRoot } = renderTriggerPanel(
      flowWith({ type: 'campaign_reply', label: 'Respondeu ao disparo', keywords: ['oi'], campaignId: 'c1', campaignName: 'Black Friday', replyFilter: 'quero' })
    )
    await waitFor(() => expect(panel.getByRole('option', { name: 'Black Friday' })).toBeInTheDocument())
    expect(campaignSelect(panelRoot).value).toBe('c1')
    expect(filterInput(panelRoot).value).toBe('quero')
    fireEvent.click(optionButton(panel, 'Palavra-chave'))
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toEqual({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi'], campaignId: null, campaignName: '', replyFilter: '' })
  })
})

// ─── TP-08 ─────────────────────────────────────────────────────────────────────

describe('TP-08 undo e fechar', () => {
  it('desfazer com o painel aberto re-sincroniza o formulário', () => {
    const { panel, panelRoot, canvas } = renderTriggerPanel(flowWith({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }))
    fireEvent.change(textarea(panelRoot), { target: { value: 'oi\nolá\nbom dia' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(canvas.getByText('3 palavras-chave')).toBeInTheDocument()
    act(() => store().undo())
    expect(textarea(panelRoot).value).toBe('oi')
    expect(canvas.getByText('1 palavra-chave')).toBeInTheDocument()
    expect(store().selectedStepId).toBe(TRIGGER_SELECTION_ID) // painel continua aberto
  })

  it('o X fecha o painel', () => {
    const { panel, panelRoot } = renderTriggerPanel(flowWith({ type: 'none', label: '', keywords: [] }))
    fireEvent.click(panel.getByRole('button', { name: 'Fechar painel' }))
    expect(store().selectedStepId).toBeNull()
    expect(panelRoot.className).toContain('translate-x-full')
    expect(screen.queryByText('Gatilho do fluxo')).not.toBeInTheDocument()
  })
})

// ─── TP-09 / TP-10 ─────────────────────────────────────────────────────────────

describe('TP-09 nome da campanha quando a lista não está disponível', () => {
  const saved: FlowTrigger = {
    type: 'campaign_reply',
    label: 'Respondeu ao disparo',
    keywords: [],
    campaignId: 'c1',
    campaignName: 'Black Friday',
    replyFilter: '',
  }

  // BUG(campaign-name-wipe): campaignName = selectedCampaign?.name ?? '' (ConfigPanel.tsx:147-148).
  // Com a lista de campanhas carregando/falhando (ou a campanha já excluída), salvar
  // apaga o nome mas mantém o campaignId: o card passa a dizer "Resposta a qualquer
  // disparo" enquanto o webhook filtra só pela campanha c1.
  it.fails('salvar com a lista ainda carregando mantém "Black Friday"', () => {
    services.campaigns.mockReturnValue(new Promise(() => {}))
    const { panel, panelRoot } = renderTriggerPanel(flowWith(saved))
    fireEvent.change(filterInput(panelRoot), { target: { value: 'quero' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ campaignId: 'c1', campaignName: 'Black Friday', replyFilter: 'quero' })
  })

  it.fails('salvar com erro ao carregar as campanhas mantém "Black Friday"', async () => {
    services.campaigns.mockRejectedValue(new Error('500'))
    const { panel, panelRoot } = renderTriggerPanel(flowWith(saved))
    await waitFor(() => expect(campaignSelect(panelRoot)).not.toBeDisabled())
    fireEvent.change(filterInput(panelRoot), { target: { value: 'quero' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ campaignId: 'c1', campaignName: 'Black Friday' })
  })

  it('caracterização: hoje o nome some e o card mente', () => {
    services.campaigns.mockReturnValue(new Promise(() => {}))
    const { panel, canvas, panelRoot } = renderTriggerPanel(flowWith(saved))
    expect(canvas.getByText('Campanha: Black Friday')).toBeInTheDocument()
    fireEvent.change(filterInput(panelRoot), { target: { value: 'quero' } })
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().flow!.trigger).toMatchObject({ campaignId: 'c1', campaignName: '' })
    expect(canvas.getByText('Resposta a qualquer disparo · contém "quero"')).toBeInTheDocument()
  })
})

describe('TP-10 "Salvar gatilho" sem mudanças', () => {
  // BUG(trigger-noop): ver OPS-09. Pela tela: abrir o gatilho de um fluxo novo e clicar
  // "Salvar gatilho" sem mudar nada cria uma entrada de undo e dispara autosave.
  it.fails('fluxo novo: salvar sem mudanças não gera undo nem rev', () => {
    const { panel } = renderTriggerPanel(createEmptyFlow({ id: 'wf', name: 'Fluxo' }))
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store()).toMatchObject({ rev: 0, past: [] })
  })

  it('depois do primeiro save, salvar de novo sem mudanças é no-op', () => {
    const { panel } = renderTriggerPanel(createEmptyFlow({ id: 'wf', name: 'Fluxo' }))
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    const rev = store().rev
    fireEvent.click(panel.getByRole('button', { name: 'Salvar gatilho' }))
    expect(store().rev).toBe(rev)
  })
})
