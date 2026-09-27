import test from 'node:test';
import assert from 'node:assert/strict';
import { loungeTargets, resolveLoungeTarget } from '../supabase/functions/hamster-lounge-mcp/lounge_target.ts';
const sofas = [
  {id:'old',name:'第一张沙发（留存）',session_id:'s1',kind:'custom',created_at:'2026-06-01T00:00:00Z',updated_at:'2026-09-27T00:00:00Z'},
  {id:'new',name:'小仓鼠出游',session_id:'s2',kind:'custom',created_at:'2026-09-19T00:00:00Z'},
  {id:'work',name:'工作',session_id:'s3',kind:'work',created_at:'2026-09-27T00:00:00Z'},
];
const sessions = sofas.map(s => ({id:s.session_id,conversation_kind:'group',handler:'router',is_archived:false,
  routing_config:{sofa_id:s.id,rules_prompt_name:s.kind==='work'?'sofa_work_rules':'sofa_daily_rules'}}));
const rules = ['sofa_daily_rules','sofa_work_rules'].map(name=>({id:name,name,version:3,content:name+' rules'}));
test('proactive casual defaults to newest created eligible sofa with its actual rule',()=>{
  const targets=loungeTargets(sofas,sessions,rules);
  assert.equal(resolveLoungeTarget(targets,{}).id,'new');
  assert.equal(targets.filter(t=>t.is_default_casual).length,1);
  assert.equal(resolveLoungeTarget(targets,{sofaId:'work'}).rules.name,'sofa_work_rules');
  assert.equal(resolveLoungeTarget(targets,{replySessionId:'s1'}).id,'old');
  assert.throws(()=>resolveLoungeTarget(targets,{sofaId:'new',replySessionId:'s1'}),/conflicts/);
});
test('archived or invalid rule-bound sessions never become default; missing explicit target never redirects',()=>{
  const altered=sessions.map(s=>({...s,is_archived:s.id==='s2'}));
  const targets=loungeTargets(sofas,altered,rules);
  assert.equal(resolveLoungeTarget(targets,{}).id,'old');
  assert.throws(()=>resolveLoungeTarget(targets,{sofaId:'new'}));
  assert.throws(()=>resolveLoungeTarget(loungeTargets(sofas,sessions,[]),{}));
  assert.throws(()=>resolveLoungeTarget(loungeTargets(sofas,sessions,[...rules,rules[0]]),{}));
});
test('same creation timestamp has a deterministic ID tie breaker; a fixed selected ID survives new sofas',()=>{
  const newer={...sofas[1],id:'z',session_id:'sz'};
  const targets=loungeTargets([...sofas,newer],[...sessions,{...sessions[1],id:'sz',routing_config:{...sessions[1].routing_config,sofa_id:'z'}}],rules);
  assert.equal(resolveLoungeTarget(targets,{}).id,'z');
  assert.equal(resolveLoungeTarget(targets,{sofaId:'new'}).id,'new');
});
