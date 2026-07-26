export const RUNTIME_CONTROL_ACTIONS = ['wake', 'sleep'] as const
export const RUNTIME_CONTROL_TARGET_ROLES = [
  'codex_cli_syzygy',
  'claude_code_cli_syzygy',
] as const

export type RuntimeControlAction = (typeof RUNTIME_CONTROL_ACTIONS)[number]
export type RuntimeControlTargetRole = (typeof RUNTIME_CONTROL_TARGET_ROLES)[number]

export type RuntimeControlRequest = {
  action: RuntimeControlAction
  target_role: RuntimeControlTargetRole
  client_id: string
  confirm_running_tasks: boolean
}

export type RuntimeControlPrepareResult = {
  schema_version: 1
  was_duplicate: boolean
  command: {
    id: string
    action: RuntimeControlAction
    target_role: RuntimeControlTargetRole
    status: 'pending' | 'running' | 'done' | 'failed'
    idempotency_key: string
    confirm_running_tasks: boolean
    created_at: string
    claimed_at: string | null
    completed_at: string | null
    error_message: string | null
  }
}

const RUNTIME_CONTROL_REQUEST_FIELDS = new Set([
  'action',
  'target_role',
  'client_id',
  'confirm_running_tasks',
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class RuntimeControlRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeControlRequestError'
  }
}

const normalizeEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!allowed.includes(normalized as T)) {
    throw new RuntimeControlRequestError(`${field} 不在允许范围内`)
  }
  return normalized as T
}

export const normalizeRuntimeControlRequest = (
  value: unknown,
): RuntimeControlRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeControlRequestError('请求体必须是 JSON object')
  }

  const input = value as Record<string, unknown>
  const unexpectedField = Object.keys(input).find(
    (field) => !RUNTIME_CONTROL_REQUEST_FIELDS.has(field),
  )
  if (unexpectedField) {
    throw new RuntimeControlRequestError(`不允许请求字段 ${unexpectedField}`)
  }
  const action = normalizeEnum(input.action, RUNTIME_CONTROL_ACTIONS, 'action')
  const targetRole = normalizeEnum(
    input.target_role,
    RUNTIME_CONTROL_TARGET_ROLES,
    'target_role',
  )
  if (typeof input.client_id !== 'string' || !UUID_PATTERN.test(input.client_id)) {
    throw new RuntimeControlRequestError('client_id 必须是 UUID')
  }
  if (
    input.confirm_running_tasks !== undefined &&
    typeof input.confirm_running_tasks !== 'boolean'
  ) {
    throw new RuntimeControlRequestError('confirm_running_tasks 必须是 boolean')
  }

  const confirmRunningTasks = input.confirm_running_tasks === true
  if (action === 'wake' && confirmRunningTasks) {
    throw new RuntimeControlRequestError(
      'confirm_running_tasks 只允许用于 sleep',
    )
  }

  return {
    action,
    target_role: targetRole,
    client_id: input.client_id.toLowerCase(),
    confirm_running_tasks: confirmRunningTasks,
  }
}

export const isRuntimeControlPrepareResult = (
  value: unknown,
): value is RuntimeControlPrepareResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const result = value as Record<string, unknown>
  const command = result.command as Record<string, unknown> | undefined
  return (
    result.schema_version === 1 &&
    typeof result.was_duplicate === 'boolean' &&
    Boolean(command) &&
    typeof command?.id === 'string' &&
    RUNTIME_CONTROL_ACTIONS.includes(command.action as RuntimeControlAction) &&
    RUNTIME_CONTROL_TARGET_ROLES.includes(
      command.target_role as RuntimeControlTargetRole,
    ) &&
    ['pending', 'running', 'done', 'failed'].includes(String(command.status)) &&
    typeof command.idempotency_key === 'string' &&
    typeof command.confirm_running_tasks === 'boolean'
  )
}

const ALLOWED_ORIGINS = [
  'https://chuan-101.github.io',
  /^http:\/\/localhost:\d+$/u,
  /^http:\/\/127\.0\.0\.1:\d+$/u,
]

export const isAllowedRuntimeControlOrigin = (origin: string | null) => {
  if (!origin) {
    return true
  }
  return ALLOWED_ORIGINS.some((candidate) =>
    typeof candidate === 'string' ? candidate === origin : candidate.test(origin)
  )
}

export const buildRuntimeControlCorsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})
