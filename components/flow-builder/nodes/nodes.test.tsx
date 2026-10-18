import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Nós do canvas: TriggerNode (título/subtítulo por tipo de gatilho), StepNode (menu
 * Renomear/Deletar), PlaceholderNode e PlusLeafNode (abrem o picker no slot) e EndNode.
 */

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

import EndNode from '@/components/flow-builder/nodes/EndNode'
import PlaceholderNode from '@/components/flow-builder/nodes/PlaceholderNode'
import PlusLeafNode from '@/components/flow-builder/nodes/PlusLeafNode'
import StepNode from '@/components/flow-builder/nodes/StepNode'
import TriggerNode from '@/components/flow-builder/nodes/TriggerNode'
import { nodeTypes } from '@/components/flow-builder/nodes'
import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { layoutFlow } from '@/lib/builder/flow/layout'
import { findStep } from '@/lib/builder/flow/operations'
import type { Flow, FlowTrigger, Slot, Step } from '@/lib/builder/flow/types'

const store = () => useFlowBuilderStore.getState()
const props = (data: unknown, extra: Record<string, unknown> = {}) => ({ id: 'n', type: 'x', data, selected: false, ...extra }) as unknown as NodeProps

const wa = (id: string, next: Step | null = null): Step => ({ id, type: 'whatsapp', name: `W ${id}`, config: { message: `msg ${id}` }, next })
const flowOf = (root: Step | null, trigger: FlowTrigger = { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }): Flow => ({
  schemaVersion: 1,
  id: 'wf',
  name: 'Fluxo',
  trigger,
  root,
})

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  store().reset()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  confirmSpy.mockRestore()
})

it('nodeTypes registra os 5 tipos usados pelo layout', () => {
  expect(Object.keys(nodeTypes).sort()).toEqual(['end', 'placeholder', 'plus', 'step', 'trigger'])
})

// ─── ND-01 ─────────────────────────────────────────────────────────────────────

describe('ND-01 TriggerNode: título e subtítulo por tipo', () => {
  it.each<[string, FlowTrigger, string, string]>([
    ['none', { type: 'none', label: '', keywords: [] }, 'Adicionar novo gatilho', 'Sem gatilho — inscrição manual pela lista de contatos'],
    ['keywords 0', { type: 'keywords', label: 'Palavras-chave', keywords: [] }, 'Palavras-chave', 'Definir palavras-chave'],
    ['keywords 1', { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] }, 'Palavras-chave', '1 palavra-chave'],
    ['keywords 3', { type: 'keywords', label: 'Palavras-chave', keywords: ['a', 'b', 'c'] }, 'Palavras-chave', '3 palavras-chave'],
    ['keywords sem label', { type: 'keywords', label: '', keywords: ['a'] }, 'Palavras-chave', '1 palavra-chave'],
    ['sem type (legado)', { label: 'Meu gatilho', keywords: ['a', 'b'] }, 'Meu gatilho', '2 palavras-chave'],
    ['campaign_reply qualquer', { type: 'campaign_reply', label: 'Respondeu ao disparo', keywords: [] }, 'Respondeu ao disparo', 'Resposta a qualquer disparo'],
    [
      'campaign_reply campanha + filtro',
      { type: 'campaign_reply', label: '', keywords: [], campaignId: 'c1', campaignName: 'Black Friday', replyFilter: 'quero' },
      'Respondeu ao disparo',
      'Campanha: Black Friday · contém "quero"',
    ],
    [
      'campaign_reply só filtro',
      { type: 'campaign_reply', label: 'Respondeu ao disparo', keywords: [], replyFilter: 'sim' },
      'Respondeu ao disparo',
      'Resposta a qualquer disparo · contém "sim"',
    ],
  ])('%s', (_, trigger, title, subtitle) => {
    // o data vem do layoutFlow, como no canvas
    const data = layoutFlow(flowOf(null, trigger)).nodes[0].data
    render(<TriggerNode {...props(data)} />)
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(subtitle)).toBeInTheDocument()
  })

  it('selecionado ganha o anel de seleção', () => {
    const data = layoutFlow(flowOf(null)).nodes[0].data
    const { container } = render(<TriggerNode {...props(data, { selected: true })} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('ring-2')
  })
})

// ─── ND-02 ─────────────────────────────────────────────────────────────────────

