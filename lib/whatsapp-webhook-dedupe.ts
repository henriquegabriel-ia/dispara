import type { WhatsAppStatus } from '@/lib/whatsapp-status-events'
import { redis } from '@/lib/redis'

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 dias

function getTtlSeconds(): number {
  const raw = process.env.WHATSAPP_STATUS_DEDUPE_TTL_SECONDS
  const n = raw ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULT_TTL_SECONDS
  return Math.max(60, Math.min(60 * 60 * 24 * 30, Math.floor(n))) // 1 min .. 30 dias
}

/**
 * Dedupe (80/20) de status do webhook ANTES de encostar no Postgres.
 *
 * - Se Redis não estiver configurado, retorna `true` (processa normalmente).
 * - Se Redis falhar, retorna `true` (fail-open; confiabilidade > custo).
 *
 * Isso reduz MUITO a pressão no Supabase em cenários de retry/duplicatas.
 */
export async function shouldProcessWhatsAppStatusEvent(input: {
  messageId: string
  status: WhatsAppStatus
}): Promise<boolean> {
  if (!redis) return true

  const key = `wa:status:dedupe:${input.messageId}:${input.status}`
  const ttlSeconds = getTtlSeconds()

  try {
    const res = await redis.set(key, '1', { nx: true, ex: ttlSeconds })
    // Upstash retorna 'OK' quando setou; null quando já existia (NX)
    return res === 'OK'
  } catch (e) {
    console.warn('[WebhookDedupe] Redis falhou (fail-open):', e)
    return true
  }
}
