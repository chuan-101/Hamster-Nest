/// <reference types="npm:@supabase/functions-js@2.110.8/src/edge-runtime.d.ts" />
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { Hono } from 'npm:hono@^4.9.7'
import { createClient } from 'npm:@supabase/supabase-js@2.110.8'
import { isMcpKeyAuthorized } from './mcp_key_auth.ts'
import { getOwnerUserId } from './owner.ts'
import { getSupabaseAdminKey } from './supabase_secret.ts'
import { isAllowedBrowserOrigin } from './cors.ts'

export const MCP_VERSION = '5.18.1'
export const USER_ID = getOwnerUserId()

export const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getSupabaseAdminKey(),
)

const isAllowedOrigin = (origin: string) => isAllowedBrowserOrigin(origin)

const buildCorsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, mcp-session-id, mcp-protocol-version, x-hamster-mcp-key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

const authorizedOwner = async (req: Request): Promise<string | null> => {
  const expectedKey = Deno.env.get('HAMSTER_MCP_KEY') ?? ''
  if (isMcpKeyAuthorized(req, expectedKey)) return USER_ID

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const apikey = req.headers.get('apikey')?.trim() ?? ''
  if (!apikey) return null
  try {
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey, Authorization: authHeader },
    })
    if (!authResponse.ok) return null
    const user = await authResponse.json()
    return typeof user.id === 'string' && user.id ? user.id : null
  } catch {
    return null
  }
}

// Compact on purpose: the reader is a model, and indentation only adds tokens
// (12–19% on memo / timeline / event-thread reads).
export const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

export const errorResult = (err: unknown) => {
  let msg: string
  if (err instanceof Error) {
    msg = err.message
  } else if (typeof err === 'object' && err !== null) {
    msg = (err as Record<string, unknown>).message as string ?? JSON.stringify(err)
  } else {
    msg = String(err)
  }
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] }
}

export const clampLimit = (limit: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(limit ?? fallback, 1), max)

type ServeMcpOptions = {
  serverName?: string
  // 随 initialize 握手下发一次的服务器级使用说明：放跨工具的共性约定（时区、枚举语义、
  // 写入习惯等），工具描述里只留"做什么"。不是所有客户端都会注入 instructions，
  // 关键触发时机仍由各客户端的系统提示负责。
  instructions?: string
}

export function serveMcp(
  functionName: string,
  registerTools: (server: McpServer, owner: string) => void,
  options: string | ServeMcpOptions = {},
) {
  const { serverName = 'hamster-nest', instructions } =
    typeof options === 'string' ? { serverName: options, instructions: undefined } : options
  const app = new Hono<{ Variables: { owner: string } }>().basePath(`/${functionName}`)

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin') ?? null
    const corsHeaders = origin && isAllowedOrigin(origin) ? buildCorsHeaders(origin) : null

    if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders ?? {} })
    if (origin && !corsHeaders) {
      return new Response(JSON.stringify({ error: '不允许的来源' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const owner = await authorizedOwner(c.req.raw)
    if (!owner) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...(corsHeaders ?? {}), 'Content-Type': 'application/json' },
      })
    }

    c.set('owner', owner)
    await next()

    if (corsHeaders) {
      const headers = new Headers(c.res.headers)
      for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
      c.res = new Response(c.res.body, { status: c.res.status, headers })
    }
  })

  // 每个请求新建 server + transport（SDK 无状态样板）：共享一个 server 时，同一 isolate 里
  // 并发的请求会被最后 connect 的 transport 抢走响应，其余请求一直挂起。注册只是同步建表，毫秒级。
  app.all('*', async (c) => {
    const server = new McpServer(
      { name: serverName, version: MCP_VERSION },
      instructions ? { instructions } : undefined,
    )
    registerTools(server, c.get('owner'))
    const transport = new WebStandardStreamableHTTPServerTransport()
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  Deno.serve(app.fetch)
}
