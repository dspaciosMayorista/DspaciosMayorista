-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 187 · búsqueda de pasajero por documento + nombres/apellidos
-- estructurados (SOLO LECTURA — no modifica nada)
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.postcheck_187_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.postcheck_187_reporte;

-- 1) Columnas y función existen.
insert into pg_temp.postcheck_187_reporte
select '187-existencia', 'contrato_pasajeros.' || c.column_name,
  case when exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = 'contrato_pasajeros' and ic.column_name = c.column_name
      and ic.data_type = 'text' and ic.is_nullable = 'YES'
  ) then 'OK' else 'FALLA' end,
  'Debe existir como text nullable (agregada por la 187).'
from (values ('nombres'), ('apellidos')) as c(column_name);

insert into pg_temp.postcheck_187_reporte
select '187-existencia-ajena', 'contrato_pasajeros.nacionalidad',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name = 'nacionalidad'
  ) then 'OK' else 'FALLA' end,
  'Debe existir (desde la migración 022) — la 187 la usa pero no la crea ni la borra.';

insert into pg_temp.postcheck_187_reporte
select '187-existencia', 'idx_contrato_pasajeros_documento',
  case when exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_contrato_pasajeros_documento'
  ) then 'OK' else 'FALLA' end,
  'Índice de soporte para la búsqueda exacta.';

insert into pg_temp.postcheck_187_reporte
select '187-existencia', 'buscar_pasajero_por_documento',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'buscar_pasajero_por_documento'
  ) then 'OK' else 'FALLA' end,
  'Función de búsqueda debe existir.';

-- 2) Forma de retorno: debe incluir nombres/apellidos y NUNCA id/responsable_id/es_infante.
insert into pg_temp.postcheck_187_reporte
select '187-forma-retorno', 'columnas de retorno esperadas',
  case when (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'buscar_pasajero_por_documento'
       and p.prorettype in (select oid from pg_type where typname = 'record')
  ) >= 0 then 'INFORMATIVO' end,
  'Ver el chequeo explícito de columnas con information_schema.parameters más abajo.';

insert into pg_temp.postcheck_187_reporte
select '187-forma-retorno', 'incluye nombres/apellidos/fecha_nacimiento/nacionalidad',
  case when (
    select count(*) from information_schema.parameters
     where specific_schema = 'public'
       and specific_name in (select specific_name from information_schema.routines where routine_name = 'buscar_pasajero_por_documento' and routine_schema = 'public')
       and parameter_name in ('nombres', 'apellidos', 'fecha_nacimiento', 'nacionalidad')
  ) = 4 then 'OK' else 'FALLA' end,
  'La función debe devolver estas 4 columnas.';

insert into pg_temp.postcheck_187_reporte
select '187-forma-retorno', 'NO expone id/responsable_id/es_infante',
  case when (
    select count(*) from information_schema.parameters
     where specific_schema = 'public'
       and specific_name in (select specific_name from information_schema.routines where routine_name = 'buscar_pasajero_por_documento' and routine_schema = 'public')
       and parameter_name in ('id', 'responsable_id', 'es_infante')
  ) = 0 then 'OK' else 'FALLA' end,
  'La función NUNCA debe devolver id/responsable_id/es_infante (atributos del contrato de origen).';

-- 3) Grants correctos: NI public NI anon pueden ejecutarla; authenticated sí.
insert into pg_temp.postcheck_187_reporte
select '187-grants', 'revoke de anon',
  case when has_function_privilege('anon', 'public.buscar_pasajero_por_documento(text, text)', 'execute')
    then 'FALLA' else 'OK' end,
  'anon NO debe poder ejecutar la búsqueda.';

insert into pg_temp.postcheck_187_reporte
select '187-grants', 'grant a authenticated',
  case when has_function_privilege('authenticated', 'public.buscar_pasajero_por_documento(text, text)', 'execute')
    then 'OK' else 'FALLA' end,
  'authenticated SÍ debe poder ejecutar la búsqueda (el candado real es el rol interno dentro de la función).';

-- 4) Las 5 funciones del núcleo de la 167 siguen EXISTIENDO con ese nombre
-- (esta migración no debía reemplazarlas). ⚠️ Chequeo de PRESENCIA por
-- catálogo (pg_proc/pg_namespace) — NO de comportamiento ni de firma: no
-- detecta un cambio de argumentos/cuerpo bajo el mismo nombre. No confundir
-- con "sigue intacta" — la prueba de comportamiento real de ese núcleo es
-- test_167_concurrencia.sh/test_167_atomicidad_fallo.sh, no este postcheck.
insert into pg_temp.postcheck_187_reporte
select '187-no-tocar-167', f.nombre,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'OK' else 'FALLA' end,
  'Debe seguir existiendo con este nombre (chequeo de presencia, no de firma ni comportamiento) — la 187 no la reemplaza.'
from (values ('_reemplazar_pasajeros_nucleo'), ('_guardar_pasajeros_nucleo'),
             ('guardar_pasajeros_contrato'), ('crear_pasajeros_contrato'),
             ('crear_pasajeros_contrato_multi')) as f(nombre);

-- 5) Prueba funcional real, con aislamiento por rol/agencia/contrato propio:
-- ver supabase/scripts/test_187_seguridad_rls.sql (self-contained, no
-- depende de datos preexistentes) y test_187_busqueda_pasajero.sql.

delete from pg_temp.postcheck_187_reporte where estado = 'INFORMATIVO';

select * from pg_temp.postcheck_187_reporte order by seccion, nombre;

select
  case when exists (select 1 from pg_temp.postcheck_187_reporte where estado like 'FALLA%')
    then '❌ FALLA — revisar filas FALLA arriba.'
    else '✅ OK — postcheck 187 pasó (falta correr test_187_seguridad_rls.sql y test_187_busqueda_pasajero.sql).'
  end as resultado_postcheck_187;
