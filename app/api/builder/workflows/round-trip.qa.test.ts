// @vitest-environment node
/**
 * Round-trip completo do builder, com as rotas REAIS e o Supabase em memória:
 * árvore (Flow) → compileFlow → PATCH (autosave) → POST publish → webhook da Meta acha o
 * fluxo → reinvokeSelf → /execute → executor → Graph API (mock). Nada vai à rede.
 *
 * Prova que CADA passo habilitado no v1, depois de salvo e publicado pelo caminho da tela,
 * realmente roda quando o gatilho dispara — e que rascunhos não disparam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
  handleDeliveryStatus: vi.fn(async () => {}),
}))

import { compileFlow } from '@/lib/builder/flow/compile'
import type { Flow, Step } from '@/lib/builder/flow/types'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  flushSelfInvokes,
  freezeTime,
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

const ANA = TEST_PHONES.ana

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

/** Caminho da tela: o fluxo nasce pelo /create (draft com owner), é salvo e publicado. */
async function saveAndPublish(flow: Flow) {
  await seedPublishedFlow(h.db, flow, { publish: false })
  return publishFlow(h.db, flow)
}

async function receiveText(body: string, from: string = ANA) {
  const res = await routes.webhook(metaWebhookBody({ messages: [metaInbound.text({ from, body })] }))
  expect(res.status).toBe(200)
  return flushSelfInvokes()
}

const textsTo = (phone: string) => h.meta.sentTo(phone).map((m) => m.text ?? m.interactiveText)
const kwFlow = (root: Step | null, keywords = ['oi'], id = 'wf') =>
  makeFlow({ id, name: 'Fluxo QA', trigger: triggers.keywords(keywords), root })

