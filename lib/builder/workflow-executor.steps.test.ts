// @vitest-environment node
/**
 * Executor do builder — passos individuais executados de verdade.
 *
 * Os grafos saem do compileFlow real (como a tela publica) ou, para os passos que a
 * tela ainda não emite (botões/lista), de um grafo cru com o actionType do plugin.
 * Tudo roda com o Supabase em memória (tests/helpers/in-memory-supabase.ts) e o mock
 * da Graph API (tests/helpers/meta-send-mock.ts): nada vai à rede.
 *
 * Cobre: payload exato enviado à Meta (texto, template, mídia, botões, lista),
 * substituição de variáveis, tags e pipeline com efeito no banco, Aguardar (pausa e
 * retomada sem reenvio), janela de horário, erros da Meta, retry/timeout, credenciais
 * ausentes e o registro de workflow_runs / workflow_run_logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { executeWorkflow } from '@/lib/builder/workflow-executor.workflow'
import {
  clearWorkflowExecutionConfigCache,
  getWorkflowExecutionConfig,
} from '@/lib/builder/workflow-execution-settings'
import type { WorkflowEdge, WorkflowNode } from '@/lib/builder/graph-types'
import type { FlowTrigger, Step } from '@/lib/builder/flow/types'
import type { WorkflowSettings } from '@/lib/builder/workflow-settings'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  compile,
  FAKE_WHATSAPP,
  freezeTime,
  makeFlow,
  resetWorkflowCaches,
  SEED_IDS,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_PHONES,
  TRIGGER_NODE_ID,
  triggers,
  waId,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

// ─── Infra local ───────────────────────────────────────────────────────────────

/** Contato Ana (semeado por defaultSeed, tags ['lead']). */
const PHONE = TEST_PHONES.ana
/** A Meta entrega `from` só com dígitos. */
const FROM = waId(PHONE)
const WF = 'wf-1'
const RUN = 'run-1'
const GRAPH_URL = `https://graph.facebook.com/v24.0/${FAKE_WHATSAPP.phoneNumberId}/messages`

type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
type NodeResult = { success: boolean; data?: unknown; error?: string }
type ExecResult = {
  success: boolean
  results: Record<string, NodeResult>
  outputs: Record<string, { label: string; data: unknown }>
  error?: string
  paused?: boolean
  wait?: { kind: 'delay'; resumeNodeIds: string[]; resumeInMs: number }
  variables?: Record<string, unknown>
  resolvedNodeIds?: string[]
  conversationId?: string
  resumeNodeId?: string
}

interface RunOpts {
  message?: string
  triggerInput?: Record<string, unknown>
  /** null = sem executionId (sem logs nem run) */
  executionId?: string | null
  /** null = sem workflowId */
  workflowId?: string | null
  startNodeIds?: string[]
  initialVariables?: Record<string, unknown>
  initialOutputs?: Record<string, unknown>
  alreadyResolvedNodeIds?: string[]
  workflowSettings?: WorkflowSettings
}

/** Config de execução determinística (sem timeout pendurado, sem retry). */
function execConfigRow(config: Record<string, unknown> = { retryCount: 0, retryDelayMs: 0, timeoutMs: 0 }): Row {
  return { key: 'workflow_execution_config', value: JSON.stringify(config) }
}

let h: WorkflowTestContext

beforeEach(async () => {
  h = setupWorkflowTest({ seed: { settings: [execConfigRow()], workflows: [{ id: WF, name: 'Fluxo de teste' }] } })
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

/** compileFlow real (o que a tela publica). */
function graphOf(root: Step | null, trigger: FlowTrigger = triggers.keywords(['oi'])): Graph {
  const compiled = compile(makeFlow({ id: WF, trigger, root }))
  return { nodes: compiled.nodes as unknown as WorkflowNode[], edges: compiled.edges as unknown as WorkflowEdge[] }
}

/** Grafo cru linear: __trigger → a1 → a2 ... (para actionTypes que a tela não emite). */
function rawChain(actions: Array<{ id: string; label?: string; config: Record<string, unknown> }>): Graph {
  const nodes = [
    {
      id: TRIGGER_NODE_ID,
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Gatilho', type: 'trigger', config: { triggerType: 'Keywords', keywordList: 'oi' } },
    },
    ...actions.map((a, i) => ({
      id: a.id,
      type: 'action',
      position: { x: 0, y: (i + 1) * 100 },
      data: { label: a.label ?? a.id, type: 'action', config: a.config },
    })),
  ]
  const ids = [TRIGGER_NODE_ID, ...actions.map((a) => a.id)]
  const edges = ids.slice(1).map((target, i) => ({ id: `e-${ids[i]}-${target}`, source: ids[i], target }))
  return { nodes: nodes as unknown as WorkflowNode[], edges: edges as unknown as WorkflowEdge[] }
}

function ensureRun(id: string, triggerType = 'Keywords'): void {
  if (!h.db.row('workflow_runs', { id })) {
    h.db.insert('workflow_runs', { id, workflow_id: WF, status: 'running', trigger_type: triggerType, input: {} })
  }
}

/** Execução inicial (como /execute): run pré-inserida 'running' + executeWorkflow real. */
async function run(graph: Graph, o: RunOpts = {}): Promise<ExecResult> {
  const executionId = o.executionId === undefined ? RUN : (o.executionId ?? undefined)
  if (executionId) ensureRun(executionId)
  return (await executeWorkflow({
    nodes: graph.nodes,
    edges: graph.edges,
    triggerInput: o.triggerInput ?? { from: FROM, to: FROM, message: o.message ?? 'oi' },
    executionId,
    workflowId: o.workflowId === undefined ? WF : (o.workflowId ?? undefined),
    startNodeIds: o.startNodeIds,
    initialVariables: o.initialVariables,
    initialOutputs: o.initialOutputs,
    alreadyResolvedNodeIds: o.alreadyResolvedNodeIds,
    workflowSettings: o.workflowSettings,
  })) as ExecResult
}

/**
 * Retomada de um Aguardar como lib/cron/workflow-enrollments.ts faz: nova run
 * 'DelayResume', startNodeIds = resumeNodeIds, snapshot jsonb (round-trip JSON) de
 * variables/outputs/resolved_nodes e triggerInput { from, to } SEM message.
 */
async function resumeDelay(graph: Graph, paused: ExecResult, executionId = 'run-delay'): Promise<ExecResult> {
  expect(paused.paused, 'a execução anterior deveria ter pausado').toBe(true)
  const snapshot = JSON.parse(
    JSON.stringify({ variables: paused.variables ?? {}, outputs: paused.outputs ?? {}, resolved: paused.resolvedNodeIds ?? [] })
  ) as { variables: Record<string, unknown>; outputs: Record<string, unknown>; resolved: string[] }
  ensureRun(executionId, 'DelayResume')
  return run(graph, {
    executionId,
    triggerInput: { from: PHONE, to: PHONE },
    startNodeIds: paused.wait!.resumeNodeIds,
    initialVariables: snapshot.variables,
    initialOutputs: snapshot.outputs,
    alreadyResolvedNodeIds: snapshot.resolved,
  })
}

function logsOf(runId = RUN): Row[] {
  return h.db.rows('workflow_run_logs').filter((r) => r.run_id === runId)
}

function setExecConfig(config: Record<string, unknown>): void {
  h.db.update('settings', { key: 'workflow_execution_config' }, { value: JSON.stringify(config) })
  clearWorkflowExecutionConfigCache()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Mensagem de texto ─────────────────────────────────────────────────────────

describe('WhatsApp — mensagem de texto (send-message)', () => {
  it('T01 envia o payload exato à Graph v24.0 com Bearer e devolve o wamid; run success', async () => {
    const graph = graphOf(steps.whatsapp({ id: 'w1', name: 'Boas-vindas', message: 'Olá! Bem-vindo' }))
    expect(graph.nodes.find((n) => n.id === 'w1')?.data.config).toEqual({
      actionType: 'whatsapp/send-message',
      toSource: 'inbound',
      message: 'Olá! Bem-vindo',
    })

    const res = await run(graph)

    expect(h.meta.calls).toHaveLength(1)
    const call = h.meta.calls[0]
    expect(call.url).toBe(GRAPH_URL)
    expect(call.method).toBe('POST')
    expect(call.headers.authorization).toBe(`Bearer ${FAKE_WHATSAPP.accessToken}`)
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'text',
      text: { body: 'Olá! Bem-vindo', preview_url: false },
    })
    expect(res.success).toBe(true)
    // O executor embrulha o retorno do passo: results.w1.data = { success, data: <resposta da Meta> }
    expect(res.results.w1).toMatchObject({
      success: true,
      data: { success: true, data: { messages: [{ id: 'wamid.TEST000001' }] } },
    })
    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({ status: 'success', error: null })
    expect(h.db.row('workflow_runs', { id: RUN })?.finished_at).toEqual(expect.any(String))
  })

  it('mensagem com espaços nas bordas sai aparada; quebras de linha internas preservadas', async () => {
    await run(graphOf(steps.whatsapp({ id: 'w1', message: '  Linha 1\nLinha 2  ' })))
    expect(h.meta.texts()).toEqual(['Linha 1\nLinha 2'])
  })

  it('destinatário vem do from do gatilho (só dígitos) normalizado para E.164; to/phone são fallback', async () => {
    const graph = graphOf(steps.whatsapp({ id: 'w1', message: 'oi' }))
    await run(graph, { triggerInput: { to: '5521988880003', message: 'oi' }, executionId: 'r-to' })
    await run(graph, { triggerInput: { phone: '+55 (11) 99999-0002', message: 'oi' }, executionId: 'r-phone' })
    expect(h.meta.sent.map((m) => m.to)).toEqual([TEST_PHONES.carla, TEST_PHONES.bruno])
  })

  it('previewUrl "true" no grafo cru liga preview_url', async () => {
    await run(
      rawChain([{ id: 'w1', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'veja https://x.test', previewUrl: 'true' } }])
    )
    expect(h.meta.last()?.body).toMatchObject({ type: 'text', text: { body: 'veja https://x.test', preview_url: true } })
  })

  it('toSource manual usa config.to (que pode vir de template)', async () => {
    await run(
      rawChain([
        {
          id: 'w1',
          config: { actionType: 'whatsapp/send-message', toSource: 'manual', to: '{{var.destino}}', message: 'Aviso interno' },
        },
      ]),
      { initialVariables: { destino: '5521988880003' } }
    )
    expect(h.meta.last()?.to).toBe(TEST_PHONES.carla)
  })

  it('mensagem que vira vazia depois das variáveis falha com "Message is required" sem chamar a Meta', async () => {
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: '{{var.nada}}' })))
    expect(res.results.w1).toEqual({ success: false, error: 'Message is required' })
    expect(h.meta.calls).toHaveLength(0)
  })
})

