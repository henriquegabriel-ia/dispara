#!/usr/bin/env node
/**
 * Testa as migrations do Supabase num Postgres 17 REAL (PGlite = Postgres compilado
 * para WebAssembly, roda dentro do Node — sem Docker, sem instalar nada).
 *
 *   npm run db:check
 *
 * O que é simulado do Supabase (o PGlite é Postgres puro):
 *  - roles anon / authenticated / service_role (BYPASSRLS) e um dono NÃO-superusuário
 *    (`supabase_owner`) fazendo o papel do `postgres` do Supabase — as migrations rodam
 *    com ele, então erros de permissão aparecem como apareceriam no Supabase;
 *  - os default privileges do Supabase (tudo que o dono cria em `public` nasce com
 *    GRANT para anon/authenticated/service_role) — é isso que torna o REVOKE relevante;
 *  - schemas `extensions` (vector, uuid-ossp), `realtime` (messages + send, igual ao
 *    Supabase, com o bloco EXCEPTION interno), `vault`, `cron` e `net` (stubs);
 *  - a publicação `supabase_realtime`.
 *
 * Cenários:
 *  1. instalação nova: todas as migrations em ordem, cada arquivo numa única chamada
 *     (transação implícita), igual a lib/installer/migrations.ts — mas sem engolir erro;
 *  2. upgrade: banco no estado de produção (todas menos a de hardening) + dados → aplica
 *     a migration de hardening → confere dados e garantias;
 *  3. idempotência: reaplica a migration de hardening (não pode falhar nem recriar triggers);
 *  4. resiliência: escrita nunca falha se o realtime quebrar (send ausente/sem permissão).
 *
 * Sai com código 1 se qualquer verificação falhar.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// DB_CHECK_MIGRATIONS_DIR permite testar uma cópia (ex.: testes de mutação do próprio harness)
const MIGRATIONS_DIR = process.env.DB_CHECK_MIGRATIONS_DIR || join(ROOT, 'supabase', 'migrations')
const HARDENING = '20261011000000_security_hardening.sql'
const OWNER = 'supabase_owner'

// RPCs que o código servidor chama com .rpc() (service_role). Mantido em sincronia por
// verifyRpcList(), que falha se o código passar a chamar uma RPC fora desta lista.
const SERVER_RPCS = [
  'analyze_table', 'bulk_delete_contacts', 'bulk_update_contact_tags', 'claim_campaign_batch', 'get_campaigns_with_all_tags',
  'get_ab_variant_metrics', 'get_agent_config', 'get_campaign_contact_stats', 'get_contact_stats',
  'get_contact_tag_counts', 'get_contact_tags', 'get_db_size', 'increment_campaign_auto_reply_counters',
  'increment_campaign_stat', 'increment_conversation_counters', 'process_inbound_message',
  'reap_stuck_campaign_sending', 'release_campaign_dispatch_lock', 'reset_unread_count',
  'search_embeddings', 'try_lock_campaign_dispatch',
]
// RPCs chamadas pelo código mas que (sabidamente) não existem no schema — o código tem fallback.
const KNOWN_MISSING_RPCS = new Set(['get_ab_variant_metrics', 'get_db_size'])

const PII_KEYS = ['phone', 'name', 'email', 'content', 'body', 'custom_fields', 'text', 'message', 'contact_name', 'last_message_preview']

// ---------------------------------------------------------------------------
// Bootstrap "Supabase" (roda como superusuário, antes das migrations)
// ---------------------------------------------------------------------------
const SUPABASE_BOOTSTRAP = `
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS;
GRANT anon, authenticated, service_role TO ${OWNER};

ALTER SCHEMA public OWNER TO ${OWNER};
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO ${OWNER}, anon, authenticated, service_role;

-- Default privileges do Supabase: objetos criados pelo dono em public nascem abertos
-- para as roles da API (é isso que a migration de hardening precisa desfazer).
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- realtime (Broadcast from Database), como no Supabase
CREATE SCHEMA realtime;
GRANT USAGE ON SCHEMA realtime TO ${OWNER}, anon, authenticated, service_role;
CREATE TABLE realtime.messages (
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(),
  inserted_at timestamp NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid()
);
GRANT SELECT, INSERT ON realtime.messages TO ${OWNER}, service_role;
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);
    INSERT INTO realtime.messages (payload, event, topic, private, extension)
    VALUES (payload, event, topic, private, 'broadcast');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$fn$;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('realtime.topic', true), '')::text
$fn$;

-- vault (stub sem criptografia)
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text DEFAULT '',
  secret text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, created_at, updated_at FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '')
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $fn$
  INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id
$fn$;
GRANT USAGE ON SCHEMA vault TO ${OWNER};
GRANT SELECT ON vault.secrets, vault.decrypted_secrets TO ${OWNER};

-- pg_cron (stub)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, jobname text UNIQUE, username text DEFAULT current_user, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER AS $fn$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$fn$;
GRANT USAGE ON SCHEMA cron TO ${OWNER};
GRANT SELECT ON cron.job TO ${OWNER};

-- pg_net (stub: só enfileira)
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb, timeout_milliseconds int, created timestamptz DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $fn$
  INSERT INTO net.http_request_queue (url, headers, body, timeout_milliseconds)
  VALUES (url, headers, body, timeout_milliseconds) RETURNING id
$fn$;
GRANT USAGE ON SCHEMA net TO ${OWNER};

CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime OWNER TO ${OWNER};

-- No Supabase pg_cron e pg_net já vêm instalados: registra no catálogo para que o
-- "create extension if not exists pg_cron/pg_net" das migrations seja no-op (como lá),
-- sem alterar o SQL testado. Os objetos de verdade são os stubs acima.
INSERT INTO pg_catalog.pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
SELECT 990001, 'pg_cron', 10, 'cron'::regnamespace, false, '1.6' WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');
INSERT INTO pg_catalog.pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
SELECT 990002, 'pg_net', 10, 'net'::regnamespace, false, '0.14' WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net');
`

// ---------------------------------------------------------------------------
// Infra de verificação
// ---------------------------------------------------------------------------
const results = []
let currentScenario = ''

function check(name, ok, detail = '') {
  results.push({ scenario: currentScenario, name, ok: !!ok, detail })
  const mark = ok ? '  ✓' : '  ✗'
  console.log(`${mark} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}

function scenario(title) {
  currentScenario = title
  console.log(`\n▶ ${title}`)
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('.')).sort()
}

async function createSupabaseLikeDb() {
  const db = await PGlite.create({ extensions: { vector, uuid_ossp } })
  await db.exec(SUPABASE_BOOTSTRAP)
  return db
}

/**
 * Troca para o dono não-superusuário (como o `postgres` do Supabase). SET ROLE e não
 * SET SESSION AUTHORIZATION: no PGlite (single-user) o RESET SESSION AUTHORIZATION não
 * volta ao superusuário. Com SET ROLE, current_user = dono: objetos nascem dele, default
 * privileges sem FOR ROLE valem para ele e as permissões são checadas sem superusuário.
 */
