/**
 * User Authentication System for Single-Tenant DaaS
 * 
 * Simple auth using MASTER_PASSWORD from environment variable
 * - No password hashing needed (password stored in Vercel env)
 * - httpOnly + Secure cookies for sessions
 * - Rate limiting for brute force protection
 * 
 * Usa Supabase (PostgreSQL) como banco de dados
 */

import { createHmac } from 'crypto'
import { cookies } from 'next/headers'
import { supabase, getSupabaseAdmin } from '@/lib/supabase'
import { timingSafeEqualString } from '@/lib/safe-compare'

// ============================================================================
// CONSTANTS
// ============================================================================

export const SESSION_COOKIE_NAME = 'dispara_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days in seconds
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes
const MAX_STORED_SESSIONS = 50

// Cache da LISTA de sessões usado pelo proxy (hot path de TODA request).
// Um flood de cookies forjados custa no máximo 1 query a cada 15s por instância.
const SESSION_LIST_CACHE_TTL_MS = 15_000
// Falha de banco também é lembrada por pouco tempo (evita martelar um Supabase fora).
const SESSION_STORE_ERROR_TTL_MS = 5_000
const MAX_SESSION_TOKEN_LENGTH = 256
const MAX_RECHECKED_TOKENS = 1_000

// Formato novo do token: `s1.<uuid>.<hmac>` (HMAC-SHA256 com a MASTER_PASSWORD).
// - Cookie forjado sem assinatura válida é rejeitado sem tocar no banco.
// - Token assinado que não está na lista em cache pode ter sido criado por OUTRA
//   instância depois da leitura (login recente) → relê a lista UMA vez por token.
// - Trocar a MASTER_PASSWORD invalida todas as sessões assinadas.
// Tokens antigos (UUID puro) continuam aceitos se estiverem na lista (compat).
const SIGNED_TOKEN_PREFIX = 's1.'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Novo formato: múltiplas sessões simultâneas (evita invalidação entre domínios/devices)
// Persistido em `settings.key = 'session_tokens'` como JSON.
type StoredSession = {
  token: string
  createdAt: string
}

// ============================================================================
// TYPES
// ============================================================================

export interface Company {
  id: string
  name: string
  email: string
  phone: string
  createdAt: string
}

export interface UserAuthResult {
  success: boolean
  error?: string
  company?: Company
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Upsert a setting in the database
 */
async function upsertSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: now }, { onConflict: 'key' })

  if (error) {
    // Não silencie erros de permissão/RLS — isso causa loops e estados falsos.
    throw new Error(`Falha ao salvar setting "${key}": ${error.message}`)
  }
}

/**
 * Get a setting from the database
 */
async function getSetting(key: string): Promise<{ value: string; updated_at: string } | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('value, updated_at')
    .eq('key', key)
    .single()

  if (error || !data) return null
  return data
}

/**
 * Delete a setting from the database
 */
async function deleteSetting(key: string): Promise<void> {
  const { error } = await supabase.from('settings').delete().eq('key', key)
  if (error) {
    throw new Error(`Falha ao remover setting "${key}": ${error.message}`)
  }
}

function parseStoredSessions(raw: string): StoredSession[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const sessions: StoredSession[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const token = (item as any).token
      const createdAt = (item as any).createdAt
      if (typeof token !== 'string' || token.length < 10) continue
      if (typeof createdAt !== 'string' || !createdAt) continue
      sessions.push({ token, createdAt })
    }
    return sessions
  } catch {
    return []
  }
}

function pruneExpiredSessions(sessions: StoredSession[], now: Date): StoredSession[] {
  const maxAgeMs = SESSION_MAX_AGE * 1000
  return sessions.filter(s => {
    const created = new Date(s.createdAt)
    if (Number.isNaN(created.getTime())) return false
    return now.getTime() - created.getTime() <= maxAgeMs
  })
}

type SessionSnapshot = {
  /** null = `session_tokens` não existe (instância antiga: vale o token legado). */
  sessions: StoredSession[] | null
  /** Token legado único (`settings.session_token`). */
  legacy: { token: string; updatedAt: string } | null
}

