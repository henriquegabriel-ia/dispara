// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Prova da infraestrutura compartilhada dos testes de workflow:
 * - Supabase em memória (insert/upsert encadeáveis, UNIQUE parcial, order numérico,
 *   filtros PostgREST, JSONB copiado, cascades, falhas por operação, hooks, rpc);
 * - mock da Graph API (captura e erros por código);
 * - harness (árvores, publicação pelas rotas reais, webhook → execute/resume,
 *   inscrição manual → drain do cron).
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
  handleDeliveryStatus: vi.fn(async () => {}),
}))

import { createNewVersion } from '@/lib/builder/workflow-db'
import { FlowCompileError } from '@/lib/builder/flow/compile'
import { createInMemorySupabase, DISPARA_SCHEMA, type Row } from '@/tests/helpers/in-memory-supabase'
import { createMetaSendMock, metaError } from '@/tests/helpers/meta-send-mock'
import {
  advanceTime,
  chain,
  compile,
  createBarrier,
  createWorkflowDb,
  flushSelfInvokes,
  freezeTime,
  headsAfterTrigger,
  makeFlow,
  metaInbound,
  metaWebhookBody,
  publishFlow,
  resetWorkflowCaches,
  routes,
  SEED_IDS,
  seedPublishedFlow,
  selfInvokeCalls,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_PHONES,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

// ─── Supabase em memória ───────────────────────────────────────────────────────

describe('in-memory-supabase: escrita', () => {
  it('insert é encadeável: .select("id") e .select("*").single() devolvem as linhas inseridas, com defaults', async () => {
    const db = createInMemorySupabase({}, {}, { schema: DISPARA_SCHEMA })
    const { data: ids, error } = await db.client
      .from('workflow_enrollments')
      .insert([
        { workflow_id: 'wf', version_id: 'v1', phone: '+5511999990001', status: 'waiting' },
        { workflow_id: 'wf', version_id: 'v1', phone: '+5511999990002', status: 'waiting' },
      ])
      .select('id')
    expect(error).toBeNull()
    expect(ids).toEqual([{ id: '00000000-0000-4000-8000-000000000001' }, { id: '00000000-0000-4000-8000-000000000002' }])
    expect(db.rows('workflow_enrollments')[0]).toMatchObject({ attempts: 0, variables: {}, resume_node_ids: [], split_path: null })

    const { data: log } = await db.client
      .from('workflow_run_logs')
      .insert({ run_id: 'r1', node_id: 'n1', status: 'running' })
      .select('*')
      .single()
    expect(log).toMatchObject({ id: 1, run_id: 'r1', completed_at: null })
    expect(typeof (log as Row).started_at).toBe('string')
  })

  it('upsert ignoreDuplicates + .select().maybeSingle(): linha só quando inseriu, null no conflito', async () => {
    const db = createInMemorySupabase({}, {}, { schema: DISPARA_SCHEMA })
    const dedupe = () =>
      db.client
        .from('processed_inbound_messages')
        .upsert({ message_id: 'wamid.1' }, { onConflict: 'message_id', ignoreDuplicates: true })
        .select('message_id')
        .maybeSingle()
    expect((await dedupe()).data).toEqual({ message_id: 'wamid.1' })
    expect((await dedupe()).data).toBeNull()
    expect(db.count('processed_inbound_messages')).toBe(1)
  })

  it('UNIQUE parcial (workflow_id, phone) WHERE status IN (active, waiting): 23505 e lote atômico', async () => {
    const db = createInMemorySupabase(
      { workflow_enrollments: [{ workflow_id: 'wf', version_id: 'v1', phone: '+55A', status: 'waiting' }] },
      {},
      { schema: DISPARA_SCHEMA }
    )
    const { error } = await db.client.from('workflow_enrollments').insert([
      { workflow_id: 'wf', version_id: 'v1', phone: '+55B', status: 'waiting' },
      { workflow_id: 'wf', version_id: 'v1', phone: '+55A', status: 'active' },
    ])
    expect(error?.code).toBe('23505')
    expect(error?.message).toContain('ux_workflow_enrollments_active')
    expect(db.count('workflow_enrollments')).toBe(1) // nada do lote entrou

    // Fora do índice parcial (completed) pode repetir; o UPDATE também é checado.
    db.update('workflow_enrollments', { phone: '+55A' }, { status: 'completed' })
    await db.client.from('workflow_enrollments').insert({ workflow_id: 'wf', version_id: 'v1', phone: '+55A', status: 'waiting' })
    const { error: updateError } = await db.client
      .from('workflow_enrollments')
      .update({ status: 'active' })
      .eq('status', 'completed')
    expect(updateError?.code).toBe('23505')
  })

  it('JSONB é copiado: mutar o objeto inserido ou lido não altera o banco; undefined não apaga coluna', async () => {
    const db = createInMemorySupabase({}, {}, { schema: DISPARA_SCHEMA })
    const variables = { nome: 'Ana' }
    await db.client.from('workflow_conversations').insert({ id: 'c1', workflow_id: 'wf', phone: '+55', variables })
    variables.nome = 'Mutado'
    const { data } = await db.client.from('workflow_conversations').select('*').eq('id', 'c1').single()
    ;(data as { variables: Row }).variables.nome = 'Mutado de novo'
    expect(db.row('workflow_conversations', { id: 'c1' })?.variables).toEqual({ nome: 'Ana' })

    await db.client.from('workflow_conversations').update({ status: 'completed', resume_node_id: undefined }).eq('id', 'c1')
    expect(db.row('workflow_conversations', { id: 'c1' })).toMatchObject({ status: 'completed', resume_node_id: null })
  })

  it('delete de workflow cascateia versões/runs/conversas, mas NÃO enrollments (sem FK); delete({ count })', async () => {
    const db = createInMemorySupabase(
      {
        workflows: [{ id: 'wf', name: 'X' }],
        workflow_versions: [{ id: 'v1', workflow_id: 'wf', version: 1, nodes: [], edges: [] }],
        workflow_runs: [{ id: 'r1', workflow_id: 'wf', version_id: 'v1' }, { id: 'r2', workflow_id: 'wf' }],
        workflow_run_logs: [{ run_id: 'r1', node_id: 'n', status: 'success' }],
        workflow_conversations: [{ id: 'c1', workflow_id: 'wf', phone: '+55' }],
        workflow_enrollments: [{ workflow_id: 'wf', version_id: 'v1', phone: '+55', status: 'waiting' }],
      },
      {},
      { schema: DISPARA_SCHEMA }
    )
    const { count } = await db.client.from('workflow_runs').delete({ count: 'exact' }).eq('id', 'r2')
    expect(count).toBe(1)
    await db.client.from('workflows').delete().eq('id', 'wf')
    for (const t of ['workflows', 'workflow_versions', 'workflow_runs', 'workflow_run_logs', 'workflow_conversations']) {
      expect(db.count(t)).toBe(0)
    }
    expect(db.count('workflow_enrollments')).toBe(1)
  })
})

describe('in-memory-supabase: leitura', () => {
  const db = createInMemorySupabase(
    {
      workflow_runs: [
        { id: 'r1', workflow_id: 'wf', input: { from: '+5511999990001' }, started_at: '2026-10-18T10:00:00.000Z', finished_at: null },
        { id: 'r2', workflow_id: 'wf', input: { from: '5511999990002' }, started_at: '2026-10-18T11:00:00.000Z', finished_at: '2026-10-18T11:05:00.000Z' },
        { id: 'r3', workflow_id: 'outro', input: {}, started_at: '2026-10-18T09:00:00.000Z', finished_at: null },
      ],
      contacts: [
        { id: 'ct_1', phone: '+55A', name: 'Ana Souza', tags: ['vip', 'lead'] },
        { id: 'ct_2', phone: '+55B', name: 'bruno', tags: ['lead'] },
      ],
    },
    {},
    { schema: DISPARA_SCHEMA }
  )

  it('order numérico (10 > 9), nullsFirst e desempate; createNewVersion real acerta a v11', async () => {
    const versions = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i + 1}`,
      workflow_id: 'wf',
      version: i + 1,
      nodes: [],
      edges: [],
      status: i === 9 ? 'published' : 'archived',
      published_at: i === 9 ? '2026-10-18T10:00:00.000Z' : null,
    }))
    const vdb = createInMemorySupabase({ workflows: [{ id: 'wf', name: 'X' }], workflow_versions: versions }, {}, { schema: DISPARA_SCHEMA })
    const created = await createNewVersion(vdb.client as never, 'wf', { nodes: [], edges: [], status: 'draft' })
    expect(created.version).toBe(11)

    const { data: desc } = await vdb.client.from('workflow_versions').select('id').order('published_at', { ascending: false }).limit(2)
    expect((desc as Row[])[0].id).not.toBe('v10') // DESC = NULLS FIRST (Postgres)
    const { data: last } = await vdb.client
      .from('workflow_versions')
      .select('id')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('version', { ascending: false })
      .limit(2)
    expect(last).toEqual([{ id: 'v10' }, { id: created.id }])
  })

  it('filtros: lte/gt/is/not/ilike/contains e or() com caminho JSON (passesReentryGate)', async () => {
    const ids = async (q: PromiseLike<{ data: unknown }>) => ((await q).data as Row[]).map((r) => r.id)
    const runs = () => db.client.from('workflow_runs').select('id')
    expect(await ids(runs().lte('started_at', '2026-10-18T10:00:00Z'))).toEqual(['r1', 'r3'])
    expect(await ids(runs().gt('started_at', '2026-10-18T10:00:00.000Z'))).toEqual(['r2'])
    expect(await ids(runs().is('finished_at', null))).toEqual(['r1', 'r3'])
    expect(await ids(runs().not('finished_at', 'is', null))).toEqual(['r2'])
    expect(await ids(runs().eq('workflow_id', 'wf').or('input->>from.eq.+5511999990001,input->>from.eq.5511999990009'))).toEqual(['r1'])
    expect(await ids(runs().or('and(workflow_id.eq.wf,finished_at.not.is.null),id.in.(r3)'))).toEqual(['r2', 'r3'])
    const contacts = () => db.client.from('contacts').select('id')
    expect(await ids(contacts().ilike('name', '%ana%'))).toEqual(['ct_1'])
    expect(await ids(contacts().contains('tags', ['vip']))).toEqual(['ct_1'])
    expect(await ids(contacts().or('phone.eq.+55B,id.eq.ct_x'))).toEqual(['ct_2'])
  })

  it('projeção, count/head, maybeSingle com >1 linha (PGRST116) e coluna inexistente (42703)', async () => {
    const { data } = await db.client.from('contacts').select('id, nome:name').eq('id', 'ct_1').single()
    expect(data).toEqual({ id: 'ct_1', nome: 'Ana Souza' })
    const head = await db.client.from('workflow_runs').select('*', { count: 'exact', head: true }).eq('workflow_id', 'wf')
    expect(head).toMatchObject({ data: null, count: 2 })
    const many = await db.client.from('workflow_runs').select('*').eq('workflow_id', 'wf').maybeSingle()
    expect(many.error?.code).toBe('PGRST116')
    const missing = await db.client.from('contacts').select('id, telefone')
    expect(missing.error?.code).toBe('42703')
  })
})

describe('in-memory-supabase: falhas, hooks e rpc', () => {
  it('failNext por operação não é consumida pelo select anterior', async () => {
    const db = createInMemorySupabase({}, {}, { schema: DISPARA_SCHEMA })
    db.failNext('contacts', 'unique race', { op: 'insert', code: '23505' })
    expect((await db.client.from('contacts').select('id')).error).toBeNull()
    const { error } = await db.client.from('contacts').insert({ phone: '+55' }).select('id').single()
    expect(error).toMatchObject({ code: '23505', message: 'unique race' })
    // A falha injetada não grava nada (nem consome a sequência).
    expect((await db.client.from('contacts').insert({ phone: '+55' }).select('id').single()).data).toEqual({ id: 'ct_1' })
  })

  it('onBefore + barreira força dois claims lerem antes de qualquer CAS (só um ganha)', async () => {
    const db = createInMemorySupabase(
      { workflow_enrollments: [{ id: 'e1', workflow_id: 'wf', version_id: 'v', phone: '+55', status: 'waiting', resume_at: '2026-01-01T00:00:00.000Z' }] },
      {},
      { schema: DISPARA_SCHEMA }
    )
    const barrier = createBarrier(2)
    db.onBefore(() => barrier.wait(), { table: 'workflow_enrollments', op: 'update' })
    const claim = () =>
      db.client.from('workflow_enrollments').update({ status: 'active' }).eq('id', 'e1').eq('status', 'waiting').select('*').maybeSingle()
    const [a, b] = await Promise.all([claim(), claim()])
    expect([a.data, b.data].filter(Boolean)).toHaveLength(1)
  })

  it('rpc bulk_update_contact_tags é fiel à migration (achata, distinct, ordena, remove) e é registrada', async () => {
    const db = createInMemorySupabase(
      { contacts: [{ id: 'ct_1', phone: '+55', tags: [['vip'], 'lead', '  ', 'antigo'] }] },
      {},
      { schema: DISPARA_SCHEMA }
    )
    const { data, error } = await db.client.rpc('bulk_update_contact_tags', {
      p_ids: ['ct_1', 'ct_inexistente'],
      p_tags_to_add: ['quente', 'lead'],
      p_tags_to_remove: ['antigo'],
    })
    expect(error).toBeNull()
    expect(data).toBe(1)
    expect(db.row('contacts', { id: 'ct_1' })?.tags).toEqual(['lead', 'quente', 'vip'])
    expect(db.rpcCalls.map((c) => c.name)).toEqual(['bulk_update_contact_tags'])
    db.failNext('bulk_update_contact_tags', 'boom', 'rpc')
    expect((await db.client.rpc('bulk_update_contact_tags', { p_ids: [] })).error?.message).toBe('boom')
  })
})

// ─── Mock da Graph API ─────────────────────────────────────────────────────────

describe('meta-send-mock', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('captura o envio com corpo parseado, simula erro por código e bloqueia rede', async () => {
    const meta = createMetaSendMock().install()
    const send = (to: string) =>
      fetch('https://graph.facebook.com/v24.0/123/messages', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'oi' } }),
      })
    const ok = await send('+5511999990001')
    expect((await ok.json()).messages[0].id).toBe('wamid.TEST000001')
    meta.failNext(131047)
    const failed = await send('+5511999990001')
    expect(failed.status).toBe(400)
    expect((await failed.json()).error.code).toBe(131047)
    expect(meta.texts()).toEqual(['oi'])
    expect(meta.sent[1]).toMatchObject({ phoneNumberId: '123', accessToken: 'tok', messageId: null, error: { code: 131047 } })
    expect(metaError(190).status).toBe(401)
    await expect(fetch('https://exemplo.test/api')).rejects.toThrow(/fetch não esperado/)
  })
})

// ─── Harness: rotas reais ponta a ponta ────────────────────────────────────────

describe('workflow-harness (rotas reais)', () => {
  let h: WorkflowTestContext
  beforeEach(async () => {
    h = setupWorkflowTest()
    await resetWorkflowCaches()
  })
  afterEach(() => teardownWorkflowTest())

  it('fábricas cobrem todos os passos; compile real recusa split/goto como a UI', () => {
    const root = chain(
      steps.whatsapp({ id: 'w1', message: 'Olá' }),
      steps.wait({ id: 'wt', value: 5 }),
      steps.condition({ id: 'c', branches: [{ label: 'Preço', value: 'preço', child: steps.tag({ id: 't', tags: ['quente'] }) }] }),
      steps.tagRemove({ id: 'tr', tags: ['frio'] }),
      steps.pipeline({ id: 'p' }),
      steps.end({ id: 'e' })
    )
    const graph = compile(makeFlow({ trigger: triggers.campaignReply({ campaignId: SEED_IDS.campaign }), root }))
    expect(graph.nodes.find((n) => n.id === '__trigger')?.data.config).toMatchObject({ triggerType: 'CampaignReply', campaignId: 'c_promo' })
    expect(headsAfterTrigger(graph)).toEqual(['w1'])
    expect(() => compile(makeFlow({ root: steps.split({ paths: [{ label: 'A', percent: 50 }, { label: 'B', percent: 50 }] }) }))).toThrow(FlowCompileError)
    expect(() => compile(makeFlow({ root: steps.goto({ targetId: null }) }))).toThrow(FlowCompileError)
  })

  it('publishFlow (PATCH + publish reais) ≡ seedPublishedFlow: v1 arquivada, v2 publicada e ativa', async () => {
    const flow = makeFlow({ id: 'wf-a', trigger: triggers.keywords(['oi']), root: steps.whatsapp({ id: 'w1', message: 'Olá!' }) })
    const viaRoutes = await publishFlow(h.db, flow)
    const direct = await seedPublishedFlow(h.db, { ...flow, id: 'wf-b' }, { workflowId: 'wf-b' })
    for (const p of [viaRoutes, direct]) {
      expect(p.version).toBe(2)
      expect(h.db.row('workflows', { id: p.workflowId })).toMatchObject({ status: 'published', active_version_id: p.versionId })
      expect(h.db.row('workflow_versions', { id: p.draftVersionId! })?.status).toBe('archived')
      expect(h.db.row('workflow_versions', { id: p.versionId })).toMatchObject({ status: 'published', tree: { root: { id: 'w1' } } })
    }
    expect(viaRoutes.nodes).toEqual(direct.nodes)
  })

  it('webhook (texto "oi") → execute via reinvokeSelf → mensagem enviada; reentrega da Meta é deduplicada', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      makeFlow({ id: 'wf-oi', trigger: triggers.keywords(['oi']), root: steps.whatsapp({ id: 'w1', message: 'Olá! Bem-vindo.' }) })
    )
    const message = metaInbound.text({ from: TEST_PHONES.ana, body: 'Oi' })
    const res = await routes.webhook(metaWebhookBody({ messages: [message] }))
    expect(res.status).toBe(200)
    expect(selfInvokeCalls).toEqual([
      { path: `/api/builder/workflow/${workflowId}/execute`, body: expect.objectContaining({ input: expect.objectContaining({ message: 'Oi' }) }) },
    ])
    const [run] = await flushSelfInvokes()
    expect(run.result).toMatchObject({ status: 200, body: { status: 'success' } })
    expect(h.meta.sentTo(TEST_PHONES.ana).map((m) => m.text)).toEqual(['Olá! Bem-vindo.'])
    expect(h.db.row('workflow_runs', { workflow_id: workflowId })).toMatchObject({ status: 'success', trigger_type: 'Keywords' })

    await routes.webhook(metaWebhookBody({ messages: [message] })) // mesma wamid
    expect(selfInvokeCalls).toHaveLength(0)
  })

  it('Perguntar: webhook → pergunta + conversa; botão interativo → resume → branch certa', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      makeFlow({
        id: 'wf-ask',
        root: steps.interactive({
          id: 'ask',
          message: 'Quer a proposta?',
          buttons: [
            { label: 'Sim', child: steps.whatsapp({ id: 'yes', message: 'Enviando a proposta!' }) },
            { label: 'Não', child: steps.whatsapp({ id: 'no', message: 'Tudo bem.' }) },
          ],
        }),
      })
    )
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.bruno, body: 'oi' })] }))
    await flushSelfInvokes()
    expect(h.db.row('workflow_conversations', { workflow_id: workflowId })).toMatchObject({
      status: 'waiting',
      phone: TEST_PHONES.bruno,
      resume_node_id: 'ask__var',
    })
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.interactiveButton({ from: TEST_PHONES.bruno, title: 'Sim' })] }))
    expect(selfInvokeCalls[0]?.path).toBe(`/api/builder/workflow/${workflowId}/resume`)
    await flushSelfInvokes()
    expect(h.meta.sentTo(TEST_PHONES.bruno).map((m) => m.text ?? m.interactiveText)).toEqual([
      expect.stringContaining('Quer a proposta?'),
      'Enviando a proposta!',
    ])
    expect(h.db.row('workflow_conversations', { workflow_id: workflowId })?.status).toBe('completed')
  })

  it('sem gatilho: /enroll → drain envia, pausa no Aguardar e retoma quando vence (tag aplicada via rpc)', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId } = await seedPublishedFlow(
      h.db,
      makeFlow({
        id: 'wf-manual',
        trigger: triggers.none(),
        root: chain(
          steps.whatsapp({ id: 'm1', message: 'Primeira' }),
          steps.wait({ id: 'w', value: 10, unit: 'minutes' }),
          steps.tag({ id: 't', tags: ['nutrido'] }),
          steps.whatsapp({ id: 'm2', message: 'Segunda' })
        ),
      })
    )
    const enroll = await routes.enroll(workflowId, { contactIds: [SEED_IDS.contacts.ana] })
    expect(enroll.body).toMatchObject({ success: true, enrolled: 1 })

    expect(await routes.drain()).toMatchObject({ claimed: 1, paused: 1 })
    expect(h.meta.texts()).toEqual(['Primeira'])
    const waiting = h.db.row('workflow_enrollments', { workflow_id: workflowId })
    expect(waiting).toMatchObject({ status: 'waiting', resume_node_ids: ['t'], resume_at: '2026-10-18T12:10:00.000Z' })

    expect(await routes.drain()).toMatchObject({ claimed: 0 }) // ainda não venceu
    advanceTime(10 * 60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Primeira', 'Segunda'])
    expect(h.db.row('contacts', { id: SEED_IDS.contacts.ana })?.tags).toEqual(['lead', 'nutrido'])
    expect(h.db.row('workflow_enrollments', { workflow_id: workflowId })?.status).toBe('completed')
  })

  it('createWorkflowDb aceita seed extra sem perder o padrão (settings mesclado por key)', () => {
    const db = createWorkflowDb({ settings: [{ key: 'company_id', value: 'outra' }], contacts: [{ phone: '+5511900000000' }] })
    expect(db.row('settings', { key: 'company_id' })?.value).toBe('outra')
    expect(db.row('settings', { key: 'accessToken' })).toBeDefined()
    expect(db.count('contacts')).toBe(3)
  })
})
