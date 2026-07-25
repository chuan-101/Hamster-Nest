import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  createConversationDispatchClient,
  ConversationDispatchError,
  ConversationDispatchTimeoutError,
} = await import('../src/lib/conversation-dispatch-client.ts')
const { runConversationCanary } = await import(
  '../src/lib/conversation-canary-runner.ts'
)

const canonicalResponse = (status, suffix = '') => ({
  status,
  userMessageId: `00000000-0000-4000-8000-000000000003${suffix}`,
  replyId: '00000000-0000-4000-8000-000000000004',
})

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

test('canary waits past duplicate 202 responses until one retry completes', async () => {
  let callCount = 0
  const dispatch = async () => {
    callCount += 1
    if (callCount === 1) {
      throw Object.assign(new Error('timed out'), { code: 'CLIENT_TIMEOUT' })
    }
    return canonicalResponse(callCount === 4 ? 200 : 202)
  }

  const result = await runConversationCanary({
    dispatch,
    request: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      clientId: '00000000-0000-4000-8000-000000000002',
      content: 'timeout reconciliation',
    },
    sleep: async () => {},
    maxRounds: 2,
  })

  assert.equal(callCount, 5)
  assert.equal(result.rounds, 2)
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    [200, 202],
  )
})

test('canary rejects mismatched canonical ids and 202-only false positives', async () => {
  let mismatchCalls = 0
  const mismatchDispatch = async () => {
    mismatchCalls += 1
    if (mismatchCalls === 1) {
      throw Object.assign(new Error('timed out'), { code: 'CLIENT_TIMEOUT' })
    }
    return canonicalResponse(200, mismatchCalls === 3 ? '-mismatch' : '')
  }

  await assert.rejects(
    runConversationCanary({
      dispatch: mismatchDispatch,
      request: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        clientId: '00000000-0000-4000-8000-000000000002',
        content: 'mismatch',
      },
      sleep: async () => {},
      maxRounds: 1,
    }),
    /不同的 canonical message IDs/u,
  )

  let generatingCalls = 0
  await assert.rejects(
    runConversationCanary({
      dispatch: async () => {
        generatingCalls += 1
        if (generatingCalls === 1) {
          throw Object.assign(new Error('timed out'), {
            code: 'CLIENT_TIMEOUT',
          })
        }
        return canonicalResponse(202)
      },
      request: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        clientId: '00000000-0000-4000-8000-000000000002',
        content: 'still generating',
      },
      sleep: async () => {},
      maxRounds: 2,
    }),
    /补账未等到 completed 响应/u,
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
  assert.match(canary, /initialTimeoutMs: TIMEOUT_MS/u)
  assert.match(canary, /runConversationCanary/u)
})
