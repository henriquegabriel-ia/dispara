import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EdgeProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Edges do canvas: FlowEdge (botão "+" no slot, pill da branch, contagem, bypass) e
 * GotoEdge (rota lateral tracejada), além do helper de path e dos ícones dos chips.
 */

const rf = vi.hoisted(() => ({ smoothCalls: [] as Array<Record<string, unknown>> }))
vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ id, path, style, markerEnd }: { id: string; path: string; style?: Record<string, unknown>; markerEnd?: string }) => (
    <path data-testid={`edge-${id}`} d={path} data-style={JSON.stringify(style ?? {})} data-marker={markerEnd ?? ''} />
  ),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: (args: Record<string, unknown>) => {
    rf.smoothCalls.push(args)
    return ['M smooth', 11, 22]
  },
  Position: { Top: 'top', Bottom: 'bottom' },
}))

import { CircleHelp, GitBranch, MessageCircle, SquareKanban } from 'lucide-react'
import FlowEdge from '@/components/flow-builder/edges/FlowEdge'
import GotoEdge from '@/components/flow-builder/edges/GotoEdge'
import { edgeTypes } from '@/components/flow-builder/edges'
import { roundedOrthogonalPath } from '@/components/flow-builder/edges/path'
import { stepChipStyle, stepIcon } from '@/components/flow-builder/icons'
import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { STEP_META } from '@/lib/builder/flow/meta'
import { createEmptyFlow } from '@/lib/builder/flow/operations'
import type { Slot } from '@/lib/builder/flow/types'

