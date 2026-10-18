// @vitest-environment node
/**
 * GET / PATCH / DELETE /api/builder/workflows/[workflowId] com estado real
 * (Supabase em memória com o esquema do Dispara; nada de rede).
 *
 * O PATCH é o AUTOSAVE da tela (hooks/useWorkflowBuilder.ts doSave): o cliente compila a
 * árvore e manda { name, tree, nodes, edges }. A sheet de Configurações manda só { settings }.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { compileFlow } from '@/lib/builder/flow/compile'
import type { Flow, Step } from '@/lib/builder/flow/types'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  chain,
  makeFlow,
  resetWorkflowCaches,
  routes,
  seedPublishedFlow,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_PHONES,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

/** Corpo EXATO do autosave (useWorkflowBuilder.doSave). */
function savePayload(flow: Flow) {
  const g = compileFlow(flow)
  return { name: flow.name, tree: flow, nodes: g.nodes, edges: g.edges }
}

function activeVersion(workflowId: string): Row {
  const wf = h.db.row('workflows', { id: workflowId })
  return h.db.row('workflow_versions', { id: wf?.active_version_id as string })!
}

const snapshot = () => JSON.stringify({ w: h.db.rows('workflows'), v: h.db.rows('workflow_versions') })

const FIXTURES: Record<string, () => Step | null> = {
  vazio: () => null,
  whatsapp: () => steps.whatsapp({ id: 'w', message: 'Olá' }),
  template: () => steps.whatsapp({ id: 'w', template: 'boas_vindas' }),
  midia: () => steps.whatsapp({ id: 'w', mediaUrl: 'https://cdn.test/a.jpg' }),
  perguntar: () => steps.interactive({ id: 'q', message: 'Sim?', buttons: ['Sim', 'Não'] }),
  aguardar: () => chain(steps.wait({ id: 'wt', value: 5 }), steps.whatsapp({ id: 'w', message: 'voltei' })),
  condicao: () => steps.condition({ id: 'c', branches: [{ label: 'x', value: 'x', child: steps.tag({ id: 't', tags: ['vip'] }) }] }),
  tags: () => chain(steps.tag({ id: 't', tags: ['vip'] }), steps.tagRemove({ id: 'r', tags: ['frio'] })),
  pipeline: () => steps.pipeline({ id: 'p' }),
  end: () => steps.end(),
}

