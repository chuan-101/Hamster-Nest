import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  runRuntimeControlCanary,
  type RuntimeControlCanaryResult,
} from '../lib/runtime-control-canary-runner'
import {
  RUNTIME_CONTROL_TARGET_ROLES,
  type RuntimeControlTargetRole,
} from '../lib/runtime-control-client'
import {
  controlRuntime,
  loadRuntimeStatusSnapshot,
} from '../storage/runtimeControl'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const sleep = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export default function RuntimeControlCanaryPage() {
  const [searchParams] = useSearchParams()
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'completed'; result: RuntimeControlCanaryResult }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })
  const targetRole = searchParams.get('target_role') ?? ''
  const wakeClientId = searchParams.get('wake_client_id') ?? ''
  const sleepClientId = searchParams.get('sleep_client_id') ?? ''
  const parametersValid = useMemo(
    () =>
      RUNTIME_CONTROL_TARGET_ROLES.includes(
        targetRole as RuntimeControlTargetRole,
      ) &&
      UUID_PATTERN.test(wakeClientId) &&
      UUID_PATTERN.test(sleepClientId) &&
      wakeClientId !== sleepClientId,
    [sleepClientId, targetRole, wakeClientId],
  )

  const run = async () => {
    if (!parametersValid || state.status === 'running') {
      return
    }
    setState({ status: 'running' })
    try {
      setState({
        status: 'completed',
        result: await runRuntimeControlCanary({
          control: controlRuntime,
          loadSnapshot: loadRuntimeStatusSnapshot,
          sleep,
          targetRole: targetRole as RuntimeControlTargetRole,
          wakeClientId,
          sleepClientId,
        }),
      })
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : 'canary 失败',
      })
    }
  }

  return (
    <main style={{ margin: '0 auto', maxWidth: 720, padding: 24 }}>
      <Link to="/">‹ 返回小窝</Link>
      <h1>2.4 Runtime 控制自检</h1>
      <p>
        使用当前登录态并发验证同一 wake / sleep 幂等键，并读取 mini
        真实心跳。自检成功后目标 Runtime 会保持 offline；不会确认取消正在执行的任务。
      </p>
      {!parametersValid ? (
        <p role="alert">canary 参数无效，请使用施工记录中的专用链接。</p>
      ) : null}
      <button
        type="button"
        disabled={!parametersValid || state.status === 'running'}
        onClick={() => void run()}
      >
        {state.status === 'running' ? '自检中…' : '运行 2.4 canary'}
      </button>
      {state.status === 'completed' ? (
        <section aria-live="polite">
          <h2>自检已完成</h2>
          <p>目标：{state.result.targetRole}</p>
          <p>
            wake：{state.result.wakeCommandId} / {state.result.wakeStatus}
          </p>
          <p>
            sleep：{state.result.sleepCommandId} / {state.result.sleepStatus}
          </p>
        </section>
      ) : null}
      {state.status === 'failed' ? (
        <p role="alert">自检失败：{state.message}</p>
      ) : null}
    </main>
  )
}
