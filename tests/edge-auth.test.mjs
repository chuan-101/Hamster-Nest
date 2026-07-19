import assert from 'node:assert/strict'
import test from 'node:test'

const env = new Map()
globalThis.Deno = {
  env: {
    get: (name) => env.get(name),
  },
}

const EDGE_KEY = 'sb_secret_edge_1234567890'
const MINI_KEY = 'sb_secret_mini_1234567890'

const { getSupabaseAdminKey, isApprovedSupabaseSecretKey } = await import(
  '../supabase/functions/_shared/supabase_secret.ts'
)
const { verifyAuth } = await import('../supabase/functions/_shared/auth.ts')
const { getOwnerUserId, requireUuidEnv } = await import(
  '../supabase/functions/_shared/owner.ts'
)
const { isMcpKeyAuthorized } = await import(
  '../supabase/functions/_shared/mcp_key_auth.ts'
)

const configureSecretKeys = () => {
  env.set(
    'SUPABASE_SECRET_KEYS',
    JSON.stringify({
      edge_functions_20260715: EDGE_KEY,
      mac_mini_runtime_20260715: MINI_KEY,
    }),
  )
}

test('admin client selects only the named Edge key', () => {
  configureSecretKeys()
  assert.equal(getSupabaseAdminKey(), EDGE_KEY)
})

test('machine auth accepts the Edge key and rejects other project secret keys', async () => {
  configureSecretKeys()
  assert.equal(isApprovedSupabaseSecretKey(EDGE_KEY), true)
  assert.equal(isApprovedSupabaseSecretKey(MINI_KEY), false)
  assert.equal(isApprovedSupabaseSecretKey('sb_secret_unknown_123456'), false)

  assert.equal(
    await verifyAuth(new Request('https://example.test', { headers: { apikey: EDGE_KEY } })),
    true,
  )
  assert.equal(
    await verifyAuth(new Request('https://example.test', { headers: { apikey: MINI_KEY } })),
    false,
  )
})

test('user JWT auth remains available with a public project key', async () => {
  configureSecretKeys()
  env.set('SUPABASE_URL', 'https://project.test')
  const originalFetch = globalThis.fetch
  let forwardedHeaders
  globalThis.fetch = async (_url, init) => {
    forwardedHeaders = init?.headers
    return new Response(null, { status: 200 })
  }

  try {
    const request = new Request('https://example.test', {
      headers: {
        apikey: 'sb_publishable_public_123456',
        Authorization: 'Bearer user-session-jwt',
      },
    })
    assert.equal(await verifyAuth(request), true)
    assert.equal(forwardedHeaders.apikey, 'sb_publishable_public_123456')
    assert.equal(forwardedHeaders.Authorization, 'Bearer user-session-jwt')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('missing or malformed secret configuration fails closed', async () => {
  env.delete('SUPABASE_SECRET_KEYS')
  assert.equal(isApprovedSupabaseSecretKey(EDGE_KEY), false)
  assert.throws(() => getSupabaseAdminKey(), /SUPABASE_SECRET_KEYS is not configured/)
  assert.equal(
    await verifyAuth(new Request('https://example.test', { headers: { apikey: EDGE_KEY } })),
    false,
  )

  env.set('SUPABASE_SECRET_KEYS', '{invalid')
  assert.equal(isApprovedSupabaseSecretKey(EDGE_KEY), false)
})

test('owner identifiers are required UUID environment values', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001'
  const aabUserId = '00000000-0000-4000-8000-000000000002'
  env.set('HAMSTER_OWNER_USER_ID', ownerId)
  env.set('AAB_USER_ID', aabUserId)
  assert.equal(getOwnerUserId(), ownerId)
  assert.equal(requireUuidEnv('AAB_USER_ID'), aabUserId)

  env.set('HAMSTER_OWNER_USER_ID', 'not-a-uuid')
  assert.throws(() => getOwnerUserId(), /HAMSTER_OWNER_USER_ID is not configured as a UUID/)
})

test('MCP key auth prefers a header while retaining legacy query compatibility', () => {
  const key = 'mcp-secret-for-test'
  assert.equal(
    isMcpKeyAuthorized(new Request('https://example.test/mcp', {
      headers: { 'x-hamster-mcp-key': key },
    }), key),
    true,
  )
  assert.equal(
    isMcpKeyAuthorized(new Request(`https://example.test/mcp?key=${encodeURIComponent(key)}`), key),
    true,
  )
  assert.equal(
    isMcpKeyAuthorized(new Request('https://example.test/mcp', {
      headers: { 'x-hamster-mcp-key': 'wrong' },
    }), key),
    false,
  )
})
