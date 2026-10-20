// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Inscrição manual ("Adicionar ao workflow") — POST /api/builder/workflows/[id]/enroll — com a
 * rota REAL, o Supabase em memória (esquema do Dispara, UNIQUE parcial dos enrollments ativos) e,
 * nos testes ponta a ponta, o drain real do pg_cron + executor real + Graph mockada.
 *
 * Bugs de produto ficam em it.fails com o comportamento CORRETO e um comentário BUG(...).
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
// O webhook (usado no teste ponta a ponta de Perguntar) chama a inbox; ela não é o foco aqui.
vi.mock('@/lib/inbox/inbox-webhook', () => ({
  handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
  handleDeliveryStatus: vi.fn(async () => {}),
}))

import type { Flow, Step } from '@/lib/builder/flow/types'
import type { WorkflowSettings } from '@/lib/builder/workflow-settings'
import type { Row } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
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
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  TEST_PHONES,
  TRIGGER_NODE_ID,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

const ANA = TEST_PHONES.ana // +5511999990001 (ct_ana)
const BRUNO = TEST_PHONES.bruno // +5511999990002 (ct_bruno)
const CARLA = TEST_PHONES.carla // +5521988880003 (sem contato)

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
})
afterEach(() => teardownWorkflowTest())

/** Fluxo "Sem gatilho" (o caso de uso típico da inscrição manual). */
function noneFlow(id: string, root?: Step | null): Flow {
  return makeFlow({
    id,
    name: `Fluxo ${id}`,
    trigger: triggers.none(),
    root: root === undefined ? steps.whatsapp({ id: `${id}-msg`, message: `Olá de ${id}` }) : root,
  })
}

const publishNone = (id: string, o: { settings?: WorkflowSettings; root?: Step | null } = {}) =>
  publishFlow(h.db, noneFlow(id, o.root), { settings: o.settings })

const enrollments = (workflowId?: string) =>
  h.db.rows('workflow_enrollments').filter((r) => !workflowId || r.workflow_id === workflowId)

function seedEnrollment(o: { workflowId: string; phone: string; status: string }): Row {
  const [row] = h.db.insert('workflow_enrollments', {
    workflow_id: o.workflowId,
    version_id: 'v-antiga',
    phone: o.phone,
    status: o.status,
    wait_kind: 'delay',
    resume_at: new Date().toISOString(),
    resume_node_ids: ['n1'],
  })
  return row
}

const textsTo = (phone: string) => h.meta.sentTo(phone).map((m) => m.text ?? m.interactiveText)

// ─── Validações ────────────────────────────────────────────────────────────────

describe('EN-01: validações de entrada e de estado', () => {
  it('body vazio, listas vazias ou JSON inválido → 400 "Informe contactIds ou phones"', async () => {
    await publishNone('wf-a')
    for (const body of [{}, { contactIds: [] }, { phones: [] }, { contactIds: [''], phones: [''] }]) {
      const res = await routes.enroll('wf-a', body)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Informe contactIds ou phones' })
    }
    const mod = await import('@/app/api/builder/workflows/[workflowId]/enroll/route')
    const raw = await mod.POST(jsonRequest('/api/builder/workflows/wf-a/enroll', '{nao-e-json'), routeParams('wf-a'))
    expect(raw.status).toBe(400)
    expect(enrollments()).toEqual([])
  })

  it('workflow inexistente → 404', async () => {
    const res = await routes.enroll('wf-nao-existe', { contactIds: [SEED_IDS.contacts.ana] })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Workflow não encontrado' })
  })

  it('workflow em rascunho (nunca publicado) → 409 e nada é inscrito', async () => {
    await seedPublishedFlow(h.db, noneFlow('wf-rascunho'), { publish: false })
    const res = await routes.enroll('wf-rascunho', { contactIds: [SEED_IDS.contacts.ana] })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Publique o workflow antes de adicionar contatos' })
    expect(enrollments()).toEqual([])
  })

  it('publicado sem nenhum passo depois do gatilho → 409', async () => {
    await seedPublishedFlow(h.db, noneFlow('wf-vazio', null))
    const res = await routes.enroll('wf-vazio', { contactIds: [SEED_IDS.contacts.ana] })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'O fluxo não tem passos após o gatilho' })
  })

  it('contatos inexistentes ou sem telefone → 400 "Nenhum telefone válido"', async () => {
    await publishNone('wf-a')
    h.db.insert('contacts', { id: 'ct_sem_fone', name: 'Sem fone', phone: '' })
    const res = await routes.enroll('wf-a', { contactIds: ['ct_nao_existe', 'ct_sem_fone'] })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Nenhum telefone válido nos contatos informados' })
    expect(enrollments()).toEqual([])
  })
})

