// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Estado das perguntas pendentes (Perguntar / ask-question) — lib/builder/workflow-conversations.ts —
 * contra o Supabase em memória com o esquema real de workflow_conversations (tabela estrita).
 */

vi.mock('server-only', () => ({}))

import {
  completeConversation,
  createConversation,
  getPendingConversation,
} from '@/lib/builder/workflow-conversations'
import { createInMemorySupabase, DISPARA_SCHEMA, type InMemorySupabase } from '@/tests/helpers/in-memory-supabase'
import { advanceTime, freezeTime } from '@/tests/helpers/workflow-harness'

const ANA = '+5511999990001'
const BRUNO = '+5511999990002'

let db: InMemorySupabase
const client = () => db.client as never

beforeEach(() => {
  db = createInMemorySupabase({}, undefined, { schema: DISPARA_SCHEMA })
  freezeTime('2026-10-18T12:00:00.000Z')
})
afterEach(() => {
  vi.useRealTimers()
})

function seed(o: { id: string; phone?: string; status?: string; updatedAt: string; workflowId?: string }) {
  db.insert('workflow_conversations', {
    id: o.id,
    workflow_id: o.workflowId ?? 'wf-a',
    phone: o.phone ?? ANA,
    status: o.status ?? 'waiting',
    resume_node_id: 'ask__var',
    variable_key: 'reply_ask',
    variables: {},
    created_at: o.updatedAt,
    updated_at: o.updatedAt,
  })
}

describe('CV-01/CV-02: createConversation', () => {
  it('grava a pergunta como waiting, com id gerado e timestamps iguais, e devolve a linha', async () => {
    const created = await createConversation({
      supabase: client(),
      workflowId: 'wf-menu',
      phone: ANA,
      resumeNodeId: 'ask__var',
      variableKey: 'reply_ask',
      variables: { nome: 'Ana' },
    })

    expect(created).not.toBeNull()
    expect(typeof created!.id).toBe('string')
    expect(created!.id.length).toBeGreaterThanOrEqual(10)
    expect(created).toMatchObject({
      workflow_id: 'wf-menu',
      phone: ANA,
      status: 'waiting',
      resume_node_id: 'ask__var',
      variable_key: 'reply_ask',
      variables: { nome: 'Ana' },
      created_at: '2026-10-18T12:00:00.000Z',
      updated_at: '2026-10-18T12:00:00.000Z',
    })
    expect(db.rows('workflow_conversations')).toEqual([expect.objectContaining({ id: created!.id, status: 'waiting' })])
  })

  it('campos opcionais ausentes viram null', async () => {
    const created = await createConversation({ supabase: client(), workflowId: 'wf-menu', phone: ANA })
    expect(created).toMatchObject({ resume_node_id: null, variable_key: null, variables: null })
  })

  it('ids são únicos entre chamadas', async () => {
    const a = await createConversation({ supabase: client(), workflowId: 'wf', phone: ANA })
    const b = await createConversation({ supabase: client(), workflowId: 'wf', phone: ANA })
    expect(a!.id).not.toBe(b!.id)
  })

  it('erro do banco → null (o executor trata como falha do passo)', async () => {
    db.failNext('workflow_conversations', 'insert failed', { op: 'insert' })
    const created = await createConversation({ supabase: client(), workflowId: 'wf-menu', phone: ANA })
    expect(created).toBeNull()
    expect(db.rows('workflow_conversations')).toEqual([])
  })

  it('não grava cópia viva do objeto de variáveis (mutação posterior não vaza para o banco)', async () => {
    const variables = { a: 1 }
    await createConversation({ supabase: client(), workflowId: 'wf', phone: ANA, variables })
    variables.a = 2
    expect(db.rows('workflow_conversations')[0].variables).toEqual({ a: 1 })
  })
})

