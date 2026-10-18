// @vitest-environment node
/**
 * Executor do builder — ramificações e roteamento de grafos compilados de verdade.
 *
 * Perguntar (envio + pausa + retomada com a resposta escolhendo a branch), Condição
 * (contains / not_contains / equals + None, exclusividade, escape), END, Split/Go To
 * (ainda não compilam), grafos com ciclo, gatilhos (sem gatilho, palavra-chave,
 * respondeu ao disparo) e o status final de workflow_runs.
 *
 * As retomadas espelham as bordas reais:
 *  - Perguntar → app/api/builder/workflow/[workflowId]/resume/route.ts
 *    (startNodeIds = [resume_node_id], initialVariables = conversa + resposta, SEM outputs);
 *  - Aguardar → lib/cron/workflow-enrollments.ts (snapshot de variables/outputs/resolved).
 * Os casos de "run órfã" usam as rotas e o drain REAIS (seedPublishedFlow + routes.*).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { executeWorkflow } from '@/lib/builder/workflow-executor.workflow'
import { FlowCompileError } from '@/lib/builder/flow/compile'
import type { WorkflowEdge, WorkflowNode } from '@/lib/builder/graph-types'
import type { FlowTrigger, Step } from '@/lib/builder/flow/types'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  createBarrier,
  compile,
  freezeTime,
  headsAfterTrigger,
  makeFlow,
  resetWorkflowCaches,
  routes,
  SEED_IDS,
  seedPublishedFlow,
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

const PHONE = TEST_PHONES.ana
const FROM = waId(PHONE)
const WF = 'wf-1'
const RUN = 'run-1'

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
  executionId?: string | null
  workflowId?: string | null
  startNodeIds?: string[]
  initialVariables?: Record<string, unknown>
  initialOutputs?: Record<string, unknown>
  alreadyResolvedNodeIds?: string[]
}

let h: WorkflowTestContext

beforeEach(async () => {
  h = setupWorkflowTest({
    seed: {
      settings: [{ key: 'workflow_execution_config', value: JSON.stringify({ retryCount: 0, retryDelayMs: 0, timeoutMs: 0 }) }],
      workflows: [{ id: WF, name: 'Fluxo de teste' }],
    },
  })
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

function graphOf(root: Step | null, trigger: FlowTrigger = triggers.keywords(['oi'])): Graph {
  const compiled = compile(makeFlow({ id: WF, trigger, root }))
  return { nodes: compiled.nodes as unknown as WorkflowNode[], edges: compiled.edges as unknown as WorkflowEdge[] }
}

function ensureRun(id: string, triggerType = 'Keywords'): void {
  if (!h.db.row('workflow_runs', { id })) {
    h.db.insert('workflow_runs', { id, workflow_id: WF, status: 'running', trigger_type: triggerType, input: {} })
  }
}

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
  })) as ExecResult
}

function waitingConversation(): Row {
  const conv = h.db.rows('workflow_conversations').filter((c) => c.status === 'waiting').at(-1)
  expect(conv, 'deveria haver uma conversa waiting').toBeDefined()
  return conv!
}

let resumeSeq = 0
/** Espelha resume/route.ts: nova run 'Resume', resposta aparada, sem initialOutputs. */
async function resumeAsk(graph: Graph, answer: string, opts: { executionId?: string } = {}): Promise<ExecResult> {
  const conv = waitingConversation()
  const message = answer.trim()
  const nextVariables = { ...((conv.variables as Record<string, unknown> | null) ?? {}), [String(conv.variable_key)]: message }
  resumeSeq += 1
  const executionId = opts.executionId ?? `run-resume-${resumeSeq}`
  ensureRun(executionId, 'Resume')
  const res = await run(graph, {
    executionId,
    triggerInput: { from: conv.phone, to: conv.phone, message },
    startNodeIds: [String(conv.resume_node_id)],
    initialVariables: nextVariables,
  })
  h.db.update('workflow_conversations', { id: conv.id }, { status: 'completed', variables: nextVariables })
  return res
}

/** Condições (Condition) que avaliaram true nesta execução. */
function trueConditions(res: ExecResult): string[] {
  return Object.entries(res.results)
    .filter(([, r]) => (r.data as { condition?: boolean } | undefined)?.condition === true)
    .map(([id]) => id)
}

/** O fluxo "Vendas ou suporte?" do plano (T09/T10/T37). */
function salesSupportGraph(): Graph {
  return graphOf(
    steps.interactive({
      id: 'ask',
      message: 'Vendas ou suporte?',
      buttons: [{ label: 'Vendas', child: steps.whatsapp({ id: 'w2', message: 'Vendas!' }) }, { label: 'Suporte' }],
      next: steps.whatsapp({ id: 'w4', message: 'Obrigado' }),
    })
  )
}

// ─── Perguntar ─────────────────────────────────────────────────────────────────

