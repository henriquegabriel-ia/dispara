// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Gatilhos de workflow no webhook da Meta, ponta a ponta e com as rotas REAIS:
 * webhook → reinvokeSelf → /execute | /resume → executor → Graph API.
 * O banco é o Supabase em memória (esquema do Dispara) e a Graph é mockada; nada vai à rede.
 *
 * Cobre:
 * - palavra-chave (match exato normalizado, precedência, rascunho/arquivada, reentrega);
 * - fluxo padrão (settings / env);
 * - "Respondeu ao disparo" (CampaignReply: campanha, frase, variantes do 9, reentrada);
 * - conversa pendente do Perguntar (texto, botão, lista, botão de template);
 * - Stop on Response, opt-out, assinatura e resiliência;
 * - o gate de palavra-chave do /execute e a validação do /resume.
 *
 * Bugs de produto ficam em it.fails, com o comportamento CORRETO e um comentário BUG(...);
 * os já corrigidos viraram `it` com o comentário "Corrigido BUG(...)".
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
  handleDeliveryStatus: vi.fn(async () => {}),
}))

import { compileFlow } from '@/lib/builder/flow/compile'
import { updateTrigger } from '@/lib/builder/flow/operations'
import type { Flow, Step } from '@/lib/builder/flow/types'
import type { WorkflowSettings } from '@/lib/builder/workflow-settings'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  createBarrier,
  flushSelfInvokes,
  freezeTime,
  headsAfterTrigger,
  jsonRequest,
  makeFlow,
  metaInbound,
  metaWebhookBody,
  publishFlow,
  resetWorkflowCaches,
  routeParams,
  routes,
  SEED_IDS,
  seedPublishedFlow,
  selfInvokeCalls,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_ADMIN_KEY,
  TEST_PHONES,
  triggers,
  waId,
  type MetaInboundMessage,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

// ─── Contexto e utilitários ────────────────────────────────────────────────────

/** Contato padrão (celular BR com o 9). A Meta manda o `from` só com dígitos. */
const ANA = TEST_PHONES.ana // +5511999990001
const ANA_WA = waId(ANA) // 5511999990001
/** Mesmo celular sem o 9 (wa_id legado que a Meta ainda manda para números antigos). */
const ANA_SEM_9 = '+551199990001'

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

const executePath = (id: string) => `/api/builder/workflow/${id}/execute`
const resumePath = (id: string) => `/api/builder/workflow/${id}/resume`
const executeCalls = () => selfInvokeCalls.filter((c) => c.path.endsWith('/execute'))
const resumeCalls = () => selfInvokeCalls.filter((c) => c.path.endsWith('/resume'))
/** ids dos workflows despachados para /execute, em ordem */
const executedIds = () => executeCalls().map((c) => c.path.split('/')[4])
const inputOf = (call: { body: Record<string, unknown> }) => call.body.input as Record<string, unknown>
const textsTo = (phone: string) => h.meta.sentTo(phone).map((m) => m.text ?? m.interactiveText)

async function receive(...messages: MetaInboundMessage[]) {
  const res = await routes.webhook(metaWebhookBody({ messages }))
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ status: 'ok' })
  return res
}

const receiveText = (body: string, from: string = ANA) => receive(metaInbound.text({ from, body }))

/** Fluxo de palavra-chave com o gatilho montado pela MESMA operação da tela (updateTrigger). */
function keywordFlow(id: string, keywords: string[], root?: Step | null): Flow {
  const base = makeFlow({
    id,
    name: `Fluxo ${id}`,
    root: root === undefined ? steps.whatsapp({ id: `${id}-msg`, message: `Resposta ${id}` }) : root,
  })
  return updateTrigger(base, { type: 'keywords', keywords })
}

function publishKeywords(id: string, keywords: string[], opts: { settings?: WorkflowSettings; root?: Step | null } = {}) {
  return publishFlow(h.db, keywordFlow(id, keywords, opts.root), { settings: opts.settings })
}

function campaignReplyFlow(id: string, o: { campaignId?: string | null; replyFilter?: string } = {}): Flow {
  return makeFlow({
    id,
    name: `Fluxo ${id}`,
    trigger: triggers.campaignReply({ campaignId: o.campaignId ?? null, replyFilter: o.replyFilter }),
    root: steps.whatsapp({ id: `${id}-msg`, message: `Resposta ${id}` }),
  })
}

function publishCampaignReply(
  id: string,
  o: { campaignId?: string | null; replyFilter?: string; settings?: WorkflowSettings } = {}
) {
  return publishFlow(h.db, campaignReplyFlow(id, o), { settings: o.settings })
}

function noneFlow(id: string, root?: Step | null): Flow {
  return makeFlow({
    id,
    name: `Fluxo ${id}`,
    trigger: triggers.none(),
    root: root === undefined ? steps.whatsapp({ id: `${id}-msg`, message: `Resposta ${id}` }) : root,
  })
}

/** "Marcar como padrão" da lista de fluxos: a rota real grava settings.workflow_builder_default_id. */
async function markAsDefault(workflowId: string) {
  const mod = await import('@/app/api/settings/workflow-builder/route')
  const res = await mod.POST(
    new Request('http://localhost:3000/api/settings/workflow-builder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultWorkflowId: workflowId }),
    })
  )
  expect(res.status).toBe(200)
  expect(h.db.row('settings', { key: 'workflow_builder_default_id' })?.value).toBe(workflowId)
}

let ccSeq = 0
/** campaign_contact de um disparo já enviado (status/sent_at configuráveis). */
function seedCampaignContact(o: { phone?: string; campaignId?: string; status?: string; sentAt?: string | null } = {}): Row {
  ccSeq += 1
  const [row] = h.db.insert('campaign_contacts', {
    id: `cc-teste-${ccSeq}`,
    campaign_id: o.campaignId ?? SEED_IDS.campaign,
    phone: o.phone ?? ANA,
    status: o.status ?? 'delivered',
    sent_at: o.sentAt === undefined ? new Date(Date.now() - 60_000).toISOString() : o.sentAt,
  })
  return row
}

function seedWorkflowRow(id: string, settings: Row = {}) {
  h.db.insert('workflows', { id, name: `Fluxo ${id}`, status: 'published', settings })
}

/** Espera durável (Aguardar) de um contato num fluxo. */
function seedWait(o: { workflowId: string; phone?: string; status?: string; waitKind?: string | null }): Row {
  const [row] = h.db.insert('workflow_enrollments', {
    workflow_id: o.workflowId,
    version_id: 'v-teste',
    phone: o.phone ?? ANA,
    status: o.status ?? 'waiting',
    wait_kind: o.waitKind === undefined ? 'delay' : o.waitKind,
    resume_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    resume_node_ids: ['n2'],
  })
  return row
}

let cvSeq = 0
/** Pergunta pendente (o que o executor grava ao pausar no Perguntar). */
function seedConversation(o: { workflowId: string; id?: string; phone?: string; status?: string; updatedAt?: string }): Row {
  cvSeq += 1
  const at = o.updatedAt ?? new Date().toISOString()
  const [row] = h.db.insert('workflow_conversations', {
    id: o.id ?? `cv-teste-${cvSeq}`,
    workflow_id: o.workflowId,
    phone: o.phone ?? ANA,
    status: o.status ?? 'waiting',
    resume_node_id: 'ask__var',
    variable_key: 'reply_ask',
    variables: {},
    created_at: at,
    updated_at: at,
  })
  return row
}

const enrollmentStatus = (id: unknown) => h.db.row('workflow_enrollments', { id: id as string })?.status

/** Perguntar com 2 botões (Sim → "A", Não → "B") e continuação "fim". */
function menuFlow(id = 'wf-menu', keyword = 'menu'): Flow {
  return keywordFlow(
    id,
    [keyword],
    steps.interactive({
      id: 'ask',
      message: 'Quer a proposta?',
      buttons: [
        { label: 'Sim', child: steps.whatsapp({ id: 'yes', message: 'A' }) },
        { label: 'Não', child: steps.whatsapp({ id: 'no', message: 'B' }) },
      ],
      next: steps.whatsapp({ id: 'end-msg', message: 'fim' }),
    })
  )
}

// ─── Palavra-chave ─────────────────────────────────────────────────────────────

