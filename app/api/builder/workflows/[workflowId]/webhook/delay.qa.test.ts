// @vitest-environment node
/**
 * POST /api/builder/workflows/[workflowId]/webhook com o executor REAL e estado real.
 * (o teste do segredo x-workflow-secret fica em ./route.test.ts)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

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
  TEST_PHONES,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

const ANA = TEST_PHONES.ana

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  vi.stubEnv('WORKFLOW_BUILDER_WEBHOOK_SECRET', '')
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

async function builderWebhook(workflowId: string, body: unknown) {
  const mod = await import('@/app/api/builder/workflows/[workflowId]/webhook/route')
  return readRoute<Row>(await mod.POST(jsonRequest(`/api/builder/workflows/${workflowId}/webhook`, body), routeParams(workflowId)))
}

const waitFlow = (opts: { publish?: boolean; trigger?: ReturnType<typeof triggers.none> } = {}) =>
  makeFlow({
    id: 'wf',
    trigger: opts.trigger ?? triggers.keywords(['oi']),
    root: chain(steps.wait({ id: 'wt', value: 2, unit: 'minutes' }), steps.whatsapp({ id: 'w', message: 'depois' })),
  })

describe('builder webhook', () => {
  it('executa o grafo ativo e envia a mensagem (sem wait)', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'agora' }) }))
    const res = await builderWebhook('wf', { from: ANA, to: ANA })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'success' })
    expect(h.meta.sentTo(ANA).map((m) => m.text)).toEqual(['agora'])
    expect(h.db.rows('workflow_runs')).toEqual([expect.objectContaining({ workflow_id: 'wf', trigger_type: 'Webhook' })])
  })

  // BUG(builder-webhook-delay): ao contrário do /execute e do /resume, esta rota ignora
  // execution.paused — não chama persistDelayWait e responde "success". Um fluxo com
  // "Aguardar" para no Delay para sempre. Correto: enrollment waiting e status "waiting".
  it.fails('W01 BUG(builder-webhook-delay): pausa por Delay deveria persistir o enrollment', async () => {
    await seedPublishedFlow(h.db, waitFlow())
    const res = await builderWebhook('wf', { from: ANA, to: ANA })
    expect(res.body.status).toBe('waiting')
    expect(h.db.rows('workflow_enrollments')).toEqual([expect.objectContaining({ workflow_id: 'wf', status: 'waiting' })])
  })

  it('W01 (fato) hoje responde "success", não grava enrollment e a mensagem depois do wait nunca sai', async () => {
    await seedPublishedFlow(h.db, waitFlow())
    const res = await builderWebhook('wf', { from: ANA, to: ANA })
    expect(res.body.status).toBe('success')
    expect((res.body.output as Row).paused).toBe(true)
    expect(h.db.count('workflow_enrollments')).toBe(0)
    expect(h.meta.sent).toHaveLength(0)
  })

  it('(fato) executa rascunho nunca publicado e fluxo "Sem gatilho" (não checa status nem trigger)', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf', trigger: triggers.none(), root: steps.whatsapp({ id: 'w', message: 'draft!' }) }), { publish: false })
    expect(h.db.row('workflows', { id: 'wf' })?.status).toBe('draft')
    const res = await builderWebhook('wf', { from: ANA, to: ANA })
    expect(res.body.status).toBe('success')
    expect(h.meta.sentTo(ANA).map((m) => m.text)).toEqual(['draft!'])
  })
})
