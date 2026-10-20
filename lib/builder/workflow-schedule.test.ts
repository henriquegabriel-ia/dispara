// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * lib/builder/workflow-schedule.ts — persistência do agendamento recorrente (trigger
 * "Schedule", legado). Só grava/limpa as colunas schedule_* de `workflows`; nenhum dreno do
 * cron executa o agendamento (caracterizado abaixo).
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', async () => (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
vi.mock('@/lib/self-invoke', async () => (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())

import { clearWorkflowSchedule, syncWorkflowSchedule } from '@/lib/builder/workflow-schedule'
import { drainWorkflowEnrollments } from '@/lib/cron/workflow-enrollments'
import { setActiveSupabase } from '@/tests/helpers/in-memory-supabase'
import {
  advanceTime,
  chain,
  freezeTime,
  makeFlow,
  resetWorkflowCaches,
  seedPublishedFlow,
  setupWorkflowTest,
  steps,
  teardownWorkflowTest,
  triggers,
  type WorkflowTestContext,
} from '@/tests/helpers/workflow-harness'

const T = '2026-10-19T08:59:00.000Z'

let h: WorkflowTestContext
beforeEach(async () => {
  h = setupWorkflowTest()
  await resetWorkflowCaches()
  freezeTime(T)
  await seedPublishedFlow(h.db, makeFlow({ id: 'wf-sched', trigger: triggers.none(), root: chain(steps.whatsapp({ id: 'm', message: 'Bom dia' })) }))
  await seedPublishedFlow(h.db, makeFlow({ id: 'wf-other', trigger: triggers.none(), root: chain(steps.whatsapp({ id: 'm', message: 'x' })) }))
})
afterEach(() => teardownWorkflowTest())

describe('workflow-schedule', () => {
  it('SCH-01a: syncWorkflowSchedule grava cron, fuso, ativo e updated_at só no workflow alvo', async () => {
    await syncWorkflowSchedule({ workflowId: 'wf-sched', cron: '0 9 * * *', timezone: 'America/Sao_Paulo' })
    expect(h.db.row('workflows', { id: 'wf-sched' })).toMatchObject({
      schedule_cron: '0 9 * * *',
      schedule_timezone: 'America/Sao_Paulo',
      schedule_active: true,
      schedule_updated_at: T,
    })
    expect(h.db.row('workflows', { id: 'wf-other' })).toMatchObject({ schedule_active: false })
    expect(h.db.row('workflows', { id: 'wf-other' })?.schedule_cron ?? null).toBeNull()
  })

  it('SCH-01b: sem timezone grava null; nova sincronização sobrescreve a anterior', async () => {
    await syncWorkflowSchedule({ workflowId: 'wf-sched', cron: '0 9 * * *', timezone: 'UTC' })
    advanceTime(60_000)
    await syncWorkflowSchedule({ workflowId: 'wf-sched', cron: '*/15 * * * *' })
    expect(h.db.row('workflows', { id: 'wf-sched' })).toMatchObject({
      schedule_cron: '*/15 * * * *',
      schedule_timezone: null,
      schedule_active: true,
      schedule_updated_at: '2026-10-19T09:00:00.000Z',
    })
  })

  it('SCH-01c: clearWorkflowSchedule zera cron/fuso e desativa', async () => {
    await syncWorkflowSchedule({ workflowId: 'wf-sched', cron: '0 9 * * *', timezone: 'UTC' })
    advanceTime(60_000)
    await clearWorkflowSchedule('wf-sched')
    expect(h.db.row('workflows', { id: 'wf-sched' })).toMatchObject({
      schedule_cron: null,
      schedule_timezone: null,
      schedule_active: false,
      schedule_updated_at: '2026-10-19T09:00:00.000Z',
    })
  })

  it('SCH-01d: workflow inexistente — sync e clear não criam linha nem lançam', async () => {
    const before = h.db.rows('workflows').length
    await expect(syncWorkflowSchedule({ workflowId: 'nao-existe', cron: '0 9 * * *' })).resolves.toBeUndefined()
    await expect(clearWorkflowSchedule('nao-existe')).resolves.toBeUndefined()
    expect(h.db.rows('workflows')).toHaveLength(before)
  })

  it('SCH-01e: sem Supabase — sync lança "Supabase not configured"; clear é no-op', async () => {
    setActiveSupabase(null)
    await expect(syncWorkflowSchedule({ workflowId: 'wf-sched', cron: '0 9 * * *' })).rejects.toThrow('Supabase not configured')
    await expect(clearWorkflowSchedule('wf-sched')).resolves.toBeUndefined()
    setActiveSupabase(h.db)
  })

  it('SCH-02: caracterização — nenhum dreno do cron executa o agendamento (Schedule é legado, sem execução)', async () => {
    await syncWorkflowSchedule({ workflowId: 'wf-sched', cron: '0 9 * * *', timezone: 'UTC' })
    advanceTime(60_000) // 09:00 UTC, horário do cron
    expect(await drainWorkflowEnrollments()).toMatchObject({ claimed: 0 })
    expect(h.meta.sent).toHaveLength(0)
    expect(h.db.rows('workflow_runs')).toHaveLength(0)
  })
})
