import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loungeRequestId} from '../supabase/functions/hamster-lounge-mcp/lounge_request.ts';
import * as targets from '../supabase/functions/hamster-lounge-mcp/lounge_target.ts';
import * as diary from '../supabase/functions/hamster-lounge-mcp/diary_contract.ts';

// Execute the actual registered handlers with database and transport boundaries replaced.
const source=readFileSync(new URL('../supabase/functions/hamster-lounge-mcp/index.ts',import.meta.url),'utf8');
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
function harness() {
  const tools=new Map(), calls=[];
  const sofas=[
    {id:'historic',name:'existing sofa',session_id:'legacy-session',kind:'custom',created_at:'2026-08-01T00:00:00Z',updated_at:'2026-09-27T00:00:00Z'},
    {id:'new',name:'new',session_id:'new-session',kind:'daily',created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-26T00:00:00Z'},
  ];
  const client={
    from(table) {
      const filters=[];
      const result=()=>({data:table==='lounge_members'?{sender:'claude_cli'}:
        table==='lounge_sofas'?sofas.filter(r=>filters.every(([k,v])=>k==='user_id'||r[k]===v)):[],error:null});
      const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},in(){return q;},
        single(){const r=result();return Promise.resolve({...r,data:r.data[0]??null});},
        maybeSingle(){return Promise.resolve(result());},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};
      return q;
    },
    async rpc(name,args){calls.push({name,args});return {data:{was_duplicate:false},error:null};},
  };
  const chain=new Proxy(function(){},{get:()=>chain,apply:()=>chain});
  const modules={
    'npm:zod@^4.1.13':{z:chain},'./lounge_request.ts':{loungeRequestId},'./lounge_target.ts':targets,'./diary_contract.ts':diary,
    '../_shared/mcp_common.ts':{USER_ID:'owner',supabase:client,clampLimit:x=>x,jsonResult:x=>x,errorResult:e=>({error:e?.message}),serveMcp(_name,register){register({registerTool(name,_schema,handler){tools.set(name,handler);}});}},
  };
  runInNewContext(compiled,{exports:{},require(name){if(!(name in modules))throw new Error(name);return modules[name];}});
  return {tools,calls,sofas};
}

test('existing list remains a short complete sofa inventory without requiring rule bindings',async()=>{
  const h=harness(),rows=await h.tools.get('lounge_list_sofas')({});
  assert.deepEqual(rows,h.sofas);
  assert.equal(rows[0].id,'historic');
  assert.ok(rows.every(row=>!('rules' in row)));
});

test('explicit lounge_post preserves the established target even without a recognized rules binding',async()=>{
  const h=harness(),request_id='12345678-1234-4123-8123-123456789abc';
  const result=await h.tools.get('lounge_post')({sofa_id:'historic',sender:'claude_cli',content:'test',request_id});
  assert.equal(result.request_id,request_id);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].name,'lounge_dispatch_prepare');assert.equal(h.calls[0].args.p_session_id,'legacy-session');
  assert.equal(h.calls[0].args.p_user_id,'owner');
  await h.tools.get('lounge_post')({sofa_id:'missing',sender:'claude_cli',content:'test',request_id});
  assert.equal(h.calls.length,1);
});