// ─── Template ──────────────────────────────────────────────────────────────────

describe('WhatsApp — template (send-template)', () => {
  it('T02 template tem prioridade sobre mensagem e mídia: payload exato com pt_BR e components []', async () => {
    const graph = graphOf(
      steps.whatsapp({ id: 'w1', template: 'boas_vindas', message: 'ignorada', mediaUrl: 'https://cdn.test/y.png' })
    )
    expect(graph.nodes.find((n) => n.id === 'w1')?.data.config).toEqual({
      actionType: 'whatsapp/send-template',
      toSource: 'inbound',
      templateName: 'boas_vindas',
      language: 'pt_BR',
    })
    const res = await run(graph)
    expect(h.meta.calls).toHaveLength(1)
    expect(h.meta.calls[0].body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'template',
      template: { name: 'boas_vindas', language: { code: 'pt_BR' }, components: [] },
    })
    expect(res.results.w1.success).toBe(true)
  })

  it('grafo cru com bodyParams/headerParams positional e named monta os components', async () => {
    await run(
      rawChain([
        {
          id: 'p',
          config: {
            actionType: 'whatsapp/send-template',
            toSource: 'inbound',
            templateName: 'pedido',
            language: 'en_US',
            bodyParams: '[{"text":"{{var.nome}}"},{"text":""},{"text":"42"}]',
            headerParams: '[{"text":"Topo"}]',
          },
        },
        {
          id: 'n',
          config: {
            actionType: 'whatsapp/send-template',
            toSource: 'inbound',
            templateName: 'pedido_named',
            parameterFormat: 'named',
            bodyParams: '[{"key":"nome","text":"Ana"}]',
          },
        },
      ]),
      { initialVariables: { nome: 'Ana' } }
    )
    expect(h.meta.sent[0].body.template).toEqual({
      name: 'pedido',
      language: { code: 'en_US' },
      components: [
        { type: 'header', parameters: [{ type: 'text', text: 'Topo' }] },
        // item sem text é descartado
        { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '42' }] },
      ],
    })
    expect(h.meta.sent[1].body.template).toEqual({
      name: 'pedido_named',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'nome', text: 'Ana' }] }],
    })
  })

  it('bodyParams com JSON inválido é ignorado em silêncio (template sai sem parâmetros)', async () => {
    await run(
      rawChain([{ id: 'p', config: { actionType: 'whatsapp/send-template', toSource: 'inbound', templateName: 't', bodyParams: '[{text' } }])
    )
    expect((h.meta.last()?.body.template as { components: unknown[] }).components).toEqual([])
  })

  it('templateName vazio falha com "Template name is required"', async () => {
    const res = await run(rawChain([{ id: 'p', config: { actionType: 'whatsapp/send-template', toSource: 'inbound', templateName: '  ' } }]))
    expect(res.results.p).toEqual({ success: false, error: 'Template name is required' })
    expect(h.meta.calls).toHaveLength(0)
  })

  // BUG(template-idioma): a tela lista templates aprovados de QUALQUER idioma
  // (ConfigPanel.tsx mostra "nome (idioma)") mas grava só o nome, e o compile fixa
  // language 'pt_BR' (lib/builder/flow/compile.ts:230). Um template aprovado só em
  // en_US sai com pt_BR e a Meta responde 132001 (template inexistente na tradução).
  it.fails('BUG(template-idioma): template aprovado só em en_US deveria sair com language en_US', async () => {
    h.db.insert('templates', {
      name: 'promo_en',
      language: 'en_US',
      status: 'APPROVED',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Hi there' }],
    })
    await run(graphOf(steps.whatsapp({ id: 'w1', template: 'promo_en' })))
    expect((h.meta.last()?.body.template as { language: { code: string } }).language.code).toBe('en_US')
  })

  // BUG(template-sem-params): sendTemplateStep não carrega o template do banco e não
  // passa `template` para buildMetaTemplatePayload (lib/builder/steps/whatsapp/send-template.ts:60-90);
  // o compile não gera bodyParams. Template com {{1}} vai sem parâmetros (Meta 132000) e
  // HEADER de mídia vai sem o parâmetro de mídia (Meta 132012) — o disparo de campanha resolve
  // isso passando o template; o passo do fluxo não.
  it.fails('BUG(template-sem-params): template com HEADER IMAGE e {{1}} deveria levar header de mídia e 1 parâmetro', async () => {
    h.db.insert('templates', {
      name: 'oferta',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://cdn.test/oferta.jpg'] } },
        { type: 'BODY', text: 'Olá {{1}}, sua oferta chegou', example: { body_text: [['Ana']] } },
      ],
    })
    await run(graphOf(steps.whatsapp({ id: 'w1', template: 'oferta' })))
    const components = (h.meta.last()?.body.template as { components: Array<{ type: string; parameters: unknown[] }> }).components
    expect(components.find((c) => c.type === 'header')?.parameters).toEqual([
      { type: 'image', image: { link: 'https://cdn.test/oferta.jpg' } },
    ])
    expect(components.find((c) => c.type === 'body')?.parameters).toHaveLength(1)
  })

  // BUG(json-template-aspas): processTemplates injeta o valor CRU dentro da string JSON de
  // bodyParams (lib/builder/workflow-executor.workflow.ts:505-515); um valor com aspas
  // invalida o JSON e parseJsonArray devolve [] em silêncio. Alcance baixo (a tela não gera
  // bodyParams), mas o grafo cru/API aceita.
  it.fails('BUG(json-template-aspas): variável com aspas dentro de bodyParams deveria virar o parâmetro literal', async () => {
    await run(
      rawChain([
        { id: 'p', config: { actionType: 'whatsapp/send-template', toSource: 'inbound', templateName: 't', bodyParams: '[{"text":"{{var.nome}}"}]' } },
      ]),
      { initialVariables: { nome: 'Ana "Aninha" Souza' } }
    )
    expect((h.meta.last()?.body.template as { components: unknown[] }).components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ana "Aninha" Souza' }] },
    ])
  })
})

