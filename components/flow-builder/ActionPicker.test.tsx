import React from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ActionPicker: o menu que abre no "+" do canvas. Catálogo por categoria, busca sem
 * acento/caixa, terminais (END/Go To) só em ponta aberta, "Em breve" não insere, e
 * inserir de verdade em cada slot (root / after / branch) pelo store real.
 */

const services = vi.hoisted(() => ({ campaigns: vi.fn(), templates: vi.fn(), tags: vi.fn() }))
vi.mock('@/services/campaignService', () => ({ campaignService: { getAll: services.campaigns } }))
vi.mock('@/services/templateService', () => ({ templateService: { getAll: services.templates } }))
vi.mock('@/services/contactService', () => ({ contactService: { getTags: services.tags } }))

import ActionPicker from '@/components/flow-builder/ActionPicker'
import ConfigPanel from '@/components/flow-builder/ConfigPanel'
import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { STEP_META } from '@/lib/builder/flow/meta'
import { findStep, listSteps } from '@/lib/builder/flow/operations'
import { validateTree } from '@/lib/builder/flow/tree-validate'
import type { Branch, Flow, Slot, Step, StepType } from '@/lib/builder/flow/types'

const store = () => useFlowBuilderStore.getState()

const wa = (id: string, next: Step | null = null): Step => ({ id, type: 'whatsapp', name: `W ${id}`, config: { template: '', mediaUrl: '', message: `msg ${id}` }, next })
const br = (id: string, label: string, child: Step | null = null, extra: Partial<Branch> = {}): Branch => ({ id, label, child, ...extra })

/** A → B ; C(condition) com b0 vazia e None com filho D ; tudo encadeado: A → C → B */
function sample(): Flow {
  return {
    schemaVersion: 1,
    id: 'wf',
    name: 'Fluxo',
    trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
    root: wa('A', {
      id: 'C',
      type: 'condition',
      name: 'Condição',
      config: {},
      branches: [
        br('b0', 'Branch 1', null, { field: 'Replied message', operator: 'contains', value: 'x' }),
        br('bn', 'None', wa('D'), { locked: true }),
      ],
      next: wa('B'),
    }),
  }
}
const emptyFlow = (): Flow => ({ ...sample(), root: null })

function renderPicker(flow: Flow, slot: Slot | null, pos = { x: 400, y: 200 }, withPanel = false) {
  store().loadFlow(flow)
  if (slot) store().openPicker(slot, pos)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <ActionPicker />
      {withPanel && (
        <div data-testid="panel">
          <ConfigPanel />
        </div>
      )}
    </QueryClientProvider>
  )
  return utils
}

const searchInput = () => screen.getByPlaceholderText('Buscar ação...') as HTMLInputElement
const itemLabels = () =>
  [...document.querySelectorAll('button[aria-disabled]')].map((b) => (b.querySelector('span.min-w-0 > span') as HTMLElement).childNodes[0].textContent)
const categories = () => [...document.querySelectorAll('.uppercase.tracking-wider')].map((c) => c.textContent)
const item = (label: string) => screen.getByText(label, { selector: 'span' }).closest('button') as HTMLButtonElement

beforeEach(() => {
  store().reset()
  services.campaigns.mockReset().mockResolvedValue([])
  services.templates.mockReset().mockResolvedValue([])
  services.tags.mockReset().mockResolvedValue([])
})
afterEach(() => cleanup())

// ─── AP-01 ─────────────────────────────────────────────────────────────────────

describe('AP-01 catálogo e busca', () => {
  it('sem picker não renderiza nada', () => {
    const { container } = renderPicker(sample(), null)
    expect(container).toBeEmptyDOMElement()
  })

  it('ponta aberta: 4 categorias, 10 itens na ordem, "Em breve" em Split e Go To', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' })
    expect(categories()).toEqual(['Mensagem', 'Lógica', 'Dados', 'CRM'])
    expect(itemLabels()).toEqual([
      'WhatsApp',
      'Perguntar',
      'Condição',
      'Split',
      'Aguardar',
      'Ir para (Go To)',
      'Encerrar (End)',
      'Adicionar tag',
      'Remover tag',
      'Mover no pipeline',
    ])
    expect(screen.getAllByText('Em breve')).toHaveLength(2)
    expect(item('Split')).toHaveAttribute('aria-disabled', 'true')
    expect(item('Ir para (Go To)')).toHaveAttribute('aria-disabled', 'true')
    expect(item('WhatsApp')).toHaveAttribute('aria-disabled', 'false')
    expect(searchInput()).toHaveFocus()
  })

  it.each<[string, string[]]>([
    ['CONDICAO', ['Condição']],
    ['condição', ['Condição']],
    ['tag', ['Adicionar tag', 'Remover tag']],
    ['  pipeline  ', ['Mover no pipeline']],
    // casa também pela descrição
    ['aleatoriamente', ['Split']],
    ['período', ['Aguardar']],
  ])('busca "%s" ignora acento/caixa e casa label ou descrição', (q, expected) => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' })
    fireEvent.change(searchInput(), { target: { value: q } })
    expect(itemLabels()).toEqual(expected)
  })

  it('sem resultado mostra "Nenhuma ação encontrada"; a busca reseta ao reabrir', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' })
    fireEvent.change(searchInput(), { target: { value: 'xyz' } })
    expect(screen.getByText('Nenhuma ação encontrada')).toBeInTheDocument()
    expect(itemLabels()).toEqual([])
    act(() => store().openPicker({ kind: 'after', stepId: 'A' }, { x: 1, y: 1 }))
    expect(searchInput().value).toBe('')
    expect(itemLabels()).toHaveLength(8) // after A tem cauda → sem terminais
  })
})

