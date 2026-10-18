// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/builder/workflow/[workflowId]/resume — retomada do "Perguntar" quando o contato
 * responde — e lib/builder/workflow-conversations.ts (a "espera" da pergunta).
 *
 * Código REAL ponta a ponta: compileFlow → PATCH/publish (rotas reais) → /execute pausa na
 * Pergunta (workflow_conversations) → /resume (ou o webhook real da Meta → reinvokeSelf →
 * flushSelfInvokes) → executor real → Graph API mockada → Supabase em memória.
 * Também cobre a branch Timeout (que a tela cria e o motor não implementa).
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
  handleDeliveryStatus: vi.fn(async () => {}),
}))

import { completeConversation, createConversation, getPendingConversation } from '@/lib/builder/workflow-conversations'
import { drainWorkflowEnrollments } from '@/lib/cron/workflow-enrollments'
import { addStep, createEmptyFlow, findStep } from '@/lib/builder/flow/operations'
import { FlowCompileError } from '@/lib/builder/flow/compile'
import { setActiveSupabase, type Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  compile,
  flushSelfInvokes,
  freezeTime,
  jsonRequest,
  makeFlow,
  metaInbound,
  metaWebhookBody,
  publishFlow,
  resetWorkflowCaches,
  routeParams,
  routes,
  selfInvokeCalls,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_API_KEY,
  TEST_PHONES,
  triggers,
  waId,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'
import type { Flow, FlowTrigger, Step } from '@/lib/builder/flow/types'

const T = '2026-10-19T12:00:00.000Z' // segunda-feira
const MIN = 60_000
const DAY = 24 * 60 * MIN
const at = (ms: number) => new Date(Date.parse(T) + ms).toISOString()

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
  freezeTime(T)
})
afterEach(() => teardownWorkflowTest())

type RouteBody = { executionId: string; status: string; error?: string; output?: Record<string, unknown> }

function flowOf(id: string, root: Step | null, trigger: FlowTrigger = triggers.keywords(['oi'])): Flow {
  return makeFlow({ id, trigger, root })
}

/** Perguntar(Sim → wSim, Não → wNao) → wDepois. */
const askFlow = (id = 'wf-ask') =>
  flowOf(
    id,
    chain(
      steps.interactive({
        id: 'ask',
        message: 'Quer a proposta?',
        buttons: [
          { label: 'Sim', child: steps.whatsapp({ id: 'wSim', message: 'Enviando a proposta!' }) },
          { label: 'Não', child: steps.whatsapp({ id: 'wNao', message: 'Tudo bem, até logo.' }) },
        ],
      }),
      steps.whatsapp({ id: 'wDepois', message: 'Obrigado pela resposta.' })
    )
  )

async function startAsk(flow: Flow = askFlow(), phone: string = TEST_PHONES.ana) {
  const published = await publishFlow(h.db, flow)
  const res = await routes.execute(published.workflowId, { input: { from: waId(phone), to: waId(phone), message: 'oi' } })
  const conv = h.db.rows('workflow_conversations').filter((c) => c.workflow_id === published.workflowId && c.status === 'waiting').at(-1)
  return { ...published, executeRunId: (res.body as RouteBody).executionId, conversation: conv as Row }
}

async function resume(workflowId: string, conversationId: string | undefined, message: string | undefined, phone: string = TEST_PHONES.ana) {
  const res = await routes.resume(workflowId, { conversationId, input: { from: phone, to: phone, message } })
  return { ...res, body: res.body as RouteBody }
}

const conv = (id: string) => h.db.row('workflow_conversations', { id }) as Row
const runsOf = (workflowId: string, trigger?: string) =>
  h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId && (trigger === undefined || r.trigger_type === trigger))

// ─── Autenticação e validações ────────────────────────────────────────────────

