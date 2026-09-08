-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 169 · Descripción manual del paquete (armado_paquetes) — SOLO
-- LECTURA. Corre esto en local ANTES de aplicar la migración 169.
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_169_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.preflight_169_reporte;

-- 1) No aplicada todavía (ninguna de las 4 columnas debe existir aún).
insert into pg_temp.preflight_169_reporte
select '169-no-aplicada', c.nombre,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = c.nombre
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = c.nombre
  ) then 'YA existe — la 169 parece aplicada; revisar antes de reintentar (es idempotente, pero revisar primero).'
    else 'No existe todavía' end
from (values ('programa_incluye'), ('programa_no_incluye'), ('programa_tarifas_especiales'), ('programa_condiciones_comerciales')) as c(nombre);

-- 2) Dependencia: la tabla armado_paquetes debe existir (la 169 solo le agrega columnas).
insert into pg_temp.preflight_169_reporte
select '169-dependencias', 'armado_paquetes',
  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'armado_paquetes')
    then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'armado_paquetes')
    then 'Presente' else 'FALTA' end;

select seccion, nombre, estado, detalle from pg_temp.preflight_169_reporte order by seccion, nombre;

select
  count(*) filter (where estado like 'BLOCKED%') as bloqueados,
  count(*) as total
from pg_temp.preflight_169_reporte;
