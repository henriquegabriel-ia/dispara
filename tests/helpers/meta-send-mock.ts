/**
 * Mock de `fetch` para a Graph API da Meta (WhatsApp Cloud API).
 *
 * - Captura TODA mensagem enviada (`POST https://graph.facebook.com/vXX/<phone_id>/messages`)
 *   com o corpo já parseado, e responde como a Meta (`messages[0].id = wamid...`).
 * - Simula erros da Meta por código (131056, 131047, 190, 132001...), com o mesmo
 *   formato `{ error: { message, type, code, error_data, fbtrace_id } }` da Graph.
 * - Bloqueia rede: qualquer fetch fora do que foi roteado lança erro (nunca chama a
 *   Meta de verdade nem outro host).
 *
 * @example
 * ```ts
 * const meta = createMetaSendMock()
 * meta.install()                     // vi.stubGlobal('fetch', ...)
 * meta.failNext(131047)              // próximo envio: janela de 24h fechada
 * ... roda o fluxo ...
 * expect(meta.texts()).toEqual(['Olá!'])
 * expect(meta.sent[0].to).toBe('+5511999990001')
 * meta.restore()                     // ou vi.unstubAllGlobals() no afterEach
 * ```
 */

import { vi } from 'vitest'

export type FetchInput = string | URL | Request

export interface GraphCall {
  url: string
  method: string
  headers: Record<string, string>
  /** corpo parseado (JSON) ou texto cru */
  body: unknown
  /** resposta devolvida pelo mock */
  status: number
  response: unknown
}

export interface SentMessage {
  url: string
  phoneNumberId: string
  /** token do header Authorization (sem "Bearer ") */
  accessToken: string | null
  /** corpo completo enviado à Meta */
  body: Record<string, unknown>
  to: string
  type: string
  /** text.body (mensagem de texto) */
  text: string | null
  /** template.name (mensagem de template) */
  templateName: string | null
  /** interactive.body.text (botões/lista) */
  interactiveText: string | null
  /** wamid devolvido (null quando a Meta "falhou") */
  messageId: string | null
  /** erro simulado (quando falhou) */
  error: MetaErrorBody['error'] | null
}

export interface MetaErrorBody {
  error: {
    message: string
    type: string
    code: number
    error_subcode?: number
    error_data?: { messaging_product: 'whatsapp'; details: string }
    fbtrace_id: string
  }
}

export interface MetaErrorSpec {
  code: number
  message?: string
  details?: string
  subcode?: number
  /** status HTTP (padrão: o do catálogo, ou 400) */
  status?: number
  type?: string
}

/** Catálogo dos erros da Cloud API mais relevantes para o builder (lib/whatsapp-errors.ts). */
export const META_ERRORS: Record<number, { status: number; message: string; details: string; type?: string }> = {
  100: { status: 400, message: '(#100) Invalid parameter', details: 'Parameter value is not valid' },
  131000: { status: 500, message: 'Something went wrong', details: 'Something went wrong' },
  131026: { status: 400, message: 'Message undeliverable', details: 'Message undeliverable' },
  131042: {
    status: 400,
    message: 'Business eligibility payment issue',
    details: 'Message failed to send because there were one or more errors related to your payment method.',
  },
  131047: {
    status: 400,
    message: 'Re-engagement message',
    details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
  },
  131048: { status: 400, message: 'Spam rate limit hit', details: 'Message failed to send because there are restrictions on how many messages can be sent from this phone number.' },
  131051: { status: 400, message: 'Unsupported message type', details: 'Unsupported message type.' },
  131056: {
    status: 400,
    message: '(#131056) (Business Account, Consumer Account) pair rate limit hit',
    details: 'Message failed to send because there were too many messages sent from this phone number to the same phone number in a short period of time.',
  },
  130429: { status: 429, message: '(#130429) Rate limit hit', details: 'Message failed to send because there were too many messages sent from this phone number in a short period of time.' },
  132000: { status: 400, message: '(#132000) Number of parameters does not match the expected number of params', details: 'body: number of localizable_params (0) does not match the expected number of params (1)' },
  132001: { status: 404, message: '(#132001) Template name does not exist in the translation', details: 'template name (x) does not exist in pt_BR' },
  132015: { status: 400, message: '(#132015) Template is paused', details: 'Template is paused due to low quality.' },
  133010: { status: 400, message: '(#133010) Account not registered', details: 'Phone number not registered on the WhatsApp Business Platform.' },
  190: { status: 401, message: 'Error validating access token: Session has expired', details: 'Access token expired', type: 'OAuthException' },
  200: { status: 403, message: '(#200) Permissions error', details: 'Permissions error' },
}

