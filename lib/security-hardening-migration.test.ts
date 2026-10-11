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

/** Whitelist por tabela: { campaigns: ['id', 'status', ...], ... } */
function parseWhitelist(body: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const re = /WHEN\s+'([a-z_]+)'\s+THEN\s+ARRAY\[([^\]]*)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    result[match[1]] = Array.from(match[2].matchAll(/'([^']+)'/g)).map((m) => m[1])
  }
  const elseMatch = /ELSE\s+ARRAY\[([^\]]*)\]/.exec(body)
  if (elseMatch) {
    result.__else__ = Array.from(elseMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
  }
  return result
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
    const whitelist = parseWhitelist(body)

    it('é SECURITY DEFINER com search_path fixo', () => {
      const header = normalizeSql(raw.slice(raw.indexOf('CREATE OR REPLACE FUNCTION public.dispara_broadcast_change()'), raw.indexOf(body)))
      expect(header).toMatch(/SECURITY DEFINER/)
      expect(header).toMatch(/SET search_path = ''/)
    })

    it('publica no canal público dispara-db, evento db_change', () => {
      expect(normalizedBody).toMatch(/PERFORM realtime\.send\( jsonb_build_object\(/)
      expect(normalizedBody).toContain("'db_change', 'dispara-db', false );")
    })

    it('payload só usa as projeções filtradas pela whitelist', () => {
      const build = /jsonb_build_object\(([\s\S]*?)\),\s*'db_change'/.exec(body)
      expect(build).not.toBeNull()
      const args = normalizeSql(build![1])
      expect(args).toBe(
        "'table', TG_TABLE_NAME, 'eventType', TG_OP, 'new', v_new, 'old', v_old, 'commit_timestamp', now()"
      )

      // A linha inteira só entra via jsonb_each(...) filtrado por ANY(v_cols)
      const toJsonbUses = normalizedBody.match(/to_jsonb\((NEW|OLD)\)/g) ?? []
      expect(toJsonbUses).toHaveLength(2)
      expect(normalizedBody).toContain('FROM jsonb_each(to_jsonb(NEW)) AS e WHERE e.key = ANY (v_cols)')
      expect(normalizedBody).toContain('FROM jsonb_each(to_jsonb(OLD)) AS e WHERE e.key = ANY (v_cols)')
    })

    it('tem whitelist para todas as tabelas que o frontend escuta, e só para elas', () => {
      const tables = Object.keys(whitelist).filter((t) => t !== '__else__').sort()
      expect(tables).toEqual([...DB_BROADCAST_TABLES].sort())
      expect(whitelist.__else__).toEqual(['id'])
    })

    it('a whitelist não referencia colunas PII', () => {
      for (const [table, columns] of Object.entries(whitelist)) {
        expect(columns, `${table} precisa de id`).toContain('id')
        for (const column of columns) {
          expect(FORBIDDEN_COLUMNS, `${table}.${column}`).not.toContain(column)
          expect(ALSO_SENSITIVE, `${table}.${column}`).not.toContain(column)
        }
      }
    })

    it('mantém os campos de que o frontend depende (filtros e transições)', () => {
      expect(whitelist.campaigns).toEqual(expect.arrayContaining(['id', 'status', 'completed_at', 'sent', 'failed']))
      expect(whitelist.inbox_messages).toEqual(
        expect.arrayContaining(['id', 'conversation_id', 'direction', 'delivery_status'])
      )
      expect(whitelist.inbox_conversations).toEqual(expect.arrayContaining(['id', 'status', 'unread_count']))
      expect(whitelist.template_project_items).toEqual(expect.arrayContaining(['id', 'project_id']))
      expect(whitelist.flow_submissions).toEqual(expect.arrayContaining(['id', 'campaign_id']))
      expect(whitelist.account_alerts).toEqual(expect.arrayContaining(['id', 'dismissed']))
    })

    it('nunca derruba a escrita (exceção vira WARNING)', () => {
      expect(normalizedBody).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING/)
    })
  })

  describe('triggers de broadcast', () => {
    it('só são criadas se realtime.send existir', () => {
      expect(sql).toContain("IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN")
    })

    it('cobrem as tabelas do frontend, por linha, exceto contacts (por statement)', () => {
      const rowTables = /v_row_tables text\[\] := ARRAY\[([^\]]*)\]/.exec(sql)
      expect(rowTables).not.toBeNull()
      const listed = Array.from(rowTables![1].matchAll(/'([^']+)'/g)).map((m) => m[1]).sort()
      expect(listed).toEqual(DB_BROADCAST_TABLES.filter((t) => t !== 'contacts').sort())

      expect(sql).toContain('DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.contacts;')
      expect(sql).toMatch(
        /CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT OR UPDATE OR DELETE ON public\.contacts FOR EACH STATEMENT EXECUTE FUNCTION public\.dispara_broadcast_change\(\);/
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
