import { beforeEach, describe, expect, it } from 'vitest'
import { TRIGGER_SELECTION_ID, useFlowBuilderStore } from '@/components/flow-builder/store'
import { createEmptyFlow, findStep, listSteps } from '@/lib/builder/flow/operations'
import { validateTree } from '@/lib/builder/flow/tree-validate'
import type { Branch, Flow, Slot, Step, StepType } from '@/lib/builder/flow/types'

/**
 * Store zustand da tela do builder: cada clique do canvas/painel passa por aqui.
 * `rev` + `saveMode` são o contrato com o autosave (structural = grava já,
 * config = debounce); `past` é o "Desfazer".
 */

const store = () => useFlowBuilderStore.getState()

const wa = (id: string, next: Step | null = null): Step => ({
  id,
  type: 'whatsapp',
  name: `W ${id}`,
  config: { template: '', mediaUrl: '', message: `msg ${id}` },
  next,
})
const goto = (id: string, targetId: string | null = null): Step => ({ id, type: 'goto', name: `Ir ${id}`, config: { targetId }, next: null })
const cond = (id: string, branches: Branch[], next: Step | null = null): Step => ({ id, type: 'condition', name: `C ${id}`, config: {}, next, branches })

const flowOf = (root: Step | null, name = 'Fluxo'): Flow => ({
  schemaVersion: 1,
  id: 'wf',
  name,
  trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
  root,
})

/** A → C(b0 → W, None) → G(goto) */
function sampleFlow(): Flow {
  return flowOf(
    wa('A', cond('C', [
      { id: 'b0', label: 'B1', child: wa('W'), field: 'Replied message', operator: 'contains', value: 'x' },
      { id: 'bn', label: 'None', child: null, locked: true },
    ], goto('G')))
  )
}

const counters = () => ({ rev: store().rev, past: store().past.length, saveMode: store().saveMode })

beforeEach(() => {
  store().reset()
  useFlowBuilderStore.setState({ saveMode: 'config' })
})

// ─── ST-01 ─────────────────────────────────────────────────────────────────────

describe('ST-01 loadFlow, reset, select e openPicker', () => {
  it('loadFlow zera histórico, rev, seleção, picker e modo goto', () => {
    store().loadFlow(sampleFlow())
    store().select('A')
    store().renameFlow('Outro')
    store().openPicker({ kind: 'root' }, { x: 1, y: 2 })
    store().startGotoPick('G')
    expect(store().rev).toBeGreaterThan(0)

    const fresh = sampleFlow()
    store().loadFlow(fresh)
    expect(store()).toMatchObject({ flow: fresh, past: [], rev: 0, selectedStepId: null, picker: null, pickingGotoId: null })
  })

  it('reset deixa o store vazio', () => {
    store().loadFlow(sampleFlow())
    store().renameFlow('x')
    store().reset()
    expect(store()).toMatchObject({ flow: null, past: [], rev: 0, selectedStepId: null, picker: null, pickingGotoId: null })
  })

  it('select fecha o picker; openPicker guarda slot e coordenadas', () => {
    store().loadFlow(sampleFlow())
    const slot: Slot = { kind: 'after', stepId: 'A' }
    store().openPicker(slot, { x: 120, y: 340 })
    expect(store().picker).toEqual({ slot, x: 120, y: 340 })
    store().select('A')
    expect(store()).toMatchObject({ selectedStepId: 'A', picker: null })
    store().openPicker(slot, { x: 0, y: 0 })
    store().closePicker()
    expect(store().picker).toBeNull()
    store().select(null)
    expect(store().selectedStepId).toBeNull()
  })

  it('mutações sem flow carregado são ignoradas', () => {
    store().removeStep('A')
    store().patchStep('A', { name: 'x' })
    store().patchTrigger({ keywords: ['x'] })
    store().addBranchTo('C')
    store().renameFlow('x')
    store().openPicker({ kind: 'root' }, { x: 0, y: 0 })
    store().insertStep('whatsapp')
    store().undo()
    expect(store()).toMatchObject({ flow: null, rev: 0, past: [] })
  })
})