describe('Gatilho Palavras-chave: despacho pelo webhook', () => {
  it('WH-01: mensagem exata dispara só o fluxo publicado daquela palavra (payload real, sem assinatura) e envia a resposta', async () => {
    await publishKeywords('wf-quero', ['quero'])
    await publishKeywords('wf-oi', ['oi'])

    await receiveText('quero')

    expect(selfInvokeCalls).toEqual([
      {
        path: executePath('wf-quero'),
        body: { input: { from: ANA_WA, to: ANA_WA, message: 'quero' }, source: 'self-reinvoke' },
      },
    ])
    expect(h.db.rows('processed_inbound_messages')).toHaveLength(1)

    const [run] = await flushSelfInvokes()
    expect(run.result).toMatchObject({ status: 200, body: { status: 'success' } })
    expect(textsTo(ANA)).toEqual(['Resposta wf-quero'])
    expect(h.db.row('workflow_runs', { workflow_id: 'wf-quero' })).toMatchObject({
      status: 'success',
      trigger_type: 'Keywords',
      input: { from: ANA_WA, message: 'quero' },
    })
  })

  it('várias palavras no mesmo fluxo (uma por linha): qualquer uma dispara', async () => {
    await publishKeywords('wf-saudacao', ['oi', 'olá', 'bom dia'])
    expect(
      h.db.row('workflow_versions', { workflow_id: 'wf-saudacao', status: 'published' })?.nodes
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: '__trigger', data: expect.objectContaining({ config: { triggerType: 'Keywords', keywordList: 'oi\nolá\nbom dia' } }) })]))

    await receiveText('Bom dia')
    await receiveText('OI')
    expect(executedIds()).toEqual(['wf-saudacao', 'wf-saudacao'])
  })

  it('palavras digitadas com espaços/linhas vazias na tela são limpas (updateTrigger) e ainda casam', async () => {
    await publishKeywords('wf-promo', ['  promo  ', '', '   ', 'Black Friday '])
    const trigger = (h.db.row('workflow_versions', { workflow_id: 'wf-promo', status: 'published' })?.nodes as Row[]).find(
      (n) => n.id === '__trigger'
    )
    expect((trigger?.data as Row).config).toEqual({ triggerType: 'Keywords', keywordList: 'promo\nBlack Friday' })

    await receiveText('promo')
    await receiveText('black friday')
    expect(executedIds()).toEqual(['wf-promo', 'wf-promo'])
  })

  it('árvore antiga sem `type` no gatilho é tratada como palavra-chave', async () => {
    await publishFlow(
      h.db,
      makeFlow({ id: 'wf-legado', trigger: triggers.legacyKeywords(['legado']), root: steps.whatsapp({ message: 'ok' }) })
    )
    await receiveText('Legado')
    expect(executedIds()).toEqual(['wf-legado'])
  })

  describe('WH-02: normalização (maiúsculas, acentos e espaços nas bordas) no webhook', () => {
    it.each([
      ['quero', '  Quero '],
      ['inscrever', 'INSCREVER'],
      ['olá', 'ola'],
      ['ola', 'Olá'],
      ['Olá', 'OLÁ'],
      ['quero muito', 'QUERO MUITO'],
      ['ação', 'ACAO'],
    ])('palavra "%s" × mensagem "%s" → despacha o fluxo', async (keyword, message) => {
      await publishKeywords('wf-kw', [keyword])
      await receiveText(message)
      expect(executedIds()).toEqual(['wf-kw'])
      expect(inputOf(executeCalls()[0]).message).toBe(message) // texto cru vai para o /execute
    })
  })

  describe('WH-02 ponta a ponta: o /execute também aceita e a resposta sai', () => {
    it.each([
      ['quero', '  Quero '],
      ['inscrever', 'INSCREVER'],
      ['Olá', 'OLÁ'],
      ['quero muito', 'QUERO MUITO'],
    ])('palavra "%s" × mensagem "%s" → mensagem enviada', async (keyword, message) => {
      await publishKeywords('wf-kw', [keyword])
      await receiveText(message)
      const [run] = await flushSelfInvokes()
      expect(run.result?.body).toMatchObject({ status: 'success' })
      expect(textsTo(ANA)).toEqual(['Resposta wf-kw'])
    })

    // Corrigido BUG(gate-acento): o webhook casa "ola" com a palavra "olá" (NFD sem diacríticos) e despacha,
    // mas o /execute reaplica o gate com message.toLowerCase().includes(keyword.toLowerCase()), SEM
    // tirar acento → run 'skipped' (keyword_not_matched) e nada é enviado. A tela promete "ignora
    // acentos" (ConfigPanel). execute/route.ts:105-148 × webhook/route.ts:420-477.
    it.each([
      ['olá', 'ola'],
      ['ola', 'Olá'],
      ['ação', 'acao'],
    ])('gate-acento: palavra "%s" × mensagem "%s" deveria enviar a resposta', async (keyword, message) => {
      await publishKeywords('wf-kw', [keyword])
      await receiveText(message)
      expect(executedIds()).toEqual(['wf-kw'])
      const [run] = await flushSelfInvokes()
      expect(run.result?.body).toMatchObject({ status: 'success' })
      expect(textsTo(ANA)).toEqual(['Resposta wf-kw'])
    })
  })

  it('WH-03: mensagem que só CONTÉM a palavra (ou difere no meio) não dispara — match exato', async () => {
    await publishKeywords('wf-quero', ['quero'])
    await publishKeywords('wf-quero-muito', ['quero muito'])
    for (const text of ['eu quero', 'quero!', 'queroo', 'Quero.', 'quero  muito', 'quero muito mesmo', 'não quero mais']) {
      await receiveText(text)
    }
    expect(executeCalls()).toEqual([])
    expect(h.meta.sent).toEqual([])
  })

  it('WH-04: rascunho nunca publicado e versão arquivada não disparam; só a versão publicada vale', async () => {
    // wf-rascunho: só v1 'draft' (o usuário nunca clicou em Publicar)
    await seedPublishedFlow(h.db, keywordFlow('wf-rascunho', ['rascunho']), { publish: false })
    // wf-v2: v1 arquivada com a palavra "velha", v2 publicada com "nova"
    const published = await seedPublishedFlow(h.db, keywordFlow('wf-v2', ['nova']))
    const old = compileFlow(keywordFlow('wf-v2', ['velha']))
    h.db.update('workflow_versions', { id: published.draftVersionId! }, { nodes: old.nodes, edges: old.edges, status: 'archived' })

    await receiveText('rascunho')
    await receiveText('velha')
    expect(executeCalls()).toEqual([])

    await receiveText('nova')
    expect(executedIds()).toEqual(['wf-v2'])
  })

  it('fluxo apagado pela tela (DELETE) deixa de disparar', async () => {
    await publishKeywords('wf-apagar', ['quero'])
    expect((await routes.deleteWorkflow('wf-apagar')).status).toBe(200)
    await receiveText('quero')
    expect(executeCalls()).toEqual([])
  })

  it('WH-05: dois fluxos com a mesma palavra → só UM dispara: o publicado mais recentemente (precedência silenciosa)', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await publishKeywords('wf-antigo', ['promo'])
    advanceTime(60_000)
    await publishKeywords('wf-novo', ['promo'])

    await receiveText('promo')
    expect(executedIds()).toEqual(['wf-novo'])

    // Republicar o antigo inverte a precedência.
    advanceTime(60_000)
    expect((await routes.publish('wf-antigo')).status).toBe(200)
    await receiveText('promo')
    expect(executedIds()).toEqual(['wf-novo', 'wf-antigo'])
  })

  it('WH-06: "Sem gatilho" e "Respondeu ao disparo" nunca disparam numa mensagem comum; palavras-chave vazias nem publicam', async () => {
    await publishFlow(h.db, noneFlow('wf-none'))
    // gatilho "Palavras-chave" sem palavra válida não compila (a tela/publish recusam)
    await expect(publishKeywords('wf-vazio', [])).rejects.toThrow(/sem nenhuma palavra/)
    await expect(publishKeywords('wf-so-espacos', ['   ', ''])).rejects.toThrow(/sem nenhuma palavra/)
    await publishCampaignReply('wf-cr') // sem campaign_contact para o telefone
    for (const text of ['oi', 'None', 'Keywords', 'CampaignReply', 'qualquer coisa']) await receiveText(text)
    expect(selfInvokeCalls).toEqual([])
    expect(h.meta.sent).toEqual([])
  })

  it('WH-18: reentrega da Meta (mesmo wamid) dispara uma vez só; outra mensagem igual (wamid novo) dispara de novo', async () => {
    await publishKeywords('wf-quero', ['quero'])
    const first = metaInbound.text({ from: ANA, body: 'quero' })
    await receive(first)
    await receive(first)
    await receive(first)
    expect(executedIds()).toEqual(['wf-quero'])

    await receiveText('quero')
    expect(executedIds()).toEqual(['wf-quero', 'wf-quero'])
    expect(h.db.rows('processed_inbound_messages').map((r) => r.message_id)).toHaveLength(2)
  })

  it('WH-28: lote com várias entries/mensagens despacha um /execute por mensagem, cada um com o from certo', async () => {
    await publishKeywords('wf-quero', ['quero'])
    await publishKeywords('wf-oi', ['oi'])
    const a = metaWebhookBody({ messages: [metaInbound.text({ from: '+5511911111111', body: 'quero' })] })
    const b = metaWebhookBody({
      messages: [metaInbound.text({ from: '+5511922222222', body: 'oi' }), metaInbound.text({ from: '+5511933333333', body: 'nada' })],
    })
    const body = { object: 'whatsapp_business_account', entry: [...(a.entry as unknown[]), ...(b.entry as unknown[])] }
    const res = await routes.webhook(body)
    expect(res.status).toBe(200)
    expect(executeCalls().map((c) => [c.path, inputOf(c).from])).toEqual([
      [executePath('wf-quero'), '5511911111111'],
      [executePath('wf-oi'), '5511922222222'],
    ])
  })

  it('WH-33: reentrada por palavra-chave reinicia o fluxo mesmo com "Permitir reentrada" desligado (a opção só vale para inscrição e CampaignReply)', async () => {
    await publishKeywords('wf-quero', ['quero'], { settings: { allowReentry: false } })
    seedWait({ workflowId: 'wf-quero' })
    h.db.insert('workflow_runs', { id: 'run-antigo', workflow_id: 'wf-quero', status: 'success', input: { from: ANA_WA } })
    await receiveText('quero')
    expect(executedIds()).toEqual(['wf-quero'])
  })

  it('EX-06: reentrada com Aguardar reinicia a espera na MESMA linha; o cron retoma depois e envia o 2º passo', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await publishKeywords('wf-nutricao', ['quero'], {
      root: steps.whatsapp({ id: 'm1', message: 'Primeira', next: steps.wait({ id: 'w', value: 10, unit: 'minutes', next: steps.whatsapp({ id: 'm2', message: 'Segunda' }) }) }),
    })

    await receiveText('quero')
    const [first] = await flushSelfInvokes()
    expect(first.result?.body).toMatchObject({ status: 'waiting' })
    const wait = h.db.row('workflow_enrollments', { workflow_id: 'wf-nutricao' })
    expect(wait).toMatchObject({
      phone: ANA,
      status: 'waiting',
      wait_kind: 'delay',
      resume_node_ids: ['m2'],
      resume_at: '2026-10-18T12:10:00.000Z',
    })
    expect(h.db.row('workflow_runs', { workflow_id: 'wf-nutricao' })?.status).toBe('waiting')

    advanceTime(5 * 60_000)
    await receiveText('QUERO')
    await flushSelfInvokes()
    expect(h.db.rows('workflow_enrollments')).toHaveLength(1)
    expect(h.db.row('workflow_enrollments', { id: wait!.id as string })).toMatchObject({
      status: 'waiting',
      resume_at: '2026-10-18T12:15:00.000Z',
    })
    expect(textsTo(ANA)).toEqual(['Primeira', 'Primeira'])

    advanceTime(10 * 60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(textsTo(ANA)).toEqual(['Primeira', 'Primeira', 'Segunda'])
    expect(enrollmentStatus(wait!.id)).toBe('completed')
  })

  it('republicar depois de editar a palavra passa a valer a nova', async () => {
    const flow = keywordFlow('wf-edit', ['quero'])
    await publishFlow(h.db, flow)
    await publishFlow(h.db, updateTrigger(flow, { keywords: ['oi'] }))
    await receiveText('quero')
    await receiveText('oi')
    expect(executeCalls().map((c) => inputOf(c).message)).toEqual(['oi'])
  })

  // Corrigido BUG(edicao-pos-publicacao-vai-ao-ar): o publish aponta active_version_id para a própria versão
  // 'published', e o autosave (PATCH → updateWorkflowRecord) faz UPDATE nessa versão. Trocar a
  // palavra no canvas vai ao ar em ~1s, sem clicar em Publicar, e o header continua "vN publicada".
  // lib/builder/workflow-db.ts:292-302 + publish/route.ts:41-54 + hooks/useWorkflowBuilder.ts:76-138.
  it('edicao-pos-publicacao-vai-ao-ar: editar a palavra sem republicar não deveria mudar o gatilho no ar', async () => {
    const flow = keywordFlow('wf-edit', ['quero'])
    await publishFlow(h.db, flow)

    // O que o autosave do builder manda depois de trocar a palavra na tela:
    const edited = updateTrigger(flow, { keywords: ['oi'] })
    const compiled = compileFlow(edited)
    const patch = await routes.patchWorkflow('wf-edit', { name: edited.name, tree: edited, nodes: compiled.nodes, edges: compiled.edges })
    expect(patch.status).toBe(200)

    await receiveText('oi')
    await receiveText('quero')
    expect(executeCalls().map((c) => inputOf(c).message)).toEqual(['quero'])
  })
})

