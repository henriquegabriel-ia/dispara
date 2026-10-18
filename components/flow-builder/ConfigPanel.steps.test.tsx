import React from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Painel de configuração de cada PASSO (ConfigPanel → PanelBody + forms por tipo).
 * O painel guarda estado local e só grava no store em "Salvar ação" (patchStep);
 * "Cancelar" reverte. Aqui exercitamos o painel real + store real + layoutFlow
 * (subtítulo do card) + compileFlow (o que vai para o servidor).
 */

const services = vi.hoisted(() => ({
  campaigns: vi.fn(),
  templates: vi.fn(),
  tags: vi.fn(),
}))
vi.mock('@/services/campaignService', () => ({ campaignService: { getAll: services.campaigns } }))
vi.mock('@/services/templateService', () => ({ templateService: { getAll: services.templates } }))
vi.mock('@/services/contactService', () => ({ contactService: { getTags: services.tags } }))

import ConfigPanel from '@/components/flow-builder/ConfigPanel'
import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { compileFlow, FlowCompileError } from '@/lib/builder/flow/compile'
import { layoutFlow } from '@/lib/builder/flow/layout'
import { addStep, createEmptyFlow, findStep, listSteps } from '@/lib/builder/flow/operations'
import { validateTree } from '@/lib/builder/flow/tree-validate'
import type { Branch, Flow, Step, StepType } from '@/lib/builder/flow/types'

const store = () => useFlowBuilderStore.getState()

const wa = (id: string, next: Step | null = null, config: Record<string, unknown> = { template: '', mediaUrl: '', message: `msg ${id}` }): Step => ({
  id,
  type: 'whatsapp',
  name: `W ${id}`,
  config,
  next,
})
const simple = (id: string, type: StepType, config: Record<string, unknown>, next: Step | null = null, name = `${type} ${id}`): Step => ({
  id,
  type,
  name,
  config,
  next,
})
const br = (id: string, label: string, child: Step | null = null, extra: Partial<Branch> = {}): Branch => ({ id, label, child, ...extra })

const flowOf = (root: Step | null): Flow => ({
  schemaVersion: 1,
  id: 'wf',
  name: 'Fluxo',
  trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
  root,
})

const subtitleOf = (id: string) => {
  const n = layoutFlow(store().flow!).nodes.find((x) => x.id === id)
  return (n?.data as { subtitle?: string } | undefined)?.subtitle
}
const compiledNode = (id: string) => compileFlow(store().flow!).nodes.find((n) => n.id === id)

function renderPanel(flow: Flow, selectId: string) {
  store().loadFlow(flow)
  store().select(selectId)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <div data-testid="panel">
        <ConfigPanel />
      </div>
    </QueryClientProvider>
  )
  const root = screen.getByTestId('panel').firstElementChild as HTMLElement
  const panel = within(root)
  return { ...utils, panel, root, client }
}

const saveBtn = (panel: ReturnType<typeof within>) => panel.getByRole('button', { name: 'Salvar ação' })
const cancelBtn = (panel: ReturnType<typeof within>) => panel.getByRole('button', { name: 'Cancelar' })
const nameInput = (panel: ReturnType<typeof within>) => panel.getByLabelText('Nome da ação') as HTMLInputElement

const TEMPLATES = [
  { id: 't1', name: 'promo', language: 'en_US', category: 'MARKETING', status: 'APPROVED', content: '', preview: '', lastUpdated: '' },
  { id: 't2', name: 'boas_vindas', language: 'pt_BR', category: 'UTILIDADE', status: 'APPROVED', content: '', preview: '', lastUpdated: '' },
  { id: 't3', name: 'pendente', language: 'pt_BR', category: 'MARKETING', status: 'PENDING', content: '', preview: '', lastUpdated: '' },
]

let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  store().reset()
  useFlowBuilderStore.setState({ saveMode: 'config' })
  services.campaigns.mockReset().mockResolvedValue([])
  services.templates.mockReset().mockResolvedValue(TEMPLATES)
  services.tags.mockReset().mockResolvedValue(['vip', 'lead'])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  confirmSpy.mockRestore()
  vi.unstubAllGlobals()
})

// ─── SP-01 WhatsApp ────────────────────────────────────────────────────────────