/** Corpo + status HTTP de um erro da Graph para o código pedido. */
export function metaError(spec: number | MetaErrorSpec): { status: number; body: MetaErrorBody } {
  const s: MetaErrorSpec = typeof spec === 'number' ? { code: spec } : spec
  const known = META_ERRORS[s.code]
  const body: MetaErrorBody = {
    error: {
      message: s.message ?? known?.message ?? `(#${s.code}) Simulated Meta error`,
      type: s.type ?? known?.type ?? 'OAuthException',
      code: s.code,
      ...(s.subcode !== undefined ? { error_subcode: s.subcode } : {}),
      error_data: { messaging_product: 'whatsapp', details: s.details ?? known?.details ?? 'Simulated error' },
      fbtrace_id: 'AbCdEfGhTEST',
    },
  }
  return { status: s.status ?? known?.status ?? 400, body }
}

interface FailRule {
  spec: MetaErrorSpec
  remaining: number
  match?: (msg: { to: string; body: Record<string, unknown> }) => boolean
}

type RouteHandler = (call: { url: string; method: string; body: unknown; headers: Record<string, string> }) =>
  | { status?: number; body?: unknown }
  | Response
  | Promise<{ status?: number; body?: unknown } | Response>

interface RouteRule {
  matcher: string | RegExp | ((url: string, method: string) => boolean)
  handler: RouteHandler
}

export interface MetaSendMockOptions {
  /**
   * fetch fora da Graph API (ou rota da Graph sem handler): 'error' (padrão) lança;
   * uma função pode responder (ex.: webhook externo de teste).
   */
  onUnhandled?: 'error' | ((url: string, init?: RequestInit) => Response | Promise<Response>)
}

export interface MetaSendMock {
  /** o fetch falso (vi.fn), para asserts diretos */
  fetch: ReturnType<typeof vi.fn>
  /** mensagens enviadas a /messages (sucesso e falha), em ordem */
  sent: SentMessage[]
  /** todas as chamadas à Graph API */
  calls: GraphCall[]
  /** chamadas fora da Graph que foram bloqueadas/respondidas por onUnhandled */
  unhandled: Array<{ url: string; method: string }>
  /** vi.stubGlobal('fetch', mock.fetch) */
  install: () => MetaSendMock
  /** devolve o fetch anterior */
  restore: () => void
  /** os próximos `times` envios falham com o erro da Meta (filtro opcional por destinatário) */
  failNext: (spec: number | MetaErrorSpec, opts?: { times?: number; to?: string }) => void
  /** todo envio que casar com o predicado falha (até removeFailures) */
  failWhen: (match: (msg: { to: string; body: Record<string, unknown> }) => boolean, spec: number | MetaErrorSpec) => void
  removeFailures: () => void
  /** responde outra rota da Graph (templates, media, ...) */
  route: (matcher: RouteRule['matcher'], handler: RouteHandler) => void
  /** limpa capturas, falhas e rotas */
  reset: () => void
  /** só os envios que a Meta aceitou */
  delivered: () => SentMessage[]
  /** text.body dos envios aceitos */
  texts: () => string[]
  /** envios aceitos para um telefone (com ou sem "+") */
  sentTo: (phone: string) => SentMessage[]
  last: () => SentMessage | undefined
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k.toLowerCase()] = v
    })
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k.toLowerCase()] = v
  } else {
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = String(v)
  }
  return out
}

