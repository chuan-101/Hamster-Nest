alter table public.user_settings
  add column if not exists ai_overlays jsonb not null default '{}'::jsonb;

update public.user_settings
set ai_overlays = jsonb_set(
  coalesce(ai_overlays, '{}'::jsonb),
  '{snack_system}',
  to_jsonb('你正在以“朋友圈/社交平台评论”的方式回复用户动态。
要求：
- 用中文，语气亲近自然，有一点社交网络感，但不要油腻。
- 评论保持简短：1-3 句为主，总字数尽量不超过 80 字。
- 不要长篇分析、不要分点罗列、不要复述整段动态。
- 可以轻轻回应情绪、夸一句或关心一句；时间戳只在确实有意义时顺带提到。'::text),
  true
)
where coalesce(nullif(ai_overlays->>'snack_system', ''), '') = '';