// ─── AP-02 ─────────────────────────────────────────────────────────────────────

describe('AP-02 terminais escondidos em slot com cauda', () => {
  it.each<[string, () => Flow, Slot, boolean]>([
    ['root com root existente', sample, { kind: 'root' }, false],
    ['after com next', sample, { kind: 'after', stepId: 'A' }, false],
    ['branch com filho', sample, { kind: 'branch', stepId: 'C', branchIndex: 1 }, false],
    ['container com next (after C)', sample, { kind: 'after', stepId: 'C' }, false],
    ['folha aberta', sample, { kind: 'after', stepId: 'B' }, true],
    ['branch vazia', sample, { kind: 'branch', stepId: 'C', branchIndex: 0 }, true],
    ['fluxo vazio', emptyFlow, { kind: 'root' }, true],
  ])('%s → END/Go To visíveis: %s', (_, mk, slot, visible) => {
    renderPicker(mk(), slot)
    const labels = itemLabels()
    expect(labels.includes('Encerrar (End)')).toBe(visible)
    expect(labels.includes('Ir para (Go To)')).toBe(visible)
    expect(labels).toHaveLength(visible ? 10 : 8)
  })
})

// ─── AP-03 ─────────────────────────────────────────────────────────────────────

const ENABLED: StepType[] = ['whatsapp', 'interactive', 'condition', 'wait', 'tag', 'tag_remove', 'pipeline']

describe('AP-03 inserir cada tipo habilitado em cada slot pela UI', () => {
  const cases: Array<[StepType, string, Slot, (f: Flow, id: string) => void]> = []
  for (const type of ENABLED) {
    cases.push([
      type,
      'root',
      { kind: 'root' },
      (f, id) => {
        expect(f.root!.id).toBe(id)
        expect(findStep(f, id)!.next!.id).toBe('A')
      },
    ])
    cases.push([
      type,
      'after A (meio)',
      { kind: 'after', stepId: 'A' },
      (f, id) => {
        expect(f.root!.next!.id).toBe(id)
        expect(findStep(f, id)!.next!.id).toBe('C')
      },
    ])
    cases.push([
      type,
      'branch vazia',
      { kind: 'branch', stepId: 'C', branchIndex: 0 },
      (f, id) => {
        expect(findStep(f, 'C')!.branches![0].child!.id).toBe(id)
        expect(findStep(f, id)!.next).toBeNull()
      },
    ])
    cases.push([
      type,
      'branch com filho (None)',
      { kind: 'branch', stepId: 'C', branchIndex: 1 },
      (f, id) => {
        expect(findStep(f, 'C')!.branches![1].child!.id).toBe(id)
        expect(findStep(f, id)!.next!.id).toBe('D')
      },
    ])
  }

  it.each(cases)('%s em %s', (type, _, slot, check) => {
    renderPicker(sample(), slot, undefined, true)
    fireEvent.click(item(STEP_META[type].label))
    const s = store()
    expect(s.picker).toBeNull()
    expect(s.selectedStepId).toBeTruthy()
    const created = findStep(s.flow!, s.selectedStepId!)!
    expect(created.type).toBe(type)
    check(s.flow!, created.id)
    expect(s).toMatchObject({ rev: 1, saveMode: 'structural' })
    expect(s.past).toHaveLength(1)
    expect(validateTree(s.flow!).valid).toBe(true)
    // o painel do novo passo abre junto
    const panel = within(screen.getByTestId('panel'))
    expect((panel.getByLabelText('Nome da ação') as HTMLInputElement).value).toBe(created.name)
    if (type === 'interactive') expect(created.branches!.every((b) => !b.locked)).toBe(true)
  })

  it('END em ponta aberta insere e fica sem next', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' })
    fireEvent.click(item('Encerrar (End)'))
    const b = findStep(store().flow!, 'B')!
    expect(b.next!.type).toBe('end')
    expect(b.next!.next).toBeNull()
  })

  it.each(['Split', 'Ir para (Go To)'])('"%s" (Em breve) não insere e o picker continua aberto', (label) => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' })
    const before = store().flow
    fireEvent.click(item(label))
    expect(store().flow).toBe(before)
    expect(store().picker).not.toBeNull()
    expect(store().rev).toBe(0)
    expect(listSteps(store().flow!)).toHaveLength(4)
  })
})

// ─── AP-04 ─────────────────────────────────────────────────────────────────────

describe('AP-04 backdrop e posicionamento', () => {
  const panelBox = () => document.querySelector('.fixed.z-50') as HTMLElement

  it('clicar no backdrop fecha o picker sem inserir', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' })
    fireEvent.click(document.querySelector('.fixed.inset-0') as HTMLElement)
    expect(store().picker).toBeNull()
    expect(store().rev).toBe(0)
    expect(screen.queryByPlaceholderText('Buscar ação...')).not.toBeInTheDocument()
  })

  it('posição limitada à janela (12px de margem)', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' }, { x: 5, y: 2000 })
    expect(panelBox().style.left).toBe('12px')
    expect(panelBox().style.top).toBe(`${window.innerHeight - 420 - 12}px`)
    expect(panelBox().style.width).toBe('300px')
  })

  it('posição normal: centrado em x e 10px abaixo de y', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' }, { x: 500, y: 100 })
    expect(panelBox().style.left).toBe('350px')
    expect(panelBox().style.top).toBe('110px')
  })

  it('clique na direita extrema não estoura a janela', () => {
    renderPicker(sample(), { kind: 'after', stepId: 'B' }, { x: 5000, y: 0 })
    expect(panelBox().style.left).toBe(`${window.innerWidth - 300 - 12}px`)
    expect(panelBox().style.top).toBe('12px')
  })
})
