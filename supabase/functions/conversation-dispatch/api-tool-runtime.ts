import type { SupabaseClient } from '@supabase/supabase-js'
import {
  API_TOOL_CATALOG,
  normalizeToolSelection,
  stableJson,
  toolResult,
} from './api-tool-contract.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiClient = SupabaseClient<any, 'public', 'public', any, any>
export type ToolProgress = { id: string; label: string; status: string; detail?: string }
export type ToolDefinition = {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export async function mcpRequest(
  url: string,
  headers: Record<string, string>,
  server: string,
  method: string,
  params?: unknown,
  signal?: AbortSignal,
) {
  const id = crypto.randomUUID()
  const response = await fetch(`${url}/functions/v1/${server}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
  })
  if (!response.ok) throw new Error(`工具服务未完成请求 (${response.status})`)
  const text = await response.text()
  const messages = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) =>
      JSON.parse(line.slice(5))
    )
    : [JSON.parse(text)]
  const message = messages.find((item) => item.id === id)
  if (!message || message.error) throw new Error('工具服务返回错误')
  return message.result as Record<string, unknown>
}

export async function selectedTools(client: ApiClient, userId: string, sessionId: string) {
  const { data, error } = await client.from('api_conversation_tools').select('enabled_tools')
    .eq('user_id', userId).eq('session_id', sessionId).maybeSingle()
  if (error) throw error
  return normalizeToolSelection(data?.enabled_tools ?? [])
}

export async function discoverTools(
  selected: string[],
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  const catalog = API_TOOL_CATALOG.filter((tool) => selected.includes(tool.id))
  const definitions: ToolDefinition[] = []
  const instructions: string[] = []
  for (const server of [...new Set(catalog.map((tool) => tool.server))]) {
    const [initialized, listed] = await Promise.all([
      mcpRequest(url, headers, server, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'hamster-api', version: '1.0' },
      }, signal),
      mcpRequest(url, headers, server, 'tools/list', {}, signal),
    ])
    if (typeof initialized.instructions === 'string') instructions.push(initialized.instructions)
    const tools = Array.isArray(listed.tools) ? listed.tools : []
    for (const entry of catalog.filter((tool) => tool.server === server)) {
      const tool = tools.find((tool) => tool.name === entry.name)
      if (!tool) throw new Error(`工具暂不可用：${entry.label}`)
      definitions.push({
        type: 'function',
        function: {
          name: entry.id,
          description: String(tool.description ?? entry.label),
          parameters: tool.inputSchema,
        },
      })
    }
  }
  definitions.sort((a, b) => a.function.name.localeCompare(b.function.name))
  return { definitions, instructions: instructions.join('\n') }
}

export async function executeApiTool(options: {
  client: ApiClient
  userId: string
  sessionId: string
  replyId: string
  attempt: number
  selected: string[]
  name: string
  argumentsText: string
  model: string
  url: string
  headers: Record<string, string>
  signal: AbortSignal
  progress: (value: ToolProgress) => Promise<void>
}) {
  const { client, userId, sessionId, replyId, name } = options
  const entry = API_TOOL_CATALOG.find((tool) => tool.id === name)
  if (!entry || !options.selected.includes(name)) {
    return { ok: false, text: '该工具未获当前会话授权，不能执行。' }
  }
  // Recheck persisted permissions immediately before execution, including resumed requests.
  if (!(await selectedTools(client, userId, sessionId)).includes(name)) {
    return { ok: false, text: '该工具已被关闭，未执行。' }
  }
  let args: Record<string, unknown>
  try {
    args = JSON.parse(options.argumentsText)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error()
  } catch {
    return { ok: false, text: '工具参数格式无效，未执行。' }
  }
  if (entry.access === 'write') {
    const claude = /claude|anthropic/iu.test(options.model)
    const gpt = /gpt|openai/iu.test(options.model)
    const speaker = claude
      ? 'claude'
      : gpt
      ? 'gpt'
      : /gemini|google/iu.test(options.model)
      ? 'gemini'
      : `api:${options.model}`
    const writer = claude ? 'syzygy-claude' : gpt ? 'syzygy-gpt' : `api:${options.model}`
    if (entry.name === 'add_timeline') {
      args.source = 'api'
      args.recorder = 'syzygy'
    }
    if (entry.name === 'add_excerpt_resonance') {
      args.speaker = speaker
      delete args.book_id
    }
    if (entry.name === 'add_book_answer') {
      if (!claude && !gpt) {
        return {
          ok: false,
          text:
            'AAB 问答目前没有该模型的署名类型，未写入。请使用 Claude 或 GPT 回答，不能冒用其他模型身份。',
        }
      }
      args.answered_by = writer
    }
    if (/^(add|update)_book_(guide|summary)$/u.test(entry.name)) {
      args.written_by = writer
    }
  }
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${name}:${stableJson(args)}`),
  )
  const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const previous = await client.from('api_tool_executions').select('status,result').eq(
    'reply_id',
    replyId,
  ).eq('fingerprint', fingerprint).maybeSingle()
  if (previous.error) throw previous.error
  if (previous.data) {
    const result = previous.data.result ??
      {
        ok: false,
        text: '上次执行结果待核对；为避免重复写入，本次没有再次执行。请先读取记录核对。',
      }
    await options.progress({
      id: fingerprint,
      label: entry.label,
      status: previous.data.status === 'running' ? 'unknown' : previous.data.status,
      detail: '已复用执行凭据',
    })
    return result as { ok: boolean; text: string }
  }
  if (entry.access === 'write' && options.attempt > 1) {
    const prior = await client.from('api_tool_executions').select('tool_id').eq('reply_id', replyId)
    if (prior.error) throw prior.error
    if (
      prior.data?.some((row) =>
        API_TOOL_CATALOG.some((tool) => tool.id === row.tool_id && tool.access === 'write')
      )
    ) {
      return {
        ok: false,
        text:
          '这条回复之前已有写入尝试。本次重试只能读取核对或复用原操作，不能更换参数再次写入；请在新消息中明确需要补做的操作。',
      }
    }
  }
  const claim = await client.from('api_tool_executions').insert({
    user_id: userId,
    session_id: sessionId,
    reply_id: replyId,
    fingerprint,
    tool_id: name,
    status: 'running',
  })
  if (claim.error) {
    if (claim.error.code === '23505') {
      return { ok: false, text: '同一操作已被执行进程接收，请核对结果，未重复执行。' }
    }
    throw claim.error
  }
  await options.progress({ id: fingerprint, label: entry.label, status: 'running' })
  let result: { ok: boolean; text: string }, status: string
  try {
    result = toolResult(
      await mcpRequest(options.url, options.headers, entry.server, 'tools/call', {
        name: entry.name,
        arguments: args,
      }, options.signal),
    )
    status = result.ok ? 'completed' : 'failed'
  } catch {
    result = {
      ok: false,
      text:
        '工具连接中断或超时，执行结果待核对；不要宣称成功，也不要自动重复写入。请读取记录核对。',
    }
    status = 'unknown'
  }
  const receipt = await client.from('api_tool_executions').update({
    status,
    result,
    updated_at: new Date().toISOString(),
  })
    .eq('reply_id', replyId).eq('fingerprint', fingerprint)
  if (receipt.error) throw receipt.error // leave claim running; never replay an unacknowledged mutation
  await options.progress({ id: fingerprint, label: entry.label, status })
  if (result.text.length > 100000) {
    return {
      ...result,
      text: result.text.slice(0, 100000) +
        '\n[结果过长，已截断；请缩小查询范围，不要假设已读取全部内容。]',
    }
  }
  return result
}