describe('round-trip: salvar → publicar → webhook → execução, para cada passo', () => {
  it('whatsapp (mensagem): dispara pela palavra-chave e envia o texto para quem escreveu', async () => {
    await saveAndPublish(kwFlow(steps.whatsapp({ id: 'w1', message: 'Olá, tudo bem?' })))
    const flushed = await receiveText('oi')
    expect(flushed.map((f) => f.path)).toEqual(['/api/builder/workflow/wf/execute'])
    expect(flushed[0].result?.body).toMatchObject({ status: 'success' })
    expect(textsTo(ANA)).toEqual(['Olá, tudo bem?'])
    const runs = h.db.rows('workflow_runs').filter((r) => r.workflow_id === 'wf')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ trigger_type: 'Keywords', version_id: h.db.row('workflows', { id: 'wf' })?.active_version_id })
  })

  it('whatsapp (template): envia o template aprovado (language pt_BR)', async () => {
    await saveAndPublish(kwFlow(steps.whatsapp({ id: 'w1', template: 'boas_vindas' })))
    await receiveText('oi')
    const sent = h.meta.sentTo(ANA)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'template', templateName: 'boas_vindas' })
    expect((sent[0].body as { template: { language: { code: string } } }).template.language.code).toBe('pt_BR')
  })

  it('whatsapp (mídia): envia a imagem com a legenda', async () => {
    await saveAndPublish(kwFlow(steps.whatsapp({ id: 'w1', mediaUrl: 'https://cdn.dispara.test/a.jpg', message: 'Veja' })))
    await receiveText('oi')
    const [sent] = h.meta.sentTo(ANA)
    expect(sent).toMatchObject({ type: 'image' })
    expect(JSON.stringify(sent.body)).toContain('https://cdn.dispara.test/a.jpg')
    expect(JSON.stringify(sent.body)).toContain('Veja')
  })

  it('tag e tag_remove: alteram as tags do contato que disparou', async () => {
    h.db.update('contacts', { id: SEED_IDS.contacts.ana }, { tags: ['antigo'] })
    await saveAndPublish(kwFlow(chain(steps.tag({ id: 't1', tags: ['vip'] }), steps.tagRemove({ id: 't2', tags: ['antigo'] }))))
    await receiveText('oi')
    expect(h.db.row('contacts', { id: SEED_IDS.contacts.ana })?.tags).toEqual(['vip'])
  })

  it('pipeline: cria a oportunidade do contato na etapa escolhida', async () => {
    await saveAndPublish(kwFlow(steps.pipeline({ id: 'p1', stageId: SEED_IDS.stages.proposta, stageName: 'Proposta' })))
    await receiveText('oi')
    const opps = h.db.rows('opportunities')
    expect(opps).toHaveLength(1)
    expect(opps[0]).toMatchObject({ pipeline_id: SEED_IDS.pipeline, stage_id: SEED_IDS.stages.proposta, status: 'open' })
  })

  it('condition no root: escolhe a branch pela mensagem do gatilho (e só ela)', async () => {
    const root = steps.condition({
      id: 'c',
      branches: [{ label: 'Promo', value: 'promo', operator: 'contains', child: steps.whatsapp({ id: 'wa', message: 'PROMO' }) }],
      none: steps.whatsapp({ id: 'wb', message: 'OUTRO' }),
    })
    await saveAndPublish(kwFlow(root, ['promo', 'oi']))
    await receiveText('promo')
    expect(textsTo(ANA)).toEqual(['PROMO'])
    await receiveText('oi', TEST_PHONES.bruno)
    expect(textsTo(TEST_PHONES.bruno)).toEqual(['OUTRO'])
  })

  it('interactive: pergunta, espera a resposta (conversation) e segue pelo botão escolhido', async () => {
    const root = steps.interactive({
      id: 'q',
      message: 'Quer falar com vendas?',
      buttons: [
        { label: 'Sim', child: steps.whatsapp({ id: 'ws', message: 'Chamando vendas' }) },
        { label: 'Não', child: steps.whatsapp({ id: 'wn', message: 'Tudo bem' }) },
      ],
      next: steps.whatsapp({ id: 'wfim', message: 'Obrigado' }),
    })
    await saveAndPublish(kwFlow(root))
    await receiveText('oi')
    expect(textsTo(ANA)).toEqual(['Quer falar com vendas?'])
    const conv = h.db.rows('workflow_conversations').find((c) => c.workflow_id === 'wf')
    expect(conv).toMatchObject({ status: 'waiting', resume_node_id: 'q__var', variable_key: 'reply_q' })

    const flushed = await receiveText('Sim')
    expect(flushed.map((f) => f.path)).toEqual(['/api/builder/workflow/wf/resume'])
    expect(textsTo(ANA)).toEqual(['Quer falar com vendas?', 'Chamando vendas', 'Obrigado'])
    expect(h.db.row('workflow_conversations', { id: conv!.id })?.status).toBe('completed')
  })

  it('wait: pausa com enrollment durável e o cron retoma depois do prazo', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await saveAndPublish(kwFlow(chain(steps.wait({ id: 'wt', value: 2, unit: 'minutes' }), steps.whatsapp({ id: 'w2', message: 'Voltei' }))))
    const [flushed] = await receiveText('oi')
    expect(flushed.result?.body).toMatchObject({ status: 'waiting' })
    expect(textsTo(ANA)).toEqual([])
    const enrollment = h.db.rows('workflow_enrollments').find((e) => e.workflow_id === 'wf')
    expect(enrollment).toMatchObject({ status: 'waiting', resume_at: '2026-10-18T12:02:00.000Z' })

    await routes.drain()
    expect(textsTo(ANA)).toEqual([]) // ainda não venceu
    advanceTime(2 * 60_000 + 1)
    await routes.drain()
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Voltei'])
  })

  it('end no meio: nada depois do END roda', async () => {
    const root = steps.condition({
      id: 'c',
      branches: [{ label: 'Sair', value: 'sair', operator: 'contains', child: steps.end() }],
      none: steps.whatsapp({ id: 'wn', message: 'continua' }),
      next: steps.whatsapp({ id: 'wz', message: 'depois' }),
    })
    await saveAndPublish(kwFlow(root, ['sair', 'oi']))
    await receiveText('oi')
    expect(textsTo(ANA)).toEqual(['continua', 'depois'])
    await receiveText('sair', TEST_PHONES.bruno)
    expect(textsTo(TEST_PHONES.bruno)).toEqual([])
  })
})

describe('round-trip: o webhook só enxerga o que foi publicado', () => {
  it('R06 rascunho com a mesma palavra-chave NÃO dispara; o publicado sim', async () => {
    await seedPublishedFlow(h.db, kwFlow(steps.whatsapp({ id: 'wr', message: 'rascunho' }), ['oi'], 'rascunho'), { publish: false })
    await saveAndPublish(kwFlow(steps.whatsapp({ id: 'wp', message: 'publicado' }), ['menu'], 'publicado'))
    await receiveText('oi')
    expect(selfInvokeCalls).toHaveLength(0)
    expect(textsTo(ANA)).toEqual([])
    await receiveText('menu')
    expect(textsTo(ANA)).toEqual(['publicado'])
  })

  it('C02 normalização do webhook: keyword "Olá" casa "ola"/"OLÁ", mas o match é EXATO (não substring)', async () => {
    await saveAndPublish(kwFlow(steps.whatsapp({ id: 'w', message: 'oi!' }), ['  Olá ']))
    await receiveText('ola tudo bem')
    expect(selfInvokeCalls).toHaveLength(0)
    await receiveText('OLÁ')
    expect(textsTo(ANA)).toEqual(['oi!'])
  })

  it('fluxo "Sem gatilho" publicado nunca é disparado pelo webhook', async () => {
    await saveAndPublish(makeFlow({ id: 'manual', trigger: triggers.none(), root: steps.whatsapp({ id: 'w', message: 'x' }) }))
    await receiveText('oi')
    expect(selfInvokeCalls).toHaveLength(0)
  })

  it('o loader de CampaignReply enxerga o gatilho compilado (campaignId "" = qualquer disparo)', async () => {
    await saveAndPublish(makeFlow({ id: 'cr', trigger: triggers.campaignReply({ replyFilter: ' Quero ' }), root: steps.whatsapp({ id: 'w', message: 'x' }) }))
    const { data } = await h.db.client.from('workflow_versions').select('workflow_id, nodes').eq('status', 'published')
    const trigger = ((data as Row[])[0].nodes as Array<{ data: { type: string; config: Row } }>).find((n) => n.data.type === 'trigger')
    expect(trigger?.data.config).toEqual({ triggerType: 'CampaignReply', campaignId: '', campaignName: '', replyFilter: 'Quero' })
  })

  it('compileFlow no cliente ≡ grafo que o /execute roda (o publish recompila a árvore no servidor — mesmo resultado)', async () => {
    const flow = kwFlow(chain(steps.tag({ id: 't', tags: ['x'] }), steps.whatsapp({ id: 'w', message: 'y' })))
    const published = await saveAndPublish(flow)
    const active = h.db.row('workflow_versions', { id: h.db.row('workflows', { id: 'wf' })?.active_version_id as string })
    expect(active?.nodes).toEqual(compileFlow(flow).nodes)
    expect(active?.id).toBe(published.versionId)
  })
})