describe('PATCH (autosave) — round-trip do que a tela salva', () => {
  it.each(Object.keys(FIXTURES))('R02 fixture "%s": grava nodes/edges/tree na versão ativa sem coerção e o GET devolve igual', async (key) => {
    const seeded = await seedPublishedFlow(h.db, makeFlow({ id: 'wf', root: null }), { publish: false })
    const flow = makeFlow({ id: 'wf', name: `Fluxo ${key}`, trigger: triggers.keywords(['oi']), root: FIXTURES[key]() })
    const body = savePayload(flow)

    const res = await routes.patchWorkflow('wf', body)
    expect(res.status).toBe(200)
    const version = activeVersion('wf')
    expect(version.id).toBe(seeded.versionId) // in-place, sem versão nova
    expect(h.db.count('workflow_versions', { workflow_id: 'wf' })).toBe(1)
    expect(version.status).toBe('draft')
    expect(version.nodes).toEqual(body.nodes) // actionTypes intactos
    expect(version.edges).toEqual(body.edges)
    expect(version.tree).toEqual(flow)
    expect(h.db.row('workflows', { id: 'wf' })).toMatchObject({ name: `Fluxo ${key}`, status: 'draft' })

    const get = await routes.getWorkflow('wf')
    expect(get.status).toBe(200)
    expect(get.body).toMatchObject({ id: 'wf', name: `Fluxo ${key}`, tree: flow, nodes: body.nodes, edges: body.edges, status: 'draft' })
  })

  it('normaliza edges (descarta sourceHandle/campos extras) e nodes (posição/label padrão)', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf' }), { publish: false })
    const body = savePayload(makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'oi' }) }))
    const edges = body.edges.map((e) => ({ ...e, sourceHandle: 'yes', animated: true }))
    const nodes = body.nodes.map((n) => (n.id === 'w' ? { ...n, position: undefined, data: { ...n.data, label: 42 } } : n))
    const res = await routes.patchWorkflow('wf', { ...body, nodes, edges })
    expect(res.status).toBe(200)
    const v = activeVersion('wf')
    expect(v.edges).toEqual([{ id: 'e-__trigger-w', source: '__trigger', target: 'w' }])
    expect((v.nodes as Row[]).find((n) => n.id === 'w')).toMatchObject({ position: { x: 0, y: 0 }, data: { label: '' } })
  })

  it('(fato) nó com variableKey + message + toSource inbound vira whatsapp/ask-question no servidor', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf' }), { publish: false })
    const body = savePayload(makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'oi' }) }))
    const nodes = body.nodes.map((n) =>
      n.id === 'w' ? { ...n, data: { ...n.data, config: { ...n.data.config, variableKey: 'resposta', templateName: 'x' } } } : n
    )
    await routes.patchWorkflow('wf', { ...body, nodes })
    expect((activeVersion('wf').nodes as Row[]).find((n) => n.id === 'w')).toMatchObject({
      data: { config: { actionType: 'whatsapp/ask-question', message: 'oi', variableKey: 'resposta' } },
    })
    expect(JSON.stringify(activeVersion('wf').nodes)).not.toContain('templateName')
  })

  it('PATCH com { settings } JUNTO do grafo grava settings sanitizado', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf' }), { publish: false })
    const body = savePayload(makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'oi' }) }))
    const res = await routes.patchWorkflow('wf', { ...body, settings: { allowReentry: false, extra: 1 } })
    expect(res.status).toBe(200)
    expect(h.db.row('workflows', { id: 'wf' })?.settings).toEqual({ allowReentry: false })
    expect(res.body).toMatchObject({ settings: { allowReentry: false } })
  })
})

describe('PATCH — validações (400 e nada gravado)', () => {
  const MALICIOUS = '{{@__trigger:Gatilho.message}}["constructor"]["constructor"]("return process.env")()'

  async function base() {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'original' }) }), { publish: false })
    return savePayload(makeFlow({ id: 'wf', name: 'Novo nome', root: steps.whatsapp({ id: 'w', message: 'editado' }) }))
  }

  it.each([
    ['sem trigger', (b: ReturnType<typeof savePayload>) => ({ ...b, nodes: b.nodes.filter((n) => n.data.type !== 'trigger'), edges: [] })],
    ['dois triggers', (b: ReturnType<typeof savePayload>) => ({ ...b, nodes: [...b.nodes, { ...b.nodes[0], id: 'outro-trigger' }] })],
    ['edge para nó ausente', (b: ReturnType<typeof savePayload>) => ({ ...b, edges: [...b.edges, { id: 'e', source: 'w', target: 'fantasma' }] })],
    ['tree null', (b: ReturnType<typeof savePayload>) => ({ ...b, tree: null })],
    ['tree string', (b: ReturnType<typeof savePayload>) => ({ ...b, tree: 'flow' })],
    ['tree schemaVersion 2', (b: ReturnType<typeof savePayload>) => ({ ...b, tree: { ...b.tree, schemaVersion: 2 } })],
    [
      'tree com ids duplicados',
      (b: ReturnType<typeof savePayload>) => ({
        ...b,
        tree: { ...b.tree, root: chain(steps.whatsapp({ id: 'dup', message: 'a' }), steps.whatsapp({ id: 'dup', message: 'b' })) },
      }),
    ],
    [
      'condição maliciosa',
      (b: ReturnType<typeof savePayload>) => ({
        ...b,
        nodes: [...b.nodes, { id: 'c', type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: 'C', config: { actionType: 'Condition', condition: MALICIOUS } } }],
      }),
    ],
    [
      'Database Query',
      (b: ReturnType<typeof savePayload>) => ({
        ...b,
        nodes: [...b.nodes, { id: 'db', type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: 'SQL', config: { actionType: 'Database Query' } } }],
      }),
    ],
    ['corpo que não é JSON', () => '{nao é json'],
  ] as const)('R04 %s → 400', async (_label, mutate) => {
    const body = await base()
    const before = snapshot()
    const res = await routes.patchWorkflow('wf', mutate(body as never))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: expect.any(String) })
    expect(snapshot()).toBe(before)
  })
})