// ─── Inscrição ─────────────────────────────────────────────────────────────────

describe('Inscrição de contatos', () => {
  it('EN-02: 1 contato grava o enrollment completo (pontapé imediato para o drain)', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    const pub = await publishNone('wf-boas-vindas', {
      root: steps.whatsapp({ id: 'm1', message: 'Oi', next: steps.wait({ id: 'w', value: 1, unit: 'hours', next: steps.whatsapp({ id: 'm2', message: 'Tchau' }) }) }),
    })
    h.db.update('contacts', { id: SEED_IDS.contacts.ana }, { phone: '(11) 99999-0001' }) // formatado como na tela

    const res = await routes.enroll('wf-boas-vindas', { contactIds: [SEED_IDS.contacts.ana] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, requested: 1, enrolled: 1, alreadyActive: 0, blockedByReentry: 0 })
    const heads = headsAfterTrigger(pub)
    expect(heads).toEqual(['m1'])
    const [row] = enrollments('wf-boas-vindas')
    expect(row).toMatchObject({
      workflow_id: 'wf-boas-vindas',
      version_id: pub.versionId,
      phone: ANA,
      contact_id: SEED_IDS.contacts.ana,
      status: 'waiting',
      wait_kind: 'enroll', // pontapé da inscrição: o Stop on Response não cancela
      current_node_id: 'm1',
      resume_node_ids: ['m1'],
      resume_at: '2026-10-18T12:00:00.000Z',
      variables: {},
      resolved_nodes: [TRIGGER_NODE_ID],
      attempts: 0,
    })
    expect(row.outputs).toEqual({
      [TRIGGER_NODE_ID]: {
        label: 'Gatilho',
        data: { triggered: true, enrolledManually: true, from: ANA, to: ANA, message: '' },
      },
    })
    // Nada é enviado na hora: o envio é do drain (~25/min).
    expect(h.meta.sent).toEqual([])
  })

  it('EN-03: vários contatos + telefones avulsos, com dedupe pelo telefone normalizado', async () => {
    await publishNone('wf-a')
    h.db.insert('contacts', { id: 'ct_ana_dup', name: 'Ana (duplicada)', phone: '+55 (11) 99999-0001' })
    const res = await routes.enroll('wf-a', {
      contactIds: [SEED_IDS.contacts.ana, SEED_IDS.contacts.bruno, 'ct_ana_dup', 'ct_inexistente'],
      phones: [CARLA, '5511999990002', '(21) 98888-0003'],
    })
    expect(res.body).toEqual({ success: true, requested: 3, enrolled: 3, alreadyActive: 0, blockedByReentry: 0 })
    const rows = enrollments('wf-a')
    expect(rows.map((r) => r.phone).sort()).toEqual([ANA, BRUNO, CARLA].sort())
    // telefone avulso sem contato fica com contact_id null; o duplicado do contato mantém um id de contato
    expect(rows.find((r) => r.phone === CARLA)?.contact_id).toBeNull()
    expect(rows.find((r) => r.phone === BRUNO)?.contact_id).toBe(SEED_IDS.contacts.bruno)
    expect([SEED_IDS.contacts.ana, 'ct_ana_dup']).toContain(rows.find((r) => r.phone === ANA)?.contact_id)
  })

  it('só telefones (sem contactIds) também inscreve', async () => {
    await publishNone('wf-a')
    const res = await routes.enroll('wf-a', { phones: ['+5521988880003'] })
    expect(res.body).toMatchObject({ requested: 1, enrolled: 1 })
    expect(enrollments('wf-a')[0]).toMatchObject({ phone: CARLA, contact_id: null })
  })

  it('EN-04: raiz em Condição → todos os heads (inclusive o "None") viram resume_node_ids', async () => {
    const pub = await publishNone('wf-cond', {
      root: steps.condition({
        id: 'cond',
        branches: [
          { label: 'Sim', value: 'sim', child: steps.whatsapp({ message: 'S' }) },
          { label: 'Não', value: 'não', child: steps.whatsapp({ message: 'N' }) },
        ],
        none: steps.whatsapp({ message: 'outro' }),
      }),
    })
    const heads = headsAfterTrigger(pub)
    expect(heads.length).toBeGreaterThanOrEqual(3)
    await routes.enroll('wf-cond', { contactIds: [SEED_IDS.contacts.ana] })
    const [row] = enrollments('wf-cond')
    expect(row.resume_node_ids).toEqual(heads)
    expect(row.current_node_id).toBe(heads[0])
  })

  it('fluxo com gatilho Palavras-chave também aceita inscrição manual (o drain não aplica o gate)', async () => {
    await publishFlow(h.db, makeFlow({ id: 'wf-kw', root: steps.whatsapp({ message: 'Bem-vindo' }) }))
    expect((await routes.enroll('wf-kw', { contactIds: [SEED_IDS.contacts.ana] })).body).toMatchObject({ enrolled: 1 })
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(textsTo(ANA)).toEqual(['Bem-vindo'])
  })

  it('EN-05: quem está ativo (waiting/active) não é reinscrito; quem completou/falhou/cancelou entra de novo', async () => {
    await publishNone('wf-a')
    seedEnrollment({ workflowId: 'wf-a', phone: ANA, status: 'waiting' })
    seedEnrollment({ workflowId: 'wf-a', phone: BRUNO, status: 'active' })
    seedEnrollment({ workflowId: 'wf-a', phone: CARLA, status: 'completed' })
    seedEnrollment({ workflowId: 'wf-a', phone: '+5511977770004', status: 'cancelled' })
    seedEnrollment({ workflowId: 'wf-outro', phone: '+5511977770005', status: 'waiting' }) // outro fluxo não conta

    const res = await routes.enroll('wf-a', { phones: [ANA, BRUNO, CARLA, '+5511977770004', '+5511977770005'] })

    expect(res.body).toEqual({ success: true, requested: 5, enrolled: 3, alreadyActive: 2, blockedByReentry: 0 })
    expect(enrollments('wf-a').filter((r) => r.status === 'waiting').map((r) => r.phone).sort()).toEqual(
      [ANA, CARLA, '+5511977770004', '+5511977770005'].sort()
    )
  })

  it('reinscrever o mesmo contato duas vezes seguidas não duplica a inscrição ativa', async () => {
    await publishNone('wf-a')
    await routes.enroll('wf-a', { contactIds: [SEED_IDS.contacts.ana] })
    const second = await routes.enroll('wf-a', { contactIds: [SEED_IDS.contacts.ana] })
    expect(second.body).toMatchObject({ requested: 1, enrolled: 0, alreadyActive: 1 })
    expect(enrollments('wf-a')).toHaveLength(1)
  })

  it('EN-06: "Permitir reentrada" desligado bloqueia quem já participou (qualquer status)', async () => {
    await publishNone('wf-a', { settings: { allowReentry: false } })
    seedEnrollment({ workflowId: 'wf-a', phone: ANA, status: 'completed' })
    seedEnrollment({ workflowId: 'wf-a', phone: BRUNO, status: 'failed' })

    const res = await routes.enroll('wf-a', { phones: [ANA, BRUNO, CARLA] })

    expect(res.body).toEqual({ success: true, requested: 3, enrolled: 1, alreadyActive: 0, blockedByReentry: 2 })
    expect(enrollments('wf-a').filter((r) => r.status === 'waiting').map((r) => r.phone)).toEqual([CARLA])
  })

  it('reentrada padrão (ligada): quem completou entra de novo', async () => {
    await publishNone('wf-a')
    seedEnrollment({ workflowId: 'wf-a', phone: ANA, status: 'completed' })
    expect((await routes.enroll('wf-a', { phones: [ANA] })).body).toMatchObject({ enrolled: 1, blockedByReentry: 0 })
  })

  // Corrigido BUG(enroll-contadores): com reentrada desligada, o select de "já participou" (qualquer status)
  // também pega quem está ATIVO, então o mesmo telefone conta em blockedByReentry E em
  // alreadyActive; o toast de useContacts mostra números que não fecham (requested < soma).
  // enroll/route.ts:103-124,181-187.
  it('enroll-contadores: contato já ativo não deveria contar também como bloqueado por reentrada', async () => {
    await publishNone('wf-a', { settings: { allowReentry: false } })
    seedEnrollment({ workflowId: 'wf-a', phone: ANA, status: 'waiting' })
    const res = await routes.enroll('wf-a', { phones: [ANA] })
    const body = res.body as { requested: number; enrolled: number; alreadyActive: number; blockedByReentry: number }
    expect(body.enrolled + body.alreadyActive + body.blockedByReentry).toBe(body.requested)
  })

  it('EN-08: corrida com o UNIQUE parcial (contato entrou entre o filtro e o insert) → lote cai no linha a linha e os outros entram', async () => {
    await publishNone('wf-a')
    const off = h.db.onBefore(
      (ctx) => {
        off() // só na 1ª tentativa (o lote); os retries linha a linha seguem normais
        ctx.db.insert('workflow_enrollments', {
          workflow_id: 'wf-a',
          version_id: 'v-corrida',
          phone: BRUNO,
          status: 'waiting',
          wait_kind: 'delay',
          resume_at: new Date().toISOString(),
        })
      },
      { table: 'workflow_enrollments', op: 'insert' }
    )

    const res = await routes.enroll('wf-a', { phones: [ANA, BRUNO, CARLA] })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, requested: 3, enrolled: 2, alreadyActive: 0 })
    const active = enrollments('wf-a').filter((r) => r.status === 'waiting')
    expect(active.map((r) => r.phone).sort()).toEqual([ANA, BRUNO, CARLA].sort())
    expect(active.filter((r) => r.phone === BRUNO)).toHaveLength(1) // sem duplicata ativa
  })

  it('erro de banco no lote (não-UNIQUE) também cai no linha a linha', async () => {
    await publishNone('wf-a')
    h.db.failNext('workflow_enrollments', 'statement timeout', { op: 'insert', code: '57014' })
    const res = await routes.enroll('wf-a', { phones: [ANA, BRUNO] })
    expect(res.body).toMatchObject({ requested: 2, enrolled: 2 })
  })

  // Corrigido BUG(enroll-optout): o enroll seleciona só id/phone, sem olhar contacts.status 'Opt-out' nem
  // phone_suppressions ativas (getActiveSuppressionsByPhone existe em lib/phone-suppressions.ts), e
  // nem o drain nem os passos de envio checam: quem pediu para sair recebe o fluxo. O disparo de
  // campanhas respeita a supressão; o workflow não. enroll/route.ts:79-99,127-157.
  it('enroll-optout: contato Opt-out ou com supressão ativa não deveria ser inscrito', async () => {
    await publishNone('wf-a')
    h.db.update('contacts', { id: SEED_IDS.contacts.ana }, { status: 'Opt-out' })
    h.db.insert('phone_suppressions', { phone: BRUNO, is_active: true, source: 'inbound_keyword', reason: 'PARAR' })
    h.db.insert('contacts', { id: 'ct_carla', name: 'Carla', phone: CARLA })

    const res = await routes.enroll('wf-a', { contactIds: [SEED_IDS.contacts.ana, SEED_IDS.contacts.bruno, 'ct_carla'] })

    expect(res.status).toBe(200)
    expect(enrollments('wf-a').map((r) => r.phone)).toEqual([CARLA])
  })

  it('BUG(enroll-optout) ponta a ponta: contato suprimido não deveria receber a mensagem do fluxo', async () => {
    await publishNone('wf-a')
    h.db.insert('phone_suppressions', { phone: ANA, is_active: true, source: 'inbound_keyword', reason: 'PARAR' })
    await routes.enroll('wf-a', { contactIds: [SEED_IDS.contacts.ana] })
    await routes.drain()
    expect(h.meta.sentTo(ANA)).toEqual([])
  })

  // Corrigido BUG(enroll-telefone-invalido): normalizePhoneNumber devolve o número "limpo" quando não
  // consegue validar, e o enroll aceita qualquer string não vazia: "123" vira uma inscrição que
  // o drain vai tentar enviar (e a Meta rejeitar). enroll/route.ts:90-93; lib/phone-formatter.ts.
  it('enroll-telefone-invalido: telefone inválido ("123") não deveria ser inscrito', async () => {
    await publishNone('wf-a')
    const res = await routes.enroll('wf-a', { phones: ['123'] })
    expect(res.status).toBe(400)
    expect(enrollments('wf-a')).toEqual([])
  })
})

