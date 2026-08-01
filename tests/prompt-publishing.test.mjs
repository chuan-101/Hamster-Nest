import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  composeConversationSystemPrompt,
  resolveConversationProfileKey,
} = await import(
  '../supabase/functions/conversation-dispatch/prompt.ts'
)

const migrationUrl = new URL(
  '../supabase/migrations/20260730133228_v4_1_prompt_publishing.sql',
  import.meta.url,
)
const rollbackUrl = new URL(
  '../supabase/rollback-contracts/20260730133228_v4_1_prompt_publishing.sql',
  import.meta.url,
)
const consoleUrl = new URL(
  '../src/pages/HamsterConsolePage.tsx',
  import.meta.url,
)
const dispatchUrl = new URL(
  '../supabase/functions/conversation-dispatch/index.ts',
  import.meta.url,
)

test('legacy direct API sessions resolve to the intended chat profiles', () => {
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: null,
      sessionKey: 'syzygy_instant',
    }),
    'app_companion',
  )
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: null,
      sessionKey: null,
    }),
    'app_chat',
  )
  assert.equal(
    resolveConversationProfileKey({
      conversationProfileKey: ' app_companion ',
      sessionKey: null,
    }),
    'app_companion',
  )
})

test('active Prompt layers replace the legacy system Prompt in declared order', () => {
  const result = composeConversationSystemPrompt({
    names: {
      identityPromptName: 'syzygy_base',
      stylePromptName: 'app_companion_reply_style',
      rulesPromptName: null,
    },
    activePrompts: [
      { name: 'app_companion_reply_style', content: '温柔直接', version: 1 },
      { name: 'syzygy_base', content: '你是 Syzygy', version: 3 },
    ],
    legacySystemPrompt: 'legacy',
  })

  assert.equal(result, '你是 Syzygy\n\n温柔直接')
})

test('missing active Prompt layers fail safely to the legacy system Prompt', () => {
  const result = composeConversationSystemPrompt({
    names: {
      identityPromptName: 'syzygy_base',
      stylePromptName: 'app_chat_reply_style',
      rulesPromptName: null,
    },
    activePrompts: [
      { name: 'syzygy_base', content: 'active base', version: 1 },
    ],
    legacySystemPrompt: ' legacy fallback ',
  })

  assert.equal(result, 'legacy fallback')
})

test('Prompt migration enforces one active immutable version and least privilege', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /prompt_templates_user_name_active_unique/iu)
  assert.match(sql, /where active/iu)
  assert.match(
    sql,
    /prompt_templates_immutable_version[\s\S]*?before update or delete/iu,
  )
  assert.match(sql, /rows are append-only and cannot be deleted/iu)
  assert.match(sql, /Inactive Prompt versions cannot be reactivated/iu)
  assert.match(
    sql,
    /revoke all on public\.prompt_templates from anon, authenticated/iu,
  )
  assert.match(
    sql,
    /grant select on public\.prompt_templates to authenticated/iu,
  )
  assert.match(sql, /Authenticated Prompt writes must use the publish RPC/iu)
})

test('Prompt publish RPC is owner-bound, serialized, and version-checked', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const publicStart = sql.indexOf(
    'create or replace function public.prompt_template_publish(',
  )
  const publicEnd = sql.indexOf('$function$;', publicStart)
  const publicFunction = sql.slice(
    publicStart,
    publicEnd + '$function$;'.length,
  )
  const privateStart = sql.indexOf(
    'create or replace function private.prompt_template_publish_core(',
  )
  const privateEnd = sql.indexOf('$function$;', privateStart)
  const privateFunction = sql.slice(
    privateStart,
    privateEnd + '$function$;'.length,
  )

  assert.notEqual(publicStart, -1)
  assert.notEqual(privateStart, -1)
  assert.match(publicFunction, /security invoker[\s\S]*?set search_path = ''/iu)
  assert.match(privateFunction, /security definer[\s\S]*?set search_path = ''/iu)
  assert.match(privateFunction, /v_owner_id uuid := \(select auth\.uid\(\)\)/iu)
  assert.match(privateFunction, /pg_advisory_xact_lock/iu)
  assert.match(privateFunction, /p_expected_active_version is null/iu)
  assert.match(privateFunction, /Prompt active version changed/iu)
  assert.match(
    sql,
    /revoke all on function public\.prompt_template_publish[\s\S]*?from public, anon, service_role/iu,
  )
  assert.match(
    sql,
    /grant execute on function public\.prompt_template_publish[\s\S]*?to authenticated/iu,
  )
})