// ─── ST-02 ─────────────────────────────────────────────────────────────────────

describe('ST-02 insertStep', () => {
  it('sem picker aberto: nada muda', () => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().insertStep('whatsapp')
    expect(store().flow).toBe(f)
    expect(counters()).toEqual({ rev: 0, past: 0, saveMode: 'config' })
  })

  const slots: Array<{ name: string; slot: Slot; parentCheck: (f: Flow, id: string) => void }> = [
    { name: 'root', slot: { kind: 'root' }, parentCheck: (f, id) => expect(f.root?.id).toBe(id) },
    { name: 'after A', slot: { kind: 'after', stepId: 'A' }, parentCheck: (f, id) => expect(findStep(f, 'A')?.next?.id).toBe(id) },
    { name: 'branch C/1 vazia', slot: { kind: 'branch', stepId: 'C', branchIndex: 1 }, parentCheck: (f, id) => expect(findStep(f, 'C')?.branches?.[1].child?.id).toBe(id) },
  ]
  const types: StepType[] = ['whatsapp', 'interactive', 'wait', 'condition', 'split', 'tag', 'tag_remove', 'pipeline']

  it.each(types.flatMap((type) => slots.map((s) => ({ type, ...s }))))('$type em $name', ({ type, slot, parentCheck }) => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().openPicker(slot, { x: 10, y: 10 })
    store().insertStep(type)
    const s = store()
    expect(s.flow).not.toBe(f)
    expect(s.past).toEqual([f])
    expect(s).toMatchObject({ rev: 1, saveMode: 'structural', picker: null })
    const created = findStep(s.flow!, s.selectedStepId!)
    expect(created?.type).toBe(type)
    parentCheck(s.flow!, created!.id)
    expect(validateTree(s.flow!).valid).toBe(true)
  })

  it('Perguntar entra sem as branches locked (v1: só botões + continuação)', () => {
    store().loadFlow(createEmptyFlow())
    store().openPicker({ kind: 'root' }, { x: 0, y: 0 })
    store().insertStep('interactive')
    const q = store().flow!.root!
    expect(q.branches?.map((b) => b.label)).toEqual(['Botão 1'])
    expect(q.branches?.some((b) => b.locked)).toBe(false)
    // uma única entrada de undo (o filtro das locked não é um passo extra)
    expect(store().past).toHaveLength(1)
    expect(store().rev).toBe(1)
  })

  it.each<StepType>(['end', 'goto'])('terminal %s em slot com cauda: só fecha o picker (sem rev/undo)', (type) => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().openPicker({ kind: 'after', stepId: 'A' }, { x: 0, y: 0 })
    store().insertStep(type)
    expect(store().flow).toBe(f)
    expect(store().picker).toBeNull()
    expect(counters()).toEqual({ rev: 0, past: 0, saveMode: 'config' })
  })

  it.each<StepType>(['end', 'goto'])('terminal %s em ponta aberta: insere', (type) => {
    store().loadFlow(sampleFlow())
    store().openPicker({ kind: 'after', stepId: 'W' }, { x: 0, y: 0 })
    store().insertStep(type)
    expect(findStep(store().flow!, 'W')?.next?.type).toBe(type)
    expect(store().rev).toBe(1)
  })
})

// ─── ST-03 ─────────────────────────────────────────────────────────────────────

describe('ST-03 removeStep e undo da remoção', () => {
  it('remove o selecionado e limpa a seleção', () => {
    store().loadFlow(sampleFlow())
    store().select('A')
    store().removeStep('A')
    expect(store()).toMatchObject({ selectedStepId: null, rev: 1, saveMode: 'structural' })
    expect(store().flow!.root?.id).toBe('C')
  })

  it('remover outro passo mantém a seleção', () => {
    store().loadFlow(sampleFlow())
    store().select('W')
    store().removeStep('A')
    expect(store().selectedStepId).toBe('W')
  })

  it('remover container com sub-árvore e desfazer restaura tudo', () => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().removeStep('C')
    expect(listSteps(store().flow!).map((s) => s.id)).toEqual(['A', 'G'])
    store().undo()
    expect(store().flow).toEqual(f)
    expect(store().flow).toBe(f) // o snapshot é o próprio objeto anterior
    expect(store()).toMatchObject({ rev: 2, saveMode: 'structural', past: [] })
  })
})

