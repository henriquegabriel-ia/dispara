import { mkdirSync } from 'node:fs'
import {
  BASE_URL,
  FAKE_SUPABASE_URL,
  SCREENSHOTS_DIR,
  SESSION_COOKIE_NAME,
  SESSION_TOKEN,
} from '@/tests/e2e-builder/env'

/**
 * Roda depois que os webServers subiram:
 *   1. confere que o servidor na porta aceita a sessão de TESTE (se for outro
 *      next dev — ex.: o do dia a dia, apontando para o Supabase real — o proxy
 *      manda para /login e a suíte para aqui com uma mensagem clara);
 *   2. aquece a compilação do Turbopack das duas telas (a 1ª compilação passa
 *      fácil de 60s no Windows e estouraria o timeout do primeiro teste).
 */
export default async function globalSetup(): Promise<void> {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })

  const health = await fetch(`${FAKE_SUPABASE_URL}/__health`).catch(() => null)
  if (!health?.ok) throw new Error(`[e2e-builder] Supabase falso não respondeu em ${FAKE_SUPABASE_URL}`)

  const cookie = `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`
  for (const pathname of ['/workflows', '/builder/warmup-e2e']) {
    const started = Date.now()
    const response = await fetch(`${BASE_URL}${pathname}`, {
      headers: { cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(300_000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || ''
      throw new Error(
        `[e2e-builder] ${pathname} redirecionou para "${location}": o servidor em ${BASE_URL} ` +
          'não aceitou a sessão de teste (é outro next dev? veja playwright.builder.config.ts).'
      )
    }
    if (!response.ok) {
      throw new Error(`[e2e-builder] aquecimento de ${pathname} falhou: HTTP ${response.status}`)
    }
    await response.text()
    console.log(`[e2e-builder] ${pathname} compilado em ${Math.round((Date.now() - started) / 1000)}s`)
  }
}
