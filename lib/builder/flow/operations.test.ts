import { describe, expect, it } from 'vitest'
import {
  addBranch,
  addStep,
  createEmptyFlow,
  deleteStep,
  findStep,
  isTerminalType,
  listSteps,
  setGotoTarget,
  slotHasTail,
  updateStep,
  updateTrigger,
  walkSteps,
} from '@/lib/builder/flow/operations'
import { validateTree } from '@/lib/builder/flow/tree-validate'
import type { Branch, Flow, Slot, Step, StepType } from '@/lib/builder/flow/types'

/**
 * Operações puras da árvore do builder (lib/builder/flow/operations.ts): são elas que
 * a tela chama em cada "+", "Excluir", "Salvar" e "Desfazer" (via store). Se uma
 * operação erra, o canvas, o autosave e o grafo compilado erram junto.
 */

// ─── Fábricas locais com ids fixos ─────────────────────────────────────────────

const wa = (id: string, next: Step | null = null, message = `msg ${id}`): Step => ({
  id,
  type: 'whatsapp',
  name: `WhatsApp ${id}`,
  config: { template: '', mediaUrl: '', message },
  next,
})

const wait = (id: string, next: Step | null = null): Step => ({
  id,
  type: 'wait',
  name: 'Aguardar',
  config: { mode: 'duration', value: 2, unit: 'minutes' },
  next,
})

const end = (id: string): Step => ({ id, type: 'end', name: 'END', config: {}, next: null })

const goto = (id: string, targetId: string | null): Step => ({
  id,
  type: 'goto',
  name: `Ir ${id}`,
  config: { targetId },
  next: null,
})

const cond = (id: string, branches: Array<Partial<Branch> & { id: string; label: string }>, next: Step | null = null): Step => ({
  id,
  type: 'condition',
  name: `Condição ${id}`,
  config: {},
  next,
  branches: branches.map((b) => ({ child: null, ...b })),
})

const flowOf = (root: Step | null): Flow => ({
  schemaVersion: 1,
  id: 'wf',
  name: 'Fluxo',
  trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
  root,
})

/**
 * Árvore base: A(whatsapp) → B(wait) → C(condition)
 *   C.branches[0] "Branch 1" vazia
 *   C.branches[1] "None" (locked) → D(whatsapp)
 */
function baseFlow(): Flow {
  const D = wa('D')
  const C = cond('C', [
    { id: 'c-b0', label: 'Branch 1', field: 'Replied message', operator: 'contains', value: 'sim' },
    { id: 'c-none', label: 'None', locked: true, child: D },
  ])
  return flowOf(wa('A', wait('B', C)))
}

const NON_TERMINAL: StepType[] = ['whatsapp', 'interactive', 'wait', 'condition', 'split', 'tag', 'tag_remove', 'pipeline']
const TERMINAL: StepType[] = ['end', 'goto']
const ALL_TYPES: StepType[] = [...NON_TERMINAL, ...TERMINAL]

/** Lê o step criado no slot depois do addStep. */
function stepAtSlot(flow: Flow, slot: Slot): Step | null {
  if (slot.kind === 'root') return flow.root
  const parent = findStep(flow, slot.stepId)
  if (!parent) return null
  if (slot.kind === 'after') return parent.next
  return parent.branches?.[slot.branchIndex]?.child ?? null
}

// ─── OPS-01 ────────────────────────────────────────────────────────────────────