describe('Perguntar (interactive) — envio e pausa', () => {
  it('T09 envia a pergunta, grava a conversa, põe a run em waiting e não executa nada depois', async () => {
    const graph = salesSupportGraph()
    expect(graph.nodes.find((n) => n.id === 'ask')?.data.config).toEqual({
      actionType: 'whatsapp/ask-question',
      toSource: 'inbound',
      message: 'Vendas ou suporte?',
      variableKey: 'reply_ask',
    })

    const res = await run(graph)

    expect(h.meta.calls).toHaveLength(1)
    expect(h.meta.calls[0].body).toEqual({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'text',
      text: { body: 'Vendas ou suporte?', preview_url: false },
    })
    expect(res).toMatchObject({ success: true, paused: true, resumeNodeId: 'ask__var', conversationId: expect.any(String) })
    expect(Object.keys(res.results)).toEqual([TRIGGER_NODE_ID, 'ask'])

    const conversations = h.db.rows('workflow_conversations')
    expect(conversations).toHaveLength(1)
    expect(conversations[0]).toMatchObject({
      id: res.conversationId,
      workflow_id: WF,
      phone: PHONE,
      status: 'waiting',
      resume_node_id: 'ask__var',
      variable_key: 'reply_ask',
      variables: {},
    })
    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({
      status: 'waiting',
      output: { status: 'waiting', conversationId: res.conversationId, resumeNodeId: 'ask__var', variableKey: 'reply_ask' },
      finished_at: null,
    })
  })

  it('T13 (documenta) o Perguntar envia TEXTO simples: os botões configurados não chegam à Meta', async () => {
    await run(salesSupportGraph())
    expect(h.meta.last()?.type).toBe('text')
    expect(JSON.stringify(h.meta.last()?.body)).not.toContain('Suporte')
  })

  // BUG(perguntar-sem-botoes): a tela configura 1 a 3 botões "≤20 caracteres (limite dos
  // botões do WhatsApp)" (components/flow-builder/ConfigPanel.tsx:964-1044), mas o compile
  // emite o ask-question só com `message` (lib/builder/flow/compile.ts:418-429) e o passo
  // manda type 'text'. O contato não tem botão para tocar: precisa DIGITAR o rótulo exato
  // (=== sensível a caixa/acento), senão cai em "Outra resposta".
  it.fails('BUG(perguntar-sem-botoes): a pergunta deveria sair como interactive.button com os rótulos dos botões', async () => {
    await run(salesSupportGraph())
    const body = h.meta.last()!.body as { type: string; interactive?: { type: string; action: { buttons: Array<{ reply: { title: string } }> } } }
    expect(body.type).toBe('interactive')
    expect(body.interactive?.type).toBe('button')
    expect(body.interactive?.action.buttons.map((b) => b.reply.title)).toEqual(['Vendas', 'Suporte'])
  })

  it('T14a branch travada "Timeout"/"Not Delivered" com ações não compila (v1)', () => {
    const tree = steps.interactive({ id: 'ask', message: 'Q?', buttons: ['Sim'] })
    tree.branches!.find((b) => b.label === 'Timeout')!.child = steps.whatsapp({ id: 'tw', message: 'Sumiu?' })
    expect(() => graphOf(tree)).toThrow(FlowCompileError)
    expect(() => graphOf(tree)).toThrow(/a branch "Timeout" não é suportada no v1/)
    try {
      graphOf(tree)
    } catch (error) {
      expect((error as FlowCompileError).stepId).toBe('ask')
    }
  })

  it('T14b falha da Meta (131047) ao enviar a pergunta: sem conversa, a jusante pulada e run error', async () => {
    h.meta.failNext(131047)
    const res = await run(salesSupportGraph())
    expect(res.paused).toBeUndefined()
    expect(res.success).toBe(false)
    expect(res.results.ask.error).toContain('code 131047')
    expect(h.db.count('workflow_conversations')).toBe(0)
    for (const id of ['ask__var', 'ask__cond_0', 'ask__cond_1', 'ask__cond_else', 'w2', 'w4']) {
      expect(res.results[id], id).toEqual({ success: false, error: 'skipped' })
    }
    const runRow = h.db.row('workflow_runs', { id: RUN })!
    expect(runRow).toMatchObject({ status: 'error', error: res.results.ask.error })
    expect(runRow.finished_at).toEqual(expect.any(String))
  })

  it('T15 (documenta) sem executionId/workflowId a pergunta SAI mas não pausa (erro de contexto)', async () => {
    const res = await run(salesSupportGraph(), { executionId: null, workflowId: null })
    expect(h.meta.texts()).toEqual(['Vendas ou suporte?'])
    expect(res.results.ask).toEqual({ success: false, error: 'Workflow context missing for Ask Question.' })
    expect(res.results.ask__var).toEqual({ success: false, error: 'skipped' })
    expect(h.db.count('workflow_conversations')).toBe(0)
  })

  it('falha ao gravar a conversa: a pergunta já saiu, mas nada fica esperando a resposta', async () => {
    h.db.failNext('workflow_conversations', 'db fora', 'insert')
    const res = await run(salesSupportGraph())
    expect(h.meta.texts()).toEqual(['Vendas ou suporte?'])
    expect(res.results.ask).toEqual({ success: false, error: 'Failed to save conversation.' })
    expect(h.db.count('workflow_conversations')).toBe(0)
    expect(h.db.row('workflow_runs', { id: RUN })?.status).toBe('error')
  })

  it('Perguntar no grafo cru sem próximo nó ou com 2 saídas: erro controlado antes de enviar', async () => {
    const askNode = {
      id: 'q',
      type: 'action',
      position: { x: 0, y: 1 },
      data: { label: 'Q', type: 'action', config: { actionType: 'whatsapp/ask-question', toSource: 'inbound', message: 'Q?', variableKey: 'k' } },
    }
    const trigger = { id: TRIGGER_NODE_ID, type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'G', type: 'trigger', config: { triggerType: 'Keywords' } } }
    const sv = (id: string) => ({ id, type: 'action', position: { x: 0, y: 2 }, data: { label: id, type: 'action', config: { actionType: 'Set Variable', variableKey: id, variableValue: 1 } } })
    const alone = await run({ nodes: [trigger, askNode] as never, edges: [{ id: 'e1', source: TRIGGER_NODE_ID, target: 'q' }] as never }, { executionId: 'r1' })
    expect(alone.results.q).toEqual({ success: false, error: 'Ask Question requires a following node to resume.' })
    const fork = await run(
      {
        nodes: [trigger, askNode, sv('a'), sv('b')] as never,
        edges: [
          { id: 'e1', source: TRIGGER_NODE_ID, target: 'q' },
          { id: 'e2', source: 'q', target: 'a' },
          { id: 'e3', source: 'q', target: 'b' },
        ] as never,
      },
      { executionId: 'r2' }
    )
    expect(fork.results.q).toEqual({ success: false, error: 'Ask Question supports only one outgoing path.' })
    expect(h.meta.calls).toHaveLength(0)
  })
})

