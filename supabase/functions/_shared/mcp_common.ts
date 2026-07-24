import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { Hono } from 'npm:hono@^4.9.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isMcpKeyAuthorized } from './mcp_key_auth.ts'
import { getOwnerUserId } from './owner.ts'
import { getSupabaseAdminKey } from './supabase_secret.ts'

export const MCP_VERSION = '5.11.0'
export const USER_ID = getOwnerUserId()

export const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getSupabaseAdminKey(),
)

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]

const isAllowedOrigin = (origin: string) =>
  allowedOrigins.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin)
  )

const buildCorsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, mcp-session-id, mcp-protocol-version, x-hamster-mcp-key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

const isAuthorizedRequest = async (req: Request): Promise<boolean> => {
  const expectedKey = Deno.env.get('HAMSTER_MCP_KEY') ?? ''
  if (isMcpKeyAuthorized(req, expectedKey)) return true

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const apikey = req.headers.get('apikey')?.trim() ?? ''
  if (!apikey) return false
  try {
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey, Authorization: authHeader },
    })
    return authResponse.ok
  } catch {
    return false
  }
}

export const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

export const errorResult = (err: unknown) => {
  let msg: string
  if (err instanceof Error) {
    msg = err.message
  } else if (typeof err === 'object' && err !== null) {
    msg = (err as Record<string, unknown>).message as string ?? JSON.stringify(err, null, 2)
  } else {
    msg = String(err)
  }
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] }
}

export const clampLimit = (limit: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(limit ?? fallback, 1), max)

export function serveMcp(
  functionName: string,
  registerTools: (server: McpServer) => void,
  serverName = 'hamster-nest',
) {
  const app = new Hono().basePath(`/${functionName}`)
  const server = new McpServer({ name: serverName, version: MCP_VERSION })

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
    if (!(await isAuthorizedRequest(c.req.raw))) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...(corsHeaders ?? {}), 'Content-Type': 'application/json' },
      })
    }

    await next()

    if (corsHeaders) {
      const headers = new Headers(c.res.headers)
      for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
      c.res = new Response(c.res.body, { status: c.res.status, headers })
    }
  })

  registerTools(server)

  app.all('*', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport()
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  Deno.serve(app.fetch)
}
