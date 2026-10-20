import { describe, expect, it } from 'vitest'
import { addBranch, addStep, createEmptyFlow, findStep, setGotoTarget, updateStep } from '@/lib/builder/flow/operations'
import { lintFlow, validateTree } from '@/lib/builder/flow/tree-validate'
import type { Branch, Flow, Step, StepType } from '@/lib/builder/flow/types'

/**
 * validateTree é a barreira do PATCH (app/api/builder/workflows/[id]/route.ts) e o
 * passo 1 do compileFlow: tudo que a tela produz precisa passar, e o que for
 * estruturalmente quebrado precisa ser recusado com mensagem legível (pt-BR).
 */

const flowOf = (root: Step | null, extra: Partial<Flow> = {}): Flow => ({
  schemaVersion: 1,
  id: 'wf',
  name: 'Fluxo',
  trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
  root,
  ...extra,
})

const step = (id: string, type: StepType, extra: Partial<Step> = {}): Step => ({
  id,
  type,
  name: extra.name ?? `${type} ${id}`,
  config: extra.config ?? {},
  next: extra.next ?? null,
  ...(extra.branches ? { branches: extra.branches } : {}),
})

const br = (id: string, label: string, extra: Partial<Branch> = {}): Branch => ({ id, label, child: null, ...extra })

/** Simula o store.insertStep (o Perguntar v1 perde as branches locked). */
function insertLikeStore(flow: Flow, type: StepType, slot: Parameters<typeof addStep>[1]['slot']): { flow: Flow; id: string } {
  const res = addStep(flow, { type, slot })
  let next = res.flow
  if (type === 'interactive') {
    const created = findStep(next, res.stepId)!
    next = updateStep(next, res.stepId, { branches: created.branches!.filter((b) => !b.locked) })
  }
  return { flow: next, id: res.stepId }
}

// ─── TV-01 ─────────────────────────────────────────────────────────────────────

describe('TV-01 árvores produzidas pela UI são válidas', () => {
  const enabled: StepType[] = ['whatsapp', 'interactive', 'condition', 'wait', 'end', 'tag', 'tag_remove', 'pipeline']

  it.each(enabled)('passo "%s" inserido como faz o store', (type) => {
    const { flow } = insertLikeStore(createEmptyFlow(), type, { kind: 'root' })
    expect(validateTree(flow)).toEqual({ valid: true, issues: [] })
  })

  it('Perguntar v1 (só botões, sem locked) é válido', () => {
    const { flow, id } = insertLikeStore(createEmptyFlow(), 'interactive', { kind: 'root' })
    expect(findStep(flow, id)!.branches!.map((b) => b.label)).toEqual(['Botão 1'])
    expect(validateTree(flow).valid).toBe(true)
  })

  it('combinação aninhada (condição dentro de pergunta, tags, pipeline, wait, END) com split/goto', () => {
    let f = createEmptyFlow({ keywords: ['oi'] })
    const a = insertLikeStore(f, 'whatsapp', { kind: 'root' })
    f = a.flow
    const q = insertLikeStore(f, 'interactive', { kind: 'after', stepId: a.id })
    f = q.flow
    const c = insertLikeStore(f, 'condition', { kind: 'branch', stepId: q.id, branchIndex: 0 })
    f = addBranch(c.flow, c.id)
    for (const [i, type] of (['tag', 'tag_remove', 'pipeline'] as StepType[]).entries()) {
      f = insertLikeStore(f, type, { kind: 'branch', stepId: c.id, branchIndex: i }).flow
    }
    const w = insertLikeStore(f, 'wait', { kind: 'after', stepId: c.id })
    f = insertLikeStore(w.flow, 'end', { kind: 'after', stepId: w.id }).flow
    const s = insertLikeStore(f, 'split', { kind: 'after', stepId: a.id })
    f = addBranch(s.flow, s.id)
    const g = insertLikeStore(f, 'goto', { kind: 'branch', stepId: s.id, branchIndex: 2 })
    f = setGotoTarget(g.flow, g.id, a.id)
    expect(validateTree(f)).toEqual({ valid: true, issues: [] })
  })
})

// ─── TV-02 ─────────────────────────────────────────────────────────────────────

