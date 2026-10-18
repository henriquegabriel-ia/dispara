// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/builder/workflow/[workflowId]/execute — o disparo inicial do fluxo (o que o
 * webhook da Meta chama via reinvokeSelf).
 *
 * Código REAL ponta a ponta: compileFlow → PATCH/publish (rotas reais) → POST /execute
 * (Bearer CRON_SECRET) → executor real → Graph API mockada → Supabase em memória.
 * Foco: autenticação só para cron, filtro de palavra-chave, pausa durável no Aguardar
 * (enrollment + run 'waiting'), Pergunta (conversa pendente), janela de horário e estado
 * consistente quando algo falha no meio.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { setActiveSupabase, type Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  freezeTime,
  jsonRequest,
  makeFlow,
  publishFlow,
  resetWorkflowCaches,
  routeParams,
  routes,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_ADMIN_KEY,
  TEST_API_KEY,
  TEST_CRON_SECRET,
  TEST_PHONES,
  triggers,
  waId,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'
import type { WorkflowTimeWindow } from '@/lib/builder/workflow-settings'
import type { Flow, FlowTrigger, Step } from '@/lib/builder/flow/types'

const T = '2026-10-19T12:00:00.000Z' // segunda-feira, 12:00 UTC
const MIN = 60_000
const at = (ms: number) => new Date(Date.parse(T) + ms).toISOString()

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
  freezeTime(T)
})
afterEach(() => teardownWorkflowTest())

type ExecBody = { executionId: string; status: string; error?: string; output?: Record<string, unknown> }

function flowOf(id: string, root: Step | null, trigger: FlowTrigger = triggers.keywords(['oi'])): Flow {
  return makeFlow({ id, trigger, root })
}

async function exec(workflowId: string, message: string | undefined = 'oi', phone: string = TEST_PHONES.ana, extra: Record<string, unknown> = {}) {
  const input: Record<string, unknown> = { from: waId(phone), to: waId(phone) }
  if (message !== undefined) input.message = message
  const res = await routes.execute(workflowId, { input, ...extra })
  return { ...res, body: res.body as ExecBody }
}

async function rawExecute(workflowId: string, headers: Record<string, string>) {
  const mod = await import('@/app/api/builder/workflow/[workflowId]/execute/route')
  const response = await mod.POST(
    jsonRequest(`/api/builder/workflow/${workflowId}/execute`, { input: { from: waId(TEST_PHONES.ana), message: 'oi' } }, { headers }),
    routeParams(workflowId)
  )
  return { status: response.status, body: (await response.json()) as ExecBody }
}

const runRow = (id: string) => h.db.row('workflow_runs', { id }) as Row
const enrollments = (workflowId: string) => h.db.rows('workflow_enrollments').filter((r) => r.workflow_id === workflowId)
const runsOf = (workflowId: string) => h.db.rows('workflow_runs').filter((r) => r.workflow_id === workflowId)

const msgWaitMsg = (value = 5, unit: 'minutes' | 'hours' | 'days' = 'minutes') =>
  chain(steps.whatsapp({ id: 'm1', message: 'Antes' }), steps.wait({ id: 'w', value, unit }), steps.whatsapp({ id: 'm2', message: 'Depois' }))

// ─── Autenticação ──────────────────────────────────────────────────────────────

describe('execute: autenticação (só o principal cron)', () => {
  it.each([
    ['sem Authorization', {}],
    ['Bearer errado', { authorization: 'Bearer nada-a-ver' }],
    ['Bearer DISPARA_API_KEY (sessão/API key não vale)', { authorization: `Bearer ${TEST_API_KEY}` }],
    ['X-API-Key com a API key', { 'x-api-key': TEST_API_KEY }],
  ])('EXE-01: %s → 401, sem run e sem envio', async (_label, headers) => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-auth', chain(steps.whatsapp({ id: 'm1', message: 'Olá' }))))
    const res = await rawExecute(workflowId, headers as Record<string, string>)
    expect(res.status).toBe(401)
    expect(runsOf(workflowId)).toHaveLength(0)
    expect(h.meta.sent).toHaveLength(0)
  })

  it.each([
    ['CRON_SECRET', TEST_CRON_SECRET],
    ['DISPARA_ADMIN_KEY', TEST_ADMIN_KEY],
  ])('EXE-01b: Bearer %s → 200 e executa', async (_label, secret) => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-auth-ok', chain(steps.whatsapp({ id: 'm1', message: 'Olá' }))))
    const res = await rawExecute(workflowId, { authorization: `Bearer ${secret}` })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['Olá'])
  })

  it('EXE-01c: helper routes.execute com auth=false também é barrado', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-auth-h', chain(steps.whatsapp({ id: 'm1', message: 'Olá' }))))
    const res = await routes.execute(workflowId, { input: { from: waId(TEST_PHONES.ana), message: 'oi' } }, { auth: false })
    expect(res.status).toBe(401)
    expect(runsOf(workflowId)).toHaveLength(0)
  })
})