describe('resume: autenticação e validações (sem consumir a conversa)', () => {
  it('RES-01a: sem auth ou com API key de sessão → 401; a conversa continua esperando', async () => {
    const { workflowId, conversation } = await startAsk()
    const body = { conversationId: conversation.id, input: { from: TEST_PHONES.ana, message: 'Sim' } }
    expect((await routes.resume(workflowId, body, { auth: false })).status).toBe(401)

    const mod = await import('@/app/api/builder/workflow/[workflowId]/resume/route')
    const response = await mod.POST(
      jsonRequest(`/api/builder/workflow/${workflowId}/resume`, body, { headers: { authorization: `Bearer ${TEST_API_KEY}` } }),
      routeParams(workflowId)
    )
    expect(response.status).toBe(401)
    expect(conv(conversation.id).status).toBe('waiting')
    expect(h.meta.texts()).toEqual(['Quer a proposta?'])
    expect(runsOf(workflowId, 'Resume')).toHaveLength(0)
  })

  it.each([
    ['sem conversationId', 'missing-id', 'Missing workflowId or conversationId'],
    ['conversa inexistente', 'nao-existe', 'Conversation not found'],
    ['mensagem em branco', 'blank', 'Missing inbound message'],
    ['mensagem ausente', 'nomsg', 'Missing inbound message'],
  ])('RES-01b: %s → 200 {status: failed} com a mensagem certa, sem envio', async (_label, kind, error) => {
    const { workflowId, conversation } = await startAsk()
    const id = kind === 'missing-id' ? undefined : kind === 'nao-existe' ? 'conv-fantasma' : conversation.id
    const message = kind === 'blank' ? '   ' : kind === 'nomsg' ? undefined : 'Sim'
    const res = await resume(workflowId, id, message)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'failed', error })
    expect(conv(conversation.id).status).toBe('waiting')
    expect(h.meta.texts()).toEqual(['Quer a proposta?'])
    expect(runsOf(workflowId, 'Resume')).toHaveLength(0)
  })

  it('RES-01c: conversa já concluída → "Conversation not found"', async () => {
    const { workflowId, conversation } = await startAsk()
    h.db.update('workflow_conversations', { id: conversation.id }, { status: 'completed' })
    expect((await resume(workflowId, conversation.id, 'Sim')).body).toMatchObject({ status: 'failed', error: 'Conversation not found' })
    expect(h.meta.sent).toHaveLength(1)
  })

  it('RES-01d: conversa de OUTRO workflow → "Conversation workflow mismatch", sem consumir', async () => {
    const { conversation } = await startAsk()
    await publishFlow(h.db, flowOf('wf-outro', chain(steps.whatsapp({ id: 'x', message: 'x' }))))
    expect((await resume('wf-outro', conversation.id, 'Sim')).body).toMatchObject({ status: 'failed', error: 'Conversation workflow mismatch' })
    expect(conv(conversation.id).status).toBe('waiting')
  })

  it.each([
    ['resume_node_id', 'Conversation missing resume node'],
    ['variable_key', 'Conversation missing variable key'],
  ])('RES-01e: conversa sem %s → "%s"', async (column, error) => {
    const { workflowId, conversation } = await startAsk()
    h.db.update('workflow_conversations', { id: conversation.id }, { [column]: null })
    expect((await resume(workflowId, conversation.id, 'Sim')).body).toMatchObject({ status: 'failed', error })
    expect(conv(conversation.id).status).toBe('waiting')
  })

  it('RES-01f: sem Supabase → 200 {status: failed, "Supabase not configured"}', async () => {
    const { workflowId, conversation } = await startAsk()
    setActiveSupabase(null)
    const res = await resume(workflowId, conversation.id, 'Sim')
    setActiveSupabase(h.db)
    expect(res.body).toMatchObject({ status: 'failed', error: 'Supabase not configured' })
    expect(conv(conversation.id).status).toBe('waiting')
  })
})

// ─── Roteamento pela resposta ─────────────────────────────────────────────────

