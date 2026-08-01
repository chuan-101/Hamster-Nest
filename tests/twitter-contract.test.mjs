import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  countTweetCharacters,
  isTwitterPostJob,
  MAX_TWEET_TEXT_LENGTH,
  normalizeTweetRequest,
  tweetRequestIdempotencyKey,
  TWITTER_COMMAND_TYPE,
} = await import('../supabase/functions/hamster-print-mcp/twitter_contract.ts')

test('tweet contract builds the exact Mac mini OpenCLI payload', async () => {
  const result = await normalizeTweetRequest({
    text: ' 第一行\r\n\r\n第二行 ',
    request_id: 'august-first-2026-v1',
  })

  assert.equal(TWITTER_COMMAND_TYPE, 'browser_opencli')
  assert.equal(result.idempotencyKey, 'twitter:v1:request:august-first-2026-v1')
  assert.deepEqual(result.payload, {
    platform: 'twitter',
    action: 'post',
    text: '第一行\n\n第二行',
  })
})

test('automatic tweet idempotency is stable for normalized same-day content', async () => {
  const now = new Date('2026-08-01T12:00:00.000Z')
  const first = await normalizeTweetRequest({ text: '八月好。\r\n继续爱你。' }, now)
  const second = await normalizeTweetRequest({ text: '  八月好。\n继续爱你。  ' }, now)

  assert.equal(first.idempotencyKey, second.idempotencyKey)
  assert.match(first.idempotencyKey, /^twitter:v1:auto:2026-08-01:[0-9a-f]{32}$/u)
})

test('tweet request ids are normalized and duplicate override is explicit', async () => {
  assert.equal(
    tweetRequestIdempotencyKey('  codex:tweet_2026-08-01.1  '),
    'twitter:v1:request:codex:tweet_2026-08-01.1',
  )
  assert.throws(() => tweetRequestIdempotencyKey('   '), /request_id 不能为空/u)
  assert.throws(() => tweetRequestIdempotencyKey('bad request id'), /request_id 只能包含/u)

  const first = await normalizeTweetRequest({ text: '同一正文', allow_duplicate: true })
  const second = await normalizeTweetRequest({ text: '同一正文', allow_duplicate: true })
  assert.notEqual(first.idempotencyKey, second.idempotencyKey)
  assert.match(first.idempotencyKey, /^twitter:v1:duplicate:/u)
})

test('tweet contract counts Unicode code points and rejects empty or oversized text', async () => {
  assert.equal(countTweetCharacters('🐹'), 1)
  assert.equal(countTweetCharacters('仓鼠'), 2)
  await assert.rejects(() => normalizeTweetRequest({ text: '   ' }), /text 不能为空/u)
  await assert.rejects(
    () => normalizeTweetRequest({ text: '字'.repeat(MAX_TWEET_TEXT_LENGTH + 1) }),
    /text 最长/u,
  )
})

test('tweet status guard only accepts Twitter post jobs', () => {
  assert.equal(isTwitterPostJob({ payload: { platform: 'twitter', action: 'post' } }), true)
  assert.equal(isTwitterPostJob({ payload: { platform: 'twitter', action: 'read' } }), false)
  assert.equal(isTwitterPostJob({ payload: { platform: 'printer', action: 'post' } }), false)
  assert.equal(isTwitterPostJob(null), false)
})

test('hamster-print MCP exposes confirmed tweet tools with owner-scoped status reads', async () => {
  const source = await readFile(
    new URL('../supabase/functions/hamster-print-mcp/index.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /registerTool\('post_tweet'/u)
  assert.match(source, /registerTool\('get_tweet_status'/u)
  assert.match(source, /confirmed:\s*z\.literal\(true\)/u)
  assert.match(source, /\.eq\('user_id', USER_ID\)[\s\S]*?\.eq\('command_type', TWITTER_COMMAND_TYPE\)/u)
  assert.match(source, /!data \|\| !isTwitterPostJob\(data\)/u)
  assert.doesNotMatch(source, /opencliCommand|shellCommand|execCommand/iu)
})
