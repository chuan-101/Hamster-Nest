-- Failed attempts must be visible without authorizing execution.
create or replace function public.council_worker_finish(
  p_proposal_id uuid, p_command_id uuid, p_claimed_by text, p_executor text,
  p_mode text, p_message text, p_result text default null,
  p_artifacts text[] default '{}', p_follow_ups text[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  parent public.agent_council%rowtype;
  request_row app_private.council_app_requests%rowtype;
  request_payload jsonb := jsonb_build_object('proposal',p_proposal_id,'executor',p_executor,'mode',p_mode,'message',p_message,'result',p_result,'artifacts',p_artifacts,'follow_ups',p_follow_ups);
  entry_id uuid;
  answer jsonb;
begin
  select * into parent from public.agent_council where id=p_proposal_id and entry_type='proposal' for update;
  if not found or parent.user_id is null or p_command_id is null then raise exception 'Council proposal/command missing'; end if;
  insert into app_private.council_app_requests(user_id,request_id,payload) values(parent.user_id,p_command_id,request_payload) on conflict do nothing;
  select * into request_row from app_private.council_app_requests where user_id=parent.user_id and request_id=p_command_id for update;
  if request_row.payload <> request_payload then raise exception 'Council command replay payload mismatch'; end if;
  if request_row.response is not null then return request_row.response; end if;
  if parent.executor is distinct from p_executor or parent.proposal_status <> 'approved'
    or nullif(p_claimed_by,'') is null or parent.metadata->>'claimed_by' is distinct from p_claimed_by then
    raise exception 'Council assignment or claim changed';
  end if;
  if btrim(coalesce(p_message,''))='' then raise exception 'Council body is empty'; end if;
  if p_mode not in ('write_plan_only','execute_confirmed') or p_mode is null then raise exception 'Unknown Council worker mode'; end if;
  if p_result='failed' then
    answer:=public.council_submit_report(parent.id,p_executor,p_message,'failed',p_artifacts,p_follow_ups);
    update public.agent_council set metadata=(coalesce(metadata,'{}'::jsonb)-'claimed_by'-'claimed_at'-'claim_executor') || jsonb_build_object('council_stage','failed') where id=parent.id;
  elsif p_mode='write_plan_only' then
    if parent.metadata->>'council_stage'='execution_confirmed' then raise exception 'Council execution already confirmed'; end if;
    insert into public.agent_council(user_id,parent_id,speaker,topic,message,entry_type,category,metadata)
      values(parent.user_id,parent.id,p_executor,parent.topic,p_message,'review',parent.category,
        jsonb_build_object('kind','execution_plan','command_id',p_command_id)) returning id into entry_id;
    update public.agent_council set proposal_status='plan_generated',updated_at=clock_timestamp(),
      metadata=(coalesce(metadata,'{}'::jsonb)-'claimed_by'-'claimed_at'-'claim_executor'-'confirmed_plan_id') ||
        jsonb_build_object('council_stage','awaiting_confirmation','execution_plan',jsonb_build_object('entry_id',entry_id,'command_id',p_command_id,'mode','council_inline','generated_at',clock_timestamp())) where id=parent.id;
    answer:=jsonb_build_object('proposal_id',parent.id,'entry_id',entry_id,'stage','awaiting_confirmation');
  elsif p_mode='execute_confirmed' then
    if parent.metadata->>'council_stage' is distinct from 'execution_confirmed'
      or parent.metadata->>'confirmed_plan_id' is distinct from parent.metadata->'execution_plan'->>'entry_id' then
      raise exception 'Council plan was not confirmed';
    end if;
    answer:=public.council_submit_report(parent.id,p_executor,p_message,p_result,p_artifacts,p_follow_ups);
    update public.agent_council set metadata=(coalesce(metadata,'{}'::jsonb)-'claimed_by'-'claimed_at'-'claim_executor') || jsonb_build_object('council_stage','reported') where id=parent.id;
  else raise exception 'Unknown Council worker mode'; end if;
  update app_private.council_app_requests set response=answer where user_id=parent.user_id and request_id=p_command_id;
  return answer;
end;
$$;
revoke all on function public.council_worker_finish(uuid,uuid,text,text,text,text,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.council_worker_finish(uuid,uuid,text,text,text,text,text,text[],text[]) to service_role;