/**
 * Lê `session_tokens` e o legado `session_token` numa única query, SEM escrever nada.
 * Lança quando o Supabase não está configurado ou o banco falha — quem chama decide
 * se isso é "indisponível" (proxy) ou erro (login/logout). Nunca trata erro como
 * "lista vazia": isso apagaria as outras sessões no próximo createSession.
 */
async function readSessionSnapshot(): Promise<SessionSnapshot> {
  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase não configurado')

  const { data, error } = await client
    .from('settings')
    .select('key, value, updated_at')
    .in('key', ['session_tokens', 'session_token'])

  if (error) throw new Error(`Falha ao ler sessões: ${error.message}`)

  let sessions: StoredSession[] | null = null
  let legacy: SessionSnapshot['legacy'] = null
  for (const row of (data || []) as Array<{ key: string; value: string | null; updated_at: string | null }>) {
    if (row.key === 'session_tokens' && row.value) {
      sessions = parseStoredSessions(row.value)
    } else if (row.key === 'session_token' && row.value) {
      legacy = { token: row.value, updatedAt: row.updated_at || '' }
    }
  }
  return { sessions, legacy }
}

async function setStoredSessions(sessions: StoredSession[]): Promise<void> {
  await upsertSetting('session_tokens', JSON.stringify(sessions.slice(-MAX_STORED_SESSIONS)))
}

// ============================================================================
// SESSION TOKENS (formato + assinatura)
// ============================================================================

function getSessionSigningSecret(): string | null {
  return process.env.MASTER_PASSWORD || null
}

function signSessionId(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`dispara-session:${SIGNED_TOKEN_PREFIX}${id}`).digest('base64url')
}

/** Gera um token de sessão novo (assinado quando há MASTER_PASSWORD). */
function generateSessionToken(): string {
  const id = crypto.randomUUID()
  const secret = getSessionSigningSecret()
  if (!secret) return id
  return `${SIGNED_TOKEN_PREFIX}${id}.${signSessionId(id, secret)}`
}

type TokenFormat = 'signed' | 'legacy' | 'malformed'

function classifySessionToken(token: string): TokenFormat {
  if (token.startsWith(SIGNED_TOKEN_PREFIX)) {
    const rest = token.slice(SIGNED_TOKEN_PREFIX.length)
    const dot = rest.indexOf('.')
    if (dot <= 0) return 'malformed'
    const id = rest.slice(0, dot)
    const sig = rest.slice(dot + 1)
    if (!UUID_RE.test(id) || !sig) return 'malformed'
    const secret = getSessionSigningSecret()
    if (!secret) return 'malformed'
    return timingSafeEqualString(sig, signSessionId(id, secret)) ? 'signed' : 'malformed'
  }
  return UUID_RE.test(token) ? 'legacy' : 'malformed'
}

// ============================================================================
// SESSION VALIDATION (hot path do proxy — NUNCA escreve no banco)
// ============================================================================

export type SessionTokenValidity = 'valid' | 'invalid' | 'unavailable'

type CachedSnapshot =
  | { ok: true; snapshot: SessionSnapshot; fetchedAt: number; expiresAt: number }
  | { ok: false; expiresAt: number }

let sessionSnapshotCache: CachedSnapshot | null = null
let sessionSnapshotInflight: Promise<CachedSnapshot> | null = null
// Incrementado a cada invalidação: leitura que começou antes não grava no cache.
let sessionCacheGeneration = 0
/** Tokens assinados que já forçaram releitura nesta janela de cache (anti-flood). */
const recheckedSignedTokens = new Set<string>()

/** Descarta o cache local da lista de sessões (login/logout nesta instância e testes). */
export function invalidateSessionCache(): void {
  sessionCacheGeneration++
  sessionSnapshotCache = null
  sessionSnapshotInflight = null
  recheckedSignedTokens.clear()
}

