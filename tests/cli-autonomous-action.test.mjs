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
create table public.agent_tasks(id uuid primary key default gen_random_uuid(),user_id uuid, executor text, status text,result_summary text, payload_json jsonb default '{}',completed_at timestamptz,error text);
create table public.syzygy_commands(id uuid primary key default gen_random_uuid(),user_id uuid,command_type text,status text,idempotency_key text,payload jsonb,completed_at timestamptz,error_message text);
create unique index command_key on public.syzygy_commands(user_id,idempotency_key) where idempotency_key is not null;
create table public.prompt_templates(user_id uuid,name text,active boolean,content text);
create table public.sessions(id uuid primary key,user_id uuid,conversation_kind text,conversation_profile_key text,handler text,session_key text,is_archived boolean default false);
create table public.messages(id uuid primary key default gen_random_uuid(),content text,client_id uuid,client_created_at timestamptz,meta jsonb,user_id uuid,role text,created_at timestamptz,session_id uuid default '55555555-5555-4555-8555-555555555555',sender_key text default 'chuanchuan',target_sender_keys text[] default '{}');
insert into sessions(id,user_id,conversation_kind,conversation_profile_key,handler) values('55555555-5555-4555-8555-555555555555','${owner}','direct','codex_cli','cli');
create table public.diary_entries(id uuid primary key default gen_random_uuid(),user_id uuid,author text,entry_date date default '2026-09-29',activity_type text,visibility text default 'private',metadata jsonb default '{}',title text,content text);
create table public.agent_events(id bigserial primary key,user_id uuid,actor text,event_type text,entity_type text,entity_id uuid,title text,payload jsonb,importance text);
create table public.test_clock(value timestamptz);
insert into test_clock values('2026-09-29T14:00:00+08:00');
create function public.test_now() returns timestamptz language sql stable as 'select value from public.test_clock';
insert into auth.users values('${owner}');
insert into agent_tasks(id,user_id,status,payload_json) values('${task}','${owner}','running','{"target_role":"codex_cli_syzygy"}');
`

async function fixture({legacy=false}={}) {
  const db = new PGlite()
  await db.exec(schema)
  // Substitute only the clock so boundary cases are deterministic on every CI date.
  const sql = readFileSync(new URL('../supabase/migrations/20260929075337_cli_free_activity.sql', import.meta.url), 'utf8')
    .replaceAll('now()', 'public.test_now()')
  await db.exec(sql)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005114642_cli_activity_dispatch_boundaries.sql', import.meta.url), 'utf8').replaceAll('now()', 'public.test_now()'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261028073454_cli_relay_activity.sql', import.meta.url), 'utf8').replaceAll('now()', 'public.test_now()'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261028090941_cli_relay_chat_schedule.sql', import.meta.url), 'utf8').replaceAll('now()', 'public.test_now()'))
  await db.exec(`insert into sessions(id,user_id,conversation_kind,conversation_profile_key,handler,session_key) values('66666666-6666-4666-8666-666666666666','${owner}','direct','claude_cli','cli','syzygy_claude_cli')`)
  const query = async (sql, args = []) => (await db.query(sql, args)).rows
  const rpc = async (name, args) => (await query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args))[0].result
  const plan = () => rpc('cli_wake_plan_day', [owner, '2026-09-29'])
  const tick = (enabled = roles, paused = false) => rpc('cli_wake_dispatch', [owner, JSON.stringify(enabled), paused])
  await db.exec(readFileSync(new URL('../supabase/migrations/20261031065834_cli_autonomous_action.sql', import.meta.url), 'utf8').replaceAll('now()', 'public.test_now()'))
  if (!legacy) await db.exec(readFileSync(new URL('../supabase/migrations/20261101100045_cli_autonomous_two_windows.sql', import.meta.url), 'utf8').replaceAll('now()', 'public.test_now()'))
  await db.exec("update sessions set session_key='syzygy_codex_cli' where conversation_profile_key='codex_cli'")
  return { db, query, rpc, plan, tick }
}

const codex='codex_cli_syzygy', claude='claude_code_cli_syzygy'
async function blank(f) {await f.plan();await f.db.exec("update cli_wake_schedule set status='skipped'")}
const alarm=(f,at,note='下次带一份具体发现',target=null,reason='')=>f.rpc('cli_schedule_action_alarm',[owner,task,at,note,target,reason])
async function running(f,role=codex,at='2026-09-29T14:00:00+08:00') {
 await blank(f)
 await f.query("update agent_tasks set payload_json=$1 where id=$2",[JSON.stringify({target_role:role}),task])
 const [w]=await f.query("update cli_wake_schedule set status='running',task_id=$1,started_at=$2,wake_at=$2,deadline=$2::timestamptz+interval '1 hour' where role=$3 and random_slot=1 returning *",[task,at,role])
 return w
}
test('two daily random windows reach 21:00 and completed slots never regenerate',async()=>{
 const f=await fixture();try {
 await f.db.exec(`insert into prompt_templates values('${owner}','machine_job_block',true,'{"targetRole":"codex_cli_syzygy","hour":19,"minute":30,"daysOfWeek":null}')`)
 await f.plan();const before=await f.query('select id,role,wake_at from cli_wake_schedule order by role');await f.plan();assert.deepEqual(await f.query('select id,role,wake_at from cli_wake_schedule order by role'),before)
 await f.db.exec("update cli_wake_schedule set status='skipped'")
 assert.equal(await f.rpc('cli_wake_slot_available',[owner,codex,'2026-09-29T21:00:00+08:00','random']),true)
 assert.equal(await f.rpc('cli_wake_slot_available',[owner,codex,'2026-09-29T21:01:00+08:00','random']),false)
 assert.equal(await f.rpc('cli_wake_slot_available',[owner,codex,'2026-09-29T10:59:00+08:00','random']),false)
 await f.db.exec("update cli_wake_schedule set status='completed'; update test_clock set value='2026-09-29T20:50:00+08:00'");await f.tick();assert.equal((await f.query('select count(*)::int n from cli_wake_schedule'))[0].n,4)
 }finally{await f.db.close()}
})
test('multiple self alarms are durable, hourly, idempotent, and task/owner scoped',async()=>{
 const f=await fixture();try{await running(f)
 const a=await alarm(f,'2026-09-29T15:00:00+08:00');assert.equal(a.ok,true)
 const b=await alarm(f,'2026-09-29T16:00:00+08:00');assert.equal(b.ok,true);assert.notEqual(a.alarm.id,b.alarm.id)
 assert.equal((await alarm(f,'2026-09-29T15:00:00+08:00')).alarm.id,a.alarm.id)
 assert.equal((await alarm(f,'2026-09-29T16:30:00+08:00')).reason,'time_conflict')
 await assert.rejects(f.rpc('cli_schedule_action_alarm',['33333333-3333-4333-8333-333333333333',task,'2026-09-29T19:00:00+08:00']),/running CLI task/)
 await f.db.exec("update agent_tasks set status='completed'");await assert.rejects(alarm(f,'2026-09-29T19:00:00+08:00'),/running CLI task/)
 }finally{await f.db.close()}
})
test('alarms at any hour need no reason, may cross midnight, and cannot exceed 24 hours',async()=>{
 const f=await fixture();try{await blank(f)
 const a=await alarm(f,'2026-09-30T00:10:00+08:00','询问身体状态');assert.equal(a.ok,true);assert.equal(a.lounge_note_required,false);assert.equal(a.alarm.local_date,'2026-09-30')
 assert.equal((await alarm(f,'2026-09-30T14:00:01+08:00','晚点',null,'照顾')).reason,'outside_24_hour_horizon')
 await f.db.exec("update test_clock set value='2026-09-30T00:10:00+08:00'");await f.tick();const [w]=await f.query('select * from cli_wake_schedule where id=$1',[a.alarm.id]);assert.equal(w.status,'queued')
 const run=await f.rpc('cli_wake_dispatch',[owner,JSON.stringify(roles),false,w.id,w.command_id,task]);assert.equal(run.status,'running');assert.equal(Date.parse(run.deadline)-Date.parse(run.started_at),3600000)
 }finally{await f.db.close()}
})
test('delegation requires a handoff note and respects recipient and cross-midnight spacing',async()=>{
 const f=await fixture();try{await running(f)
 assert.equal((await alarm(f,'2026-09-29T15:00:00+08:00','',claude)).reason,'handoff_note_required')
 assert.equal((await alarm(f,'2026-09-29T14:29:00+08:00','帮我看书摘',claude)).reason,'time_conflict')
 const handoff=await alarm(f,'2026-09-29T14:30:00+08:00','我撞上任务，请读最新书摘后留旁批',claude);assert.equal(handoff.ok,true);assert.equal(handoff.alarm.delegated_from,codex)
 assert.equal((await alarm(f,'2026-09-29T15:20:00+08:00','第二件',claude)).reason,'time_conflict')
 assert.equal((await alarm(f,'2026-09-29T23:45:00+08:00','照看',null,'生病')).ok,true)
 assert.equal((await alarm(f,'2026-09-30T00:10:00+08:00','接手',claude,'生病')).reason,'time_conflict')
 assert.equal((await alarm(f,'2026-09-30T00:20:00+08:00','接手',claude,'生病')).ok,true)
 }finally{await f.db.close()}
})
test('fixed jobs on adjacent dates are excluded, including a midnight alarm',async()=>{
 const f=await fixture();try{await blank(f)
 await f.db.exec(`insert into prompt_templates values('${owner}','machine_job_midnight',true,'{"targetRole":"codex_cli_syzygy","hour":0,"minute":20,"daysOfWeek":[3]}')`)
 assert.equal((await alarm(f,'2026-09-29T23:30:00+08:00','照看',null,'生病')).reason,'time_conflict')
 assert.equal((await alarm(f,'2026-09-30T01:20:00+08:00','照看',null,'生病')).ok,true)
 }finally{await f.db.close()}
})
test('each CLI shares only to its own canonical session, once per wake',async()=>{
 for(const role of [codex,claude]){const f=await fixture();try{const w=await running(f,role)
 const first=await f.rpc('cli_relay_share',[owner,task,w.id,'带来一首歌']);const replay=await f.rpc('cli_relay_share',[owner,task,w.id,'带来一首歌']);assert.equal(first.message_id,replay.message_id)
 const [m]=await f.query('select sender_key,session_id from messages');assert.equal(m.sender_key,role===codex?'codex_cli':'claude_cli');assert.equal(m.session_id,role===codex?'55555555-5555-4555-8555-555555555555':'66666666-6666-4666-8666-666666666666')
 assert.equal((await f.query('select count(*)::int n from agent_events'))[0].n,1)
 }finally{await f.db.close()}}
})
test('daily diary appends action records once per round, keeps private prose separate and never pushes append',async()=>{
 const f=await fixture();try{const w=await running(f)
 const write=()=>f.rpc('cli_action_append_diary',[owner,task,JSON.stringify(['给书摘留旁批']), '今天读到了一句喜欢的话'])
 const a=await write();assert.equal((await write()).id,a.id)
 let [page]=await f.query('select * from diary_entries');assert.match(page.content,/## 行动记录\n- 14:00 给书摘留旁批/);assert.match(page.content,/## 日记/)
 const nextTask='77777777-7777-4777-8777-777777777777'
 await f.db.exec(`update cli_wake_schedule set status='completed' where id='${w.id}';insert into agent_tasks(id,user_id,status,payload_json) values('${nextTask}','${owner}','running','{"target_role":"codex_cli_syzygy"}');insert into cli_wake_schedule(user_id,role,local_date,kind,wake_at,status,task_id) values('${owner}','${codex}','2026-09-29','alarm','2026-09-29T16:00:00+08:00','running','${nextTask}')`)
 await f.rpc('cli_action_append_diary',[owner,nextTask,JSON.stringify(['带来一份推荐']),null]);[page]=await f.query('select * from diary_entries');assert.equal(page.metadata.action_segments.length,2);assert.equal(page.metadata.task_id,task)
 assert.equal((await f.query('select count(*)::int n from diary_entries'))[0].n,1);assert.equal((await f.query("select count(*)::int n from agent_events where event_type='cli_diary_created'"))[0].n,1)
 assert.equal((await f.rpc('cli_wake_finish',[owner,(await f.query('select id from cli_wake_schedule where task_id=$1',[nextTask]))[0].id,nextTask,'completed'])).action_missing,false)
 }finally{await f.db.close()}
})
test('one page existing does not satisfy a missing round action; shared pages require explicit consent',async()=>{
 const f=await fixture();try{const w=await running(f)
 await assert.rejects(f.rpc('cli_action_append_diary',[owner,task,'[]',null]),/concrete action/)
 const result=await f.rpc('cli_wake_finish',[owner,w.id,task,'completed']);assert.equal(result.diary_missing,true);assert.equal(result.action_missing,true)
 await f.query("update cli_wake_schedule set status='running' where id=$1",[w.id]);await f.rpc('cli_action_append_diary',[owner,task,'["已点歌"]',null])
 await f.db.exec("update diary_entries set visibility='shared',metadata=metadata-'action_segments'")
 await assert.rejects(f.rpc('cli_action_append_diary',[owner,task,'["另一件"]','私密想法']),/allow_shared/)
 assert.equal((await f.rpc('cli_action_append_diary',[owner,task,'["公开记录"]',null,true])).replayed,false)
 }finally{await f.db.close()}
})
test('new mutation RPCs remain service-only with invoker security',async()=>{
 const f=await fixture();try{for(const signature of ['cli_schedule_action_alarm(uuid,uuid,timestamptz,text,text,text)','cli_action_append_diary(uuid,uuid,jsonb,text,boolean)']){
 for(const role of ['anon','authenticated'])assert.equal((await f.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,'public.'+signature]))[0].allowed,false)
 assert.equal((await f.query("select prosecdef from pg_proc where oid=$1::regprocedure",['public.'+signature]))[0].prosecdef,false)
 }}finally{await f.db.close()}
})

test('a delayed alarm keeps its request identity and a midnight tick can start inside the original grace window',async()=>{
 const f=await fixture();try{await blank(f)
 const at='2026-09-29T15:00:00+08:00';const a=await alarm(f,at)
 await f.db.exec(`update test_clock set value='${at}';insert into messages(user_id,role,created_at) values('${owner}','user','2026-09-29T14:59:00+08:00')`)
 await f.tick();const replay=await alarm(f,at);assert.equal(replay.alarm.id,a.alarm.id);assert.equal(replay.alarm.delayed,true);assert.equal(Date.parse(replay.next_wake_at),Date.parse('2026-09-29T15:30:00+08:00'))
 const b=await alarm(f,'2026-09-29T23:59:59+08:00','照看',null,'身体不适')
 await f.db.exec("update test_clock set value='2026-09-30T00:00:01+08:00'");await f.tick();const [w]=await f.query('select * from cli_wake_schedule where id=$1',[b.alarm.id]);assert.equal(w.status,'queued')
 const started=await f.rpc('cli_wake_dispatch',[owner,JSON.stringify(roles),false,w.id,w.command_id,task]);assert.equal(started.status,'running');assert.equal(started.local_date,'2026-09-30')
 }finally{await f.db.close()}
})
test('daily close cancels queued reservations without touching the other role or next day and cannot reopen',async()=>{
 const f=await fixture();try{await blank(f)
 const first=await alarm(f,'2026-09-29T15:00:00+08:00');await alarm(f,'2026-09-29T17:00:00+08:00','交给你',claude)
 const tomorrow=await alarm(f,'2026-09-30T00:10:00+08:00','照看',null,'身体不适')
 await f.db.exec("update test_clock set value='2026-09-29T15:00:00+08:00'");await f.tick()
 const [w]=await f.query('select * from cli_wake_schedule where id=$1',[first.alarm.id]);assert.equal(w.status,'queued')
 assert.equal((await f.rpc('cli_set_self_alarm',[owner,task,null,'今天到此'])).day_closed,true)
 assert.equal((await f.query('select status from syzygy_commands where id=$1',[w.command_id]))[0].status,'failed')
 assert.equal((await alarm(f,'2026-09-29T20:00:00+08:00')).reason,'day_closed')
 assert.equal((await f.query('select status from cli_wake_schedule where id=$1',[tomorrow.alarm.id]))[0].status,'planned')
 assert.equal((await f.query("select count(*)::int n from cli_wake_schedule where role=$1 and kind='alarm' and status='planned'",[claude]))[0].n,1)
 }finally{await f.db.close()}
})

test('each role has one stable slot in each band; guards and closed slots survive repeated planning',async()=>{
 const f=await fixture();try{
 await f.db.exec("update test_clock set value='2026-09-29T00:00:00+08:00'")
 await f.plan();const rows=await f.query("select *,to_char(wake_at at time zone 'Asia/Shanghai','HH24:MI') hm from cli_wake_schedule order by role,random_slot")
 assert.equal(rows.length,4)
 for(const role of [codex,claude])assert.deepEqual(rows.filter(w=>w.role===role).map(w=>w.random_slot),[1,2])
 for(const w of rows){assert.equal(w.status,'planned');assert.ok(w.random_slot===1?w.hm>='11:00'&&w.hm<='16:00':w.hm>='17:00'&&w.hm<='21:00')}
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)assert.ok(Math.abs(Date.parse(rows[i].wake_at)-Date.parse(rows[j].wake_at))>=(rows[i].role===rows[j].role?3600000:1800000))
 await f.db.exec("update cli_wake_schedule set status='skipped'")
 for(const at of ['11:00','16:00','17:00','21:00'])assert.equal(await f.rpc('cli_wake_slot_available',[owner,codex,`2026-09-29T${at}:00+08:00`,'random']),true)
 for(const at of ['10:59','16:01','16:59','21:01'])assert.equal(await f.rpc('cli_wake_slot_available',[owner,codex,`2026-09-29T${at}:00+08:00`,'random']),false)
 await f.plan();assert.deepEqual((await f.query('select id from cli_wake_schedule order by role,random_slot')).map(w=>w.id),rows.map(w=>w.id))
 await assert.rejects(f.query("insert into cli_wake_schedule(user_id,role,local_date,kind,random_slot,wake_at) values($1,$2,'2026-09-29','random',1,'2026-09-29T12:00:00+08:00')",[owner,codex]),/unique/)
 }finally{await f.db.close()}
})
test('migration preserves legacy IDs, completed rounds and appointments; elapsed bands are not replayed',async()=>{
 const f=await fixture({legacy:true});try{
 await f.query("insert into cli_wake_schedule(user_id,role,local_date,kind,wake_at,status) values($1,$2,'2026-09-29','random','2026-09-29T13:00:00+08:00','completed'),($1,$3,'2026-09-29','random','2026-09-29T20:48:00+08:00','planned'),($1,$2,'2026-09-29','alarm','2026-09-29T18:30:00+08:00','planned')",[owner,claude,codex])
 const before=await f.query('select id,role,kind,wake_at,status from cli_wake_schedule order by id')
 await f.db.exec(readFileSync(new URL('../supabase/migrations/20261101100045_cli_autonomous_two_windows.sql',import.meta.url),'utf8').replaceAll('now()','public.test_now()'))
 await f.db.exec("update test_clock set value='2026-09-29T18:00:00+08:00'");await f.plan();await f.plan()
 assert.deepEqual(await f.query('select id,role,kind,wake_at,status from cli_wake_schedule where id=any($1::uuid[]) order by id',[before.map(w=>w.id)]),before)
 const [missed]=await f.query("select * from cli_wake_schedule where role=$1 and kind='random' and random_slot=1",[codex]);assert.equal(missed.status,'skipped');assert.equal(missed.skip_reason,'missed_window')
 assert.equal((await f.query("select count(*)::int n from cli_wake_schedule where kind='random'"))[0].n,4)
 }finally{await f.db.close()}
})
test('a fully blocked band is recorded once, and fixed-job exclusion is retained',async()=>{
 const f=await fixture();try{
 await f.db.exec("update test_clock set value='2026-09-29T00:00:00+08:00'")
 for(let hour=11;hour<=21;hour++)await f.query("insert into prompt_templates values($1,$2,true,$3)",[owner,`machine_job_block_${hour}`,JSON.stringify({targetRole:codex,hour,minute:0,daysOfWeek:null})])
 await f.plan();await f.plan();const rows=await f.query('select status,skip_reason from cli_wake_schedule where role=$1',[codex]);assert.equal(rows.length,2);assert.ok(rows.every(w=>w.status==='skipped'&&w.skip_reason==='no_available_slot'))
 }finally{await f.db.close()}
})
test('random chat postponement stays in its own band; overnight alarms postpone without a reason',async()=>{
 const f=await fixture();try{await blank(f)
 const [w]=await f.query("update cli_wake_schedule set wake_at='2026-09-29T15:45:00+08:00',status='planned' where role=$1 and random_slot=1 returning *",[codex])
 await f.db.exec(`update test_clock set value='2026-09-29T15:45:00+08:00';insert into messages(user_id,role,created_at) values('${owner}','user','2026-09-29T15:44:00+08:00')`)
 await f.tick();assert.equal((await f.query('select skip_reason from cli_wake_schedule where id=$1',[w.id]))[0].skip_reason,'delay_conflict')
 assert.equal(await f.rpc('cli_wake_slot_available',[owner,codex,'2026-09-29T17:00:00+08:00','random',w.id]),false)
 const a=await alarm(f,'2026-09-30T01:00:00+08:00');assert.equal(a.ok,true)
 await f.db.exec(`update test_clock set value='2026-09-30T01:00:00+08:00';insert into messages(user_id,role,created_at) values('${owner}','user','2026-09-30T00:59:00+08:00')`)
 await f.tick();const replay=await alarm(f,'2026-09-30T01:00:00+08:00');assert.equal(replay.alarm.id,a.alarm.id);assert.equal(replay.lounge_note_required,false);assert.equal(replay.alarm.delayed,true);assert.equal(Date.parse(replay.next_wake_at),Date.parse('2026-09-30T01:30:00+08:00'))
 }finally{await f.db.close()}
})
test('24-hour endpoint is inclusive, conflicts suggest overnight times, and pauses still skip',async()=>{
 const f=await fixture();try{await blank(f)
 await f.db.exec("update test_clock set value='2026-09-29T22:00:00+08:00'")
 assert.equal((await alarm(f,'2026-09-30T22:00:00+08:00')).ok,true)
 assert.equal((await alarm(f,'2026-09-30T22:00:01+08:00')).reason,'outside_24_hour_horizon')
 const a=await alarm(f,'2026-09-29T23:00:00+08:00');assert.equal(a.ok,true)
 const clash=await alarm(f,'2026-09-29T23:20:00+08:00');assert.equal(clash.reason,'time_conflict');assert.ok(clash.available_times.length>0);assert.ok(clash.available_times.some(at=>new Date(Date.parse(at)+8*3600000).getUTCHours()<11))
 await f.db.exec("update test_clock set value='2026-09-29T23:00:00+08:00'");await f.tick(roles,true);assert.equal((await f.query('select skip_reason from cli_wake_schedule where id=$1',[a.alarm.id]))[0].skip_reason,'paused')
 }finally{await f.db.close()}
})
