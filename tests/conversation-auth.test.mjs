import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyConversationUser } from '../supabase/functions/conversation-dispatch/auth.ts'

const headers = { apikey: 'test-public-key', Authorization: 'Bearer test-user-token' }
test('auth forwards credentials and returns only a reverified user', async () => {
  const result = await verifyConversationUser('https://example.com', headers, async (url, init) => {
    assert.equal(url.pathname, '/auth/v1/user')
    assert.deepEqual(init.headers, headers)
    assert.ok(init.signal instanceof AbortSignal)
    return Response.json({ id: 'owner' })
  })
  assert.deepEqual(result, { ok: true, userId: 'owner' })
})
test('temporary auth outage retries once and can recover', async () => {
  for (const status of [502, 503, 504, 'network']) {
    let calls = 0
    const result = await verifyConversationUser('https://example.com', headers, async () => {
      if (++calls === 2) return Response.json({ id: 'owner' })
      if (status === 'network') throw new TypeError('fetch failed')
      return new Response('unavailable', { status })
    })
    assert.equal(calls, 2)
    assert.deepEqual(result, { ok: true, userId: 'owner' })
  }
})
test('persistent outages fail closed with 503 instead of invalid-session', async () => {
  for (const status of [502, 503, 504, 'timeout']) {
    let calls = 0
    const result = await verifyConversationUser('https://example.com', headers, async () => {
      calls++
      if (status === 'timeout') throw new DOMException('Timed out', 'TimeoutError')
      return new Response(null, { status })
    })
    assert.equal(calls, 2)
    assert.equal(result.ok, false)
    assert.equal(result.status, 503)
    assert.equal(result.code, 'AUTH_SERVICE_UNAVAILABLE')
    assert.equal('userId' in result, false)
  }
})
test('rejected sessions are never retried or accepted', async () => {
  for (const status of [401, 403]) {
    let calls = 0
    const result = await verifyConversationUser('https://example.com', headers, async () => {
      calls++
      return new Response(null, { status })
    })
    assert.equal(calls, 1)
    assert.equal(result.status, 401)
    assert.equal(result.code, 'INVALID_SESSION')
  }
})
test('unexpected responses never authorize a message', async () => {
  for (const response of [Response.json({}), new Response('not JSON'), new Response(null, { status: 429 })]) {
    const result = await verifyConversationUser('https://example.com', headers, async () => response.clone())
    assert.equal(result.ok, false)
    assert.equal(result.status, 503)
  }
})