describe('TV-02 ids, schemaVersion e branches', () => {
  it('schemaVersion diferente de 1', () => {
    const res = validateTree({ ...flowOf(null), schemaVersion: 2 as unknown as 1 })
    expect(res.valid).toBe(false)
    expect(res.issues).toEqual([{ stepId: null, message: 'schemaVersion não suportada: 2 (esperado 1).' }])
  })

  it('passo sem id', () => {
    const res = validateTree(flowOf(step('', 'whatsapp', { config: { message: 'x' } })))
    expect(res.issues).toEqual([{ stepId: null, message: 'Step do tipo "whatsapp" sem id.' }])
  })

  it('ids de passo duplicados', () => {
    const res = validateTree(flowOf(step('a', 'whatsapp', { next: step('a', 'tag') })))
    expect(res.issues).toEqual([{ stepId: 'a', message: 'Id de step duplicado: "a".' }])
  })

  it('ids de branch duplicados no mesmo passo e entre passos', () => {
    const same = validateTree(
      flowOf(step('c', 'condition', { branches: [br('b', 'B1', { value: 'x' }), br('b', 'B2', { value: 'y' }), br('n', 'None', { locked: true })] }))
    )
    expect(same.issues).toEqual([{ stepId: 'c', message: 'Id de branch duplicado: "b".' }])

    const across = validateTree(
      flowOf(
        step('c1', 'condition', {
          branches: [br('x', 'B1', { value: 'a' }), br('n1', 'None', { locked: true })],
          next: step('c2', 'condition', { branches: [br('x', 'B1', { value: 'b' }), br('n2', 'None', { locked: true })] }),
        })
      )
    )
    expect(across.issues).toEqual([{ stepId: 'c2', message: 'Id de branch duplicado: "x".' }])
  })

  it('branch sem id', () => {
    const res = validateTree(flowOf(step('c', 'condition', { name: 'Cond', branches: [br('', 'B1', { value: 'x' }), br('n', 'None', { locked: true })] })))
    expect(res.issues).toEqual([{ stepId: 'c', message: 'Branch "B1" sem id em "Cond".' }])
  })

  it('condição só com None e Perguntar só com locked', () => {
    expect(validateTree(flowOf(step('c', 'condition', { name: 'C', branches: [br('n', 'None', { locked: true })] }))).issues).toEqual([
      { stepId: 'c', message: 'Condição "C" precisa de pelo menos 1 branch além do "None".' },
    ])
    expect(
      validateTree(flowOf(step('q', 'interactive', { name: 'Q', branches: [br('nd', 'Not Delivered', { locked: true }), br('to', 'Timeout', { locked: true })] })))
        .issues
    ).toEqual([{ stepId: 'q', message: 'Pergunta "Q" precisa de pelo menos 1 botão.' }])
  })

  it('tipos ramificados sem branches e não ramificados com branches', () => {
    for (const type of ['condition', 'split', 'interactive'] as StepType[]) {
      expect(validateTree(flowOf(step('s', type, { name: 'S' }))).issues).toEqual([
        { stepId: 's', message: `Step "S" (${type}) precisa ter branches.` },
      ])
      expect(validateTree(flowOf(step('s', type, { name: 'S', branches: [] }))).issues).toEqual([
        { stepId: 's', message: `Step "S" (${type}) precisa ter branches.` },
      ])
    }
    expect(validateTree(flowOf(step('w', 'whatsapp', { name: 'W', branches: [br('b', 'x')] }))).issues).toEqual([
      { stepId: 'w', message: 'Step "W" (whatsapp) não deveria ter branches.' },
    ])
    // branches vazio em passo não ramificado é tolerado
    expect(validateTree(flowOf(step('w', 'whatsapp', { branches: [] }))).valid).toBe(true)
  })

  it('acumula vários problemas na mesma árvore', () => {
    const res = validateTree({
      ...flowOf(step('a', 'end', { next: step('a', 'whatsapp', { branches: [br('b', 'x')] }) })),
      schemaVersion: 3 as unknown as 1,
    })
    expect(res.valid).toBe(false)
    expect(res.issues.length).toBeGreaterThanOrEqual(4)
  })
})

// ─── TV-03 ─────────────────────────────────────────────────────────────────────

