BEGIN;
DO $claims$ DECLARE uid uuid; BEGIN SELECT user_id INTO STRICT uid FROM public.generation_ports WHERE active AND port_key='codex_cli';PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);END $claims$;
DO $test$ DECLARE owner_id uuid; doc public.prompt_templates; BEGIN
 SELECT user_id INTO STRICT owner_id FROM public.generation_ports WHERE active AND port_key='codex_cli';
 IF (SELECT count(*) FROM public.prompt_templates WHERE user_id=owner_id AND active AND name LIKE 'machine_%')<>21 THEN RAISE EXCEPTION 'wrong active count'; END IF;
 SELECT * INTO STRICT doc FROM public.prompt_templates WHERE user_id=owner_id AND active AND name='machine_job_codex_weekly_backup';
 IF doc.content::jsonb->>'targetRole'<>'codex_cli_syzygy' OR doc.content::jsonb->>'hour'<>'23' THEN RAISE EXCEPTION 'backup schedule wrong'; END IF;
 BEGIN
 PERFORM public.prompt_template_publish(doc.name,doc.category,jsonb_set(doc.content::jsonb,'{hour}','3')::text,doc.version);
 RAISE EXCEPTION 'accepted wrong schedule';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted wrong schedule' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.prompt_template_publish('machine_doc_prompts_cli_tasks_syzygy_note','scenario','revive old task',NULL);
 RAISE EXCEPTION 'accepted retired document';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted retired document' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM public.prompt_templates WHERE user_id=owner_id AND name='machine_doc_prompts_cli_tasks_syzygy_note' AND NOT active) THEN RAISE EXCEPTION 'retired history lost'; END IF;
END $test$;
SELECT '21 active / merged revisions / retired history retained / retirement and backup schedule guards passed' AS validation;
ROLLBACK;
