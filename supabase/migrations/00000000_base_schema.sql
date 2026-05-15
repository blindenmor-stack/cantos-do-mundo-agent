-- =====================================================================
-- Migration: 00000000_base_schema
-- Purpose: Recriar o schema base do projeto Supabase deletado.
--          Estas 6 tabelas foram criadas manualmente no painel e nunca
--          versionadas. Esta migration reconstrói TODAS as colunas
--          referenciadas pelo código (app/ + lib/), inferindo os tipos.
--
-- ORDEM DE EXECUÇÃO (Supabase virgem):
--   1) 00000000_base_schema.sql      (este arquivo)
--   2) 20260410_production_ready.sql (migration incremental existente)
--
-- A migration 20260410 usa ALTER TABLE / cria views / cria tabelas
-- (excluded_phones, notify_targets, conversation_events) e RLS dessas.
-- Por isso, este arquivo NÃO recria nada que a 20260410 já cria.
-- Colunas adicionadas pela 20260410 via ADD COLUMN IF NOT EXISTS
-- (leads.is_test, conversations.source, conversations.buffer_lock_at)
-- ficam SÓ na 20260410 — não aqui.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS / IF NOT EXISTS em índices.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELA: leads
-- ---------------------------------------------------------------------
-- Upsert do webhook usa onConflict:"phone" → phone deve ser UNIQUE NOT NULL.
-- campaign_id NÃO é usado pelo código, mas a view v_ad_performance da
-- migration 20260410 referencia leads.campaign_id — precisa existir aqui.
CREATE TABLE IF NOT EXISTS leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                text UNIQUE NOT NULL,
  name                 text,
  source               text,                       -- "whatsapp" (leadInsert no webhook)
  qualification_status text DEFAULT 'pending',     -- pending|qualified|warm|disqualified|needs_attention|inactive
  qualification_score  integer DEFAULT 0,
  qualification_summary text,                       -- gerado por generateHandoffSummary (inferido text)
  destination_interest text,
  travel_dates         text,
  travelers_count      integer,
  travelers_type       text,                        -- couple|solo|family
  travel_style         text,                        -- recebe updatedData.travel_motive (inferido text)
  budget_range         text,                        -- recebe updatedData.budget_per_person (inferido text)
  ctwa_clid            text,
  ad_id                text,
  campaign_id          text,                        -- só referenciado pela view v_ad_performance (20260410)
  utm_source           text,
  utm_medium           text,
  created_at           timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. TABELA: conversations
-- ---------------------------------------------------------------------
-- context_summary é REUTILIZADO pelo webhook como buffer-lock (guarda
-- um timestamp em string). NÃO confundir com buffer_lock_at, que a
-- migration 20260410 adiciona separadamente.
CREATE TABLE IF NOT EXISTS conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid REFERENCES leads(id) ON DELETE CASCADE,
  phone               text NOT NULL,
  bot_active          boolean DEFAULT true,
  current_step        text DEFAULT 'greeting',
  qualification_data  jsonb DEFAULT '{}'::jsonb,
  messages_count      integer DEFAULT 0,
  bot_messages_count  integer DEFAULT 0,
  context_summary     text,                          -- buffer-lock (timestamp string) — ver webhook STEP 4/5
  handoff_at          timestamptz,
  handoff_reason      text,
  handoff_summary     text,
  last_message_at     timestamptz DEFAULT now(),
  started_at          timestamptz DEFAULT now(),     -- usado em .order("started_at")
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);

-- ---------------------------------------------------------------------
-- 3. TABELA: messages
-- ---------------------------------------------------------------------
-- zapi_message_id é usado para dedup (.eq("zapi_message_id").maybeSingle()).
-- UNIQUE permite múltiplos NULL no Postgres (mensagens do bot não têm id),
-- mas garante dedup das mensagens recebidas + cria índice automático.
CREATE TABLE IF NOT EXISTS messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES leads(id) ON DELETE CASCADE,
  direction        text NOT NULL,                    -- incoming|outgoing
  content          text,
  message_type     text DEFAULT 'text',              -- text|image|audio|video|document|unknown (inferido text)
  is_from_bot      boolean DEFAULT false,
  zapi_message_id  text UNIQUE,
  metadata         jsonb DEFAULT '{}'::jsonb,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_zapi_message_id ON messages(zapi_message_id) WHERE zapi_message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. TABELA: agent_config (key/value)
-- ---------------------------------------------------------------------
-- key DEVE ser único: migration 20260410 faz INSERT ... ON CONFLICT (key).
-- Código lê: system_prompt_override, notify_phone, bot_mode,
-- quiet_hours_enabled, quiet_hours_start, quiet_hours_end.
-- (bot_mode e quiet_* são semeados pela migration 20260410 — não aqui.)
CREATE TABLE IF NOT EXISTS agent_config (
  key          text PRIMARY KEY,
  value        text,
  description  text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. TABELA: zapi_config (0 ou 1 linha — settings lê .limit(1).single())
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zapi_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   text,
  token         text,
  client_token  text,
  created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. TABELA: daily_metrics
-- ---------------------------------------------------------------------
-- daily-report faz .upsert(..., { onConflict: "date" }) → date é a PK.
CREATE TABLE IF NOT EXISTS daily_metrics (
  date          date PRIMARY KEY,
  total_leads   integer DEFAULT 0,
  qualified     integer DEFAULT 0,
  warm          integer DEFAULT 0,
  disqualified  integer DEFAULT 0,
  pending       integer DEFAULT 0,
  from_ads      integer DEFAULT 0,
  organic       integer DEFAULT 0,
  handoffs      integer DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7. RLS — permissiva pra anon (mesmo padrão da migration 20260410)
-- ---------------------------------------------------------------------
-- getSupabase() prefere service_role (que ignora RLS); anon é fallback.
-- Mantém o mesmo modelo de segurança temporário da 20260410.
ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE zapi_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_leads" ON leads;
CREATE POLICY "allow_all_leads" ON leads FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_conversations" ON conversations;
CREATE POLICY "allow_all_conversations" ON conversations FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_messages" ON messages;
CREATE POLICY "allow_all_messages" ON messages FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_agent_config" ON agent_config;
CREATE POLICY "allow_all_agent_config" ON agent_config FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_zapi_config" ON zapi_config;
CREATE POLICY "allow_all_zapi_config" ON zapi_config FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_daily_metrics" ON daily_metrics;
CREATE POLICY "allow_all_daily_metrics" ON daily_metrics FOR ALL TO anon USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 8. SEED mínimo de agent_config
-- ---------------------------------------------------------------------
-- NÃO semeamos system_prompt_override: o código (ai-agent.ts) só usa o
-- override se value.trim().length > 100, caso contrário usa a constante
-- DEFAULT_SYSTEM_PROMPT embutida. Uma linha vazia só geraria ruído.
-- bot_mode / quiet_hours_* são semeados pela migration 20260410.
-- notify_phone é opcional (fallback legado) — não obrigatório semear.
-- Portanto: nenhum seed necessário aqui.

-- ---------------------------------------------------------------------
-- FIM — rodar 20260410_production_ready.sql em seguida
-- ---------------------------------------------------------------------
