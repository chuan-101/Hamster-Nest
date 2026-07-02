-- 1. 移除误解service_role机制的全放行INSERT策略
-- （service_role天然绕过RLS无需策略，这两条实际效果是向anon敞开写入）
DROP POLICY "Allow service insert" ON public.wallet_transactions;
DROP POLICY "Allow service insert" ON public.quests;

-- 2. 收回匿名角色对四个SECURITY DEFINER函数的执行权
-- （authenticated暂保留，前端登录态可能在用软删除）
REVOKE EXECUTE ON FUNCTION public.soft_delete_snack_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_snack_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_snack_reply(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.touch_session_updated_at_from_messages() FROM anon;