describe('OPS-01 createEmptyFlow e defaults de createStep', () => {
  it('fluxo novo começa SEM gatilho (none, label vazio, sem keywords) e sem passos', () => {
    const f = createEmptyFlow()
    expect(f).toMatchObject({ schemaVersion: 1, name: 'Novo fluxo', root: null })
    expect(f.trigger).toEqual({ type: 'none', label: '', keywords: [] })
    expect(f.id).toHaveLength(8)
  })

  it('com keywords/triggerLabel cria gatilho de palavra-chave (compat)', () => {
    expect(createEmptyFlow({ keywords: ['oi'] }).trigger).toEqual({ type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] })
    expect(createEmptyFlow({ triggerLabel: 'Entrada' }).trigger).toEqual({ type: 'keywords', label: 'Entrada', keywords: [] })
    expect(createEmptyFlow({ id: 'x', name: 'Meu fluxo' })).toMatchObject({ id: 'x', name: 'Meu fluxo', trigger: { type: 'none' } })
  })

  const expected: Record<StepType, { name: string; config: Record<string, unknown>; branches?: Array<Partial<Branch>> }> = {
    whatsapp: { name: 'WhatsApp', config: { template: '', mediaUrl: '', message: '' } },
    interactive: {
      name: 'Perguntar',
      config: { message: '' },
      branches: [
        { label: 'Botão 1', child: null },
        { label: 'Not Delivered', child: null, locked: true },
        { label: 'Timeout', child: null, locked: true },
      ],
    },
    wait: { name: 'Aguardar', config: { mode: 'duration', value: 2, unit: 'minutes', timeoutValue: 1, timeoutUnit: 'hours' } },
    condition: {
      name: 'Condição',
      config: {},
      branches: [
        { label: 'Branch 1', child: null, field: 'Replied message', operator: 'contains', value: '' },
        { label: 'None', child: null, locked: true },
      ],
    },
    split: {
      name: 'Split',
      config: {},
      branches: [
        { label: 'Path A', child: null, percent: 50 },
        { label: 'Path B', child: null, percent: 50 },
      ],
    },
    tag: { name: 'Adicionar tag', config: { tags: [] } },
    tag_remove: { name: 'Remover tag', config: { tags: [] } },
    pipeline: {
      name: 'Mover no pipeline',
      config: { pipelineId: '', pipelineName: '', stageId: '', stageName: '', oppStatus: 'open' },
    },
    goto: { name: 'Ir para', config: { targetId: null } },
    end: { name: 'END', config: {} },
  }

  it.each(ALL_TYPES)('passo "%s" nasce com os defaults do tipo', (type) => {
    const { flow, stepId } = addStep(createEmptyFlow(), { type, slot: { kind: 'root' } })
    const step = flow.root!
    expect(step.id).toBe(stepId)
    expect(step.id).toHaveLength(8)
    expect(step).toMatchObject({ type, name: expected[type].name, next: null })
    expect(step.config).toEqual(expected[type].config)
    if (expected[type].branches) {
      expect(step.branches).toHaveLength(expected[type].branches!.length)
      expected[type].branches!.forEach((b, i) => expect(step.branches![i]).toMatchObject(b))
      expect(new Set(step.branches!.map((b) => b.id)).size).toBe(step.branches!.length)
      step.branches!.forEach((b) => expect(b.id).toHaveLength(6))
    } else {
      expect(step.branches).toBeUndefined()
    }
    expect(validateTree(flow)).toEqual({ valid: true, issues: [] })
  })

  it('ids são únicos entre passos criados em sequência', () => {
    let f = createEmptyFlow()
    for (let i = 0; i < 30; i += 1) f = addStep(f, { type: 'whatsapp', slot: { kind: 'root' } }).flow
    const ids = listSteps(f).map((s) => s.id)
    expect(new Set(ids).size).toBe(30)
  })

  it('isTerminalType: só end e goto', () => {
    expect(ALL_TYPES.filter(isTerminalType)).toEqual(['end', 'goto'])
  })
})

// ─── OPS-02 ────────────────────────────────────────────────────────────────────

