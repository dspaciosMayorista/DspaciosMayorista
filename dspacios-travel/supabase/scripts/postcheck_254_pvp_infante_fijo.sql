-- Postcheck 254 (solo lectura, UNA consulta): control | observado | esperado | estado (OK / FALLA).
select * from (
  select 1 as n, 'columna armado_paquetes.pvp_infante_fijo numeric(15,2) nullable' as control,
         coalesce((select data_type||'('||numeric_precision||','||numeric_scale||') '||is_nullable from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='pvp_infante_fijo'),'no existe') as observado,
         'numeric(15,2) YES' as esperado,
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='pvp_infante_fijo' and data_type='numeric' and numeric_precision=15 and numeric_scale=2 and is_nullable='YES') then 'OK' else 'FALLA' end as estado
  union all
  select 2, 'columnas tarifario_resultado.precio_pvp_sin_fijo y precio_pvp_menor2_sin_fijo numeric(15,2)',
         (select count(*) from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name in ('precio_pvp_sin_fijo','precio_pvp_menor2_sin_fijo') and data_type='numeric' and numeric_precision=15 and numeric_scale=2)::text, '2',
         case when (select count(*) from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name in ('precio_pvp_sin_fijo','precio_pvp_menor2_sin_fijo') and data_type='numeric' and numeric_precision=15 and numeric_scale=2) = 2 then 'OK' else 'FALLA' end
  union all
  select 3, 'checks (>= 0) de las tres columnas', (select count(*) from pg_constraint where conname in ('armado_paquetes_pvp_infante_fijo_chk','tarifario_resultado_sin_fijo_chk'))::text, '2',
         case when (select count(*) from pg_constraint where conname in ('armado_paquetes_pvp_infante_fijo_chk','tarifario_resultado_sin_fijo_chk')) = 2 then 'OK' else 'FALLA' end
  union all
  select 4, 'huella función del trigger = la de la 254', coalesce(md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tarifario_trg_bump_armado_paquetes()')), chr(13), '')),'no existe'), '47a597c5ac1faaf86c9820797115bd61', case when md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tarifario_trg_bump_armado_paquetes()')), chr(13), '')) = '47a597c5ac1faaf86c9820797115bd61' then 'OK' else 'FALLA' end
  union all
  select 5, 'huella definición del trigger = la de la 254 (vigila pvp_infante_fijo)', coalesce((select md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgname = 'tarifario_trg_armado_paquetes' and t.tgrelid = to_regclass('public.armado_paquetes')),'no existe'), '65c829bcdf7f83da9d2f7f6c54fbb122', case when (select md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgname = 'tarifario_trg_armado_paquetes' and t.tgrelid = to_regclass('public.armado_paquetes')) = '65c829bcdf7f83da9d2f7f6c54fbb122' then 'OK' else 'FALLA' end
  union all
  select 6, 'huella publicar_tarifario_resultado_interno = la de la 254', coalesce(md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), '')),'no existe'), '990e246824e567293372355d290a61a9', case when md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), '')) = '990e246824e567293372355d290a61a9' then 'OK' else 'FALLA' end
  union all
  select 7, 'función del trigger y publicador interno sin EXECUTE para anon/authenticated', (has_function_privilege('anon','public.tarifario_trg_bump_armado_paquetes()','execute') or has_function_privilege('authenticated','public.tarifario_trg_bump_armado_paquetes()','execute') or has_function_privilege('anon','public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)','execute') or has_function_privilege('authenticated','public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)','execute'))::text, 'false',
         case when not (has_function_privilege('anon','public.tarifario_trg_bump_armado_paquetes()','execute') or has_function_privilege('authenticated','public.tarifario_trg_bump_armado_paquetes()','execute') or has_function_privilege('anon','public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)','execute') or has_function_privilege('authenticated','public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)','execute')) then 'OK' else 'FALLA' end
  union all
  select 8, 'huella vista tarifario_resultado_publicable = la de la 254 (expone las 2 columnas nuevas)', coalesce((select md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true))),'no existe'), 'd4165ca9aaa100ae9bfb49d07e1aacb6', case when (select md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true))) = 'd4165ca9aaa100ae9bfb49d07e1aacb6' then 'OK' else 'FALLA' end
  union all
  select 9, 'filas con valores negativos (armado_paquetes + tarifario_resultado)', ((select count(*) from public.armado_paquetes where pvp_infante_fijo < 0) + (select count(*) from public.tarifario_resultado where precio_pvp_sin_fijo < 0 or precio_pvp_menor2_sin_fijo < 0))::text, '0',
         case when (select count(*) from public.armado_paquetes where pvp_infante_fijo < 0) + (select count(*) from public.tarifario_resultado where precio_pvp_sin_fijo < 0 or precio_pvp_menor2_sin_fijo < 0) = 0 then 'OK' else 'FALLA' end
) t order by n;
