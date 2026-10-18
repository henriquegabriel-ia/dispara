// @vitest-environment node
/**
 * GET /api/builder/workflows/[workflowId]/download (export) e o re-import pelo /create.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { compileFlow } from '@/lib/builder/flow/compile'
import type { Flow } from '@/lib/builder/flow/types'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  chain,
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

async function download(workflowId: string) {
  const mod = await import('@/app/api/builder/workflows/[workflowId]/download/route')
  return readRoute<{ name: string; workflow: Row }>(await mod.GET(jsonRequest(`/api/builder/workflows/${workflowId}/download`), routeParams(workflowId)))
}

const flow = makeFlow({
  id: 'wf',
  name: 'Exportável',
  trigger: triggers.keywords(['oi', 'menu']),
  root: chain(
    steps.whatsapp({ id: 'w1', message: 'Olá' }),
    steps.condition({ id: 'c', branches: [{ label: 'A', value: 'a', child: steps.tag({ id: 't', tags: ['a'] }) }] }),
    steps.wait({ id: 'wt', value: 3 })
  ),
})

describe('download', () => {
  it('R14 devolve { name, workflow: SavedWorkflow } com nodes, edges, tree, settings e status', async () => {
    const seeded = await seedPublishedFlow(h.db, flow, { settings: { allowReentry: false } })
    const res = await download('wf')
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Exportável')
    expect(res.body.workflow).toMatchObject({ id: 'wf', name: 'Exportável', status: 'published', tree: flow })
    expect(res.body.workflow.nodes).toEqual(seeded.nodes)
    expect(res.body.workflow.edges).toEqual(seeded.edges)
    expect(res.body.workflow.settings).toMatchObject({ allowReentry: false })
  })

  it('R14 export → import (/create com nodes, edges, tree) reproduz o mesmo grafo, e o compileFlow da tree importada bate', async () => {
    await seedPublishedFlow(h.db, flow)
    const exported = (await download('wf')).body.workflow
    const create = await import('@/app/api/builder/workflows/create/route')
    const res = await readRoute<Row>(
      await create.POST(
        jsonRequest('/api/builder/workflows/create', { name: 'Importado', nodes: exported.nodes, edges: exported.edges, tree: exported.tree })
      )
    )
    expect(res.status).toBe(200)
    const importedId = res.body.id as string
    expect(importedId).not.toBe('wf')
    const version = h.db.row('workflow_versions', { workflow_id: importedId })!
    expect(version.status).toBe('draft')
    expect(version.nodes).toEqual(exported.nodes)
    expect(version.edges).toEqual(exported.edges)
    const recompiled = compileFlow(version.tree as Flow)
    expect(recompiled.nodes).toEqual(version.nodes)
    expect(recompiled.edges).toEqual(version.edges)
  })

  it('(fato) download de id inexistente cria o "Fluxo inicial" (ensureWorkflowRecord) — ver BUG(ghost-workflow)', async () => {
    const res = await download('nao-existe')
    expect(res.body.name).toBe('Fluxo inicial')
    expect(h.db.count('workflows')).toBe(1)
  })
})
