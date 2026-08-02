-- Rollback contract for 20260802111329_v4_1_companion_scheduler_canonical.sql.
--
-- This removes the local scheduler publish surface and nullable audit columns.
-- Canonical messages and agent_events already published by the forward migration
-- are durable facts and are intentionally never deleted or rewritten here.

set lock_timeout = '5s';
set statement_timeout = '2min';

drop function if exists public.conversation_companion_publish_proactive(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  text,
  integer,
  text,
  jsonb,
  text
);

drop index if exists public.agent_events_companion_proactive_published_unique;
drop index if exists public.checkin_logs_canonical_event_idx;
drop index if exists public.checkin_logs_canonical_message_idx;
drop index if exists public.checkin_logs_user_idempotency_unique;

alter table public.checkin_logs
  drop constraint if exists checkin_logs_generation_audit_object_check,
  drop constraint if exists checkin_logs_topic_fingerprint_nonempty_check,
  drop constraint if exists checkin_logs_idempotency_key_nonempty_check,
  drop constraint if exists checkin_logs_canonical_event_fkey,
  drop constraint if exists checkin_logs_canonical_message_fkey,
  drop column if exists generation_audit,
  drop column if exists topic_fingerprint,
  drop column if exists idempotency_key,
  drop column if exists canonical_event_id,
  drop column if exists canonical_message_id;
