import { describe, expect, it } from 'vitest'
import {
  BRANCH_LABEL_H,
  CONTAINER_H,
  END_W,
  H_GAP,
  layoutFlow,
  measureChain,
  NODE_W,
  PLUS_SIZE,
  SIMPLE_H,
  TRIGGER_H,
  TRIGGER_ID,
  V_GAP,
  type LayoutEdge,
  type LayoutNode,
} from '@/lib/builder/flow/layout'
import { addBranch, addStep, createEmptyFlow, listSteps, setGotoTarget } from '@/lib/builder/flow/operations'
import type { Branch, Flow, Slot, Step, StepType } from '@/lib/builder/flow/types'

/**
 * layoutFlow deriva o canvas inteiro (nós, "+", placeholders, edges de branch,
 * convergência e Go To) da árvore. Aqui: posições exatas dos casos-base, subtítulos
 * dos cards, e uma propriedade sobre 400 árvores aleatórias (sem sobreposição).
 */

const ROOT_Y = TRIGGER_H + V_GAP

const wa = (id: string, next: Step | null = null, config: Record<string, unknown> = { message: `msg ${id}` }): Step => ({
  id,
  type: 'whatsapp',
  name: `W ${id}`,
  config,
  next,
})
const simple = (id: string, type: StepType, config: Record<string, unknown> = {}, next: Step | null = null, name = `${type} ${id}`): Step => ({
  id,
  type,
  name,
  config,
  next,
})
const end = (id: string): Step => ({ id, type: 'end', name: 'END', config: {}, next: null })
const goto = (id: string, targetId: string | null): Step => ({ id, type: 'goto', name: `Ir ${id}`, config: { targetId }, next: null })
const container = (id: string, type: 'condition' | 'split' | 'interactive', branches: Branch[], next: Step | null = null, name = `${type} ${id}`): Step => ({
  id,
  type,
  name,
  config: {},
  next,
  branches,
})
const br = (id: string, label: string, child: Step | null = null, extra: Partial<Branch> = {}): Branch => ({ id, label, child, ...extra })

const flowOf = (root: Step | null): Flow => ({
  schemaVersion: 1,
  id: 'wf',
  name: 'Fluxo',
  trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
  root,
})

const node = (nodes: LayoutNode[], id: string) => {
  const n = nodes.find((x) => x.id === id)
  if (!n) throw new Error(`nó ${id} não existe no layout`)
  return n
}
const edge = (edges: LayoutEdge[], id: string) => {
  const e = edges.find((x) => x.id === id)
  if (!e) throw new Error(`edge ${id} não existe no layout`)
  return e
}

/** Slots onde a tela oferece um "+" (edge com slot e sem noButton, folha "+" e placeholder). */
function offeredSlots(flow: Flow): Slot[] {
  const { nodes, edges } = layoutFlow(flow)
  const out: Slot[] = []
  for (const e of edges) {
    const d = e.data ?? {}
    if (d.slot && !d.noButton) out.push(d.slot as Slot)
  }
  for (const n of nodes) if ((n.type === 'plus' || n.type === 'placeholder') && n.data.slot) out.push(n.data.slot as Slot)
  return out
}

// ─── LY-01 ─────────────────────────────────────────────────────────────────────

