import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const owner='11111111-1111-4111-8111-111111111111', stranger='22222222-2222-4222-8222-222222222222', session='33333333-3333-4333-8333-333333333333',reply='44444444-4444-4444-8444-444444444444'
test('API tool ledger enforces RLS, service-only writes, unique receipts and honest usage totals', async()=>{
  const db=new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
      create table public.sessions(id uuid primary key);create table public.messages(id uuid primary key);
      insert into auth.users values('${owner}'),('${stranger}');insert into sessions values('${session}');insert into messages values('${reply}');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261105123007_api_conversation_tools.sql',import.meta.url),'utf8'))
    await db.exec(`insert into api_conversation_tools(user_id,session_id) values('${owner}','${session}');
      insert into api_model_calls(user_id,session_id,reply_id,attempt,round,status,usage) values
      ('${owner}','${session}','${reply}',1,0,'completed','{"cost":0.02,"prompt_tokens":10,"completion_tokens":5}'),
      ('${owner}','${session}','${reply}',1,1,'failed',null);
      insert into api_tool_executions(user_id,session_id,reply_id,fingerprint,tool_id,status) values('${owner}','${session}','${reply}','fp','timeline__add_timeline','running');`)
    await assert.rejects(()=>db.exec(`insert into api_tool_executions(user_id,session_id,reply_id,fingerprint,tool_id,status) values('${owner}','${session}','${reply}','fp','timeline__add_timeline','running')`),/duplicate key/)
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`)
    const totals=(await db.query(`select api_conversation_usage('${session}') as usage`)).rows[0].usage
    assert.equal(totals.session.calls,2);assert.equal(totals.session.cost_usd,0.02);assert.equal(totals.session.unknown_calls,1)
    assert.equal(totals.today.calls,2)
    await assert.rejects(()=>db.exec(`update api_conversation_tools set enabled_tools='{bash}'`),/permission denied/)
    await db.exec(`select set_config('request.jwt.claim.sub','${stranger}',false)`)
    assert.equal((await db.query('select * from api_conversation_tools')).rows.length,0)
    assert.equal((await db.query(`select api_conversation_usage('${session}') as usage`)).rows[0].usage.session.calls,0)
  } finally {await db.close()}
})

test('timeline source migration preserves existing writers and admits API writes', async()=>{
  const db=new PGlite()
  try {
    await db.exec("create table public.timeline_entries(source text constraint timeline_entries_source_check check(source in ('claude','expo_app')));insert into timeline_entries values('claude'),('expo_app')")
    await db.exec(await readFile(new URL('../supabase/migrations/20261105123533_timeline_api_source.sql',import.meta.url),'utf8'))
    await db.exec("insert into timeline_entries values('api')")
    assert.equal((await db.query('select * from timeline_entries')).rows.length,3)
    await assert.rejects(()=>db.exec("insert into timeline_entries values('bogus')"),/check constraint/)
  } finally { await db.close() }
})