// ─── Mídia ─────────────────────────────────────────────────────────────────────

describe('WhatsApp — mídia (send-media)', () => {
  it('T05 imagem com legenda (a mensagem vira caption) e sem legenda (chave caption omitida)', async () => {
    const withCaption = graphOf(steps.whatsapp({ id: 'w1', mediaUrl: 'https://cdn.test/foto.png', message: 'Legenda' }))
    expect(withCaption.nodes.find((n) => n.id === 'w1')?.data.config).toEqual({
      actionType: 'whatsapp/send-media',
      toSource: 'inbound',
      mediaType: 'image',
      mediaUrl: 'https://cdn.test/foto.png',
      caption: 'Legenda',
    })
    await run(withCaption, { executionId: 'r1' })
    await run(graphOf(steps.whatsapp({ id: 'w1', mediaUrl: 'https://cdn.test/foto.png', message: '' })), { executionId: 'r2' })

    expect(h.meta.sent[0].body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'image',
      image: { link: 'https://cdn.test/foto.png', caption: 'Legenda' },
    })
    expect(h.meta.sent[1].body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'image',
      image: { link: 'https://cdn.test/foto.png' },
    })
  })

  it('grafo cru: document recebe filename padrão, vídeo leva legenda, áudio não, mediaId vira id', async () => {
    await run(
      rawChain([
        { id: 'd', config: { actionType: 'whatsapp/send-media', toSource: 'inbound', mediaType: 'document', mediaUrl: 'https://cdn.test/c.pdf', caption: 'Contrato' } },
        { id: 'v', config: { actionType: 'whatsapp/send-media', toSource: 'inbound', mediaType: 'video', mediaId: 'MID-1', caption: 'Vídeo' } },
        { id: 'a', config: { actionType: 'whatsapp/send-media', toSource: 'inbound', mediaType: 'audio', mediaUrl: 'https://cdn.test/a.ogg', caption: 'ignorada' } },
      ])
    )
    expect(h.meta.sent.map((m) => ({ type: m.type, media: m.body[m.type] }))).toEqual([
      { type: 'document', media: { link: 'https://cdn.test/c.pdf', filename: 'document', caption: 'Contrato' } },
      { type: 'video', media: { id: 'MID-1', caption: 'Vídeo' } },
      { type: 'audio', media: { link: 'https://cdn.test/a.ogg' } },
    ])
  })

  it('sem mediaUrl nem mediaId falha com "Media URL or Media ID is required"', async () => {
    const res = await run(rawChain([{ id: 'm', config: { actionType: 'whatsapp/send-media', toSource: 'inbound', mediaType: 'image' } }]))
    expect(res.results.m).toEqual({ success: false, error: 'Media URL or Media ID is required' })
    expect(h.meta.calls).toHaveLength(0)
  })

  // BUG(midia-sempre-imagem): o formulário WhatsApp da tela só tem "Media URL" (sem tipo) e
  // o compile usa mediaType ?? 'image' (lib/builder/flow/compile.ts:236). Um PDF/MP4 sai como
  // { type: 'image' } e a Meta rejeita ou não entrega.
  it.fails('BUG(midia-sempre-imagem): URL de PDF deveria sair como document (com filename)', async () => {
    await run(graphOf(steps.whatsapp({ id: 'w1', mediaUrl: 'https://cdn.test/contrato.pdf', message: 'Segue o contrato' })))
    const sent = h.meta.last()!
    expect(sent.type).toBe('document')
    expect(sent.body.document).toMatchObject({ link: 'https://cdn.test/contrato.pdf', filename: expect.any(String) })
  })
})

// ─── Botões e lista (grafo cru: a tela ainda não emite) ────────────────────────

