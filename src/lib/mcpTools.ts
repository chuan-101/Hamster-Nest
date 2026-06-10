// hamster-mcp 客户端：通过 JSON-RPC (MCP Streamable HTTP) 获取工具列表并执行工具调用。
// 工具 schema 一律来自服务端 tools/list，前端不做任何硬编码。

export type McpToolDefinition = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type McpAuth = {
  accessToken: string
  anonKey: string
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000

let cachedTools: McpToolDefinition[] | null = null
let cachedToolsAt = 0

const buildEndpoint = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hamster-mcp`

let requestSequence = 0

const parseJsonRpcResponse = async (response: Response, requestId: number): Promise<JsonRpcResponse> => {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    // 无状态 Streamable HTTP 也可能以 SSE 包裹单条 JSON-RPC 响应。
    const text = await response.text()
    const dataLines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s*/, ''))
    for (const line of dataLines) {
      try {
        const parsed = JSON.parse(line) as JsonRpcResponse
        if (parsed.id === requestId) {
          return parsed
        }
      } catch {
        // 跳过非 JSON 数据行
      }
    }
    throw new Error('MCP 响应中未找到匹配的 JSON-RPC 结果')
  }
  return (await response.json()) as JsonRpcResponse
}

const sendJsonRpc = async (
  auth: McpAuth,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  requestSequence += 1
  const requestId = requestSequence
  const response = await fetch(buildEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      apikey: auth.anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      ...(params ? { params } : {}),
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`MCP 请求失败 (${response.status}): ${errorText.slice(0, 300)}`)
  }
  const payload = await parseJsonRpcResponse(response, requestId)
  if (payload.error) {
    throw new Error(`MCP 错误 (${payload.error.code}): ${payload.error.message}`)
  }
  return payload.result ?? {}
}

const toOpenAiTool = (tool: Record<string, unknown>): McpToolDefinition | null => {
  const name = typeof tool.name === 'string' ? tool.name : ''
  if (!name) {
    return null
  }
  const description = typeof tool.description === 'string' ? tool.description : undefined
  const inputSchema =
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? (tool.inputSchema as Record<string, unknown>)
      : { type: 'object', properties: {} }
  return {
    type: 'function',
    function: {
      name,
      ...(description ? { description } : {}),
      parameters: inputSchema,
    },
  }
}

/** 动态获取 hamster-mcp 工具列表（OpenAI function calling 格式），带 5 分钟缓存。 */
export const listMcpTools = async (auth: McpAuth): Promise<McpToolDefinition[]> => {
  if (cachedTools && Date.now() - cachedToolsAt < TOOLS_CACHE_TTL_MS) {
    return cachedTools
  }
  const result = await sendJsonRpc(auth, 'tools/list')
  const rawTools = Array.isArray(result.tools) ? (result.tools as Array<Record<string, unknown>>) : []
  const tools = rawTools
    .map(toOpenAiTool)
    .filter((tool): tool is McpToolDefinition => tool !== null)
  cachedTools = tools
  cachedToolsAt = Date.now()
  return tools
}

const flattenToolResultContent = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : JSON.stringify(content ?? null)
  }
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }
      const candidate = part as Record<string, unknown>
      if (typeof candidate.text === 'string') {
        return candidate.text
      }
      return JSON.stringify(candidate)
    })
    .filter(Boolean)
    .join('\n')
}

export type McpToolCallResult = {
  ok: boolean
  text: string
}

/**
 * 执行单个工具调用。任何错误（参数解析失败、网络失败、工具自身 isError）
 * 都以文本形式返回给模型，不抛出，保证工具循环不中断。
 */
export const callMcpTool = async (
  auth: McpAuth,
  name: string,
  argumentsText: string,
): Promise<McpToolCallResult> => {
  let parsedArguments: Record<string, unknown> = {}
  if (argumentsText.trim()) {
    try {
      parsedArguments = JSON.parse(argumentsText) as Record<string, unknown>
    } catch (error) {
      return {
        ok: false,
        text: `工具参数 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  try {
    const result = await sendJsonRpc(auth, 'tools/call', {
      name,
      arguments: parsedArguments,
    })
    const text = flattenToolResultContent(result.content)
    if (result.isError) {
      return { ok: false, text: `工具执行报错: ${text || '未知错误'}` }
    }
    return { ok: true, text: text || '(工具执行完成，无输出)' }
  } catch (error) {
    return {
      ok: false,
      text: `工具调用失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
