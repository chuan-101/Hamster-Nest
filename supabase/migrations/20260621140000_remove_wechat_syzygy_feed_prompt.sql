-- Remove the WeChat-side "Syzygy 小窝 Feed（按需查看）" prompt template.
--
-- 背景：测试确认当前微信 bot 提供方不支持 MCP / function calling，微信侧无法直接
-- 调用 Hamster-mcp 读取 Syzygy Feed。因此撤回上一阶段在 prompt_templates 里播种的
-- wechat_syzygy_feed 模板（见 20260621120000_seed_wechat_syzygy_feed_prompt.sql）。
-- 后续微信侧改为在本地脚本的上下文构建逻辑里直接注入晨间分享文本，不接 MCP。
--
-- 幂等：模板不存在时为 no-op；prompt_templates 表不存在时直接跳过。

do $$
begin
  if to_regclass('public.prompt_templates') is null then
    raise notice 'prompt_templates table not found; skipping wechat_syzygy_feed removal';
    return;
  end if;

  delete from public.prompt_templates
  where user_id = '94dd24be-e136-45bb-836b-6820c09c4292'
    and name = 'wechat_syzygy_feed';
end $$;