const store = () => useFlowBuilderStore.getState()
const edgeProps = (data: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
  ({ id: 'e1', source: 'a', target: 'b', sourceX: 100, sourceY: 50, targetX: 300, targetY: 250, sourcePosition: 'bottom', targetPosition: 'top', data, ...extra }) as unknown as EdgeProps

const renderSvg = (el: React.ReactElement) => render(<svg>{el}</svg>)

beforeEach(() => {
  store().reset()
  store().loadFlow(createEmptyFlow())
  rf.smoothCalls.length = 0
})
afterEach(() => cleanup())

it('edgeTypes registra flow e goto', () => {
  expect(edgeTypes).toEqual({ flow: FlowEdge, goto: GotoEdge })
})

// ─── ED-01 ─────────────────────────────────────────────────────────────────────

describe('ED-01 FlowEdge', () => {
  const slot: Slot = { kind: 'after', stepId: 'A' }

  it('com slot: "+" abre o picker no slot sem propagar', () => {
    const parent = vi.fn()
    render(
      <div onClick={parent}>
        <svg>
          <FlowEdge {...edgeProps({ slot })} />
        </svg>
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Inserir ação aqui' }), { clientX: 7, clientY: 9 })
    expect(store().picker).toEqual({ slot, x: 7, y: 9 })
    expect(parent).not.toHaveBeenCalled()
  })

  it.each([
    ['noButton', { slot, noButton: true }],
    ['sem slot', {}],
    ['data ausente', undefined],
  ])('%s → sem "+"', (_, data) => {
    renderSvg(<FlowEdge {...edgeProps(data as Record<string, unknown> | undefined)} />)
    expect(screen.queryByRole('button', { name: 'Inserir ação aqui' })).not.toBeInTheDocument()
  })

  it('branch: pill com o label, centerY logo abaixo do container e "+" acima do alvo', () => {
    renderSvg(<FlowEdge {...edgeProps({ slot: { kind: 'branch', stepId: 'C', branchIndex: 0 }, branchLabel: 'Path A · 50%' })} />)
    expect(screen.getByText('Path A · 50%')).toBeInTheDocument()
    expect(rf.smoothCalls[0]).toMatchObject({ centerY: 50 + 24, borderRadius: 8 })
    const plus = screen.getByRole('button', { name: 'Inserir ação aqui' }).parentElement!
    expect(plus.style.transform).toContain('translate(300px,234px)')
    expect(screen.getByTestId('edge-e1')).toHaveAttribute('d', 'M smooth')
  })

  it('contagem formatada em pt-BR', () => {
    renderSvg(<FlowEdge {...edgeProps({ branchLabel: 'B1', count: 1234 })} />)
    expect(screen.getByText('1.234')).toBeInTheDocument()
  })

  it('convergência: centerY logo acima do alvo e "+" logo abaixo da origem', () => {
    renderSvg(<FlowEdge {...edgeProps({ slot, converge: true })} />)
    expect(rf.smoothCalls[0]).toMatchObject({ centerY: 250 - 28 })
    const plus = screen.getByRole('button', { name: 'Inserir ação aqui' }).parentElement!
    expect(plus.style.transform).toContain('translate(100px,78px)')
  })

  it('bypass: path ortogonal pela lateral (sem getSmoothStepPath) e "+" na lateral', () => {
    renderSvg(<FlowEdge {...edgeProps({ slot, bypassX: 600 })} />)
    expect(rf.smoothCalls).toHaveLength(0)
    const d = screen.getByTestId('edge-e1').getAttribute('d')!
    expect(d.startsWith('M 100 50')).toBe(true)
    expect(d.endsWith('L 300 250')).toBe(true)
    expect(d).toContain('Q 600 74')
    const plus = screen.getByRole('button', { name: 'Inserir ação aqui' }).parentElement!
    expect(plus.style.transform).toContain(`translate(600px,${(74 + 222) / 2}px)`)
  })
})

describe('GotoEdge', () => {
  it('tracejada violeta pela lateral (sideX do layout), entrando 24px à direita do alvo', () => {
    renderSvg(<GotoEdge {...edgeProps({ sideX: 900 }, { markerEnd: 'url(#arrow)' })} />)
    const p = screen.getByTestId('edge-e1')
    expect(JSON.parse(p.getAttribute('data-style')!)).toEqual({ stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '6 4' })
    expect(p.getAttribute('data-marker')).toBe('url(#arrow)')
    const d = p.getAttribute('d')!
    expect(d).toContain('Q 900 74')
    expect(d.endsWith('L 324 250')).toBe(true)
  })

  it('sem sideX usa max(source,target)+120', () => {
    renderSvg(<GotoEdge {...edgeProps({})} />)
    expect(screen.getByTestId('edge-e1').getAttribute('d')).toContain('Q 420 74')
  })
})

describe('roundedOrthogonalPath', () => {
  it('começa com M, uma curva Q por canto e termina no último ponto', () => {
    const d = roundedOrthogonalPath(
      [
        [0, 0],
        [0, 100],
        [100, 100],
        [100, 200],
      ],
      8
    )
    expect(d).toBe('M 0 0 L 0 92 Q 0 100 8 100 L 92 100 Q 100 100 100 108 L 100 200')
  })

  it('raio limitado a metade do segmento curto', () => {
    const d = roundedOrthogonalPath(
      [
        [0, 0],
        [0, 4],
        [10, 4],
      ],
      8
    )
    expect(d).toBe('M 0 0 L 0 2 Q 0 4 5 4 L 10 4')
  })

  it('dois pontos → só uma linha', () => {
    expect(roundedOrthogonalPath([[1, 2], [3, 4]], 8)).toBe('M 1 2 L 3 4')
  })
})

describe('ícones e chips', () => {
  it('stepIcon resolve os nomes do meta e cai em CircleHelp', () => {
    expect(stepIcon('MessageCircle')).toBe(MessageCircle)
    expect(stepIcon('GitBranch')).toBe(GitBranch)
    expect(stepIcon('KanbanSquare')).toBe(SquareKanban)
    expect(stepIcon('x')).toBe(CircleHelp)
    for (const meta of Object.values(STEP_META)) expect(stepIcon(meta.icon)).not.toBe(CircleHelp)
  })

  it('stepChipStyle expõe os pares claro/escuro como custom properties', () => {
    expect(stepChipStyle({ iconBg: '#dcfce7', iconFg: '#16a34a' })).toEqual({
      '--chip-bg-light': '#dcfce7',
      '--chip-fg-light': '#16a34a',
      '--chip-bg-dark': '#16a34a26',
      '--chip-fg-dark': '#7fcc9b',
    })
    // hex inválido não é clareado
    expect(stepChipStyle({ iconBg: '#fff', iconFg: 'red' })['--chip-fg-dark' as never]).toBe('red')
  })
})
