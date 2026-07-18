-- V4.0 Phase 3：Expo App 以 authenticated owner 身份直写 device_status。
-- 背景：device_status 此前只有 SELECT 策略（device_status_select_authenticated），
-- 写入全部经 device-report Edge Function（快捷指令降级通道，service_role 服务端写）。
-- 本迁移只开 INSERT：事实日志不开客户端 UPDATE/DELETE；不恢复 anon INSERT。

create policy device_status_insert_own
  on public.device_status
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

comment on column public.device_status.source_app is
  'expo_app = Expo App 直写（authenticated owner INSERT，V4.0 Phase 3 起）；为空 = 快捷指令经 device-report Edge Function 服务端写入的历史与降级通道。';
