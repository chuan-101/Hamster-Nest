import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanToolNames } from '../scripts/mcp-tool-names.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/mcp-tools.snapshot.json', import.meta.url), 'utf8'))
const inventory = JSON.parse(execFileSync(process.execPath, ['scripts/mcp-tools-inventory.mjs', '--json'], {
  cwd: root, encoding: 'utf8',
}))

test('all MCP registrations match the reviewed server/name snapshot, including reading factories', () => {
  assert.equal(inventory.mode, 'static')
  assert.equal(inventory.totals.dynamic, 0)
  assert.deepEqual(inventory.toolNamesByServer, snapshot,
    'Review added, removed, renamed or moved tools, then update tests/fixtures/mcp-tools.snapshot.json in the same PR.')
  assert.equal(inventory.totals.tools, Object.values(snapshot).flat().length)
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['scripts/mcp-tools-inventory.mjs', '--snapshot'], {
    cwd: root, encoding: 'utf8',
  })), snapshot)
})

test('README badge, heading, server counts and complete tool tables match the snapshot', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const total = Object.values(snapshot).flat().length
  assert.ok(readme.includes(`MCP_Tools-${total}-`))
  assert.ok(readme.includes(`](#-mcp-工具箱全部-${total}-个)`))
  assert.ok(readme.includes(`### 🧰 MCP 工具箱（全部 ${total} 个）`))
  const serverCounts = Object.fromEntries([...readme.matchAll(/^\| `(hamster[^`]*-mcp)` \| [^\n]+ \| (\d+) \|$/gm)]
    .map(([, server, count]) => [server, Number(count)]))
  assert.deepEqual(serverCounts, Object.fromEntries(Object.entries(snapshot).map(([server, names]) => [server, names.length])))
  const documented = {}
  for (const match of readme.matchAll(/<summary><b>[^<]*? (hamster[^<]*-mcp)<\/b>[^\n]*（(\d+)）<\/summary>([\s\S]*?)<\/details>/g)) {
    const [, server, count, body] = match
    const names = [...body.matchAll(/^\| `([^`]+)` \|/gm)].map(([, name]) => name).sort()
    assert.equal(Number(count), names.length, `${server} detail count`)
    documented[server] = names
  }
  assert.deepEqual(documented, snapshot)
})

test('static registration parsing ignores comments and text, accepts quote/format variations', () => {
  assert.deepEqual(scanToolNames(`
    // server.registerTool('removed', {}, handler)
    const documentation = "server.registerTool('example', {}, handler)";
    /* server.registerTool('old', {}, handler) */
    server.registerTool (
      "active", {}, handler);
    server['registerTool'](\`also_active\`, {}, handler);
  `), ['active', 'also_active'])
})

test('factory names follow actual array entries and template properties, without hardcoded suffixes', () => {
  const source = (configs) => `
    const CONFIGS = ${configs} as const;
    for (const item of CONFIGS) {
      server.registerTool(\`read_\${item.table}\`, {}, handler);
      server.registerTool(\`add_\${item.suffix}\`, {}, handler);
    }
  `
  assert.deepEqual(scanToolNames(source(`[
    {table: 'guides', suffix: 'guide'}, {table: 'summaries', suffix: 'summary'}
  ]`)), ['add_guide', 'add_summary', 'read_guides', 'read_summaries'])
  assert.deepEqual(scanToolNames(source(`[{table: 'notes', suffix: 'note'}]`)), ['add_note', 'read_notes'])
  assert.deepEqual(scanToolNames(source('[]')), [])
})

test('unresolved dynamic registrations fail instead of producing a partial passing snapshot', () => {
  for (const source of [
    'server.registerTool(getName(), {}, handler)',
    'for (const config of loadConfigs()) { server.registerTool(`read_${config.table}`, {}, handler) }',
    'const CONFIGS = [{suffix: "guide"}]; for (const config of CONFIGS) { server.registerTool(`read_${config.table}`, {}, handler) }',
    'if (enabled) { server.registerTool("conditional", {}, handler) }',
    'for (let i = 0; i < 2; i++) { server.registerTool("loop", {}, handler) }',
    'const a = b; const b = a; server.registerTool(a, {}, handler)',
  ]) assert.throws(() => scanToolNames(source), /cannot statically resolve MCP registration/)
})

test('duplicate names and invalid source are rejected', () => {
  assert.throws(() => scanToolNames(`server.registerTool('same', {}, handler); server.registerTool('same', {}, handler)`), /duplicate MCP tool names/)
  assert.throws(() => scanToolNames(`server.registerTool('broken'`), /invalid TypeScript/)
})