describe('SP-01 painel WhatsApp', () => {
  it('só templates APPROVED viram opção; salvar grava template, mídia e mensagem', async () => {
    const { panel, root } = renderPanel(flowOf(wa('A', null, { template: '', mediaUrl: '', message: '' })), 'A')
    await waitFor(() => expect(panel.getByRole('option', { name: 'promo (en_US) - MARKETING' })).toBeInTheDocument())
    expect(panel.getByRole('option', { name: 'boas_vindas (pt_BR) - UTILIDADE' })).toBeInTheDocument()
    expect(panel.queryByRole('option', { name: /pendente/ })).not.toBeInTheDocument()
    expect(panel.getByRole('option', { name: 'Nenhum — mensagem livre' })).toBeInTheDocument()
    expect(panel.getByText('Somente templates aprovados na Meta aparecem aqui.')).toBeInTheDocument()

    const select = root.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'boas_vindas' } })
    fireEvent.change(panel.getByPlaceholderText('https://...'), { target: { value: 'https://cdn/x.jpg' } })
    fireEvent.change(panel.getByPlaceholderText('Digite a mensagem a ser enviada...'), { target: { value: 'Olá {{var.nome}}!' } })
    // nada vai pro store antes de salvar
    expect(findStep(store().flow!, 'A')!.config).toEqual({ template: '', mediaUrl: '', message: '' })
    expect(store().rev).toBe(0)

    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'A')!.config).toEqual({ template: 'boas_vindas', mediaUrl: 'https://cdn/x.jpg', message: 'Olá {{var.nome}}!' })
    expect(store()).toMatchObject({ rev: 1, saveMode: 'config' })
    expect(subtitleOf('A')).toBe('boas_vindas')
    expect(compiledNode('A')!.data.config).toMatchObject({ actionType: 'whatsapp/send-template', templateName: 'boas_vindas', language: 'pt_BR' })
  })

  it('preview destaca {{var.nome}}', () => {
    const { panel } = renderPanel(flowOf(wa('A', null, { template: '', mediaUrl: '', message: 'Oi {{var.nome}}, tudo bem?' })), 'A')
    const highlighted = panel.getByText('{{var.nome}}', { selector: 'span' })
    expect(highlighted.className).toContain('bg-primary-500/15')
    expect(panel.getByText('Oi', { exact: false, selector: 'span' })).toBeInTheDocument()
  })

  it('template salvo que não está aprovado aparece como "(não aprovado?)"', async () => {
    const { panel, root } = renderPanel(flowOf(wa('A', null, { template: 'pendente', mediaUrl: '', message: '' })), 'A')
    await waitFor(() => expect(panel.getByRole('option', { name: 'pendente (não aprovado?)' })).toBeInTheDocument())
    expect((root.querySelector('select') as HTMLSelectElement).value).toBe('pendente')
  })

  it('falha ao carregar templates mostra a dica de credenciais', async () => {
    services.templates.mockRejectedValue(new Error('401'))
    const { panel } = renderPanel(flowOf(wa('A')), 'A')
    await waitFor(() => expect(panel.getByText('Falha ao carregar templates — verifique as credenciais da Meta.')).toBeInTheDocument())
  })

  it('carregando: select desabilitado com a dica de carregamento', () => {
    services.templates.mockReturnValue(new Promise(() => {}))
    const { panel, root } = renderPanel(flowOf(wa('A')), 'A')
    expect(root.querySelector('select')).toBeDisabled()
    expect(panel.getByText('Carregando templates aprovados...')).toBeInTheDocument()
  })

  it('Cancelar reverte o formulário sem tocar no store', () => {
    const { panel } = renderPanel(flowOf(wa('A')), 'A')
    const msg = panel.getByPlaceholderText('Digite a mensagem a ser enviada...') as HTMLTextAreaElement
    fireEvent.change(msg, { target: { value: 'outra coisa' } })
    fireEvent.change(nameInput(panel), { target: { value: 'Outro nome' } })
    fireEvent.click(cancelBtn(panel))
    expect(msg.value).toBe('msg A')
    expect(nameInput(panel).value).toBe('W A')
    expect(store()).toMatchObject({ rev: 0, past: [] })
  })

  it('salvar sem mudanças é no-op (sem undo nem save)', () => {
    const { panel } = renderPanel(flowOf(wa('A')), 'A')
    fireEvent.click(saveBtn(panel))
    expect(store()).toMatchObject({ rev: 0, past: [] })
  })

  it('só mídia (sem template) compila como send-media com a legenda', () => {
    const { panel } = renderPanel(flowOf(wa('A', null, { template: '', mediaUrl: '', message: '' })), 'A')
    fireEvent.change(panel.getByPlaceholderText('https://...'), { target: { value: 'https://cdn/x.jpg' } })
    fireEvent.change(panel.getByPlaceholderText('Digite a mensagem a ser enviada...'), { target: { value: 'legenda' } })
    fireEvent.click(saveBtn(panel))
    expect(compiledNode('A')!.data.config).toMatchObject({ mediaUrl: 'https://cdn/x.jpg', caption: 'legenda', mediaType: 'image' })
  })

  // BUG(template-language): o select mostra "nome (idioma)" mas grava só o nome, e o
  // compile fixa language 'pt_BR' (compile.ts:225-231). Um template aprovado só em
  // en_US é enviado como pt_BR e a Meta recusa (132001 — template inexistente no idioma).
  it.fails('template en_US é enviado com language en_US', async () => {
    const { panel, root } = renderPanel(flowOf(wa('A', null, { template: '', mediaUrl: '', message: '' })), 'A')
    await waitFor(() => expect(panel.getByRole('option', { name: 'promo (en_US) - MARKETING' })).toBeInTheDocument())
    fireEvent.change(root.querySelector('select') as HTMLSelectElement, { target: { value: 'promo' } })
    fireEvent.click(saveBtn(panel))
    expect(compiledNode('A')!.data.config).toMatchObject({ templateName: 'promo', language: 'en_US' })
  })

  // BUG(template-media-dropped): a dica do campo diz "Substitui a mídia aprovada na Meta
  // no momento do disparo", mas com template selecionado o compile descarta o mediaUrl
  // (compile.ts:225-231): o contato recebe a mídia antiga do template.
  it.fails('template + Media URL leva a mídia para o nó compilado', async () => {
    const { panel, root } = renderPanel(flowOf(wa('A', null, { template: '', mediaUrl: '', message: '' })), 'A')
    await waitFor(() => expect(panel.getByRole('option', { name: 'boas_vindas (pt_BR) - UTILIDADE' })).toBeInTheDocument())
    fireEvent.change(root.querySelector('select') as HTMLSelectElement, { target: { value: 'boas_vindas' } })
    fireEvent.change(panel.getByPlaceholderText('https://...'), { target: { value: 'https://cdn/novo.jpg' } })
    fireEvent.click(saveBtn(panel))
    expect(JSON.stringify(compiledNode('A')!.data.config)).toContain('https://cdn/novo.jpg')
  })
})