describe('LY-01 fluxo vazio e cadeia linear', () => {
  it('fluxo vazio: gatilho no topo e "+" do root', () => {
    const { nodes, edges } = layoutFlow(createEmptyFlow())
    expect(nodes).toEqual([
      expect.objectContaining({ id: TRIGGER_ID, type: 'trigger', position: { x: -160, y: 0 }, width: 320, height: 64, selectable: false }),
      expect.objectContaining({ id: '__plus-root', type: 'plus', position: { x: -PLUS_SIZE / 2, y: ROOT_Y }, data: { slot: { kind: 'root' } } }),
    ])
    expect(edges).toEqual([{ id: 'e-__trigger-__plus-root', source: TRIGGER_ID, target: '__plus-root', type: 'flow', data: { noButton: true } }])
  })

  it('dados do gatilho vão para o nó (tipo, keywords, campanha, filtro)', () => {
    const f: Flow = {
      ...createEmptyFlow(),
      trigger: { type: 'campaign_reply', label: 'Respondeu ao disparo', keywords: [], campaignId: 'c1', campaignName: 'BF', replyFilter: 'quero' },
    }
    expect(layoutFlow(f).nodes[0].data).toEqual({
      label: 'Respondeu ao disparo',
      keywords: [],
      triggerType: 'campaign_reply',
      campaignName: 'BF',
      campaignId: 'c1',
      replyFilter: 'quero',
    })
    // árvore legada sem type → keywords
    const legacy = { ...createEmptyFlow(), trigger: { label: 'Palavras-chave', keywords: ['oi'] } }
    expect(layoutFlow(legacy).nodes[0].data).toMatchObject({ triggerType: 'keywords', campaignName: '', campaignId: '', replyFilter: '' })
  })

  it('whatsapp → wait → END: y em degraus de 120, END centralizado e sem "+"', () => {
    const { nodes, edges } = layoutFlow(flowOf(wa('a', simple('b', 'wait', { value: 2, unit: 'minutes' }, end('e')))))
    expect(node(nodes, 'a')).toMatchObject({ type: 'step', position: { x: -160, y: 120 }, width: NODE_W, height: SIMPLE_H })
    expect(node(nodes, 'b')).toMatchObject({ type: 'step', position: { x: -160, y: 240 } })
    expect(node(nodes, 'e')).toMatchObject({ type: 'end', position: { x: -END_W / 2, y: 360 }, width: 96, height: 32 })
    expect(nodes.filter((n) => n.type === 'plus')).toEqual([])
    expect(edges).toEqual([
      { id: 'e-__trigger-a', source: '__trigger', target: 'a', type: 'flow', data: { slot: { kind: 'root' } } },
      { id: 'e-a-b', source: 'a', target: 'b', type: 'flow', data: { slot: { kind: 'after', stepId: 'a' } } },
      { id: 'e-b-e', source: 'b', target: 'e', type: 'flow', data: { slot: { kind: 'after', stepId: 'b' } } },
    ])
  })

  it('cadeia aberta (whatsapp → tag): folha "+" só na cauda', () => {
    const { nodes, edges } = layoutFlow(flowOf(wa('a', simple('t', 'tag', { tags: ['vip'] }))))
    expect(nodes.filter((n) => n.type === 'plus')).toEqual([
      expect.objectContaining({ id: 'plus-t', position: { x: -16, y: 240 + SIMPLE_H + V_GAP }, data: { slot: { kind: 'after', stepId: 't' } } }),
    ])
    expect(edge(edges, 'e-t-plus-t').data).toEqual({ noButton: true })
  })
})

// ─── LY-02 ─────────────────────────────────────────────────────────────────────

