-- Production migration history: 20260730133228.
-- V4.1 W1 / 3.2: append-only Prompt publishing and chat Prompt seeds.
--
-- Local expand slice:
-- - legacy user_settings Prompt columns remain available for fallback reads;
-- - existing Prompt bodies are retained and never copied into source control;
-- - runtime deployment and legacy-column contract remain separate gates.

set lock_timeout = '5s';
set statement_timeout = '2min';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ── Existing Prompt catalog hardening ────────────────────────────────────────

alter table public.prompt_templates
  add constraint prompt_templates_name_key_check
    check (name ~ '^[a-z][a-z0-9_]*$') not valid;

alter table public.prompt_templates
  validate constraint prompt_templates_name_key_check;

alter table public.prompt_templates
  add constraint prompt_templates_content_nonempty_check
    check (btrim(content) <> '') not valid;

alter table public.prompt_templates
  validate constraint prompt_templates_content_nonempty_check;

create unique index prompt_templates_user_name_active_unique
  on public.prompt_templates (user_id, name)
  where active;

comment on index public.prompt_templates_user_name_active_unique is
  'Exactly one active version per owner Prompt name.';

drop policy if exists prompt_templates_select_own
  on public.prompt_templates;
drop policy if exists prompt_templates_insert_own
  on public.prompt_templates;
drop policy if exists prompt_templates_update_own
  on public.prompt_templates;
drop policy if exists prompt_templates_delete_own
  on public.prompt_templates;

create policy prompt_templates_select_own
  on public.prompt_templates
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.prompt_templates from anon, authenticated;
grant select on public.prompt_templates to authenticated;
grant select, insert, update, delete
  on public.prompt_templates
  to service_role;

-- ── Append-only version rows ─────────────────────────────────────────────────

create or replace function private.enforce_prompt_template_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception
      'prompt_templates rows are append-only and cannot be deleted';
  end if;

  if (
    to_jsonb(new) - 'active' - 'updated_at'
  ) is distinct from (
    to_jsonb(old) - 'active' - 'updated_at'
  ) then
    raise exception
      'prompt_templates rows are append-only; publish a new version instead';
  end if;

  if not old.active and new.active then
    raise exception
      'Inactive Prompt versions cannot be reactivated';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.enforce_prompt_template_immutable()
  from public, anon, authenticated;
grant execute on function private.enforce_prompt_template_immutable()
  to service_role;

create trigger prompt_templates_immutable_version
before update or delete on public.prompt_templates
for each row execute function private.enforce_prompt_template_immutable();

-- ── Owner-bound Prompt publishing ────────────────────────────────────────────

create or replace function private.prompt_template_publish_core(
  p_name text,
  p_category text,
  p_content text,
  p_expected_active_version integer default null
)
returns public.prompt_templates
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_name text := lower(btrim(p_name));
  v_category text := lower(btrim(p_category));
  v_content text := p_content;
  v_active_version integer;
  v_next_version integer;
  v_result public.prompt_templates%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if v_name !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Invalid Prompt name';
  end if;

  if v_category not in ('base', 'scenario', 'style') then
    raise exception 'Invalid Prompt category';
  end if;

  if v_content is null or btrim(v_content) = '' then
    raise exception 'Prompt content is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'v4.1:prompt-template:' || v_owner_id::text || ':' || v_name,
      0
    )
  );

  select version
  into v_active_version
  from public.prompt_templates
  where user_id = v_owner_id
    and name = v_name
    and active
  for update;

  if v_active_version is null then
    if p_expected_active_version is not null then
      raise exception
        'Prompt active version changed (expected %, actual none)',
        p_expected_active_version;
    end if;
  elsif p_expected_active_version is null
     or p_expected_active_version is distinct from v_active_version then
    raise exception
      'Prompt active version changed (expected %, actual %)',
      p_expected_active_version,
      v_active_version;
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.prompt_templates
  where user_id = v_owner_id
    and name = v_name;

  update public.prompt_templates
  set active = false
  where user_id = v_owner_id
    and name = v_name
    and active;

  insert into public.prompt_templates (
    user_id,
    name,
    category,
    content,
    version,
    active
  )
  values (
    v_owner_id,
    v_name,
    v_category,
    v_content,
    v_next_version,
    true
  )
  returning * into v_result;

  return v_result;
end
$function$;

