// @vitest-environment node
/**
 * POST /api/builder/workflows/[workflowId]/rollback com estado real (Supabase em memória).
 * Reativar uma versão = publicá-la de novo: a selecionada vira published/ativa e TODAS as
 * outras viram archived.
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
  publishFlow,
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

async function rollback(workflowId: string, body: unknown) {
  const mod = await import('@/app/api/builder/workflows/[workflowId]/rollback/route')
  return readRoute(await mod.POST(jsonRequest(`/api/builder/workflows/${workflowId}/rollback`, body), routeParams(workflowId)))
}

const versions = (workflowId: string) =>
  h.db
    .rows('workflow_versions')
    .filter((v) => v.workflow_id === workflowId)
    .sort((a, b) => Number(a.version) - Number(b.version))
const statuses = (workflowId: string) => versions(workflowId).map((v) => `${v.version}:${v.status}`)
const kw = (keywords: string[], id = 'wf') =>
  makeFlow({ id, trigger: triggers.keywords(keywords), root: steps.whatsapp({ id: 'w1', message: keywords.join(',') }) })
const keywordListOf = (v: Row | undefined) =>
  ((v?.nodes as Array<{ data: { type: string; config: Row } }>) ?? []).find((n) => n.data.type === 'trigger')?.data.config.keywordList

/** v1 draft → v2 (oi) published → v3 (menu) published; v1/v2 archived. */
async function threeVersions() {
  freezeTime('2026-10-18T12:00:00.000Z')
  await seedPublishedFlow(h.db, kw(['oi']), { publish: false })
  await publishFlow(h.db, kw(['oi']))
  advanceTime(60_000)
  await publishFlow(h.db, kw(['menu']))
  expect(statuses('wf')).toEqual(['1:archived', '2:archived', '3:published'])
  return versions('wf')
}

describe('rollback — validações', () => {
  it('sem versionId → 400 e nada muda', async () => {
    await threeVersions()
    const before = JSON.stringify(h.db.rows('workflow_versions'))
    const res = await rollback('wf', {})
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'versionId is required' })
    expect(JSON.stringify(h.db.rows('workflow_versions'))).toBe(before)
  })

  it('versionId de OUTRO workflow ou inexistente → 404 e nada muda', async () => {
    await threeVersions()
    const other = await seedPublishedFlow(h.db, kw(['x'], 'outro'))
    const before = JSON.stringify([h.db.rows('workflows'), h.db.rows('workflow_versions')])
    expect((await rollback('wf', { versionId: other.versionId })).status).toBe(404)
    expect((await rollback('wf', { versionId: 'nao-existe' })).status).toBe(404)
    expect(JSON.stringify([h.db.rows('workflows'), h.db.rows('workflow_versions')])).toBe(before)
  })

  it('versão antiga com condição maliciosa / Database Query → 400 (revalida no servidor) e nada muda', async () => {
    const [, v2] = await threeVersions()
    const nodes = [
      ...(v2.nodes as Row[]),
      { id: 'cx', type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: 'Cond', config: { actionType: 'Condition', condition: 'process.exit(1)' } } },
    ]
    h.db.update('workflow_versions', { id: v2.id }, { nodes })
    const before = JSON.stringify([h.db.rows('workflows'), h.db.rows('workflow_versions')])
    const res = await rollback('wf', { versionId: v2.id })
    expect(res.status).toBe(400)
    expect(JSON.stringify([h.db.rows('workflows'), h.db.rows('workflow_versions')])).toBe(before)
  })
})