describe('LY-02 containers, placeholders, convergência e bypass', () => {
  const childY = ROOT_Y + CONTAINER_H + V_GAP + BRANCH_LABEL_H // 284

  it('condição com Branch1 → W1, None vazia e next X', () => {
    const C = container('C', 'condition', [br('b0', 'Branch 1', wa('W1'), { value: 'oi' }), br('bn', 'None', null, { locked: true })], wa('X'))
    const { nodes, edges } = layoutFlow(flowOf(C))
    expect(node(nodes, 'C')).toMatchObject({ position: { x: -160, y: 120 }, height: CONTAINER_H })
    // 2 colunas de 320 + H_GAP centradas em 0
    expect(node(nodes, 'W1').position).toEqual({ x: -344, y: childY })
    expect(node(nodes, 'ph-C-1')).toMatchObject({ type: 'placeholder', position: { x: 24, y: childY }, width: NODE_W, data: { slot: { kind: 'branch', stepId: 'C', branchIndex: 1 } } })
    expect(edge(edges, 'e-C-W1').data).toEqual({ slot: { kind: 'branch', stepId: 'C', branchIndex: 0 }, branchLabel: 'Branch 1', count: undefined })
    expect(edge(edges, 'e-C-ph-C-1').data).toEqual({ branchLabel: 'None', count: undefined, noButton: true })
    expect(edge(edges, 'e-W1-X').data).toEqual({ slot: { kind: 'after', stepId: 'W1' }, converge: true })
    expect(edge(edges, 'e-ph-C-1-X').data).toEqual({ noButton: true, converge: true })
    expect(edges.find((e) => e.id === 'e-C-X')).toBeUndefined() // sem bypass: há convergência
    expect(node(nodes, 'X').position).toEqual({ x: -160, y: childY + SIMPLE_H + V_GAP })
    expect(node(nodes, 'plus-X').position.y).toBe(childY + SIMPLE_H + V_GAP + SIMPLE_H + V_GAP)
  })

  it('condição sem next: caudas das branches ganham "+" e o placeholder não converge', () => {
    const C = container('C', 'condition', [br('b0', 'Branch 1', wa('W1'), { value: 'oi' }), br('bn', 'None', null, { locked: true })])
    const { nodes, edges } = layoutFlow(flowOf(C))
    expect(node(nodes, 'plus-W1').data).toEqual({ slot: { kind: 'after', stepId: 'W1' } })
    expect(edges.filter((e) => e.source === 'ph-C-1')).toEqual([])
    expect(edges.some((e) => e.data?.converge)).toBe(false)
  })

  it('todas as branches terminam em END e há next X: edge bypass pela lateral com slot after C', () => {
    const C = container('C', 'condition', [br('b0', 'Branch 1', end('E1'), { value: 'oi' }), br('bn', 'None', end('E2'), { locked: true })], wa('X'))
    const { nodes, edges } = layoutFlow(flowOf(C))
    expect(edge(edges, 'e-C-X').data).toEqual({ slot: { kind: 'after', stepId: 'C' }, bypassX: 344 + H_GAP / 2 })
    expect(node(nodes, 'E1').position).toEqual({ x: -184 - END_W / 2, y: childY })
    expect(node(nodes, 'X').position.y).toBe(childY + 32 + V_GAP)
  })

  it('split: label com % e contagem propagada para a edge (inclusive branch vazia)', () => {
    const S = container('S', 'split', [br('pa', 'Path A', wa('A1'), { percent: 50, count: 1234 }), br('pb', 'Path B', null, { percent: 50, count: 7 })])
    const { edges } = layoutFlow(flowOf(S))
    expect(edge(edges, 'e-S-A1').data).toMatchObject({ branchLabel: 'Path A · 50%', count: 1234 })
    expect(edge(edges, 'e-S-ph-S-1').data).toMatchObject({ branchLabel: 'Path B · 50%', count: 7, noButton: true })
  })

  it('container aninhado: convergência interna aponta para o next do container interno, depois o externo', () => {
    // C(b0 → K(k0 → W, None) → Y, None) → X
    const K = container('K', 'condition', [br('k0', 'K1', wa('W'), { value: 'a' }), br('kn', 'None', null, { locked: true })], wa('Y'))
    const C = container('C', 'condition', [br('c0', 'C1', K, { value: 'b' }), br('cn', 'None', null, { locked: true })], wa('X'))
    const { edges } = layoutFlow(flowOf(C))
    expect(edge(edges, 'e-W-Y').data).toMatchObject({ converge: true })
    expect(edge(edges, 'e-Y-X').data).toMatchObject({ converge: true, slot: { kind: 'after', stepId: 'Y' } })
    expect(edge(edges, 'e-ph-C-1-X').data).toMatchObject({ converge: true })
  })
})

// ─── LY-03 / LY-04 (propriedade) ───────────────────────────────────────────────

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const FUZZ_TYPES: StepType[] = ['whatsapp', 'interactive', 'wait', 'condition', 'split', 'tag', 'tag_remove', 'pipeline', 'goto', 'end']

function allSlots(flow: Flow): Slot[] {
  const slots: Slot[] = [{ kind: 'root' }]
  for (const s of listSteps(flow)) {
    if (s.type !== 'end' && s.type !== 'goto') slots.push({ kind: 'after', stepId: s.id })
    s.branches?.forEach((_, i) => slots.push({ kind: 'branch', stepId: s.id, branchIndex: i }))
  }
  return slots
}

function randomFlow(rand: () => number): Flow {
  let f = createEmptyFlow({ keywords: ['oi'] })
  const inserts = 1 + Math.floor(rand() * 14)
  for (let i = 0; i < inserts; i += 1) {
    const slots = allSlots(f)
    const slot = slots[Math.floor(rand() * slots.length)]
    const type = FUZZ_TYPES[Math.floor(rand() * FUZZ_TYPES.length)]
    f = addStep(f, { type, slot }).flow
    if (rand() < 0.2) {
      const containers = listSteps(f).filter((s) => s.branches?.length)
      if (containers.length) f = addBranch(f, containers[Math.floor(rand() * containers.length)].id)
    }
  }
  const all = listSteps(f)
  for (const g of all.filter((s) => s.type === 'goto')) {
    if (rand() < 0.7) f = setGotoTarget(f, g.id, all[Math.floor(rand() * all.length)].id)
  }
  return f
}