describe('Perguntar — a resposta escolhe a branch', () => {
  it.each([
    ['Vendas', ['ask__cond_0'], ['Vendas!', 'Obrigado']],
    ['Suporte', ['ask__cond_1'], ['Obrigado']],
    ['quero falar com alguém', ['ask__cond_else'], ['Obrigado']],
  ])('T10 resposta "%s" → exatamente 1 condição true e os envios certos, em ordem', async (answer, conds, texts) => {
    const graph = salesSupportGraph()
    await run(graph)
    h.meta.reset()
    const res = await resumeAsk(graph, answer)
    expect(trueConditions(res)).toEqual(conds)
    expect(h.meta.texts()).toEqual(texts)
    expect(res.results.ask__var).toMatchObject({ success: true, data: { data: { key: 'reply_ask', value: answer } } })
    expect(h.db.row('workflow_conversations', { workflow_id: WF })?.status).toBe('completed')
  })

  it('T11 "Sim" e "Sim, quero mais" são botões distintos (igualdade exata, não substring)', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask',
        message: 'Quer?',
        buttons: [
          { label: 'Sim', child: steps.whatsapp({ id: 'w1', message: 'Só sim' }) },
          { label: 'Sim, quero mais', child: steps.whatsapp({ id: 'w2', message: 'Quer mais' }) },
        ],
      })
    )
    await run(graph)
    h.meta.reset()
    const res = await resumeAsk(graph, 'Sim, quero mais')
    expect(trueConditions(res)).toEqual(['ask__cond_1'])
    expect(h.meta.texts()).toEqual(['Quer mais'])
  })

  it('T11 resposta ausente (sem a variável): todas as branches false, "Outra resposta" segue a continuação', async () => {
    const graph = salesSupportGraph()
    const res = await run(graph, { executionId: 'r-sem-var', startNodeIds: ['ask__var'], initialVariables: {} })
    expect(res.results.ask__var).toMatchObject({ success: true, data: { data: { key: 'reply_ask' } } })
    expect(trueConditions(res)).toEqual(['ask__cond_else'])
    expect(h.meta.texts()).toEqual(['Obrigado'])
  })

  it('T12 (documenta) "vendas" minúsculo cai no else; " Vendas " é aparado pela rota e bate', async () => {
    const graph = salesSupportGraph()
    await run(graph)
    h.meta.reset()
    const lower = await resumeAsk(graph, 'vendas')
    expect(trueConditions(lower)).toEqual(['ask__cond_else'])
    expect(h.meta.texts()).toEqual(['Obrigado'])

    await run(graph, { executionId: 'r2' })
    h.meta.reset()
    const padded = await resumeAsk(graph, '  Vendas ')
    expect(trueConditions(padded)).toEqual(['ask__cond_0'])
    expect(h.meta.texts()).toEqual(['Vendas!', 'Obrigado'])
  })

  it('rótulo de botão com aspas, barra e acento bate literalmente (escape do compile)', async () => {
    const label = 'Não "sei" \\ talvez'
    const graph = graphOf(
      steps.interactive({ id: 'ask', message: 'E aí?', buttons: [{ label, child: steps.whatsapp({ id: 'w1', message: 'ok' }) }] })
    )
    await run(graph)
    h.meta.reset()
    const res = await resumeAsk(graph, label)
    expect(trueConditions(res)).toEqual(['ask__cond_0'])
    expect(res.results.ask__cond_0.data).not.toHaveProperty('expressionError')
    expect(h.meta.texts()).toEqual(['ok'])
  })

  it('T19 a resposta vira variável usada na mensagem seguinte', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask',
        message: 'Qual área?',
        buttons: ['Vendas', 'Suporte'],
        next: steps.whatsapp({ id: 'w', message: 'Você escolheu {{var.reply_ask}}' }),
      })
    )
    await run(graph)
    h.meta.reset()
    await resumeAsk(graph, 'Suporte')
    expect(h.meta.texts()).toEqual(['Você escolheu Suporte'])
  })

  // BUG(template-segunda-expansao): processTemplates expande {{var.*}} e DEPOIS aplica o
  // padrão {{@nodeId:...}} sobre o resultado (lib/builder/workflow-executor.workflow.ts:505-584):
  // um texto digitado pelo contato contendo "{{@...}}" é resolvido contra as saídas da run
  // (aqui a saída do nó de retomada; num fluxo com HTTP Request, a resposta dele).
  it.fails('BUG(template-segunda-expansao): a resposta do contato deveria ser ecoada literalmente', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask',
        message: 'Qual área?',
        buttons: ['Vendas'],
        next: steps.whatsapp({ id: 'w', message: 'Você escolheu {{var.reply_ask}}' }),
      })
    )
    await run(graph)
    h.meta.reset()
    await resumeAsk(graph, '{{@ask__var:Resposta.key}}')
    expect(h.meta.texts()).toEqual(['Você escolheu {{@ask__var:Resposta.key}}'])
  })

  it('T16 Perguntar duplo: a 2ª conversa carrega a resposta do 1º e o final usa as duas', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask1',
        message: 'A ou B?',
        buttons: [
          { label: 'A', child: steps.interactive({ id: 'ask2', message: 'X ou Y?', buttons: ['X', 'Y'] }) },
          { label: 'B' },
        ],
        next: steps.whatsapp({ id: 'fim', message: 'Fim {{var.reply_ask1}} / {{var.reply_ask2}}' }),
      })
    )
    await run(graph)
    const afterA = await resumeAsk(graph, 'A')
    expect(afterA).toMatchObject({ paused: true, resumeNodeId: 'ask2__var' })
    const conv2 = waitingConversation()
    expect(conv2).toMatchObject({ resume_node_id: 'ask2__var', variable_key: 'reply_ask2', variables: { reply_ask1: 'A' } })
    expect(h.db.row('workflow_runs', { id: 'run-resume-' + resumeSeq })?.status).toBe('waiting')

    await resumeAsk(graph, 'X')
    expect(h.meta.texts()).toEqual(['A ou B?', 'X ou Y?', 'Fim A / X'])
  })

  it('T16 resposta "B" no 1º Perguntar pula o 2º e vai direto ao final (sem 2ª conversa)', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask1',
        message: 'A ou B?',
        buttons: [{ label: 'A', child: steps.interactive({ id: 'ask2', message: 'X ou Y?', buttons: ['X'] }) }, { label: 'B' }],
        next: steps.whatsapp({ id: 'fim', message: 'Fim {{var.reply_ask1}}' }),
      })
    )
    await run(graph)
    const res = await resumeAsk(graph, 'B')
    expect(res.paused).toBeUndefined()
    expect(h.meta.texts()).toEqual(['A ou B?', 'Fim B'])
    expect(h.db.count('workflow_conversations', { status: 'waiting' })).toBe(0)
  })

  it('Perguntar seguido de Aguardar: a retomada do Aguardar mantém a resposta (variables no snapshot)', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask',
        message: 'Confirma?',
        buttons: ['Sim'],
        next: chain(steps.wait({ id: 'wt', value: 1, unit: 'hours' }), steps.whatsapp({ id: 'w', message: 'Lembrete: você disse {{var.reply_ask}}' })),
      })
    )
    await run(graph)
    const paused = await resumeAsk(graph, 'Sim')
    expect(paused).toMatchObject({ paused: true, wait: { resumeNodeIds: ['w'] }, variables: { reply_ask: 'Sim' } })
    const snap = JSON.parse(JSON.stringify(paused))
    ensureRun('run-delay', 'DelayResume')
    await run(graph, {
      executionId: 'run-delay',
      triggerInput: { from: PHONE, to: PHONE },
      startNodeIds: snap.wait.resumeNodeIds,
      initialVariables: snap.variables,
      initialOutputs: snap.outputs,
      alreadyResolvedNodeIds: snap.resolvedNodeIds,
    })
    expect(h.meta.texts()).toEqual(['Confirma?', 'Lembrete: você disse Sim'])
  })
})

