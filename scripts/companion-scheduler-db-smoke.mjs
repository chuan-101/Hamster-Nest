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
  throw new Error(
    '--module-root is required; see supabase/smoke-tests/README.md',
  )
}

const embeddedModule = await import(
  pathToFileURL(
    path.join(
      path.resolve(moduleRoot),
      'node_modules/embedded-postgres/dist/index.js',
    ),
  ).href,
)
const EmbeddedPostgres = embeddedModule.default ?? embeddedModule
const postgresMetaRoot = path.join(
  path.resolve(moduleRoot),
  'node_modules/@supabase/postgres-meta',
)
const postgresMetaPackage = JSON.parse(
  await readFile(path.join(postgresMetaRoot, 'package.json'), 'utf8'),
)
assert.equal(postgresMetaPackage.version, '0.96.6')
const postgresMetaServer = path.join(postgresMetaRoot, 'dist/server/server.js')
const fixtureSql = await readFile(
  path.join(
    repoRoot,
    'supabase/smoke-tests/companion_scheduler_fixture.sql',
  ),
  'utf8',
)
const migrationSql = await readFile(
  path.join(
    repoRoot,
    'supabase/migrations/20260803125308_v4_1_companion_scheduler_canonical.sql',
  ),
  'utf8',
)
const rollbackSql = await readFile(
  path.join(
    repoRoot,
    'supabase/rollback-contracts/20260803125308_v4_1_companion_scheduler_canonical.sql',
  ),
  'utf8',
)
const sourceTypes = await readFile(
  path.join(repoRoot, 'src/supabase/database.types.ts'),
  'utf8',
)

