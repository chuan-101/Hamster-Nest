// Shared fail-closed auth helpers for Edge Functions.
//
// Accepted credentials:
//   1. a configured sb_secret_ key in the apikey header — machine callers;
//   2. a real user JWT, re-verified against GoTrue via /auth/v1/user — the
//      web frontend. The gateway cannot verify ES256 tokens (see
//      supabase/config.toml), so functions must re-verify here.
//
// The public anon key is NOT an accepted credential: it ships inside the
// frontend bundle and must be treated as a public constant. GoTrue rejects
// it at /auth/v1/user because it carries no user claims.

import { isConfiguredSupabaseSecretKey } from './supabase_secret.ts'

export const timingSafeEqual = (a: string, b: string): boolean => {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

export const getBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  return token.length > 0 ? token : null
}

export const isVerifiedUserJwt = async (req: Request): Promise<boolean> => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!apikey) return false
  try {
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey, Authorization: authHeader },
    })
    return authResponse.ok
  } catch {
    return false
  }
}

// Configured secret API key or verified user JWT. Secret keys are checked
// against SUPABASE_SECRET_KEYS, never by prefix alone.
export const verifyAuth = async (req: Request): Promise<boolean> => {
  const apiKey = req.headers.get('apikey')?.trim()
  if (apiKey && isConfiguredSupabaseSecretKey(apiKey)) return true

  const token = getBearerToken(req)
  if (!token) return false
  return await isVerifiedUserJwt(req)
}

// Shared-secret header check for machine callers that hold no Supabase key
// (e.g. the iOS Shortcut reporting device status). Fails closed when either
// the header or the expected env value is missing.
export const verifySharedSecret = (req: Request, headerName: string, envName: string): boolean => {
  const provided = req.headers.get(headerName)?.trim()
  const expected = Deno.env.get(envName)?.trim()
  if (!provided || !expected) return false
  return timingSafeEqual(provided, expected)
}