// ─── Condição ──────────────────────────────────────────────────────────────────

describe('Condição — operadores, None e continuação', () => {
  type Op = 'contains' | 'not_contains' | 'equals'
  const conditionGraph = (operator: Op, value: string) =>
    graphOf(
      steps.condition({
        id: 'c',
        branches: [{ label: 'Branch', operator, value, child: steps.whatsapp({ id: 'wB', message: 'branch' }) }],
        none: steps.whatsapp({ id: 'wNone', message: 'none' }),
        next: steps.whatsapp({ id: 'wFim', message: 'fim' }),
      })
    )

  it.each<[Op, string, string, string[]]>([
    ['contains', 'urgente', 'é urgente!', ['branch', 'fim']],
    ['contains', 'urgente', 'pode esperar', ['none', 'fim']],
    ['not_contains', 'cancelar', 'quero comprar', ['branch', 'fim']],
    ['not_contains', 'cancelar', 'quero cancelar', ['none', 'fim']],
    ['equals', 'menu', 'menu', ['branch', 'fim']],
    ['equals', 'menu', 'Menu', ['none', 'fim']], // sensível a maiúsculas (como diz a tela)
    ['equals', 'menu', 'menu ', ['none', 'fim']],
  ])('T21 %s "%s" com mensagem "%s" → %j', async (operator, value, message, texts) => {
    const res = await run(conditionGraph(operator, value), { message })
    expect(h.meta.texts()).toEqual(texts)
    expect(trueConditions(res)).toHaveLength(1)
  })

  it('T21 expressões compiladas: base sobre {{@__trigger:Gatilho.message}} e None = negação de todas', () => {
    const graph = graphOf(
      steps.condition({
        id: 'c',
        branches: [
          { label: 'A', value: 'a' },
          { label: 'B', operator: 'equals', value: 'b' },
        ],
      })
    )
    const cond = (id: string) => graph.nodes.find((n) => n.id === id)?.data.config.condition
    expect(cond('c__cond_0')).toBe('{{@__trigger:Gatilho.message}}.includes("a")')
    expect(cond('c__cond_1')).toBe('{{@__trigger:Gatilho.message}} === "b" && !({{@__trigger:Gatilho.message}}.includes("a"))')
    expect(cond('c__cond_none')).toBe('!({{@__trigger:Gatilho.message}}.includes("a")) && !({{@__trigger:Gatilho.message}} === "b")')
  })

  it('T22 exclusividade: duas branches que batem → só a primeira roda', async () => {
    const res = await run(
      graphOf(
        steps.condition({
          id: 'c',
          branches: [
            { label: 'Vendas', value: 'vendas', child: steps.whatsapp({ id: 'w1', message: 'vendas' }) },
            { label: 'Urgente', value: 'urgente', child: steps.whatsapp({ id: 'w2', message: 'urgente' }) },
          ],
        })
      ),
      { message: 'urgente: vendas' }
    )
    expect(trueConditions(res)).toEqual(['c__cond_0'])
    expect(h.meta.texts()).toEqual(['vendas'])
  })

  it('T22 valor com aspas e barra invertida bate literalmente, sem expressionError', async () => {
    const value = 'ele disse "oi" \\ ok'
    const res = await run(conditionGraph('contains', value), { message: `então ${value}!` })
    expect(h.meta.texts()).toEqual(['branch', 'fim'])
    expect(res.results.c__cond_0.data).not.toHaveProperty('expressionError')
  })

  it('T22 (documenta) acento conta: "promocao" não bate em "promoção"', async () => {
    await run(conditionGraph('contains', 'promoção'), { message: 'quero a promocao' })
    expect(h.meta.texts()).toEqual(['none', 'fim'])
  })

  it('T22 tentativa de injeção no valor (crase/construtor) vira literal inofensivo', async () => {
    const value = '"); globalThis.__pwned = true; ("'
    const res = await run(conditionGraph('contains', value), { message: 'nada a ver' })
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined()
    expect(h.meta.texts()).toEqual(['none', 'fim'])
    expect(res.results.c__cond_0.data).not.toHaveProperty('expressionError')
  })

  it('condição sem branch None explícita: o fallback "Outra resposta" segue para a continuação', async () => {
    await run(
      graphOf(
        steps.condition({
          id: 'c',
          noneBranch: false,
          branches: [{ label: 'X', value: 'x', child: steps.whatsapp({ id: 'wx', message: 'x' }) }],
          next: steps.whatsapp({ id: 'wFim', message: 'fim' }),
        })
      ),
      { message: 'nada' }
    )
    expect(h.meta.texts()).toEqual(['fim'])
  })

  it('T23 condição depois do Perguntar usa a resposta persistida ({{var.reply_ask}})', async () => {
    const graph = graphOf(
      steps.interactive({
        id: 'ask',
        message: 'A ou B?',
        buttons: ['A', 'B'],
        next: steps.condition({
          id: 'c',
          branches: [{ label: 'Urg', value: 'urgente', child: steps.whatsapp({ id: 'wU', message: 'urgente!' }) }],
          none: steps.whatsapp({ id: 'wN', message: 'normal' }),
        }),
      })
    )
    expect(graph.nodes.find((n) => n.id === 'c__cond_0')?.data.config.condition).toBe('{{var.reply_ask}}.includes("urgente")')
    await run(graph)
    h.meta.reset()
    await resumeAsk(graph, 'A')
    expect(h.meta.texts()).toEqual(['normal'])

    await run(graph, { executionId: 'r2' })
    h.meta.reset()
    await resumeAsk(graph, 'B urgente')
    expect(h.meta.texts()).toEqual(['urgente!'])
  })

  // BUG(cond-trigger-pos-resume): uma Condição na CONVERGÊNCIA depois de um Perguntar que
  // está dentro de uma branch é compilada com o askStepId do contexto externo (null) → usa
  // {{@__trigger:Gatilho.message}} (lib/builder/flow/compile.ts:523-525, 648-653). Ela só
  // roda depois do resume, quando outputs começa vazio (resume/route.ts não passa
  // initialOutputs): o literal fica na expressão, cond_0 E cond_none dão false e TUDO
  // depois é pulado — o fluxo termina em silêncio.
  it.fails('BUG(cond-trigger-pos-resume): condição na convergência após Perguntar em branch deveria seguir (ao menos o None)', async () => {
    const graph = graphOf(
      steps.condition({
        id: 'condA',
        branches: [{ label: 'X', value: 'x', child: steps.interactive({ id: 'ask', message: 'Confirma?', buttons: ['Sim'] }) }],
        next: steps.condition({
          id: 'condB',
          branches: [{ label: 'Y', value: 'y', child: steps.whatsapp({ id: 'wY', message: 'y' }) }],
          next: steps.whatsapp({ id: 'wFim', message: 'Obrigado' }),
        }),
      })
    )
    await run(graph, { message: 'x' })
    expect(h.meta.texts()).toEqual(['Confirma?'])
    await resumeAsk(graph, 'Sim')
    expect(h.meta.texts()).toContain('Obrigado')
  })

  it('T24 (documenta) o mesmo fluxo sem passar pelo Perguntar (mensagem sem "x") funciona', async () => {
    const graph = graphOf(
      steps.condition({
        id: 'condA',
        branches: [{ label: 'X', value: 'x', child: steps.interactive({ id: 'ask', message: 'Confirma?', buttons: ['Sim'] }) }],
        next: steps.condition({
          id: 'condB',
          branches: [{ label: 'Y', value: 'y', child: steps.whatsapp({ id: 'wY', message: 'y' }) }],
          next: steps.whatsapp({ id: 'wFim', message: 'Obrigado' }),
        }),
      })
    )
    await run(graph, { message: 'y' })
    expect(h.meta.texts()).toEqual(['y', 'Obrigado'])
  })

  it('T25 (documenta) valor vazio ("contains \'\'", default da tela) é sempre verdadeiro: o None nunca roda', async () => {
    const graph = conditionGraph('contains', '')
    for (const [i, message] of ['qualquer coisa', 'outra', ''].entries()) {
      await run(graph, { message, executionId: `r${i}` })
    }
    expect(h.meta.texts()).toEqual(['branch', 'fim', 'branch', 'fim', 'branch', 'fim'])
  })

  // BUG(cond-valor-vazio): createStep/addBranch criam a branch de condição com value ''
  // (lib/builder/flow/operations.ts:124-131, 322-326) e nem validateTree nem o compile barram;
  // ".includes("")" é sempre true — a branch captura tudo e o None nunca roda.
  it.fails('BUG(cond-valor-vazio): compile deveria recusar condição contains/equals com valor vazio', () => {
    expect(() => conditionGraph('contains', '')).toThrow(FlowCompileError)
  })

  it('T26 expressionError (crase com ${}) vai para o log do passo; condição false e a jusante pulada', async () => {
    const graph: Graph = {
      nodes: [
        { id: TRIGGER_NODE_ID, type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'G', type: 'trigger', config: { triggerType: 'Keywords' } } },
        { id: 'c', type: 'action', position: { x: 0, y: 1 }, data: { label: 'Cond', type: 'action', config: { actionType: 'Condition', condition: '`${1}` === "1"' } } },
        { id: 'w', type: 'action', position: { x: 0, y: 2 }, data: { label: 'W', type: 'action', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'x' } } },
      ] as never,
      edges: [
        { id: 'e1', source: TRIGGER_NODE_ID, target: 'c' },
        { id: 'e2', source: 'c', target: 'w' },
      ] as never,
    }
    const res = await run(graph)
    expect(res.results.c).toMatchObject({ success: true, data: { condition: false } })
    expect(res.results.w).toEqual({ success: false, error: 'skipped' })
    const log = h.db.rows('workflow_run_logs').find((l) => l.node_id === 'c')!
    expect(log.status).toBe('success')
    expect((log.input as { expressionError?: string }).expressionError).toMatch(/Template literals \(backticks\) are not supported/)
    expect(log.input).toMatchObject({ condition: false, expression: '`${1}` === "1"' })
    expect(h.meta.calls).toHaveLength(0)
  })

  it('log da condição traz a expressão original e os valores resolvidos', async () => {
    await run(conditionGraph('contains', 'oi'), { message: 'oi gente' })
    const log = h.db.rows('workflow_run_logs').find((l) => l.node_id === 'c__cond_0')!
    expect(log.input).toEqual({
      condition: true,
      expression: '{{@__trigger:Gatilho.message}}.includes("oi")',
      values: { 'Gatilho.message': 'oi gente' },
    })
    expect(log.output).toEqual({ condition: true })
  })
})