const overlaps = (a: LayoutNode, b: LayoutNode) => {
  const aw = a.width ?? NODE_W
  const ah = a.height ?? SIMPLE_H
  const bw = b.width ?? NODE_W
  const bh = b.height ?? SIMPLE_H
  return a.position.x < b.position.x + bw && b.position.x < a.position.x + aw && a.position.y < b.position.y + bh && b.position.y < a.position.y + ah
}

describe('LY-03 propriedade: 400 árvores aleatórias sem sobreposição', () => {
  const rand = lcg(20261018)
  const flows = Array.from({ length: 400 }, () => randomFlow(rand))

  it('as árvores geradas cobrem todos os tipos (o gerador não é trivial)', () => {
    const types = new Set(flows.flatMap((f) => listSteps(f).map((s) => s.type)))
    expect([...types].sort()).toEqual([...FUZZ_TYPES].sort())
    expect(flows.some((f) => listSteps(f).length >= 10)).toBe(true)
  })

  it('nenhum par de nós se sobrepõe; ids únicos; edges apontam para nós existentes', () => {
    const problems: string[] = []
    flows.forEach((f, idx) => {
      const { nodes, edges } = layoutFlow(f)
      const ids = new Set<string>()
      for (const n of nodes) {
        if (ids.has(n.id)) problems.push(`#${idx}: nó duplicado ${n.id}`)
        ids.add(n.id)
      }
      const edgeIds = new Set<string>()
      for (const e of edges) {
        if (edgeIds.has(e.id)) problems.push(`#${idx}: edge duplicada ${e.id}`)
        edgeIds.add(e.id)
        if (!ids.has(e.source) || !ids.has(e.target)) problems.push(`#${idx}: edge solta ${e.id}`)
      }
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          if (overlaps(nodes[i], nodes[j])) problems.push(`#${idx}: ${nodes[i].id} × ${nodes[j].id}`)
        }
      }
      // todo passo da árvore vira exatamente 1 nó
      for (const s of listSteps(f)) if (!ids.has(s.id)) problems.push(`#${idx}: passo ${s.id} sem nó`)
    })
    expect(problems).toEqual([])
  })

  it('LY-04 measureChain cobre a extensão real dos nós (colunas irmãs não se invadem)', () => {
    const problems: string[] = []
    flows.forEach((f, idx) => {
      if (!f.root) return
      const box = measureChain(f.root, false)
      const placed = layoutFlow(f).nodes.filter((n) => n.id !== TRIGGER_ID)
      const minX = Math.min(...placed.map((n) => n.position.x))
      const maxX = Math.max(...placed.map((n) => n.position.x + (n.width ?? NODE_W)))
      const maxY = Math.max(...placed.map((n) => n.position.y + (n.height ?? SIMPLE_H)))
      if (maxY - ROOT_Y > box.height) problems.push(`#${idx}: altura ${maxY - ROOT_Y} > ${box.height}`)
      if (maxX - minX > box.width) problems.push(`#${idx}: largura ${maxX - minX} > ${box.width}`)
    })
    expect(problems).toEqual([])
  })

  it('layout é determinístico (mesma árvore → mesmo resultado)', () => {
    for (const f of flows.slice(0, 50)) expect(layoutFlow(structuredClone(f))).toEqual(layoutFlow(f))
  })
})

// ─── LY-05 ─────────────────────────────────────────────────────────────────────

describe('LY-05 edges de Go To', () => {
  it('só alvos válidos (existentes e ≠ do próprio goto) geram edge, cada uma num trilho', () => {
    const C = container('C', 'condition', [
      br('b0', 'B0', goto('G1', 'A'), { value: '0' }),
      br('b1', 'B1', goto('G2', 'C'), { value: '1' }),
      br('b2', 'B2', goto('G3', null), { value: '2' }),
      br('b3', 'B3', goto('G4', 'G4'), { value: '3' }),
      br('bn', 'None', goto('G5', 'nao-existe'), { locked: true }),
    ])
    const { nodes, edges } = layoutFlow(flowOf(wa('A', C)))
    const gotoEdges = edges.filter((e) => e.type === 'goto')
    expect(gotoEdges.map((e) => [e.id, e.source, e.target])).toEqual([
      ['goto-G1', 'G1', 'A'],
      ['goto-G2', 'G2', 'C'],
    ])
    const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? NODE_W)))
    expect(gotoEdges[0]).toMatchObject({
      zIndex: 1000,
      markerEnd: { type: 'arrowclosed', color: '#8b5cf6', width: 18, height: 18 },
      data: { sideX: maxX + 64 },
    })
    expect(gotoEdges[1].data).toEqual({ sideX: maxX + 64 + 16 })
    // goto é terminal: sem "+" depois dele
    expect(nodes.some((n) => n.id.startsWith('plus-G'))).toBe(false)
  })

  it('subtítulo do goto mostra o nome do alvo', () => {
    const { nodes } = layoutFlow(flowOf(wa('A', goto('G', 'A'))))
    expect(node(nodes, 'G').data.subtitle).toBe('Ir para: W A')
  })
})

