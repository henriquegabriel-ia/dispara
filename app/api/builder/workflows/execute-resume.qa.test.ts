// @vitest-environment node
/**
 * Rotas que o webhook/cron chamam para RODAR o grafo compilado:
 *   POST /api/builder/workflow/[id]/execute  (disparo inicial; gate de keywords; Delay durável)
 *   POST /api/builder/workflow/[id]/resume   (resposta do Perguntar)
 * Executor REAL, Supabase em memória e Graph API mockada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import type { Flow } from '@/lib/builder/flow/types'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  chain,
  freezeTime,
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

const ANA = TEST_PHONES.ana

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

type ExecBody = { executionId: string; status: string; output?: Row; error?: string }
const exec = async (id: string, body: unknown, opts?: { auth?: boolean }) =>
  (await routes.execute(id, body, opts)) as { status: number; body: ExecBody }
const resume = async (id: string, body: unknown, opts?: { auth?: boolean }) =>
  (await routes.resume(id, body, opts)) as { status: number; body: ExecBody }
const run = (executionId: string) => h.db.row('workflow_runs', { id: executionId })
const textsTo = (phone: string) => h.meta.sentTo(phone).map((m) => m.text ?? m.interactiveText)

const kw = (keywords: string[], root = steps.whatsapp({ id: 'w', message: 'resposta' }) as Flow['root'], id = 'wf') =>
  makeFlow({ id, trigger: triggers.keywords(keywords), root })

describe('execute — autenticação e validação', () => {
  it('sem Bearer CRON_SECRET → 401 e nenhuma run', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    const res = await exec('wf', { input: { from: ANA, message: 'oi' } }, { auth: false })
    expect(res.status).toBe(401)
    expect(h.db.count('workflow_runs')).toBe(0)
    expect(h.meta.sent).toHaveLength(0)
  })

  it('grafo ativo inválido (sem trigger) → status "failed" "Invalid workflow" sem run', async () => {
    const seeded = await seedPublishedFlow(h.db, kw(['oi']))
    h.db.update('workflow_versions', { id: seeded.versionId }, { nodes: [], edges: [] })
    const res = await exec('wf', { input: { from: ANA, message: 'oi' } })
    expect(res.body).toMatchObject({ status: 'failed', error: 'Invalid workflow' })
    expect(h.db.count('workflow_runs')).toBe(0)
  })
})

describe('execute — gate de Keywords', () => {
  it('E02 sem mensagem → run "skipped" missing_message e nada enviado', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    const res = await exec('wf', { input: { from: ANA } })
    expect(res.body).toMatchObject({ status: 'skipped', output: { reason: 'missing_message' } })
    expect(run(res.body.executionId)).toMatchObject({ status: 'skipped', output: { reason: 'missing_message' }, trigger_type: 'Keywords' })
    expect(h.meta.sent).toHaveLength(0)
  })

  it('E02 mensagem sem keyword → run "skipped" keyword_not_matched', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    const res = await exec('wf', { input: { from: ANA, message: 'tchau' } })
    expect(res.body).toMatchObject({ status: 'skipped', output: { reason: 'keyword_not_matched' } })
    expect(run(res.body.executionId)?.status).toBe('skipped')
  })

  it('E02 casa sem diferenciar maiúsculas e executa (run com version_id da versão ativa)', async () => {
    const seeded = await seedPublishedFlow(h.db, kw(['Oi']))
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'OI' } })
    expect(res.body.status).toBe('success')
    expect(textsTo(ANA)).toEqual(['resposta'])
    expect(run(res.body.executionId)).toMatchObject({ version_id: seeded.versionId, trigger_type: 'Keywords' })
  })

  it('E02 o gate do execute usa a MESMA regra do webhook: match exato normalizado (substring não casa)', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'quero oi agora' } })
    expect(res.body).toMatchObject({ status: 'skipped', output: { reason: 'keyword_not_matched' } })
    expect(h.meta.sent).toHaveLength(0)
  })

  it('E02 fluxo despachado como PADRÃO (dispatch "default") não passa pelo gate de Palavras-chave', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'bom dia' }, dispatch: 'default' })
    expect(res.body.status).toBe('success')
    expect(textsTo(ANA)).toEqual(['resposta'])
  })

  it('E02 contato com opt-out/supressão ativa não recebe o fluxo (run "skipped" contact_opted_out)', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    h.db.insert('phone_suppressions', { phone: ANA, is_active: true, source: 'inbound_keyword', reason: 'PARAR' })
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'oi' } })
    expect(res.body).toMatchObject({ status: 'skipped', output: { reason: 'contact_opted_out' } })
    expect(h.meta.sent).toHaveLength(0)
  })

  it('E02 com startNodeIds (retomada) o gate não se aplica', async () => {
    await seedPublishedFlow(h.db, kw(['oi']))
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'qualquer' }, startNodeIds: ['w'] })
    expect(res.body.status).toBe('success')
    expect(textsTo(ANA)).toEqual(['resposta'])
  })

  it('E02 CampaignReply e None não passam pelo gate', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'cr', trigger: triggers.campaignReply({}), root: steps.whatsapp({ id: 'w', message: 'cr' }) }))
    await seedPublishedFlow(h.db, makeFlow({ id: 'nn', trigger: triggers.none(), root: steps.whatsapp({ id: 'w', message: 'nn' }) }))
    expect((await exec('cr', { input: { from: ANA, to: ANA, message: 'qualquer' } })).body.status).toBe('success')
    expect((await exec('nn', { input: { from: ANA, to: ANA } })).body.status).toBe('success')
    expect(textsTo(ANA)).toEqual(['cr', 'nn'])
  })

  // Corrigido BUG(keyword-acento): o webhook normaliza acentos (keyword "ola" casa "Olá", como a dica da
  // tela promete) e despacha; o gate do /execute só faz toLowerCase + includes, então
  // "olá".includes("ola") é false e a run vira "skipped keyword_not_matched". Correto: executar.
  it('E01 keyword-acento: "Olá" deveria passar no gate de uma keyword "ola"', async () => {
    await seedPublishedFlow(h.db, kw(['ola']))
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'Olá' } })
    expect(res.body.status).toBe('success')
  })

  it('E01 keyword-acento: "promocao" deveria passar no gate de uma keyword "Promoção"', async () => {
    await seedPublishedFlow(h.db, kw(['Promoção']))
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'promocao' } })
    expect(res.body.status).toBe('success')
  })

})

describe('execute — rascunho', () => {
  // Corrigido BUG(default-draft): o webhook despacha o "fluxo padrão" para toda mensagem sem keyword e o
  // /execute roda a versão ATIVA sem checar workflows.status: um rascunho nunca publicado (ou
  // um None/CampaignReply marcado como padrão) roda para toda mensagem inbound.
  // Correto: o /execute recusa (skip) fluxo que não está publicado.
  it('E03 default-draft: execute não deveria rodar um fluxo nunca publicado', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'wf', trigger: triggers.none(), root: steps.whatsapp({ id: 'w', message: 'rascunho' }) }), { publish: false })
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'qualquer coisa' } })
    expect(res.body.status).not.toBe('success')
    expect(h.meta.sent).toHaveLength(0)
  })

})

describe('execute — Delay durável', () => {
  const delayThenCondition = () =>
    kw(
      ['oi'],
      chain(
        steps.whatsapp({ id: 'w0', message: 'antes' }),
        steps.wait({ id: 'wt', value: 3, unit: 'hours' }),
        steps.condition({ id: 'c', branches: [{ label: 'A', value: 'oi', child: steps.whatsapp({ id: 'wa', message: 'A' }) }], none: steps.whatsapp({ id: 'wn', message: 'N' }) })
      )
    )

  it('E02 pausa: enrollment waiting com TODOS os heads da continuação, variáveis/outputs e run "waiting"', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const seeded = await seedPublishedFlow(h.db, delayThenCondition())
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'oi' } })
    expect(res.body.status).toBe('waiting')
    expect(textsTo(ANA)).toEqual(['antes'])
    const [enr] = h.db.rows('workflow_enrollments')
    expect(enr).toMatchObject({
      workflow_id: 'wf',
      version_id: seeded.versionId,
      phone: ANA,
      status: 'waiting',
      wait_kind: 'delay',
      run_id: res.body.executionId,
      resume_at: '2026-10-18T15:00:00.000Z',
    })
    expect([...(enr.resume_node_ids as string[])].sort()).toEqual(['c__cond_0', 'c__cond_none'])
    expect(enr.resolved_nodes).toEqual(expect.arrayContaining(['__trigger', 'w0', 'wt']))
    expect(Object.keys(enr.outputs as Row)).toEqual(expect.arrayContaining(['__trigger']))
    expect(run(res.body.executionId)).toMatchObject({ status: 'waiting', output: { status: 'waiting', waitKind: 'delay' }, finished_at: null })
  })

  it('E02 depois do prazo o drain retoma e a condição usa a mensagem ORIGINAL do gatilho (outputs persistidos)', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await seedPublishedFlow(h.db, delayThenCondition())
    await exec('wf', { input: { from: ANA, to: ANA, message: 'oi' } })
    vi.setSystemTime(new Date('2026-10-18T15:00:01.000Z'))
    await routes.drain()
    expect(textsTo(ANA)).toEqual(['antes', 'A'])
  })

  it('E02 Delay sem telefone (sem from/to) → run "failed" "Delay sem telefone de retomada" e nenhum enrollment', async () => {
    await seedPublishedFlow(h.db, makeFlow({ id: 'nn', trigger: triggers.none(), root: chain(steps.wait({ id: 'wt' }), steps.whatsapp({ id: 'w', message: 'x' })) }))
    const res = await exec('nn', { input: {} })
    expect(res.body.status).toBe('failed')
    expect(run(res.body.executionId)).toMatchObject({ status: 'failed', error: 'Delay sem telefone de retomada' })
    expect(h.db.count('workflow_enrollments')).toBe(0)
  })
})

describe('resume — validações', () => {
  const askFlow = () =>
    kw(
      ['oi'],
      steps.interactive({
        id: 'q',
        message: 'Topa?',
        buttons: [
          { label: 'Sim', child: steps.whatsapp({ id: 'ws', message: 'Oba' }) },
          { label: 'Não', child: steps.whatsapp({ id: 'wn', message: 'Pena' }) },
        ],
      })
    )

  function conversation(over: Row = {}) {
    return h.db.insert('workflow_conversations', {
      id: 'conv1',
      workflow_id: 'wf',
      phone: ANA,
      status: 'waiting',
      resume_node_id: 'q__var',
      variable_key: 'reply_q',
      variables: {},
      ...over,
    })
  }

  it('sem Bearer → 401', async () => {
    expect((await resume('wf', { conversationId: 'x', input: { message: 'Sim' } }, { auth: false })).status).toBe(401)
  })

  it.each([
    ['sem conversationId', {}, undefined, 'Missing workflowId or conversationId'],
    ['conversa inexistente', { conversationId: 'nope', input: { message: 'Sim' } }, undefined, 'Conversation not found'],
    ['conversa já completed', { conversationId: 'conv1', input: { message: 'Sim' } }, { status: 'completed' }, 'Conversation not found'],
    ['conversa de outro workflow', { conversationId: 'conv1', input: { message: 'Sim' } }, { workflow_id: 'outro' }, 'Conversation workflow mismatch'],
    ['sem resume_node_id', { conversationId: 'conv1', input: { message: 'Sim' } }, { resume_node_id: null }, 'Conversation missing resume node'],
    ['sem variable_key', { conversationId: 'conv1', input: { message: 'Sim' } }, { variable_key: null }, 'Conversation missing variable key'],
    ['mensagem vazia', { conversationId: 'conv1', input: { message: '   ' } }, {}, 'Missing inbound message'],
  ])('X01 %s → failed com o erro certo, sem enviar nada', async (_l, body, conv, error) => {
    await seedPublishedFlow(h.db, askFlow())
    await seedPublishedFlow(h.db, kw(['x'], undefined, 'outro'))
    if (conv) conversation(conv as Row)
    const res = await resume('wf', body)
    expect(res.body).toMatchObject({ status: 'failed', error })
    expect(h.meta.sent).toHaveLength(0)
    expect(h.db.rows('workflow_runs').filter((r) => r.trigger_type === 'Resume')).toHaveLength(0)
  })

  it('X01 caso válido: execute cria a conversa; resume segue pelo botão, encerra a conversa e grava run "Resume"', async () => {
    await seedPublishedFlow(h.db, askFlow())
    const first = await exec('wf', { input: { from: ANA, to: ANA, message: 'oi' } })
    // o Perguntar pausa a execução (aguarda a resposta)
    expect(first.body.status).toBe('waiting')
    expect(run(first.body.executionId)?.status).toBe('waiting')
    expect(textsTo(ANA)).toEqual(['Topa?'])
    const conv = h.db.rows('workflow_conversations')[0]
    expect(conv).toMatchObject({ workflow_id: 'wf', status: 'waiting', resume_node_id: 'q__var', variable_key: 'reply_q' })

    const res = await resume('wf', { conversationId: conv.id, input: { from: ANA, message: 'Não' } })
    expect(textsTo(ANA)).toEqual(['Topa?', 'Pena'])
    // a branch "Sim" pulada não conta como falha
    expect(res.body.status).toBe('success')
    expect(h.db.row('workflow_conversations', { id: conv.id })).toMatchObject({ status: 'completed' })
    expect((h.db.row('workflow_conversations', { id: conv.id })?.variables as Row).reply_q).toBe('Não')
    expect(run(res.body.executionId)).toMatchObject({ trigger_type: 'Resume', workflow_id: 'wf' })

    // a mesma conversa não pode ser retomada 2x
    const again = await resume('wf', { conversationId: conv.id, input: { from: ANA, message: 'Sim' } })
    expect(again.body).toMatchObject({ status: 'failed', error: 'Conversation not found' })
  })

  it('X01 resposta que não é botão segue pelo else ("Outra resposta") → continuação', async () => {
    await seedPublishedFlow(
      h.db,
      kw(['oi'], steps.interactive({ id: 'q', message: 'Topa?', buttons: [{ label: 'Sim', child: steps.end() }], next: steps.whatsapp({ id: 'wfim', message: 'fim' }) }))
    )
    await exec('wf', { input: { from: ANA, to: ANA, message: 'oi' } })
    const conv = h.db.rows('workflow_conversations')[0]
    await resume('wf', { conversationId: conv.id, input: { from: ANA, message: 'talvez' } })
    expect(textsTo(ANA)).toEqual(['Topa?', 'fim'])
  })

  it('X01 resume que cai num Delay persiste o enrollment (com as variáveis da resposta) e a run fica "waiting"', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await seedPublishedFlow(
      h.db,
      kw(['oi'], steps.interactive({ id: 'q', message: 'Topa?', buttons: [{ label: 'Sim', child: chain(steps.wait({ id: 'wt', value: 1, unit: 'days' }), steps.whatsapp({ id: 'w', message: 'amanhã' })) }] }))
    )
    await exec('wf', { input: { from: ANA, to: ANA, message: 'oi' } })
    const conv = h.db.rows('workflow_conversations')[0]
    const res = await resume('wf', { conversationId: conv.id, input: { from: ANA, message: 'Sim' } })
    expect(res.body.status).toBe('waiting')
    const [enr] = h.db.rows('workflow_enrollments')
    expect(enr).toMatchObject({ workflow_id: 'wf', phone: ANA, status: 'waiting', resume_at: '2026-10-19T12:00:00.000Z' })
    expect((enr.variables as Row).reply_q).toBe('Sim')
    expect(run(res.body.executionId)?.status).toBe('waiting')
    vi.setSystemTime(new Date('2026-10-19T12:00:01.000Z'))
    await routes.drain()
    expect(textsTo(ANA)).toEqual(['Topa?', 'amanhã'])
  })
})

describe('status da execução com ramificação', () => {
  const branchFlow = () =>
    kw(
      ['oi', 'promo'],
      steps.condition({
        id: 'c',
        branches: [{ label: 'Promo', value: 'promo', child: steps.whatsapp({ id: 'wp', message: 'PROMO' }) }],
        none: steps.whatsapp({ id: 'wn', message: 'OUTRO' }),
      })
    )

  // Corrigido BUG(branch-pulada-falha): o executor grava { success: false, error: "skipped" } para cada nó
  // de uma branch NÃO escolhida e calcula success = every(results.success). Toda execução com
  // condição/Perguntar (onde sempre sobra uma branch não escolhida) termina como "failed" na
  // resposta e "error"/"skipped" na workflow_runs, mesmo tendo enviado tudo certo — as métricas
  // contam como falha. Correto: branch pulada não é falha; status "success".
  it('branch-pulada-falha: execução que seguiu a branch certa deveria terminar "success"', async () => {
    await seedPublishedFlow(h.db, branchFlow())
    const res = await exec('wf', { input: { from: ANA, to: ANA, message: 'promo' } })
    expect(textsTo(ANA)).toEqual(['PROMO'])
    expect(res.body.status).toBe('success')
    expect(run(res.body.executionId)?.status).toBe('success')
  })

})
