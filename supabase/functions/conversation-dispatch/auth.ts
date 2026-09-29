type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 503; code: string; error: string }

// Recheck with GoTrue; never accept decoded JWT claims as authorization.
// Only the read-only auth request is retried, before any message/task writes.
export async function verifyConversationUser(
  supabaseUrl: string,
  headers: { apikey: string; Authorization: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(new URL('/auth/v1/user', supabaseUrl), {
        headers,
        signal: AbortSignal.timeout(4000),
      })
      if (response.ok) {
        const data = await response.json()
        if (typeof data?.id === 'string' && data.id) return { ok: true, userId: data.id }
        break
      }
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403) {
        return { ok: false, status: 401, code: 'INVALID_SESSION', error: '登录状态已失效，请重新登录' }
      }
      if (![502, 503, 504].includes(response.status)) break
    } catch {
      // Network errors/timeouts can recover on the one bounded retry.
    }
  }
  return {
    ok: false,
    status: 503,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    error: '登录验证服务暂时不可用，请稍后重试；无需退出登录',
  }
}
