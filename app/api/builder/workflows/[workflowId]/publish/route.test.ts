// @vitest-environment node
/**
 * POST /api/builder/workflows/[workflowId]/publish com estado real (Supabase em memória).
 *
 * Publicar compila a árvore do EDITOR (o rascunho mais novo, ou a versão ativa se nunca
 * publicou) numa versão nova "published" (com published_at), arquiva o rascunho e a versão
 * anterior e marca workflows.status = published. A versão publicada é imutável: o autosave
 * seguinte grava num rascunho novo. O webhook da Meta só enxerga workflow_versions.status =
 * 'published' (ver ../../round-trip.qa.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { compileFlow, FlowCompileError } from '@/lib/builder/flow/compile'
import type { Flow } from '@/lib/builder/flow/types'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  freezeTime,
  makeFlow,
  publishFlow,
  resetWorkflowCaches,
  routes,
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

const versions = (workflowId: string) =>
  h.db
    .rows('workflow_versions')
    .filter((v) => v.workflow_id === workflowId)
    .sort((a, b) => Number(a.version) - Number(b.version))
const statuses = (workflowId: string) => versions(workflowId).map((v) => `${v.version}:${v.status}`)
const keywordListOf = (version: Row | undefined) =>
  ((version?.nodes as Array<{ data: { type: string; config: Record<string, unknown> } }>) ?? []).find((n) => n.data.type === 'trigger')?.data
    .config.keywordList

/** A mesma query do webhook da Meta (loadKeywordWorkflows): versões publicadas, mais recente primeiro. */
async function publishedVersionsSeenByWebhook(): Promise<Row[]> {
  const { data } = await h.db.client
    .from('workflow_versions')
    .select('workflow_id, nodes, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
  return (data as Row[]) ?? []
}

const keywordsFlow = (keywords: string[], id = 'wf') =>
  makeFlow({ id, name: 'Boas-vindas', trigger: triggers.keywords(keywords), root: steps.whatsapp({ id: 'w1', message: 'Olá!' }) })

function savePayload(flow: Flow) {
  const g = compileFlow(flow)
  return { name: flow.name, tree: flow, nodes: g.nodes, edges: g.edges }
}

describe('publish — caminho feliz', () => {
  it('R05 cria v2 published (cópia da v1), arquiva a v1, ativa a v2 e limpa o agendamento', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const draft = await seedPublishedFlow(h.db, keywordsFlow(['oi']), { publish: false })
    h.db.update('workflows', { id: 'wf' }, { schedule_cron: '0 9 * * *', schedule_active: true })

    const res = await routes.publish('wf')
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; versionId: string; version: number }
    expect(body).toEqual({ success: true, versionId: expect.any(String), version: 2 })

    const [v1, v2] = versions('wf')
    expect(v1).toMatchObject({ id: draft.versionId, status: 'archived', published_at: null })
    expect(v2).toMatchObject({ id: body.versionId, version: 2, status: 'published', published_at: '2026-10-18T12:00:00.000Z' })
    expect(v2.nodes).toEqual(v1.nodes)
    expect(v2.edges).toEqual(v1.edges)
    expect(v2.tree).toEqual(v1.tree)
    expect(h.db.row('workflows', { id: 'wf' })).toMatchObject({
      status: 'published',
      active_version_id: body.versionId,
      schedule_cron: null,
      schedule_timezone: null,
      schedule_active: false,
      schedule_updated_at: '2026-10-18T12:00:00.000Z',
    })

    const seen = await publishedVersionsSeenByWebhook()
    expect(seen.map((v) => v.workflow_id)).toEqual(['wf'])
    expect(keywordListOf(seen[0])).toBe('oi')
  })

  it('R05 caminho da tela (PATCH com a árvore compilada → publish) ≡ publicar o compileFlow(tree)', async () => {
    const flow = makeFlow({
      id: 'wf',
      trigger: triggers.campaignReply({ campaignId: 'c_promo', replyFilter: 'quero' }),
      root: steps.interactive({ id: 'q', message: 'Topa?', buttons: ['Sim', 'Não'] }),
    })
    const published = await publishFlow(h.db, flow)
    const expected = compileFlow(flow)
    expect(published.version).toBe(2)
    expect(published.nodes).toEqual(expected.nodes)
    expect(published.edges).toEqual(expected.edges)
    expect(h.db.row('workflow_versions', { id: published.versionId })?.tree).toEqual(flow)
  })

  it('trigger legado "Schedule" sincroniza as colunas schedule_* do workflow', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const draft = await seedPublishedFlow(h.db, keywordsFlow(['oi']), { publish: false })
    const nodes = (draft.nodes as unknown as Row[]).map((n) =>
      n.id === '__trigger'
        ? { ...n, data: { ...(n.data as Row), config: { triggerType: 'Schedule', scheduleCron: '0 9 * * 1', scheduleTimezone: 'America/Sao_Paulo' } } }
        : n
    )
    // fluxo legado: sem árvore (o publish só recompila quando há tree do builder novo)
    h.db.update('workflow_versions', { id: draft.versionId }, { nodes, tree: null })
    expect((await routes.publish('wf')).status).toBe(200)
    expect(h.db.row('workflows', { id: 'wf' })).toMatchObject({
      schedule_cron: '0 9 * * 1',
      schedule_timezone: 'America/Sao_Paulo',
      schedule_active: true,
    })
  })

  it('R09 publicar → editar → publicar: 1 archived, 2 archived, 3 archived (rascunho), 4 published; sempre 1 published por fluxo', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    // como na tela: o fluxo nasce pelo /create (com owner_company_id) e só depois é salvo/publicado
    await seedPublishedFlow(h.db, keywordsFlow(['oi']), { publish: false })
    await publishFlow(h.db, keywordsFlow(['oi']))
    expect(statuses('wf')).toEqual(['1:archived', '2:published'])
    advanceTime(60_000)
    await publishFlow(h.db, keywordsFlow(['menu']))
    // a edição depois do 1º publish foi para o rascunho v3; o publish gerou a v4
    expect(statuses('wf')).toEqual(['1:archived', '2:archived', '3:archived', '4:published'])
    expect(versions('wf').filter((v) => v.status === 'published')).toHaveLength(1)
    const v4 = versions('wf')[3]
    expect(h.db.row('workflows', { id: 'wf' })?.active_version_id).toBe(v4.id)
    expect(keywordListOf(v4)).toBe('menu')

    const list = await (await import('@/app/api/builder/workflows/route')).GET()
    const [item] = (await list.json()) as Array<{ id: string; lastPublishedVersion: number }>
    expect(item).toMatchObject({ id: 'wf', lastPublishedVersion: 4 })
  })

  it('PATCH (upsert do editor) num id novo cria o workflow COM owner_company_id — aparece na lista', async () => {
    await publishFlow(h.db, keywordsFlow(['oi'], 'novo'))
    expect(h.db.row('workflows', { id: 'novo' })?.owner_company_id).toBe('company-test')
    const list = await (await import('@/app/api/builder/workflows/route')).GET()
    expect(((await list.json()) as Row[]).map((w) => w.id)).toEqual(['novo'])
    expect((await publishedVersionsSeenByWebhook()).map((v) => v.workflow_id)).toEqual(['novo'])
  })

  it('(fato) publicar 2x sem mudar nada cria outra versão idêntica (v3)', async () => {
    await seedPublishedFlow(h.db, keywordsFlow(['oi']))
    await routes.publish('wf')
    expect(statuses('wf')).toEqual(['1:archived', '2:archived', '3:published'])
    expect(versions('wf')[2].nodes).toEqual(versions('wf')[1].nodes)
  })
})

