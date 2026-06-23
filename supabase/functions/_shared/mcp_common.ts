import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { Hono } from 'npm:hono@^4.9.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

export const MCP_VERSION = '5.6.0'
export const USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'

export const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]

const isAllowedOrigin = (origin: string) =>
  allowedOrigins.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin)
  )

const buildCorsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

const timingSafeEqual = (a: string, b: string) => {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

const isAuthorizedRequest = async (req: Request): Promise<boolean> => {
  const providedKey = new URL(req.url).searchParams.get('key')
  const expectedKey = Deno.env.get('HAMSTER_MCP_KEY') ?? ''
  if (providedKey && expectedKey && timingSafeEqual(providedKey, expectedKey)) return true

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

export const errorResult = (err: unknown) => ({
  content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
})

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