// ─── Fluxo padrão ──────────────────────────────────────────────────────────────

describe('Fluxo padrão (settings workflow_builder_default_id / env WORKFLOW_BUILDER_DEFAULT_ID)', () => {
  it('WH-07: padrão recebe o que não casa com palavra-chave; palavra de outro fluxo vai só para ele; a palavra do próprio padrão não duplica', async () => {
    await publishKeywords('wf-padrao', ['oi'])
    await publishKeywords('wf-quero', ['quero'])
    await markAsDefault('wf-padrao')

    await receiveText('qualquer coisa')
    expect(executedIds()).toEqual(['wf-padrao'])

    await receiveText('quero')
    expect(executedIds()).toEqual(['wf-padrao', 'wf-quero'])

    await receiveText('oi')
    expect(executedIds()).toEqual(['wf-padrao', 'wf-quero', 'wf-padrao'])
  })

  it('env WORKFLOW_BUILDER_DEFAULT_ID é o fallback; o valor salvo pela tela tem precedência', async () => {
    await publishFlow(h.db, noneFlow('wf-env'))
    await publishFlow(h.db, noneFlow('wf-tela'))
    vi.stubEnv('WORKFLOW_BUILDER_DEFAULT_ID', 'wf-env')

    await receiveText('olá')
    expect(executedIds()).toEqual(['wf-env'])

    await markAsDefault('wf-tela')
    await receiveText('olá de novo')
    expect(executedIds()).toEqual(['wf-env', 'wf-tela'])
  })

  it('padrão "Sem gatilho" responde a qualquer mensagem sem palavra-chave (ponta a ponta)', async () => {
    await publishFlow(h.db, noneFlow('wf-padrao'))
    await markAsDefault('wf-padrao')
    await receiveText('Bom dia, tudo bem?')
    const [run] = await flushSelfInvokes()
    expect(run.result?.body).toMatchObject({ status: 'success' })
    expect(textsTo(ANA)).toEqual(['Resposta wf-padrao'])
  })

  it('mensagem sem texto (mídia) não aciona o padrão', async () => {
    await publishFlow(h.db, noneFlow('wf-padrao'))
    await markAsDefault('wf-padrao')
    await receive(metaInbound.image({ from: ANA }))
    expect(selfInvokeCalls).toEqual([])
  })

  // Corrigido BUG(default-gate-palavra): o webhook despacha o padrão para qualquer mensagem que não casou
  // (targetWorkflowId = matched || default), mas o /execute reaplica o gate de Palavras-chave
  // (message.includes(keyword)) e pula o run → um padrão com gatilho "Palavras-chave" NUNCA
  // responde a "bom dia" (e responde a "boi", que contém "oi"). execute/route.ts:104-149.
  it('default-gate-palavra: padrão com gatilho Palavras-chave deveria responder a mensagem que não casou', async () => {
    await publishKeywords('wf-boas-vindas', ['oi'])
    await markAsDefault('wf-boas-vindas')
    await receiveText('bom dia')
    expect(executedIds()).toEqual(['wf-boas-vindas'])
    const [run] = await flushSelfInvokes()
    expect(run.result?.body).toMatchObject({ status: 'success' })
    expect(textsTo(ANA)).toEqual(['Resposta wf-boas-vindas'])
  })

  // Corrigido BUG(default-rascunho): targetWorkflowId = matched || default não olha workflows.status, e o
  // /execute roda a versão ATIVA sem checar publicação. Um fluxo nunca publicado marcado como
  // padrão responde a todos os contatos. webhook/route.ts:1409-1423; execute/route.ts:72-102.
  it('default-rascunho: padrão em rascunho (nunca publicado) não deveria disparar', async () => {
    await seedPublishedFlow(h.db, noneFlow('wf-rascunho'), { publish: false })
    await markAsDefault('wf-rascunho')
    await receiveText('olá tudo bem')
    await flushSelfInvokes()
    expect(h.meta.sent).toEqual([])
    expect(executeCalls()).toEqual([])
  })

  // Corrigido BUG(default-duplica-campaign-reply): o laço do CampaignReply despacha o fluxo e, como nenhuma
  // palavra casou, o bloco keyword/padrão despacha o MESMO fluxo como padrão → 2 execuções e
  // mensagens duplicadas. Só existe exclusão do padrão na lista de keywords (route.ts:732-734).
  it('default-duplica-campaign-reply: padrão com gatilho "Respondeu ao disparo" deveria executar 1x na resposta', async () => {
    await publishCampaignReply('wf-cr')
    await markAsDefault('wf-cr')
    seedCampaignContact()
    await receiveText('sim')
    expect(executedIds()).toEqual(['wf-cr'])
  })

  // Corrigido BUG(default-fantasma): apagar o fluxo padrão não limpa settings.workflow_builder_default_id; na
  // próxima mensagem o webhook chama ensureWorkflowRecord, que RECRIA um "Fluxo inicial" (rascunho,
  // gatilho Webhook + Send Message) e o despacha. workflow-db.ts:162-216; webhook/route.ts:1414-1423.
  it('default-fantasma: padrão apagado não deveria recriar um "Fluxo inicial" nem disparar', async () => {
    await publishFlow(h.db, noneFlow('wf-padrao'))
    await markAsDefault('wf-padrao')
    expect((await routes.deleteWorkflow('wf-padrao')).status).toBe(200)

    await receiveText('olá')
    expect(h.db.row('workflows', { id: 'wf-padrao' })).toBeUndefined()
    expect(executeCalls()).toEqual([])
  })
})

