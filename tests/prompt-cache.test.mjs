import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  applyAnthropicPromptCaching,
  findHistoryBreakpointIndex,
} = await import('../supabase/functions/openrouter-chat/prompt-cache.ts')
const { buildCurrentShanghaiTimeNote } = await import(
  '../supabase/functions/conversation-dispatch/model-context.ts'
)
const { OpenAiSseAccumulator } = await import(
  '../supabase/functions/conversation-dispatch/contract.ts'
)
const { buildLlmUsageRow, recordLlmUsage } = await import(
  '../supabase/functions/_shared/llm_usage.ts'
)
const { loungeIdentity, loungeTurnNote } = await import(
  '../supabase/functions/conversation-dispatch/lounge.ts'
)

const cached = (text) => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]

const conversation = () => [
  { role: 'system', content: '人设' },
  { role: 'user', content: '[2026-10-08 18:00:00] 第一句' },
  { role: 'assistant', content: '[2026-10-08 18:00:05] 回一' },
  { role: 'user', content: '[2026-10-08 18:01:00] 第二句' },
  { role: 'assistant', content: '[2026-10-08 18:01:05] 回二' },
  { role: 'user', content: '[2026-10-08 18:02:00] 第三句' },
  { role: 'user', content: '（运行时附注，不是串串的发言）当前上海时间：2026-10-08 18:02:01（Asia/Shanghai）' },
]

test('history breakpoint lands on the user turn before the newest reply', () => {
  assert.equal(findHistoryBreakpointIndex(conversation()), 3)
  assert.equal(findHistoryBreakpointIndex([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]), -1)
  assert.equal(findHistoryBreakpointIndex([]), -1)
})

test('Claude payload gets system and history breakpoints without mutating history', () => {
  const messages = conversation()
  const payload = { model: 'anthropic/claude-opus-5.5', messages }
  applyAnthropicPromptCaching(payload)

  assert.deepEqual(payload.messages[0].content, cached('人设'))
  assert.deepEqual(payload.messages[3].content, cached('[2026-10-08 18:01:00] 第二句'))
  assert.equal(messages[3].content, '[2026-10-08 18:01:00] 第二句')
  for (const index of [1, 2, 4, 5, 6]) {
    assert.equal(typeof payload.messages[index].content, 'string')
  }

  // Re-applying keeps a single history breakpoint.
  applyAnthropicPromptCaching(payload)
  const wrapped = payload.messages.filter((message) => Array.isArray(message.content))
  assert.equal(wrapped.length, 2)
})

test('next turn reuses the previous turn prefix byte for byte', () => {
  const turnOne = { messages: conversation() }
  applyAnthropicPromptCaching(turnOne)
  const turnTwo = {
    messages: [
      ...conversation().slice(0, 6),
      { role: 'assistant', content: '[2026-10-08 18:02:06] 回三' },
      { role: 'user', content: '[2026-10-08 18:03:00] 第四句' },
      { role: 'user', content: '（运行时附注，不是串串的发言）当前上海时间：2026-10-08 18:03:02（Asia/Shanghai）' },
    ],
  }
  applyAnthropicPromptCaching(turnTwo)
  // Everything up to turn one's breakpoint is identical text in turn two.
  const text = (message) => (Array.isArray(message.content) ? message.content[0].text : message.content)
  for (let index = 0; index <= 3; index += 1) {
    assert.equal(text(turnTwo.messages[index]), text(turnOne.messages[index]))
  }
  assert.deepEqual(turnTwo.messages[5].content, cached('[2026-10-08 18:02:00] 第三句'))
})

test('top-level system (Anthropic-native hoist) is still wrapped', () => {
  const payload = { system: '人设', messages: conversation().slice(1) }
  applyAnthropicPromptCaching(payload)
  assert.deepEqual(payload.system, cached('人设'))
})

test('current time rides at the end as a user-role note, not in the system prompt', async () => {
  assert.equal(
    buildCurrentShanghaiTimeNote(new Date('2026-08-04T00:01:02.000Z')),
    '（运行时附注，不是串串的发言）当前上海时间：2026-08-04 08:01:02（Asia/Shanghai）',
  )
  const source = await readFile(
    new URL('../supabase/functions/conversation-dispatch/index.ts', import.meta.url),
    'utf8',
  )
  assert.match(
    source,
    /\.\.\.canonicalMessages,\s*\{\s*role: 'user' as const,\s*content: buildCurrentShanghaiTimeNote\(\),/u,
  )
})

test('lounge system identity is stable; per-reply values move to the turn note', () => {
  const sofa = { id: 'sofa-1', title: '客厅' }
  const identity = loungeIdentity('api_syzygy', sofa)
  assert.doesNotMatch(identity, /当前时间：/u)
  assert.doesNotMatch(identity, /消息ID=/u)
  assert.equal(identity, loungeIdentity('api_syzygy', sofa))

  const note = loungeTurnNote(
    { sender_key: 'chuanchuan', id: 'msg-1' },
    new Date('2026-08-04T00:01:02.000Z'),
  )
  assert.match(note, /当前时间：2026\/8\/4 08:01:02（Asia\/Shanghai）/u)
  assert.match(note, /本次叫你接话的是 chuanchuan，消息ID=msg-1/u)
})

test('SSE accumulator keeps the usage chunk OpenRouter sends last', () => {
  const accumulator = new OpenAiSseAccumulator()
  accumulator.push('data: {"choices":[{"delta":{"content":"嗯"}}]}\n\n')
  accumulator.push(
    'data: {"choices":[],"usage":{"prompt_tokens":9000,"completion_tokens":800,"prompt_tokens_details":{"cached_tokens":7000}}}\n\n',
  )
  accumulator.push('data: [DONE]\n\n')
  accumulator.finish()
  assert.equal(accumulator.content, '嗯')
  assert.equal(accumulator.usage.prompt_tokens_details.cached_tokens, 7000)
})

test('usage rows read OpenRouter and Anthropic cache fields', () => {
  const row = buildLlmUsageRow(
    { module: 'chitchat', conversationId: 's1', model: 'anthropic/claude-opus-5.5' },
    {
      prompt_tokens: 9000,
      completion_tokens: 800,
      total_tokens: 9800,
      cost: 0.0123,
      prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 1500 },
    },
  )
  assert.equal(row.module, 'chitchat')
  assert.equal(row.conversation_id, 's1')
  assert.equal(row.cached_tokens, 7000)
  assert.equal(row.cache_write_tokens, 1500)
  assert.equal(row.cost_usd, 0.0123)

  const native = buildLlmUsageRow(
    { module: 'lounge' },
    { cache_read_input_tokens: 10, cache_creation_input_tokens: 20 },
  )
  assert.equal(native.cached_tokens, 10)
  assert.equal(native.cache_write_tokens, 20)
  assert.equal(buildLlmUsageRow({ module: 'lounge' }, null), null)
})

test('usage bookkeeping never throws into the reply path', async () => {
  const inserted = []
  await recordLlmUsage(
    { from: () => ({ insert: async (row) => { inserted.push(row); return { error: null } } }) },
    { module: 'lounge' },
    { prompt_tokens: 1 },
  )
  assert.equal(inserted.length, 1)

  await recordLlmUsage(
    { from: () => ({ insert: async () => { throw new Error('db down') } }) },
    { module: 'lounge' },
    { prompt_tokens: 1 },
  )
  await recordLlmUsage(
    { from: () => ({ insert: async () => ({ error: { message: 'denied' } }) }) },
    { module: 'lounge' },
    { prompt_tokens: 1 },
  )
})
