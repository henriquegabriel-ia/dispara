// @vitest-environment node
/**
 * GET /api/builder/workflows (lista) e GET /api/builder/workflows/metrics com estado real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  freezeTime,
  jsonRequest,
  makeFlow,
  readRoute,
  resetWorkflowCaches,
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

const flow = (id: string) => makeFlow({ id, name: `Fluxo ${id}`, trigger: triggers.keywords([id]), root: steps.whatsapp({ id: 'w', message: id }) })

async function metrics(query = '') {
  const mod = await import('@/app/api/builder/workflows/metrics/route')
  return readRoute<{ totals: Row; byWorkflow: Record<string, Row> }>(await mod.GET(jsonRequest(`/api/builder/workflows/metrics${query}`)))
}

function seedRuns(workflowId: string, statuses: string[]) {
  statuses.forEach((status, i) => h.db.insert('workflow_runs', { id: `${workflowId}-r${i}`, workflow_id: workflowId, status, started_at: new Date().toISOString() }))
}

describe('lista (GET /api/builder/workflows)', () => {
  it('R16 ordena por updated_at desc, traz lastPublishedVersion e omite outra company e workflow sem versão ativa', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await seedPublishedFlow(h.db, flow('a'))
    advanceTime(1000)
    await seedPublishedFlow(h.db, flow('b'), { publish: false })
    advanceTime(1000)
    await seedPublishedFlow(h.db, flow('c'))
    await seedPublishedFlow(h.db, flow('alheio'), { ownerCompanyId: 'outra-company' })
    h.db.insert('workflows', { id: 'sem-versao', name: 'x', status: 'draft', owner_company_id: 'company-test' })

    const mod = await import('@/app/api/builder/workflows/route')
    const list = (await (await mod.GET()).json()) as Row[]
    expect(list.map((w) => [w.id, w.status, w.lastPublishedVersion])).toEqual([
      ['c', 'published', 2],
      ['b', 'draft', null],
      ['a', 'published', 2],
    ])
    expect(list[0].tree).toEqual(flow('c'))
  })
})

describe('metrics', () => {
  it('R16 success = "success"; failed = "failed" + "error"; skipped/waiting/running contam só em runs', async () => {
    await seedPublishedFlow(h.db, flow('a'))
    await seedPublishedFlow(h.db, flow('b'))
    seedRuns('a', ['success', 'success', 'failed', 'error', 'skipped', 'waiting'])
    seedRuns('b', ['running', 'success'])
    const all = await metrics()
    expect(all.body).toEqual({
      totals: { runs: 8, success: 3, failed: 2 },
      byWorkflow: {
        a: { runs: 6, success: 2, failed: 2 },
        b: { runs: 2, success: 1, failed: 0 },
      },
    })
    const onlyB = await metrics('?workflowId=b')
    expect(onlyB.body).toEqual({ totals: { runs: 2, success: 1, failed: 0 }, byWorkflow: { b: { runs: 2, success: 1, failed: 0 } } })
  })

  it('sem runs → zeros', async () => {
    expect((await metrics()).body).toEqual({ totals: { runs: 0, success: 0, failed: 0 }, byWorkflow: {} })
  })
})
