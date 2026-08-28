-- ============================================================================
-- Hamster-Nest 完整数据库结构（只含结构，不含数据）
-- 导出时间：2026-08-28，来源：线上 Supabase 项目（PostgreSQL 17）
--
-- 用途：在一个全新 Supabase 项目的 SQL Editor 里整体粘贴运行，即可得到与
--       原项目一致的表 / 列 / 约束 / 索引 / 函数 / 视图 / 触发器 / RLS 策略 /
--       Realtime publication / 权限 / storage bucket。
-- 幂等：全文使用 IF NOT EXISTS / CREATE OR REPLACE / DROP-CREATE 写法，可整体
--       重跑；已有部署缺表缺列（报 42703 或表 404）的，直接重跑本文件即可补齐。
--
-- ⚠️ 运行前必须做的两个全局替换（编辑器查找替换即可）：
--   1) 11111111-1111-1111-1111-111111111111
--      → 替换成你自己的 auth 用户 UUID。先在 Dashboard → Authentication 创建
--        （或前端注册）你的账号，再在 SQL Editor 跑 `select id from auth.users;`
--        拿到 UUID。原项目是单用户应用，部分 RLS 策略与列默认值绑定 owner UUID，
--        不替换会导致登录后读不到 / 写不进数据。
--   2) YOUR_PROJECT_REF
--      → 替换成你自己的项目 ref（Dashboard → Project Settings → General）。
--        只出现在 notify_push_dispatch() 的 Edge Function 回调 URL 里。
--
-- 其它说明：
--   * 推送 webhook 依赖 Vault secret `push_dispatch_secret`（可选；缺失时触发器
--     只 raise warning，不影响业务写入）。需要推送时在 Dashboard → Vault 自建。
--   * 线上库另有一个运维登录角色（cli_login_postgres，Mac mini psql 用），与
--     应用无关、密码也无法导出，故不包含在本文件中。
-- ============================================================================

SET check_function_bodies = off;
SET search_path = public, extensions;

-- ============================================================================
-- 1. 扩展
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;

-- ============================================================================
-- 2. Schema
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ============================================================================
-- 3. 表结构（CREATE TABLE）
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_council (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  speaker text NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  read_by text[] DEFAULT ARRAY[]::text[],
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid,
  parent_id uuid,
  entry_type text,
  proposal_status text,
  vote text,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  category text,
  executor text
);

CREATE TABLE IF NOT EXISTS public.agent_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  actor text NOT NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  title text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  importance text DEFAULT 'normal'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_feed_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  summary text,
  content text NOT NULL,
  content_format text DEFAULT 'markdown'::text NOT NULL,
  priority text DEFAULT 'normal'::text NOT NULL,
  status text DEFAULT 'unread'::text NOT NULL,
  source text,
  created_by text,
  visible_from timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone,
  read_at timestamp with time zone,
  pinned boolean DEFAULT false NOT NULL,
  related_table text,
  related_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_heartbeats (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  agent_id text NOT NULL,
  agent_type text NOT NULL,
  status text NOT NULL,
  last_task text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  checkin_enabled boolean DEFAULT false NOT NULL,
  day_mode_start_hour integer DEFAULT 8 NOT NULL,
  day_mode_end_hour integer DEFAULT 23 NOT NULL,
  day_min_interval_minutes integer DEFAULT 3 NOT NULL,
  day_max_interval_minutes integer DEFAULT 60 NOT NULL,
  night_mode_start_hour integer DEFAULT 23 NOT NULL,
  night_mode_end_hour integer DEFAULT 8 NOT NULL,
  night_min_interval_minutes integer DEFAULT 60 NOT NULL,
  night_max_interval_minutes integer DEFAULT 180 NOT NULL,
  quiet_hours_start_hour integer,
  quiet_hours_end_hour integer,
  cooldown_after_interaction_minutes integer DEFAULT 15 NOT NULL,
  max_daily_checkins_day integer DEFAULT 10 NOT NULL,
  max_daily_checkins_night integer DEFAULT 3 NOT NULL,
  per_channel_schedule jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone,
  heartbeat_data jsonb DEFAULT '{}'::jsonb,
  wechat_context_summary_model text DEFAULT 'deepseek/deepseek-chat'::text,
  wechat_context_window_rounds integer DEFAULT 18,
  wechat_context_summary_trigger_rounds integer DEFAULT 20,
  wechat_context_summary_refresh_rounds integer DEFAULT 10,
  wechat_memory_search_min_length integer DEFAULT 6,
  wechat_memory_search_enabled boolean DEFAULT true,
  agent_mode text DEFAULT 'active'::text
);

CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  source text NOT NULL,
  executor text NOT NULL,
  command text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  result_summary text,
  result_detail text,
  error text,
  created_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  payload_json jsonb DEFAULT '{}'::jsonb,
  correlation_id uuid,
  parent_task_id uuid
);

CREATE TABLE IF NOT EXISTS public.approval_executions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  approval_id uuid NOT NULL,
  user_id uuid NOT NULL,
  executor text NOT NULL,
  status text DEFAULT 'claimed'::text NOT NULL,
  claimed_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  exit_code integer,
  output_excerpt text,
  error_message text
);

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  source_actor text NOT NULL,
  title text NOT NULL,
  description text,
  proposed_action jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  response_note text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  responded_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.archive_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  parent_id uuid,
  scope text NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.archives (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  category_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  keywords text[] DEFAULT '{}'::text[],
  aliases text[] DEFAULT '{}'::text[],
  importance text DEFAULT 'normal'::text,
  source text DEFAULT 'manual'::text,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auto_letter_config (
  user_id uuid DEFAULT auth.uid() NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  t2_mode text DEFAULT 'off'::text NOT NULL,
  t2_interval_hours integer DEFAULT 12,
  t2_random_probability double precision DEFAULT 0.3,
  t2_daily_limit integer DEFAULT 3,
  last_auto_letter_at timestamp with time zone,
  auto_letters_today integer DEFAULT 0,
  auto_letters_today_date date DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  active_hour_start integer DEFAULT 9,
  active_hour_end integer DEFAULT 23
);

CREATE TABLE IF NOT EXISTS public.bubble_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  session_id uuid NOT NULL,
  role text NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  action_tag text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.bubble_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  session_date date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.capabilities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  trigger_conditions text,
  cooldown_rule text,
  risk_level text DEFAULT 'low'::text NOT NULL,
  requires_confirmation boolean DEFAULT false,
  output_channel text,
  last_used_at timestamp with time zone,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  trigger_config jsonb DEFAULT '{}'::jsonb,
  cooldown_until timestamp with time zone,
  usage_count integer DEFAULT 0,
  failure_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.channel_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  channel_name text NOT NULL,
  active_model text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.checkin_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  checkin_time timestamp with time zone DEFAULT now() NOT NULL,
  model text,
  input_summary text,
  raw_output text,
  decision text DEFAULT 'silent'::text NOT NULL,
  wechat_message_id uuid,
  tokens_used integer,
  error_detail text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  canonical_message_id uuid,
  canonical_event_id bigint,
  idempotency_key text,
  topic_fingerprint text,
  generation_audit jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.checkins (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  checkin_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.codex_control (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  action text NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  executed_at timestamp with time zone,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid
);

CREATE TABLE IF NOT EXISTS public.codex_tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  task text NOT NULL,
  source text DEFAULT 'syzygy'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  result text,
  created_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid
);

CREATE TABLE IF NOT EXISTS public.compression_cache (
  conversation_id uuid NOT NULL,
  compressed_up_to_message_id uuid NOT NULL,
  summary_text text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  module text DEFAULT 'chat'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  profile_key text NOT NULL,
  conversation_kind text NOT NULL,
  handler text NOT NULL,
  session_policy text NOT NULL,
  singleton_session_key text,
  participant_port_keys text[] NOT NULL,
  default_responder_port_key text NOT NULL,
  rules_prompt_name text,
  context_recipe jsonb NOT NULL,
  version integer NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.council_categories (
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.current_context_snapshot (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  snapshot_type text DEFAULT 'current_status'::text NOT NULL,
  summary_text text NOT NULL,
  summary_json jsonb,
  stale_after timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_status_digest (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  date date NOT NULL,
  period_of_day text NOT NULL,
  summary_json jsonb,
  summary_text text,
  care_priority text,
  created_at timestamp with time zone DEFAULT now(),
  source_range_start timestamp with time zone,
  source_range_end timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.device_status (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  latitude double precision,
  longitude double precision,
  battery_level integer,
  wifi_name text,
  source_app text,
  device_name text,
  brightness double precision,
  now_playing text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  weather text,
  steps integer,
  now_playing_title text,
  now_playing_artist text,
  is_charging boolean,
  step_count integer
);

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  device_name text,
  expo_push_token text NOT NULL,
  native_push_token text,
  app_version text,
  enabled boolean DEFAULT true NOT NULL,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.enabled_models (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  model_id text NOT NULL,
  display_name text,
  is_default boolean DEFAULT false NOT NULL,
  enabled_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.forum_ai_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  slot_index integer NOT NULL,
  name text DEFAULT ''::text NOT NULL,
  system_prompt text DEFAULT ''::text NOT NULL,
  model text DEFAULT ''::text NOT NULL,
  temperature double precision,
  top_p double precision,
  api_base_url text,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  context_token_limit integer DEFAULT 32000 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.forum_replies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  author_type text NOT NULL,
  author_slot integer,
  author_name text DEFAULT ''::text NOT NULL,
  reply_to_reply_id uuid,
  reply_to_author_name text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  parent_id uuid
);

CREATE TABLE IF NOT EXISTS public.forum_threads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text DEFAULT ''::text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  author_type text NOT NULL,
  author_slot integer,
  author_name text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.generation_ports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  port_key text NOT NULL,
  runtime_kind text NOT NULL,
  model_channel_name text,
  target_role text,
  identity_prompt_name text NOT NULL,
  style_prompt_name text,
  sop_source text,
  sop_ref text,
  version integer NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ideas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  category text,
  content text NOT NULL,
  source_context text,
  captured_by text NOT NULL,
  status text DEFAULT 'captured'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_folders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  icon text,
  parent_id uuid,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learning_edges (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  edge_type text NOT NULL,
  description text,
  strength integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learning_nodes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  folder_id uuid,
  node_type text NOT NULL,
  title text NOT NULL,
  content text,
  tags text[] DEFAULT '{}'::text[],
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.letter_conversations (
  letter_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.letters (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  model text NOT NULL,
  content text NOT NULL,
  trigger_type text DEFAULT 'manual'::text NOT NULL,
  trigger_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_read boolean DEFAULT false NOT NULL,
  conversation_id uuid,
  module text DEFAULT 'letter'::text NOT NULL,
  metadata jsonb
);

CREATE TABLE IF NOT EXISTS public.llm_providers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  display_name text NOT NULL,
  base_url text NOT NULL,
  secret_name text NOT NULL,
  active boolean DEFAULT false NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.llm_usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  module text,
  conversation_id text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cached_tokens integer,
  cache_write_tokens integer,
  cost_usd numeric,
  raw jsonb
);

CREATE TABLE IF NOT EXISTS public.lounge_members (
  sender text NOT NULL,
  display_name text NOT NULL,
  emoji text NOT NULL,
  color text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.lounge_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sender text NOT NULL,
  content text NOT NULL,
  mentions text[] DEFAULT '{}'::text[] NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sofa_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.lounge_sofas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.memo_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  source text DEFAULT 'user'::text NOT NULL,
  is_pinned boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.memo_entry_tags (
  memo_entry_id uuid NOT NULL,
  memo_tag_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.memo_tags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.memory_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_deleted boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  session_id uuid NOT NULL,
  role text NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  client_id uuid,
  client_created_at timestamp with time zone,
  sender_key text,
  reply_to_id uuid,
  target_sender_keys text[]
);

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  agent_event_id bigint,
  channel text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  target text,
  error_message text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  ticket_id text,
  receipt_checked_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.novel_books (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid,
  title text NOT NULL,
  description text DEFAULT ''::text,
  outline text DEFAULT ''::text,
  world_setting text DEFAULT ''::text,
  characters jsonb DEFAULT '[]'::jsonb,
  model_config jsonb DEFAULT '{"prompts": {"outline_prompt": "", "summary_prompt": "", "writing_prompt": "", "character_gen_prompt": ""}, "summary_model": "", "writing_model": "", "context_window_chapters": 3}'::jsonb,
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  summary text DEFAULT ''::text
);

CREATE TABLE IF NOT EXISTS public.novel_chapters (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid,
  book_id uuid,
  chapter_number integer NOT NULL,
  title text DEFAULT ''::text,
  content text DEFAULT ''::text,
  director_note text DEFAULT ''::text,
  summary text DEFAULT ''::text,
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  content text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  source text DEFAULT 'claude'::text,
  created_at timestamp with time zone DEFAULT now(),
  sent_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.pending_wechat_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  source text DEFAULT 'checkin'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  delivered_at timestamp with time zone,
  retry_count integer DEFAULT 0 NOT NULL,
  idempotency_key text,
  last_error text,
  sent_at timestamp with time zone,
  locked_at timestamp with time zone,
  processing_by text
);

CREATE TABLE IF NOT EXISTS public.print_capsules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  paper_size text DEFAULT '95x171'::text,
  status text DEFAULT 'queued'::text NOT NULL,
  created_by text NOT NULL,
  trigger_reason text,
  hidden_until_printed boolean DEFAULT true,
  scheduled_print_week date,
  batch_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  printed_at timestamp with time zone,
  sort_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  content text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.provider_models (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  model_id text NOT NULL,
  model_type text DEFAULT 'chat'::text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  api_base_url text NOT NULL,
  secret_name text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  platform text DEFAULT 'web'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.quests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  created_by text NOT NULL,
  title text NOT NULL,
  description text,
  reward_points integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_note text
);

CREATE TABLE IF NOT EXISTS public.rp_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  client_id uuid,
  client_created_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.rp_npc_cards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  display_name text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  system_prompt text DEFAULT ''::text NOT NULL,
  model_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  api_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  avatar_bg text,
  avatar_initial text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rp_session_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_group_id uuid NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rp_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text,
  player_display_name text,
  player_avatar_url text,
  settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  worldbook_text text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_archived boolean DEFAULT false NOT NULL,
  archived_at timestamp with time zone,
  rp_context_token_limit integer DEFAULT 32000,
  rp_keep_recent_messages integer DEFAULT 10,
  tile_color text
);

CREATE TABLE IF NOT EXISTS public.rp_story_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scheduled_wakeup (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  trigger_at timestamp with time zone NOT NULL,
  timezone text DEFAULT 'Asia/Shanghai'::text,
  message text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_by text NOT NULL,
  recurrence_rule text,
  delivered_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  title text DEFAULT '新会话'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  override_model text,
  override_reasoning boolean,
  is_archived boolean DEFAULT false NOT NULL,
  archived_at timestamp with time zone,
  session_key text,
  conversation_kind text DEFAULT 'direct'::text NOT NULL,
  handler text DEFAULT 'api'::text NOT NULL,
  routing_config jsonb DEFAULT '{"version": 1, "participants": ["chuanchuan", "syzygy_instant"], "default_responder": "syzygy_instant"}'::jsonb NOT NULL,
  conversation_profile_key text
);

CREATE TABLE IF NOT EXISTS public.snack_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_deleted boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.snack_replies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  post_id uuid NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_deleted boolean DEFAULT false NOT NULL,
  role text DEFAULT 'assistant'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.special_dates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  month integer NOT NULL,
  day integer NOT NULL,
  label text DEFAULT ''::text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.syzygy_commands (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  command_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  result jsonb,
  error_message text,
  claimed_by text,
  claimed_at timestamp with time zone,
  idempotency_key text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.syzygy_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  model_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_deleted boolean DEFAULT false NOT NULL,
  deleted_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.syzygy_replies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  post_id uuid NOT NULL,
  author_role text NOT NULL,
  content text NOT NULL,
  model_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_deleted boolean DEFAULT false NOT NULL,
  deleted_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.syzygy_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  signal_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  source text DEFAULT 'claude'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone,
  expires_at timestamp with time zone,
  dedupe_key text
);

CREATE TABLE IF NOT EXISTS public.thought_relations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  from_id uuid NOT NULL,
  to_id uuid NOT NULL,
  score double precision DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.timeline_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  config_key text NOT NULL,
  config_value text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.timeline_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  event_date date NOT NULL,
  summary text NOT NULL,
  recorder text DEFAULT 'syzygy'::text NOT NULL,
  source text DEFAULT 'claude'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.todo_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  date date NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.todos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  category_id uuid NOT NULL,
  date date NOT NULL,
  title text NOT NULL,
  notes text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_by text DEFAULT 'chuanchuan'::text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  todo_type text DEFAULT 'short_term'::text,
  event_date date
);

CREATE TABLE IF NOT EXISTS public.usage_quota (
  user_id uuid NOT NULL,
  scope text NOT NULL,
  day date NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid DEFAULT auth.uid() NOT NULL,
  enabled_models text[] DEFAULT ARRAY[]::text[] NOT NULL,
  default_model text DEFAULT 'openrouter/auto'::text NOT NULL,
  temperature double precision DEFAULT 0.7 NOT NULL,
  top_p double precision DEFAULT 1 NOT NULL,
  max_tokens integer DEFAULT 1024 NOT NULL,
  system_prompt text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  enable_reasoning boolean DEFAULT false NOT NULL,
  snack_system_prompt text,
  syzygy_post_system_prompt text,
  syzygy_reply_system_prompt text,
  memory_extract_model text,
  memory_merge_enabled boolean DEFAULT true NOT NULL,
  compression_enabled boolean DEFAULT true NOT NULL,
  compression_trigger_ratio double precision DEFAULT 0.65 NOT NULL,
  compression_keep_recent_messages integer DEFAULT 20 NOT NULL,
  summarizer_model text,
  memory_auto_extract_enabled boolean DEFAULT false NOT NULL,
  chat_reasoning_enabled boolean DEFAULT true NOT NULL,
  rp_reasoning_enabled boolean DEFAULT false NOT NULL,
  letter_reply_system_prompt text,
  bubble_chat_model text,
  bubble_chat_system_prompt text,
  bubble_chat_max_tokens integer DEFAULT 512,
  bubble_chat_temperature double precision DEFAULT 0.7,
  bubble_chat_reasoning_enabled boolean DEFAULT false,
  lounge_scene_prompt text
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  type text NOT NULL,
  points_delta integer DEFAULT 0 NOT NULL,
  coins_delta numeric(10,2) DEFAULT 0 NOT NULL,
  description text NOT NULL,
  quest_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.wechat_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weekly_digest (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  digest_json jsonb,
  digest_text text,
  highlights text[],
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wiki_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid,
  title text NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  category text DEFAULT '未分类'::text NOT NULL,
  tags text[] DEFAULT '{}'::text[],
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- 3b. 缺列修补（幂等）：已有部署缺列报 42703 时，本段自动补齐缺失列。
--     注意：无默认值的 NOT NULL 列在补列时不加 NOT NULL（老表已有数据时无法回填）。
-- ============================================================================

ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS speaker text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS read_by text[] DEFAULT ARRAY[]::text[];
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS entry_type text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS proposal_status text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS vote text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.agent_council ADD COLUMN IF NOT EXISTS executor text;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY NOT NULL;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS importance text DEFAULT 'normal'::text NOT NULL;
ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS content_format text DEFAULT 'markdown'::text NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal'::text NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS status text DEFAULT 'unread'::text NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS visible_from timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS related_table text;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS related_id uuid;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_feed_items ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS agent_type text;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS last_task text;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS heartbeat_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_heartbeats ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS checkin_enabled boolean DEFAULT false NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS day_mode_start_hour integer DEFAULT 8 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS day_mode_end_hour integer DEFAULT 23 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS day_min_interval_minutes integer DEFAULT 3 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS day_max_interval_minutes integer DEFAULT 60 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS night_mode_start_hour integer DEFAULT 23 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS night_mode_end_hour integer DEFAULT 8 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS night_min_interval_minutes integer DEFAULT 60 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS night_max_interval_minutes integer DEFAULT 180 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS quiet_hours_start_hour integer;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS quiet_hours_end_hour integer;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS cooldown_after_interaction_minutes integer DEFAULT 15 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS max_daily_checkins_day integer DEFAULT 10 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS max_daily_checkins_night integer DEFAULT 3 NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS per_channel_schedule jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS heartbeat_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS wechat_context_summary_model text DEFAULT 'deepseek/deepseek-chat'::text;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS wechat_context_window_rounds integer DEFAULT 18;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS wechat_context_summary_trigger_rounds integer DEFAULT 20;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS wechat_context_summary_refresh_rounds integer DEFAULT 10;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS wechat_memory_search_min_length integer DEFAULT 6;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS wechat_memory_search_enabled boolean DEFAULT true;
ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS agent_mode text DEFAULT 'active'::text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS executor text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS command text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS result_summary text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS result_detail text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS payload_json jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS approval_id uuid;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS executor text;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS status text DEFAULT 'claimed'::text NOT NULL;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS finished_at timestamp with time zone;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS exit_code integer;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS output_excerpt text;
ALTER TABLE public.approval_executions ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS source_actor text;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS proposed_action jsonb;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS response_note text;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS responded_at timestamp with time zone;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.archive_categories ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS keywords text[] DEFAULT '{}'::text[];
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}'::text[];
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS importance text DEFAULT 'normal'::text;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'::text;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT false NOT NULL;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS t2_mode text DEFAULT 'off'::text NOT NULL;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS t2_interval_hours integer DEFAULT 12;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS t2_random_probability double precision DEFAULT 0.3;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS t2_daily_limit integer DEFAULT 3;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS last_auto_letter_at timestamp with time zone;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS auto_letters_today integer DEFAULT 0;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS auto_letters_today_date date DEFAULT CURRENT_DATE;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS active_hour_start integer DEFAULT 9;
ALTER TABLE public.auto_letter_config ADD COLUMN IF NOT EXISTS active_hour_end integer DEFAULT 23;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text NOT NULL;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS action_tag text;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.bubble_messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.bubble_sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.bubble_sessions ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.bubble_sessions ADD COLUMN IF NOT EXISTS session_date date DEFAULT CURRENT_DATE NOT NULL;
ALTER TABLE public.bubble_sessions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.bubble_sessions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS trigger_conditions text;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS cooldown_rule text;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS risk_level text DEFAULT 'low'::text NOT NULL;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS requires_confirmation boolean DEFAULT false;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS output_channel text;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS last_used_at timestamp with time zone;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS trigger_config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS cooldown_until timestamp with time zone;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS usage_count integer DEFAULT 0;
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS failure_count integer DEFAULT 0;
ALTER TABLE public.channel_config ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.channel_config ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.channel_config ADD COLUMN IF NOT EXISTS channel_name text;
ALTER TABLE public.channel_config ADD COLUMN IF NOT EXISTS active_model text;
ALTER TABLE public.channel_config ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.channel_config ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS checkin_time timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS input_summary text;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS raw_output text;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS decision text DEFAULT 'silent'::text NOT NULL;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS wechat_message_id uuid;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS tokens_used integer;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS error_detail text;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS canonical_message_id uuid;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS canonical_event_id bigint;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS topic_fingerprint text;
ALTER TABLE public.checkin_logs ADD COLUMN IF NOT EXISTS generation_audit jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS checkin_date date;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'::text NOT NULL;
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS executed_at timestamp with time zone;
ALTER TABLE public.codex_control ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS task text;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS source text DEFAULT 'syzygy'::text NOT NULL;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS result text;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
ALTER TABLE public.codex_tasks ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.compression_cache ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.compression_cache ADD COLUMN IF NOT EXISTS compressed_up_to_message_id uuid;
ALTER TABLE public.compression_cache ADD COLUMN IF NOT EXISTS summary_text text;
ALTER TABLE public.compression_cache ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.compression_cache ADD COLUMN IF NOT EXISTS module text DEFAULT 'chat'::text NOT NULL;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS profile_key text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS conversation_kind text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS handler text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS session_policy text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS singleton_session_key text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS participant_port_keys text[];
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS default_responder_port_key text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS rules_prompt_name text;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS context_recipe jsonb;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS active boolean DEFAULT true NOT NULL;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.conversation_profiles ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.council_categories ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.council_categories ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.council_categories ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS snapshot_type text DEFAULT 'current_status'::text NOT NULL;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS summary_text text;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS summary_json jsonb;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS stale_after timestamp with time zone;
ALTER TABLE public.current_context_snapshot ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS period_of_day text;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS summary_json jsonb;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS summary_text text;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS care_priority text;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS source_range_start timestamp with time zone;
ALTER TABLE public.daily_status_digest ADD COLUMN IF NOT EXISTS source_range_end timestamp with time zone;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS battery_level integer;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS wifi_name text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS source_app text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS device_name text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS brightness double precision;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS now_playing text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS raw_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS weather text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS steps integer;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS now_playing_title text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS now_playing_artist text;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS is_charging boolean;
ALTER TABLE public.device_status ADD COLUMN IF NOT EXISTS step_count integer;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS device_name text;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS expo_push_token text;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS native_push_token text;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS provider_id uuid;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false NOT NULL;
ALTER TABLE public.enabled_models ADD COLUMN IF NOT EXISTS enabled_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS slot_index integer;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS system_prompt text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS model text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS temperature double precision;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS top_p double precision;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS api_base_url text;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.forum_ai_profiles ADD COLUMN IF NOT EXISTS context_token_limit integer DEFAULT 32000 NOT NULL;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS thread_id uuid;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS body text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS author_type text;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS author_slot integer;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS author_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS reply_to_reply_id uuid;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS reply_to_author_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.forum_replies ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS title text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS body text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS author_type text;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS author_slot integer;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS author_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.forum_threads ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS port_key text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS runtime_kind text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS model_channel_name text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS target_role text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS identity_prompt_name text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS style_prompt_name text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS sop_source text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS sop_ref text;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS active boolean DEFAULT true NOT NULL;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.generation_ports ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS source_context text;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS captured_by text;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS status text DEFAULT 'captured'::text;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.knowledge_folders ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS from_node_id uuid;
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS to_node_id uuid;
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS edge_type text;
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS strength integer DEFAULT 1;
ALTER TABLE public.learning_edges ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS folder_id uuid;
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS node_type text;
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.learning_nodes ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.letter_conversations ADD COLUMN IF NOT EXISTS letter_id uuid;
ALTER TABLE public.letter_conversations ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.letter_conversations ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.letter_conversations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'manual'::text NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS trigger_reason text;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS module text DEFAULT 'letter'::text NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS secret_name text;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS active boolean DEFAULT false NOT NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0 NOT NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.llm_providers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS module text;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS conversation_id text;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS total_tokens integer;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS cached_tokens integer;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS cache_write_tokens integer;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS cost_usd numeric;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE public.lounge_members ADD COLUMN IF NOT EXISTS sender text;
ALTER TABLE public.lounge_members ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.lounge_members ADD COLUMN IF NOT EXISTS emoji text;
ALTER TABLE public.lounge_members ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS sender text;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS mentions text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.lounge_messages ADD COLUMN IF NOT EXISTS sofa_id uuid;
ALTER TABLE public.lounge_sofas ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.lounge_sofas ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.lounge_sofas ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.lounge_sofas ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS source text DEFAULT 'user'::text NOT NULL;
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.memo_entries ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE public.memo_entry_tags ADD COLUMN IF NOT EXISTS memo_entry_id uuid;
ALTER TABLE public.memo_entry_tags ADD COLUMN IF NOT EXISTS memo_tag_id uuid;
ALTER TABLE public.memo_tags ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.memo_tags ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.memo_tags ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.memo_tags ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.memory_entries ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_created_at timestamp with time zone;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_key text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS target_sender_keys text[];
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS agent_event_id bigint;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued'::text NOT NULL;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS ticket_id text;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS receipt_checked_at timestamp with time zone;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS description text DEFAULT ''::text;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS outline text DEFAULT ''::text;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS world_setting text DEFAULT ''::text;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS characters jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS model_config jsonb DEFAULT '{"prompts": {"outline_prompt": "", "summary_prompt": "", "writing_prompt": "", "character_gen_prompt": ""}, "summary_model": "", "writing_model": "", "context_window_chapters": 3}'::jsonb;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft'::text NOT NULL;
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.novel_books ADD COLUMN IF NOT EXISTS summary text DEFAULT ''::text;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS book_id uuid;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS chapter_number integer;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS title text DEFAULT ''::text;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS director_note text DEFAULT ''::text;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS summary text DEFAULT ''::text;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft'::text NOT NULL;
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.novel_chapters ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS source text DEFAULT 'claude'::text;
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.outbound_messages ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS source text DEFAULT 'checkin'::text NOT NULL;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS locked_at timestamp with time zone;
ALTER TABLE public.pending_wechat_messages ADD COLUMN IF NOT EXISTS processing_by text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS paper_size text DEFAULT '95x171'::text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued'::text NOT NULL;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS trigger_reason text;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS hidden_until_printed boolean DEFAULT true;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS scheduled_print_week date;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS printed_at timestamp with time zone;
ALTER TABLE public.print_capsules ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS active boolean DEFAULT true NOT NULL;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS provider_id uuid;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS model_type text DEFAULT 'chat'::text NOT NULL;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false NOT NULL;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.provider_models ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS api_base_url text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS secret_name text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS priority integer DEFAULT 100 NOT NULL;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS endpoint text;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS p256dh text;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS auth text;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS platform text DEFAULT 'web'::text NOT NULL;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS reward_points integer DEFAULT 0 NOT NULL;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS status text DEFAULT 'open'::text NOT NULL;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS completed_note text;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.rp_messages ADD COLUMN IF NOT EXISTS client_created_at timestamp with time zone;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS system_prompt text DEFAULT ''::text NOT NULL;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS model_config jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS api_config jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS avatar_bg text;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS avatar_initial text;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.rp_npc_cards ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.rp_session_groups ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rp_session_groups ADD COLUMN IF NOT EXISTS story_group_id uuid;
ALTER TABLE public.rp_session_groups ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.rp_session_groups ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.rp_session_groups ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS player_display_name text;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS player_avatar_url text;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS worldbook_text text DEFAULT ''::text NOT NULL;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false NOT NULL;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS rp_context_token_limit integer DEFAULT 32000;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS rp_keep_recent_messages integer DEFAULT 10;
ALTER TABLE public.rp_sessions ADD COLUMN IF NOT EXISTS tile_color text;
ALTER TABLE public.rp_story_groups ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rp_story_groups ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.rp_story_groups ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.rp_story_groups ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.rp_story_groups ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.rp_story_groups ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS trigger_at timestamp with time zone;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Asia/Shanghai'::text;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS recurrence_rule text;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone;
ALTER TABLE public.scheduled_wakeup ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS title text DEFAULT '新会话'::text NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS override_model text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS override_reasoning boolean;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS session_key text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS conversation_kind text DEFAULT 'direct'::text NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS handler text DEFAULT 'api'::text NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS routing_config jsonb DEFAULT '{"version": 1, "participants": ["chuanchuan", "syzygy_instant"], "default_responder": "syzygy_instant"}'::jsonb NOT NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS conversation_profile_key text;
ALTER TABLE public.snack_posts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.snack_posts ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.snack_posts ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text NOT NULL;
ALTER TABLE public.snack_posts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.snack_posts ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.snack_posts ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS post_id uuid;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL;
ALTER TABLE public.snack_replies ADD COLUMN IF NOT EXISTS role text DEFAULT 'assistant'::text NOT NULL;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS month integer;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS day integer;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS label text DEFAULT ''::text NOT NULL;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.special_dates ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS command_type text;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS claimed_by text;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.syzygy_commands ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL;
ALTER TABLE public.syzygy_posts ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS post_id uuid;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS author_role text;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false NOT NULL;
ALTER TABLE public.syzygy_replies ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS signal_type text;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS source text DEFAULT 'claude'::text NOT NULL;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.syzygy_signals ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.thought_relations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.thought_relations ADD COLUMN IF NOT EXISTS from_id uuid;
ALTER TABLE public.thought_relations ADD COLUMN IF NOT EXISTS to_id uuid;
ALTER TABLE public.thought_relations ADD COLUMN IF NOT EXISTS score double precision DEFAULT 0;
ALTER TABLE public.thought_relations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.timeline_config ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.timeline_config ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.timeline_config ADD COLUMN IF NOT EXISTS config_key text;
ALTER TABLE public.timeline_config ADD COLUMN IF NOT EXISTS config_value text;
ALTER TABLE public.timeline_config ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.timeline_config ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS event_date date;
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS recorder text DEFAULT 'syzygy'::text NOT NULL;
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS source text DEFAULT 'claude'::text NOT NULL;
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.timeline_entries ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.todo_categories ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.todo_categories ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.todo_categories ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE public.todo_categories ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.todo_categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.todo_categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS created_by text DEFAULT 'chuanchuan'::text NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS todo_type text DEFAULT 'short_term'::text;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS event_date date;
ALTER TABLE public.usage_quota ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.usage_quota ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE public.usage_quota ADD COLUMN IF NOT EXISTS day date;
ALTER TABLE public.usage_quota ADD COLUMN IF NOT EXISTS count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.usage_quota ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS enabled_models text[] DEFAULT ARRAY[]::text[] NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS default_model text DEFAULT 'openrouter/auto'::text NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS temperature double precision DEFAULT 0.7 NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS top_p double precision DEFAULT 1 NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS max_tokens integer DEFAULT 1024 NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS system_prompt text DEFAULT ''::text NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS enable_reasoning boolean DEFAULT false NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS snack_system_prompt text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS syzygy_post_system_prompt text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS syzygy_reply_system_prompt text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS memory_extract_model text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS memory_merge_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS compression_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS compression_trigger_ratio double precision DEFAULT 0.65 NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS compression_keep_recent_messages integer DEFAULT 20 NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS summarizer_model text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS memory_auto_extract_enabled boolean DEFAULT false NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS chat_reasoning_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS rp_reasoning_enabled boolean DEFAULT false NOT NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS letter_reply_system_prompt text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS bubble_chat_model text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS bubble_chat_system_prompt text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS bubble_chat_max_tokens integer DEFAULT 512;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS bubble_chat_temperature double precision DEFAULT 0.7;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS bubble_chat_reasoning_enabled boolean DEFAULT false;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS lounge_scene_prompt text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS points_delta integer DEFAULT 0 NOT NULL;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS coins_delta numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS quest_id uuid;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.wechat_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.wechat_messages ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.wechat_messages ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.wechat_messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.wechat_messages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid NOT NULL;
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS week_start date;
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS week_end date;
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS digest_json jsonb;
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS digest_text text;
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS highlights text[];
ALTER TABLE public.weekly_digest ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid;
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text NOT NULL;
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS category text DEFAULT '未分类'::text NOT NULL;
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft'::text NOT NULL;
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.wiki_entries ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- ============================================================================
-- 4. 主键与唯一约束
-- ============================================================================

DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_pkey' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_events_pkey' AND conrelid = 'public.agent_events'::regclass) THEN ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_pkey' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_heartbeats_pkey' AND conrelid = 'public.agent_heartbeats'::regclass) THEN ALTER TABLE public.agent_heartbeats ADD CONSTRAINT agent_heartbeats_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_heartbeats_user_id_agent_id_key' AND conrelid = 'public.agent_heartbeats'::regclass) THEN ALTER TABLE public.agent_heartbeats ADD CONSTRAINT agent_heartbeats_user_id_agent_id_key UNIQUE (user_id, agent_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_pkey' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_user_id_key' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_user_id_key UNIQUE (user_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_pkey' AND conrelid = 'public.agent_tasks'::regclass) THEN ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_executions_approval_id_key' AND conrelid = 'public.approval_executions'::regclass) THEN ALTER TABLE public.approval_executions ADD CONSTRAINT approval_executions_approval_id_key UNIQUE (approval_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_executions_pkey' AND conrelid = 'public.approval_executions'::regclass) THEN ALTER TABLE public.approval_executions ADD CONSTRAINT approval_executions_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_pkey' AND conrelid = 'public.approval_requests'::regclass) THEN ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archive_categories_pkey' AND conrelid = 'public.archive_categories'::regclass) THEN ALTER TABLE public.archive_categories ADD CONSTRAINT archive_categories_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archives_pkey' AND conrelid = 'public.archives'::regclass) THEN ALTER TABLE public.archives ADD CONSTRAINT archives_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_letter_config_pkey' AND conrelid = 'public.auto_letter_config'::regclass) THEN ALTER TABLE public.auto_letter_config ADD CONSTRAINT auto_letter_config_pkey PRIMARY KEY (user_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bubble_messages_pkey' AND conrelid = 'public.bubble_messages'::regclass) THEN ALTER TABLE public.bubble_messages ADD CONSTRAINT bubble_messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bubble_sessions_pkey' AND conrelid = 'public.bubble_sessions'::regclass) THEN ALTER TABLE public.bubble_sessions ADD CONSTRAINT bubble_sessions_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bubble_sessions_user_id_chat_date_key' AND conrelid = 'public.bubble_sessions'::regclass) THEN ALTER TABLE public.bubble_sessions ADD CONSTRAINT bubble_sessions_user_id_chat_date_key UNIQUE (user_id, session_date); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capabilities_name_key' AND conrelid = 'public.capabilities'::regclass) THEN ALTER TABLE public.capabilities ADD CONSTRAINT capabilities_name_key UNIQUE (name); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capabilities_pkey' AND conrelid = 'public.capabilities'::regclass) THEN ALTER TABLE public.capabilities ADD CONSTRAINT capabilities_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_config_pkey' AND conrelid = 'public.channel_config'::regclass) THEN ALTER TABLE public.channel_config ADD CONSTRAINT channel_config_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_config_user_id_channel_name_key' AND conrelid = 'public.channel_config'::regclass) THEN ALTER TABLE public.channel_config ADD CONSTRAINT channel_config_user_id_channel_name_key UNIQUE (user_id, channel_name); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_pkey' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkins_pkey' AND conrelid = 'public.checkins'::regclass) THEN ALTER TABLE public.checkins ADD CONSTRAINT checkins_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_control_pkey' AND conrelid = 'public.codex_control'::regclass) THEN ALTER TABLE public.codex_control ADD CONSTRAINT codex_control_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_tasks_pkey' AND conrelid = 'public.codex_tasks'::regclass) THEN ALTER TABLE public.codex_tasks ADD CONSTRAINT codex_tasks_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compression_cache_module_conv_key' AND conrelid = 'public.compression_cache'::regclass) THEN ALTER TABLE public.compression_cache ADD CONSTRAINT compression_cache_module_conv_key UNIQUE (module, conversation_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compression_cache_pkey' AND conrelid = 'public.compression_cache'::regclass) THEN ALTER TABLE public.compression_cache ADD CONSTRAINT compression_cache_pkey PRIMARY KEY (conversation_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_pkey' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_user_key_version_unique' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_user_key_version_unique UNIQUE (user_id, profile_key, version); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'council_categories_pkey' AND conrelid = 'public.council_categories'::regclass) THEN ALTER TABLE public.council_categories ADD CONSTRAINT council_categories_pkey PRIMARY KEY (key); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'current_context_snapshot_pkey' AND conrelid = 'public.current_context_snapshot'::regclass) THEN ALTER TABLE public.current_context_snapshot ADD CONSTRAINT current_context_snapshot_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_status_digest_pkey' AND conrelid = 'public.daily_status_digest'::regclass) THEN ALTER TABLE public.daily_status_digest ADD CONSTRAINT daily_status_digest_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_status_pkey' AND conrelid = 'public.device_status'::regclass) THEN ALTER TABLE public.device_status ADD CONSTRAINT device_status_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_tokens_pkey' AND conrelid = 'public.device_tokens'::regclass) THEN ALTER TABLE public.device_tokens ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_tokens_user_id_expo_push_token_key' AND conrelid = 'public.device_tokens'::regclass) THEN ALTER TABLE public.device_tokens ADD CONSTRAINT device_tokens_user_id_expo_push_token_key UNIQUE (user_id, expo_push_token); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enabled_models_pkey' AND conrelid = 'public.enabled_models'::regclass) THEN ALTER TABLE public.enabled_models ADD CONSTRAINT enabled_models_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enabled_models_user_id_provider_id_model_id_key' AND conrelid = 'public.enabled_models'::regclass) THEN ALTER TABLE public.enabled_models ADD CONSTRAINT enabled_models_user_id_provider_id_model_id_key UNIQUE (user_id, provider_id, model_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_ai_profiles_pkey' AND conrelid = 'public.forum_ai_profiles'::regclass) THEN ALTER TABLE public.forum_ai_profiles ADD CONSTRAINT forum_ai_profiles_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_ai_profiles_user_id_slot_index_key' AND conrelid = 'public.forum_ai_profiles'::regclass) THEN ALTER TABLE public.forum_ai_profiles ADD CONSTRAINT forum_ai_profiles_user_id_slot_index_key UNIQUE (user_id, slot_index); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_replies_pkey' AND conrelid = 'public.forum_replies'::regclass) THEN ALTER TABLE public.forum_replies ADD CONSTRAINT forum_replies_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_pkey' AND conrelid = 'public.forum_threads'::regclass) THEN ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_pkey' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_user_key_version_unique' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_user_key_version_unique UNIQUE (user_id, port_key, version); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_pkey' AND conrelid = 'public.ideas'::regclass) THEN ALTER TABLE public.ideas ADD CONSTRAINT ideas_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_folders_pkey' AND conrelid = 'public.knowledge_folders'::regclass) THEN ALTER TABLE public.knowledge_folders ADD CONSTRAINT knowledge_folders_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_edges_pkey' AND conrelid = 'public.learning_edges'::regclass) THEN ALTER TABLE public.learning_edges ADD CONSTRAINT learning_edges_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_nodes_pkey' AND conrelid = 'public.learning_nodes'::regclass) THEN ALTER TABLE public.learning_nodes ADD CONSTRAINT learning_nodes_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letter_conversations_pkey' AND conrelid = 'public.letter_conversations'::regclass) THEN ALTER TABLE public.letter_conversations ADD CONSTRAINT letter_conversations_pkey PRIMARY KEY (letter_id, conversation_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letters_pkey' AND conrelid = 'public.letters'::regclass) THEN ALTER TABLE public.letters ADD CONSTRAINT letters_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_providers_pkey' AND conrelid = 'public.llm_providers'::regclass) THEN ALTER TABLE public.llm_providers ADD CONSTRAINT llm_providers_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_providers_user_id_name_key' AND conrelid = 'public.llm_providers'::regclass) THEN ALTER TABLE public.llm_providers ADD CONSTRAINT llm_providers_user_id_name_key UNIQUE (user_id, name); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_usage_pkey' AND conrelid = 'public.llm_usage'::regclass) THEN ALTER TABLE public.llm_usage ADD CONSTRAINT llm_usage_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lounge_members_pkey' AND conrelid = 'public.lounge_members'::regclass) THEN ALTER TABLE public.lounge_members ADD CONSTRAINT lounge_members_pkey PRIMARY KEY (sender); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lounge_messages_pkey' AND conrelid = 'public.lounge_messages'::regclass) THEN ALTER TABLE public.lounge_messages ADD CONSTRAINT lounge_messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lounge_sofas_pkey' AND conrelid = 'public.lounge_sofas'::regclass) THEN ALTER TABLE public.lounge_sofas ADD CONSTRAINT lounge_sofas_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_entries_pkey' AND conrelid = 'public.memo_entries'::regclass) THEN ALTER TABLE public.memo_entries ADD CONSTRAINT memo_entries_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_entry_tags_pkey' AND conrelid = 'public.memo_entry_tags'::regclass) THEN ALTER TABLE public.memo_entry_tags ADD CONSTRAINT memo_entry_tags_pkey PRIMARY KEY (memo_entry_id, memo_tag_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_tags_pkey' AND conrelid = 'public.memo_tags'::regclass) THEN ALTER TABLE public.memo_tags ADD CONSTRAINT memo_tags_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_tags_user_id_name_key' AND conrelid = 'public.memo_tags'::regclass) THEN ALTER TABLE public.memo_tags ADD CONSTRAINT memo_tags_user_id_name_key UNIQUE (user_id, name); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_entries_pkey' AND conrelid = 'public.memory_entries'::regclass) THEN ALTER TABLE public.memory_entries ADD CONSTRAINT memory_entries_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_pkey' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_session_id_id_unique' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_session_id_id_unique UNIQUE (session_id, id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_events_pkey' AND conrelid = 'public.notification_events'::regclass) THEN ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_books_pkey' AND conrelid = 'public.novel_books'::regclass) THEN ALTER TABLE public.novel_books ADD CONSTRAINT novel_books_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_chapters_book_id_chapter_number_key' AND conrelid = 'public.novel_chapters'::regclass) THEN ALTER TABLE public.novel_chapters ADD CONSTRAINT novel_chapters_book_id_chapter_number_key UNIQUE (book_id, chapter_number); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_chapters_pkey' AND conrelid = 'public.novel_chapters'::regclass) THEN ALTER TABLE public.novel_chapters ADD CONSTRAINT novel_chapters_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_pkey' AND conrelid = 'public.outbound_messages'::regclass) THEN ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_wechat_messages_pkey' AND conrelid = 'public.pending_wechat_messages'::regclass) THEN ALTER TABLE public.pending_wechat_messages ADD CONSTRAINT pending_wechat_messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_capsules_pkey' AND conrelid = 'public.print_capsules'::regclass) THEN ALTER TABLE public.print_capsules ADD CONSTRAINT print_capsules_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_pkey' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_user_id_name_version_key' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_user_id_name_version_key UNIQUE (user_id, name, version); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_models_pkey' AND conrelid = 'public.provider_models'::regclass) THEN ALTER TABLE public.provider_models ADD CONSTRAINT provider_models_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_models_unique_binding' AND conrelid = 'public.provider_models'::regclass) THEN ALTER TABLE public.provider_models ADD CONSTRAINT provider_models_unique_binding UNIQUE (provider_id, model_id, model_type); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_name_unique_per_user' AND conrelid = 'public.providers'::regclass) THEN ALTER TABLE public.providers ADD CONSTRAINT providers_name_unique_per_user UNIQUE (user_id, name); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_pkey' AND conrelid = 'public.providers'::regclass) THEN ALTER TABLE public.providers ADD CONSTRAINT providers_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_pkey' AND conrelid = 'public.push_subscriptions'::regclass) THEN ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_endpoint_key' AND conrelid = 'public.push_subscriptions'::regclass) THEN ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quests_pkey' AND conrelid = 'public.quests'::regclass) THEN ALTER TABLE public.quests ADD CONSTRAINT quests_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_messages_pkey' AND conrelid = 'public.rp_messages'::regclass) THEN ALTER TABLE public.rp_messages ADD CONSTRAINT rp_messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_npc_cards_pkey' AND conrelid = 'public.rp_npc_cards'::regclass) THEN ALTER TABLE public.rp_npc_cards ADD CONSTRAINT rp_npc_cards_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_session_groups_pkey' AND conrelid = 'public.rp_session_groups'::regclass) THEN ALTER TABLE public.rp_session_groups ADD CONSTRAINT rp_session_groups_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_session_groups_session_id_key' AND conrelid = 'public.rp_session_groups'::regclass) THEN ALTER TABLE public.rp_session_groups ADD CONSTRAINT rp_session_groups_session_id_key UNIQUE (session_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_session_groups_story_group_id_session_id_key' AND conrelid = 'public.rp_session_groups'::regclass) THEN ALTER TABLE public.rp_session_groups ADD CONSTRAINT rp_session_groups_story_group_id_session_id_key UNIQUE (story_group_id, session_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_sessions_pkey' AND conrelid = 'public.rp_sessions'::regclass) THEN ALTER TABLE public.rp_sessions ADD CONSTRAINT rp_sessions_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_story_groups_pkey' AND conrelid = 'public.rp_story_groups'::regclass) THEN ALTER TABLE public.rp_story_groups ADD CONSTRAINT rp_story_groups_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_wakeup_pkey' AND conrelid = 'public.scheduled_wakeup'::regclass) THEN ALTER TABLE public.scheduled_wakeup ADD CONSTRAINT scheduled_wakeup_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_pkey' AND conrelid = 'public.sessions'::regclass) THEN ALTER TABLE public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snack_posts_pkey' AND conrelid = 'public.snack_posts'::regclass) THEN ALTER TABLE public.snack_posts ADD CONSTRAINT snack_posts_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snack_replies_pkey' AND conrelid = 'public.snack_replies'::regclass) THEN ALTER TABLE public.snack_replies ADD CONSTRAINT snack_replies_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'special_dates_pkey' AND conrelid = 'public.special_dates'::regclass) THEN ALTER TABLE public.special_dates ADD CONSTRAINT special_dates_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_commands_pkey' AND conrelid = 'public.syzygy_commands'::regclass) THEN ALTER TABLE public.syzygy_commands ADD CONSTRAINT syzygy_commands_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_commands_user_id_idempotency_key_key' AND conrelid = 'public.syzygy_commands'::regclass) THEN ALTER TABLE public.syzygy_commands ADD CONSTRAINT syzygy_commands_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_posts_pkey' AND conrelid = 'public.syzygy_posts'::regclass) THEN ALTER TABLE public.syzygy_posts ADD CONSTRAINT syzygy_posts_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_replies_pkey' AND conrelid = 'public.syzygy_replies'::regclass) THEN ALTER TABLE public.syzygy_replies ADD CONSTRAINT syzygy_replies_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_signals_pkey' AND conrelid = 'public.syzygy_signals'::regclass) THEN ALTER TABLE public.syzygy_signals ADD CONSTRAINT syzygy_signals_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_relations_from_id_to_id_key' AND conrelid = 'public.thought_relations'::regclass) THEN ALTER TABLE public.thought_relations ADD CONSTRAINT thought_relations_from_id_to_id_key UNIQUE (from_id, to_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_relations_pkey' AND conrelid = 'public.thought_relations'::regclass) THEN ALTER TABLE public.thought_relations ADD CONSTRAINT thought_relations_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_config_pkey' AND conrelid = 'public.timeline_config'::regclass) THEN ALTER TABLE public.timeline_config ADD CONSTRAINT timeline_config_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_config_user_id_config_key_key' AND conrelid = 'public.timeline_config'::regclass) THEN ALTER TABLE public.timeline_config ADD CONSTRAINT timeline_config_user_id_config_key_key UNIQUE (user_id, config_key); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_entries_pkey' AND conrelid = 'public.timeline_entries'::regclass) THEN ALTER TABLE public.timeline_entries ADD CONSTRAINT timeline_entries_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_categories_pkey' AND conrelid = 'public.todo_categories'::regclass) THEN ALTER TABLE public.todo_categories ADD CONSTRAINT todo_categories_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_pkey' AND conrelid = 'public.todos'::regclass) THEN ALTER TABLE public.todos ADD CONSTRAINT todos_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_quota_pkey' AND conrelid = 'public.usage_quota'::regclass) THEN ALTER TABLE public.usage_quota ADD CONSTRAINT usage_quota_pkey PRIMARY KEY (user_id, scope, day); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_pkey' AND conrelid = 'public.user_settings'::regclass) THEN ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_pkey' AND conrelid = 'public.wallet_transactions'::regclass) THEN ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wechat_messages_pkey' AND conrelid = 'public.wechat_messages'::regclass) THEN ALTER TABLE public.wechat_messages ADD CONSTRAINT wechat_messages_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_digest_pkey' AND conrelid = 'public.weekly_digest'::regclass) THEN ALTER TABLE public.weekly_digest ADD CONSTRAINT weekly_digest_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wiki_entries_pkey' AND conrelid = 'public.wiki_entries'::regclass) THEN ALTER TABLE public.wiki_entries ADD CONSTRAINT wiki_entries_pkey PRIMARY KEY (id); END IF; END $c$;