// ─── Respondeu ao disparo (CampaignReply) ──────────────────────────────────────

describe('Gatilho "Respondeu ao disparo" (CampaignReply)', () => {
  it('WH-10: resposta a QUALQUER disparo dispara o fluxo, marca o contato como replied e envia (ponta a ponta)', async () => {
    await publishCampaignReply('wf-cr')
    const cc = seedCampaignContact({ status: 'read' })

    await receiveText('ok')

    expect(selfInvokeCalls).toEqual([
      {
        path: executePath('wf-cr'),
        body: { input: { from: ANA_WA, to: ANA_WA, message: 'ok', campaignId: SEED_IDS.campaign }, source: 'self-reinvoke' },
      },
    ])
    expect(h.db.row('campaign_contacts', { id: cc.id as string })?.status).toBe('replied')

    const [run] = await flushSelfInvokes()
    expect(run.result?.body).toMatchObject({ status: 'success' })
    expect(textsTo(ANA)).toEqual(['Resposta wf-cr'])
    expect(h.db.row('workflow_runs', { workflow_id: 'wf-cr' })).toMatchObject({ trigger_type: 'CampaignReply', status: 'success' })
  })

  it.each(['sent', 'delivered', 'read'])('contato com disparo em status "%s" é elegível', async (status) => {
    await publishCampaignReply('wf-cr')
    seedCampaignContact({ status })
    await receiveText('oi')
    expect(executedIds()).toEqual(['wf-cr'])
  })

  it('WH-11: campanha específica — dispara só para o disparo daquela campanha', async () => {
    h.db.insert('campaigns', { id: 'c_outra', name: 'Outra campanha' })
    await publishCampaignReply('wf-cr-promo', { campaignId: SEED_IDS.campaign })

    seedCampaignContact({ campaignId: 'c_outra' })
    await receiveText('oi')
    expect(executeCalls()).toEqual([])

    seedCampaignContact({ campaignId: SEED_IDS.campaign })
    await receiveText('oi de novo')
    expect(executedIds()).toEqual(['wf-cr-promo'])
    expect(inputOf(executeCalls()[0]).campaignId).toBe(SEED_IDS.campaign)
  })

  it('o disparo MAIS RECENTE (sent_at) decide a campanha respondida', async () => {
    h.db.insert('campaigns', { id: 'c_outra', name: 'Outra campanha' })
    await publishCampaignReply('wf-cr-promo', { campaignId: SEED_IDS.campaign })
    await publishCampaignReply('wf-cr-outra', { campaignId: 'c_outra' })
    seedCampaignContact({ campaignId: SEED_IDS.campaign, sentAt: '2026-10-01T10:00:00.000Z' })
    seedCampaignContact({ campaignId: 'c_outra', sentAt: '2026-10-10T10:00:00.000Z' })
    await receiveText('quero')
    expect(executedIds()).toEqual(['wf-cr-outra'])
  })

  it('dois fluxos (qualquer disparo + campanha específica) disparam os dois para a mesma resposta', async () => {
    await publishCampaignReply('wf-cr-qualquer')
    await publishCampaignReply('wf-cr-promo', { campaignId: SEED_IDS.campaign })
    seedCampaignContact()
    await receiveText('oi')
    expect(executedIds().sort()).toEqual(['wf-cr-promo', 'wf-cr-qualquer'])
  })

  describe('WH-12: filtro "A resposta contém" (normalizado, por inclusão)', () => {
    it.each([
      ['Quero', 'eu QUERO sim', true],
      ['Quero', 'não', false],
      ['não', 'NAO pode', true],
      ['  sim  ', 'Sim, claro', true],
      ['promoção', 'quero a PROMOCAO', true],
      ['', 'qualquer resposta', true],
    ])('filtro "%s" × resposta "%s" → dispara=%s', async (replyFilter, reply, dispatched) => {
      await publishCampaignReply('wf-cr', { replyFilter })
      seedCampaignContact()
      await receiveText(reply)
      expect(executedIds()).toEqual(dispatched ? ['wf-cr'] : [])
    })
  })

  it('resposta por botão de TEMPLATE (type button) usa o texto do botão', async () => {
    await publishCampaignReply('wf-cr', { replyFilter: 'quero' })
    seedCampaignContact()
    await receive(metaInbound.button({ from: ANA, text: 'Quero saber mais', payload: 'QUERO_MAIS' }))
    expect(executedIds()).toEqual(['wf-cr'])
    expect(inputOf(executeCalls()[0]).message).toBe('Quero saber mais')
  })

  it.each([
    ['disparo com 9, Meta manda sem 9', '+5511988887777', '551188887777'],
    ['disparo sem 9, Meta manda com 9', '+551188887777', '5511988887777'],
  ])('WH-13: acha o disparo pelas variantes do 9 (%s)', async (_label, ccPhone, from) => {
    await publishCampaignReply('wf-cr')
    const cc = seedCampaignContact({ phone: ccPhone })
    await receiveText('ok', from)
    expect(executedIds()).toEqual(['wf-cr'])
    expect(h.db.row('campaign_contacts', { id: cc.id as string })?.status).toBe('replied')
  })

  it('WH-14: reentrega, segunda resposta (já replied) e disparo falho não redisparam', async () => {
    await publishCampaignReply('wf-cr')
    seedCampaignContact()
    const reply = metaInbound.text({ from: ANA, body: 'sim' })
    await receive(reply)
    await receive(reply) // reentrega da Meta
    await receiveText('sim de novo') // mensagem nova: o cc já está replied
    seedCampaignContact({ phone: TEST_PHONES.bruno, status: 'failed' })
    await receiveText('oi', TEST_PHONES.bruno)
    expect(executedIds()).toEqual(['wf-cr'])
  })

  it('WH-15: resposta de opt-out ("PARAR") não dispara o fluxo, não marca replied e registra a supressão', async () => {
    await publishCampaignReply('wf-cr')
    const cc = seedCampaignContact()
    await receiveText('PARAR')
    expect(executeCalls()).toEqual([])
    expect(h.db.row('campaign_contacts', { id: cc.id as string })?.status).toBe('delivered')
    expect(h.db.rows('phone_suppressions')).toEqual([
      expect.objectContaining({ phone: ANA, source: 'inbound_keyword', is_active: true, expires_at: null }),
    ])
  })

  describe('WH-16: "Permitir reentrada" desligado', () => {
    it('A: quem já tem inscrição (qualquer status) no fluxo é bloqueado', async () => {
      await publishCampaignReply('wf-cr', { settings: { allowReentry: false } })
      seedWait({ workflowId: 'wf-cr', status: 'completed' })
      seedCampaignContact()
      await receiveText('oi')
      expect(executeCalls()).toEqual([])
    })

    it('B: quem já tem run do fluxo (input.from, ponta a ponta) é bloqueado na próxima campanha', async () => {
      h.db.insert('campaigns', { id: 'c_outra', name: 'Outra campanha' })
      await publishCampaignReply('wf-cr', { settings: { allowReentry: false } })
      seedCampaignContact()
      await receiveText('oi')
      expect(executedIds()).toEqual(['wf-cr'])
      await flushSelfInvokes()
      expect(h.db.row('workflow_runs', { workflow_id: 'wf-cr' })?.input).toMatchObject({ from: ANA_WA })

      seedCampaignContact({ campaignId: 'c_outra' })
      await receiveText('oi de novo')
      expect(executeCalls()).toEqual([])
    })

    it('B2: o bloqueio também vale para run gravado com a variante sem 9', async () => {
      await publishCampaignReply('wf-cr', { settings: { allowReentry: false } })
      h.db.insert('workflow_runs', { id: 'run-sem-9', workflow_id: 'wf-cr', status: 'success', input: { from: waId(ANA_SEM_9) } })
      seedCampaignContact()
      await receiveText('oi')
      expect(executeCalls()).toEqual([])
    })

    it('C: contato sem histórico entra', async () => {
      await publishCampaignReply('wf-cr', { settings: { allowReentry: false } })
      seedCampaignContact()
      await receiveText('oi')
      expect(executedIds()).toEqual(['wf-cr'])
    })

    it('D: reentrada ligada (padrão) deixa entrar mesmo com histórico', async () => {
      await publishCampaignReply('wf-cr')
      seedWait({ workflowId: 'wf-cr', status: 'completed' })
      h.db.insert('workflow_runs', { id: 'run-antigo', workflow_id: 'wf-cr', status: 'success', input: { from: ANA_WA } })
      seedCampaignContact()
      await receiveText('oi')
      expect(executedIds()).toEqual(['wf-cr'])
    })

    it('ST-01: settings só aceitam booleano — allowReentry "false" (string) não bloqueia', async () => {
      await publishCampaignReply('wf-cr')
      h.db.update('workflows', { id: 'wf-cr' }, { settings: { allowReentry: 'false' } })
      seedWait({ workflowId: 'wf-cr', status: 'completed' })
      seedCampaignContact()
      await receiveText('oi')
      expect(executedIds()).toEqual(['wf-cr'])
    })
  })

  // Corrigido BUG(campaign-reply-pending): o lookup aceita status 'pending' (contato ainda na FILA do disparo,
  // nada enviado). Uma mensagem qualquer vira "resposta ao disparo": o cc vai para 'replied' (o
  // dispatcher, que só pega 'pending', nunca mais envia) e o fluxo roda para uma campanha que o
  // contato não recebeu. webhook/route.ts:1194-1200 e 1246-1249; campaign/workflow/route.ts:332,369.
  it('campaign-reply-pending: contato ainda na fila (pending, sem sent_at) não respondeu ao disparo', async () => {
    await publishCampaignReply('wf-cr')
    const cc = seedCampaignContact({ status: 'pending', sentAt: null })
    await receiveText('oi')
    expect(executeCalls()).toEqual([])
    expect(h.db.row('campaign_contacts', { id: cc.id as string })?.status).toBe('pending')
  })
})

