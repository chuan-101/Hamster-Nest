-- Add an "in_progress" status for TODO items so the TODO 仪表盘 can split
-- near-term todos into 未完成 (pending) and 进行中 (in_progress).
--
-- 背景：todos.status 之前的 CHECK 只允许 pending / completed，待办仪表盘需要一个
-- “进行中” 中间态。这里放宽约束，保留旧值兼容历史数据，并新增 in_progress。
-- 列默认值仍为 'pending'，旧数据不受影响。

alter table public.todos
  drop constraint if exists todos_status_check;

alter table public.todos
  add constraint todos_status_check
  check (status = any (array['pending'::text, 'in_progress'::text, 'completed'::text]));
