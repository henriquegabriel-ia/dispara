// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Esperas duráveis — parte "relógio": dreno dos enrollments (lib/cron/workflow-enrollments.ts)
 * e o endpoint-relógio /api/cron/tick.
 *
 * Ponta a ponta com o código REAL: compileFlow → PATCH/publish (rotas reais) → POST
 * /execute (Bearer CRON_SECRET) → enrollment → drainWorkflowEnrollments (relógio
 * congelado com freezeTime/advanceTime) → executor → Graph API mockada.
 * executeWorkflow é um vi.fn que delega para o executor real; só alguns testes de
 * contrato (DRN-03/04/05/07) trocam a implementação.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
  handleDeliveryStatus: vi.fn(async () => {}),
}))
vi.mock('@/lib/builder/workflow-executor.workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/builder/workflow-executor.workflow')>()
  return { ...actual, executeWorkflow: vi.fn(actual.executeWorkflow) }
})
vi.mock('@/lib/cron/workflow-enrollments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cron/workflow-enrollments')>()
  return { ...actual, drainWorkflowEnrollments: vi.fn(actual.drainWorkflowEnrollments) }
})
vi.mock('@/lib/cron/scheduled-campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/scheduled-campaigns')>()),
  drainScheduledCampaigns: vi.fn(async () => ({ stub: 'scheduled' })),
}))
vi.mock('@/lib/cron/campaign-drain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/campaign-drain')>()),
  drainStuckCampaigns: vi.fn(async () => ({ stub: 'stuck' })),
}))
vi.mock('@/lib/whatsapp-status-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp-status-events')>()),
  reconcilePendingStatusEvents: vi.fn(async () => ({ stub: 'reconcile' })),
}))

import { executeWorkflow } from '@/lib/builder/workflow-executor.workflow'
import { drainWorkflowEnrollments } from '@/lib/cron/workflow-enrollments'
import { drainScheduledCampaigns } from '@/lib/cron/scheduled-campaigns'
import { drainStuckCampaigns } from '@/lib/cron/campaign-drain'
import { reconcilePendingStatusEvents } from '@/lib/whatsapp-status-events'
import { MAX_ENROLLMENT_ATTEMPTS } from '@/lib/builder/workflow-enrollments'
import { parseWorkflowSettings, type WorkflowSettings, type WorkflowTimeWindow } from '@/lib/builder/workflow-settings'
import { setActiveSupabase, type Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  createBarrier,
  freezeTime,
  jsonRequest,
  makeFlow,
  metaInbound,
  metaWebhookBody,
  publishFlow,
  resetWorkflowCaches,
  routes,
  SEED_IDS,
  seedPublishedFlow,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_ADMIN_KEY,
  TEST_API_KEY,
  TEST_CRON_SECRET,
  TEST_PHONES,
  triggers,
  TRIGGER_NODE_ID,
  waId,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'
import type { Flow, Step } from '@/lib/builder/flow/types'

type RealExecute = typeof executeWorkflow
type RealDrain = typeof drainWorkflowEnrollments
let realExecute: RealExecute
let realDrain: RealDrain
const execMock = vi.mocked(executeWorkflow)

beforeAll(async () => {
  realExecute = (await vi.importActual<typeof import('@/lib/builder/workflow-executor.workflow')>('@/lib/builder/workflow-executor.workflow'))
    .executeWorkflow
  realDrain = (await vi.importActual<typeof import('@/lib/cron/workflow-enrollments')>('@/lib/cron/workflow-enrollments'))
    .drainWorkflowEnrollments
})

const T = '2026-10-19T12:00:00.000Z' // segunda-feira
const MIN = 60_000
const HOUR = 60 * MIN
const at = (ms: number) => new Date(Date.parse(T) + ms).toISOString()
const WINDOW_9_18_UTC: WorkflowTimeWindow = { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'UTC' }

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
  freezeTime(T)
  execMock.mockReset()
  execMock.mockImplementation(realExecute)
  vi.mocked(drainWorkflowEnrollments).mockReset()
  vi.mocked(drainWorkflowEnrollments).mockImplementation(realDrain)
  for (const fn of [drainScheduledCampaigns, drainStuckCampaigns, reconcilePendingStatusEvents]) vi.mocked(fn).mockClear()
})
afterEach(() => teardownWorkflowTest())

// ─── helpers ───────────────────────────────────────────────────────────────────

/** Mensagem que chega da Meta (só dígitos), como o webhook repassa ao /execute. */
async function startViaExecute(workflowId: string, phone: string = TEST_PHONES.ana, message = 'oi') {
  return routes.execute(workflowId, { input: { from: waId(phone), to: waId(phone), message } })
}

function enrollmentOf(workflowId: string, phone: string = TEST_PHONES.ana): Row | undefined {
  const rows = h.db.rows('workflow_enrollments').filter((r) => r.workflow_id === workflowId && r.phone === phone)
  return rows.at(-1)
}

function runsOf(workflowId: string, trigger?: string): Row[] {
  return h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId && (trigger === undefined || r.trigger_type === trigger))
}

function waitChain(n: number, prefix = 'm'): Step[] {
  const out: Step[] = [steps.whatsapp({ id: `${prefix}0`, message: `${prefix}0` })]
  for (let i = 1; i <= n; i += 1) {
    out.push(steps.wait({ id: `w${i}`, value: 1, unit: 'minutes' }))
    out.push(steps.whatsapp({ id: `${prefix}${i}`, message: `${prefix}${i}` }))
  }
  return out
}

