import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DB_BROADCAST_TABLES } from '@/lib/realtime-db-change'

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations')
const HARDENING_FILE = '20261011000000_security_hardening.sql'

function readMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')
}

/** Remove comentários `--` e normaliza espaços (para casar statements). */
function normalizeSql(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Corpo ($$ ... $$) da função dispara_broadcast_change. */
function broadcastFunctionBody(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.dispara_broadcast_change()')
  expect(start).toBeGreaterThanOrEqual(0)
  const bodyStart = sql.indexOf('$$', start)
  const bodyEnd = sql.indexOf('$$', bodyStart + 2)
  expect(bodyStart).toBeGreaterThan(start)
  expect(bodyEnd).toBeGreaterThan(bodyStart)
  return sql.slice(bodyStart + 2, bodyEnd)
}

interface Projection {
  /** Colunas de `new` (INSERT/UPDATE) */
  new: string[]
  /** Colunas de `old` (UPDATE/DELETE) */
  old: string[]
}

/** Chaves de `<variable> := jsonb_build_object('col', <RECORD>.col, ...)` num trecho. */
function projectionKeys(chunk: string, variable: 'v_new' | 'v_old', record: 'NEW' | 'OLD', table: string): string[] {
  const match = new RegExp(`${variable} := jsonb_build_object\\(([^)]*)\\);`).exec(chunk)
  if (!match) return []
  const args = match[1]
    .split(',')
    .map((arg) => arg.trim())
    .filter(Boolean)
  expect(args.length % 2, `${table}.${variable}: pares chave/valor`).toBe(0)

  const keys: string[] = []
  for (let i = 0; i < args.length; i += 2) {
    const key = /^'([a-z_]+)'$/.exec(args[i])?.[1]
    expect(key, `${table}.${variable}: chave literal`).toBeDefined()
    // Valor é SEMPRE a própria coluna (sem expressão, sem renomear, sem linha inteira)
    expect(args[i + 1], `${table}.${variable}.${key}`).toBe(`${record}.${key}`)
    keys.push(key!)
  }
  return keys
}

/** Projeção explícita por tabela: { campaigns: { new: ['id', ...], old: ['id', ...] }, ... } */
function parseProjections(body: string): Record<string, Projection> {
  const result: Record<string, Projection> = {}
  // [antes, tabela1, trecho1, tabela2, trecho2, ...]
  const parts = body.split(/(?:ELSIF|IF) TG_TABLE_NAME = '([a-z_]+)' THEN/)
  for (let i = 1; i < parts.length; i += 2) {
    const table = parts[i]
    const chunk = parts[i + 1]
    result[table] = {
      new: projectionKeys(chunk, 'v_new', 'NEW', table),
      old: projectionKeys(chunk, 'v_old', 'OLD', table),
    }
  }
  return result
}

interface TriggerSpec {
  table: string
  name: string
  /** Definição depois do nome (`AFTER ... EXECUTE FUNCTION ...`), espaços normalizados */
  definition: string
}

/**
 * Triggers declaradas na lista `(tabela, trigger, $d$definição$d$)` do DO block de broadcast
 * (a migration cria cada uma com `CREATE OR REPLACE TRIGGER <nome> <definição>`).
 */
function parseTriggerSpecs(raw: string): TriggerSpec[] {
  const specs: TriggerSpec[] = []
  for (const match of raw.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*\$d\$([\s\S]*?)\$d\$\)/g)) {
    specs.push({ table: match[1], name: match[2], definition: match[3].replace(/\s+/g, ' ').trim() })
  }
  return specs
}

function triggerDefinition(specs: TriggerSpec[], table: string, name: string): string {
  const found = specs.filter((spec) => spec.table === table && spec.name === name)
  expect(found, `trigger ${name} ON public.${table}`).toHaveLength(1)
  return found[0].definition
}

// -----------------------------------------------------------------------------
// Mini avaliador das triggers (eventos, nível e WHEN) para simular o volume em
// realtime.messages. Cobre só o subconjunto de SQL usado nos WHEN das tabelas do inbox:
// OLD.col / NEW.col, NEW.col ->> 'chave', literais, tuplas, IS DISTINCT FROM, AND, OR.
// -----------------------------------------------------------------------------

type SqlValue = unknown
type Row = Record<string, unknown>

interface ParsedTrigger {
  events: string[]
  level: 'ROW' | 'STATEMENT'
  when: string | null
}

function parseTrigger(definition: string): ParsedTrigger {
  const match = /^AFTER ((?:INSERT|UPDATE|DELETE)(?: OR (?:INSERT|UPDATE|DELETE))*) ON public\.[a-z_]+ FOR EACH (ROW|STATEMENT)(?: WHEN \((.*)\))? EXECUTE FUNCTION public\.dispara_broadcast_change\(\)$/.exec(
    definition
  )
  expect(match, `definição de trigger inesperada: ${definition}`).not.toBeNull()
  return { events: match![1].split(' OR '), level: match![2] as ParsedTrigger['level'], when: match![3] ?? null }
}