-- ============================================================================
-- 5. CHECK 约束
-- ============================================================================

DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_entry_type_check' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_entry_type_check CHECK (((entry_type IS NULL) OR (entry_type = ANY (ARRAY['proposal'::text, 'review'::text, 'decision'::text, 'report'::text])))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_executor_check' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_executor_check CHECK (((executor IS NULL) OR (executor = ANY (ARRAY['codex_cli'::text, 'claude_code_cli'::text, 'client'::text, 'chuanchuan'::text])))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_proposal_status_check' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_proposal_status_check CHECK (((proposal_status IS NULL) OR (proposal_status = ANY (ARRAY['open'::text, 'approved'::text, 'rejected'::text, 'deferred'::text, 'plan_generated'::text, 'done'::text, 'failed'::text])))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_speaker_check' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_speaker_check CHECK ((speaker = ANY (ARRAY['claude'::text, 'gpt'::text, 'gemini'::text, 'chuanchuan'::text, 'codex_cli'::text, 'claude_code_cli'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_vote_check' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_vote_check CHECK (((vote IS NULL) OR (vote = ANY (ARRAY['support'::text, 'neutral'::text, 'against'::text])))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_events_importance_check' AND conrelid = 'public.agent_events'::regclass) THEN ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_importance_check CHECK ((importance = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_content_format_check' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_content_format_check CHECK ((content_format = ANY (ARRAY['markdown'::text, 'plain'::text, 'json'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_priority_check' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_read_at_check' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_read_at_check CHECK ((((status = 'read'::text) AND (read_at IS NOT NULL)) OR (status <> 'read'::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_status_check' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_status_check CHECK ((status = ANY (ARRAY['unread'::text, 'read'::text, 'archived'::text, 'expired'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_type_check' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_type_check CHECK ((type = ANY (ARRAY['morning_share'::text, 'reading_assist'::text, 'daily_card'::text, 'system_notice'::text, 'syzygy_note'::text, 'weekly_card'::text, 'reminder_card'::text, 'print_card'::text, 'dev_log'::text, 'monthly_overview'::text, 'other'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_heartbeats_status_check' AND conrelid = 'public.agent_heartbeats'::regclass) THEN ALTER TABLE public.agent_heartbeats ADD CONSTRAINT agent_heartbeats_status_check CHECK ((status = ANY (ARRAY['online'::text, 'idle'::text, 'working'::text, 'waiting_approval'::text, 'failed'::text, 'offline'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_agent_mode_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_agent_mode_check CHECK ((agent_mode = ANY (ARRAY['active'::text, 'quiet'::text, 'paused'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_cooldown_after_interaction_minutes_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_cooldown_after_interaction_minutes_check CHECK ((cooldown_after_interaction_minutes >= 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_day_max_interval_minutes_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_day_max_interval_minutes_check CHECK ((day_max_interval_minutes > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_day_min_interval_minutes_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_day_min_interval_minutes_check CHECK ((day_min_interval_minutes > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_day_mode_end_hour_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_day_mode_end_hour_check CHECK (((day_mode_end_hour >= 0) AND (day_mode_end_hour <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_day_mode_start_hour_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_day_mode_start_hour_check CHECK (((day_mode_start_hour >= 0) AND (day_mode_start_hour <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_max_daily_checkins_day_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_max_daily_checkins_day_check CHECK ((max_daily_checkins_day >= 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_max_daily_checkins_night_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_max_daily_checkins_night_check CHECK ((max_daily_checkins_night >= 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_night_max_interval_minutes_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_night_max_interval_minutes_check CHECK ((night_max_interval_minutes > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_night_min_interval_minutes_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_night_min_interval_minutes_check CHECK ((night_min_interval_minutes > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_night_mode_end_hour_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_night_mode_end_hour_check CHECK (((night_mode_end_hour >= 0) AND (night_mode_end_hour <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_night_mode_start_hour_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_night_mode_start_hour_check CHECK (((night_mode_start_hour >= 0) AND (night_mode_start_hour <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_quiet_hours_end_hour_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_quiet_hours_end_hour_check CHECK (((quiet_hours_end_hour >= 0) AND (quiet_hours_end_hour <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_quiet_hours_start_hour_check' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_quiet_hours_start_hour_check CHECK (((quiet_hours_start_hour >= 0) AND (quiet_hours_start_hour <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_executor_check' AND conrelid = 'public.agent_tasks'::regclass) THEN ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_executor_check CHECK ((executor = ANY (ARRAY['codex_cli'::text, 'claude_code_cli'::text, 'edge_function'::text, 'system'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_status_check' AND conrelid = 'public.agent_tasks'::regclass) THEN ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_executions_status_check' AND conrelid = 'public.approval_executions'::regclass) THEN ALTER TABLE public.approval_executions ADD CONSTRAINT approval_executions_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'stale_skipped'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_status_check' AND conrelid = 'public.approval_requests'::regclass) THEN ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'cancelled'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archive_categories_parent_not_self' AND conrelid = 'public.archive_categories'::regclass) THEN ALTER TABLE public.archive_categories ADD CONSTRAINT archive_categories_parent_not_self CHECK (((parent_id IS NULL) OR (parent_id <> id))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archive_categories_scope_check' AND conrelid = 'public.archive_categories'::regclass) THEN ALTER TABLE public.archive_categories ADD CONSTRAINT archive_categories_scope_check CHECK ((scope = ANY (ARRAY['chuanchuan'::text, 'syzygy'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archives_importance_check' AND conrelid = 'public.archives'::regclass) THEN ALTER TABLE public.archives ADD CONSTRAINT archives_importance_check CHECK ((importance = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'critical'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_letter_config_active_hour_end_check' AND conrelid = 'public.auto_letter_config'::regclass) THEN ALTER TABLE public.auto_letter_config ADD CONSTRAINT auto_letter_config_active_hour_end_check CHECK (((active_hour_end >= 0) AND (active_hour_end <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_letter_config_active_hour_start_check' AND conrelid = 'public.auto_letter_config'::regclass) THEN ALTER TABLE public.auto_letter_config ADD CONSTRAINT auto_letter_config_active_hour_start_check CHECK (((active_hour_start >= 0) AND (active_hour_start <= 23))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_letter_config_t2_mode_check' AND conrelid = 'public.auto_letter_config'::regclass) THEN ALTER TABLE public.auto_letter_config ADD CONSTRAINT auto_letter_config_t2_mode_check CHECK ((t2_mode = ANY (ARRAY['off'::text, 'fixed'::text, 'random'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bubble_messages_role_check' AND conrelid = 'public.bubble_messages'::regclass) THEN ALTER TABLE public.bubble_messages ADD CONSTRAINT bubble_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capabilities_risk_level_check' AND conrelid = 'public.capabilities'::regclass) THEN ALTER TABLE public.capabilities ADD CONSTRAINT capabilities_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_decision_check' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_decision_check CHECK ((decision = ANY (ARRAY['sent'::text, 'silent'::text, 'error'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_generation_audit_object_check' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_generation_audit_object_check CHECK ((jsonb_typeof(generation_audit) = 'object'::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_idempotency_key_nonempty_check' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_idempotency_key_nonempty_check CHECK (((idempotency_key IS NULL) OR (btrim(idempotency_key) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_topic_fingerprint_nonempty_check' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_topic_fingerprint_nonempty_check CHECK (((topic_fingerprint IS NULL) OR (btrim(topic_fingerprint) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_control_action_check' AND conrelid = 'public.codex_control'::regclass) THEN ALTER TABLE public.codex_control ADD CONSTRAINT codex_control_action_check CHECK ((action = ANY (ARRAY['wake'::text, 'sleep'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_control_source_check' AND conrelid = 'public.codex_control'::regclass) THEN ALTER TABLE public.codex_control ADD CONSTRAINT codex_control_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'syzygy'::text, 'system'::text, 'hamster-nest'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_control_status_check' AND conrelid = 'public.codex_control'::regclass) THEN ALTER TABLE public.codex_control ADD CONSTRAINT codex_control_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'executed'::text, 'failed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_tasks_source_check' AND conrelid = 'public.codex_tasks'::regclass) THEN ALTER TABLE public.codex_tasks ADD CONSTRAINT codex_tasks_source_check CHECK ((source = ANY (ARRAY['syzygy'::text, 'chuanchuan'::text, 'system'::text, 'manual'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_tasks_status_check' AND conrelid = 'public.codex_tasks'::regclass) THEN ALTER TABLE public.codex_tasks ADD CONSTRAINT codex_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_context_recipe_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_context_recipe_check CHECK (((jsonb_typeof(context_recipe) = 'object'::text) AND (jsonb_typeof((context_recipe -> 'version'::text)) = 'number'::text) AND ((context_recipe ->> 'history_scope'::text) = 'current_session'::text) AND ((context_recipe ->> 'epoch'::text) = ANY (ARRAY['asia_shanghai_day'::text, 'session'::text])) AND ((context_recipe ->> 'selection'::text) = 'newest_within_token_budget'::text) AND (jsonb_typeof((context_recipe -> 'external_sources'::text)) = 'array'::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_default_responder_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_default_responder_check CHECK ((btrim(default_responder_port_key) <> ''::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_group_rules_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_group_rules_check CHECK (((conversation_kind <> 'group'::text) OR (rules_prompt_name IS NOT NULL))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_participants_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_participants_check CHECK (((cardinality(participant_port_keys) > 0) AND (array_position(participant_port_keys, NULL::text) IS NULL) AND (default_responder_port_key = ANY (participant_port_keys)) AND ((conversation_kind = 'group'::text) OR (cardinality(participant_port_keys) = 1)))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_profile_key_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_profile_key_check CHECK ((profile_key ~ '^[a-z][a-z0-9_]*$'::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_rules_prompt_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_rules_prompt_check CHECK (((rules_prompt_name IS NULL) OR (btrim(rules_prompt_name) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_session_policy_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_session_policy_check CHECK ((session_policy = ANY (ARRAY['singleton'::text, 'multi'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_shape_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_shape_check CHECK ((((conversation_kind = 'direct'::text) AND (handler = ANY (ARRAY['api'::text, 'cli'::text]))) OR ((conversation_kind = 'group'::text) AND (handler = 'router'::text)))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_singleton_key_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_singleton_key_check CHECK ((((session_policy = 'singleton'::text) AND (singleton_session_key IS NOT NULL) AND (btrim(singleton_session_key) <> ''::text)) OR ((session_policy = 'multi'::text) AND (singleton_session_key IS NULL)))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_version_check' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_version_check CHECK ((version > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'council_categories_label_check' AND conrelid = 'public.council_categories'::regclass) THEN ALTER TABLE public.council_categories ADD CONSTRAINT council_categories_label_check CHECK ((btrim(label) <> ''::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_status_digest_period_of_day_check' AND conrelid = 'public.daily_status_digest'::regclass) THEN ALTER TABLE public.daily_status_digest ADD CONSTRAINT daily_status_digest_period_of_day_check CHECK ((period_of_day = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text, 'night'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_tokens_platform_check' AND conrelid = 'public.device_tokens'::regclass) THEN ALTER TABLE public.device_tokens ADD CONSTRAINT device_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_ai_profiles_context_token_limit_check' AND conrelid = 'public.forum_ai_profiles'::regclass) THEN ALTER TABLE public.forum_ai_profiles ADD CONSTRAINT forum_ai_profiles_context_token_limit_check CHECK (((context_token_limit >= 8000) AND (context_token_limit <= 128000))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_ai_profiles_slot_index_check' AND conrelid = 'public.forum_ai_profiles'::regclass) THEN ALTER TABLE public.forum_ai_profiles ADD CONSTRAINT forum_ai_profiles_slot_index_check CHECK (((slot_index >= 1) AND (slot_index <= 3))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_replies_author_slot_check' AND conrelid = 'public.forum_replies'::regclass) THEN ALTER TABLE public.forum_replies ADD CONSTRAINT forum_replies_author_slot_check CHECK (((author_slot >= 1) AND (author_slot <= 3))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_replies_author_type_check' AND conrelid = 'public.forum_replies'::regclass) THEN ALTER TABLE public.forum_replies ADD CONSTRAINT forum_replies_author_type_check CHECK ((author_type = ANY (ARRAY['user'::text, 'ai'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_author_slot_check' AND conrelid = 'public.forum_threads'::regclass) THEN ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_author_slot_check CHECK (((author_slot >= 1) AND (author_slot <= 3))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_author_type_check' AND conrelid = 'public.forum_threads'::regclass) THEN ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_author_type_check CHECK ((author_type = ANY (ARRAY['user'::text, 'ai'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_identity_prompt_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_identity_prompt_check CHECK ((btrim(identity_prompt_name) <> ''::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_port_key_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_port_key_check CHECK ((port_key ~ '^[a-z][a-z0-9_]*$'::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_runtime_config_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_runtime_config_check CHECK ((((runtime_kind = 'api'::text) AND (model_channel_name IS NOT NULL) AND (btrim(model_channel_name) <> ''::text) AND (target_role IS NULL)) OR ((runtime_kind = 'cli'::text) AND (target_role IS NOT NULL) AND (btrim(target_role) <> ''::text)))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_runtime_kind_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_runtime_kind_check CHECK ((runtime_kind = ANY (ARRAY['api'::text, 'cli'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_sop_pair_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_sop_pair_check CHECK ((((sop_source IS NULL) AND (sop_ref IS NULL)) OR ((sop_source = 'git'::text) AND (sop_ref IS NOT NULL) AND (btrim(sop_ref) <> ''::text)))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_style_prompt_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_style_prompt_check CHECK (((style_prompt_name IS NULL) OR (btrim(style_prompt_name) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_version_check' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_version_check CHECK ((version > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_category_check' AND conrelid = 'public.ideas'::regclass) THEN ALTER TABLE public.ideas ADD CONSTRAINT ideas_category_check CHECK ((category = ANY (ARRAY['product'::text, 'story'::text, 'reading'::text, 'journal'::text, 'life'::text, 'ai_relationship'::text, 'other'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_status_check' AND conrelid = 'public.ideas'::regclass) THEN ALTER TABLE public.ideas ADD CONSTRAINT ideas_status_check CHECK ((status = ANY (ARRAY['captured'::text, 'explored'::text, 'archived'::text, 'implemented'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_edges_edge_type_check' AND conrelid = 'public.learning_edges'::regclass) THEN ALTER TABLE public.learning_edges ADD CONSTRAINT learning_edges_edge_type_check CHECK ((edge_type = ANY (ARRAY['association'::text, 'derivation'::text, 'contradiction'::text, 'application'::text, 'reference'::text, 'question'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_edges_strength_check' AND conrelid = 'public.learning_edges'::regclass) THEN ALTER TABLE public.learning_edges ADD CONSTRAINT learning_edges_strength_check CHECK (((strength >= 1) AND (strength <= 5))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_self_loop' AND conrelid = 'public.learning_edges'::regclass) THEN ALTER TABLE public.learning_edges ADD CONSTRAINT no_self_loop CHECK ((from_node_id <> to_node_id)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_nodes_node_type_check' AND conrelid = 'public.learning_nodes'::regclass) THEN ALTER TABLE public.learning_nodes ADD CONSTRAINT learning_nodes_node_type_check CHECK ((node_type = ANY (ARRAY['concept'::text, 'question'::text, 'insight'::text, 'source'::text, 'quote'::text, 'note'::text, 'application'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letters_module_check' AND conrelid = 'public.letters'::regclass) THEN ALTER TABLE public.letters ADD CONSTRAINT letters_module_check CHECK ((module = 'letter'::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letters_trigger_type_check' AND conrelid = 'public.letters'::regclass) THEN ALTER TABLE public.letters ADD CONSTRAINT letters_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['manual'::text, 'scheduled'::text, 'event'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_entries_source_check' AND conrelid = 'public.memory_entries'::regclass) THEN ALTER TABLE public.memory_entries ADD CONSTRAINT memory_entries_source_check CHECK ((source = ANY (ARRAY['ai_suggested'::text, 'user_created'::text, 'user_edited'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_entries_status_check' AND conrelid = 'public.memory_entries'::regclass) THEN ALTER TABLE public.memory_entries ADD CONSTRAINT memory_entries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_reply_to_id_not_self_check' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_reply_to_id_not_self_check CHECK (((reply_to_id IS NULL) OR (reply_to_id <> id))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_role_check' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_key_nonempty_check' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_sender_key_nonempty_check CHECK (((sender_key IS NULL) OR (btrim(sender_key) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_events_channel_check' AND conrelid = 'public.notification_events'::regclass) THEN ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_channel_check CHECK ((channel = ANY (ARRAY['expo_push'::text, 'wechat_bridge'::text, 'email'::text, 'local'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_events_status_check' AND conrelid = 'public.notification_events'::regclass) THEN ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_books_status_check' AND conrelid = 'public.novel_books'::regclass) THEN ALTER TABLE public.novel_books ADD CONSTRAINT novel_books_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ongoing'::text, 'completed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_chapters_status_check' AND conrelid = 'public.novel_chapters'::regclass) THEN ALTER TABLE public.novel_chapters ADD CONSTRAINT novel_chapters_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_status_check' AND conrelid = 'public.outbound_messages'::regclass) THEN ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_wechat_messages_status_check' AND conrelid = 'public.pending_wechat_messages'::regclass) THEN ALTER TABLE public.pending_wechat_messages ADD CONSTRAINT pending_wechat_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'delivered'::text, 'sent'::text, 'failed'::text, 'cancelled'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_capsules_paper_size_check' AND conrelid = 'public.print_capsules'::regclass) THEN ALTER TABLE public.print_capsules ADD CONSTRAINT print_capsules_paper_size_check CHECK ((paper_size = ANY (ARRAY['A4'::text, '95x171'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_capsules_status_check' AND conrelid = 'public.print_capsules'::regclass) THEN ALTER TABLE public.print_capsules ADD CONSTRAINT print_capsules_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'printing'::text, 'printed'::text, 'failed'::text, 'cancelled'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_capsules_type_check' AND conrelid = 'public.print_capsules'::regclass) THEN ALTER TABLE public.print_capsules ADD CONSTRAINT print_capsules_type_check CHECK ((type = ANY (ARRAY['syzygy_note'::text, 'reading_card'::text, 'weekly_digest_card'::text, 'dev_log_card'::text, 'anniversary_card'::text, 'life_card'::text, 'random_fragment'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_category_check' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_category_check CHECK ((category = ANY (ARRAY['base'::text, 'scenario'::text, 'style'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_content_nonempty_check' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_content_nonempty_check CHECK ((btrim(content) <> ''::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_name_key_check' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_name_key_check CHECK ((name ~ '^[a-z][a-z0-9_]*$'::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_version_check' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_version_check CHECK ((version > 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_models_model_type_check' AND conrelid = 'public.provider_models'::regclass) THEN ALTER TABLE public.provider_models ADD CONSTRAINT provider_models_model_type_check CHECK ((model_type = ANY (ARRAY['chat'::text, 'embedding'::text, 'reasoning'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_platform_check' AND conrelid = 'public.push_subscriptions'::regclass) THEN ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'expo'::text, 'apns'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quests_created_by_check' AND conrelid = 'public.quests'::regclass) THEN ALTER TABLE public.quests ADD CONSTRAINT quests_created_by_check CHECK ((created_by = ANY (ARRAY['syzygy'::text, 'chuanchuan'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quests_reward_positive' AND conrelid = 'public.quests'::regclass) THEN ALTER TABLE public.quests ADD CONSTRAINT quests_reward_positive CHECK ((reward_points >= 0)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quests_status_check' AND conrelid = 'public.quests'::regclass) THEN ALTER TABLE public.quests ADD CONSTRAINT quests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'completed'::text, 'cancelled'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_wakeup_status_check' AND conrelid = 'public.scheduled_wakeup'::regclass) THEN ALTER TABLE public.scheduled_wakeup ADD CONSTRAINT scheduled_wakeup_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'triggered'::text, 'delivered'::text, 'cancelled'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_conversation_handler_check' AND conrelid = 'public.sessions'::regclass) THEN ALTER TABLE public.sessions ADD CONSTRAINT sessions_conversation_handler_check CHECK ((((conversation_kind = 'direct'::text) AND (handler = ANY (ARRAY['api'::text, 'cli'::text]))) OR ((conversation_kind = 'group'::text) AND (handler = 'router'::text)))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_conversation_profile_key_nonempty_check' AND conrelid = 'public.sessions'::regclass) THEN ALTER TABLE public.sessions ADD CONSTRAINT sessions_conversation_profile_key_nonempty_check CHECK (((conversation_profile_key IS NULL) OR (btrim(conversation_profile_key) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_routing_config_object_check' AND conrelid = 'public.sessions'::regclass) THEN ALTER TABLE public.sessions ADD CONSTRAINT sessions_routing_config_object_check CHECK ((jsonb_typeof(routing_config) = 'object'::text)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_session_key_nonempty_check' AND conrelid = 'public.sessions'::regclass) THEN ALTER TABLE public.sessions ADD CONSTRAINT sessions_session_key_nonempty_check CHECK (((session_key IS NULL) OR (btrim(session_key) <> ''::text))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snack_replies_role_check' AND conrelid = 'public.snack_replies'::regclass) THEN ALTER TABLE public.snack_replies ADD CONSTRAINT snack_replies_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'special_dates_day_check' AND conrelid = 'public.special_dates'::regclass) THEN ALTER TABLE public.special_dates ADD CONSTRAINT special_dates_day_check CHECK (((day >= 1) AND (day <= 31))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'special_dates_month_check' AND conrelid = 'public.special_dates'::regclass) THEN ALTER TABLE public.special_dates ADD CONSTRAINT special_dates_month_check CHECK (((month >= 1) AND (month <= 12))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_commands_status_check' AND conrelid = 'public.syzygy_commands'::regclass) THEN ALTER TABLE public.syzygy_commands ADD CONSTRAINT syzygy_commands_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_replies_author_role_check' AND conrelid = 'public.syzygy_replies'::regclass) THEN ALTER TABLE public.syzygy_replies ADD CONSTRAINT syzygy_replies_author_role_check CHECK ((author_role = ANY (ARRAY['user'::text, 'ai'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_signals_signal_type_check' AND conrelid = 'public.syzygy_signals'::regclass) THEN ALTER TABLE public.syzygy_signals ADD CONSTRAINT syzygy_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['sleep_alert'::text, 'hydration_boost'::text, 'calendar_aware'::text, 'mood_check'::text, 'custom'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_signals_source_check' AND conrelid = 'public.syzygy_signals'::regclass) THEN ALTER TABLE public.syzygy_signals ADD CONSTRAINT syzygy_signals_source_check CHECK ((source = ANY (ARRAY['claude'::text, 'gpt'::text, 'user'::text, 'system'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_signals_status_check' AND conrelid = 'public.syzygy_signals'::regclass) THEN ALTER TABLE public.syzygy_signals ADD CONSTRAINT syzygy_signals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text, 'expired'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_relations_no_self' AND conrelid = 'public.thought_relations'::regclass) THEN ALTER TABLE public.thought_relations ADD CONSTRAINT thought_relations_no_self CHECK ((from_id <> to_id)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_entries_recorder_check' AND conrelid = 'public.timeline_entries'::regclass) THEN ALTER TABLE public.timeline_entries ADD CONSTRAINT timeline_entries_recorder_check CHECK ((recorder = ANY (ARRAY['chuanchuan'::text, 'syzygy'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_entries_source_check' AND conrelid = 'public.timeline_entries'::regclass) THEN ALTER TABLE public.timeline_entries ADD CONSTRAINT timeline_entries_source_check CHECK ((source = ANY (ARRAY['claude'::text, 'gpt'::text, 'gemini'::text, 'user'::text, 'frontend'::text, 'wechat_api'::text, 'client_gpt'::text, 'client_claude'::text, 'codex_cli'::text, 'claude_code_cli'::text, 'system'::text, 'expo_app'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_status_check' AND conrelid = 'public.todos'::regclass) THEN ALTER TABLE public.todos ADD CONSTRAINT todos_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_todo_type_check' AND conrelid = 'public.todos'::regclass) THEN ALTER TABLE public.todos ADD CONSTRAINT todos_todo_type_check CHECK ((todo_type = ANY (ARRAY['short_term'::text, 'long_term'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_type_check' AND conrelid = 'public.wallet_transactions'::regclass) THEN ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK ((type = ANY (ARRAY['earn'::text, 'exchange'::text, 'spend'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wechat_messages_role_check' AND conrelid = 'public.wechat_messages'::regclass) THEN ALTER TABLE public.wechat_messages ADD CONSTRAINT wechat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wiki_entries_status_check' AND conrelid = 'public.wiki_entries'::regclass) THEN ALTER TABLE public.wiki_entries ADD CONSTRAINT wiki_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text]))); END IF; END $c$;

-- ============================================================================
-- 6. 索引（非约束索引；含外键依赖的唯一索引，必须先于外键创建）
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_agent_council_created ON public.agent_council USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_council_parent_created ON public.agent_council USING btree (parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_council_status_created ON public.agent_council USING btree (proposal_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_council_topic ON public.agent_council USING btree (topic);
CREATE INDEX IF NOT EXISTS idx_agent_council_user_created ON public.agent_council USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_events_companion_proactive_published_unique ON public.agent_events USING btree (user_id, event_type, entity_id) WHERE ((event_type = 'companion_proactive_published'::text) AND (entity_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS agent_events_conversation_reply_completed_unique ON public.agent_events USING btree (user_id, event_type, entity_id) WHERE ((event_type = 'conversation_reply_completed'::text) AND (entity_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS agent_events_user_created_idx ON public.agent_events USING btree (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_agent_feed_items_expiry ON public.agent_feed_items USING btree (expires_at) WHERE ((expires_at IS NOT NULL) AND (status = 'unread'::text));
CREATE INDEX IF NOT EXISTS idx_agent_feed_items_metadata ON public.agent_feed_items USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_agent_feed_items_pinned ON public.agent_feed_items USING btree (user_id, pinned, created_at DESC) WHERE (pinned = true);
CREATE INDEX IF NOT EXISTS idx_agent_feed_items_priority_unread ON public.agent_feed_items USING btree (user_id, priority, created_at DESC) WHERE (status = 'unread'::text);
CREATE INDEX IF NOT EXISTS idx_agent_feed_items_user_status_visible ON public.agent_feed_items USING btree (user_id, status, visible_from DESC);
CREATE INDEX IF NOT EXISTS idx_agent_feed_items_user_type_created ON public.agent_feed_items USING btree (user_id, type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_morning_share_per_day ON public.agent_feed_items USING btree (((timezone('Asia/Shanghai'::text, visible_from))::date)) WHERE (type = 'morning_share'::text);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_conversation_command_unique ON public.agent_tasks USING btree (user_id, ((payload_json ->> 'command_id'::text))) WHERE ((source = 'conversation_dispatch'::text) AND (payload_json ? 'command_id'::text));
CREATE INDEX IF NOT EXISTS idx_agent_tasks_correlation ON public.agent_tasks USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON public.agent_tasks USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent ON public.agent_tasks USING btree (parent_task_id) WHERE (parent_task_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON public.agent_tasks USING btree (status);
CREATE INDEX IF NOT EXISTS approval_executions_user_claimed_at_idx ON public.approval_executions USING btree (user_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_user_status_idx ON public.approval_requests USING btree (user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS archive_categories_id_user_id_key ON public.archive_categories USING btree (id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS archive_categories_unique_sibling_name ON public.archive_categories USING btree (user_id, scope, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS idx_archive_categories_parent ON public.archive_categories USING btree (parent_id);
CREATE INDEX IF NOT EXISTS idx_archive_categories_parent_user ON public.archive_categories USING btree (parent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_archive_categories_scope ON public.archive_categories USING btree (scope);
CREATE INDEX IF NOT EXISTS idx_archive_categories_user_scope_parent_sort ON public.archive_categories USING btree (user_id, scope, parent_id, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_archives_category ON public.archives USING btree (category_id);
CREATE INDEX IF NOT EXISTS idx_archives_category_user ON public.archives USING btree (category_id, user_id);
CREATE INDEX IF NOT EXISTS idx_archives_keywords ON public.archives USING gin (keywords);
CREATE INDEX IF NOT EXISTS idx_archives_user_category_active_updated ON public.archives USING btree (user_id, category_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_archives_user_updated ON public.archives USING btree (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bubble_messages_session ON public.bubble_messages USING btree (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bubble_sessions_date ON public.bubble_sessions USING btree (user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_capabilities_enabled_cooldown ON public.capabilities USING btree (enabled, cooldown_until);
CREATE INDEX IF NOT EXISTS idx_channel_config_user_id ON public.channel_config USING btree (user_id);
CREATE INDEX IF NOT EXISTS checkin_logs_canonical_event_idx ON public.checkin_logs USING btree (canonical_event_id) WHERE (canonical_event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS checkin_logs_canonical_message_idx ON public.checkin_logs USING btree (canonical_message_id) WHERE (canonical_message_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS checkin_logs_user_idempotency_unique ON public.checkin_logs USING btree (user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_checkin_time ON public.checkin_logs USING btree (checkin_time DESC);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_decision ON public.checkin_logs USING btree (decision);
CREATE INDEX IF NOT EXISTS checkins_user_date_idx ON public.checkins USING btree (user_id, checkin_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS checkins_user_date_uniq ON public.checkins USING btree (user_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_codex_control_user_id ON public.codex_control USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_codex_tasks_user_id ON public.codex_tasks USING btree (user_id);
CREATE INDEX IF NOT EXISTS compression_cache_lookup ON public.compression_cache USING btree (module, conversation_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS compression_cache_unique_progress ON public.compression_cache USING btree (module, conversation_id, compressed_up_to_message_id);
CREATE INDEX IF NOT EXISTS compression_cache_updated_at_idx ON public.compression_cache USING btree (updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_profiles_user_key_active_unique ON public.conversation_profiles USING btree (user_id, profile_key) WHERE active;
CREATE INDEX IF NOT EXISTS conversation_profiles_user_lookup_idx ON public.conversation_profiles USING btree (user_id, profile_key, active, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS current_context_snapshot_user_type_unique ON public.current_context_snapshot USING btree (user_id, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_context_snapshot_latest ON public.current_context_snapshot USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_status_digest_user_date_period ON public.daily_status_digest USING btree (user_id, date, period_of_day);
CREATE INDEX IF NOT EXISTS idx_device_status_user_created ON public.device_status USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enabled_models_provider ON public.enabled_models USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_enabled_models_user ON public.enabled_models USING btree (user_id);
CREATE INDEX IF NOT EXISTS forum_ai_profiles_user_id_idx ON public.forum_ai_profiles USING btree (user_id);
CREATE INDEX IF NOT EXISTS forum_replies_parent_created_idx ON public.forum_replies USING btree (parent_id, created_at);
CREATE INDEX IF NOT EXISTS forum_replies_thread_id_created_at_idx ON public.forum_replies USING btree (thread_id, created_at);
CREATE INDEX IF NOT EXISTS forum_replies_thread_parent_created_idx ON public.forum_replies USING btree (thread_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_replies_reply_to_reply_id ON public.forum_replies USING btree (reply_to_reply_id);
CREATE INDEX IF NOT EXISTS forum_threads_user_id_created_at_idx ON public.forum_threads USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS generation_ports_user_key_active_unique ON public.generation_ports USING btree (user_id, port_key) WHERE active;
CREATE INDEX IF NOT EXISTS generation_ports_user_lookup_idx ON public.generation_ports USING btree (user_id, port_key, active, version DESC);
CREATE INDEX IF NOT EXISTS generation_ports_user_model_channel_idx ON public.generation_ports USING btree (user_id, model_channel_name) WHERE (model_channel_name IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ideas_category ON public.ideas USING btree (category);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON public.ideas USING btree (status);
CREATE INDEX IF NOT EXISTS idx_knowledge_folders_parent_id ON public.knowledge_folders USING btree (parent_id);
CREATE INDEX IF NOT EXISTS idx_learning_edges_from ON public.learning_edges USING btree (from_node_id);
CREATE INDEX IF NOT EXISTS idx_learning_edges_to ON public.learning_edges USING btree (to_node_id);
CREATE INDEX IF NOT EXISTS idx_learning_edges_type ON public.learning_edges USING btree (edge_type);
CREATE INDEX IF NOT EXISTS idx_learning_nodes_folder ON public.learning_nodes USING btree (folder_id);
CREATE INDEX IF NOT EXISTS idx_learning_nodes_tags ON public.learning_nodes USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_learning_nodes_type ON public.learning_nodes USING btree (node_type);
CREATE INDEX IF NOT EXISTS idx_letter_conversations_conversation_id ON public.letter_conversations USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS letter_conversations_user_conversation_created_idx ON public.letter_conversations USING btree (user_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_letters_conversation_id ON public.letters USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS letters_user_conversation_created_at_idx ON public.letters USING btree (user_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS letters_user_created_at_idx ON public.letters USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS letters_user_is_read_created_at_idx ON public.letters USING btree (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_providers_user_active ON public.llm_providers USING btree (user_id, active) WHERE (active = true);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON public.llm_usage USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_module ON public.llm_usage USING btree (module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lounge_messages_created_at ON public.lounge_messages USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lounge_messages_sofa ON public.lounge_messages USING btree (sofa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memo_entries_is_deleted ON public.memo_entries USING btree (is_deleted);
CREATE INDEX IF NOT EXISTS idx_memo_entries_is_pinned ON public.memo_entries USING btree (is_pinned);
CREATE INDEX IF NOT EXISTS idx_memo_entries_source ON public.memo_entries USING btree (source);
CREATE INDEX IF NOT EXISTS idx_memo_entries_updated_at ON public.memo_entries USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memo_entries_user_id ON public.memo_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_memo_entry_tags_tag_id ON public.memo_entry_tags USING btree (memo_tag_id);
CREATE INDEX IF NOT EXISTS idx_memo_tags_user_id ON public.memo_tags USING btree (user_id);
CREATE INDEX IF NOT EXISTS memory_entries_user_created_at_idx ON public.memory_entries USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_entries_user_status_idx ON public.memory_entries USING btree (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id_unique ON public.messages USING btree (client_id) WHERE (client_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_session_client_created ON public.messages USING btree (session_id, client_created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON public.messages USING btree (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON public.messages USING btree (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_assistant_reply_responder_unique ON public.messages USING btree (session_id, reply_to_id, sender_key) WHERE ((role = 'assistant'::text) AND (reply_to_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx ON public.messages USING btree (reply_to_id);
CREATE INDEX IF NOT EXISTS notification_events_agent_event_idx ON public.notification_events USING btree (agent_event_id);
CREATE INDEX IF NOT EXISTS notification_events_receipt_pending_idx ON public.notification_events USING btree (sent_at) WHERE ((status = 'sent'::text) AND (receipt_checked_at IS NULL));
CREATE INDEX IF NOT EXISTS notification_events_user_created_idx ON public.notification_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_novel_books_user_id ON public.novel_books USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_novel_chapters_user_id ON public.novel_chapters USING btree (user_id);
CREATE INDEX IF NOT EXISTS novel_chapters_book_idx ON public.novel_chapters USING btree (book_id, chapter_number);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_user_id ON public.outbound_messages USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_wechat_idempotency ON public.pending_wechat_messages USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pending_wechat_pending_created ON public.pending_wechat_messages USING btree (created_at) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_pending_wechat_user_status ON public.pending_wechat_messages USING btree (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_capsules_batch_sort ON public.print_capsules USING btree (batch_id, sort_order, created_at) WHERE (batch_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_print_capsules_status ON public.print_capsules USING btree (status);
CREATE INDEX IF NOT EXISTS idx_print_capsules_week ON public.print_capsules USING btree (scheduled_print_week);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_lookup ON public.prompt_templates USING btree (user_id, name, active, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_user_name_active_unique ON public.prompt_templates USING btree (user_id, name) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS provider_models_one_default_per_model ON public.provider_models USING btree (user_id, model_id, model_type) WHERE (is_default = true);
CREATE INDEX IF NOT EXISTS provider_models_resolve_idx ON public.provider_models USING btree (user_id, model_id, model_type, enabled, is_default DESC);
CREATE INDEX IF NOT EXISTS providers_user_enabled_idx ON public.providers USING btree (user_id, enabled, priority);
CREATE INDEX IF NOT EXISTS idx_quests_created_at ON public.quests USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quests_status ON public.quests USING btree (status);
CREATE INDEX IF NOT EXISTS idx_rp_messages_session_created_at ON public.rp_messages USING btree (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rp_messages_user_session ON public.rp_messages USING btree (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_rp_npc_cards_session_enabled ON public.rp_npc_cards USING btree (session_id, enabled);
CREATE INDEX IF NOT EXISTS idx_rp_npc_cards_user_session ON public.rp_npc_cards USING btree (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_rp_sessions_user_id_created_at ON public.rp_sessions USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rp_story_groups_user_id ON public.rp_story_groups USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_wakeup_trigger ON public.scheduled_wakeup USING btree (trigger_at) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON public.sessions USING btree (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_id_session_key_unique ON public.sessions USING btree (user_id, session_key) WHERE (session_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user_profile_archived_updated_idx ON public.sessions USING btree (user_id, conversation_profile_key, is_archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_snack_posts_user_created ON public.snack_posts USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snack_replies_post_created ON public.snack_replies USING btree (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_special_dates_user_id ON public.special_dates USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_syzygy_commands_active ON public.syzygy_commands USING btree (status, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));
CREATE INDEX IF NOT EXISTS idx_syzygy_commands_user ON public.syzygy_commands USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS syzygy_posts_user_id_created_at_idx ON public.syzygy_posts USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS syzygy_replies_post_id_created_at_idx ON public.syzygy_replies USING btree (post_id, created_at);
CREATE INDEX IF NOT EXISTS syzygy_replies_user_id_created_at_idx ON public.syzygy_replies USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_syzygy_signals_created_at ON public.syzygy_signals USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_syzygy_signals_dedupe ON public.syzygy_signals USING btree (user_id, dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (status = 'pending'::text));
CREATE INDEX IF NOT EXISTS idx_syzygy_signals_signal_type ON public.syzygy_signals USING btree (signal_type);
CREATE INDEX IF NOT EXISTS idx_syzygy_signals_status ON public.syzygy_signals USING btree (status);
CREATE INDEX IF NOT EXISTS idx_syzygy_signals_user_id ON public.syzygy_signals USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_thought_relations_from ON public.thought_relations USING btree (from_id);
CREATE INDEX IF NOT EXISTS idx_thought_relations_to ON public.thought_relations USING btree (to_id);
CREATE INDEX IF NOT EXISTS idx_timeline_config_user_id ON public.timeline_config USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_entries_created_at ON public.timeline_entries USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_timeline_entries_event_date ON public.timeline_entries USING btree (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_entries_recorder ON public.timeline_entries USING btree (recorder);
CREATE INDEX IF NOT EXISTS idx_timeline_entries_source ON public.timeline_entries USING btree (source);
CREATE INDEX IF NOT EXISTS idx_timeline_entries_user_id ON public.timeline_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_todo_categories_user_date ON public.todo_categories USING btree (user_id, date);
CREATE INDEX IF NOT EXISTS idx_todos_category ON public.todos USING btree (category_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_date ON public.todos USING btree (user_id, date);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_quest_id ON public.wallet_transactions USING btree (quest_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at ON public.wallet_transactions USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON public.wallet_transactions USING btree (type);
CREATE INDEX IF NOT EXISTS idx_wechat_messages_created_at ON public.wechat_messages USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly_digest_user_week_start ON public.weekly_digest USING btree (user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_wiki_entries_user_id ON public.wiki_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS wiki_entries_category_idx ON public.wiki_entries USING btree (category);
CREATE INDEX IF NOT EXISTS wiki_entries_search_idx ON public.wiki_entries USING gin (to_tsvector('simple'::regconfig, ((title || ' '::text) || content)));
CREATE INDEX IF NOT EXISTS wiki_entries_tags_idx ON public.wiki_entries USING gin (tags);

-- ============================================================================
-- 7. 外键约束
-- ============================================================================

DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_council_parent_id_fkey' AND conrelid = 'public.agent_council'::regclass) THEN ALTER TABLE public.agent_council ADD CONSTRAINT agent_council_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES agent_council(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_events_user_id_fkey' AND conrelid = 'public.agent_events'::regclass) THEN ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_items_user_id_fkey' AND conrelid = 'public.agent_feed_items'::regclass) THEN ALTER TABLE public.agent_feed_items ADD CONSTRAINT agent_feed_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_heartbeats_user_id_fkey' AND conrelid = 'public.agent_heartbeats'::regclass) THEN ALTER TABLE public.agent_heartbeats ADD CONSTRAINT agent_heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_settings_user_id_fkey' AND conrelid = 'public.agent_settings'::regclass) THEN ALTER TABLE public.agent_settings ADD CONSTRAINT agent_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_parent_task_id_fkey' AND conrelid = 'public.agent_tasks'::regclass) THEN ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_executions_approval_id_fkey' AND conrelid = 'public.approval_executions'::regclass) THEN ALTER TABLE public.approval_executions ADD CONSTRAINT approval_executions_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_executions_user_id_fkey' AND conrelid = 'public.approval_executions'::regclass) THEN ALTER TABLE public.approval_executions ADD CONSTRAINT approval_executions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_user_id_fkey' AND conrelid = 'public.approval_requests'::regclass) THEN ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archive_categories_parent_id_fkey' AND conrelid = 'public.archive_categories'::regclass) THEN ALTER TABLE public.archive_categories ADD CONSTRAINT archive_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES archive_categories(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archive_categories_parent_user_fkey' AND conrelid = 'public.archive_categories'::regclass) THEN ALTER TABLE public.archive_categories ADD CONSTRAINT archive_categories_parent_user_fkey FOREIGN KEY (parent_id, user_id) REFERENCES archive_categories(id, user_id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archives_category_id_fkey' AND conrelid = 'public.archives'::regclass) THEN ALTER TABLE public.archives ADD CONSTRAINT archives_category_id_fkey FOREIGN KEY (category_id) REFERENCES archive_categories(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'archives_category_user_fkey' AND conrelid = 'public.archives'::regclass) THEN ALTER TABLE public.archives ADD CONSTRAINT archives_category_user_fkey FOREIGN KEY (category_id, user_id) REFERENCES archive_categories(id, user_id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_letter_config_user_id_fkey' AND conrelid = 'public.auto_letter_config'::regclass) THEN ALTER TABLE public.auto_letter_config ADD CONSTRAINT auto_letter_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bubble_messages_session_id_fkey' AND conrelid = 'public.bubble_messages'::regclass) THEN ALTER TABLE public.bubble_messages ADD CONSTRAINT bubble_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES bubble_sessions(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_config_user_id_fkey' AND conrelid = 'public.channel_config'::regclass) THEN ALTER TABLE public.channel_config ADD CONSTRAINT channel_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_canonical_event_fkey' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_canonical_event_fkey FOREIGN KEY (canonical_event_id) REFERENCES agent_events(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkin_logs_canonical_message_fkey' AND conrelid = 'public.checkin_logs'::regclass) THEN ALTER TABLE public.checkin_logs ADD CONSTRAINT checkin_logs_canonical_message_fkey FOREIGN KEY (canonical_message_id) REFERENCES messages(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkins_user_id_fkey' AND conrelid = 'public.checkins'::regclass) THEN ALTER TABLE public.checkins ADD CONSTRAINT checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_control_user_id_fkey' AND conrelid = 'public.codex_control'::regclass) THEN ALTER TABLE public.codex_control ADD CONSTRAINT codex_control_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codex_tasks_user_id_fkey' AND conrelid = 'public.codex_tasks'::regclass) THEN ALTER TABLE public.codex_tasks ADD CONSTRAINT codex_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_profiles_user_id_fkey' AND conrelid = 'public.conversation_profiles'::regclass) THEN ALTER TABLE public.conversation_profiles ADD CONSTRAINT conversation_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_tokens_user_id_fkey' AND conrelid = 'public.device_tokens'::regclass) THEN ALTER TABLE public.device_tokens ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enabled_models_provider_id_fkey' AND conrelid = 'public.enabled_models'::regclass) THEN ALTER TABLE public.enabled_models ADD CONSTRAINT enabled_models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enabled_models_user_id_fkey' AND conrelid = 'public.enabled_models'::regclass) THEN ALTER TABLE public.enabled_models ADD CONSTRAINT enabled_models_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_replies_parent_id_fkey' AND conrelid = 'public.forum_replies'::regclass) THEN ALTER TABLE public.forum_replies ADD CONSTRAINT forum_replies_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES forum_replies(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_replies_reply_to_reply_id_fkey' AND conrelid = 'public.forum_replies'::regclass) THEN ALTER TABLE public.forum_replies ADD CONSTRAINT forum_replies_reply_to_reply_id_fkey FOREIGN KEY (reply_to_reply_id) REFERENCES forum_replies(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_replies_thread_id_fkey' AND conrelid = 'public.forum_replies'::regclass) THEN ALTER TABLE public.forum_replies ADD CONSTRAINT forum_replies_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_model_channel_fkey' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_model_channel_fkey FOREIGN KEY (user_id, model_channel_name) REFERENCES channel_config(user_id, channel_name) ON UPDATE CASCADE ON DELETE RESTRICT; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_ports_user_id_fkey' AND conrelid = 'public.generation_ports'::regclass) THEN ALTER TABLE public.generation_ports ADD CONSTRAINT generation_ports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_folders_parent_id_fkey' AND conrelid = 'public.knowledge_folders'::regclass) THEN ALTER TABLE public.knowledge_folders ADD CONSTRAINT knowledge_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES knowledge_folders(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_edges_from_node_id_fkey' AND conrelid = 'public.learning_edges'::regclass) THEN ALTER TABLE public.learning_edges ADD CONSTRAINT learning_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES learning_nodes(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_edges_to_node_id_fkey' AND conrelid = 'public.learning_edges'::regclass) THEN ALTER TABLE public.learning_edges ADD CONSTRAINT learning_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES learning_nodes(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_nodes_folder_id_fkey' AND conrelid = 'public.learning_nodes'::regclass) THEN ALTER TABLE public.learning_nodes ADD CONSTRAINT learning_nodes_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES knowledge_folders(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letter_conversations_conversation_id_fkey' AND conrelid = 'public.letter_conversations'::regclass) THEN ALTER TABLE public.letter_conversations ADD CONSTRAINT letter_conversations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES sessions(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letter_conversations_letter_id_fkey' AND conrelid = 'public.letter_conversations'::regclass) THEN ALTER TABLE public.letter_conversations ADD CONSTRAINT letter_conversations_letter_id_fkey FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letter_conversations_user_id_fkey' AND conrelid = 'public.letter_conversations'::regclass) THEN ALTER TABLE public.letter_conversations ADD CONSTRAINT letter_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letters_conversation_id_fkey' AND conrelid = 'public.letters'::regclass) THEN ALTER TABLE public.letters ADD CONSTRAINT letters_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES sessions(id) ON DELETE SET NULL; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'letters_user_id_fkey' AND conrelid = 'public.letters'::regclass) THEN ALTER TABLE public.letters ADD CONSTRAINT letters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_providers_user_id_fkey' AND conrelid = 'public.llm_providers'::regclass) THEN ALTER TABLE public.llm_providers ADD CONSTRAINT llm_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lounge_messages_sofa_id_fkey' AND conrelid = 'public.lounge_messages'::regclass) THEN ALTER TABLE public.lounge_messages ADD CONSTRAINT lounge_messages_sofa_id_fkey FOREIGN KEY (sofa_id) REFERENCES lounge_sofas(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_entries_user_id_fkey' AND conrelid = 'public.memo_entries'::regclass) THEN ALTER TABLE public.memo_entries ADD CONSTRAINT memo_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_entry_tags_memo_entry_id_fkey' AND conrelid = 'public.memo_entry_tags'::regclass) THEN ALTER TABLE public.memo_entry_tags ADD CONSTRAINT memo_entry_tags_memo_entry_id_fkey FOREIGN KEY (memo_entry_id) REFERENCES memo_entries(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_entry_tags_memo_tag_id_fkey' AND conrelid = 'public.memo_entry_tags'::regclass) THEN ALTER TABLE public.memo_entry_tags ADD CONSTRAINT memo_entry_tags_memo_tag_id_fkey FOREIGN KEY (memo_tag_id) REFERENCES memo_tags(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memo_tags_user_id_fkey' AND conrelid = 'public.memo_tags'::regclass) THEN ALTER TABLE public.memo_tags ADD CONSTRAINT memo_tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_entries_user_id_fkey' AND conrelid = 'public.memory_entries'::regclass) THEN ALTER TABLE public.memory_entries ADD CONSTRAINT memory_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_reply_same_session_fkey' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_reply_same_session_fkey FOREIGN KEY (session_id, reply_to_id) REFERENCES messages(session_id, id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_session_id_fkey' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_events_agent_event_id_fkey' AND conrelid = 'public.notification_events'::regclass) THEN ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_agent_event_id_fkey FOREIGN KEY (agent_event_id) REFERENCES agent_events(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_events_user_id_fkey' AND conrelid = 'public.notification_events'::regclass) THEN ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_books_user_id_fkey' AND conrelid = 'public.novel_books'::regclass) THEN ALTER TABLE public.novel_books ADD CONSTRAINT novel_books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_chapters_book_id_fkey' AND conrelid = 'public.novel_chapters'::regclass) THEN ALTER TABLE public.novel_chapters ADD CONSTRAINT novel_chapters_book_id_fkey FOREIGN KEY (book_id) REFERENCES novel_books(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'novel_chapters_user_id_fkey' AND conrelid = 'public.novel_chapters'::regclass) THEN ALTER TABLE public.novel_chapters ADD CONSTRAINT novel_chapters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_user_id_fkey' AND conrelid = 'public.outbound_messages'::regclass) THEN ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_wechat_messages_user_id_fkey' AND conrelid = 'public.pending_wechat_messages'::regclass) THEN ALTER TABLE public.pending_wechat_messages ADD CONSTRAINT pending_wechat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_user_id_fkey' AND conrelid = 'public.prompt_templates'::regclass) THEN ALTER TABLE public.prompt_templates ADD CONSTRAINT prompt_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_models_provider_id_fkey' AND conrelid = 'public.provider_models'::regclass) THEN ALTER TABLE public.provider_models ADD CONSTRAINT provider_models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_models_user_id_fkey' AND conrelid = 'public.provider_models'::regclass) THEN ALTER TABLE public.provider_models ADD CONSTRAINT provider_models_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_user_id_fkey' AND conrelid = 'public.providers'::regclass) THEN ALTER TABLE public.providers ADD CONSTRAINT providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_fkey' AND conrelid = 'public.push_subscriptions'::regclass) THEN ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_messages_session_id_fkey' AND conrelid = 'public.rp_messages'::regclass) THEN ALTER TABLE public.rp_messages ADD CONSTRAINT rp_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES rp_sessions(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_npc_cards_session_id_fkey' AND conrelid = 'public.rp_npc_cards'::regclass) THEN ALTER TABLE public.rp_npc_cards ADD CONSTRAINT rp_npc_cards_session_id_fkey FOREIGN KEY (session_id) REFERENCES rp_sessions(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_session_groups_story_group_id_fkey' AND conrelid = 'public.rp_session_groups'::regclass) THEN ALTER TABLE public.rp_session_groups ADD CONSTRAINT rp_session_groups_story_group_id_fkey FOREIGN KEY (story_group_id) REFERENCES rp_story_groups(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_story_groups_user_id_fkey' AND conrelid = 'public.rp_story_groups'::regclass) THEN ALTER TABLE public.rp_story_groups ADD CONSTRAINT rp_story_groups_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snack_replies_post_id_fkey' AND conrelid = 'public.snack_replies'::regclass) THEN ALTER TABLE public.snack_replies ADD CONSTRAINT snack_replies_post_id_fkey FOREIGN KEY (post_id) REFERENCES snack_posts(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'special_dates_user_id_fkey' AND conrelid = 'public.special_dates'::regclass) THEN ALTER TABLE public.special_dates ADD CONSTRAINT special_dates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_commands_user_id_fkey' AND conrelid = 'public.syzygy_commands'::regclass) THEN ALTER TABLE public.syzygy_commands ADD CONSTRAINT syzygy_commands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_posts_user_id_fkey' AND conrelid = 'public.syzygy_posts'::regclass) THEN ALTER TABLE public.syzygy_posts ADD CONSTRAINT syzygy_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_replies_post_id_fkey' AND conrelid = 'public.syzygy_replies'::regclass) THEN ALTER TABLE public.syzygy_replies ADD CONSTRAINT syzygy_replies_post_id_fkey FOREIGN KEY (post_id) REFERENCES syzygy_posts(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_replies_user_id_fkey' AND conrelid = 'public.syzygy_replies'::regclass) THEN ALTER TABLE public.syzygy_replies ADD CONSTRAINT syzygy_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'syzygy_signals_user_id_fkey' AND conrelid = 'public.syzygy_signals'::regclass) THEN ALTER TABLE public.syzygy_signals ADD CONSTRAINT syzygy_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_config_user_id_fkey' AND conrelid = 'public.timeline_config'::regclass) THEN ALTER TABLE public.timeline_config ADD CONSTRAINT timeline_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_entries_user_id_fkey' AND conrelid = 'public.timeline_entries'::regclass) THEN ALTER TABLE public.timeline_entries ADD CONSTRAINT timeline_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_category_id_fkey' AND conrelid = 'public.todos'::regclass) THEN ALTER TABLE public.todos ADD CONSTRAINT todos_category_id_fkey FOREIGN KEY (category_id) REFERENCES todo_categories(id) ON DELETE CASCADE; END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_quest_id_fkey' AND conrelid = 'public.wallet_transactions'::regclass) THEN ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES quests(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wiki_entries_user_id_fkey' AND conrelid = 'public.wiki_entries'::regclass) THEN ALTER TABLE public.wiki_entries ADD CONSTRAINT wiki_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); END IF; END $c$;

-- ============================================================================
-- 8. 函数（private schema 内部函数 + public 函数/RPC/触发器函数）
-- ============================================================================

CREATE OR REPLACE FUNCTION private.conversation_dispatch_prepare_core(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean, p_create_durable_task boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := p_user_id;
  v_session public.sessions%rowtype;
  v_participants jsonb;
  v_responder text;
  v_targets text[];
  v_user_message public.messages%rowtype;
  v_reply public.messages%rowtype;
  v_command public.syzygy_commands%rowtype;
  v_task public.agent_tasks%rowtype;
  v_reply_id uuid;
  v_command_id uuid;
  v_task_id uuid;
  v_user_inserted boolean := false;
  v_reply_inserted boolean := false;
  v_reply_claimed boolean := false;
  v_command_inserted boolean := false;
  v_command_requeued boolean := false;
  v_task_inserted boolean := false;
  v_task_requeued boolean := false;
  v_delivery_state text;
  v_delivery_attempt integer := 1;
  v_command_key text;
  v_target_role text;
  v_executor text;
  v_task_status text;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: authentication required';
  end if;

  if current_user = 'authenticated'
     and (
       auth.uid() is null
       or v_user_id is distinct from auth.uid()
     ) then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: authenticated owner mismatch';
  end if;

  if p_create_durable_task
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: durable task preparation requires service role';
  end if;

  if p_session_id is null or p_client_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: session_id and client_id are required';
  end if;

  if p_content is null or btrim(p_content) = '' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: content must not be empty';
  end if;

  if char_length(p_content) > 20000 then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: content exceeds 20000 characters';
  end if;

  select *
  into v_session
  from public.sessions
  where id = p_session_id
    and user_id = v_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch: session not found';
  end if;

  if v_session.is_archived then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: archived session is read only';
  end if;

  if v_session.conversation_kind <> 'direct'
     or v_session.handler not in ('api', 'cli') then
    raise exception using
      errcode = '0A000',
      message = 'conversation_dispatch: group router is not enabled in W1';
  end if;

  v_participants := v_session.routing_config -> 'participants';
  if jsonb_typeof(v_participants) <> 'array'
     or jsonb_array_length(v_participants) < 2 then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: routing participants are invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_participants) as participant(value)
    where jsonb_typeof(participant.value) <> 'string'
       or btrim(participant.value #>> '{}') = ''
  ) then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: participant sender keys must be nonempty strings';
  end if;

  if not (v_participants ? 'chuanchuan') then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: chuanchuan must be a participant';
  end if;

  if p_target_sender_keys is null or cardinality(p_target_sender_keys) = 0 then
    v_responder := nullif(btrim(v_session.routing_config ->> 'default_responder'), '');
    v_targets := case when v_responder is null then null else array[v_responder] end;
  else
    if cardinality(p_target_sender_keys) <> 1
       or exists (
         select 1
         from unnest(p_target_sender_keys) as target(sender_key)
         where target.sender_key is null
            or btrim(target.sender_key) = ''
       ) then
      raise exception using
        errcode = '22023',
        message = 'conversation_dispatch: direct sessions require exactly one target sender';
    end if;

    v_responder := btrim(p_target_sender_keys[1]);
    v_targets := array[v_responder];
  end if;

  if v_responder is null
     or v_responder = 'chuanchuan'
     or not (v_participants ? v_responder) then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: responder is not a valid participant';
  end if;

  insert into public.messages (
    user_id,
    session_id,
    role,
    content,
    meta,
    client_id,
    client_created_at,
    sender_key,
    target_sender_keys
  )
  values (
    v_user_id,
    v_session.id,
    'user',
    p_content,
    jsonb_build_object(
      'schema_version', 1,
      'source', 'conversation_dispatch'
    ),
    p_client_id,
    coalesce(p_client_created_at, now()),
    'chuanchuan',
    v_targets
  )
  on conflict (client_id) where client_id is not null
  do nothing
  returning *
  into v_user_message;

  v_user_inserted := found;

  if not v_user_inserted then
    select *
    into v_user_message
    from public.messages
    where client_id = p_client_id
      and user_id = v_user_id;

    if not found
       or v_user_message.session_id <> v_session.id
       or v_user_message.role <> 'user'
       or v_user_message.sender_key is distinct from 'chuanchuan'
       or v_user_message.content is distinct from p_content
       or v_user_message.target_sender_keys is distinct from v_targets then
      raise exception using
        errcode = '23505',
        message = 'conversation_dispatch: client_id was already used for a different message';
    end if;
  end if;

  insert into public.messages (
    user_id,
    session_id,
    role,
    content,
    meta,
    sender_key,
    reply_to_id
  )
  values (
    v_user_id,
    v_session.id,
    'assistant',
    '',
    jsonb_build_object(
      'schema_version', 1,
      'source', 'conversation_dispatch',
      'delivery_state', 'generating',
      'delivery_attempt', 1
    ),
    v_responder,
    v_user_message.id
  )
  on conflict (session_id, reply_to_id, sender_key)
    where role = 'assistant' and reply_to_id is not null
  do nothing
  returning *
  into v_reply;

  v_reply_inserted := found;
  v_reply_claimed := v_reply_inserted;
  if v_reply_inserted then
    v_reply_id := v_reply.id;
  end if;

  if not v_reply_inserted then
    select *
    into v_reply
    from public.messages
    where session_id = v_session.id
      and reply_to_id = v_user_message.id
      and sender_key = v_responder
      and role = 'assistant'
      and user_id = v_user_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'conversation_dispatch: responder reply claim could not be resolved';
    end if;

    v_reply_id := v_reply.id;
    v_delivery_state := coalesce(
      nullif(v_reply.meta ->> 'delivery_state', ''),
      case when btrim(v_reply.content) <> '' then 'completed' else 'failed' end
    );

    if v_delivery_state = 'failed' and p_retry_failed then
      v_delivery_attempt := case
        when coalesce(v_reply.meta ->> 'delivery_attempt', '') ~ '^[0-9]+$'
          then greatest((v_reply.meta ->> 'delivery_attempt')::integer + 1, 2)
        else 2
      end;

      update public.messages
      set
        content = '',
        meta = (
          jsonb_set(
            jsonb_set(
              coalesce(meta, '{}'::jsonb),
              '{delivery_state}',
              '"generating"'::jsonb,
              true
            ),
            '{delivery_attempt}',
            to_jsonb(v_delivery_attempt),
            true
          )
          - 'delivery_error'
          - 'delivery_error_code'
          - 'failed_at'
          - 'completed_at'
          - 'model'
        )
      where id = v_reply_id
        and user_id = v_user_id
        and coalesce(meta ->> 'delivery_state', 'failed') = 'failed'
      returning *
      into v_reply;

      v_reply_claimed := found;

      if not v_reply_claimed then
        select *
        into v_reply
        from public.messages
        where id = v_reply_id
          and user_id = v_user_id;
      end if;
    end if;
  end if;

  if v_session.handler = 'cli' then
    v_target_role := coalesce(
      nullif(btrim(v_session.routing_config ->> 'target_role'), ''),
      'codex_cli_syzygy'
    );

    if v_target_role not in ('codex_cli_syzygy', 'claude_code_cli_syzygy') then
      raise exception using
        errcode = '22023',
        message = 'conversation_dispatch: CLI target_role is not allowed';
    end if;

    v_executor := case v_target_role
      when 'codex_cli_syzygy' then 'codex_cli'
      else 'claude_code_cli'
    end;
    v_command_key := format(
      'conversation:v1:%s:%s',
      v_user_message.id,
      v_responder
    );
    v_command_id := gen_random_uuid();
    if p_create_durable_task then
      v_task_id := gen_random_uuid();
    end if;

    insert into public.syzygy_commands (
      id,
      user_id,
      command_type,
      payload,
      status,
      idempotency_key
    )
    values (
      v_command_id,
      v_user_id,
      'run_task',
      jsonb_build_object(
        'schema_version', 1,
        'source', 'conversation_dispatch',
        'target_role', v_target_role,
        'task_type', 'conversation_message',
        'task_content', p_content,
        'trigger_reason', 'user_message',
        'allow_wechat_notify', false,
        'session_id', v_session.id,
        'user_message_id', v_user_message.id,
        'reply_id', v_reply.id,
        'correlation_id', v_user_message.id,
        'responder_sender_key', v_responder,
        'idempotency_key', v_command_key
      ) || case
        when p_create_durable_task
          then jsonb_build_object('agent_task_id', v_task_id)
        else '{}'::jsonb
      end,
      'pending',
      v_command_key
    )
    on conflict (user_id, idempotency_key)
    do nothing
    returning *
    into v_command;

    v_command_inserted := found;
    if v_command_inserted then
      v_command_id := v_command.id;
    else
      select *
      into v_command
      from public.syzygy_commands
      where user_id = v_user_id
        and idempotency_key = v_command_key
      for update;

      if not found
         or v_command.command_type <> 'run_task'
         or v_command.payload ->> 'reply_id' is distinct from v_reply.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: CLI idempotency key conflict';
      end if;

      v_command_id := v_command.id;
    end if;

    if p_create_durable_task then
      if nullif(v_command.payload ->> 'agent_task_id', '') is not null then
        if (v_command.payload ->> 'agent_task_id')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
          raise exception using
            errcode = '22023',
            message = 'conversation_dispatch: command agent_task_id is invalid';
        end if;
        v_task_id := (v_command.payload ->> 'agent_task_id')::uuid;
      end if;

      v_task_status := case v_command.status
        when 'pending' then 'pending'
        when 'running' then 'running'
        when 'done' then 'completed'
        else 'failed'
      end;

      insert into public.agent_tasks (
        id,
        user_id,
        source,
        executor,
        command,
        status,
        payload_json,
        correlation_id,
        result_summary,
        started_at,
        completed_at
      )
      values (
        v_task_id,
        v_user_id,
        'conversation_dispatch',
        v_executor,
        'run_cli_runtime_task',
        v_task_status,
        jsonb_build_object(
          'schema_version', 1,
          'source', 'conversation_dispatch',
          'command_id', v_command.id,
          'command_type', v_command.command_type,
          'task_type', 'conversation_message',
          'target_role', v_target_role,
          'session_id', v_session.id,
          'user_message_id', v_user_message.id,
          'reply_id', v_reply.id,
          'responder_sender_key', v_responder,
          'task_content', p_content
        ),
        v_user_message.id,
        case v_task_status
          when 'pending' then v_target_role || ' queued'
          when 'running' then v_target_role || ' running'
          when 'completed' then v_target_role || ' completed before durable backfill'
          else v_target_role || ' failed before durable backfill'
        end,
        case when v_task_status = 'running' then v_command.claimed_at else null end,
        case when v_task_status in ('completed', 'failed')
          then coalesce(v_command.completed_at, now())
          else null
        end
      )
      on conflict do nothing
      returning *
      into v_task;

      v_task_inserted := found;
      if not v_task_inserted then
        select *
        into v_task
        from public.agent_tasks
        where user_id = v_user_id
          and source = 'conversation_dispatch'
          and payload_json ->> 'command_id' = v_command.id::text
        for update;
      end if;

      if not found
         or v_task.correlation_id is distinct from v_user_message.id
         or v_task.payload_json ->> 'reply_id' is distinct from v_reply.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: durable task could not be resolved';
      end if;

      v_task_id := v_task.id;
      if nullif(v_command.payload ->> 'agent_task_id', '') is null then
        update public.syzygy_commands
        set payload = jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{agent_task_id}',
          to_jsonb(v_task.id::text),
          true
        )
        where id = v_command.id
          and user_id = v_user_id
        returning *
        into v_command;
      elsif v_command.payload ->> 'agent_task_id' is distinct from v_task.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: command and durable task ids disagree';
      end if;

      update public.messages
      set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'command_id', v_command.id,
        'agent_task_id', v_task.id
      )
      where id = v_reply.id
        and user_id = v_user_id
      returning *
      into v_reply;
    end if;

    if p_retry_failed
       and v_reply_claimed
       and v_command.status = 'failed' then
      if p_create_durable_task
         and v_task.status not in ('pending', 'completed', 'failed', 'cancelled') then
        raise exception using
          errcode = '55000',
          message = 'conversation_dispatch: durable task is not retryable';
      end if;

      update public.syzygy_commands
      set
        status = 'pending',
        result = null,
        error_message = null,
        claimed_by = null,
        claimed_at = null,
        completed_at = null,
        updated_at = now()
      where id = v_command_id
        and user_id = v_user_id
        and status = 'failed'
      returning *
      into v_command;

      v_command_requeued := found;

      if p_create_durable_task
         and v_command_requeued
         and v_task.status <> 'completed' then
        update public.agent_tasks
        set
          status = 'pending',
          result_summary = v_target_role || ' queued',
          result_detail = null,
          error = null,
          started_at = null,
          completed_at = null
        where id = v_task_id
          and user_id = v_user_id
          and status in ('pending', 'failed', 'cancelled')
        returning *
        into v_task;

        v_task_requeued := found;
        if not v_task_requeued then
          raise exception using
            errcode = '55000',
            message = 'conversation_dispatch: durable task retry lost its pending claim';
        end if;
      end if;
    elsif p_retry_failed
          and v_reply_claimed
          and v_command.status = 'done' then
      update public.messages
      set meta = jsonb_set(
        jsonb_set(
          coalesce(meta, '{}'::jsonb),
          '{delivery_state}',
          '"failed"'::jsonb,
          true
        ),
        '{delivery_error_code}',
        '"CLI_COMMAND_ALREADY_DONE"'::jsonb,
        true
      )
      where id = v_reply_id
        and user_id = v_user_id
      returning *
      into v_reply;

      v_reply_claimed := false;
    end if;
  end if;

  v_delivery_state := coalesce(
    nullif(v_reply.meta ->> 'delivery_state', ''),
    case when btrim(v_reply.content) <> '' then 'completed' else 'failed' end
  );
  v_delivery_attempt := case
    when coalesce(v_reply.meta ->> 'delivery_attempt', '') ~ '^[0-9]+$'
      then greatest((v_reply.meta ->> 'delivery_attempt')::integer, 1)
    else 1
  end;

  return jsonb_build_object(
    'schema_version', 1,
    'handler', v_session.handler,
    'responder_sender_key', v_responder,
    'target_sender_keys', to_jsonb(v_targets),
    'user_message', jsonb_build_object(
      'id', v_user_message.id,
      'created_at', v_user_message.created_at
    ),
    'reply', jsonb_build_object(
      'id', v_reply.id,
      'delivery_state', v_delivery_state,
      'delivery_attempt', v_delivery_attempt
    ),
    'command', case
      when v_session.handler = 'cli' then jsonb_build_object(
        'id', v_command.id,
        'status', v_command.status,
        'idempotency_key', v_command.idempotency_key
      )
      else null
    end,
    'task', case
      when v_session.handler = 'cli' and p_create_durable_task then jsonb_build_object(
        'id', v_task.id,
        'status', v_task.status,
        'correlation_id', v_task.correlation_id
      )
      else null
    end,
    'should_execute', case
      when v_session.handler = 'api' then v_reply_claimed
      else v_command_inserted or v_command_requeued
    end,
    'was_duplicate', not v_user_inserted
  );
end
$function$;

CREATE OR REPLACE FUNCTION private.conversation_profile_publish_core(p_profile_key text, p_conversation_kind text, p_handler text, p_session_policy text, p_singleton_session_key text, p_participant_port_keys text[], p_default_responder_port_key text, p_rules_prompt_name text, p_context_recipe jsonb, p_expected_active_version integer DEFAULT NULL::integer)
 RETURNS conversation_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_profile_key text := btrim(p_profile_key);
  v_conversation_kind text := lower(btrim(p_conversation_kind));
  v_handler text := lower(btrim(p_handler));
  v_session_policy text := lower(btrim(p_session_policy));
  v_singleton_session_key text := nullif(btrim(p_singleton_session_key), '');
  v_participant_port_keys text[];
  v_default_responder_port_key text := btrim(p_default_responder_port_key);
  v_rules_prompt_name text := nullif(btrim(p_rules_prompt_name), '');
  v_context_recipe jsonb := coalesce(p_context_recipe, '{}'::jsonb);
  v_participant_count integer;
  v_distinct_participant_count integer;
  v_active_port_count integer;
  v_default_runtime_kind text;
  v_active_version integer;
  v_next_version integer;
  v_result public.conversation_profiles%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if v_profile_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Invalid conversation profile key';
  end if;

  if not (
    (v_conversation_kind = 'direct' and v_handler in ('api', 'cli'))
    or (v_conversation_kind = 'group' and v_handler = 'router')
  ) then
    raise exception 'Invalid conversation profile shape';
  end if;

  if v_session_policy not in ('singleton', 'multi') then
    raise exception 'Invalid session policy';
  end if;

  if (
    v_session_policy = 'singleton'
    and v_singleton_session_key is null
  ) or (
    v_session_policy = 'multi'
    and v_singleton_session_key is not null
  ) then
    raise exception 'Singleton session key does not match session policy';
  end if;

  if jsonb_typeof(v_context_recipe) <> 'object' then
    raise exception 'Context recipe must be a JSON object';
  end if;

  if jsonb_typeof(v_context_recipe -> 'version') <> 'number'
     or v_context_recipe ->> 'history_scope' <> 'current_session'
     or v_context_recipe ->> 'epoch' not in ('asia_shanghai_day', 'session')
     or v_context_recipe ->> 'selection' <> 'newest_within_token_budget'
     or jsonb_typeof(v_context_recipe -> 'external_sources') <> 'array' then
    raise exception 'Context recipe violates the V4.1 window isolation contract';
  end if;

  select array_agg(btrim(item) order by ordinal)
  into v_participant_port_keys
  from unnest(p_participant_port_keys) with ordinality as valueset(item, ordinal);

  if v_participant_port_keys is null
     or cardinality(v_participant_port_keys) = 0
     or array_position(v_participant_port_keys, '') is not null
     or array_position(v_participant_port_keys, null) is not null then
    raise exception 'Participant generation port keys must be non-empty';
  end if;

  select count(*), count(distinct item)
  into v_participant_count, v_distinct_participant_count
  from unnest(v_participant_port_keys) as valueset(item);

  if v_participant_count <> v_distinct_participant_count then
    raise exception 'Participant generation port keys must be unique';
  end if;

  if v_conversation_kind = 'direct' and v_participant_count <> 1 then
    raise exception 'Direct profiles must resolve to exactly one generation port';
  end if;

  if not (v_default_responder_port_key = any (v_participant_port_keys)) then
    raise exception 'Default responder must be one of the participant ports';
  end if;

  select count(*)
  into v_active_port_count
  from public.generation_ports
  where user_id = v_owner_id
    and active
    and port_key = any (v_participant_port_keys);

  if v_active_port_count <> cardinality(v_participant_port_keys) then
    raise exception 'Every participant must resolve to an active owner generation port';
  end if;

  select runtime_kind
  into v_default_runtime_kind
  from public.generation_ports
  where user_id = v_owner_id
    and port_key = v_default_responder_port_key
    and active;

  if (
    v_handler = 'api'
    and v_default_runtime_kind <> 'api'
  ) or (
    v_handler = 'cli'
    and v_default_runtime_kind <> 'cli'
  ) or (
    v_handler = 'router'
    and v_default_runtime_kind <> 'api'
  ) then
    raise exception 'Profile handler must match the default responder runtime contract';
  end if;

  if v_conversation_kind = 'group' and v_rules_prompt_name is null then
    raise exception 'Group profiles require a rules Prompt reference';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'v4.1:conversation-profile:' || v_owner_id::text || ':' || v_profile_key,
      0
    )
  );

  select version
  into v_active_version
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = v_profile_key
    and active
  for update;

  if p_expected_active_version is not null
     and p_expected_active_version is distinct from v_active_version then
    raise exception
      'Conversation profile active version changed (expected %, actual %)',
      p_expected_active_version,
      v_active_version;
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = v_profile_key;

  update public.conversation_profiles
  set active = false
  where user_id = v_owner_id
    and profile_key = v_profile_key
    and active;

  insert into public.conversation_profiles (
    user_id,
    profile_key,
    conversation_kind,
    handler,
    session_policy,
    singleton_session_key,
    participant_port_keys,
    default_responder_port_key,
    rules_prompt_name,
    context_recipe,
    version,
    active
  )
  values (
    v_owner_id,
    v_profile_key,
    v_conversation_kind,
    v_handler,
    v_session_policy,
    v_singleton_session_key,
    v_participant_port_keys,
    v_default_responder_port_key,
    v_rules_prompt_name,
    v_context_recipe,
    v_next_version,
    true
  )
  returning * into v_result;

  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION private.conversation_session_create_core(p_session_id uuid, p_profile_key text, p_title text, p_display_config jsonb DEFAULT '{}'::jsonb)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_profile_key text := btrim(p_profile_key);
  v_title text := coalesce(nullif(btrim(p_title), ''), '新聊天');
  v_display_config jsonb := coalesce(p_display_config, '{}'::jsonb);
  v_profile public.conversation_profiles%rowtype;
  v_routing_config jsonb;
  v_session public.sessions%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if p_session_id is null then
    raise exception 'A stable client-generated session id is required';
  end if;

  if jsonb_typeof(v_display_config) <> 'object' then
    raise exception 'Display config must be a JSON object';
  end if;

  if (
    v_display_config
      - array['display_name', 'avatar', 'source_label']::text[]
  ) <> '{}'::jsonb then
    raise exception 'Display config contains unsupported routing keys';
  end if;

  if exists (
    select 1
    from jsonb_each(v_display_config) entry
    where jsonb_typeof(entry.value) <> 'string'
       or btrim(entry.value #>> '{}') = ''
  ) then
    raise exception 'Display config values must be non-empty strings';
  end if;

  select *
  into v_profile
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = v_profile_key
    and active;

  if not found then
    raise exception 'Active owner conversation profile not found';
  end if;

  if v_profile.session_policy = 'singleton' then
    select *
    into v_session
    from public.sessions
    where user_id = v_owner_id
      and session_key = v_profile.singleton_session_key;

    if not found then
      raise exception
        'Singleton session is not provisioned yet; run its dedicated migrate step';
    end if;

    if v_session.conversation_profile_key is distinct from v_profile.profile_key
       or v_session.conversation_kind is distinct from v_profile.conversation_kind
       or v_session.handler is distinct from v_profile.handler then
      raise exception 'Existing singleton session does not match its active profile';
    end if;

    return v_session;
  end if;

  v_routing_config := jsonb_build_object(
    'version',
    1,
    'participants',
    to_jsonb(
      array_prepend(
        'chuanchuan'::text,
        v_profile.participant_port_keys
      )
    ),
    'default_responder',
    v_profile.default_responder_port_key
  ) || v_display_config;

  select *
  into v_session
  from public.sessions
  where id = p_session_id;

  if found then
    if v_session.user_id is distinct from v_owner_id
       or v_session.conversation_profile_key is distinct from v_profile.profile_key
       or v_session.title is distinct from v_title
       or v_session.conversation_kind is distinct from v_profile.conversation_kind
       or v_session.handler is distinct from v_profile.handler
       or v_session.routing_config is distinct from v_routing_config then
      raise exception 'Session id was already used with a different creation payload';
    end if;

    return v_session;
  end if;

  insert into public.sessions (
    id,
    user_id,
    title,
    session_key,
    conversation_kind,
    handler,
    routing_config,
    conversation_profile_key,
    is_archived,
    archived_at
  )
  values (
    p_session_id,
    v_owner_id,
    v_title,
    null,
    v_profile.conversation_kind,
    v_profile.handler,
    v_routing_config,
    v_profile.profile_key,
    false,
    null
  )
  returning * into v_session;

  return v_session;
end
$function$;

CREATE OR REPLACE FUNCTION private.enforce_prompt_template_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception
      'prompt_templates rows are append-only and cannot be deleted';
  end if;

  if (
    to_jsonb(new) - 'active' - 'updated_at'
  ) is distinct from (
    to_jsonb(old) - 'active' - 'updated_at'
  ) then
    raise exception
      'prompt_templates rows are append-only; publish a new version instead';
  end if;

  if not old.active and new.active then
    raise exception
      'Inactive Prompt versions cannot be reactivated';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.enforce_versioned_chat_config_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (
    to_jsonb(new) - 'active' - 'updated_at'
  ) is distinct from (
    to_jsonb(old) - 'active' - 'updated_at'
  ) then
    raise exception
      '% rows are append-only; publish a new version instead',
      tg_table_name;
  end if;

  if not old.active and new.active then
    raise exception
      '% inactive versions cannot be reactivated',
      tg_table_name;
  end if;

  new.updated_at := now();
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.generation_port_publish_core(p_port_key text, p_runtime_kind text, p_model_channel_name text, p_target_role text, p_identity_prompt_name text, p_style_prompt_name text, p_sop_source text, p_sop_ref text, p_expected_active_version integer DEFAULT NULL::integer)
 RETURNS generation_ports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_port_key text := btrim(p_port_key);
  v_runtime_kind text := lower(btrim(p_runtime_kind));
  v_model_channel_name text := nullif(btrim(p_model_channel_name), '');
  v_target_role text := nullif(btrim(p_target_role), '');
  v_identity_prompt_name text := btrim(p_identity_prompt_name);
  v_style_prompt_name text := nullif(btrim(p_style_prompt_name), '');
  v_sop_source text := nullif(lower(btrim(p_sop_source)), '');
  v_sop_ref text := nullif(btrim(p_sop_ref), '');
  v_active_version integer;
  v_next_version integer;
  v_result public.generation_ports%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if v_port_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Invalid generation port key';
  end if;

  if v_runtime_kind not in ('api', 'cli') then
    raise exception 'Invalid generation runtime kind';
  end if;

  if v_identity_prompt_name = '' then
    raise exception 'Identity Prompt name is required';
  end if;

  if v_runtime_kind = 'api' then
    if v_model_channel_name is null or v_target_role is not null then
      raise exception 'API ports require a model channel and cannot target a CLI role';
    end if;
  elsif v_target_role is null then
    raise exception 'CLI ports require a target role';
  end if;

  if v_model_channel_name is not null and not exists (
    select 1
    from public.channel_config
    where user_id = v_owner_id
      and channel_name = v_model_channel_name
  ) then
    raise exception 'Unknown owner model channel: %', v_model_channel_name;
  end if;

  if (v_sop_source is null) <> (v_sop_ref is null) then
    raise exception 'SOP source and reference must be supplied together';
  end if;

  if v_sop_source is not null and v_sop_source <> 'git' then
    raise exception 'Only Git-backed SOP references are allowed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'v4.1:generation-port:' || v_owner_id::text || ':' || v_port_key,
      0
    )
  );

  select version
  into v_active_version
  from public.generation_ports
  where user_id = v_owner_id
    and port_key = v_port_key
    and active
  for update;

  if p_expected_active_version is not null
     and p_expected_active_version is distinct from v_active_version then
    raise exception
      'Generation port active version changed (expected %, actual %)',
      p_expected_active_version,
      v_active_version;
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.generation_ports
  where user_id = v_owner_id
    and port_key = v_port_key;

  update public.generation_ports
  set active = false
  where user_id = v_owner_id
    and port_key = v_port_key
    and active;

  insert into public.generation_ports (
    user_id,
    port_key,
    runtime_kind,
    model_channel_name,
    target_role,
    identity_prompt_name,
    style_prompt_name,
    sop_source,
    sop_ref,
    version,
    active
  )
  values (
    v_owner_id,
    v_port_key,
    v_runtime_kind,
    v_model_channel_name,
    v_target_role,
    v_identity_prompt_name,
    v_style_prompt_name,
    v_sop_source,
    v_sop_ref,
    v_next_version,
    true
  )
  returning * into v_result;

  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION private.prompt_template_publish_core(p_name text, p_category text, p_content text, p_expected_active_version integer DEFAULT NULL::integer)
 RETURNS prompt_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_name text := lower(btrim(p_name));
  v_category text := lower(btrim(p_category));
  v_content text := p_content;
  v_active_version integer;
  v_next_version integer;
  v_result public.prompt_templates%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if v_name !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Invalid Prompt name';
  end if;

  if v_category not in ('base', 'scenario', 'style') then
    raise exception 'Invalid Prompt category';
  end if;

  if v_content is null or btrim(v_content) = '' then
    raise exception 'Prompt content is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'v4.1:prompt-template:' || v_owner_id::text || ':' || v_name,
      0
    )
  );

  select version
  into v_active_version
  from public.prompt_templates
  where user_id = v_owner_id
    and name = v_name
    and active
  for update;

  if v_active_version is null then
    if p_expected_active_version is not null then
      raise exception
        'Prompt active version changed (expected %, actual none)',
        p_expected_active_version;
    end if;
  elsif p_expected_active_version is null
     or p_expected_active_version is distinct from v_active_version then
    raise exception
      'Prompt active version changed (expected %, actual %)',
      p_expected_active_version,
      v_active_version;
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.prompt_templates
  where user_id = v_owner_id
    and name = v_name;

  update public.prompt_templates
  set active = false
  where user_id = v_owner_id
    and name = v_name
    and active;

  insert into public.prompt_templates (
    user_id,
    name,
    category,
    content,
    version,
    active
  )
  values (
    v_owner_id,
    v_name,
    v_category,
    v_content,
    v_next_version,
    true
  )
  returning * into v_result;

  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_companion_publish_proactive(p_user_id uuid, p_client_id uuid, p_content text, p_generated_at timestamp with time zone, p_model text, p_input_summary text, p_raw_output text, p_tokens_used integer, p_topic_fingerprint text, p_generation_audit jsonb, p_importance text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_session public.sessions%rowtype;
  v_profile public.conversation_profiles%rowtype;
  v_port public.generation_ports%rowtype;
  v_identity_prompt public.prompt_templates%rowtype;
  v_style_prompt public.prompt_templates%rowtype;
  v_scenario_prompt public.prompt_templates%rowtype;
  v_message public.messages%rowtype;
  v_event public.agent_events%rowtype;
  v_checkin public.checkin_logs%rowtype;
  v_generated_at timestamptz := coalesce(p_generated_at, now());
  v_content text := coalesce(p_content, '');
  v_model text := btrim(coalesce(p_model, ''));
  v_topic_fingerprint text := btrim(coalesce(p_topic_fingerprint, ''));
  v_importance text := lower(btrim(coalesce(p_importance, 'normal')));
  v_idempotency_key text;
  v_active_model text;
  v_generation_audit jsonb;
  v_message_meta jsonb;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using
      errcode = '42501',
      message = 'conversation_companion_publish_proactive: service role required';
  end if;

  if p_user_id is null or p_client_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: user_id and client_id are required';
  end if;

  if btrim(v_content) = '' or char_length(v_content) > 12000 then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: content must contain 1 to 12000 characters';
  end if;

  if v_model = ''
     or v_topic_fingerprint = ''
     or p_generation_audit is null
     or jsonb_typeof(p_generation_audit) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: model, topic fingerprint, and generation audit are required';
  end if;

  if p_tokens_used is not null and p_tokens_used < 0 then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: tokens_used must be nonnegative';
  end if;

  if v_importance not in ('low', 'normal', 'high', 'urgent') then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: invalid importance';
  end if;

  select *
  into v_profile
  from public.conversation_profiles
  where user_id = p_user_id
    and profile_key = 'app_companion'
    and active
    and conversation_kind = 'direct'
    and handler = 'api'
    and session_policy = 'singleton'
    and singleton_session_key = 'syzygy_companion';

  if not found
     or cardinality(v_profile.participant_port_keys) <> 1
     or v_profile.default_responder_port_key <> 'app_companion'
     or v_profile.participant_port_keys[1] <> 'app_companion' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active app_companion profile contract not found';
  end if;

  if v_profile.context_recipe ->> 'history_scope' <> 'current_session'
     or v_profile.context_recipe ->> 'selection' <> 'newest_within_token_budget'
     or v_profile.context_recipe ->> 'epoch' <> 'asia_shanghai_day'
     or jsonb_typeof(v_profile.context_recipe -> 'external_sources') <> 'array' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active context recipe is outside the V4.1 companion boundary';
  end if;

  select *
  into v_session
  from public.sessions
  where user_id = p_user_id
    and session_key = 'syzygy_companion'
    and conversation_profile_key = 'app_companion'
    and conversation_kind = 'direct'
    and handler = 'api'
    and not is_archived;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_companion_publish_proactive: canonical companion session not found';
  end if;

  if v_session.routing_config ->> 'default_responder' <> 'app_companion'
     or not coalesce(v_session.routing_config -> 'participants', '[]'::jsonb) ? 'chuanchuan'
     or not coalesce(v_session.routing_config -> 'participants', '[]'::jsonb) ? 'app_companion' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: canonical companion routing contract is invalid';
  end if;

  select *
  into v_port
  from public.generation_ports
  where user_id = p_user_id
    and port_key = v_profile.default_responder_port_key
    and active
    and runtime_kind = 'api';

  if not found or v_port.model_channel_name is null then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active API generation port not found';
  end if;

  select active_model
  into v_active_model
  from public.channel_config
  where user_id = p_user_id
    and channel_name = v_port.model_channel_name;

  if not found or btrim(coalesce(v_active_model, '')) = '' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active model channel not found';
  end if;

  select *
  into v_identity_prompt
  from public.prompt_templates
  where user_id = p_user_id
    and name = v_port.identity_prompt_name
    and active;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active identity Prompt not found';
  end if;

  if v_port.style_prompt_name is not null then
    select *
    into v_style_prompt
    from public.prompt_templates
    where user_id = p_user_id
      and name = v_port.style_prompt_name
      and active;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'conversation_companion_publish_proactive: active style Prompt not found';
    end if;
  end if;

  if p_generation_audit ->> 'scenario_prompt_name' not in ('checkin_day', 'checkin_night') then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: invalid checkin scenario Prompt';
  end if;

  select *
  into v_scenario_prompt
  from public.prompt_templates
  where user_id = p_user_id
    and name = p_generation_audit ->> 'scenario_prompt_name'
    and active;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active checkin scenario Prompt not found';
  end if;

  if p_generation_audit ->> 'model' is distinct from v_active_model
     or coalesce((p_generation_audit ->> 'profile_version')::integer, -1) <> v_profile.version
     or coalesce((p_generation_audit ->> 'port_version')::integer, -1) <> v_port.version
     or coalesce((p_generation_audit ->> 'identity_prompt_version')::integer, -1) <> v_identity_prompt.version
     or coalesce((p_generation_audit ->> 'scenario_prompt_version')::integer, -1) <> v_scenario_prompt.version
     or (
       v_style_prompt.id is null
       and p_generation_audit -> 'style_prompt_version' is not null
       and p_generation_audit -> 'style_prompt_version' <> 'null'::jsonb
     )
     or (
       v_style_prompt.id is not null
       and coalesce((p_generation_audit ->> 'style_prompt_version')::integer, -1) <> v_style_prompt.version
     ) then
    raise exception using
      errcode = '40001',
      message = 'conversation_companion_publish_proactive: generation contract changed before publish';
  end if;

  if v_model is distinct from v_active_model then
    raise exception using
      errcode = '40001',
      message = 'conversation_companion_publish_proactive: generated model no longer matches active model';
  end if;

  v_idempotency_key := 'companion:v1:' || p_client_id::text;
  v_generation_audit := jsonb_build_object(
    'schema_version', 1,
    'model', v_active_model,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'key', v_profile.profile_key,
      'version', v_profile.version,
      'context_recipe', v_profile.context_recipe
    ),
    'port', jsonb_build_object(
      'id', v_port.id,
      'key', v_port.port_key,
      'version', v_port.version,
      'model_channel_name', v_port.model_channel_name
    ),
    'prompts', jsonb_build_object(
      'identity', jsonb_build_object(
        'id', v_identity_prompt.id,
        'name', v_identity_prompt.name,
        'version', v_identity_prompt.version
      ),
      'style', case
        when v_style_prompt.id is null then null
        else jsonb_build_object(
          'id', v_style_prompt.id,
          'name', v_style_prompt.name,
          'version', v_style_prompt.version
        )
      end,
      'scenario', jsonb_build_object(
        'id', v_scenario_prompt.id,
        'name', v_scenario_prompt.name,
        'version', v_scenario_prompt.version
      )
    ),
    'context', coalesce(p_generation_audit -> 'context', '{}'::jsonb)
  );

  v_message_meta := jsonb_build_object(
    'schema_version', 1,
    'source', 'companion_scheduler',
    'delivery_state', 'completed',
    'generated_at', v_generated_at,
    'idempotency_key', v_idempotency_key,
    'topic_fingerprint', v_topic_fingerprint,
    'generation', v_generation_audit
  );

  insert into public.messages (
    user_id,
    session_id,
    role,
    sender_key,
    reply_to_id,
    target_sender_keys,
    content,
    client_id,
    client_created_at,
    meta
  )
  values (
    p_user_id,
    v_session.id,
    'assistant',
    'app_companion',
    null,
    null,
    v_content,
    p_client_id,
    v_generated_at,
    v_message_meta
  )
  on conflict (client_id) where client_id is not null
  do nothing
  returning *
  into v_message;

  if v_message.id is null then
    select *
    into v_message
    from public.messages
    where client_id = p_client_id;

    if not found
       or v_message.user_id is distinct from p_user_id
       or v_message.session_id is distinct from v_session.id
       or v_message.role is distinct from 'assistant'
       or v_message.sender_key is distinct from 'app_companion'
       or v_message.reply_to_id is not null
       or v_message.content is distinct from v_content
       or v_message.client_created_at is distinct from v_generated_at
       or v_message.meta is distinct from v_message_meta then
      raise exception using
        errcode = '23505',
        message = 'conversation_companion_publish_proactive: client_id was already used with a different publish contract';
    end if;
  end if;

  insert into public.agent_events (
    user_id,
    actor,
    event_type,
    entity_type,
    entity_id,
    title,
    payload,
    importance
  )
  values (
    p_user_id,
    'app_companion',
    'companion_proactive_published',
    'conversation_message',
    v_message.id,
    'Syzygy 来找你啦',
    jsonb_build_object(
      'schema_version', 1,
      'screen', 'conversation_detail',
      'params', jsonb_build_object('id', v_session.id),
      'url', format('/#/chat?session=%s', v_session.id),
      'session_id', v_session.id,
      'message_id', v_message.id,
      'sender_key', 'app_companion',
      'source', 'companion_scheduler'
    ),
    v_importance
  )
  on conflict (user_id, event_type, entity_id)
    where event_type = 'companion_proactive_published'
      and entity_id is not null
  do nothing
  returning *
  into v_event;

  if v_event.id is null then
    select *
    into v_event
    from public.agent_events
    where user_id = p_user_id
      and event_type = 'companion_proactive_published'
      and entity_id = v_message.id;
  end if;

  insert into public.checkin_logs (
    user_id,
    checkin_time,
    model,
    input_summary,
    raw_output,
    decision,
    tokens_used,
    canonical_message_id,
    canonical_event_id,
    idempotency_key,
    topic_fingerprint,
    generation_audit
  )
  values (
    p_user_id,
    v_generated_at,
    v_active_model,
    nullif(btrim(coalesce(p_input_summary, '')), ''),
    nullif(btrim(coalesce(p_raw_output, '')), ''),
    'sent',
    p_tokens_used,
    v_message.id,
    v_event.id,
    v_idempotency_key,
    v_topic_fingerprint,
    v_generation_audit
  )
  on conflict (user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning *
  into v_checkin;

  if v_checkin.id is null then
    select *
    into v_checkin
    from public.checkin_logs
    where user_id = p_user_id
      and idempotency_key = v_idempotency_key;

    if not found
       or v_checkin.decision is distinct from 'sent'
       or v_checkin.canonical_message_id is distinct from v_message.id
       or v_checkin.canonical_event_id is distinct from v_event.id
       or v_checkin.model is distinct from v_active_model
       or v_checkin.topic_fingerprint is distinct from v_topic_fingerprint
       or v_checkin.generation_audit is distinct from v_generation_audit then
      raise exception using
        errcode = '23505',
        message = 'conversation_companion_publish_proactive: idempotency key was already used with a different audit contract';
    end if;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'idempotency_key', v_idempotency_key,
    'message', jsonb_build_object(
      'id', v_message.id,
      'session_id', v_message.session_id,
      'client_id', v_message.client_id,
      'sender_key', v_message.sender_key,
      'created_at', v_message.created_at
    ),
    'event', jsonb_build_object(
      'id', v_event.id,
      'event_type', v_event.event_type
    ),
    'checkin_log', jsonb_build_object(
      'id', v_checkin.id,
      'decision', v_checkin.decision
    )
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.claim_pending_wechat_message(p_worker_id text)
 RETURNS TABLE(id uuid, user_id uuid, content text, source text, metadata jsonb, retry_count integer, idempotency_key text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return query
  with next_msg as (
    select pwm.id
    from public.pending_wechat_messages pwm
    where pwm.status = 'pending'
    order by pwm.created_at asc
    limit 1
    for update skip locked
  )
  update public.pending_wechat_messages pwm
  set status = 'sending',
      locked_at = now(),
      processing_by = p_worker_id,
      last_error = null
  from next_msg
  where pwm.id = next_msg.id
  returning pwm.id, pwm.user_id, pwm.content, pwm.source, pwm.metadata,
            pwm.retry_count, pwm.idempotency_key, pwm.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_quest(p_quest_id uuid, p_note text DEFAULT NULL::text, p_user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quest RECORD;
BEGIN
  SELECT * INTO v_quest FROM quests WHERE id = p_quest_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '任务不存在');
  END IF;

  IF v_quest.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '任务已完成');
  END IF;

  -- 更新任务状态
  UPDATE quests SET
    status = 'completed',
    completed_at = now(),
    completed_note = p_note
  WHERE id = p_quest_id;

  -- 积分入账（reward_points为0的特殊任务不发积分）
  IF v_quest.reward_points > 0 THEN
    INSERT INTO wallet_transactions (user_id, type, points_delta, coins_delta, description, quest_id)
    VALUES (p_user_id, 'earn', v_quest.reward_points, 0,
            '完成任务：' || v_quest.title, p_quest_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'quest_title', v_quest.title,
    'points_earned', v_quest.reward_points,
    'completed_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_usage_quota(p_user_id uuid, p_scope text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date := (now() at time zone 'Asia/Shanghai')::date;
  v_count integer;
begin
  insert into public.usage_quota (user_id, scope, day, count)
  values (p_user_id, p_scope, v_day, 1)
  on conflict (user_id, scope, day)
  do update set count = usage_quota.count + 1, updated_at = now()
  returning count into v_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.conversation_dispatch_cancel_pending(p_user_id uuid, p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_task public.agent_tasks%rowtype;
  v_command public.syzygy_commands%rowtype;
  v_command_id uuid;
  v_reply_id uuid;
  v_cancelled_at timestamptz := now();
begin
  if p_user_id is null or p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_cancel: user_id and task_id are required';
  end if;

  select *
  into v_task
  from public.agent_tasks
  where id = p_task_id
    and user_id = p_user_id
    and source = 'conversation_dispatch';

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch_cancel: task not found';
  end if;

  if coalesce(v_task.payload_json ->> 'command_id', '')
     !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_cancel: task command_id is invalid';
  end if;
  v_command_id := (v_task.payload_json ->> 'command_id')::uuid;

  select *
  into v_command
  from public.syzygy_commands
  where id = v_command_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch_cancel: command not found';
  end if;

  select *
  into v_task
  from public.agent_tasks
  where id = p_task_id
    and user_id = p_user_id
    and source = 'conversation_dispatch'
  for update;

  if v_command.status <> 'pending' or v_task.status <> 'pending' then
    return jsonb_build_object(
      'schema_version', 1,
      'cancelled', false,
      'reason', 'already_claimed',
      'command', jsonb_build_object('id', v_command.id, 'status', v_command.status),
      'task', jsonb_build_object('id', v_task.id, 'status', v_task.status)
    );
  end if;

  update public.syzygy_commands
  set
    status = 'failed',
    result = jsonb_build_object(
      'schema_version', 1,
      'cancelled', true,
      'cancelled_at', v_cancelled_at
    ),
    error_message = 'cancelled by owner before claim',
    completed_at = v_cancelled_at,
    updated_at = v_cancelled_at
  where id = v_command.id
    and user_id = p_user_id
    and status = 'pending'
  returning *
  into v_command;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'conversation_dispatch_cancel: command claim changed';
  end if;

  update public.agent_tasks
  set
    status = 'cancelled',
    result_summary = 'Cancelled before mini claim',
    result_detail = null,
    error = null,
    completed_at = v_cancelled_at
  where id = v_task.id
    and user_id = p_user_id
    and status = 'pending'
  returning *
  into v_task;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'conversation_dispatch_cancel: task claim changed';
  end if;

  if coalesce(v_task.payload_json ->> 'reply_id', '')
     ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_reply_id := (v_task.payload_json ->> 'reply_id')::uuid;

    update public.messages
    set meta = (
      coalesce(meta, '{}'::jsonb)
      || jsonb_build_object(
        'delivery_state', 'failed',
        'delivery_error_code', 'CLI_TASK_CANCELLED',
        'delivery_error', '任务已在 Mac mini 认领前取消',
        'failed_at', v_cancelled_at,
        'command_id', v_command.id,
        'agent_task_id', v_task.id
      )
    ) - 'completed_at'
    where id = v_reply_id
      and user_id = p_user_id
      and role = 'assistant';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'cancelled', true,
    'cancelled_at', v_cancelled_at,
    'command', jsonb_build_object('id', v_command.id, 'status', v_command.status),
    'task', jsonb_build_object('id', v_task.id, 'status', v_task.status)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_dispatch_complete_reply(p_user_id uuid, p_task_id uuid, p_content text, p_completed_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_task public.agent_tasks%rowtype;
  v_reply public.messages%rowtype;
  v_event_id bigint;
  v_session_id uuid;
  v_user_message_id uuid;
  v_reply_id uuid;
  v_command_id uuid;
  v_responder text;
  v_output text := left(coalesce(p_content, ''), 12000);
  v_completed_at timestamptz := coalesce(p_completed_at, now());
begin
  if p_user_id is null or p_task_id is null or btrim(v_output) = '' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_complete: user_id, task_id, and content are required';
  end if;

  select *
  into v_task
  from public.agent_tasks
  where id = p_task_id
    and user_id = p_user_id
    and source = 'conversation_dispatch';

  if not found or v_task.status <> 'completed' then
    raise exception using
      errcode = '55000',
      message = 'conversation_dispatch_complete: completed task not found';
  end if;

  if coalesce(v_task.payload_json ->> 'session_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_task.payload_json ->> 'user_message_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_task.payload_json ->> 'reply_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_task.payload_json ->> 'command_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_complete: durable task envelope is invalid';
  end if;

  v_session_id := (v_task.payload_json ->> 'session_id')::uuid;
  v_user_message_id := (v_task.payload_json ->> 'user_message_id')::uuid;
  v_reply_id := (v_task.payload_json ->> 'reply_id')::uuid;
  v_command_id := (v_task.payload_json ->> 'command_id')::uuid;
  v_responder := nullif(btrim(v_task.payload_json ->> 'responder_sender_key'), '');

  select *
  into v_reply
  from public.messages
  where id = v_reply_id
    and user_id = p_user_id
    and session_id = v_session_id
    and reply_to_id = v_user_message_id
    and sender_key = v_responder
    and role = 'assistant'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch_complete: canonical reply not found';
  end if;

  if coalesce(v_reply.meta ->> 'delivery_state', '') = 'completed'
     and v_reply.content is distinct from v_output then
    raise exception using
      errcode = '23505',
      message = 'conversation_dispatch_complete: reply already completed with different content';
  end if;

  if coalesce(v_reply.meta ->> 'delivery_state', '') <> 'completed' then
    update public.messages
    set
      content = v_output,
      meta = (
        coalesce(meta, '{}'::jsonb)
        || jsonb_build_object(
          'schema_version', 1,
          'source', 'conversation_dispatch',
          'delivery_state', 'completed',
          'responder_sender_key', v_responder,
          'command_id', v_command_id,
          'agent_task_id', v_task.id,
          'completed_at', v_completed_at
        )
      )
      - 'delivery_error'
      - 'delivery_error_code'
      - 'failed_at'
    where id = v_reply.id
      and user_id = p_user_id
    returning *
    into v_reply;
  end if;

  insert into public.agent_events (
    user_id,
    actor,
    event_type,
    entity_type,
    entity_id,
    title,
    payload,
    importance
  )
  values (
    p_user_id,
    coalesce(v_responder, 'syzygy_cli'),
    'conversation_reply_completed',
    'conversation_reply',
    v_reply.id,
    'Syzygy·本体回复了你',
    jsonb_build_object(
      'schema_version', 1,
      'screen', 'conversation_detail',
      'params', jsonb_build_object('id', v_session_id),
      'url', format('/#/chat?session=%s', v_session_id),
      'session_id', v_session_id,
      'user_message_id', v_user_message_id,
      'reply_id', v_reply.id,
      'command_id', v_command_id,
      'agent_task_id', v_task.id,
      'responder_sender_key', v_responder
    ),
    'normal'
  )
  on conflict (user_id, event_type, entity_id)
    where event_type = 'conversation_reply_completed'
      and entity_id is not null
  do nothing
  returning id
  into v_event_id;

  if v_event_id is null then
    select id
    into v_event_id
    from public.agent_events
    where user_id = p_user_id
      and event_type = 'conversation_reply_completed'
      and entity_id = v_reply.id;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'reply', jsonb_build_object(
      'id', v_reply.id,
      'content', v_reply.content,
      'delivery_state', v_reply.meta ->> 'delivery_state',
      'completed_at', v_reply.meta ->> 'completed_at'
    ),
    'task', jsonb_build_object('id', v_task.id, 'status', v_task.status),
    'event', jsonb_build_object('id', v_event_id, 'event_type', 'conversation_reply_completed')
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_dispatch_prepare(p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone DEFAULT now(), p_target_sender_keys text[] DEFAULT NULL::text[], p_retry_failed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.conversation_dispatch_prepare_core(
    auth.uid(),
    p_session_id,
    p_client_id,
    p_content,
    p_client_created_at,
    p_target_sender_keys,
    p_retry_failed,
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.conversation_dispatch_prepare_durable(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone DEFAULT now(), p_target_sender_keys text[] DEFAULT NULL::text[], p_retry_failed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.conversation_dispatch_prepare_core(
    p_user_id,
    p_session_id,
    p_client_id,
    p_content,
    p_client_created_at,
    p_target_sender_keys,
    p_retry_failed,
    true
  );
$function$;

CREATE OR REPLACE FUNCTION public.conversation_profile_publish(p_profile_key text, p_conversation_kind text, p_handler text, p_session_policy text, p_singleton_session_key text, p_participant_port_keys text[], p_default_responder_port_key text, p_rules_prompt_name text, p_context_recipe jsonb, p_expected_active_version integer DEFAULT NULL::integer)
 RETURNS conversation_profiles
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.conversation_profile_publish_core(
    p_profile_key,
    p_conversation_kind,
    p_handler,
    p_session_policy,
    p_singleton_session_key,
    p_participant_port_keys,
    p_default_responder_port_key,
    p_rules_prompt_name,
    p_context_recipe,
    p_expected_active_version
  )
$function$;

CREATE OR REPLACE FUNCTION public.conversation_session_create(p_session_id uuid, p_profile_key text, p_title text, p_display_config jsonb DEFAULT '{}'::jsonb)
 RETURNS sessions
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.conversation_session_create_core(
    p_session_id,
    p_profile_key,
    p_title,
    p_display_config
  )
$function$;

CREATE OR REPLACE FUNCTION public.council_submit_report(p_proposal_id uuid, p_speaker text, p_message text, p_result text, p_artifacts text[] DEFAULT NULL::text[], p_follow_ups text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_proposal public.agent_council%rowtype;
  v_report_id uuid;
  v_next_status text;
  v_event_id bigint;
  v_title text;
begin
  if p_result is null or p_result not in ('succeeded', 'partial', 'failed') then
    raise exception 'council_submit_report: result 必须是 succeeded / partial / failed，收到 %', coalesce(p_result, 'null');
  end if;
  if p_message is null or btrim(p_message) = '' then
    raise exception 'council_submit_report: message 不能为空（三五句人话：干了什么/怎么验证/遗留什么）';
  end if;

  select * into v_proposal
    from public.agent_council
   where id = p_proposal_id and entry_type = 'proposal'
     for update;
  if not found then
    raise exception 'council_submit_report: 主提案不存在或不是 proposal: %', p_proposal_id;
  end if;

  -- succeeded / partial → done（partial 的遗留项建议另开提案，写进 follow_ups）；
  -- failed → failed（完成是事实不是愿望；卡点写在回执里，等串串改派或重试）。
  v_next_status := case when p_result = 'failed' then 'failed' else 'done' end;

  insert into public.agent_council
    (user_id, parent_id, speaker, topic, message, entry_type, category, metadata)
  values
    (v_proposal.user_id, v_proposal.id, p_speaker, v_proposal.topic, p_message, 'report',
     v_proposal.category,
     jsonb_strip_nulls(jsonb_build_object(
       'result', p_result,
       'artifacts', case when p_artifacts is null or cardinality(p_artifacts) = 0
                         then null else to_jsonb(p_artifacts) end,
       'follow_ups', case when p_follow_ups is null or cardinality(p_follow_ups) = 0
                          then null else to_jsonb(p_follow_ups) end
     )))
  returning id into v_report_id;

  update public.agent_council
     set proposal_status = v_next_status, updated_at = now()
   where id = v_proposal.id;

  v_title := case p_result
    when 'succeeded' then '✅ 议事厅回执：' || v_proposal.topic
    when 'partial'   then '🟡 议事厅回执（部分完成）：' || v_proposal.topic
    else                  '❌ 议事厅回执（失败）：' || v_proposal.topic
  end;

  -- screen=home 已在 App 推送白名单内（push-payload.ts），entity_id 供客户端补账定位。
  insert into public.agent_events
    (user_id, actor, event_type, entity_type, entity_id, title, payload, importance)
  values
    (v_proposal.user_id, p_speaker, 'council_report', 'council_proposal', v_proposal.id,
     v_title,
     jsonb_build_object('screen', 'home', 'result', p_result, 'topic', v_proposal.topic),
     'normal')
  returning id into v_event_id;

  return jsonb_build_object(
    'proposal_id', v_proposal.id,
    'proposal_status', v_next_status,
    'report_id', v_report_id,
    'agent_event_id', v_event_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.exchange_points_to_coins(p_points integer, p_user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_points INTEGER;
  v_coins NUMERIC(10,2);
BEGIN
  -- 检查余额
  SELECT COALESCE(SUM(points_delta), 0) INTO v_current_points
  FROM wallet_transactions WHERE user_id = p_user_id;

  IF v_current_points < p_points THEN
    RETURN jsonb_build_object('success', false, 'error', '积分不足', 'current_points', v_current_points);
  END IF;

  IF p_points < 100 THEN
    RETURN jsonb_build_object('success', false, 'error', '最少兑换100积分');
  END IF;

  -- 100:1 兑换
  v_coins := (p_points / 100)::NUMERIC(10,2);

  INSERT INTO wallet_transactions (user_id, type, points_delta, coins_delta, description)
  VALUES (p_user_id, 'exchange', -p_points, v_coins,
          p_points || '积分 → ' || v_coins || '金币');

  RETURN jsonb_build_object(
    'success', true,
    'exchanged_points', p_points,
    'gained_coins', v_coins,
    'remaining_points', v_current_points - p_points
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.generation_port_publish(p_port_key text, p_runtime_kind text, p_model_channel_name text, p_target_role text, p_identity_prompt_name text, p_style_prompt_name text, p_sop_source text, p_sop_ref text, p_expected_active_version integer DEFAULT NULL::integer)
 RETURNS generation_ports
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.generation_port_publish_core(
    p_port_key,
    p_runtime_kind,
    p_model_channel_name,
    p_target_role,
    p_identity_prompt_name,
    p_style_prompt_name,
    p_sop_source,
    p_sop_ref,
    p_expected_active_version
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_forum_thread_replies_tree(p_thread_id uuid)
 RETURNS TABLE(id uuid, thread_id uuid, user_id uuid, body text, author_type text, author_slot integer, author_name text, parent_id uuid, reply_to_reply_id uuid, reply_to_author_name text, created_at timestamp with time zone, depth integer, sort_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive reply_tree as (
    select
      r.id,
      r.thread_id,
      r.user_id,
      r.body,
      r.author_type,
      r.author_slot,
      r.author_name,
      r.parent_id,
      r.reply_to_reply_id,
      r.reply_to_author_name,
      r.created_at,
      0 as depth,
      to_char(r.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSMS') || '-' || r.id::text as sort_path
    from public.forum_replies r
    where r.thread_id = p_thread_id
      and r.parent_id is null

    union all

    select
      c.id,
      c.thread_id,
      c.user_id,
      c.body,
      c.author_type,
      c.author_slot,
      c.author_name,
      c.parent_id,
      c.reply_to_reply_id,
      c.reply_to_author_name,
      c.created_at,
      p.depth + 1 as depth,
      p.sort_path || '.' || to_char(c.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSMS') || '-' || c.id::text as sort_path
    from public.forum_replies c
    join reply_tree p
      on c.parent_id = p.id
    where c.thread_id = p_thread_id
  )
  select *
  from reply_tree
  order by sort_path;
$function$;

CREATE OR REPLACE FUNCTION public.get_push_dispatch_secret()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'push_dispatch_secret'
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.mark_wechat_message_failed(p_message_id uuid, p_worker_id text, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_updated_count integer;
begin
  update public.pending_wechat_messages pwm
  set status = 'failed',
      last_error = left(coalesce(p_error, 'unknown error'), 2000),
      retry_count = pwm.retry_count + 1,
      locked_at = null,
      processing_by = null
  where pwm.id = p_message_id
    and pwm.status = 'sending'
    and (
      pwm.processing_by = p_worker_id
      or pwm.locked_at < now() - interval '10 minutes'
    );

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_wechat_message_sent(p_message_id uuid, p_worker_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_updated_count integer;
begin
  update public.pending_wechat_messages pwm
  set status = 'sent',
      sent_at = now(),
      delivered_at = coalesce(pwm.delivered_at, now()),
      last_error = null,
      locked_at = null,
      processing_by = null
  where pwm.id = p_message_id
    and pwm.status = 'sending'
    and (
      pwm.processing_by = p_worker_id
      or pwm.locked_at < now() - interval '10 minutes'
    );

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_push_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'push_dispatch_secret'
   limit 1;
  if v_secret is null then
    raise warning 'notify_push_dispatch: vault secret push_dispatch_secret missing, skip';
    return new;
  end if;
  perform net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-dispatch-secret', v_secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
exception
  when others then
    raise warning 'notify_push_dispatch failed: %', sqlerrm;
    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prompt_template_publish(p_name text, p_category text, p_content text, p_expected_active_version integer DEFAULT NULL::integer)
 RETURNS prompt_templates
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.prompt_template_publish_core(
    p_name,
    p_category,
    p_content,
    p_expected_active_version
  )
$function$;

CREATE OR REPLACE FUNCTION public.reset_stuck_wechat_messages(p_timeout_minutes integer DEFAULT 5, p_max_retries integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_updated_count integer;
begin
  update public.pending_wechat_messages pwm
  set status = case
        when pwm.retry_count >= p_max_retries then 'failed'
        else 'pending'
      end,
      last_error = case
        when pwm.retry_count >= p_max_retries then 'message stuck in sending and exceeded max retries'
        else pwm.last_error
      end,
      locked_at = null,
      processing_by = null
  where pwm.status = 'sending'
    and pwm.locked_at is not null
    and pwm.locked_at < now() - make_interval(mins => p_timeout_minutes);

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_approval(p_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS approval_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.approval_requests;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision';
  end if;

  update public.approval_requests
     set status = p_decision,
         response_note = coalesce(p_note, response_note),
         responded_at = now()
   where id = p_id
     and user_id = (select auth.uid())
     and status = 'pending'
     and (expires_at is null or expires_at > now())
  returning * into v_row;

  if not found then
    raise exception 'approval not pending, expired, or not found';
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_snack_post(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.snack_posts
  set is_deleted = false
  where id = p_post_id
    and user_id = auth.uid();

  if not found then
    raise exception 'not found or not owner';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.runtime_control_prepare(p_action text, p_target_role text, p_client_id uuid, p_confirm_running_tasks boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_target_role text := lower(btrim(coalesce(p_target_role, '')));
  v_idempotency_key text;
  v_payload jsonb;
  v_command public.syzygy_commands%rowtype;
  v_was_duplicate boolean := false;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if v_action not in ('wake', 'sleep') then
    raise exception using
      errcode = '22023',
      message = 'action must be wake or sleep';
  end if;

  if v_target_role not in (
    'codex_cli_syzygy',
    'claude_code_cli_syzygy'
  ) then
    raise exception using
      errcode = '22023',
      message = 'target_role is not allowed';
  end if;

  if p_client_id is null then
    raise exception using
      errcode = '22023',
      message = 'client_id is required';
  end if;

  if v_action = 'wake' and coalesce(p_confirm_running_tasks, false) then
    raise exception using
      errcode = '22023',
      message = 'confirm_running_tasks is only valid for sleep';
  end if;

  v_idempotency_key := 'runtime-control:v1:' || p_client_id::text;
  v_payload := jsonb_build_object(
    'schema_version', 1,
    'source', 'runtime_control',
    'action', v_action,
    'target_role', v_target_role,
    'client_id', p_client_id::text,
    'idempotency_key', v_idempotency_key,
    'confirm_running_tasks', coalesce(p_confirm_running_tasks, false)
  );

  insert into public.syzygy_commands (
    user_id,
    command_type,
    status,
    payload,
    idempotency_key
  )
  values (
    v_user_id,
    v_action,
    'pending',
    v_payload,
    v_idempotency_key
  )
  on conflict (user_id, idempotency_key)
  do nothing
  returning *
  into v_command;

  if v_command.id is null then
    v_was_duplicate := true;

    select *
    into v_command
    from public.syzygy_commands
    where user_id = v_user_id
      and idempotency_key = v_idempotency_key;
  end if;

  if v_command.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'runtime control command was not found';
  end if;

  if v_command.command_type is distinct from v_action
    or v_command.payload -> 'schema_version' is distinct from '1'::jsonb
    or v_command.payload ->> 'source' is distinct from 'runtime_control'
    or v_command.payload ->> 'action' is distinct from v_action
    or v_command.payload ->> 'target_role' is distinct from v_target_role
    or v_command.payload ->> 'client_id' is distinct from p_client_id::text
    or v_command.payload ->> 'idempotency_key' is distinct from v_idempotency_key
    or v_command.payload -> 'confirm_running_tasks'
      is distinct from to_jsonb(coalesce(p_confirm_running_tasks, false))
  then
    raise exception using
      errcode = '23505',
      message = 'runtime control idempotency key collision';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'was_duplicate', v_was_duplicate,
    'command', jsonb_build_object(
      'id', v_command.id,
      'action', v_action,
      'target_role', v_target_role,
      'status', v_command.status,
      'idempotency_key', v_command.idempotency_key,
      'confirm_running_tasks', coalesce(p_confirm_running_tasks, false),
      'created_at', v_command.created_at,
      'claimed_at', v_command.claimed_at,
      'completed_at', v_command.completed_at,
      'error_message', v_command.error_message
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_sessions_updated_at_now()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_snack_posts_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_id_from_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_settings_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_snack_post(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.snack_posts
  set is_deleted = true
  where id = p_post_id
    and user_id = auth.uid();

  if not found then
    raise exception 'not found or not owner';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_snack_reply(p_reply_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.snack_replies
  set is_deleted = true
  where id = p_reply_id
    and user_id = auth.uid();

  if not found then
    raise exception 'not found or not owner';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.spend_coins(p_amount numeric, p_description text, p_user_id uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_coins NUMERIC(10,2);
BEGIN
  SELECT COALESCE(SUM(coins_delta), 0) INTO v_current_coins
  FROM wallet_transactions WHERE user_id = p_user_id;

  IF v_current_coins < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', '金币不足', 'current_coins', v_current_coins);
  END IF;

  INSERT INTO wallet_transactions (user_id, type, points_delta, coins_delta, description)
  VALUES (p_user_id, 'spend', 0, -p_amount, p_description);

  RETURN jsonb_build_object(
    'success', true,
    'spent', p_amount,
    'remaining_coins', v_current_coins - p_amount,
    'description', p_description
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_session_updated_at_from_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_session_id uuid;
begin
  target_session_id = coalesce(new.session_id, old.session_id);

  if target_session_id is not null then
    update public.sessions
    set updated_at = now()
    where id = target_session_id;
  end if;

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_knowledge_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_timeline_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_forum_reply_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  parent_thread_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'forum_replies.parent_id cannot equal id';
  end if;

  select thread_id
  into parent_thread_id
  from public.forum_replies
  where id = new.parent_id;

  if parent_thread_id is null then
    raise exception 'parent reply does not exist';
  end if;

  if parent_thread_id <> new.thread_id then
    raise exception 'parent reply must belong to the same thread';
  end if;

  return new;
end;
$function$;

-- ============================================================================
-- 9. 视图
-- ============================================================================

CREATE OR REPLACE VIEW public.llm_usage_daily WITH (security_invoker=on) AS
 SELECT (created_at AT TIME ZONE 'Asia/Shanghai'::text)::date AS day,
    module,
    model,
    count(*) AS calls,
    sum(prompt_tokens) AS prompt_tokens,
    sum(completion_tokens) AS completion_tokens,
    sum(total_tokens) AS total_tokens,
    sum(cached_tokens) AS cached_tokens,
    sum(cache_write_tokens) AS cache_write_tokens,
    sum(cost_usd) AS cost_usd
   FROM llm_usage
  GROUP BY ((created_at AT TIME ZONE 'Asia/Shanghai'::text)::date), module, model;

CREATE OR REPLACE VIEW public.wallet_balance WITH (security_invoker=on) AS
 SELECT user_id,
    COALESCE(sum(points_delta), 0::bigint)::integer AS points,
    COALESCE(sum(coins_delta), 0::numeric)::numeric(10,2) AS coins
   FROM wallet_transactions
  GROUP BY user_id;

-- ============================================================================
-- 10. 触发器
-- ============================================================================

DROP TRIGGER IF EXISTS agent_events_push_dispatch ON public.agent_events;
CREATE TRIGGER agent_events_push_dispatch AFTER INSERT ON public.agent_events FOR EACH ROW EXECUTE FUNCTION notify_push_dispatch();
DROP TRIGGER IF EXISTS trg_agent_feed_items_updated_at ON public.agent_feed_items;
CREATE TRIGGER trg_agent_feed_items_updated_at BEFORE UPDATE ON public.agent_feed_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS agent_settings_set_updated_at ON public.agent_settings;
CREATE TRIGGER agent_settings_set_updated_at BEFORE UPDATE ON public.agent_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS channel_config_set_updated_at ON public.channel_config;
CREATE TRIGGER channel_config_set_updated_at BEFORE UPDATE ON public.channel_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS conversation_profiles_immutable_version ON public.conversation_profiles;
CREATE TRIGGER conversation_profiles_immutable_version BEFORE UPDATE ON public.conversation_profiles FOR EACH ROW EXECUTE FUNCTION private.enforce_versioned_chat_config_immutable();
DROP TRIGGER IF EXISTS set_forum_ai_profiles_updated_at ON public.forum_ai_profiles;
CREATE TRIGGER set_forum_ai_profiles_updated_at BEFORE UPDATE ON public.forum_ai_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS forum_replies_validate_parent ON public.forum_replies;
CREATE TRIGGER forum_replies_validate_parent BEFORE INSERT OR UPDATE OF parent_id, thread_id ON public.forum_replies FOR EACH ROW EXECUTE FUNCTION validate_forum_reply_parent();
DROP TRIGGER IF EXISTS set_forum_threads_updated_at ON public.forum_threads;
CREATE TRIGGER set_forum_threads_updated_at BEFORE UPDATE ON public.forum_threads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS generation_ports_immutable_version ON public.generation_ports;
CREATE TRIGGER generation_ports_immutable_version BEFORE UPDATE ON public.generation_ports FOR EACH ROW EXECUTE FUNCTION private.enforce_versioned_chat_config_immutable();
DROP TRIGGER IF EXISTS trg_knowledge_folders_updated ON public.knowledge_folders;
CREATE TRIGGER trg_knowledge_folders_updated BEFORE UPDATE ON public.knowledge_folders FOR EACH ROW EXECUTE FUNCTION update_knowledge_updated_at();
DROP TRIGGER IF EXISTS trg_learning_nodes_updated ON public.learning_nodes;
CREATE TRIGGER trg_learning_nodes_updated BEFORE UPDATE ON public.learning_nodes FOR EACH ROW EXECUTE FUNCTION update_knowledge_updated_at();
DROP TRIGGER IF EXISTS trg_llm_providers_updated_at ON public.llm_providers;
CREATE TRIGGER trg_llm_providers_updated_at BEFORE UPDATE ON public.llm_providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS touch_session_updated_at_after_messages ON public.messages;
CREATE TRIGGER touch_session_updated_at_after_messages AFTER INSERT OR DELETE OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION touch_session_updated_at_from_messages();
DROP TRIGGER IF EXISTS prompt_templates_immutable_version ON public.prompt_templates;
CREATE TRIGGER prompt_templates_immutable_version BEFORE DELETE OR UPDATE ON public.prompt_templates FOR EACH ROW EXECUTE FUNCTION private.enforce_prompt_template_immutable();
DROP TRIGGER IF EXISTS prompt_templates_set_updated_at ON public.prompt_templates;
CREATE TRIGGER prompt_templates_set_updated_at BEFORE UPDATE ON public.prompt_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS provider_models_set_updated_at ON public.provider_models;
CREATE TRIGGER provider_models_set_updated_at BEFORE UPDATE ON public.provider_models FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS providers_set_updated_at ON public.providers;
CREATE TRIGGER providers_set_updated_at BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_rp_npc_cards_set_updated_at ON public.rp_npc_cards;
CREATE TRIGGER trg_rp_npc_cards_set_updated_at BEFORE UPDATE ON public.rp_npc_cards FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_rp_sessions_set_updated_at ON public.rp_sessions;
CREATE TRIGGER trg_rp_sessions_set_updated_at BEFORE UPDATE ON public.rp_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_sessions_updated_at_now ON public.sessions;
CREATE TRIGGER set_sessions_updated_at_now BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_sessions_updated_at_now();
DROP TRIGGER IF EXISTS trg_sessions_updated_at ON public.sessions;
CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_snack_posts_updated_at ON public.snack_posts;
CREATE TRIGGER trg_snack_posts_updated_at BEFORE UPDATE ON public.snack_posts FOR EACH ROW EXECUTE FUNCTION set_snack_posts_updated_at();
DROP TRIGGER IF EXISTS syzygy_commands_set_updated_at ON public.syzygy_commands;
CREATE TRIGGER syzygy_commands_set_updated_at BEFORE UPDATE ON public.syzygy_commands FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_syzygy_posts_user_id ON public.syzygy_posts;
CREATE TRIGGER trg_syzygy_posts_user_id BEFORE INSERT ON public.syzygy_posts FOR EACH ROW EXECUTE FUNCTION set_user_id_from_auth();
DROP TRIGGER IF EXISTS trg_syzygy_replies_user_id ON public.syzygy_replies;
CREATE TRIGGER trg_syzygy_replies_user_id BEFORE INSERT ON public.syzygy_replies FOR EACH ROW EXECUTE FUNCTION set_user_id_from_auth();
DROP TRIGGER IF EXISTS trigger_timeline_config_updated_at ON public.timeline_config;
CREATE TRIGGER trigger_timeline_config_updated_at BEFORE UPDATE ON public.timeline_config FOR EACH ROW EXECUTE FUNCTION update_timeline_updated_at();
DROP TRIGGER IF EXISTS trigger_timeline_entries_updated_at ON public.timeline_entries;
CREATE TRIGGER trigger_timeline_entries_updated_at BEFORE UPDATE ON public.timeline_entries FOR EACH ROW EXECUTE FUNCTION update_timeline_updated_at();
DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION set_user_settings_updated_at();

-- ============================================================================
-- 11. 启用 RLS（所有表）
-- ============================================================================

ALTER TABLE public.agent_council ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_feed_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_letter_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bubble_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bubble_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codex_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codex_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compression_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.current_context_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_status_digest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enabled_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_ai_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_ports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lounge_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lounge_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lounge_sofas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memo_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memo_entry_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memo_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.novel_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.novel_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_wechat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_capsules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rp_npc_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rp_session_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rp_story_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_wakeup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snack_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snack_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syzygy_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syzygy_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syzygy_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syzygy_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thought_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wechat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_digest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 12. RLS 策略
-- ============================================================================

DROP POLICY IF EXISTS authenticated_all ON public.agent_council;
CREATE POLICY authenticated_all ON public.agent_council FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS agent_events_insert_own ON public.agent_events;
CREATE POLICY agent_events_insert_own ON public.agent_events FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_events_select_own ON public.agent_events;
CREATE POLICY agent_events_select_own ON public.agent_events FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_feed_items_delete_own ON public.agent_feed_items;
CREATE POLICY agent_feed_items_delete_own ON public.agent_feed_items FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_feed_items_insert_own ON public.agent_feed_items;
CREATE POLICY agent_feed_items_insert_own ON public.agent_feed_items FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_feed_items_select_own ON public.agent_feed_items;
CREATE POLICY agent_feed_items_select_own ON public.agent_feed_items FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_feed_items_update_own ON public.agent_feed_items;
CREATE POLICY agent_feed_items_update_own ON public.agent_feed_items FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_heartbeats_select_own ON public.agent_heartbeats;
CREATE POLICY agent_heartbeats_select_own ON public.agent_heartbeats FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_heartbeats_update_own ON public.agent_heartbeats;
CREATE POLICY agent_heartbeats_update_own ON public.agent_heartbeats FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_heartbeats_upsert_own ON public.agent_heartbeats;
CREATE POLICY agent_heartbeats_upsert_own ON public.agent_heartbeats FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS agent_settings_delete_own ON public.agent_settings;
CREATE POLICY agent_settings_delete_own ON public.agent_settings FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS agent_settings_insert_own ON public.agent_settings;
CREATE POLICY agent_settings_insert_own ON public.agent_settings FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS agent_settings_select_own ON public.agent_settings;
CREATE POLICY agent_settings_select_own ON public.agent_settings FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS agent_settings_update_own ON public.agent_settings;
CREATE POLICY agent_settings_update_own ON public.agent_settings FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS agent_tasks_select_own ON public.agent_tasks;
CREATE POLICY agent_tasks_select_own ON public.agent_tasks FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS approval_executions_select_own ON public.approval_executions;
CREATE POLICY approval_executions_select_own ON public.approval_executions FOR SELECT TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS approval_requests_select_own ON public.approval_requests;
CREATE POLICY approval_requests_select_own ON public.approval_requests FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archive_categories_delete_own ON public.archive_categories;
CREATE POLICY archive_categories_delete_own ON public.archive_categories FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archive_categories_insert_own ON public.archive_categories;
CREATE POLICY archive_categories_insert_own ON public.archive_categories FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archive_categories_select_own ON public.archive_categories;
CREATE POLICY archive_categories_select_own ON public.archive_categories FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archive_categories_service_role_all ON public.archive_categories;
CREATE POLICY archive_categories_service_role_all ON public.archive_categories FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS archive_categories_update_own ON public.archive_categories;
CREATE POLICY archive_categories_update_own ON public.archive_categories FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archives_delete_own ON public.archives;
CREATE POLICY archives_delete_own ON public.archives FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archives_insert_own ON public.archives;
CREATE POLICY archives_insert_own ON public.archives FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archives_select_own ON public.archives;
CREATE POLICY archives_select_own ON public.archives FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS archives_service_role_all ON public.archives;
CREATE POLICY archives_service_role_all ON public.archives FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS archives_update_own ON public.archives;
CREATE POLICY archives_update_own ON public.archives FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can insert own config" ON public.auto_letter_config;
CREATE POLICY "Users can insert own config" ON public.auto_letter_config FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own config" ON public.auto_letter_config;
CREATE POLICY "Users can read own config" ON public.auto_letter_config FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own config" ON public.auto_letter_config;
CREATE POLICY "Users can update own config" ON public.auto_letter_config FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can manage own bubble messages" ON public.bubble_messages;
CREATE POLICY "Users can manage own bubble messages" ON public.bubble_messages FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can manage own bubble sessions" ON public.bubble_sessions;
CREATE POLICY "Users can manage own bubble sessions" ON public.bubble_sessions FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Authenticated users can read capabilities" ON public.capabilities;
CREATE POLICY "Authenticated users can read capabilities" ON public.capabilities FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS channel_config_delete_own ON public.channel_config;
CREATE POLICY channel_config_delete_own ON public.channel_config FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS channel_config_insert_own ON public.channel_config;
CREATE POLICY channel_config_insert_own ON public.channel_config FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS channel_config_select_own ON public.channel_config;
CREATE POLICY channel_config_select_own ON public.channel_config FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS channel_config_update_own ON public.channel_config;
CREATE POLICY channel_config_update_own ON public.channel_config FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Allow all for owner" ON public.checkin_logs;
CREATE POLICY "Allow all for owner" ON public.checkin_logs FOR ALL TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid))
  WITH CHECK ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS checkins_delete_own ON public.checkins;
CREATE POLICY checkins_delete_own ON public.checkins FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS checkins_insert_own ON public.checkins;
CREATE POLICY checkins_insert_own ON public.checkins FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS checkins_select_own ON public.checkins;
CREATE POLICY checkins_select_own ON public.checkins FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "User can manage own codex_control" ON public.codex_control;
CREATE POLICY "User can manage own codex_control" ON public.codex_control FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "User can manage own codex_tasks" ON public.codex_tasks;
CREATE POLICY "User can manage own codex_tasks" ON public.codex_tasks FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS compression_cache_insert_own ON public.compression_cache;
CREATE POLICY compression_cache_insert_own ON public.compression_cache FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = compression_cache.conversation_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS compression_cache_select_own ON public.compression_cache;
CREATE POLICY compression_cache_select_own ON public.compression_cache FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = compression_cache.conversation_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS compression_cache_update_own ON public.compression_cache;
CREATE POLICY compression_cache_update_own ON public.compression_cache FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = compression_cache.conversation_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = compression_cache.conversation_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS conversation_profiles_select_own ON public.conversation_profiles;
CREATE POLICY conversation_profiles_select_own ON public.conversation_profiles FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS council_categories_select ON public.council_categories;
CREATE POLICY council_categories_select ON public.council_categories FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS council_categories_update ON public.council_categories;
CREATE POLICY council_categories_update ON public.council_categories FOR UPDATE TO authenticated
  USING ((( SELECT auth.uid() AS uid) IS NOT NULL))
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));

DROP POLICY IF EXISTS frontend_read_current_context_snapshot ON public.current_context_snapshot;
CREATE POLICY frontend_read_current_context_snapshot ON public.current_context_snapshot FOR SELECT TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS frontend_read_daily_status_digest ON public.daily_status_digest;
CREATE POLICY frontend_read_daily_status_digest ON public.daily_status_digest FOR SELECT TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS device_status_insert_own ON public.device_status;
CREATE POLICY device_status_insert_own ON public.device_status FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS device_status_select_authenticated ON public.device_status;
CREATE POLICY device_status_select_authenticated ON public.device_status FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS device_tokens_delete_own ON public.device_tokens;
CREATE POLICY device_tokens_delete_own ON public.device_tokens FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS device_tokens_insert_own ON public.device_tokens;
CREATE POLICY device_tokens_insert_own ON public.device_tokens FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS device_tokens_select_own ON public.device_tokens;
CREATE POLICY device_tokens_select_own ON public.device_tokens FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS device_tokens_update_own ON public.device_tokens;
CREATE POLICY device_tokens_update_own ON public.device_tokens FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS enabled_models_delete_own ON public.enabled_models;
CREATE POLICY enabled_models_delete_own ON public.enabled_models FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS enabled_models_insert_own ON public.enabled_models;
CREATE POLICY enabled_models_insert_own ON public.enabled_models FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS enabled_models_select_own ON public.enabled_models;
CREATE POLICY enabled_models_select_own ON public.enabled_models FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS enabled_models_update_own ON public.enabled_models;
CREATE POLICY enabled_models_update_own ON public.enabled_models FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_ai_profiles_delete_own ON public.forum_ai_profiles;
CREATE POLICY forum_ai_profiles_delete_own ON public.forum_ai_profiles FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_ai_profiles_insert_own ON public.forum_ai_profiles;
CREATE POLICY forum_ai_profiles_insert_own ON public.forum_ai_profiles FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_ai_profiles_select_own ON public.forum_ai_profiles;
CREATE POLICY forum_ai_profiles_select_own ON public.forum_ai_profiles FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_ai_profiles_update_own ON public.forum_ai_profiles;
CREATE POLICY forum_ai_profiles_update_own ON public.forum_ai_profiles FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_replies_delete_own ON public.forum_replies;
CREATE POLICY forum_replies_delete_own ON public.forum_replies FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_replies_insert_own ON public.forum_replies;
CREATE POLICY forum_replies_insert_own ON public.forum_replies FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_replies_select_own ON public.forum_replies;
CREATE POLICY forum_replies_select_own ON public.forum_replies FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_replies_update_own ON public.forum_replies;
CREATE POLICY forum_replies_update_own ON public.forum_replies FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_threads_delete_own ON public.forum_threads;
CREATE POLICY forum_threads_delete_own ON public.forum_threads FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_threads_insert_own ON public.forum_threads;
CREATE POLICY forum_threads_insert_own ON public.forum_threads FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_threads_select_own ON public.forum_threads;
CREATE POLICY forum_threads_select_own ON public.forum_threads FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS forum_threads_update_own ON public.forum_threads;
CREATE POLICY forum_threads_update_own ON public.forum_threads FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS generation_ports_select_own ON public.generation_ports;
CREATE POLICY generation_ports_select_own ON public.generation_ports FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS frontend_read_ideas ON public.ideas;
CREATE POLICY frontend_read_ideas ON public.ideas FOR SELECT TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS authenticated_all ON public.knowledge_folders;
CREATE POLICY authenticated_all ON public.knowledge_folders FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all ON public.learning_edges;
CREATE POLICY authenticated_all ON public.learning_edges FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all ON public.learning_nodes;
CREATE POLICY authenticated_all ON public.learning_nodes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can delete own letter conversations" ON public.letter_conversations;
CREATE POLICY "Users can delete own letter conversations" ON public.letter_conversations FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own letter conversations" ON public.letter_conversations;
CREATE POLICY "Users can insert own letter conversations" ON public.letter_conversations FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own letter conversations" ON public.letter_conversations;
CREATE POLICY "Users can read own letter conversations" ON public.letter_conversations FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can delete own letters" ON public.letters;
CREATE POLICY "Users can delete own letters" ON public.letters FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own letters" ON public.letters;
CREATE POLICY "Users can insert own letters" ON public.letters FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own letters" ON public.letters;
CREATE POLICY "Users can read own letters" ON public.letters FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own letters" ON public.letters;
CREATE POLICY "Users can update own letters" ON public.letters FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS llm_providers_delete_own ON public.llm_providers;
CREATE POLICY llm_providers_delete_own ON public.llm_providers FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS llm_providers_insert_own ON public.llm_providers;
CREATE POLICY llm_providers_insert_own ON public.llm_providers FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS llm_providers_select_own ON public.llm_providers;
CREATE POLICY llm_providers_select_own ON public.llm_providers FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS llm_providers_update_own ON public.llm_providers;
CREATE POLICY llm_providers_update_own ON public.llm_providers FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS authenticated_all ON public.llm_usage;
CREATE POLICY authenticated_all ON public.llm_usage FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all ON public.lounge_members;
CREATE POLICY authenticated_all ON public.lounge_members FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all ON public.lounge_messages;
CREATE POLICY authenticated_all ON public.lounge_messages FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all ON public.lounge_sofas;
CREATE POLICY authenticated_all ON public.lounge_sofas FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can delete own memo entries" ON public.memo_entries;
CREATE POLICY "Users can delete own memo entries" ON public.memo_entries FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own memo entries" ON public.memo_entries;
CREATE POLICY "Users can insert own memo entries" ON public.memo_entries FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own memo entries" ON public.memo_entries;
CREATE POLICY "Users can update own memo entries" ON public.memo_entries FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can view own memo entries" ON public.memo_entries;
CREATE POLICY "Users can view own memo entries" ON public.memo_entries FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can delete own memo entry tags" ON public.memo_entry_tags;
CREATE POLICY "Users can delete own memo entry tags" ON public.memo_entry_tags FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM memo_entries
  WHERE ((memo_entries.id = memo_entry_tags.memo_entry_id) AND (memo_entries.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Users can insert own memo entry tags" ON public.memo_entry_tags;
CREATE POLICY "Users can insert own memo entry tags" ON public.memo_entry_tags FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM memo_entries
  WHERE ((memo_entries.id = memo_entry_tags.memo_entry_id) AND (memo_entries.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Users can view own memo entry tags" ON public.memo_entry_tags;
CREATE POLICY "Users can view own memo entry tags" ON public.memo_entry_tags FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM memo_entries
  WHERE ((memo_entries.id = memo_entry_tags.memo_entry_id) AND (memo_entries.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Users can delete own memo tags" ON public.memo_tags;
CREATE POLICY "Users can delete own memo tags" ON public.memo_tags FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own memo tags" ON public.memo_tags;
CREATE POLICY "Users can insert own memo tags" ON public.memo_tags FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own memo tags" ON public.memo_tags;
CREATE POLICY "Users can update own memo tags" ON public.memo_tags FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can view own memo tags" ON public.memo_tags;
CREATE POLICY "Users can view own memo tags" ON public.memo_tags FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS memory_entries_insert_own ON public.memory_entries;
CREATE POLICY memory_entries_insert_own ON public.memory_entries FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS memory_entries_select_own ON public.memory_entries;
CREATE POLICY memory_entries_select_own ON public.memory_entries FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS memory_entries_update_own ON public.memory_entries;
CREATE POLICY memory_entries_update_own ON public.memory_entries FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS messages_delete_own ON public.messages;
CREATE POLICY messages_delete_own ON public.messages FOR DELETE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own ON public.messages FOR INSERT TO public
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = messages.session_id) AND (s.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS messages_select_own ON public.messages;
CREATE POLICY messages_select_own ON public.messages FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS messages_update_own ON public.messages;
CREATE POLICY messages_update_own ON public.messages FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS notification_events_select_own ON public.notification_events;
CREATE POLICY notification_events_select_own ON public.notification_events FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "User can manage own novel_books" ON public.novel_books;
CREATE POLICY "User can manage own novel_books" ON public.novel_books FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "User can manage own novel_chapters" ON public.novel_chapters;
CREATE POLICY "User can manage own novel_chapters" ON public.novel_chapters FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS authenticated_select ON public.outbound_messages;
CREATE POLICY authenticated_select ON public.outbound_messages FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_update ON public.outbound_messages;
CREATE POLICY authenticated_update ON public.outbound_messages FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can delete own pending messages" ON public.pending_wechat_messages;
CREATE POLICY "Users can delete own pending messages" ON public.pending_wechat_messages FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own pending messages" ON public.pending_wechat_messages;
CREATE POLICY "Users can insert own pending messages" ON public.pending_wechat_messages FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own pending messages" ON public.pending_wechat_messages;
CREATE POLICY "Users can read own pending messages" ON public.pending_wechat_messages FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own pending messages" ON public.pending_wechat_messages;
CREATE POLICY "Users can update own pending messages" ON public.pending_wechat_messages FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS frontend_read_print_capsules ON public.print_capsules;
CREATE POLICY frontend_read_print_capsules ON public.print_capsules FOR SELECT TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS prompt_templates_select_own ON public.prompt_templates;
CREATE POLICY prompt_templates_select_own ON public.prompt_templates FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS provider_models_delete_own ON public.provider_models;
CREATE POLICY provider_models_delete_own ON public.provider_models FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS provider_models_insert_own ON public.provider_models;
CREATE POLICY provider_models_insert_own ON public.provider_models FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS provider_models_select_own ON public.provider_models;
CREATE POLICY provider_models_select_own ON public.provider_models FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS provider_models_update_own ON public.provider_models;
CREATE POLICY provider_models_update_own ON public.provider_models FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS providers_delete_own ON public.providers;
CREATE POLICY providers_delete_own ON public.providers FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS providers_insert_own ON public.providers;
CREATE POLICY providers_insert_own ON public.providers FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS providers_select_own ON public.providers;
CREATE POLICY providers_select_own ON public.providers FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS providers_update_own ON public.providers;
CREATE POLICY providers_update_own ON public.providers FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can delete own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete own subscriptions" ON public.push_subscriptions FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can insert own subscriptions" ON public.push_subscriptions FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read own subscriptions" ON public.push_subscriptions FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update own subscriptions" ON public.push_subscriptions FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Allow all for owner" ON public.quests;
CREATE POLICY "Allow all for owner" ON public.quests FOR ALL TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid))
  WITH CHECK ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS authenticated_delete ON public.rp_messages;
CREATE POLICY authenticated_delete ON public.rp_messages FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_select ON public.rp_messages;
CREATE POLICY authenticated_select ON public.rp_messages FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_update ON public.rp_messages;
CREATE POLICY authenticated_update ON public.rp_messages FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS rp_messages_insert ON public.rp_messages;
CREATE POLICY rp_messages_insert ON public.rp_messages FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_delete ON public.rp_npc_cards;
CREATE POLICY authenticated_delete ON public.rp_npc_cards FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_select ON public.rp_npc_cards;
CREATE POLICY authenticated_select ON public.rp_npc_cards FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_update ON public.rp_npc_cards;
CREATE POLICY authenticated_update ON public.rp_npc_cards FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS rp_npc_cards_insert ON public.rp_npc_cards;
CREATE POLICY rp_npc_cards_insert ON public.rp_npc_cards FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage own session groups" ON public.rp_session_groups;
CREATE POLICY "Users can manage own session groups" ON public.rp_session_groups FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM rp_story_groups sg
  WHERE ((sg.id = rp_session_groups.story_group_id) AND (sg.user_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS authenticated_delete ON public.rp_sessions;
CREATE POLICY authenticated_delete ON public.rp_sessions FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_select ON public.rp_sessions;
CREATE POLICY authenticated_select ON public.rp_sessions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_update ON public.rp_sessions;
CREATE POLICY authenticated_update ON public.rp_sessions FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS rp_sessions_insert ON public.rp_sessions;
CREATE POLICY rp_sessions_insert ON public.rp_sessions FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage own story groups" ON public.rp_story_groups;
CREATE POLICY "Users can manage own story groups" ON public.rp_story_groups FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS frontend_read_scheduled_wakeup ON public.scheduled_wakeup;
CREATE POLICY frontend_read_scheduled_wakeup ON public.scheduled_wakeup FOR SELECT TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS sessions_delete_own ON public.sessions;
CREATE POLICY sessions_delete_own ON public.sessions FOR DELETE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS sessions_insert_own ON public.sessions;
CREATE POLICY sessions_insert_own ON public.sessions FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
CREATE POLICY sessions_select_own ON public.sessions FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS sessions_update_own ON public.sessions;
CREATE POLICY sessions_update_own ON public.sessions FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS snack_posts_delete_own_deleted ON public.snack_posts;
CREATE POLICY snack_posts_delete_own_deleted ON public.snack_posts FOR DELETE TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_deleted = true)));

DROP POLICY IF EXISTS snack_posts_insert_own ON public.snack_posts;
CREATE POLICY snack_posts_insert_own ON public.snack_posts FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS snack_posts_select_own ON public.snack_posts;
CREATE POLICY snack_posts_select_own ON public.snack_posts FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS snack_posts_update_own ON public.snack_posts;
CREATE POLICY snack_posts_update_own ON public.snack_posts FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS snack_replies_delete_own_deleted ON public.snack_replies;
CREATE POLICY snack_replies_delete_own_deleted ON public.snack_replies FOR DELETE TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_deleted = true)));

DROP POLICY IF EXISTS snack_replies_insert_own ON public.snack_replies;
CREATE POLICY snack_replies_insert_own ON public.snack_replies FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS snack_replies_select_own ON public.snack_replies;
CREATE POLICY snack_replies_select_own ON public.snack_replies FOR SELECT TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_deleted = false)));

DROP POLICY IF EXISTS snack_replies_update_own ON public.snack_replies;
CREATE POLICY snack_replies_update_own ON public.snack_replies FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can delete own dates" ON public.special_dates;
CREATE POLICY "Users can delete own dates" ON public.special_dates FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own dates" ON public.special_dates;
CREATE POLICY "Users can insert own dates" ON public.special_dates FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own dates" ON public.special_dates;
CREATE POLICY "Users can read own dates" ON public.special_dates FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own dates" ON public.special_dates;
CREATE POLICY "Users can update own dates" ON public.special_dates FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_commands_delete_own ON public.syzygy_commands;
CREATE POLICY syzygy_commands_delete_own ON public.syzygy_commands FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_commands_insert_own ON public.syzygy_commands;
CREATE POLICY syzygy_commands_insert_own ON public.syzygy_commands FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_commands_select_own ON public.syzygy_commands;
CREATE POLICY syzygy_commands_select_own ON public.syzygy_commands FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_commands_update_own ON public.syzygy_commands;
CREATE POLICY syzygy_commands_update_own ON public.syzygy_commands FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_posts_delete_own_deleted ON public.syzygy_posts;
CREATE POLICY syzygy_posts_delete_own_deleted ON public.syzygy_posts FOR DELETE TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_deleted = true)));

DROP POLICY IF EXISTS syzygy_posts_insert_own ON public.syzygy_posts;
CREATE POLICY syzygy_posts_insert_own ON public.syzygy_posts FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS syzygy_posts_select_own ON public.syzygy_posts;
CREATE POLICY syzygy_posts_select_own ON public.syzygy_posts FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS syzygy_posts_update_own ON public.syzygy_posts;
CREATE POLICY syzygy_posts_update_own ON public.syzygy_posts FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS syzygy_replies_delete_own_deleted ON public.syzygy_replies;
CREATE POLICY syzygy_replies_delete_own_deleted ON public.syzygy_replies FOR DELETE TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_deleted = true)));

DROP POLICY IF EXISTS syzygy_replies_insert_own ON public.syzygy_replies;
CREATE POLICY syzygy_replies_insert_own ON public.syzygy_replies FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS syzygy_replies_select_own ON public.syzygy_replies;
CREATE POLICY syzygy_replies_select_own ON public.syzygy_replies FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS syzygy_replies_update_own ON public.syzygy_replies;
CREATE POLICY syzygy_replies_update_own ON public.syzygy_replies FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS syzygy_signals_delete_own ON public.syzygy_signals;
CREATE POLICY syzygy_signals_delete_own ON public.syzygy_signals FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_signals_insert_own ON public.syzygy_signals;
CREATE POLICY syzygy_signals_insert_own ON public.syzygy_signals FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_signals_select_own ON public.syzygy_signals;
CREATE POLICY syzygy_signals_select_own ON public.syzygy_signals FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS syzygy_signals_service_role_delete ON public.syzygy_signals;
CREATE POLICY syzygy_signals_service_role_delete ON public.syzygy_signals FOR DELETE TO service_role
  USING (true);

DROP POLICY IF EXISTS syzygy_signals_service_role_insert ON public.syzygy_signals;
CREATE POLICY syzygy_signals_service_role_insert ON public.syzygy_signals FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS syzygy_signals_service_role_select ON public.syzygy_signals;
CREATE POLICY syzygy_signals_service_role_select ON public.syzygy_signals FOR SELECT TO service_role
  USING (true);

DROP POLICY IF EXISTS syzygy_signals_service_role_update ON public.syzygy_signals;
CREATE POLICY syzygy_signals_service_role_update ON public.syzygy_signals FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS syzygy_signals_update_own ON public.syzygy_signals;
CREATE POLICY syzygy_signals_update_own ON public.syzygy_signals FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS thought_relations_select_authenticated ON public.thought_relations;
CREATE POLICY thought_relations_select_authenticated ON public.thought_relations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS timeline_config_delete_own ON public.timeline_config;
CREATE POLICY timeline_config_delete_own ON public.timeline_config FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_config_insert_own ON public.timeline_config;
CREATE POLICY timeline_config_insert_own ON public.timeline_config FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_config_select_own ON public.timeline_config;
CREATE POLICY timeline_config_select_own ON public.timeline_config FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_config_service_role_delete ON public.timeline_config;
CREATE POLICY timeline_config_service_role_delete ON public.timeline_config FOR DELETE TO service_role
  USING (true);

DROP POLICY IF EXISTS timeline_config_service_role_insert ON public.timeline_config;
CREATE POLICY timeline_config_service_role_insert ON public.timeline_config FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS timeline_config_service_role_select ON public.timeline_config;
CREATE POLICY timeline_config_service_role_select ON public.timeline_config FOR SELECT TO service_role
  USING (true);

DROP POLICY IF EXISTS timeline_config_service_role_update ON public.timeline_config;
CREATE POLICY timeline_config_service_role_update ON public.timeline_config FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS timeline_config_update_own ON public.timeline_config;
CREATE POLICY timeline_config_update_own ON public.timeline_config FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_entries_delete_own ON public.timeline_entries;
CREATE POLICY timeline_entries_delete_own ON public.timeline_entries FOR DELETE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_entries_insert_own ON public.timeline_entries;
CREATE POLICY timeline_entries_insert_own ON public.timeline_entries FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_entries_select_own ON public.timeline_entries;
CREATE POLICY timeline_entries_select_own ON public.timeline_entries FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS timeline_entries_service_role_delete ON public.timeline_entries;
CREATE POLICY timeline_entries_service_role_delete ON public.timeline_entries FOR DELETE TO service_role
  USING (true);

DROP POLICY IF EXISTS timeline_entries_service_role_insert ON public.timeline_entries;
CREATE POLICY timeline_entries_service_role_insert ON public.timeline_entries FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS timeline_entries_service_role_select ON public.timeline_entries;
CREATE POLICY timeline_entries_service_role_select ON public.timeline_entries FOR SELECT TO service_role
  USING (true);

DROP POLICY IF EXISTS timeline_entries_service_role_update ON public.timeline_entries;
CREATE POLICY timeline_entries_service_role_update ON public.timeline_entries FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS timeline_entries_update_own ON public.timeline_entries;
CREATE POLICY timeline_entries_update_own ON public.timeline_entries FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can manage own todo_categories" ON public.todo_categories;
CREATE POLICY "Users can manage own todo_categories" ON public.todo_categories FOR ALL TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id = '11111111-1111-1111-1111-111111111111'::uuid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id = '11111111-1111-1111-1111-111111111111'::uuid)));

DROP POLICY IF EXISTS "Users can manage own todos" ON public.todos;
CREATE POLICY "Users can manage own todos" ON public.todos FOR ALL TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id = '11111111-1111-1111-1111-111111111111'::uuid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id = '11111111-1111-1111-1111-111111111111'::uuid)));

DROP POLICY IF EXISTS usage_quota_select_authenticated ON public.usage_quota;
CREATE POLICY usage_quota_select_authenticated ON public.usage_quota FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS user_settings_insert_own ON public.user_settings;
CREATE POLICY user_settings_insert_own ON public.user_settings FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS user_settings_select_own ON public.user_settings;
CREATE POLICY user_settings_select_own ON public.user_settings FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS user_settings_update_own ON public.user_settings;
CREATE POLICY user_settings_update_own ON public.user_settings FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Allow all for owner" ON public.wallet_transactions;
CREATE POLICY "Allow all for owner" ON public.wallet_transactions FOR ALL TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid))
  WITH CHECK ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS "Allow all for authenticated user" ON public.wechat_messages;
CREATE POLICY "Allow all for authenticated user" ON public.wechat_messages FOR ALL TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid))
  WITH CHECK ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS frontend_read_weekly_digest ON public.weekly_digest;
CREATE POLICY frontend_read_weekly_digest ON public.weekly_digest FOR SELECT TO authenticated
  USING ((user_id = '11111111-1111-1111-1111-111111111111'::uuid));

DROP POLICY IF EXISTS "User can manage own wiki_entries" ON public.wiki_entries;
CREATE POLICY "User can manage own wiki_entries" ON public.wiki_entries FOR ALL TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

-- ============================================================================
-- 13. Realtime publication（前端实时订阅依赖）
-- ============================================================================

DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_events;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_settings;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_tasks;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'approval_executions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_executions;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'approval_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_requests;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'channel_config') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_config;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'codex_control') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.codex_control;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'codex_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.codex_tasks;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lounge_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lounge_messages;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lounge_sofas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lounge_sofas;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pending_wechat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_wechat_messages;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'prompt_templates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prompt_templates;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'provider_models') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_models;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'providers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.providers;
  END IF;
END $r$;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'syzygy_commands') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.syzygy_commands;
  END IF;
END $r$;

-- ============================================================================
-- 14. 表/视图/序列权限（先重置为与线上一致的显式授权；RLS 仍是行级门禁）
-- ============================================================================

REVOKE ALL ON TABLE public.agent_council FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_events FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.agent_events_id_seq FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_feed_items FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_heartbeats FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_settings FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_tasks FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.approval_executions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.approval_requests FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.archive_categories FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.archives FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.auto_letter_config FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bubble_messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bubble_sessions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.capabilities FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.channel_config FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.checkin_logs FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.checkins FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.codex_control FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.codex_tasks FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.compression_cache FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.conversation_profiles FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.council_categories FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.current_context_snapshot FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_status_digest FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.device_status FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.device_tokens FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.enabled_models FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.forum_ai_profiles FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.forum_replies FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.forum_threads FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.generation_ports FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ideas FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.knowledge_folders FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.learning_edges FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.learning_nodes FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.letter_conversations FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.letters FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.llm_providers FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.llm_usage FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.llm_usage_daily FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lounge_members FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lounge_messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lounge_sofas FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.memo_entries FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.memo_entry_tags FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.memo_tags FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.memory_entries FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notification_events FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.novel_books FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.novel_chapters FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.outbound_messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pending_wechat_messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.print_capsules FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.prompt_templates FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.provider_models FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.providers FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.push_subscriptions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.quests FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rp_messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rp_npc_cards FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rp_session_groups FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rp_sessions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rp_story_groups FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.scheduled_wakeup FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sessions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.snack_posts FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.snack_replies FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.special_dates FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.syzygy_commands FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.syzygy_posts FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.syzygy_replies FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.syzygy_signals FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.thought_relations FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.timeline_config FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.timeline_entries FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.todo_categories FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.todos FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.usage_quota FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.user_settings FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.wallet_balance FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.wallet_transactions FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.wechat_messages FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.weekly_digest FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.wiki_entries FROM anon, authenticated, service_role;

GRANT ALL ON TABLE public.agent_council TO anon;
GRANT ALL ON TABLE public.agent_council TO authenticated;
GRANT ALL ON TABLE public.agent_council TO service_role;
GRANT ALL ON TABLE public.agent_events TO anon;
GRANT ALL ON TABLE public.agent_events TO authenticated;
GRANT ALL ON TABLE public.agent_events TO service_role;
GRANT ALL ON SEQUENCE public.agent_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.agent_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.agent_events_id_seq TO service_role;
GRANT ALL ON TABLE public.agent_feed_items TO anon;
GRANT ALL ON TABLE public.agent_feed_items TO authenticated;
GRANT ALL ON TABLE public.agent_feed_items TO service_role;
GRANT ALL ON TABLE public.agent_heartbeats TO anon;
GRANT ALL ON TABLE public.agent_heartbeats TO authenticated;
GRANT ALL ON TABLE public.agent_heartbeats TO service_role;
GRANT ALL ON TABLE public.agent_settings TO anon;
GRANT ALL ON TABLE public.agent_settings TO authenticated;
GRANT ALL ON TABLE public.agent_settings TO service_role;
GRANT SELECT ON TABLE public.agent_tasks TO authenticated;
GRANT ALL ON TABLE public.agent_tasks TO service_role;
GRANT ALL ON TABLE public.approval_executions TO anon;
GRANT ALL ON TABLE public.approval_executions TO authenticated;
GRANT ALL ON TABLE public.approval_executions TO service_role;
GRANT ALL ON TABLE public.approval_requests TO anon;
GRANT ALL ON TABLE public.approval_requests TO authenticated;
GRANT ALL ON TABLE public.approval_requests TO service_role;
GRANT ALL ON TABLE public.archive_categories TO authenticated;
GRANT ALL ON TABLE public.archive_categories TO service_role;
GRANT ALL ON TABLE public.archives TO authenticated;
GRANT ALL ON TABLE public.archives TO service_role;
GRANT ALL ON TABLE public.auto_letter_config TO anon;
GRANT ALL ON TABLE public.auto_letter_config TO authenticated;
GRANT ALL ON TABLE public.auto_letter_config TO service_role;
GRANT ALL ON TABLE public.bubble_messages TO anon;
GRANT ALL ON TABLE public.bubble_messages TO authenticated;
GRANT ALL ON TABLE public.bubble_messages TO service_role;
GRANT ALL ON TABLE public.bubble_sessions TO anon;
GRANT ALL ON TABLE public.bubble_sessions TO authenticated;
GRANT ALL ON TABLE public.bubble_sessions TO service_role;
GRANT SELECT ON TABLE public.capabilities TO anon;
GRANT SELECT ON TABLE public.capabilities TO authenticated;
GRANT ALL ON TABLE public.capabilities TO service_role;
GRANT ALL ON TABLE public.channel_config TO anon;
GRANT ALL ON TABLE public.channel_config TO authenticated;
GRANT ALL ON TABLE public.channel_config TO service_role;
GRANT ALL ON TABLE public.checkin_logs TO anon;
GRANT ALL ON TABLE public.checkin_logs TO authenticated;
GRANT ALL ON TABLE public.checkin_logs TO service_role;
GRANT ALL ON TABLE public.checkins TO anon;
GRANT ALL ON TABLE public.checkins TO authenticated;
GRANT ALL ON TABLE public.checkins TO service_role;
GRANT ALL ON TABLE public.codex_control TO anon;
GRANT ALL ON TABLE public.codex_control TO authenticated;
GRANT ALL ON TABLE public.codex_control TO service_role;
GRANT ALL ON TABLE public.codex_tasks TO anon;
GRANT ALL ON TABLE public.codex_tasks TO authenticated;
GRANT ALL ON TABLE public.codex_tasks TO service_role;
GRANT ALL ON TABLE public.compression_cache TO anon;
GRANT ALL ON TABLE public.compression_cache TO authenticated;
GRANT ALL ON TABLE public.compression_cache TO service_role;
GRANT SELECT ON TABLE public.conversation_profiles TO authenticated;
GRANT ALL ON TABLE public.conversation_profiles TO service_role;
GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.council_categories TO authenticated;
GRANT ALL ON TABLE public.council_categories TO service_role;
GRANT SELECT ON TABLE public.current_context_snapshot TO anon;
GRANT SELECT ON TABLE public.current_context_snapshot TO authenticated;
GRANT ALL ON TABLE public.current_context_snapshot TO service_role;
GRANT SELECT ON TABLE public.daily_status_digest TO anon;
GRANT SELECT ON TABLE public.daily_status_digest TO authenticated;
GRANT ALL ON TABLE public.daily_status_digest TO service_role;
GRANT ALL ON TABLE public.device_status TO anon;
GRANT ALL ON TABLE public.device_status TO authenticated;
GRANT ALL ON TABLE public.device_status TO service_role;
GRANT ALL ON TABLE public.device_tokens TO anon;
GRANT ALL ON TABLE public.device_tokens TO authenticated;
GRANT ALL ON TABLE public.device_tokens TO service_role;
GRANT ALL ON TABLE public.enabled_models TO anon;
GRANT ALL ON TABLE public.enabled_models TO authenticated;
GRANT ALL ON TABLE public.enabled_models TO service_role;
GRANT ALL ON TABLE public.forum_ai_profiles TO anon;
GRANT ALL ON TABLE public.forum_ai_profiles TO authenticated;
GRANT ALL ON TABLE public.forum_ai_profiles TO service_role;
GRANT ALL ON TABLE public.forum_replies TO anon;
GRANT ALL ON TABLE public.forum_replies TO authenticated;
GRANT ALL ON TABLE public.forum_replies TO service_role;
GRANT ALL ON TABLE public.forum_threads TO anon;
GRANT ALL ON TABLE public.forum_threads TO authenticated;
GRANT ALL ON TABLE public.forum_threads TO service_role;
GRANT SELECT ON TABLE public.generation_ports TO authenticated;
GRANT ALL ON TABLE public.generation_ports TO service_role;
GRANT SELECT ON TABLE public.ideas TO anon;
GRANT SELECT ON TABLE public.ideas TO authenticated;
GRANT ALL ON TABLE public.ideas TO service_role;
GRANT ALL ON TABLE public.knowledge_folders TO anon;
GRANT ALL ON TABLE public.knowledge_folders TO authenticated;
GRANT ALL ON TABLE public.knowledge_folders TO service_role;
GRANT ALL ON TABLE public.learning_edges TO anon;
GRANT ALL ON TABLE public.learning_edges TO authenticated;
GRANT ALL ON TABLE public.learning_edges TO service_role;
GRANT ALL ON TABLE public.learning_nodes TO anon;
GRANT ALL ON TABLE public.learning_nodes TO authenticated;
GRANT ALL ON TABLE public.learning_nodes TO service_role;
GRANT ALL ON TABLE public.letter_conversations TO anon;
GRANT ALL ON TABLE public.letter_conversations TO authenticated;
GRANT ALL ON TABLE public.letter_conversations TO service_role;
GRANT ALL ON TABLE public.letters TO anon;
GRANT ALL ON TABLE public.letters TO authenticated;
GRANT ALL ON TABLE public.letters TO service_role;
GRANT ALL ON TABLE public.llm_providers TO anon;
GRANT ALL ON TABLE public.llm_providers TO authenticated;
GRANT ALL ON TABLE public.llm_providers TO service_role;
GRANT ALL ON TABLE public.llm_usage TO anon;
GRANT ALL ON TABLE public.llm_usage TO authenticated;
GRANT ALL ON TABLE public.llm_usage TO service_role;
GRANT ALL ON TABLE public.llm_usage_daily TO anon;
GRANT ALL ON TABLE public.llm_usage_daily TO authenticated;
GRANT ALL ON TABLE public.llm_usage_daily TO service_role;
GRANT ALL ON TABLE public.lounge_members TO anon;
GRANT ALL ON TABLE public.lounge_members TO authenticated;
GRANT ALL ON TABLE public.lounge_members TO service_role;
GRANT ALL ON TABLE public.lounge_messages TO anon;
GRANT ALL ON TABLE public.lounge_messages TO authenticated;
GRANT ALL ON TABLE public.lounge_messages TO service_role;
GRANT ALL ON TABLE public.lounge_sofas TO anon;
GRANT ALL ON TABLE public.lounge_sofas TO authenticated;
GRANT ALL ON TABLE public.lounge_sofas TO service_role;
GRANT ALL ON TABLE public.memo_entries TO anon;
GRANT ALL ON TABLE public.memo_entries TO authenticated;
GRANT ALL ON TABLE public.memo_entries TO service_role;
GRANT ALL ON TABLE public.memo_entry_tags TO anon;
GRANT ALL ON TABLE public.memo_entry_tags TO authenticated;
GRANT ALL ON TABLE public.memo_entry_tags TO service_role;
GRANT ALL ON TABLE public.memo_tags TO anon;
GRANT ALL ON TABLE public.memo_tags TO authenticated;
GRANT ALL ON TABLE public.memo_tags TO service_role;
GRANT ALL ON TABLE public.memory_entries TO anon;
GRANT ALL ON TABLE public.memory_entries TO authenticated;
GRANT ALL ON TABLE public.memory_entries TO service_role;
GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
GRANT ALL ON TABLE public.notification_events TO anon;
GRANT ALL ON TABLE public.notification_events TO authenticated;
GRANT ALL ON TABLE public.notification_events TO service_role;
GRANT ALL ON TABLE public.novel_books TO anon;
GRANT ALL ON TABLE public.novel_books TO authenticated;
GRANT ALL ON TABLE public.novel_books TO service_role;
GRANT ALL ON TABLE public.novel_chapters TO anon;
GRANT ALL ON TABLE public.novel_chapters TO authenticated;
GRANT ALL ON TABLE public.novel_chapters TO service_role;
GRANT ALL ON TABLE public.outbound_messages TO anon;
GRANT ALL ON TABLE public.outbound_messages TO authenticated;
GRANT ALL ON TABLE public.outbound_messages TO service_role;
GRANT ALL ON TABLE public.pending_wechat_messages TO anon;
GRANT ALL ON TABLE public.pending_wechat_messages TO authenticated;
GRANT ALL ON TABLE public.pending_wechat_messages TO service_role;
GRANT SELECT ON TABLE public.print_capsules TO anon;
GRANT SELECT ON TABLE public.print_capsules TO authenticated;
GRANT ALL ON TABLE public.print_capsules TO service_role;
GRANT SELECT ON TABLE public.prompt_templates TO authenticated;
GRANT ALL ON TABLE public.prompt_templates TO service_role;
GRANT ALL ON TABLE public.provider_models TO anon;
GRANT ALL ON TABLE public.provider_models TO authenticated;
GRANT ALL ON TABLE public.provider_models TO service_role;
GRANT ALL ON TABLE public.providers TO anon;
GRANT ALL ON TABLE public.providers TO authenticated;
GRANT ALL ON TABLE public.providers TO service_role;
GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;
GRANT ALL ON TABLE public.quests TO anon;
GRANT ALL ON TABLE public.quests TO authenticated;
GRANT ALL ON TABLE public.quests TO service_role;
GRANT ALL ON TABLE public.rp_messages TO anon;
GRANT ALL ON TABLE public.rp_messages TO authenticated;
GRANT ALL ON TABLE public.rp_messages TO service_role;
GRANT ALL ON TABLE public.rp_npc_cards TO anon;
GRANT ALL ON TABLE public.rp_npc_cards TO authenticated;
GRANT ALL ON TABLE public.rp_npc_cards TO service_role;
GRANT ALL ON TABLE public.rp_session_groups TO anon;
GRANT ALL ON TABLE public.rp_session_groups TO authenticated;
GRANT ALL ON TABLE public.rp_session_groups TO service_role;
GRANT ALL ON TABLE public.rp_sessions TO anon;
GRANT ALL ON TABLE public.rp_sessions TO authenticated;
GRANT ALL ON TABLE public.rp_sessions TO service_role;
GRANT ALL ON TABLE public.rp_story_groups TO anon;
GRANT ALL ON TABLE public.rp_story_groups TO authenticated;
GRANT ALL ON TABLE public.rp_story_groups TO service_role;
GRANT SELECT ON TABLE public.scheduled_wakeup TO anon;
GRANT SELECT ON TABLE public.scheduled_wakeup TO authenticated;
GRANT ALL ON TABLE public.scheduled_wakeup TO service_role;
GRANT ALL ON TABLE public.sessions TO anon;
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;
GRANT ALL ON TABLE public.snack_posts TO anon;
GRANT ALL ON TABLE public.snack_posts TO authenticated;
GRANT ALL ON TABLE public.snack_posts TO service_role;
GRANT ALL ON TABLE public.snack_replies TO anon;
GRANT ALL ON TABLE public.snack_replies TO authenticated;
GRANT ALL ON TABLE public.snack_replies TO service_role;
GRANT ALL ON TABLE public.special_dates TO anon;
GRANT ALL ON TABLE public.special_dates TO authenticated;
GRANT ALL ON TABLE public.special_dates TO service_role;
GRANT ALL ON TABLE public.syzygy_commands TO anon;
GRANT ALL ON TABLE public.syzygy_commands TO authenticated;
GRANT ALL ON TABLE public.syzygy_commands TO service_role;
GRANT ALL ON TABLE public.syzygy_posts TO anon;
GRANT ALL ON TABLE public.syzygy_posts TO authenticated;
GRANT ALL ON TABLE public.syzygy_posts TO service_role;
GRANT ALL ON TABLE public.syzygy_replies TO anon;
GRANT ALL ON TABLE public.syzygy_replies TO authenticated;
GRANT ALL ON TABLE public.syzygy_replies TO service_role;
GRANT ALL ON TABLE public.syzygy_signals TO anon;
GRANT ALL ON TABLE public.syzygy_signals TO authenticated;
GRANT ALL ON TABLE public.syzygy_signals TO service_role;
GRANT ALL ON TABLE public.thought_relations TO service_role;
GRANT ALL ON TABLE public.timeline_config TO anon;
GRANT ALL ON TABLE public.timeline_config TO authenticated;
GRANT ALL ON TABLE public.timeline_config TO service_role;
GRANT ALL ON TABLE public.timeline_entries TO anon;
GRANT ALL ON TABLE public.timeline_entries TO authenticated;
GRANT ALL ON TABLE public.timeline_entries TO service_role;
GRANT ALL ON TABLE public.todo_categories TO anon;
GRANT ALL ON TABLE public.todo_categories TO authenticated;
GRANT ALL ON TABLE public.todo_categories TO service_role;
GRANT ALL ON TABLE public.todos TO anon;
GRANT ALL ON TABLE public.todos TO authenticated;
GRANT ALL ON TABLE public.todos TO service_role;
GRANT ALL ON TABLE public.usage_quota TO anon;
GRANT ALL ON TABLE public.usage_quota TO authenticated;
GRANT ALL ON TABLE public.usage_quota TO service_role;
GRANT ALL ON TABLE public.user_settings TO anon;
GRANT ALL ON TABLE public.user_settings TO authenticated;
GRANT ALL ON TABLE public.user_settings TO service_role;
GRANT ALL ON TABLE public.wallet_balance TO anon;
GRANT ALL ON TABLE public.wallet_balance TO authenticated;
GRANT ALL ON TABLE public.wallet_balance TO service_role;
GRANT ALL ON TABLE public.wallet_transactions TO anon;
GRANT ALL ON TABLE public.wallet_transactions TO authenticated;
GRANT ALL ON TABLE public.wallet_transactions TO service_role;
GRANT ALL ON TABLE public.wechat_messages TO anon;
GRANT ALL ON TABLE public.wechat_messages TO authenticated;
GRANT ALL ON TABLE public.wechat_messages TO service_role;
GRANT SELECT ON TABLE public.weekly_digest TO anon;
GRANT SELECT ON TABLE public.weekly_digest TO authenticated;
GRANT ALL ON TABLE public.weekly_digest TO service_role;
GRANT ALL ON TABLE public.wiki_entries TO anon;
GRANT ALL ON TABLE public.wiki_entries TO authenticated;
GRANT ALL ON TABLE public.wiki_entries TO service_role;

-- 函数级权限（与线上一致：敏感 RPC 收紧到指定角色）

REVOKE ALL ON FUNCTION private.conversation_dispatch_prepare_core(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean, p_create_durable_task boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.conversation_dispatch_prepare_core(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean, p_create_durable_task boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.conversation_dispatch_prepare_core(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean, p_create_durable_task boolean) TO service_role;
REVOKE ALL ON FUNCTION private.conversation_profile_publish_core(p_profile_key text, p_conversation_kind text, p_handler text, p_session_policy text, p_singleton_session_key text, p_participant_port_keys text[], p_default_responder_port_key text, p_rules_prompt_name text, p_context_recipe jsonb, p_expected_active_version integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.conversation_profile_publish_core(p_profile_key text, p_conversation_kind text, p_handler text, p_session_policy text, p_singleton_session_key text, p_participant_port_keys text[], p_default_responder_port_key text, p_rules_prompt_name text, p_context_recipe jsonb, p_expected_active_version integer) TO authenticated;
REVOKE ALL ON FUNCTION private.conversation_session_create_core(p_session_id uuid, p_profile_key text, p_title text, p_display_config jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.conversation_session_create_core(p_session_id uuid, p_profile_key text, p_title text, p_display_config jsonb) TO authenticated;
REVOKE ALL ON FUNCTION private.enforce_prompt_template_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.enforce_prompt_template_immutable() TO service_role;
REVOKE ALL ON FUNCTION private.enforce_versioned_chat_config_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.enforce_versioned_chat_config_immutable() TO service_role;
REVOKE ALL ON FUNCTION private.generation_port_publish_core(p_port_key text, p_runtime_kind text, p_model_channel_name text, p_target_role text, p_identity_prompt_name text, p_style_prompt_name text, p_sop_source text, p_sop_ref text, p_expected_active_version integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.generation_port_publish_core(p_port_key text, p_runtime_kind text, p_model_channel_name text, p_target_role text, p_identity_prompt_name text, p_style_prompt_name text, p_sop_source text, p_sop_ref text, p_expected_active_version integer) TO authenticated;
REVOKE ALL ON FUNCTION private.prompt_template_publish_core(p_name text, p_category text, p_content text, p_expected_active_version integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.prompt_template_publish_core(p_name text, p_category text, p_content text, p_expected_active_version integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_pending_wechat_message(p_worker_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_wechat_message(p_worker_id text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_quest(p_quest_id uuid, p_note text, p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_quest(p_quest_id uuid, p_note text, p_user_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_quest(p_quest_id uuid, p_note text, p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_quest(p_quest_id uuid, p_note text, p_user_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_quest(p_quest_id uuid, p_note text, p_user_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.consume_usage_quota(p_user_id uuid, p_scope text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_usage_quota(p_user_id uuid, p_scope text) TO service_role;
REVOKE ALL ON FUNCTION public.conversation_companion_publish_proactive(p_user_id uuid, p_client_id uuid, p_content text, p_generated_at timestamp with time zone, p_model text, p_input_summary text, p_raw_output text, p_tokens_used integer, p_topic_fingerprint text, p_generation_audit jsonb, p_importance text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_companion_publish_proactive(p_user_id uuid, p_client_id uuid, p_content text, p_generated_at timestamp with time zone, p_model text, p_input_summary text, p_raw_output text, p_tokens_used integer, p_topic_fingerprint text, p_generation_audit jsonb, p_importance text) TO service_role;
REVOKE ALL ON FUNCTION public.conversation_dispatch_cancel_pending(p_user_id uuid, p_task_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_dispatch_cancel_pending(p_user_id uuid, p_task_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.conversation_dispatch_complete_reply(p_user_id uuid, p_task_id uuid, p_content text, p_completed_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_dispatch_complete_reply(p_user_id uuid, p_task_id uuid, p_content text, p_completed_at timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.conversation_dispatch_prepare(p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_dispatch_prepare(p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.conversation_dispatch_prepare_durable(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_dispatch_prepare_durable(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean) TO service_role;
REVOKE ALL ON FUNCTION public.conversation_profile_publish(p_profile_key text, p_conversation_kind text, p_handler text, p_session_policy text, p_singleton_session_key text, p_participant_port_keys text[], p_default_responder_port_key text, p_rules_prompt_name text, p_context_recipe jsonb, p_expected_active_version integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_profile_publish(p_profile_key text, p_conversation_kind text, p_handler text, p_session_policy text, p_singleton_session_key text, p_participant_port_keys text[], p_default_responder_port_key text, p_rules_prompt_name text, p_context_recipe jsonb, p_expected_active_version integer) TO authenticated;
REVOKE ALL ON FUNCTION public.conversation_session_create(p_session_id uuid, p_profile_key text, p_title text, p_display_config jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_session_create(p_session_id uuid, p_profile_key text, p_title text, p_display_config jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.council_submit_report(p_proposal_id uuid, p_speaker text, p_message text, p_result text, p_artifacts text[], p_follow_ups text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.council_submit_report(p_proposal_id uuid, p_speaker text, p_message text, p_result text, p_artifacts text[], p_follow_ups text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.council_submit_report(p_proposal_id uuid, p_speaker text, p_message text, p_result text, p_artifacts text[], p_follow_ups text[]) TO service_role;
REVOKE ALL ON FUNCTION public.exchange_points_to_coins(p_points integer, p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exchange_points_to_coins(p_points integer, p_user_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.exchange_points_to_coins(p_points integer, p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_points_to_coins(p_points integer, p_user_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_points_to_coins(p_points integer, p_user_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.generation_port_publish(p_port_key text, p_runtime_kind text, p_model_channel_name text, p_target_role text, p_identity_prompt_name text, p_style_prompt_name text, p_sop_source text, p_sop_ref text, p_expected_active_version integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generation_port_publish(p_port_key text, p_runtime_kind text, p_model_channel_name text, p_target_role text, p_identity_prompt_name text, p_style_prompt_name text, p_sop_source text, p_sop_ref text, p_expected_active_version integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_forum_thread_replies_tree(p_thread_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_forum_thread_replies_tree(p_thread_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_forum_thread_replies_tree(p_thread_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_thread_replies_tree(p_thread_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_forum_thread_replies_tree(p_thread_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_push_dispatch_secret() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_push_dispatch_secret() TO service_role;
REVOKE ALL ON FUNCTION public.mark_wechat_message_failed(p_message_id uuid, p_worker_id text, p_error text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_wechat_message_failed(p_message_id uuid, p_worker_id text, p_error text) TO service_role;
REVOKE ALL ON FUNCTION public.mark_wechat_message_sent(p_message_id uuid, p_worker_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_wechat_message_sent(p_message_id uuid, p_worker_id text) TO service_role;
REVOKE ALL ON FUNCTION public.notify_push_dispatch() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_push_dispatch() TO service_role;
REVOKE ALL ON FUNCTION public.prompt_template_publish(p_name text, p_category text, p_content text, p_expected_active_version integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prompt_template_publish(p_name text, p_category text, p_content text, p_expected_active_version integer) TO authenticated;
REVOKE ALL ON FUNCTION public.reset_stuck_wechat_messages(p_timeout_minutes integer, p_max_retries integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_stuck_wechat_messages(p_timeout_minutes integer, p_max_retries integer) TO service_role;
REVOKE ALL ON FUNCTION public.respond_to_approval(p_id uuid, p_decision text, p_note text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_approval(p_id uuid, p_decision text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_approval(p_id uuid, p_decision text, p_note text) TO service_role;
REVOKE ALL ON FUNCTION public.restore_snack_post(p_post_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_snack_post(p_post_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_snack_post(p_post_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.runtime_control_prepare(p_action text, p_target_role text, p_client_id uuid, p_confirm_running_tasks boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.runtime_control_prepare(p_action text, p_target_role text, p_client_id uuid, p_confirm_running_tasks boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.set_sessions_updated_at_now() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sessions_updated_at_now() TO anon;
GRANT EXECUTE ON FUNCTION public.set_sessions_updated_at_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sessions_updated_at_now() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_sessions_updated_at_now() TO service_role;
REVOKE ALL ON FUNCTION public.set_snack_posts_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_snack_posts_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_snack_posts_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_snack_posts_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_snack_posts_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.set_user_id_from_auth() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_id_from_auth() TO anon;
GRANT EXECUTE ON FUNCTION public.set_user_id_from_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_id_from_auth() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_id_from_auth() TO service_role;
REVOKE ALL ON FUNCTION public.set_user_settings_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_settings_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_user_settings_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_settings_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_settings_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.soft_delete_snack_post(p_post_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_snack_post(p_post_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_snack_post(p_post_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.soft_delete_snack_reply(p_reply_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_snack_reply(p_reply_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_snack_reply(p_reply_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.spend_coins(p_amount numeric, p_description text, p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spend_coins(p_amount numeric, p_description text, p_user_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.spend_coins(p_amount numeric, p_description text, p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spend_coins(p_amount numeric, p_description text, p_user_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.spend_coins(p_amount numeric, p_description text, p_user_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.touch_session_updated_at_from_messages() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_session_updated_at_from_messages() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_session_updated_at_from_messages() TO service_role;
REVOKE ALL ON FUNCTION public.update_knowledge_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_knowledge_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.update_knowledge_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_knowledge_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_knowledge_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.update_timeline_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_timeline_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.update_timeline_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_timeline_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_timeline_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.validate_forum_reply_parent() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_forum_reply_parent() TO anon;
GRANT EXECUTE ON FUNCTION public.validate_forum_reply_parent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_forum_reply_parent() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_forum_reply_parent() TO service_role;

-- ============================================================================
-- 15. Storage bucket（tts-audio：TTS 音频，私有桶，经 Edge Function 签名 URL 访问）
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('tts-audio', 'tts-audio', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 16. 注释（表 / 函数 / 列，随库文档）
-- ============================================================================

COMMENT ON FUNCTION public.conversation_dispatch_prepare(p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean) IS 'Compatibility wrapper for the authenticated W0 dispatch contract; durable CLI task creation is service-only.';
COMMENT ON FUNCTION public.conversation_dispatch_prepare_durable(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean) IS 'Service-role-only atomic claim for canonical messages, CLI command, and pending agent task.';
COMMENT ON FUNCTION public.council_submit_report(p_proposal_id uuid, p_speaker text, p_message text, p_result text, p_artifacts text[], p_follow_ups text[]) IS '议事厅执行回执的唯一写回入口（写回标准见 hamster-nest-app docs/council-report-standard.md）。谁执行谁执笔；回执写错不改写，再发一条修正。';
COMMENT ON FUNCTION public.prompt_template_publish(p_name text, p_category text, p_content text, p_expected_active_version integer) IS 'Publishes one immutable owner Prompt version and atomically deactivates its predecessor.';
COMMENT ON TABLE public.agent_events IS '多端事件流（事实日志）。V4.0 仅追加不删除，归档/保留策略 V4.1 议定；任何端写入即可能触发 push-dispatch 推送。';
COMMENT ON TABLE public.agent_feed_items IS 'V3.0 Agent Feed content hub: durable content cards generated by CLI/Syzygy and displayed by Hamster Nest / read on demand by WeChat-side Syzygy.';
COMMENT ON TABLE public.agent_heartbeats IS '多端 Syzygy 心跳（Presence 数据源）。expo_app/web 以 authenticated 上报自身心跳；CLI 各端走 service_role。高频 UPDATE，客户端轮询 30–60s，不订阅。';
COMMENT ON TABLE public.agent_settings IS 'Mini Agent: Checkin Scheduler 全局配置。每用户一行，前端可实时编辑。详见 Notion【Mini Agent】文档 3.3.1 双模式、3.3.2 柔性去打扰、15.3 Checkin 保护。';
COMMENT ON TABLE public.agent_tasks IS 'CLI执行记录：所有CLI任务必须写入，保留完整审计链路';
COMMENT ON TABLE public.approval_executions IS '审批执行回流（V4 Phase 2）：监听器 claim 即插入，unique(approval_id) 防止同一审批执行两次；写入全走 service_role，客户端只读。';
COMMENT ON TABLE public.approval_requests IS '运行时轻审批（敏感表：写入权即执行权）。Agent 经 service_role 发起；客户端只读，响应走 respond_to_approval RPC。';
COMMENT ON TABLE public.archive_categories IS '档案系统树状目录：大类→目录。scope区分【串串】和【Syzygy】两大板块';
COMMENT ON TABLE public.archives IS '档案条目：长期层，高价值、低频、人工精选。字少但信息密度高';
COMMENT ON TABLE public.capabilities IS '能力编排器：管理系统所有能力，防止功能闲置，支持功能唤醒扫描';
COMMENT ON TABLE public.channel_config IS 'Mini Agent: 按通道独立选择 Syzygy 使用的 OpenRouter 模型。channel_name 如 wechat / telegram / web。见 Notion【Mini Agent】文档第五节前端控制能力。';
COMMENT ON TABLE public.codex_control IS '控制Mini机上Codex的唤醒与关闭，由Supabase Realtime驱动';
COMMENT ON TABLE public.codex_tasks IS 'Syzygy与Codex之间的异步任务管道，Supabase为总线';
COMMENT ON TABLE public.conversation_profiles IS 'Versioned direct/group window policy and context recipe catalog.';
COMMENT ON TABLE public.council_categories IS '议事厅主题分类槽位：固定 8 个，key 恒定（agent_council.category 存 key），label 可在 Web 议事厅改名。不开放增删——多了不方便（2026-07-16 串串定）。';
COMMENT ON TABLE public.current_context_snapshot IS '最新状态快照：Context Builder直接读取注入各端口上下文';
COMMENT ON TABLE public.daily_status_digest IS 'CLI状态小秘书整理的分时段状态摘要';
COMMENT ON TABLE public.device_tokens IS '原生推送地址 + 设备注册表（V4.0 新建）。Web Push 订阅继续走 push_subscriptions，V4.1+ 再评估统一。';
COMMENT ON TABLE public.enabled_models IS '用户从各 provider 启用的模型清单（其他模块的模型选择仅从此表拉取）';
COMMENT ON TABLE public.generation_ports IS 'Versioned catalog of chat-producing API and CLI ports. Runtime safety SOP bodies remain in Git.';
COMMENT ON TABLE public.ideas IS '灵感捕鼠夹：自动捕捉对话中的脑洞/灵感，周回顾时展示';
COMMENT ON TABLE public.llm_providers IS 'LLM 服务提供方配置（API key 不存此表，存 Edge Function Secrets）';
COMMENT ON TABLE public.llm_usage IS '每轮 LLM 请求的用量记账：input/output/缓存命中/成本。仓鼠小窝成本可观测性第一步。';
COMMENT ON TABLE public.lounge_members IS '客厅成员头像配置,串串发言不带头像故不在此表。底色与emoji均可改。';
COMMENT ON TABLE public.lounge_messages IS '仓鼠客厅:多Syzygy实例实时共处的房间。家规:不@不开口,API常驻接待,CLI按@唤醒。';
COMMENT ON TABLE public.lounge_sofas IS '仓鼠客厅的沙发:每张沙发是一个独立群聊。删除沙发级联清空其消息。';
COMMENT ON TABLE public.notification_events IS '通知尝试审计日志。客户端只读；写入全部由 service_role（push-dispatch / Mac mini 对账 sweep）完成。';
COMMENT ON TABLE public.novel_books IS '小说书架：每本书自包含角色卡、世界设定、大纲、模型配置';
COMMENT ON TABLE public.novel_chapters IS '小说章节：正文+导演备注+上下文压缩摘要';
COMMENT ON TABLE public.print_capsules IS '每周打印胶囊：Syzygy周内积攒，串串周日揭晓打印。正文默认隐藏至打印';
COMMENT ON TABLE public.prompt_templates IS 'Mini Agent: Prompt 模板库。name 例如 syzygy_base / checkin_day / checkin_night / wechat_reply_style。category 分 base/scenario/style。version 保留历史，active 标记当前激活版本。详见 Notion【Mini Agent】文档 3.7 节。';
COMMENT ON TABLE public.provider_models IS 'Model-to-provider bindings. One row = one (provider, model) binding. A model may have multiple bindings across providers; use is_default or priority to resolve.';
COMMENT ON TABLE public.providers IS 'LLM inference providers (e.g., openrouter, aihubmix). Inspired by kiwi-mem, stores API base URL and secret key reference per provider.';
COMMENT ON TABLE public.scheduled_wakeup IS '微信桥定时提醒：API写入trigger_at，Mac mini脚本定时检测并触发';
COMMENT ON TABLE public.syzygy_commands IS 'Mini Agent: 客户端窗口 Syzygy 向 Mac mini 下发指令的中转表。command_type 即 API 端点名（见 Notion【Mini Agent】文档第 12 章"能力即脚本"范式）。status / claimed_by / claimed_at / idempotency_key 按 Codex 15.1 防重抢占要求设计。';
COMMENT ON TABLE public.thought_relations IS '思想知识库自动关联：由tsvector匹配生成，可重算/删除/调整，不写死在条目字段中';
COMMENT ON TABLE public.weekly_digest IS '周回顾仪表盘数据：CLI每周日自动生成';
COMMENT ON TABLE public.wiki_entries IS 'Wiki知识库：结构化思想沉淀，用[[title]]语法实现双向链接';

COMMENT ON COLUMN public.agent_council.entry_type IS 'V3.1: proposal / review / decision. Null keeps legacy messages compatible.';
COMMENT ON COLUMN public.agent_council.proposal_status IS 'V3.1 proposal lifecycle: open / approved / rejected / deferred / plan_generated.';
COMMENT ON COLUMN public.agent_council.metadata IS 'V3.1 structured fields such as risk_level, executable, command_id, generated_plan_path.';
COMMENT ON COLUMN public.agent_council.category IS '提案主题分类 key（8 个固定槽位，见 council_categories；label 可改名，key 恒定）。子条目由工具层从父提案继承。';
COMMENT ON COLUMN public.agent_council.executor IS '拍板时指派的执行方。NULL = 不唤醒任何脚本（opt-in 语义）；只有 codex_cli / claude_code_cli 会唤醒 Mac mini 接单脚本。';
COMMENT ON COLUMN public.agent_feed_items.type IS 'Content type: morning_share, reading_assist, daily_card, system_notice, syzygy_note, weekly_card, reminder_card, print_card, dev_log, other.';
COMMENT ON COLUMN public.agent_feed_items.status IS 'Content lifecycle: unread, read, archived, expired. This is content state, not WeChat delivery state.';
COMMENT ON COLUMN public.agent_feed_items.related_table IS 'Optional pointer to source table such as weekly_digest, print_capsules, daily_status_digest.';
COMMENT ON COLUMN public.agent_feed_items.related_id IS 'Optional pointer to source record in related_table.';
COMMENT ON COLUMN public.agent_settings.agent_mode IS '全局暂停/静默模式：active正常运行, quiet减少主动消息, paused暂停所有自动化';
COMMENT ON COLUMN public.approval_executions.executor IS '执行方标识（如 mac_mini），多执行器时用于排查归属。';
COMMENT ON COLUMN public.approval_executions.status IS 'claimed → running → succeeded/failed；stale_skipped = 批准时间超出新鲜窗口，认领后跳过执行。';
COMMENT ON COLUMN public.approval_executions.output_excerpt IS '执行输出摘录（截断），不含敏感密钥；完整输出留在执行方本地日志。';
COMMENT ON COLUMN public.channel_config.channel_name IS '通道名称：wechat / telegram / web / 其他扩展';
COMMENT ON COLUMN public.channel_config.active_model IS '该通道当前使用的 OpenRouter 模型 ID，如 anthropic/claude-sonnet-4.5';
COMMENT ON COLUMN public.checkin_logs.canonical_message_id IS 'Canonical proactive companion message produced by this checkin decision.';
COMMENT ON COLUMN public.checkin_logs.canonical_event_id IS 'Pushable agent event atomically paired with the canonical proactive message.';
COMMENT ON COLUMN public.checkin_logs.idempotency_key IS 'Stable scheduler retry key; companion:v1:<client UUID> for canonical publishes.';
COMMENT ON COLUMN public.checkin_logs.topic_fingerprint IS 'Non-content fingerprint used by the scheduler to avoid repetitive proactive topics.';
COMMENT ON COLUMN public.checkin_logs.generation_audit IS 'Resolved profile, port, Prompt, model, and context-window versions used for generation.';
COMMENT ON COLUMN public.conversation_profiles.session_policy IS 'singleton for the fixed companion window; multi for ordinary API/CLI chats and sofas.';
COMMENT ON COLUMN public.conversation_profiles.participant_port_keys IS 'Generation port keys available to this profile; session routing metadata is derived from this list.';
COMMENT ON COLUMN public.conversation_profiles.context_recipe IS 'Versioned declaration of allowed history scope, epoch, token selection, and external context sources.';
COMMENT ON COLUMN public.device_status.source_app IS 'expo_app = Expo App 直写（authenticated owner INSERT，V4.0 Phase 3 起）；为空 = 快捷指令经 device-report Edge Function 服务端写入的历史与降级通道。';
COMMENT ON COLUMN public.device_tokens.platform IS 'V4.0 只写 ios/android；web 仅为未来统一设备表预留，V4.0 不写 web 行。';
COMMENT ON COLUMN public.enabled_models.model_id IS 'Provider 侧真实 model ID，如 anthropic/claude-sonnet-4.5';
COMMENT ON COLUMN public.enabled_models.display_name IS 'UI 展示名（可选）';
COMMENT ON COLUMN public.enabled_models.is_default IS '是否为全局默认模型';
COMMENT ON COLUMN public.generation_ports.port_key IS 'Stable routing key such as app_companion, app_chat, codex_cli, or claude_cli.';
COMMENT ON COLUMN public.generation_ports.model_channel_name IS 'Optional owner-scoped channel_config reference; required for API ports.';
COMMENT ON COLUMN public.generation_ports.sop_ref IS 'Immutable Git reference for code-coupled CLI safety/SOP behavior; nullable until the runtime integration slice.';
COMMENT ON COLUMN public.learning_edges.edge_type IS 'association=联想, derivation=派生, contradiction=反驳, application=应用, reference=引用, question=提问';
COMMENT ON COLUMN public.learning_nodes.metadata IS '类型专属字段。concept: {source}; question: {status, answer}; application: {project, status}; source: {url, author}; quote: {origin, page}';
COMMENT ON COLUMN public.llm_providers.name IS '机器名（用于日志/标识），如 openrouter / aihubmix';
COMMENT ON COLUMN public.llm_providers.display_name IS 'UI 展示名';
COMMENT ON COLUMN public.llm_providers.base_url IS 'Chat Completions 端点基础 URL（不含 /chat/completions 后缀）';
COMMENT ON COLUMN public.llm_providers.secret_name IS '对应 Edge Function Secret 的环境变量名，如 OPENROUTER_API_KEY';
COMMENT ON COLUMN public.llm_providers.active IS '是否为当前主 provider（主 provider 应确保唯一，由前端控制）';
COMMENT ON COLUMN public.llm_providers.priority IS 'Fallback 顺序，数值越小优先级越高（预留）';
COMMENT ON COLUMN public.messages.sender_key IS 'Stable sender identity within routing_config.participants; nullable only during the legacy-client expand window.';
COMMENT ON COLUMN public.messages.reply_to_id IS 'Typed reply target constrained to a message in the same session.';
COMMENT ON COLUMN public.messages.target_sender_keys IS 'Explicit responder targets resolved against routing_config.participants by conversation-dispatch.';
COMMENT ON COLUMN public.notification_events.ticket_id IS 'Expo push ticket id，供 receipts 回查（清单 5.3）；仅 status=sent 行有值。';
COMMENT ON COLUMN public.notification_events.receipt_checked_at IS 'receipts 回查完成时间；null = 已发送但尚未回查。';
COMMENT ON COLUMN public.prompt_templates.name IS '模板名（同一 name 可有多个 version，只有一个 active）';
COMMENT ON COLUMN public.prompt_templates.category IS 'base=人格底色 / scenario=场景模板（checkin_day 等）/ style=风格变体';
COMMENT ON COLUMN public.provider_models.is_default IS 'When multiple providers bind the same model_id for the same model_type, the is_default=true row wins resolution. Enforced by partial unique index.';
COMMENT ON COLUMN public.providers.secret_name IS 'The key name in Supabase Secrets (or Mini Agent .env) where the actual API key is stored. Never store the key itself here.';
COMMENT ON COLUMN public.providers.priority IS 'Default sort order when multiple providers offer the same model and none is_default. Lower = higher priority.';
COMMENT ON COLUMN public.sessions.session_key IS 'Stable machine key. Display names live in routing_config and may change independently.';
COMMENT ON COLUMN public.sessions.conversation_kind IS 'Routing shape: direct or group.';
COMMENT ON COLUMN public.sessions.handler IS 'Server-side handler: api/cli for direct sessions, router for group sessions.';
COMMENT ON COLUMN public.sessions.routing_config IS 'Versioned routing metadata: participant sender keys, default responder, and display hints.';
COMMENT ON COLUMN public.sessions.conversation_profile_key IS 'Nullable expand reference resolved against the owner current active conversation profile.';
COMMENT ON COLUMN public.syzygy_commands.command_type IS '指令类型名：print / say / notify / query_screen_time / read_local_file 等，未来扩展时在此字段加新值即可';
COMMENT ON COLUMN public.syzygy_commands.payload IS 'JSON 参数载荷，schema 由 command_type 决定';
COMMENT ON COLUMN public.syzygy_commands.claimed_by IS 'Mini Agent 实例标识（如进程 ID + hostname），用于抢占执行';
COMMENT ON COLUMN public.syzygy_commands.idempotency_key IS '客户端生成的唯一键，用于防止重复提交';
COMMENT ON COLUMN public.todos.todo_type IS '短期(near)/长期(long_term)，长期待办距event_date≤7天时自动翻转为短期';
COMMENT ON COLUMN public.todos.event_date IS '长期待办的目标日期，如9月20日看剧院魅影';

-- ============================================================================
-- 完 · Hamster-Nest schema 到此结束
-- ============================================================================