// ─── Conversa pendente (Perguntar) ─────────────────────────────────────────────

describe('Resposta a pergunta pendente (Perguntar → /resume)', () => {
  it('WH-19: retoma a conversa do fluxo certo e NÃO reinicia gatilho (nem palavra-chave nem padrão)', async () => {
    await publishKeywords('wf-sim', ['sim'])
    await publishFlow(h.db, noneFlow('wf-padrao'))
    await markAsDefault('wf-padrao')
    seedWorkflowRow('wf-pergunta')
    seedConversation({ id: 'cv1', workflowId: 'wf-pergunta' })

    await receiveText('Sim')

    expect(selfInvokeCalls).toEqual([
      {
        path: resumePath('wf-pergunta'),
        body: { conversationId: 'cv1', input: { from: ANA, to: ANA, message: 'Sim' }, source: 'self-reinvoke' },
      },
    ])
  })

  it.each([
    ['botão interativo (button_reply)', () => metaInbound.interactiveButton({ from: ANA, title: 'Sim', replyId: 'btn_1' }), 'Sim'],
    ['item de lista (list_reply)', () => metaInbound.listReply({ from: ANA, title: 'Plano B', replyId: 'opt_2' }), 'Plano B'],
    ['botão de template (type button)', () => metaInbound.button({ from: ANA, text: 'Quero', payload: 'Q' }), 'Quero'],
    ['texto livre', () => metaInbound.text({ from: ANA, body: '  talvez  ' }), '  talvez  '],
  ])('WH-20: %s retoma com o título/texto da resposta', async (_label, build, expected) => {
    seedConversation({ id: 'cv1', workflowId: 'wf-pergunta' })
    await receive(build())
    expect(resumeCalls()).toHaveLength(1)
    expect(resumeCalls()[0].body).toMatchObject({ conversationId: 'cv1', input: { message: expected } })
    expect(executeCalls()).toEqual([])
  })

  it('WH-21: com duas perguntas pendentes vence a mais recente; conversa completed não retoma', async () => {
    seedConversation({ id: 'cv-antiga', workflowId: 'wf-a', updatedAt: '2026-10-01T10:00:00.000Z' })
    seedConversation({ id: 'cv-nova', workflowId: 'wf-b', updatedAt: '2026-10-10T10:00:00.000Z' })
    await receiveText('resposta')
    expect(resumeCalls().map((c) => [c.path, c.body.conversationId])).toEqual([[resumePath('wf-b'), 'cv-nova']])

    selfInvokeCalls.splice(0)
    h.db.update('workflow_conversations', () => true, { status: 'completed' })
    await publishKeywords('wf-quero', ['quero'])
    await receiveText('quero')
    expect(resumeCalls()).toEqual([])
    expect(executedIds()).toEqual(['wf-quero'])
  })

  it('pergunta pendente de OUTRO contato não captura a mensagem', async () => {
    seedConversation({ workflowId: 'wf-pergunta', phone: TEST_PHONES.bruno })
    await publishKeywords('wf-quero', ['quero'])
    await receiveText('quero')
    expect(resumeCalls()).toEqual([])
    expect(executedIds()).toEqual(['wf-quero'])
  })

  it('reentrega da resposta (mesmo wamid) não retoma duas vezes', async () => {
    seedConversation({ id: 'cv1', workflowId: 'wf-pergunta' })
    const reply = metaInbound.interactiveButton({ from: ANA, title: 'Sim' })
    await receive(reply)
    await receive(reply)
    expect(resumeCalls()).toHaveLength(1)
  })

  it('RS-02/RS-04 ponta a ponta: pergunta → conversa waiting → botão "Sim" → ramo "Sim" + continuação; conversa completed', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await flushSelfInvokes()

    expect(textsTo(ANA)).toEqual(['Quer a proposta?'])
    const conversation = h.db.row('workflow_conversations', { workflow_id: 'wf-menu' })
    expect(conversation).toMatchObject({ status: 'waiting', phone: ANA, resume_node_id: 'ask__var', variable_key: 'reply_ask' })
    expect(h.db.row('workflow_runs', { workflow_id: 'wf-menu' })).toMatchObject({ status: 'waiting', output: { conversationId: conversation!.id } })

    await receive(metaInbound.interactiveButton({ from: ANA, title: 'Sim' }))
    expect(resumeCalls()).toHaveLength(1)
    const [resumed] = await flushSelfInvokes()
    expect(resumed.result?.body).toMatchObject({ status: 'success' })

    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'A', 'fim'])
    expect(h.db.row('workflow_conversations', { id: conversation!.id as string })).toMatchObject({
      status: 'completed',
      variables: expect.objectContaining({ reply_ask: 'Sim' }),
    })
    expect(h.db.rows('workflow_runs').map((r) => r.trigger_type)).toEqual(['Keywords', 'Resume'])

    // Conversa encerrada: a próxima mensagem volta a valer como gatilho.
    await receiveText('menu')
    expect(executedIds()).toEqual(['wf-menu'])
  })

  it('RS-04: resposta digitada que difere do botão só em maiúsculas/acentos/espaços ("  sim ", "NAO") segue o ramo do botão', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await flushSelfInvokes()
    await receiveText('  sim ')
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'A', 'fim'])

    await receiveText('menu')
    await flushSelfInvokes()
    await receiveText('NAO')
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'A', 'fim', 'Quer a proposta?', 'B', 'fim'])
  })

  it('RS-04: o id do botão clicado vale mesmo com o título diferente; texto que não é botão cai em "Outra resposta"', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await flushSelfInvokes()
    await receive(metaInbound.interactiveButton({ from: ANA, title: 'Pode mandar!', replyId: 'Sim' }))
    expect(resumeCalls()[0].body).toMatchObject({ input: { message: 'Pode mandar!', replyId: 'Sim' } })
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'A', 'fim'])

    await receiveText('menu')
    await flushSelfInvokes()
    await receiveText('talvez')
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'A', 'fim', 'Quer a proposta?', 'fim'])
  })

  it('RS-04: resposta "Não" segue o ramo do segundo botão', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await flushSelfInvokes()
    await receive(metaInbound.interactiveButton({ from: ANA, title: 'Não' }))
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'B', 'fim'])
  })

  // Corrigido BUG(perguntar-sem-botoes): a tela edita "Botões / opções" (≤20 chars, "limite dos botões do
  // WhatsApp"), mas o compile emite ask-question só com `message` e o step usa buildTextMessage: a
  // pergunta sai como TEXTO puro, sem botões, e o contato precisa digitar o rótulo exato.
  // lib/builder/flow/compile.ts:417-429; lib/builder/steps/whatsapp/ask-question.ts:51-55.
  it('perguntar-sem-botoes: a pergunta deveria sair como mensagem interativa com os botões', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await flushSelfInvokes()
    const [question] = h.meta.sent
    expect(question.type).toBe('interactive')
    const buttons = ((question.body.interactive as Row)?.action as Row)?.buttons as Array<{ reply: { title: string } }>
    expect(buttons.map((b) => b.reply.title)).toEqual(['Sim', 'Não'])
  })

  // Corrigido BUG(resume-corrida): cada mensagem nova (wamid diferente) vê a mesma conversa 'waiting' e
  // despacha um /resume; o /resume só lê status 'waiting' e marca 'completed' DEPOIS de executar.
  // Dois toques rápidos no botão executam o ramo duas vezes (envio duplicado). Falta CAS
  // waiting→processing antes de executar. resume/route.ts:75-80,159-175.
  it('resume-corrida: duas respostas quase simultâneas deveriam executar o ramo uma vez só', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await flushSelfInvokes()

    await receive(metaInbound.interactiveButton({ from: ANA, title: 'Sim' }))
    await receive(metaInbound.interactiveButton({ from: ANA, title: 'Sim' }))
    const pending = selfInvokeCalls.splice(0)
    expect(pending.map((c) => c.path)).toEqual([resumePath('wf-menu'), resumePath('wf-menu')])

    // Em produção cada /resume roda numa invocação própria (after()), em paralelo.
    const barrier = createBarrier(2)
    const off = h.db.onBefore(() => barrier.wait(), { table: 'workflow_conversations', op: 'select' })
    await Promise.all(pending.map((c) => routes.resume('wf-menu', c.body)))
    off()

    expect(textsTo(ANA).filter((t) => t === 'A')).toHaveLength(1)
  })

  // Corrigido BUG(pergunta-duplicada): duas mensagens do gatilho antes do primeiro /execute terminar (nenhuma
  // vê conversa pendente, porque o execute é fire-and-forget) criam DUAS conversas 'waiting'. A
  // resposta retoma só a mais recente; a outra fica órfã e captura a PRÓXIMA mensagem do contato.
  // createConversation não checa existentes e não há UNIQUE. workflow-conversations.ts:18-48.
  it('pergunta-duplicada: dois gatilhos rápidos não deveriam deixar duas perguntas pendentes', async () => {
    await publishFlow(h.db, menuFlow())
    await receiveText('menu')
    await receiveText('menu')
    expect(executedIds()).toEqual(['wf-menu', 'wf-menu'])
    await flushSelfInvokes()
    expect(h.db.count('workflow_conversations', { workflow_id: 'wf-menu', status: 'waiting' })).toBeLessThanOrEqual(1)
  })

  // Corrigido BUG(optout-pendente): com pergunta pendente, o `continue` do resume encerra a iteração antes do
  // bloco de opt-out: "PARAR" vira a resposta da pergunta, o fluxo continua mandando mensagens e a
  // supressão não é gravada. webhook/route.ts:1392-1403 × 1960-1972.
  it('optout-pendente: "PARAR" com pergunta pendente deveria registrar o opt-out e não retomar o fluxo', async () => {
    seedConversation({ id: 'cv1', workflowId: 'wf-pergunta' })
    await receiveText('PARAR')
    expect(h.db.rows('phone_suppressions')).toEqual([expect.objectContaining({ phone: ANA, source: 'inbound_keyword' })])
    expect(resumeCalls()).toEqual([])
  })

  // Corrigido BUG(pendente-nono-digito): getPendingConversation faz eq exato no telefone normalizado. A
  // conversa de um fluxo iniciado por inscrição manual é salva com o telefone do contato (com 9);
  // se a Meta manda o wa_id legado (sem 9), a resposta não retoma a pergunta e cai no gatilho/
  // padrão. O próprio webhook já usa buildPhoneLookupVariants no AutoReply e no Stop on Response.
  it('pendente-nono-digito: conversa salva com 9 deveria ser retomada pela resposta sem 9', async () => {
    seedConversation({ id: 'cv1', workflowId: 'wf-pergunta', phone: '+5511988887777' })
    await receiveText('Sim', '551188887777')
    expect(resumeCalls().map((c) => c.body.conversationId)).toEqual(['cv1'])
  })

  it('DESIGN: pergunta pendente não expira — semanas depois, a palavra-chave de outro fluxo vira resposta da pergunta antiga', async () => {
    await publishKeywords('wf-quero', ['quero'])
    seedConversation({ id: 'cv-velha', workflowId: 'wf-pergunta', updatedAt: '2026-09-01T10:00:00.000Z' })
    await receiveText('quero')
    expect(resumeCalls().map((c) => c.body.conversationId)).toEqual(['cv-velha'])
    expect(executeCalls()).toEqual([])
  })

  it('DESIGN: resposta a disparo com pergunta pendente roda os DOIS (CampaignReply e o resume da pergunta)', async () => {
    await publishCampaignReply('wf-cr')
    seedCampaignContact()
    seedConversation({ id: 'cv1', workflowId: 'wf-pergunta' })
    await receiveText('sim')
    expect(selfInvokeCalls.map((c) => c.path)).toEqual([executePath('wf-cr'), resumePath('wf-pergunta')])
  })

  describe('RS-01: /resume valida a entrada antes de executar', () => {
    beforeEach(async () => {
      await publishFlow(h.db, menuFlow())
    })

    const call = (body: Record<string, unknown>, workflowId = 'wf-menu') => routes.resume(workflowId, body)
    const input = { from: ANA, to: ANA, message: 'Sim' }

    it('sem Bearer do cron → 401', async () => {
      seedConversation({ id: 'cv1', workflowId: 'wf-menu' })
      const res = await routes.resume('wf-menu', { conversationId: 'cv1', input }, { auth: false })
      expect(res.status).toBe(401)
    })

    it.each([
      ['sem conversationId', () => ({ input }), 'Missing workflowId or conversationId'],
      ['conversa inexistente', () => ({ conversationId: 'nao-existe', input }), 'Conversation not found'],
      [
        'conversa já respondida (completed)',
        () => {
          seedConversation({ id: 'cv1', workflowId: 'wf-menu', status: 'completed' })
          return { conversationId: 'cv1', input }
        },
        'Conversation not found',
      ],
      [
        'conversa de outro workflow',
        () => {
          seedConversation({ id: 'cv1', workflowId: 'wf-outro' })
          return { conversationId: 'cv1', input }
        },
        'Conversation workflow mismatch',
      ],
      [
        'conversa sem nó de retomada',
        () => {
          seedConversation({ id: 'cv1', workflowId: 'wf-menu' })
          h.db.update('workflow_conversations', { id: 'cv1' }, { resume_node_id: null })
          return { conversationId: 'cv1', input }
        },
        'Conversation missing resume node',
      ],
      [
        'conversa sem variável',
        () => {
          seedConversation({ id: 'cv1', workflowId: 'wf-menu' })
          h.db.update('workflow_conversations', { id: 'cv1' }, { variable_key: null })
          return { conversationId: 'cv1', input }
        },
        'Conversation missing variable key',
      ],
      [
        'mensagem só com espaços',
        () => {
          seedConversation({ id: 'cv1', workflowId: 'wf-menu' })
          return { conversationId: 'cv1', input: { ...input, message: '   ' } }
        },
        'Missing inbound message',
      ],
    ])('%s → status failed "%s" e nada executa', async (_label, build, error) => {
      const res = await call(build())
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ status: 'failed', error })
      expect(h.db.count('workflow_runs')).toBe(0)
      expect(h.meta.sent).toEqual([])
    })

    it('resposta válida: trim, variável injetada, run "Resume" e conversa completed', async () => {
      seedConversation({ id: 'cv1', workflowId: 'wf-menu' })
      h.db.update('workflow_conversations', { id: 'cv1' }, { variables: { origem: 'teste' } })
      const res = await call({ conversationId: 'cv1', input: { ...input, message: '  Sim  ' } })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ status: 'success' })
      expect(h.db.row('workflow_conversations', { id: 'cv1' })).toMatchObject({
        status: 'completed',
        variables: { origem: 'teste', reply_ask: 'Sim' },
      })
      expect(h.db.row('workflow_runs', { workflow_id: 'wf-menu' })).toMatchObject({ trigger_type: 'Resume' })
      expect(textsTo(ANA)).toEqual(['A', 'fim'])
    })

    // Corrigido BUG(status-skipped): skipNode grava { success:false, error:'skipped' } para os nós do ramo NÃO
    // tomado e finalSuccess = every(r.success) — toda resposta a um Perguntar com 2+ botões fecha o
    // run como 'error' e o /resume responde status 'failed', mesmo com as mensagens certas enviadas.
    // lib/builder/workflow-executor.workflow.ts:775-788 e 1283. (Também em workflow-executor.branches.test.ts.)
    it('status-skipped: resposta "Sim" (ramo "Não" pulado) deveria fechar o /resume como success', async () => {
      seedConversation({ id: 'cv1', workflowId: 'wf-menu' })
      const res = await call({ conversationId: 'cv1', input })
      expect(textsTo(ANA)).toEqual(['A', 'fim'])
      expect(res.body).toMatchObject({ status: 'success' })
      expect(h.db.row('workflow_runs', { workflow_id: 'wf-menu' })?.status).toBe('success')
    })
  })
})