// ─── Falhas controladas ────────────────────────────────────────────────────────

describe('execute: falha controlada sem Supabase ou com grafo inválido', () => {
  it('EXE-02a: sem Supabase → 200 {status: failed, "Supabase not configured"}, nenhum envio', async () => {
    setActiveSupabase(null)
    const res = await exec('wf-x')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'failed', error: 'Supabase not configured' })
    expect(h.meta.sent).toHaveLength(0)
    setActiveSupabase(h.db)
  })

  it('EXE-02b: versão ativa sem gatilho → "Invalid workflow", nenhum run e nenhum envio', async () => {
    const { workflowId, versionId } = await publishFlow(h.db, flowOf('wf-inv', chain(steps.whatsapp({ id: 'm1', message: 'Olá' }))))
    const version = h.db.row('workflow_versions', { id: versionId })!
    const nodes = (version.nodes as Array<{ data: { type: string } }>).filter((n) => n.data.type !== 'trigger')
    h.db.update('workflow_versions', { id: versionId }, { nodes, edges: [] })
    const res = await exec(workflowId)
    expect(res.body).toMatchObject({ status: 'failed', error: 'Invalid workflow' })
    expect(runsOf(workflowId)).toHaveLength(0)
    expect(h.meta.sent).toHaveLength(0)
  })

  it('EXE-02c: corpo que não é JSON é tratado como {} (gatilho por palavra-chave → skipped missing_message)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-nojson', chain(steps.whatsapp({ id: 'm1', message: 'Olá' }))))
    const mod = await import('@/app/api/builder/workflow/[workflowId]/execute/route')
    const response = await mod.POST(
      jsonRequest(`/api/builder/workflow/${workflowId}/execute`, 'isto não é json', { headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }),
      routeParams(workflowId)
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'skipped', output: { reason: 'missing_message' } })
    expect(h.meta.sent).toHaveLength(0)
  })
})

// ─── Filtro de palavra-chave ──────────────────────────────────────────────────

