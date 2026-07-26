export const RUNTIME_CONTROL_ACTIONS = ['wake', 'sleep'] as const
export const RUNTIME_CONTROL_TARGET_ROLES = [
  'codex_cli_syzygy',
  'claude_code_cli_syzygy',
] as const

export type RuntimeControlAction = (typeof RUNTIME_CONTROL_ACTIONS)[number]
export type RuntimeControlTargetRole =
  (typeof RUNTIME_CONTROL_TARGET_ROLES)[number]

export type RuntimeControlRequest = {
  action: RuntimeControlAction
  targetRole: RuntimeControlTargetRole
  clientId: string
  confirmRunningTasks?: boolean
}

export type RuntimeControlCommand = {
  id: string
  action: RuntimeControlAction
  targetRole: RuntimeControlTargetRole
  status: 'pending' | 'running' | 'done' | 'failed'
  idempotencyKey: string
  confirmRunningTasks: boolean
  createdAt: string
  claimedAt: string | null
  completedAt: string | null
  errorMessage: string | null
}

export type RuntimeControlResponse = {
  httpStatus: number
  schemaVersion: 1
  wasDuplicate: boolean
  command: RuntimeControlCommand
}

export type RuntimeControlOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

export type RuntimeControlClientConfig = {
  endpointUrl: string
  publishableKey: string
  getAccessToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

export class RuntimeControlError extends Error {
  readonly status: number | null
  readonly code: string | null

  constructor(
    message: string,
    options: { status?: number | null; code?: string | null } = {},
  ) {
    super(message)
    this.name = 'RuntimeControlError'
    this.status = options.status ?? null
    this.code = options.code ?? null
  }
}

export class RuntimeControlTimeoutError extends RuntimeControlError {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super('Runtime 控制请求超时；可使用原 clientId 补账', {
      code: 'CLIENT_TIMEOUT',
    })
    this.name = 'RuntimeControlTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

const serializeRequest = (request: RuntimeControlRequest) => ({
  action: request.action,
  target_role: request.targetRole,
  client_id: request.clientId,
  confirm_running_tasks: request.confirmRunningTasks === true,
})

const parseJsonObject = (bodyText: string) => {
  try {
    const value = JSON.parse(bodyText) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const parseCommand = (
  value: unknown,
): RuntimeControlCommand | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const command = value as Record<string, unknown>
  if (
    typeof command.id !== 'string' ||
    !RUNTIME_CONTROL_ACTIONS.includes(command.action as RuntimeControlAction) ||
    !RUNTIME_CONTROL_TARGET_ROLES.includes(
      command.target_role as RuntimeControlTargetRole,
    ) ||
    !['pending', 'running', 'done', 'failed'].includes(
      String(command.status),
    ) ||
    typeof command.idempotency_key !== 'string' ||
    typeof command.confirm_running_tasks !== 'boolean'
  ) {
    return null
  }
  return {
    id: command.id,
    action: command.action as RuntimeControlAction,
    targetRole: command.target_role as RuntimeControlTargetRole,
    status: command.status as RuntimeControlCommand['status'],
    idempotencyKey: command.idempotency_key,
    confirmRunningTasks: command.confirm_running_tasks,
    createdAt: typeof command.created_at === 'string' ? command.created_at : '',
    claimedAt:
      typeof command.claimed_at === 'string' ? command.claimed_at : null,
    completedAt:
      typeof command.completed_at === 'string' ? command.completed_at : null,
    errorMessage:
      typeof command.error_message === 'string'
        ? command.error_message
        : null,
  }
}

const parseResponse = (
  bodyText: string,
  httpStatus: number,
): RuntimeControlResponse | null => {
  const body = parseJsonObject(bodyText)
  const command = parseCommand(body?.command)
  if (body?.schema_version !== 1 || typeof body.was_duplicate !== 'boolean' || !command) {
    return null
  }
  return {
    httpStatus,
    schemaVersion: 1,
    wasDuplicate: body.was_duplicate,
    command,
  }
}

export const createRuntimeControlClient = (
  config: RuntimeControlClientConfig,
) => {
  const fetchImpl = config.fetchImpl ?? fetch

  return async (
    request: RuntimeControlRequest,
    options: RuntimeControlOptions = {},
  ): Promise<RuntimeControlResponse> => {
    const timeoutMs = options.timeoutMs ?? 15_000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RuntimeControlError('timeoutMs 必须是正数', {
        code: 'INVALID_TIMEOUT',
      })
    }
    if (
      request.action === 'wake' &&
      request.confirmRunningTasks === true
    ) {
      throw new RuntimeControlError(
        'confirmRunningTasks 只允许用于 sleep',
        { code: 'INVALID_CONFIRMATION' },
      )
    }

    const accessToken = await config.getAccessToken()
    if (!accessToken) {
      throw new RuntimeControlError('登录状态异常，请重新登录', {
        status: 401,
        code: 'MISSING_SESSION',
      })
    }

    const controller = new AbortController()
    let didTimeout = false
    const relayAbort = () => controller.abort()
    options.signal?.addEventListener('abort', relayAbort, { once: true })
    if (options.signal?.aborted) {
      controller.abort()
    }
    const timeout = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetchImpl(config.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: config.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serializeRequest(request)),
        signal: controller.signal,
      })
      const bodyText = await response.text()
      const parsed = parseResponse(bodyText, response.status)
      if (parsed) {
        return parsed
      }

      const errorPayload = parseJsonObject(bodyText)
      throw new RuntimeControlError(
        typeof errorPayload?.error === 'string'
          ? errorPayload.error
          : `Runtime 控制请求失败（HTTP ${response.status}）`,
        {
          status: response.status,
          code:
            typeof errorPayload?.code === 'string'
              ? errorPayload.code
              : null,
        },
      )
    } catch (error) {
      if (didTimeout) {
        throw new RuntimeControlTimeoutError(timeoutMs)
      }
      if (error instanceof RuntimeControlError) {
        throw error
      }
      if (controller.signal.aborted) {
        throw new RuntimeControlError('Runtime 控制请求已取消', {
          code: 'CLIENT_ABORTED',
        })
      }
      throw new RuntimeControlError('Runtime 控制入口暂时无法连接', {
        code: 'NETWORK_ERROR',
      })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', relayAbort)
    }
  }
}