describe('OPS-02 addStep em cada slot × cada tipo não-terminal', () => {
  const slots: Array<{ name: string; slot: Slot; tail: string | null }> = [
    { name: 'root (antes de A)', slot: { kind: 'root' }, tail: 'A' },
    { name: 'depois de A (meio)', slot: { kind: 'after', stepId: 'A' }, tail: 'B' },
    { name: 'depois de C (fim da cadeia)', slot: { kind: 'after', stepId: 'C' }, tail: null },
    { name: 'branch C/0 vazia', slot: { kind: 'branch', stepId: 'C', branchIndex: 0 }, tail: null },
    { name: 'branch C/1 (None) com filho D', slot: { kind: 'branch', stepId: 'C', branchIndex: 1 }, tail: 'D' },
    { name: 'depois de D (fim da branch)', slot: { kind: 'after', stepId: 'D' }, tail: null },
  ]

  const cases = NON_TERMINAL.flatMap((type) => slots.map((s) => ({ type, ...s })))

  it.each(cases)('$type em $name: entra no slot e herda a cauda', ({ type, slot, tail }) => {
    const base = baseFlow()
    const snapshot = structuredClone(base)
    const { flow, stepId } = addStep(base, { type, slot })

    expect(flow).not.toBe(base)
    expect(base).toEqual(snapshot) // pura: não muta a entrada
    const created = stepAtSlot(flow, slot)
    expect(created?.id).toBe(stepId)
    expect(created?.type).toBe(type)
    expect(created?.next?.id ?? null).toBe(tail)
    // nada some: todos os passos originais continuam na árvore
    expect(listSteps(flow).map((s) => s.id).sort()).toEqual([...listSteps(base).map((s) => s.id), stepId].sort())
    expect(validateTree(flow)).toEqual({ valid: true, issues: [] })
  })

  it('o novo passo vira o selecionável: o stepId devolvido existe em findStep', () => {
    const { flow, stepId } = addStep(baseFlow(), { type: 'tag', slot: { kind: 'after', stepId: 'B' } })
    expect(findStep(flow, stepId)?.type).toBe('tag')
    expect(findStep(flow, 'B')?.next?.id).toBe(stepId)
    expect(findStep(flow, stepId)?.next?.id).toBe('C')
  })
})

// ─── OPS-03 ────────────────────────────────────────────────────────────────────

describe('OPS-03 terminais (end/goto) só em ponta aberta', () => {
  const withTail: Array<{ name: string; slot: Slot }> = [
    { name: 'root com root', slot: { kind: 'root' } },
    { name: 'after A (tem next)', slot: { kind: 'after', stepId: 'A' } },
    { name: 'branch com filho', slot: { kind: 'branch', stepId: 'C', branchIndex: 1 } },
  ]
  const open: Array<{ name: string; slot: Slot }> = [
    { name: 'after C (cauda)', slot: { kind: 'after', stepId: 'C' } },
    { name: 'branch vazia', slot: { kind: 'branch', stepId: 'C', branchIndex: 0 } },
    { name: 'after D (fim da branch)', slot: { kind: 'after', stepId: 'D' } },
  ]

  it.each(TERMINAL.flatMap((type) => withTail.map((s) => ({ type, ...s }))))(
    '$type em $name: no-op (MESMO objeto, stepId vazio)',
    ({ type, slot }) => {
      const base = baseFlow()
      expect(slotHasTail(base, slot)).toBe(true)
      const res = addStep(base, { type, slot })
      expect(res.flow).toBe(base)
      expect(res.stepId).toBe('')
    }
  )

  it.each(TERMINAL.flatMap((type) => open.map((s) => ({ type, ...s }))))('$type em $name: insere com next null', ({ type, slot }) => {
    const base = baseFlow()
    expect(slotHasTail(base, slot)).toBe(false)
    const res = addStep(base, { type, slot })
    const created = stepAtSlot(res.flow, slot)
    expect(created).toMatchObject({ id: res.stepId, type, next: null })
    expect(validateTree(res.flow).valid).toBe(true)
  })

  it.each(TERMINAL)('%s no root de fluxo vazio: insere', (type) => {
    const f = createEmptyFlow()
    expect(slotHasTail(f, { kind: 'root' })).toBe(false)
    const res = addStep(f, { type, slot: { kind: 'root' } })
    expect(res.flow.root).toMatchObject({ type, next: null })
  })

  it('slotHasTail com pai inexistente ou branch fora do range: false', () => {
    const base = baseFlow()
    expect(slotHasTail(base, { kind: 'after', stepId: 'nao-existe' })).toBe(false)
    expect(slotHasTail(base, { kind: 'branch', stepId: 'C', branchIndex: 9 })).toBe(false)
    expect(slotHasTail(base, { kind: 'branch', stepId: 'A', branchIndex: 0 })).toBe(false)
  })
})

// ─── OPS-04 ────────────────────────────────────────────────────────────────────

