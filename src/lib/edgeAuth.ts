import { supabase } from '../supabase/client'

// Mixed-mode Edge Functions verify credentials in their handlers. Direct
// user calls carry the session JWT plus the public project API key.
export const buildEdgeAuthHeaders = async (): Promise<Record<string, string> | null> => {
  if (!supabase) {
    return null
  }
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  const publicApiKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!accessToken || !publicApiKey) {
    return null
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: publicApiKey,
  }
}