function loadSessionSnapshot(force: boolean): Promise<CachedSnapshot> {
  const cached = sessionSnapshotCache
  if (!force && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached)
  }
  // Requests concorrentes compartilham a mesma leitura.
  if (sessionSnapshotInflight) return sessionSnapshotInflight

  const generation = sessionCacheGeneration
  const isTtlRefresh = !force
  const fetchSnapshot = async (): Promise<CachedSnapshot> => {
    let result: CachedSnapshot
    try {
      const snapshot = await readSessionSnapshot()
      const fetchedAt = Date.now()
      result = { ok: true, snapshot, fetchedAt, expiresAt: fetchedAt + SESSION_LIST_CACHE_TTL_MS }
    } catch (error) {
      console.error('[user-auth] Session store indisponível:', error instanceof Error ? error.message : error)
      result = { ok: false, expiresAt: Date.now() + SESSION_STORE_ERROR_TTL_MS }
    }
    if (generation === sessionCacheGeneration) {
      sessionSnapshotCache = result
      if (result.ok && isTtlRefresh) recheckedSignedTokens.clear()
    }
    return result
  }

  const promise = fetchSnapshot()
  sessionSnapshotInflight = promise
  void promise.then(() => {
    if (sessionSnapshotInflight === promise) sessionSnapshotInflight = null
  })
  return promise
}

function isSessionAlive(createdAtIso: string, nowMs: number): boolean {
  const created = new Date(createdAtIso).getTime()
  if (Number.isNaN(created)) return false
  return nowMs - created <= SESSION_MAX_AGE * 1000
}

function snapshotHasToken(snapshot: SessionSnapshot, token: string, nowMs: number): boolean {
  // Prefer multi-session list when available
  if (snapshot.sessions) {
    let found = false
    for (const s of snapshot.sessions) {
      // Sem curto-circuito: percorre a lista inteira (tempo independe da posição).
      const match = timingSafeEqualString(s.token, token)
      if (match && isSessionAlive(s.createdAt, nowMs)) found = true
    }
    return found
  }

  // Legacy fallback: single token
  if (snapshot.legacy) {
    const updatedAt = new Date(snapshot.legacy.updatedAt).getTime()
    const sessionAgeMs = nowMs - updatedAt
    if (!Number.isNaN(sessionAgeMs) && sessionAgeMs > SESSION_MAX_AGE * 1000) return false
    return timingSafeEqualString(snapshot.legacy.token, token)
  }

  return false
}

/**
 * Valida um token de sessão contra `settings.session_tokens` (e o legado `session_token`).
 *
 * - 'valid'       → sessão existe e não expirou.
 * - 'invalid'     → token malformado, com assinatura errada, inexistente ou expirado.
 * - 'unavailable' → Supabase não configurado ou erro de banco (NÃO é "deslogado":
 *                   o proxy responde 503 em APIs e deixa a página abrir em modo degradado).
 *
 * Não escreve nada por request. A lista é cacheada por ~15s por instância; a poda de
 * sessões expiradas acontece só em createSession/logoutUser.
 */
export async function isValidSessionToken(token: string): Promise<SessionTokenValidity> {
  if (typeof token !== 'string') return 'invalid'
  const trimmed = token.trim()
  if (!trimmed || trimmed.length > MAX_SESSION_TOKEN_LENGTH) return 'invalid'

  // Cookie forjado sem assinatura válida morre aqui, sem tocar no banco.
  const format = classifySessionToken(trimmed)
  if (format === 'malformed') return 'invalid'

  const cached = await loadSessionSnapshot(false)
  if (!cached.ok) return 'unavailable'
  if (snapshotHasToken(cached.snapshot, trimmed, Date.now())) return 'valid'

  // Token assinado por ESTE servidor que não está na lista em cache: pode ter sido
  // criado por outra instância depois da leitura (login recente). Relê uma vez por
  // token por janela de cache; tokens revogados não forçam releituras em loop.
  if (format === 'signed' && !recheckedSignedTokens.has(trimmed)) {
    if (recheckedSignedTokens.size >= MAX_RECHECKED_TOKENS) recheckedSignedTokens.clear()
    recheckedSignedTokens.add(trimmed)
    const fresh = await loadSessionSnapshot(true)
    if (!fresh.ok) return 'unavailable'
    return snapshotHasToken(fresh.snapshot, trimmed, Date.now()) ? 'valid' : 'invalid'
  }

  return 'invalid'
}

/**
 * Check if setup is completed (company exists)
 *
 * ATENÇÃO: em erro de banco devolve `false`. Isso é seguro só porque NENHUM caminho
 * emite sessão quando o setup "não está completo" (o antigo /api/auth/setup, que
 * fazia isso, foi removido; o login só cria sessão quando isto é `true`).
 * Não use `!isSetupComplete()` como autorização para criar sessão.
 */