// ─── ST-04 ─────────────────────────────────────────────────────────────────────

describe('ST-04 patchStep, patchTrigger, renameFlow e addBranchTo', () => {
  it('patchStep: no-op não gasta rev/undo; mudança → config', () => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().patchStep('A', { name: 'W A' })
    store().patchStep('nao-existe', { name: 'x' })
    expect(store().flow).toBe(f)
    expect(counters()).toEqual({ rev: 0, past: 0, saveMode: 'config' })
    store().patchStep('A', { config: { message: 'Olá' } })
    expect(findStep(store().flow!, 'A')?.config.message).toBe('Olá')
    expect(counters()).toEqual({ rev: 1, past: 1, saveMode: 'config' })
  })

  it('patchTrigger: no-op ignorado; mudança → config', () => {
    store().loadFlow(sampleFlow())
    store().patchTrigger({ keywords: ['oi'] })
    expect(store().rev).toBe(0)
    store().patchTrigger({ keywords: ['oi', 'olá'] })
    expect(store().flow!.trigger.keywords).toEqual(['oi', 'olá'])
    expect(counters()).toEqual({ rev: 1, past: 1, saveMode: 'config' })
  })

  it('renameFlow: ignora nome igual; preserva a identidade do trigger e do root', () => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().renameFlow('Fluxo')
    expect(store().rev).toBe(0)
    store().renameFlow('Boas-vindas')
    expect(store().flow!.name).toBe('Boas-vindas')
    expect(store().flow!.trigger).toBe(f.trigger)
    expect(store().flow!.root).toBe(f.root)
    expect(counters()).toEqual({ rev: 1, past: 1, saveMode: 'config' })
  })

  it('addBranchTo: estrutural', () => {
    store().loadFlow(sampleFlow())
    store().addBranchTo('C')
    expect(findStep(store().flow!, 'C')?.branches?.map((b) => b.label)).toEqual(['B1', 'Branch 2', 'None'])
    expect(counters()).toEqual({ rev: 1, past: 1, saveMode: 'structural' })
  })

  it('saveMode acompanha a ÚLTIMA mutação (config depois de structural)', () => {
    store().loadFlow(sampleFlow())
    store().removeStep('G')
    expect(store().saveMode).toBe('structural')
    store().renameFlow('x')
    expect(store().saveMode).toBe('config')
  })
})

// ─── ST-05 ─────────────────────────────────────────────────────────────────────

describe('ST-05 modo Go To', () => {
  it('startGotoPick fecha o picker; escolher o próprio goto ou sem pick é ignorado', () => {
    store().loadFlow(sampleFlow())
    store().openPicker({ kind: 'root' }, { x: 0, y: 0 })
    store().startGotoPick('G')
    expect(store()).toMatchObject({ pickingGotoId: 'G', picker: null })
    store().chooseGotoTarget('G')
    expect(store()).toMatchObject({ pickingGotoId: 'G', rev: 0 })
    store().cancelGotoPick()
    store().chooseGotoTarget('A')
    expect(store()).toMatchObject({ pickingGotoId: null, rev: 0 })
  })

  it('escolher um alvo grava targetId, é estrutural e sai do modo', () => {
    store().loadFlow(sampleFlow())
    store().startGotoPick('G')
    store().chooseGotoTarget('W')
    expect(findStep(store().flow!, 'G')?.config.targetId).toBe('W')
    expect(store()).toMatchObject({ pickingGotoId: null, rev: 1, saveMode: 'structural' })
    expect(store().past).toHaveLength(1)
  })

  it('remover o alvo depois limpa o targetId (sem goto órfão)', () => {
    store().loadFlow(sampleFlow())
    store().startGotoPick('G')
    store().chooseGotoTarget('W')
    store().removeStep('W')
    expect(findStep(store().flow!, 'G')?.config.targetId).toBeNull()
  })
})