// ─── SP-02 Aguardar ────────────────────────────────────────────────────────────

describe('SP-02 painel Aguardar (1..5 minutos)', () => {
  const waitStep = (config: Record<string, unknown> = { value: 2, unit: 'minutes', mode: 'duration' }) => simple('W', 'wait', config, null, 'Aguardar')

  it.each<[string, number, boolean]>([
    ['9', 5, true],
    ['0', 1, true],
    ['', 1, true],
    ['2.6', 3, false],
    ['4', 4, false],
  ])('valor %s → grava %d (aviso: %s)', (typed, saved, warn) => {
    const { panel, root } = renderPanel(flowOf(waitStep()), 'W')
    const input = root.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: typed } })
    if (warn) expect(panel.getByText('Valor ajustado para 1–5 minutos ao salvar.')).toBeInTheDocument()
    else expect(panel.queryByText('Valor ajustado para 1–5 minutos ao salvar.')).not.toBeInTheDocument()
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'W')!.config).toEqual({ value: saved, unit: 'minutes', mode: 'duration' })
    expect(subtitleOf('W')).toBe(`${saved} ${saved === 1 ? 'minuto' : 'minutos'}`)
    expect(compiledNode('W')!.data.config).toMatchObject({ actionType: 'Delay', delayMs: saved * 60_000 })
  })

  it('passo legado (horas / até resposta) é normalizado para minutos/duration ao salvar', () => {
    const { panel, root } = renderPanel(flowOf(waitStep({ value: 2, unit: 'hours', mode: 'reply' })), 'W')
    expect(subtitleOf('W')).toBe('Até resposta do contato')
    expect(() => compileFlow(store().flow!)).toThrow(FlowCompileError)
    // horas e dias aparecem desabilitados (fase 2)
    expect(within(root).getByRole('option', { name: 'Horas (fase 2)' })).toBeDisabled()
    expect(within(root).getByRole('option', { name: 'Dias (fase 2)' })).toBeDisabled()
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'W')!.config).toEqual({ value: 2, unit: 'minutes', mode: 'duration' })
    expect(compiledNode('W')!.data.config).toMatchObject({ delayMs: 120_000 })
  })

  it('5 minutos → subtitle "5 minutos" e delayMs 300000', () => {
    const { panel, root } = renderPanel(flowOf(waitStep()), 'W')
    fireEvent.change(root.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '5' } })
    fireEvent.click(saveBtn(panel))
    expect(subtitleOf('W')).toBe('5 minutos')
    expect(compiledNode('W')!.data.config).toMatchObject({ delayMs: 300_000 })
  })
})

// ─── SP-03 Condição ────────────────────────────────────────────────────────────

