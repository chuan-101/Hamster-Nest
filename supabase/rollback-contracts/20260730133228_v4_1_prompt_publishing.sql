-- Production migration history: 20260730133228.
-- Emergency contract rollback for V4.1 Prompt publishing.
--
-- This file deliberately lives outside supabase/migrations so normal forward
-- migration tooling never applies it automatically. If production rollback is
-- required, register this SQL as a new forward migration after confirming the
-- guard below still passes. The guard fails closed once any seeded Prompt has
-- been published beyond its original v1 row.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $rollback_guard$
declare
  v_seed_rows bigint;
  v_seed_names bigint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('v4.1:prompt-publishing-seed', 0)
  );

  if to_regprocedure(
    'public.prompt_template_publish(text,text,text,integer)'
  ) is null then
    raise exception 'Prompt publishing contract is not installed';
  end if;

  select count(*), count(distinct name)
  into v_seed_rows, v_seed_names
  from public.prompt_templates
  where name in (
    'app_companion_reply_style',
    'app_chat_reply_style',
    'codex_cli_reply_style',
    'claude_cli_reply_style',
    'sofa_daily_rules',
    'sofa_work_rules'
  );

  if v_seed_rows <> 6 or v_seed_names <> 6 then
    raise exception
      'Prompt rollback requires exactly six untouched seed rows; found % rows / % names',
      v_seed_rows,
      v_seed_names;
  end if;

  if exists (
    select 1
    from public.prompt_templates
    where name in (
      'app_companion_reply_style',
      'app_chat_reply_style',
      'codex_cli_reply_style',
      'claude_cli_reply_style',
      'sofa_daily_rules',
      'sofa_work_rules'
    )
      and (version <> 1 or not active)
  ) then
    raise exception
      'Prompt rollback refuses to delete a seed that has entered version history';
  end if;
end
$rollback_guard$;

drop function public.prompt_template_publish(
  text, text, text, integer
);
drop function private.prompt_template_publish_core(
  text, text, text, integer
);

drop trigger prompt_templates_immutable_version
  on public.prompt_templates;
drop function private.enforce_prompt_template_immutable();

delete from public.prompt_templates
where name in (
  'app_companion_reply_style',
  'app_chat_reply_style',
  'codex_cli_reply_style',
  'claude_cli_reply_style',
  'sofa_daily_rules',
  'sofa_work_rules'
);

drop index public.prompt_templates_user_name_active_unique;

alter table public.prompt_templates
  drop constraint prompt_templates_name_key_check,
  drop constraint prompt_templates_content_nonempty_check;

drop policy prompt_templates_select_own
  on public.prompt_templates;

create policy prompt_templates_select_own
  on public.prompt_templates
  for select
  using ((select auth.uid()) = user_id);

create policy prompt_templates_insert_own
  on public.prompt_templates
  for insert
  with check ((select auth.uid()) = user_id);

create policy prompt_templates_update_own
  on public.prompt_templates
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy prompt_templates_delete_own
  on public.prompt_templates
  for delete
  using ((select auth.uid()) = user_id);

revoke all on public.prompt_templates from anon, authenticated;
grant all privileges on public.prompt_templates to anon, authenticated;

do $rollback_assertions$
begin
  if to_regprocedure(
    'public.prompt_template_publish(text,text,text,integer)'
  ) is not null then
    raise exception 'Prompt publish RPC survived contract rollback';
  end if;

  if to_regclass(
    'public.prompt_templates_user_name_active_unique'
  ) is not null then
    raise exception 'Prompt active unique index survived contract rollback';
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.prompt_templates'::regclass
      and tgname = 'prompt_templates_immutable_version'
      and not tgisinternal
  ) then
    raise exception 'Prompt immutable trigger survived contract rollback';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.prompt_templates'::regclass
      and conname in (
        'prompt_templates_name_key_check',
        'prompt_templates_content_nonempty_check'
      )
  ) then
    raise exception 'Prompt publishing constraints survived contract rollback';
  end if;

  if exists (
    select 1
    from public.prompt_templates
    where name in (
      'app_companion_reply_style',
      'app_chat_reply_style',
      'codex_cli_reply_style',
      'claude_cli_reply_style',
      'sofa_daily_rules',
      'sofa_work_rules'
    )
  ) then
    raise exception 'Prompt seed rows survived contract rollback';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'prompt_templates'
      and policyname in (
        'prompt_templates_select_own',
        'prompt_templates_insert_own',
        'prompt_templates_update_own',
        'prompt_templates_delete_own'
      )
      and roles = array['public']::name[]
  ) <> 4 then
    raise exception 'Prompt owner policies were not restored';
  end if;

  if not (
    has_table_privilege('anon', 'public.prompt_templates', 'SELECT')
    and has_table_privilege('anon', 'public.prompt_templates', 'INSERT')
    and has_table_privilege('anon', 'public.prompt_templates', 'UPDATE')
    and has_table_privilege('anon', 'public.prompt_templates', 'DELETE')
    and has_table_privilege('anon', 'public.prompt_templates', 'TRUNCATE')
    and has_table_privilege('anon', 'public.prompt_templates', 'REFERENCES')
    and has_table_privilege('anon', 'public.prompt_templates', 'TRIGGER')
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'SELECT'
    )
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'INSERT'
    )
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'UPDATE'
    )
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'DELETE'
    )
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'TRUNCATE'
    )
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'REFERENCES'
    )
    and has_table_privilege(
      'authenticated',
      'public.prompt_templates',
      'TRIGGER'
    )
  ) then
    raise exception 'Prompt table grants were not restored';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.prompt_templates'::regclass
      and tgname = 'prompt_templates_set_updated_at'
      and not tgisinternal
  ) then
    raise exception 'Legacy Prompt updated_at trigger was not preserved';
  end if;
end
$rollback_assertions$;