describe('execute: filtro de palavra-chave (Keywords)', () => {
  async function kwFlow(id: string, keywords: string[]) {
    return publishFlow(h.db, flowOf(id, chain(steps.whatsapp({ id: 'm1', message: 'Bem-vindo' })), triggers.keywords(keywords)))
  }

  it('EXE-03a: mensagem vazia → run "skipped" {reason: missing_message} com finished_at; nada enviado', async () => {
    const { workflowId } = await kwFlow('wf-kw-a', ['quero', 'inscrever'])
    const res = await exec(workflowId, '')
    expect(res.body).toMatchObject({ status: 'skipped', output: { reason: 'missing_message' } })
    expect(runRow(res.body.executionId)).toMatchObject({ status: 'skipped', output: { reason: 'missing_message' }, finished_at: T })
    expect(h.meta.sent).toHaveLength(0)
  })

  it('EXE-03b: mensagem sem a palavra → run "skipped" keyword_not_matched com finished_at; nada enviado', async () => {
    const { workflowId } = await kwFlow('wf-kw-b', ['quero', 'inscrever'])
    const res = await exec(workflowId, 'tchau')
    expect(res.body).toMatchObject({ status: 'skipped', output: { reason: 'keyword_not_matched' } })
    expect(runRow(res.body.executionId)).toMatchObject({ status: 'skipped', finished_at: T })
    expect(h.meta.sent).toHaveLength(0)
  })

  it.each([['quero'], ['INSCREVER'], ['eu quero me inscrever agora']])('EXE-03c: "%s" casa (minúsculas + substring) e executa', async (message) => {
    const { workflowId } = await kwFlow('wf-kw-c', ['quero', 'inscrever'])
    const res = await exec(workflowId, message)
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['Bem-vindo'])
  })

  it('EXE-03d: com startNodeIds o filtro é ignorado (retomada explícita)', async () => {
    const { workflowId } = await kwFlow('wf-kw-d', ['quero'])
    const res = await exec(workflowId, 'tchau', TEST_PHONES.ana, { startNodeIds: ['m1'] })
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['Bem-vindo'])
  })

  it('EXE-03e: gatilho "Sem gatilho" não filtra — qualquer mensagem (ou nenhuma) executa', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-none', chain(steps.whatsapp({ id: 'm1', message: 'Olá' })), triggers.none()))
    const res = await exec(workflowId, undefined)
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['Olá'])
  })

  it('EXE-03f: o run é criado ANTES do filtro — mensagens que não casam deixam rastro "skipped" (caracterização)', async () => {
    const { workflowId } = await kwFlow('wf-kw-f', ['quero'])
    await exec(workflowId, 'a')
    await exec(workflowId, 'b')
    expect(runsOf(workflowId).map((r) => r.status)).toEqual(['skipped', 'skipped'])
  })

  // BUG(keyword-acento): o webhook despacha quando normalizeInboundText(msg) === normalizeInboundText(kw)
  // (sem acento, minúsculas) e a UI promete "ignora maiúsculas/acentos", mas o /execute refaz o
  // filtro com msg.toLowerCase().includes(kw.toLowerCase()) — SEM tirar acento. O webhook casa,
  // o execute grava 'skipped keyword_not_matched' e o fluxo morre em silêncio.
  // app/api/builder/workflow/[workflowId]/execute/route.ts:113,131-133.
  it.fails.each([
    ['promoção', 'promocao'],
    ['ola', 'Olá'],
  ])('EXE-04: BUG(keyword-acento) — palavra "%s" deveria casar a mensagem "%s"', async (keyword, message) => {
    const { workflowId } = await kwFlow('wf-acento', [keyword])
    const res = await exec(workflowId, message)
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['Bem-vindo'])
  })
})

// ─── Pausas ───────────────────────────────────────────────────────────────────

