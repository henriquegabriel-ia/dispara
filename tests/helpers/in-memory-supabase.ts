/**
 * Supabase em memória (com estado) para testes de unidade.
 *
 * Diferente de createMockQueryBuilder (resultado fixo), aqui as escritas valem para
 * as leituras seguintes. Cada instrução roda inteira e de forma ATÔMICA (como um
 * INSERT/UPDATE/DELETE no Postgres: ou aplica tudo, ou nada).
 *
 * O que imita do PostgREST/supabase-js:
 * - Builders preguiçosos e "thenable": nada roda até o `await`/`.then` (como o
 *   supabase-js). `insert/upsert/update/delete` aceitam `.select(cols)`, `.single()`,
 *   `.maybeSingle()`, `count` e `throwOnError()`.
 * - Filtros: eq, neq, gt, gte, lt, lte, like, ilike, is, in, contains, containedBy,
 *   overlaps, match, not(col, op, valor), filter(col, op, valor) e or('a.eq.1,b.is.null')
 *   no formato PostgREST (com and()/or() aninhados, `not.`, listas `in.(a,b)` e caminho
 *   JSON `input->>from`). Lógica de 3 valores do SQL: NULL nunca casa com eq/neq/gt/...
 * - Comparações: número com número numericamente; datas ISO cronologicamente; o resto
 *   como texto. Igualdade "frouxa" como o cast do Postgres (5 casa com '5').
 * - order() com vários critérios, nullsFirst (padrão do Postgres: ASC → NULLS LAST,
 *   DESC → NULLS FIRST), limit e range.
 * - select('a, b, alias:c, input->>from') projeta colunas; embeds (`rel(*)`) não são
 *   suportados — com embed a linha volta inteira.
 * - select(cols, { count: 'exact', head: true }) e delete/update/insert({ count }).
 * - single(): ≠1 linha → erro PGRST116. maybeSingle(): >1 linha → PGRST116 (como o
 *   PostgREST; desligue com `strictMaybeSingle: false`).
 * - JSONB: tudo é copiado (JSON) na escrita e (structuredClone) na leitura — nada de
 *   referência compartilhada entre o "banco" e o código. Chaves `undefined` somem
 *   (como no JSON do supabase-js), então o DEFAULT da coluna vale.
 * - Esquema opcional por tabela (veja DISPARA_SCHEMA): PK, UNIQUE (inclusive parcial,
 *   com WHERE), NOT NULL, CHECK, defaults/ids gerados, colunas conhecidas (coluna
 *   inexistente → erro PGRST204/42703) e FKs com ON DELETE CASCADE / SET NULL.
 *   Violação de UNIQUE → { code: '23505' } e o lote inteiro é descartado.
 * - rpc(nome, args) com handlers registráveis (embutidos: bulk_update_contact_tags,
 *   increment_campaign_auto_reply_counters, increment_campaign_stat).
 *
 * Para testes:
 * - failNext(tabela, msg, op?|{ op, times, code }) injeta falha por operação.
 * - onBefore(handler, { table, op }) roda antes de cada operação (pode ser async →
 *   barreiras para forçar corridas; pode devolver { data, error } para curto-circuitar).
 * - ops / rpcCalls / accessed registram o que o código fez.
 * - insert/update/delete/row/rows/count diretos (sem hooks nem falhas) para semear
 *   e inspecionar no meio do teste.
 *
 * @example
 * ```ts
 * const db = createInMemorySupabase({ settings: [{ key: 'x', value: '1' }] }, { settings: 'key' })
 * vi.mocked(getSupabaseAdmin).mockReturnValue(db.client as never)
 * db.rows('settings') // estado atual
 *
 * // Com o esquema do Dispara (PKs, UNIQUEs, defaults, cascades):
 * const db2 = createInMemorySupabase({}, {}, { schema: DISPARA_SCHEMA })
 *
 * // Mock do módulo inteiro (getSupabaseAdmin + facade `supabase`):
 * vi.mock('@/lib/supabase', async () =>
 *   (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
 * setActiveSupabase(db2)
 * ```
 */

import { vi } from 'vitest'

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>
export type DbOp = 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc'

export interface DbError {
  message: string
  code: string
  details: string | null
  hint: string | null
}

export interface DbResult<T = unknown> {
  data: T
  error: DbError | null
  count: number | null
  status: number
  statusText: string
}

export interface DefaultCtx {
  /** contador por tabela (1, 2, 3...) — use para ids determinísticos */
  seq: number
  /** new Date().toISOString() no momento da escrita (respeita fake timers) */
  now: string
  /** linha sendo inserida (já sem as chaves undefined) */
  row: Row
  table: string
}

/** Valor fixo (clonado por linha) ou função `(ctx) => valor`. */
export type DefaultSpec = Record<string, unknown>

export interface UniqueConstraint {
  name: string
  columns: string[]
  /** índice único PARCIAL: só participam as linhas que passam no predicado */
  where?: (row: Row) => boolean
}

export interface ForeignKey {
  column: string
  references: { table: string; column: string }
  onDelete: 'cascade' | 'set null' | 'restrict'
}

export interface TableSchema {
  /** PK (padrão 'id'). Entra como UNIQUE + NOT NULL. */
  primaryKey?: string | string[]
  /** colunas conhecidas: faltando no insert viram NULL; desconhecidas → erro */
  columns?: readonly string[]
  notNull?: readonly string[]
  /** DEFAULTs: objeto coluna → valor|((ctx) => valor), ou função (ctx) => linha parcial */
  defaults?: DefaultSpec | ((ctx: DefaultCtx) => Row)
  unique?: UniqueConstraint[]
  foreignKeys?: ForeignKey[]
  checks?: Array<{ name: string; test: (row: Row) => boolean }>
}

export type RpcHandler = (args: Record<string, unknown>, db: InMemorySupabase) => unknown | Promise<unknown>

export interface InMemorySupabaseOptions {
  schema?: Record<string, TableSchema>
  /** maybeSingle() com >1 linha devolve PGRST116 (padrão true, como o PostgREST) */
  strictMaybeSingle?: boolean
  /** select('a, b') devolve só as colunas pedidas (padrão true) */
  projectColumns?: boolean
  /** em tabelas com `columns` declaradas, coluna desconhecida vira erro (padrão true) */
  strictColumns?: boolean
  /** insert/upsert/update checam FK (23503). Padrão false (cascades valem sempre). */
  enforceForeignKeys?: boolean
  /** rpc sem handler: 'null' → { data: null } (padrão); 'error' → PGRST202 */
  unknownRpc?: 'null' | 'error'
  rpc?: Record<string, RpcHandler>
}

export interface FailNextOptions {
  op?: DbOp
  /** quantas operações falham (padrão 1; Infinity = sempre) */
  times?: number
  code?: string
  details?: string
}

export interface HookContext {
  table: string
  op: DbOp
  /** linhas do insert/upsert (já copiadas) */
  payload?: Row[]
  /** patch do update */
  patch?: Row
  /** args da rpc */
  args?: Record<string, unknown>
  db: InMemorySupabase
}

/** Devolver { data, error } curto-circuita a operação com esse resultado. */
export type HookHandler = (
  ctx: HookContext
) => void | Partial<DbResult> | Promise<void | Partial<DbResult>>

export interface OpLogEntry {
  table: string
  op: DbOp
  /** colunas do select/returning ('*' quando omitido) */
  columns: string | null
  filters: string[]
  count: string | null
}

export interface RpcCall {
  name: string
  args: Record<string, unknown>
}

export interface InMemoryClient {
  from: (table: string) => InMemoryQueryBuilder
  rpc: (
    name: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; count?: string; get?: boolean }
  ) => InMemoryQueryBuilder
  schema: (name: string) => InMemoryClient
}