// ─── Stop on Response ──────────────────────────────────────────────────────────

describe('Stop on Response (settings.stopOnResponse)', () => {
  it('WH-24: a resposta cancela só os Aguardar dos fluxos com a opção (inclusive o que o dreno está retomando agora); não toca outros fluxos nem outros contatos', async () => {
    seedWorkflowRow('wf-stop', { stopOnResponse: true })
    seedWorkflowRow('wf-keep', {})
    seedWorkflowRow('wf-stop-ativo', { stopOnResponse: true })
    seedWorkflowRow('wf-stop-sem-9', { stopOnResponse: true })
    seedWorkflowRow('wf-stop-outro', { stopOnResponse: true })
    const e1 = seedWait({ workflowId: 'wf-stop' })
    const e2 = seedWait({ workflowId: 'wf-keep' })
    const e3 = seedWait({ workflowId: 'wf-stop-ativo', status: 'active' })
    const e4 = seedWait({ workflowId: 'wf-stop-sem-9', phone: ANA_SEM_9 })
    const e5 = seedWait({ workflowId: 'wf-stop-outro', phone: TEST_PHONES.bruno })

    await receiveText('ok')

    // e3 está 'active' (dreno em voo): fica 'cancelled' e o CAS do reschedule/complete em 'active'
    // impede que o dreno o devolva à fila (ver STOP-03 em lib/cron/workflow-enrollments.test.ts)
    expect([e1, e2, e3, e4, e5].map((e) => enrollmentStatus(e.id))).toEqual(['cancelled', 'waiting', 'cancelled', 'cancelled', 'waiting'])
  })

  it('ponta a ponta: resposta durante o Aguardar cancela a espera e o passo seguinte nunca sai', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await publishKeywords('wf-nutricao', ['quero'], {
      settings: { stopOnResponse: true },
      root: steps.whatsapp({ id: 'm1', message: 'Primeira', next: steps.wait({ id: 'w', value: 10, unit: 'minutes', next: steps.whatsapp({ id: 'm2', message: 'Segunda' }) }) }),
    })
    await receiveText('quero')
    await flushSelfInvokes()
    const wait = h.db.row('workflow_enrollments', { workflow_id: 'wf-nutricao' })
    expect(wait?.status).toBe('waiting')

    await receiveText('obrigado, já comprei')
    expect(enrollmentStatus(wait!.id)).toBe('cancelled')

    advanceTime(15 * 60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 0 })
    expect(textsTo(ANA)).toEqual(['Primeira'])
  })

  it('WH-25: reentrega (mesmo wamid) não cancela de novo', async () => {
    seedWorkflowRow('wf-stop', { stopOnResponse: true })
    seedWait({ workflowId: 'wf-stop' })
    const reply = metaInbound.text({ from: ANA, body: 'ok' })
    await receive(reply)
    const e2 = seedWait({ workflowId: 'wf-stop' }) // nova espera depois da 1ª resposta
    await receive(reply)
    expect(enrollmentStatus(e2.id)).toBe('waiting')
  })

  it('ST-01: stopOnResponse não-booleano (1) é ignorado', async () => {
    seedWorkflowRow('wf-stop', { stopOnResponse: 1 })
    const e1 = seedWait({ workflowId: 'wf-stop' })
    await receiveText('ok')
    expect(enrollmentStatus(e1.id)).toBe('waiting')
  })

  // Corrigido BUG(stop-on-response-midia): a condição exige texto (route.ts:1375). A tela diz "Quando o contato
  // responde, os passos de espera (Aguardar) pendentes deste fluxo são cancelados", mas uma resposta
  // em áudio/imagem não cancela.
  it('stop-on-response-midia: resposta em áudio também deveria cancelar o Aguardar', async () => {
    seedWorkflowRow('wf-stop', { stopOnResponse: true })
    const e1 = seedWait({ workflowId: 'wf-stop' })
    await receive({
      from: ANA_WA,
      id: 'wamid.AUDIO1',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'audio',
      audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus', voice: true },
    })
    expect(enrollmentStatus(e1.id)).toBe('cancelled')
  })

  // Corrigido BUG(stop-on-response-cancela-inscricao): a inscrição manual grava o pontapé como
  // waiting/wait_kind='delay' com resume_at=now (drenado a ~25/min). O cancelamento filtra só por
  // wait_kind='delay', então quem mandar QUALQUER mensagem antes do drain chegar nele perde o fluxo
  // inteiro — a tela promete cancelar só os "Aguardar". enroll/route.ts:134-138 × webhook:562-598.
  it('stop-on-response-cancela-inscricao: inscrição manual ainda não iniciada não deveria ser cancelada', async () => {
    await publishFlow(h.db, noneFlow('wf-stop'), { settings: { stopOnResponse: true } })
    const enroll = await routes.enroll('wf-stop', { contactIds: [SEED_IDS.contacts.ana] })
    expect(enroll.body).toMatchObject({ enrolled: 1 })
    const [enrollment] = h.db.rows('workflow_enrollments')

    await receiveText('oi, recebi o e-mail de vocês')
    expect(enrollmentStatus(enrollment.id)).toBe('waiting')
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(textsTo(ANA)).toEqual(['Resposta wf-stop'])
  })

  // Corrigido BUG(stop-on-response-janela): a pausa por janela de horário também é persistida como
  // wait_kind='delay' (executor 943-968 + execute/route.ts:163), então a próxima mensagem do contato
  // cancela um fluxo que nem enviou a 1ª mensagem — não é um "Aguardar".
  it('stop-on-response-janela: pausa fora da janela de horário não deveria ser cancelada pela resposta', async () => {
    freezeTime('2026-10-18T12:00:00.000Z') // 09:00 em São Paulo
    await publishKeywords('wf-janela', ['quero'], {
      settings: {
        stopOnResponse: true,
        timeWindow: { enabled: true, start: '01:00', end: '02:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'America/Sao_Paulo' },
      },
    })
    await receiveText('quero')
    const [run] = await flushSelfInvokes()
    expect(run.result?.body).toMatchObject({ status: 'waiting' })
    const paused = h.db.row('workflow_enrollments', { workflow_id: 'wf-janela' })
    expect(paused).toMatchObject({ status: 'waiting', wait_kind: 'window' })

    await receiveText('alguém aí?')
    expect(enrollmentStatus(paused!.id)).toBe('waiting')
  })
})