function flowOf(id: string, root: Step | null, trigger = triggers.keywords(['oi'])): Flow {
  return makeFlow({ id, trigger, root })
}

/** Enrollment semeado direto (sem passar pelo /execute) — para os testes de contrato do dreno. */
function seedEnrollment(o: Row): Row {
  const [row] = h.db.insert('workflow_enrollments', {
    version_id: 'v-any',
    status: 'waiting',
    wait_kind: 'delay',
    resume_at: at(-MIN),
    ...o,
  })
  return row
}

const okResult = () => ({ success: true, results: { n: { success: true } }, outputs: {} })

// ─── Dreno: contrato ───────────────────────────────────────────────────────────

describe('drainWorkflowEnrollments: o que o relógio retoma (e o que nunca retoma)', () => {
  it('DRN-01: sem Supabase devolve zeros; sem vencidos não lê nada nem executa', async () => {
    setActiveSupabase(null)
    expect(await drainWorkflowEnrollments()).toEqual({ reaped: 0, claimed: 0, completed: 0, paused: 0, failed: 0 })
    setActiveSupabase(h.db)

    seedEnrollment({ workflow_id: 'wf', phone: TEST_PHONES.ana, resume_at: at(5 * MIN), resume_node_ids: ['x'] })
    const opsBefore = h.db.ops.length
    expect(await drainWorkflowEnrollments()).toEqual({ reaped: 0, claimed: 0, completed: 0, paused: 0, failed: 0 })
    expect(execMock).not.toHaveBeenCalled()
    const ops = h.db.ops.slice(opsBefore)
    expect(ops.some((o) => o.table === 'settings')).toBe(false) // getCompanyId nem é chamado
    expect(h.db.count('workflow_runs')).toBe(0)
    expect(enrollmentOf('wf')?.status).toBe('waiting')
  })

  it('DRN-02: retoma só o vencido; o futuro entra quando vence; cancelado/concluído/falho nunca voltam', async () => {
    const { workflowId } = await seedPublishedFlow(
      h.db,
      flowOf('wf-drn2', chain(steps.whatsapp({ id: 'm1', message: 'Primeira' }), steps.wait({ id: 'w', value: 10 }), steps.whatsapp({ id: 'm2', message: 'Segunda' })))
    )
    const base = { workflow_id: workflowId, resume_node_ids: ['m2'], current_node_id: 'm2', resolved_nodes: [TRIGGER_NODE_ID, 'm1', 'w'] }
    seedEnrollment({ ...base, id: 'due', phone: TEST_PHONES.ana, resume_at: at(-MIN) })
    seedEnrollment({ ...base, id: 'future', phone: TEST_PHONES.bruno, resume_at: at(2 * MIN) })
    seedEnrollment({ ...base, id: 'cancelled', phone: TEST_PHONES.carla, status: 'cancelled', resume_at: at(-HOUR) })
    seedEnrollment({ ...base, id: 'completed', phone: '+5531977770004', status: 'completed', resume_at: at(-HOUR) })
    seedEnrollment({ ...base, id: 'failed', phone: '+5531977770005', status: 'failed', resume_at: at(-HOUR) })

    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1 })
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1 })
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })

    expect(execMock).toHaveBeenCalledTimes(2)
    expect(h.meta.sent.map((m) => [m.to, m.text])).toEqual([
      [TEST_PHONES.ana, 'Segunda'],
      [TEST_PHONES.bruno, 'Segunda'],
    ])
    expect(h.db.row('workflow_enrollments', { id: 'due' })?.status).toBe('completed')
    expect(h.db.row('workflow_enrollments', { id: 'future' })?.status).toBe('completed')
    for (const id of ['cancelled', 'completed', 'failed']) {
      expect(h.db.row('workflow_enrollments', { id })).toMatchObject({ status: id, attempts: 0 })
    }
  })

  it('DRN-03: passa ao executor o ponto de continuação exato (multi-head, fallback current_node_id, snapshot e settings)', async () => {
    const settings: WorkflowSettings = { timeWindow: WINDOW_9_18_UTC, stopOnResponse: true }
    const { workflowId, versionId } = await seedPublishedFlow(h.db, flowOf('wf-drn3', steps.whatsapp({ id: 'm1', message: 'x' })), { settings })
    seedEnrollment({
      id: 'multi',
      workflow_id: workflowId,
      phone: TEST_PHONES.ana,
      resume_at: at(-2 * MIN),
      resume_node_ids: ['x', 'y'],
      current_node_id: 'x',
      variables: { reply_ask: 'Sim' },
      resolved_nodes: ['__trigger', 'w'],
      outputs: { __trigger: { label: 'Gatilho', data: { message: 'oi' } } },
    })
    seedEnrollment({ id: 'legacy', workflow_id: workflowId, phone: TEST_PHONES.bruno, resume_at: at(-MIN), resume_node_ids: [], current_node_id: 'z' })
    execMock.mockImplementation(async () => okResult() as never)

    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 2, completed: 2 })

    const [first, second] = execMock.mock.calls.map((c) => c[0] as unknown as Record<string, unknown>)
    expect(first).toMatchObject({
      startNodeIds: ['x', 'y'],
      initialVariables: { reply_ask: 'Sim' },
      initialOutputs: { __trigger: { label: 'Gatilho', data: { message: 'oi' } } },
      alreadyResolvedNodeIds: ['__trigger', 'w'],
      triggerInput: { from: TEST_PHONES.ana, to: TEST_PHONES.ana },
      workflowId,
      workflowSettings: parseWorkflowSettings(settings),
    })
    expect(second).toMatchObject({ startNodeIds: ['z'], triggerInput: { from: TEST_PHONES.bruno, to: TEST_PHONES.bruno } })
    for (const call of [first, second]) {
      expect(h.db.row('workflow_runs', { id: call.executionId as string })).toMatchObject({
        workflow_id: workflowId,
        version_id: versionId,
        trigger_type: 'DelayResume',
      })
    }
    expect((first.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual([TRIGGER_NODE_ID, 'm1'])
  })

  it('DRN-04: o resultado do executor vira o estado certo do enrollment', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, flowOf('wf-drn4', steps.whatsapp({ id: 'm1', message: 'x' })))
    const mk = (id: string, phone: string, i: number) =>
      seedEnrollment({ id, workflow_id: workflowId, phone, resume_at: at(-(10 - i) * MIN), resume_node_ids: [id] })
    mk('done', '+5511900000001', 0)
    mk('again', '+5511900000002', 1)
    mk('asked', '+5511900000003', 2)
    mk('ghost', '+5511900000004', 3)
    execMock.mockImplementation((async (input: { startNodeIds?: string[] }) => {
      switch (input.startNodeIds?.[0]) {
        case 'done':
          return okResult()
        case 'again':
          return {
            success: true,
            paused: true,
            wait: { kind: 'delay', resumeNodeIds: ['n2'], resumeInMs: 60_000 },
            variables: { v: 1 },
            resolvedNodeIds: ['a', 'b'],
            outputs: { a: { data: 1 } },
            results: {},
          }
        case 'asked':
          return { success: true, paused: true, conversationId: 'conv-1', resumeNodeId: 'ask__var', results: { ask: { success: true } } }
        default:
          return { success: true, results: {}, outputs: {} }
      }
    }) as never)

    expect(await drainWorkflowEnrollments()).toEqual({ reaped: 0, claimed: 4, completed: 2, paused: 1, failed: 1 })
    expect(h.db.row('workflow_enrollments', { id: 'done' })).toMatchObject({ status: 'completed', locked_by: null })
    expect(h.db.row('workflow_enrollments', { id: 'again' })).toMatchObject({
      status: 'waiting',
      resume_at: at(60_000),
      resume_node_ids: ['n2'],
      current_node_id: 'n2',
      variables: { v: 1 },
      resolved_nodes: ['a', 'b'],
      outputs: { a: { data: 1 } },
      locked_at: null,
    })
    expect(h.db.row('workflow_enrollments', { id: 'asked' })?.status).toBe('completed')
    expect(h.db.row('workflow_enrollments', { id: 'ghost' })).toMatchObject({ status: 'failed' })
    expect(String(h.db.row('workflow_enrollments', { id: 'ghost' })?.last_error)).toMatch(/Nó de retomada ausente/)
  })

  it('DRN-05: exceção no meio → backoff (2^n min) e, no teto, falha definitiva; nada fica "active"', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, flowOf('wf-drn5', steps.whatsapp({ id: 'm1', message: 'x' })))
    seedEnrollment({ id: 'fresh', workflow_id: workflowId, phone: '+5511900000001', resume_node_ids: ['m1'], attempts: 0 })
    seedEnrollment({ id: 'tired', workflow_id: workflowId, phone: '+5511900000002', resume_node_ids: ['m1'], attempts: 4 })
    execMock.mockImplementation(async () => {
      throw new Error('Graph API timeout')
    })

    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 2, paused: 1, failed: 1 })
    expect(h.db.row('workflow_enrollments', { id: 'fresh' })).toMatchObject({
      status: 'waiting',
      attempts: 1,
      resume_at: at(2 * MIN),
      locked_at: null,
      locked_by: null,
      last_error: 'Error: Graph API timeout',
    })
    expect(h.db.row('workflow_enrollments', { id: 'tired' })).toMatchObject({ status: 'failed', attempts: 5, last_error: 'Error: Graph API timeout' })
    expect(h.db.count('workflow_enrollments', { status: 'active' })).toBe(0)

    // o backoff respeita o relógio: antes de 2 min nada; em 2 min tenta de novo (attempts 2 → +4 min)
    advanceTime(2 * MIN - 1)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    advanceTime(1)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, paused: 1 })
    expect(h.db.row('workflow_enrollments', { id: 'fresh' })).toMatchObject({ attempts: 2, resume_at: at(2 * MIN + 4 * MIN) })
  })

  it('DRN-06: anti-poison — excedeu as tentativas → falha sem executar nem reenviar', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, flowOf('wf-drn6', steps.whatsapp({ id: 'm1', message: 'x' })))
    seedEnrollment({ id: 'poison', workflow_id: workflowId, phone: TEST_PHONES.ana, resume_node_ids: ['m1'], attempts: MAX_ENROLLMENT_ATTEMPTS })

    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, failed: 1, completed: 0 })
    expect(execMock).not.toHaveBeenCalled()
    expect(h.meta.sent).toHaveLength(0)
    expect(h.db.row('workflow_enrollments', { id: 'poison' })).toMatchObject({
      status: 'failed',
      attempts: 6,
      last_error: 'Máximo de tentativas (6) excedido',
      locked_at: null,
    })
    expect(h.db.count('workflow_runs')).toBe(0)
  })

  it('DRN-07: dois drenos simultâneos retomam cada enrollment uma única vez', async () => {
    const { workflowId } = await seedPublishedFlow(
      h.db,
      flowOf('wf-drn7', chain(steps.whatsapp({ id: 'm1', message: 'Primeira' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'm2', message: 'Depois da espera' })))
    )
    const phones = ['+5511900000001', '+5511900000002', '+5511900000003']
    phones.forEach((phone, i) =>
      seedEnrollment({ workflow_id: workflowId, phone, resume_at: at(-(3 - i) * MIN), resume_node_ids: ['m2'], resolved_nodes: [TRIGGER_NODE_ID, 'm1', 'w'] })
    )
    // segura o 1º CAS (waiting→active) até os dois drenos terem lido os candidatos
    const barrier = createBarrier(2)
    const off = h.db.onBefore(async (ctx) => {
      if (ctx.patch?.status === 'active') await barrier.wait()
    }, { table: 'workflow_enrollments', op: 'update' })

    const [a, b] = await Promise.all([drainWorkflowEnrollments(), drainWorkflowEnrollments()])
    off()

    expect(a.claimed + b.claimed).toBe(3)
    expect(a.completed + b.completed).toBe(3)
    expect(execMock).toHaveBeenCalledTimes(3)
    expect(h.meta.sent.map((m) => m.to).sort()).toEqual([...phones].sort()) // 1 envio por contato, nunca 2
    expect(h.db.rows('workflow_enrollments').every((r) => r.status === 'completed' && r.attempts === 1)).toBe(true)
  })

  it('DRN-08: reaper e claim no mesmo tick retomam o enrollment de um worker morto', async () => {
    const { workflowId } = await seedPublishedFlow(
      h.db,
      flowOf('wf-drn8', chain(steps.whatsapp({ id: 'm1', message: 'Primeira' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'm2', message: 'Segunda' })))
    )
    seedEnrollment({
      id: 'orphan',
      workflow_id: workflowId,
      phone: TEST_PHONES.ana,
      status: 'active',
      locked_at: at(-25 * MIN),
      locked_by: 'worker-morto',
      attempts: 2,
      resume_at: at(-26 * MIN),
      resume_node_ids: ['m2'],
      resolved_nodes: [TRIGGER_NODE_ID, 'm1', 'w'],
    })
    expect(await drainWorkflowEnrollments()).toMatchObject({ reaped: 1, claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Segunda'])
    expect(h.db.row('workflow_enrollments', { id: 'orphan' })).toMatchObject({ status: 'completed', attempts: 3 })
  })

  it('DRN-08b: lock recente (worker vivo, < 20 min) não é roubado', async () => {
    seedEnrollment({ id: 'busy', workflow_id: 'wf', phone: TEST_PHONES.ana, status: 'active', locked_at: at(-5 * MIN), locked_by: 'vivo', resume_node_ids: ['m2'] })
    expect(await drainWorkflowEnrollments()).toMatchObject({ reaped: 0, claimed: 0 })
    expect(h.db.row('workflow_enrollments', { id: 'busy' })).toMatchObject({ status: 'active', locked_by: 'vivo' })
  })
})

