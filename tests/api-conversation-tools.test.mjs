import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiModelStream } from '../supabase/functions/conversation-dispatch/api-model-stream.ts'
import { API_TOOL_CATALOG, normalizeToolSelection, toolResult, summarizeApiUsage } from '../supabase/functions/conversation-dispatch/api-tool-contract.ts'
import { executeApiTool } from '../supabase/functions/conversation-dispatch/api-tool-runtime.ts'
import { startApiConversation } from '../supabase/functions/conversation-dispatch/api-conversation-runner.ts'

function memoryClient(selected = []) {
  const tables = { api_conversation_tools: [{user_id:'u',session_id:'s',enabled_tools:selected}], api_tool_executions:[],api_model_calls:[],llm_usage:[] }
  return { tables, from(table) {
    const conditions=[]; let action='select',value, single=false
    const q={ select(){return q},eq(k,v){conditions.push([k,v]);return q},maybeSingle(){single=true;return q},
      insert(v){action='insert';value=v;return q},update(v){action='update';value=v;return q},
      then(resolve,reject){return Promise.resolve().then(()=>{
        const rows=tables[table]??=[]
        const matched=rows.filter(row=>conditions.every(([k,v])=>row[k]===v))
        if(action==='insert') {
          if(table==='api_tool_executions' && rows.some(row=>row.reply_id===value.reply_id && row.fingerprint===value.fingerprint))return {data:null,error:{code:'23505'}}
          rows.push({...value}); return {data:null,error:null}
        }
        if(action==='update')matched.forEach(row=>Object.assign(row,value))
        return {data:single?(matched[0]??null):matched.map(row=>({...row})),error:null}
      }).then(resolve,reject)} }
    return q
  } }
}
const usage={prompt_tokens:100,completion_tokens:20,cost:0.002,prompt_tokens_details:{cached_tokens:60,cache_write_tokens:10}}
function streamResponse(calls=[], content='') {
  const chunks=[{model:'anthropic/claude-opus-5.5',choices:[{delta:{content, ...(calls.length?{tool_calls:calls}: {})},finish_reason:null}]},
    {choices:[{delta:{},finish_reason:calls.length?'tool_calls':'stop'}],usage}]
  return new Response(chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n', {headers:{'Content-Type':'text/event-stream'}})
}
const toolCall=(name,args)=>({index:0,id:'tool-1',type:'function',function:{name,arguments:JSON.stringify(args)}})
const baseOptions=client=>({client,userId:'u',sessionId:'s',replyId:'r',attempt:1,url:'https://test.invalid',headers:{},selected:['timeline__add_timeline'],name:'timeline__add_timeline',argumentsText:JSON.stringify({event_date:'2026-11-05',summary:'test'}),model:'anthropic/claude-opus-5.5',signal:AbortSignal.timeout(5000),progress:async()=>{}})

test('permissions reject unknown tools; stable catalog includes both reading and timeline',()=>{
  assert.throws(()=>normalizeToolSelection(['bash']))
  assert.throws(()=>normalizeToolSelection('all'))
  assert.deepEqual(normalizeToolSelection(['timeline__add_timeline','timeline__add_timeline']),['timeline__add_timeline'])
  assert.ok(API_TOOL_CATALOG.some(t=>t.name==='book_excerpts'))
})
test('MCP text errors and unknown costs are not successes or zero-dollar calls',()=>{
  assert.equal(toolResult({content:[{text:'Error: not found'}]}).ok,false)
  assert.equal(toolResult({isError:true,content:[{text:'failed'}]}).ok,false)
  assert.deepEqual(summarizeApiUsage([{usage,status:'completed'},{usage:null,status:'failed'}]),{
    calls:2,cost_usd:0.002,unknown_calls:1,prompt_tokens:100,completion_tokens:20,cached_tokens:60,cache_write_tokens:10,
  })
})
test('fragmented SSE preserves call arguments, reasoning signatures, usage and end marker',()=>{
  const p=new ApiModelStream()
  const data=[{choices:[{delta:{tool_calls:[{index:0,id:'c',function:{name:'timeline__add_timeline',arguments:'{"summary":'}}],reasoning_details:[{index:0,type:'reasoning.text',text:'a'}]}}]},
    {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"x"}'}}],reasoning_details:[{index:0,type:'reasoning.text',text:'b',signature:'sig'}]},finish_reason:'tool_calls'}],usage}]
    .map(x=>'data: '+JSON.stringify(x)+'\r\n\r\n').join('')+'data: [DONE]\n'
  for(let i=0;i<data.length;i+=7)p.push(data.slice(i,i+7))
  p.finish()
  assert.equal(p.calls[0].function.arguments,'{"summary":"x"}')
  assert.equal(p.assistantMessage().reasoning_details[0].text,'ab')
  assert.equal(p.details[0].signature,'sig');assert.equal(p.done,true);assert.equal(p.usage.cost,0.002)
})
test('disabled tool is rejected before network, including permission revoked since planning',async()=>{
  const client=memoryClient([])
  const result=await executeApiTool(baseOptions(client))
  assert.equal(result.ok,false);assert.equal(client.tables.api_tool_executions.length,0)
})
test('successful write is executed once across retries; unknown writes are never replayed',async t=>{
  const client=memoryClient(['timeline__add_timeline']);let calls=0
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    calls++;const request=JSON.parse(init.body)
    assert.equal(request.params.arguments.source,'api');assert.equal(request.params.arguments.recorder,'syzygy')
    return new Response(JSON.stringify({id:request.id,result:{content:[{text:'saved id=1'}]}}),{headers:{'content-type':'application/json'}})
  })
  assert.equal((await executeApiTool(baseOptions(client))).ok,true)
  assert.equal((await executeApiTool({...baseOptions(client),attempt:2})).ok,true)
  assert.equal(calls,1)
  const blocked=await executeApiTool({...baseOptions(client),attempt:2,argumentsText:'{"summary":"different"}'})
  assert.equal(blocked.ok,false);assert.equal(calls,1)
  const uncertain=memoryClient(['timeline__add_timeline'])
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('network')})
  assert.equal((await executeApiTool(baseOptions(uncertain))).ok,false)
  assert.equal(uncertain.tables.api_tool_executions[0].status,'unknown')
  await executeApiTool({...baseOptions(uncertain),attempt:2})
  assert.equal(calls,2)
})
test('server runs model/tool/model, accounts every round, and finishes even if client disconnects',async t=>{
  const client=memoryClient(['timeline__recent_timeline']);let rounds=0, reads=0;const states=[]
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const body=JSON.parse(init.body)
    if(String(url).includes('openrouter-chat')) {
      rounds++
      if(rounds===1)return streamResponse([toolCall('timeline__recent_timeline',{limit:1})])
      assert.equal(body.messages.at(-1).role,'tool')
      assert.equal(body.conversationId,undefined)
      return streamResponse([],'读取完成')
    }
    let result
    if(body.method==='initialize')result={instructions:'timeline instructions'}
    if(body.method==='tools/list')result={tools:[{name:'recent_timeline',inputSchema:{type:'object'},description:'read'}]}
    if(body.method==='tools/call'){reads++;result={content:[{text:'[{"id":"1"}]'}]}}
    return new Response(JSON.stringify({id:body.id,result}),{headers:{'content-type':'application/json'}})
  })
  const run=startApiConversation({client,userId:'u',sessionId:'s',replyId:'r',attempt:1,url:'https://test.invalid',modelUrl:new URL('https://test.invalid/openrouter-chat'),headers:{},request:{model:'anthropic/claude-opus-5.5',messages:[{role:'user',content:'read'}]},persist:async(content,state,meta)=>states.push({content,state,meta:structuredClone(meta)}),completed:async()=>{}})
  await run.readable.cancel(); await run.work
  assert.equal(reads,1);assert.equal(rounds,2)
  assert.equal(states.at(-1).state,'completed')
  assert.equal(states.at(-1).meta.api_usage.cost_usd,0.004)
  assert.equal(client.tables.llm_usage.length,2)
  assert.equal(states.at(-1).meta.api_tools[0].status,'completed')
})
test('truncated model output does not execute a tool and records unknown billable usage',async t=>{
  const client=memoryClient([]),states=[]
  t.mock.method(globalThis,'fetch',async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'partial'}}]})+'\n\n',{headers:{'content-type':'text/event-stream'}}))
  const run=startApiConversation({client,userId:'u',sessionId:'s',replyId:'r',attempt:1,url:'https://test.invalid',modelUrl:new URL('https://test.invalid/openrouter-chat'),headers:{},request:{model:'test',messages:[]},persist:async(content,state,meta)=>states.push({content,state,meta}),completed:async()=>assert.fail('must not complete')})
  await run.readable.cancel();await run.work
  assert.equal(states.at(-1).state,'failed');assert.equal(states.at(-1).meta.api_usage.unknown_calls,1)
})
test('AAB does not borrow GPT identity for an unrelated model', async()=>{
  const client=memoryClient(['reading__add_book_answer'])
  const result=await executeApiTool({...baseOptions(client),selected:['reading__add_book_answer'],name:'reading__add_book_answer',model:'google/gemini-test',argumentsText:'{"question_id":"q","content":"answer"}'})
  assert.equal(result.ok,false);assert.equal(client.tables.api_tool_executions.length,0)
})
