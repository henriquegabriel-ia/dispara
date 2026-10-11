import { createHmac, timingSafeEqual } from 'node:crypto'
import { getStoredMetaAppSecret } from '@/lib/meta-app-credentials'
import { getSupabaseAdmin } from '@/lib/supabase'

/**
 * Verificação da assinatura X-Hub-Signature-256 da Meta (webhook do WhatsApp e
 * endpoint de data exchange dos WhatsApp Flows).
 *
 * Política (evaluateMetaSignature):
 * - HÁ App Secret (env META_APP_SECRET ou settings 'metaAppSecret' salvo pela UI)
 *   → exige assinatura válida (fail-closed), modo 'enforced'.
 * - NÃO há App Secret → aceita sem assinatura (modo 'unsigned_allowed') e loga um
 *   warning periódico. O App Secret é OPCIONAL no produto e o installer não o
 *   provisiona: fail-closed incondicional derrubaria o inbound de toda instalação
 *   sem secret. Exceção: META_WEBHOOK_REQUIRE_SIGNATURE=true rejeita mesmo assim.
 * - Não deu para ler o App Secret (falha de banco) → rejeita (nunca "abre" por erro).
 */

export const META_SIGNATURE_HEADER = 'x-hub-signature-256'

export type MetaAppSecretSource = 'env' | 'settings' | null

export interface MetaAppSecretInfo {
  secret: string | null
  source: MetaAppSecretSource
}

export type MetaSignatureMode = 'enforced' | 'unsigned_allowed'

export type MetaSignatureReason =
  | 'missing_signature'   // header ausente
  | 'malformed_signature' // header fora do formato sha256=<64 hex>
  | 'invalid_signature'   // HMAC não confere
  | 'app_secret_required' // META_WEBHOOK_REQUIRE_SIGNATURE=true sem App Secret configurado
  | 'secret_unavailable'  // falha ao ler o App Secret (banco) — fail-closed
  | 'no_app_secret'       // unsigned_allowed: aceito sem verificação

export interface MetaSignatureEvaluation {
  ok: boolean
  mode: MetaSignatureMode
  reason?: MetaSignatureReason
}

export type MetaSignatureEndpoint = 'webhook' | 'flows_endpoint'

const APP_SECRET_CACHE_TTL_MS = 60_000
const UNSIGNED_WARNING_INTERVAL_MS = 15 * 60_000
const FAILURE_ALERT_LOCAL_THROTTLE_MS = 10 * 60_000
const FAILURE_ALERT_BUCKET_MS = 60 * 60_000
const FAILURE_ALERT_ID_PREFIX = 'alert_meta_signature_'
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i

export const META_APP_SECRET_RECOMMENDED_ACTION =
  'Configure o App Secret do App da Meta em Configurações (ou na env META_APP_SECRET) para que o webhook e o endpoint de Flows rejeitem requisições forjadas.'

let secretCache: { value: MetaAppSecretInfo; expiresAt: number } | null = null
let secretInflight: Promise<MetaAppSecretInfo> | null = null
let lastUnsignedWarningAt = 0
let lastFailureAlertAt = 0

/** Invalida o cache do App Secret (chamar ao salvar/remover o secret pela UI). */
export function clearMetaAppSecretCache(): void {
  secretCache = null
  secretInflight = null
}

/** Zera todo o estado em memória do módulo (testes). */
export function resetMetaSignatureState(): void {
  clearMetaAppSecretCache()
  lastUnsignedWarningAt = 0
  lastFailureAlertAt = 0
}

export function isSignatureRequiredByEnv(): boolean {
  return String(process.env.META_WEBHOOK_REQUIRE_SIGNATURE || '').trim().toLowerCase() === 'true'
}

/**
 * App Secret usado para verificar a assinatura.
 * Precedência: env META_APP_SECRET > settings 'metaAppSecret' (cache de 60s).
 *
 * Lança erro quando o banco não responde e não há valor anterior em cache:
 * o chamador decide (evaluateMetaSignature rejeita).
 */