export interface InMemorySupabase {
  client: InMemoryClient
  /** cópia profunda das linhas atuais */
  rows: (table: string) => Row[]
  /** primeira linha que casa (objeto = igualdade por coluna, ou predicado) */
  row: (table: string, match: Row | ((row: Row) => boolean)) => Row | undefined
  count: (table: string, match?: Row | ((row: Row) => boolean)) => number
  /** insert direto (defaults + constraints, sem hooks/falhas). Lança em violação. */
  insert: (table: string, rows: Row | Row[]) => Row[]
  /** update direto (sem hooks/falhas). Lança em violação. */
  update: (table: string, match: Row | ((row: Row) => boolean), patch: Row) => Row[]
  /** delete direto (com cascades). */
  delete: (table: string, match: Row | ((row: Row) => boolean)) => Row[]
  /** recomeça do zero (tabelas, sequências, falhas, hooks e logs) */
  reset: (seed?: Record<string, Row[]>) => void
  /**
   * A próxima operação na tabela falha com este erro. Sem op: qualquer operação
   * (compat). Para rpc, `table` é o nome da função.
   */
  failNext: (table: string, message: string, opts?: DbOp | FailNextOptions) => void
  clearFailures: () => void
  /** roda antes de cada operação (filtro opcional por tabela/op). Devolve o "unsubscribe". */
  onBefore: (handler: HookHandler, filter?: { table?: string; op?: DbOp | DbOp[] }) => () => void
  registerRpc: (name: string, handler: RpcHandler) => void
  /** chamadas de rpc, em ordem */
  rpcCalls: RpcCall[]
  /** operações executadas, em ordem */
  ops: OpLogEntry[]
  /** Tabelas acessadas via client.from, em ordem. */
  accessed: string[]
  schema: Record<string, TableSchema>
}

// ─── Utilitários de valor ──────────────────────────────────────────────────────

/** Semântica do JSON do supabase-js: undefined some, Date vira ISO, cópia profunda. */
function toWire<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function deepClone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value
  return structuredClone(value)
}

function pgError(code: string, message: string, details: string | null = null, hint: string | null = null): DbError {
  return { code, message, details, hint }
}

class DbErrorSignal extends Error {
  constructor(readonly dbError: DbError) {
    super(dbError.message)
  }
}

function fail(code: string, message: string, details: string | null = null): never {
  throw new DbErrorSignal(pgError(code, message, details))
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/
const NUMERIC_RE = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i

function isoTime(value: string): number | null {
  if (!ISO_RE.test(value)) return null
  let normalized = value.replace(' ', 'T')
  // Sem fuso = UTC (sessão do Supabase), não o fuso local do Node.
  if (/T\d{2}:\d{2}/.test(normalized) && !/(Z|[+-]\d{2}(:?\d{2})?)$/.test(normalized)) normalized += 'Z'
  const t = Date.parse(normalized)
  return Number.isNaN(t) ? null : t
}

function isNumericLike(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && NUMERIC_RE.test(value.trim()))
}

/** Ordem de dois valores NÃO nulos. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if ((typeof a === 'number' && isNumericLike(b)) || (typeof b === 'number' && isNumericLike(a))) {
    return Number(a) - Number(b)
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const as = typeof a === 'object' ? JSON.stringify(a) : String(a)
  const bs = typeof b === 'object' ? JSON.stringify(b) : String(b)
  const at = isoTime(as)
  const bt = isoTime(bs)
  if (at !== null && bt !== null) return at - bt
  return as < bs ? -1 : as > bs ? 1 : 0
}

/** Igualdade com o cast do Postgres; NULL nunca é igual a nada (nem a NULL). */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (a === b) return true
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  if (typeof a === 'number' || typeof b === 'number') {
    return isNumericLike(a) && isNumericLike(b) && Number(a) === Number(b)
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  const at = isoTime(String(a))
  const bt = isoTime(String(b))
  if (at !== null && bt !== null) return at === bt
  return String(a) === String(b)
}

/** Chave canônica para índices únicos. */
function keyPart(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    const t = isoTime(value)
    return t !== null ? `t:${t}` : value
  }
  return JSON.stringify(value)
}

function unquote(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return s
}

/** Divide por `sep` fora de parênteses/chaves/aspas. */
function splitTopLevel(input: string, sep = ','): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === '\\' && quoted) {
      current += ch + (input[i + 1] ?? '')
      i += 1
      continue
    }
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '(' || ch === '{' || ch === '[')) depth += 1
    else if (!quoted && (ch === ')' || ch === '}' || ch === ']')) depth -= 1
    if (ch === sep && depth === 0 && !quoted) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.length > 0 || out.length > 0) out.push(current)
  return out
}

/** Lê uma coluna, inclusive caminho JSON (`input->>from`, `data->a->>b`). */
function readColumn(row: Row, column: string): unknown {
  if (!column.includes('->')) return row[column]
  const parts = column.split(/(->>|->)/)
  let current: unknown = row[parts[0].trim()]
  let asText = false
  for (let i = 1; i < parts.length; i += 2) {
    const arrow = parts[i]
    const key = unquote(parts[i + 1] ?? '').replace(/^'(.*)'$/, '$1')
    if (current === null || current === undefined || typeof current !== 'object') {
      current = undefined
      break
    }
    current = Array.isArray(current) && /^-?\d+$/.test(key) ? current[Number(key)] : (current as Row)[key]
    asText = arrow === '->>'
  }
  if (current === undefined) return null
  if (asText && current !== null) return typeof current === 'object' ? JSON.stringify(current) : String(current)
  return current
}

/** Nome-base da coluna (sem caminho JSON nem cast). */
function baseColumn(column: string): string {
  return column.split('->')[0].split('::')[0].trim()
}

function likeRegex(pattern: string, caseInsensitive: boolean): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '%' || ch === '*') re += '[\\s\\S]*'
    else if (ch === '_') re += '[\\s\\S]'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, caseInsensitive ? 'i' : '')
}

function jsonContains(container: unknown, contained: unknown): boolean {
  if (Array.isArray(container)) {
    const list = Array.isArray(contained) ? contained : [contained]
    return list.every((item) =>
      container.some((c) =>
        typeof item === 'object' && item !== null ? jsonContains(c, item) : looseEquals(c, item)
      )
    )
  }
  if (container && typeof container === 'object') {
    if (!contained || typeof contained !== 'object' || Array.isArray(contained)) return false
    return Object.entries(contained as Row).every(([k, v]) => {
      const c = (container as Row)[k]
      return typeof v === 'object' && v !== null ? jsonContains(c, v) : looseEquals(c, v)
    })
  }
  return looseEquals(container, contained)
}

// ─── Predicados (lógica de 3 valores) ──────────────────────────────────────────

type Tri = boolean | null
type Pred = (row: Row) => Tri

const KNOWN_OPS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'ov',
  'contains', 'containedBy', 'overlaps', 'match', 'imatch', 'isdistinct',
])

/** Converte o valor textual do PostgREST (or/filter/not) para o valor do filtro. */
function parseTextValue(op: string, raw: string): unknown {
  const s = raw.trim()
  if (op === 'is') {
    const lower = s.toLowerCase()
    if (lower === 'null' || lower === 'unknown') return null
    if (lower === 'true') return true
    if (lower === 'false') return false
    return s
  }
  if (op === 'in') {
    const inner = s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s
    if (inner.trim() === '') return []
    return splitTopLevel(inner).map((v) => unquote(v))
  }
  if (op === 'cs' || op === 'cd' || op === 'ov') {
    if (s.startsWith('{') && !s.startsWith('{"') && s.endsWith('}')) {
      const inner = s.slice(1, -1)
      return inner.trim() === '' ? [] : splitTopLevel(inner).map((v) => unquote(v))
    }
    if (op === 'ov' && s.startsWith('(') && s.endsWith(')')) {
      return splitTopLevel(s.slice(1, -1)).map((v) => unquote(v))
    }
    try {
      return JSON.parse(s)
    } catch {
      return s
    }
  }
  return unquote(s)
}