describe('publish — rascunhos, validação e o que o webhook passa a ver', () => {
  it('R06 fluxo só salvo (nunca publicado) não aparece para o webhook; o publicado sim', async () => {
    await seedPublishedFlow(h.db, keywordsFlow(['oi'], 'rascunho'), { publish: false })
    await seedPublishedFlow(h.db, keywordsFlow(['menu'], 'publicado'))
    const seen = await publishedVersionsSeenByWebhook()
    expect(seen.map((v) => v.workflow_id)).toEqual(['publicado'])
    expect(h.db.row('workflows', { id: 'rascunho' })?.status).toBe('draft')
  })

  it('grafo com condição maliciosa/Database Query não é publicado (400, nada muda)', async () => {
    const draft = await seedPublishedFlow(h.db, keywordsFlow(['oi']), { publish: false })
    const nodes = [
      ...(draft.nodes as unknown as Row[]),
      { id: 'db', type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: 'SQL', config: { actionType: 'Database Query' } } },
    ]
    h.db.update('workflow_versions', { id: draft.versionId }, { nodes })
    const before = JSON.stringify([h.db.rows('workflows'), h.db.rows('workflow_versions')])
    const res = await routes.publish('wf')
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toContain('Database Query')
    expect(JSON.stringify([h.db.rows('workflows'), h.db.rows('workflow_versions')])).toBe(before)
  })

  // Corrigido BUG(publish-nao-compila): o botão "Publicar" da LISTA (app/(dashboard)/workflows/page.tsx
  // handlePublish) chama esta rota direto, sem compilar. Quando o autosave encontrou um
  // FlowCompileError (ex.: passo Split), ele grava a tree nova com os nodes ANTIGOS ("Fluxo salvo
  // como rascunho"). A rota publica esses nodes velhos, que não correspondem à árvore exibida.
  // Correto: o servidor compila a tree antes de publicar e recusa (400) a que não compila.
  it('R08 publish-nao-compila: publish deveria recusar árvore que não compila', async () => {
    const draft = await seedPublishedFlow(h.db, keywordsFlow(['oi']), { publish: false })
    const brokenTree = keywordsFlow(['oi'])
    brokenTree.root!.next = steps.split({ id: 's', paths: [{ label: 'A', percent: 50 }, { label: 'B', percent: 50 }] })
    expect(() => compileFlow(brokenTree)).toThrow(FlowCompileError)
    // é exatamente o que o autosave grava após o FlowCompileError (tree nova + nodes anteriores)
    const patch = await routes.patchWorkflow('wf', { name: brokenTree.name, tree: brokenTree, nodes: draft.nodes, edges: draft.edges })
    expect(patch.status).toBe(200)

    const res = await routes.publish('wf')
    expect(res.status).toBe(400)
    expect(versions('wf')).toHaveLength(1)
  })

  // PLAUSIBLE BUG(guard-incompleto): só PATCH/create rodam validateWorkflowSchema. Uma versão
  // gravada sem gatilho (ex.: pelo /current, que aceita nodes []), ou com edge para nó ausente, é
  // publicada e só falha no runtime (execute devolve "Invalid workflow" para toda mensagem).
  // Correto: publish recusa (400) grafo que não passa no schema.
  it.fails('G02 BUG(guard-incompleto): publish deveria recusar versão sem nó de gatilho', async () => {
    const draft = await seedPublishedFlow(h.db, keywordsFlow(['oi']), { publish: false })
    h.db.update('workflow_versions', { id: draft.versionId }, { nodes: (draft.nodes as unknown as Row[]).filter((n) => n.id !== '__trigger'), edges: [] })
    const res = await routes.publish('wf')
    expect(res.status).toBe(400)
  })

  // Corrigido BUG(ghost-workflow): publicar um id inexistente cria E publica um "Fluxo inicial" com o grafo
  // legado (trigger "Webhook" + "Send Message" vazio). Correto: 404 e nada gravado.
  it('D02 ghost-workflow: publish de id inexistente deveria dar 404', async () => {
    const res = await routes.publish('nao-existe')
    expect(res.status).toBe(404)
    expect(h.db.count('workflows')).toBe(0)
  })

  it('fluxo recém-criado pela lista e publicado sem abrir o editor publica o grafo da árvore vazia ("Sem gatilho")', async () => {
    const created = await (await import('@/app/api/builder/workflows/create/route')).POST(
      new Request('http://localhost/api/builder/workflows/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Fluxo 20261018_1200', nodes: [], edges: [] }),
      })
    )
    const { id } = (await created.json()) as { id: string }
    expect((await routes.publish(id)).status).toBe(200)
    const [, published] = versions(id)
    const trigger = (published.nodes as Row[]).find((n) => (n.data as Row).type === 'trigger') as { id: string; data: Row }
    expect(trigger.data.config).toEqual({ triggerType: 'None' })
    expect(trigger.id).toBe('__trigger')
    expect(published.tree).toMatchObject({ schemaVersion: 1, id, trigger: { type: 'none' }, root: null })
  })
})

