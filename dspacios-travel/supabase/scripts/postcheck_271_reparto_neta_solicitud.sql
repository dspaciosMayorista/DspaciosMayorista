-- POSTCHECK 271 (#120) · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · estado. Pegar COMPLETA en el editor SQL (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL: «271 CORRECTA» solo si ninguna fila es FALLA. Verifica el ESTADO FINAL: columnas, CHECK de la regla, RPC única de 15 argumentos y permisos.
with
fnn as (select to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date,text,integer,integer,integer,numeric,numeric,numeric)') as oid),
fi as (
  select p.oid, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
         (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as public_x
    from fnn join pg_proc p on p.oid = fnn.oid
),
col(nombre, tipo, nulo, defecto) as (values
  ('modo', 'text', 'NO', '''adultos''::text'), ('adultos', 'integer', 'NO', '1'), ('ninos', 'integer', 'NO', '0'), ('infantes', 'integer', 'NO', '0'),
  ('neta_adulto', 'numeric', 'NO', '0'), ('neta_nino', 'numeric', 'NO', '0'), ('neta_infante', 'numeric', 'NO', '0')),
filas as (
  select 1 as n, 'columnas del reparto con tipo, NOT NULL y valor por defecto esperados' as control,
         (select count(*) from col k join information_schema.columns i on i.table_schema = 'public' and i.table_name = 'cotizacion_tarifa_solicitud' and i.column_name = k.nombre
            where i.data_type = k.tipo and i.is_nullable = k.nulo and i.column_default = k.defecto)::text || '/7' as observado, '7/7' as esperado,
         (select count(*) from col k join information_schema.columns i on i.table_schema = 'public' and i.table_name = 'cotizacion_tarifa_solicitud' and i.column_name = k.nombre
            where i.data_type = k.tipo and i.is_nullable = k.nulo and i.column_default = k.defecto) = 7 as ok, null::text as nivel
  union all select 2, 'CHECK de la regla presentes (modo, conteos, infante $0, modo adultos, modo distribuir)',
    (select count(*) from pg_constraint where conrelid = 'public.cotizacion_tarifa_solicitud'::regclass and conname in ('cts_modo_check', 'cts_conteos_check', 'cts_infante_cero_check', 'cts_modo_adultos_check', 'cts_modo_distribuir_check'))::text || '/5', '5/5',
    (select count(*) from pg_constraint where conrelid = 'public.cotizacion_tarifa_solicitud'::regclass and conname in ('cts_modo_check', 'cts_conteos_check', 'cts_infante_cero_check', 'cts_modo_adultos_check', 'cts_modo_distribuir_check')) = 5, null
  union all select 3, 'ninguna fila incumple la regla (infante $0; adultos ⇒ niño $0; distribuir ⇒ suma = neta ± 1 centavo por persona)',
    (select count(*) from public.cotizacion_tarifa_solicitud t where t.neta_infante <> 0 or (t.modo = 'adultos' and t.neta_nino <> 0)
       or (t.modo = 'distribuir' and not (t.ninos > 0 and t.neta_adulto > 0 and t.neta_nino > 0 and abs(t.adultos * t.neta_adulto + t.ninos * t.neta_nino - t.neta) <= 0.01 * (t.adultos + t.ninos) + 0.000001)))::text, '0',
    (select count(*) from public.cotizacion_tarifa_solicitud t where t.neta_infante <> 0 or (t.modo = 'adultos' and t.neta_nino <> 0)
       or (t.modo = 'distribuir' and not (t.ninos > 0 and t.neta_adulto > 0 and t.neta_nino > 0 and abs(t.adultos * t.neta_adulto + t.ninos * t.neta_nino - t.neta) <= 0.01 * (t.adultos + t.ninos) + 0.000001))) = 0, null
  union all select 4, 'RPC de 15 argumentos presente, SECURITY DEFINER con search_path fijo',
    coalesce((select (prosecdef and cfg like '%search_path%')::text from fi), 'AUSENTE'), 'true', coalesce((select prosecdef and cfg like '%search_path%' from fi), false), null
  union all select 5, 'la RPC de 8 argumentos de la 270 ya NO existe (dos firmas permitirían saltarse el reparto)',
    (to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date)') is not null)::text, 'false', to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date)') is null, null
  union all select 6, 'permisos de la RPC: authenticated sí; anon y PUBLIC no',
    coalesce((select 'auth=' || auth_x::text || ' · anon=' || anon_x::text || ' · public=' || public_x::text from fi), 'AUSENTE'), 'auth=true · anon=false · public=false',
    coalesce((select auth_x and not anon_x and not public_x from fi), false), null
  union all select 7, 'la elección sigue PRIVADA: ni payload ni detalle de ninguna cotización traen claves del reparto',
    (select count(*) from public.cotizaciones c where c.payload::text ~ '"(netaAdulto|netaNino|reparto|neta_adulto|neta_nino)"' or coalesce(c.detalle::text, '') ~ '"(netaAdulto|netaNino|reparto|neta_adulto|neta_nino)"')::text, '0',
    (select count(*) from public.cotizaciones c where c.payload::text ~ '"(netaAdulto|netaNino|reparto|neta_adulto|neta_nino)"' or coalesce(c.detalle::text, '') ~ '"(netaAdulto|netaNino|reparto|neta_adulto|neta_nino)"') = 0, null
  union all select 8, 'la 270 sigue íntegra: anon sin permisos sobre cotizacion_tarifa_solicitud y authenticated solo lectura',
    'anon=' || (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'anon')::text
      || ' · escritura=' || (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))::text,
    'anon=0 · escritura=0',
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'anon') = 0
      and (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) = 0, null
)
select n, control, observado, esperado, case when ok then 'OK' else coalesce(nivel, 'FALLA') end as estado from filas
union all
select 99, 'VEREDICTO GLOBAL', case when count(*) filter (where not ok and nivel is null) = 0 then '271 CORRECTA' else '271 CON FALLAS' end, '271 CORRECTA',
       case when count(*) filter (where not ok and nivel is null) = 0 then 'OK' else 'FALLA' end from filas
order by n;
