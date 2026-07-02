-- 1. 移除误解service_role机制的全放行INSERT策略
-- （service_role天然绕过RLS无需策略，这两条实际效果是向anon敞开写入）
DROP POLICY "Allow service insert" ON public.wallet_transactions;
DROP POLICY "Allow service insert" ON public.quests;

-- 2. 收回匿名侧对四个SECURITY DEFINER函数的执行权
-- 线上核实：三个snack函数上anon并无直接授权，其执行权来自PUBLIC默认授权（=X/postgres），
-- 只REVOKE anon是空操作，必须连PUBLIC一起收回。
-- （authenticated在四个函数上均有显式授权，不受影响；前端登录态可能在用软删除）
REVOKE EXECUTE ON FUNCTION public.soft_delete_snack_post(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_snack_post(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_snack_reply(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_session_updated_at_from_messages() FROM PUBLIC, anon;
