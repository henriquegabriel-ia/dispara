// @vitest-environment node
/**
 * POST /api/builder/workflows/create com estado real (Supabase em memória).
 * A tela de lista (app/(dashboard)/workflows/page.tsx) cria com { name, nodes: [], edges: [] }.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { compileFlow } from '@/lib/builder/flow/compile'
import { createEmptyFlow } from '@/lib/builder/flow/operations'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  jsonRequest,
  makeFlow,
  readRoute,
  resetWorkflowCaches,
  routes,
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

async function create(body: unknown) {
  const mod = await import('@/app/api/builder/workflows/create/route')
  return readRoute<Row>(await mod.POST(jsonRequest('/api/builder/workflows/create', body)))
}

const flow = makeFlow({ id: 'tree-id', name: 'Com árvore', trigger: triggers.keywords(['oi']), root: steps.whatsapp({ id: 'w', message: 'Olá' }) })

describe('create', () => {
  it('R01 corpo da tela de lista ({ name, nodes: [], edges: [] }): workflow draft + v1 draft, com owner', async () => {
    const res = await create({ name: 'Fluxo 20261018_1200', nodes: [], edges: [] })
    expect(res.status).toBe(200)
    const id = res.body.id as string
    expect(res.body).toMatchObject({ name: 'Fluxo 20261018_1200', status: 'draft' })
    const wf = h.db.row('workflows', { id })!
    expect(wf).toMatchObject({ status: 'draft', owner_company_id: TEST_COMPANY_ID })
    expect(h.db.rows('workflow_versions').filter((v) => v.workflow_id === id)).toEqual([
      expect.objectContaining({ id: wf.active_version_id, version: 1, status: 'draft', published_at: null }),
    ])
    // aparece na lista
    const list = await (await import('@/app/api/builder/workflows/route')).GET()
    expect(((await list.json()) as Row[]).map((w) => w.id)).toEqual([id])
  })

  // Corrigido BUG(create-grafo-legado): o fluxo novo nasce no builder novo — árvore vazia
  // ("Sem gatilho", com o id e o nome do fluxo) e o grafo compilado dela (nó "__trigger" None).
  it('R01 create-grafo-legado: fluxo novo nasce com a árvore vazia e o grafo compilado dela', async () => {
    const res = await create({ name: 'x', nodes: [], edges: [] })
    const id = res.body.id as string
    const version = h.db.row('workflow_versions', { workflow_id: id })!
    expect(version.nodes).toEqual(compileFlow(createEmptyFlow()).nodes)
    expect(version.edges).toEqual([])
    expect(version.tree).toEqual({ schemaVersion: 1, id, name: 'x', trigger: { type: 'none', label: '', keywords: [] }, root: null })
    // o GET devolve a árvore para a tela
    expect(((await routes.getWorkflow(id)).body as Row).tree).toEqual(version.tree)
  })

  it('R01 com tree válida + nodes compilados: persiste exatamente o que veio (tree as-is)', async () => {
    const g = compileFlow(flow)
    const res = await create({ name: flow.name, nodes: g.nodes, edges: g.edges, tree: flow })
    expect(res.status).toBe(200)
    const version = h.db.row('workflow_versions', { workflow_id: res.body.id as string })!
    expect(version.nodes).toEqual(g.nodes)
    expect(version.edges).toEqual(g.edges)
    expect(version.tree).toEqual(flow)
    // o GET devolve a árvore para a tela
    const get = await routes.getWorkflow(res.body.id as string)
    expect((get.body as Row).tree).toEqual(flow)
  })

  it('com tree mas SEM nodes: grava a tree e o grafo compilado DELA (nunca o legado)', async () => {
    const res = await create({ name: 'x', nodes: [], edges: [], tree: flow })
    const version = h.db.row('workflow_versions', { workflow_id: res.body.id as string })!
    expect(version.tree).toEqual(flow)
    expect(version.nodes).toEqual(compileFlow(flow).nodes)
    expect(JSON.stringify(version.nodes)).not.toContain('Webhook')
  })

  it.each([
    ['tree null', null],
    ['tree string', 'x'],
    ['schemaVersion 2', { ...flow, schemaVersion: 2 }],
    ['ids de passo duplicados', makeFlow({ root: { ...steps.whatsapp({ id: 'dup', message: 'a' }), next: steps.whatsapp({ id: 'dup', message: 'b' }) } })],
  ])('R01 %s → 400 "Invalid tree" e nada gravado', async (_label, tree) => {
    const res = await create({ name: 'x', nodes: [], edges: [], tree })
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toBe('Invalid tree')
    expect(h.db.count('workflows')).toBe(0)
    expect(h.db.count('workflow_versions')).toBe(0)
  })

  it('grafo sem trigger / com 2 triggers → 400 "Invalid workflow"', async () => {
    const g = compileFlow(flow)
    const noTrigger = await create({ name: 'x', nodes: g.nodes.filter((n) => n.id !== '__trigger'), edges: [] })
    expect(noTrigger.status).toBe(400)
    expect((noTrigger.body as { error: string }).error).toBe('Invalid workflow')
    const two = await create({ name: 'x', nodes: [...g.nodes, { ...g.nodes[0], id: '__trigger2' }], edges: g.edges })
    expect(two.status).toBe(400)
    expect(h.db.count('workflows')).toBe(0)
  })

  it('ação fora da allowlist → 400 e nada gravado', async () => {
    const g = compileFlow(flow)
    const nodes = [
      ...g.nodes,
      { id: 'db', type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: 'SQL', config: { actionType: 'Database Query' } } },
    ]
    const res = await create({ name: 'x', nodes, edges: g.edges })
    expect(res.status).toBe(400)
    expect(h.db.count('workflows')).toBe(0)
  })

  it('falha do banco no insert → 500 com a mensagem', async () => {
    h.db.failNext('workflows', 'disco cheio', 'insert')
    const res = await create({ name: 'x', nodes: [], edges: [] })
    expect(res.status).toBe(500)
    expect((res.body as { error: string }).error).toContain('disco cheio')
  })
})
