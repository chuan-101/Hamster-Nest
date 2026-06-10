-- 仓鼠客厅：客厅场景说明（注入模型系统提示，用户可在前端编辑）
alter table public.user_settings
  add column if not exists lounge_scene_prompt text;
