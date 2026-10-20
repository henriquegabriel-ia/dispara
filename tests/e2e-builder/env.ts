// Ambiente do E2E do builder: segredos de TESTE gerados a cada execução (nunca
// gravados em arquivo versionado) + o token de sessão assinado do mesmo jeito que
// lib/user-auth.ts assina (formato `s2.<uuid>.<hmac>`).
//
// O config do Playwright é avaliado no processo principal E de novo em cada
// worker: os valores ficam em process.env (`??=`) para os workers — que herdam o
// env do processo principal — enxergarem os MESMOS segredos do webServer.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

function ensureEnv(name: string, generate: () => string): string {
  const current = process.env[name]
  if (current) return current
  const value = generate()
  process.env[name] = value
  return value
}

export const NEXT_PORT = Number(process.env.E2E_BUILDER_PORT || 3100)
export const BASE_URL = `http://localhost:${NEXT_PORT}`
export const FAKE_SUPABASE_PORT = Number(process.env.FAKE_SUPABASE_PORT || 54399)
export const FAKE_SUPABASE_URL = `http://127.0.0.1:${FAKE_SUPABASE_PORT}`

/** Screenshots, logs e relatório (fora do repo por padrão). */
export const ARTIFACTS_DIR = ensureEnv('E2E_BUILDER_ARTIFACTS_DIR', () =>
  path.join(os.tmpdir(), 'dispara-builder-e2e')
)
export const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots')
export const FAKE_SUPABASE_LOG = path.join(ARTIFACTS_DIR, 'fake-supabase.log')

export const MASTER_PASSWORD = ensureEnv(
  'E2E_BUILDER_MASTER_PASSWORD',
  () => `e2e-master-${randomBytes(18).toString('hex')}`
)
// >= 32 caracteres: lib/user-auth.ts ignora SESSION_SECRET curto.
export const SESSION_SECRET = ensureEnv('E2E_BUILDER_SESSION_SECRET', () =>
  randomBytes(32).toString('hex')
)
export const API_KEY = ensureEnv('E2E_BUILDER_API_KEY', () => `e2e-api-${randomBytes(16).toString('hex')}`)
export const ADMIN_KEY = ensureEnv('E2E_BUILDER_ADMIN_KEY', () => `e2e-admin-${randomBytes(16).toString('hex')}`)
export const CRON_SECRET = ensureEnv('E2E_BUILDER_CRON_SECRET', () => `e2e-cron-${randomBytes(16).toString('hex')}`)
const SESSION_ID = ensureEnv('E2E_BUILDER_SESSION_ID', () => randomUUID())

/** Mesma derivação de lib/user-auth.ts (getSessionSigningKey + signSessionId). */
function signSessionToken(id: string): string {
  const key = createHmac('sha256', SESSION_SECRET)
    .update(`dispara-session-v2|${MASTER_PASSWORD}`)
    .digest()
  const sig = createHmac('sha256', key).update(`dispara-session:s2.${id}`).digest('base64url')
  return `s2.${id}.${sig}`
}

export const SESSION_COOKIE_NAME = 'dispara_session'
export const SESSION_TOKEN = signSessionToken(SESSION_ID)
export const SESSION_TOKEN_HASH = createHash('sha256').update(SESSION_TOKEN, 'utf8').digest('hex')

/**
 * Env do `next dev` de teste. Tudo que poderia apontar para fora é sobrescrito
 * explicitamente (o next.config.ts carrega .env.vercel.local se existir, e o
 * dotenv não sobrescreve variável já definida — por isso as vazias).
 */
export function nextDevEnv(): Record<string, string> {
  return {
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: FAKE_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_builder_fake',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SECRET_KEY: 'sb_secret_e2e_builder_fake_key_not_real',
    SUPABASE_SERVICE_ROLE_KEY: '',
    MASTER_PASSWORD,
    SESSION_SECRET,
    DISPARA_API_KEY: API_KEY,
    DISPARA_ADMIN_KEY: ADMIN_KEY,
    CRON_SECRET,
    WHATSAPP_TOKEN: '',
    WHATSAPP_PHONE_ID: '',
    WHATSAPP_BUSINESS_ACCOUNT_ID: '',
    GEMINI_API_KEY: '',
    MEM0_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    DATABASE_URL: '',
    POSTGRES_URL: '',
    VERCEL_ENV: '',
    VERCEL_URL: '',
  }
}

export function fakeSupabaseEnv(): Record<string, string> {
  return {
    FAKE_SUPABASE_PORT: String(FAKE_SUPABASE_PORT),
    E2E_BUILDER_SESSION_TOKEN_HASH: SESSION_TOKEN_HASH,
    FAKE_SUPABASE_LOG,
  }
}