function tokenize(expression: string): string[] {
  const tokens = expression.match(/'[^']*'|->>|<>|[(),]|[A-Za-z_][A-Za-z0-9_.]*/g) ?? []
  return tokens
}

function evaluateWhen(expression: string, oldRow: Row | null, newRow: Row | null): boolean {
  const tokens = tokenize(expression)
  let pos = 0
  const peek = () => tokens[pos]
  const take = (expected?: string) => {
    const token = tokens[pos++]
    if (expected !== undefined && token?.toUpperCase() !== expected) {
      throw new Error(`esperado ${expected}, veio ${token} em: ${expression}`)
    }
    return token
  }

  const distinct = (a: SqlValue, b: SqlValue): boolean => {
    if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length || a.some((v, i) => distinct(v, b[i]))
    const na = a === undefined ? null : a
    const nb = b === undefined ? null : b
    return JSON.stringify(na) !== JSON.stringify(nb)
  }

  const primary = (): SqlValue => {
    const token = take()
    if (token === '(') {
      const items = [orExpr()]
      while (peek() === ',') {
        take(',')
        items.push(orExpr())
      }
      take(')')
      return items.length === 1 ? items[0] : items
    }
    if (token.startsWith("'")) return token.slice(1, -1)
    if (token.toUpperCase() === 'NULL') return null
    const ref = /^(OLD|NEW)\.([a-z_]+)$/.exec(token)
    if (!ref) throw new Error(`token não suportado: ${token} em: ${expression}`)
    const row = ref[1] === 'OLD' ? oldRow : newRow
    if (!row) throw new Error(`${ref[1]} indisponível neste evento: ${expression}`)
    let value: SqlValue = row[ref[2]]
    if (peek() === '->>') {
      take('->>')
      const key = take().slice(1, -1)
      value = value && typeof value === 'object' ? ((value as Row)[key] ?? null) : null
      if (value !== null) value = String(value)
    }
    return value
  }

  const comparison = (): SqlValue => {
    const left = primary()
    if (peek()?.toUpperCase() === 'IS') {
      take('IS')
      take('DISTINCT')
      take('FROM')
      return distinct(left, primary())
    }
    return left
  }

  const andExpr = (): SqlValue => {
    let value = comparison()
    while (peek()?.toUpperCase() === 'AND') {
      take('AND')
      const right = comparison()
      value = value === false || right === false ? false : value === true && right === true ? true : null
    }
    return value
  }

  function orExpr(): SqlValue {
    let value = andExpr()
    while (peek()?.toUpperCase() === 'OR') {
      take('OR')
      const right = andExpr()
      value = value === true || right === true ? true : value === false && right === false ? false : null
    }
    return value
  }

  const result = orExpr()
  if (pos !== tokens.length) throw new Error(`sobrou expressão: ${tokens.slice(pos).join(' ')}`)
  return result === true
}

interface TableWrite {
  table: string
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  rows: Array<{ old: Row | null; new: Row | null }>
}

/** Quantos eventos (linhas em realtime.messages) um statement gera com as triggers dadas. */
function countBroadcastEvents(specs: TriggerSpec[], write: TableWrite): number {
  let events = 0
  for (const spec of specs.filter((s) => s.table === write.table)) {
    const trigger = parseTrigger(spec.definition)
    if (!trigger.events.includes(write.op)) continue
    if (trigger.level === 'STATEMENT') {
      events += 1
      continue
    }
    for (const row of write.rows) {
      if (!trigger.when || evaluateWhen(trigger.when, row.old, row.new)) events += 1
    }
  }
  return events
}

// Nomes de coluna que NUNCA podem sair pelo canal público.
const FORBIDDEN_COLUMNS = ['phone', 'name', 'email', 'content', 'body', 'custom_fields', 'text', 'message']

// Outras colunas com PII/dados de negócio/segredos que também não podem vazar.
const ALSO_SENSITIVE = [
  'from_phone',
  'last_message_preview',
  'handoff_summary',
  'automation_paused_by',
  'notes',
  'tags',
  'details',
  'title',
  'prompt',
  'user_id',
  'payload',
  'media_url',
  'button_payload',
  'whatsapp_message_id',
  'message_id',
  'failure_reason',
  'ai_sources',
  'response_json',
  'response_json_raw',
  'mapped_data',
  'flow_token',
  'template_name',
  'flow_name',
  'template_variables',
  'template_snapshot',
  'quick_reply_responses',
  'fallback_response',
  'components',
  'spec',
  'flow_json',
  'mapping',
  'meta_preview_url',
  'rejected_reason',
  'sample_variables',
  'marketing_variables',
  'variables',
  'header',
  'footer',
  'buttons',
]

