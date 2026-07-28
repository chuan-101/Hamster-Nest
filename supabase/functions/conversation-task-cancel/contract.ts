const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class ConversationTaskCancelRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationTaskCancelRequestError'
  }
}

export const normalizeConversationTaskCancelRequest = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConversationTaskCancelRequestError('请求体必须是 JSON object')
  }
  const taskId = (value as Record<string, unknown>).task_id
  if (typeof taskId !== 'string' || !UUID_PATTERN.test(taskId)) {
    throw new ConversationTaskCancelRequestError('task_id 必须是 UUID')
  }
  return { task_id: taskId.toLowerCase() }
}

export const isConversationTaskCancelResult = (
  value: unknown,
): value is {
  schema_version: 1
  cancelled: boolean
  reason?: string
  command: { id: string; status: string }
  task: { id: string; status: string }
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  const command = result.command as Record<string, unknown> | undefined
  const task = result.task as Record<string, unknown> | undefined
  return (
    result.schema_version === 1 &&
    typeof result.cancelled === 'boolean' &&
    Boolean(command && typeof command.id === 'string' && typeof command.status === 'string') &&
    Boolean(task && typeof task.id === 'string' && typeof task.status === 'string')
  )
}