describe('round-trip: bugs que só aparecem executando o grafo compilado', () => {
  // Corrigido BUG(orphan-next): numa condição em que TODAS as branches terminam em END, o passo do
  // "next" é compilado sem edge de entrada; o executor trata nó sem entrada como raiz e o roda
  // no início de TODA execução. Correto: "Obrigado" nunca é enviado (nenhum caminho leva a ele).
  it('C11 orphan-next: passo depois de condição toda-END não deveria rodar', async () => {
    const root = steps.condition({
      id: 'c',
      branches: [{ label: 'X', value: 'x', operator: 'contains', child: steps.end() }],
      none: steps.end(),
      next: steps.whatsapp({ id: 'wz', message: 'Obrigado' }),
    })
    await saveAndPublish(kwFlow(root))
    await receiveText('oi')
    expect(textsTo(ANA)).toEqual([])
  })

  // Corrigido BUG(resume-trigger-ref): condição na convergência depois de um Perguntar que está DENTRO de
  // uma branch referencia {{@__trigger:Gatilho.message}}. O /resume roda a partir de ask__var sem
  // os outputs do gatilho: a expressão fica literal, todas as saídas da condição dão false e o
  // fluxo morre em silêncio. Correto: depois de responder "Sim", alguma saída de C2 roda.
  it('C12 resume-trigger-ref: condição após Perguntar aninhado deveria seguir no resume', async () => {
    const root = steps.condition({
      id: 'c1',
      branches: [{ label: 'A', value: 'oi', operator: 'contains', child: steps.interactive({ id: 'q', message: 'Confirma?', buttons: ['Sim'] }) }],
      next: steps.condition({
        id: 'c2',
        branches: [{ label: 'B', value: 'xyz', operator: 'contains', child: steps.whatsapp({ id: 'wb', message: 'B' }) }],
        none: steps.whatsapp({ id: 'wn', message: 'NONE' }),
      }),
    })
    await saveAndPublish(kwFlow(root))
    await receiveText('oi')
    expect(textsTo(ANA)).toEqual(['Confirma?'])
    await receiveText('Sim')
    expect(textsTo(ANA).length).toBeGreaterThan(1)
  })

  // Corrigido BUG(perguntar-sem-botoes): a tela configura botões, mas o ask-question compilado envia
  // TEXTO puro e casa a resposta com === sensível a maiúsculas. Correto: a mensagem do Perguntar
  // sai como interativa com os botões e responder "sim" segue pela branch "Sim".
  it('C09 perguntar-sem-botoes: o Perguntar deveria sair com botões interativos', async () => {
    await saveAndPublish(kwFlow(steps.interactive({ id: 'q', message: 'Topa?', buttons: ['Sim', 'Não'] })))
    await receiveText('oi')
    const [sent] = h.meta.sentTo(ANA)
    expect(sent.type).toBe('interactive')
  })

  it('C09 o Perguntar sai com botões e "sim" minúsculo digitado segue a branch "Sim"', async () => {
    const root = steps.interactive({
      id: 'q',
      message: 'Topa?',
      buttons: [{ label: 'Sim', child: steps.whatsapp({ id: 'ws', message: 'ok sim' }) }],
      next: null,
    })
    await saveAndPublish(kwFlow(root))
    await receiveText('oi')
    expect(h.meta.sentTo(ANA)[0].type).toBe('interactive')
    await receiveText('sim')
    expect(textsTo(ANA)).toEqual(['Topa?', 'ok sim'])
  })
})
