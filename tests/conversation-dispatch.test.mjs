import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  buildConversationCorsHeaders,
  MAX_CONVERSATION_CONTENT_LENGTH,
  normalizeConversationDispatchRequest,
  OpenAiSseAccumulator,
} = await import('../supabase/functions/conversation-dispatch/contract.ts')
const {
  isConversationTaskCancelResult,
  normalizeConversationTaskCancelRequest,
} = await import('../supabase/functions/conversation-task-cancel/contract.ts')

const migrationUrl = new URL(
  '../supabase/migrations/20260725123315_v4_1_conversation_dispatch_prepare.sql',
  import.meta.url,
)
const functionUrl = new URL(
  '../supabase/functions/conversation-dispatch/index.ts',
  import.meta.url,
)
const durableMigrationUrl = new URL(
  '../supabase/migrations/20260728131144_v4_1_conversation_cli_durable_tasks.sql',
  import.meta.url,
)
const cancelFunctionUrl = new URL(
  '../supabase/functions/conversation-task-cancel/index.ts',
  import.meta.url,
)
const configUrl = new URL('../supabase/config.toml', import.meta.url)

test('dispatch request preserves content and normalizes stable identifiers', () => {
  const request = normalizeConversationDispatchRequest({
    session_id: '00000000-0000-4000-8000-000000000001',
    client_id: '00000000-0000-4000-8000-000000000002',
    content: '  第一行\n第二行  ',
    client_created_at: '2026-07-25T12:00:00+08:00',
    target_sender_keys: [' syzygy_instant '],
    retry_failed: true,
  })

  assert.equal(request.content, '  第一行\n第二行  ')
  assert.equal(request.client_created_at, '2026-07-25T04:00:00.000Z')
  assert.deepEqual(request.target_sender_keys, ['syzygy_instant'])
  assert.equal(request.retry_failed, true)
})

test('dispatch request rejects malformed, ambiguous, and oversized messages', () => {
  assert.throws(
    () =>
      normalizeConversationDispatchRequest({
        session_id: 'not-a-uuid',
        client_id: '00000000-0000-4000-8000-000000000002',
        content: 'hello',
      }),
    /session_id 必须是 UUID/u,
  )
  assert.throws(
    () =>
      normalizeConversationDispatchRequest({
        session_id: '00000000-0000-4000-8000-000000000001',
        client_id: '00000000-0000-4000-8000-000000000002',
        content: 'hello',
        target_sender_keys: ['syzygy_instant', 'syzygy_cli'],
      }),
    /零个或一个 responder/u,
  )
  assert.throws(
    () =>
      normalizeConversationDispatchRequest({
        session_id: '00000000-0000-4000-8000-000000000001',
        client_id: '00000000-0000-4000-8000-000000000002',
        content: '字'.repeat(MAX_CONVERSATION_CONTENT_LENGTH + 1),
      }),
    /content 最长/u,
  )
})

test('SSE accumulator survives split JSON frames and records the provider model', () => {
  const accumulator = new OpenAiSseAccumulator()
  accumulator.push('data: {"model":"openrouter/test","choices":[{"delta":{"cont')
  accumulator.push('ent":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":[{"text":"好"}]}}]}\r')
  accumulator.push('\n\ndata: [DONE]\n\n')
  accumulator.finish()

  assert.equal(accumulator.content, '你好')
  assert.equal(accumulator.model, 'openrouter/test')
  assert.equal(accumulator.done, true)
})

test('CORS contract exposes canonical message identifiers', () => {
  const headers = buildConversationCorsHeaders('https://chuan-101.github.io')
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://chuan-101.github.io')
  assert.match(headers['Access-Control-Expose-Headers'], /x-conversation-reply-id/u)
  assert.match(headers['Access-Control-Expose-Headers'], /x-conversation-agent-task-id/u)
  assert.match(headers['Access-Control-Allow-Headers'], /authorization/u)
})

test('RPC remains an authenticated SECURITY INVOKER atomic claim', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /security invoker/iu)
  assert.match(sql, /set search_path = ''/iu)
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/iu)
  assert.match(
    sql,
    /on conflict \(client_id\) where client_id is not null\s+do nothing/iu,
  )
  assert.match(
    sql,
    /on conflict \(session_id, reply_to_id, sender_key\)\s+where role = 'assistant'/iu,
  )
  assert.match(sql, /on conflict \(user_id, idempotency_key\)\s+do nothing/iu)
  assert.match(sql, /from public, anon, service_role/iu)
  assert.match(sql, /to authenticated/iu)
  assert.doesNotMatch(sql, /security definer/iu)
})