// ─── END, status final e ciclos ────────────────────────────────────────────────

describe('END e status final da run', () => {
  const endGraph = () =>
    graphOf(
      steps.condition({
        id: 'c',
        branches: [{ label: 'Sair', value: 'sair', child: chain(steps.whatsapp({ id: 'wTchau', message: 'Tchau' }), steps.end()) }],
        next: steps.whatsapp({ id: 'wContinua', message: 'Continuando' }),
      })
    )

  it('T36 END encerra a branch: "sair" envia Tchau e NÃO a continuação; outra mensagem segue a continuação', async () => {
    const graph = endGraph()
    expect(graph.edges.filter((e) => e.source === 'wTchau')).toEqual([]) // END não emite nó nem aresta
    const sair = await run(graph, { message: 'quero sair' })
    expect(h.meta.texts()).toEqual(['Tchau'])
    expect(sair.results.wContinua).toEqual({ success: false, error: 'skipped' })

    h.meta.reset()
    await run(graph, { message: 'fico', executionId: 'r2' })
    expect(h.meta.texts()).toEqual(['Continuando'])
  })

  it('END como raiz: o fluxo não tem passos e só o gatilho executa (success)', async () => {
    const graph = graphOf(steps.end())
    expect(headsAfterTrigger(graph)).toEqual([])
    const res = await run(graph)
    expect(Object.keys(res.results)).toEqual([TRIGGER_NODE_ID])
    expect(res.success).toBe(true)
  })

  // BUG(status-skipped): skipNode grava { success:false, error:'skipped' } para todo nó de
  // branch não escolhida/depois de um END (lib/builder/workflow-executor.workflow.ts:776-789)
  // e finalSuccess = every(r => r.success) (linha 1282) conta esses nós: o fluxo que fez
  // exatamente o que devia termina com workflow_runs.status 'error' e error 'skipped'
  // (e as rotas respondem "failed").
  it.fails('BUG(status-skipped): branch com END tomada corretamente deveria fechar a run como success', async () => {
    const res = await run(endGraph(), { message: 'sair' })
    expect(h.meta.texts()).toEqual(['Tchau'])
    expect(res.success).toBe(true)
    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({ status: 'success', error: null })
  })

  it('T36 (documenta) hoje a run do END fica "error" com error "skipped"', async () => {
    const res = await run(endGraph(), { message: 'sair' })
    expect(res.success).toBe(false)
    expect(h.db.row('workflow_runs', { id: RUN })).toMatchObject({ status: 'error', error: 'skipped' })
  })

  it.fails('BUG(status-skipped): T37 resposta "Suporte" (branch Vendas não tomada) deveria fechar a run de resume como success', async () => {
    const graph = salesSupportGraph()
    await run(graph)
    const res = await resumeAsk(graph, 'Suporte', { executionId: 'run-resume' })
    expect(h.meta.texts()).toEqual(['Vendas ou suporte?', 'Obrigado'])
    expect(res.success).toBe(true)
    expect(h.db.row('workflow_runs', { id: 'run-resume' })).toMatchObject({ status: 'success', error: null })
  })

  it('T37 (documenta) com "Vendas" (nenhuma branch com passos fica para trás) a run fecha success', async () => {
    const graph = salesSupportGraph()
    await run(graph)
    const res = await resumeAsk(graph, 'Vendas', { executionId: 'run-resume' })
    expect(res.success).toBe(true)
    expect(h.db.row('workflow_runs', { id: 'run-resume' })?.status).toBe('success')
  })
})

