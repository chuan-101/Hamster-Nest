import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260729134035_v4_1_chat_config_expand.sql',
  import.meta.url,
)

test('chat config expand adds only the two versioned catalogs and nullable session profile key', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /create table public\.generation_ports/iu)
  assert.match(sql, /create table public\.conversation_profiles/iu)
  assert.match(
    sql,
    /alter table public\.sessions[\s\S]*?add column if not exists conversation_profile_key text/iu,
  )
  assert.match(sql, /sessions_user_profile_archived_updated_idx/iu)
  assert.match(
    sql,
    /Expand migration must not backfill existing sessions/iu,
  )
  assert.doesNotMatch(sql, /alter table public\.prompt_templates/iu)
  assert.doesNotMatch(sql, /update public\.sessions[\s\S]*?conversation_profile_key/iu)
})

test('chat config catalogs are owner-readable with explicit grants and one active version', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const tableName of ['generation_ports', 'conversation_profiles']) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${tableName} enable row level security`,
        'iu',
      ),
    )
    assert.match(
      sql,
      new RegExp(
        `create policy ${tableName}_select_own[\\s\\S]*?to authenticated[\\s\\S]*?auth\\.uid\\(\\)`,
        'iu',
      ),
    )
    assert.match(
      sql,
      new RegExp(
        `revoke all on public\\.${tableName} from anon, authenticated`,
        'iu',
      ),
    )
    assert.match(
      sql,
      new RegExp(`grant select on public\\.${tableName} to authenticated`, 'iu'),
    )
  }

  assert.match(sql, /generation_ports_user_key_active_unique/iu)
  assert.match(sql, /generation_ports_user_model_channel_idx/iu)
  assert.match(sql, /conversation_profiles_user_key_active_unique/iu)
  assert.match(sql, /enforce_versioned_chat_config_immutable/iu)
  assert.match(sql, /inactive versions cannot be reactivated/iu)
})

test('public publish and session RPCs are invoker wrappers over private owner-bound cores', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const functionName of [
    'generation_port_publish',
    'conversation_profile_publish',
    'conversation_session_create',
  ]) {
    const start = sql.indexOf(
      `create or replace function public.${functionName}(`,
    )
    const end = sql.indexOf('$function$;', start)
    const functionSql = sql.slice(start, end + '$function$;'.length)

    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    assert.match(
      functionSql,
      /security invoker[\s\S]*?set search_path = ''/iu,
    )
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${functionName}[\\s\\S]*?from public, anon, service_role`,
        'iu',
      ),
    )
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${functionName}[\\s\\S]*?to authenticated`,
        'iu',
      ),
    )
    assert.doesNotMatch(functionSql, /security definer/iu)
  }

  for (const functionName of [
    'generation_port_publish_core',
    'conversation_profile_publish_core',
    'conversation_session_create_core',
  ]) {
    const start = sql.indexOf(
      `create or replace function private.${functionName}(`,
    )
    const end = sql.indexOf('$function$;', start)
    const functionSql = sql.slice(start, end + '$function$;'.length)

    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    assert.match(
      functionSql,
      /security definer[\s\S]*?set search_path = ''/iu,
    )
  }
  assert.match(sql, /v_owner_id uuid := \(select auth\.uid\(\)\)/iu)
})

test('profile publishing validates active ports and direct runtime shape', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(
    sql,
    /Every participant must resolve to an active owner generation port/iu,
  )
  assert.match(
    sql,
    /Profile handler must match the default responder runtime contract/iu,
  )
  assert.match(sql, /Direct profiles must resolve to exactly one generation port/iu)
  assert.match(
    sql,
    /Default responder must be one of the participant ports/iu,
  )
  assert.match(sql, /Group profiles require a rules Prompt reference/iu)
  assert.match(sql, /Context recipe violates the V4\.1 window isolation contract/iu)
})

test('session creation is idempotent by client UUID and cannot pre-create the companion singleton', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /A stable client-generated session id is required/iu)
  assert.match(
    sql,
    /Session id was already used with a different creation payload/iu,
  )
  assert.match(
    sql,
    /Singleton session is not provisioned yet; run its dedicated migrate step/iu,
  )
  assert.match(
    sql,
    /array\['display_name', 'avatar', 'source_label'\]::text\[\]/iu,
  )
  assert.match(sql, /Display config values must be non-empty strings/iu)
  assert.match(
    sql,
    /'participants'[\s\S]*?array_prepend\([\s\S]*?'chuanchuan'/iu,
  )
})

test('seed registers four generation ports and six profiles without Prompt or runtime activation', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const key of [
    'app_companion',
    'app_chat',
    'codex_cli',
    'claude_cli',
  ]) {
    assert.match(sql, new RegExp(`'${key}'`, 'u'))
  }

  for (const key of [
    'app_companion',
    'app_chat',
    'codex_cli',
    'claude_cli',
    'sofa_daily',
    'sofa_work',
  ]) {
    assert.match(sql, new RegExp(`'${key}'`, 'u'))
  }

  assert.match(sql, /syzygy_companion/iu)
  assert.match(sql, /asia_shanghai_day/iu)
  assert.match(sql, /current_session/iu)
  assert.doesNotMatch(sql, /insert into public\.prompt_templates/iu)
  assert.doesNotMatch(sql, /update public\.prompt_templates/iu)
  assert.doesNotMatch(sql, /pending_wechat_messages|wechat_messages/iu)
})