describe('publish → autosave depois de publicar', () => {
  // Corrigido BUG(published-mutavel): depois do 1º publish, active_version_id aponta para a versão
  // PUBLICADA e o autosave (PATCH) grava nela in-place. O webhook lê status = 'published' e passa a
  // responder às edições na hora, sem o usuário clicar em "Publicar" (e o histórico de versões vira
  // mutável: o rollback para N traz o que foi editado depois). Correto: a versão publicada é um
  // snapshot imutável e as edições ficam num rascunho até o próximo publish.
  it('R07 published-mutavel: editar depois de publicar NÃO deveria alterar o que o webhook vê', async () => {
    await publishFlow(h.db, keywordsFlow(['oi']))
    const res = await routes.patchWorkflow('wf', savePayload(keywordsFlow(['tchau'])))
    expect(res.status).toBe(200)
    const [seen] = await publishedVersionsSeenByWebhook()
    expect(keywordListOf(seen)).toBe('oi')
  })

  it('R07 árvore incompilável salva depois de publicar fica no rascunho; a versão PUBLICADA continua intacta e o publish recusa', async () => {
    const published = await publishFlow(h.db, keywordsFlow(['oi']))
    const broken = keywordsFlow(['oi'])
    broken.root!.next = steps.goto({ id: 'g', targetId: 'w1' })
    expect(() => compileFlow(broken)).toThrow(FlowCompileError)
    await routes.patchWorkflow('wf', { name: broken.name, tree: broken, nodes: published.nodes, edges: published.edges })
    const row = h.db.row('workflow_versions', { id: published.versionId })!
    expect(row.status).toBe('published')
    expect(JSON.stringify(row.tree)).not.toContain('"goto"')
    expect(statuses('wf')).toEqual(['1:archived', '2:published', '3:draft'])
    const get = await routes.getWorkflow('wf')
    expect(get.body).toMatchObject({ hasUnpublishedChanges: true, lastPublishedVersion: 2 })
    expect(JSON.stringify((get.body as Row).tree)).toContain('"goto"')

    const res = await routes.publish('wf')
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toMatch(/^Não foi possível publicar: .*ainda não é suportado/)
    expect(statuses('wf')).toEqual(['1:archived', '2:published', '3:draft'])
  })

  it('R07 publicar de novo leva o rascunho ao ar e arquiva rascunho + versão anterior', async () => {
    await publishFlow(h.db, keywordsFlow(['oi']))
    await routes.patchWorkflow('wf', savePayload(keywordsFlow(['tchau'])))
    expect(keywordListOf((await publishedVersionsSeenByWebhook())[0])).toBe('oi')
    expect((await routes.publish('wf')).status).toBe(200)
    expect(statuses('wf')).toEqual(['1:archived', '2:archived', '3:archived', '4:published'])
    expect(keywordListOf((await publishedVersionsSeenByWebhook())[0])).toBe('tchau')
    expect((await routes.getWorkflow('wf')).body).toMatchObject({ hasUnpublishedChanges: false, lastPublishedVersion: 4 })
  })
})
