-- ============================================================
-- 议事厅调度台升级：executor 指派 / category 主题 / report 执行回执
-- 方案：hamster-nest-app docs/plans/2026-07-15-council-scheduler-upgrade.md
--（2026-07-16 敲定版：failed 独立状态；写回标准下沉为 council_submit_report RPC，
--  MCP 工具与 Web 回执表单共用同一实现）
-- ============================================================

-- 1. 新列：主题分类 + 执行方指派
alter table public.agent_council add column if not exists category text;
alter table public.agent_council add column if not exists executor text;

comment on column public.agent_council.category is
  '提案主题分类。值域由 MCP 工具层校验（app/memory/infra/ritual/reading/game/council/other），不加 DB CHECK——分类演进免 migration；子条目由工具层从父提案继承。';
comment on column public.agent_council.executor is
  '拍板时指派的执行方。NULL = 不唤醒任何脚本（opt-in 语义）；只有 codex_cli / claude_code_cli 会唤醒 Mac mini 接单脚本。';

-- 2. entry_type 值域 + report（执行回执，第四种发言）
alter table public.agent_council drop constraint agent_council_entry_type_check;
alter table public.agent_council add constraint agent_council_entry_type_check
  check (entry_type is null or entry_type = any (array['proposal','review','decision','report']));

-- 3. proposal_status 值域 + done / failed
--    done = 回执 succeeded/partial；failed = 回执 failed（区别于「刚拍板没人动」的 approved，
--    重派 = 串串重新 decide 回 approved，留痕在 decision 子条目）
alter table public.agent_council drop constraint agent_council_proposal_status_check;
alter table public.agent_council add constraint agent_council_proposal_status_check
  check (proposal_status is null or proposal_status = any (array['open','approved','rejected','deferred','plan_generated','done','failed']));

-- 4. executor 值域（出生即约束）
alter table public.agent_council add constraint agent_council_executor_check
  check (executor is null or executor = any (array['codex_cli','claude_code_cli','client','chuanchuan']));

-- 5. 存量提案回填兜底分类
update public.agent_council set category = 'other'
  where entry_type = 'proposal' and category is null;

-- 6. 写回标准的唯一实现：council_submit_report
--    一次调用完成三件事：插 report 子条目 / 翻主提案状态 / 写 agent_events 推横幅。
--    MCP 工具 council_report 与 Web 回执表单都只调这一个函数，各端不得自行写回。
--    字段语义见 hamster-nest-app docs/council-report-standard.md。
create or replace function public.council_submit_report(
  p_proposal_id uuid,
  p_speaker text,
  p_message text,
  p_result text,
  p_artifacts text[] default null,
  p_follow_ups text[] default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal public.agent_council%rowtype;
  v_report_id uuid;
  v_next_status text;
  v_event_id bigint;
  v_title text;
begin
  if p_result is null or p_result not in ('succeeded', 'partial', 'failed') then
    raise exception 'council_submit_report: result 必须是 succeeded / partial / failed，收到 %', coalesce(p_result, 'null');
  end if;
  if p_message is null or btrim(p_message) = '' then
    raise exception 'council_submit_report: message 不能为空（三五句人话：干了什么/怎么验证/遗留什么）';
  end if;

  select * into v_proposal
    from public.agent_council
   where id = p_proposal_id and entry_type = 'proposal'
     for update;
  if not found then
    raise exception 'council_submit_report: 主提案不存在或不是 proposal: %', p_proposal_id;
  end if;

  -- succeeded / partial → done（partial 的遗留项建议另开提案，写进 follow_ups）；
  -- failed → failed（完成是事实不是愿望；卡点写在回执里，等串串改派或重试）。
  v_next_status := case when p_result = 'failed' then 'failed' else 'done' end;

  insert into public.agent_council
    (user_id, parent_id, speaker, topic, message, entry_type, category, metadata)
  values
    (v_proposal.user_id, v_proposal.id, p_speaker, v_proposal.topic, p_message, 'report',
     v_proposal.category,
     jsonb_strip_nulls(jsonb_build_object(
       'result', p_result,
       'artifacts', case when p_artifacts is null or cardinality(p_artifacts) = 0
                         then null else to_jsonb(p_artifacts) end,
       'follow_ups', case when p_follow_ups is null or cardinality(p_follow_ups) = 0
                          then null else to_jsonb(p_follow_ups) end
     )))
  returning id into v_report_id;

  update public.agent_council
     set proposal_status = v_next_status, updated_at = now()
   where id = v_proposal.id;

  v_title := case p_result
    when 'succeeded' then '✅ 议事厅回执：' || v_proposal.topic
    when 'partial'   then '🟡 议事厅回执（部分完成）：' || v_proposal.topic
    else                  '❌ 议事厅回执（失败）：' || v_proposal.topic
  end;

  -- screen=home 已在 App 推送白名单内（push-payload.ts），entity_id 供客户端补账定位。
  insert into public.agent_events
    (user_id, actor, event_type, entity_type, entity_id, title, payload, importance)
  values
    (v_proposal.user_id, p_speaker, 'council_report', 'council_proposal', v_proposal.id,
     v_title,
     jsonb_build_object('screen', 'home', 'result', p_result, 'topic', v_proposal.topic),
     'normal')
  returning id into v_event_id;

  return jsonb_build_object(
    'proposal_id', v_proposal.id,
    'proposal_status', v_next_status,
    'report_id', v_report_id,
    'agent_event_id', v_event_id
  );
end;
$$;

comment on function public.council_submit_report(uuid, text, text, text, text[], text[]) is
  '议事厅执行回执的唯一写回入口（写回标准见 hamster-nest-app docs/council-report-standard.md）。谁执行谁执笔；回执写错不改写，再发一条修正。';

revoke all on function public.council_submit_report(uuid, text, text, text, text[], text[]) from public, anon;
grant execute on function public.council_submit_report(uuid, text, text, text, text[], text[]) to authenticated, service_role;
