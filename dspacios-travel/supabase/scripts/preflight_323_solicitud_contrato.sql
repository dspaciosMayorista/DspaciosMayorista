-- PREFLIGHT 323 (#78: solicitar contrato + aviso interno) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 323.
with t as (
  select to_regclass('public.cotizacion_solicitudes_contrato') as tabla,
         to_regclass('public.avisos') as avisos,
         to_regclass('public.config_solicitudes') as cfg,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') as chk,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('modo', 'payload', 'creado_por', 'numero_contrato', 'vigencia_hasta', 'tenant', 'codigo'))::int as cols_cot,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name in ('email', 'rol', 'activo', 'tenant', 'aliado_id'))::int as cols_usr,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'cotizacion_id')::int as col_aviso,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from public.avisos)::int as n_avisos
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla cotizacion_solicitudes_contrato aún NO existe (existe si la 323 ya se corrió)' as control, coalesce(tabla::text, 'no existe') as observado, 'no existe antes de la 323' as esperado, case when tabla is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existen avisos (281) y config_solicitudes (056)', coalesce(avisos::text, 'falta') || ' / ' || coalesce(cfg::text, 'falta'), 'ambas existen', case when avisos is not null and cfg is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'El CHECK avisos_tipo_check admite SOLO los dos tipos de soporte de pago (la 323 lo amplía)', coalesce(chk, 'no existe'), 'tipo in (soporte_pago_nuevo, soporte_pago_reemplazado)', case when chk like '%soporte_pago_nuevo%' and chk like '%soporte_pago_reemplazado%' and chk not like '%solicitud_contrato%' then 'OK' else 'REVISAR' end from t
  union all select 4, 'avisos aún NO tiene la columna cotizacion_id', col_aviso::text, '0', case when col_aviso = 0 then 'OK' else 'REVISAR' end from t
  union all select 5, 'cotizaciones tiene las 7 columnas que usa la función', cols_cot::text, '7', case when cols_cot = 7 then 'OK' else 'REVISAR' end from t
  union all select 6, 'usuarios tiene las 5 columnas que usa la función', cols_usr::text, '5', case when cols_usr = 5 then 'OK' else 'REVISAR' end from t
  union all select 7, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 8, 'INFO: avisos existentes (no se tocan)', n_avisos::text, 'n/a', 'INFO' from t
) r order by orden;
