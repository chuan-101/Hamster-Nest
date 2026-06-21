-- Allow more granular TIMELINE source values so the frontend (and other writers)
-- can record which end produced an entry.
--
-- 背景：timeline_entries.source 之前的 CHECK 只允许 claude / gpt / gemini / user，
-- 仓鼠窝前端手动写入需要标记 source=frontend，微信侧 / 客户端 / CLI 也希望各自标记来源。
-- 这里放宽约束，保留旧值兼容历史数据，并新增前端约定的来源取值。
-- 表的默认值保持 'claude' 不变（服务端写入方未显式带 source 时沿用旧行为）。

alter table public.timeline_entries
  drop constraint if exists timeline_entries_source_check;

alter table public.timeline_entries
  add constraint timeline_entries_source_check
  check (source = any (array[
    'claude'::text,
    'gpt'::text,
    'gemini'::text,
    'user'::text,
    'frontend'::text,
    'wechat_api'::text,
    'client_gpt'::text,
    'client_claude'::text,
    'codex_cli'::text,
    'claude_code_cli'::text,
    'system'::text
  ]));