function makePredicate(column: string, op: string, value: unknown): Pred {
  const get = (row: Row) => readColumn(row, column)
  switch (op) {
    case 'eq':
      return (r) => {
        const v = get(r)
        return v === null || v === undefined || value === null || value === undefined ? null : looseEquals(v, value)
      }
    case 'neq':
      return (r) => {
        const v = get(r)
        return v === null || v === undefined || value === null || value === undefined ? null : !looseEquals(v, value)
      }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return (r) => {
        const v = get(r)
        if (v === null || v === undefined || value === null || value === undefined) return null
        const c = compareValues(v, value)
        return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0
      }
    case 'like':
    case 'ilike': {
      const re = likeRegex(String(value ?? ''), op === 'ilike')
      return (r) => {
        const v = get(r)
        return v === null || v === undefined ? null : re.test(String(v))
      }
    }
    case 'match':
    case 'imatch': {
      const re = new RegExp(String(value ?? ''), op === 'imatch' ? 'i' : '')
      return (r) => {
        const v = get(r)
        return v === null || v === undefined ? null : re.test(String(v))
      }
    }
    case 'is':
      return (r) => {
        const v = get(r)
        if (value === null || value === undefined) return v === null || v === undefined
        return v === value
      }
    case 'isdistinct':
      return (r) => {
        const v = get(r)
        const vNull = v === null || v === undefined
        const valNull = value === null || value === undefined
        if (vNull || valNull) return vNull !== valNull
        return !looseEquals(v, value)
      }
    case 'in': {
      const list = Array.isArray(value) ? value : [value]
      return (r) => {
        const v = get(r)
        if (v === null || v === undefined) return null
        if (list.some((item) => looseEquals(v, item))) return true
        return list.some((item) => item === null || item === undefined) ? null : false
      }
    }
    case 'cs':
    case 'contains':
      return (r) => {
        const v = get(r)
        return v === null || v === undefined ? null : jsonContains(v, value)
      }
    case 'cd':
    case 'containedBy':
      return (r) => {
        const v = get(r)
        return v === null || v === undefined ? null : jsonContains(value, v)
      }
    case 'ov':
    case 'overlaps':
      return (r) => {
        const v = get(r)
        if (v === null || v === undefined) return null
        const a = Array.isArray(v) ? v : [v]
        const b = Array.isArray(value) ? value : [value]
        return a.some((x) => b.some((y) => looseEquals(x, y)))
      }
    default:
      throw new Error(`[in-memory-supabase] operador de filtro não suportado: "${op}"`)
  }
}

const notTri = (p: Pred): Pred => (r) => {
  const v = p(r)
  return v === null ? null : !v
}
const andTri = (preds: Pred[]): Pred => (r) => {
  let unknown = false
  for (const p of preds) {
    const v = p(r)
    if (v === false) return false
    if (v === null) unknown = true
  }
  return unknown ? null : true
}
const orTri = (preds: Pred[]): Pred => (r) => {
  let unknown = false
  for (const p of preds) {
    const v = p(r)
    if (v === true) return true
    if (v === null) unknown = true
  }
  return unknown ? null : false
}

/** Uma condição textual: `col.op.valor`, `col.not.op.valor`, `and(...)`, `not.or(...)`. */
function parseCondition(item: string, columns: string[]): Pred {
  const text = item.trim()
  const logic = /^(not\.)?(and|or)\(([\s\S]*)\)$/.exec(text)
  if (logic) {
    const inner = splitTopLevel(logic[3]).map((part) => parseCondition(part, columns))
    const combined = logic[2] === 'and' ? andTri(inner) : orTri(inner)
    return logic[1] ? notTri(combined) : combined
  }
  const segments = text.split('.')
  // A coluna pode ter pontos (embed "contato.nome"): acha o 1º segmento que é operador.
  let opIndex = -1
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i] === 'not' || KNOWN_OPS.has(segments[i])) {
      opIndex = i
      break
    }
  }
  if (opIndex < 0) throw new Error(`[in-memory-supabase] condição PostgREST inválida: "${text}"`)
  const column = segments.slice(0, opIndex).join('.')
  let negate = false
  let op = segments[opIndex]
  let valueStart = opIndex + 1
  if (op === 'not') {
    negate = true
    op = segments[opIndex + 1]
    valueStart = opIndex + 2
  }
  if (!KNOWN_OPS.has(op)) throw new Error(`[in-memory-supabase] operador não suportado em "${text}"`)
  columns.push(column)
  const value = parseTextValue(op, segments.slice(valueStart).join('.'))
  const pred = makePredicate(column, op, value)
  return negate ? notTri(pred) : pred
}

function matchToPredicate(match: Row | ((row: Row) => boolean)): (row: Row) => boolean {
  if (typeof match === 'function') return match
  return (row) => Object.entries(match).every(([k, v]) => (v === null ? row[k] === null || row[k] === undefined : looseEquals(row[k], v)))
}

// ─── Projeção ──────────────────────────────────────────────────────────────────

interface ProjectionToken {
  key: string
  column: string
  star: boolean
}

function parseProjection(columns: string | null): { tokens: ProjectionToken[]; hasEmbed: boolean } | null {
  if (columns === null) return null
  const tokens: ProjectionToken[] = []
  let hasEmbed = false
  for (const raw of splitTopLevel(columns)) {
    const t = raw.trim()
    if (!t) continue
    if (t.includes('(')) {
      hasEmbed = true
      continue
    }
    if (t === '*') {
      tokens.push({ key: '*', column: '*', star: true })
      continue
    }
    // alias:coluna (cuidado com o cast ::tipo)
    const aliasMatch = /^([A-Za-z_][\w]*)\s*:(?!:)\s*(.+)$/.exec(t)
    const alias = aliasMatch ? aliasMatch[1] : null
    const expr = (aliasMatch ? aliasMatch[2] : t).split('::')[0].trim()
    const pathParts = expr.split(/->>|->/)
    const key = alias ?? unquote(pathParts[pathParts.length - 1]).replace(/^'(.*)'$/, '$1')
    tokens.push({ key, column: expr, star: false })
  }
  return { tokens, hasEmbed }
}

