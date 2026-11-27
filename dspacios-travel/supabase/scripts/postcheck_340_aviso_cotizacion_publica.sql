-- POSTCHECK 340 (#78) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 340.
with t as (
  select to_regprocedure('public.avisar_cotizacion_publica(bigint)') as fn,
         to_regprocedure('public.avisos_recientes(uuid,integer)') as fn_rec,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') as chk,
         (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'uq_avisos_cotizacion_publica' and indexdef like '%UNIQUE%' and indexdef like '%cotizacion_publica%')::int as idx,
         (select prosecdef from pg_proc where oid = to_regprocedure('public.avisar_cotizacion_publica(bigint)')) as secdef,
         (select prosecdef from pg_proc where oid = to_regprocedure('public.avisos_recientes(uuid,integer)')) as secdef_rec,
         (select count(*) from public.avisos where tipo = 'cotizacion_publica')::int as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las dos funciones existen' as control, coalesce(fn::text, 'no existe') || ' / ' || coalesce(fn_rec::text, 'no existe') as observado, 'ambas existen' as esperado, case when fn is not null and fn_rec is not null then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'El CHECK de avisos admite cotizacion_publica y conserva los tipos previos', coalesce(chk, 'no existe'), 'incluye cotizacion_publica + soporte_pago_nuevo + soporte_pago_reemplazado + solicitud_contrato',
         case when chk like '%cotizacion_publica%' and chk like '%soporte_pago_nuevo%' and chk like '%soporte_pago_reemplazado%' and chk like '%solicitud_contrato%' then 'OK' else 'FALLO' end from t
  union all select 3, 'Índice único parcial por (usuario, cotización) del tipo nuevo', idx::text, '1', case when idx = 1 then 'OK' else 'FALLO' end from t
  union all select 4, 'Ambas funciones son SECURITY DEFINER', coalesce(secdef::text, 'sin función') || ' / ' || coalesce(secdef_rec::text, 'sin función'), 'true / true', case when secdef is true and secdef_rec is true then 'OK' else 'FALLO' end from t
  union all select 5, 'Solo service_role ejecuta las funciones (anon/authenticated no)',
         case when fn is null or fn_rec is null then 'sin función' else 'service_role=' || (has_function_privilege('service_role', fn, 'execute') and has_function_privilege('service_role', fn_rec, 'execute'))::text || ' anon=' || (has_function_privilege('anon', fn, 'execute') or has_function_privilege('anon', fn_rec, 'execute'))::text || ' authenticated=' || (has_function_privilege('authenticated', fn, 'execute') or has_function_privilege('authenticated', fn_rec, 'execute'))::text end,
         'service_role=true anon=false authenticated=false',
         case when fn is not null and fn_rec is not null and has_function_privilege('service_role', fn, 'execute') and has_function_privilege('service_role', fn_rec, 'execute')
                   and not has_function_privilege('anon', fn, 'execute') and not has_function_privilege('authenticated', fn, 'execute')
                   and not has_function_privilege('anon', fn_rec, 'execute') and not has_function_privilege('authenticated', fn_rec, 'execute') then 'OK' else 'FALLO' end from t
  union all select 6, 'INFO: avisos del tipo nuevo (0 justo tras aplicar, hasta el primer visitante)', filas::text, 'n/a', 'INFO' from t
) r order by orden;
