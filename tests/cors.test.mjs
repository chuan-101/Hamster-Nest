import assert from 'node:assert/strict'
import test from 'node:test'

const { isAllowedBrowserOrigin, parseAllowedOrigins } = await import(
  '../supabase/functions/_shared/cors.ts'
)

test('default browser origins stay allowed without extra configuration', () => {
  assert.equal(isAllowedBrowserOrigin('https://chuan-101.github.io', []), true)
  assert.equal(isAllowedBrowserOrigin('http://localhost:5173', []), true)
  assert.equal(isAllowedBrowserOrigin('http://127.0.0.1:4173', []), true)
  assert.equal(isAllowedBrowserOrigin('https://someone.github.io', []), false)
  assert.equal(isAllowedBrowserOrigin('https://chuan-101.github.io.evil.example', []), false)
})

test('HAMSTER_ALLOWED_ORIGINS adds exact fork origins', () => {
  const extra = parseAllowedOrigins(' https://someone.github.io/ ,, https://nest.example.com ')
  assert.deepEqual(extra, ['https://someone.github.io', 'https://nest.example.com'])
  assert.equal(isAllowedBrowserOrigin('https://someone.github.io', extra), true)
  assert.equal(isAllowedBrowserOrigin('https://nest.example.com', extra), true)
  assert.equal(isAllowedBrowserOrigin('https://someone.github.io.evil.example', extra), false)
})

test('missing configuration yields no extra origins', () => {
  assert.deepEqual(parseAllowedOrigins(undefined), [])
  assert.deepEqual(parseAllowedOrigins(''), [])
})
