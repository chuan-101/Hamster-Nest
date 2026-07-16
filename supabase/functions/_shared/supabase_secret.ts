const ADMIN_SECRET_KEY_NAME = 'edge_functions_20260715'

const timingSafeEqual = (left: string, right: string): boolean => {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  if (leftBytes.length !== rightBytes.length) return false

  let diff = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index]
  }
  return diff === 0
}

const readSecretKeys = (): Record<string, string> => {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim()
  if (!raw) throw new Error('SUPABASE_SECRET_KEYS is not configured')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('SUPABASE_SECRET_KEYS is not valid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SUPABASE_SECRET_KEYS must be a JSON object')
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => [name, value.trim()])
      .filter(([, value]) => value.length > 0),
  )
}

export const getSupabaseAdminKey = (): string => {
  const key = readSecretKeys()[ADMIN_SECRET_KEY_NAME]
  if (!key || !key.startsWith('sb_secret_')) {
    throw new Error(`Supabase secret key ${ADMIN_SECRET_KEY_NAME} is not configured`)
  }
  return key
}

export const isApprovedSupabaseSecretKey = (candidate: string): boolean => {
  const normalized = candidate.trim()
  if (!normalized.startsWith('sb_secret_')) return false

  try {
    return timingSafeEqual(normalized, getSupabaseAdminKey())
  } catch {
    return false
  }
}
