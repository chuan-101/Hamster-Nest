// Daily usage guardrail (P1 · 1-3).
//
// Counts calls per (user, scope, Beijing day) via the consume_usage_quota
// SQL function and reports whether the caller is still within its limit.
// This is a cost guardrail, not an auth gate: on infrastructure errors it
// fails OPEN (logs loudly, allows the call) so a quota-table hiccup cannot
// brick chat or letters. Auth must already have been enforced by then.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const consumeQuota = async (
  scope: string,
  userId: string,
  dailyLimit: number,
): Promise<{ allowed: boolean; count: number | null }> => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data, error } = await supabase.rpc('consume_usage_quota', {
      p_user_id: userId,
      p_scope: scope,
    })
    if (error) {
      console.error(`quota check failed for ${scope}, allowing call`, error.message)
      return { allowed: true, count: null }
    }
    const count = typeof data === 'number' ? data : null
    return { allowed: count === null || count <= dailyLimit, count }
  } catch (err) {
    console.error(`quota check errored for ${scope}, allowing call`, String(err))
    return { allowed: true, count: null }
  }
}

export const quotaExceededResponse = (scope: string, extraHeaders: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ error: 'daily quota exceeded', scope }),
    { status: 429, headers: { 'Content-Type': 'application/json', ...extraHeaders } },
  )
