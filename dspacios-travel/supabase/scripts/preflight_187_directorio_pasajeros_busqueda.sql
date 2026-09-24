-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 187 · búsqueda de pasajero por documento + nombres/apellidos
-- estructurados (SOLO LECTURA — no modifica nada)
--
-- ⚠️ `contrato_pasajeros.nacionalidad` NO es de esta migración (existe desde
-- la 022) — a propósito NO se usa como señal de "187 aplicada o no". La
-- primera versión de este preflight sí la usaba y por eso siempre reportaba
-- BLOCKED en cualquier base con la 022 aplicada (o sea, todas). Corregido:
-- las únicas señales de "187 aplicada" son la función de búsqueda y las
-- columnas nombres/apellidos (que sí nacen aquí).
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_187_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.preflight_187_reporte;

-- 1) No aplicada todavía.
insert into pg_temp.preflight_187_reporte
select '187-no-aplicada', 'contrato_pasajeros.nombres/apellidos',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name in ('nombres', 'apellidos')
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name in ('nombres', 'apellidos')
  ) then 'Alguna de las dos YA existe — la 187 parece aplicada; revisar antes de reintentar.'
    else 'No existen todavía' end;

insert into pg_temp.preflight_187_reporte
select '187-no-aplicada', 'buscar_pasajero_por_documento',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'buscar_pasajero_por_documento'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'buscar_pasajero_por_documento'
  ) then 'YA existe — la 187 parece aplicada; revisar antes de reintentar.'
    else 'No existe todavía' end;

-- 2) Dependencias que la 187 asume ya aplicadas (migraciones 022/141/142/144/147/167).
insert into pg_temp.preflight_187_reporte
select '187-dependencias', f.nombre,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'OK' else 'BLOCKED' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'Existe' else 'FALTA — aplicar las migraciones previas antes de la 187.' end
from (values ('mi_rol'), ('puede_ver_contrato'), ('puede_ver_tenant'), ('soy_asesor_del_contrato')) as f(nombre);

insert into pg_temp.preflight_187_reporte
select '187-dependencias', 'contrato_pasajeros.tipo_id/identificacion/nacionalidad',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros'
      and column_name in ('tipo_id', 'identificacion', 'numero_contrato', 'orden', 'nacionalidad')
  ) = 5 then 'OK' else 'BLOCKED' end,
  'Columnas base de contrato_pasajeros requeridas (nacionalidad viene de la 022, no de la 187).';

-- 3) No debe existir ya un índice con el mismo nombre por otra vía (no debería
-- colisionar; solo informativo).
insert into pg_temp.preflight_187_reporte
select '187-informativo', 'idx_contrato_pasajeros_documento',
  case when exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_contrato_pasajeros_documento'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_contrato_pasajeros_documento'
  ) then 'YA existe — revisar antes de reintentar.' else 'No existe todavía' end;

select * from pg_temp.preflight_187_reporte order by seccion, nombre;

select
  case when exists (select 1 from pg_temp.preflight_187_reporte where estado = 'BLOCKED')
    then '❌ BLOCKED — no aplicar la 187 todavía, ver filas BLOCKED arriba.'
    else '✅ OK — la 187 puede aplicarse.'
  end as resultado_preflight_187;