export async function isSetupComplete(): Promise<boolean> {
  // Em produção, usamos a env var para evitar consultas e loops.
  if (process.env.SETUP_COMPLETE === 'true') return true

  // Em dev/local, o fluxo pode rodar sem Vercel.
  // Então consideramos "setup completo" se a empresa já foi gravada no banco.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value')
        .eq('key', 'company_name')
        .single()

      if (error) {
        // Ajuda a diagnosticar "isSetup:false" causado por permissão negada.
        console.warn('[isSetupComplete] settings/company_name query error:', error.message)
        return false
      }
      return !!data?.value
    } catch {
      return false
    }
  }

  return false
}

/**
 * Get company info
 */
export async function getCompany(): Promise<Company | null> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['company_id', 'company_name', 'company_email', 'company_phone', 'company_created_at'])

    if (error || !data || data.length === 0) return null

    const settings: Record<string, string> = {}
    data.forEach(row => {
      settings[row.key] = row.value
    })

    if (!settings.company_name) return null

    return {
      id: settings.company_id || 'default',
      name: settings.company_name,
      email: settings.company_email || '',
      phone: settings.company_phone || '',
      createdAt: settings.company_created_at || new Date().toISOString()
    }
  } catch {
    return null
  }
}

// ============================================================================
// LOGIN / LOGOUT
// ============================================================================

/**
 * Hash SHA-256 com salt fixo (mesmo algoritmo do IdentityStep no wizard).
 */
async function hashPasswordForLogin(password: string): Promise<string> {
  const SALT = '_dispara_salt_2026';
  const encoder = new TextEncoder();
  const data = encoder.encode(password + SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifica se uma string parece ser um hash SHA-256 (64 caracteres hexadecimais)
 */
function isHashFormat(value: string): boolean {
  return value.length === 64 && /^[a-f0-9]+$/i.test(value)
}

/**
 * Attempt login with password
 * Validates against MASTER_PASSWORD env var
 *
 * Aceita dois formatos de MASTER_PASSWORD:
 * - Hash SHA-256 (64 chars hex): compara com hash da senha digitada (retrocompatível)
 * - Texto puro: compara diretamente (mais simples para reset)
 */
export async function loginUser(password: string): Promise<UserAuthResult> {
  if (!password) {
    return { success: false, error: 'Senha é obrigatória' }
  }

  // Check if MASTER_PASSWORD is configured
  const masterPassword = process.env.MASTER_PASSWORD
  if (!masterPassword) {
    return { success: false, error: 'MASTER_PASSWORD não configurada nas variáveis de ambiente' }
  }

  // Check rate limiting
  const isLocked = await checkRateLimiting()
  if (isLocked) {
    return { success: false, error: 'Muitas tentativas. Tente novamente em 15 minutos.' }
  }

  try {
    // Detecta automaticamente se MASTER_PASSWORD é hash ou texto puro
    const masterIsHash = isHashFormat(masterPassword)

    // Comparações em tempo constante (lib/safe-compare.ts).
    let isValid: boolean
    if (masterIsHash) {
      // Comportamento original: MASTER_PASSWORD é hash, compara com hash da senha digitada
      const passwordHash = await hashPasswordForLogin(password)
      isValid = timingSafeEqualString(passwordHash, masterPassword)
    } else {
      // Novo: MASTER_PASSWORD é texto puro, compara diretamente
      isValid = timingSafeEqualString(password, masterPassword)
    }

    if (!isValid) {
      await recordFailedAttempt()
      return { success: false, error: 'Senha incorreta' }
    }

    // Clear failed attempts on success
    await clearFailedAttempts()

    // Create session
    await createSession()

    const company = await getCompany()
    return { success: true, company: company || undefined }

  } catch (error) {
    console.error('Login error:', error)
    return { success: false, error: 'Erro ao fazer login' }
  }
}

/**
 * Logout - destroy session
 */
export async function logoutUser(): Promise<void> {
  const cookieStore = await cookies()

  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value
  cookieStore.delete(SESSION_COOKIE_NAME)

  // Best-effort: remove o token atual da lista de sessões para revogar imediatamente
  // e aproveita para podar as expiradas (a poda NÃO acontece mais por request).
  if (sessionToken) {
    try {
      const now = new Date()
      const { sessions: stored } = await readSessionSnapshot()
      if (stored) {
        const pruned = pruneExpiredSessions(stored, now)
        const filtered = pruned.filter(s => !timingSafeEqualString(s.token, sessionToken))
        // Só grava se houver mudança (token removido ou sessões expiradas podadas).
        if (filtered.length !== stored.length) {
          await setStoredSessions(filtered)
        }
      }
    } catch {
      // Não bloqueia logout
    } finally {
      invalidateSessionCache()
    }
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new session
 */
async function createSession(): Promise<void> {
  const cookieStore = await cookies()
  const sessionToken = generateSessionToken()

  const nowIso = new Date().toISOString()

  // Store session in database (multi-session)
  // Mantém múltiplos tokens ativos para evitar invalidação entre domínios/devices.
  // A poda das expiradas acontece aqui (e no logout), nunca por request.
  // Erro de leitura PROPAGA: tratar como lista vazia apagaria as outras sessões.
  const { sessions: existing } = await readSessionSnapshot()
  const now = new Date()
  const pruned = pruneExpiredSessions(existing || [], now)
  const nextSessions = [...pruned, { token: sessionToken, createdAt: nowIso }]
  await setStoredSessions(nextSessions)

  // Backward-compat: ainda grava o token legado para instâncias antigas (se houver).
  // Não usamos mais esse campo para validar quando `session_tokens` existe.
  await upsertSetting('session_token', sessionToken)

  // O cache local da lista não tem o token novo: descarta.
  invalidateSessionCache()

  // Set cookie
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/'
  })
}

/**
 * Validate current session (cookie do request atual).
 * Só 'valid' conta como autenticado; não escreve nada no banco.
 */
export async function validateSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value

    if (!sessionToken) return false

    return (await isValidSessionToken(sessionToken)) === 'valid'
  } catch {
    return false
  }
}

