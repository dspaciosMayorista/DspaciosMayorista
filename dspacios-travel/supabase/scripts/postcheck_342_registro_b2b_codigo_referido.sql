-- POSTCHECK 342 (#76) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 342.
with t as (
  select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'b2b_solicitudes' and column_name in ('codigo_referido', 'referido_estado', 'referido_decidido_por', 'referido_decidido_en'))::int as cols,
         (select count(*) from pg_constraint where conrelid = 'public.b2b_solicitudes'::regclass and conname = 'b2b_solicitudes_referido_coherente')::int as coherente,
         (select count(*) from pg_constraint where conrelid = 'public.b2b_solicitudes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%codigo_referido ~%')::int as formato,
         to_regprocedure('public.registro_b2b_completar(uuid,jsonb)') as comp,
         to_regprocedure('public.referido_decidir_solicitud(uuid,bigint,text,bigint,numeric)') as dec,
         to_regprocedure('public.referidos_candidatos(uuid)') as cand,
         pg_get_functiondef(to_regprocedure('public.registro_b2b_completar(uuid,jsonb)')) as def_comp,
         (select count(*) from public.b2b_solicitudes where codigo_referido is not null)::int as con_codigo,
         (select count(*) from public.b2b_solicitudes where referido_estado <> 'sin_codigo')::int as con_estado
), v as (
  select t.*, (def_comp like '%SECURITY DEFINER%' and (def_comp like '%search_path%public%' and def_comp like '%pg_temp%') and def_comp like '%p324_correo_confirmado%' and def_comp like '%ya_existia%') as conserva,
         (comp is not null and dec is not null and cand is not null) as existen
    from t
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las 4 columnas nuevas existen' as control, cols::text as observado, '4' as esperado, case when cols = 4 then 'OK' else 'FALLO' end as estado from v
  union all select 2, 'Coherencia (sin código ⇔ estado sin_codigo) y formato del código exigidos por la tabla', coherente::text || ' / ' || formato::text, '1 / 1', case when coherente = 1 and formato >= 1 then 'OK' else 'FALLO' end from v
  union all select 3, 'Las 3 funciones existen', coalesce(comp::text, '-') || ' / ' || coalesce(dec::text, '-') || ' / ' || coalesce(cand::text, '-'), 'las tres', case when existen then 'OK' else 'FALLO' end from v
  union all select 4, 'registro_b2b_completar conserva SECURITY DEFINER, search_path y la validación de correo confirmado de la 324', case when conserva then 'conserva' else 'CAMBIÓ' end, 'conserva', case when conserva then 'OK' else 'FALLO' end from v
  union all select 5, 'Solo service_role ejecuta las 3 funciones (anon/authenticated no)',
         case when not existen then 'sin función' else 'service_role=' || (has_function_privilege('service_role', comp, 'execute') and has_function_privilege('service_role', dec, 'execute') and has_function_privilege('service_role', cand, 'execute'))::text
           || ' anon=' || (has_function_privilege('anon', comp, 'execute') or has_function_privilege('anon', dec, 'execute') or has_function_privilege('anon', cand, 'execute'))::text
           || ' authenticated=' || (has_function_privilege('authenticated', comp, 'execute') or has_function_privilege('authenticated', dec, 'execute') or has_function_privilege('authenticated', cand, 'execute'))::text end,
         'service_role=true anon=false authenticated=false',
         case when existen and has_function_privilege('service_role', comp, 'execute') and has_function_privilege('service_role', dec, 'execute') and has_function_privilege('service_role', cand, 'execute')
                   and not has_function_privilege('anon', comp, 'execute') and not has_function_privilege('authenticated', comp, 'execute') and not has_function_privilege('anon', dec, 'execute') and not has_function_privilege('authenticated', dec, 'execute')
                   and not has_function_privilege('anon', cand, 'execute') and not has_function_privilege('authenticated', cand, 'execute') then 'OK' else 'FALLO' end from v
  union all select 6, 'Sin backfill: ningún registro anterior quedó con código ni estado (justo tras aplicar)', con_codigo::text || ' con código / ' || con_estado::text || ' con estado', '0 / 0 justo tras aplicar', case when con_codigo = 0 and con_estado = 0 then 'OK' else 'INFO' end from v
) r order by orden;
