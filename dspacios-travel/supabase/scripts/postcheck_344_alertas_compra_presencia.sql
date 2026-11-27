-- POSTCHECK 344 (B3: alertas de compra con «Revisado», fuentes de hotel/servicio, presencia paginada) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 344.
with t as (
  select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'revisado_en')::int as col_rev,
         (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'idx_avisos_compra_activos')::int as idx_act,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_compra_coherente_check') as chk,
         (select count(*) from pg_trigger where tgname in ('trg_f344_hotel_vigencia', 'trg_f344_hotel_vigencia_del', 'trg_f344_hotel', 'trg_f344_servicio_vigencia', 'trg_f344_servicio_vigencia_del', 'trg_f344_servicio') and not tgisinternal)::int as triggers,
         to_regprocedure('public.alertas_compra_listar(uuid,integer)') as f_lis, to_regprocedure('public.alertas_compra_revisar(uuid,bigint)') as f_rev,
         to_regprocedure('public.fn_actividad_resumen()') as f_res, to_regprocedure('public.fn_actividad_pagina(text,text,integer,integer,integer)') as f_pag,
         to_regprocedure('public.avisos_reclamar(uuid,integer)') as f_recl, to_regprocedure('public.avisos_marcar_leidos(uuid,bigint[])') as f_leer, to_regprocedure('public.avisos_recientes(uuid,integer)') as f_rec,
         (select pg_get_functiondef(to_regprocedure('public.f343_ventanas_compra(date,integer)'))) as def_ven,
         (select count(*) from public.avisos where tipo = 'compra_por_vencer' and revisado_en is not null)::int as revisadas,
         (select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null)::int as vivos
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'avisos.revisado_en existe y el índice parcial de alertas activas también' as control, col_rev::text || ' / ' || idx_act::text as observado, '1 / 1' as esperado, case when col_rev = 1 and idx_act = 1 then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'El CHECK de coherencia admite hotel_vigencia y servicio_vigencia conservando las cuatro fuentes anteriores', coalesce(chk, 'sin check'), 'incluye las seis fuentes',
         case when chk like '%hotel_vigencia%' and chk like '%servicio_vigencia%' and chk like '%paquete_total%' and chk like '%empaquetado%' and chk like '%salida_dinamica%' then 'OK' else 'FALLO' end from t
  union all select 3, 'f343_ventanas_compra incluye las fuentes de hotel y de servicio', (def_ven like '%hotel_vigencia%' and def_ven like '%servicio_vigencia%')::text, 'true', case when def_ven like '%hotel_vigencia%' and def_ven like '%servicio_vigencia%' then 'OK' else 'FALLO' end from t
  union all select 4, 'Los 6 disparadores de archivo inmediato nuevos (cambio de fecha / borrado de la vigencia / desactivar hotel o servicio)', triggers::text, '6', case when triggers = 6 then 'OK' else 'FALLO' end from t
  union all select 5, 'alertas_compra_listar y alertas_compra_revisar: solo service_role (ni authenticated ni anon)',
         case when f_lis is null or f_rev is null then 'falta alguna' else 'service_role=' || (has_function_privilege('service_role', f_lis, 'execute') and has_function_privilege('service_role', f_rev, 'execute'))::text || ' authenticated=' || (has_function_privilege('authenticated', f_lis, 'execute') or has_function_privilege('authenticated', f_rev, 'execute'))::text || ' anon=' || (has_function_privilege('anon', f_lis, 'execute') or has_function_privilege('anon', f_rev, 'execute'))::text end,
         'service_role=true authenticated=false anon=false',
         case when f_lis is not null and f_rev is not null and has_function_privilege('service_role', f_lis, 'execute') and has_function_privilege('service_role', f_rev, 'execute') and not has_function_privilege('authenticated', f_lis, 'execute') and not has_function_privilege('authenticated', f_rev, 'execute') and not has_function_privilege('anon', f_lis, 'execute') and not has_function_privilege('anon', f_rev, 'execute') then 'OK' else 'FALLO' end from t
  union all select 6, 'fn_actividad_resumen y fn_actividad_pagina: SECURITY DEFINER con search_path vacío; authenticated sí, anon no (la base exige superadmin dentro)',
         case when f_res is null or f_pag is null then 'falta alguna' else (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig))::text from pg_proc p where p.oid in (f_res, f_pag)) || ' / authenticated=' || (has_function_privilege('authenticated', f_res, 'execute') and has_function_privilege('authenticated', f_pag, 'execute'))::text || ' anon=' || (has_function_privilege('anon', f_res, 'execute') or has_function_privilege('anon', f_pag, 'execute'))::text end,
         'true / authenticated=true anon=false',
         case when f_res is not null and f_pag is not null and (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p where p.oid in (f_res, f_pag)) and has_function_privilege('authenticated', f_res, 'execute') and has_function_privilege('authenticated', f_pag, 'execute') and not has_function_privilege('anon', f_res, 'execute') and not has_function_privilege('anon', f_pag, 'execute') then 'OK' else 'FALLO' end from t
  union all select 7, 'La campana ya no ve alertas de compra: reclamar, marcar leídos y recientes las excluyen',
         ((select prosrc like '%compra_por_vencer%' from pg_proc where oid = f_recl) and (select prosrc like '%compra_por_vencer%' from pg_proc where oid = f_leer) and (select prosrc like '%compra_por_vencer%' from pg_proc where oid = f_rec))::text, 'true',
         case when (select prosrc like '%compra_por_vencer%' from pg_proc where oid = f_recl) and (select prosrc like '%compra_por_vencer%' from pg_proc where oid = f_leer) and (select prosrc like '%compra_por_vencer%' from pg_proc where oid = f_rec) then 'OK' else 'FALLO' end from t
  union all select 8, 'INFO: alertas de compra vivas / ya revisadas (0 revisadas justo tras aplicar; las vigencias de hotel y servicio aparecen tras la primera corrida del cron diario)', vivos::text || ' / ' || revisadas::text, 'n/a', 'INFO' from t
) r order by orden;