/**
 * Get auth status for client
 * OPTIMIZED: Parallelized queries for better performance
 */
export async function getUserAuthStatus(): Promise<{
  isSetup: boolean
  isAuthenticated: boolean
  company: Company | null
}> {
  // Run in parallel for better performance
  const [isSetup, isAuthenticated] = await Promise.all([
    isSetupComplete(),
    validateSession()
  ])

  // Only fetch company if authenticated 
  const company = isAuthenticated ? await getCompany() : null

  return { isSetup, isAuthenticated, company }
}

// ============================================================================
// RATE LIMITING (Brute Force Protection)
// ============================================================================

async function checkRateLimiting(): Promise<boolean> {
  try {
    const setting = await getSetting('login_attempts')
    if (!setting) return false

    const attempts = parseInt(setting.value) || 0
    const lastAttempt = new Date(setting.updated_at)
    const now = new Date()

    // Reset if lockout period passed
    if (now.getTime() - lastAttempt.getTime() > LOCKOUT_DURATION) {
      await clearFailedAttempts()
      return false
    }

    return attempts >= MAX_LOGIN_ATTEMPTS
  } catch {
    return false
  }
}

async function recordFailedAttempt(): Promise<void> {
  // Get current count
  const setting = await getSetting('login_attempts')
  const currentAttempts = setting ? parseInt(setting.value) || 0 : 0

  await upsertSetting('login_attempts', (currentAttempts + 1).toString())
}

async function clearFailedAttempts(): Promise<void> {
  try {
    await deleteSetting('login_attempts')
  } catch (error) {
    console.warn('[auth] Falha ao limpar login_attempts (best-effort):', error)
  }
}

// ============================================================================
// PASSWORD INFO
// ============================================================================

/**
 * Password is managed via MASTER_PASSWORD environment variable in Vercel.
 *
 * ACEITA DOIS FORMATOS:
 * - Texto puro: "minhaSenha123" (recomendado - mais simples)
 * - Hash SHA-256: 64 caracteres hex (retrocompatível com instalações antigas)
 *
 * COMO RESETAR A SENHA:
 * 1. Vá em Vercel Dashboard → Settings → Environment Variables
 * 2. Edite MASTER_PASSWORD e coloque sua nova senha (ex: "novaSenha456")
 * 3. Clique em Save
 * 4. Vá em Deployments → clique nos 3 pontos do último deploy → Redeploy
 * 5. Pronto! Faça login com a nova senha
 */
