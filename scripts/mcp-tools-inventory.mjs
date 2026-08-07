// MCP 工具清单盘点：核对 6 个 hamster MCP server 的工具数量与 schema 下发体积，
// 防止 README / 文档计数漂移（详见 docs/mcp-tools-assessment.md）。
//
// 两种模式：
//   静态扫描（默认，无网络）——解析 supabase/functions/*-mcp/ 里的 registerTool 注册。
//     模板字符串命名的动态注册（如 reading 的 COMPANION_CONFIGS 工厂）无法静态展开，
//     会单独标注，精确数量以 --live 为准。
//   live 直连（--live <functions-base-url>）——按 MCP Streamable HTTP 调 tools/list，
//     返回已部署的精确清单与真实 JSON 体积。鉴权用环境变量 HAMSTER_MCP_KEY。
//
// 用法：
//   node ./scripts/mcp-tools-inventory.mjs
//   node ./scripts/mcp-tools-inventory.mjs --json > mcp-tools.json
//   HAMSTER_MCP_KEY=xxx node ./scripts/mcp-tools-inventory.mjs --live https://<ref>.supabase.co/functions/v1

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const functionsDir = fileURLToPath(new URL('../supabase/functions', import.meta.url))
const asJson = process.argv.includes('--json')
const liveIndex = process.argv.indexOf('--live')
const liveBaseUrl = liveIndex !== -1 ? process.argv[liveIndex + 1]?.replace(/\/$/, '') : null

if (liveIndex !== -1 && !liveBaseUrl) {
  console.error('用法: --live https://<ref>.supabase.co/functions/v1')
  process.exit(1)
}

const servers = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('-mcp'))
  .map((entry) => entry.name)
  .sort()

// 中英混合的 schema 文本按 ~3 bytes/token 粗估（中文 UTF-8 3 字节 ≈ 1+ token，ASCII JSON 更省）。
const estimateTokens = (bytes) => Math.round(bytes / 3)

const staticScan = (server) => {
  const dir = join(functionsDir, server)
  const source = readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n')

  const staticNames = [...source.matchAll(/registerTool\(\s*'([^']+)'/g)].map((m) => m[1])
  const dynamicTemplates = [...source.matchAll(/registerTool\(\s*`([^`]+)`/g)].map((m) => m[1])

  const textBytes = (regex) =>
    [...source.matchAll(regex)].reduce((total, m) => total + Buffer.byteLength(m[1], 'utf8'), 0)
  const descriptionBytes = textBytes(/description:\s*'((?:[^'\\]|\\.)*)'/g) + textBytes(/description:\s*`((?:[^`\\]|\\.)*)`/g)
  const paramDescriptionBytes = textBytes(/\.describe\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g) + textBytes(/\.describe\(\s*`((?:[^`\\]|\\.)*)`\s*\)/g)
  const paramCount = (source.match(/\.describe\(/g) ?? []).length
  const registrationCount = staticNames.length + dynamicTemplates.length
  // JSON Schema 结构骨架估算：每工具约 120 字节（name/title/type/properties 包装）+ 每参数约 80 字节。
  const structureBytes = registrationCount * 120 + paramCount * 80
  const totalBytes = descriptionBytes + paramDescriptionBytes + structureBytes

  return {
    server,
    tools: staticNames,
    dynamicTemplates,
    schemaBytes: totalBytes,
    estTokens: estimateTokens(totalBytes),
  }
}

const parseMcpResponse = async (response) => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) return response.json()
  const text = await response.text()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    try {
      const parsed = JSON.parse(trimmed.replace(/^data:\s*/, ''))
      if (parsed.id !== undefined) return parsed
    } catch {
      // 跳过非 JSON 数据行
    }
  }
  throw new Error('SSE 响应中未找到 JSON-RPC 结果')
}

const liveRpc = async (endpoint, key, body, extraHeaders = {}) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-hamster-mcp-key': key,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return { payload: await parseMcpResponse(response), sessionId: response.headers.get('mcp-session-id') }
}

const liveScan = async (server) => {
  const key = process.env.HAMSTER_MCP_KEY
  if (!key) {
    console.error('--live 模式需要环境变量 HAMSTER_MCP_KEY')
    process.exit(1)
  }
  const endpoint = `${liveBaseUrl}/${server}`
  const listRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
  let result
  try {
    // 生产前端（src/lib/mcpTools.ts）就是裸调 tools/list，先走同一路径。
    result = (await liveRpc(endpoint, key, listRequest)).payload
    if (result.error) throw new Error(result.error.message)
  } catch {
    // 部分 SDK 版本要求完整握手：initialize → notifications/initialized → tools/list。
    const init = await liveRpc(endpoint, key, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp-tools-inventory', version: '1.0.0' } },
    })
    const session = init.sessionId ? { 'mcp-session-id': init.sessionId } : {}
    await liveRpc(endpoint, key, { jsonrpc: '2.0', method: 'notifications/initialized' }, session)
    result = (await liveRpc(endpoint, key, listRequest, session)).payload
    if (result.error) throw new Error(result.error.message)
  }
  const tools = result.result?.tools ?? []
  const schemaBytes = Buffer.byteLength(JSON.stringify(tools), 'utf8')
  return {
    server,
    tools: tools.map((tool) => tool.name),
    dynamicTemplates: [],
    schemaBytes,
    estTokens: estimateTokens(schemaBytes),
  }
}

const rows = []
for (const server of servers) {
  try {
    rows.push(liveBaseUrl ? await liveScan(server) : staticScan(server))
  } catch (error) {
    rows.push({ server, error: error instanceof Error ? error.message : String(error), tools: [], dynamicTemplates: [], schemaBytes: 0, estTokens: 0 })
  }
}

const totals = rows.reduce(
  (acc, row) => ({
    tools: acc.tools + row.tools.length,
    dynamic: acc.dynamic + row.dynamicTemplates.length,
    schemaBytes: acc.schemaBytes + row.schemaBytes,
    estTokens: acc.estTokens + row.estTokens,
  }),
  { tools: 0, dynamic: 0, schemaBytes: 0, estTokens: 0 },
)

if (asJson) {
  console.log(JSON.stringify({ mode: liveBaseUrl ? 'live' : 'static', servers: rows, totals }, null, 2))
} else {
  console.log(`模式: ${liveBaseUrl ? `live (${liveBaseUrl})` : '静态扫描'}\n`)
  console.log('server                      tools  schema(B)  ~tokens')
  for (const row of rows) {
    if (row.error) {
      console.log(`${row.server.padEnd(28)} 错误: ${row.error}`)
      continue
    }
    const dynamicNote = row.dynamicTemplates.length > 0 ? `  (+${row.dynamicTemplates.length} 组动态注册: ${row.dynamicTemplates.join(', ')})` : ''
    console.log(`${row.server.padEnd(28)}${String(row.tools.length).padStart(4)}${String(row.schemaBytes).padStart(11)}${String(row.estTokens).padStart(9)}${dynamicNote}`)
  }
  console.log('-'.repeat(56))
  console.log(`${'总计'.padEnd(26)}${String(totals.tools).padStart(4)}${String(totals.schemaBytes).padStart(11)}${String(totals.estTokens).padStart(9)}`)
  if (totals.dynamic > 0 && !liveBaseUrl) {
    console.log('\n注意：存在模板字符串动态注册（工厂模式），静态计数偏低，精确清单请用 --live。')
  }
}
