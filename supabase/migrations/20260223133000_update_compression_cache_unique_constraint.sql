alter table public.compression_cache
  drop constraint if exists compression_cache_module_conv_msg_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'compression_cache_module_conv_key'
      and conrelid = 'public.compression_cache'::regclass
  ) then
    alter table public.compression_cache
      add constraint compression_cache_module_conv_key unique (module, conversation_id);
  end if;
end
$$;