describe('resume: a resposta escolhe a branch certa', () => {
  it('RES-00: a Pergunta pausa com a conversa pendente apontando para o nó de retomada', async () => {
    const { workflowId, conversation, executeRunId } = await startAsk()
    expect(conversation).toMatchObject({
      workflow_id: workflowId,
      phone: TEST_PHONES.ana,
      status: 'waiting',
      resume_node_id: 'ask__var',
      variable_key: 'reply_ask',
    })
    expect(h.db.row('workflow_runs', { id: executeRunId })?.status).toBe('waiting')
    expect(h.meta.texts()).toEqual(['Quer a proposta?'])
  })

  it.each([
    ['Sim', ['Enviando a proposta!', 'Obrigado pela resposta.']],
    ['Não', ['Tudo bem, até logo.', 'Obrigado pela resposta.']],
    ['talvez', ['Obrigado pela resposta.']],
  ])('RES-02: resposta "%s" → envia só a branch dela e depois a continuação', async (answer, expected) => {
    const { workflowId, conversation } = await startAsk()
    const res = await resume(workflowId, conversation.id, answer)
    expect(res.status).toBe(200)
    expect(h.meta.texts()).toEqual(['Quer a proposta?', ...expected])
    expect(conv(conversation.id)).toMatchObject({ status: 'completed', variables: expect.objectContaining({ reply_ask: answer }) })
    const [run] = runsOf(workflowId, 'Resume')
    expect(run).toMatchObject({ id: res.body.executionId })
    expect(run.status).not.toBe('running')
    expect(run.finished_at).not.toBeNull()
  })

  it('RES-03: igualdade exata e sensível a maiúsculas; o trim é feito na rota (caracterização)', async () => {
    const a = await startAsk(askFlow('wf-case-a'))
    await resume(a.workflowId, a.conversation.id, 'sim')
    expect(h.meta.texts()).toEqual(['Quer a proposta?', 'Obrigado pela resposta.']) // 'sim' cai no else

    h.meta.reset()
    const b = await startAsk(askFlow('wf-case-b'))
    await resume(b.workflowId, b.conversation.id, '  Sim  ')
    expect(h.meta.texts()).toEqual(['Quer a proposta?', 'Enviando a proposta!', 'Obrigado pela resposta.'])
    expect(conv(b.conversation.id).variables).toMatchObject({ reply_ask: 'Sim' })
  })

  // BUG(perguntar-sem-botoes): a tela configura 1-3 botões (limite de 20 caracteres, o do
  // WhatsApp), mas o compile emite whatsapp/ask-question SEM botões e o passo monta uma
  // mensagem de texto (type 'text'). O contato nunca vê botões e precisa digitar o rótulo
  // exato ('sim' cai em "Outra resposta"). lib/builder/flow/compile.ts:418-429 +
  // lib/builder/steps/whatsapp/ask-question.ts:51.
  it.fails('RES-04: BUG(perguntar-sem-botoes) — Perguntar deveria enviar botões interativos com os rótulos', async () => {
    await startAsk()
    const [sent] = h.meta.sent
    expect(sent.type).toBe('interactive')
    const action = (sent.body.interactive as { action?: { buttons?: Array<{ reply: { title: string } }> } })?.action
    expect(action?.buttons?.map((b) => b.reply.title)).toEqual(['Sim', 'Não'])
  })

  it('RES-04a: hoje a Pergunta sai como texto puro (caracterização)', async () => {
    await startAsk()
    expect(h.meta.sent[0]).toMatchObject({ type: 'text', text: 'Quer a proposta?', to: TEST_PHONES.ana })
  })

  it('RES-05: resume repetido em sequência é idempotente (2ª chamada não reenvia nada)', async () => {
    const { workflowId, conversation } = await startAsk()
    await resume(workflowId, conversation.id, 'Sim')
    expect(h.meta.texts()).toContain('Enviando a proposta!')
    const sentAfterFirst = h.meta.sent.length
    const second = await resume(workflowId, conversation.id, 'Sim')
    expect(second.body).toMatchObject({ status: 'failed', error: 'Conversation not found' })
    expect(h.meta.sent).toHaveLength(sentAfterFirst)
    expect(runsOf(workflowId, 'Resume')).toHaveLength(1)
  })

  // BUG(resume-sem-claim): a rota lê a conversa 'waiting' sem CAS, executa o fluxo inteiro e
  // só no fim chama completeConversation. O dedupe do webhook é por message.id: duas
  // mensagens rápidas (ids diferentes) acham a conversa ainda pendente, disparam dois
  // /resume e a branch é enviada duas vezes. Falta um claim waiting→processing antes de
  // executar. app/api/builder/workflow/[workflowId]/resume/route.ts:75-80,159-175.
  it.fails('RES-06: BUG(resume-sem-claim) — dois resumes simultâneos não podem executar a resposta duas vezes', async () => {
    const { workflowId, conversation } = await startAsk()
    await Promise.all([resume(workflowId, conversation.id, 'Sim'), resume(workflowId, conversation.id, 'Sim')])
    expect(h.meta.texts().filter((t) => t === 'Enviando a proposta!')).toHaveLength(1)
  })

  it('RES-06a: caracterização — hoje os dois resumes simultâneos enviam a branch duas vezes', async () => {
    const { workflowId, conversation } = await startAsk()
    await Promise.all([resume(workflowId, conversation.id, 'Sim'), resume(workflowId, conversation.id, 'Sim')])
    expect(h.meta.texts().filter((t) => t === 'Enviando a proposta!')).toHaveLength(2)
    expect(runsOf(workflowId, 'Resume')).toHaveLength(2)
  })

  // BUG(run-pergunta-orfa): o run do /execute que pausou na Pergunta é marcado 'waiting' e
  // nunca mais é tocado — o /resume cria um run NOVO ('Resume') e a conversa nem guarda o
  // run_id. Todo contato que respondeu deixa um run 'waiting' eterno no painel.
  it.fails('RES-09: BUG(run-pergunta-orfa) — o run que pausou na Pergunta deveria ser finalizado após a resposta', async () => {
    const { workflowId, conversation, executeRunId } = await startAsk()
    await resume(workflowId, conversation.id, 'Sim')
    expect(h.db.row('workflow_runs', { id: executeRunId })?.status).not.toBe('waiting')
  })
})

