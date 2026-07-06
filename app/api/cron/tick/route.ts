import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest, cronUnauthorizedResponse } from '@/lib/cron-auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { reconcilePendingStatusEvents } from '@/lib/whatsapp-status-events'

/**
 * Endpoint-relógio do Dispara.
 *
 * Chamado pelo pg_cron do Supabase (via pg_net) a cada minuto — e/ou pela
 * auto-reinvocação dos workers. É o ponto único onde as fases da migração
 * QStash→pg_cron plugam suas varreduras:
 *   - Fase B: reconcile de status de webhook pendentes
 *   - Fase C: disparo de campanhas agendadas vencidas
 *   - Fase D: drain de waits duráveis de fluxo (workflow_enrollments)
 *   - Fase F: sweeper/reaper do disparo em massa
 *
 * FASE A: stub. Só valida a autenticação de cron e responde qual orquestração fará.
 * Nenhuma varredura plugada ainda — não muda comportamento de produção.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(request: NextRequest) {
  const auth = verifyCronRequest(request)
  if (!auth.valid) {
    return cronUnauthorizedResponse(auth.error)
  }

  const ran: Array<{ task: string; result: unknown }> = []

  if (isSupabaseConfigured()) {
    // Fase B: reconcile de eventos de status de webhook pendentes (unmatched/error).
    // Substitui o retry de 60s que o QStash fazia — best-effort, nunca derruba o tick.
    try {
      const result = await reconcilePendingStatusEvents({ limit: 200 })
      ran.push({ task: 'reconcile-status-events', result })
    } catch (e) {
      ran.push({
        task: 'reconcile-status-events',
        result: { error: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  return NextResponse.json({
    ok: true,
    tick: 'dispara-cron-tick',
    authSource: auth.source,
    ran,
    ts: new Date().toISOString(),
  })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

// GET permite um healthcheck manual autenticado do relógio.
export async function GET(request: NextRequest) {
  return handle(request)
}