export async function getMetaAppSecret(): Promise<MetaAppSecretInfo> {
  const envSecret = String(process.env.META_APP_SECRET || '').trim()
  if (envSecret) return { secret: envSecret, source: 'env' }

  const now = Date.now()
  if (secretCache && secretCache.expiresAt > now) return secretCache.value
  if (secretInflight) return secretInflight

  const lookup = (async (): Promise<MetaAppSecretInfo> => {
    try {
      const stored = await getStoredMetaAppSecret()
      const value: MetaAppSecretInfo = stored
        ? { secret: stored, source: 'settings' }
        : { secret: null, source: null }
      secretCache = { value, expiresAt: Date.now() + APP_SECRET_CACHE_TTL_MS }
      return value
    } catch (error) {
      // Falha transitória: reaproveita o último valor conhecido (mesmo expirado).
      if (secretCache) return secretCache.value
      throw error
    } finally {
      secretInflight = null
    }
  })()

  secretInflight = lookup
  return lookup
}

/**
 * HMAC-SHA256 do corpo cru com o App Secret, comparado em tempo constante.
 * Aceita apenas o formato `sha256=<64 hex>`; qualquer outra coisa é inválida.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false
  const match = SIGNATURE_PATTERN.exec(header.trim())
  if (!match) return false

  const received = Buffer.from(match[1], 'hex')
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest()
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

function warnUnsignedAllowed(): void {
  const now = Date.now()
  if (lastUnsignedWarningAt && now - lastUnsignedWarningAt < UNSIGNED_WARNING_INTERVAL_MS) return
  lastUnsignedWarningAt = now
  console.warn(
    '[meta-signature] ⚠️ App Secret da Meta não configurado: webhook e endpoint de Flows estão aceitando requisições SEM assinatura (qualquer um pode forjar eventos). ' +
      'Configure o App Secret em Configurações ou defina META_APP_SECRET. ' +
      'Para rejeitar requisições não assinadas mesmo sem App Secret, defina META_WEBHOOK_REQUIRE_SIGNATURE=true.'
  )
}

/**
 * Aplica a política de assinatura ao corpo cru da request.
 * Deve rodar ANTES de qualquer processamento do payload.
 */
export async function evaluateMetaSignature(
  rawBody: string,
  header: string | null
): Promise<MetaSignatureEvaluation> {
  let info: MetaAppSecretInfo
  try {
    info = await getMetaAppSecret()
  } catch (error) {
    console.error(
      '[meta-signature] Não foi possível ler o App Secret; rejeitando a requisição (fail-closed):',
      error instanceof Error ? error.message : error
    )
    return { ok: false, mode: 'enforced', reason: 'secret_unavailable' }
  }

  if (info.secret) {
    const value = header?.trim() || ''
    if (!value) return { ok: false, mode: 'enforced', reason: 'missing_signature' }
    if (!SIGNATURE_PATTERN.test(value)) return { ok: false, mode: 'enforced', reason: 'malformed_signature' }
    return verifyMetaSignature(rawBody, value, info.secret)
      ? { ok: true, mode: 'enforced' }
      : { ok: false, mode: 'enforced', reason: 'invalid_signature' }
  }

  if (isSignatureRequiredByEnv()) {
    return { ok: false, mode: 'enforced', reason: 'app_secret_required' }
  }

  warnUnsignedAllowed()
  return { ok: true, mode: 'unsigned_allowed', reason: 'no_app_secret' }
}

/** Status de configuração para diagnóstico (não expõe o secret). */
export interface MetaSignatureStatus {
  mode: MetaSignatureMode
  secretSource: MetaAppSecretSource
  requireSignature: boolean
  /** true quando todo POST está sendo rejeitado (exige assinatura sem App Secret). */
  rejectsAll: boolean
  error: string | null
  recommendedAction: string | null
}

