import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase-realtime', () => ({
  createRealtimeChannel: vi.fn(() => null),
  subscribeToTable: vi.fn(),
  activateChannel: vi.fn(() => Promise.resolve()),
  removeChannel: vi.fn(),
}))

import { pickMessageStatusUpdate } from '@/hooks/useConversation'

describe('pickMessageStatusUpdate (payload realtime de inbox_messages)', () => {
  it('extrai só o status de entrega', () => {
    expect(
      pickMessageStatusUpdate({
        id: 'm1',
        conversation_id: 'conv1',
        direction: 'outbound',
        delivery_status: 'read',
        read_at: '2026-10-11T10:00:00Z',
      })
    ).toEqual({ id: 'm1', conversation_id: 'conv1', patch: { delivery_status: 'read' } })
  })

  it('nunca repassa outros campos (ex.: conteúdo forjado no canal público)', () => {
    const update = pickMessageStatusUpdate({
      id: 'm1',
      conversation_id: 'conv1',
      delivery_status: 'delivered',
      content: '<img src=x onerror=alert(1)>',
      media_url: 'https://evil.example/x.png',
    })
    expect(update?.patch).toEqual({ delivery_status: 'delivered' })
  })

  it('ignora status desconhecido ou ids ausentes', () => {
    expect(pickMessageStatusUpdate({ id: 'm1', conversation_id: 'c', delivery_status: 'hacked' })).toBeNull()
    expect(pickMessageStatusUpdate({ conversation_id: 'c', delivery_status: 'read' })).toBeNull()
    expect(pickMessageStatusUpdate({ id: 'm1', delivery_status: 'read' })).toBeNull()
    expect(pickMessageStatusUpdate(null)).toBeNull()
  })
})