// ─── Opt-out ───────────────────────────────────────────────────────────────────

describe('Opt-out por palavra', () => {
  it('"PARAR" registra a supressão do telefone normalizado (sem fluxo envolvido)', async () => {
    await receiveText('PARAR')
    expect(h.db.rows('phone_suppressions')).toEqual([
      expect.objectContaining({
        phone: ANA,
        source: 'inbound_keyword',
        is_active: true,
        metadata: expect.objectContaining({ text: 'PARAR', messageType: 'text' }),
      }),
    ])
    expect(selfInvokeCalls).toEqual([])
  })

  // Corrigido BUG(optout-dispara-padrao): o bloco keyword/padrão não checa isOptOutKeyword (o AutoReply checa,
  // route.ts:1171). "parar" com fluxo padrão configurado despacha o padrão ANTES de gravar a
  // supressão, e os passos do executor não consultam phone_suppressions: quem pediu para sair
  // recebe a mensagem do fluxo. webhook/route.ts:1409-1427 × 1960-1972.
  it('optout-dispara-padrao: mensagem de opt-out não deveria disparar o fluxo padrão', async () => {
    await publishFlow(h.db, noneFlow('wf-padrao'))
    await markAsDefault('wf-padrao')
    await receiveText('parar')
    expect(h.db.rows('phone_suppressions')).toHaveLength(1)
    expect(executeCalls()).toEqual([])
  })
})

// ─── Assinatura ────────────────────────────────────────────────────────────────

