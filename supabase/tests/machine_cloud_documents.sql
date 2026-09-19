BEGIN;
DO $test$
DECLARE owner_id uuid; row public.prompt_templates; old_version integer; expected jsonb; prior_count integer;
BEGIN
 SELECT user_id INTO STRICT owner_id FROM public.generation_ports WHERE active AND port_key='codex_cli';
 IF (SELECT count(*) FROM public.prompt_templates WHERE user_id=owner_id AND name LIKE 'machine_%' AND active) <> 21 THEN RAISE EXCEPTION 'seed incomplete'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 SELECT * INTO STRICT row FROM public.prompt_templates WHERE user_id=owner_id AND name='machine_job_claude_morning_share' AND active;
 SELECT count(*) INTO prior_count FROM public.prompt_templates WHERE user_id=owner_id AND name=row.name;
 old_version:=row.version;
 expected:=row.content::jsonb;
 row:=public.prompt_template_publish(row.name,row.category,jsonb_set(expected,'{taskContent}','"transaction rollback test"')::text,row.version);
 IF row.version <> old_version+1 THEN RAISE EXCEPTION 'version not advanced'; END IF;
 BEGIN
  PERFORM public.prompt_template_publish(row.name,row.category,row.content,old_version);
  RAISE EXCEPTION 'conflict was accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='conflict was accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.prompt_template_publish(row.name,row.category,jsonb_set(expected,'{hour}','9')::text,row.version);
  RAISE EXCEPTION 'schedule change was accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='schedule change was accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.prompt_template_publish(row.name,row.category,'{}',row.version);
  RAISE EXCEPTION 'incomplete config was accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='incomplete config was accepted' THEN RAISE; END IF; END;
 row:=public.prompt_template_publish(row.name,row.category,expected::text,row.version);
 IF row.version <> old_version+2 OR row.content::jsonb IS DISTINCT FROM expected THEN RAISE EXCEPTION 'restore failed'; END IF;
 IF (SELECT count(*) FROM public.prompt_templates WHERE user_id=owner_id AND name=row.name AND active) <> 1 THEN RAISE EXCEPTION 'duplicate active'; END IF;
 IF (SELECT count(*) FROM public.prompt_templates WHERE user_id=owner_id AND name=row.name) <> prior_count+2 THEN RAISE EXCEPTION 'history lost'; END IF;
 IF has_function_privilege('anon','public.prompt_template_publish(text,text,text,integer)','EXECUTE') THEN RAISE EXCEPTION 'anon can publish'; END IF;
END $test$;
DO $test$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
END $test$;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 IF EXISTS (SELECT 1 FROM public.prompt_templates WHERE name LIKE 'machine_%') THEN RAISE EXCEPTION 'cross owner visible'; END IF;
END $test$;
RESET ROLE;
SELECT '21 documents / publish / conflict / locked schedule / invalid payload / restore / history / anon / cross-owner RLS passed; rolled back' AS validation;
ROLLBACK;