test('chat Prompt seeds copy server-side legacy sources without embedding bodies', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const name of [
    'app_companion_reply_style',
    'app_chat_reply_style',
    'codex_cli_reply_style',
    'claude_cli_reply_style',
    'sofa_daily_rules',
    'sofa_work_rules',
  ]) {
    assert.match(sql, new RegExp(`'${name}'`, 'u'))
  }

  assert.match(sql, /v_wechat_reply_style/iu)
  assert.match(sql, /v_cli_reply_style/iu)
  assert.match(sql, /select lounge_scene_prompt[\s\S]*?from public\.user_settings/iu)
  assert.match(
    sql,
    /Every active generation port must resolve to active Prompt versions/iu,
  )
})

test('Prompt contract rollback is guarded and excluded from forward migrations', async () => {
  const sql = await readFile(rollbackUrl, 'utf8')

  assert.match(
    rollbackUrl.pathname,
    /\/supabase\/rollback-contracts\/20260730133228_v4_1_prompt_publishing\.sql$/u,
  )
  assert.doesNotMatch(rollbackUrl.pathname, /\/supabase\/migrations\//u)
  assert.match(sql, /requires exactly six untouched seed rows/iu)
  assert.match(sql, /refuses to delete a seed that has entered version history/iu)
  assert.match(sql, /drop function public\.prompt_template_publish/iu)
  assert.match(sql, /drop trigger prompt_templates_immutable_version/iu)
  assert.match(sql, /grant all privileges on public\.prompt_templates/iu)
  assert.match(sql, /Legacy Prompt updated_at trigger was not preserved/iu)
})

test('Web editor publishes a new version instead of updating Prompt content', async () => {
  const source = await readFile(consoleUrl, 'utf8')
  const saveStart = source.indexOf('const handleSaveTemplate = async')
  const saveEnd = source.indexOf('\n  const toggleSection', saveStart)
  const saveHandler = source.slice(saveStart, saveEnd)

  assert.match(saveHandler, /\.rpc\('prompt_template_publish'/u)
  assert.match(saveHandler, /p_expected_active_version: activeTemplate\.version/u)
  assert.doesNotMatch(saveHandler, /\.from\('prompt_templates'\)[\s\S]*?\.update\(/u)
  assert.match(source, /发布新版本/u)
  assert.match(source, /旧版本保留用于审计与回滚/u)
})

test('Web editor locks Prompt selection and drafting while a publish is pending', async () => {
  const source = await readFile(consoleUrl, 'utf8')
  const editorStart = source.indexOf('aria-label="Prompt 编辑器"')
  const editorEnd = source.indexOf('\n          <section', editorStart)
  const editor = source.slice(editorStart, editorEnd)

  assert.notEqual(editorStart, -1)
  assert.match(
    editor,
    /onClick=\{\(\) => handleSelectTemplate\(template\.id\)\}[\s\S]*?disabled=\{savingTemplateId !== null\}/u,
  )
  assert.match(
    editor,
    /className="textarea-glass hamster-console-template-editor"[\s\S]*?disabled=\{savingTemplateId !== null\}/u,
  )
})

test('API dispatch prefers active profile Prompt layers with legacy fallback', async () => {
  const source = await readFile(dispatchUrl, 'utf8')

  assert.match(source, /\.from\('conversation_profiles'\)/u)
  assert.match(source, /\.from\('generation_ports'\)/u)
  assert.match(source, /\.from\('prompt_templates'\)/u)
  assert.match(source, /composeConversationSystemPrompt/u)
  assert.match(source, /settings\.system_prompt/u)
})
