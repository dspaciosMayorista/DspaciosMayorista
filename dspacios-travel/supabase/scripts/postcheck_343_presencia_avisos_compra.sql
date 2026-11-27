-- POSTCHECK 343 (#11 presencia reciente + #13 avisos de compra en la campana) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 343.
with t as (
  select to_regclass('public.presencia_usuario') as pres,
         (select relrowsecurity from pg_class where oid = to_regclass('public.presencia_usuario')) as rls,
         (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'presencia_usuario' and grantee in ('anon', 'authenticated', 'public', 'service_role'))::int as grants_pres,
         (select count(*) from pg_policy where polrelid = to_regclass('public.presencia_usuario'))::int as pol_pres,
         to_regprocedure('public.registrar_presencia()') as f_reg,
         to_regprocedure('public.fn_actividad_reciente(integer)') as f_act,
         to_regprocedure('public.generar_avisos_compra(date,integer)') as f_gen,
         to_regprocedure('public.f343_ventanas_compra(date,integer)') as f_ven,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name in ('ventana_tipo', 'ventana_id', 'ventana_ref', 'ventana_titulo', 'compra_fin'))::int as cols_ventana,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') as chk,
         (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'uq_avisos_compra_vivo' and indexdef like '%archivado_en IS NULL%')::int as idx_vivo,
         (select count(*) from pg_trigger where tgname in ('trg_f343_paquete', 'trg_f343_salida', 'trg_f343_empaquetado', 'trg_f343_total') and not tgisinternal)::int as triggers,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'config_notificaciones' and column_name = 'alerta_paquetes')::int as col_correo,
         (select count(*) from public.presencia_usuario)::int as filas_pres,
         (select count(*) from public.avisos where tipo = 'compra_por_vencer')::int as avisos_compra
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'presencia_usuario existe con RLS activa, sin políticas y SIN privilegios para ningún cliente ni service_role' as control, coalesce(pres::text, 'no existe') || ' / rls=' || coalesce(rls::text, 'null') || ' / políticas=' || pol_pres || ' / grants=' || grants_pres as observado, 'existe / rls=true / políticas=0 / grants=0' as esperado, case when pres is not null and rls and pol_pres = 0 and grants_pres = 0 then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'registrar_presencia: SECURITY DEFINER con search_path vacío; solo authenticated la ejecuta (anon y public no)',
         case when f_reg is null then 'no existe' else (select p.prosecdef::text || ' / ' || coalesce(array_to_string(p.proconfig, ','), 'sin config') from pg_proc p where p.oid = f_reg) || ' / authenticated=' || has_function_privilege('authenticated', f_reg, 'execute')::text || ' anon=' || has_function_privilege('anon', f_reg, 'execute')::text end,
         'true / search_path="" / authenticated=true anon=false',
         case when f_reg is not null and (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = f_reg) and has_function_privilege('authenticated', f_reg, 'execute') and not has_function_privilege('anon', f_reg, 'execute') then 'OK' else 'FALLO' end from t
  union all select 3, 'fn_actividad_reciente: SECURITY DEFINER con search_path vacío; authenticated y service_role sí, anon no',
         case when f_act is null then 'no existe' else (select p.prosecdef::text || ' / ' || coalesce(array_to_string(p.proconfig, ','), 'sin config') from pg_proc p where p.oid = f_act) || ' / authenticated=' || has_function_privilege('authenticated', f_act, 'execute')::text || ' anon=' || has_function_privilege('anon', f_act, 'execute')::text end,
         'true / search_path="" / authenticated=true anon=false',
         case when f_act is not null and (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = f_act) and has_function_privilege('authenticated', f_act, 'execute') and not has_function_privilege('anon', f_act, 'execute') then 'OK' else 'FALLO' end from t
  union all select 4, 'generar_avisos_compra y f343_ventanas_compra: solo service_role (la segunda ni siquiera ella: es interna)',
         case when f_gen is null or f_ven is null then 'falta alguna' else 'gen: service_role=' || has_function_privilege('service_role', f_gen, 'execute')::text || ' authenticated=' || has_function_privilege('authenticated', f_gen, 'execute')::text || ' anon=' || has_function_privilege('anon', f_gen, 'execute')::text || ' / ventanas: authenticated=' || has_function_privilege('authenticated', f_ven, 'execute')::text end,
         'gen: service_role=true authenticated=false anon=false / ventanas: authenticated=false',
         case when f_gen is not null and f_ven is not null and has_function_privilege('service_role', f_gen, 'execute') and not has_function_privilege('authenticated', f_gen, 'execute') and not has_function_privilege('anon', f_gen, 'execute') and not has_function_privilege('authenticated', f_ven, 'execute') then 'OK' else 'FALLO' end from t
  union all select 5, 'avisos: 5 columnas de ventana y el CHECK de tipos admite compra_por_vencer CONSERVANDO los tipos previos', cols_ventana::text || ' / ' || coalesce(chk, 'sin check'), '5 / incluye compra_por_vencer + soporte_pago_nuevo + soporte_pago_reemplazado + solicitud_contrato',
         case when cols_ventana = 5 and chk like '%compra_por_vencer%' and chk like '%soporte_pago_nuevo%' and chk like '%soporte_pago_reemplazado%' and chk like '%solicitud_contrato%' then 'OK' else 'FALLO' end from t
  union all select 6, 'Índice único parcial: un solo aviso VIVO por persona, ventana y fecha de fin', idx_vivo::text, '1', case when idx_vivo = 1 then 'OK' else 'FALLO' end from t
  union all select 7, 'Los 4 disparadores de archivo inmediato (paquete, salida, empaquetado, paquete total)', triggers::text, '4', case when triggers = 4 then 'OK' else 'FALLO' end from t
  union all select 8, 'NO existe configuración de correo para paquetes (config_notificaciones sin alerta_paquetes)', col_correo::text, '0', case when col_correo = 0 then 'OK' else 'FALLO' end from t
  union all select 9, 'INFO: filas de presencia / avisos de compra (0 y 0 justo tras aplicar; los avisos aparecen tras la primera ejecución del cron diario)', filas_pres::text || ' / ' || avisos_compra::text, 'n/a', 'INFO' from t
) r order by orden;