async function asOwner(db) {
  await db.exec(`SET ROLE ${OWNER}; SET search_path = "$user", public, extensions;`)
}

async function asSuperuser(db) {
  await db.exec(`RESET ROLE; SET search_path = "$user", public, extensions;`)
}

/** Aplica um arquivo como o installer: uma única chamada (transação implícita). */
async function applyMigration(db, file) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  const warnings = []
  try {
    await db.exec(sql, {
      onNotice: (n) => {
        if (n.severity === 'WARNING') warnings.push(n.message)
      },
    })
    return { ok: true, warnings }
  } catch (error) {
    return { ok: false, error: error.message, warnings }
  }
}

async function rows(db, sql, params) {
  return (await db.query(sql, params)).rows
}

/** Monta `public.fn(NULL::tipo, ...)` a partir dos tipos reais dos argumentos. */
async function nullCallFor(db, name) {
  const fns = await rows(db, `
    SELECT oidvectortypes(p.proargtypes) AS types FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`, [name])
  if (fns.length === 0) return null
  const types = fns[0].types ? fns[0].types.split(', ') : []
  return `public.${name}(${types.map((t) => `NULL::${t}`).join(', ')})`
}

/** Executa como uma role e devolve o código de erro (ou null se passou). */
async function tryAsRole(db, role, sql) {
  try {
    await db.exec(`SET ROLE ${role}; ${sql}`)
    return null
  } catch (error) {
    return error.code || error.message
  } finally {
    await db.exec('RESET ROLE')
  }
}