describe('CV-03: getPendingConversation', () => {
  it('devolve a waiting MAIS RECENTE do telefone; ignora completed (mesmo mais nova) e outros telefones', async () => {
    seed({ id: 'antiga', updatedAt: '2026-10-01T10:00:00.000Z' })
    seed({ id: 'recente', updatedAt: '2026-10-10T10:00:00.000Z', workflowId: 'wf-b' })
    seed({ id: 'respondida', status: 'completed', updatedAt: '2026-10-17T10:00:00.000Z' })
    seed({ id: 'do-bruno', phone: BRUNO, updatedAt: '2026-10-18T10:00:00.000Z' })

    const pending = await getPendingConversation(client(), ANA)
    expect(pending).toMatchObject({ id: 'recente', workflow_id: 'wf-b', status: 'waiting' })
    expect((await getPendingConversation(client(), BRUNO))?.id).toBe('do-bruno')
  })

  it('sem pergunta pendente → null', async () => {
    seed({ id: 'respondida', status: 'completed', updatedAt: '2026-10-17T10:00:00.000Z' })
    expect(await getPendingConversation(client(), ANA)).toBeNull()
    expect(await getPendingConversation(client(), '+5599999999999')).toBeNull()
  })

  it('erro do banco → null (o webhook segue para os gatilhos)', async () => {
    seed({ id: 'x', updatedAt: '2026-10-17T10:00:00.000Z' })
    db.failNext('workflow_conversations', 'timeout', { op: 'select' })
    expect(await getPendingConversation(client(), ANA)).toBeNull()
  })

  it('o telefone casa pelas variantes: "5511999990001" (sem +) acha a conversa de "+5511999990001"', async () => {
    seed({ id: 'x', updatedAt: '2026-10-17T10:00:00.000Z' })
    expect((await getPendingConversation(client(), '5511999990001'))?.id).toBe('x')
  })

  // Corrigido BUG(pendente-nono-digito): a busca da pergunta pendente usa as variantes do 9
  // brasileiro (lib/builder/phone-variants), como o AutoReply e o Stop on Response.
  it('pendente-nono-digito: conversa gravada com o 9 é achada pelo número sem o 9', async () => {
    seed({ id: 'com-9', phone: '+5511988887777', updatedAt: '2026-10-17T10:00:00.000Z' })
    expect((await getPendingConversation(client(), '+551188887777'))?.id).toBe('com-9')
  })

  it('DESIGN: não há expiração — uma pergunta de semanas atrás ainda é "pendente"', async () => {
    seed({ id: 'velha', updatedAt: '2026-08-01T10:00:00.000Z' })
    expect((await getPendingConversation(client(), ANA))?.id).toBe('velha')
  })
})

describe('CV-04: completeConversation', () => {
  it('encerra com as variáveis finais e atualiza updated_at; não toca outras conversas', async () => {
    seed({ id: 'alvo', updatedAt: '2026-10-17T10:00:00.000Z' })
    seed({ id: 'outra', phone: BRUNO, updatedAt: '2026-10-17T10:00:00.000Z' })
    advanceTime(5 * 60_000)

    await completeConversation(client(), 'alvo', { reply_ask: 'Sim', x: 'y' })

    expect(db.row('workflow_conversations', { id: 'alvo' })).toMatchObject({
      status: 'completed',
      variables: { reply_ask: 'Sim', x: 'y' },
      updated_at: '2026-10-18T12:05:00.000Z',
      created_at: '2026-10-17T10:00:00.000Z',
    })
    expect(db.row('workflow_conversations', { id: 'outra' })).toMatchObject({ status: 'waiting', variables: {} })
    expect(await getPendingConversation(client(), ANA)).toBeNull()
  })

  it('id inexistente não lança nem cria linha', async () => {
    await expect(completeConversation(client(), 'nao-existe', {})).resolves.toBeUndefined()
    expect(db.rows('workflow_conversations')).toEqual([])
  })

  it('DESIGN: não há CAS — completar uma conversa já completed sobrescreve as variáveis (base do BUG resume-corrida)', async () => {
    seed({ id: 'alvo', status: 'completed', updatedAt: '2026-10-17T10:00:00.000Z' })
    await completeConversation(client(), 'alvo', { reply_ask: 'segunda resposta' })
    expect(db.row('workflow_conversations', { id: 'alvo' })?.variables).toEqual({ reply_ask: 'segunda resposta' })
    const update = db.ops.filter((o) => o.table === 'workflow_conversations' && o.op === 'update').at(-1)
    expect(JSON.stringify(update?.filters)).not.toContain('status')
  })
})
