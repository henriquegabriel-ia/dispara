import { settingsDb } from '@/lib/supabase-db'
import { getSupabaseAdmin } from '@/lib/supabase'

export interface MetaAppCredentials {
  appId: string
  appSecret: string
}

/**
 * Retorna apenas o App ID (sem exigir secret).
 *
 * Necessário para APIs da Meta que usam caminhos baseados em /{app_id}/...
 * (ex.: Resumable Upload API) mas não exigem appSecret.
 *
 * Fonte única: Supabase Settings (configurado via UI)
 */
export async function getMetaAppId(): Promise<string | null> {
  try {
    const dbAppIdRaw = await settingsDb.get('metaAppId')
    const appId = String(dbAppIdRaw || '').trim()
    return appId || null
  } catch {
    return null
  }
}

/**
 * Credenciais do App da Meta (opcional).
 *
 * Usadas para validação forte de tokens via Graph API `/debug_token`.
 *
 * Fonte única: Supabase Settings (configurado via UI)
 */
export async function getMetaAppCredentials(): Promise<MetaAppCredentials | null> {
  try {
    const [dbAppId, dbSecret] = await Promise.all([
      settingsDb.get('metaAppId'),
      settingsDb.get('metaAppSecret'),
    ])

    const appId = String(dbAppId || '').trim()
    const appSecret = String(dbSecret || '').trim()

    if (!appId || !appSecret) return null

    return { appId, appSecret }
  } catch {
    return null
  }
}

/**
 * App Secret salvo pela UI (settings 'metaAppSecret'), independente do App ID.
 *
 * Usado na verificação de assinatura (X-Hub-Signature-256) do webhook e do
 * endpoint de Flows. Diferente das funções acima, NÃO engole erro de leitura:
 * quem verifica assinatura precisa distinguir "não configurado" (null) de
 * "não consegui ler" (throw) para não abrir o webhook por falha transitória do banco.
 */
export async function getStoredMetaAppSecret(): Promise<string | null> {
  const client = getSupabaseAdmin()
  // Supabase não configurado (wizard) → não há nada salvo.
  if (!client) return null

  const { data, error } = await client
    .from('settings')
    .select('value')
    .eq('key', 'metaAppSecret')
    .maybeSingle()

  if (error) {
    throw new Error(`Falha ao ler metaAppSecret: ${error.message}`)
  }

  const secret = String((data as { value?: unknown } | null)?.value || '').trim()
  return secret || null
}

/**
 * Retorna configuração pública do Meta App (sem expor secret)
 */
export async function getMetaAppConfigPublic(): Promise<{
  appId: string | null
  hasAppSecret: boolean
  isConfigured: boolean
}> {
  try {
    const [dbAppIdRaw, dbSecretRaw] = await Promise.all([
      settingsDb.get('metaAppId'),
      settingsDb.get('metaAppSecret'),
    ])

    const appId = String(dbAppIdRaw || '').trim() || null
    const hasAppSecret = Boolean(String(dbSecretRaw || '').trim())

    return {
      appId,
      hasAppSecret,
      isConfigured: Boolean(appId && hasAppSecret),
    }
  } catch {
    return {
      appId: null,
      hasAppSecret: false,
      isConfigured: false,
    }
  }
}