describe('rollback — efeitos', () => {
  it('R10 reativa a v2: ativa, published, as outras archived; workflow published; schedule limpo', async () => {
    const [, v2] = await threeVersions()
    h.db.update('workflows', { id: 'wf' }, { schedule_cron: '* * * * *', schedule_active: true })
    const res = await rollback('wf', { versionId: v2.id })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, versionId: v2.id, companyId: TEST_COMPANY_ID })
    expect(statuses('wf')).toEqual(['1:archived', '2:published', '3:archived'])
    expect(h.db.row('workflows', { id: 'wf' })).toMatchObject({ active_version_id: v2.id, status: 'published', schedule_cron: null, schedule_active: false })
  })

  // BUG(published-mutavel): o autosave grava IN-PLACE na versão ativa — que, depois do 1º
  // publish, é a PUBLICADA. Ao editar para "menu" e publicar a v3, a v2 também foi reescrita
  // com "menu". Resultado: o histórico de versões é mutável e o rollback para a v2 NÃO traz de
  // volta o que foi publicado na v2 ("oi"). Correto: a v2 é um snapshot imutável.
  it.fails('R10 BUG(published-mutavel): rollback para a v2 deveria trazer de volta o fluxo publicado na v2 ("oi")', async () => {
    const [, v2] = await threeVersions()
    await rollback('wf', { versionId: v2.id })
    const { data } = await h.db.client.from('workflow_versions').select('workflow_id, nodes').eq('status', 'published')
    expect((data as Row[]).map((v) => keywordListOf(v))).toEqual(['oi'])
  })

  it('R10 (fato) a v2 foi reescrita pelo autosave antes do 2º publish: o rollback traz "menu"', async () => {
    const [, v2] = await threeVersions()
    expect(keywordListOf(v2)).toBe('menu')
    await rollback('wf', { versionId: v2.id })
    const { data } = await h.db.client.from('workflow_versions').select('workflow_id, nodes').eq('status', 'published')
    expect((data as Row[]).map((v) => keywordListOf(v))).toEqual(['menu'])
  })

  it('R10 rollback com versões NÃO editadas in-place (publish direto) volta o conteúdo certo', async () => {
    // publish pela rota sem autosave entre eles: cada versão guarda o seu grafo
    freezeTime('2026-10-18T12:00:00.000Z')
    const first = await seedPublishedFlow(h.db, kw(['oi']))
    const v3 = await (await import('@/lib/builder/workflow-db')).createNewVersion(h.db.client as never, 'wf', {
      nodes: (await seedPublishedFlow(h.db, kw(['menu'], 'tmp'))).nodes,
      edges: [],
      tree: kw(['menu']),
      status: 'draft',
    })
    expect(v3.version).toBe(3)
    await rollback('wf', { versionId: first.versionId })
    const { data } = await h.db.client.from('workflow_versions').select('workflow_id, nodes').eq('status', 'published').eq('workflow_id', 'wf')
    expect((data as Row[]).map((v) => keywordListOf(v))).toEqual(['oi'])
  })

  it('R09 sempre exatamente 1 versão published por workflow (publish → rollback → publish)', async () => {
    const [v1, v2] = await threeVersions()
    await rollback('wf', { versionId: v2.id })
    expect(versions('wf').filter((v) => v.status === 'published')).toHaveLength(1)
    await rollback('wf', { versionId: v1.id })
    expect(statuses('wf')).toEqual(['1:published', '2:archived', '3:archived'])
    await publishFlow(h.db, kw(['tchau']))
    // publicar a partir da v1 ativa: v1 (já reativada) vira archived e nasce a v4
    expect(statuses('wf')).toEqual(['1:archived', '2:archived', '3:archived', '4:published'])
  })

  it('o rollback não toca outros workflows', async () => {
    const [, v2] = await threeVersions()
    await seedPublishedFlow(h.db, kw(['x'], 'outro'))
    const otherBefore = JSON.stringify(versions('outro'))
    await rollback('wf', { versionId: v2.id })
    expect(JSON.stringify(versions('outro'))).toBe(otherBefore)
  })

  // PLAUSIBLE BUG(rollback-published_at): o loader de keywords do webhook ordena as versões
  // publicadas por published_at desc para decidir a prioridade entre fluxos com a mesma
  // palavra-chave. O rollback marca a versão como published SEM atualizar published_at: ela
  // fica com a data antiga (ou null, se nunca foi publicada — e DESC põe NULLS FIRST no Postgres).
  // Correto: published_at = agora ao reativar.
  it.fails('R11 BUG(rollback-published_at): reativar a v2 deveria atualizar published_at para agora', async () => {
    const [, v2] = await threeVersions()
    advanceTime(60_000)
    await rollback('wf', { versionId: v2.id })
    expect(h.db.row('workflow_versions', { id: v2.id })?.published_at).toBe(new Date().toISOString())
  })

  it('R11 (fato) published_at fica com a data do 1º publish; a v1 (rascunho) reativada fica null', async () => {
    const [v1, v2] = await threeVersions()
    advanceTime(60_000)
    await rollback('wf', { versionId: v2.id })
    expect(h.db.row('workflow_versions', { id: v2.id })?.published_at).toBe('2026-10-18T12:00:00.000Z')
    await rollback('wf', { versionId: v1.id })
    const v1Row = h.db.row('workflow_versions', { id: v1.id })
    expect(v1Row).toMatchObject({ status: 'published', published_at: null })
  })

  it('R11 (fato) a v1 reativada com published_at null passa À FRENTE de um fluxo publicado agora (NULLS FIRST)', async () => {
    const [v1] = await threeVersions()
    await rollback('wf', { versionId: v1.id })
    advanceTime(60_000)
    await seedPublishedFlow(h.db, kw(['oi'], 'novo'))
    const { data } = await h.db.client
      .from('workflow_versions')
      .select('workflow_id, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
    expect((data as Row[]).map((v) => v.workflow_id)).toEqual(['wf', 'novo'])
  })
})

describe('versions GET', () => {
  it('R12 lista todas as versões do workflow ordenadas por version desc, com status/published_at/tree', async () => {
    await threeVersions()
    await seedPublishedFlow(h.db, kw(['x'], 'outro'))
    const mod = await import('@/app/api/builder/workflows/[workflowId]/versions/route')
    const res = await readRoute<Row[]>(await mod.GET(jsonRequest('/api/builder/workflows/wf/versions'), routeParams('wf')))
    expect(res.status).toBe(200)
    expect(res.body.map((v) => [v.version, v.status])).toEqual([
      [3, 'published'],
      [2, 'archived'],
      [1, 'archived'],
    ])
    expect(res.body[0].published_at).toBe('2026-10-18T12:01:00.000Z')
    expect(res.body[1].published_at).toBe('2026-10-18T12:00:00.000Z')
    expect(res.body[2].published_at).toBeNull()
    expect((res.body[0].tree as { trigger: { keywords: string[] } }).trigger.keywords).toEqual(['menu'])
    expect(res.body.every((v) => v.workflow_id === 'wf')).toBe(true)
  })

  it('R12 workflow inexistente → [] (não cria nada)', async () => {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/versions/route')
    const res = await readRoute(await mod.GET(jsonRequest('/api/builder/workflows/x/versions'), routeParams('x')))
    expect(res.body).toEqual([])
    expect(h.db.count('workflows')).toBe(0)
  })
})
