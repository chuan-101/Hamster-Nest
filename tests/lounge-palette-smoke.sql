-- Run in BEGIN / ROLLBACK.
select set_config('request.jwt.claim.sub',(select user_id::text from public.lounge_sofas where kind='daily' limit 1),true);
set local role authenticated;
do $$ declare sid uuid:=gen_random_uuid(); result jsonb; denied boolean:=false; begin
 perform public.lounge_manage('create',sid,'palette validation');
 result:=public.lounge_set_appearance(sid,'new name','heart','sage');
 assert result->>'icon_color'='sage' and result->>'icon'='heart' and result->>'name'='new name','appearance persisted';
 result:=public.lounge_set_appearance(sid,'legacy rename','moon');
 assert result->>'icon_color'='sage','old three-argument clients retain color';
 begin perform public.lounge_set_appearance(sid,'bad','heart','red'); exception when invalid_parameter_value then denied:=true;end;
 assert denied,'invalid palette rejected';
 assert (select name='legacy rename' from public.lounge_sofas where id=sid),'invalid update atomic';
 denied:=false;
 begin perform public.lounge_set_appearance(gen_random_uuid(),'foreign','heart','rose'); exception when no_data_found then denied:=true;end;
 assert denied,'unknown/foreign sofa denied';
end $$; reset role; select 'palette validation passed' result;