// ─── ST-06 ─────────────────────────────────────────────────────────────────────

describe('ST-06 undo: seleção e limite de 50', () => {
  it('sem histórico: no-op', () => {
    const f = sampleFlow()
    store().loadFlow(f)
    store().undo()
    expect(store().flow).toBe(f)
    expect(store().rev).toBe(0)
  })

  it('mantém o gatilho selecionado e passos que ainda existem; fecha picker e modo goto', () => {
    store().loadFlow(sampleFlow())
    store().renameFlow('x')
    store().select(TRIGGER_SELECTION_ID)
    store().openPicker({ kind: 'root' }, { x: 0, y: 0 })
    store().startGotoPick('G')
    store().undo()
    expect(store()).toMatchObject({ selectedStepId: TRIGGER_SELECTION_ID, picker: null, pickingGotoId: null, rev: 2, saveMode: 'structural' })

    store().renameFlow('y')
    store().select('A')
    store().undo()
    expect(store().selectedStepId).toBe('A')
  })

  it('desfazer a inserção do passo selecionado limpa a seleção', () => {
    store().loadFlow(sampleFlow())
    store().openPicker({ kind: 'after', stepId: 'A' }, { x: 0, y: 0 })
    store().insertStep('tag')
    const created = store().selectedStepId!
    expect(findStep(store().flow!, created)).not.toBeNull()
    store().undo()
    expect(store().selectedStepId).toBeNull()
    expect(findStep(store().flow!, created)).toBeNull()
  })

  it('histórico máximo de 50: depois de 60 renomeações, 50 undos voltam ao nome da 10ª', () => {
    store().loadFlow(sampleFlow())
    for (let i = 1; i <= 60; i += 1) {
      store().renameFlow(`n${i}`)
      expect(store().past.length).toBeLessThanOrEqual(50)
    }
    expect(store().past).toHaveLength(50)
    for (let i = 0; i < 50; i += 1) store().undo()
    expect(store().flow!.name).toBe('n10')
    expect(store().past).toHaveLength(0)
    const rev = store().rev
    store().undo()
    expect(store().flow!.name).toBe('n10')
    expect(store().rev).toBe(rev)
  })
})

// ─── Mutações que não mudam nada ───────────────────────────────────────────────

describe('mutações estruturais sem efeito', () => {
  // noop-structural-undo: removeStep/addBranchTo com id inexistente (ou num passo sem
  // branches) não empurram snapshot de undo nem save estrutural.
  it('removeStep de id inexistente não gera undo nem save', () => {
    store().loadFlow(sampleFlow())
    store().removeStep('nao-existe')
    expect(counters()).toEqual({ rev: 0, past: 0, saveMode: 'config' })
  })

  it('addBranchTo num passo sem branches não gera undo nem save', () => {
    store().loadFlow(sampleFlow())
    store().addBranchTo('A')
    expect(counters()).toEqual({ rev: 0, past: 0, saveMode: 'config' })
  })
})

describe('redo', () => {
  it('desfazer e refazer voltam ao mesmo estado; mutação nova limpa o redo', () => {
    store().loadFlow(sampleFlow())
    store().renameFlow('n1')
    store().renameFlow('n2')
    store().undo()
    expect(store().flow!.name).toBe('n1')
    store().redo()
    expect(store().flow!.name).toBe('n2')
    expect(store().saveMode).toBe('structural')
    store().undo()
    store().renameFlow('outro')
    expect(store().future).toEqual([])
    const rev = store().rev
    store().redo()
    expect(store().rev).toBe(rev)
    expect(store().flow!.name).toBe('outro')
  })
})