// ─── Ponta a ponta: tela → execute → cron ──────────────────────────────────────

describe('esperas duráveis ponta a ponta (publicar → execute → dreno do cron)', () => {
  it('DRN-09: msg1 → Aguardar 2 horas → msg2: espera o tempo exato e envia msg2 uma única vez', async () => {
    const { workflowId, versionId } = await publishFlow(
      h.db,
      flowOf('wf-2h', chain(steps.whatsapp({ id: 'm1', message: 'Olá! Já volto.' }), steps.wait({ id: 'w', value: 2, unit: 'hours' }), steps.whatsapp({ id: 'm2', message: 'Voltei!' })))
    )

    const res = await startViaExecute(workflowId)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'waiting' })
    const runId = (res.body as { executionId: string }).executionId
    expect(h.meta.texts()).toEqual(['Olá! Já volto.'])
    expect(enrollmentOf(workflowId)).toMatchObject({
      status: 'waiting',
      wait_kind: 'delay',
      version_id: versionId,
      resume_at: at(2 * HOUR),
      resume_node_ids: ['m2'],
      run_id: runId,
      attempts: 0,
    })
    expect(h.db.row('workflow_runs', { id: runId })).toMatchObject({ status: 'waiting', finished_at: null })

    advanceTime(2 * HOUR - MIN) // 1h59m
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    expect(h.meta.sent).toHaveLength(1)

    advanceTime(MIN) // 2h
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1, paused: 0, failed: 0 })
    expect(h.meta.texts()).toEqual(['Olá! Já volto.', 'Voltei!']) // msg1 NÃO é reenviada
    expect(h.meta.sentTo(TEST_PHONES.ana)).toHaveLength(2)
    expect(enrollmentOf(workflowId)).toMatchObject({ status: 'completed', locked_at: null })
    expect(runsOf(workflowId, 'DelayResume')).toEqual([expect.objectContaining({ status: 'success', version_id: versionId })])

    advanceTime(HOUR)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 }) // concluído nunca volta
    expect(h.meta.sent).toHaveLength(2)
  })

  it('DRN-09b: o tick real do cron (GET/POST /api/cron/tick) faz a mesma retomada', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-tick', chain(steps.whatsapp({ id: 'm1', message: 'Antes' }), steps.wait({ id: 'w', value: 5 }), steps.whatsapp({ id: 'm2', message: 'Depois' })))
    )
    await startViaExecute(workflowId)
    advanceTime(5 * MIN)
    const tick = await import('@/app/api/cron/tick/route')
    const response = await tick.POST(jsonRequest('/api/cron/tick', {}, { headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }))
    const body = (await response.json()) as { ran: Array<{ task: string; result: unknown }> }
    expect(body.ran.find((r) => r.task === 'workflow-enrollments')?.result).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Antes', 'Depois'])
  })

  it('DRN-10: Aguardar que vence fora da janela de horário reagenda para a abertura e envia nela', async () => {
    freezeTime('2026-10-19T17:00:00.000Z') // segunda 17:00 UTC (janela aberta)
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-window', chain(steps.whatsapp({ id: 'm1', message: 'Recebido' }), steps.wait({ id: 'w', value: 2, unit: 'hours' }), steps.whatsapp({ id: 'm2', message: 'Retorno' }))),
      { settings: { timeWindow: WINDOW_9_18_UTC } }
    )
    await startViaExecute(workflowId)
    expect(h.meta.texts()).toEqual(['Recebido'])
    expect(enrollmentOf(workflowId)?.resume_at).toBe('2026-10-19T19:00:00.000Z')

    freezeTime('2026-10-19T19:00:00.000Z')
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, paused: 1 })
    expect(h.meta.sent).toHaveLength(1)
    expect(enrollmentOf(workflowId)).toMatchObject({
      status: 'waiting',
      resume_node_ids: ['m2'],
      resume_at: '2026-10-20T09:00:00.000Z',
      locked_at: null,
    })

    freezeTime('2026-10-20T08:59:00.000Z')
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    freezeTime('2026-10-20T09:00:00.000Z')
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Recebido', 'Retorno'])
  })

  it('DRN-11: Pergunta depois de um Aguardar conclui o enrollment e deixa a conversa pendente com o snapshot', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      flowOf(
        'wf-wait-ask',
        chain(
          steps.wait({ id: 'w', value: 1 }),
          steps.interactive({ id: 'ask', message: 'Podemos falar agora?', buttons: ['Sim', 'Não'] }),
          steps.whatsapp({ id: 'after', message: 'Obrigado!' })
        )
      )
    )
    await startViaExecute(workflowId)
    expect(h.meta.sent).toHaveLength(0)
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1 })

    expect(h.meta.texts()).toEqual(['Podemos falar agora?'])
    expect(enrollmentOf(workflowId)?.status).toBe('completed')
    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })
    expect(conv).toMatchObject({ status: 'waiting', phone: TEST_PHONES.ana, resume_node_id: 'ask__var', variable_key: 'reply_ask', variables: {} })
    expect(runsOf(workflowId, 'DelayResume')).toEqual([expect.objectContaining({ status: 'waiting' })])

    // a resposta retoma pela rota /resume e conclui o fluxo
    const resumed = await routes.resume(workflowId, { conversationId: conv!.id, input: { from: TEST_PHONES.ana, message: 'Sim' } })
    expect(resumed.body).toMatchObject({ status: expect.any(String) })
    expect(h.meta.texts()).toEqual(['Podemos falar agora?', 'Obrigado!'])
  })

  it('DRN-12a: fluxo com 5 Aguardar seguidos (via /execute) termina — limite do orçamento atual', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-5w', chain(...waitChain(5))))
    await startViaExecute(workflowId)
    for (let i = 0; i < 5; i += 1) {
      advanceTime(MIN)
      await drainWorkflowEnrollments()
    }
    expect(h.meta.texts()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
    expect(enrollmentOf(workflowId)).toMatchObject({ status: 'completed', attempts: 5 })
  })

  // BUG(attempts-acumulam): cada retomada bem-sucedida gasta 1 tentativa (claim faz
  // attempts+1 e reschedule não zera). No 6º Aguardar o claim chega com attempts 6 > 5 e o
  // anti-poison marca 'failed' "Máximo de tentativas (6) excedido" — a última mensagem nunca
  // sai, sem erro nenhum. lib/builder/workflow-enrollments.ts:145/177; lib/cron/workflow-enrollments.ts:66.
  it.fails('DRN-12: BUG(attempts-acumulam) — fluxo com 6 Aguardar seguidos (via /execute) deveria terminar', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-6w', chain(...waitChain(6))))
    await startViaExecute(workflowId)
    for (let i = 0; i < 6; i += 1) {
      advanceTime(MIN)
      await drainWorkflowEnrollments()
    }
    expect(h.meta.texts()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'])
    expect(enrollmentOf(workflowId)?.status).toBe('completed')
  })

  // BUG(attempts-acumulam), variante da inscrição manual: o /enroll já gasta 1 claim no
  // início, então bastam 5 Aguardar para o contato ser marcado 'failed' no meio do fluxo.
  it.fails('DRN-12b: BUG(attempts-acumulam) — "Sem gatilho" + inscrição manual com 5 Aguardar deveria terminar', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, flowOf('wf-enroll-5w', chain(...waitChain(5)), triggers.none()))
    expect((await routes.enroll(workflowId, { contactIds: [SEED_IDS.contacts.ana] })).body).toMatchObject({ enrolled: 1 })
    await drainWorkflowEnrollments() // envia m0 e pausa no 1º Aguardar
    for (let i = 0; i < 5; i += 1) {
      advanceTime(MIN)
      await drainWorkflowEnrollments()
    }
    expect(h.meta.texts()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
    expect(enrollmentOf(workflowId)?.status).toBe('completed')
  })

  // BUG(drain-run-running): o dreno insere o run 'DelayResume' como 'running'; quando a
  // retomada pausa de novo (outro Aguardar ou janela de horário) o executor retorna antes
  // do _workflowComplete e o ramo de reschedule do dreno não atualiza workflow_runs — o run
  // fica 'running' para sempre. A rota /execute trata o mesmo caso marcando 'waiting'.
  // lib/cron/workflow-enrollments.ts:91-126.
  it.fails('DRN-13: BUG(drain-run-running) — run de retomada que cai em outro Aguardar deveria ficar "waiting"', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-2w', chain(...waitChain(2))))
    await startViaExecute(workflowId)
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, paused: 1 })
    expect(runsOf(workflowId, 'DelayResume').map((r) => r.status)).toEqual(['waiting'])
  })

  // BUG(drain-run-running), variante da janela de horário: retomada fora da janela.
  it.fails('DRN-13b: BUG(drain-run-running) — run de retomada pausado pela janela de horário deveria ficar "waiting"', async () => {
    freezeTime('2026-10-19T17:59:00.000Z')
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-2w-window', chain(steps.wait({ id: 'w', value: 5 }), steps.whatsapp({ id: 'm', message: 'x' }))),
      { settings: { timeWindow: WINDOW_9_18_UTC } }
    )
    await startViaExecute(workflowId)
    advanceTime(5 * MIN) // 18:04 → janela fechada
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, paused: 1 })
    expect(runsOf(workflowId, 'DelayResume').map((r) => r.status)).toEqual(['waiting'])
  })

  // BUG(run-original-waiting): a retomada sempre cria um run NOVO e nunca fecha o run que
  // pausou (enrollment.run_id é gravado mas ninguém lê). Todo contato que passa por um
  // Aguardar deixa o 1º run em 'waiting' para sempre — o histórico mostra o fluxo "em espera"
  // mesmo depois de concluído. execute/route.ts:182-189 + lib/cron/workflow-enrollments.ts:91.
  it.fails('DRN-14: BUG(run-original-waiting) — o run que pausou deveria ser finalizado quando a espera termina', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-orig', chain(...waitChain(1))))
    const res = await startViaExecute(workflowId)
    const originalRunId = (res.body as { executionId: string }).executionId
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ completed: 1 })
    expect(h.meta.texts()).toEqual(['m0', 'm1'])
    expect(h.db.row('workflow_runs', { id: originalRunId })?.status).not.toBe('waiting')
  })

  // BUG(drain-run-on-throw): quando executeWorkflow lança (ex.: versão com grafo corrompido —
  // uma aresta null derruba o executor antes do try interno), o catch do dreno só faz
  // backoff: o run 'DelayResume' recém-inserido fica 'running' para sempre, um por tentativa.
  // lib/cron/workflow-enrollments.ts:102-111.
  it.fails('DRN-15: BUG(drain-run-on-throw) — exceção na retomada deveria fechar o run inserido', async () => {
    const { workflowId, versionId } = await publishFlow(h.db, flowOf('wf-throw', chain(...waitChain(1))))
    await startViaExecute(workflowId)
    const version = h.db.row('workflow_versions', { id: versionId })!
    h.db.update('workflow_versions', { id: versionId }, { edges: [...(version.edges as unknown[]), null] })
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, paused: 1 }) // backoff
    expect(enrollmentOf(workflowId)).toMatchObject({ status: 'waiting', attempts: 1 })
    const [run] = runsOf(workflowId, 'DelayResume')
    expect(run.status).not.toBe('running')
    expect(run.finished_at).not.toBeNull()
  })

  it('DRN-15a: exceção real do executor (grafo corrompido) cai no backoff sem reenviar nada (caracterização)', async () => {
    const { workflowId, versionId } = await publishFlow(h.db, flowOf('wf-throw-a', chain(...waitChain(1))))
    await startViaExecute(workflowId)
    const version = h.db.row('workflow_versions', { id: versionId })!
    h.db.update('workflow_versions', { id: versionId }, { edges: [...(version.edges as unknown[]), null] })
    advanceTime(MIN)
    await drainWorkflowEnrollments()
    expect(enrollmentOf(workflowId)).toMatchObject({ status: 'waiting', attempts: 1, resume_at: at(MIN + 2 * MIN) })
    expect(String(enrollmentOf(workflowId)?.last_error)).toMatch(/TypeError/)
    expect(h.meta.texts()).toEqual(['m0'])
  })

  // BUG(drain-ressuscita-workflow): workflow_enrollments não tem FK e o DELETE do workflow
  // não cancela os waits. No dreno, ensureWorkflowRecord não acha o workflow e CRIA um
  // rascunho "Fluxo inicial" com o mesmo id (grafo default Webhook → Send Message) — o
  // fluxo excluído reaparece na lista. lib/cron/workflow-enrollments.ts:77 + workflow-db.ts:162.
  it.fails('DRN-16: BUG(drain-ressuscita-workflow) — wait de workflow excluído não deveria recriar o workflow', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-del', chain(...waitChain(1))))
    await startViaExecute(workflowId)
    expect((await routes.deleteWorkflow(workflowId)).status).toBe(200)
    expect(h.db.row('workflows', { id: workflowId })).toBeUndefined()

    advanceTime(MIN)
    await drainWorkflowEnrollments()
    expect(['failed', 'cancelled']).toContain(enrollmentOf(workflowId)?.status)
    expect(h.db.row('workflows', { id: workflowId })).toBeUndefined()
  })

  it('DRN-16a: wait de workflow excluído não envia nada e falha visível (caracterização do que dá certo hoje)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-del-a', chain(...waitChain(1))))
    await startViaExecute(workflowId)
    await routes.deleteWorkflow(workflowId)
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, failed: 1 })
    expect(h.meta.texts()).toEqual(['m0'])
    expect(String(enrollmentOf(workflowId)?.last_error)).toMatch(/Nó de retomada ausente/)
  })

  // BUG(run-no-ausente-success): se o nó de retomada sumiu (republicação removeu o passo),
  // o executor não roda nada, results fica {} e [].every() === true — o run 'DelayResume'
  // é gravado 'success' enquanto o enrollment é marcado 'failed'. O painel de execuções
  // mostra sucesso para um contato que nunca recebeu o resto do fluxo.
  it.fails('DRN-16b: BUG(run-no-ausente-success) — retomada sem o nó de retomada não deveria gravar run "success"', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-repub', chain(steps.whatsapp({ id: 'm0', message: 'm0' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'old', message: 'antigo' })))
    )
    await startViaExecute(workflowId)
    // republica sem o passo "old" (o contato está esperando para retomar nele)
    await publishFlow(
      h.db,
      flowOf('wf-repub', chain(steps.whatsapp({ id: 'm0', message: 'm0' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'novo', message: 'novo' })))
    )
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ failed: 1 })
    expect(runsOf(workflowId, 'DelayResume')[0]?.status).not.toBe('success')
  })

  it('DRN-17: o dreno usa a versão ATIVA no momento da retomada, não o version_id do enrollment (caracterização)', async () => {
    const v1 = await publishFlow(
      h.db,
      flowOf('wf-ver', chain(steps.whatsapp({ id: 'm0', message: 'm0' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'm1', message: 'Versão 1' })))
    )
    await startViaExecute(v1.workflowId)
    expect(enrollmentOf(v1.workflowId)?.version_id).toBe(v1.versionId)
    const v2 = await publishFlow(
      h.db,
      flowOf('wf-ver', chain(steps.whatsapp({ id: 'm0', message: 'm0' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'm1', message: 'Versão 2' })))
    )
    expect(v2.versionId).not.toBe(v1.versionId)
    advanceTime(MIN)
    await drainWorkflowEnrollments()
    expect(h.meta.texts()).toEqual(['m0', 'Versão 2'])
  })

  // BUG(autosave-edita-publicada): depois do 1º publicar, active_version_id aponta para a
  // versão 'published' e todo PATCH (autosave do builder) faz UPDATE nessa MESMA linha
  // (lib/builder/workflow-db.ts:292-302). Quem está num Aguardar retoma com a edição que o
  // usuário ainda NÃO publicou (e disparos novos também a usam).
  it.fails('DRN-17b: BUG(autosave-edita-publicada) — wait retomado deveria usar a versão publicada, não o rascunho salvo', async () => {
    const flow = flowOf('wf-draft', chain(steps.whatsapp({ id: 'm0', message: 'm0' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'm1', message: 'Publicado' })))
    const { workflowId } = await publishFlow(h.db, flow)
    await startViaExecute(workflowId)

    // o usuário edita o texto no builder (autosave = PATCH) mas NÃO publica
    const draft = flowOf('wf-draft', chain(steps.whatsapp({ id: 'm0', message: 'm0' }), steps.wait({ id: 'w', value: 1 }), steps.whatsapp({ id: 'm1', message: 'Rascunho não publicado' })))
    const { compileFlow } = await import('@/lib/builder/flow/compile')
    const compiled = compileFlow(draft)
    expect((await routes.patchWorkflow(workflowId, { name: draft.name, tree: draft, nodes: compiled.nodes, edges: compiled.edges })).status).toBe(200)

    advanceTime(MIN)
    await drainWorkflowEnrollments()
    expect(h.meta.texts()).toEqual(['m0', 'Publicado'])
  })
})