describe('Split, Go To e ciclos', () => {
  it('T38 Split e Go To ainda não compilam (FlowCompileError com o stepId)', () => {
    const split = steps.split({ id: 'sp', paths: [{ label: 'A', percent: 50 }, { label: 'B', percent: 50 }] })
    const goto = steps.goto({ id: 'gt', targetId: 'w1' })
    for (const [root, id] of [
      [split, 'sp'],
      [chain(steps.whatsapp({ id: 'w1', message: 'oi' }), goto), 'gt'],
    ] as const) {
      try {
        graphOf(root)
        expect.unreachable('deveria lançar')
      } catch (error) {
        expect(error).toBeInstanceOf(FlowCompileError)
        expect((error as FlowCompileError).message).toMatch(/ainda não é suportado no v1/)
        expect((error as FlowCompileError).stepId).toBe(id)
      }
    }
  })

  it('T38 (documenta) grafo cru com ciclo A → B → A não trava: nada do ciclo roda e o retorno é success', async () => {
    const sv = (id: string) => ({ id, type: 'action', position: { x: 0, y: 1 }, data: { label: id, type: 'action', config: { actionType: 'Set Variable', variableKey: id, variableValue: 1 } } })
    const graph: Graph = {
      nodes: [{ id: TRIGGER_NODE_ID, type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'G', type: 'trigger', config: { triggerType: 'Keywords' } } }, sv('A'), sv('B')] as never,
      edges: [
        { id: 'e1', source: TRIGGER_NODE_ID, target: 'A' },
        { id: 'e2', source: 'A', target: 'B' },
        { id: 'e3', source: 'B', target: 'A' },
      ] as never,
    }
    const started = Date.now()
    const res = await run(graph)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(Object.keys(res.results)).toEqual([TRIGGER_NODE_ID])
    expect(res.success).toBe(true) // stall silencioso: risco para quando o Go To existir
  })
})

// ─── Gatilhos ──────────────────────────────────────────────────────────────────