// ─── LY-06 / LY-07 ─────────────────────────────────────────────────────────────

const subtitleOf = (s: Step, extra: Step | null = null) => {
  const f = flowOf(extra ? { ...extra, next: s } : s)
  return node(layoutFlow(f).nodes, s.id).data.subtitle
}

describe('LY-06 subtítulos dos cards', () => {
  const long60 = 'x'.repeat(60)
  const exactly42 = 'y'.repeat(42)
  const interactive = (buttons: number, locked = true) =>
    container('Q', 'interactive', [
      ...Array.from({ length: buttons }, (_, i) => br(`q${i}`, `Botão ${i + 1}`)),
      ...(locked ? [br('nd', 'Not Delivered', null, { locked: true }), br('to', 'Timeout', null, { locked: true })] : []),
    ])
  const condition = (branches: Array<Partial<Branch>>) =>
    container('C', 'condition', [...branches.map((b, i) => br(`c${i}`, `B${i + 1}`, null, { field: 'Replied message', operator: 'contains', ...b })), br('cn', 'None', null, { locked: true })])

  it.each<[string, Step, string]>([
    ['whatsapp com template', wa('w', null, { template: 'promo_outubro', message: 'ignorado' }), 'promo_outubro'],
    ['whatsapp com mensagem longa (truncada em 42)', wa('w', null, { message: long60 }), `${'x'.repeat(41)}…`],
    ['whatsapp com exatamente 42', wa('w', null, { message: exactly42 }), exactly42],
    ['whatsapp vazio', wa('w', null, { template: '', message: '' }), 'Mensagem livre'],
    ['Perguntar 1 botão (+ locked)', interactive(1), '1 botão interativo'],
    ['Perguntar 3 botões (v1, sem locked)', interactive(3, false), '3 botões interativos'],
    ['wait 1 minuto', simple('t', 'wait', { value: 1, unit: 'minutes' }), '1 minuto'],
    ['wait 2 minutos', simple('t', 'wait', { value: 2, unit: 'minutes' }), '2 minutos'],
    ['wait 3 horas', simple('t', 'wait', { value: 3, unit: 'hours' }), '3 horas'],
    ['wait 1 dia', simple('t', 'wait', { value: 1, unit: 'days' }), '1 dia'],
    ['wait unidade desconhecida → minutos', simple('t', 'wait', { value: 4, unit: 'weeks' }), '4 minutos'],
    ['wait até resposta', simple('t', 'wait', { mode: 'reply', value: 9 }), 'Até resposta do contato'],
    ['condição contém', condition([{ value: 'oi' }]), 'Se "Replied message" contém "oi"'],
    ['condição é igual a', condition([{ value: 'Sim', operator: 'equals' }]), 'Se "Replied message" é igual a "Sim"'],
    ['condição não contém', condition([{ value: 'não', operator: 'not_contains' }]), 'Se "Replied message" não contém "não"'],
    ['condição operador desconhecido', condition([{ value: '5', operator: 'gt' }]), 'Se "Replied message" gt "5"'],
    ['condição sem valor (1 branch)', condition([{ value: '' }]), '1 branch + None'],
    ['condição sem valor (2 branches)', condition([{ value: '' }, { value: '' }]), '2 branches + None'],
    ['condição truncada em 48', condition([{ value: 'z'.repeat(60) }]), `${'Se "Replied message" contém "zzzzzzzzzzzzzzzzzzzzzzzzzzz'.slice(0, 47)}…`],
    ['split', container('S', 'split', [br('a', 'A', null, { percent: 50 }), br('b', 'B', null, { percent: 50 })]), '2 paths'],
    ['tag com tags', simple('t', 'tag', { tags: ['vip', ' lead ', ''] }), 'vip, lead'],
    ['tag legado tagName', simple('t', 'tag', { tags: [], tagName: 'antiga' }), 'antiga'],
    ['tag vazia', simple('t', 'tag', { tags: [] }), 'Definir tags'],
    ['tag_remove', simple('t', 'tag_remove', { tags: ['frio'] }), 'frio'],
    ['tags longas truncadas em 42', simple('t', 'tag', { tags: ['a'.repeat(30), 'b'.repeat(30)] }), `${`${'a'.repeat(30)}, ${'b'.repeat(30)}`.slice(0, 41)}…`],
    ['pipeline completo', simple('p', 'pipeline', { pipelineName: 'Vendas', stageName: 'Novo' }), 'Vendas → Novo'],
    ['pipeline sem etapa', simple('p', 'pipeline', { pipelineName: 'Vendas', stageName: '' }), 'Selecionar pipeline e etapa'],
    ['goto sem destino', goto('g', null), 'Selecionar destino'],
    ['END', end('e'), ''],
  ])('%s', (_, s, expected) => {
    expect(subtitleOf(s)).toBe(expected)
  })
})

