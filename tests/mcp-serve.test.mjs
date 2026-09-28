import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../supabase/functions/_shared/mcp_common.ts', import.meta.url),
  'utf8',
)

test('serveMcp builds a fresh McpServer and transport for every request', () => {
  const serveMcp = source.slice(source.indexOf('export function serveMcp('))
  const handlerStart = serveMcp.indexOf("app.all('*', async (c) => {")
  assert.ok(handlerStart > 0, 'serveMcp must route requests through app.all')

  const beforeHandler = serveMcp.slice(0, handlerStart)
  const handler = serveMcp.slice(handlerStart)

  // A server shared across requests lets concurrent calls in one isolate steal each
  // other's transport: every caller but the last one to connect hangs forever.
  assert.doesNotMatch(beforeHandler, /new McpServer\(/u)
  assert.doesNotMatch(beforeHandler, /registerTools\(server\)/u)
  assert.match(handler, /new McpServer\(/u)
  assert.match(handler, /registerTools\(server\)/u)
  assert.match(handler, /new WebStandardStreamableHTTPServerTransport\(\)/u)
  assert.ok(
    handler.indexOf('new McpServer(') < handler.indexOf('server.connect(transport)'),
    'the per-request server must exist before it connects',
  )
})
