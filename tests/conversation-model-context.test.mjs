import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  buildCurrentShanghaiTimePrompt,
  formatShanghaiTimestamp,
  withCanonicalMessageTimestamp,
} = await import('../supabase/functions/conversation-dispatch/model-context.ts')
const {
  normalizeConversationPushPreview,
  resolvePushTitle,
  supportsConversationPushPreview,
} = await import('../supabase/functions/push-dispatch/preview.ts')

const dispatchUrl = new URL(
  '../supabase/functions/conversation-dispatch/index.ts',
  import.meta.url,
)
const pushUrl = new URL(
  '../supabase/functions/push-dispatch/index.ts',
  import.meta.url,
)

test('reply context carries current Shanghai time and each canonical message timestamp', () => {
  assert.equal(
    formatShanghaiTimestamp('2026-08-04T00:01:02.000Z'),
    '2026-08-04 08:01:02',
  )
  assert.equal(
    buildCurrentShanghaiTimePrompt(new Date('2026-08-04T00:01:02.000Z')),
    '当前上海时间：2026-08-04 08:01:02（Asia/Shanghai）',
  )
  assert.equal(
    withCanonicalMessageTimestamp('早呀', '2026-08-04T00:01:02.000Z'),
    '[2026-08-04 08:01:02] 早呀',
  )
})

test('App companion replies resolve the same model channel used by proactive messages', async () => {
  const source = await readFile(dispatchUrl, 'utf8')
  assert.match(source, /model_channel_name/u)
  assert.match(source, /from\('channel_config'\)/u)
  assert.match(source, /profileKey === 'app_companion'/u)
  assert.match(source, /generation\.activeModel/u)
  assert.match(source, /withCanonicalMessageTimestamp/u)
  assert.match(source, /buildCurrentShanghaiTimePrompt/u)
})

test('completed App replies publish one idempotent push fact routed back to the conversation', async () => {
  const source = await readFile(dispatchUrl, 'utf8')
  assert.match(source, /from\('agent_events'\)\.insert/u)
  assert.match(source, /event_type: 'conversation_reply_completed'/u)
  assert.match(source, /entity_type: 'conversation_reply'/u)
  assert.match(source, /screen: 'conversation_detail'/u)
  assert.match(source, /params: \{ id: sessionId \}/u)
  assert.match(source, /error\.code !== '23505'/u)
  assert.match(
    source,
    /persistReply\([\s\S]*?'completed'[\s\S]*?publishApiReplyCompletedEvent/iu,
  )
})

test('conversation push preview is bounded, readable, and fetched owner-scoped', async () => {
  assert.equal(
    normalizeConversationPushPreview(' 第一段 |||\n第二段 '),
    '第一段 第二段',
  )
  assert.equal(normalizeConversationPushPreview(''), null)
  assert.equal(normalizeConversationPushPreview('鼠'.repeat(150))?.length, 140)
  assert.equal(supportsConversationPushPreview('conversation_message'), true)
  assert.equal(supportsConversationPushPreview('conversation_reply'), true)
  assert.equal(supportsConversationPushPreview('approval_request'), false)
  assert.equal(resolvePushTitle('Syzygy 来找你啦', 'conversation_message'), 'Syzygy')
  assert.equal(resolvePushTitle('Syzygy · 陪伴回复了你', 'conversation_reply'), 'Syzygy')
  assert.equal(resolvePushTitle('需要你确认', 'approval_request'), '需要你确认')

  const source = await readFile(pushUrl, 'utf8')
  assert.match(source, /from\('messages'\)/u)
  assert.match(source, /\.eq\('user_id', event\.user_id\)/u)
  assert.match(source, /body: preview/u)
  assert.match(source, /title: resolvePushTitle\(event\.title, event\.entity_type\)/u)
})
