// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Contrato TELA → SERVIDOR do builder, com as rotas reais e o Supabase em memória:
 * o autosave do useWorkflowBuilder manda PATCH { name, tree, nodes, edges } (compileFlow
 * da árvore do store) e o botão Publicar chama POST /publish. Verifica o que o runtime
 * (webhook lê workflow_versions com status 'published') passa a enxergar.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { compileFlow } from '@/lib/builder/flow/compile'
import { findStep } from '@/lib/builder/flow/operations'
import type { Flow } from '@/lib/builder/flow/types'
import {
  chain,
  makeFlow,
  publishFlow,
  resetWorkflowCaches,
  routes,
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
  useFlowBuilderStore.getState().reset()
})
afterEach(() => teardownWorkflowTest())

const store = () => useFlowBuilderStore.getState()

/** O que o doSave do hook manda para a rota. */
const autosaveBody = (flow: Flow) => {
  const g = compileFlow(flow)
  return { name: flow.name, tree: flow, nodes: g.nodes, edges: g.edges }
}

/** Mensagem do passo w1 na versão publicada (o que o webhook executa). */
function publishedMessage(workflowId: string): unknown {
  const published = h.db.rows('workflow_versions').filter((v) => v.workflow_id === workflowId && v.status === 'published')
  expect(published).toHaveLength(1)
  const node = (published[0].nodes as Array<{ id: string; data: { config: Record<string, unknown> } }>).find((n) => n.id === 'w1')
  return node?.data.config.message
}

async function publishedA() {
  const flow = makeFlow({ id: 'wf-live', name: 'Fluxo', trigger: triggers.keywords(['oi']), root: chain(steps.whatsapp({ id: 'w1', message: 'A' })) })
  const pub = await publishFlow(h.db, flow)
  return { flow, pub }
}

/** Edita a mensagem pelo store (como o ConfigPanel) e devolve a árvore resultante. */
function editInStore(flow: Flow, message: string): Flow {
  store().loadFlow(structuredClone(flow))
  store().patchStep('w1', { config: { message } })
  expect(findStep(store().flow!, 'w1')!.config.message).toBe(message)
  return store().flow!
}

describe('RT-01 salvar pela tela grava a árvore e o grafo', () => {
  it('rascunho: o PATCH do autosave grava tree/nodes/edges na versão ativa e o GET devolve', async () => {
    const flow = makeFlow({ id: 'wf-draft', name: 'Rascunho', trigger: triggers.keywords(['oi']), root: chain(steps.whatsapp({ id: 'w1', message: 'A' })) })
    // cria o registro como a lista de fluxos ("Novo fluxo") via GET (ensureWorkflowRecord)
    const created = await routes.getWorkflow('wf-draft')
    expect(created.status).toBe(200)
    const edited = editInStore(flow, 'Rascunho editado')
    const res = await routes.patchWorkflow('wf-draft', autosaveBody(edited))
    expect(res.status).toBe(200)
    const get = await routes.getWorkflow('wf-draft')
    const body = get.body as { tree: Flow; nodes: Array<{ id: string; data: { config: Record<string, unknown> } }> }
    expect(findStep(body.tree, 'w1')!.config.message).toBe('Rascunho editado')
    expect(body.nodes.find((n) => n.id === 'w1')!.data.config.message).toBe('Rascunho editado')
  })

  it('árvore inválida (ids duplicados) → 400 sem gravar', async () => {
    const { flow } = await publishedA()
    const bad = structuredClone(flow)
    bad.root!.next = { ...structuredClone(bad.root!), next: null }
    const before = h.db.rows('workflow_versions').map((v) => structuredClone(v))
    const res = await routes.patchWorkflow('wf-live', { ...autosaveBody(flow), tree: bad })
    expect(res.status).toBe(400)
    expect(h.db.rows('workflow_versions')).toEqual(before)
  })
})

describe('RT-03 editar depois de publicar', () => {
  // BUG(edits-go-live): o publish aponta workflows.active_version_id para a versão
  // 'published', e o PATCH do autosave (updateWorkflowRecord) grava nessa MESMA linha
  // (workflow-db.ts:292-302). Qualquer edição no builder entra no ar na hora, sem
  // clicar em Publicar — o webhook (status='published') já executa a mensagem nova.
  it.fails('o autosave não altera a versão publicada até o próximo Publicar', async () => {
    const { flow } = await publishedA()
    expect(publishedMessage('wf-live')).toBe('A')
    const res = await routes.patchWorkflow('wf-live', autosaveBody(editInStore(flow, 'B')))
    expect(res.status).toBe(200)
    expect(publishedMessage('wf-live')).toBe('A')
  })

  it('caracterização: hoje a mensagem "B" já está na versão publicada', async () => {
    const { flow, pub } = await publishedA()
    await routes.patchWorkflow('wf-live', autosaveBody(editInStore(flow, 'B')))
    expect(publishedMessage('wf-live')).toBe('B')
    expect(h.db.row('workflows', { id: 'wf-live' })!.active_version_id).toBe(pub.versionId)
  })

  it('publicar de novo cria a versão seguinte e arquiva a anterior', async () => {
    const { flow, pub } = await publishedA()
    const pub2 = await publishFlow(h.db, editInStore(flow, 'C'), { workflowId: 'wf-live' })
    expect(pub2.version).toBe(pub.version + 1)
    expect(h.db.row('workflow_versions', { id: pub.versionId })!.status).toBe('archived')
    expect(publishedMessage('wf-live')).toBe('C')
  })
})

describe('RT-04 versão publicada ao reabrir o builder', () => {
  // BUG(no-last-published): o GET por id usa ensureWorkflowRecord/fetchWorkflowRecord, que
  // não calcula lastPublishedVersion (só a listagem calcula); toSavedWorkflow faz ?? null.
  // O hook inicializa publishedVersion com isso, então ao recarregar a página o badge
  // "vN publicada" some do cabeçalho.
  it.fails('GET devolve lastPublishedVersion = versão publicada', async () => {
    const { pub } = await publishedA()
    const get = await routes.getWorkflow('wf-live')
    expect((get.body as { lastPublishedVersion: number | null }).lastPublishedVersion).toBe(pub.version)
  })

  it('caracterização: hoje vem null mesmo com status published', async () => {
    await publishedA()
    const get = await routes.getWorkflow('wf-live')
    expect(get.body).toMatchObject({ status: 'published', lastPublishedVersion: null })
  })
})
