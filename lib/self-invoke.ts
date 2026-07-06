import 'server-only'
import { after } from 'next/server'

/**
 * Resolve a URL pública base do deploy — mesma cadeia usada por dispatch/schedule.
 * Em produção Vercel vem de VERCEL_PROJECT_PRODUCTION_URL; em dev, localhost.
 */
export function resolveBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
    'http://localhost:3000'
  )
}

/** Segredo usado pra autenticar a chamada interna (o próprio endpoint valida via verifyCronRequest). */
function internalSecret(): string {
  return process.env.CRON_SECRET || process.env.DISPARA_ADMIN_KEY || ''
}

/**
 * Auto-reinvocação fire-and-forget do próprio deploy.
 *
 * Substitui a re-invocação encadeada de steps do QStash Workflow: quando um worker
 * esgota o budget de wall-clock (~250s de 300s), ele chama a si mesmo pra continuar
 * o próximo lote SEM esperar o próximo tick do pg_cron. O pg_cron é a rede de
 * segurança que religa a cadeia caso este fetch se perca.
 *
 * Usa after() pra não bloquear a resposta HTTP atual.
 */
export function reinvokeSelf(path: string, body: Record<string, unknown> = {}): void {
  const url = `${resolveBaseUrl()}${path}`
  const secret = internalSecret()
  after(async () => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({ ...body, source: 'self-reinvoke' }),
        keepalive: true,
      })
    } catch {
      // best-effort — o pg_cron religa a cadeia se este fetch falhar.
    }
  })
}