describe('migration 20261011000000_security_hardening.sql', () => {
  const raw = readMigration(HARDENING_FILE)
  const sql = normalizeSql(raw)

  it('não cria nenhuma policy de leitura anônima irrestrita', () => {
    expect(sql).not.toMatch(/TO anon USING \(true\)/i)
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })

  it('remove as 7 policies anon_select_*', () => {
    for (const table of [
      'campaigns',
      'contacts',
      'templates',
      'flows',
      'inbox_conversations',
      'inbox_messages',
      'account_alerts',
    ]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "anon_select_${table}" ON public.${table};`)
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated;`)
    }
  })

  it('DROP POLICY (ACCESS EXCLUSIVE nas 7 tabelas quentes) fica por último, depois do REVOKE', () => {
    const firstDropPolicy = sql.indexOf('DROP POLICY')
    // Nada que pegue lock ou espere depois dele: só os outros DROP POLICY até o fim
    expect(sql.slice(firstDropPolicy)).toMatch(/^(DROP POLICY IF EXISTS "anon_select_[a-z_]+" ON public\.[a-z_]+; ?)+$/)
    for (const marker of [
      'ENABLE ROW LEVEL SECURITY',
      'CREATE OR REPLACE TRIGGER',
      'ALTER PUBLICATION',
      'REVOKE EXECUTE ON ALL FUNCTIONS',
      'ALTER DEFAULT PRIVILEGES',
    ]) {
      expect(sql.lastIndexOf(marker), marker).toBeLessThan(firstDropPolicy)
    }
    // O acesso de anon fecha ANTES (vale até para quem aplicar fora de transação)
    expect(sql.indexOf('REVOKE ALL ON TABLE public.campaigns FROM anon, authenticated;')).toBeLessThan(firstDropPolicy)
  })

  it('nenhum bloco de exceção de DDL engole erro de lock: lock_timeout aborta a migration inteira', () => {
    // Fora da função de broadcast (best-effort por definição), todo handler é estreito
    // ou relança lock_not_available/deadlock antes do WHEN OTHERS.
    const body = broadcastFunctionBody(raw)
    const ddl = normalizeSql(raw.replace(body, ''))

    const handlers = ddl.match(/EXCEPTION WHEN [\s\S]*? END;/g) ?? []
    expect(handlers.length).toBe(3)
    for (const handler of handlers) {
      if (!handler.includes('WHEN OTHERS')) continue
      expect(handler, handler).toMatch(/^EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE; WHEN OTHERS THEN/)
    }
    expect(handlers.some((h) => /WHEN (lock_not_available|deadlock_detected|query_canceled)[^;]*THEN RAISE WARNING/.test(h))).toBe(false)

    // ENABLE RLS: só pula tabela de outro dono
    expect(ddl).toContain(
      "EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname); EXCEPTION WHEN insufficient_privilege THEN RAISE WARNING"
    )
    // Publicação: só "já saiu/não existe" e permissão
    expect(ddl).toContain(
      "EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', r.schemaname, r.tablename); EXCEPTION WHEN undefined_object OR undefined_table OR insufficient_privilege THEN RAISE WARNING"
    )
    // ALTER FUNCTION: relança lock/deadlock
    expect(ddl).toContain(
      "EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.signature); EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE; WHEN OTHERS THEN RAISE WARNING"
    )
  })

  it('limita a espera por lock (lock_timeout) e a duração dos statements antes de qualquer DDL', () => {
    const lockTimeout = sql.indexOf("SET LOCAL lock_timeout = '5s';")
    const statementTimeout = sql.indexOf("SET LOCAL statement_timeout = '60s';")
    expect(lockTimeout).toBeGreaterThanOrEqual(0)
    expect(statementTimeout).toBeGreaterThanOrEqual(0)

    // Antes do primeiro statement que pega lock em tabela
    const firstDdl = sql.search(/DROP POLICY|REVOKE|ALTER TABLE|CREATE TRIGGER|DROP TRIGGER/)
    expect(firstDdl).toBeGreaterThan(lockTimeout)
    expect(firstDdl).toBeGreaterThan(statementTimeout)

    // O cabeçalho documenta a janela de baixo tráfego e que re-executar é seguro
    expect(raw).toMatch(/BAIXO TRÁFEGO/)
    expect(raw).toMatch(/SEGURO DE RE-EXECUTAR/)
  })

  it('só liga RLS (ACCESS EXCLUSIVE) nas tabelas que ainda não têm', () => {
    expect(sql).toContain('SELECT c.oid, c.relname, c.relkind, c.relrowsecurity FROM pg_class c')
    expect(sql).toContain(
      "IF r.relkind IN ('r', 'p') AND NOT r.relrowsecurity THEN BEGIN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);"
    )
  })

  it('revoga anon/authenticated de TODAS as tabelas de public via inventário dinâmico', () => {
    expect(sql).toMatch(/FROM pg_class c JOIN pg_namespace n ON n\.oid = c\.relnamespace WHERE n\.nspname = 'public'/)
    expect(sql).toContain("EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', r.relname);")
    expect(sql).toContain("EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);")
    expect(sql).toContain('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;')
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;')
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;')
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON [^;]* TO (anon|authenticated)\b/i)
  })

  it('revoga EXECUTE em funções de PUBLIC/anon/authenticated e mantém service_role', () => {
    expect(sql).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;')
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;'
    )
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;')

    // O REVOKE geral vem DEPOIS da criação da função de broadcast (cobre ela também).
    expect(sql.indexOf('REVOKE EXECUTE ON ALL FUNCTIONS')).toBeGreaterThan(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.dispara_broadcast_change()')
    )
  })

  it('fixa search_path das SECURITY DEFINER que não têm', () => {
    expect(sql).toMatch(/AND p\.prosecdef/)
    expect(sql).toContain("EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.signature);")
  })

  describe('broadcast realtime (dispara_broadcast_change)', () => {
    const body = broadcastFunctionBody(raw)
    const normalizedBody = normalizeSql(body)
    const projections = parseProjections(body)

    it('é SECURITY DEFINER com search_path fixo', () => {
      const header = normalizeSql(raw.slice(raw.indexOf('CREATE OR REPLACE FUNCTION public.dispara_broadcast_change()'), raw.indexOf(body)))
      expect(header).toMatch(/SECURITY DEFINER/)
      expect(header).toMatch(/SET search_path = ''/)
    })

    it('publica no canal público dispara-db, evento db_change', () => {
      expect(normalizedBody).toMatch(/PERFORM realtime\.send\( jsonb_build_object\(/)
      expect(normalizedBody).toContain("'db_change', 'dispara-db', false );")
    })

    it('payload só usa as projeções explícitas (nunca a linha inteira)', () => {
      const build = /PERFORM realtime\.send\(\s*jsonb_build_object\(([\s\S]*?)\),\s*'db_change'/.exec(body)
      expect(build).not.toBeNull()
      const args = normalizeSql(build![1])
      expect(args).toBe(
        "'table', TG_TABLE_NAME, 'eventType', TG_OP, 'new', v_new, 'old', v_old, 'commit_timestamp', now()"
      )

      // to_jsonb(NEW)/row_to_json destoastam template_snapshot, components, content... a cada escrita
      expect(normalizedBody).not.toMatch(/to_jsonb\s*\(/i)
      expect(normalizedBody).not.toMatch(/row_to_json|jsonb_each|hstore/i)
      // v_new/v_old só recebem jsonb_build_object com colunas explícitas
      const assignments = normalizedBody.match(/v_(?:new|old) := [^;]*;/g) ?? []
      expect(assignments.length).toBeGreaterThan(0)
      for (const assignment of assignments) {
        expect(assignment).toMatch(/^v_(?:new|old) := jsonb_build_object\( ?(?:'[a-z_]+', (?:NEW|OLD)\.[a-z_]+(?:, )?)+ ?\);$/)
      }
    })

    it('campaigns: payload com colunas explícitas e old só com id/status/completed_at', () => {
      expect(projections.campaigns.new).toEqual(
        expect.arrayContaining(['id', 'status', 'sent', 'delivered', 'read', 'failed', 'completed_at', 'cancelled_at'])
      )
      // old enxuto: só o que useRealtimeNotifications usa para detectar a transição
      expect(projections.campaigns.old).toEqual(['id', 'status', 'completed_at'])
      for (const big of ['template_snapshot', 'ab_template_snapshot_b', 'template_variables', 'quick_reply_responses']) {
        expect(projections.campaigns.new).not.toContain(big)
        expect(normalizedBody).not.toContain(`NEW.${big}`)
      }
    })

    it('tem projeção para todas as tabelas com trigger por linha, e só para elas', () => {
      const tables = Object.keys(projections).sort()
      // contacts só tem trigger por statement (sem linha)
      expect(tables).toEqual(DB_BROADCAST_TABLES.filter((t) => t !== 'contacts').sort())
      for (const [table, projection] of Object.entries(projections)) {
        expect(projection.new.length, `${table}.new`).toBeGreaterThan(0)
        expect(projection.old.length, `${table}.old`).toBeGreaterThan(0)
      }
    })

    it('as projeções não referenciam colunas PII', () => {
      for (const [table, projection] of Object.entries(projections)) {
        for (const columns of [projection.new, projection.old]) {
          expect(columns, `${table} precisa de id`).toContain('id')
          for (const column of columns) {
            expect(FORBIDDEN_COLUMNS, `${table}.${column}`).not.toContain(column)
            expect(ALSO_SENSITIVE, `${table}.${column}`).not.toContain(column)
          }
        }
      }
    })

    it('mantém os campos de que o frontend depende (filtros e transições)', () => {
      expect(projections.campaigns.new).toEqual(expect.arrayContaining(['id', 'status', 'completed_at', 'sent', 'failed']))
      expect(projections.inbox_messages.new).toEqual(
        expect.arrayContaining(['id', 'conversation_id', 'direction', 'delivery_status'])
      )
      expect(projections.inbox_messages.old).toEqual(expect.arrayContaining(['id', 'conversation_id']))
      expect(projections.inbox_conversations.new).toEqual(expect.arrayContaining(['id', 'status', 'unread_count']))
      expect(projections.template_project_items.new).toEqual(expect.arrayContaining(['id', 'project_id']))
      expect(projections.template_project_items.old).toEqual(expect.arrayContaining(['id', 'project_id']))
      expect(projections.flow_submissions.new).toEqual(expect.arrayContaining(['id', 'campaign_id']))
      expect(projections.account_alerts.new).toEqual(expect.arrayContaining(['id', 'dismissed']))
    })

    it('nunca derruba a escrita, com UMA subtransação com XID por evento (a do realtime.send)', () => {
      // Um único bloco EXCEPTION, só na projeção: sem escrita lá dentro a subtransação
      // não recebe XID. realtime.send fica FORA dele (tem o próprio EXCEPTION no INSERT).
      const exceptionBlocks = normalizedBody.match(/\bEXCEPTION\b/g) ?? []
      expect(exceptionBlocks).toHaveLength(1)

      const blockStart = normalizedBody.indexOf("BEGIN IF TG_LEVEL = 'ROW' THEN")
      const handler = normalizedBody.indexOf(
        "EXCEPTION WHEN OTHERS THEN RAISE WARNING 'dispara_broadcast_change(%): %', TG_TABLE_NAME, SQLERRM; RETURN NULL; END;"
      )
      const send = normalizedBody.indexOf('PERFORM realtime.send(')
      expect(blockStart).toBeGreaterThan(0)
      expect(handler).toBeGreaterThan(blockStart)
      expect(send).toBeGreaterThan(handler)

      // Dentro do bloco: só projeção (nenhuma escrita, nenhuma chamada ao realtime)
      const block = normalizedBody.slice(blockStart, handler)
      expect(block).not.toMatch(/PERFORM|EXECUTE|INSERT INTO|UPDATE [a-z]|DELETE FROM|realtime\./i)

      // Guardas ANTES do bloco: sem realtime.send, ou sem EXECUTE nele, não publica
      // (e o send fora do bloco nunca derruba a escrita por permissão revogada).
      const guard = normalizedBody.indexOf(
        "v_send := to_regprocedure('realtime.send(jsonb,text,text,boolean)'); IF v_send IS NULL THEN RETURN NULL; END IF; IF NOT has_function_privilege(v_send::oid, 'EXECUTE') THEN RETURN NULL; END IF;"
      )
      expect(guard).toBeGreaterThanOrEqual(0)
      expect(guard).toBeLessThan(blockStart)
    })
  })

  describe('triggers de broadcast', () => {
    const specs = parseTriggerSpecs(raw)
    const def = (table: string, name: string) => triggerDefinition(specs, table, name)

    it('só são criadas se realtime.send existir', () => {
      expect(sql).toContain("IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RAISE NOTICE")
    })

    it('cobrem as tabelas do frontend, todas pela função de broadcast', () => {
      const tables = Array.from(new Set(specs.map((spec) => spec.table))).sort()
      expect(tables).toEqual([...DB_BROADCAST_TABLES].sort())
      for (const spec of specs) {
        expect(spec.definition, `${spec.table}.${spec.name}`).toMatch(
          new RegExp(`^AFTER [A-Z ]+ ON public\\.${spec.table} FOR EACH (ROW|STATEMENT) .*EXECUTE FUNCTION public\\.dispara_broadcast_change\\(\\)$`)
        )
        expect(spec.name).toMatch(/^dispara_realtime_broadcast(_update|_delete)?$/)
      }

      // Volume baixo: por linha, em INSERT/UPDATE/DELETE
      for (const table of ['templates', 'flows', 'account_alerts', 'template_projects', 'template_project_items']) {
        expect(def(table, 'dispara_realtime_broadcast')).toBe(
          `AFTER INSERT OR UPDATE OR DELETE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()`
        )
      }
      expect(def('contacts', 'dispara_realtime_broadcast')).toBe(
        'AFTER INSERT OR UPDATE OR DELETE ON public.contacts FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change()'
      )
      expect(def('flow_submissions', 'dispara_realtime_broadcast')).toBe(
        'AFTER INSERT ON public.flow_submissions FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()'
      )
    })

    it('re-executar não trava tabela: CREATE OR REPLACE só quando a definição muda, sem DROP TRIGGER', () => {
      // DROP TRIGGER pega ACCESS EXCLUSIVE (até o COMMIT) mesmo para recriar igual
      expect(sql).not.toMatch(/DROP TRIGGER/i)
      expect(sql).not.toMatch(/CREATE TRIGGER/)
      expect(sql).toContain(
        "v_definition := regexp_replace(btrim(r.definition), '\\s+', ' ', 'g'); v_marker := 'dispara_broadcast:' || md5(v_definition);"
      )
      expect(sql).toContain("SELECT obj_description(tg.oid, 'pg_trigger') INTO v_current FROM pg_trigger tg")

      const skip = sql.indexOf('IF v_current IS NOT DISTINCT FROM v_marker THEN CONTINUE; END IF;')
      const create = sql.indexOf("EXECUTE format('CREATE OR REPLACE TRIGGER %I %s', r.trigger_name, v_definition);")
      const comment = sql.indexOf(
        "EXECUTE format('COMMENT ON TRIGGER %I ON public.%I IS %L', r.trigger_name, r.table_name, v_marker);"
      )
      expect(skip).toBeGreaterThan(0)
      expect(create).toBeGreaterThan(skip)
      expect(comment).toBeGreaterThan(create)
    })

    it('campaigns: INSERT/DELETE sem condição e UPDATE com WHEN (nunca 1 evento por webhook de status)', () => {
      expect(def('campaigns', 'dispara_realtime_broadcast')).toBe(
        'AFTER INSERT OR DELETE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()'
      )
      // Nenhuma trigger de campaigns dispara em TODO update
      for (const spec of specs.filter((s) => s.table === 'campaigns')) {
        const trigger = parseTrigger(spec.definition)
        if (trigger.events.includes('UPDATE')) expect(trigger.when, spec.name).not.toBeNull()
      }

      const update = def('campaigns', 'dispara_realtime_broadcast_update')
      expect(update).toMatch(/^AFTER UPDATE ON public\.campaigns FOR EACH ROW WHEN \(/)
      expect(update).toMatch(/\) EXECUTE FUNCTION public\.dispara_broadcast_change\(\)$/)

      // Sempre publica mudança de status/conclusão/cancelamento/pasta
      for (const column of ['status', 'completed_at', 'cancelled_at', 'folder_id']) {
        expect(update).toContain(`OLD.${column} IS DISTINCT FROM NEW.${column} OR`)
      }
      // Contadores: só se mudaram E no primeiro UPDATE da janela fixa de 2s
      expect(update).toMatch(/\(OLD\.sent, OLD\.delivered, OLD\.read, OLD\.failed, OLD\.skipped,[^)]*\) IS DISTINCT FROM \(NEW\.sent, NEW\.delivered, NEW\.read, NEW\.failed, NEW\.skipped,/)
      expect(update).toContain(
        'AND ( OLD.updated_at IS NULL OR floor(extract(epoch FROM OLD.updated_at) / 2) <> floor(extract(epoch FROM now()) / 2) )'
      )
      // try_lock/release_campaign_dispatch_lock (só dispatch_lock_* + updated_at) não publicam
      expect(update).not.toMatch(/dispatch_lock|dispatch_locked_by/)
      // throttle por OLD.updated_at < now() - interval nunca dispara sob fluxo contínuo
      expect(update).not.toMatch(/interval/i)
    })

    it('inbox_messages: sem template de campanha, UPDATE só quando o status muda, DELETE por statement', () => {
      expect(def('inbox_messages', 'dispara_realtime_broadcast')).toBe(
        "AFTER INSERT ON public.inbox_messages FOR EACH ROW WHEN ((NEW.payload ->> 'type') IS DISTINCT FROM 'campaign_template') EXECUTE FUNCTION public.dispara_broadcast_change()"
      )
      expect(def('inbox_messages', 'dispara_realtime_broadcast_update')).toBe(
        "AFTER UPDATE ON public.inbox_messages FOR EACH ROW WHEN ( OLD.delivery_status IS DISTINCT FROM NEW.delivery_status AND (NEW.payload ->> 'type') IS DISTINCT FROM 'campaign_template' ) EXECUTE FUNCTION public.dispara_broadcast_change()"
      )
      expect(def('inbox_messages', 'dispara_realtime_broadcast_delete')).toBe(
        'AFTER DELETE ON public.inbox_messages FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change()'
      )
    })

    it('inbox_conversations: sem INSERT; UPDATE só quando muda o estado do atendimento', () => {
      const conversationTriggers = specs
        .filter((s) => s.table === 'inbox_conversations')
        .map((s) => parseTrigger(s.definition))
      expect(conversationTriggers.some((t) => t.events.includes('INSERT'))).toBe(false)

      expect(def('inbox_conversations', 'dispara_realtime_broadcast')).toBe(
        'AFTER DELETE ON public.inbox_conversations FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()'
      )
      const update = def('inbox_conversations', 'dispara_realtime_broadcast_update')
      expect(update).toContain(
        '(OLD.status, OLD.mode, OLD.priority, OLD.unread_count, OLD.ai_agent_id, OLD.automation_paused_until, OLD.human_mode_expires_at) IS DISTINCT FROM (NEW.status, NEW.mode, NEW.priority, NEW.unread_count, NEW.ai_agent_id, NEW.automation_paused_until, NEW.human_mode_expires_at)'
      )
      // Contador de saída e SET NULL de contact_id (bulk_delete_contacts) não publicam
      for (const column of ['total_messages', 'last_message_at', 'last_message_preview', 'contact_id', 'updated_at']) {
        expect(update).not.toContain(column)
      }
    })

    it('NÃO cria trigger em campaign_contacts (volume do disparo)', () => {
      expect(sql).not.toMatch(/ON public\.campaign_contacts/)
      expect(sql).not.toMatch(/'campaign_contacts'/)
    })

    it('tira as tabelas de public da publicação do postgres_changes', () => {
      expect(sql).toContain("EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', r.schemaname, r.tablename);")
    })
  })

  describe('volume em realtime.messages (simulação das triggers do inbox)', () => {
    const specs = parseTriggerSpecs(raw)
    const count = (write: TableWrite) => countBroadcastEvents(specs, write)

    const conversation = (overrides: Row = {}): Row => ({
      id: 'conv1',
      contact_id: 'ct1',
      ai_agent_id: 'agent1',
      status: 'open',
      mode: 'bot',
      priority: 'normal',
      unread_count: 0,
      total_messages: 0,
      last_message_at: null,
      last_message_preview: null,
      automation_paused_until: null,
      human_mode_expires_at: null,
      updated_at: '2026-10-11T10:00:00Z',
      ...overrides,
    })
    const message = (overrides: Row = {}): Row => ({
      id: 'm1',
      conversation_id: 'conv1',
      direction: 'outbound',
      delivery_status: 'sent',
      payload: null,
      ...overrides,
    })
    const campaignPayload = { type: 'campaign_template', campaign_id: 'c1', template_name: 't' }

    /** O que o disparo grava por contato (syncCampaignTemplateToInbox + webhooks de status). */
    function campaignContactWrites(index: number): TableWrite[] {
      const conv = conversation({ id: `conv${index}` })
      const sent = message({ id: `m${index}`, conversation_id: conv.id, payload: campaignPayload })
      const delivered = { ...sent, delivery_status: 'delivered' }
      const read = { ...sent, delivery_status: 'read' }
      return [
        // getOrCreateConversation (contato sem conversa)
        { table: 'inbox_conversations', op: 'INSERT', rows: [{ old: null, new: conv }] },
        // createMessage do template
        { table: 'inbox_messages', op: 'INSERT', rows: [{ old: null, new: sent }] },
        // increment_conversation_counters(outbound)
        {
          table: 'inbox_conversations',
          op: 'UPDATE',
          rows: [
            {
              old: conv,
              new: { ...conv, total_messages: 1, last_message_at: 'x', last_message_preview: 'Olá', updated_at: 'y' },
            },
          ],
        },
        // webhooks sent (repetido), delivered e read → handleDeliveryStatus
        { table: 'inbox_messages', op: 'UPDATE', rows: [{ old: sent, new: sent }] },
        { table: 'inbox_messages', op: 'UPDATE', rows: [{ old: sent, new: delivered }] },
        { table: 'inbox_messages', op: 'UPDATE', rows: [{ old: delivered, new: read }] },
      ]
    }

    it('disparo de campanha: nenhuma linha em realtime.messages por contato', () => {
      // As duas tabelas do inbox têm trigger (o zero abaixo não é por falta de trigger)
      expect(specs.filter((s) => s.table === 'inbox_messages').length).toBeGreaterThan(0)
      expect(specs.filter((s) => s.table === 'inbox_conversations').length).toBeGreaterThan(0)

      let events = 0
      for (let i = 0; i < 1000; i++) {
        for (const write of campaignContactWrites(i)) events += count(write)
      }
      expect(events).toBe(0)
    })

    it('referência: as triggers anteriores (sem WHEN no inbox) gravavam 6 linhas por contato', () => {
      const previous: TriggerSpec[] = [
        {
          table: 'inbox_messages',
          name: 'dispara_realtime_broadcast',
          definition:
            'AFTER INSERT OR UPDATE ON public.inbox_messages FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()',
        },
        {
          table: 'inbox_conversations',
          name: 'dispara_realtime_broadcast',
          definition:
            'AFTER INSERT OR UPDATE OR DELETE ON public.inbox_conversations FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()',
        },
      ]
      let events = 0
      for (let i = 0; i < 1000; i++) {
        for (const write of campaignContactWrites(i)) events += countBroadcastEvents(previous, write)
      }
      // INSERT da conversa + INSERT da mensagem + UPDATE do contador + 3 webhooks de status
      expect(events).toBe(6 * 1000)
    })

    it('mensagem recebida, resposta humana e atendimento continuam ao vivo', () => {
      const conv = conversation({ total_messages: 3, unread_count: 0 })

      // process_inbound_message: UPDATE (não lidas +1) + INSERT da mensagem recebida
      expect(
        count({
          table: 'inbox_conversations',
          op: 'UPDATE',
          rows: [{ old: conv, new: { ...conv, unread_count: 1, total_messages: 4 } }],
        })
      ).toBe(1)
      expect(
        count({
          table: 'inbox_messages',
          op: 'INSERT',
          rows: [{ old: null, new: message({ direction: 'inbound', delivery_status: 'delivered' }) }],
        })
      ).toBe(1)

      // Resposta humana: INSERT publica; o contador de saída não
      const reply = message({ id: 'm2', delivery_status: 'pending' })
      expect(count({ table: 'inbox_messages', op: 'INSERT', rows: [{ old: null, new: reply }] })).toBe(1)
      expect(
        count({
          table: 'inbox_conversations',
          op: 'UPDATE',
          rows: [{ old: conv, new: { ...conv, total_messages: 4, last_message_at: 'x' } }],
        })
      ).toBe(0)
      // Status de entrega da resposta: publica quando muda, não quando repete
      const sentReply = { ...reply, delivery_status: 'sent' }
      expect(count({ table: 'inbox_messages', op: 'UPDATE', rows: [{ old: reply, new: sentReply }] })).toBe(1)
      expect(count({ table: 'inbox_messages', op: 'UPDATE', rows: [{ old: sentReply, new: sentReply }] })).toBe(0)

      // Atendimento: takeover, marcar como lida, fechar, apagar
      expect(count({ table: 'inbox_conversations', op: 'UPDATE', rows: [{ old: conv, new: { ...conv, mode: 'human' } }] })).toBe(1)
      expect(
        count({ table: 'inbox_conversations', op: 'UPDATE', rows: [{ old: { ...conv, unread_count: 2 }, new: conv }] })
      ).toBe(1)
      expect(
        count({ table: 'inbox_conversations', op: 'UPDATE', rows: [{ old: conv, new: { ...conv, status: 'closed' } }] })
      ).toBe(1)
      expect(count({ table: 'inbox_conversations', op: 'DELETE', rows: [{ old: conv, new: null }] })).toBe(1)
    })

    it('SET NULL em massa de contact_id (bulk_delete_contacts) não publica nada', () => {
      const rows = Array.from({ length: 500 }, (_, i) => {
        const conv = conversation({ id: `conv${i}` })
        return { old: conv, new: { ...conv, contact_id: null } }
      })
      expect(count({ table: 'inbox_conversations', op: 'UPDATE', rows })).toBe(0)
      // Apagar uma conversa com N mensagens em cascata: 1 evento (STATEMENT), não N
      const cascade = Array.from({ length: 500 }, (_, i) => ({ old: message({ id: `m${i}` }), new: null }))
      expect(count({ table: 'inbox_messages', op: 'DELETE', rows: cascade })).toBe(1)
    })
  })

  it('é idempotente (sem CREATE sem IF NOT EXISTS/OR REPLACE fora dos DO blocks guardados)', () => {
    expect(sql).not.toMatch(/CREATE FUNCTION/i)
    expect(sql).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)/i)
    expect(sql).not.toMatch(/CREATE TRIGGER/)
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })
})

describe('migrations posteriores ao hardening', () => {
  const later = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f > HARDENING_FILE)
    .sort()

  // O EXECUTE para PUBLIC é default GLOBAL do Postgres e não pode ser revogado por schema:
  // toda função nova precisa de REVOKE explícito na própria migration.
  it.each(later.length ? later : ['(nenhuma)'])('%s revoga EXECUTE das funções novas e não reabre anon', (file) => {
    if (file === '(nenhuma)') return
    const sql = normalizeSql(readMigration(file))

    expect(sql).not.toMatch(/TO anon USING \(true\)/i)
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON [^;]* TO (anon|authenticated)\b/i)

    const functions = Array.from(
      sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-zA-Z0-9_]+)\s*\(/gi)
    ).map((m) => m[1])
    for (const fn of functions) {
      const revoke = new RegExp(`REVOKE (?:ALL|EXECUTE) ON FUNCTION public\\.${fn}\\b[^;]*FROM PUBLIC`, 'i')
      const blanket = /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/i
      expect(revoke.test(sql) || blanket.test(sql), `${file}: public.${fn} sem REVOKE ... FROM PUBLIC`).toBe(true)
    }
  })
})
