import { beforeEach, describe, expect, it, vi } from 'vitest'

type BroadcastHandler = (message: unknown) => void
type StatusHandler = (status: string) => void

interface FakeChannel {
  topic: string
  params: unknown
  broadcastHandlers: Array<{ event: string; handler: BroadcastHandler }>
  otherBindings: string[]
  statusHandler: StatusHandler | null
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

const channels: FakeChannel[] = []

function makeChannel(topic: string, params: unknown): FakeChannel {
  const channel: FakeChannel = {
    topic,
    params,
    broadcastHandlers: [],
    otherBindings: [],
    statusHandler: null,
    on: vi.fn(),
    subscribe: vi.fn(),
  }
  channel.on.mockImplementation((type: string, filter: { event?: string }, handler: BroadcastHandler) => {
    if (type === 'broadcast') channel.broadcastHandlers.push({ event: filter?.event ?? '*', handler })
    else channel.otherBindings.push(type)
    return channel
  })
  channel.subscribe.mockImplementation((cb?: StatusHandler) => {
    channel.statusHandler = cb ?? null
    return channel
  })
  return channel
}

const fakeClient = {
  channel: vi.fn((topic: string, params?: unknown) => {
    const channel = makeChannel(topic, params)
    channels.push(channel)
    return channel
  }),
  removeChannel: vi.fn(),
}

let supabaseConfigured = true

vi.mock('@/lib/supabase', () => ({
  getSupabaseBrowser: () => (supabaseConfigured ? fakeClient : null),
}))
vi.mock('./supabase', () => ({
  getSupabaseBrowser: () => (supabaseConfigured ? fakeClient : null),
}))

import {
  __resetDbChangesHubForTests,
  createRealtimeChannel,
  onDbChangesStatus,
  removeChannel,
  subscribeToDbChanges,
  subscribeToTable,
} from '@/lib/supabase-realtime'
import type { RealtimeChannel } from '@supabase/supabase-js'

function dbChannel(): FakeChannel {
  const found = channels.find((c) => c.topic === 'dispara-db')
  if (!found) throw new Error('canal dispara-db não criado')
  return found
}

function emit(payload: Record<string, unknown>) {
  const channel = dbChannel()
  for (const { event, handler } of channel.broadcastHandlers) {
    if (event === 'db_change') handler({ type: 'broadcast', event: 'db_change', payload })
  }
}

beforeEach(() => {
  __resetDbChangesHubForTests()
  channels.length = 0
  fakeClient.channel.mockClear()
  fakeClient.removeChannel.mockClear()
  supabaseConfigured = true
})

describe('hub de mudanças do banco (broadcast dispara-db)', () => {
  it('cria UM canal público dispara-db, ouvindo só broadcast db_change (sem postgres_changes)', () => {
    const offA = subscribeToDbChanges(vi.fn())
    const offB = subscribeToDbChanges(vi.fn(), { table: 'campaigns' })

    const dbChannels = channels.filter((c) => c.topic === 'dispara-db')
    expect(dbChannels).toHaveLength(1)
    expect(dbChannels[0].params).toEqual({ config: { private: false } })
    expect(dbChannels[0].broadcastHandlers.map((b) => b.event)).toEqual(['db_change'])
    expect(dbChannels[0].otherBindings).toEqual([])
    expect(dbChannels[0].subscribe).toHaveBeenCalledTimes(1)

    offA()
    offB()
    // O canal compartilhado nunca é removido (evita a corrida de removeChannel assíncrono)
    expect(fakeClient.removeChannel).not.toHaveBeenCalled()
  })

  it('entrega por tabela, tipo de evento e filtro', () => {
    const all = vi.fn()
    const campaigns = vi.fn()
    const campaignUpdates = vi.fn()
    const oneCampaign = vi.fn()

    subscribeToDbChanges(all)
    subscribeToDbChanges(campaigns, { table: 'campaigns' })
    subscribeToDbChanges(campaignUpdates, { table: 'campaigns', event: 'UPDATE' })
    subscribeToDbChanges(oneCampaign, { table: 'campaigns', filter: 'id=eq.c_2' })

    emit({ table: 'campaigns', eventType: 'INSERT', new: { id: 'c_1', status: 'Rascunho' }, old: null })
    emit({ table: 'campaigns', eventType: 'UPDATE', new: { id: 'c_2', status: 'Enviando' }, old: { id: 'c_2' } })
    emit({ table: 'contacts', eventType: 'INSERT', new: null, old: null })

    expect(all).toHaveBeenCalledTimes(3)
    expect(campaigns).toHaveBeenCalledTimes(2)
    expect(campaignUpdates).toHaveBeenCalledTimes(1)
    expect(oneCampaign).toHaveBeenCalledTimes(1)
    expect(oneCampaign.mock.calls[0][0]).toMatchObject({ table: 'campaigns', eventType: 'UPDATE', new: { id: 'c_2' } })
  })

  it('descarta mensagens fora do contrato', () => {
    const listener = vi.fn()
    subscribeToDbChanges(listener)

    emit({ table: 'attendant_tokens', eventType: 'INSERT', new: { id: 'x' }, old: null })
    emit({ table: 'campaigns', eventType: 'HACK', new: { id: 'x' }, old: null })
    emit({ table: 'campaigns', eventType: 'INSERT', new: 'oops', old: null })

    expect(listener).not.toHaveBeenCalled()
  })

  it('isola erro de um listener', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    subscribeToDbChanges(broken)
    subscribeToDbChanges(ok)

    emit({ table: 'flows', eventType: 'UPDATE', new: { id: 'fl_1' }, old: { id: 'fl_1' } })

    expect(ok).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('cancelar a assinatura para de entregar', () => {
    const listener = vi.fn()
    const off = subscribeToDbChanges(listener)
    off()
    emit({ table: 'templates', eventType: 'UPDATE', new: { id: 't' }, old: { id: 't' } })
    expect(listener).not.toHaveBeenCalled()
  })

  it('sem Supabase configurado devolve no-op e não cria canal', () => {
    supabaseConfigured = false
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const off = subscribeToDbChanges(vi.fn())
    expect(typeof off).toBe('function')
    expect(channels).toHaveLength(0)
    off()
    warnSpy.mockRestore()
  })

  it('propaga o status do canal compartilhado', () => {
    const statuses: string[] = []
    subscribeToDbChanges(vi.fn())
    onDbChangesStatus((s) => statuses.push(s))

    dbChannel().statusHandler?.('SUBSCRIBED')
    expect(statuses).toEqual(['SUBSCRIBED'])

    // Quem chega depois recebe o status atual na hora
    const late: string[] = []
    onDbChangesStatus((s) => late.push(s))
    expect(late).toEqual(['SUBSCRIBED'])
  })
})

describe('subscribeToTable (compat com os hooks)', () => {
  it('mapeia o broadcast para RealtimePayload e respeita o filtro', () => {
    const channel = createRealtimeChannel('rq-test') as unknown as RealtimeChannel
    const callback = vi.fn()

    subscribeToTable(channel, 'inbox_messages', 'INSERT', callback, 'conversation_id=eq.conv1')

    emit({
      table: 'inbox_messages',
      eventType: 'INSERT',
      new: { id: 'm1', conversation_id: 'conv2', direction: 'inbound' },
      old: null,
    })
    emit({
      table: 'inbox_messages',
      eventType: 'INSERT',
      new: { id: 'm2', conversation_id: 'conv1', direction: 'inbound' },
      old: null,
      commit_timestamp: '2026-10-11T10:00:00Z',
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      schema: 'public',
      table: 'inbox_messages',
      commit_timestamp: '2026-10-11T10:00:00Z',
      eventType: 'INSERT',
      new: { id: 'm2', conversation_id: 'conv1', direction: 'inbound' },
      old: null,
      errors: null,
    })

    // Não adiciona postgres_changes no canal do consumidor
    const own = channels.find((c) => c.topic === 'rq-test')!
    expect(own.otherBindings).toEqual([])
  })

  it('removeChannel cancela as assinaturas feitas com aquele canal', () => {
    const channelA = createRealtimeChannel('a') as unknown as RealtimeChannel
    const channelB = createRealtimeChannel('b') as unknown as RealtimeChannel
    const cbA = vi.fn()
    const cbB = vi.fn()

    subscribeToTable(channelA, 'campaigns', '*', cbA)
    subscribeToTable(channelA, 'campaigns', 'UPDATE', cbA)
    subscribeToTable(channelB, 'campaigns', '*', cbB)

    removeChannel(channelA)
    expect(fakeClient.removeChannel).toHaveBeenCalledWith(channelA)

    emit({ table: 'campaigns', eventType: 'UPDATE', new: { id: 'c' }, old: { id: 'c' } })
    expect(cbA).not.toHaveBeenCalled()
    expect(cbB).toHaveBeenCalledTimes(1)
  })
})