test('durable CLI dispatch is service-only, owner-readable, atomic, and replay-safe', async () => {
  const sql = await readFile(durableMigrationUrl, 'utf8')

  assert.match(sql, /agent_tasks_conversation_command_unique/iu)
  assert.match(sql, /payload_json\s*->>\s*'command_id'/iu)
  assert.match(sql, /alter publication supabase_realtime add table public\.agent_tasks/iu)
  assert.match(sql, /create policy agent_tasks_select_own[\s\S]*?auth\.uid\(\)/iu)
  assert.match(sql, /revoke all on public\.agent_tasks from anon/iu)
  assert.match(sql, /private\.conversation_dispatch_prepare_core/iu)
  assert.match(sql, /security invoker/iu)
  assert.doesNotMatch(sql, /security definer/iu)
  assert.match(sql, /authenticated owner mismatch/iu)
  assert.match(sql, /durable task preparation requires service role/iu)
  assert.match(sql, /insert into public\.syzygy_commands[\s\S]*?insert into public\.agent_tasks/iu)
  assert.match(sql, /'agent_task_id', v_task_id/iu)
  assert.match(sql, /conversation_dispatch_prepare_durable/iu)
  assert.match(
    sql,
    /revoke all on function public\.conversation_dispatch_prepare_durable[\s\S]*?from public, anon, authenticated/iu,
  )
  assert.match(
    sql,
    /grant execute on function public\.conversation_dispatch_prepare_durable[\s\S]*?to service_role/iu,
  )
  assert.match(
    sql,
    /v_command\.status <> 'pending' or v_task\.status <> 'pending'/iu,
  )
  assert.match(sql, /v_task\.status not in \('pending', 'completed', 'failed', 'cancelled'\)/iu)
  assert.match(sql, /conversation_reply_completed/iu)
  assert.match(sql, /'screen', 'conversation_detail'/iu)
})

test('Edge handler re-verifies the owner before using the service-only durable RPC', async () => {
  const [source, config] = await Promise.all([
    readFile(functionUrl, 'utf8'),
    readFile(configUrl, 'utf8'),
  ])

  assert.match(config, /\[functions\.conversation-dispatch\][\s\S]*?verify_jwt = false/iu)
  assert.match(source, /new URL\('\/auth\/v1\/user', supabaseUrl\)/u)
  assert.match(source, /getOwnerUserId\(\)/u)
  assert.match(source, /Authorization: authorization/u)
  assert.match(source, /getSupabaseAdminKey\(\)/u)
  assert.match(source, /\.rpc\('conversation_dispatch_prepare_durable'/u)
  assert.match(source, /p_user_id: userId/u)
  assert.match(source, /EdgeRuntime\.waitUntil\(streamWork\)/u)
  assert.ok(source.indexOf('getOwnerUserId()') < source.indexOf('getSupabaseAdminKey()'))
  assert.equal(source.match(/new URL\('\/functions\/v1\/openrouter-chat'/gu)?.length, 1)
})

test('pending cancel boundary validates task ids and keeps privileged work behind owner auth', async () => {
  assert.deepEqual(
    normalizeConversationTaskCancelRequest({
      task_id: '00000000-0000-4000-8000-000000000005',
    }),
    { task_id: '00000000-0000-4000-8000-000000000005' },
  )
  assert.throws(
    () => normalizeConversationTaskCancelRequest({ task_id: 'not-a-task' }),
    /task_id 必须是 UUID/u,
  )
  assert.equal(
    isConversationTaskCancelResult({
      schema_version: 1,
      cancelled: false,
      reason: 'already_claimed',
      command: { id: 'command', status: 'running' },
      task: { id: 'task', status: 'running' },
    }),
    true,
  )

  const [source, config] = await Promise.all([
    readFile(cancelFunctionUrl, 'utf8'),
    readFile(configUrl, 'utf8'),
  ])
  assert.match(
    config,
    /\[functions\.conversation-task-cancel\][\s\S]*?verify_jwt = false/iu,
  )
  assert.match(source, /new URL\('\/auth\/v1\/user', supabaseUrl\)/u)
  assert.match(source, /getOwnerUserId\(\)/u)
  assert.match(source, /getSupabaseAdminKey\(\)/u)
  assert.match(source, /\.rpc\('conversation_dispatch_cancel_pending'/u)
  assert.ok(source.indexOf('getOwnerUserId()') < source.indexOf('getSupabaseAdminKey()'))
})
