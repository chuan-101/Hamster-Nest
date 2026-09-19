import test from 'node:test';
import assert from 'node:assert/strict';
import {loungeRequestId} from '../supabase/functions/hamster-lounge-mcp/lounge_request.ts';
const input={sofa_id:'sofa',sender:'client_claude',content:'hello',mentions:['codex_cli','claude_cli']};
test('cached clients without request_id retry with a stable, scoped UUID',async()=>{
 const first=await loungeRequestId('owner',input);
 assert.match(first,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(first,await loungeRequestId('owner',{...input,mentions:[...input.mentions].reverse()}));
 for(const changed of [{...input,sofa_id:'other'},{...input,content:'new'},{...input,reply_to_id:'parent'},{...input,sender:'client_gpt'}]) assert.notEqual(first,await loungeRequestId('owner',changed));
 assert.notEqual(first,await loungeRequestId('other',input));
});
test('explicit stable labels preserve request identity for conflict checks; new UUID allows intentional repeat',async()=>{
 const label=await loungeRequestId('owner',{...input,request_id:'message-1'});
 assert.equal(label,await loungeRequestId('owner',{...input,content:'changed',request_id:'message-1'}));
 const id='12345678-1234-4123-8123-123456789abc';
 assert.equal(await loungeRequestId('owner',{...input,request_id:id}),id);
 assert.notEqual(await loungeRequestId('owner',input),id);
});