describe('PATCH — tela de Configurações (WorkflowSettingsSheet manda só { settings })', () => {
  const sheetBody = {
    settings: { allowReentry: false, stopOnResponse: true, timeWindow: { enabled: false, start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] } },
  }

  it('R03 (fato) hoje responde 400 "Invalid workflow" (0 triggers) e não grava nada', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'oi' }) }), { publish: false })
    const before = snapshot()
    const res = await routes.patchWorkflow('wf', sheetBody)
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('encontrado 0')
    expect(snapshot()).toBe(before)
  })

  // BUG(settings-patch-400): components/flow-builder/WorkflowSettingsSheet.tsx salva com
  // api.workflow.update(id, { settings }) — PATCH sem nodes. normalizeWorkflowPatch transforma a
  // ausência em nodes [] e validateWorkflowSchema exige 1 trigger → 400 sempre: "Permitir
  // reentrada", "Parar ao responder" e "Janela de horário" nunca são salvas pela tela (toast "Falha
  // ao salvar as configurações"). E se passasse, updateWorkflowRecord gravaria nodes [] (só
  // preserva undefined) e APAGARIA o grafo. Correto: 200, settings gravado e grafo intacto.
  it.fails('R03 BUG(settings-patch-400): salvar só as configurações deveria funcionar sem tocar no grafo', async () => {
    const seeded = await seedPublishedFlow(h.db, makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'oi' }) }))
    const res = await routes.patchWorkflow('wf', sheetBody)
    expect(res.status).toBe(200)
    expect(h.db.row('workflows', { id: 'wf' })?.settings).toMatchObject({ allowReentry: false, stopOnResponse: true })
    const version = activeVersion('wf')
    expect(version.nodes).toEqual(seeded.nodes)
    expect(version.edges).toEqual(seeded.edges)
    expect(version.tree).toEqual(seeded.tree)
  })
})

describe('GET', () => {
  it('devolve o SavedWorkflow da versão ativa (tree, nodes, settings, status)', async () => {
    const flow = makeFlow({ id: 'wf', root: steps.whatsapp({ id: 'w', message: 'oi' }) })
    const seeded = await seedPublishedFlow(h.db, flow, { settings: { allowReentry: false } })
    const res = await routes.getWorkflow('wf')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'wf', status: 'published', tree: flow, nodes: seeded.nodes, settings: { allowReentry: false } })
  })

  it('Supabase não configurado → 400', async () => {
    const { setActiveSupabase } = await import('@/tests/helpers/in-memory-supabase')
    setActiveSupabase(null)
    expect((await routes.getWorkflow('wf')).status).toBe(400)
    expect((await routes.patchWorkflow('wf', {})).status).toBe(400)
    expect((await routes.deleteWorkflow('wf')).status).toBe(400)
  })

  // BUG(ghost-workflow): GET de um id inexistente (URL errada, link velho, fluxo apagado) passa por
  // ensureWorkflowRecord e CRIA um workflow "Fluxo inicial" com o grafo legado — lixo na lista e
  // um fluxo publicável que ninguém criou. Correto: 404 e nenhuma linha nova.
  it.fails('D02 BUG(ghost-workflow): GET de id inexistente deveria dar 404 sem criar nada', async () => {
    const res = await routes.getWorkflow('nao-existe')
    expect(res.status).toBe(404)
    expect(h.db.count('workflows', { id: 'nao-existe' })).toBe(0)
  })

  it('D02 (fato) hoje o GET de id inexistente cria "Fluxo inicial" draft', async () => {
    const res = await routes.getWorkflow('nao-existe')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'nao-existe', name: 'Fluxo inicial', status: 'draft' })
    expect(h.db.count('workflows', { id: 'nao-existe' })).toBe(1)
  })
})

