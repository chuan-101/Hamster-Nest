-- V4.0 Phase 4：timeline_entries.source 值域加入 'expo_app'。
-- 背景：Expo App 时间轴速记以 source='expo_app' 标记来源（与 device_status.source_app 惯例一致），
-- 原 CHECK 值域建于 App 出现之前，未含该值，App 首条速记被 23514 拒绝（2026-07-18 真机实测）。
-- Web TS 层 TimelineSource 为自由 string，实际值域以本约束为准。

alter table public.timeline_entries
  drop constraint timeline_entries_source_check;

alter table public.timeline_entries
  add constraint timeline_entries_source_check
  check (source = any (array[
    'claude'::text, 'gpt'::text, 'gemini'::text, 'user'::text, 'frontend'::text,
    'wechat_api'::text, 'client_gpt'::text, 'client_claude'::text,
    'codex_cli'::text, 'claude_code_cli'::text, 'system'::text,
    'expo_app'::text
  ]));