// ─── Resposta que cai em Aguardar / nova Pergunta ─────────────────────────────

describe('resume: continuação durável depois da resposta', () => {
  it('RES-07: a branch escolhida cai num Aguardar → enrollment com a resposta nas variáveis; o cron envia depois', async () => {
    const flow = flowOf(
      'wf-ask-wait',
      steps.interactive({
        id: 'ask',
        message: 'Quer lembrete?',
        buttons: [
          { label: 'Sim', child: chain(steps.wait({ id: 'w', value: 3 }), steps.whatsapp({ id: 'wLembrete', message: 'Lembrete: {{var.reply_ask}}' })) },
          'Não',
        ],
      })
    )
    const { workflowId, conversation } = await startAsk(flow)
    const res = await resume(workflowId, conversation.id, 'Sim')
    expect(res.body.status).toBe('waiting')
    expect(conv(conversation.id).status).toBe('completed')
    const [enr] = h.db.rows('workflow_enrollments').filter((e) => e.workflow_id === workflowId)
    expect(enr).toMatchObject({
      status: 'waiting',
      phone: TEST_PHONES.ana,
      resume_at: at(3 * MIN),
      resume_node_ids: ['wLembrete'],
      run_id: res.body.executionId,
      variables: expect.objectContaining({ reply_ask: 'Sim' }),
    })
    expect(h.db.row('workflow_runs', { id: res.body.executionId })).toMatchObject({ status: 'waiting', output: { status: 'waiting', waitKind: 'delay' } })

    advanceTime(3 * MIN - 1)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    advanceTime(1)
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Quer lembrete?', 'Lembrete: Sim'])
  })

  it('RES-08: 2ª Pergunta carrega a resposta da 1ª (variáveis persistidas na conversa)', async () => {
    const flow = flowOf(
      'wf-two-asks',
      chain(
        steps.interactive({ id: 'ask1', message: 'Plano A ou B?', buttons: ['A', 'B'] }),
        steps.interactive({ id: 'ask2', message: 'Confirma?', buttons: ['Ok', 'Cancelar'] }),
        steps.whatsapp({ id: 'wFim', message: 'Plano {{var.reply_ask1}}: {{var.reply_ask2}}' })
      )
    )
    const { workflowId, conversation: c1 } = await startAsk(flow)
    await resume(workflowId, c1.id, 'A')
    expect(conv(c1.id).status).toBe('completed')
    const c2 = h.db.rows('workflow_conversations').find((c) => c.status === 'waiting')!
    expect(c2).toMatchObject({ resume_node_id: 'ask2__var', variable_key: 'reply_ask2', variables: expect.objectContaining({ reply_ask1: 'A' }) })
    expect(h.meta.texts()).toEqual(['Plano A ou B?', 'Confirma?'])

    await resume(workflowId, c2.id, 'Ok')
    expect(conv(c2.id)).toMatchObject({ status: 'completed', variables: expect.objectContaining({ reply_ask1: 'A', reply_ask2: 'Ok' }) })
    expect(h.meta.texts()).toEqual(['Plano A ou B?', 'Confirma?', 'Plano A: Ok'])
  })

  it('RES-08b: Condição depois da 2ª Pergunta avalia a resposta da pergunta MAIS PRÓXIMA (caracterização)', async () => {
    const flow = flowOf(
      'wf-two-asks-cond',
      chain(
        steps.interactive({ id: 'ask1', message: 'Plano A ou B?', buttons: ['A', 'B'] }),
        steps.interactive({ id: 'ask2', message: 'Confirma?', buttons: ['Ok', 'Cancelar'] }),
        steps.condition({
          id: 'c',
          branches: [{ label: 'Confirmou', value: 'Ok', operator: 'equals', child: steps.whatsapp({ id: 'wOk', message: 'Confirmado' }) }],
          none: steps.whatsapp({ id: 'wNo', message: 'Cancelado' }),
        })
      )
    )
    const { workflowId, conversation: c1 } = await startAsk(flow)
    await resume(workflowId, c1.id, 'A')
    const c2 = h.db.rows('workflow_conversations').find((c) => c.status === 'waiting')!
    await resume(workflowId, c2.id, 'Cancelar')
    expect(h.meta.texts()).toEqual(['Plano A ou B?', 'Confirma?', 'Cancelado'])
  })

  it('RES-10: ponta a ponta pelo webhook real — "oi" dispara, o clique no botão "Sim" retoma pela branch certa', async () => {
    const { workflowId } = await publishFlow(h.db, askFlow('wf-hook-ask'))
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.ana, body: 'oi' })] }))
    const [started] = await flushSelfInvokes()
    expect(started.path).toBe(`/api/builder/workflow/${workflowId}/execute`)
    expect(h.meta.texts()).toEqual(['Quer a proposta?'])

    await routes.webhook(metaWebhookBody({ messages: [metaInbound.interactiveButton({ from: TEST_PHONES.ana, title: 'Sim' })] }))
    expect(selfInvokeCalls.map((c) => c.path)).toEqual([`/api/builder/workflow/${workflowId}/resume`])
    await flushSelfInvokes()
    expect(h.meta.texts()).toEqual(['Quer a proposta?', 'Enviando a proposta!', 'Obrigado pela resposta.'])
    expect(h.db.rows('workflow_conversations').map((c) => c.status)).toEqual(['completed'])
  })

  it('RES-10b: a mesma mensagem da Meta entregue duas vezes (mesmo wamid) retoma uma única vez', async () => {
    const { workflowId } = await publishFlow(h.db, askFlow('wf-hook-dup'))
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.ana, body: 'oi' })] }))
    await flushSelfInvokes()
    const reply = metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.ana, body: 'Sim', id: 'wamid.REPLY-DUP' })] })
    await routes.webhook(reply)
    await routes.webhook(reply)
    const flushed = await flushSelfInvokes()
    expect(flushed.filter((f) => f.path.endsWith('/resume'))).toHaveLength(1)
    expect(h.meta.texts().filter((t) => t === 'Enviando a proposta!')).toHaveLength(1)
    expect(runsOf(workflowId, 'Resume')).toHaveLength(1)
  })
})

