import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const moduleRoot = readArgument('--module-root')
if (!moduleRoot) {
  throw new Error('--module-root is required; see supabase/smoke-tests/README.md')
}

const embeddedModule = await import(
  pathToFileURL(
    path.join(path.resolve(moduleRoot), 'node_modules/embedded-postgres/dist/index.js'),
  ).href,
)
const EmbeddedPostgres = embeddedModule.default ?? embeddedModule
const fixtureSql = await readFile(
  path.join(repoRoot, 'supabase/smoke-tests/cli_singleton_fixture.sql'),
  'utf8',
)
const migrationSql = await readFile(
  path.join(
    repoRoot,
    'supabase/migrations/20260811123910_v4_1_cli_singleton_sessions_migrate.sql',
  ),
  'utf8',
)
const rollbackSql = await readFile(
  path.join(
    repoRoot,
    'supabase/rollback-contracts/20260811123910_v4_1_cli_singleton_sessions_migrate.sql',
  ),
  'utf8',
)

const databaseDir = await mkdtemp(path.join(tmpdir(), 'hamster-cli-singleton-postgres-'))
const port = await reservePort()
const password = 'local-cli-singleton-smoke-only'
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password,
  port,
  persistent: false,
  onLog() {},
  onError(message) {
    const text = String(message ?? '')
    if (text && !text.includes('database system is ready')) {
      process.stderr.write(`[embedded-postgres] ${text}\n`)
    }
  },
})

let client
try {
  await postgres.initialise()
  await postgres.start()
  client = postgres.getPgClient()
  await client.connect()

  const version = await client.query("select current_setting('server_version') as version")
  assert.match(version.rows[0].version, /^17\.6/u)

  await client.query(fixtureSql)
  const baseline = await readState(client)
  const securityBefore = await readSecurityShape(client)

  await client.query(migrationSql)
  await client.query(migrationSql)

  const migrated = await readState(client)
  assert.equal(migrated.codex_session_id, baseline.codex_session_id)
  assert.equal(migrated.codex_session_key, 'syzygy_codex_cli')
  assert.equal(migrated.codex_profile_key, 'codex_cli')
  assert.equal(migrated.claude_session_count, 1)
  assert.equal(migrated.codex_message_count, baseline.codex_message_count)
  assert.equal(migrated.codex_message_hash, baseline.codex_message_hash)
  assert.deepEqual(migrated.active_profiles, [
    'claude_cli:2:singleton:syzygy_claude_cli:asia_shanghai_day',
    'codex_cli:2:singleton:syzygy_codex_cli:asia_shanghai_day',
  ])
  assert.deepEqual(await readSecurityShape(client), securityBefore)

  await client.query(rollbackSql)
  const rolledBack = await readState(client)
  assert.equal(rolledBack.codex_session_id, baseline.codex_session_id)
  assert.equal(rolledBack.codex_session_key, 'syzygy_cli')
  assert.equal(rolledBack.codex_profile_key, null)
  assert.equal(rolledBack.claude_session_count, 0)
  assert.equal(rolledBack.codex_message_count, baseline.codex_message_count)
  assert.equal(rolledBack.codex_message_hash, baseline.codex_message_hash)
  assert.deepEqual(rolledBack.active_profiles, [
    'claude_cli:3:multi::session',
    'codex_cli:3:multi::session',
  ])

  await client.query(migrationSql)
  const reapplied = await readState(client)
  assert.equal(reapplied.codex_session_id, baseline.codex_session_id)
  assert.equal(reapplied.claude_session_count, 1)
  assert.deepEqual(reapplied.active_profiles, [
    'claude_cli:4:singleton:syzygy_claude_cli:asia_shanghai_day',
    'codex_cli:4:singleton:syzygy_codex_cli:asia_shanghai_day',
  ])

  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres?sslmode=disable`
  const advisors = await runCommand('supabase', [
    'db',
    'advisors',
    '--db-url',
    databaseUrl,
    '--type',
    'all',
    '--level',
    'warn',
    '--fail-on',
    'none',
  ])
  assert.equal(
    advisors.exitCode,
    0,
    [advisors.stderr, advisors.stdout].filter(Boolean).join('\n'),
  )

  process.stdout.write(
    `${JSON.stringify(
      {
        postgresVersion: version.rows[0].version,
        forwardAppliedTwice: true,
        baseline,
        migrated,
        rolledBack,
        reapplied,
        securityShapePreserved: securityBefore,
        advisors: advisors.stdout.trim() || 'no warn-or-higher findings',
        databaseDirRemovedOnExit: databaseDir,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  if (client) {
    await client.end().catch(() => {})
  }
  await postgres.stop().catch(() => {})
  await rm(databaseDir, { recursive: true, force: true })
}

async function readState(databaseClient) {
  const result = await databaseClient.query(`
    select
      codex.id::text as codex_session_id,
      codex.session_key as codex_session_key,
      codex.conversation_profile_key as codex_profile_key,
      (select count(*)::integer
       from public.sessions
       where session_key = 'syzygy_claude_cli'
         and not is_archived) as claude_session_count,
      (select count(*)::integer
       from public.messages
       where session_id = codex.id) as codex_message_count,
      (select md5(coalesce(string_agg(id::text, ',' order by id), ''))
       from public.messages
       where session_id = codex.id) as codex_message_hash,
      (select array_agg(
        profile_key || ':' || version::text || ':' || session_policy || ':' ||
        coalesce(singleton_session_key, '') || ':' || (context_recipe ->> 'epoch')
        order by profile_key
      )
       from public.conversation_profiles
       where active and profile_key in ('codex_cli', 'claude_cli')) as active_profiles
    from public.sessions codex
    where codex.session_key in ('syzygy_cli', 'syzygy_codex_cli')
  `)
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function readSecurityShape(databaseClient) {
  const result = await databaseClient.query(`
    select
      (select relrowsecurity from pg_class where oid = 'public.sessions'::regclass)
        as sessions_rls,
      (select relrowsecurity from pg_class where oid = 'public.messages'::regclass)
        as messages_rls,
      has_table_privilege('authenticated', 'public.sessions', 'SELECT')
        as authenticated_sessions_select,
      has_table_privilege('authenticated', 'public.messages', 'SELECT')
        as authenticated_messages_select,
      has_table_privilege('anon', 'public.sessions', 'SELECT')
        as anon_sessions_select,
      has_table_privilege('anon', 'public.messages', 'SELECT')
        as anon_messages_select
  `)
  return result.rows[0]
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const selectedPort = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  assert.ok(selectedPort > 0)
  return selectedPort
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}