describe('DELETE', () => {
  async function publishedWithLeftovers() {
    const flow = makeFlow({
      id: 'wf',
      trigger: triggers.none(),
      root: chain(steps.wait({ id: 'wt', value: 5 }), steps.whatsapp({ id: 'w', message: 'depois do wait' })),
    })
    const seeded = await seedPublishedFlow(h.db, flow)
    h.db.insert('workflow_runs', { id: 'run-1', workflow_id: 'wf', version_id: seeded.versionId, status: 'waiting' })
    h.db.insert('workflow_conversations', { id: 'conv-1', workflow_id: 'wf', phone: TEST_PHONES.ana })
    h.db.insert('workflow_enrollments', {
      workflow_id: 'wf',
      version_id: seeded.versionId,
      phone: TEST_PHONES.ana,
      status: 'waiting',
      wait_kind: 'delay',
      resume_at: '2020-01-01T00:00:00.000Z',
      resume_node_ids: ['w'],
      resolved_nodes: ['__trigger', 'wt'],
    })
    return seeded
  }

  it('R15 apaga o workflow e, em cascata, versões/runs/conversas; o enrollment (sem FK) sobra', async () => {
    await publishedWithLeftovers()
    const res = await routes.deleteWorkflow('wf')
    expect(res).toMatchObject({ status: 200, body: { success: true } })
    expect(h.db.count('workflows')).toBe(0)
    expect(h.db.count('workflow_versions')).toBe(0)
    expect(h.db.count('workflow_runs')).toBe(0)
    expect(h.db.count('workflow_conversations')).toBe(0)
    expect(h.db.row('workflow_enrollments', { workflow_id: 'wf' })?.status).toBe('waiting')
  })

  it('DELETE de id inexistente responde success (idempotente)', async () => {
    expect((await routes.deleteWorkflow('nao-existe')).body).toEqual({ success: true })
  })

  // BUG(ghost-workflow / cron): o DELETE não cancela os workflow_enrollments (a tabela não tem FK)
  // e o próximo tick do cron (drainWorkflowEnrollments) chama ensureWorkflowRecord para o
  // workflow_id do enrollment — RECRIANDO o fluxo apagado como "Fluxo inicial" (grafo legado).
  // Correto: depois do DELETE o enrollment não fica ativo/esperando e o drain não recria nada.
  it.fails('R15 BUG(ghost-workflow): fluxo apagado não deveria voltar no próximo tick do cron', async () => {
    await publishedWithLeftovers()
    await routes.deleteWorkflow('wf')
    await routes.drain()
    expect(h.db.count('workflows', { id: 'wf' })).toBe(0)
    expect(['waiting', 'active']).not.toContain(h.db.row('workflow_enrollments', { workflow_id: 'wf' })?.status)
  })

  it('R15 (fato) hoje o drain recria o workflow apagado e marca o enrollment como failed', async () => {
    await publishedWithLeftovers()
    await routes.deleteWorkflow('wf')
    const drained = await routes.drain()
    expect(drained).toMatchObject({ claimed: 1 })
    expect(h.db.row('workflows', { id: 'wf' })).toMatchObject({ name: 'Fluxo inicial', status: 'draft' })
    expect(h.db.row('workflow_enrollments', { workflow_id: 'wf' })?.status).toBe('failed')
    expect(h.meta.sent).toEqual([]) // pelo menos não envia nada
  })
})