describe('SP-03 painel Condição: branches', () => {
  const condFlow = () =>
    flowOf(
      {
        ...simple('C', 'condition', {}, wa('X'), 'Condição'),
        branches: [
          br('b0', 'Quer', wa('W0'), { field: 'Replied message', operator: 'contains', value: 'quero' }),
          br('b1', 'Não quer', null, { field: 'Replied message', operator: 'contains', value: 'não' }),
          br('bn', 'None', wa('WN'), { locked: true }),
        ],
      }
    )

  const branchLabelInputs = (root: HTMLElement) => [...root.querySelectorAll('input[placeholder="Nome da branch"]')] as HTMLInputElement[]
  const valueInputs = (root: HTMLElement) => [...root.querySelectorAll('input[placeholder="Valor (ex.: Confirmar Presença)"]')] as HTMLInputElement[]

  it('mostra as branches editáveis + o None fixo; campo fixo "Mensagem recebida"', () => {
    const { panel, root } = renderPanel(condFlow(), 'C')
    expect(branchLabelInputs(root).map((i) => i.value)).toEqual(['Quer', 'Não quer'])
    expect(panel.getByText('None')).toBeInTheDocument()
    expect(panel.getByText(/fixa, não removível/)).toBeInTheDocument()
    const fieldInputs = [...root.querySelectorAll('input[value="Mensagem recebida"]')]
    expect(fieldInputs).toHaveLength(2)
    fieldInputs.forEach((f) => expect(f).toBeDisabled())
    expect(panel.getAllByRole('option', { name: 'contém' }).length).toBe(2)
    expect(panel.getAllByRole('option', { name: 'não contém' }).length).toBe(2)
    expect(panel.getAllByRole('option', { name: 'é igual a' }).length).toBe(2)
  })

  it('editar label/operador/valor e adicionar branch (entra antes do None); filhos mantidos pelo id', () => {
    const { panel, root } = renderPanel(condFlow(), 'C')
    fireEvent.change(branchLabelInputs(root)[1], { target: { value: 'Recusou' } })
    fireEvent.change(root.querySelectorAll('select')[1], { target: { value: 'equals' } })
    fireEvent.change(valueInputs(root)[1], { target: { value: 'Não' } })
    fireEvent.click(panel.getByRole('button', { name: /Adicionar branch/ }))
    expect(branchLabelInputs(root)).toHaveLength(3)
    expect(branchLabelInputs(root)[2].value).toBe('Branch 3')
    fireEvent.change(valueInputs(root)[2], { target: { value: 'talvez' } })
    fireEvent.click(saveBtn(panel))

    const c = findStep(store().flow!, 'C')!
    expect(c.branches!.map((b) => b.label)).toEqual(['Quer', 'Recusou', 'Branch 3', 'None'])
    expect(c.branches![1]).toMatchObject({ id: 'b1', operator: 'equals', value: 'Não', child: null })
    expect(c.branches![2]).toMatchObject({ field: 'Replied message', operator: 'contains', value: 'talvez', child: null })
    expect(c.branches![0].child!.id).toBe('W0')
    expect(c.branches![3]).toMatchObject({ id: 'bn', locked: true })
    expect(c.branches![3].child!.id).toBe('WN')
    expect(validateTree(store().flow!).valid).toBe(true)

    const ids = compileFlow(store().flow!).nodes.map((n) => n.id)
    expect(ids).toEqual(expect.arrayContaining(['C__cond_0', 'C__cond_1', 'C__cond_2', 'C__cond_none']))
  })

  it('com uma única branch editável o botão de remover fica desabilitado', () => {
    const flow = flowOf({
      ...simple('C', 'condition', {}, null, 'Condição'),
      branches: [br('b0', 'Branch 1', null, { field: 'Replied message', operator: 'contains', value: 'x' }), br('bn', 'None', null, { locked: true })],
    })
    const { panel } = renderPanel(flow, 'C')
    expect(panel.getByRole('button', { name: 'Remover branch' })).toBeDisabled()
  })

  it('remover branch com sub-árvore pede confirmação; false mantém, true remove e o save descarta a sub-árvore', () => {
    const { panel, root } = renderPanel(condFlow(), 'C')
    confirmSpy.mockReturnValueOnce(false)
    fireEvent.click(panel.getAllByRole('button', { name: 'Remover branch' })[0])
    expect(confirmSpy).toHaveBeenCalledWith('A branch "Quer" tem uma sub-árvore. Excluir tudo?')
    expect(branchLabelInputs(root)).toHaveLength(2)

    confirmSpy.mockReturnValueOnce(true)
    fireEvent.click(panel.getAllByRole('button', { name: 'Remover branch' })[0])
    expect(branchLabelInputs(root).map((i) => i.value)).toEqual(['Não quer'])
    // ainda não salvou: W0 continua na árvore
    expect(findStep(store().flow!, 'W0')).not.toBeNull()
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'W0')).toBeNull()
    expect(findStep(store().flow!, 'C')!.branches!.map((b) => b.id)).toEqual(['b1', 'bn'])
  })

  it('remover branch sem sub-árvore não pede confirmação', () => {
    const { panel } = renderPanel(condFlow(), 'C')
    fireEvent.click(panel.getAllByRole('button', { name: 'Remover branch' })[1])
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  // BUG(cond-empty-value): uma branch com valor vazio compila como
  // `.includes("")` (sempre verdadeiro, compile.ts:490-499): a 1ª branch sempre ganha e o
  // None nunca roda. Nem o painel, nem o compile, nem o validateTree barram isso.
  it.fails('condição "contém" com valor vazio não deve compilar em silêncio', () => {
    const flow = flowOf({
      ...simple('C', 'condition', {}, null, 'Condição'),
      branches: [br('b0', 'Branch 1', wa('W0'), { field: 'Replied message', operator: 'contains', value: '' }), br('bn', 'None', null, { locked: true })],
    })
    store().loadFlow(flow)
    expect(() => compileFlow(store().flow!)).toThrow(FlowCompileError)
  })
})