// ---------------------------------------------------------------------------
// Verificações de segurança
// ---------------------------------------------------------------------------
async function verifyPrivileges(db) {
  const tables = await rows(db, `
    SELECT c.relname, c.relkind, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
    ORDER BY c.relname`)
  check(`há tabelas/views em public (${tables.length})`, tables.length > 20)

  for (const role of ['anon', 'authenticated']) {
    const leaks = []
    for (const t of tables) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const [{ has }] = await rows(db, `SELECT has_table_privilege($1, $2, $3) AS has`, [role, `public."${t.relname}"`, priv])
        if (has) leaks.push(`${t.relname}:${priv}`)
      }
    }
    check(`${role} sem nenhum privilégio de tabela/view em public`, leaks.length === 0, leaks.slice(0, 15).join(', '))
  }

  const noRls = tables.filter((t) => t.relkind === 'r' && !t.relrowsecurity).map((t) => t.relname)
  check('RLS habilitado em todas as tabelas de public', noRls.length === 0, noRls.join(', '))

  const anonPolicies = await rows(db, `SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles) OR 'public' = ANY(roles)) AND qual = 'true'`)
  check('nenhuma policy USING (true) para anon/authenticated/public', anonPolicies.length === 0,
    anonPolicies.map((p) => `${p.tablename}.${p.policyname}`).join(', '))

  const fns = await rows(db, `
    SELECT p.oid::regprocedure::text AS sig, p.proname, p.prosecdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND d.objid IS NULL`)
  for (const role of ['anon', 'authenticated']) {
    const exec = []
    for (const f of fns) {
      const [{ has }] = await rows(db, `SELECT has_function_privilege($1, $2, 'EXECUTE') AS has`, [role, f.sig])
      if (has) exec.push(f.sig)
    }
    check(`${role} sem EXECUTE em nenhuma função de public (${fns.length} funções)`, exec.length === 0, exec.slice(0, 10).join(', '))
  }

  const definerNoPath = await rows(db, `
    SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`)
  check('toda função SECURITY DEFINER de public fixa o search_path', definerNoPath.length === 0, definerNoPath.map((f) => f.sig).join(', '))

  // Tentativa real como anon (equivalente ao PostgREST com a chave pública)
  for (const t of ['contacts', 'inbox_messages', 'inbox_conversations', 'campaigns', 'settings']) {
    const err = await tryAsRole(db, 'anon', `SELECT * FROM public.${t} LIMIT 1`)
    check(`anon: SELECT em ${t} é negado`, err === '42501', `resultado: ${err ?? 'PASSOU (vazamento!)'}`)
  }
  for (const fn of ['claim_campaign_batch', 'try_lock_campaign_dispatch', 'dispara_cron_tick']) {
    const call = await nullCallFor(db, fn)
    if (!call) continue
    const rpcErr = await tryAsRole(db, 'anon', `SELECT ${call}`)
    check(`anon: RPC ${fn} é negada`, rpcErr === '42501', `resultado: ${rpcErr ?? 'PASSOU (vazamento!)'}`)
  }

  const pubTables = await rows(db, `SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'`)
  check('tabelas de public fora da publicação supabase_realtime (postgres_changes desligado)', pubTables.length === 0,
    pubTables.map((p) => p.tablename).join(', '))
}