describe('OPS-04 addStep com slot inválido devolve o fluxo original', () => {
  it.each<{ name: string; slot: Slot }>([
    { name: 'after de id inexistente', slot: { kind: 'after', stepId: 'nao-existe' } },
    { name: 'branch de índice 9', slot: { kind: 'branch', stepId: 'C', branchIndex: 9 } },
    { name: 'branch de passo sem branches', slot: { kind: 'branch', stepId: 'A', branchIndex: 0 } },
    { name: 'branch de id inexistente', slot: { kind: 'branch', stepId: 'zzz', branchIndex: 0 } },
  ])('$name', ({ slot }) => {
    const base = baseFlow()
    for (const type of ALL_TYPES) {
      expect(addStep(base, { type, slot }).flow).toBe(base)
    }
  })
})

// ─── OPS-05 ────────────────────────────────────────────────────────────────────

describe('OPS-05 deleteStep religa pai → next', () => {
  it('root simples: o next vira root', () => {
    const f = deleteStep(baseFlow(), 'A')
    expect(f.root?.id).toBe('B')
    expect(validateTree(f).valid).toBe(true)
  })

  it('passo do meio: o pai aponta para o next', () => {
    const f = deleteStep(baseFlow(), 'B')
    expect(f.root?.next?.id).toBe('C')
    expect(listSteps(f).map((s) => s.id)).toEqual(['A', 'C', 'D'])
  })

  it('container na cauda: some junto com as sub-árvores das branches', () => {
    const f = deleteStep(baseFlow(), 'C')
    expect(findStep(f, 'B')?.next).toBeNull()
    expect(findStep(f, 'D')).toBeNull()
    expect(listSteps(f).map((s) => s.id)).toEqual(['A', 'B'])
  })

  it('cabeça de branch: o próximo da branch sobe para o slot', () => {
    const base = baseFlow()
    findStep(base, 'D')!.next = wa('E')
    const f = deleteStep(base, 'D')
    expect(findStep(f, 'C')?.branches?.[1].child?.id).toBe('E')
  })

  it('container no meio com next X: sub-árvores somem e X é promovido', () => {
    const base = baseFlow()
    findStep(base, 'C')!.next = wa('X', end('X-end'))
    const f = deleteStep(base, 'C')
    expect(findStep(f, 'B')?.next?.id).toBe('X')
    expect(findStep(f, 'D')).toBeNull()
    expect(listSteps(f).map((s) => s.id)).toEqual(['A', 'B', 'X', 'X-end'])
    expect(validateTree(f).valid).toBe(true)
  })

  it('id inexistente: conteúdo igual (clone) e entrada intacta', () => {
    const base = baseFlow()
    const snapshot = structuredClone(base)
    const f = deleteStep(base, 'nao-existe')
    expect(f).toEqual(base)
    expect(base).toEqual(snapshot)
  })
})

// ─── OPS-06 ────────────────────────────────────────────────────────────────────

describe('OPS-06 deleteStep limpa alvos de Go To', () => {
  it('apagar o alvo zera targetId do goto', () => {
    // W → K(condition: b0 → G(goto W))
    let f = flowOf(wa('W', cond('K', [{ id: 'k0', label: 'Branch 1', value: 'x', child: goto('G', null) }, { id: 'kn', label: 'None', locked: true }])))
    f = setGotoTarget(f, 'G', 'W')
    expect(findStep(f, 'G')?.config.targetId).toBe('W')
    const after = deleteStep(f, 'W')
    expect(findStep(after, 'G')?.config.targetId).toBeNull()
    expect(validateTree(after)).toEqual({ valid: true, issues: [] })
  })

  it('apagar o container que contém o alvo também zera o targetId', () => {
    // K(condition: b0 → W) → Y → G(goto W)
    const f = flowOf(
      cond('K', [{ id: 'k0', label: 'Branch 1', value: 'x', child: wa('W') }, { id: 'kn', label: 'None', locked: true }], wa('Y', goto('G', 'W')))
    )
    expect(validateTree(f).valid).toBe(true)
    const after = deleteStep(f, 'K')
    expect(after.root?.id).toBe('Y')
    expect(findStep(after, 'G')?.config.targetId).toBeNull()
    expect(validateTree(after).valid).toBe(true)
  })

  it('goto para alvo que continua existindo não é tocado', () => {
    const f = flowOf(wa('W', wa('Z', goto('G', 'W'))))
    expect(findStep(deleteStep(f, 'Z'), 'G')?.config.targetId).toBe('W')
  })
})

