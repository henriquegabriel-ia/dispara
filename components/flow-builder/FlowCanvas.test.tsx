import React from 'react'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * FlowCanvas: monta o React Flow a partir de layoutFlow(store.flow). O ReactFlow é
 * substituído por um dublê que guarda as props, para chamarmos onNodeClick/onPaneClick
 * como a lib faria. Atalhos de teclado (Ctrl/Cmd+Z, Esc) no window.
 */

const rf = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('@xyflow/react', () => ({
  ReactFlow: (p: Record<string, unknown> & { children?: React.ReactNode }) => {
    rf.props = p
    return <div data-testid="reactflow">{p.children}</div>
  },
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="rf-panel">{children}</div>,
  useViewport: () => ({ zoom: 0.8, x: 0, y: 0 }),
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ['M 0 0', 0, 0],
}))
const theme = vi.hoisted(() => ({ value: 'light' as 'light' | 'dark' }))
vi.mock('@/components/eia/theme', () => ({ useEiaTheme: () => ({ theme: theme.value }) }))

import FlowCanvas from '@/components/flow-builder/FlowCanvas'
import { TRIGGER_SELECTION_ID, useFlowBuilderStore } from '@/components/flow-builder/store'
import { layoutFlow } from '@/lib/builder/flow/layout'
import { findStep } from '@/lib/builder/flow/operations'
import type { Flow, Step } from '@/lib/builder/flow/types'

type RFNode = { id: string; type: string; selected?: boolean; className?: string }
const store = () => useFlowBuilderStore.getState()
const nodes = () => rf.props!.nodes as RFNode[]
const clickNode = (id: string) => {
  const n = nodes().find((x) => x.id === id)
  if (!n) throw new Error(`nó ${id} não existe`)
  act(() => (rf.props!.onNodeClick as (e: unknown, n: RFNode) => void)({}, n))
}
const clickPane = () => act(() => (rf.props!.onPaneClick as () => void)())

const wa = (id: string, next: Step | null = null): Step => ({ id, type: 'whatsapp', name: `W ${id}`, config: { message: `msg ${id}` }, next })
const goto = (id: string): Step => ({ id, type: 'goto', name: `Ir ${id}`, config: { targetId: null }, next: null })

/** A → C(b0 vazia, None → W) ; C.next = G (goto). Mais um END numa branch. */
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
        { id: 'b0', label: 'B1', child: { id: 'E', type: 'end', name: 'END', config: {}, next: null }, field: 'Replied message', operator: 'contains', value: 'x' },
        { id: 'bn', label: 'None', child: wa('W'), locked: true },
      ],
      next: goto('G'),
    }),
  }
}

beforeEach(() => {
  store().reset()
  rf.props = null
  theme.value = 'light'
})
afterEach(() => cleanup())

// ─── FC-01 ─────────────────────────────────────────────────────────────────────

