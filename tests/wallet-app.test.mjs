import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const sql = readFileSync(new URL('../supabase/migrations/20261009133349_wallet_app_transactions.sql', import.meta.url),'utf8')
async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table quests(id uuid primary key default gen_random_uuid(),user_id uuid not null,created_by text not null check(created_by in ('chuanchuan','syzygy')),title text not null,description text,reward_points integer not null default 0 check(reward_points>=0),status text not null default 'open' check(status in ('open','completed','cancelled')),completed_at timestamptz,created_at timestamptz not null default now(),completed_note text);
    create table wallet_transactions(id uuid primary key default gen_random_uuid(),user_id uuid not null,type text not null check(type in ('earn','exchange','spend')),points_delta integer not null default 0,coins_delta numeric not null default 0,description text not null,quest_id uuid references quests(id),created_at timestamptz not null default now());
    alter table quests enable row level security; alter table wallet_transactions enable row level security;
    create policy "Allow all for owner" on quests for all to authenticated using(true) with check(true);
    create policy "Allow all for owner" on wallet_transactions for all to authenticated using(true) with check(true);
    grant all on quests,wallet_transactions to authenticated,service_role;
  `)
  await db.exec(sql)
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`)
  const rpc = async (name, args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result
  const mutate = (payload,id=randomUUID()) => rpc('wallet_app_mutate',[id,JSON.stringify(payload)])
  const create = (reward=250) => mutate({action:'create',id:randomUUID(),created_by:'chuanchuan',title:'测试心愿',description:'描述',reward_points:reward})
  return {db,rpc,mutate,create}
}

test('wallet CRUD, stale edits, confirmed open-only deletion, immutable creator', async()=> {
  const f=await fixture()
  try {
    const q=(await f.create()).quests[0]
    const edit={action:'edit',id:q.id,expected:q,title:'更新',description:'新描述',reward_points:400,created_by:'syzygy'}
    const changed=(await f.mutate(edit)).quests[0]
    assert.equal(changed.title,'更新'); assert.equal(changed.created_by,'chuanchuan')
    await assert.rejects(f.mutate({...edit,title:'过期编辑'}),/其他地方更新/)
    assert.equal((await f.mutate({action:'delete',id:q.id,expected:changed})).quests.length,0)
    assert.equal((await f.rpc('wallet_app_read')).points,0)
    await assert.rejects(f.create(-1),/非负整数/)
  } finally {await f.db.close()}
})

test('completion is atomic and replayable; completed quests and ledger remain',async()=>{
  const f=await fixture()
  try {
    const q=(await f.create()).quests[0], id=randomUUID()
    const payload={action:'complete',id:q.id,expected:q,note:'做好啦'}
    const done=await f.mutate(payload,id)
    assert.equal(done.points,250);assert.equal(done.transactions.length,1)
    assert.equal(done.quests[0].completed_note,'做好啦')
    assert.deepEqual(await f.mutate(payload,id),done)
    await assert.rejects(f.mutate({...payload,note:'changed'},id),/不能改变内容/)
    await assert.rejects(f.mutate(payload),/其他地方更新/)
    await assert.rejects(f.mutate({action:'delete',id:q.id,expected:done.quests[0]}),/只有未完成/)
    assert.equal((await f.rpc('complete_quest',[q.id,null,owner])).success,false)
    assert.equal((await f.rpc('wallet_app_read')).points,250)
    const zero=(await f.create(0)).quests.find(x=>x.status==='open')
    assert.equal((await f.mutate({action:'complete',id:zero.id,expected:zero})).transactions.length,1)
  } finally {await f.db.close()}
})

test('150 points converts to 1.50 coins; retry and overspend cannot double-charge',async()=>{
  const f=await fixture()
  try {
    const q=(await f.create()).quests[0]
    await f.mutate({action:'complete',id:q.id,expected:q})
    const id=randomUUID(), payload={action:'exchange',points:150}
    const exchanged=await f.mutate(payload,id)
    assert.equal(exchanged.points,100);assert.equal(exchanged.coins,1.5)
    assert.deepEqual(await f.mutate(payload,id),exchanged)
    await assert.rejects(f.mutate({action:'exchange',points:101}),/积分不足/)
    await assert.rejects(f.mutate({action:'exchange',points:99}),/最少/)
    await assert.rejects(f.mutate({action:'exchange',points:100.5}),/整数/)
    for(const value of [-1,0,0.001,'NaN','Infinity']) assert.equal((await f.rpc('spend_coins',[value,'支出',owner])).success,false)
    assert.equal((await f.rpc('spend_coins',[1.51,'支出',owner])).success,false)
    assert.equal((await f.rpc('spend_coins',[1.5,'支出',owner])).success,true)
    assert.equal((await f.rpc('wallet_app_read')).coins,0)
  } finally {await f.db.close()}
})

test('RLS, forged owner, receipt and anonymous boundaries',async()=>{
  const f=await fixture()
  try {
    const q=(await f.create()).quests[0]
    await f.db.exec(`set request.jwt.claim.sub='${other}'`)
    assert.equal((await f.rpc('wallet_app_read')).quests.length,0)
    await assert.rejects(f.rpc('complete_quest',[q.id,null,owner]),/无权/)
    await assert.rejects(f.mutate({action:'delete',id:q.id,expected:q}),/已删除/)
    assert.equal((await f.db.query('select * from wallet_private.requests')).rows.length,0)
    await assert.rejects(f.db.query('insert into quests(user_id,created_by,title) values($1,$2,$3)',[owner,'chuanchuan','forged']),/row-level security/)
    await f.db.exec('set role anon')
    await assert.rejects(f.rpc('wallet_app_read'),/permission denied/)
  } finally {await f.db.close()}
})

test('full snapshot retains histories beyond PostgREST row cap',async()=>{
  const f=await fixture()
  try {
    await f.db.exec(`insert into wallet_transactions(user_id,type,points_delta,description) select '${owner}','earn',1,'fixture' from generate_series(1,1005)`)
    const snapshot=await f.rpc('wallet_app_read')
    assert.equal(snapshot.transactions.length,1005);assert.equal(snapshot.points,1005)
  } finally {await f.db.close()}
})
