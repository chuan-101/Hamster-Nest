-- ============================================================
-- V4.0 Phase 2 · advisors 复核修正（2026-07-12）
-- 1) pg_net 迁出 public schema（20260712073230 裸 create extension 落到了 public；
--    对齐 Dashboard 惯例放 extensions。objects 本就在 net schema，
--    net.http_post 引用不受影响，drop/recreate 无静态依赖）。
-- 2) notify_push_dispatch 收紧 EXECUTE：Supabase 默认权限会给 anon/authenticated
--    直接授函数 EXECUTE（不经 PUBLIC），触发器函数虽不可被 RPC 实际调用，
--    暴露面纪律上仍显式撤销（同批修正 respond_to_approval 的 anon 撤销已在
--    20260712075132 内完成）。
-- ============================================================

drop extension pg_net;
create extension pg_net with schema extensions;

revoke execute on function public.notify_push_dispatch() from public, anon, authenticated;
