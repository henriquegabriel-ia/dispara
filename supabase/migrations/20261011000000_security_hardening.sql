-- =============================================================================
-- Hardening de segurança do banco (2026-10-11)
-- =============================================================================
--
-- O que esta migration faz:
--
-- 1. Fecha a leitura anônima. O init criava policies `FOR SELECT TO anon USING (true)`
--    em campaigns, contacts, templates, flows, inbox_conversations, inbox_messages e
--    account_alerts. Como a chave publishable (role anon) vai no bundle do browser,
--    qualquer pessoa conseguia GET /rest/v1/contacts ou /rest/v1/inbox_messages.
--    Aqui as policies são removidas e anon/authenticated perdem TODO privilégio em
--    TODAS as tabelas/views/sequences de public (inventário dinâmico, não lista manual).
--    O app não usa Supabase Auth: todo acesso legítimo é service role no servidor
--    (rotas de API, server actions e lib/supabase-server.ts), com a autorização
--    feita pelo proxy.ts (sessão do dashboard, API key, cron, atendente).
--
-- 2. Fecha as RPCs. Funções SECURITY DEFINER das migrations 2026* (claim_campaign_batch,
--    reap_stuck_campaign_sending, try_lock_campaign_dispatch, release_campaign_dispatch_lock,
--    dispara_cron_tick, increment_campaign_auto_reply_counters...) ficaram executáveis
--    por anon via /rest/v1/rpc/*. Aqui EXECUTE é revogado de PUBLIC/anon/authenticated
--    em TODAS as funções de public (e nas futuras via default privileges); só
--    service_role mantém EXECUTE. SECURITY DEFINER sem search_path fixo ganha um.
--
-- 3. Realtime via Broadcast from Database. O realtime do dashboard usava
--    postgres_changes com a chave anon, que dependia exatamente das policies acima.
--    Agora uma trigger (dispara_broadcast_change) publica no canal público
--    'dispara-db' (evento 'db_change') um payload com SÓ colunas não sensíveis
--    (ids, status, contadores, timestamps). NUNCA inclua PII (nome, telefone, email,
--    conteúdo de mensagem, custom_fields): quem tem a chave publishable pode ouvir
--    (e também emitir) mensagens nesse canal. O frontend trata o evento como um
--    "sinal de invalidação" e busca os dados reais pelas APIs autenticadas.
--    campaign_contacts NÃO tem trigger (volume do disparo em massa; o progresso vem
--    de campaigns + lib/realtime-broadcast-server.ts). contacts usa trigger por
--    STATEMENT (um evento por import/bulk update, não um por linha).
--    As tabelas saem da publicação supabase_realtime (postgres_changes não é mais usado).
--
-- EXIGE a versão correspondente do frontend (realtime via broadcast em
-- lib/supabase-realtime.ts + CentralizedRealtimeProvider, useUnreadCount via
-- /api/inbox/unread-count e lib/supabase-server.ts com service role). Com o frontend
-- antigo o realtime do dashboard para de atualizar (as listas seguem funcionando
-- por polling/refetch), e as leituras diretas do browser passam a falhar.
--
-- Idempotente: pode rodar mais de uma vez (o installer aplica todas as migrations
-- em ordem em instalações novas; em produção é aplicada manualmente).
--
-- Rollback (emergência): recriar as policies anon_select_* e o GRANT SELECT nessas
-- 7 tabelas reabre o vazamento — prefira voltar o frontend e manter este arquivo.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Policies de leitura anônima
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "anon_select_campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "anon_select_contacts" ON public.contacts;
DROP POLICY IF EXISTS "anon_select_templates" ON public.templates;
DROP POLICY IF EXISTS "anon_select_flows" ON public.flows;
DROP POLICY IF EXISTS "anon_select_inbox_conversations" ON public.inbox_conversations;
DROP POLICY IF EXISTS "anon_select_inbox_messages" ON public.inbox_messages;
DROP POLICY IF EXISTS "anon_select_account_alerts" ON public.account_alerts;

REVOKE ALL ON TABLE public.campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE public.contacts FROM anon, authenticated;
REVOKE ALL ON TABLE public.templates FROM anon, authenticated;
REVOKE ALL ON TABLE public.flows FROM anon, authenticated;
REVOKE ALL ON TABLE public.inbox_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE public.inbox_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_alerts FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2) Inventário dinâmico: nenhuma tabela/view/sequence de public para anon/authenticated
--    + RLS ligado em todas as tabelas (defesa em profundidade: sem policy, nega).
--    service_role tem BYPASSRLS e segue com os grants que já tinha.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      -- objetos de extensão instalada em public não são nossos
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', r.relname);

    IF r.relkind IN ('r', 'p') THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'security_hardening: não foi possível ligar RLS em public.% (%)', r.relname, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Objetos futuros criados pelo role que roda as migrations (postgres no Supabase).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3) SECURITY DEFINER sem search_path fixo (ex.: increment_campaign_auto_reply_counters)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.signature);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'security_hardening: não foi possível fixar search_path em % (%)', r.signature, SQLERRM;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 4) Realtime: Broadcast from Database (canal público 'dispara-db', evento 'db_change')
-- -----------------------------------------------------------------------------
-- Payload: { table, eventType, new, old, commit_timestamp }
--   new = colunas whitelisted da linha nova (INSERT/UPDATE), senão null
--   old = colunas whitelisted da linha antiga (UPDATE/DELETE), senão null
--   Trigger por STATEMENT (contacts): new = old = null.
-- A whitelist abaixo é a ÚNICA fonte das colunas que saem do banco por este canal.
-- Ao adicionar coluna: só ids, status, contadores e timestamps. Nada de PII.
CREATE OR REPLACE FUNCTION public.dispara_broadcast_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cols text[];
  v_new jsonb := NULL;
  v_old jsonb := NULL;
BEGIN
  v_cols := CASE TG_TABLE_NAME
    WHEN 'campaigns' THEN ARRAY[
      'id', 'status', 'total_recipients', 'sent', 'delivered', 'read', 'failed', 'skipped',
      'auto_reply_sent_count', 'quick_reply_match_count', 'fallback_sent_count',
      'folder_id', 'flow_id', 'ab_test_enabled',
      'scheduled_date', 'started_at', 'first_dispatch_at', 'last_sent_at',
      'completed_at', 'cancelled_at', 'created_at', 'updated_at'
    ]
    WHEN 'contacts' THEN ARRAY[
      'id', 'status', 'created_at', 'updated_at'
    ]
    WHEN 'templates' THEN ARRAY[
      'id', 'status', 'category', 'language', 'parameter_format',
      'fetched_at', 'created_at', 'updated_at'
    ]
    WHEN 'flows' THEN ARRAY[
      'id', 'status', 'meta_status', 'meta_flow_id',
      'meta_last_checked_at', 'meta_published_at', 'created_at', 'updated_at'
    ]
    WHEN 'inbox_conversations' THEN ARRAY[
      'id', 'contact_id', 'ai_agent_id', 'status', 'mode', 'priority',
      'unread_count', 'total_messages', 'last_message_at',
      'automation_paused_until', 'human_mode_expires_at', 'created_at', 'updated_at'
    ]
    WHEN 'inbox_messages' THEN ARRAY[
      'id', 'conversation_id', 'direction', 'message_type', 'source_type',
      'delivery_status', 'created_at', 'delivered_at', 'read_at', 'failed_at'
    ]
    WHEN 'account_alerts' THEN ARRAY[
      'id', 'type', 'code', 'dismissed', 'created_at'
    ]
    WHEN 'template_projects' THEN ARRAY[
      'id', 'status', 'template_count', 'approved_count', 'created_at', 'updated_at'
    ]
    WHEN 'template_project_items' THEN ARRAY[
      'id', 'project_id', 'status', 'meta_status', 'category', 'language',
      'submitted_at', 'created_at', 'updated_at'
    ]
    WHEN 'flow_submissions' THEN ARRAY[
      'id', 'campaign_id', 'flow_id', 'flow_local_id', 'created_at'
    ]
    ELSE ARRAY['id']
  END;

  IF TG_LEVEL = 'ROW' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        INTO v_new
        FROM jsonb_each(to_jsonb(NEW)) AS e
       WHERE e.key = ANY (v_cols);
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        INTO v_old
        FROM jsonb_each(to_jsonb(OLD)) AS e
       WHERE e.key = ANY (v_cols);
    END IF;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'eventType', TG_OP,
      'new', v_new,
      'old', v_old,
      'commit_timestamp', now()
    ),
    'db_change',
    'dispara-db',
    false
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Realtime é best-effort: nunca pode derrubar a escrita no banco.
  RAISE WARNING 'dispara_broadcast_change(%): %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.dispara_broadcast_change() IS
  'Realtime do dashboard: publica no canal público dispara-db (evento db_change) só colunas whitelisted (sem PII). Ver 20261011000000_security_hardening.sql.';

-- Triggers só onde existe realtime.send (Supabase com Broadcast from Database).
-- Lista = tabelas que o frontend escuta (CentralizedRealtimeProvider + hooks/*).
DO $$
DECLARE
  v_table text;
  v_row_tables text[] := ARRAY[
    'campaigns',
    'templates',
    'flows',
    'inbox_conversations',
    'inbox_messages',
    'account_alerts',
    'template_projects',
    'template_project_items',
    'flow_submissions'
  ];
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RAISE NOTICE 'security_hardening: realtime.send indisponível; triggers de broadcast não criadas (realtime do dashboard fica só no polling).';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY v_row_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()',
      v_table
    );
  END LOOP;

  -- contacts: import/bulk update mexe em milhares de linhas por statement.
  -- Um evento por statement basta (o frontend só invalida a lista/estatísticas).
  IF to_regclass('public.contacts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.contacts;
    CREATE TRIGGER dispara_realtime_broadcast
      AFTER INSERT OR UPDATE OR DELETE ON public.contacts
      FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change();
  END IF;
END $$;

-- postgres_changes não é mais usado: tira as tabelas de public da publicação do Realtime
-- (evita decodificar WAL à toa, inclusive de campaign_contacts, e fecha o caminho caso
-- algum grant a anon volte no futuro).
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', r.schemaname, r.tablename);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'security_hardening: não foi possível tirar %.% da publicação (%)', r.schemaname, r.tablename, SQLERRM;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 5) Funções: EXECUTE só para service_role (por último, cobre também a função acima)
-- -----------------------------------------------------------------------------
-- Inventário (grep em todas as migrations) de funções de public SEM REVOKE próprio até aqui:
--   claim_campaign_batch, reap_stuck_campaign_sending, try_lock_campaign_dispatch,
--   release_campaign_dispatch_lock (20260705000600_campaign_queue — SECURITY DEFINER),
--   dispara_cron_tick (20260705000100_cron_infra — SECURITY DEFINER, lê o Vault),
--   increment_campaign_auto_reply_counters (20260422000000 — SECURITY DEFINER sem search_path),
--   dispara_broadcast_change (esta migration).
-- As demais (init, 20260225*, 20260430*) já tinham REVOKE explícito; o REVOKE geral cobre todas.
-- Triggers não checam EXECUTE ao disparar; pg_cron roda dispara_cron_tick como o dono.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Desfaz o GRANT por schema que o Supabase dá a anon/authenticated em funções futuras.
-- ATENÇÃO: o EXECUTE a PUBLIC é um default GLOBAL do Postgres e NÃO pode ser revogado
-- por schema (a parte "FROM PUBLIC" abaixo não tem efeito). Toda função nova em public
-- precisa de `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` explícito
-- na própria migration (lib/security-hardening-migration.test.ts verifica isso).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
