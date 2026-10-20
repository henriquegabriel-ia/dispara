// @vitest-environment node
/**
 * GET/DELETE /api/builder/workflows/[workflowId]/executions e POST .../run com estado real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  jsonRequest,
  makeFlow,
  readRoute,
  resetWorkflowCaches,
  routeParams,
  seedPublishedFlow,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

const flow = (id: string) => makeFlow({ id, trigger: triggers.keywords(['oi']), root: steps.whatsapp({ id: 'w', message: 'x' }) })

async function getExecutions(workflowId: string) {
  const mod = await import('@/app/api/builder/workflows/[workflowId]/executions/route')
  return readRoute<Row[]>(await mod.GET(jsonRequest(`/api/builder/workflows/${workflowId}/executions`), routeParams(workflowId)))
}
async function deleteExecutions(workflowId: string) {
  const mod = await import('@/app/api/builder/workflows/[workflowId]/executions/route')
  return readRoute<Row>(
    await mod.DELETE(jsonRequest(`/api/builder/workflows/${workflowId}/executions`, undefined, { method: 'DELETE' }), routeParams(workflowId))
  )
}

const minute = (i: number) => new Date(Date.UTC(2026, 9, 18, 12, i)).toISOString()

describe('executions', () => {
  it('R16 GET mapeia os campos, ordena por started_at desc, limita a 50 e filtra pelo workflow', async () => {
    await seedPublishedFlow(h.db, flow('wf'))
    await seedPublishedFlow(h.db, flow('outro'))
    for (let i = 0; i < 55; i += 1) {
      h.db.insert('workflow_runs', {
        id: `r${i}`,
        workflow_id: 'wf',
        status: i % 2 ? 'success' : 'failed',
        input: { i },
        output: { ok: i },
        error: i % 2 ? null : 'boom',
        started_at: minute(i),
        finished_at: minute(i + 1),
      })
    }
    h.db.insert('workflow_runs', { id: 'alheio', workflow_id: 'outro', status: 'success', started_at: minute(59) })
    const res = await getExecutions('wf')
    expect(res.body).toHaveLength(50)
    expect(res.body[0]).toEqual({
      id: 'r54',
      workflowId: 'wf',
      userId: null,
      status: 'failed',
      input: { i: 54 },
      output: { ok: 54 },
      error: 'boom',
      startedAt: minute(54),
      completedAt: minute(55),
      duration: null,
    })
    expect(res.body.map((r) => r.id)).not.toContain('alheio')
    expect(res.body[49].id).toBe('r5')
  })

  it('erro do banco no GET → []', async () => {
    h.db.failNext('workflow_runs', 'timeout', 'select')
    expect((await getExecutions('wf')).body).toEqual([])
  })

  it('R16 DELETE apaga só as runs do workflow (com os logs em cascata) e devolve deletedCount', async () => {
    await seedPublishedFlow(h.db, flow('wf'))
    await seedPublishedFlow(h.db, flow('outro'))
    h.db.insert('workflow_runs', { id: 'a', workflow_id: 'wf', status: 'success' })
    h.db.insert('workflow_runs', { id: 'b', workflow_id: 'wf', status: 'failed' })
    h.db.insert('workflow_runs', { id: 'c', workflow_id: 'outro', status: 'success' })
    h.db.insert('workflow_run_logs', { run_id: 'a', node_id: 'w', status: 'success' })
    const res = await deleteExecutions('wf')
    expect(res.body).toEqual({ success: true, deletedCount: 2 })
    expect(h.db.rows('workflow_runs').map((r) => r.id)).toEqual(['c'])
    expect(h.db.count('workflow_run_logs')).toBe(0)
    expect((await deleteExecutions('wf')).body).toEqual({ success: true, deletedCount: 0 })
  })

  it('DELETE com erro do banco → 500', async () => {
    h.db.failNext('workflow_runs', 'lock', 'delete')
    const res = await deleteExecutions('wf')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ success: false, error: 'lock' })
  })
})

describe('run (POST /api/builder/workflows/[id]/run)', () => {
  it('(fato) só insere uma run "queued" (Manual) que nenhum processo consome — infla as métricas', async () => {
    const seeded = await seedPublishedFlow(h.db, flow('wf'))
    const mod = await import('@/app/api/builder/workflows/[workflowId]/run/route')
    const res = await readRoute<Row>(await mod.POST(jsonRequest('/api/builder/workflows/wf/run', {}), routeParams('wf')))
    expect(res.body).toMatchObject({ status: 'queued', workflowId: 'wf', executionId: expect.stringMatching(/^exec_/) })
    expect(h.db.rows('workflow_runs')).toEqual([
      expect.objectContaining({ workflow_id: 'wf', version_id: seeded.versionId, status: 'queued', trigger_type: 'Manual' }),
    ])
    expect(h.meta.sent).toHaveLength(0)
  })

  it('grafo ativo sem trigger → 400 "Invalid workflow"', async () => {
    const seeded = await seedPublishedFlow(h.db, flow('wf'))
    h.db.update('workflow_versions', { id: seeded.versionId }, { nodes: [], edges: [] })
    const mod = await import('@/app/api/builder/workflows/[workflowId]/run/route')
    const res = await readRoute(await mod.POST(jsonRequest('/api/builder/workflows/wf/run', {}), routeParams('wf')))
    expect(res.status).toBe(400)
    expect(h.db.count('workflow_runs')).toBe(0)
  })
})
