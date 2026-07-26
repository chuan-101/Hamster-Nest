import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  createRuntimeControlClient,
  RuntimeControlError,
} = await import('../src/lib/runtime-control-client.ts')
const { normalizeRuntimeStatusSnapshot } = await import(
  '../src/lib/runtime-status.ts'
)
const { runRuntimeControlCanary } = await import(
  '../src/lib/runtime-control-canary-runner.ts'
)

const responseBody = (status = 'pending', wasDuplicate = false) => ({
  schema_version: 1,
  was_duplicate: wasDuplicate,
  command: {
    id: '00000000-0000-4000-8000-000000000031',
    action: 'wake',
    target_role: 'codex_cli_syzygy',
    status,
    idempotency_key:
      'runtime-control:v1:00000000-0000-4000-8000-000000000032',
    confirm_running_tasks: false,
    created_at: '2026-07-26T08:00:00.000Z',
    claimed_at: null,
    completed_at: null,
    error_message: null,
  },
})

test('runtime-control client sends only the allowlisted intent envelope', async () => {
  const bodies = []
  const control = createRuntimeControlClient({
    endpointUrl: 'https://example.test/functions/v1/runtime-control',
    publishableKey: 'publishable-test-key',
    getAccessToken: async () => 'access-token',
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify(responseBody()), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const request = {
    action: 'wake',
    targetRole: 'codex_cli_syzygy',
    clientId: '00000000-0000-4000-8000-000000000032',
  }
  const [first, second] = await Promise.all([
    control(request),
    control(request),
  ])

  assert.deepEqual(bodies[0], {
    action: 'wake',
    target_role: 'codex_cli_syzygy',
    client_id: request.clientId,
    confirm_running_tasks: false,
  })
  assert.deepEqual(bodies[0], bodies[1])
  assert.equal(first.command.id, second.command.id)
  assert.equal(first.command.targetRole, 'codex_cli_syzygy')
})

test('runtime-control client returns a canonical failed command for reconciliation', async () => {
  const control = createRuntimeControlClient({
    endpointUrl: 'https://example.test/functions/v1/runtime-control',
    publishableKey: 'publishable-test-key',
    getAccessToken: async () => 'access-token',
    fetchImpl: async () =>
      new Response(JSON.stringify(responseBody('failed', true)), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
  })

  const result = await control({
    action: 'wake',
    targetRole: 'codex_cli_syzygy',
    clientId: '00000000-0000-4000-8000-000000000032',
  })
  assert.equal(result.httpStatus, 409)
  assert.equal(result.wasDuplicate, true)
  assert.equal(result.command.status, 'failed')
})

test('runtime-control client refuses wake confirmation before sending', async () => {
  let calls = 0
  const control = createRuntimeControlClient({
    endpointUrl: 'https://example.test/functions/v1/runtime-control',
    publishableKey: 'publishable-test-key',
    getAccessToken: async () => 'access-token',
    fetchImpl: async () => {
      calls += 1
      return new Response('{}')
    },
  })

  await assert.rejects(
    control({
      action: 'wake',
      targetRole: 'codex_cli_syzygy',
      clientId: '00000000-0000-4000-8000-000000000032',
      confirmRunningTasks: true,
    }),
    (error) => {
      assert.ok(error instanceof RuntimeControlError)
      assert.equal(error.code, 'INVALID_CONFIRMATION')
      return true
    },
  )
  assert.equal(calls, 0)
})

test('runtime status forces unknown after the mini heartbeat expires', () => {
  const row = {
    last_seen_at: '2026-07-26T08:00:00.000Z',
    heartbeat_data: {
      runtime_statuses: {
        version: 1,
        reported_at: '2026-07-26T08:00:00.000Z',
        roles: {
          codex_cli_syzygy: {
            status: 'busy',
            enabled: true,
            instance_id: '123:codex_cli_syzygy',
          },
        },
      },
    },
  }

  const fresh = normalizeRuntimeStatusSnapshot(row, {
    nowMs: Date.parse('2026-07-26T08:01:00.000Z'),
  })
  const stale = normalizeRuntimeStatusSnapshot(row, {
    nowMs: Date.parse('2026-07-26T08:03:00.001Z'),
  })
  assert.equal(fresh.roles.codex_cli_syzygy.status, 'busy')
  assert.equal(fresh.isFresh, true)
  assert.equal(stale.roles.codex_cli_syzygy.status, 'unknown')
  assert.equal(stale.isFresh, false)
})

test('Web wrapper uses the browser session and never writes command tables directly', async () => {
  const [source, app, canary] = await Promise.all([
    readFile(
      new URL('../src/storage/runtimeControl.ts', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/pages/RuntimeControlCanaryPage.tsx', import.meta.url),
      'utf8',
    ),
  ])
  assert.match(source, /client\.auth\.getSession\(\)/u)
  assert.match(source, /functions\/v1\/runtime-control/u)
  assert.match(source, /from\('agent_settings'\)/u)
  assert.doesNotMatch(source, /from\('syzygy_commands'\).*insert/su)
  assert.doesNotMatch(source, /from\('codex_control'\).*insert/su)
  assert.doesNotMatch(source, /service[_-]?role/iu)
  assert.match(app, /path="\/runtime-control-canary"/u)
  assert.match(canary, /runRuntimeControlCanary/u)
  assert.match(canary, /不会确认取消正在执行的任务/u)
})

test('runtime-control canary proves duplicate command ids and fresh wake-to-sleep heartbeats', async () => {
  const statuses = ['waking', 'idle', 'closing', 'offline']
  let statusIndex = 0
  const requests = []
  const result = await runRuntimeControlCanary({
    control: async (request) => {
      requests.push(request)
      const commandId = request.action === 'wake' ? 'wake-command' : 'sleep-command'
      const actionRequestCount = requests.filter(
        (candidate) => candidate.action === request.action,
      ).length
      return {
        httpStatus: actionRequestCount > 2 ? 200 : 202,
        schemaVersion: 1,
        wasDuplicate: actionRequestCount > 1,
        command: {
          id: commandId,
          action: request.action,
          targetRole: request.targetRole,
          status: actionRequestCount > 2 ? 'done' : 'pending',
          idempotencyKey: `runtime-control:v1:${request.clientId}`,
          confirmRunningTasks: false,
          createdAt: '',
          claimedAt: null,
          completedAt: null,
          errorMessage: null,
        },
      }
    },
    loadSnapshot: async () => {
      const status = statuses[Math.min(statusIndex, statuses.length - 1)]
      statusIndex += 1
      return {
        schemaVersion: 1,
        lastSeenAt: '2026-07-26T08:00:00.000Z',
        reportedAt: '2026-07-26T08:00:00.000Z',
        isFresh: true,
        roles: {
          codex_cli_syzygy: {
            status,
            enabled: status !== 'offline',
            instanceId: 'test',
            activeCommandId: null,
            activeTaskId: null,
            lastError: null,
            changedAt: null,
          },
          claude_code_cli_syzygy: {
            status: 'idle',
            enabled: true,
            instanceId: 'test',
            activeCommandId: null,
            activeTaskId: null,
            lastError: null,
            changedAt: null,
          },
        },
      }
    },
    sleep: async () => {},
    targetRole: 'codex_cli_syzygy',
    wakeClientId: '00000000-0000-4000-8000-000000000041',
    sleepClientId: '00000000-0000-4000-8000-000000000042',
  })

  assert.equal(result.wakeCommandId, 'wake-command')
  assert.equal(result.sleepCommandId, 'sleep-command')
  assert.equal(result.sleepStatus, 'offline')
  assert.deepEqual(
    requests.map((request) => request.action),
    ['wake', 'wake', 'wake', 'sleep', 'sleep', 'sleep'],
  )
  assert.equal(
    requests.filter((request) => request.action === 'sleep')
      .every((request) => request.confirmRunningTasks === false),
    true,
  )
})
