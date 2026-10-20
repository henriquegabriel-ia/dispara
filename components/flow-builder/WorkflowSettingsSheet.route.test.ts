// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WS-03: o que acontece quando o body que a sheet de configurações manda
 * ({ settings } — ver WorkflowSettingsSheet.test.tsx) chega na rota PATCH REAL,
 * com o Supabase em memória e um fluxo publicado pelo caminho real da UI.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import {
  makeFlow,
  publishFlow,
  resetWorkflowCaches,
  routes,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  triggers,
  chain,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

const SHEET_BODY = {
  settings: { allowReentry: false, stopOnResponse: true, timeWindow: { enabled: true, start: '10:00', end: '17:00', days: [1, 2, 3] } },
}

async function publishedFixture() {
  const flow = makeFlow({ id: 'wf-settings', name: 'Fluxo', trigger: triggers.keywords(['oi']), root: chain(steps.whatsapp({ id: 'w1', message: 'Olá' })) })
  const pub = await publishFlow(h.db, flow)
  const version = () => h.db.row('workflow_versions', { id: pub.versionId })!
  return { pub, version, before: structuredClone(version()) }
}

describe('WS-03 PATCH só com settings (o que a sheet manda)', () => {
  // settings-never-save: PATCH parcial (só settings) não valida nem toca o grafo.
  it('responde 200 e grava workflows.settings sem tocar no grafo da versão', async () => {
    const { version, before } = await publishedFixture()
    const res = await routes.patchWorkflow('wf-settings', SHEET_BODY)
    expect(res.status).toBe(200)
    expect(h.db.row('workflows', { id: 'wf-settings' })!.settings).toMatchObject(SHEET_BODY.settings)
    expect(version().nodes).toEqual(before.nodes)
    expect(version().edges).toEqual(before.edges)
    expect(version().tree).toEqual(before.tree)
  })

  it('controle: settings enviados JUNTO com o grafo (save do builder) são gravados', async () => {
    const { pub } = await publishedFixture()
    const res = await routes.patchWorkflow('wf-settings', { name: 'Fluxo', tree: pub.tree, nodes: pub.nodes, edges: pub.edges, ...SHEET_BODY })
    expect(res.status).toBe(200)
    expect(h.db.row('workflows', { id: 'wf-settings' })!.settings).toMatchObject(SHEET_BODY.settings)
  })
})
