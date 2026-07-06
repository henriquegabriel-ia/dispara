import { NextRequest, NextResponse } from 'next/server'

/**
 * Autenticação das chamadas de cron.
 *
 * Substitui a verificação de assinatura `upstash-signature` que existia enquanto o
 * disparo era orquestrado pelo QStash. O relógio do Dispara agora é o pg_cron do
 * Supabase (via pg_net), que lê o `cron_secret` do Supabase Vault e o envia no header.
 *
 * Aceita, nesta ordem:
 *  - header `x-vercel-cron`            → Vercel Cron nativo (caso o deploy também use)
 *  - Authorization: Bearer <CRON_SECRET>      → pg_cron / auto-reinvocação
 *  - Authorization: Bearer <DISPARA_ADMIN_KEY> → disparo manual do admin
 *
 * Fail-closed: sem header válido, nega. Comparação em tempo constante pra não vazar
 * o segredo por timing.
 */

export interface CronAuthResult {
  valid: boolean
  source?: 'vercel_cron' | 'cron_secret' | 'admin_key'
  error?: string
}

/** Comparação de strings em tempo constante (evita timing-attack no segredo). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export function verifyCronRequest(request: NextRequest): CronAuthResult {
  // Vercel Cron injeta este header automaticamente em jobs nativos.
  if (request.headers.get('x-vercel-cron')) {
    return { valid: true, source: 'vercel_cron' }
  }

  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

  if (bearer) {
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && safeEqual(bearer, cronSecret)) {
      return { valid: true, source: 'cron_secret' }
    }
    const adminKey = process.env.DISPARA_ADMIN_KEY
    if (adminKey && safeEqual(bearer, adminKey)) {
      return { valid: true, source: 'admin_key' }
    }
  }

  return { valid: false, error: 'Chamada de cron não autenticada' }
}

export function cronUnauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: 'Unauthorized', message }, { status: 401 })
}
