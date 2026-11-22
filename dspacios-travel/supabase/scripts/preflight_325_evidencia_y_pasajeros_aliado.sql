-- PREFLIGHT 325 (O-3: evidencia previa y pasajeros adicionales del aliado, sobre la cotización) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 325.
with t as (
  select to_regclass('public.cotizacion_evidencias') as evid, to_regclass('public.cotizacion_pasajeros_aliado') as pas,
         to_regprocedure('public.solicitar_contrato_cotizacion(bigint,uuid)') as f323,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('id', 'codigo', 'creado_por', 'tenant', 'payload', 'modo', 'estado', 'vigencia_hasta', 'fecha_salida', 'numero_contrato', 'pax'))::int as cols_cot,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name in ('id', 'email', 'rol', 'activo', 'tenant', 'aliado_id'))::int as cols_usr,
         (select count(*) from storage.buckets where id = 'evidencias-cotizacion')::int as bucket,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('mi_rol', 'mi_tenant'))::int as helpers
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las tablas nuevas aún NO existen' as control, coalesce(evid::text, 'no existe') || ' / ' || coalesce(pas::text, 'no existe') as observado, 'no existen antes de la 325' as esperado, case when evid is null and pas is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existe la 323 (solicitar_contrato_cotizacion)', coalesce(f323::text, 'falta'), 'existe', case when f323 is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'cotizaciones tiene las 11 columnas que usan las funciones', cols_cot::text, '11', case when cols_cot = 11 then 'OK' else 'REVISAR' end from t
  union all select 4, 'usuarios tiene las 6 columnas que usan las funciones', cols_usr::text, '6', case when cols_usr = 6 then 'OK' else 'REVISAR' end from t
  union all select 5, 'El bucket evidencias-cotizacion aún no existe', bucket::text, '0', case when bucket = 0 then 'OK' else 'REVISAR' end from t
  union all select 6, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 7, 'Existen mi_rol() y mi_tenant() (las usan las policies)', helpers::text, '2', case when helpers = 2 then 'OK' else 'REVISAR' end from t
) r order by orden;