// ─── OPS-07 ────────────────────────────────────────────────────────────────────

describe('OPS-07 updateStep: merge, branches e identidade', () => {
  it('name e merge raso de config (não perde template/mediaUrl)', () => {
    const base = baseFlow()
    const f = updateStep(base, 'A', { name: 'Boas-vindas', config: { message: 'Olá!' } })
    expect(findStep(f, 'A')).toMatchObject({ name: 'Boas-vindas', config: { template: '', mediaUrl: '', message: 'Olá!' } })
    expect(findStep(base, 'A')?.name).toBe('WhatsApp A')
  })

  it('branches são substituídas por um CLONE (mutar o patch depois não afeta o flow)', () => {
    const base = baseFlow()
    const patchBranches: Branch[] = [
      { id: 'c-b0', label: 'Quer', child: null, field: 'Replied message', operator: 'equals', value: 'quero' },
      { id: 'c-none', label: 'None', locked: true, child: findStep(base, 'D') },
    ]
    const f = updateStep(base, 'C', { branches: patchBranches })
    patchBranches[0].label = 'MUTADO'
    patchBranches.push({ id: 'zz', label: 'intrusa', child: null })
    expect(findStep(f, 'C')?.branches?.map((b) => b.label)).toEqual(['Quer', 'None'])
    expect(findStep(f, 'D')).not.toBeNull()
  })

  it('patch idêntico e id inexistente devolvem o flow ORIGINAL (identidade)', () => {
    const base = baseFlow()
    expect(updateStep(base, 'A', { name: 'WhatsApp A' })).toBe(base)
    expect(updateStep(base, 'A', { config: { message: 'msg A' } })).toBe(base)
    expect(updateStep(base, 'A', {})).toBe(base)
    expect(updateStep(base, 'nao-existe', { name: 'x' })).toBe(base)
  })

  it('config NÃO remove chaves (merge) — chave antiga continua', () => {
    const base = flowOf({ ...wa('A'), config: { template: 't', mediaUrl: '', message: '', legado: 1 } })
    const f = updateStep(base, 'A', { config: { template: '' } })
    expect(findStep(f, 'A')?.config).toEqual({ template: '', mediaUrl: '', message: '', legado: 1 })
  })

  it('remover uma branch com sub-árvore pelo patch descarta a sub-árvore e limpa goto que apontava para ela', () => {
    const base = flowOf(
      cond('C', [
        { id: 'b0', label: 'B1', value: 'x', child: wa('W') },
        { id: 'b1', label: 'B2', value: 'y', child: goto('G', 'W') },
        { id: 'bn', label: 'None', locked: true },
      ])
    )
    const branches = findStep(base, 'C')!.branches!.filter((b) => b.id !== 'b0')
    const f = updateStep(base, 'C', { branches })
    expect(findStep(f, 'W')).toBeNull()
    expect(findStep(f, 'G')?.config.targetId).toBeNull()
  })
})

// ─── OPS-08 / OPS-09 ───────────────────────────────────────────────────────────

