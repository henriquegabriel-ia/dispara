// Supabase FALSO (HTTP) para o E2E do builder — sobe como webServer do
// playwright.builder.config.ts, ANTES do `next dev`.
//
// Por que existe: o proxy.ts valida o cookie `dispara_session` lendo
// `settings.session_tokens` no Supabase (lib/user-auth.ts). Para abrir as páginas
// do dashboard sem tocar no banco real (o do preview é PRODUÇÃO), o next dev do
// teste aponta NEXT_PUBLIC_SUPABASE_URL para este servidor local, que responde
// só o necessário no formato do PostgREST:
//   - GET /rest/v1/settings?key=in.(session_tokens,...) → a sessão do teste
//     (sha256 do token, como o app grava);
//   - qualquer outra leitura → [] (ou 406 PGRST116 quando pede objeto único);
//   - escritas → 201/204 vazio (nada persiste).
// Toda requisição é registrada (FAKE_SUPABASE_LOG) para auditar o que o servidor
// Next tentou ler durante o teste.
//
// Sem dependências: só node:http.

import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

const PORT = Number(process.env.FAKE_SUPABASE_PORT || 54399)
const TOKEN_HASH = process.env.E2E_BUILDER_SESSION_TOKEN_HASH || ''
const LOG_FILE = process.env.FAKE_SUPABASE_LOG || ''

if (!/^[0-9a-f]{64}$/.test(TOKEN_HASH)) {
  console.error('[fake-supabase] E2E_BUILDER_SESSION_TOKEN_HASH ausente/inválido')
  process.exit(1)
}

// createdAt "agora": sessão viva por 7 dias (SESSION_MAX_AGE do app).
const SESSION_CREATED_AT = new Date().toISOString()
const SESSION_ROWS_UPDATED_AT = SESSION_CREATED_AT

function log(line) {
  if (!LOG_FILE) return
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // log é best-effort
  }
}

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
    ...extraHeaders,
  })
  res.end(payload)
}

/** Linhas da tabela settings que o fake conhece (só a sessão do teste). */
function settingsRows(url) {
  const keyFilter = url.searchParams.get('key') || ''
  const rows = [
    {
      key: 'session_tokens',
      value: JSON.stringify([{ tokenHash: TOKEN_HASH, createdAt: SESSION_CREATED_AT }]),
      updated_at: SESSION_ROWS_UPDATED_AT,
    },
  ]
  if (keyFilter.startsWith('in.(')) {
    const keys = keyFilter
      .slice(4, -1)
      .split(',')
      .map((k) => k.replace(/^"|"$/g, ''))
    return rows.filter((r) => keys.includes(r.key))
  }
  if (keyFilter.startsWith('eq.')) {
    const key = keyFilter.slice(3)
    return rows.filter((r) => r.key === key)
  }
  return rows
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  const method = (req.method || 'GET').toUpperCase()
  log(`${method} ${url.pathname}${url.search}`)

  if (method === 'OPTIONS') return send(res, 204)
  if (url.pathname === '/__health') return send(res, 200, { ok: true })

  // Drena o body (não usamos) antes de responder.
  req.resume()

  if (!url.pathname.startsWith('/rest/v1/')) {
    // auth/storage/functions/realtime(HTTP): nada disso é usado pelas páginas.
    return send(res, 404, { message: 'fake-supabase: rota não suportada', path: url.pathname })
  }

  const table = url.pathname.slice('/rest/v1/'.length)
  const wantsObject = String(req.headers.accept || '').includes('application/vnd.pgrst.object+json')

  if (method === 'GET' || method === 'HEAD') {
    const rows = table === 'settings' ? settingsRows(url) : []
    const headers = { 'Content-Range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }
    if (wantsObject) {
      if (rows.length === 1) return send(res, 200, rows[0], headers)
      return send(
        res,
        406,
        {
          code: 'PGRST116',
          details: `The result contains ${rows.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        },
        headers
      )
    }
    if (method === 'HEAD') {
      res.writeHead(200, headers)
      return res.end()
    }
    return send(res, 200, rows, headers)
  }

  // Escritas: aceitas e descartadas. `Prefer: return=representation` → [].
  const prefer = String(req.headers.prefer || '')
  if (prefer.includes('return=representation')) return send(res, 201, wantsObject ? {} : [])
  return send(res, 204)
})

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on ${PORT}`)
  console.log(`[fake-supabase] ouvindo em http://127.0.0.1:${PORT}`)
})
