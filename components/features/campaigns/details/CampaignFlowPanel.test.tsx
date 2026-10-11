import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { DbChangeEvent } from '@/lib/realtime-db-change'
import type { Campaign } from '@/types'

type Listener = (event: DbChangeEvent) => void
const subscriptions: Array<{ listener: Listener; options: unknown }> = []
const statusCallbacks: Array<(status: string) => void> = []
const unsubscribe = vi.fn()

vi.mock('@/lib/supabase-realtime', () => ({
  subscribeToDbChanges: vi.fn((listener: Listener, options: unknown) => {
    subscriptions.push({ listener, options })
    return unsubscribe
  }),
  onDbChangesStatus: vi.fn((cb: (status: string) => void) => {
    statusCallbacks.push(cb)
    return vi.fn()
  }),
}))

vi.mock('@/components/ui/PrefetchLink', () => ({
  PrefetchLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

import { CampaignFlowPanel } from '@/components/features/campaigns/details/CampaignFlowPanel'

function makeCampaign(overrides: Partial<Campaign>): Campaign {
  return {
    id: 'c_1',
    name: 'Campanha',
    recipients: 10,
    submissionsCount: 2,
    flowId: 'fl_1',
    flowName: 'Cadastro',
    ...overrides,
  } as Campaign
}

beforeEach(() => {
  subscriptions.length = 0
  statusCallbacks.length = 0
  unsubscribe.mockClear()
})

describe('CampaignFlowPanel realtime', () => {
  it('assina INSERT de flow_submissions da campanha via broadcast e incrementa o contador', () => {
    render(<CampaignFlowPanel campaign={makeCampaign({})} />)

    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0].options).toEqual({
      table: 'flow_submissions',
      event: 'INSERT',
      filter: 'campaign_id=eq.c_1',
    })
    expect(screen.getByText('2')).toBeTruthy()

    act(() => {
      subscriptions[0].listener({
        table: 'flow_submissions',
        eventType: 'INSERT',
        new: { id: 'fs_1', campaign_id: 'c_1' },
        old: null,
        commit_timestamp: null,
      })
    })
    expect(screen.getByText('3')).toBeTruthy()

    act(() => statusCallbacks[0]('SUBSCRIBED'))
    expect(screen.getByText('Ao vivo')).toBeTruthy()
  })

  it('campanha sem Flow não renderiza nem assina (hooks antes do return)', () => {
    const { container } = render(<CampaignFlowPanel campaign={makeCampaign({ flowId: undefined })} />)
    expect(container.innerHTML).toBe('')
    expect(subscriptions).toHaveLength(0)
  })

  it('cancela a assinatura ao desmontar', () => {
    const { unmount } = render(<CampaignFlowPanel campaign={makeCampaign({})} />)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