// ─── SP-04 Perguntar ───────────────────────────────────────────────────────────

describe('SP-04 painel Perguntar: botões', () => {
  /** Perguntar como a tela cria (store.insertStep: sem branches locked). */
  function insertedInteractive(): { flow: Flow; id: string } {
    store().loadFlow(flowOf(null))
    store().openPicker({ kind: 'root' }, { x: 0, y: 0 })
    store().insertStep('interactive')
    const flow = store().flow!
    return { flow, id: flow.root!.id }
  }

  const buttonInputs = (root: HTMLElement) => [...root.querySelectorAll('input[maxlength="20"]')] as HTMLInputElement[]

  it('pergunta + até 3 botões (≤20 chars, contador), remover desabilitado com 1', () => {
    const { flow, id } = insertedInteractive()
    const { panel, root } = renderPanel(flow, id)
    expect(panel.getByText('Perguntar (aguardar resposta)')).toBeInTheDocument()
    expect(buttonInputs(root).map((i) => i.value)).toEqual(['Botão 1'])
    expect(panel.getByText('7/20')).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Remover botão' })).toBeDisabled()

    fireEvent.change(panel.getByPlaceholderText('Texto da pergunta enviada ao contato...'), { target: { value: 'Você quer?' } })
    const add = panel.getByRole('button', { name: /Adicionar botão/ })
    fireEvent.click(add)
    fireEvent.click(add)
    expect(buttonInputs(root).map((i) => i.value)).toEqual(['Botão 1', 'Botão 2', 'Botão 3'])
    expect(add).toBeDisabled()
    expect(add).toHaveTextContent('(máx. 3)')
    fireEvent.click(add)
    expect(buttonInputs(root)).toHaveLength(3)

    fireEvent.change(buttonInputs(root)[0], { target: { value: 'Sim' } })
    expect(panel.getByText('3/20')).toBeInTheDocument()
    fireEvent.click(saveBtn(panel))
    const s = findStep(store().flow!, id)!
    expect(s.config.message).toBe('Você quer?')
    expect(s.branches!.map((b) => b.label)).toEqual(['Sim', 'Botão 2', 'Botão 3'])
    expect(subtitleOf(id)).toBe('3 botões interativos')
    expect(validateTree(store().flow!).valid).toBe(true)
  })

  it('salvar mantém as sub-árvores dos botões existentes', () => {
    const { flow, id } = insertedInteractive()
    const withChild = addStep(flow, { type: 'tag', slot: { kind: 'branch', stepId: id, branchIndex: 0 } })
    const { panel } = renderPanel(withChild.flow, id)
    fireEvent.click(panel.getByRole('button', { name: /Adicionar botão/ }))
    fireEvent.click(saveBtn(panel))
    const s = findStep(store().flow!, id)!
    expect(s.branches![0].child!.id).toBe(withChild.stepId)
    expect(s.branches![1].child).toBeNull()
    expect(subtitleOf(id)).toBe('2 botões interativos')
  })

  it('remover botão com sub-árvore pede confirmação', () => {
    const { flow, id } = insertedInteractive()
    let f = addStep(flow, { type: 'tag', slot: { kind: 'branch', stepId: id, branchIndex: 0 } }).flow
    f = { ...f }
    const { panel, root } = renderPanel(f, id)
    fireEvent.click(panel.getByRole('button', { name: /Adicionar botão/ }))
    confirmSpy.mockReturnValueOnce(false)
    fireEvent.click(panel.getAllByRole('button', { name: 'Remover botão' })[0])
    expect(confirmSpy).toHaveBeenCalledWith('O botão "Botão 1" tem uma sub-árvore. Excluir tudo?')
    expect(buttonInputs(root)).toHaveLength(2)
  })

  // BUG(interactive-locked-dup): o estado local já inclui as branches locked (o
  // InteractiveForm as preserva) e o save ainda anexa `keptLocked` (ConfigPanel.tsx:351-359):
  // num Perguntar criado pelo operations.addStep (dados antigos/importados), a locked
  // "Not Delivered" com sub-árvore entra 2 vezes com o mesmo id → validateTree reprova,
  // o PATCH responde 400 "Invalid tree" e todo save seguinte falha.
  it.fails('Perguntar legado com branch locked + filho: "Salvar ação" sem mudar nada mantém a árvore válida', () => {
    const base = addStep(flowOf(null), { type: 'interactive', slot: { kind: 'root' } })
    const id = base.stepId
    const notDeliveredIdx = findStep(base.flow, id)!.branches!.findIndex((b) => b.label === 'Not Delivered')
    const withChild = addStep(base.flow, { type: 'tag', slot: { kind: 'branch', stepId: id, branchIndex: notDeliveredIdx } }).flow
    expect(validateTree(withChild).valid).toBe(true)
    const { panel } = renderPanel(withChild, id)
    fireEvent.change(panel.getByPlaceholderText('Texto da pergunta enviada ao contato...'), { target: { value: 'Quer?' } })
    fireEvent.click(saveBtn(panel))
    expect(validateTree(store().flow!).issues).toEqual([])
  })

  it('caracterização do BUG(interactive-locked-dup): hoje a branch locked aparece duplicada', () => {
    const base = addStep(flowOf(null), { type: 'interactive', slot: { kind: 'root' } })
    const id = base.stepId
    const idx = findStep(base.flow, id)!.branches!.findIndex((b) => b.label === 'Not Delivered')
    const withChild = addStep(base.flow, { type: 'tag', slot: { kind: 'branch', stepId: id, branchIndex: idx } }).flow
    const { panel } = renderPanel(withChild, id)
    fireEvent.change(panel.getByPlaceholderText('Texto da pergunta enviada ao contato...'), { target: { value: 'Quer?' } })
    fireEvent.click(saveBtn(panel))
    const labels = findStep(store().flow!, id)!.branches!.map((b) => b.label)
    expect(labels.filter((l) => l === 'Not Delivered')).toHaveLength(2)
    expect(validateTree(store().flow!).valid).toBe(false)
  })
})

