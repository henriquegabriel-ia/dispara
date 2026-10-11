import { getSupabaseAdmin } from '@/lib/supabase'
import type { AttendantPrincipal } from '@/lib/principal'
import type { AttendantPermissions } from '@/types'

/**
 * Autenticação de atendente (PWA /atendimento).
 *
 * Fluxo:
 * 1. O atendente abre /atendimento?token=<token>.
 * 2. POST /api/attendants/validate valida o token e grava o cookie httpOnly
 *    `dispara_attendant` (ATTENDANT_COOKIE_NAME).
 * 3. Daí em diante o browser manda o cookie em toda chamada; o proxy resolve o
 *    atendente aqui (resolveAttendantToken) só nas rotas com política
 *    `attendant_or_session`, e repassa o principal para a rota (lib/principal.ts).
 * 4. A rota exige a permissão certa com requireAttendantPermission().
 *
 * Revogar/desativar/expirar o token derruba o acesso em até CACHE_TTL_MS.
 */

export const ATTENDANT_COOKIE_NAME = 'dispara_attendant'
export const ATTENDANT_TOKEN_HEADER = 'x-attendant-token'

const CACHE_TTL_MS = 30_000
const NEGATIVE_CACHE_TTL_MS = 10_000
const MAX_CACHE_ENTRIES = 500
const MIN_TOKEN_LENGTH = 16
const MAX_TOKEN_LENGTH = 256

type CacheEntry = { value: AttendantPrincipal | null; expiresAt: number }

const cache = new Map<string, CacheEntry>()

function normalizePermissions(raw: unknown): AttendantPermissions {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<AttendantPermissions>
  return {
    canView: p.canView === true,
    canReply: p.canReply === true,
    canHandoff: p.canHandoff === true,
  }
}

function remember(token: string, value: AttendantPrincipal | null, now: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evicção simples: descarta o mais antigo inserido.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(token, { value, expiresAt: now + (value ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS) })
}

/** Limpa o cache (usado ao revogar/editar tokens e nos testes). */
export function clearAttendantAuthCache(): void {
  cache.clear()
}

/**
 * Resolve um token de atendente para o principal correspondente.
 * Retorna null para token ausente, malformado, inexistente, inativo ou expirado.
 */
export async function resolveAttendantToken(token: string | null | undefined): Promise<AttendantPrincipal | null> {
  if (!token) return null
  const trimmed = token.trim()
  if (trimmed.length < MIN_TOKEN_LENGTH || trimmed.length > MAX_TOKEN_LENGTH) return null

  const now = Date.now()
  const cached = cache.get(trimmed)
  if (cached && cached.expiresAt > now) return cached.value

  const supabase = getSupabaseAdmin()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('attendant_tokens')
    .select('id, name, permissions, is_active, expires_at')
    .eq('token', trimmed)
    .maybeSingle()

  if (error) {
    // Erro de banco: não cacheia (nem positivo nem negativo) e nega.
    console.error('[attendant-auth] Falha ao validar token de atendente:', error.message)
    return null
  }

  let principal: AttendantPrincipal | null = null
  if (data && data.is_active === true) {
    const expired = data.expires_at ? new Date(data.expires_at).getTime() <= now : false
    if (!expired) {
      principal = {
        id: String(data.id),
        name: String(data.name ?? ''),
        permissions: normalizePermissions(data.permissions),
      }
    }
  }

  remember(trimmed, principal, now)
  return principal
}

/** Extrai o token de atendente do cookie (preferido) ou do header X-Attendant-Token. */
export function readAttendantToken(request: {
  cookies: { get(name: string): { value: string } | undefined }
  headers: Headers
}): string | null {
  return request.cookies.get(ATTENDANT_COOKIE_NAME)?.value || request.headers.get(ATTENDANT_TOKEN_HEADER) || null
}
