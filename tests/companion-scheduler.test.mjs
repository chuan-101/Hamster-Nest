import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260802111329_v4_1_companion_scheduler_canonical.sql',
  import.meta.url,
)
const rollbackUrl = new URL(
  '../supabase/rollback-contracts/20260802111329_v4_1_companion_scheduler_canonical.sql',
  import.meta.url,
)

test('companion publisher is one service-only invoker transaction', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const functionStart = sql.indexOf(
    'create or replace function public.conversation_companion_publish_proactive(',
  )
  const functionEnd = sql.indexOf('$function$;', functionStart)
  const functionSql = sql.slice(
    functionStart,
    functionEnd + '$function$;'.length,
  )

  assert.notEqual(functionStart, -1)
  assert.notEqual(functionEnd, -1)
  assert.match(functionSql, /language plpgsql[\s\S]*?security invoker/iu)
  assert.doesNotMatch(functionSql, /security definer/iu)
  assert.match(functionSql, /current_user not in \('service_role', 'postgres', 'supabase_admin'\)/iu)
  assert.match(
    sql,
    /revoke all on function public\.conversation_companion_publish_proactive\([\s\S]*?from public, anon, authenticated/iu,
  )
  assert.match(
    sql,
    /grant execute on function public\.conversation_companion_publish_proactive\([\s\S]*?to service_role/iu,
  )
})

test('publisher resolves the active companion contract before writing canonical facts', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /profile_key = 'app_companion'[\s\S]*?and active/iu)
  assert.match(sql, /singleton_session_key = 'syzygy_companion'/iu)
  assert.match(sql, /session_key = 'syzygy_companion'/iu)
  assert.match(sql, /conversation_profile_key = 'app_companion'/iu)
  assert.match(sql, /port_key = v_profile\.default_responder_port_key[\s\S]*?and active/iu)
  assert.match(sql, /runtime_kind = 'api'/iu)
  assert.match(sql, /from public\.prompt_templates[\s\S]*?and active/iu)
  assert.match(sql, /generation contract changed before publish/iu)
})

test('same client UUID converges to one message, event, and audit row', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(
    sql,
    /insert into public\.messages[\s\S]*?on conflict \(client_id\) where client_id is not null[\s\S]*?do nothing/iu,
  )
  assert.match(sql, /client_id was already used with a different publish contract/iu)
  assert.match(sql, /agent_events_companion_proactive_published_unique/iu)
  assert.match(
    sql,
    /insert into public\.agent_events[\s\S]*?on conflict \(user_id, event_type, entity_id\)[\s\S]*?do nothing/iu,
  )
  assert.match(sql, /checkin_logs_user_idempotency_unique/iu)
  assert.match(
    sql,
    /insert into public\.checkin_logs[\s\S]*?on conflict \(user_id, idempotency_key\)[\s\S]*?do nothing/iu,
  )
  assert.match(sql, /'companion:v1:' \|\| p_client_id::text/iu)
})

test('push event routes by ids and never copies proactive content into its payload', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const eventInsertStart = sql.indexOf('insert into public.agent_events (')
  const eventInsertEnd = sql.indexOf('on conflict', eventInsertStart)
  const eventInsert = sql.slice(eventInsertStart, eventInsertEnd)

  assert.match(eventInsert, /'companion_proactive_published'/iu)
  assert.match(eventInsert, /'session_id', v_session\.id/iu)
  assert.match(eventInsert, /'message_id', v_message\.id/iu)
  assert.doesNotMatch(eventInsert, /'body'/iu)
  assert.doesNotMatch(eventInsert, /'content'/iu)
  assert.doesNotMatch(eventInsert, /v_content/iu)
})

test('rollback removes only the publish surface and audit schema', async () => {
  const rollback = await readFile(rollbackUrl, 'utf8')

  assert.match(rollback, /drop function if exists public\.conversation_companion_publish_proactive/iu)
  assert.match(rollback, /drop column if exists canonical_message_id/iu)
  assert.match(rollback, /never deleted or rewritten/iu)
  assert.doesNotMatch(rollback, /delete from public\.messages/iu)
  assert.doesNotMatch(rollback, /delete from public\.agent_events/iu)
})
