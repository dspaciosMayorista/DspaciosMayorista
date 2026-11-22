-- PREFLIGHT 318 (#98: firma del aliado + aceptación de cuenta de cobro) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 318.
with t as (
  select to_regclass('public.aliado_firmas') as firmas, to_regclass('public.cuenta_cobro_aceptaciones') as aceptaciones,
         to_regprocedure('public.aceptar_cuenta_cobro(text,bigint,jsonb,text,uuid)') as f_aceptar,
         to_regprocedure('public.registrar_firma_aliado(bigint,text,text,text,integer,uuid)') as f_firma,
         to_regclass('public.aliados') as aliados, to_regprocedure('public.fn_auditoria()') as auditoria,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from storage.buckets where id = 'aliado-firmas')::int as bucket
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las tablas aliado_firmas y cuenta_cobro_aceptaciones aún NO existen' as control, concat_ws(' / ', coalesce(firmas::text, 'no existe'), coalesce(aceptaciones::text, 'no existe')) as observado, 'no existe / no existe antes de la 318' as esperado, case when firmas is null and aceptaciones is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Las funciones aceptar_cuenta_cobro y registrar_firma_aliado aún NO existen', concat_ws(' / ', coalesce(f_aceptar::text, 'no existe'), coalesce(f_firma::text, 'no existe')), 'no existe / no existe', case when f_aceptar is null and f_firma is null then 'OK' else 'REVISAR' end from t
  union all select 3, 'El bucket aliado-firmas aún NO existe (si ya existe, vacío, de una aplicación anterior: la 318 lo reutiliza)', bucket::text, '0', case when bucket = 0 then 'OK' else 'INFO' end from t
  union all select 4, 'Existen public.aliados y public.fn_auditoria() (requisitos de la 318)', concat_ws(' / ', coalesce(aliados::text, 'falta'), coalesce(auditoria::text, 'falta')), 'aliados / fn_auditoria()', case when aliados is not null and auditoria is not null then 'OK' else 'REVISAR' end from t
  union all select 5, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
) r order by orden;