function parseBody(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const digits = (phone: string) => String(phone).replace(/\D/g, '')

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function createMetaSendMock(options: MetaSendMockOptions = {}): MetaSendMock {
  const sent: SentMessage[] = []
  const calls: GraphCall[] = []
  const unhandled: Array<{ url: string; method: string }> = []
  let failures: FailRule[] = []
  let routes: RouteRule[] = []
  let counter = 0
  let previousFetch: typeof fetch | null = null

  const takeFailure = (msg: { to: string; body: Record<string, unknown> }): MetaErrorSpec | null => {
    const index = failures.findIndex((f) => !f.match || f.match(msg))
    if (index < 0) return null
    const rule = failures[index]
    rule.remaining -= 1
    if (rule.remaining <= 0) failures.splice(index, 1)
    return rule.spec
  }

  const handle = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    let url: string
    let method = (init?.method ?? 'GET').toUpperCase()
    let headers = headersToRecord(init?.headers)
    let rawBody: unknown = init?.body
    if (input instanceof Request) {
      url = input.url
      method = (init?.method ?? input.method ?? 'GET').toUpperCase()
      headers = { ...headersToRecord(input.headers), ...headers }
      if (rawBody === undefined && method !== 'GET') rawBody = await input.clone().text()
    } else {
      url = String(input)
    }
    const body = parseBody(rawBody)

    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(url)
    } catch {
      parsedUrl = null
    }
    const isGraph = parsedUrl?.hostname === 'graph.facebook.com'

    const custom = routes.find((r) =>
      typeof r.matcher === 'string'
        ? url.includes(r.matcher)
        : r.matcher instanceof RegExp
          ? r.matcher.test(url)
          : r.matcher(url, method)
    )
    if (custom) {
      const out = await custom.handler({ url, method, body, headers })
      const response = out instanceof Response ? out : jsonResponse(out.status ?? 200, out.body ?? {})
      if (isGraph) {
        calls.push({ url, method, headers, body, status: response.status, response: await response.clone().json().catch(() => null) })
      }
      return response
    }

    const messagesMatch = isGraph && method === 'POST' ? /^\/v[\d.]+\/([^/]+)\/messages\/?$/.exec(parsedUrl!.pathname) : null
    if (messagesMatch) {
      const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
      const to = String(payload.to ?? '')
      const auth = headers.authorization ?? ''
      const failure = takeFailure({ to, body: payload })
      const base = {
        url,
        phoneNumberId: messagesMatch[1],
        accessToken: auth.startsWith('Bearer ') ? auth.slice(7) : auth || null,
        body: payload,
        to,
        type: String(payload.type ?? ''),
        text: ((payload.text as { body?: string } | undefined)?.body ?? null) as string | null,
        templateName: ((payload.template as { name?: string } | undefined)?.name ?? null) as string | null,
        interactiveText: ((payload.interactive as { body?: { text?: string } } | undefined)?.body?.text ?? null) as
          | string
          | null,
      }
      if (failure) {
        const { status, body: errorBody } = metaError(failure)
        sent.push({ ...base, messageId: null, error: errorBody.error })
        calls.push({ url, method, headers, body, status, response: errorBody })
        return jsonResponse(status, errorBody)
      }
      counter += 1
      const messageId = `wamid.TEST${String(counter).padStart(6, '0')}`
      const response = {
        messaging_product: 'whatsapp',
        contacts: [{ input: to, wa_id: digits(to) }],
        messages: [
          payload.type === 'template' ? { id: messageId, message_status: 'accepted' } : { id: messageId },
        ],
      }
      sent.push({ ...base, messageId, error: null })
      calls.push({ url, method, headers, body, status: 200, response })
      return jsonResponse(200, response)
    }

    unhandled.push({ url, method })
    if (typeof options.onUnhandled === 'function') return options.onUnhandled(url, init)
    throw new Error(
      `[meta-send-mock] fetch não esperado: ${method} ${url}. ` +
        'Testes não podem ir à rede — roteie com meta.route(...) ou passe onUnhandled.'
    )
  }

  const fetchMock = vi.fn(handle)

  const mock: MetaSendMock = {
    fetch: fetchMock,
    sent,
    calls,
    unhandled,
    install: () => {
      previousFetch = globalThis.fetch
      vi.stubGlobal('fetch', fetchMock)
      return mock
    },
    restore: () => {
      if (previousFetch) vi.stubGlobal('fetch', previousFetch)
      previousFetch = null
    },
    failNext: (spec, opts) => {
      const wanted = opts?.to ? digits(opts.to) : null
      failures.push({
        spec: typeof spec === 'number' ? { code: spec } : spec,
        remaining: opts?.times ?? 1,
        match: wanted ? (msg) => digits(msg.to) === wanted : undefined,
      })
    },
    failWhen: (match, spec) => {
      failures.push({ spec: typeof spec === 'number' ? { code: spec } : spec, remaining: Infinity, match })
    },
    removeFailures: () => {
      failures = []
    },
    route: (matcher, handler) => {
      routes.push({ matcher, handler })
    },
    reset: () => {
      sent.splice(0)
      calls.splice(0)
      unhandled.splice(0)
      failures = []
      routes = []
      counter = 0
      fetchMock.mockClear()
    },
    delivered: () => sent.filter((m) => m.messageId !== null),
    texts: () => sent.filter((m) => m.messageId !== null && m.text !== null).map((m) => m.text as string),
    sentTo: (phone) => sent.filter((m) => m.messageId !== null && digits(m.to) === digits(phone)),
    last: () => sent[sent.length - 1],
  }
  return mock
}