// ─── SP-06 Tags ────────────────────────────────────────────────────────────────

describe('SP-06 painel de tags', () => {
  const tagInput = (panel: ReturnType<typeof within>) => panel.getByPlaceholderText('Digite a tag e pressione Enter') as HTMLInputElement
  const chips = (root: HTMLElement) => [...root.querySelectorAll('button[aria-label^="Remover tag "]')].map((b) => b.getAttribute('aria-label')!.replace('Remover tag ', ''))
  const datalist = (root: HTMLElement) => [...root.querySelectorAll('#flow-tag-suggestions option')].map((o) => o.getAttribute('value'))

  it('Enter, vírgula e blur adicionam (trim, sem duplicata); X remove; sugestões excluem as escolhidas', async () => {
    const { panel, root } = renderPanel(flowOf(simple('T', 'tag', { tags: [] }, null, 'Adicionar tag')), 'T')
    expect(panel.getByText('Tags a adicionar')).toBeInTheDocument()
    await waitFor(() => expect(datalist(root)).toEqual(['vip', 'lead']))

    fireEvent.change(tagInput(panel), { target: { value: '  vip ' } })
    fireEvent.keyDown(tagInput(panel), { key: 'Enter' })
    fireEvent.change(tagInput(panel), { target: { value: 'novo' } })
    fireEvent.keyDown(tagInput(panel), { key: ',' })
    fireEvent.change(tagInput(panel), { target: { value: 'blur' } })
    fireEvent.blur(tagInput(panel))
    fireEvent.change(tagInput(panel), { target: { value: 'vip' } })
    fireEvent.keyDown(tagInput(panel), { key: 'Enter' })
    expect(tagInput(panel).value).toBe('')
    // só espaços: não vira tag (o rascunho fica no campo)
    fireEvent.change(tagInput(panel), { target: { value: '   ' } })
    fireEvent.keyDown(tagInput(panel), { key: 'Enter' })
    expect(chips(root)).toEqual(['vip', 'novo', 'blur'])
    expect(datalist(root)).toEqual(['lead'])

    fireEvent.click(panel.getByRole('button', { name: 'Remover tag blur' }))
    expect(chips(root)).toEqual(['vip', 'novo'])
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'T')!.config).toEqual({ tags: ['vip', 'novo'], tagName: '' })
    expect(subtitleOf('T')).toBe('vip, novo')
    expect(compiledNode('T')!.data.config).toMatchObject({ actionType: 'contacts/add-tag', tags: ['vip', 'novo'] })
  })

  it('tagName legado aparece como chip; editar zera o tagName', () => {
    const { panel, root } = renderPanel(flowOf(simple('T', 'tag', { tagName: 'antiga' }, null, 'Adicionar tag')), 'T')
    expect(chips(root)).toEqual(['antiga'])
    fireEvent.change(tagInput(panel), { target: { value: 'nova' } })
    fireEvent.keyDown(tagInput(panel), { key: 'Enter' })
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'T')!.config).toEqual({ tags: ['antiga', 'nova'], tagName: '' })
  })

  it('remover a última tag legada não ressuscita o tagName', () => {
    const { panel, root } = renderPanel(flowOf(simple('T', 'tag', { tagName: 'antiga' }, null, 'Adicionar tag')), 'T')
    fireEvent.click(panel.getByRole('button', { name: 'Remover tag antiga' }))
    expect(chips(root)).toEqual([])
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'T')!.config).toEqual({ tags: [], tagName: '' })
    expect(subtitleOf('T')).toBe('Definir tags')
  })

  it('Remover tag: rótulo "Tags a remover" e compile remove-tag', () => {
    const { panel } = renderPanel(flowOf(simple('T', 'tag_remove', { tags: [] }, null, 'Remover tag')), 'T')
    expect(panel.getByText('Tags a remover')).toBeInTheDocument()
    expect(panel.getByText('As tags são removidas do contato quando o fluxo passa por aqui.')).toBeInTheDocument()
    fireEvent.change(tagInput(panel), { target: { value: 'lead' } })
    fireEvent.keyDown(tagInput(panel), { key: 'Enter' })
    fireEvent.click(saveBtn(panel))
    expect(compiledNode('T')!.data.config).toMatchObject({ actionType: 'contacts/remove-tag', tags: ['lead'] })
  })
})