describe('LY-07 subtítulo da condição em pt-BR', () => {
  // BUG(cond-subtitle-field): o painel rotula o campo como "Mensagem recebida"
  // (ConfigPanel.tsx:917), mas o card mostra o identificador interno em inglês
  // "Replied message" (layout.ts:406).
  it.fails('mostra "Mensagem recebida" no card', () => {
    const C = container('C', 'condition', [
      br('c0', 'B1', null, { field: 'Replied message', operator: 'contains', value: 'oi' }),
      br('cn', 'None', null, { locked: true }),
    ])
    expect(subtitleOf(C)).toBe('Se "Mensagem recebida" contém "oi"')
  })
})

// ─── LY-08 ─────────────────────────────────────────────────────────────────────

describe('LY-08 "+" para a continuação de Perguntar/Condição', () => {
  const hasAfter = (flow: Flow, stepId: string) => offeredSlots(flow).some((s) => s.kind === 'after' && s.stepId === stepId)

  it('caracterização: slot after do container só existe no caso bypass (todas as branches terminais)', () => {
    const C = container('C', 'condition', [br('b0', 'B1', end('E1'), { value: 'x' }), br('bn', 'None', end('E2'), { locked: true })], wa('X'))
    expect(hasAfter(flowOf(C), 'C')).toBe(true)
  })

  // BUG(no-continuation-slot): um Perguntar no fim do fluxo nunca ganha um "+" para a
  // continuação (next). Respostas fora dos botões seguem pela continuação
  // (compile.ts:472-485; dica em ConfigPanel.tsx:1041-1044), mas a tela não deixa
  // configurá-la: o layout só cria o slot {after, container} no bypass (layout.ts:343-348).
  it.fails('Perguntar no root sem next oferece slot "after" do próprio Perguntar', () => {
    const Q = container('Q', 'interactive', [br('q0', 'Sim', wa('S')), br('q1', 'Não')])
    expect(hasAfter(flowOf(Q), 'Q')).toBe(true)
  })

  // BUG(no-continuation-slot): com next X e branches convergindo, não há como
  // inserir um passo entre a condição e o ponto de junção X.
  it.fails('condição com next X e branches convergindo oferece slot "after" da condição', () => {
    const C = container('C', 'condition', [br('b0', 'B1', wa('W'), { value: 'x' }), br('bn', 'None', null, { locked: true })], wa('X'))
    expect(hasAfter(flowOf(C), 'C')).toBe(true)
  })

  it('todos os outros pontos de inserção existem (root, after de simples, branches vazias e com filho)', () => {
    const C = container('C', 'condition', [br('b0', 'B1', wa('W'), { value: 'x' }), br('bn', 'None', null, { locked: true })], wa('X'))
    const slots = offeredSlots(flowOf(C))
    expect(slots).toEqual(
      expect.arrayContaining([
        { kind: 'root' },
        { kind: 'branch', stepId: 'C', branchIndex: 0 },
        { kind: 'branch', stepId: 'C', branchIndex: 1 },
        { kind: 'after', stepId: 'W' },
        { kind: 'after', stepId: 'X' },
      ])
    )
  })
})
