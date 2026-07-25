import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  createConversationDispatchClient,
  ConversationDispatchError,
  ConversationDispatchTimeoutError,
} = await import('../src/lib/conversation-dispatch-client.ts')

test('authenticated dispatch keeps the caller client id stable on concurrent requests', async () => {
  const bodies = []
  const dispatch = createConversationDispatchClient({
    endpointUrl: 'https://example.test/functions/v1/conversation-dispatch',
    publishableKey: 'publishable-test-key',
    getAccessToken: async () => 'access-token',
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return new Response(
        JSON.stringify({
          schema_version: 1,
          handler: 'api',
          should_execute: false,
          was_duplicate: true,
        }),
        {
          status: 202,
          headers: {
            'content-type': 'application/json',
            'x-conversation-user-message-id':
              '00000000-0000-4000-8000-000000000003',
            'x-conversation-reply-id': '00000000-0000-4000-8000-000000000004',
          },
        },
      )
    },
  })
  const request = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    clientId: '00000000-0000-4000-8000-000000000002',
    content: '并发幂等 canary',
    clientCreatedAt: '2026-07-25T12:00:00.000Z',
  }

  const [first, second] = await Promise.all([
    dispatch(request),
    dispatch(request),
  ])

  assert.equal(bodies.length, 2)
  assert.deepEqual(bodies[0], bodies[1])
  assert.equal(bodies[0].client_id, request.clientId)
  assert.equal(first.userMessageId, second.userMessageId)
  assert.equal(first.replyId, second.replyId)
})

test('client timeout is explicit and preserves retry responsibility with the caller', async () => {
  const dispatch = createConversationDispatchClient({
    endpointUrl: 'https://example.test/functions/v1/conversation-dispatch',
    publishableKey: 'publishable-test-key',
    getAccessToken: async () => 'access-token',
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      }),
  })

  await assert.rejects(
    dispatch(
      {
        sessionId: '00000000-0000-4000-8000-000000000001',
        clientId: '00000000-0000-4000-8000-000000000002',
        content: 'timeout canary',
      },
      { timeoutMs: 5 },
    ),
    (error) => {
      assert.ok(error instanceof ConversationDispatchTimeoutError)
      assert.equal(error.code, 'CLIENT_TIMEOUT')
      assert.equal(error.timeoutMs, 5)
      return true
    },
  )
})

test('HTTP failures preserve canonical ids for safe reconciliation', async () => {
  const dispatch = createConversationDispatchClient({
    endpointUrl: 'https://example.test/functions/v1/conversation-dispatch',
    publishableKey: 'publishable-test-key',
    getAccessToken: async () => 'access-token',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ error: '回复仍在生成', code: 'REPLY_GENERATING' }),
        {
          status: 409,
          headers: {
            'content-type': 'application/json',
            'x-conversation-user-message-id':
              '00000000-0000-4000-8000-000000000003',
            'x-conversation-reply-id': '00000000-0000-4000-8000-000000000004',
          },
        },
      ),
  })

  await assert.rejects(
    dispatch({
      sessionId: '00000000-0000-4000-8000-000000000001',
      clientId: '00000000-0000-4000-8000-000000000002',
      content: 'retry canary',
    }),
    (error) => {
      assert.ok(error instanceof ConversationDispatchError)
      assert.equal(error.status, 409)
      assert.equal(error.code, 'REPLY_GENERATING')
      assert.equal(error.userMessageId, '00000000-0000-4000-8000-000000000003')
      assert.equal(error.replyId, '00000000-0000-4000-8000-000000000004')
      return true
    },
  )
})

test('Web wrapper uses the existing browser session and leaves legacy daily chat untouched', async () => {
  const [wrapper, app, canary] = await Promise.all([
    readFile(
      new URL('../src/storage/conversationDispatch.ts', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/pages/ConversationCanaryPage.tsx', import.meta.url),
      'utf8',
    ),
  ])

  assert.match(wrapper, /client\.auth\.getSession\(\)/u)
  assert.match(wrapper, /functions\/v1\/conversation-dispatch/u)
  assert.doesNotMatch(wrapper, /service[_-]?role/iu)
  assert.match(app, /functions\/v1\/openrouter-chat/u)
  assert.doesNotMatch(app, /functions\/v1\/conversation-dispatch/u)
  assert.match(app, /path="\/conversation-canary"/u)
  assert.match(canary, /timeoutMs: TIMEOUT_MS/u)
  assert.match(canary, /Promise\.allSettled\(\[/u)
  assert.match(canary, /dispatchConversation\(retryRequest\)/u)
  assert.match(canary, /retryFailed: true/u)
})