describe('Gatilhos no executor', () => {
  it('T45 Palavras-chave: config { Keywords, keywordList por \\n } e a saída do gatilho expõe a mensagem', async () => {
    const graph = graphOf(steps.whatsapp({ id: 'w', message: 'Você disse: {{@__trigger:Gatilho.message}}' }), triggers.keywords(['oi', 'olá']))
    expect(graph.nodes.find((n) => n.id === TRIGGER_NODE_ID)?.data).toMatchObject({
      type: 'trigger',
      label: 'Palavras-chave',
      config: { triggerType: 'Keywords', keywordList: 'oi\nolá' },
    })
    const res = await run(graph, { message: 'Olá' })
    expect(res.results[TRIGGER_NODE_ID]).toMatchObject({ success: true, data: { triggered: true, from: FROM, message: 'Olá' } })
    expect(h.meta.texts()).toEqual(['Você disse: Olá'])
  })

  it('T45 árvore antiga sem type compila como Palavras-chave', () => {
    const graph = graphOf(steps.whatsapp({ id: 'w', message: 'x' }), triggers.legacyKeywords(['promo']))
    expect(graph.nodes.find((n) => n.id === TRIGGER_NODE_ID)?.data.config).toEqual({ triggerType: 'Keywords', keywordList: 'promo' })
  })

  it('T45 Respondeu ao disparo: config da campanha e {{@__trigger:Gatilho.campaignId}} resolvido', async () => {
    const graph = graphOf(
      steps.whatsapp({ id: 'w', message: 'Obrigado por responder a campanha {{@__trigger:Gatilho.campaignId}}' }),
      triggers.campaignReply({ campaignId: SEED_IDS.campaign, campaignName: 'Promo de outubro', replyFilter: ' quero ' })
    )
    expect(graph.nodes.find((n) => n.id === TRIGGER_NODE_ID)?.data.config).toEqual({
      triggerType: 'CampaignReply',
      campaignId: SEED_IDS.campaign,
      campaignName: 'Promo de outubro',
      replyFilter: 'quero',
    })
    await run(graph, { triggerInput: { from: FROM, to: FROM, message: 'quero sim', campaignId: SEED_IDS.campaign } })
    expect(h.meta.texts()).toEqual([`Obrigado por responder a campanha ${SEED_IDS.campaign}`])
  })

  it('T45 Sem gatilho: retomada como o drain da inscrição manual (/enroll) envia o 1º passo; condição vai para o None', async () => {
    const graph = graphOf(
      chain(
        steps.whatsapp({ id: 'w1', message: 'Oi {{@__trigger:Gatilho.from}}' }),
        steps.condition({ id: 'c', branches: [{ label: 'X', value: 'x', child: steps.whatsapp({ id: 'wx', message: 'x' }) }], none: steps.whatsapp({ id: 'wn', message: 'sem mensagem' }) })
      ),
      triggers.none()
    )
    expect(graph.nodes.find((n) => n.id === TRIGGER_NODE_ID)?.data).toMatchObject({ label: 'Sem gatilho (entrada manual)', config: { triggerType: 'None' } })
    const heads = headsAfterTrigger(graph)
    expect(heads).toEqual(['w1'])
    // Mesmo shape que app/api/builder/workflows/[workflowId]/enroll/route.ts grava no enrollment.
    const outputs = {
      [TRIGGER_NODE_ID]: { label: 'Gatilho', data: { triggered: true, enrolledManually: true, from: PHONE, to: PHONE, message: '' } },
    }
    const res = await run(graph, {
      triggerInput: { from: PHONE, to: PHONE },
      startNodeIds: heads,
      initialOutputs: outputs,
      alreadyResolvedNodeIds: [TRIGGER_NODE_ID],
    })
    expect(h.meta.texts()).toEqual([`Oi ${PHONE}`, 'sem mensagem'])
    expect(res.results[TRIGGER_NODE_ID]).toBeUndefined() // o gatilho não roda de novo
  })
})

// ─── Bordas reais: run órfã e drain ────────────────────────────────────────────

