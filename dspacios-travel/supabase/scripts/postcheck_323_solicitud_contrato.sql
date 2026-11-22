-- POSTCHECK 323 (#78) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 323.
with t as (
  select to_regclass('public.cotizacion_solicitudes_contrato') as tabla,
         (select relrowsecurity from pg_class where oid = to_regclass('public.cotizacion_solicitudes_contrato')) as rls,
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cotizacion_solicitudes_contrato')::int as politicas,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') as chk,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'cotizacion_id')::int as col_aviso,
         (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'uq_solicitud_contrato_abierta' and indexdef like '%WHERE%solicitada%')::int as idx,
         to_regprocedure('public.solicitar_contrato_cotizacion(bigint,uuid)') as fn,
         (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_solicitudes_contrato' and grantee in ('anon', 'authenticated', 'public'))::int as grants_cliente,
         (select count(*) from public.cotizacion_solicitudes_contrato)::int as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla existe con RLS activa' as control, coalesce(tabla::text, 'no existe') || ' / rls=' || coalesce(rls::text, 'null') as observado, 'existe / rls=true' as esperado, case when tabla is not null and rls then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'Sin políticas RLS (solo service_role vía RPC)', politicas::text, '0', case when politicas = 0 then 'OK' else 'FALLO' end from t
  union all select 3, 'anon/authenticated/public sin privilegios sobre la tabla', grants_cliente::text, '0', case when grants_cliente = 0 then 'OK' else 'FALLO' end from t
  union all select 4, 'El CHECK de avisos admite solicitud_contrato y conserva los tipos previos', coalesce(chk, 'no existe'), 'incluye solicitud_contrato + 2 previos', case when chk like '%solicitud_contrato%' and chk like '%soporte_pago_nuevo%' and chk like '%soporte_pago_reemplazado%' then 'OK' else 'FALLO' end from t
  union all select 5, 'avisos.cotizacion_id existe', col_aviso::text, '1', case when col_aviso = 1 then 'OK' else 'FALLO' end from t
  union all select 6, 'Índice único parcial de solicitud abierta por cotización', idx::text, '1', case when idx = 1 then 'OK' else 'FALLO' end from t
  union all select 7, 'La función existe', coalesce(fn::text, 'no existe'), 'existe', case when fn is not null then 'OK' else 'FALLO' end from t
  union all select 8, 'Solo service_role ejecuta la función (anon/authenticated no)',
         case when fn is null then 'sin función' else 'service_role=' || has_function_privilege('service_role', fn, 'execute')::text || ' anon=' || has_function_privilege('anon', fn, 'execute')::text || ' authenticated=' || has_function_privilege('authenticated', fn, 'execute')::text end,
         'service_role=true anon=false authenticated=false',
         case when fn is not null and has_function_privilege('service_role', fn, 'execute') and not has_function_privilege('anon', fn, 'execute') and not has_function_privilege('authenticated', fn, 'execute') then 'OK' else 'FALLO' end from t
  union all select 9, 'INFO: solicitudes registradas (0 justo tras aplicar)', filas::text, 'n/a', 'INFO' from t
) r order by orden;