// ─── workflow-conversations.ts ────────────────────────────────────────────────

describe('workflow-conversations: create / getPending / complete', () => {
  const client = () => h.db.client as never

  beforeEach(async () => {
    await publishFlow(h.db, flowOf('wf-c1', chain(steps.whatsapp({ id: 'x', message: 'x' }))))
    await publishFlow(h.db, flowOf('wf-c2', chain(steps.whatsapp({ id: 'y', message: 'y' })), triggers.keywords(['tchau'])))
  })

  it('CONV-01a: createConversation grava a linha waiting e a devolve; com erro no INSERT devolve null', async () => {
    const created = await createConversation({
      supabase: client(),
      workflowId: 'wf-c1',
      phone: TEST_PHONES.ana,
      resumeNodeId: 'ask__var',
      variableKey: 'reply_ask',
      variables: { nome: 'Ana' },
    })
    expect(created).toMatchObject({
      workflow_id: 'wf-c1',
      phone: TEST_PHONES.ana,
      status: 'waiting',
      resume_node_id: 'ask__var',
      variable_key: 'reply_ask',
      variables: { nome: 'Ana' },
      created_at: T,
      updated_at: T,
    })
    expect(h.db.rows('workflow_conversations')).toHaveLength(1)

    h.db.failNext('workflow_conversations', 'boom', 'insert')
    expect(await createConversation({ supabase: client(), workflowId: 'wf-c1', phone: TEST_PHONES.bruno })).toBeNull()
    expect(h.db.rows('workflow_conversations')).toHaveLength(1)
  })

  it('CONV-01b: getPendingConversation devolve a "waiting" mais recente DAQUELE telefone (de qualquer workflow)', async () => {
    const old = await createConversation({ supabase: client(), workflowId: 'wf-c1', phone: TEST_PHONES.ana, resumeNodeId: 'a', variableKey: 'k' })
    advanceTime(MIN)
    const recent = await createConversation({ supabase: client(), workflowId: 'wf-c2', phone: TEST_PHONES.ana, resumeNodeId: 'b', variableKey: 'k' })
    advanceTime(MIN)
    const done = await createConversation({ supabase: client(), workflowId: 'wf-c1', phone: TEST_PHONES.ana, resumeNodeId: 'c', variableKey: 'k' })
    await completeConversation(client(), done!.id, {})
    await createConversation({ supabase: client(), workflowId: 'wf-c1', phone: TEST_PHONES.bruno, resumeNodeId: 'd', variableKey: 'k' })

    expect((await getPendingConversation(client(), TEST_PHONES.ana))?.id).toBe(recent!.id)
    await completeConversation(client(), recent!.id, {})
    expect((await getPendingConversation(client(), TEST_PHONES.ana))?.id).toBe(old!.id)
    await completeConversation(client(), old!.id, {})
    expect(await getPendingConversation(client(), TEST_PHONES.ana)).toBeNull()
    expect(await getPendingConversation(client(), TEST_PHONES.carla)).toBeNull()
  })

  it('CONV-01c: completeConversation marca completed, grava as variáveis e o updated_at', async () => {
    const created = await createConversation({ supabase: client(), workflowId: 'wf-c1', phone: TEST_PHONES.ana, resumeNodeId: 'a', variableKey: 'k' })
    advanceTime(5 * MIN)
    await completeConversation(client(), created!.id, { reply_ask: 'Sim' })
    expect(conv(created!.id)).toMatchObject({ status: 'completed', variables: { reply_ask: 'Sim' }, updated_at: at(5 * MIN) })
  })

  // GAP(pergunta-sem-timeout): não existe expiração em workflow_conversations nem dreno de
  // timeout — uma pergunta sem resposta fica pendente para sempre. Se o produto definir um
  // TTL, este teste vira it.fails (ver RES-12/RES-13).
  it('CONV-02: GAP(pergunta-sem-timeout) — conversa pendente nunca expira (caracterização)', async () => {
    const created = await createConversation({ supabase: client(), workflowId: 'wf-c1', phone: TEST_PHONES.ana, resumeNodeId: 'a', variableKey: 'k' })
    advanceTime(30 * DAY)
    expect((await getPendingConversation(client(), TEST_PHONES.ana))?.id).toBe(created!.id)
  })
})

