-- PREFLIGHT 340 (#78: aviso interno por cotización pública B2C, destinatarios por PERMISO) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 340.
with t as (
  select to_regprocedure('public.avisar_cotizacion_publica(bigint)') as fn,
         to_regprocedure('public.avisos_recientes(uuid,integer)') as fn_rec,
         to_regclass('public.avisos') as avisos,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') as chk,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'cotizacion_id')::int as col_aviso,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('id', 'codigo', 'tipo', 'estado', 'numero_contrato', 'creado_por', 'tenant'))::int as cols_cot,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name in ('id', 'email', 'rol', 'activo', 'tenant'))::int as cols_usr,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'uq_avisos_cotizacion_publica')::int as idx,
         (select count(*) from public.avisos where tipo = 'cotizacion_publica')::int as n_tipo_nuevo,
         (select count(*) from public.usuarios where activo and rol in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta'))::int as n_destinatarios
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las funciones avisar_cotizacion_publica y avisos_recientes aún NO existen (existen si la 340 ya se corrió)' as control, coalesce(fn::text, 'no existe') || ' / ' || coalesce(fn_rec::text, 'no existe') as observado, 'ninguna existe antes de la 340' as esperado, case when fn is null and fn_rec is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existe la tabla avisos (281)', coalesce(avisos::text, 'falta'), 'existe', case when avisos is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'La 323 está aplicada: avisos.cotizacion_id existe y el CHECK admite solicitud_contrato', col_aviso::text || ' / ' || coalesce(chk, 'no existe'), 'cotizacion_id=1 y el CHECK incluye solicitud_contrato', case when col_aviso = 1 and chk like '%solicitud_contrato%' then 'OK' else 'REVISAR' end from t
  union all select 4, 'El CHECK aún NO admite cotizacion_publica', coalesce(chk, 'no existe'), 'sin cotizacion_publica', case when chk not like '%cotizacion_publica%' then 'OK' else 'REVISAR' end from t
  union all select 5, 'cotizaciones tiene las 7 columnas que usan las funciones', cols_cot::text, '7', case when cols_cot = 7 then 'OK' else 'REVISAR' end from t
  union all select 6, 'usuarios tiene las 5 columnas que usan las funciones', cols_usr::text, '5', case when cols_usr = 5 then 'OK' else 'REVISAR' end from t
  union all select 7, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 8, 'El índice único uq_avisos_cotizacion_publica aún no existe', idx::text, '0', case when idx = 0 then 'OK' else 'REVISAR' end from t
  union all select 9, 'No hay avisos del tipo nuevo todavía', n_tipo_nuevo::text, '0', case when n_tipo_nuevo = 0 then 'OK' else 'REVISAR' end from t
  union all select 10, 'INFO: usuarios activos con un rol que puede asistir cotizaciones (los destinatarios potenciales; la lista de config_solicitudes ya NO decide)', n_destinatarios::text, 'n/a', 'INFO' from t
) r order by orden;