describe('execute: Aguardar persiste a espera durável', () => {
  it('EXE-05: pausa no Aguardar → enrollment com resume_at exato e run "waiting"', async () => {
    const { workflowId, versionId } = await publishFlow(h.db, flowOf('wf-wait', msgWaitMsg(5)))
    const res = await exec(workflowId)
    expect(res.body.status).toBe('waiting')
    expect(h.meta.texts()).toEqual(['Antes'])
    const [enr] = enrollments(workflowId)
    expect(enrollments(workflowId)).toHaveLength(1)
    expect(enr).toMatchObject({
      phone: TEST_PHONES.ana, // normalizado para E.164 a partir do wa_id só com dígitos
      status: 'waiting',
      wait_kind: 'delay',
      version_id: versionId,
      run_id: res.body.executionId,
      resume_at: at(5 * MIN),
      resume_node_ids: ['m2'],
      current_node_id: 'm2',
      attempts: 0,
      locked_at: null,
      locked_by: null,
    })
    expect(enr.resolved_nodes).toEqual(expect.arrayContaining(['m1', 'w']))
    expect((enr.outputs as Record<string, { data: Record<string, unknown> }>).__trigger.data.message).toBe('oi')
    expect(runRow(res.body.executionId)).toMatchObject({
      status: 'waiting',
      output: { status: 'waiting', waitKind: 'delay' },
      finished_at: null,
      version_id: versionId,
    })
  })

  it.each([
    [2, 'hours' as const, 2 * 60 * MIN],
    [3, 'days' as const, 3 * 24 * 60 * MIN],
  ])('EXE-05b: Aguardar %s %s → resume_at = agora + %d ms', async (value, unit, ms) => {
    const { workflowId } = await publishFlow(h.db, flowOf(`wf-wait-${unit}`, msgWaitMsg(value, unit)))
    await exec(workflowId)
    expect(enrollments(workflowId)[0].resume_at).toBe(at(ms))
  })

  it('EXE-05c: "from" com máscara/+ vira o mesmo telefone E.164 no enrollment', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-mask', msgWaitMsg(1)))
    await routes.execute(workflowId, { input: { from: '+55 (11) 99999-0001', message: 'oi' } })
    expect(enrollments(workflowId)[0].phone).toBe(TEST_PHONES.ana)
  })

  it('EXE-06: pausa sem telefone → run "failed" ("Delay sem telefone de retomada") e nenhum enrollment', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-nophone', chain(steps.wait({ id: 'w', value: 1 }), steps.tag({ id: 't2', tags: ['y'] })), triggers.none())
    )
    const res = await routes.execute(workflowId, { input: {} })
    const body = res.body as ExecBody
    expect(enrollments(workflowId)).toHaveLength(0)
    expect(runRow(body.executionId)).toMatchObject({ status: 'failed', error: 'Delay sem telefone de retomada' })
    expect(runRow(body.executionId).finished_at).not.toBeNull()
  })

  it('EXE-07: Pergunta → conversa pendente (sem enrollment) e run "waiting"', async () => {
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-ask', steps.interactive({ id: 'ask', message: 'Quer a proposta?', buttons: ['Sim', 'Não'] }))
    )
    const res = await exec(workflowId)
    expect(res.body.status).toBe('waiting')
    expect(h.meta.texts()).toEqual(['Quer a proposta?'])
    const convs = h.db.rows('workflow_conversations')
    expect(convs).toEqual([
      expect.objectContaining({ workflow_id: workflowId, phone: TEST_PHONES.ana, status: 'waiting', resume_node_id: 'ask__var', variable_key: 'reply_ask' }),
    ])
    expect(enrollments(workflowId)).toHaveLength(0)
    expect(runRow(res.body.executionId)).toMatchObject({ status: 'waiting', finished_at: null })
    expect(runRow(res.body.executionId).output).toMatchObject({ status: 'waiting', conversationId: convs[0].id, resumeNodeId: 'ask__var' })
  })

  it('EXE-08: fluxo sem espera conclui como "success" com finished_at', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-ok', chain(steps.whatsapp({ id: 'm1', message: 'A' }), steps.whatsapp({ id: 'm2', message: 'B' }))))
    const res = await exec(workflowId)
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['A', 'B'])
    expect(runRow(res.body.executionId)).toMatchObject({ status: 'success', finished_at: T })
    expect(enrollments(workflowId)).toHaveLength(0)
  })

  it('EXE-09: re-disparo durante a espera reusa o mesmo enrollment, apontando para o run mais novo (caracterização)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-twice', msgWaitMsg(5)))
    const r1 = await exec(workflowId)
    advanceTime(MIN)
    const r2 = await exec(workflowId)
    // sem idempotência na rota (o dedupe é só por message.id no webhook): dois runs, dois envios pré-espera
    expect(runsOf(workflowId)).toHaveLength(2)
    expect(h.meta.texts()).toEqual(['Antes', 'Antes'])
    expect(enrollments(workflowId)).toHaveLength(1)
    expect(enrollments(workflowId)[0]).toMatchObject({ run_id: r2.body.executionId, resume_at: at(6 * MIN) })
    // o 1º run fica órfão em 'waiting' (ver BUG(run-original-waiting) no teste do dreno)
    expect(runRow(r1.body.executionId).status).toBe('waiting')
  })

  it('EXE-09b: contatos diferentes no mesmo fluxo têm esperas independentes', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-two', msgWaitMsg(5)))
    await exec(workflowId, 'oi', TEST_PHONES.ana)
    await exec(workflowId, 'oi', TEST_PHONES.bruno)
    expect(enrollments(workflowId).map((e) => e.phone).sort()).toEqual([TEST_PHONES.ana, TEST_PHONES.bruno].sort())
  })

  // BUG(wait-perdido-conflito): se o dreno está processando (status 'active') o mesmo
  // (workflow, phone) e chega um /execute que pausa num Delay, o INSERT viola o índice
  // único parcial ux_workflow_enrollments_active (23505); o fallback só atualiza linhas
  // 'waiting' (nenhuma) e persistDelayWait retorna sem sinalizar. A rota marca o run
  // 'waiting' mesmo assim: o contato nunca continua e não há rastro do problema.
  // lib/builder/workflow-enrollments.ts:95-114 + execute/route.ts:167-189.
  it.fails('EXE-10: BUG(wait-perdido-conflito) — espera que conflita com um enrollment "active" não pode sumir em silêncio', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-conflict', msgWaitMsg(5)))
    h.db.insert('workflow_enrollments', {
      workflow_id: workflowId,
      version_id: 'v-old',
      phone: TEST_PHONES.ana,
      status: 'active',
      wait_kind: 'delay',
      resume_at: at(-MIN),
      locked_at: T,
      locked_by: 'drain-em-voo',
    })
    const res = await exec(workflowId)
    const runId = res.body.executionId
    const persisted = enrollments(workflowId).some((e) => e.run_id === runId && e.status === 'waiting')
    // correto: ou a espera foi persistida/enfileirada, ou o run NÃO fica 'waiting' órfão
    expect(persisted || runRow(runId).status !== 'waiting').toBe(true)
  })

  it('EXE-10a: o conflito com enrollment "active" deixa a linha do dreno intacta (caracterização)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-conflict-a', msgWaitMsg(5)))
    const [active] = h.db.insert('workflow_enrollments', {
      workflow_id: workflowId,
      version_id: 'v-old',
      phone: TEST_PHONES.ana,
      status: 'active',
      wait_kind: 'delay',
      resume_at: at(-MIN),
      locked_at: T,
      locked_by: 'drain-em-voo',
    })
    const res = await exec(workflowId)
    expect(res.status).toBe(200)
    expect(enrollments(workflowId)).toHaveLength(1)
    expect(h.db.row('workflow_enrollments', { id: active.id })).toMatchObject({ status: 'active', locked_by: 'drain-em-voo' })
  })

  it('EXE-11: janela de horário fechada → espera persistida NO nó de envio, até a próxima abertura; nada enviado', async () => {
    freezeTime('2026-10-19T20:00:00.000Z') // segunda 20:00 UTC (fora de 09-18)
    const window: WorkflowTimeWindow = { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'UTC' }
    const { workflowId } = await publishFlow(h.db, flowOf('wf-tw', chain(steps.whatsapp({ id: 'm1', message: 'Bom dia!' }))), {
      settings: { timeWindow: window },
    })
    const res = await exec(workflowId)
    expect(res.body.status).toBe('waiting')
    expect(h.meta.sent).toHaveLength(0)
    expect(enrollments(workflowId)).toEqual([
      expect.objectContaining({ status: 'waiting', resume_node_ids: ['m1'], resume_at: '2026-10-20T09:00:00.000Z' }),
    ])
    expect(runRow(res.body.executionId).status).toBe('waiting')
  })

  it('EXE-11b: janela fechada deixa as ações internas (tag) rodarem antes da pausa', async () => {
    freezeTime('2026-10-19T20:00:00.000Z')
    const window: WorkflowTimeWindow = { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'UTC' }
    const { workflowId } = await publishFlow(
      h.db,
      flowOf('wf-tw-tag', chain(steps.tag({ id: 't', tags: ['lead-noturno'] }), steps.whatsapp({ id: 'm1', message: 'Bom dia!' }))),
      { settings: { timeWindow: window } }
    )
    await exec(workflowId)
    expect(h.db.row('contacts', { phone: TEST_PHONES.ana })?.tags).toEqual(expect.arrayContaining(['lead-noturno']))
    expect(enrollments(workflowId)[0].resume_node_ids).toEqual(['m1'])
    expect(h.meta.sent).toHaveLength(0)
  })
})

