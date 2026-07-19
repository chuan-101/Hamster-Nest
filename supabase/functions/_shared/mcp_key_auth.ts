const timingSafeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  if (leftBytes.length !== rightBytes.length) return false
  let diff = 0
  for (let index = 0; index < leftBytes.length; index += 1) diff |= leftBytes[index] ^ rightBytes[index]
  return diff === 0
}

export const isMcpKeyAuthorized = (req: Request, expectedKey: string): boolean => {
  if (!expectedKey) return false

  const providedHeaderKey = req.headers.get('x-hamster-mcp-key')?.trim() ?? ''
  if (providedHeaderKey && timingSafeEqual(providedHeaderKey, expectedKey)) return true

  // Transitional compatibility for existing custom apps. New clients must use
  // x-hamster-mcp-key so credentials never appear in request URLs or access logs.
  const providedLegacyKey = new URL(req.url).searchParams.get('key')
  return Boolean(providedLegacyKey && timingSafeEqual(providedLegacyKey, expectedKey))
}
