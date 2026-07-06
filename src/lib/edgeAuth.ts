import { supabase } from '../supabase/client'

// Edge Functions re-verify the caller's JWT internally (the gateway cannot
// verify ES256 tokens), so every direct fetch to /functions/v1/* must carry
// the session token plus the anon key, mirroring the openrouter-chat calls.
export const buildEdgeAuthHeaders = async (): Promise<Record<string, string> | null> => {
  if (!supabase) {
    return null
  }
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!accessToken || !anonKey) {
    return null
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
  }
}