// ─── SP-07 Pipeline ────────────────────────────────────────────────────────────

describe('SP-07 painel de pipeline', () => {
  const PIPELINES = [
    { id: 'p1', name: 'Vendas', stages: [{ id: 's1', name: 'Novo' }, { id: 's2', name: 'Proposta' }] },
    { id: 'p2', name: 'Suporte', stages: [{ id: 's3', name: 'Aberto' }] },
  ]
  const stubPipelines = (data: unknown, ok = true) => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) !== '/api/pipelines') throw new Error(`fetch inesperado: ${url}`)
      return { ok, json: async () => data } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const pipelineStep = () => simple('P', 'pipeline', { pipelineId: '', stageId: '', oppStatus: 'open', oppName: '' }, null, 'Mover no pipeline')

  it('sem pipelines: mensagem com link para /crm', async () => {
    stubPipelines([])
    const { panel } = renderPanel(flowOf(pipelineStep()), 'P')
    await waitFor(() => expect(panel.getByText(/Nenhum pipeline criado ainda/)).toBeInTheDocument())
    expect(panel.getByRole('link', { name: 'CRM' })).toHaveAttribute('href', '/crm')
  })

  it('escolher pipeline e etapa denormaliza os nomes; trocar o pipeline zera a etapa', async () => {
    const fetchMock = stubPipelines(PIPELINES)
    const { panel, root } = renderPanel(flowOf(pipelineStep()), 'P')
    await waitFor(() => expect(panel.getByRole('option', { name: 'Vendas' })).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/pipelines', { cache: 'no-store' })
    const [pipelineSel, stageSel, statusSel] = [...root.querySelectorAll('select')] as HTMLSelectElement[]
    expect(stageSel).toBeDisabled()

    fireEvent.change(pipelineSel, { target: { value: 'p1' } })
    expect(stageSel).not.toBeDisabled()
    fireEvent.change(stageSel, { target: { value: 's2' } })
    expect(stageSel.value).toBe('s2')
    fireEvent.change(pipelineSel, { target: { value: 'p2' } })
    expect(stageSel.value).toBe('')
    expect(within(root).queryByRole('option', { name: 'Proposta' })).not.toBeInTheDocument()
    fireEvent.change(pipelineSel, { target: { value: 'p1' } })
    fireEvent.change(stageSel, { target: { value: 's1' } })
    fireEvent.change(statusSel, { target: { value: 'won' } })
    fireEvent.click(saveBtn(panel))

    expect(findStep(store().flow!, 'P')!.config).toEqual({
      pipelineId: 'p1',
      pipelineName: 'Vendas',
      stageId: 's1',
      stageName: 'Novo',
      oppStatus: 'won',
      oppName: '',
    })
    expect(subtitleOf('P')).toBe('Vendas → Novo')
    expect(compiledNode('P')!.data.config).toMatchObject({ actionType: 'crm/move-pipeline', pipelineId: 'p1', stageId: 's1', oppStatus: 'won' })
  })

  it('sem etapa escolhida o compile falha (bloqueia publicar)', async () => {
    stubPipelines(PIPELINES)
    const { panel, root } = renderPanel(flowOf(pipelineStep()), 'P')
    await waitFor(() => expect(panel.getByRole('option', { name: 'Vendas' })).toBeInTheDocument())
    fireEvent.change(root.querySelector('select') as HTMLSelectElement, { target: { value: 'p1' } })
    fireEvent.click(saveBtn(panel))
    expect(subtitleOf('P')).toBe('Selecionar pipeline e etapa')
    expect(() => compileFlow(store().flow!)).toThrow(FlowCompileError)
  })
})

// ─── SP-08 END, Split e Go To ──────────────────────────────────────────────────

describe('SP-08 END, Split e Go To', () => {
  it('END mostra o texto fixo e salva só o nome', () => {
    const { panel } = renderPanel(flowOf(wa('A', simple('E', 'end', {}, null, 'END'))), 'E')
    expect(panel.getByText('Este passo encerra o fluxo para o contato. Sem configurações.')).toBeInTheDocument()
    expect(saveBtn(panel)).not.toBeDisabled()
  })

  it.each<[StepType, string]>([
    ['split', 'Split'],
    ['goto', 'Ir para (Go To)'],
  ])('%s: "Em breve", nome/Salvar/Cancelar desabilitados, Excluir funciona', (type, label) => {
    const res = addStep(flowOf(wa('A')), { type, slot: { kind: 'after', stepId: 'A' } })
    const { panel } = renderPanel(res.flow, res.stepId)
    expect(panel.getByText('Em breve')).toBeInTheDocument()
    expect(panel.getByText(label, { selector: 'span' })).toBeInTheDocument()
    expect(nameInput(panel)).toBeDisabled()
    expect(saveBtn(panel)).toBeDisabled()
    expect(cancelBtn(panel)).toBeDisabled()
    fireEvent.click(panel.getByRole('button', { name: /Excluir/ }))
    expect(findStep(store().flow!, res.stepId)).toBeNull()
    expect(store().selectedStepId).toBeNull()
  })
})