revoke all on function private.prompt_template_publish_core(
  text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function private.prompt_template_publish_core(
  text, text, text, integer
) to authenticated;

create or replace function public.prompt_template_publish(
  p_name text,
  p_category text,
  p_content text,
  p_expected_active_version integer default null
)
returns public.prompt_templates
language sql
security invoker
set search_path = ''
as $function$
  select private.prompt_template_publish_core(
    p_name,
    p_category,
    p_content,
    p_expected_active_version
  )
$function$;

revoke all on function public.prompt_template_publish(
  text, text, text, integer
) from public, anon, service_role;
grant execute on function public.prompt_template_publish(
  text, text, text, integer
) to authenticated;

comment on function public.prompt_template_publish(
  text, text, text, integer
) is
  'Publishes one immutable owner Prompt version and atomically deactivates its predecessor.';

-- ── Owner chat Prompt seeds ──────────────────────────────────────────────────

do $migration$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_wechat_reply_style text;
  v_cli_reply_style text;
  v_sofa_rules text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('v4.1:prompt-publishing-seed', 0)
  );

  select count(*), min(owner_id::text)::uuid
  into v_owner_count, v_owner_id
  from (
    select distinct user_id as owner_id
    from public.prompt_templates
    where user_id is not null
  ) owners;

  if v_owner_count <> 1 or v_owner_id is null then
    raise exception
      'Expected exactly one Prompt owner before seeding chat Prompts; found %',
      v_owner_count;
  end if;

  select content
  into v_wechat_reply_style
  from public.prompt_templates
  where user_id = v_owner_id
    and name = 'wechat_reply_style'
    and active;

  select content
  into v_cli_reply_style
  from public.prompt_templates
  where user_id = v_owner_id
    and name = 'cli_reply_style'
    and active;

  select lounge_scene_prompt
  into v_sofa_rules
  from public.user_settings
  where user_id = v_owner_id;

  if v_wechat_reply_style is null or btrim(v_wechat_reply_style) = '' then
    raise exception 'Active wechat_reply_style is required as the App style seed';
  end if;

  if v_cli_reply_style is null or btrim(v_cli_reply_style) = '' then
    raise exception 'Active cli_reply_style is required as the CLI style seed';
  end if;

  if v_sofa_rules is null or btrim(v_sofa_rules) = '' then
    raise exception 'Legacy lounge_scene_prompt is required as the sofa rules seed';
  end if;

  insert into public.prompt_templates (
    user_id,
    name,
    category,
    content,
    version,
    active
  )
  select
    v_owner_id,
    seed.name,
    seed.category,
    seed.content,
    1,
    true
  from (
    values
      ('app_companion_reply_style', 'style', v_wechat_reply_style),
      ('app_chat_reply_style', 'style', v_wechat_reply_style),
      ('codex_cli_reply_style', 'style', v_cli_reply_style),
      ('claude_cli_reply_style', 'style', v_cli_reply_style),
      ('sofa_daily_rules', 'scenario', v_sofa_rules),
      ('sofa_work_rules', 'scenario', v_sofa_rules)
  ) as seed(name, category, content)
  where not exists (
    select 1
    from public.prompt_templates existing
    where existing.user_id = v_owner_id
      and existing.name = seed.name
  );

  if exists (
    select 1
    from public.generation_ports port
    left join public.prompt_templates identity_prompt
      on identity_prompt.user_id = port.user_id
     and identity_prompt.name = port.identity_prompt_name
     and identity_prompt.active
    left join public.prompt_templates style_prompt
      on style_prompt.user_id = port.user_id
     and style_prompt.name = port.style_prompt_name
     and style_prompt.active
    where port.user_id = v_owner_id
      and port.active
      and (
        identity_prompt.id is null
        or (
          port.style_prompt_name is not null
          and style_prompt.id is null
        )
      )
  ) then
    raise exception 'Every active generation port must resolve to active Prompt versions';
  end if;

  if exists (
    select 1
    from public.conversation_profiles profile
    left join public.prompt_templates rules_prompt
      on rules_prompt.user_id = profile.user_id
     and rules_prompt.name = profile.rules_prompt_name
     and rules_prompt.active
    where profile.user_id = v_owner_id
      and profile.active
      and profile.rules_prompt_name is not null
      and rules_prompt.id is null
  ) then
    raise exception 'Every active sofa profile must resolve to an active rules Prompt';
  end if;
end
$migration$;

-- ── Migration assertions ─────────────────────────────────────────────────────

do $assertions$
declare
  v_owner_id uuid;
  v_missing_prompt_count bigint;
begin
  select min(user_id::text)::uuid
  into v_owner_id
  from public.prompt_templates;

  if exists (
    select 1
    from public.prompt_templates
    where active
    group by user_id, name
    having count(*) > 1
  ) then
    raise exception 'Prompt migration created duplicate active versions';
  end if;

  select count(*)
  into v_missing_prompt_count
  from unnest(array[
    'syzygy_base',
    'checkin_day',
    'checkin_night',
    'wechat_reply_style',
    'app_companion_reply_style',
    'app_chat_reply_style',
    'codex_cli_reply_style',
    'claude_cli_reply_style',
    'sofa_daily_rules',
    'sofa_work_rules'
  ]) required_name
  where not exists (
    select 1
    from public.prompt_templates prompt
    where prompt.user_id = v_owner_id
      and prompt.name = required_name
      and prompt.active
  );

  if v_missing_prompt_count <> 0 then
    raise exception
      'Prompt migration is missing % required active chat Prompt(s)',
      v_missing_prompt_count;
  end if;

  if has_table_privilege('anon', 'public.prompt_templates', 'SELECT')
     or has_table_privilege('anon', 'public.prompt_templates', 'INSERT')
     or has_table_privilege('anon', 'public.prompt_templates', 'UPDATE')
     or has_table_privilege('anon', 'public.prompt_templates', 'DELETE') then
    raise exception 'Anon must not have prompt_templates table privileges';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.prompt_templates',
    'SELECT'
  ) then
    raise exception 'Authenticated must retain owner-readable Prompt access';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.prompt_templates',
    'INSERT'
  ) or has_table_privilege(
    'authenticated',
    'public.prompt_templates',
    'UPDATE'
  ) or has_table_privilege(
    'authenticated',
    'public.prompt_templates',
    'DELETE'
  ) then
    raise exception 'Authenticated Prompt writes must use the publish RPC';
  end if;
end
$assertions$;