describe('WH-29: assinatura X-Hub-Signature-256 antes de qualquer gatilho', () => {
  const body = () => metaWebhookBody({ messages: [metaInbound.text({ from: ANA, body: 'quero' })] })

  it('enforced (META_APP_SECRET na env): assinatura inválida/ausente → 401 sem ler workflows nem disparar', async () => {
    await publishKeywords('wf-quero', ['quero'])
    vi.stubEnv('META_APP_SECRET', 'app-secret-de-teste')
    h.db.accessed.splice(0)

    const forged = await routes.webhook(body(), { signature: `sha256=${'0'.repeat(64)}` })
    expect(forged.status).toBe(401)
    const missing = await routes.webhook(body())
    expect(missing.status).toBe(401)
    expect(h.db.accessed).not.toContain('workflow_versions')
    expect(h.db.accessed).not.toContain('processed_inbound_messages')
    expect(selfInvokeCalls).toEqual([])

    const signed = await routes.webhook(body(), { secret: 'app-secret-de-teste' })
    expect(signed.status).toBe(200)
    expect(executedIds()).toEqual(['wf-quero'])
  })

  it('report_only (App Secret salvo na tela, ainda não comprovado): assinatura errada é aceita e dispara', async () => {
    await publishKeywords('wf-quero', ['quero'])
    h.db.insert('settings', { key: 'metaAppSecret', value: 'segredo-da-tela' })
    const res = await routes.webhook(body(), { signature: `sha256=${'1'.repeat(64)}` })
    expect(res.status).toBe(200)
    expect(executedIds()).toEqual(['wf-quero'])
  })

  it('report_only vira enforced na 1ª assinatura válida: depois disso a forjada é rejeitada', async () => {
    await publishKeywords('wf-quero', ['quero'])
    h.db.insert('settings', { key: 'metaAppSecret', value: 'segredo-da-tela' })
    expect((await routes.webhook(body(), { secret: 'segredo-da-tela' })).status).toBe(200)
    expect((await routes.webhook(body(), { signature: `sha256=${'2'.repeat(64)}` })).status).toBe(401)
    expect(executedIds()).toEqual(['wf-quero'])
  })
})

// ─── Robustez ──────────────────────────────────────────────────────────────────

describe('Robustez do despacho', () => {
  it('WH-30: mensagens sem texto (imagem, imagem com legenda, figurinha, reação) não acionam gatilho nem padrão', async () => {
    await publishKeywords('wf-quero', ['quero'])
    await publishFlow(h.db, noneFlow('wf-padrao'))
    await markAsDefault('wf-padrao')
    seedConversation({ workflowId: 'wf-pergunta' })
    const base = { from: ANA_WA, timestamp: String(Math.floor(Date.now() / 1000)) }
    await receive(
      metaInbound.image({ from: ANA }),
      // a legenda NÃO é lida como texto (extractInboundText só olha text/button/interactive)
      metaInbound.image({ from: ANA, caption: 'quero' }),
      { ...base, id: 'wamid.STICKER1', type: 'sticker', sticker: { id: 'st-1', mime_type: 'image/webp', animated: false } },
      { ...base, id: 'wamid.REACT1', type: 'reaction', reaction: { message_id: 'wamid.OUT1', emoji: '👍' } }
    )
    expect(selfInvokeCalls).toEqual([])
  })

  it('WH-31: erro ao carregar os fluxos publicados não derruba o webhook (200) — a mensagem fica sem gatilho', async () => {
    await publishKeywords('wf-quero', ['quero'])
    h.db.failNext('workflow_versions', 'connection reset', { op: 'select' })
    await receiveText('quero')
    expect(executeCalls()).toEqual([])
  })

  // Corrigido BUG(dedupe-erro-silencioso): o erro do upsert em processed_inbound_messages é ignorado; data fica
  // null e a mensagem é tratada como DUPLICADA — resume, execute e Stop on Response são pulados sem
  // nenhum log, e o webhook responde 200 (a Meta não reenvia). route.ts:1359-1368.
  it('dedupe-erro-silencioso: falha no dedupe não deveria descartar o gatilho em silêncio', async () => {
    await publishKeywords('wf-quero', ['quero'])
    h.db.failNext('processed_inbound_messages', 'dedupe store down', { op: 'upsert' })
    await receiveText('quero')
    const logged = [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.log).mock.calls]
      .map((args) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .some((line) => /dedupe store down|processed_inbound|dedupe/i.test(line))
    expect(executeCalls().length === 1 || logged).toBe(true)
  })
})

// ─── /execute ──────────────────────────────────────────────────────────────────

describe('/execute (o que o webhook despacha)', () => {
  it('EX-01: exige Bearer CRON_SECRET ou DISPARA_ADMIN_KEY; x-vercel-cron e Bearer errado → 401 sem tocar no banco', async () => {
    await publishKeywords('wf-quero', ['quero'])
    const mod = await import('@/app/api/builder/workflow/[workflowId]/execute/route')
    const body = { input: { from: ANA_WA, to: ANA_WA, message: 'quero' } }
    const opsBefore = h.db.ops.length

    expect((await routes.execute('wf-quero', body, { auth: false })).status).toBe(401)
    for (const headers of [{ authorization: 'Bearer errado' }, { 'x-vercel-cron': '1' }, { authorization: 'test-cron-secret' }]) {
      const res = await mod.POST(jsonRequest('/api/builder/workflow/wf-quero/execute', body, { headers }), routeParams('wf-quero'))
      expect(res.status).toBe(401)
    }
    expect(h.db.ops.slice(opsBefore)).toEqual([])
    expect(h.meta.sent).toEqual([])

    const admin = await mod.POST(
      jsonRequest('/api/builder/workflow/wf-quero/execute', body, { headers: { authorization: `Bearer ${TEST_ADMIN_KEY}` } }),
      routeParams('wf-quero')
    )
    expect(admin.status).toBe(200)
    expect(textsTo(ANA)).toEqual(['Resposta wf-quero'])
  })

  it.each([
    ['quero', 'success', null],
    ['  QUERO ', 'success', null],
    ['', 'skipped', 'missing_message'],
    ['nada a ver', 'skipped', 'keyword_not_matched'],
  ])('EX-02: gate de palavra-chave — mensagem "%s" → %s %s', async (message, status, reason) => {
    await publishKeywords('wf-quero', ['quero'])
    const res = await routes.execute('wf-quero', { input: { from: ANA_WA, to: ANA_WA, message } })
    expect(res.body).toMatchObject({ status })
    const run = h.db.row('workflow_runs', { workflow_id: 'wf-quero' })
    expect(run).toMatchObject({ status, trigger_type: 'Keywords' })
    if (reason) {
      expect(run?.output).toEqual({ reason })
      expect(h.meta.sent).toEqual([])
    } else {
      expect(textsTo(ANA)).toEqual(['Resposta wf-quero'])
    }
  })

  it('EX-04: startNodeIds pula o gate; "Sem gatilho" e "Respondeu ao disparo" não têm gate', async () => {
    const kw = await publishKeywords('wf-quero', ['quero'])
    const resumed = await routes.execute('wf-quero', {
      input: { from: ANA_WA, to: ANA_WA, message: 'nada a ver' },
      startNodeIds: headsAfterTrigger(kw),
    })
    expect(resumed.body).toMatchObject({ status: 'success' })

    await publishFlow(h.db, noneFlow('wf-none'))
    await publishCampaignReply('wf-cr')
    for (const id of ['wf-none', 'wf-cr']) {
      const res = await routes.execute(id, { input: { from: ANA_WA, to: ANA_WA, message: 'qualquer coisa' } })
      expect(res.body).toMatchObject({ status: 'success' })
    }
    expect(textsTo(ANA)).toEqual(['Resposta wf-quero', 'Resposta wf-none', 'Resposta wf-cr'])
  })

  it('EX-06: Aguardar sem telefone de retomada → run failed visível (não fica "running")', async () => {
    await publishKeywords('wf-espera', ['quero'], {
      root: steps.wait({ id: 'w', value: 5, unit: 'minutes', next: steps.whatsapp({ id: 'm', message: 'depois' }) }),
    })
    await routes.execute('wf-espera', { input: { message: 'quero' } })
    expect(h.db.row('workflow_runs', { workflow_id: 'wf-espera' })).toMatchObject({ status: 'failed', error: 'Delay sem telefone de retomada' })
    expect(h.db.count('workflow_enrollments')).toBe(0)
  })

  // Corrigido BUG(execute-rascunho): o /execute carrega a versão ATIVA via ensureWorkflowRecord e não checa
  // workflows.status — um fluxo em rascunho roda se alguém (o padrão, um cron, o admin) o chamar.
  // execute/route.ts:72-102.
  it('execute-rascunho: /execute não deveria rodar fluxo nunca publicado', async () => {
    await seedPublishedFlow(h.db, keywordFlow('wf-rascunho', ['quero']), { publish: false })
    await routes.execute('wf-rascunho', { input: { from: ANA_WA, to: ANA_WA, message: 'quero' } })
    expect(h.meta.sent).toEqual([])
    expect(h.db.row('workflow_runs', { workflow_id: 'wf-rascunho' })?.status).not.toBe('success')
  })
})