// ─── SP-09 Renomear, excluir e trocar de passo ─────────────────────────────────

describe('SP-09 renomear e excluir pelo painel; troca de passo', () => {
  it('renomear pelo painel grava no store e no card', () => {
    const { panel } = renderPanel(flowOf(wa('A', wa('B'))), 'A')
    fireEvent.change(nameInput(panel), { target: { value: 'Boas-vindas' } })
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'A')!.name).toBe('Boas-vindas')
    const n = layoutFlow(store().flow!).nodes.find((x) => x.id === 'A')!
    expect((n.data as { step: Step }).step.name).toBe('Boas-vindas')
    expect(compiledNode('A')!.data.label).toBe('Boas-vindas')
  })

  it('trocar de passo descarta a edição não salva (key=step.id)', () => {
    const { panel } = renderPanel(flowOf(wa('A', wa('B'))), 'A')
    fireEvent.change(nameInput(panel), { target: { value: 'rascunho' } })
    act(() => store().select('B'))
    expect(nameInput(panel).value).toBe('W B')
    act(() => store().select('A'))
    expect(nameInput(panel).value).toBe('W A')
    expect(store().rev).toBe(0)
  })

  it('Excluir sem sub-árvore remove direto e fecha o painel', () => {
    const { panel, root } = renderPanel(flowOf(wa('A', wa('B'))), 'A')
    fireEvent.click(panel.getByRole('button', { name: /Excluir/ }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(store().flow!.root!.id).toBe('B')
    expect(store()).toMatchObject({ selectedStepId: null, saveMode: 'structural' })
    expect(root.className).toContain('translate-x-full')
  })

  it('Excluir container com sub-árvore: confirm false mantém, true remove tudo', () => {
    const flow = flowOf({
      ...simple('C', 'condition', {}, wa('X'), 'Condição'),
      branches: [br('b0', 'B1', wa('W0'), { field: 'Replied message', operator: 'contains', value: 'x' }), br('bn', 'None', null, { locked: true })],
    })
    const { panel } = renderPanel(flow, 'C')
    confirmSpy.mockReturnValueOnce(false)
    fireEvent.click(panel.getByRole('button', { name: /Excluir/ }))
    expect(confirmSpy).toHaveBeenCalledWith('Este passo contém branches com sub-árvores. Excluir tudo?')
    expect(findStep(store().flow!, 'C')).not.toBeNull()
    fireEvent.click(panel.getByRole('button', { name: /Excluir/ }))
    expect(listSteps(store().flow!).map((s) => s.id)).toEqual(['X'])
  })

  it('o X fecha o painel do passo', () => {
    const { panel } = renderPanel(flowOf(wa('A')), 'A')
    fireEvent.click(panel.getByRole('button', { name: 'Fechar painel' }))
    expect(store().selectedStepId).toBeNull()
  })

  it('undo com o painel aberto re-sincroniza o formulário', () => {
    const { panel } = renderPanel(flowOf(wa('A')), 'A')
    fireEvent.change(nameInput(panel), { target: { value: 'Novo' } })
    fireEvent.click(saveBtn(panel))
    expect(nameInput(panel).value).toBe('Novo')
    act(() => store().undo())
    expect(nameInput(panel).value).toBe('W A')
  })

  // BUG(empty-step-name): o BuilderHeader e o StepNode fazem trim e ignoram nome vazio,
  // mas o painel grava name '' (ConfigPanel.tsx:344-347): o card fica sem título e o nó
  // compilado sem label.
  it.fails('nome vazio (ou só espaços) mantém o nome anterior', () => {
    const { panel } = renderPanel(flowOf(wa('A')), 'A')
    fireEvent.change(nameInput(panel), { target: { value: '   ' } })
    fireEvent.click(saveBtn(panel))
    expect(findStep(store().flow!, 'A')!.name).toBe('W A')
  })

  // BUG(panel-edits-lost): qualquer mutação clona o Flow inteiro, e o re-sync por
  // identidade (ConfigPanel.tsx:331-337) apaga o rascunho do passo aberto quando OUTRO
  // passo muda (ex.: deletar pelo menu "…" do card).
  it.fails('rascunho do passo A sobrevive a deletar o passo B pelo card', () => {
    const { panel } = renderPanel(flowOf(wa('A', wa('B'))), 'A')
    const msg = panel.getByPlaceholderText('Digite a mensagem a ser enviada...') as HTMLTextAreaElement
    fireEvent.change(msg, { target: { value: 'rascunho importante' } })
    act(() => store().removeStep('B'))
    expect(msg.value).toBe('rascunho importante')
  })
})
