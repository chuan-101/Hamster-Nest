import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const authPage = readFileSync(new URL('../src/pages/AuthPage.tsx', import.meta.url), 'utf8')
const authErrors = readFileSync(new URL('../src/lib/authErrors.ts', import.meta.url), 'utf8')

test('single-tenant OTP login never attempts to create users', () => {
  assert.match(authPage, /signInWithOtp\(\{[\s\S]*shouldCreateUser:\s*false/)
})

test('web sign-out only clears the current browser session', () => {
  assert.match(authPage, /signOut\(\{\s*scope:\s*'local'\s*\}\)/)
  assert.doesNotMatch(authPage, /signOut\(\)/)
})

test('auth errors distinguish blocked signup from email rate limiting', () => {
  assert.match(authErrors, /signup_disabled/)
  assert.match(authErrors, /over_email_send_rate_limit/)
  assert.match(authErrors, /验证码邮件发送太频繁/)
  assert.match(authErrors, /这个邮箱不是小窝钥匙的持有者/)
})