describe('OPS-08 updateTrigger: normalização', () => {
  it('keywords com trim e sem linhas vazias (sem lowercase e sem dedupe); replyFilter com trim', () => {
    const base = createEmptyFlow()
    const f = updateTrigger(base, {
      type: 'keywords',
      label: 'Palavras-chave',
      keywords: ['  Oi ', '', '\tQuero comprar\r', ' ', 'oi', 'Oi'],
      replyFilter: '  quero  ',
    })
    expect(f.trigger.keywords).toEqual(['Oi', 'Quero comprar', 'oi', 'Oi'])
    expect(f.trigger.replyFilter).toBe('quero')
    expect(f.trigger).toMatchObject({ type: 'keywords', label: 'Palavras-chave' })
    expect(base.trigger).toEqual({ type: 'none', label: '', keywords: [] })
  })

  it('o mesmo patch aplicado de novo devolve o MESMO objeto (sem undo redundante)', () => {
    const patch = { type: 'keywords' as const, label: 'Palavras-chave', keywords: ['  Oi ', '\tQuero comprar\r'], replyFilter: '  quero  ' }
    const once = updateTrigger(createEmptyFlow(), patch)
    expect(updateTrigger(once, patch)).toBe(once)
  })

  it('campanha: campaignId/campaignName/replyFilter e troca de tipo', () => {
    const f = updateTrigger(createEmptyFlow(), {
      type: 'campaign_reply',
      label: 'Respondeu ao disparo',
      campaignId: 'c1',
      campaignName: 'Black Friday',
      replyFilter: ' quero ',
    })
    expect(f.trigger).toMatchObject({ type: 'campaign_reply', campaignId: 'c1', campaignName: 'Black Friday', replyFilter: 'quero' })
    const back = updateTrigger(f, { type: 'none', label: '', campaignId: null, campaignName: '', replyFilter: '' })
    expect(back.trigger).toMatchObject({ type: 'none', label: '', campaignId: null, campaignName: '', replyFilter: '' })
  })

  it('patch vazio devolve o mesmo objeto; não mexe em root', () => {
    const base = baseFlow()
    expect(updateTrigger(base, {})).toBe(base)
    const f = updateTrigger(base, { keywords: ['novo'] })
    expect(f.root).toEqual(base.root)
  })
})

describe('OPS-09 primeiro "Salvar gatilho" sem mudanças', () => {
  // trigger-noop: o trigger de createEmptyFlow() não tem campaignId/campaignName/
  // replyFilter, e o ConfigPanel sempre envia esses campos (campaignId null, '' e '').
  // A comparação é pela forma normalizada: "Salvar" sem mudar nada é no-op.
  it('o patch que o painel envia sem alterar nada deve ser no-op (mesmo objeto)', () => {
    const f = createEmptyFlow()
    const panelPatch = {
      type: 'none' as const,
      label: '',
      keywords: ''.split('\n'), // textarea vazio → ['']
      campaignId: null,
      campaignName: '',
      replyFilter: '',
    }
    expect(updateTrigger(f, panelPatch)).toBe(f)
  })
})

// ─── OPS-10 / OPS-11 ───────────────────────────────────────────────────────────

describe('OPS-10 addBranch por tipo', () => {
  it('condition: nova branch entra ANTES do None, com campo/operador/valor padrão', () => {
    const { flow, stepId } = addStep(createEmptyFlow(), { type: 'condition', slot: { kind: 'root' } })
    const f = addBranch(flow, stepId)
    const bs = findStep(f, stepId)!.branches!
    expect(bs.map((b) => b.label)).toEqual(['Branch 1', 'Branch 2', 'None'])
    expect(bs[1]).toMatchObject({ child: null, field: 'Replied message', operator: 'contains', value: '' })
    expect(bs[2].locked).toBe(true)
    expect(validateTree(f).valid).toBe(true)
  })

  it('split: entra no fim como "Path C" com 0% (a soma continua 100)', () => {
    const { flow, stepId } = addStep(createEmptyFlow(), { type: 'split', slot: { kind: 'root' } })
    const f = addBranch(flow, stepId)
    const bs = findStep(f, stepId)!.branches!
    expect(bs.map((b) => `${b.label}:${b.percent}`)).toEqual(['Path A:50', 'Path B:50', 'Path C:0'])
    expect(validateTree(f).valid).toBe(true)
  })

  it('interactive cru (com Not Delivered/Timeout): novo botão antes das locked', () => {
    const { flow, stepId } = addStep(createEmptyFlow(), { type: 'interactive', slot: { kind: 'root' } })
    const f = addBranch(flow, stepId)
    expect(findStep(f, stepId)!.branches!.map((b) => b.label)).toEqual(['Botão 1', 'Botão 2', 'Not Delivered', 'Timeout'])
  })

  it('label explícito é respeitado; ids novos são únicos', () => {
    const { flow, stepId } = addStep(createEmptyFlow(), { type: 'condition', slot: { kind: 'root' } })
    const f = addBranch(addBranch(flow, stepId, 'Preço'), stepId, 'Prazo')
    const bs = findStep(f, stepId)!.branches!
    expect(bs.map((b) => b.label)).toEqual(['Branch 1', 'Preço', 'Prazo', 'None'])
    expect(new Set(bs.map((b) => b.id)).size).toBe(4)
  })

  it('passo sem branches: conteúdo inalterado', () => {
    const base = baseFlow()
    expect(addBranch(base, 'A')).toEqual(base)
    expect(addBranch(base, 'nao-existe')).toEqual(base)
  })
})

