import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  runConversationCanary,
  type ConversationCanaryResult,
} from '../lib/conversation-canary-runner'
import { dispatchConversation } from '../storage/conversationDispatch'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const TIMEOUT_MS = 200

const sleep = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export default function ConversationCanaryPage() {
  const [searchParams] = useSearchParams()
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'completed'; result: ConversationCanaryResult }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })
  const sessionId = searchParams.get('session_id') ?? ''
  const clientId = searchParams.get('client_id') ?? ''
  const parametersValid = useMemo(
    () => UUID_PATTERN.test(sessionId) && UUID_PATTERN.test(clientId),
    [clientId, sessionId],
  )

  const run = async () => {
    if (!parametersValid || state.status === 'running') {
      return
    }
    setState({ status: 'running' })
    const request = {
      sessionId,
      clientId,
      content: 'V4.1 2.3c authenticated canary，请只回复：2.3c OK',
      clientCreatedAt: new Date().toISOString(),
    }

    try {
      setState({
        status: 'completed',
        result: await runConversationCanary({
          dispatch: dispatchConversation,
          request,
          sleep,
          initialTimeoutMs: TIMEOUT_MS,
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
      <h1>2.3c 会话链路自检</h1>
      <p>
        使用当前登录态，对临时会话执行一次真实 timeout 与同 client_id 并发补账。
      </p>
      {!parametersValid ? (
        <p role="alert">canary 参数无效，请使用施工记录中的专用链接。</p>
      ) : null}
      <button
        type="button"
        disabled={!parametersValid || state.status === 'running'}
        onClick={() => void run()}
      >
        {state.status === 'running' ? '自检中…' : '运行 2.3c canary'}
      </button>
      {state.status === 'completed' ? (
        <section aria-live="polite">
          <h2>自检请求已完成</h2>
          <p>
            真实客户端超时：{state.result.timeoutObserved ? '已观察' : '未观察'}
          </p>
          <p>后续响应数：{state.result.attempts.length}</p>
          <p>补账轮次：{state.result.rounds}</p>
          <p>
            canonical IDs：
            {state.result.attempts
              .map(
                (attempt) =>
                  `${attempt.userMessageId ?? '—'} / ${attempt.replyId ?? '—'}`,
              )
              .join('；')}
          </p>
        </section>
      ) : null}
      {state.status === 'failed' ? (
        <p role="alert">自检失败：{state.message}</p>
      ) : null}
    </main>
  )
}