describe('WhatsApp — botões (send-buttons, grafo cru)', () => {
  const buttonsNode = (config: Record<string, unknown>) => ({
    id: 'b',
    config: { actionType: 'whatsapp/send-buttons', toSource: 'inbound', body: 'Escolha', ...config },
  })
  const after = { id: 'depois', config: { actionType: 'Set Variable', variableKey: 'k', variableValue: 'v' } }

  it('T07 payload interactive.button exato (header, body, footer, reply buttons)', async () => {
    const res = await run(
      rawChain([
        buttonsNode({
          headerText: 'Topo',
          footer: 'Rodapé',
          buttons: '[{"id":"s","title":"Sim"},{"id":"n","title":"Não"}]',
        }),
        after,
      ])
    )
    expect(h.meta.last()?.body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'Topo' },
        body: { text: 'Escolha' },
        footer: { text: 'Rodapé' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 's', title: 'Sim' } },
            { type: 'reply', reply: { id: 'n', title: 'Não' } },
          ],
        },
      },
    })
    expect(res.results.depois.success).toBe(true)
  })

  it.each([
    ['4 botões', JSON.stringify([1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` }))), /max 3 buttons/],
    ['título com 21 caracteres', JSON.stringify([{ id: 'x', title: 'a'.repeat(21) }]), /20 character limit/],
  ])('T07 %s: o builder lança, vira erro do nó, sem fetch, e a jusante é pulada sem travar', async (_label, buttons, error) => {
    const res = await run(rawChain([buttonsNode({ buttons }), after]))
    expect(res.results.b.success).toBe(false)
    expect(res.results.b.error).toMatch(error)
    expect(h.meta.calls).toHaveLength(0)
    expect(res.results.depois).toEqual({ success: false, error: 'skipped' })
    expect(res.success).toBe(false)
  })

  it.each([
    ['vazio', '[]'],
    ['JSON inválido', '[{id:'],
    ['objeto em vez de array', '{"id":"s"}'],
  ])('T07 buttons %s → "Buttons JSON is required"', async (_label, buttons) => {
    const res = await run(rawChain([buttonsNode({ buttons })]))
    expect(res.results.b).toEqual({ success: false, error: 'Buttons JSON is required' })
  })

  it('body vazio → "Body is required"; footer > 60 caracteres → erro do builder', async () => {
    const empty = await run(rawChain([buttonsNode({ body: ' ', buttons: '[{"id":"s","title":"Sim"}]' })]), { executionId: 'r1' })
    expect(empty.results.b.error).toBe('Body is required')
    const footer = await run(rawChain([buttonsNode({ footer: 'f'.repeat(61), buttons: '[{"id":"s","title":"Sim"}]' })]), { executionId: 'r2' })
    expect(footer.results.b.error).toMatch(/Footer text exceeds 60/)
    expect(h.meta.calls).toHaveLength(0)
  })
})

describe('WhatsApp — lista (send-list, grafo cru)', () => {
  const listNode = (config: Record<string, unknown>) => ({
    id: 'l',
    config: {
      actionType: 'whatsapp/send-list',
      toSource: 'inbound',
      body: 'Menu',
      buttonText: 'Opções',
      sections: '[{"title":"A","rows":[{"id":"1","title":"Um","description":"d"}]}]',
      ...config,
    },
  })

  it('T08 payload interactive.list exato', async () => {
    const res = await run(rawChain([listNode({})]))
    expect(res.results.l.success).toBe(true)
    expect(h.meta.last()?.body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: 'Menu' },
        action: { button: 'Opções', sections: [{ title: 'A', rows: [{ id: '1', title: 'Um', description: 'd' }] }] },
      },
    })
  })

  it('T08 validações: sem buttonText, sem sections, 11 linhas e título de linha > 24', async () => {
    const rows = (n: number) => JSON.stringify([{ title: 'S', rows: Array.from({ length: n }, (_, i) => ({ id: `${i}`, title: `Item ${i}` })) }])
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ buttonText: '' }, /^Button text is required$/],
      [{ sections: '[]' }, /^Sections JSON is required$/],
      [{ sections: rows(11) }, /max 10/],
      [{ sections: JSON.stringify([{ rows: [{ id: '1', title: 'x'.repeat(25) }] }]) }, /24 character limit/],
      [{ buttonText: 'b'.repeat(21) }, /20 character limit/],
    ]
    for (const [i, [config, error]] of cases.entries()) {
      const res = await run(rawChain([listNode(config)]), { executionId: `r${i}` })
      expect(res.results.l.success).toBe(false)
      expect(res.results.l.error).toMatch(error)
    }
    expect(h.meta.calls).toHaveLength(0)
  })
})

// ─── Variáveis ─────────────────────────────────────────────────────────────────

describe('Variáveis na mensagem', () => {
  it('T17 {{var.*}} e {{@__trigger:Gatilho.*}} substituídos (objeto vira JSON, ausente vira vazio)', async () => {
    await run(
      graphOf(
        steps.whatsapp({
          id: 'w1',
          message: 'Oi {{var.cidade}} / {{var.obj}} / {{var.nada}} / {{@__trigger:Gatilho.message}} / {{@__trigger:Gatilho.from}}',
        })
      ),
      { message: 'oi', initialVariables: { cidade: 'SP', obj: { a: 1 } } }
    )
    expect(h.meta.texts()).toEqual([`Oi SP / {"a":1} /  / oi / ${FROM}`])
  })

  it('saída de nó inexistente fica literal; campo inexistente de nó existente vira vazio', async () => {
    await run(graphOf(steps.whatsapp({ id: 'w1', message: 'A={{@fantasma:X.y}} B=[{{@__trigger:Gatilho.naoExiste}}]' })))
    expect(h.meta.texts()).toEqual(['A={{@fantasma:X.y}} B=[]'])
  })

  it('T18 (documenta) não há variável de contato: {{contato.nome}} chega literal e {{var.nome}} some', async () => {
    await run(graphOf(chain(steps.whatsapp({ id: 'w1', message: 'Olá {{contato.nome}}' }), steps.whatsapp({ id: 'w2', message: 'Olá {{var.nome}}!' }))))
    expect(h.meta.texts()).toEqual(['Olá {{contato.nome}}', 'Olá !'])
  })

  // BUG(variaveis-contato): o hint da tela manda usar "{{var.nome}}"
  // (components/flow-builder/ConfigPanel.tsx:600-603), mas o executor nunca popula
  // variables com dados do contato (lib/builder/workflow-executor.workflow.ts:494-593) e a
  // árvore não tem passo para definir variáveis: o cliente recebe "Olá !" ou o literal.
  it.fails('BUG(variaveis-contato): o nome do contato (Ana) deveria estar disponível na mensagem', async () => {
    await run(graphOf(chain(steps.whatsapp({ id: 'w1', message: 'Olá {{contato.nome}}' }), steps.whatsapp({ id: 'w2', message: 'Olá {{var.nome}}' }))))
    expect(h.meta.texts()).toContain('Olá Ana')
  })
})

// ─── Tags ──────────────────────────────────────────────────────────────────────

describe('Contatos — adicionar/remover tag', () => {
  it('T31 adiciona em contato existente achado por variante do telefone (sem "+"), via rpc', async () => {
    h.db.insert('contacts', { id: 'ct_1', name: 'Zé', phone: '5511988887777', tags: ['antiga'] })
    const graph = graphOf(steps.tag({ id: 't', tags: ['quente', ' vip ', 'quente'] }))
    expect(graph.nodes.find((n) => n.id === 't')?.data.config).toEqual({
      actionType: 'contacts/add-tag',
      toSource: 'inbound',
      tags: ['quente', 'vip'],
    })
    const res = await run(graph, { triggerInput: { from: '+5511988887777', message: 'oi' } })
    expect(res.results.t).toMatchObject({ success: true, data: { success: true, data: { contactId: 'ct_1', tags: ['quente', 'vip'] } } })
    expect(h.db.rpcCalls).toEqual([
      { name: 'bulk_update_contact_tags', args: { p_ids: ['ct_1'], p_tags_to_add: ['quente', 'vip'], p_tags_to_remove: [] } },
    ])
    expect(h.db.row('contacts', { id: 'ct_1' })?.tags).toEqual(['antiga', 'quente', 'vip'])
    expect(h.db.count('contacts', { phone: '+5511988887777' })).toBe(0) // não duplicou o contato
  })

  it('T31 "bug do 9": a Meta entrega o número sem o 9 e o contato salvo com 9 é encontrado', async () => {
    const withoutNine = '551199990001' // Ana (+5511999990001) sem o 9
    const res = await run(graphOf(steps.tag({ id: 't', tags: ['vip'] })), { triggerInput: { from: withoutNine, message: 'oi' } })
    expect(res.results.t.success).toBe(true)
    expect(h.db.row('contacts', { id: SEED_IDS.contacts.ana })?.tags).toEqual(['lead', 'vip'])
    expect(h.db.count('contacts')).toBe(2)
  })

  it('T31 contato inexistente é criado ({ phone E.164, name "", tags [] }) e recebe as tags', async () => {
    const res = await run(graphOf(steps.tag({ id: 't', tags: ['novo'] })), { triggerInput: { from: waId(TEST_PHONES.carla), message: 'oi' } })
    expect(res.results.t.success).toBe(true)
    const created = h.db.row('contacts', { phone: TEST_PHONES.carla })
    expect(created).toMatchObject({ name: '', tags: ['novo'] })
    expect(h.db.ops.find((o) => o.table === 'contacts' && o.op === 'insert')).toBeDefined()
  })

  it('T32 remover tag tira só as pedidas', async () => {
    h.db.update('contacts', { id: SEED_IDS.contacts.ana }, { tags: ['antiga', 'quente', 'vip'] })
    const res = await run(graphOf(steps.tagRemove({ id: 'r', tags: ['antiga', 'nao-tem'] })))
    expect(res.results.r.success).toBe(true)
    expect(h.db.rpcCalls[0].args).toEqual({ p_ids: [SEED_IDS.contacts.ana], p_tags_to_add: [], p_tags_to_remove: ['antiga', 'nao-tem'] })
    expect(h.db.row('contacts', { id: SEED_IDS.contacts.ana })?.tags).toEqual(['quente', 'vip'])
  })

  it('T32 erro da rpc vira erro do nó ("Add tag failed"/"Remove tag failed") e bloqueia a jusante', async () => {
    h.db.failNext('bulk_update_contact_tags', 'boom', 'rpc')
    const add = await run(graphOf(chain(steps.tag({ id: 't', tags: ['x'] }), steps.whatsapp({ id: 'w', message: 'depois' }))), { executionId: 'r1' })
    expect(add.results.t).toEqual({ success: false, error: 'Add tag failed: boom' })
    expect(add.results.w).toEqual({ success: false, error: 'skipped' })
    expect(h.meta.calls).toHaveLength(0)

    h.db.failNext('bulk_update_contact_tags', 'boom', 'rpc')
    const remove = await run(graphOf(steps.tagRemove({ id: 'r', tags: ['x'] })), { executionId: 'r2' })
    expect(remove.results.r).toEqual({ success: false, error: 'Remove tag failed: boom' })
  })

  it('T32 telefone inválido → "Contact phone not resolved"; tags como JSON string → "No tags configured"', async () => {
    const bad = await run(graphOf(steps.tag({ id: 't', tags: ['x'] })), { triggerInput: { from: 'abc', message: 'oi' }, executionId: 'r1' })
    expect(bad.results.t).toEqual({ success: false, error: 'Contact phone not resolved' })
    const json = await run(rawChain([{ id: 't', config: { actionType: 'contacts/add-tag', toSource: 'inbound', tags: '["x"]' } }]), { executionId: 'r2' })
    expect(json.results.t).toEqual({ success: false, error: 'No tags configured' })
    expect(h.db.rpcCalls).toHaveLength(0)
  })
})

// ─── Pipeline ──────────────────────────────────────────────────────────────────

describe('CRM — mover no pipeline (crm/move-pipeline)', () => {
  const pipelineGraph = (o: Parameters<typeof steps.pipeline>[0] = {}) => graphOf(steps.pipeline({ id: 'p', ...o }))

  it('T33 cria a oportunidade e depois move de etapa (stage_changed_at só muda quando a etapa muda)', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const created = await run(pipelineGraph({ stageId: SEED_IDS.stages.novo }), { executionId: 'r1' })
    expect(created.results.p).toMatchObject({
      success: true,
      data: { success: true, data: { created: true, pipelineId: SEED_IDS.pipeline, stageId: SEED_IDS.stages.novo, status: 'open' } },
    })
    expect(h.db.rows('opportunities')).toEqual([
      expect.objectContaining({
        pipeline_id: SEED_IDS.pipeline,
        stage_id: SEED_IDS.stages.novo,
        contact_id: SEED_IDS.contacts.ana,
        phone: PHONE,
        name: 'Ana',
        status: 'open',
        source: 'workflow',
        stage_changed_at: '2026-10-18T12:00:00.000Z',
      }),
    ])
    const oppId = h.db.rows('opportunities')[0].id

    advanceTime(60_000)
    const moved = await run(pipelineGraph({ stageId: SEED_IDS.stages.proposta }), { executionId: 'r2' })
    expect(moved.results.p).toMatchObject({ success: true, data: { data: { opportunityId: oppId, created: false } } })
    expect(h.db.count('opportunities')).toBe(1)
    expect(h.db.row('opportunities', { id: oppId })).toMatchObject({
      stage_id: SEED_IDS.stages.proposta,
      stage_changed_at: '2026-10-18T12:01:00.000Z',
      updated_at: '2026-10-18T12:01:00.000Z',
    })

    advanceTime(60_000)
    await run(pipelineGraph({ stageId: SEED_IDS.stages.proposta }), { executionId: 'r3' })
    expect(h.db.row('opportunities', { id: oppId })).toMatchObject({
      stage_changed_at: '2026-10-18T12:01:00.000Z', // mesma etapa: não mexe
      updated_at: '2026-10-18T12:02:00.000Z',
    })
  })

  it('contato novo (nome vazio): a oportunidade recebe o telefone como nome; oppName tem prioridade', async () => {
    await run(pipelineGraph(), { triggerInput: { from: waId(TEST_PHONES.carla), message: 'oi' }, executionId: 'r1' })
    expect(h.db.row('opportunities', { phone: TEST_PHONES.carla })?.name).toBe(TEST_PHONES.carla)

    h.db.insert('pipelines', { id: 'pl_suporte', name: 'Suporte' })
    h.db.insert('pipeline_stages', { id: 'pls_s1', pipeline_id: 'pl_suporte', name: 'Aberto' })
    await run(graphOf(steps.pipeline({ id: 'p2', pipelineId: 'pl_suporte', stageId: 'pls_s1', oppName: 'Lead do fluxo' })), { executionId: 'r2' })
    expect(h.db.row('opportunities', { pipeline_id: 'pl_suporte' })).toMatchObject({ name: 'Lead do fluxo', phone: PHONE })
  })

  it('etapa inexistente (pipeline reorganizado depois de publicar) → erro controlado, nada criado', async () => {
    const res = await run(graphOf(steps.pipeline({ id: 'p', stageId: 'pls_apagada' })))
    expect(res.results.p).toEqual({ success: false, error: 'Stage does not belong to the configured pipeline' })
    expect(h.db.count('opportunities')).toBe(0)
  })

  it('oportunidade aberta só por telefone (contact_id nulo, sem "+") é reaproveitada e vinculada ao contato', async () => {
    h.db.insert('opportunities', {
      id: 'op_legado',
      pipeline_id: SEED_IDS.pipeline,
      stage_id: SEED_IDS.stages.novo,
      contact_id: null,
      phone: FROM,
      name: 'Importada',
      status: 'open',
    })
    const res = await run(pipelineGraph({ stageId: SEED_IDS.stages.proposta }))
    expect(res.results.p).toMatchObject({ success: true, data: { data: { opportunityId: 'op_legado', created: false } } })
    expect(h.db.row('opportunities', { id: 'op_legado' })).toMatchObject({ contact_id: SEED_IDS.contacts.ana, stage_id: SEED_IDS.stages.proposta })
    expect(h.db.count('opportunities')).toBe(1)
  })

  it('T34 etapa de OUTRO pipeline → "Stage does not belong to the configured pipeline", nada criado', async () => {
    h.db.insert('pipelines', { id: 'pl_2', name: 'Outro' })
    h.db.insert('pipeline_stages', { id: 'pls_x', pipeline_id: 'pl_2', name: 'X' })
    const res = await run(pipelineGraph({ stageId: 'pls_x' }))
    expect(res.results.p).toEqual({ success: false, error: 'Stage does not belong to the configured pipeline' })
    expect(h.db.count('opportunities')).toBe(0)
  })

  it('T34 status inválido vira open; "won" fecha a aberta existente', async () => {
    await run(pipelineGraph({ oppStatus: 'invalido' as never }), { executionId: 'r1' })
    expect(h.db.rows('opportunities').map((o) => o.status)).toEqual(['open'])
    await run(pipelineGraph({ oppStatus: 'won' }), { executionId: 'r2' })
    expect(h.db.rows('opportunities').map((o) => o.status)).toEqual(['won'])
  })

  it('T34 (documenta) reexecutar com "won" quando não há aberta CRIA outra oportunidade ganha', async () => {
    await run(pipelineGraph({ oppStatus: 'won' }), { executionId: 'r1' })
    await run(pipelineGraph({ oppStatus: 'won' }), { executionId: 'r2' })
    expect(h.db.rows('opportunities').map((o) => o.status)).toEqual(['won', 'won'])
  })

  // BUG(pipeline-won-duplica): a busca considera só status='open'
  // (lib/builder/steps/crm/move-pipeline.ts:86-98). Um fluxo com reentrada que marca o
  // contato como "ganho" cria uma oportunidade ganha NOVA a cada execução (infla o CRM).
  it.fails('BUG(pipeline-won-duplica): reexecutar "won" para o mesmo contato não deveria duplicar a oportunidade', async () => {
    await run(pipelineGraph({ oppStatus: 'won' }), { executionId: 'r1' })
    await run(pipelineGraph({ oppStatus: 'won' }), { executionId: 'r2' })
    expect(h.db.count('opportunities')).toBe(1)
  })

  it('T35 cadeia tag → pipeline → whatsapp → remover tag numa run: um único contato, todos success, 1 envio', async () => {
    const res = await run(
      graphOf(
        chain(
          steps.tag({ id: 't', tags: ['quente'] }),
          steps.pipeline({ id: 'p' }),
          steps.whatsapp({ id: 'w', message: 'Recebemos seu contato' }),
          steps.tagRemove({ id: 'r', tags: ['quente'] })
        )
      ),
      { triggerInput: { from: waId(TEST_PHONES.carla), to: waId(TEST_PHONES.carla), message: 'oi' } }
    )
    expect(res.success).toBe(true)
    expect(Object.entries(res.results).map(([id, r]) => [id, r.success])).toEqual([
      [TRIGGER_NODE_ID, true],
      ['t', true],
      ['p', true],
      ['w', true],
      ['r', true],
    ])
    expect(h.db.count('contacts', { phone: TEST_PHONES.carla })).toBe(1)
    const carla = h.db.row('contacts', { phone: TEST_PHONES.carla })!
    expect(carla.tags).toEqual([])
    expect(h.db.row('opportunities', { phone: TEST_PHONES.carla })?.contact_id).toBe(carla.id)
    expect(h.meta.sentTo(TEST_PHONES.carla).map((m) => m.text)).toEqual(['Recebemos seu contato'])
  })
})

// ─── Aguardar e janela de horário ──────────────────────────────────────────────

describe('Aguardar (Delay durável)', () => {
  it('T27 pausa no Aguardar e a retomada envia só o passo seguinte (sem reenviar o anterior)', async () => {
    const graph = graphOf(
      chain(
        steps.whatsapp({ id: 'w1', message: 'Primeira' }),
        steps.wait({ id: 'wt', value: 2, unit: 'minutes' }),
        steps.whatsapp({ id: 'w2', message: 'Segunda' }),
        steps.end()
      )
    )
    expect(graph.nodes.find((n) => n.id === 'wt')?.data.config).toEqual({ actionType: 'Delay', delayMs: 120_000 })

    const first = await run(graph)
    expect(h.meta.texts()).toEqual(['Primeira'])
    expect(first).toMatchObject({ success: true, paused: true, wait: { kind: 'delay', resumeNodeIds: ['w2'], resumeInMs: 120_000 } })
    expect(first.resolvedNodeIds).toEqual(expect.arrayContaining([TRIGGER_NODE_ID, 'w1', 'wt']))
    expect(first.resolvedNodeIds).not.toContain('w2')
    // O executor não grava status na pausa por Delay: quem põe 'waiting' é a borda (/execute).
    expect(h.db.row('workflow_runs', { id: RUN })?.status).toBe('running')

    const resumed = await resumeDelay(graph, first)
    expect(h.meta.texts()).toEqual(['Primeira', 'Segunda'])
    expect(resumed.success).toBe(true)
    expect(Object.keys(resumed.results)).toEqual(['w2'])
    expect(h.db.row('workflow_runs', { id: 'run-delay' })?.status).toBe('success')
  })

  it('T28 Aguardar antes da Condição: retoma em TODAS as branches e o {{@__trigger}} vem do snapshot', async () => {
    const graph = graphOf(
      chain(
        steps.wait({ id: 'wt', value: 1, unit: 'hours' }),
        steps.condition({
          id: 'c',
          branches: [{ label: 'Oi', value: 'oi', child: steps.whatsapp({ id: 'wA', message: 'Disse oi' }) }],
          none: steps.whatsapp({ id: 'wB', message: 'Outra coisa' }),
        })
      )
    )
    const first = await run(graph, { message: 'oi, tudo bem?' })
    expect(first.wait).toEqual({ kind: 'delay', resumeNodeIds: ['c__cond_0', 'c__cond_none'], resumeInMs: 3_600_000 })
    expect(h.meta.calls).toHaveLength(0)

    await resumeDelay(graph, first)
    expect(h.meta.texts()).toEqual(['Disse oi'])
  })

  it('T28 (documenta) sem o snapshot de outputs a condição sobre o gatilho morre: nenhuma branch, nem None', async () => {
    const graph = graphOf(
      chain(
        steps.wait({ id: 'wt', value: 1, unit: 'hours' }),
        steps.condition({
          id: 'c',
          branches: [{ label: 'Oi', value: 'oi', child: steps.whatsapp({ id: 'wA', message: 'Disse oi' }) }],
          none: steps.whatsapp({ id: 'wB', message: 'Outra coisa' }),
        })
      )
    )
    const first = await run(graph, { message: 'oi' })
    const res = await run(graph, {
      executionId: 'run-sem-snapshot',
      triggerInput: { from: PHONE, to: PHONE },
      startNodeIds: first.wait!.resumeNodeIds,
      alreadyResolvedNodeIds: first.resolvedNodeIds,
    })
    expect(h.meta.calls).toHaveLength(0)
    expect(res.results.wA).toEqual({ success: false, error: 'skipped' })
    expect(res.results.wB).toEqual({ success: false, error: 'skipped' })
  })

  it('T29 Aguardar terminal (sem próximo passo) não pausa e a run termina success', async () => {
    const res = await run(graphOf(chain(steps.whatsapp({ id: 'w1', message: 'Tchau' }), steps.wait({ id: 'wt', value: 5 }))))
    expect(res.paused).toBeUndefined()
    expect(res.success).toBe(true)
    expect(res.results.wt).toEqual({ success: true, data: { delayMs: 300_000 } })
    expect(h.db.row('workflow_runs', { id: RUN })?.status).toBe('success')
  })

  it('Aguardar em sequência: cada retomada pausa no próximo e nada é reenviado', async () => {
    const graph = graphOf(
      chain(
        steps.whatsapp({ id: 'w1', message: 'Um' }),
        steps.wait({ id: 'd1', value: 1 }),
        steps.whatsapp({ id: 'w2', message: 'Dois' }),
        steps.wait({ id: 'd2', value: 3, unit: 'days' }),
        steps.whatsapp({ id: 'w3', message: 'Três' })
      )
    )
    const p1 = await run(graph)
    const p2 = await resumeDelay(graph, p1, 'r-2')
    expect(p2).toMatchObject({ paused: true, wait: { resumeNodeIds: ['w3'], resumeInMs: 3 * 86_400_000 } })
    expect(p2.resolvedNodeIds).toEqual(expect.arrayContaining([TRIGGER_NODE_ID, 'w1', 'd1', 'w2', 'd2']))
    await resumeDelay(graph, p2, 'r-3')
    expect(h.meta.texts()).toEqual(['Um', 'Dois', 'Três'])
  })

  it('compile barra Aguardar inválido: modo "até resposta", 0 minutos e > ~24 dias', () => {
    expect(() => graphOf(steps.wait({ id: 'w', mode: 'reply' }))).toThrow(/aguardar até resposta ainda não é suportado/)
    expect(() => graphOf(steps.wait({ id: 'w', value: 0 }))).toThrow(/duração inválida/)
    expect(() => graphOf(steps.wait({ id: 'w', value: 25, unit: 'days' }))).toThrow(/excede o máximo/)
  })
})

describe('Janela de horário (settings.timeWindow)', () => {
  // 2026-10-19 é segunda-feira; 06:00Z = 03:00 em America/Sao_Paulo.
  const window = { enabled: true, days: [1], start: '09:00', end: '18:00', timezone: 'America/Sao_Paulo' }

  it('T30 fora da janela: a tag roda, o WhatsApp pausa NO PRÓPRIO nó (sem enviar) até a abertura', async () => {
    freezeTime('2026-10-19T06:00:00.000Z')
    const graph = graphOf(chain(steps.tag({ id: 't', tags: ['madrugada'] }), steps.whatsapp({ id: 'w1', message: 'Bom dia!' })))
    const res = await run(graph, { workflowSettings: { timeWindow: window } })
    expect(h.db.rpcCalls.map((c) => c.name)).toEqual(['bulk_update_contact_tags'])
    expect(h.meta.calls).toHaveLength(0)
    expect(res).toMatchObject({ paused: true, wait: { kind: 'delay', resumeNodeIds: ['w1'], resumeInMs: 6 * 3_600_000 } })
    expect(res.resolvedNodeIds).toEqual(expect.arrayContaining([TRIGGER_NODE_ID, 't']))
    expect(res.resolvedNodeIds).not.toContain('w1')

    // Na retomada (dentro da janela) o próprio nó envia e a tag não roda de novo.
    advanceTime(6 * 3_600_000)
    await resumeDelay(graph, res)
    expect(h.meta.texts()).toEqual(['Bom dia!'])
    expect(h.db.rpcCalls).toHaveLength(1)
  })

  it('dentro da janela, janela sem dias ou invertida: envia normalmente', async () => {
    freezeTime('2026-10-19T15:00:00.000Z') // 12:00 local
    const graph = graphOf(steps.whatsapp({ id: 'w1', message: 'Agora' }))
    await run(graph, { workflowSettings: { timeWindow: window }, executionId: 'r1' })
    freezeTime('2026-10-19T06:00:00.000Z')
    await run(graph, { workflowSettings: { timeWindow: { ...window, days: [] } }, executionId: 'r2' })
    await run(graph, { workflowSettings: { timeWindow: { ...window, start: '18:00', end: '09:00' } }, executionId: 'r3' })
    expect(h.meta.texts()).toEqual(['Agora', 'Agora', 'Agora'])
  })
})

// ─── Erros da Meta, retry e credenciais ────────────────────────────────────────

describe('Erros da Meta e resiliência', () => {
  it('T39 131047 (janela de 24h): registra o erro, não trava, bloqueia a jusante e fecha a run como error', async () => {
    h.meta.failNext({ code: 131047, subcode: 2494010 })
    const graph = graphOf(
      chain(steps.whatsapp({ id: 'w1', name: 'Oferta', message: 'Oferta' }), steps.tag({ id: 't', tags: ['x'] }), steps.whatsapp({ id: 'w2', message: 'Depois' }))
    )
    const res = await run(graph)
    const expectedError = 'WhatsApp send failed: Re-engagement message | code 131047 | subcode 2494010'

    expect(res.success).toBe(false)
    expect(res.results.w1).toEqual({ success: false, error: expectedError })
    expect(res.results.t).toEqual({ success: false, error: 'skipped' })
    expect(res.results.w2).toEqual({ success: false, error: 'skipped' })
    expect(h.meta.calls).toHaveLength(1)
    expect(h.db.rpcCalls).toHaveLength(0)

    const w1Log = logsOf().find((l) => l.node_id === 'w1')!
    expect(w1Log).toMatchObject({ status: 'error', error: expectedError, node_name: 'Oferta', node_type: 'whatsapp/send-message' })
    expect(w1Log.completed_at).toEqual(expect.any(String))
    // output do log = { error, details: { details: <corpo da Meta>, payload } }
    expect(w1Log.output).toMatchObject({
      error: expectedError,
      details: { details: { error: { code: 131047, error_subcode: 2494010 } }, payload: { type: 'text', to: PHONE } },
    })
    // nós pulados não geram log
    expect(logsOf().map((l) => l.node_id)).toEqual([TRIGGER_NODE_ID, 'w1'])
    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({ status: 'error', error: expectedError, output: null })
    expect(h.db.row('workflow_runs', { id: RUN })?.finished_at).toEqual(expect.any(String))
  })

  it.each([131056, 130429, 190, 132001])('erro %i da Meta vira erro do nó com o código na mensagem', async (code) => {
    h.meta.failNext(code)
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })))
    expect(res.results.w1.success).toBe(false)
    expect(res.results.w1.error).toMatch(new RegExp(`^WhatsApp send failed: .+ \\| code ${code}$`))
  })

  it('resposta não-JSON da Meta (5xx de proxy) vira "WhatsApp send failed" genérico, sem travar', async () => {
    h.meta.route(/\/messages$/, () => new Response('<html>Bad gateway</html>', { status: 502 }))
    const res = await run(graphOf(chain(steps.whatsapp({ id: 'w1', message: 'oi' }), steps.tag({ id: 't', tags: ['x'] }))))
    expect(res.results.w1).toEqual({ success: false, error: 'WhatsApp send failed' })
    expect(res.results.t).toEqual({ success: false, error: 'skipped' })
    // hoje o log só guarda o payload enviado (ver BUG(meta-erro-texto-perdido))
    expect(logsOf().find((l) => l.node_id === 'w1')?.output).toMatchObject({ details: { payload: { type: 'text' } } })
  })

  // BUG(meta-erro-texto-perdido): sendWhatsAppPayload chama safeJson(response) (consome o
  // corpo) e, se não for JSON, safeText(response) no MESMO Response — que já foi lido e
  // devolve null (lib/builder/steps/whatsapp/shared.ts:78-80). O corpo de um 5xx/HTML do
  // proxy some do log: o operador vê só "WhatsApp send failed".
  it.fails('BUG(meta-erro-texto-perdido): corpo não-JSON do erro deveria ir para os detalhes do log', async () => {
    h.meta.route(/\/messages$/, () => new Response('<html>Bad gateway</html>', { status: 502 }))
    await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })))
    expect(logsOf().find((l) => l.node_id === 'w1')?.output).toMatchObject({ details: { details: '<html>Bad gateway</html>' } })
  })

  it('T40 (documenta) 131056 com retryCount 2: retorno {success:false} NÃO é re-tentado (1 único envio)', async () => {
    setExecConfig({ retryCount: 2, retryDelayMs: 0, timeoutMs: 0 })
    h.meta.failNext(131056)
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })))
    expect(h.meta.fetch).toHaveBeenCalledTimes(1)
    expect(res.results.w1.error).toContain('code 131056')
    expect(logsOf().filter((l) => l.node_id === 'w1')).toHaveLength(1)
  })

  it('T40 exceção de rede é re-tentada: 2 fetches, nó success e 2 logs (error + success)', async () => {
    setExecConfig({ retryCount: 2, retryDelayMs: 0, timeoutMs: 0 })
    h.meta.fetch.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed')
    })
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })))
    expect(h.meta.fetch).toHaveBeenCalledTimes(2)
    expect(res.results.w1.success).toBe(true)
    expect(h.meta.texts()).toEqual(['oi'])
    expect(logsOf().filter((l) => l.node_id === 'w1').map((l) => [l.status, l.error])).toEqual([
      ['error', 'fetch failed'],
      ['success', null],
    ])
  })

  it('exceção de rede esgota os retries: erro do nó (sem travar) e a jusante é pulada', async () => {
    setExecConfig({ retryCount: 1, retryDelayMs: 0, timeoutMs: 0 })
    h.meta.fetch.mockImplementation(async () => {
      throw new TypeError('fetch failed')
    })
    const res = await run(graphOf(chain(steps.whatsapp({ id: 'w1', message: 'oi' }), steps.tag({ id: 't', tags: ['x'] }))))
    expect(h.meta.fetch).toHaveBeenCalledTimes(2)
    expect(res.results.w1).toEqual({ success: false, error: 'fetch failed' })
    expect(res.results.t).toEqual({ success: false, error: 'skipped' })
    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({ status: 'error', error: 'fetch failed' })
  })

  it('config do nó (retryCount) sobrepõe o padrão global', async () => {
    h.meta.fetch.mockImplementationOnce(async () => {
      throw new TypeError('socket hang up')
    })
    const res = await run(
      rawChain([{ id: 'w1', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'oi', retryCount: 1, retryDelayMs: 0 } }])
    )
    expect(res.results.w1.success).toBe(true)
    expect(h.meta.fetch).toHaveBeenCalledTimes(2)
  })

  // BUG(timeout-reenvio): runWithTimeout rejeita mas NÃO cancela o passo
  // (lib/builder/workflow-executor.workflow.ts:277-312). Com retry, um envio lento é
  // refeito enquanto o primeiro ainda completa: o contato recebe a mensagem 2x.
  it.fails('BUG(timeout-reenvio): passo que estoura o timeout com retry não deveria enviar a mensagem duas vezes', async () => {
    const original = h.meta.fetch.getMockImplementation()!
    h.meta.fetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      await sleep(60)
      return original(input, init)
    })
    await run(
      rawChain([
        { id: 'w1', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'Promo', retryCount: 1, retryDelayMs: 0, timeoutMs: 15 } },
      ])
    )
    await sleep(120) // deixa o primeiro envio (lento) terminar
    expect(h.meta.texts()).toEqual(['Promo'])
  })

  it('T47 credenciais ausentes: "WhatsApp not configured" sem fetch, com log de erro', async () => {
    h.db.delete('settings', { key: 'accessToken' })
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })))
    expect(res.results.w1).toEqual({ success: false, error: 'WhatsApp not configured' })
    expect(h.meta.calls).toHaveLength(0)
    expect(logsOf().find((l) => l.node_id === 'w1')).toMatchObject({ status: 'error', error: 'WhatsApp not configured' })
  })

  it('T47 destinatário inválido: erro com o valor cru, sem fetch, com log de erro', async () => {
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })), { triggerInput: { from: 'abc', message: 'oi' } })
    expect(res.results.w1).toEqual({ success: false, error: 'Recipient phone number is invalid: "abc"' })
    expect(h.meta.calls).toHaveLength(0)
    expect(logsOf().find((l) => l.node_id === 'w1')).toMatchObject({ status: 'error', error: 'Recipient phone number is invalid: "abc"' })
  })

  it('sem nenhum telefone no gatilho: erro com valor vazio', async () => {
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })), { triggerInput: { message: 'oi' } })
    expect(res.results.w1).toEqual({ success: false, error: 'Recipient phone number is invalid: ""' })
  })
})

// ─── Run e logs ────────────────────────────────────────────────────────────────

describe('workflow_runs e workflow_run_logs', () => {
  it('T41 caminho feliz: um log por nó executado, em ordem, com input limpo e a run success', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const res = await run(
      graphOf(chain(steps.whatsapp({ id: 'w1', name: 'Boas-vindas', message: 'Olá' }), steps.tag({ id: 't', name: 'Marca lead', tags: ['lead-quente'] })))
    )
    expect(res.success).toBe(true)
    const logs = logsOf()
    expect(logs.map((l) => [l.node_id, l.node_name, l.node_type, l.status])).toEqual([
      [TRIGGER_NODE_ID, 'Palavras-chave', 'trigger', 'success'],
      ['w1', 'Boas-vindas', 'whatsapp/send-message', 'success'],
      ['t', 'Marca lead', 'contacts/add-tag', 'success'],
    ])
    for (const log of logs) {
      expect(log).toMatchObject({ run_id: RUN, error: null, started_at: '2026-10-18T12:00:00.000Z', completed_at: '2026-10-18T12:00:00.000Z' })
    }
    // trigger: input { triggerData } e output = dados do gatilho
    expect(logs[0].input).toEqual({ triggerData: { triggered: true, timestamp: Date.now(), from: FROM, to: FROM, message: 'oi' } })
    expect(logs[0].output).toMatchObject({ triggered: true, message: 'oi' })
    // passo: config + triggerData, sem _context/actionType
    expect(logs[1].input).toEqual({ toSource: 'inbound', message: 'Olá', triggerData: { from: FROM, to: FROM, message: 'oi' } })
    expect(logs[1].output).toMatchObject({ messages: [{ id: 'wamid.TEST000001' }] })
    expect(logs[2].output).toEqual({ contactId: SEED_IDS.contacts.ana, tags: ['lead-quente'] })

    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({
      status: 'success',
      error: null,
      finished_at: '2026-10-18T12:00:00.000Z',
      // output = data do ÚLTIMO resultado (o passo de tag, embrulhado)
      output: { success: true, data: { contactId: SEED_IDS.contacts.ana, tags: ['lead-quente'] } },
    })
  })

  it('sem executionId: nada é gravado em workflow_run_logs nem em workflow_runs', async () => {
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })), { executionId: null })
    expect(res.success).toBe(true)
    expect(h.db.count('workflow_run_logs')).toBe(0)
    expect(h.db.count('workflow_runs')).toBe(0)
    expect(h.meta.texts()).toEqual(['oi'])
  })

  it('T42 (documenta) Delay, Get/Set Variable não geram log (lacuna de observabilidade)', async () => {
    const graph = graphOf(chain(steps.whatsapp({ id: 'w1', message: 'oi' }), steps.wait({ id: 'wt', value: 1 }), steps.whatsapp({ id: 'w2', message: 'fim' })))
    await run(graph)
    expect(logsOf().map((l) => l.node_id)).toEqual([TRIGGER_NODE_ID, 'w1'])
    await run(rawChain([{ id: 'sv', config: { actionType: 'Set Variable', variableKey: 'k', variableValue: 'v' } }]), { executionId: 'r-vars' })
    expect(logsOf('r-vars').map((l) => l.node_id)).toEqual([TRIGGER_NODE_ID])
  })

  it('falha ao gravar log é engolida: o passo envia e a run fecha normalmente', async () => {
    h.db.failNext('workflow_run_logs', 'logs fora do ar', { op: 'insert', times: Infinity })
    const res = await run(graphOf(steps.whatsapp({ id: 'w1', message: 'oi' })))
    expect(res.success).toBe(true)
    expect(h.meta.texts()).toEqual(['oi'])
    expect(h.db.count('workflow_run_logs')).toBe(0)
    expect(h.db.row('workflow_runs', { id: RUN })?.status).toBe('success')
  })

  it('nó com enabled=false é pulado (sem envio) e bloqueia a jusante', async () => {
    const graph = rawChain([
      { id: 'w1', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'desligado' } },
      { id: 'w2', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'depois' } },
    ])
    ;(graph.nodes[1].data as { enabled?: boolean }).enabled = false
    const res = await run(graph)
    expect(h.meta.calls).toHaveLength(0)
    expect(res.results.w1).toEqual({ success: false, error: 'skipped' })
    expect(res.results.w2).toEqual({ success: false, error: 'skipped' })
  })

  it('actionType ausente ou fora da allowlist: erro controlado, sem despachar', async () => {
    const res = await run(
      rawChain([
        { id: 'a', label: 'Sem tipo', config: {} },
      ]),
      { executionId: 'r1' }
    )
    expect(res.results.a).toEqual({ success: false, error: 'Action node "Sem tipo" has no action type configured' })
    const forged = await run(rawChain([{ id: 'q', label: 'SQL', config: { actionType: 'Database Query', query: 'drop table x' } }]), { executionId: 'r2' })
    expect(forged.results.q).toEqual({ success: false, error: 'Action type "Database Query" is not supported (node "SQL").' })
  })
})

// ─── Config de execução ────────────────────────────────────────────────────────

describe('getWorkflowExecutionConfig (settings.workflow_execution_config)', () => {
  it('T48 lê do banco com clamp (retry 0-10, delay/timeout 0-60000) e source "db"', async () => {
    setExecConfig({ retryCount: 99, retryDelayMs: -5, timeoutMs: 'abc' })
    expect(await getWorkflowExecutionConfig()).toEqual({ config: { retryCount: 10, retryDelayMs: 0, timeoutMs: 0 }, source: 'db' })
    setExecConfig({ retryCount: 2.9, retryDelayMs: 999_999, timeoutMs: 1500 })
    expect((await getWorkflowExecutionConfig()).config).toEqual({ retryCount: 2, retryDelayMs: 60_000, timeoutMs: 1500 })
  })

  it('T48 cache de 30s: a 2ª chamada não relê o banco até clearWorkflowExecutionConfigCache', async () => {
    setExecConfig({ retryCount: 1 })
    const reads = () => h.db.ops.filter((o) => o.table === 'settings' && o.op === 'select').length
    await getWorkflowExecutionConfig()
    const after1 = reads()
    h.db.update('settings', { key: 'workflow_execution_config' }, { value: JSON.stringify({ retryCount: 5 }) })
    expect((await getWorkflowExecutionConfig()).config.retryCount).toBe(1)
    expect(reads()).toBe(after1)
    clearWorkflowExecutionConfigCache()
    expect((await getWorkflowExecutionConfig()).config.retryCount).toBe(5)
  })

  it('T48 JSON inválido ou ausente usa o env (com clamp); chaves ausentes no JSON também', async () => {
    vi.stubEnv('WORKFLOW_EXECUTION_RETRY_COUNT', '3')
    vi.stubEnv('WORKFLOW_EXECUTION_RETRY_DELAY_MS', '250')
    vi.stubEnv('WORKFLOW_EXECUTION_TIMEOUT_MS', '999999')
    h.db.update('settings', { key: 'workflow_execution_config' }, { value: '{nao-e-json' })
    clearWorkflowExecutionConfigCache()
    expect(await getWorkflowExecutionConfig()).toEqual({ config: { retryCount: 3, retryDelayMs: 250, timeoutMs: 60_000 }, source: 'env' })

    setExecConfig({ retryCount: 0 })
    expect(await getWorkflowExecutionConfig()).toEqual({ config: { retryCount: 0, retryDelayMs: 250, timeoutMs: 60_000 }, source: 'db' })

    h.db.delete('settings', { key: 'workflow_execution_config' })
    clearWorkflowExecutionConfigCache()
    expect((await getWorkflowExecutionConfig()).source).toBe('env')
  })
})
