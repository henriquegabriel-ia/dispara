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

/** Statement `CREATE TRIGGER <name> ... ;` (normalizado) que contém `ON public.<table>`. */
function createTriggerStatement(sql: string, name: string, table: string): string {
  const statements = sql.match(/CREATE TRIGGER [a-z_]+ [^;]*;/g) ?? []
  const found = statements.filter(
    (statement) => statement.startsWith(`CREATE TRIGGER ${name} `) && statement.includes(` ON public.${table} `)
  )
  expect(found, `CREATE TRIGGER ${name} ON public.${table}`).toHaveLength(1)
  return found[0]
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

    it('nunca derruba a escrita, com UM único bloco de exceção por chamada', () => {
      // Cada bloco EXCEPTION é uma subtransação (e realtime.send já abre outra por dentro)
      const exceptionBlocks = normalizedBody.match(/\bEXCEPTION\b/g) ?? []
      expect(exceptionBlocks).toHaveLength(1)
      expect(normalizedBody).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING/)

      // O bloco cobre a projeção e o envio (coluna renomeada não derruba a escrita)...
      const blockStart = normalizedBody.indexOf("BEGIN IF TG_LEVEL = 'ROW' THEN")
      expect(blockStart).toBeGreaterThan(0)
      expect(normalizedBody.indexOf('PERFORM realtime.send(')).toBeGreaterThan(blockStart)
      expect(normalizedBody.indexOf('EXCEPTION WHEN OTHERS')).toBeGreaterThan(normalizedBody.indexOf('PERFORM realtime.send('))

      // ...e a checagem de realtime.send vem ANTES dele (sem a função, nenhuma subtransação)
      const guard = normalizedBody.indexOf(
        "IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN NULL; END IF;"
      )
      expect(guard).toBeGreaterThanOrEqual(0)
      expect(guard).toBeLessThan(blockStart)
    })
  })

  describe('triggers de broadcast', () => {
    it('só são criadas se realtime.send existir', () => {
      expect(sql).toContain("IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RAISE NOTICE")
    })

    it('cobrem as tabelas do frontend: por linha nas de volume baixo, recortes nas demais', () => {
      const rowTables = /v_row_tables text\[\] := ARRAY\[([^\]]*)\]/.exec(sql)
      expect(rowTables).not.toBeNull()
      const listed = Array.from(rowTables![1].matchAll(/'([^']+)'/g)).map((m) => m[1]).sort()
      const special = ['campaigns', 'contacts', 'inbox_messages', 'flow_submissions']
      expect(listed).toEqual(DB_BROADCAST_TABLES.filter((t) => !special.includes(t)).sort())

      // Toda tabela do frontend tem pelo menos uma trigger
      for (const table of special) {
        expect(sql, table).toMatch(new RegExp(`CREATE TRIGGER dispara_realtime_broadcast[a-z_]* AFTER [A-Z ]+ ON public\\.${table} `))
      }

      expect(sql).toContain('DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.contacts;')
      expect(createTriggerStatement(sql, 'dispara_realtime_broadcast', 'contacts')).toBe(
        'CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.contacts FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change();'
      )
    })

    it('campaigns: INSERT/DELETE sem condição e UPDATE com WHEN (nunca 1 evento por webhook de status)', () => {
      expect(createTriggerStatement(sql, 'dispara_realtime_broadcast', 'campaigns')).toBe(
        'CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT OR DELETE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change();'
      )
      // Nenhuma trigger de campaigns dispara em TODO update
      expect(sql).not.toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.campaigns/)
      expect(sql).not.toMatch(/AFTER UPDATE ON public\.campaigns FOR EACH ROW EXECUTE/)

      const update = createTriggerStatement(sql, 'dispara_realtime_broadcast_update', 'campaigns')
      expect(update).toMatch(/^CREATE TRIGGER dispara_realtime_broadcast_update AFTER UPDATE ON public\.campaigns FOR EACH ROW WHEN \(/)
      expect(update).toMatch(/\) EXECUTE FUNCTION public\.dispara_broadcast_change\(\);$/)

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

    it('inbox_messages: DELETE por statement (cascata da conversa) e flow_submissions só INSERT', () => {
      expect(createTriggerStatement(sql, 'dispara_realtime_broadcast', 'inbox_messages')).toBe(
        'CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT OR UPDATE ON public.inbox_messages FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change();'
      )
      expect(createTriggerStatement(sql, 'dispara_realtime_broadcast_delete', 'inbox_messages')).toBe(
        'CREATE TRIGGER dispara_realtime_broadcast_delete AFTER DELETE ON public.inbox_messages FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change();'
      )
      expect(createTriggerStatement(sql, 'dispara_realtime_broadcast', 'flow_submissions')).toBe(
        'CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT ON public.flow_submissions FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change();'
      )
    })

    it('NÃO cria trigger em campaign_contacts (volume do disparo)', () => {
      expect(sql).not.toMatch(/ON public\.campaign_contacts/)
      expect(sql).not.toMatch(/'campaign_contacts'/)
    })

    it('tira as tabelas de public da publicação do postgres_changes', () => {
      expect(sql).toContain("EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', r.schemaname, r.tablename);")
    })
  })

  it('é idempotente (sem CREATE sem IF NOT EXISTS/OR REPLACE fora dos DO blocks guardados)', () => {
    expect(sql).not.toMatch(/CREATE FUNCTION/i)
    expect(sql).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)/i)
    // Toda CREATE TRIGGER é precedida pelo DROP TRIGGER IF EXISTS correspondente
    const creates = sql.match(/CREATE TRIGGER dispara_realtime_broadcast/g) ?? []
    const drops = sql.match(/DROP TRIGGER IF EXISTS dispara_realtime_broadcast/g) ?? []
    expect(creates.length).toBe(drops.length)
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
