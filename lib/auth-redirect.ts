import { INSTALLER_PAGE_PREFIX, isPublicPage, matchSegmentPrefix } from '@/lib/route-policy'

/**
 * Redirecionamento para /login (client e proxy).
 *
 * - sanitizeRedirectPath: valida o `?redirect=` do login (evita open redirect).
 * - installUnauthorizedRedirect: tratamento global de 401 no browser. Só reage a
 *   401 emitidos pelo PROXY (header AUTH_REQUIRED_HEADER), porque várias rotas
 *   devolvem 401 por outros motivos (ex.: "credenciais WhatsApp não configuradas")
 *   e isso não pode mandar o dono para o login em loop.
 *
 * Módulo sem dependências de servidor: é importado por app/providers.tsx.
 */

/** Header que o proxy põe nos 401 de "sem sessão/credencial" das APIs. */
export const AUTH_REQUIRED_HEADER = 'x-auth-required'

const LOGIN_PATH = '/login'
const DEFAULT_REDIRECT = '/'
// Base fictícia só para o parser de URL resolver caminhos relativos.
const PARSE_BASE = 'http://dispara.invalid'

/**
 * Aceita só caminhos relativos do próprio app: começam com '/', não com '//' nem
 * '/\' (ambos viram URL de outro host no browser), sem caracteres de controle nem
 * barra invertida, e que continuem no mesmo origin depois de parseados. Evita
 * loop de volta para o /login.
 */
export function sanitizeRedirectPath(raw: string | null | undefined, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof raw !== 'string') return fallback
  const value = raw.trim()
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback

  try {
    const parsed = new URL(value, PARSE_BASE)
    if (parsed.origin !== PARSE_BASE) return fallback
    if (matchSegmentPrefix(LOGIN_PATH, parsed.pathname)) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

/** Monta `/login?redirect=<caminho>` com o caminho já sanitizado. */
export function buildLoginPath(currentPath: string): string {
  const target = sanitizeRedirectPath(currentPath, '')
  if (!target || target === DEFAULT_REDIRECT) return LOGIN_PATH
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(target)}`
}

/**
 * Decide se um 401 deve levar ao /login:
 * - a request foi para /api/* do próprio origin (exceto /api/auth/*);
 * - a resposta veio do proxy (AUTH_REQUIRED_HEADER);
 * - a página atual não é pública (/atendimento, /f, /login...) nem o wizard /install
 *   — a PWA de atendente tem auth própria e não usa o /login do dashboard.
 */
export function shouldRedirectToLogin(params: {
  requestUrl: string
  status: number
  authRequiredHeader: string | null
  location: { href: string; origin: string; pathname: string }
}): boolean {
  const { requestUrl, status, authRequiredHeader, location } = params
  if (status !== 401 || !authRequiredHeader) return false

  let target: URL
  try {
    target = new URL(requestUrl, location.href)
  } catch {
    return false
  }
  if (target.origin !== location.origin) return false
  if (!matchSegmentPrefix('/api', target.pathname)) return false
  if (matchSegmentPrefix('/api/auth', target.pathname)) return false

  if (isPublicPage(location.pathname)) return false
  if (matchSegmentPrefix(INSTALLER_PAGE_PREFIX, location.pathname)) return false
  return true
}

const INSTALLED_FLAG = '__disparaUnauthorizedRedirectInstalled'
let redirecting = false

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Instala (uma vez) o interceptador global de 401 no `window.fetch`. Cobre React
 * Query e também os services que engolem o status e devolvem lista vazia.
 * Redireciona no máximo uma vez por carregamento de página.
 */
export function installUnauthorizedRedirect(
  navigate: (url: string) => void = (url) => window.location.assign(url)
): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  const w = window as Window & { [INSTALLED_FLAG]?: boolean }
  if (w[INSTALLED_FLAG]) return
  w[INSTALLED_FLAG] = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init)
    if (response.status === 401 && !redirecting) {
      try {
        const loc = window.location
        if (
          shouldRedirectToLogin({
            requestUrl: requestUrlOf(input),
            status: response.status,
            authRequiredHeader: response.headers.get(AUTH_REQUIRED_HEADER),
            location: { href: loc.href, origin: loc.origin, pathname: loc.pathname },
          })
        ) {
          redirecting = true
          navigate(buildLoginPath(`${loc.pathname}${loc.search}`))
        }
      } catch {
        // Nunca quebra a request original por causa do redirect.
      }
    }
    return response
  }
}

/** Só para testes: reseta o estado do módulo. */
export function __resetUnauthorizedRedirectForTests(): void {
  redirecting = false
  if (typeof window !== 'undefined') {
    delete (window as Window & { [INSTALLED_FLAG]?: boolean })[INSTALLED_FLAG]
  }
}
