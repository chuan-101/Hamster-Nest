import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../supabase/functions/hamster-lounge-mcp/index.ts',import.meta.url),'utf8');
test('lounge expansion retains the existing council and diary tool catalogue',()=>{
 const names=[...source.matchAll(/registerTool\('([^']+)'/g)].map(m=>m[1]).sort();
 assert.deepEqual(names,['lounge_list_members','council_list_categories','lounge_list_sofas','lounge_read','lounge_post','council_post','council_propose','council_review','council_decide','council_read','council_report','add_diary_entry','read_diary','share_diary_entry','set_diary_lock','add_diary_comment'].sort());
});
