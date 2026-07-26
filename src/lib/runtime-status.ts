import {
  RUNTIME_CONTROL_TARGET_ROLES,
  type RuntimeControlTargetRole,
} from './runtime-control-client.ts'

export const RUNTIME_STATUSES = [
  'offline',
  'waking',
  'idle',
  'busy',
  'closing',
  'error',
  'unknown',
] as const

export type RuntimeStatus = (typeof RUNTIME_STATUSES)[number]

export type RuntimeRoleStatus = {
  status: RuntimeStatus
  enabled: boolean | null
  instanceId: string | null
  activeCommandId: string | null
  activeTaskId: string | null
  lastError: string | null
  changedAt: string | null
}

export type RuntimeStatusSnapshot = {
  schemaVersion: 1
  lastSeenAt: string | null
  reportedAt: string | null
  isFresh: boolean
  roles: Record<RuntimeControlTargetRole, RuntimeRoleStatus>
}

const unknownRoleStatus = (): RuntimeRoleStatus => ({
  status: 'unknown',
  enabled: null,
  instanceId: null,
  activeCommandId: null,
  activeTaskId: null,
  lastError: null,
  changedAt: null,
})

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const textOrNull = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const normalizeRuntimeStatusSnapshot = (
  row: { last_seen_at?: unknown; heartbeat_data?: unknown } | null,
  options: { nowMs?: number; staleAfterMs?: number } = {},
): RuntimeStatusSnapshot => {
  const nowMs = options.nowMs ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? 150_000
  const lastSeenAt = textOrNull(row?.last_seen_at)
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN
  const isFresh =
    Number.isFinite(lastSeenMs) &&
    nowMs - lastSeenMs >= 0 &&
    nowMs - lastSeenMs <= staleAfterMs
  const heartbeat = objectValue(row?.heartbeat_data)
  const runtimeStatuses = objectValue(heartbeat?.runtime_statuses)
  const rolesValue = objectValue(runtimeStatuses?.roles)

  const roles = Object.fromEntries(
    RUNTIME_CONTROL_TARGET_ROLES.map((role) => {
      if (!isFresh || runtimeStatuses?.version !== 1) {
        return [role, unknownRoleStatus()]
      }
      const raw = objectValue(rolesValue?.[role])
      const rawStatus = textOrNull(raw?.status)
      const status = RUNTIME_STATUSES.includes(rawStatus as RuntimeStatus)
        ? (rawStatus as RuntimeStatus)
        : 'unknown'
      return [
        role,
        {
          status,
          enabled:
            typeof raw?.enabled === 'boolean' ? raw.enabled : null,
          instanceId: textOrNull(raw?.instance_id),
          activeCommandId: textOrNull(raw?.active_command_id),
          activeTaskId: textOrNull(raw?.active_task_id),
          lastError: textOrNull(raw?.last_error),
          changedAt: textOrNull(raw?.changed_at),
        },
      ]
    }),
  ) as Record<RuntimeControlTargetRole, RuntimeRoleStatus>

  return {
    schemaVersion: 1,
    lastSeenAt,
    reportedAt: textOrNull(runtimeStatuses?.reported_at),
    isFresh,
    roles,
  }
}