describe('TV-03 split, goto e terminais', () => {
  const split = (...percents: Array<number | undefined>) =>
    flowOf(step('s', 'split', { name: 'Split', branches: percents.map((p, i) => br(`p${i}`, `Path ${i}`, p === undefined ? {} : { percent: p })) }))

  it('split precisa somar 100', () => {
    expect(validateTree(split(50, 40)).issues).toEqual([{ stepId: 's', message: 'Split "Split": percentuais somam 90% (esperado 100%).' }])
    expect(validateTree(split(34, 33, 33)).valid).toBe(true)
    expect(validateTree(split(50, 50, 0)).valid).toBe(true)
    expect(validateTree(split(60, 50)).issues[0].message).toContain('110%')
  })

  it('percent ausente conta como 0', () => {
    expect(validateTree(split(50, undefined)).issues).toEqual([{ stepId: 's', message: 'Split "Split": percentuais somam 50% (esperado 100%).' }])
  })

  it('goto: alvo inexistente é inválido; null/ausente é válido; alvo existente é válido', () => {
    const g = (targetId: unknown) => step('g', 'goto', { name: 'Ir', config: { targetId } })
    expect(validateTree(flowOf(step('a', 'whatsapp', { next: g('zzz') }))).issues).toEqual([
      { stepId: 'g', message: 'Go To "Ir" aponta para step inexistente: "zzz".' },
    ])
    expect(validateTree(flowOf(step('a', 'whatsapp', { next: g(null) }))).valid).toBe(true)
    expect(validateTree(flowOf(step('a', 'whatsapp', { next: g(undefined) }))).valid).toBe(true)
    expect(validateTree(flowOf(step('a', 'whatsapp', { next: g('a') }))).valid).toBe(true)
  })

  it('terminais não podem ter continuação', () => {
    expect(validateTree(flowOf(step('e', 'end', { name: 'END', next: step('x', 'tag') }))).issues).toEqual([
      { stepId: 'e', message: 'Step terminal "END" (end) não pode ter continuação.' },
    ])
    expect(validateTree(flowOf(step('g', 'goto', { name: 'Ir', config: { targetId: null }, next: step('x', 'tag') }))).issues).toEqual([
      { stepId: 'g', message: 'Step terminal "Ir" (goto) não pode ter continuação.' },
    ])
  })

  it('o gatilho não é validado aqui: keywords vazias passam (o webhook ignora o fluxo)', () => {
    // Caracterização: validateTree não olha o trigger. Ver HK (publish) para o efeito na tela.
    expect(validateTree(flowOf(step('a', 'whatsapp', { config: { message: 'x' } }), { trigger: { type: 'keywords', label: '', keywords: [] } })).valid).toBe(true)
  })
})

// ─── TV-04 ─────────────────────────────────────────────────────────────────────

describe('TV-04 árvore malformada', () => {
  // tree-validate-malformed: uma tree malformada no corpo do PATCH devolve issues
  // (400 "Invalid tree") em vez de lançar TypeError (500).
  it('goto sem config: devolve issue em vez de lançar', () => {
    const malformed = flowOf({ id: 'g', type: 'goto', name: 'x', next: null } as unknown as Step)
    expect(() => validateTree(malformed)).not.toThrow()
  })

  it('branches que não são array: devolve issue em vez de lançar', () => {
    const malformed = flowOf({ id: 'c', type: 'condition', name: 'x', config: {}, next: null, branches: 5 } as unknown as Step)
    expect(() => validateTree(malformed)).not.toThrow()
    expect(validateTree(malformed).valid).toBe(false)
  })

  it('config que não é objeto e next primitivo não lançam', () => {
    const malformed = flowOf({ id: 'w', type: 'whatsapp', name: 'x', config: 'oi', next: 7 } as unknown as Step)
    expect(() => validateTree(malformed)).not.toThrow()
    expect(validateTree(malformed).valid).toBe(false)
  })
})

// ─── TV-05 ─────────────────────────────────────────────────────────────────────

describe('TV-05 lintFlow (pendências que bloqueiam o publish)', () => {
  const ok = step('a', 'whatsapp', { config: { message: 'x' } })

  it('fluxo completo: sem pendências', () => {
    expect(lintFlow(flowOf(ok))).toEqual([])
  })

  it('gatilho de palavra-chave sem palavras (ou só espaços) é pendência do gatilho', () => {
    const issues = lintFlow(flowOf(ok, { trigger: { type: 'keywords', label: '', keywords: ['  ', ''] } }))
    expect(issues).toEqual([{ stepId: null, message: expect.stringContaining('sem nenhuma palavra') }])
    expect(lintFlow(flowOf(ok, { trigger: { type: 'none', label: '', keywords: [] } }))).toEqual([])
  })

  it('condição com valor vazio aponta a branch', () => {
    const cond = step('c', 'condition', {
      name: 'Cond',
      branches: [br('b1', 'Sim', { operator: 'contains', value: ' ' }), br('n', 'None', { locked: true })],
    })
    expect(lintFlow(flowOf(cond))).toEqual([{ stepId: 'c', message: 'Condição "Cond": a branch "Sim" está sem valor.' }])
  })

  it('template com variável sem valor e cabeçalho de mídia sem URL', () => {
    const w = step('w', 'whatsapp', {
      name: 'Boas-vindas',
      config: { template: 'boas_vindas', templateBodyParams: ['{{var.nome}}', ''], templateHeaderMediaType: 'image' },
    })
    expect(lintFlow(flowOf(w)).map((i) => i.message)).toEqual([
      'Passo WhatsApp "Boas-vindas": preencha a variável do template.',
      'Passo WhatsApp "Boas-vindas": o template tem mídia no cabeçalho — informe a URL.',
    ])
  })

  it('pergunta sem texto ou com botões repetidos', () => {
    const q = step('q', 'interactive', { name: 'Q', config: { message: '' }, branches: [br('b1', 'Sim'), br('b2', 'sim')] })
    expect(lintFlow(flowOf(q)).map((i) => i.message)).toEqual(['Pergunta "Q" está sem texto.', 'Pergunta "Q" tem botões com o mesmo texto.'])
  })
})