// ─── Esquema do Dispara ─────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
const seqId = (prefix: string) => ({ seq }: DefaultCtx) => `${prefix}${seq}`
/** uuid v4 determinístico por sequência (00000000-0000-4000-8000-000000000001). */
export const sequentialUuid = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`

const ACTIVE_ENROLLMENT_STATUSES = new Set(['active', 'waiting'])

/**
 * Esquema das tabelas que o builder de workflows, o webhook e o cron tocam — extraído
 * de supabase/migrations (init + 20260705* + 20260709000000_ghl_parity). Tabelas com
 * `columns` são estritas (coluna inexistente vira erro, como no PostgREST).
 */
export const DISPARA_SCHEMA: Record<string, TableSchema> = {
  settings: {
    primaryKey: 'key',
    columns: ['key', 'value', 'updated_at'],
    notNull: ['value'],
    defaults: { updated_at: now },
  },
  workflows: {
    columns: [
      'id', 'name', 'description', 'status', 'owner_company_id', 'active_version_id', 'created_at',
      'updated_at', 'schedule_cron', 'schedule_timezone', 'schedule_active', 'schedule_next_run_at',
      'schedule_last_run_at', 'schedule_updated_at', 'settings',
    ],
    notNull: ['name', 'status', 'created_at', 'updated_at', 'schedule_active', 'settings'],
    defaults: { status: 'draft', settings: {}, schedule_active: false, created_at: now, updated_at: now },
    foreignKeys: [
      { column: 'active_version_id', references: { table: 'workflow_versions', column: 'id' }, onDelete: 'set null' },
    ],
  },
  workflow_versions: {
    columns: ['id', 'workflow_id', 'version', 'status', 'nodes', 'edges', 'created_at', 'updated_at', 'published_at', 'tree'],
    notNull: ['workflow_id', 'version', 'status', 'nodes', 'edges', 'created_at', 'updated_at'],
    defaults: { status: 'draft', created_at: now, updated_at: now },
    unique: [{ name: 'workflow_versions_workflow_version_idx', columns: ['workflow_id', 'version'] }],
    foreignKeys: [{ column: 'workflow_id', references: { table: 'workflows', column: 'id' }, onDelete: 'cascade' }],
  },
  workflow_runs: {
    columns: ['id', 'workflow_id', 'version_id', 'status', 'trigger_type', 'input', 'output', 'error', 'started_at', 'finished_at'],
    notNull: ['workflow_id', 'status', 'started_at'],
    defaults: { status: 'running', started_at: now },
    foreignKeys: [
      { column: 'workflow_id', references: { table: 'workflows', column: 'id' }, onDelete: 'cascade' },
      { column: 'version_id', references: { table: 'workflow_versions', column: 'id' }, onDelete: 'set null' },
    ],
  },
  workflow_run_logs: {
    columns: ['id', 'run_id', 'node_id', 'node_name', 'node_type', 'status', 'input', 'output', 'error', 'started_at', 'completed_at'],
    notNull: ['run_id', 'node_id', 'status', 'started_at'],
    // bigint serial: o supabase-js devolve number
    defaults: { id: ({ seq }: DefaultCtx) => seq, started_at: now },
    foreignKeys: [{ column: 'run_id', references: { table: 'workflow_runs', column: 'id' }, onDelete: 'cascade' }],
  },
  workflow_conversations: {
    columns: ['id', 'workflow_id', 'phone', 'status', 'resume_node_id', 'variable_key', 'variables', 'created_at', 'updated_at'],
    notNull: ['workflow_id', 'phone', 'status', 'created_at', 'updated_at'],
    defaults: { status: 'waiting', created_at: now, updated_at: now },
    foreignKeys: [{ column: 'workflow_id', references: { table: 'workflows', column: 'id' }, onDelete: 'cascade' }],
  },
  // SEM FK de propósito (igual à migration 20260705000300): sobra após apagar o workflow.
  workflow_enrollments: {
    columns: [
      'id', 'workflow_id', 'version_id', 'phone', 'contact_id', 'status', 'wait_kind', 'current_node_id',
      'resume_at', 'resume_node_id', 'variable_key', 'variables', 'resolved_nodes', 'outputs',
      'resume_node_ids', 'split_path', 'run_id', 'attempts', 'locked_at', 'locked_by', 'last_error',
      'created_at', 'updated_at',
    ],
    notNull: [
      'workflow_id', 'version_id', 'phone', 'status', 'variables', 'resolved_nodes', 'outputs',
      'resume_node_ids', 'attempts', 'created_at', 'updated_at',
    ],
    defaults: {
      id: ({ seq }: DefaultCtx) => sequentialUuid(seq),
      status: 'active',
      variables: {},
      resolved_nodes: [],
      outputs: {},
      resume_node_ids: [],
      attempts: 0,
      created_at: now,
      updated_at: now,
    },
    unique: [
      {
        name: 'ux_workflow_enrollments_active',
        columns: ['workflow_id', 'phone'],
        where: (row) => ACTIVE_ENROLLMENT_STATUSES.has(String(row.status)),
      },
    ],
  },
  processed_inbound_messages: {
    primaryKey: 'message_id',
    columns: ['message_id', 'created_at'],
    notNull: ['created_at'],
    defaults: { created_at: now },
  },
  contacts: {
    columns: ['id', 'name', 'phone', 'email', 'status', 'tags', 'notes', 'custom_fields', 'created_at', 'updated_at'],
    notNull: ['name', 'phone', 'created_at'],
    defaults: { id: seqId('ct_'), name: '', status: 'Opt-in', tags: [], custom_fields: {}, created_at: now },
    unique: [{ name: 'contacts_phone_key', columns: ['phone'] }],
  },
  pipelines: {
    columns: ['id', 'name', 'position', 'created_at', 'updated_at'],
    notNull: ['name', 'position', 'created_at'],
    defaults: { id: seqId('pl_'), position: 0, created_at: now },
  },
  pipeline_stages: {
    columns: ['id', 'pipeline_id', 'name', 'position', 'created_at'],
    notNull: ['pipeline_id', 'name', 'position', 'created_at'],
    defaults: { id: seqId('pls_'), position: 0, created_at: now },
    foreignKeys: [{ column: 'pipeline_id', references: { table: 'pipelines', column: 'id' }, onDelete: 'cascade' }],
  },
  opportunities: {
    columns: [
      'id', 'pipeline_id', 'stage_id', 'contact_id', 'phone', 'name', 'status', 'value', 'source',
      'stage_changed_at', 'created_at', 'updated_at',
    ],
    notNull: ['pipeline_id', 'stage_id', 'name', 'status', 'stage_changed_at', 'created_at'],
    defaults: { id: seqId('op_'), name: '', status: 'open', stage_changed_at: now, created_at: now },
    checks: [
      {
        name: 'opportunities_status_check',
        test: (row) => ['open', 'won', 'lost', 'abandoned'].includes(String(row.status)),
      },
    ],
    foreignKeys: [
      { column: 'pipeline_id', references: { table: 'pipelines', column: 'id' }, onDelete: 'cascade' },
      { column: 'stage_id', references: { table: 'pipeline_stages', column: 'id' }, onDelete: 'cascade' },
      { column: 'contact_id', references: { table: 'contacts', column: 'id' }, onDelete: 'set null' },
    ],
  },
  // Tabelas "frouxas" (sem lista de colunas: aceitam qualquer coluna).
  campaigns: {
    defaults: {
      id: seqId('c_'),
      status: 'Rascunho',
      created_at: now,
      total_recipients: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      skipped: 0,
      auto_reply_sent_count: 0,
      quick_reply_match_count: 0,
      fallback_sent_count: 0,
    },
  },
  campaign_contacts: {
    notNull: ['campaign_id', 'phone'],
    defaults: { id: seqId('cc_'), status: 'pending', custom_fields: {} },
    unique: [{ name: 'campaign_contacts_campaign_id_contact_id_key', columns: ['campaign_id', 'contact_id'] }],
    foreignKeys: [
      { column: 'campaign_id', references: { table: 'campaigns', column: 'id' }, onDelete: 'cascade' },
      { column: 'contact_id', references: { table: 'contacts', column: 'id' }, onDelete: 'set null' },
    ],
  },
  account_alerts: {
    defaults: { id: seqId('alert_'), dismissed: false, created_at: now },
  },
  phone_suppressions: {
    defaults: { id: seqId('ps_'), is_active: true, metadata: {}, created_at: now },
  },
  templates: {
    defaults: { id: seqId('tpl_'), language: 'pt_BR', parameter_format: 'positional', created_at: now },
  },
  webhook_debug_logs: {
    defaults: { id: ({ seq }: DefaultCtx) => seq, created_at: now },
  },
}

// ─── RPCs embutidas (fiéis às migrations) ─────────────────────────────────────

function jsonbElemText(el: unknown): string | null {
  if (el === null || el === undefined) return null
  if (typeof el === 'object') return JSON.stringify(el)
  return String(el)
}

/**
 * bulk_update_contact_tags (20260225000001): achata 1 nível de array aninhado,
 * descarta vazios (trim), une com as tags novas, DISTINCT, ORDER BY (ordem de bytes),
 * remove p_tags_to_remove. Devolve o ROW_COUNT.
 */
const bulkUpdateContactTags: RpcHandler = (args, db) => {
  const ids = (Array.isArray(args.p_ids) ? args.p_ids : []).map(String)
  const toAdd = (Array.isArray(args.p_tags_to_add) ? args.p_tags_to_add : []).map(jsonbElemText)
  const toRemove = new Set((Array.isArray(args.p_tags_to_remove) ? args.p_tags_to_remove : []).map(String))
  const updated = db.update('contacts', (r) => ids.includes(String(r.id)), {})
  let count = 0
  for (const contact of updated) {
    count += 1
    const existing = Array.isArray(contact.tags) ? contact.tags : []
    const flat: Array<string | null> = []
    for (const el of existing) {
      if (Array.isArray(el)) for (const sub of el) flat.push(jsonbElemText(sub))
      else flat.push(jsonbElemText(el))
    }
    const all = [...flat, ...toAdd].filter(
      (t): t is string => t !== null && t.trim().length > 0 && !toRemove.has(t)
    )
    const tags = Array.from(new Set(all)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    db.update('contacts', { id: contact.id }, { tags })
  }
  return count
}

const incrementCampaignAutoReplyCounters: RpcHandler = (args, db) => {
  const matchType = String(args.p_match_type)
  if (matchType !== 'quick' && matchType !== 'fallback') {
    throw new Error(`Invalid match_type: ${matchType}`)
  }
  const campaign = db.row('campaigns', { id: args.p_campaign_id as string })
  if (!campaign) return null
  db.update('campaigns', { id: campaign.id }, {
    auto_reply_sent_count: Number(campaign.auto_reply_sent_count ?? 0) + 1,
    quick_reply_match_count: Number(campaign.quick_reply_match_count ?? 0) + (matchType === 'quick' ? 1 : 0),
    fallback_sent_count: Number(campaign.fallback_sent_count ?? 0) + (matchType === 'fallback' ? 1 : 0),
  })
  return null
}

/** As duas assinaturas: (campaign_id_input, field) e (p_campaign_id, p_stat, p_value). */
const incrementCampaignStat: RpcHandler = (args, db) => {
  const id = (args.campaign_id_input ?? args.p_campaign_id) as string
  const field = String(args.field ?? args.p_stat ?? '')
  const by = args.p_value === undefined ? 1 : Number(args.p_value)
  if (args.campaign_id_input !== undefined && !['sent', 'delivered', 'read', 'failed'].includes(field)) return null
  const campaign = db.row('campaigns', { id })
  if (!campaign || !field) return null
  db.update('campaigns', { id }, { [field]: Number(campaign[field] ?? 0) + by })
  return null
}

const BUILTIN_RPCS: Record<string, RpcHandler> = {
  bulk_update_contact_tags: bulkUpdateContactTags,
  increment_campaign_auto_reply_counters: incrementCampaignAutoReplyCounters,
  increment_campaign_stat: incrementCampaignStat,
}

/** Marca o retorno de um RpcHandler como resultado completo ({ data, error }). */
export function rpcResult(data: unknown, error: Partial<DbError> | null = null): { __rpcResult: true; data: unknown; error: DbError | null } {
  return {
    __rpcResult: true,
    data,
    error: error ? pgError(error.code ?? 'P0001', error.message ?? 'rpc error', error.details ?? null, error.hint ?? null) : null,
  }
}

// ─── Builder ───────────────────────────────────────────────────────────────────

interface QuerySpec {
  table: string
  kind: DbOp
  columns: string | null
  returning: boolean
  countMode: string | null
  head: boolean
  payload: Row[]
  patch: Row
  onConflict: string | null
  ignoreDuplicates: boolean
  filters: Pred[]
  filterDescs: string[]
  filterColumns: string[]
  orders: Array<{ column: string; ascending: boolean; nullsFirst: boolean }>
  limit: number | null
  offset: number
  singleMode: 'single' | 'maybeSingle' | null
  rpcArgs: Record<string, unknown>
}

interface Engine {
  execute: (spec: QuerySpec) => Promise<DbResult>
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Query builder (from/rpc). É PromiseLike e também tem catch/finally, então pode ser
 * usado como Promise. Roda uma única vez (o resultado fica memorizado).
 */
export class InMemoryQueryBuilder implements PromiseLike<DbResult> {
  readonly [Symbol.toStringTag] = 'InMemoryQueryBuilder'
  private readonly spec: QuerySpec
  private shouldThrow = false
  private promise: Promise<DbResult> | null = null

  constructor(
    private readonly engine: Engine,
    table: string,
    kind: DbOp = 'select',
    rpcArgs: Record<string, unknown> = {}
  ) {
    this.spec = {
      table,
      kind,
      columns: null,
      returning: kind === 'rpc',
      countMode: null,
      head: false,
      payload: [],
      patch: {},
      onConflict: null,
      ignoreDuplicates: false,
      filters: [],
      filterDescs: [],
      filterColumns: [],
      orders: [],
      limit: null,
      offset: 0,
      singleMode: null,
      rpcArgs,
    }
  }

  // ── operação ──
  select(columns = '*', options?: { count?: string; head?: boolean }): this {
    if (this.spec.kind !== 'select') this.spec.returning = true
    this.spec.columns = columns
    if (options?.count) this.spec.countMode = options.count
    if (options?.head) this.spec.head = true
    return this
  }

  insert(values: Row | Row[], options?: { count?: string; defaultToNull?: boolean }): this {
    this.spec.kind = 'insert'
    this.spec.payload = Array.isArray(values) ? values : [values]
    if (options?.count) this.spec.countMode = options.count
    return this
  }

  upsert(
    values: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean; count?: string; defaultToNull?: boolean }
  ): this {
    this.spec.kind = 'upsert'
    this.spec.payload = Array.isArray(values) ? values : [values]
    this.spec.onConflict = options?.onConflict ?? null
    this.spec.ignoreDuplicates = options?.ignoreDuplicates === true
    if (options?.count) this.spec.countMode = options.count
    return this
  }

  update(values: Row, options?: { count?: string }): this {
    this.spec.kind = 'update'
    this.spec.patch = values
    if (options?.count) this.spec.countMode = options.count
    return this
  }

  delete(options?: { count?: string }): this {
    this.spec.kind = 'delete'
    if (options?.count) this.spec.countMode = options.count
    return this
  }

  // ── filtros ──
  private add(column: string, op: string, value: unknown, negate = false): this {
    const pred = makePredicate(column, op, value)
    this.spec.filters.push(negate ? notTri(pred) : pred)
    this.spec.filterDescs.push(`${column}.${negate ? 'not.' : ''}${op}.${describeValue(value)}`)
    this.spec.filterColumns.push(column)
    return this
  }

  eq(column: string, value: unknown): this {
    return this.add(column, 'eq', value)
  }
  neq(column: string, value: unknown): this {
    return this.add(column, 'neq', value)
  }
  gt(column: string, value: unknown): this {
    return this.add(column, 'gt', value)
  }
  gte(column: string, value: unknown): this {
    return this.add(column, 'gte', value)
  }
  lt(column: string, value: unknown): this {
    return this.add(column, 'lt', value)
  }
  lte(column: string, value: unknown): this {
    return this.add(column, 'lte', value)
  }
  like(column: string, pattern: string): this {
    return this.add(column, 'like', pattern)
  }
  ilike(column: string, pattern: string): this {
    return this.add(column, 'ilike', pattern)
  }
  is(column: string, value: null | boolean): this {
    return this.add(column, 'is', value)
  }
  in(column: string, values: readonly unknown[]): this {
    return this.add(column, 'in', [...values])
  }
  contains(column: string, value: unknown): this {
    return this.add(column, 'cs', typeof value === 'string' ? parseTextValue('cs', value) : value)
  }
  containedBy(column: string, value: unknown): this {
    return this.add(column, 'cd', typeof value === 'string' ? parseTextValue('cd', value) : value)
  }
  overlaps(column: string, value: unknown): this {
    return this.add(column, 'ov', typeof value === 'string' ? parseTextValue('ov', value) : value)
  }
  match(query: Row): this {
    for (const [k, v] of Object.entries(query)) this.add(k, 'eq', v)
    return this
  }
  /** `.not('col', 'is', null)`, `.not('status', 'in', '(a,b)')` */
  not(column: string, operator: string, value: unknown): this {
    const parsed = typeof value === 'string' ? parseTextValue(operator, value) : value
    return this.add(column, operator, parsed, true)
  }
  /** `.filter('col', 'in', '(a,b)')`, `.filter('col', 'not.is', null)` */
  filter(column: string, operator: string, value: unknown): this {
    const negate = operator.startsWith('not.')
    const op = negate ? operator.slice(4) : operator
    const parsed = typeof value === 'string' ? parseTextValue(op, value) : value
    return this.add(column, op, parsed, negate)
  }
  /** Sintaxe PostgREST: 'a.eq.1,b.is.null,and(c.gt.2,d.lt.3)', 'input->>from.eq.+55...' */
  or(filters: string, options?: { referencedTable?: string; foreignTable?: string }): this {
    if (options?.referencedTable || options?.foreignTable) return this // embeds não suportados
    const columns: string[] = []
    const preds = splitTopLevel(filters).filter((p) => p.trim()).map((p) => parseCondition(p, columns))
    this.spec.filters.push(orTri(preds))
    this.spec.filterDescs.push(`or(${filters})`)
    this.spec.filterColumns.push(...columns)
    return this
  }
  textSearch(): this {
    throw new Error('[in-memory-supabase] textSearch não é suportado')
  }

  // ── modificadores ──
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string }
  ): this {
    if (options?.referencedTable || options?.foreignTable) return this
    const ascending = options?.ascending !== false
    this.spec.orders.push({ column, ascending, nullsFirst: options?.nullsFirst ?? !ascending })
    this.spec.filterColumns.push(column)
    return this
  }
  limit(count: number, options?: { referencedTable?: string; foreignTable?: string }): this {
    if (options?.referencedTable || options?.foreignTable) return this
    this.spec.limit = count
    return this
  }
  range(from: number, to: number): this {
    this.spec.offset = from
    this.spec.limit = to - from + 1
    return this
  }
  single(): this {
    this.spec.singleMode = 'single'
    return this
  }
  maybeSingle(): this {
    this.spec.singleMode = 'maybeSingle'
    return this
  }
  throwOnError(): this {
    this.shouldThrow = true
    return this
  }
  abortSignal(): this {
    return this
  }
  returns(): this {
    return this
  }
  overrideTypes(): this {
    return this
  }
  csv(): this {
    throw new Error('[in-memory-supabase] csv() não é suportado')
  }
  explain(): this {
    throw new Error('[in-memory-supabase] explain() não é suportado')
  }

  // ── thenable ──
  private run(): Promise<DbResult> {
    if (!this.promise) {
      this.promise = this.engine.execute(this.spec).then((result) => {
        if (this.shouldThrow && result.error) {
          throw Object.assign(new Error(result.error.message), result.error)
        }
        return result
      })
    }
    return this.promise
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }

  catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<DbResult | TResult> {
    return this.run().catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<DbResult> {
    return this.run().finally(onfinally)
  }
}

// ─── Fábrica ───────────────────────────────────────────────────────────────────

interface FailureRule {
  table: string
  op: DbOp | null
  message: string
  code: string
  details: string | null
  remaining: number
}

interface HookEntry {
  handler: HookHandler
  table?: string
  ops?: DbOp[]
}

export function createInMemorySupabase(
  seed: Record<string, Row[]> = {},
  primaryKeys: Record<string, string> = {},
  options: InMemorySupabaseOptions = {}
): InMemorySupabase {
  const opts = {
    strictMaybeSingle: options.strictMaybeSingle ?? true,
    projectColumns: options.projectColumns ?? true,
    strictColumns: options.strictColumns ?? true,
    enforceForeignKeys: options.enforceForeignKeys ?? false,
    unknownRpc: options.unknownRpc ?? 'null',
  }
  const schema: Record<string, TableSchema> = {}
  for (const [name, def] of Object.entries(options.schema ?? {})) schema[name] = { ...def }
  for (const [name, pk] of Object.entries(primaryKeys)) schema[name] = { ...(schema[name] ?? {}), primaryKey: pk }

  const tables = new Map<string, Row[]>()
  const seqs = new Map<string, number>()
  const failures: FailureRule[] = []
  let hooks: HookEntry[] = []
  const rpcHandlers = new Map<string, RpcHandler>(Object.entries(BUILTIN_RPCS))
  for (const [name, handler] of Object.entries(options.rpc ?? {})) rpcHandlers.set(name, handler)
  const accessed: string[] = []
  const ops: OpLogEntry[] = []
  const rpcCalls: RpcCall[] = []

  // ── acesso ao estado ──
  const tableRows = (name: string): Row[] => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }
  const pkColumns = (name: string): string[] => {
    const pk = schema[name]?.primaryKey ?? 'id'
    return Array.isArray(pk) ? pk : [pk]
  }
  const nextSeq = (name: string): number => {
    const n = (seqs.get(name) ?? 0) + 1
    seqs.set(name, n)
    return n
  }

  // ── colunas ──
  const knownColumns = (name: string): Set<string> | null => {
    const cols = schema[name]?.columns
    return cols && opts.strictColumns ? new Set(cols) : null
  }
  const assertPayloadColumns = (name: string, rows: Row[]) => {
    const known = knownColumns(name)
    if (!known) return
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!known.has(key)) {
          fail('PGRST204', `Could not find the '${key}' column of '${name}' in the schema cache`)
        }
      }
    }
  }
  const assertReadColumns = (name: string, columns: string[]) => {
    const known = knownColumns(name)
    if (!known) return
    for (const column of columns) {
      const base = baseColumn(column)
      if (base.includes('.')) continue // embed (não suportado): não valida
      if (!known.has(base)) fail('42703', `column ${name}.${base} does not exist`)
    }
  }
  const assertProjection = (name: string, columns: string | null) => {
    const parsed = parseProjection(columns)
    if (!parsed || parsed.hasEmbed) return
    assertReadColumns(
      name,
      parsed.tokens.filter((t) => !t.star).map((t) => t.column)
    )
  }

  const project = (row: Row, columns: string | null): Row => {
    if (!opts.projectColumns) return deepClone(row)
    const parsed = parseProjection(columns)
    if (!parsed || parsed.hasEmbed) return deepClone(row)
    if (parsed.tokens.length === 0) return deepClone(row)
    const out: Row = {}
    for (const token of parsed.tokens) {
      if (token.star) Object.assign(out, deepClone(row))
      else {
        const value = readColumn(row, token.column)
        out[token.key] = value === undefined ? null : deepClone(value)
      }
    }
    return out
  }

  // ── defaults e constraints ──
  const withDefaults = (name: string, input: Row, taken: Row[]): Row => {
    const def = schema[name]
    const row: Row = { ...input }
    const pk = pkColumns(name)
    const pkProvided = pk.every((c) => row[c] !== undefined)
    const fill = () => {
      const seq = nextSeq(name)
      const ctx: DefaultCtx = { seq, now: new Date().toISOString(), row: { ...input }, table: name }
      if (typeof def?.defaults === 'function') {
        const extra = def.defaults(ctx)
        for (const [k, v] of Object.entries(extra)) if (input[k] === undefined) row[k] = deepClone(v)
      } else if (def?.defaults) {
        for (const [k, v] of Object.entries(def.defaults)) {
          if (input[k] !== undefined) continue
          row[k] = typeof v === 'function' ? (v as (c: DefaultCtx) => unknown)(ctx) : deepClone(v)
        }
      }
    }
    fill()
    // id gerado não pode colidir com linhas semeadas à mão ('ct_1' já existente etc.)
    if (!pkProvided && pk.length === 1) {
      for (let guard = 0; guard < 10_000; guard += 1) {
        const value = row[pk[0]]
        if (value === undefined || !taken.some((t) => looseEquals(t[pk[0]], value))) break
        fill()
      }
    }
    for (const col of def?.columns ?? []) if (row[col] === undefined) row[col] = null
    return row
  }

  const uniqueConstraints = (name: string): UniqueConstraint[] => {
    const pk = pkColumns(name)
    return [{ name: `${name}_pkey`, columns: pk }, ...(schema[name]?.unique ?? [])]
  }

  const foreignKeysTo = (parent: string): Array<{ table: string; fk: ForeignKey }> => {
    const out: Array<{ table: string; fk: ForeignKey }> = []
    for (const [table, def] of Object.entries(schema)) {
      for (const fk of def.foreignKeys ?? []) if (fk.references.table === parent) out.push({ table, fk })
    }
    return out
  }

  const checkConstraints = (name: string, nextRows: Row[], affected: Set<Row>) => {
    const def = schema[name]
    const pk = schema[name] ? pkColumns(name) : []
    const notNull = new Set([...(def?.notNull ?? []), ...pk])
    for (const row of affected) {
      for (const col of notNull) {
        if (row[col] === null || row[col] === undefined) {
          fail('23502', `null value in column "${col}" of relation "${name}" violates not-null constraint`)
        }
      }
      for (const check of def?.checks ?? []) {
        if (!check.test(row)) fail('23514', `new row for relation "${name}" violates check constraint "${check.name}"`)
      }
    }
    for (const constraint of uniqueConstraints(name)) {
      const seen = new Map<string, Row>()
      for (const row of nextRows) {
        if (constraint.where && !constraint.where(row)) continue
        const values = constraint.columns.map((c) => readColumn(row, c))
        if (values.some((v) => v === null || v === undefined)) continue // NULLs são distintos
        const key = values.map(keyPart).join('\u0000')
        const previous = seen.get(key)
        if (previous && (affected.has(row) || affected.has(previous))) {
          fail(
            '23505',
            `duplicate key value violates unique constraint "${constraint.name}"`,
            `Key (${constraint.columns.join(', ')})=(${values.map((v) => String(v)).join(', ')}) already exists.`
          )
        }
        seen.set(key, row)
      }
    }
    if (opts.enforceForeignKeys) {
      for (const fk of def?.foreignKeys ?? []) {
        for (const row of affected) {
          const value = row[fk.column]
          if (value === null || value === undefined) continue
          const parentRows = fk.references.table === name ? nextRows : tableRows(fk.references.table)
          if (!parentRows.some((p) => looseEquals(p[fk.references.column], value))) {
            fail(
              '23503',
              `insert or update on table "${name}" violates foreign key constraint "${name}_${fk.column}_fkey"`,
              `Key (${fk.column})=(${String(value)}) is not present in table "${fk.references.table}".`
            )
          }
        }
      }
    }
  }

  // ── operações (síncronas e atômicas) ──
  const doInsert = (name: string, payload: Row[]): Row[] => {
    const wire = payload.map((r) => toWire(r) ?? {})
    assertPayloadColumns(name, wire)
    const current = tableRows(name)
    const prepared: Row[] = []
    for (const row of wire) prepared.push(withDefaults(name, row, [...current, ...prepared]))
    const next = [...current, ...prepared]
    checkConstraints(name, next, new Set(prepared))
    tables.set(name, next)
    return prepared
  }

  const doUpsert = (name: string, payload: Row[], onConflict: string | null, ignoreDuplicates: boolean): Row[] => {
    const wire = payload.map((r) => toWire(r) ?? {})
    assertPayloadColumns(name, wire)
    const conflictCols = onConflict ? onConflict.split(',').map((c) => c.trim()).filter(Boolean) : pkColumns(name)
    const next = tableRows(name).slice()
    const touched = new Set<Row>()
    const affected: Row[] = []
    for (const row of wire) {
      const index = next.findIndex((existing) => conflictCols.every((c) => looseEquals(existing[c], row[c])))
      if (index >= 0) {
        if (ignoreDuplicates) continue
        if (touched.has(next[index])) {
          fail('21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time')
        }
        const merged = { ...next[index], ...row }
        next[index] = merged
        touched.add(merged)
        affected.push(merged)
      } else {
        const inserted = withDefaults(name, row, next)
        next.push(inserted)
        touched.add(inserted)
        affected.push(inserted)
      }
    }
    checkConstraints(name, next, touched)
    tables.set(name, next)
    return affected
  }

  const doUpdate = (name: string, patchInput: Row, predicate: (row: Row) => boolean): Row[] => {
    const patch = toWire(patchInput) ?? {}
    assertPayloadColumns(name, [patch])
    const affected: Row[] = []
    const next = tableRows(name).map((row) => {
      if (!predicate(row)) return row
      const updated = { ...row, ...deepClone(patch) }
      affected.push(updated)
      return updated
    })
    checkConstraints(name, next, new Set(affected))
    tables.set(name, next)
    return affected
  }

  const doDelete = (name: string, predicate: (row: Row) => boolean): Row[] => {
    const working = new Map<string, Row[]>()
    const get = (t: string) => working.get(t) ?? tableRows(t).slice()
    const current = get(name)
    const deleted = current.filter(predicate)
    working.set(name, current.filter((r) => !deleted.includes(r)))
    const queue: Array<{ table: string; rows: Row[] }> = [{ table: name, rows: deleted }]
    while (queue.length > 0) {
      const { table: parent, rows: parentRows } = queue.shift()!
      for (const { table: child, fk } of foreignKeysTo(parent)) {
        const refs = parentRows.map((r) => r[fk.references.column]).filter((v) => v !== null && v !== undefined)
        if (refs.length === 0) continue
        const children = get(child)
        const references = (c: Row) => refs.some((v) => looseEquals(c[fk.column], v))
        if (fk.onDelete === 'cascade') {
          const gone = children.filter(references)
          if (gone.length === 0) continue
          working.set(child, children.filter((c) => !gone.includes(c)))
          queue.push({ table: child, rows: gone })
        } else if (fk.onDelete === 'set null') {
          working.set(child, children.map((c) => (references(c) ? { ...c, [fk.column]: null } : c)))
        } else if (children.some(references)) {
          fail(
            '23503',
            `update or delete on table "${parent}" violates foreign key constraint "${child}_${fk.column}_fkey" on table "${child}"`
          )
        }
      }
    }
    for (const [t, rows] of working) tables.set(t, rows)
    return deleted
  }

  const sortRows = (rows: Row[], orders: QuerySpec['orders']): Row[] => {
    if (orders.length === 0) return rows
    return rows
      .map((row, index) => ({ row, index }))
      .sort((A, B) => {
        for (const o of orders) {
          const a = readColumn(A.row, o.column)
          const b = readColumn(B.row, o.column)
          const aNull = a === null || a === undefined
          const bNull = b === null || b === undefined
          if (aNull || bNull) {
            if (aNull && bNull) continue
            return (aNull ? -1 : 1) * (o.nullsFirst ? 1 : -1)
          }
          const c = compareValues(a, b)
          if (c !== 0) return o.ascending ? c : -c
        }
        return A.index - B.index
      })
      .map((x) => x.row)
  }

  // ── falhas e hooks ──
  const takeFailure = (table: string, op: DbOp): DbError | null => {
    const index = failures.findIndex((f) => f.table === table && (f.op === null || f.op === op))
    if (index < 0) return null
    const rule = failures[index]
    rule.remaining -= 1
    if (rule.remaining <= 0) failures.splice(index, 1)
    return pgError(rule.code, rule.message, rule.details)
  }

  const okResult = (data: unknown, count: number | null, status = 200): DbResult => ({
    data,
    error: null,
    count,
    status,
    statusText: status === 201 ? 'Created' : status === 204 ? 'No Content' : 'OK',
  })
  const errorResult = (error: DbError, status = 400): DbResult => ({
    data: null,
    error,
    count: null,
    status,
    statusText: status === 406 ? 'Not Acceptable' : status === 409 ? 'Conflict' : 'Bad Request',
  })

  const finalize = (spec: QuerySpec, rows: Row[] | null, count: number | null, status: number): DbResult => {
    if (rows === null) return okResult(null, count, status)
    let data: unknown = rows
    if (spec.singleMode) {
      if (rows.length === 1) data = rows[0]
      else if (rows.length === 0 && spec.singleMode === 'maybeSingle') data = null
      else if (rows.length > 1 && spec.singleMode === 'maybeSingle' && !opts.strictMaybeSingle) data = rows[0]
      else {
        return errorResult(
          pgError(
            'PGRST116',
            'JSON object requested, multiple (or no) rows returned',
            `The result contains ${rows.length} rows`
          ),
          406
        )
      }
    }
    return okResult(data, count, status)
  }

  const apply = (spec: QuerySpec, rpcData?: unknown): DbResult => {
    const name = spec.table
    const predicate = (row: Row) => spec.filters.every((f) => f(row) === true)
    const countOf = (n: number) => (spec.countMode ? n : null)
    const returned = (rows: Row[]) => {
      const sorted = sortRows(rows, spec.orders)
      const sliced = spec.limit !== null ? sorted.slice(spec.offset, spec.offset + spec.limit) : sorted.slice(spec.offset)
      return sliced.map((r) => project(r, spec.columns))
    }
    switch (spec.kind) {
      case 'select': {
        assertProjection(name, spec.columns)
        assertReadColumns(name, spec.filterColumns)
        const matched = tableRows(name).filter(predicate)
        return finalize(spec, spec.head ? null : returned(matched), countOf(matched.length), 200)
      }
      case 'insert': {
        if (spec.returning) assertProjection(name, spec.columns)
        const inserted = doInsert(name, spec.payload)
        return finalize(spec, spec.returning ? returned(inserted) : null, countOf(inserted.length), 201)
      }
      case 'upsert': {
        if (spec.returning) assertProjection(name, spec.columns)
        const affected = doUpsert(name, spec.payload, spec.onConflict, spec.ignoreDuplicates)
        return finalize(spec, spec.returning ? returned(affected) : null, countOf(affected.length), 201)
      }
      case 'update': {
        if (spec.returning) assertProjection(name, spec.columns)
        assertReadColumns(name, spec.filterColumns)
        const updated = doUpdate(name, spec.patch, predicate)
        return finalize(spec, spec.returning ? returned(updated) : null, countOf(updated.length), spec.returning ? 200 : 204)
      }
      case 'delete': {
        if (spec.returning) assertProjection(name, spec.columns)
        assertReadColumns(name, spec.filterColumns)
        const deleted = doDelete(name, predicate)
        return finalize(spec, spec.returning ? returned(deleted) : null, countOf(deleted.length), spec.returning ? 200 : 204)
      }
      case 'rpc': {
        if (Array.isArray(rpcData)) {
          const rows = (rpcData as Row[]).filter(predicate)
          return finalize(spec, spec.head ? null : returned(rows), countOf(rows.length), 200)
        }
        if (spec.singleMode === 'single' && (rpcData === null || rpcData === undefined)) {
          return finalize(spec, [], null, 200)
        }
        return okResult(rpcData ?? null, null, 200)
      }
    }
  }

  const engine: Engine = {
    execute: async (spec) => {
      const isRpc = spec.kind === 'rpc'
      ops.push({
        table: spec.table,
        op: spec.kind,
        columns: spec.kind === 'select' || spec.returning ? (spec.columns ?? '*') : null,
        filters: [...spec.filterDescs],
        count: spec.countMode,
      })
      if (isRpc) rpcCalls.push({ name: spec.table, args: deepClone(spec.rpcArgs) })
      // Cede o turno como um round-trip de rede (e dá lugar aos hooks async).
      await Promise.resolve()
      for (const hook of hooks) {
        if (hook.table && hook.table !== spec.table) continue
        if (hook.ops && !hook.ops.includes(spec.kind)) continue
        const override = await hook.handler({
          table: spec.table,
          op: spec.kind,
          payload: spec.payload.length > 0 ? spec.payload.map((r) => toWire(r) ?? {}) : undefined,
          patch: spec.kind === 'update' ? toWire(spec.patch) : undefined,
          args: isRpc ? deepClone(spec.rpcArgs) : undefined,
          db: api,
        })
        if (override && typeof override === 'object' && ('data' in override || 'error' in override)) {
          return {
            data: override.data ?? null,
            error: override.error ?? null,
            count: override.count ?? null,
            status: override.status ?? (override.error ? 400 : 200),
            statusText: override.statusText ?? (override.error ? 'Bad Request' : 'OK'),
          }
        }
      }
      const failure = takeFailure(spec.table, spec.kind)
      if (failure) return errorResult(failure, 400)
      try {
        if (isRpc) {
          const handler = rpcHandlers.get(spec.table)
          if (!handler) {
            if (opts.unknownRpc === 'error') {
              return errorResult(
                pgError('PGRST202', `Could not find the function public.${spec.table} in the schema cache`),
                404
              )
            }
            return apply(spec, null)
          }
          let out: unknown
          try {
            out = await handler(deepClone(spec.rpcArgs), api)
          } catch (error) {
            if (error instanceof DbErrorSignal) throw error
            return errorResult(pgError('P0001', error instanceof Error ? error.message : String(error)), 400)
          }
          if (out && typeof out === 'object' && (out as { __rpcResult?: boolean }).__rpcResult) {
            const r = out as { data: unknown; error: DbError | null }
            return r.error ? errorResult(r.error) : apply(spec, deepClone(r.data))
          }
          return apply(spec, deepClone(out))
        }
        return apply(spec)
      } catch (error) {
        if (error instanceof DbErrorSignal) {
          const code = error.dbError.code
          return errorResult(error.dbError, code === '23505' || code === '23503' ? 409 : 400)
        }
        throw error
      }
    },
  }

  const client: InMemoryClient = {
    from: (table: string) => {
      accessed.push(table)
      return new InMemoryQueryBuilder(engine, table)
    },
    rpc: (name, args = {}, rpcOptions) => {
      const builder = new InMemoryQueryBuilder(engine, name, 'rpc', args ?? {})
      if (rpcOptions?.count) builder.select('*', { count: rpcOptions.count, head: rpcOptions.head })
      return builder
    },
    schema: () => client,
  }

  const directSignal = (fn: () => Row[]): Row[] => {
    try {
      return fn().map((r) => deepClone(r))
    } catch (error) {
      if (error instanceof DbErrorSignal) {
        throw Object.assign(new Error(`[in-memory-supabase] ${error.dbError.message}`), error.dbError)
      }
      throw error
    }
  }

  const loadSeed = (data: Record<string, Row[]>) => {
    for (const [name, rows] of Object.entries(data)) {
      tableRows(name)
      try {
        doInsert(name, rows)
      } catch (error) {
        if (error instanceof DbErrorSignal) {
          throw new Error(`[in-memory-supabase] seed inválido em "${name}": ${error.dbError.message} ${error.dbError.details ?? ''}`)
        }
        throw error
      }
    }
  }

  const api: InMemorySupabase = {
    client,
    rows: (name) => tableRows(name).map((r) => deepClone(r)),
    row: (name, match) => {
      const found = tableRows(name).find(matchToPredicate(match))
      return found ? deepClone(found) : undefined
    },
    count: (name, match) => (match ? tableRows(name).filter(matchToPredicate(match)).length : tableRows(name).length),
    insert: (name, rows) => directSignal(() => doInsert(name, Array.isArray(rows) ? rows : [rows])),
    update: (name, match, patch) => directSignal(() => doUpdate(name, patch, matchToPredicate(match))),
    delete: (name, match) => directSignal(() => doDelete(name, matchToPredicate(match))),
    reset: (nextSeed = {}) => {
      tables.clear()
      seqs.clear()
      failures.splice(0)
      hooks = []
      accessed.splice(0)
      ops.splice(0)
      rpcCalls.splice(0)
      loadSeed(nextSeed)
    },
    failNext: (table, message, opArg) => {
      const o: FailNextOptions = typeof opArg === 'string' ? { op: opArg } : (opArg ?? {})
      failures.push({
        table,
        op: o.op ?? null,
        message,
        code: o.code ?? '',
        details: o.details ?? null,
        remaining: o.times ?? 1,
      })
    },
    clearFailures: () => {
      failures.splice(0)
    },
    onBefore: (handler, filter) => {
      const entry: HookEntry = {
        handler,
        table: filter?.table,
        ops: filter?.op ? (Array.isArray(filter.op) ? filter.op : [filter.op]) : undefined,
      }
      hooks.push(entry)
      return () => {
        hooks = hooks.filter((h) => h !== entry)
      }
    },
    registerRpc: (name, handler) => {
      rpcHandlers.set(name, handler)
    },
    rpcCalls,
    ops,
    accessed,
    schema,
  }

  loadSeed(seed)
  return api
}

// ─── Mock do módulo @/lib/supabase ─────────────────────────────────────────────

let activeDb: InMemorySupabase | null = null

/** Define qual banco em memória o supabaseModuleMock() expõe (null = "não configurado"). */
export function setActiveSupabase(db: InMemorySupabase | null): void {
  activeDb = db
}

export function getActiveSupabase(): InMemorySupabase | null {
  return activeDb
}

/**
 * Forma do módulo `@/lib/supabase` apontando para o banco ativo (setActiveSupabase).
 * Cobre getSupabaseAdmin, a facade `supabase` (from/rpc — usada por settingsDb e
 * pelo webhook), isSupabaseConfigured e getSupabaseBrowser.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/supabase', async () =>
 *   (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
 * ```
 */
export function supabaseModuleMock() {
  const admin = () => activeDb?.client ?? null
  const requireClient = () => {
    const c = admin()
    if (!c) throw new Error('Supabase not configured. Complete setup at /install')
    return c
  }
  return {
    getSupabaseAdmin: vi.fn(() => admin()),
    getSupabaseBrowser: vi.fn(() => null),
    isSupabaseConfigured: vi.fn(() => activeDb !== null),
    checkSupabaseConnection: vi.fn(async () => ({ connected: activeDb !== null, latency: 0 })),
    supabase: {
      get admin() {
        return admin()
      },
      get browser() {
        return null
      },
      from: (table: string) => requireClient().from(table),
      rpc: (fn: string, params?: Record<string, unknown>) => requireClient().rpc(fn, params),
      execute: async () => ({ rows: [], rowsAffected: 0 }),
    },
  }
}