describe('ND-02 StepNode: menu Renomear e Deletar', () => {
  function renderStep(flow: Flow, id: string) {
    store().loadFlow(flow)
    const n = layoutFlow(flow).nodes.find((x) => x.id === id)!
    const parentClick = vi.fn()
    const utils = render(
      <div onClick={parentClick}>
        <StepNode {...props(n.data, { id })} />
      </div>
    )
    return { ...utils, parentClick }
  }
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Opções do passo' }))

  it('mostra nome e subtítulo; o menu abre sem propagar o clique', () => {
    const { parentClick } = renderStep(flowOf(wa('A')), 'A')
    expect(screen.getByText('W A')).toBeInTheDocument()
    expect(screen.getByText('msg A')).toBeInTheDocument()
    openMenu()
    expect(screen.getByRole('button', { name: /Renomear/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deletar/ })).toBeInTheDocument()
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('Renomear: Enter grava com trim; o clique no input não propaga', () => {
    const { parentClick } = renderStep(flowOf(wa('A')), 'A')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Renomear/ }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('W A')
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '  Boas-vindas ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(findStep(store().flow!, 'A')!.name).toBe('Boas-vindas')
    expect(store()).toMatchObject({ rev: 1, saveMode: 'config' })
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('Renomear: blur grava; Esc, vazio e igual não gravam', () => {
    renderStep(flowOf(wa('A')), 'A')
    const startRename = () => {
      openMenu()
      fireEvent.click(screen.getByRole('button', { name: /Renomear/ }))
      return screen.getByRole('textbox') as HTMLInputElement
    }
    let input = startRename()
    fireEvent.change(input, { target: { value: 'Esc' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    input = startRename()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    input = startRename()
    fireEvent.change(input, { target: { value: 'W A' } })
    fireEvent.blur(input)
    expect(store().rev).toBe(0)
    input = startRename()
    fireEvent.change(input, { target: { value: 'Pelo blur' } })
    fireEvent.blur(input)
    expect(findStep(store().flow!, 'A')!.name).toBe('Pelo blur')
  })

  it('Deletar sem sub-árvore remove direto, sem confirm e sem propagar', () => {
    const { parentClick } = renderStep(flowOf(wa('A', wa('B'))), 'A')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Deletar/ }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(store().flow!.root!.id).toBe('B')
    expect(store().saveMode).toBe('structural')
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('Deletar container com sub-árvore pede confirmação (false mantém, true remove)', () => {
    const cond: Step = {
      id: 'C',
      type: 'condition',
      name: 'Condição',
      config: {},
      next: null,
      branches: [
        { id: 'b0', label: 'B1', child: wa('W'), field: 'Replied message', operator: 'contains', value: 'x' },
        { id: 'bn', label: 'None', child: null, locked: true },
      ],
    }
    renderStep(flowOf(cond), 'C')
    confirmSpy.mockReturnValueOnce(false)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Deletar/ }))
    expect(confirmSpy).toHaveBeenCalledWith('Este passo contém branches com sub-árvores. Excluir tudo?')
    expect(store().flow!.root!.id).toBe('C')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Deletar/ }))
    expect(store().flow!.root).toBeNull()
  })

  it('mouseLeave fecha o menu', () => {
    renderStep(flowOf(wa('A')), 'A')
    openMenu()
    fireEvent.mouseLeave(screen.getByRole('button', { name: /Renomear/ }).parentElement!)
    expect(screen.queryByRole('button', { name: /Renomear/ })).not.toBeInTheDocument()
  })

  it('END não mostra subtítulo vazio; selecionado ganha borda', () => {
    const { container } = render(<StepNode {...props({ step: wa('A'), subtitle: '' }, { selected: true })} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('border-primary-500')
    expect(container.querySelectorAll('.truncate')).toHaveLength(1)
  })
})

// ─── ND-03 ─────────────────────────────────────────────────────────────────────

describe('ND-03 placeholder, folha "+" e END', () => {
  const slot: Slot = { kind: 'branch', stepId: 'C', branchIndex: 1 }

  it.each([
    ['PlaceholderNode', PlaceholderNode, /Adicionar ação/],
    ['PlusLeafNode', PlusLeafNode, 'Adicionar ação'],
  ] as const)('%s abre o picker no slot com as coordenadas do clique, sem propagar', (_, Comp, name) => {
    store().loadFlow(flowOf(wa('A')))
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <Comp {...props({ slot })} />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name }), { clientX: 120, clientY: 340 })
    expect(store().picker).toEqual({ slot, x: 120, y: 340 })
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('EndNode renderiza "END"', () => {
    render(<EndNode {...props({})} />)
    expect(screen.getByText('END')).toBeInTheDocument()
  })
})
