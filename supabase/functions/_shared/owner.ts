const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const requireUuidEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim() ?? ''
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} is not configured as a UUID`)
  }
  return value
}

export const getOwnerUserId = (): string => requireUuidEnv('HAMSTER_OWNER_USER_ID')
