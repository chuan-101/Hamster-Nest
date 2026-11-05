-- Match the existing MCP source schema; preserve every previously accepted source.
alter table public.timeline_entries drop constraint timeline_entries_source_check;
alter table public.timeline_entries add constraint timeline_entries_source_check
check (source = any (array[
  'claude'::text, 'gpt'::text, 'gemini'::text, 'user'::text, 'frontend'::text,
  'wechat_api'::text, 'client_gpt'::text, 'client_claude'::text,
  'codex_cli'::text, 'claude_code_cli'::text, 'system'::text, 'expo_app'::text, 'api'::text
]));