// ─── Branch Timeout da Pergunta ───────────────────────────────────────────────

describe('Perguntar × Timeout', () => {
  it('CONV-03a: a tela cria a Pergunta com as branches travadas "Not Delivered" e "Timeout"', () => {
    const { flow, stepId } = addStep(createEmptyFlow({ keywords: ['oi'] }), { type: 'interactive', slot: { kind: 'root' } })
    const step = findStep(flow, stepId)!
    expect(step.branches?.filter((b) => b.locked).map((b) => b.label)).toEqual(expect.arrayContaining(['Not Delivered', 'Timeout']))
  })

  it('CONV-03b: o compile ignora a branch Timeout vazia (nenhum nó/aresta de timeout é emitido)', () => {
    const graph = compile(askFlow('wf-to-empty'))
    const ids = graph.nodes.map((n) => n.id)
    expect(ids.some((id) => /timeout|-to\b|__to/i.test(id))).toBe(false)
    expect(ids).toEqual(expect.arrayContaining(['ask', 'ask__var', 'ask__cond_0', 'ask__cond_1', 'ask__cond_else']))
  })

  it('CONV-03c: o compile REJEITA ações na branch Timeout (a UI deixa adicionar)', () => {
    const ask = steps.interactive({ id: 'ask', message: 'Oi?', buttons: ['Sim'] })
    ask.branches!.find((b) => b.label === 'Timeout')!.child = steps.whatsapp({ id: 'wTo', message: 'Você sumiu!' })
    expect(() => compile(flowOf('wf-to-child', ask))).toThrow(FlowCompileError)
    expect(() => compile(flowOf('wf-to-child', ask))).toThrow(/Timeout/)
  })

  // BUG(pergunta-sem-timeout): a árvore nasce com a branch "Timeout" (operations.ts), mas o
  // compile recusa qualquer ação nela e não existe expiração/dreno de timeout. O usuário não
  // consegue montar "se não responder em X, manda lembrete" — o contato fica preso na pergunta.
  // lib/builder/flow/compile.ts:393-401; lib/builder/workflow-conversations.ts:50-65.
  it.fails('RES-12: BUG(pergunta-sem-timeout) — sem resposta, a branch Timeout deveria rodar (lembrete)', async () => {
    const ask = steps.interactive({ id: 'ask', message: 'Oi?', buttons: ['Sim'] })
    ask.branches!.find((b) => b.label === 'Timeout')!.child = steps.whatsapp({ id: 'wTo', message: 'Você sumiu!' })
    const { workflowId } = await startAsk(flowOf('wf-to', ask))
    advanceTime(2 * DAY)
    await drainWorkflowEnrollments()
    expect(h.meta.texts()).toEqual(['Oi?', 'Você sumiu!'])
    expect(h.db.rows('workflow_conversations').filter((c) => c.workflow_id === workflowId).map((c) => c.status)).not.toContain('waiting')
  })

  // BUG(pergunta-sequestra-palavra-chave): consequência do GAP acima — getPendingConversation
  // pega a conversa 'waiting' mais recente de QUALQUER workflow e o webhook dá `continue`.
  // Semanas depois, uma palavra-chave de OUTRO fluxo é consumida como resposta da pergunta
  // antiga e o fluxo novo nunca dispara. app/api/webhook/route.ts:1385-1403.
  it.fails('RES-13: BUG(pergunta-sequestra-palavra-chave) — pergunta esquecida não deveria engolir a palavra-chave de outro fluxo', async () => {
    const { workflowId: askWf } = await startAsk(askFlow('wf-velha'))
    await publishFlow(h.db, flowOf('wf-promo', chain(steps.whatsapp({ id: 'p', message: 'Promoção do dia!' })), triggers.keywords(['promo'])))
    advanceTime(30 * DAY)
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.ana, body: 'promo' })] }))
    const flushed = await flushSelfInvokes()
    expect(flushed.map((f) => f.path)).toContain('/api/builder/workflow/wf-promo/execute')
    expect(flushed.map((f) => f.path)).not.toContain(`/api/builder/workflow/${askWf}/resume`)
    expect(h.meta.texts()).toContain('Promoção do dia!')
  })

  it('RES-13a: caracterização — hoje a palavra-chave vira resposta da pergunta antiga', async () => {
    const { workflowId: askWf, conversation } = await startAsk(askFlow('wf-velha-a'))
    await publishFlow(h.db, flowOf('wf-promo-a', chain(steps.whatsapp({ id: 'p', message: 'Promoção do dia!' })), triggers.keywords(['promo'])))
    advanceTime(30 * DAY)
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.ana, body: 'promo' })] }))
    const flushed = await flushSelfInvokes()
    expect(flushed.map((f) => f.path)).toEqual([`/api/builder/workflow/${askWf}/resume`])
    expect(conv(conversation.id)).toMatchObject({ status: 'completed', variables: expect.objectContaining({ reply_ask: 'promo' }) })
    expect(h.meta.texts()).not.toContain('Promoção do dia!')
  })

  it('RES-14: resposta antes de qualquer prazo retoma pela branch certa e encerra a espera da pergunta', async () => {
    const { workflowId, conversation } = await startAsk()
    advanceTime(10 * MIN)
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from: TEST_PHONES.ana, body: 'Não' })] }))
    await flushSelfInvokes()
    expect(h.meta.texts()).toEqual(['Quer a proposta?', 'Tudo bem, até logo.', 'Obrigado pela resposta.'])
    expect(conv(conversation.id).status).toBe('completed')
    expect(await getPendingConversation(h.db.client as never, TEST_PHONES.ana)).toBeNull()
    expect(runsOf(workflowId, 'Resume')).toHaveLength(1)
  })
})