// ─── Ponta a ponta: inscrição → drain do pg_cron → envio ───────────────────────

describe('EN-10: inscrição → drain (pg_cron) → passos executados', () => {
  it('drain retoma do 1º passo, pausa no Aguardar e completa depois; cada contato recebe a sua mensagem', async () => {
    freezeTime('2026-10-18T12:00:00.000Z')
    await publishNone('wf-nutricao', {
      root: steps.whatsapp({
        id: 'm1',
        message: 'Primeira',
        next: steps.wait({ id: 'w', value: 30, unit: 'minutes', next: steps.whatsapp({ id: 'm2', message: 'Segunda' }) }),
      }),
    })
    const res = await routes.enroll('wf-nutricao', { contactIds: [SEED_IDS.contacts.ana, SEED_IDS.contacts.bruno] })
    expect(res.body).toMatchObject({ enrolled: 2 })

    expect(await routes.drain()).toMatchObject({ claimed: 2, paused: 2, failed: 0 })
    expect(textsTo(ANA)).toEqual(['Primeira'])
    expect(textsTo(BRUNO)).toEqual(['Primeira'])
    for (const row of enrollments('wf-nutricao')) {
      expect(row).toMatchObject({ status: 'waiting', resume_node_ids: ['m2'], resume_at: '2026-10-18T12:30:00.000Z' })
      expect(row.resolved_nodes).toEqual(expect.arrayContaining([TRIGGER_NODE_ID, 'm1']))
    }

    // Antes da hora nada sai.
    advanceTime(10 * 60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 0 })

    advanceTime(25 * 60_000)
    expect(await routes.drain()).toMatchObject({ claimed: 2, completed: 2 })
    expect(textsTo(ANA)).toEqual(['Primeira', 'Segunda'])
    expect(textsTo(BRUNO)).toEqual(['Primeira', 'Segunda'])
    expect(enrollments('wf-nutricao').map((r) => r.status)).toEqual(['completed', 'completed'])
    expect(h.db.rows('workflow_runs').every((r) => r.trigger_type === 'DelayResume')).toBe(true)
  })

  it('a referência ao gatilho ({{@__trigger:Gatilho.from}}) resolve pelo snapshot gravado na inscrição', async () => {
    await publishNone('wf-eco', { root: steps.whatsapp({ id: 'm', message: 'Seu número: {{@__trigger:Gatilho.from}}' }) })
    await routes.enroll('wf-eco', { contactIds: [SEED_IDS.contacts.ana] })
    await routes.drain()
    expect(textsTo(ANA)).toEqual([`Seu número: ${ANA}`])
  })

  it('erro da Meta no envio (131026, número sem WhatsApp) não deixa o enrollment preso em active', async () => {
    await publishNone('wf-a')
    h.meta.failNext(131026)
    await routes.enroll('wf-a', { contactIds: [SEED_IDS.contacts.ana] })
    await routes.drain()
    const [row] = enrollments('wf-a')
    expect(['completed', 'failed', 'waiting']).toContain(row.status)
    expect(row.status).not.toBe('active')
  })

  it('inscrição → Perguntar → resposta pelo webhook (botão) retoma a conversa e segue o ramo', async () => {
    await publishNone('wf-menu', {
      root: steps.interactive({
        id: 'ask',
        message: 'Quer a proposta?',
        buttons: [
          { label: 'Sim', child: steps.whatsapp({ id: 'yes', message: 'Proposta enviada' }) },
          { label: 'Não', child: steps.whatsapp({ id: 'no', message: 'Ok, até mais' }) },
        ],
      }),
    })
    await routes.enroll('wf-menu', { contactIds: [SEED_IDS.contacts.ana] })
    expect(await routes.drain()).toMatchObject({ claimed: 1, completed: 1 })
    expect(textsTo(ANA)).toEqual(['Quer a proposta?'])
    const conversation = h.db.row('workflow_conversations', { workflow_id: 'wf-menu' })
    expect(conversation).toMatchObject({ status: 'waiting', phone: ANA })

    const res = await routes.webhook(metaWebhookBody({ messages: [metaInbound.interactiveButton({ from: ANA, title: 'Sim' })] }))
    expect(res.status).toBe(200)
    await flushSelfInvokes()
    expect(textsTo(ANA)).toEqual(['Quer a proposta?', 'Proposta enviada'])
    expect(h.db.row('workflow_conversations', { id: conversation!.id as string })?.status).toBe('completed')
  })

  // Corrigido BUG(pendente-nono-digito): a conversa do Perguntar de um fluxo inscrito manualmente é salva com
  // o telefone do CONTATO (com o 9). Se a Meta manda o wa_id legado sem o 9, getPendingConversation
  // (eq exato) não acha a conversa e a resposta se perde. workflow-conversations.ts:50-65.
  it('pendente-nono-digito: resposta pelo wa_id sem o 9 deveria retomar a pergunta do fluxo inscrito', async () => {
    h.db.update('contacts', { id: SEED_IDS.contacts.ana }, { phone: '+5511988887777' })
    await publishNone('wf-menu', {
      root: steps.interactive({
        id: 'ask',
        message: 'Quer a proposta?',
        buttons: [{ label: 'Sim', child: steps.whatsapp({ id: 'yes', message: 'Proposta enviada' }) }],
      }),
    })
    await routes.enroll('wf-menu', { contactIds: [SEED_IDS.contacts.ana] })
    await routes.drain()
    await routes.webhook(metaWebhookBody({ messages: [metaInbound.interactiveButton({ from: '+551188887777', title: 'Sim' })] }))
    await flushSelfInvokes()
    expect(h.meta.sent.map((m) => m.text ?? m.interactiveText)).toContain('Proposta enviada')
  })
})