describe('FC-01 cliques e modo Go To', () => {
  it('sem flow não renderiza o ReactFlow', () => {
    const { container } = render(<FlowCanvas />)
    expect(container).toBeEmptyDOMElement()
  })

  it('nós e edges vêm do layoutFlow; opções fixas do canvas; colorMode segue o tema', () => {
    store().loadFlow(sample())
    render(<FlowCanvas />)
    const layout = layoutFlow(store().flow!)
    expect(nodes().map((n) => n.id)).toEqual(layout.nodes.map((n) => n.id))
    expect((rf.props!.edges as Array<{ id: string }>).map((e) => e.id)).toEqual(layout.edges.map((e) => e.id))
    expect(rf.props).toMatchObject({ nodesDraggable: false, nodesConnectable: false, deleteKeyCode: null, colorMode: 'light', fitView: true })
    expect(screen.getByText('80%')).toBeInTheDocument()
    cleanup()
    theme.value = 'dark'
    render(<FlowCanvas />)
    expect(rf.props!.colorMode).toBe('dark')
  })

  it('clique em step/end seleciona; no trigger seleciona "__trigger"; placeholder/plus não selecionam', () => {
    store().loadFlow(sample())
    render(<FlowCanvas />)
    clickNode('A')
    expect(store().selectedStepId).toBe('A')
    expect(nodes().find((n) => n.id === 'A')!.selected).toBe(true)
    expect(nodes().filter((n) => n.selected)).toHaveLength(1)
    clickNode('E')
    expect(store().selectedStepId).toBe('E')
    clickNode('__trigger')
    expect(store().selectedStepId).toBe(TRIGGER_SELECTION_ID)
    expect(nodes().find((n) => n.id === '__trigger')!.selected).toBe(true)
    // fluxo com folha "+" e placeholder: clicar neles (fora do botão) não muda a seleção
    act(() => store().loadFlow({ ...sample(), root: { ...wa('Z'), type: 'condition', branches: [{ id: 'z0', label: 'B1', child: null, field: 'Replied message', operator: 'contains', value: 'x' }] } as Step }))
    clickNode('Z')
    for (const n of nodes().filter((x) => x.type === 'plus' || x.type === 'placeholder')) clickNode(n.id)
    expect(nodes().some((n) => n.type === 'placeholder')).toBe(true)
    expect(store().selectedStepId).toBe('Z')
  })

  it('modo Go To: banner, só steps ≠ goto são "pickable"; clicar escolhe o alvo; goto e trigger são ignorados', () => {
    store().loadFlow(sample())
    render(<FlowCanvas />)
    act(() => store().startGotoPick('G'))
    expect(screen.getByText(/Clique em um passo para definir o destino do Go To/)).toBeInTheDocument()
    const pickable = nodes().filter((n) => n.className === 'pickable').map((n) => n.id).sort()
    expect(pickable).toEqual(['A', 'C', 'W'])

    clickNode('G')
    clickNode('__trigger')
    clickNode('E') // END não é step
    expect(store().pickingGotoId).toBe('G')
    expect(findStep(store().flow!, 'G')!.config.targetId).toBeNull()
    expect(store().rev).toBe(0)

    clickNode('W')
    expect(findStep(store().flow!, 'G')!.config.targetId).toBe('W')
    expect(store()).toMatchObject({ pickingGotoId: null, saveMode: 'structural', rev: 1 })
    expect(screen.queryByText(/Clique em um passo/)).not.toBeInTheDocument()
    // a edge do goto aparece no canvas
    expect((rf.props!.edges as Array<{ id: string }>).some((e) => e.id === 'goto-G')).toBe(true)
  })

  it('clique no pane limpa seleção, picker e modo goto', () => {
    store().loadFlow(sample())
    render(<FlowCanvas />)
    clickNode('A')
    act(() => store().openPicker({ kind: 'root' }, { x: 0, y: 0 }))
    act(() => useFlowBuilderStore.setState({ pickingGotoId: 'G' }))
    clickPane()
    expect(store()).toMatchObject({ selectedStepId: null, picker: null, pickingGotoId: null })
  })
})

// ─── FC-02 / FC-03 ─────────────────────────────────────────────────────────────

describe('FC-02 atalhos de teclado', () => {
  function mounted() {
    store().loadFlow(sample())
    store().renameFlow('B')
    store().renameFlow('C')
    return render(<FlowCanvas />)
  }

  it.each([
    ['Ctrl+Z', { key: 'z', ctrlKey: true }],
    ['Cmd+Z', { key: 'z', metaKey: true }],
    ['Ctrl+Z com CapsLock', { key: 'Z', ctrlKey: true }],
  ])('%s desfaz', (_, ev) => {
    mounted()
    fireEvent.keyDown(window, ev)
    expect(store().flow!.name).toBe('B')
  })

  it('Z sem modificador não desfaz', () => {
    mounted()
    fireEvent.keyDown(window, { key: 'z' })
    expect(store().flow!.name).toBe('C')
  })

  it.each(['input', 'textarea'])('Ctrl+Z digitando num %s não desfaz o fluxo', (tag) => {
    mounted()
    const el = document.createElement(tag)
    document.body.appendChild(el)
    fireEvent.keyDown(el, { key: 'z', ctrlKey: true })
    expect(store().flow!.name).toBe('C')
    el.remove()
  })

  it('Esc fecha o picker e cancela o goto', () => {
    mounted()
    act(() => store().openPicker({ kind: 'root' }, { x: 0, y: 0 }))
    act(() => useFlowBuilderStore.setState({ pickingGotoId: 'G' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(store()).toMatchObject({ picker: null, pickingGotoId: null })
  })

  it('o listener sai no unmount', () => {
    const { unmount } = mounted()
    unmount()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(store().flow!.name).toBe('C')
  })

  // BUG(redo-undo): o atalho de "refazer" (Ctrl/Cmd+Shift+Z) também desfaz, porque o
  // handler só testa e.key.toLowerCase() === 'z' sem olhar shiftKey (FlowCanvas.tsx:69).
  // Quem tenta refazer perde mais um passo.
  it.fails('Ctrl+Shift+Z não desfaz', () => {
    mounted()
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(store().flow!.name).toBe('C')
  })
})
