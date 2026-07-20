import { isAuthApiError } from '@supabase/supabase-js'

/** Map Supabase Auth failures to useful owner-facing copy without exposing raw internals. */
export const friendlyAuthError = (error: unknown, fallback: string): string => {
  if (isAuthApiError(error)) {
    if (error.code === 'otp_expired') {
      return '验证码错误或已过期，请重新获取。'
    }
    if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
      return '验证码邮件发送太频繁，请稍后再试。'
    }
    if (
      error.code === 'signup_disabled' ||
      error.code === 'otp_disabled' ||
      error.message.includes('Signups not allowed')
    ) {
      return '这个邮箱不是小窝钥匙的持有者。'
    }
  }
  if (
    error instanceof Error &&
    (error.message.includes('Network request failed') || error.message.includes('Failed to fetch'))
  ) {
    return '网络不给力，请检查连接后重试。'
  }
  return fallback
}
