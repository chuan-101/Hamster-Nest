import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const owner = '11111111-1111-4111-8111-111111111111'
const task = '22222222-2222-4222-8222-222222222222'
const roles = { codex_cli_syzygy: { enabled: true }, claude_code_cli_syzygy: { enabled: true } }
const schema = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as 'select null::uuid';
create table auth.users(id uuid primary key);
create table public.agent_tasks(id uuid primary key default gen_random_uuid(),user_id uuid, status text, payload_json jsonb default '{}',completed_at timestamptz,error text);
create table public.syzygy_commands(id uuid primary key default gen_random_uuid(),user_id uuid,command_type text,status text,idempotency_key text,payload jsonb,completed_at timestamptz,error_message text);
create unique index command_key on public.syzygy_commands(user_id,idempotency_key) where idempotency_key is not null;
create table public.prompt_templates(user_id uuid,name text,active boolean,content text);
create table public.sessions(id uuid primary key,user_id uuid,conversation_kind text,conversation_profile_key text,handler text);
create table public.messages(user_id uuid,role text,created_at timestamptz,session_id uuid default '55555555-5555-4555-8555-555555555555',sender_key text default 'chuanchuan',target_sender_keys text[] default '{}');
insert into sessions values('55555555-5555-4555-8555-555555555555','${owner}','direct','codex_cli','cli');
create table public.diary_entries(id uuid primary key default gen_random_uuid(),user_id uuid,author text,entry_date date default '2026-09-29',activity_type text,metadata jsonb default '{}',title text,content text);
create table public.agent_events(id bigserial primary key,user_id uuid,actor text,event_type text,entity_type text,entity_id uuid,title text,payload jsonb,importance text);
create table public.test_clock(value timestamptz);
insert into test_clock values('2026-09-29T14:00:00+08:00');
create function public.test_now() returns timestamptz language sql stable as 'select value from public.test_clock';
insert into auth.users values('${owner}');
insert into agent_tasks(id,user_id,status,payload_json) values('${task}','${owner}','running','{"target_role":"codex_cli_syzygy"}');
`

async function fixture() {
  const db = new PGlite()
  await db.exec(schema)
  // Substitute only the clock so boundary cases are deterministic on every CI date.
  const sql = readFileSync(new URL('../supabase/migrations/20260929075337_cli_free_activity.sql', import.meta.url), 'utf8')
    .replaceAll('now()', 'public.test_now()')
  await db.exec(sql)
  const query = async (sql, args = []) => (await db.query(sql, args)).rows
  const rpc = async (name, args) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args))[0].result
  const plan = () => rpc('cli_wake_plan_day', [owner, '2026-09-29'])
  const tick = (enabled = roles, paused = false) => rpc('cli_wake_dispatch', [owner, JSON.stringify(enabled), paused])
  return { db, query, rpc, plan, tick }
}

test('random plans are durable, deterministic, staggered and account scoped', async () => {
  const f = await fixture()
  try {
    await f.plan()
    const before = await f.query('select role,wake_at from cli_wake_schedule order by role')
    assert.equal(before.length, 2)
    assert.ok(Math.abs(Date.parse(before[0].wake_at) - Date.parse(before[1].wake_at)) >= 30 * 60_000)
    await f.plan()
    assert.deepEqual(await f.query('select role,wake_at from cli_wake_schedule order by role'), before)
    await f.db.exec('delete from cli_wake_schedule')
    await f.plan()
    assert.deepEqual(await f.query('select role,wake_at from cli_wake_schedule order by role'), before)
    assert.equal((await f.query("select has_function_privilege('authenticated','public.cli_set_self_alarm(uuid,uuid,timestamptz,text)','execute') as allowed"))[0].allowed, false)
  } finally { await f.db.close() }
})

test('alarms derive self from the task; conflict returns suggestions; one daily alarm survives replay', async () => {
  const f = await fixture()
  try {
    await f.plan()
    const [random] = await f.query("select wake_at from cli_wake_schedule where role='codex_cli_syzygy'")
    const rejected = await f.rpc('cli_set_self_alarm', [owner, task, random.wake_at, 'private note'])
    assert.equal(rejected.ok, false)
    assert.ok(rejected.available_times.length)
    const at = rejected.available_times[0]
    const accepted = await f.rpc('cli_set_self_alarm', [owner, task, at, 'private note'])
    assert.equal(accepted.ok, true)
    assert.equal(accepted.alarm.role, 'codex_cli_syzygy')
    assert.equal((await f.rpc('cli_set_self_alarm', [owner, task, at, 'private note'])).ok, true)
    assert.equal((await f.query("select count(*)::int as n from cli_wake_schedule where kind='alarm'"))[0].n, 1)
    await assert.rejects(f.rpc('cli_set_self_alarm', ['33333333-3333-4333-8333-333333333333', task, at, '']), /running CLI task/)
  } finally { await f.db.close() }
})

async function due(f) {
  await f.plan()
  await f.db.exec("update cli_wake_schedule set wake_at=case when role='codex_cli_syzygy' then '2026-09-29T14:00:00+08:00'::timestamptz else '2026-09-29T18:00:00+08:00'::timestamptz end")
}

test('manual off, paused and missed starts never enqueue or catch up', async () => {
  for (const kind of ['off', 'paused', 'missed']) {
    const f = await fixture()
    try {
      await due(f)
      if (kind === 'missed') await f.db.exec("update test_clock set value='2026-09-29T14:03:00+08:00'")
      await f.tick(kind === 'off' ? {} : roles, kind === 'paused')
      assert.equal((await f.query('select count(*)::int as n from syzygy_commands'))[0].n, 0)
      assert.equal((await f.query("select status from cli_wake_schedule where role='codex_cli_syzygy'"))[0].status, 'skipped')
    } finally { await f.db.close() }
  }
})

test('chat delays once and a second active-chat check skips; collision cannot move another wake', async () => {
  const f = await fixture()
  try {
    await due(f)
    await f.db.exec(`insert into messages(user_id,role,created_at) values('${owner}','user','2026-09-29T13:59:00+08:00')`)
    await f.tick()
    const [row] = await f.query("select * from cli_wake_schedule where role='codex_cli_syzygy'")
    assert.equal(row.delayed, true)
    assert.equal(Date.parse(row.wake_at), Date.parse('2026-09-29T14:30:00+08:00'))
    await f.db.exec("update test_clock set value='2026-09-29T14:30:00+08:00'; update messages set created_at='2026-09-29T14:29:00+08:00'")
    await f.tick()
    assert.equal((await f.query('select skip_reason from cli_wake_schedule where id=$1', [row.id]))[0].skip_reason, 'chatting_after_delay')
  } finally { await f.db.close() }
})

test('queue and claim are idempotent; linked diary is unique and notification never includes content', async () => {
  const f = await fixture()
  try {
    await due(f)
    await f.tick(); await f.tick()
    const [command] = await f.query('select * from syzygy_commands')
    assert.ok(command)
    const wakeId = command.payload.wake_id
    const args = [owner, JSON.stringify(roles), false, wakeId, command.id, task]
    const claimed = await f.rpc('cli_wake_dispatch', args)
    assert.equal(claimed.status, 'running')
    assert.equal(await f.rpc('cli_wake_dispatch', args), null)
    assert.equal(Date.parse(claimed.deadline) - Date.parse(claimed.started_at), 3600_000)
    const insert = "insert into diary_entries(user_id,author,activity_type,metadata,title,content) values($1,'codex_cli','free_activity',$2,'秘密标题','秘密正文')"
    await f.query(insert, [owner, JSON.stringify({ task_id: task })])
    await assert.rejects(f.query(insert, [owner, JSON.stringify({ task_id: task })]), /duplicate key/)
    const events = await f.query('select * from agent_events')
    assert.equal(events.length, 1)
    assert.doesNotMatch(JSON.stringify(events), /秘密/)
    assert.equal(events[0].payload.screen, 'diary')
    const finish = await f.rpc('cli_wake_finish', [owner, wakeId, task, 'completed', null])
    assert.equal(finish.diary_missing, false)
  } finally { await f.db.close() }
})

test('crash is audited without replay; backfill attaches to original task and clears missing receipt', async () => {
  const f = await fixture()
  try {
    await due(f); await f.tick()
    const [c] = await f.query('select * from syzygy_commands')
    await f.rpc('cli_wake_dispatch', [owner, JSON.stringify(roles), false, c.payload.wake_id, c.id, task])
    assert.equal(await f.rpc('cli_wake_recover', [owner, '2026-09-29T14:01:00+08:00']), 1)
    const [w] = await f.query('select * from cli_wake_schedule where id=$1', [c.payload.wake_id])
    assert.equal(w.status, 'failed'); assert.equal(w.diary_missing, true)
    await f.query("insert into diary_entries(user_id,author,activity_type,metadata,content) values($1,'codex_cli','free_activity',$2,'补写')", [owner, JSON.stringify({ task_id: task })])
    assert.equal((await f.query('select diary_missing from cli_wake_schedule where id=$1', [w.id]))[0].diary_missing, false)
    await f.tick()
    assert.equal((await f.query('select count(*)::int as n from syzygy_commands'))[0].n, 1)
  } finally { await f.db.close() }
})

test('cross-role alarms and own fixed-job margins use the shared daily ledger', async () => {
  const f = await fixture()
  try {
    await due(f)
    const otherTask = '44444444-4444-4444-8444-444444444444'
    await f.query("insert into agent_tasks(id,user_id,status,payload_json) values($1,$2,'running','{\"target_role\":\"claude_code_cli_syzygy\"}')", [otherTask, owner])
    assert.equal((await f.rpc('cli_set_self_alarm', [owner, task, '2026-09-29T16:00:00+08:00', ''])).ok, true)
    assert.equal((await f.rpc('cli_set_self_alarm', [owner, otherTask, '2026-09-29T16:29:00+08:00', ''])).ok, false)
    assert.equal((await f.rpc('cli_set_self_alarm', [owner, otherTask, '2026-09-29T16:30:00+08:00', ''])).ok, true)
    await f.query("insert into prompt_templates values($1,'machine_job_test',true,$2)", [owner, JSON.stringify({ targetRole: 'codex_cli_syzygy', hour: 20, minute: 0, daysOfWeek: null })])
    assert.equal(await f.rpc('cli_wake_slot_available', [owner, 'codex_cli_syzygy', '2026-09-29T20:59:00+08:00', 'alarm']), false)
    assert.equal(await f.rpc('cli_wake_slot_available', [owner, 'codex_cli_syzygy', '2026-09-29T21:00:00+08:00', 'alarm']), true)
  } finally { await f.db.close() }
})

test('queued activity expires without late execution and a conflicting delay is skipped', async () => {
  for (const delayed of [false, true]) {
    const f = await fixture()
    try {
      await due(f)
      if (delayed) {
        await f.db.exec("update cli_wake_schedule set wake_at='2026-09-29T14:45:00+08:00' where role='claude_code_cli_syzygy'")
        await f.query("insert into messages(user_id,role,created_at) values($1,'user',public.test_now()-interval '1 minute')", [owner])
        await f.tick()
      } else {
        await f.tick()
        const [command] = await f.query('select * from syzygy_commands')
        await f.db.exec("update test_clock set value='2026-09-29T14:03:00+08:00'")
        assert.equal(await f.rpc('cli_wake_dispatch', [owner, JSON.stringify(roles), false, command.payload.wake_id, command.id, task]), null)
        assert.equal((await f.query('select status from syzygy_commands'))[0].status, 'failed')
      }
      assert.equal((await f.query("select status from cli_wake_schedule where role='codex_cli_syzygy'"))[0].status, 'skipped')
    } finally { await f.db.close() }
  }
})


test('only this CLI direct chat or a user Lounge mention postpones its activity', async () => {
  const f = await fixture()
  try {
    for (const [kind, profile, handler, sender, targets, delayed] of [
      ['direct', 'syzygy', 'api', 'chuanchuan', [], false],
      ['direct', 'claude_cli', 'cli', 'chuanchuan', [], false],
      ['direct', 'codex_cli', 'cli', 'chuanchuan', [], true],
      ['group', null, 'router', 'chuanchuan', [], false],
      ['group', null, 'router', 'chuanchuan', ['claude_cli'], false],
      ['group', null, 'router', 'chuanchuan', ['codex_cli'], true],
      ['group', null, 'router', 'claude_cli', ['codex_cli'], false],
    ]) {
      await f.db.exec('delete from cli_wake_schedule; delete from syzygy_commands; delete from messages')
      await due(f)
      await f.query('update sessions set conversation_kind=$1,conversation_profile_key=$2,handler=$3', [kind, profile, handler])
      await f.query("insert into messages(user_id,role,created_at,sender_key,target_sender_keys) values($1,$2,public.test_now(),$3,$4)", [owner, sender === 'chuanchuan' ? 'user' : 'assistant', sender, targets])
      await f.tick()
      const [wake] = await f.query("select delayed,status from cli_wake_schedule where role='codex_cli_syzygy'")
      assert.equal(wake.delayed, delayed, JSON.stringify([kind, profile, sender, targets]))
      assert.equal(wake.status, delayed ? 'planned' : 'queued')
    }
  } finally { await f.db.close() }
})

test('unstarted skipped or cancelled plans release slots; started activity retains spacing', async () => {
  const f = await fixture()
  try {
    await due(f)
    for (const status of ['skipped', 'cancelled']) {
      await f.query("update cli_wake_schedule set status=$1,started_at=null where role='codex_cli_syzygy'", [status])
      const args = [owner, 'claude_code_cli_syzygy', '2026-09-29T14:15:00+08:00', 'alarm']
      assert.equal(await f.rpc('cli_wake_slot_available', args), true)
      await f.db.exec("update cli_wake_schedule set started_at=public.test_now() where role='codex_cli_syzygy'")
      assert.equal(await f.rpc('cli_wake_slot_available', args), false)
    }
  } finally { await f.db.close() }
})