// ─── Erros no meio ────────────────────────────────────────────────────────────

describe('execute: erro no meio deixa o estado consistente', () => {
  it('EXE-12: Meta recusa o envio antes do Aguardar → run fechado (não fica "running"), sem espera órfã', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-metafail', msgWaitMsg(5)))
    h.meta.failNext(131026)
    const res = await exec(workflowId)
    const run = runRow(res.body.executionId)
    expect(run.status).not.toBe('running')
    if (res.body.status === 'waiting') {
      // se o executor seguiu mesmo com a falha, a espera precisa ter sido persistida
      expect(enrollments(workflowId)).toHaveLength(1)
    } else {
      expect(res.body.status).toBe('failed')
      expect(run.finished_at).not.toBeNull()
    }
  })

  // BUG(wait-perdido-erro-db): persistDelayWait engole QUALQUER erro do INSERT (não só o
  // 23505): numa falha transitória do banco o fallback só tenta UPDATE em linhas 'waiting'
  // (nenhuma) e retorna sem sinal. A rota marca o run 'waiting' e responde 'waiting' — o
  // contato fica parado para sempre, sem enrollment para o cron retomar e sem erro visível.
  // lib/builder/workflow-enrollments.ts:95-114 + execute/route.ts:167-189.
  it.fails('EXE-13: BUG(wait-perdido-erro-db) — falha ao gravar a espera não pode deixar o run "waiting" sem enrollment', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-dbfail', msgWaitMsg(5)))
    h.db.failNext('workflow_enrollments', 'connection reset by peer', 'insert')
    const res = await exec(workflowId)
    const persisted = enrollments(workflowId).length > 0
    expect(persisted || runRow(res.body.executionId).status !== 'waiting').toBe(true)
  })

  it('EXE-13a: falha ao gravar a espera — caracterização do estado atual (resposta "waiting", nenhum enrollment)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-dbfail-a', msgWaitMsg(5)))
    h.db.failNext('workflow_enrollments', 'connection reset by peer', 'insert')
    const res = await exec(workflowId)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('waiting')
    expect(enrollments(workflowId)).toHaveLength(0)
    expect(h.meta.texts()).toEqual(['Antes'])
  })

  it('EXE-13b: grafo corrompido (aresta null) é barrado na validação antes de criar run ou enviar', async () => {
    const { workflowId, versionId } = await publishFlow(h.db, flowOf('wf-corrupt', msgWaitMsg(5)))
    const version = h.db.row('workflow_versions', { id: versionId })!
    h.db.update('workflow_versions', { id: versionId }, { edges: [...(version.edges as unknown[]), null] })
    const res = await exec(workflowId)
    expect(res.body).toMatchObject({ status: 'failed', error: 'Invalid workflow' })
    expect(runsOf(workflowId)).toHaveLength(0)
    expect(h.meta.sent).toHaveLength(0)
    expect(enrollments(workflowId)).toHaveLength(0)
  })
})