// ─── Stop on Response × espera ─────────────────────────────────────────────────

describe('Stop on Response: resposta do contato encerra o Aguardar', () => {
  async function replyFromContact(text: string, phone: string = TEST_PHONES.ana) {
    return routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: phone, body: text })] }))
  }

  it('STOP-01: com stopOnResponse, a resposta cancela a espera e o cron nunca mais retoma', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-stop', chain(...waitChain(1))), { settings: { stopOnResponse: true } })
    await startViaExecute(workflowId)
    expect((await replyFromContact('ok, obrigado')).status).toBe(200)
    expect(enrollmentOf(workflowId)?.status).toBe('cancelled')

    advanceTime(10 * MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    expect(h.meta.texts()).toEqual(['m0'])
  })

  it('STOP-02: sem stopOnResponse, a resposta não mexe na espera (o fluxo continua)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-nostop', chain(...waitChain(1))))
    await startViaExecute(workflowId)
    await replyFromContact('ok, obrigado')
    expect(enrollmentOf(workflowId)?.status).toBe('waiting')
    advanceTime(MIN)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['m0', 'm1'])
  })

  // BUG(stop-on-response-corrida): o cancelamento faz CAS só em status 'waiting'. Se a resposta
  // chega enquanto o dreno está processando o enrollment ('active' — entre o envio de uma
  // mensagem e o próximo Aguardar), nada é cancelado e o reschedule devolve o enrollment para
  // 'waiting': o contato que pediu para parar continua recebendo o fluxo.
  // app/api/webhook/route.ts:569-596 × lib/builder/workflow-enrollments.ts:177.
  it.fails('STOP-03: BUG(stop-on-response-corrida) — resposta durante a retomada deveria impedir o próximo Aguardar', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-stop-race', chain(...waitChain(2))), { settings: { stopOnResponse: true } })
    await startViaExecute(workflowId)
    let fired = false
    const off = h.db.onBefore(async (ctx) => {
      if (!fired && ctx.patch?.status === 'waiting' && ctx.patch?.wait_kind === 'delay') {
        fired = true
        off()
        await replyFromContact('pare, por favor') // chega com o enrollment 'active'
      }
    }, { table: 'workflow_enrollments', op: 'update' })

    advanceTime(MIN)
    await drainWorkflowEnrollments() // envia m1 e reagenda o 2º Aguardar
    expect(fired).toBe(true)
    advanceTime(MIN)
    await drainWorkflowEnrollments()
    expect(h.meta.texts()).toEqual(['m0', 'm1']) // m2 não deveria sair
  })
})

