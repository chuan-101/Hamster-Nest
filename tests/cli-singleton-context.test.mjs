import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const { resolveConversationProfileKey } = await import(
  '../supabase/functions/conversation-dispatch/prompt.ts'
)

const migrationUrl = new URL(
  '../supabase/migrations/20260810123838_v4_1_cli_singleton_sessions_migrate.sql',
  import.meta.url,
)
const rollbackUrl = new URL(
  '../supabase/rollback-contracts/20260810123838_v4_1_cli_singleton_sessions_migrate.sql',
  import.meta.url,
)

test('CLI profile fallback accepts legacy and final stable session keys', () => {
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: null,
      sessionKey: 'syzygy_cli',
    }),
    'codex_cli',
  )
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: null,
      sessionKey: 'syzygy_codex_cli',
    }),
    'codex_cli',
  )
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: null,
      sessionKey: 'syzygy_claude_cli',
    }),
    'claude_cli',
  )
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: 'claude_cli',
      sessionKey: 'legacy-does-not-matter',
    }),
    'claude_cli',
  )
})

test('CLI singleton migration preserves Codex facts and provisions only the two fixed windows', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const rollback = await readFile(rollbackUrl, 'utf8')

  assert.match(sql, /pg_advisory_xact_lock/iu)
  assert.match(sql, /session_policy[\s\S]*?'singleton'/iu)
  assert.match(sql, /singleton_session_key[\s\S]*?'syzygy_codex_cli'/iu)
  assert.match(sql, /singleton_session_key[\s\S]*?'syzygy_claude_cli'/iu)
  assert.match(sql, /"epoch":\s*"asia_shanghai_day"/iu)
  assert.match(sql, /session_key = 'syzygy_codex_cli'/iu)
  assert.match(sql, /session_key[\s\S]*?'syzygy_claude_cli'/iu)
  assert.match(sql, /on conflict \(user_id, session_key\)/iu)
  assert.match(sql, /must preserve every Codex canonical message id/iu)
  assert.match(sql, /md5\(coalesce\(string_agg\(id::text/iu)
  assert.doesNotMatch(sql, /update public\.messages/iu)
  assert.doesNotMatch(sql, /insert into public\.messages/iu)
  assert.doesNotMatch(sql, /delete from public\.messages/iu)
  assert.doesNotMatch(sql, /create table/iu)
  assert.doesNotMatch(sql, /create policy/iu)
  assert.doesNotMatch(sql, /grant /iu)

  assert.doesNotMatch(rollbackUrl.pathname, /\/supabase\/migrations\//u)
  assert.match(rollback, /same legacy sessions\.id/iu)
  assert.match(rollback, /canonical messages are never/iu)
  assert.match(rollback, /session_key = 'syzygy_cli'/iu)
  assert.match(rollback, /append-only profile versions are not reactivated/iu)
  assert.match(rollback, /insert into public\.conversation_profiles/iu)
  assert.match(rollback, /if exists[\s\S]*?public\.messages[\s\S]*?is_archived = true/iu)
})