describe('Bordas (rotas e drain reais): status das runs', () => {
  const askFlow = (id: string) =>
    makeFlow({
      id,
      trigger: triggers.keywords(['oi']),
      root: steps.interactive({ id: 'ask', message: 'Vendas ou suporte?', buttons: ['Vendas', 'Suporte'], next: steps.whatsapp({ id: 'w', message: 'Obrigado' }) }),
    })

  it('/execute pausa no Perguntar (run waiting) e /resume cria uma NOVA run "Resume" que termina', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, askFlow('wf-ask'))
    const exec = await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    expect(exec.body).toMatchObject({ status: 'waiting' })
    const first = h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId)
    expect(first).toHaveLength(1)
    expect(first[0].status).toBe('waiting')

    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })!
    const resume = await routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'Vendas' } })
    expect(resume.body).toMatchObject({ status: 'success' })
    expect(h.meta.texts()).toEqual(['Vendas ou suporte?', 'Obrigado'])
    const runsAfter = h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId)
    expect(runsAfter.map((r) => [r.trigger_type, r.status])).toEqual([
      ['Keywords', 'waiting'],
      ['Resume', 'success'],
    ])
  })

  // BUG(run-waiting-orfao): a pausa põe a run em 'waiting' e a continuação (resume/drain)
  // SEMPRE cria outra workflow_runs (resume/route.ts:139-148, lib/cron/workflow-enrollments.ts:89-98);
  // ninguém finaliza a original (o enrollment guarda run_id, mas não é usado). A lista de
  // execuções acumula runs 'waiting' eternas para conversas que já terminaram.
  it.fails('BUG(run-waiting-orfao): depois do resume a run original não deveria continuar "waiting"', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, askFlow('wf-ask'))
    const exec = await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })!
    await routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'Vendas' } })
    const original = h.db.row('workflow_runs', { id: (exec.body as { executionId: string }).executionId })!
    expect(original.status).not.toBe('waiting')
    expect(original.finished_at).toEqual(expect.any(String))
  })

  it.fails('BUG(run-waiting-orfao): Aguardar via /execute + drain não deveria deixar a run original "waiting"', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId } = await seedPublishedFlow(
      h.db,
      makeFlow({ id: 'wf-wait', root: chain(steps.whatsapp({ id: 'w1', message: 'Um' }), steps.wait({ id: 'd', value: 1 }), steps.whatsapp({ id: 'w2', message: 'Dois' })) })
    )
    const exec = await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    expect(exec.body).toMatchObject({ status: 'waiting' })
    advanceTime(60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Um', 'Dois'])
    const original = h.db.row('workflow_runs', { id: (exec.body as { executionId: string }).executionId })!
    expect(original.status).not.toBe('waiting')
  })

  // BUG(resume-sem-claim): /resume lê a conversa com status='waiting' e só a marca
  // 'completed' DEPOIS do executeWorkflow (resume/route.ts:76-82 e 176), sem CAS
  // waiting→processing. Duas respostas próximas (ids de mensagem distintos, então o dedupe
  // do webhook não ajuda) retomam o mesmo Perguntar duas vezes e reenviam os passos seguintes.
  it.fails('BUG(resume-sem-claim): duas respostas simultâneas deveriam retomar o Perguntar uma vez só', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, askFlow('wf-ask'))
    await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })!
    h.meta.reset()
    const barrier = createBarrier(2)
    const off = h.db.onBefore(async () => barrier.wait(), { table: 'workflow_conversations', op: 'select' })
    const [a, b] = await Promise.all([
      routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'Vendas' } }),
      routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'Suporte' } }),
    ])
    off()
    expect(barrier.arrived).toBe(2)
    const statuses = [a.body, b.body].map((x) => (x as { status: string }).status).sort()
    expect(statuses).toEqual(['failed', 'success'])
    expect(h.meta.texts()).toEqual(['Obrigado'])
  })

  it('(documenta) resume-sem-claim: hoje as duas respostas simultâneas executam e "Obrigado" sai 2x', async () => {
    const { workflowId } = await seedPublishedFlow(h.db, askFlow('wf-ask'))
    await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })!
    h.meta.reset()
    const barrier = createBarrier(2)
    const off = h.db.onBefore(async () => barrier.wait(), { table: 'workflow_conversations', op: 'select' })
    await Promise.all([
      routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'Vendas' } }),
      routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'Suporte' } }),
    ])
    off()
    expect(h.meta.texts()).toEqual(['Obrigado', 'Obrigado'])
    expect(h.db.rows('workflow_runs').filter((r) => r.trigger_type === 'Resume')).toHaveLength(2)
  })

  // BUG(conversa-sem-expiracao): workflow_conversations não tem TTL e o compile rejeita a
  // branch Timeout; uma conversa 'waiting' de semanas atrás ainda é retomada por qualquer
  // mensagem nova do contato (resume/route.ts não olha created_at). Decisão de produto (TTL).
  it.fails('BUG(conversa-sem-expiracao): conversa esperando há 30 dias não deveria ser retomada', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId } = await seedPublishedFlow(h.db, askFlow('wf-ask'))
    await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })!
    advanceTime(30 * 24 * 3600_000)
    h.meta.reset()
    const res = await routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'bom dia' } })
    expect((res.body as { status: string }).status).not.toBe('success')
    expect(h.meta.texts()).toEqual([])
  })

  it('(documenta) conversa-sem-expiracao: hoje a resposta 30 dias depois retoma e envia', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId } = await seedPublishedFlow(h.db, askFlow('wf-ask'))
    await routes.execute(workflowId, { input: { from: FROM, to: FROM, message: 'oi' } })
    const conv = h.db.row('workflow_conversations', { workflow_id: workflowId })!
    advanceTime(30 * 24 * 3600_000)
    h.meta.reset()
    const res = await routes.resume(workflowId, { conversationId: conv.id, input: { from: PHONE, to: PHONE, message: 'bom dia' } })
    expect(res.body).toMatchObject({ status: 'success' })
    expect(h.meta.texts()).toEqual(['Obrigado'])
  })

  it('T29 drain real: inscrição manual → envia o 1º passo, reagenda no Aguardar e completa no vencimento', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId } = await seedPublishedFlow(
      h.db,
      makeFlow({
        id: 'wf-drip',
        trigger: triggers.none(),
        root: chain(steps.whatsapp({ id: 'w1', message: 'Um' }), steps.wait({ id: 'd1', value: 5 }), steps.whatsapp({ id: 'w2', message: 'Dois' })),
      })
    )
    expect((await routes.enroll(workflowId, { contactIds: [SEED_IDS.contacts.ana] })).body).toMatchObject({ enrolled: 1 })
    expect(await routes.drain()).toMatchObject({ claimed: 1, paused: 1 })
    expect(h.db.row('workflow_enrollments', { workflow_id: workflowId })).toMatchObject({ status: 'waiting', attempts: 1, resume_node_ids: ['w2'] })
    advanceTime(5 * 60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(h.meta.texts()).toEqual(['Um', 'Dois'])
    const runs = h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId)
    expect(runs.map((r) => r.trigger_type)).toEqual(['DelayResume', 'DelayResume'])
    expect(runs[1].status).toBe('success')
  })

  // BUG(drain-run-running): o drain insere a run 'running' e, quando a execução pausa de
  // novo num Aguardar, só reagenda o enrollment (lib/cron/workflow-enrollments.ts:89-112) —
  // o executor não grava status na pausa — e a run fica 'running' para sempre.
  it.fails('BUG(drain-run-running): run "DelayResume" que pausa em outro Aguardar deveria ficar "waiting"', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId } = await seedPublishedFlow(
      h.db,
      makeFlow({
        id: 'wf-drip',
        trigger: triggers.none(),
        root: chain(steps.whatsapp({ id: 'w1', message: 'Um' }), steps.wait({ id: 'd1', value: 5 }), steps.whatsapp({ id: 'w2', message: 'Dois' })),
      })
    )
    await routes.enroll(workflowId, { contactIds: [SEED_IDS.contacts.ana] })
    expect(await routes.drain()).toMatchObject({ paused: 1 })
    const [drainRun] = h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId)
    expect(drainRun.status).toBe('waiting')
  })

  // BUG(drain-run-running) (2ª parte): nó de retomada ausente (republicação) → results {}
  // e every([]) === true: o executor grava a run 'success' enquanto o enrollment vai para
  // 'failed' ("Nó de retomada ausente") — a tela mostra sucesso para algo que não rodou.
  it.fails('BUG(drain-run-running): nó de retomada ausente não deveria gravar a run como success', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const { workflowId, versionId } = await seedPublishedFlow(
      h.db,
      makeFlow({ id: 'wf-x', trigger: triggers.none(), root: steps.whatsapp({ id: 'w1', message: 'Um' }) })
    )
    h.db.insert('workflow_enrollments', {
      workflow_id: workflowId,
      version_id: versionId,
      phone: PHONE,
      status: 'waiting',
      resume_at: '2026-10-18T11:00:00.000Z',
      resume_node_ids: ['no-que-sumiu'],
      resolved_nodes: [TRIGGER_NODE_ID],
    })
    expect(await routes.drain()).toMatchObject({ claimed: 1, failed: 1 })
    expect(h.db.row('workflow_enrollments', { workflow_id: workflowId })?.status).toBe('failed')
    const [drainRun] = h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId)
    expect(drainRun.status).not.toBe('success')
  })
})