// ─── Gatilho por webhook do builder (outra porta de entrada do executor) ───────

describe('POST /api/builder/workflows/[id]/webhook × Aguardar', () => {
  async function callBuilderWebhook(workflowId: string, body: unknown) {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/webhook/route')
    const response = await mod.POST(jsonRequest(`/api/builder/workflows/${workflowId}/webhook`, body), routeParams(workflowId))
    return { status: response.status, body: (await response.json()) as ExecBody }
  }

  // BUG(webhook-builder-perde-delay): a rota do webhook do builder chama executeWorkflow sem
  // tratar paused/wait (e sem passar workflowSettings). Um fluxo com Aguardar pausa sem
  // persistir nada: responde 'success', o run fica 'running' e o resto do fluxo nunca roda.
  // app/api/builder/workflows/[workflowId]/webhook/route.ts:54-66.
  it.fails('WH-01: BUG(webhook-builder-perde-delay) — gatilho por webhook deveria persistir o Aguardar', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-hook', msgWaitMsg(5), triggers.none()))
    const res = await callBuilderWebhook(workflowId, { from: waId(TEST_PHONES.ana), to: waId(TEST_PHONES.ana) })
    expect(res.status).toBe(200)
    expect(enrollments(workflowId)).toHaveLength(1)
    expect(runRow(res.body.executionId).status).toBe('waiting')
  })

  it('WH-01a: hoje o webhook do builder responde "success" mas não grava espera e deixa o run "running" (caracterização)', async () => {
    const { workflowId } = await publishFlow(h.db, flowOf('wf-hook-a', msgWaitMsg(5), triggers.none()))
    const res = await callBuilderWebhook(workflowId, { from: waId(TEST_PHONES.ana), to: waId(TEST_PHONES.ana) })
    expect(res.body.status).toBe('success')
    expect(h.meta.texts()).toEqual(['Antes'])
    expect(enrollments(workflowId)).toHaveLength(0)
    expect(runRow(res.body.executionId).status).toBe('running')
  })
})
