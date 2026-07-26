import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  buildRuntimeControlCorsHeaders,
  normalizeRuntimeControlRequest,
  RUNTIME_CONTROL_TARGET_ROLES,
} = await import('../supabase/functions/runtime-control/contract.ts')

const migrationUrl = new URL(
  '../supabase/migrations/20260726073412_v4_1_runtime_control_prepare.sql',
  import.meta.url,
)
const functionUrl = new URL(
  '../supabase/functions/runtime-control/index.ts',
  import.meta.url,
)
const configUrl = new URL('../supabase/config.toml', import.meta.url)

test('runtime-control normalizes the narrow action and target contract', () => {
  const request = normalizeRuntimeControlRequest({
    action: ' Sleep ',
    target_role: ' CODEX_CLI_SYZYGY ',
    client_id: '00000000-0000-4000-8000-000000000021',
    confirm_running_tasks: true,
  })

  assert.deepEqual(request, {
    action: 'sleep',
    target_role: 'codex_cli_syzygy',
    client_id: '00000000-0000-4000-8000-000000000021',
    confirm_running_tasks: true,
  })
  assert.deepEqual(RUNTIME_CONTROL_TARGET_ROLES, [
    'codex_cli_syzygy',
    'claude_code_cli_syzygy',
  ])
})

test('runtime-control rejects arbitrary actions, targets, payloads, and wake confirmation', () => {
  const base = {
    action: 'wake',
    target_role: 'codex_cli_syzygy',
    client_id: '00000000-0000-4000-8000-000000000021',
  }

  assert.throws(
    () => normalizeRuntimeControlRequest({ ...base, action: 'run_shell' }),
    /action 不在允许范围内/u,
  )
  assert.throws(
    () => normalizeRuntimeControlRequest({ ...base, target_role: 'root' }),
    /target_role 不在允许范围内/u,
  )
  assert.throws(
    () => normalizeRuntimeControlRequest({ ...base, client_id: 'arbitrary-key' }),
    /client_id 必须是 UUID/u,
  )
  assert.throws(
    () =>
      normalizeRuntimeControlRequest({
        ...base,
        working_dir: '/tmp',
      }),
    /不允许请求字段 working_dir/u,
  )
  assert.throws(
    () =>
      normalizeRuntimeControlRequest({
        ...base,
        confirm_running_tasks: true,
      }),
    /只允许用于 sleep/u,
  )
})

test('runtime-control RPC is owner-bound, invoker-only, and atomically idempotent', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /security invoker/iu)
  assert.match(sql, /set search_path = ''/iu)
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/iu)
  assert.match(sql, /v_action not in \('wake', 'sleep'\)/iu)
  assert.match(sql, /codex_cli_syzygy[\s\S]*claude_code_cli_syzygy/iu)
  assert.match(sql, /'runtime-control:v1:' \|\| p_client_id::text/iu)
  assert.match(sql, /on conflict \(user_id, idempotency_key\)\s+do nothing/iu)
  assert.match(sql, /from public, anon, service_role/iu)
  assert.match(sql, /to authenticated/iu)
  assert.doesNotMatch(sql, /security definer/iu)
  assert.doesNotMatch(sql, /working_dir|binary|environment|shell|command_text/iu)
})

test('runtime-control Edge handler uses caller auth and no privileged client', async () => {
  const [source, config] = await Promise.all([
    readFile(functionUrl, 'utf8'),
    readFile(configUrl, 'utf8'),
  ])

  assert.match(config, /\[functions\.runtime-control\][\s\S]*?verify_jwt = true/iu)
  assert.match(source, /new URL\('\/auth\/v1\/user', supabaseUrl\)/u)
  assert.match(source, /getOwnerUserId\(\)/u)
  assert.match(source, /Authorization: authorization/u)
  assert.match(source, /\.rpc\('runtime_control_prepare'/u)
  assert.doesNotMatch(source, /getSupabaseAdminKey|service_role/iu)
})

test('runtime-control CORS admits only the established browser origins', () => {
  const headers = buildRuntimeControlCorsHeaders(
    'https://chuan-101.github.io',
  )
  assert.equal(
    headers['Access-Control-Allow-Origin'],
    'https://chuan-101.github.io',
  )
  assert.match(headers['Access-Control-Allow-Headers'], /authorization/u)
})
