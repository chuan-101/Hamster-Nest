import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  estimateTextTokens,
  parseConversationContextRecipe,
  resolveHistoryTokenBudget,
  selectNewestContextWindow,
  startOfShanghaiDayIso,
} = await import('../supabase/functions/conversation-dispatch/context.ts')
const {
  readCanonicalContextContract,
  resolveCompressionModule,
  shouldInjectChitchatMemory,
} = await import('../supabase/functions/openrouter-chat/context-contract.ts')

const migrationUrl = new URL(
  '../supabase/migrations/20260801123513_v4_1_companion_session_migrate.sql',
  import.meta.url,
)
const rollbackUrl = new URL(
  '../supabase/rollback-contracts/20260801123513_v4_1_companion_session_migrate.sql',
  import.meta.url,
)
const dispatchUrl = new URL(
  '../supabase/functions/conversation-dispatch/index.ts',
  import.meta.url,
)

const message = ({ id, role = 'user', content, state = null, createdAt }) => ({
  id,
  role,
  content,
  meta: state ? { delivery_state: state } : null,
  created_at: createdAt,
})

test('companion migration changes only the stable session address and preserves message ids', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const rollback = await readFile(rollbackUrl, 'utf8')

  assert.match(sql, /pg_advisory_xact_lock/iu)
  assert.match(sql, /session_key = 'syzygy_companion'/iu)
  assert.match(sql, /conversation_profile_key = 'app_companion'/iu)
  assert.match(sql, /default_responder', 'app_companion'/iu)
  assert.match(
    sql,
    /Companion migration must preserve every canonical message id/iu,
  )
  assert.match(sql, /md5\(coalesce\(string_agg\(id::text/iu)
  assert.doesNotMatch(sql, /update public\.messages/iu)
  assert.doesNotMatch(sql, /insert into public\.messages/iu)
  assert.doesNotMatch(sql, /delete from public\.messages/iu)

  assert.match(
    rollbackUrl.pathname,
    /\/supabase\/rollback-contracts\/20260801123513_v4_1_companion_session_migrate\.sql$/u,
  )
  assert.doesNotMatch(rollbackUrl.pathname, /\/supabase\/migrations\//u)
  assert.match(rollback, /same[\s\S]*?sessions\.id/iu)
  assert.match(rollback, /never deletes or rewrites canonical messages/iu)
  assert.match(rollback, /session_key = 'syzygy_instant'/iu)
  assert.match(rollback, /'version', 1/iu)
})

test('Shanghai epoch changes exactly at local midnight', () => {
  assert.equal(
    startOfShanghaiDayIso('2026-08-01T15:59:59.999Z'),
    '2026-07-31T16:00:00.000Z',
  )
  assert.equal(
    startOfShanghaiDayIso('2026-08-01T16:00:00.000Z'),
    '2026-08-01T16:00:00.000Z',
  )
  assert.throws(
    () => startOfShanghaiDayIso('not-a-date'),
    /invalid created_at/u,
  )
})

test('context recipe is explicit and fails closed when its boundary is malformed', () => {
  const recipe = parseConversationContextRecipe({
    version: 1,
    history_scope: 'current_session',
    epoch: 'asia_shanghai_day',
    selection: 'newest_within_token_budget',
    external_sources: [],
  })
  assert.equal(recipe.epoch, 'asia_shanghai_day')
  assert.deepEqual(recipe.external_sources, [])
  assert.throws(
    () =>
      parseConversationContextRecipe({
        ...recipe,
        history_scope: 'all_sessions',
      }),
    /invalid context recipe/u,
  )
})

test('newest-first token selection excludes placeholders and always keeps the triggering user message', () => {
  const replyId = '00000000-0000-4000-8000-000000000004'
  const userId = '00000000-0000-4000-8000-000000000003'
  const olderId = '00000000-0000-4000-8000-000000000002'
  const oldestId = '00000000-0000-4000-8000-000000000001'
  const current = message({
    id: userId,
    content: '今天继续',
    createdAt: '2026-08-01T16:00:01.000Z',
  })
  const older = message({
    id: olderId,
    role: 'assistant',
    content: '好',
    state: 'completed',
    createdAt: '2026-08-01T16:00:00.500Z',
  })
  const result = selectNewestContextWindow({
    newestFirst: [
      message({
        id: replyId,
        role: 'assistant',
        content: '',
        state: 'generating',
        createdAt: '2026-08-01T16:00:01.100Z',
      }),
      current,
      older,
      message({
        id: oldestId,
        content: '太长了'.repeat(2_000),
        createdAt: '2026-08-01T16:00:00.000Z',
      }),
    ],
    tokenBudget: estimateTextTokens(current.content) + estimateTextTokens(older.content),
    requiredMessageId: userId,
    excludedMessageIds: [replyId],
  })

  assert.deepEqual(
    result.newestFirst.map((row) => row.id),
    [userId, olderId],
  )
  assert.equal(result.containsRequiredMessage, true)
  assert.equal(result.reachedBudget, true)

  const zeroBudget = selectNewestContextWindow({
    newestFirst: [current, older],
    tokenBudget: 0,
    requiredMessageId: userId,
  })
  assert.deepEqual(
    zeroBudget.newestFirst.map((row) => row.id),
    [userId],
  )
})

test('history budget reserves system, completion, and safety capacity', () => {
  const withoutPrompt = resolveHistoryTokenBudget({
    systemPrompt: '',
    maxOutputTokens: 1_000,
    triggerRatio: 0.65,
  })
  const withPrompt = resolveHistoryTokenBudget({
    systemPrompt: '规则'.repeat(1_000),
    maxOutputTokens: 1_000,
    triggerRatio: 0.65,
  })
  assert.ok(withoutPrompt > 0)
  assert.ok(withPrompt < withoutPrompt)
})

test('managed canonical context prevents a second history read and honors external sources', () => {
  const managed = {
    module: 'chitchat',
    extra: {
      canonical_context: {
        version: 1,
        managed_by: 'conversation-dispatch',
        external_sources: [],
      },
    },
  }
  assert.deepEqual(readCanonicalContextContract(managed)?.external_sources, [])
  assert.equal(resolveCompressionModule(managed), null)
  assert.equal(shouldInjectChitchatMemory(managed), false)
  assert.equal(
    shouldInjectChitchatMemory({
      ...managed,
      extra: {
        canonical_context: {
          version: 1,
          managed_by: 'conversation-dispatch',
          external_sources: ['memory_entries'],
        },
      },
    }),
    true,
  )
  assert.equal(resolveCompressionModule({ module: 'chitchat' }), 'chat')
  assert.equal(shouldInjectChitchatMemory({ module: 'chitchat' }), true)
})

test('dispatch applies profile boundary before keyset token selection', async () => {
  const source = await readFile(dispatchUrl, 'utf8')

  assert.match(source, /parseConversationContextRecipe/iu)
  assert.match(
    source,
    /startOfShanghaiDayIso\(dispatch\.user_message\.created_at\)/iu,
  )
  assert.match(source, /query = query\.gte\('created_at', epochStart\)/iu)
  assert.match(source, /order\('id', \{ ascending: false \}\)/iu)
  assert.match(source, /selectNewestContextWindow/iu)
  assert.match(source, /managed_by: 'conversation-dispatch'/iu)
  assert.match(source, /external_sources: contextRecipe\.external_sources/iu)
  assert.doesNotMatch(source, /HISTORY_LIMIT/iu)
})
