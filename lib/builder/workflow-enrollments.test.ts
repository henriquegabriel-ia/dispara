// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Esperas duráveis — parte "persistência + passo Aguardar do executor".
 *
 * 1) lib/builder/workflow-enrollments.ts: persistDelayWait, claim (CAS), reaper,
 *    reschedule, backoff, complete/fail — direto contra o Supabase em memória
 *    (DISPARA_SCHEMA, com o índice único parcial ux_workflow_enrollments_active).
 * 2) Passo Aguardar / janela de horário no executor REAL (compileFlow real → executeWorkflow),
 *    com o mock da Graph API: pausa, ponto de continuação, retomada com snapshot.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import {
  backoffEnrollment,
  claimDueEnrollments,
  completeEnrollment,
  failEnrollment,
  MAX_ENROLLMENT_ATTEMPTS,
  persistDelayWait,
  reapStuckEnrollments,
  rescheduleEnrollment,
  type DelayWaitParams,
} from '@/lib/builder/workflow-enrollments'
import { executeWorkflow } from '@/lib/builder/workflow-executor.workflow'
import { createInMemorySupabase, DISPARA_SCHEMA, type InMemorySupabase, type Row } from '@/tests/helpers/in-memory-supabase'
import {
  chain,
  compile,
  createBarrier,
  freezeTime,
  makeFlow,
  resetWorkflowCaches,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_PHONES,
  triggers,
  TRIGGER_NODE_ID,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'
import type { WorkflowTimeWindow } from '@/lib/builder/workflow-settings'

const T = '2026-10-19T12:00:00.000Z' // segunda-feira
const iso = (ms: number) => new Date(Date.parse(T) + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function memDb(seed: Record<string, Row[]> = {}): InMemorySupabase {
  return createInMemorySupabase(seed, {}, { schema: DISPARA_SCHEMA })
}

const client = (db: InMemorySupabase) => db.client as never

function waitParams(overrides: Partial<DelayWaitParams> = {}): DelayWaitParams {
  return {
    workflowId: 'wf',
    versionId: 'v1',
    phone: TEST_PHONES.ana,
    runId: 'r1',
    resumeNodeIds: ['a', 'b'],
    resumeAt: iso(5 * MIN),
    variables: { nome: 'Ana' },
    resolvedNodeIds: [TRIGGER_NODE_ID, 'm1', 'wait'],
    outputs: { __trigger: { label: 'Gatilho', data: { message: 'oi' } } },
    ...overrides,
  }
}

function enrollment(overrides: Row = {}): Row {
  return {
    workflow_id: 'wf',
    version_id: 'v1',
    phone: TEST_PHONES.ana,
    status: 'waiting',
    wait_kind: 'delay',
    resume_at: iso(-MIN),
    ...overrides,
  }
}

// ─── 1. Persistência dos enrollments ───────────────────────────────────────────

describe('workflow-enrollments: persistDelayWait (pausa do Aguardar → linha durável)', () => {
  beforeEach(() => freezeTime(T))
  afterEach(() => vi.useRealTimers())

  it('ENR-01: insere um enrollment novo com o payload completo do ponto de continuação', async () => {
    const db = memDb()
    await persistDelayWait(client(db), waitParams())

    expect(db.count('workflow_enrollments')).toBe(1)
    expect(db.rows('workflow_enrollments')[0]).toMatchObject({
      workflow_id: 'wf',
      version_id: 'v1',
      phone: TEST_PHONES.ana,
      contact_id: null,
      status: 'waiting',
      wait_kind: 'delay',
      current_node_id: 'a',
      resume_node_ids: ['a', 'b'],
      resume_at: iso(5 * MIN),
      run_id: 'r1',
      variables: { nome: 'Ana' },
      resolved_nodes: [TRIGGER_NODE_ID, 'm1', 'wait'],
      outputs: { __trigger: { label: 'Gatilho', data: { message: 'oi' } } },
      attempts: 0,
      locked_at: null,
      locked_by: null,
      created_at: T,
      updated_at: T,
    })
  })

  it('ENR-02: atualiza a espera existente do mesmo contato/fluxo, sem duplicar', async () => {
    const db = memDb({ workflow_enrollments: [enrollment({ id: 'e1', run_id: 'r-velho', resume_node_ids: ['x'], created_at: iso(-HOUR) })] })
    await persistDelayWait(client(db), waitParams({ runId: 'r-novo', resumeAt: iso(10 * MIN), resumeNodeIds: ['n2'] }))

    expect(db.count('workflow_enrollments')).toBe(1)
    expect(db.row('workflow_enrollments', { id: 'e1' })).toMatchObject({
      status: 'waiting',
      run_id: 'r-novo',
      resume_at: iso(10 * MIN),
      resume_node_ids: ['n2'],
      current_node_id: 'n2',
      variables: { nome: 'Ana' },
      created_at: iso(-HOUR), // a linha original é preservada (UPDATE, não INSERT)
    })
  })

  it('ENR-03: enrollment antigo completed/cancelled/failed não bloqueia — cria um novo e não toca nos antigos', async () => {
    const db = memDb({
      workflow_enrollments: [
        enrollment({ id: 'old-c', status: 'completed' }),
        enrollment({ id: 'old-x', status: 'cancelled' }),
        enrollment({ id: 'old-f', status: 'failed', last_error: 'boom' }),
      ],
    })
    await persistDelayWait(client(db), waitParams())

    expect(db.count('workflow_enrollments')).toBe(4)
    expect(db.count('workflow_enrollments', { status: 'waiting' })).toBe(1)
    expect(db.row('workflow_enrollments', { id: 'old-c' })?.status).toBe('completed')
    expect(db.row('workflow_enrollments', { id: 'old-x' })?.status).toBe('cancelled')
    expect(db.row('workflow_enrollments', { id: 'old-f' })).toMatchObject({ status: 'failed', last_error: 'boom' })
  })

  it('ENR-04: não pisa num enrollment "active" (dreno em voo): a linha fica intacta e nada novo entra (o 23505 é engolido)', async () => {
    const db = memDb({ workflow_enrollments: [enrollment({ id: 'e-active', status: 'active', locked_by: 'w1', locked_at: T, attempts: 2 })] })
    await expect(persistDelayWait(client(db), waitParams())).resolves.toBeUndefined()

    expect(db.count('workflow_enrollments')).toBe(1)
    expect(db.row('workflow_enrollments', { id: 'e-active' })).toMatchObject({ status: 'active', locked_by: 'w1', attempts: 2 })
    // O INSERT bateu no índice único parcial e o fallback (UPDATE só em 'waiting') não achou nada.
    const ops = db.ops.filter((o) => o.table === 'workflow_enrollments').map((o) => o.op)
    expect(ops).toEqual(['select', 'insert', 'update'])
  })

  it('ENR-04b: erro genérico no INSERT (ex.: rede) também é engolido — a pausa some sem sinal para quem chamou', async () => {
    const db = memDb()
    db.failNext('workflow_enrollments', 'fetch failed', { op: 'insert', code: '08006' })
    await expect(persistDelayWait(client(db), waitParams())).resolves.toBeUndefined()
    expect(db.count('workflow_enrollments')).toBe(0)
  })

  it('ENR-04c: duas pausas concorrentes do mesmo contato viram 1 enrollment (23505 tratado pelo fallback)', async () => {
    const db = memDb()
    const barrier = createBarrier(2)
    const off = db.onBefore(() => barrier.wait(), { table: 'workflow_enrollments', op: 'insert' })
    await Promise.all([
      persistDelayWait(client(db), waitParams({ runId: 'rA', resumeAt: iso(5 * MIN) })),
      persistDelayWait(client(db), waitParams({ runId: 'rB', resumeAt: iso(7 * MIN) })),
    ])
    off()
    expect(db.count('workflow_enrollments')).toBe(1)
    const row = db.rows('workflow_enrollments')[0]
    expect(row.status).toBe('waiting')
    expect(['rA', 'rB']).toContain(row.run_id)
  })
})

describe('workflow-enrollments: claimDueEnrollments (CAS waiting → active)', () => {
  beforeEach(() => freezeTime(T))
  afterEach(() => vi.useRealTimers())

  it('ENR-05: pega só os "waiting" vencidos, do mais antigo para o mais novo, respeitando o limite', async () => {
    const due = Array.from({ length: 30 }, (_, i) =>
      enrollment({ id: `due-${String(i).padStart(2, '0')}`, phone: `+55119000000${String(i).padStart(2, '0')}`, resume_at: iso(-(30 - i) * MIN) })
    )
    const db = memDb({
      workflow_enrollments: [
        ...due.reverse(), // ordem física diferente da ordem de resume_at
        enrollment({ id: 'future', phone: '+5511900000100', resume_at: iso(1) }),
        enrollment({ id: 'no-date', phone: '+5511900000101', resume_at: null }),
        enrollment({ id: 'active', phone: '+5511900000102', status: 'active', resume_at: iso(-HOUR) }),
        enrollment({ id: 'completed', phone: '+5511900000103', status: 'completed', resume_at: iso(-HOUR) }),
        enrollment({ id: 'cancelled', phone: '+5511900000104', status: 'cancelled', resume_at: iso(-HOUR) }),
        enrollment({ id: 'failed', phone: '+5511900000105', status: 'failed', resume_at: iso(-HOUR) }),
      ],
    })

    const claimed = await claimDueEnrollments(client(db), 'w1', 25)

    expect(claimed.map((r) => r.id)).toEqual(Array.from({ length: 25 }, (_, i) => `due-${String(i).padStart(2, '0')}`))
    for (const r of claimed) {
      expect(r).toMatchObject({ status: 'active', locked_by: 'w1', attempts: 1 })
      expect(db.row('workflow_enrollments', { id: r.id })).toMatchObject({ status: 'active', locked_by: 'w1', locked_at: T, attempts: 1 })
    }
    // os 5 vencidos que não couberam continuam na fila para o próximo tick
    expect(db.count('workflow_enrollments', (r) => String(r.id).startsWith('due-') && r.status === 'waiting')).toBe(5)
    for (const id of ['future', 'no-date']) expect(db.row('workflow_enrollments', { id })?.status).toBe('waiting')
    for (const id of ['active', 'completed', 'cancelled', 'failed']) expect(db.row('workflow_enrollments', { id })?.status).toBe(id)
  })

  it('ENR-05b: resume_at exatamente igual a "agora" entra (lte); 1 ms depois não', async () => {
    const db = memDb({
      workflow_enrollments: [
        enrollment({ id: 'now', phone: '+5511900000001', resume_at: T }),
        enrollment({ id: 'later', phone: '+5511900000002', resume_at: iso(1) }),
      ],
    })
    expect((await claimDueEnrollments(client(db), 'w1')).map((r) => r.id)).toEqual(['now'])
  })

  it('ENR-05c: attempts acumula sobre o valor anterior (e null conta como 0)', async () => {
    const db = memDb({
      workflow_enrollments: [
        enrollment({ id: 'a3', phone: '+5511900000001', attempts: 3 }),
      ],
    })
    const [row] = await claimDueEnrollments(client(db), 'w1')
    expect(row.attempts).toBe(4)
  })

  it('ENR-06: dois claims simultâneos nunca pegam o mesmo enrollment', async () => {
    const db = memDb({
      workflow_enrollments: Array.from({ length: 5 }, (_, i) =>
        enrollment({ id: `e${i}`, phone: `+551190000000${i}`, resume_at: iso(-(5 - i) * MIN) })
      ),
    })
    // segura o 1º UPDATE até os dois SELECTs terem acontecido (os dois enxergam os 5 candidatos)
    const barrier = createBarrier(2)
    const off = db.onBefore(() => barrier.wait(), { table: 'workflow_enrollments', op: 'update' })
    const [a, b] = await Promise.all([claimDueEnrollments(client(db), 'A'), claimDueEnrollments(client(db), 'B')])
    off()

    const idsA = a.map((r) => r.id)
    const idsB = b.map((r) => r.id)
    expect(new Set([...idsA, ...idsB]).size).toBe(5)
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([])
    for (const row of db.rows('workflow_enrollments')) {
      expect(row.status).toBe('active')
      expect(row.attempts).toBe(1)
      expect(row.locked_by).toBe(idsA.includes(String(row.id)) ? 'A' : 'B')
    }
  })
})

describe('workflow-enrollments: reaper, reschedule, backoff, complete e fail', () => {
  beforeEach(() => freezeTime(T))
  afterEach(() => vi.useRealTimers())

  it('ENR-07: reaper devolve à fila só os "active" com lock vencido (> 20 min), preservando attempts e resume_at', async () => {
    const db = memDb({
      workflow_enrollments: [
        enrollment({ id: 'dead', phone: '+5511900000001', status: 'active', locked_at: iso(-25 * MIN), locked_by: 'w-morto', attempts: 3, resume_at: iso(-30 * MIN) }),
        enrollment({ id: 'edge-21', phone: '+5511900000002', status: 'active', locked_at: iso(-21 * MIN), locked_by: 'w-x', attempts: 1 }),
        enrollment({ id: 'alive-19', phone: '+5511900000003', status: 'active', locked_at: iso(-19 * MIN), locked_by: 'w-vivo', attempts: 1 }),
        enrollment({ id: 'alive-5', phone: '+5511900000004', status: 'active', locked_at: iso(-5 * MIN), locked_by: 'w-vivo', attempts: 1 }),
        enrollment({ id: 'waiting', phone: '+5511900000005', status: 'waiting' }),
        enrollment({ id: 'done', phone: '+5511900000006', status: 'completed', locked_at: iso(-HOUR) }),
      ],
    })

    expect(await reapStuckEnrollments(client(db))).toBe(2)
    expect(db.row('workflow_enrollments', { id: 'dead' })).toMatchObject({
      status: 'waiting',
      locked_at: null,
      locked_by: null,
      attempts: 3,
      resume_at: iso(-30 * MIN),
    })
    expect(db.row('workflow_enrollments', { id: 'edge-21' })?.status).toBe('waiting')
    expect(db.row('workflow_enrollments', { id: 'alive-19' })).toMatchObject({ status: 'active', locked_by: 'w-vivo' })
    expect(db.row('workflow_enrollments', { id: 'alive-5' })).toMatchObject({ status: 'active', locked_by: 'w-vivo' })
    expect(db.row('workflow_enrollments', { id: 'done' })?.status).toBe('completed')
  })

  it('ENR-08: rescheduleEnrollment volta para waiting com o novo ponto de continuação e libera o lock', async () => {
    const db = memDb({
      workflow_enrollments: [enrollment({ id: 'e1', status: 'active', locked_at: T, locked_by: 'w1', attempts: 1, run_id: 'r1' })],
    })
    await rescheduleEnrollment(client(db), 'e1', {
      resumeNodeIds: ['n3', 'n4'],
      resumeAt: iso(HOUR),
      variables: { reply_ask: 'Sim' },
      resolvedNodeIds: ['__trigger', 'm1', 'w1', 'm2', 'w2'],
      outputs: { m2: { label: 'm2', data: { ok: true } } },
    })
    expect(db.row('workflow_enrollments', { id: 'e1' })).toMatchObject({
      status: 'waiting',
      wait_kind: 'delay',
      current_node_id: 'n3',
      resume_node_ids: ['n3', 'n4'],
      resume_at: iso(HOUR),
      variables: { reply_ask: 'Sim' },
      resolved_nodes: ['__trigger', 'm1', 'w1', 'm2', 'w2'],
      outputs: { m2: { label: 'm2', data: { ok: true } } },
      locked_at: null,
      locked_by: null,
      run_id: 'r1', // caracterização: o reschedule não troca o run_id
      updated_at: T,
    })
  })

  it('ENR-09: backoff usa 2^n minutos com teto de 30 e trunca o erro em 500 caracteres', async () => {
    const attempts = [1, 2, 3, 4, 5, 6]
    const db = memDb({
      workflow_enrollments: attempts.map((a) =>
        enrollment({ id: `e${a}`, phone: `+551190000000${a}`, status: 'active', locked_at: T, locked_by: 'w1', attempts: a })
      ),
    })
    const longError = new Error('x'.repeat(800))
    for (const a of attempts) await backoffEnrollment(client(db), `e${a}`, a, longError)

    const expectedMinutes = [2, 4, 8, 16, 30, 30]
    attempts.forEach((a, i) => {
      const row = db.row('workflow_enrollments', { id: `e${a}` })!
      expect(row).toMatchObject({ status: 'waiting', locked_at: null, locked_by: null, attempts: a })
      expect(row.resume_at).toBe(iso(expectedMinutes[i] * MIN))
      expect(String(row.last_error)).toHaveLength(500)
      expect(String(row.last_error).startsWith('Error: xxx')).toBe(true)
    })
  })

  it('ENR-10: complete/fail definem o status final e limpam o lock (fail trunca o erro)', async () => {
    const db = memDb({
      workflow_enrollments: [
        enrollment({ id: 'ok', phone: '+5511900000001', status: 'active', locked_at: T, locked_by: 'w1' }),
        enrollment({ id: 'ko', phone: '+5511900000002', status: 'active', locked_at: T, locked_by: 'w1' }),
      ],
    })
    await completeEnrollment(client(db), 'ok')
    await failEnrollment(client(db), 'ko', 'y'.repeat(600))
    expect(db.row('workflow_enrollments', { id: 'ok' })).toMatchObject({ status: 'completed', locked_at: null, locked_by: null })
    const ko = db.row('workflow_enrollments', { id: 'ko' })!
    expect(ko).toMatchObject({ status: 'failed', locked_at: null, locked_by: null })
    expect(String(ko.last_error)).toBe('y'.repeat(500))
  })

  // BUG(attempts-acumulam): todo claim faz attempts+1 — inclusive nas retomadas que deram
  // certo — e nem rescheduleEnrollment nem persistDelayWait zeram o contador. Como o
  // anti-poison do dreno falha quando attempts > MAX_ENROLLMENT_ATTEMPTS (5), um fluxo
  // saudável com vários "Aguardar" seguidos esgota o orçamento de tentativas e é marcado
  // 'failed' ("Máximo de tentativas") sem nenhum erro real. O contador deveria medir só
  // falhas consecutivas da MESMA retomada. Ver DRN-12 em lib/cron/workflow-enrollments.test.ts.
  it.fails('ENR-11: BUG(attempts-acumulam) — retomada bem-sucedida reagendada não deveria consumir tentativas', async () => {
    const db = memDb({ workflow_enrollments: [enrollment({ id: 'e1' })] })
    for (let i = 0; i < MAX_ENROLLMENT_ATTEMPTS + 1; i += 1) {
      const [row] = await claimDueEnrollments(client(db), `w${i}`)
      expect(row).toBeDefined()
      // retomada OK: caiu no próximo Aguardar
      await rescheduleEnrollment(client(db), row.id, {
        resumeNodeIds: [`n${i}`],
        resumeAt: iso(-1),
        variables: {},
        resolvedNodeIds: [],
        outputs: {},
      })
    }
    // Correto: depois de N esperas bem-sucedidas, o próximo claim continua longe do teto.
    const [next] = await claimDueEnrollments(client(db), 'w-final')
    expect(next.attempts).toBeLessThanOrEqual(1)
  })
})

// ─── 2. Passo Aguardar no executor real ────────────────────────────────────────

type ExecOut = {
  success: boolean
  paused?: boolean
  wait?: { kind: string; resumeNodeIds: string[]; resumeInMs: number }
  variables?: Record<string, unknown>
  resolvedNodeIds?: string[]
  outputs?: Record<string, { label?: string; data?: unknown }>
  results: Record<string, { success: boolean; error?: string; data?: unknown }>
  conversationId?: string
}

const WINDOW_9_18_UTC: WorkflowTimeWindow = { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'UTC' }

describe('executor: passo Aguardar (pausa durável e ponto de continuação)', () => {
  let h: WorkflowTestContext
  beforeEach(async () => {
    h = setupWorkflowTest()
    await resetWorkflowCaches()
    freezeTime(T)
  })
  afterEach(() => teardownWorkflowTest())

  async function run(
    graph: { nodes: unknown[]; edges: unknown[] },
    opts: {
      message?: string
      from?: string
      startNodeIds?: string[]
      alreadyResolvedNodeIds?: string[]
      initialOutputs?: Record<string, unknown>
      initialVariables?: Record<string, unknown>
      executionId?: string
      workflowId?: string
      timeWindow?: WorkflowTimeWindow
      triggerInput?: Record<string, unknown>
    } = {}
  ): Promise<ExecOut> {
    const from = opts.from ?? TEST_PHONES.ana
    return (await executeWorkflow({
      nodes: graph.nodes as never,
      edges: graph.edges as never,
      triggerInput: opts.triggerInput ?? { from, to: from, ...(opts.message !== undefined ? { message: opts.message } : {}) },
      executionId: opts.executionId,
      workflowId: opts.workflowId,
      startNodeIds: opts.startNodeIds,
      alreadyResolvedNodeIds: opts.alreadyResolvedNodeIds,
      initialOutputs: opts.initialOutputs,
      initialVariables: opts.initialVariables,
      workflowSettings: opts.timeWindow ? { timeWindow: opts.timeWindow } : undefined,
    })) as unknown as ExecOut
  }

  const msg1Wait2Msg2 = (value: number, unit: 'minutes' | 'hours' | 'days') =>
    compile(
      makeFlow({
        root: chain(
          steps.whatsapp({ id: 'm1', message: 'Primeira' }),
          steps.wait({ id: 'w', value, unit }),
          steps.whatsapp({ id: 'm2', message: 'Segunda' })
        ),
      })
    )

  it('EXW-01: Aguardar 2 minutos pausa, envia só o passo anterior e devolve o ponto de continuação', async () => {
    const res = await run(msg1Wait2Msg2(2, 'minutes'), { message: 'oi' })

    expect(res.paused).toBe(true)
    expect(res.wait).toEqual({ kind: 'delay', resumeNodeIds: ['m2'], resumeInMs: 2 * MIN })
    expect(res.resolvedNodeIds).toEqual(expect.arrayContaining([TRIGGER_NODE_ID, 'm1', 'w']))
    expect(res.resolvedNodeIds).not.toContain('m2')
    expect(h.meta.texts()).toEqual(['Primeira'])
    expect(h.meta.sent[0].to).toBe(TEST_PHONES.ana)
    expect((res.outputs?.__trigger?.data as Record<string, unknown>)?.message).toBe('oi')
    expect(res.results.w).toEqual({ success: true, data: { delayMs: 2 * MIN } })
  })

  it.each([
    [3, 'hours' as const, 3 * HOUR],
    [1, 'days' as const, DAY],
    [24, 'days' as const, 24 * DAY],
  ])('EXW-02: Aguardar %s %s gera resumeInMs exato e não executa o passo seguinte', async (value, unit, expected) => {
    const res = await run(msg1Wait2Msg2(value, unit), { message: 'oi' })
    expect(res.wait?.resumeInMs).toBe(expected)
    expect(h.meta.texts()).toEqual(['Primeira'])
  })

  it('EXW-03: Aguardar terminal (último passo ou antes do END) não pausa e o fluxo completa', async () => {
    for (const tail of [[], [steps.end({ id: 'fim' })]]) {
      const graph = compile(makeFlow({ root: chain(steps.whatsapp({ id: 'm1', message: 'Só esta' }), steps.wait({ id: 'w', value: 5 }), ...tail) }))
      const res = await run(graph, { message: 'oi' })
      expect(res.paused).toBeUndefined()
      expect(res.success).toBe(true)
      expect(res.results.w.success).toBe(true)
    }
    expect(h.meta.texts()).toEqual(['Só esta', 'Só esta'])
  })

  it.each([['abc'], [-5], [undefined]])('EXW-04: delayMs inválido (%s) num grafo cru vira pausa de 0 ms (caracterização)', async (delayMs) => {
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { type: 'trigger', label: 'T', config: { triggerType: 'None' } } },
        { id: 'd', type: 'action', position: { x: 0, y: 1 }, data: { type: 'action', label: 'D', config: { actionType: 'Delay', ...(delayMs === undefined ? {} : { delayMs }) } } },
        { id: 's', type: 'action', position: { x: 0, y: 2 }, data: { type: 'action', label: 'S', config: { actionType: 'Set Variable', variableKey: 'k', value: 'v' } } },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 's' },
      ],
    }
    const res = await run(graph)
    expect(res.paused).toBe(true)
    expect(res.wait).toEqual({ kind: 'delay', resumeNodeIds: ['s'], resumeInMs: 0 })
  })

  it('EXW-05: Aguardar antes de uma Condição retoma por TODAS as cabeças da condição (multi-head)', async () => {
    const graph = compile(
      makeFlow({
        root: chain(
          steps.wait({ id: 'w', value: 1 }),
          steps.condition({
            id: 'c',
            branches: [{ label: 'Vendas', value: 'vendas', child: steps.whatsapp({ id: 'wa', message: 'Falar com vendas' }) }],
            none: steps.whatsapp({ id: 'wb', message: 'Outro assunto' }),
          })
        ),
      })
    )
    const res = await run(graph, { message: 'quero vendas' })
    expect(res.wait?.resumeNodeIds).toEqual(['c__cond_0', 'c__cond_none'])
    expect(h.meta.sent).toHaveLength(0)
  })

  it('EXW-06: retomada com o snapshot de outputs roteia a Condição pela mensagem do gatilho (sem snapshot, nenhuma branch roda)', async () => {
    const graph = compile(
      makeFlow({
        root: chain(
          steps.wait({ id: 'w', value: 1 }),
          steps.condition({
            id: 'c',
            branches: [{ label: 'Vendas', value: 'vendas', child: steps.whatsapp({ id: 'wa', message: 'Falar com vendas' }) }],
            none: steps.whatsapp({ id: 'wb', message: 'Outro assunto' }),
          })
        ),
      })
    )
    const first = await run(graph, { message: 'quero vendas' })
    expect(first.paused).toBe(true)

    // Como o dreno faz: triggerInput só com o telefone; a mensagem vem do snapshot.
    const resumed = await run(graph, {
      triggerInput: { from: TEST_PHONES.ana, to: TEST_PHONES.ana },
      startNodeIds: first.wait!.resumeNodeIds,
      alreadyResolvedNodeIds: first.resolvedNodeIds,
      initialOutputs: first.outputs as Record<string, unknown>,
      initialVariables: first.variables,
    })
    expect(resumed.paused).toBeUndefined()
    expect(h.meta.texts()).toEqual(['Falar com vendas'])
    expect(resumed.results.wb).toEqual({ success: false, error: 'skipped' })

    // Contraste (por que o snapshot é obrigatório): sem initialOutputs a referência
    // {{@__trigger:...}} fica crua, a expressão é inválida, a condição E o None viram
    // false e o fluxo termina em silêncio sem enviar nada.
    h.meta.reset()
    const blind = await run(graph, {
      triggerInput: { from: TEST_PHONES.ana, to: TEST_PHONES.ana },
      startNodeIds: first.wait!.resumeNodeIds,
      alreadyResolvedNodeIds: first.resolvedNodeIds,
    })
    expect(h.meta.sent).toHaveLength(0)
    expect(blind.results.wa).toEqual({ success: false, error: 'skipped' })
    expect(blind.results.wb).toEqual({ success: false, error: 'skipped' })
  })

  it('EXW-07: janela de horário fechada pausa o envio NO PRÓPRIO nó; ações internas (tag) rodam antes', async () => {
    freezeTime('2026-10-19T20:00:00.000Z') // segunda 20:00 UTC, janela 09–18 seg–sex
    const graph = compile(
      makeFlow({
        root: chain(
          steps.tag({ id: 't', tags: ['noturno'] }),
          steps.whatsapp({ id: 'm1', message: 'Bom dia!' }),
          steps.whatsapp({ id: 'm2', message: 'Segunda mensagem' })
        ),
      })
    )
    const res = await run(graph, { message: 'oi', timeWindow: WINDOW_9_18_UTC })

    expect(res.paused).toBe(true)
    expect(res.wait).toEqual({ kind: 'delay', resumeNodeIds: ['m1'], resumeInMs: 13 * HOUR }) // terça 09:00
    expect(res.resolvedNodeIds).toEqual(expect.arrayContaining([TRIGGER_NODE_ID, 't']))
    expect(res.resolvedNodeIds).not.toContain('m1')
    expect(h.db.row('contacts', { phone: TEST_PHONES.ana })?.tags).toEqual(['lead', 'noturno'])
    expect(h.meta.sent).toHaveLength(0)
  })

  it('EXW-07b: janela aberta não interfere; dia inativo (sábado) empurra para segunda 09:00', async () => {
    freezeTime('2026-10-19T10:30:00.000Z')
    const graph = compile(makeFlow({ root: steps.whatsapp({ id: 'm1', message: 'Dentro da janela' }) }))
    const open = await run(graph, { message: 'oi', timeWindow: WINDOW_9_18_UTC })
    expect(open.paused).toBeUndefined()
    expect(h.meta.texts()).toEqual(['Dentro da janela'])

    freezeTime('2026-10-24T10:00:00.000Z') // sábado
    const weekend = await run(graph, { message: 'oi', timeWindow: WINDOW_9_18_UTC })
    expect(weekend.wait).toEqual({ kind: 'delay', resumeNodeIds: ['m1'], resumeInMs: (2 * 24 - 1) * HOUR })
  })

  it('EXW-07c: janela respeita o fuso (America/Sao_Paulo): 07:00 local espera 2h até 09:00 local', async () => {
    freezeTime('2026-10-19T10:00:00.000Z') // 07:00 em São Paulo (UTC-3)
    const graph = compile(makeFlow({ root: steps.whatsapp({ id: 'm1', message: 'Oi' }) }))
    const res = await run(graph, { message: 'oi', timeWindow: { ...WINDOW_9_18_UTC, timezone: 'America/Sao_Paulo' } })
    expect(res.wait?.resumeInMs).toBe(2 * HOUR)
  })

  it('EXW-08: janela fechada também segura a Pergunta: nada é enviado e nenhuma conversa é aberta', async () => {
    freezeTime('2026-10-19T20:00:00.000Z')
    const graph = compile(makeFlow({ root: steps.interactive({ id: 'ask', message: 'Quer a proposta?', buttons: ['Sim', 'Não'] }) }))
    const res = await run(graph, { message: 'oi', timeWindow: WINDOW_9_18_UTC, workflowId: 'wf', executionId: 'r1' })
    expect(res.wait).toEqual({ kind: 'delay', resumeNodeIds: ['ask'], resumeInMs: 13 * HOUR })
    expect(h.db.count('workflow_conversations')).toBe(0)
    expect(h.meta.sent).toHaveLength(0)
  })

  it('EXW-09: retomada no nó da janela, já dentro do horário, envia exatamente uma vez e continua', async () => {
    freezeTime('2026-10-19T20:00:00.000Z')
    const graph = compile(
      makeFlow({ root: chain(steps.whatsapp({ id: 'm1', message: 'Bom dia!' }), steps.whatsapp({ id: 'm2', message: 'Tudo certo?' })) })
    )
    const first = await run(graph, { message: 'oi', timeWindow: WINDOW_9_18_UTC })
    freezeTime('2026-10-20T09:00:00.000Z')
    const resumed = await run(graph, {
      triggerInput: { from: TEST_PHONES.ana, to: TEST_PHONES.ana },
      startNodeIds: first.wait!.resumeNodeIds,
      alreadyResolvedNodeIds: first.resolvedNodeIds,
      initialOutputs: first.outputs as Record<string, unknown>,
      timeWindow: WINDOW_9_18_UTC,
    })
    expect(resumed.paused).toBeUndefined()
    expect(resumed.success).toBe(true)
    expect(h.meta.texts()).toEqual(['Bom dia!', 'Tudo certo?'])
  })

  it('EXW-09b: anti-double-send — nós já resolvidos no snapshot nunca são reexecutados na retomada', async () => {
    const graph = msg1Wait2Msg2(2, 'minutes')
    const first = await run(graph, { message: 'oi' })
    // retomada "errada" a partir do início (ex.: resume_node_ids corrompido) — m1 já está resolvido
    await run(graph, {
      triggerInput: { from: TEST_PHONES.ana, to: TEST_PHONES.ana },
      startNodeIds: ['m1', 'm2'],
      alreadyResolvedNodeIds: first.resolvedNodeIds,
      initialOutputs: first.outputs as Record<string, unknown>,
    })
    expect(h.meta.texts()).toEqual(['Primeira', 'Segunda'])
  })

  it('EXW-10: Aguardar dentro de branch não tomada é pulado (sem pausa) e o fluxo segue pelo None', async () => {
    const graph = compile(
      makeFlow({
        root: steps.condition({
          id: 'c',
          branches: [
            {
              label: 'X',
              value: 'x',
              child: chain(steps.wait({ id: 'wx', value: 5 }), steps.whatsapp({ id: 'mx', message: 'ramo X' })),
            },
          ],
          none: steps.whatsapp({ id: 'mn', message: 'ramo None' }),
        }),
      })
    )
    const res = await run(graph, { message: 'y' })
    expect(res.paused).toBeUndefined()
    expect(res.results.wx).toEqual({ success: false, error: 'skipped' })
    expect(res.results.mx).toEqual({ success: false, error: 'skipped' })
    expect(h.meta.texts()).toEqual(['ramo None'])
  })

  // BUG(run-skipped-error): skipNode grava results[n] = { success: false, error: 'skipped' } e
  // o executor calcula finalSuccess = every(r => r.success). Toda Perguntar/Condição com
  // passos na branch NÃO escolhida termina com success=false e o run é gravado 'error'
  // (error: 'skipped') — as rotas respondem 'failed' e as métricas contam como falha, mesmo
  // o contato tendo seguido o caminho certo. (lib/builder/workflow-executor.workflow.ts:1282)
  it.fails('EXW-11: BUG(run-skipped-error) — escolher uma branch não deveria fazer o run terminar como erro', async () => {
    const graph = compile(
      makeFlow({
        root: steps.interactive({
          id: 'ask',
          message: 'Quer a proposta?',
          buttons: [
            { label: 'Sim', child: steps.whatsapp({ id: 'wSim', message: 'Enviando!' }) },
            { label: 'Não', child: steps.whatsapp({ id: 'wNao', message: 'Tudo bem.' }) },
          ],
        }),
      })
    )
    h.db.insert('workflow_runs', { id: 'r-resume', workflow_id: 'wf', status: 'running', trigger_type: 'Resume' })
    const res = await run(graph, {
      triggerInput: { from: TEST_PHONES.ana, to: TEST_PHONES.ana, message: 'Sim' },
      startNodeIds: ['ask__var'],
      initialVariables: { reply_ask: 'Sim' },
      executionId: 'r-resume',
      workflowId: 'wf',
    })
    expect(h.meta.texts()).toEqual(['Enviando!']) // o caminho certo foi seguido…
    expect(res.success).toBe(true) // …então a execução deveria ser sucesso
    expect(h.db.row('workflow_runs', { id: 'r-resume' })?.status).toBe('success')
  })
})