const ownerId = '10000000-0000-4000-8000-000000000001'
const firstClientId = '60000000-0000-4000-8000-000000000001'
const failedClientId = '60000000-0000-4000-8000-000000000002'
const permissionClientId = '60000000-0000-4000-8000-000000000003'
const reapplyClientId = '60000000-0000-4000-8000-000000000004'
const generatedAt = '2026-08-02T04:00:00.000Z'
const model = 'openai/local-smoke-model'
const databaseDir = await mkdtemp(
  path.join(tmpdir(), 'hamster-companion-postgres-'),
)
const port = await reservePort()
const password = 'local-companion-smoke-only'
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

  const version = await client.query(
    "select current_setting('server_version') as version",
  )
  assert.match(version.rows[0].version, /^17\.6/u)

  await client.query(fixtureSql)
  await client.query(migrationSql)
  await client.query(migrationSql)

  const privilegeRows = await client.query(`
    select
      has_function_privilege(
        'anon',
        'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)',
        'EXECUTE'
      ) as anon_execute,
      has_function_privilege(
        'authenticated',
        'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)',
        'EXECUTE'
      ) as authenticated_execute,
      has_function_privilege(
        'service_role',
        'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)',
        'EXECUTE'
      ) as service_execute
  `)
  assert.deepEqual(privilegeRows.rows[0], {
    anon_execute: false,
    authenticated_execute: false,
    service_execute: true,
  })

  const firstArgs = publishArgs({
    clientId: firstClientId,
    content: '本地数据库验真消息。',
  })
  await assertRoleRejected(client, 'anon', {
    ...firstArgs,
    clientId: permissionClientId,
  })
  await assertRoleRejected(client, 'authenticated', {
    ...firstArgs,
    clientId: permissionClientId,
  })

  const first = await publishAsService(client, firstArgs)
  const repeated = await publishAsService(client, firstArgs)
  assert.deepEqual(repeated, first)

  const firstCounts = await readCanonicalCounts(client, firstClientId)
  assert.deepEqual(firstCounts, { messages: 1, events: 1, checkins: 1 })
  assert.equal(first.message.sender_key, 'app_companion')
  assert.equal(first.event.event_type, 'companion_proactive_published')
  assert.equal(first.checkin_log.decision, 'sent')

  const publishedRows = await client.query(
    `
      select
        message.meta,
        event.payload,
        log.canonical_message_id,
        log.canonical_event_id,
        log.generation_audit
      from public.messages message
      join public.agent_events event
        on event.entity_id = message.id
       and event.event_type = 'companion_proactive_published'
      join public.checkin_logs log
        on log.canonical_message_id = message.id
      where message.client_id = $1
    `,
    [firstClientId],
  )
  assert.equal(publishedRows.rowCount, 1)
  const published = publishedRows.rows[0]
  assert.equal(published.meta.source, 'companion_scheduler')
  assert.equal(published.meta.generation.profile.version, 6)
  assert.equal(published.meta.generation.port.version, 7)
  assert.equal(published.meta.generation.prompts.identity.version, 3)
  assert.equal(published.meta.generation.prompts.style.version, 4)
  assert.equal(published.meta.generation.prompts.scenario.version, 5)
  assert.equal('content' in published.payload, false)
  assert.equal('body' in published.payload, false)
  assert.equal(published.payload.message_id, first.message.id)
  assert.equal(published.canonical_message_id, first.message.id)
  assert.equal(Number(published.canonical_event_id), Number(first.event.id))

  await assertRejectsCode(
    () =>
      publishAsService(client, {
        ...firstArgs,
        content: '同 UUID 的不同正文。',
      }),
    '23505',
  )
  assert.deepEqual(await readCanonicalCounts(client, firstClientId), firstCounts)

  await assertRejectsCode(
    () =>
      publishAsService(client, {
        ...publishArgs({
          clientId: failedClientId,
          content: '版本漂移不应写入。',
        }),
        generationAudit: {
          ...generationAudit(),
          profile_version: 999,
        },
      }),
    '40001',
  )
  assert.deepEqual(await readCanonicalCounts(client, failedClientId), {
    messages: 0,
    events: 0,
    checkins: 0,
  })

  await client.query(`
    create or replace function public.smoke_fail_companion_checkin()
    returns trigger
    language plpgsql
    set search_path = ''
    as $trigger$
    begin
      if new.input_summary = 'force-mid-transaction-failure' then
        raise exception using
          errcode = 'P0001',
          message = 'forced local checkin failure';
      end if;
      return new;
    end
    $trigger$;

    create trigger smoke_fail_companion_checkin
    before insert on public.checkin_logs
    for each row execute function public.smoke_fail_companion_checkin();
  `)
  await assertRejectsCode(
    () =>
      publishAsService(client, {
        ...publishArgs({
          clientId: failedClientId,
          content: '中途失败不得留下半态。',
        }),
        inputSummary: 'force-mid-transaction-failure',
      }),
    'P0001',
  )
  await client.query(`
    drop trigger smoke_fail_companion_checkin on public.checkin_logs;
    drop function public.smoke_fail_companion_checkin();
  `)
  assert.deepEqual(await readCanonicalCounts(client, failedClientId), {
    messages: 0,
    events: 0,
    checkins: 0,
  })

  const factsBeforeRollback = await readFactTotals(client)
  await client.query(rollbackSql)
  const rollbackObjects = await client.query(`
    select
      to_regprocedure(
        'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)'
      ) is null as function_removed,
      not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'checkin_logs'
          and column_name in (
            'canonical_message_id',
            'canonical_event_id',
            'idempotency_key',
            'topic_fingerprint',
            'generation_audit'
          )
      ) as columns_removed,
      to_regclass('public.agent_events_companion_proactive_published_unique') is null
        as event_index_removed
  `)
  assert.deepEqual(rollbackObjects.rows[0], {
    function_removed: true,
    columns_removed: true,
    event_index_removed: true,
  })
  assert.deepEqual(await readFactTotals(client), factsBeforeRollback)

  await client.query(migrationSql)
  const reapply = await publishAsService(
    client,
    publishArgs({
      clientId: reapplyClientId,
      content: '回滚后重新应用仍可发布。',
    }),
  )
  assert.deepEqual(await readCanonicalCounts(client, reapplyClientId), {
    messages: 1,
    events: 1,
    checkins: 1,
  })

  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres?sslmode=disable`
  const typeShape = await client.query(`
    select
      array_agg(column_name::text order by column_name) filter (
        where table_name = 'checkin_logs'
          and column_name in (
            'canonical_event_id',
            'canonical_message_id',
            'generation_audit',
            'idempotency_key',
            'topic_fingerprint'
          )
      )::text[] as checkin_columns,
      to_regprocedure(
        'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamp with time zone,text,text,text,integer,text,jsonb,text)'
      ) is not null as publish_rpc_present
    from information_schema.columns
    where table_schema = 'public'
  `)
  assert.deepEqual(typeShape.rows[0], {
    checkin_columns: [
      'canonical_event_id',
      'canonical_message_id',
      'generation_audit',
      'idempotency_key',
      'topic_fingerprint',
    ],
    publish_rpc_present: true,
  })

  const generatedTypes = await runCommand(
    process.execPath,
    [postgresMetaServer],
    {
      env: {
        ...process.env,
        PG_META_DB_URL: databaseUrl,
        PG_CONN_TIMEOUT_SECS: '15',
        PG_QUERY_TIMEOUT_SECS: '15',
        PG_META_GENERATE_TYPES: 'typescript',
        PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS: 'public',
        PG_META_GENERATE_TYPES_SWIFT_ACCESS_CONTROL: 'internal',
        PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS: 'true',
      },
    },
  )
  const generatedTypesOutput = [generatedTypes.stderr, generatedTypes.stdout]
    .filter(Boolean)
    .join('\n')
  assert.equal(generatedTypes.exitCode, 0, generatedTypesOutput)
  for (const field of [
    'canonical_event_id',
    'canonical_message_id',
    'generation_audit',
    'idempotency_key',
    'topic_fingerprint',
    'conversation_companion_publish_proactive',
  ]) {
    assert.match(generatedTypes.stdout, new RegExp(field, 'u'))
    assert.match(sourceTypes, new RegExp(field, 'u'))
  }

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
        privileges: privilegeRows.rows[0],
        firstPublish: first,
        firstCounts,
        driftConflict: '23505',
        generationConflict: '40001',
        forcedFailure: 'P0001',
        forcedFailureCounts: await readCanonicalCounts(client, failedClientId),
        rollback: rollbackObjects.rows[0],
        factsPreservedByRollback: factsBeforeRollback,
        reapplyPublish: reapply,
        databaseTypeShapeChecked: typeShape.rows[0],
        sourceTypesChecked: true,
        generatedTypesEngine: `@supabase/postgres-meta@${postgresMetaPackage.version}`,
        generatedTypesChecked: true,
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

function publishArgs({ clientId, content }) {
  return {
    clientId,
    content,
    generatedAt,
    model,
    inputSummary: 'local companion scheduler smoke',
    rawOutput: content,
    tokensUsed: 42,
    topicFingerprint: `local-topic-${clientId}`,
    generationAudit: generationAudit(),
    importance: 'normal',
  }
}

function generationAudit() {
  return {
    model,
    profile_version: 6,
    port_version: 7,
    identity_prompt_version: 3,
    style_prompt_version: 4,
    scenario_prompt_name: 'checkin_day',
    scenario_prompt_version: 5,
    context: {
      recipe_version: 1,
      epoch: 'asia_shanghai_day',
      external_sources: [],
      token_budget: 6000,
      used_tokens: 12,
      message_ids: [],
    },
  }
}

async function publishAsService(databaseClient, args) {
  await databaseClient.query('set role service_role')
  try {
    const result = await databaseClient.query(
      `
        select public.conversation_companion_publish_proactive(
          $1::uuid,
          $2::uuid,
          $3::text,
          $4::timestamptz,
          $5::text,
          $6::text,
          $7::text,
          $8::integer,
          $9::text,
          $10::jsonb,
          $11::text
        ) as result
      `,
      [
        ownerId,
        args.clientId,
        args.content,
        args.generatedAt,
        args.model,
        args.inputSummary,
        args.rawOutput,
        args.tokensUsed,
        args.topicFingerprint,
        args.generationAudit,
        args.importance,
      ],
    )
    return result.rows[0].result
  } finally {
    await databaseClient.query('reset role')
  }
}

async function assertRoleRejected(databaseClient, role, args) {
  await databaseClient.query(`set role ${role}`)
  try {
    await assertRejectsCode(
      () =>
        databaseClient.query(
          `
            select public.conversation_companion_publish_proactive(
              $1::uuid,
              $2::uuid,
              $3::text,
              $4::timestamptz,
              $5::text,
              $6::text,
              $7::text,
              $8::integer,
              $9::text,
              $10::jsonb,
              $11::text
            )
          `,
          [
            ownerId,
            args.clientId,
            args.content,
            args.generatedAt,
            args.model,
            args.inputSummary,
            args.rawOutput,
            args.tokensUsed,
            args.topicFingerprint,
            args.generationAudit,
            args.importance,
          ],
        ),
      '42501',
    )
  } finally {
    await databaseClient.query('reset role')
  }
}

async function assertRejectsCode(operation, expectedCode) {
  let caught = null
  try {
    await operation()
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `expected PostgreSQL error ${expectedCode}`)
  assert.equal(caught.code, expectedCode, caught.message)
}

async function readCanonicalCounts(databaseClient, clientId) {
  const result = await databaseClient.query(
    `
      select
        (select count(*)::integer
         from public.messages
         where client_id = $1) as messages,
        (select count(*)::integer
         from public.agent_events event
         join public.messages message on message.id = event.entity_id
         where message.client_id = $1
           and event.event_type = 'companion_proactive_published') as events,
        (select count(*)::integer
         from public.checkin_logs log
         join public.messages message on message.id = log.canonical_message_id
         where message.client_id = $1) as checkins
    `,
    [clientId],
  )
  return result.rows[0]
}

async function readFactTotals(databaseClient) {
  const result = await databaseClient.query(`
    select
      (select count(*)::integer from public.messages) as messages,
      (select count(*)::integer from public.agent_events) as events,
      (select count(*)::integer from public.checkin_logs) as checkins
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

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: options.env ?? process.env,
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
    child.once('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr })
    })
  })
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}