// ─── /api/cron/tick ────────────────────────────────────────────────────────────

describe('/api/cron/tick: relógio que drena os waits', () => {
  async function callTick(method: 'GET' | 'POST', headers: Record<string, string> = {}) {
    const mod = await import('@/app/api/cron/tick/route')
    const request = jsonRequest('/api/cron/tick', method === 'POST' ? {} : undefined, { method, headers })
    const response = await (method === 'POST' ? mod.POST(request) : mod.GET(request))
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it('TICK-01a: sem credencial de cron (ou com API key de sessão) → 401 e nenhuma tarefa roda', async () => {
    for (const method of ['GET', 'POST'] as const) {
      for (const headers of [{}, { authorization: 'Bearer errado' }, { authorization: `Bearer ${TEST_API_KEY}` }, { 'x-vercel-cron': '1' }]) {
        expect((await callTick(method, headers)).status).toBe(401)
      }
    }
    expect(drainScheduledCampaigns).not.toHaveBeenCalled()
    expect(drainWorkflowEnrollments).not.toHaveBeenCalled()
  })

  it('TICK-01b: com CRON_SECRET/ADMIN_KEY roda as tarefas na ordem e devolve o resultado do dreno', async () => {
    const res = await callTick('POST', { authorization: `Bearer ${TEST_CRON_SECRET}` })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, tick: 'dispara-cron-tick', authSource: 'cron_secret' })
    expect((res.body.ran as Array<{ task: string }>).map((r) => r.task)).toEqual([
      'scheduled-campaigns',
      'workflow-enrollments',
      'stuck-campaigns',
      'reconcile-status-events',
    ])
    expect((res.body.ran as Array<{ result: unknown }>)[1].result).toEqual({ reaped: 0, claimed: 0, completed: 0, paused: 0, failed: 0 })
    expect(reconcilePendingStatusEvents).toHaveBeenCalledWith({ limit: 200 })

    const viaAdmin = await callTick('GET', { authorization: `Bearer ${TEST_ADMIN_KEY}` })
    expect(viaAdmin).toMatchObject({ status: 200, body: { authSource: 'admin_key' } })
  })

  it('TICK-01c: erro no dreno de waits aparece em ran[] e não derruba as outras tarefas', async () => {
    vi.mocked(drainWorkflowEnrollments).mockRejectedValueOnce(new Error('db caiu'))
    const res = await callTick('POST', { authorization: `Bearer ${TEST_CRON_SECRET}` })
    expect(res.status).toBe(200)
    const ran = res.body.ran as Array<{ task: string; result: unknown }>
    expect(ran[1]).toEqual({ task: 'workflow-enrollments', result: { error: 'db caiu' } })
    expect(ran.map((r) => r.task)).toEqual(['scheduled-campaigns', 'workflow-enrollments', 'stuck-campaigns', 'reconcile-status-events'])
    expect(drainStuckCampaigns).toHaveBeenCalledTimes(1)
  })

  it('TICK-01d: sem Supabase configurado responde 200 com ran vazio', async () => {
    setActiveSupabase(null)
    const res = await callTick('POST', { authorization: `Bearer ${TEST_CRON_SECRET}` })
    expect(res).toMatchObject({ status: 200, body: { ok: true, ran: [] } })
    expect(drainWorkflowEnrollments).not.toHaveBeenCalled()
  })

  it('TICK-01e: higiene remove dedupes de inbound com mais de 7 dias (os recentes seguem deduplicando)', async () => {
    h.db.insert('processed_inbound_messages', [
      { message_id: 'wamid.velho', created_at: at(-8 * 24 * HOUR) },
      { message_id: 'wamid.recente', created_at: at(-HOUR) },
    ])
    await callTick('POST', { authorization: `Bearer ${TEST_CRON_SECRET}` })
    expect(h.db.rows('processed_inbound_messages').map((r) => r.message_id)).toEqual(['wamid.recente'])
  })

  it('TICK-02: invariante do reaper — 20 min > 2 × maxDuration das rotas que processam waits', async () => {
    const [tick, execute, resume] = await Promise.all([
      import('@/app/api/cron/tick/route'),
      import('@/app/api/builder/workflow/[workflowId]/execute/route'),
      import('@/app/api/builder/workflow/[workflowId]/resume/route'),
    ])
    const reaperWindowMs = 20 * MIN
    for (const mod of [tick, execute, resume]) {
      expect(mod.maxDuration).toBe(300)
      expect(reaperWindowMs).toBeGreaterThan(2 * mod.maxDuration * 1000)
    }
    // e o reaper NÃO devolve um lock de 19 min (worker ainda pode estar vivo)
    seedEnrollment({ id: 'busy', workflow_id: 'wf', phone: TEST_PHONES.ana, status: 'active', locked_at: at(-19 * MIN) })
    expect(await drainWorkflowEnrollments()).toMatchObject({ reaped: 0 })
  })
})