export async function getMetaSignatureStatus(): Promise<MetaSignatureStatus> {
  const requireSignature = isSignatureRequiredByEnv()
  try {
    const info = await getMetaAppSecret()
    if (info.secret) {
      return {
        mode: 'enforced',
        secretSource: info.source,
        requireSignature,
        rejectsAll: false,
        error: null,
        recommendedAction: null,
      }
    }
    return {
      mode: requireSignature ? 'enforced' : 'unsigned_allowed',
      secretSource: null,
      requireSignature,
      rejectsAll: requireSignature,
      error: null,
      recommendedAction: META_APP_SECRET_RECOMMENDED_ACTION,
    }
  } catch (error) {
    return {
      mode: 'enforced',
      secretSource: null,
      requireSignature,
      rejectsAll: false,
      error: error instanceof Error ? error.message : String(error),
      recommendedAction: null,
    }
  }
}

function buildFailureAlert(evaluation: MetaSignatureEvaluation): { message: string; action: string } {
  if (evaluation.reason === 'app_secret_required') {
    return {
      message:
        'O webhook da Meta está rejeitando todas as requisições: META_WEBHOOK_REQUIRE_SIGNATURE=true, mas nenhum App Secret está configurado.',
      action:
        'Configure o App Secret em Configurações (ou META_APP_SECRET) ou remova META_WEBHOOK_REQUIRE_SIGNATURE. Enquanto isso, mensagens recebidas e status não são processados.',
    }
  }
  return {
    message: 'Requisições ao webhook da Meta foram rejeitadas por assinatura (X-Hub-Signature-256) inválida.',
    action:
      'Se as mensagens recebidas pararam de chegar, confira se o App Secret em Configurações é o do mesmo App da Meta que envia o webhook. ' +
      'Se o App Secret está correto, alguém pode estar tentando forjar eventos — as requisições foram bloqueadas.',
  }
}

/**
 * Registra um account_alert quando uma request é rejeitada em modo enforced.
 * Best-effort (nunca lança) e com rate limit para não inundar a tabela:
 * - por instância: no máximo 1 tentativa a cada 10 min;
 * - global: não cria se já houver alerta de assinatura ativo, e o id determinístico
 *   por hora (`alert_meta_signature_<bucket>`) deduplica entre instâncias.
 */
export async function reportMetaSignatureFailure(params: {
  evaluation: MetaSignatureEvaluation
  endpoint: MetaSignatureEndpoint
}): Promise<void> {
  const { evaluation, endpoint } = params
  if (evaluation.ok || evaluation.mode !== 'enforced') return
  // Falha ao ler o secret = banco com problema; gravar alerta também falharia.
  if (evaluation.reason === 'secret_unavailable') return

  const now = Date.now()
  if (lastFailureAlertAt && now - lastFailureAlertAt < FAILURE_ALERT_LOCAL_THROTTLE_MS) return
  lastFailureAlertAt = now

  try {
    const db = getSupabaseAdmin()
    if (!db) return

    const { data: active, error: activeError } = await db
      .from('account_alerts')
      .select('id')
      .like('id', `${FAILURE_ALERT_ID_PREFIX}%`)
      .eq('dismissed', false)
      .limit(1)
    if (activeError) throw activeError
    if (Array.isArray(active) && active.length > 0) return

    const { message, action } = buildFailureAlert(evaluation)
    const bucket = Math.floor(now / FAILURE_ALERT_BUCKET_MS)
    const { error } = await db.from('account_alerts').upsert(
      {
        id: `${FAILURE_ALERT_ID_PREFIX}${bucket}`,
        type: 'auth',
        code: null,
        message,
        details: JSON.stringify({ reason: evaluation.reason, endpoint, action }),
        created_at: new Date(now).toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) throw error
  } catch (error) {
    console.warn('[meta-signature] Falha ao registrar account_alert (best-effort):', error)
  }
}