async function verifyServiceRole(db) {
  const tables = await rows(db, `
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`)
  const missing = []
  for (const t of tables) {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const [{ has }] = await rows(db, `SELECT has_table_privilege('service_role', $1, $2) AS has`, [`public."${t.relname}"`, priv])
      if (!has) missing.push(`${t.relname}:${priv}`)
    }
  }
  check('service_role com SELECT/INSERT/UPDATE/DELETE em todas as tabelas', missing.length === 0, missing.slice(0, 15).join(', '))

  // OFFSET 0 impede o planner de avaliar has_sequence_privilege antes do filtro por relkind
  const seqMissing = await rows(db, `
    SELECT s.relname FROM (
      SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S' OFFSET 0
    ) s WHERE NOT has_sequence_privilege('service_role', s.oid, 'USAGE')`)
  check('service_role com USAGE em todas as sequences', seqMissing.length === 0, seqMissing.map((s) => s.relname).join(', '))

  const rpcProblems = []
  for (const name of SERVER_RPCS) {
    const fns = await rows(db, `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [name])
    if (fns.length === 0) {
      if (!KNOWN_MISSING_RPCS.has(name)) rpcProblems.push(`${name}: não existe`)
      continue
    }
    for (const f of fns) {
      const [{ has }] = await rows(db, `SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS has`, [f.sig])
      if (!has) rpcProblems.push(`${f.sig}: sem EXECUTE para service_role`)
    }
  }
  check(`service_role executa todas as RPCs usadas pelo servidor (${SERVER_RPCS.length})`, rpcProblems.length === 0, rpcProblems.join('; '))
  for (const name of KNOWN_MISSING_RPCS) {
    const [{ c }] = await rows(db, `SELECT count(*)::int AS c FROM pg_proc WHERE proname = $1`, [name])
    if (c === 0) console.log(`  · aviso: RPC ${name} é chamada pelo código mas não existe no schema (o código tem fallback)`)
  }

  const svcRead = await tryAsRole(db, 'service_role', `SELECT count(*) FROM public.contacts; SELECT count(*) FROM public.settings;`)
  check('service_role lê contacts/settings (BYPASSRLS)', svcRead === null, `erro: ${svcRead}`)
}

function verifyRpcList() {
  const sources = ['app', 'lib', 'services', 'hooks', 'components']
  const found = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/g)) found.add(m[1])
      }
    }
  }
  for (const s of sources) walk(join(ROOT, s))
  const unknown = [...found].filter((n) => !SERVER_RPCS.includes(n))
  check('lista de RPCs do servidor está em dia com o código', unknown.length === 0, `novas: ${unknown.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Verificações do realtime (triggers de broadcast)
// ---------------------------------------------------------------------------
async function realtimeCount(db) {
  const [{ c }] = await rows(db, `SELECT count(*)::int AS c FROM realtime.messages`)
  return c
}

async function lastMessages(db, n = 5) {
  return rows(db, `SELECT topic, event, private, payload FROM realtime.messages ORDER BY inserted_at DESC, id LIMIT $1`, [n])
}

function findPii(payload, piiValues) {
  const hits = []
  const visit = (v, path) => {
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (PII_KEYS.includes(k)) hits.push(`chave ${path}${k}`)
        visit(val, `${path}${k}.`)
      }
    } else if (typeof v === 'string' && piiValues.some((pv) => v.includes(pv))) {
      hits.push(`valor em ${path}`)
    }
  }
  visit(payload, '')
  return hits
}

async function verifyRealtime(db, label) {
  // Escreve como service_role (o que o app faz) — os triggers rodam como o dono.
  const write = async (sql) => {
    const err = await tryAsRole(db, 'service_role', sql)
    if (err) throw new Error(`escrita falhou (${err}): ${sql.slice(0, 120)}`)
  }
  const piiValues = ['5511987654321', 'Maria Teste', 'maria@teste.com', 'mensagem secreta do cliente']

  const before = await realtimeCount(db)
  await write(`INSERT INTO public.campaigns (id, name, status) VALUES ('rt_c1', 'Campanha RT', 'Rascunho')`)
  let after = await realtimeCount(db)
  check(`[${label}] INSERT em campaigns publica 1 evento`, after === before + 1, `antes=${before} depois=${after}`)
  const [msg] = await lastMessages(db, 1)
  check(`[${label}] evento no tópico público dispara-db/db_change`,
    msg && msg.topic === 'dispara-db' && msg.event === 'db_change' && msg.private === false, JSON.stringify(msg ?? {}))
  check(`[${label}] payload traz table/eventType`, msg?.payload?.table === 'campaigns' && msg?.payload?.eventType === 'INSERT', JSON.stringify(msg?.payload ?? {}))

  // Mudança de status sempre publica
  const s0 = await realtimeCount(db)
  await write(`UPDATE public.campaigns SET status = 'Enviando' WHERE id = 'rt_c1'`)
  check(`[${label}] mudança de status de campanha publica`, (await realtimeCount(db)) === s0 + 1)

  // Rajada de contadores na mesma janela: no máximo 1 evento
  const b0 = await realtimeCount(db)
  for (let i = 0; i < 10; i++) {
    await write(`SELECT public.increment_campaign_stat('rt_c1'::text, 'delivered'::text)`)
  }
  const burst = (await realtimeCount(db)) - b0
  check(`[${label}] 10 incrementos de contador seguidos geram ≤ 1 evento (throttle)`, burst <= 1, `eventos=${burst}`)

  // Update só de lock não publica
  const l0 = await realtimeCount(db)
  const lockCols = await rows(db, `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name LIKE 'dispatch_lock%'`)
  if (lockCols.length > 0) {
    await write(`UPDATE public.campaigns SET ${lockCols[0].column_name} = ${lockCols[0].column_name} WHERE id = 'rt_c1'`)
    check(`[${label}] UPDATE só de dispatch_lock_* não publica`, (await realtimeCount(db)) === l0, `eventos=${(await realtimeCount(db)) - l0}`)
  }

  // Contatos (statement-level, sem linha)
  const c0 = await realtimeCount(db)
  await write(`INSERT INTO public.contacts (id, phone, name, email) VALUES ('rt_ct1', '5511987654321', 'Maria Teste', 'maria@teste.com')`)
  check(`[${label}] INSERT em contacts publica sinal`, (await realtimeCount(db)) >= c0 + 1)

  // Inbox: mensagem recebida publica; cópia de template de campanha não
  await write(`INSERT INTO public.inbox_conversations (id, phone, contact_id) VALUES ('11111111-1111-1111-1111-111111111111', '5511987654321', 'rt_ct1')`)
  const i0 = await realtimeCount(db)
  await write(`INSERT INTO public.inbox_messages (conversation_id, direction, content) VALUES ('11111111-1111-1111-1111-111111111111', 'inbound', 'mensagem secreta do cliente')`)
  check(`[${label}] mensagem recebida no inbox publica`, (await realtimeCount(db)) === i0 + 1, `eventos=${(await realtimeCount(db)) - i0}`)
  const hasPayloadCol = (await rows(db, `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inbox_messages' AND column_name='payload'`)).length > 0
  if (hasPayloadCol) {
    const t0 = await realtimeCount(db)
    await write(`INSERT INTO public.inbox_messages (conversation_id, direction, content, payload) VALUES ('11111111-1111-1111-1111-111111111111', 'outbound', 'template', '{"type":"campaign_template"}'::jsonb)`)
    check(`[${label}] cópia de template de campanha no inbox NÃO publica (volume do disparo)`, (await realtimeCount(db)) === t0, `eventos=${(await realtimeCount(db)) - t0}`)
  }

  // Nenhum payload com PII
  const all = await rows(db, `SELECT payload FROM realtime.messages`)
  const leaks = all.flatMap((m) => findPii(m.payload, piiValues).map((h) => `${m.payload?.table}: ${h}`))
  check(`[${label}] nenhum payload de broadcast contém PII (${all.length} eventos)`, leaks.length === 0, [...new Set(leaks)].slice(0, 10).join('; '))
}

async function verifyRealtimeResilience(db) {
  const write = async (sql) => tryAsRole(db, 'service_role', sql)

  // 1) realtime.messages recusando INSERT: realtime.send engole, a escrita segue
  await asSuperuser(db)
  await db.exec(`ALTER TABLE realtime.messages ADD CONSTRAINT harness_block CHECK (false) NOT VALID`)
  let err = await write(`UPDATE public.campaigns SET status = 'Pausado' WHERE id = 'rt_c1'`)
  check('escrita segue quando o INSERT em realtime.messages falha', err === null, `erro: ${err}`)
  await db.exec(`ALTER TABLE realtime.messages DROP CONSTRAINT harness_block`)

  // 2) sem EXECUTE em realtime.send
  await db.exec(`REVOKE EXECUTE ON FUNCTION realtime.send(jsonb, text, text, boolean) FROM PUBLIC, ${OWNER}`)
  err = await write(`UPDATE public.campaigns SET status = 'Enviando' WHERE id = 'rt_c1'`)
  check('escrita segue sem permissão de EXECUTE em realtime.send', err === null, `erro: ${err}`)
  await db.exec(`GRANT EXECUTE ON FUNCTION realtime.send(jsonb, text, text, boolean) TO PUBLIC`)

  // 3) realtime.send inexistente (ambiente sem Broadcast from Database)
  await db.exec(`ALTER FUNCTION realtime.send(jsonb, text, text, boolean) RENAME TO send_disabled`)
  err = await write(`UPDATE public.campaigns SET status = 'Pausado' WHERE id = 'rt_c1'`)
  check('escrita segue com realtime.send ausente', err === null, `erro: ${err}`)
  await db.exec(`ALTER FUNCTION realtime.send_disabled(jsonb, text, text, boolean) RENAME TO send`)
}

async function verifyCron(db) {
  await asSuperuser(db)
  const jobs = await rows(db, `SELECT jobname, command FROM cron.job`)
  check('job dispara-cron-tick agendado', jobs.some((j) => j.jobname === 'dispara-cron-tick'), JSON.stringify(jobs))
  await db.exec(`SELECT vault.create_secret('https://exemplo.test', 'app_base_url'); SELECT vault.create_secret('s3cr3t', 'cron_secret');`)
  // pg_cron roda o job como o dono do job (o postgres do Supabase)
  await asOwner(db)
  let err = null
  try {
    await db.exec(`SELECT public.dispara_cron_tick()`)
  } catch (error) {
    err = error.message
  }
  await asSuperuser(db)
  const queued = await rows(db, `SELECT url, headers FROM net.http_request_queue ORDER BY id DESC LIMIT 1`)
  check('dispara_cron_tick roda como o dono e enfileira POST /api/cron/tick com Bearer',
    err === null && queued[0]?.url === 'https://exemplo.test/api/cron/tick' && queued[0]?.headers?.Authorization === 'Bearer s3cr3t',
    err ?? JSON.stringify(queued))
}

async function triggerFingerprint(db) {
  return rows(db, `
    SELECT c.relname, t.tgname, t.oid::int AS oid, obj_description(t.oid, 'pg_trigger') AS comment
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE 'dispara_realtime%'
    ORDER BY c.relname, t.tgname`)
}

// ---------------------------------------------------------------------------
// Cenários
// ---------------------------------------------------------------------------
async function scenarioFreshInstall(files) {
  scenario('1. Instalação nova (todas as migrations em ordem, como o installer)')
  const db = await createSupabaseLikeDb()
  await asOwner(db)
  for (const file of files) {
    const r = await applyMigration(db, file)
    check(`aplica ${file}`, r.ok, r.error)
    if (r.warnings.length) console.log(`      avisos: ${[...new Set(r.warnings)].slice(0, 3).join(' | ')}`)
    if (!r.ok) return null
  }
  await asSuperuser(db)
  const fingerprint = await triggerFingerprint(db)
  check(`triggers de broadcast criados (${fingerprint.length})`, fingerprint.length >= 5, JSON.stringify(fingerprint.map((f) => `${f.relname}.${f.tgname}`)))
  await verifyPrivileges(db)
  await verifyServiceRole(db)

  scenario('3. Idempotência (reaplica a migration de hardening)')
  await asOwner(db)
  const again = await applyMigration(db, HARDENING)
  check('reaplicar a migration de hardening não falha', again.ok, again.error)
  await asSuperuser(db)
  const fingerprint2 = await triggerFingerprint(db)
  check('reaplicar não recria triggers (mesmos OIDs)',
    JSON.stringify(fingerprint.map((f) => f.oid)) === JSON.stringify(fingerprint2.map((f) => f.oid)),
    `antes=${fingerprint.map((f) => f.oid)} depois=${fingerprint2.map((f) => f.oid)}`)
  await verifyPrivileges(db)

  scenario('4. Realtime e resiliência (instalação nova)')
  await verifyRealtime(db, 'nova')
  await verifyRealtimeResilience(db)
  await verifyCron(db)
  await db.close()
  return true
}

async function scenarioUpgrade(files) {
  scenario('2. Upgrade de produção (banco antigo + dados → migration de hardening)')
  const db = await createSupabaseLikeDb()
  await asOwner(db)
  for (const file of files.filter((f) => f !== HARDENING)) {
    const r = await applyMigration(db, file)
    if (!r.ok) {
      check(`aplica ${file} (estado anterior)`, false, r.error)
      return
    }
  }

  // Estado de produção ANTES: confirma que o vazamento existia (o teste precisa enxergá-lo)
  await asSuperuser(db)
  await db.exec(`
    INSERT INTO public.contacts (id, phone, name, email) VALUES ('up_ct1', '5511900000001', 'Cliente Antigo', 'antigo@teste.com');
    INSERT INTO public.campaigns (id, name, status) VALUES ('up_c1', 'Campanha antiga', 'Concluído');
    INSERT INTO public.settings (key, value) VALUES ('session_tokens', '[]');
    INSERT INTO public.inbox_conversations (id, phone) VALUES ('22222222-2222-2222-2222-222222222222', '5511900000001');
    INSERT INTO public.inbox_messages (conversation_id, direction, content) VALUES ('22222222-2222-2222-2222-222222222222', 'inbound', 'oi');
    INSERT INTO public.attendant_tokens (name, token) VALUES ('Atendente', 'abcdef0123456789abcdef0123456789');
  `)
  const leakBefore = await tryAsRole(db, 'anon', `SELECT * FROM public.contacts LIMIT 1`)
  check('antes do hardening: anon LIA contacts (vazamento reproduzido)', leakBefore === null, `resultado: ${leakBefore}`)

  await asOwner(db)
  const r = await applyMigration(db, HARDENING)
  check(`aplica ${HARDENING} sobre o banco de produção`, r.ok, r.error)
  if (r.warnings.length) console.log(`      avisos: ${[...new Set(r.warnings)].slice(0, 3).join(' | ')}`)
  if (!r.ok) return
  await asSuperuser(db)

  const counts = await rows(db, `
    SELECT (SELECT count(*) FROM public.contacts)::int AS contacts, (SELECT count(*) FROM public.campaigns)::int AS campaigns,
           (SELECT count(*) FROM public.inbox_messages)::int AS messages, (SELECT count(*) FROM public.attendant_tokens)::int AS tokens`)
  check('dados preservados após a migration', counts[0].contacts === 1 && counts[0].campaigns === 1 && counts[0].messages === 1 && counts[0].tokens === 1, JSON.stringify(counts[0]))
  await verifyPrivileges(db)
  await verifyServiceRole(db)
  await verifyRealtime(db, 'upgrade')
  await db.close()
}

async function main() {
  const files = listMigrations()
  console.log(`Migrations encontradas: ${files.length} (${files[0]} … ${files[files.length - 1]})`)
  if (!files.includes(HARDENING)) {
    console.error(`Migration ${HARDENING} não encontrada`)
    process.exit(1)
  }
  verifyRpcList()
  await scenarioFreshInstall(files)
  await scenarioUpgrade(files)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`)
  if (failed.length) {
    console.log('\nFALHAS:')
    for (const f of failed) console.log(` - [${f.scenario}] ${f.name}${f.detail ? `: ${f.detail}` : ''}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
