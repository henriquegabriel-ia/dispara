// @vitest-environment node
/**
 * POST /api/builder/workflows/[workflowId]/duplicate com estado real (Supabase em memória).
 * A cópia nasce como rascunho (draft, v1 draft) com o grafo/árvore da versão ATIVA do original.
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
  TEST_COMPANY_ID,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

async function duplicate(workflowId: string) {
  const mod = await import('@/app/api/builder/workflows/[workflowId]/duplicate/route')
  return readRoute<Row>(await mod.POST(jsonRequest(`/api/builder/workflows/${workflowId}/duplicate`, {}), routeParams(workflowId)))
}

const flow = makeFlow({
  id: 'wf',
  name: 'Boas-vindas',
  trigger: triggers.keywords(['oi']),
  root: steps.interactive({ id: 'q', message: 'Topa?', buttons: ['Sim'] }),
})

describe('duplicate', () => {
  it('R13 cria "<nome> Copy" draft + v1 draft com nodes/edges/tree da versão ativa; original intacto', async () => {
    const original = await seedPublishedFlow(h.db, flow)
    const before = JSON.stringify(h.db.rows('workflow_versions').filter((v) => v.workflow_id === 'wf'))
    const res = await duplicate('wf')
    expect(res.status).toBe(200)
    const copyId = res.body.id as string
    expect(copyId).not.toBe('wf')
    expect(res.body).toMatchObject({ name: 'Boas-vindas Copy', status: 'draft' })

    const copy = h.db.row('workflows', { id: copyId })!
    expect(copy).toMatchObject({ status: 'draft', owner_company_id: TEST_COMPANY_ID })
    const copyVersions = h.db.rows('workflow_versions').filter((v) => v.workflow_id === copyId)
    expect(copyVersions).toHaveLength(1)
    expect(copyVersions[0]).toMatchObject({ id: copy.active_version_id, version: 1, status: 'draft', published_at: null })
    expect(copyVersions[0].nodes).toEqual(original.nodes)
    expect(copyVersions[0].edges).toEqual(original.edges)
    expect(copyVersions[0].tree).toEqual(flow)

    expect(JSON.stringify(h.db.rows('workflow_versions').filter((v) => v.workflow_id === 'wf'))).toBe(before)
    expect(h.db.row('workflows', { id: 'wf' })?.status).toBe('published')
  })

  it('R13 a cópia NÃO aparece para o webhook (só o original publicado)', async () => {
    await seedPublishedFlow(h.db, flow)
    await duplicate('wf')
    const { data } = await h.db.client.from('workflow_versions').select('workflow_id').eq('status', 'published')
    expect((data as Row[]).map((v) => v.workflow_id)).toEqual(['wf'])
  })

  it('grafo ativo com ação fora da allowlist → 400 e nenhuma cópia', async () => {
    const original = await seedPublishedFlow(h.db, flow)
    h.db.update('workflow_versions', { id: original.versionId }, {
      nodes: [
        ...(original.nodes as unknown as Row[]),
        { id: 'db', type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: 'SQL', config: { actionType: 'Database Query' } } },
      ],
    })
    const res = await duplicate('wf')
    expect(res.status).toBe(400)
    expect(h.db.count('workflows')).toBe(1)
  })

  // PLAUSIBLE BUG(duplicate-sem-settings): createWorkflowRecord não recebe nem grava settings —
  // a cópia volta para allowReentry/stopOnResponse/timeWindow padrão. Correto: herdar settings.
  it('R13 duplicate-sem-settings: a cópia deveria herdar as configurações do original', async () => {
    await seedPublishedFlow(h.db, flow, { settings: { allowReentry: false, stopOnResponse: true } })
    const res = await duplicate('wf')
    const copy = h.db.row('workflows', { id: res.body.id as string })!
    expect(copy.settings).toEqual(h.db.row('workflows', { id: 'wf' })?.settings)
  })

  // Corrigido BUG(ghost-workflow): duplicar um id inexistente cria o "Fluxo inicial" (ensureWorkflowRecord)
  // E a cópia. Correto: 404 sem gravar nada.
  it('D02 ghost-workflow: duplicar id inexistente deveria dar 404', async () => {
    const res = await duplicate('nao-existe')
    expect(res.status).toBe(404)
    expect(h.db.count('workflows')).toBe(0)
  })

})
