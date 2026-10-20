// @vitest-environment node
/**
 * lib/builder/workflow-db.ts com estado real (Supabase em memória com o esquema do Dispara):
 * create / fetch / ensure / update / list / createNewVersion / toSavedWorkflow.
 *
 * É a camada que TODAS as rotas do builder usam para salvar (PATCH), publicar, versionar,
 * duplicar e para o webhook/execute/cron acharem o grafo a executar.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDefaultGraph,
  buildDefaultTree,
  createNewVersion,
  createWorkflowRecord,
  ensureWorkflowRecord,
  fetchEditorRecord,
  fetchPublishedRecord,
  fetchWorkflowRecord,
  getCompanyId,
  listWorkflowRecords,
  toSavedWorkflow,
  updateWorkflowRecord,
} from '@/lib/builder/workflow-db'
import { compileFlow } from '@/lib/builder/flow/compile'
import type { WorkflowEdge, WorkflowNode } from '@/lib/builder/graph-types'
import { findWorkflowGraphIssues } from '@/lib/builder/workflow-graph-guard'
import { validateWorkflowSchema } from '@/lib/shared/workflow-schema'
import { setActiveSupabase, type InMemorySupabase } from '@/tests/helpers/in-memory-supabase'
import { createBarrier, createWorkflowDb, makeFlow, steps, TEST_COMPANY_ID, triggers } from '@/tests/helpers/workflow-harness'

type Client = Parameters<typeof getCompanyId>[0]

function setup(seed: Parameters<typeof createWorkflowDb>[0] = {}): { db: InMemorySupabase; client: Client } {
  const db = createWorkflowDb(seed, { activate: false })
  return { db, client: db.client as unknown as Client }
}

afterEach(() => setActiveSupabase(null))

const flow = makeFlow({ id: 'wf-1', name: 'Boas-vindas', trigger: triggers.keywords(['oi']), root: steps.whatsapp({ id: 'w1', message: 'Olá' }) })
const compiled = compileFlow(flow)
const graph = { nodes: compiled.nodes as unknown as WorkflowNode[], edges: compiled.edges as unknown as WorkflowEdge[] }

describe('workflow-db — grafo e árvore padrão', () => {
  it('buildDefaultGraph: grafo LEGADO (trigger "Webhook" + "Send Message" sem mensagem), ids nanoid novos a cada chamada', () => {
    const a = buildDefaultGraph()
    const b = buildDefaultGraph()
    expect(a.nodes.map((n) => n.data.config)).toEqual([{ triggerType: 'Webhook' }, { actionType: 'Send Message' }])
    expect(a.nodes[0].id).not.toBe('__trigger')
    expect(a.nodes[0].id).not.toBe(b.nodes[0].id)
    expect(a.edges).toEqual([{ id: expect.any(String), source: a.nodes[0].id, target: a.nodes[1].id, type: 'animated' }])
    // passa nos guardas do servidor (por isso as rotas o aceitam)
    expect(validateWorkflowSchema(a).success).toBe(true)
    expect(findWorkflowGraphIssues(a.nodes)).toEqual([])
  })

  it('buildDefaultTree: árvore vazia SEM gatilho ("none") com o nome padrão', () => {
    expect(buildDefaultTree({ id: 'x' })).toEqual({
      schemaVersion: 1,
      id: 'x',
      name: 'Fluxo inicial',
      trigger: { type: 'none', label: '', keywords: [] },
      root: null,
    })
  })

  it('getCompanyId lê settings.company_id (null sem a chave)', async () => {
    const { client } = setup()
    expect(await getCompanyId(client)).toBe(TEST_COMPANY_ID)
    const empty = createWorkflowDb({}, { withDefaults: false, activate: false })
    expect(await getCompanyId(empty.client as unknown as Client)).toBeNull()
  })
})

describe('workflow-db — createWorkflowRecord / fetchWorkflowRecord', () => {
  it('cria workflow draft + v1 draft ligada (active_version_id), com tree e owner', async () => {
    const { db, client } = setup()
    const record = await createWorkflowRecord(client, { id: 'wf-1', name: 'Boas-vindas', ...graph, tree: flow }, TEST_COMPANY_ID)
    expect(record.workflow).toMatchObject({ id: 'wf-1', name: 'Boas-vindas', status: 'draft', owner_company_id: TEST_COMPANY_ID })
    expect(record.workflow.active_version_id).toBe(record.version.id)
    expect(record.version).toMatchObject({ workflow_id: 'wf-1', version: 1, status: 'draft', published_at: null })
    expect(record.version.nodes).toEqual(graph.nodes)
    expect(record.version.tree).toEqual(flow)
    expect(db.count('workflow_versions', { workflow_id: 'wf-1' })).toBe(1)
    expect(db.row('workflows', { id: 'wf-1' })?.settings).toEqual({})
  })

  it('sem id gera um; sem nome usa "Fluxo inicial"; sem tree grava null', async () => {
    const { client } = setup()
    const record = await createWorkflowRecord(client, { nodes: [], edges: [] }, null)
    expect(record.workflow.id).toEqual(expect.any(String))
    expect(record.workflow.name).toBe('Fluxo inicial')
    expect(record.workflow.owner_company_id).toBeNull()
    expect(record.version.tree).toBeNull()
  })

  it('id já existente → erro com a mensagem do banco (PK) e nada é duplicado', async () => {
    const { db, client } = setup()
    await createWorkflowRecord(client, { id: 'wf-1', ...graph })
    await expect(createWorkflowRecord(client, { id: 'wf-1', ...graph })).rejects.toThrow(/Failed to create workflow: duplicate key/)
    expect(db.count('workflows')).toBe(1)
    expect(db.count('workflow_versions')).toBe(1)
  })

  it('fetchWorkflowRecord: null para inexistente, sem versão ativa ou versão ativa sumida', async () => {
    const { db, client } = setup({
      workflows: [
        { id: 'sem-versao', name: 'X', active_version_id: null },
        { id: 'versao-sumida', name: 'Y', active_version_id: 'v-fantasma' },
      ],
    })
    expect(await fetchWorkflowRecord(client, 'nao-existe')).toBeNull()
    expect(await fetchWorkflowRecord(client, 'sem-versao')).toBeNull()
    expect(await fetchWorkflowRecord(client, 'versao-sumida')).toBeNull()
    // fetch é só leitura
    expect(db.count('workflows')).toBe(2)
  })
})

describe('workflow-db — ensureWorkflowRecord', () => {
  it('workflow existente: devolve o registro sem escrever nada', async () => {
    const { db, client } = setup()
    await createWorkflowRecord(client, { id: 'wf-1', ...graph, tree: flow })
    const writesBefore = db.ops.filter((o) => o.op !== 'select').length
    const record = await ensureWorkflowRecord(client, 'wf-1')
    expect(record.version.tree).toEqual(flow)
    expect(db.ops.filter((o) => o.op !== 'select').length).toBe(writesBefore)
  })

  it('id inexistente: cria "Fluxo inicial" draft com a árvore vazia e o grafo COMPILADO dela (só o PATCH do editor usa o ensure)', async () => {
    const { db, client } = setup()
    const record = await ensureWorkflowRecord(client, 'id-digitado-errado', TEST_COMPANY_ID)
    expect(record.workflow).toMatchObject({ id: 'id-digitado-errado', name: 'Fluxo inicial', status: 'draft' })
    expect(record.version.nodes.find((n) => n.data.type === 'trigger')).toMatchObject({ id: '__trigger', data: { config: { triggerType: 'None' } } })
    expect(record.version.tree).toMatchObject({ id: 'id-digitado-errado', trigger: { type: 'none' }, root: null })
    expect(db.count('workflows')).toBe(1)
  })

  it('(fato) workflow sem versão ativa: o insert do "ensure" bate na PK e a rota explode (500)', async () => {
    const { client } = setup({ workflows: [{ id: 'quebrado', name: 'Sem versão', active_version_id: null }] })
    await expect(ensureWorkflowRecord(client, 'quebrado')).rejects.toThrow(/Failed to create workflow: duplicate key/)
  })

  // Corrigido BUG(create-grafo-legado): o registro novo nasce com nodes/edges = compileFlow(tree).
  it('create-grafo-legado: grafo do registro novo é o compileFlow(tree)', async () => {
    const { client } = setup()
    const record = await ensureWorkflowRecord(client, 'novo')
    const expected = compileFlow(record.version.tree as Parameters<typeof compileFlow>[0])
    expect(record.version.nodes).toEqual(expected.nodes)
    expect(record.version.edges).toEqual(expected.edges)
  })
})

describe('workflow-db — updateWorkflowRecord (save do editor: rascunho; a versão publicada é imutável)', () => {
  async function seeded() {
    const ctx = setup()
    await createWorkflowRecord(ctx.client, { id: 'wf-1', name: 'Boas-vindas', ...graph, tree: flow })
    ctx.db.update('workflows', { id: 'wf-1' }, { settings: { allowReentry: false } })
    return ctx
  }

  it('patch só com name: nodes/edges/tree/settings preservados; nenhuma versão nova', async () => {
    const { db, client } = await seeded()
    const updated = await updateWorkflowRecord(client, 'wf-1', { name: 'Renomeado' })
    expect(updated.workflow).toMatchObject({ name: 'Renomeado', settings: { allowReentry: false } })
    expect(updated.version.nodes).toEqual(graph.nodes)
    expect(updated.version.edges).toEqual(graph.edges)
    expect(updated.version.tree).toEqual(flow)
    expect(db.count('workflow_versions')).toBe(1)
  })

  it('settings é sanitizado por parseWorkflowSettings (chaves desconhecidas somem)', async () => {
    const { client } = await seeded()
    const updated = await updateWorkflowRecord(client, 'wf-1', {
      settings: { stopOnResponse: true, hack: 'x', timeWindow: { enabled: true, start: '08:00', end: '18:00', days: [1, 1, 9] } } as never,
    })
    expect(updated.workflow.settings).toEqual({
      stopOnResponse: true,
      timeWindow: { enabled: true, start: '08:00', end: '18:00', days: [1], timezone: 'America/Sao_Paulo' },
    })
  })

  it('(fato) nodes: [] APAGA o grafo (?? só preserva undefined/null) e tree: null apaga a árvore', async () => {
    const { client } = await seeded()
    const updated = await updateWorkflowRecord(client, 'wf-1', { nodes: [], edges: [], tree: null })
    expect(updated.version.nodes).toEqual([])
    expect(updated.version.edges).toEqual([])
    expect(updated.version.tree).toBeNull()
  })

  it('nunca publicado: grava no próprio rascunho ativo (sem versão nova)', async () => {
    const { db, client } = await seeded()
    const edited = compileFlow({ ...flow, trigger: triggers.keywords(['tchau']) })
    const updated = await updateWorkflowRecord(client, 'wf-1', { nodes: edited.nodes as never, edges: edited.edges as never })
    expect(updated.version.status).toBe('draft')
    expect(updated.version.id).toBe(db.row('workflows', { id: 'wf-1' })?.active_version_id)
    expect(db.count('workflow_versions')).toBe(1)
  })

  it('depois de publicar: a versão publicada fica intacta e a edição vai para um rascunho mais novo (reaproveitado nos saves seguintes)', async () => {
    const { db, client } = await seeded()
    const published = await createNewVersion(client, 'wf-1', { ...graph, tree: flow, status: 'published' })
    db.update('workflows', { id: 'wf-1' }, { active_version_id: published.id, status: 'published' })
    const edited = compileFlow({ ...flow, trigger: triggers.keywords(['tchau']) })
    const first = await updateWorkflowRecord(client, 'wf-1', { nodes: edited.nodes as never, edges: edited.edges as never })
    const row = db.row('workflow_versions', { id: published.id })!
    expect(row.status).toBe('published')
    expect((row.nodes as WorkflowNode[])[0].data.config).toEqual({ triggerType: 'Keywords', keywordList: 'oi' })
    expect(db.row('workflows', { id: 'wf-1' })?.active_version_id).toBe(published.id)
    expect(first.version).toMatchObject({ status: 'draft', version: 3 })
    expect(first.lastPublishedVersion).toBe(2)
    expect(toSavedWorkflow(first).hasUnpublishedChanges).toBe(true)

    await updateWorkflowRecord(client, 'wf-1', { name: 'Só o nome' })
    const again = await updateWorkflowRecord(client, 'wf-1', { tree: { ...flow, name: 'v3' } })
    expect(again.version.id).toBe(first.version.id)
    expect(db.count('workflow_versions')).toBe(3)

    // o runtime só enxerga a publicada; o editor enxerga o rascunho
    expect((await fetchPublishedRecord(client, 'wf-1'))?.version.id).toBe(published.id)
    expect((await fetchEditorRecord(client, 'wf-1'))?.version.id).toBe(first.version.id)
  })

  it('fetchPublishedRecord: rascunho nunca publicado, inexistente ou excluído → null (e nunca cria nada)', async () => {
    const { db, client } = await seeded()
    expect(await fetchPublishedRecord(client, 'wf-1')).toBeNull()
    expect(await fetchPublishedRecord(client, 'nao-existe')).toBeNull()
    expect(db.count('workflows')).toBe(1)
  })
})

describe('workflow-db — listWorkflowRecords', () => {
  it('filtra por company, omite workflow sem versão ativa, calcula lastPublishedVersion e ordena por updated_at desc', async () => {
    const { db, client } = setup()
    await createWorkflowRecord(client, { id: 'a', name: 'A', ...graph }, TEST_COMPANY_ID)
    await createWorkflowRecord(client, { id: 'b', name: 'B', ...graph }, TEST_COMPANY_ID)
    await createWorkflowRecord(client, { id: 'outra', name: 'Outra', ...graph }, 'company-outra')
    db.insert('workflows', { id: 'orfao', name: 'Órfão', owner_company_id: TEST_COMPANY_ID, active_version_id: null })
    // b: v2 publicada, v3 publicada e depois arquivada, v4 rascunho ativo → última publicada = 2
    for (const status of ['published', 'archived', 'draft']) await createNewVersion(client, 'b', { ...graph, status })
    const v4 = db.row('workflow_versions', { workflow_id: 'b', version: 4 })!
    db.update('workflows', { id: 'b' }, { active_version_id: v4.id })
    db.update('workflows', { id: 'a' }, { updated_at: '2026-10-18T10:00:00.000Z' })
    db.update('workflows', { id: 'b' }, { updated_at: '2026-10-18T11:00:00.000Z' })

    const records = await listWorkflowRecords(client, TEST_COMPANY_ID)
    expect(records.map((r) => r.workflow.id)).toEqual(['b', 'a'])
    expect(records.map((r) => r.lastPublishedVersion)).toEqual([2, null])
    expect(records[0].version.version).toBe(4)

    // sem company: lista todas (inclusive de outra company), ainda omitindo a sem versão
    const all = await listWorkflowRecords(client, null)
    expect(all.map((r) => r.workflow.id).sort()).toEqual(['a', 'b', 'outra'])
  })

  it('nenhum workflow → []', async () => {
    const { client } = setup()
    expect(await listWorkflowRecords(client, TEST_COMPANY_ID)).toEqual([])
  })
})

describe('workflow-db — createNewVersion', () => {
  it('numera max+1 (ordem numérica: 2..12), copia tree e só seta published_at quando published', async () => {
    const { db, client } = setup()
    await createWorkflowRecord(client, { id: 'wf-1', ...graph, tree: flow })
    const created = []
    for (let i = 0; i < 11; i += 1) {
      created.push(await createNewVersion(client, 'wf-1', { ...graph, tree: flow, status: i % 2 === 0 ? 'published' : 'draft' }))
    }
    expect(created.map((v) => v.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(created[0].published_at).toEqual(expect.any(String))
    expect(created[1].published_at).toBeNull()
    expect(created[0].tree).toEqual(flow)
    expect(db.count('workflow_versions', { workflow_id: 'wf-1' })).toBe(12)
  })

  it('sem tree grava null; numeração é por workflow', async () => {
    const { client } = setup()
    await createWorkflowRecord(client, { id: 'a', ...graph })
    await createWorkflowRecord(client, { id: 'b', ...graph })
    await createNewVersion(client, 'a', { ...graph, status: 'draft' })
    const vb = await createNewVersion(client, 'b', { ...graph, status: 'draft' })
    expect(vb).toMatchObject({ version: 2, tree: null })
  })

  it('(fato) duas publicações concorrentes: o UNIQUE (workflow_id, version) segura, uma delas falha genérica', async () => {
    const { db, client } = setup()
    await createWorkflowRecord(client, { id: 'wf-1', ...graph })
    const barrier = createBarrier(2)
    const off = db.onBefore(() => barrier.wait(), { table: 'workflow_versions', op: 'insert' })
    const results = await Promise.allSettled([
      createNewVersion(client, 'wf-1', { ...graph, status: 'published' }),
      createNewVersion(client, 'wf-1', { ...graph, status: 'published' }),
    ])
    off()
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    // o erro do insert (23505) é engolido: sobra a mensagem genérica
    expect(String(rejected.reason)).toContain('Failed to create workflow version')
    expect(db.rows('workflow_versions').map((v) => v.version).sort()).toEqual([1, 2])
  })
})

describe('workflow-db — toSavedWorkflow', () => {
  it('mapeia o registro para o formato da API (settings parseado, tree ausente vira undefined)', async () => {
    const { db, client } = setup()
    await createWorkflowRecord(client, { id: 'wf-1', name: 'Boas-vindas', description: 'desc', ...graph })
    db.update('workflows', { id: 'wf-1' }, { settings: { allowReentry: false, lixo: 1 } })
    const record = (await fetchWorkflowRecord(client, 'wf-1'))!
    expect(toSavedWorkflow(record)).toEqual({
      id: 'wf-1',
      name: 'Boas-vindas',
      description: 'desc',
      nodes: graph.nodes,
      edges: graph.edges,
      tree: undefined,
      visibility: 'private',
      settings: { allowReentry: false },
      createdAt: record.workflow.created_at,
      updatedAt: record.workflow.updated_at,
      isOwner: true,
      status: 'draft',
      lastPublishedVersion: null,
      hasUnpublishedChanges: false,
    })
    expect(toSavedWorkflow({ ...record, lastPublishedVersion: 3 }, { isOwner: false })).toMatchObject({ isOwner: false, lastPublishedVersion: 3 })
  })
})
