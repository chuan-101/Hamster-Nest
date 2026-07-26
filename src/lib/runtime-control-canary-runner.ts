import type {
  RuntimeControlRequest,
  RuntimeControlResponse,
  RuntimeControlTargetRole,
} from './runtime-control-client.ts'
import type { RuntimeStatus, RuntimeStatusSnapshot } from './runtime-status.ts'

export type RuntimeControlCanaryResult = {
  targetRole: RuntimeControlTargetRole
  wakeCommandId: string
  sleepCommandId: string
  wakeStatus: RuntimeStatus
  sleepStatus: RuntimeStatus
}

type RuntimeControlCanaryInput = {
  control: (
    request: RuntimeControlRequest,
  ) => Promise<RuntimeControlResponse>
  loadSnapshot: () => Promise<RuntimeStatusSnapshot>
  sleep: (milliseconds: number) => Promise<unknown>
  targetRole: RuntimeControlTargetRole
  wakeClientId: string
  sleepClientId: string
  maxPolls?: number
  pollDelayMs?: number
}

const requireMatchingCommand = (
  action: 'wake' | 'sleep',
  responses: RuntimeControlResponse[],
) => {
  const commandIds = new Set(responses.map((response) => response.command.id))
  if (commandIds.size !== 1) {
    throw new Error(`${action} 并发请求返回了不同 command IDs`)
  }
  const failed = responses.find(
    (response) => response.command.status === 'failed',
  )
  if (failed) {
    throw new Error(
      failed.command.errorMessage || `${action} command 已失败`,
    )
  }
  return responses[0].command.id
}

const waitForStatus = async ({
  loadSnapshot,
  sleep,
  targetRole,
  accepted,
  maxPolls,
  pollDelayMs,
}: Pick<
  RuntimeControlCanaryInput,
  'loadSnapshot' | 'sleep' | 'targetRole'
> & {
  accepted: RuntimeStatus[]
  maxPolls: number
  pollDelayMs: number
}) => {
  let lastStatus: RuntimeStatus = 'unknown'
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const snapshot = await loadSnapshot()
    lastStatus = snapshot.roles[targetRole].status
    if (snapshot.isFresh && accepted.includes(lastStatus)) {
      return lastStatus
    }
    await sleep(pollDelayMs)
  }
  throw new Error(
    `Runtime 心跳未收敛到 ${accepted.join('/')}，最后状态为 ${lastStatus}`,
  )
}

const waitForDoneCommand = async ({
  control,
  request,
  commandId,
  sleep,
  maxPolls,
  pollDelayMs,
}: Pick<RuntimeControlCanaryInput, 'control' | 'sleep'> & {
  request: RuntimeControlRequest
  commandId: string
  maxPolls: number
  pollDelayMs: number
}) => {
  let lastStatus: RuntimeControlResponse['command']['status'] = 'pending'
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const response = await control(request)
    if (response.command.id !== commandId) {
      throw new Error(`${request.action} 补账返回了不同 command ID`)
    }
    lastStatus = response.command.status
    if (lastStatus === 'failed') {
      throw new Error(
        response.command.errorMessage || `${request.action} command 已失败`,
      )
    }
    if (lastStatus === 'done') {
      if (response.httpStatus !== 200) {
        throw new Error(
          `${request.action} command 已完成但未返回 HTTP 200`,
        )
      }
      return
    }
    await sleep(pollDelayMs)
  }
  throw new Error(
    `${request.action} command 未收敛到 done，最后状态为 ${lastStatus}`,
  )
}

export const runRuntimeControlCanary = async ({
  control,
  loadSnapshot,
  sleep,
  targetRole,
  wakeClientId,
  sleepClientId,
  maxPolls = 60,
  pollDelayMs = 500,
}: RuntimeControlCanaryInput): Promise<RuntimeControlCanaryResult> => {
  const wakeRequest: RuntimeControlRequest = {
    action: 'wake',
    targetRole,
    clientId: wakeClientId,
  }
  const wakeResponses = await Promise.all([
    control(wakeRequest),
    control(wakeRequest),
  ])
  const wakeCommandId = requireMatchingCommand('wake', wakeResponses)
  const wakeStatus = await waitForStatus({
    loadSnapshot,
    sleep,
    targetRole,
    accepted: ['idle'],
    maxPolls,
    pollDelayMs,
  })
  await waitForDoneCommand({
    control,
    request: wakeRequest,
    commandId: wakeCommandId,
    sleep,
    maxPolls,
    pollDelayMs,
  })

  const sleepRequest: RuntimeControlRequest = {
    action: 'sleep',
    targetRole,
    clientId: sleepClientId,
    confirmRunningTasks: false,
  }
  const sleepResponses = await Promise.all([
    control(sleepRequest),
    control(sleepRequest),
  ])
  const sleepCommandId = requireMatchingCommand('sleep', sleepResponses)
  const sleepStatus = await waitForStatus({
    loadSnapshot,
    sleep,
    targetRole,
    accepted: ['offline'],
    maxPolls,
    pollDelayMs,
  })
  await waitForDoneCommand({
    control,
    request: sleepRequest,
    commandId: sleepCommandId,
    sleep,
    maxPolls,
    pollDelayMs,
  })

  return {
    targetRole,
    wakeCommandId,
    sleepCommandId,
    wakeStatus,
    sleepStatus,
  }
}