describe('OPS-11 addBranch em formatos sem branches locked', () => {
  // BUG(addbranch-interactive-v1): o store remove as branches locked do Perguntar
  // (v1 = só botões), mas addBranch assume 2 locked no fim: splice(length-2) com
  // [Botão 1] insere no INÍCIO e o label sai "Botão 0" (operations.ts:419-420).
  it.fails('Perguntar v1 [Botão 1] → ["Botão 1", "Botão 2"]', () => {
    const f = flowOf({
      id: 'Q',
      type: 'interactive',
      name: 'Perguntar',
      config: { message: 'Quer?' },
      next: null,
      branches: [{ id: 'q0', label: 'Botão 1', child: null }],
    })
    expect(findStep(addBranch(f, 'Q'), 'Q')!.branches!.map((b) => b.label)).toEqual(['Botão 1', 'Botão 2'])
  })

  // BUG(addbranch-condition-no-none): condição sem a branch "None" (árvore legada/
  // importada) — addBranch insere ANTES da última branch real, em vez de anexar.
  it.fails('condição sem None [B1, B2] → nova branch no fim', () => {
    const f = flowOf(cond('C', [{ id: 'c0', label: 'B1', value: 'a' }, { id: 'c1', label: 'B2', value: 'b' }]))
    const labels = findStep(addBranch(f, 'C', 'B3'), 'C')!.branches!.map((b) => b.label)
    expect(labels).toEqual(['B1', 'B2', 'B3'])
  })
})

// ─── OPS-12 ────────────────────────────────────────────────────────────────────

describe('OPS-12 setGotoTarget, walkSteps, listSteps, findStep', () => {
  it('setGotoTarget só altera passos do tipo goto', () => {
    const base = flowOf(wa('A', wa('B', goto('G', null))))
    expect(findStep(setGotoTarget(base, 'G', 'A'), 'G')?.config.targetId).toBe('A')
    expect(findStep(setGotoTarget(base, 'B', 'A'), 'B')?.config).toEqual(findStep(base, 'B')?.config)
    expect(setGotoTarget(base, 'nao-existe', 'A')).toEqual(base)
    // entrada intacta
    expect(findStep(base, 'G')?.config.targetId).toBeNull()
  })

  it('listSteps em pré-ordem: passo, branches (recursivo) e depois next', () => {
    const f = flowOf(
      wa('A', cond('C', [
        { id: 'c0', label: 'B1', value: 'x', child: wa('C0a', wa('C0b')) },
        { id: 'c1', label: 'B2', value: 'y', child: cond('N', [{ id: 'n0', label: 'N1', value: 'z', child: wa('N0') }, { id: 'nn', label: 'None', locked: true }]) },
        { id: 'cn', label: 'None', locked: true, child: end('CE') },
      ], wa('Z')))
    )
    expect(listSteps(f).map((s) => s.id)).toEqual(['A', 'C', 'C0a', 'C0b', 'N', 'N0', 'CE', 'Z'])
    const seen: string[] = []
    walkSteps(f.root, (s) => seen.push(s.id))
    expect(seen).toEqual(listSteps(f).map((s) => s.id))
    expect(findStep(f, 'N0')?.type).toBe('whatsapp')
    expect(findStep(f, 'CE')?.type).toBe('end')
    expect(findStep(f, 'nao-existe')).toBeNull()
    expect(listSteps(createEmptyFlow())).toEqual([])
  })
})
