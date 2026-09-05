-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 167 · vínculo INF→adulto + reconciliación de sillas (SOLO LECTURA)
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_167_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.preflight_167_reporte;

-- 1) No aplicada todavía.
insert into pg_temp.preflight_167_reporte
select '167-no-aplicada', 'contrato_pasajeros.responsable_id',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name = 'responsable_id'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name = 'responsable_id'
  ) then 'La columna YA existe — la 167 parece aplicada; revisar antes de reintentar.'
    else 'No existe todavía' end;

insert into pg_temp.preflight_167_reporte
select '167-no-aplicada', f.nombre,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'YA existe — la 167 parece aplicada; revisar antes de reintentar.'
    else 'No existe todavía' end
from (values ('ajustar_sillas_por_pasajeros'), ('guardar_pasajeros_contrato'), ('crear_pasajeros_contrato'), ('edad_anios'), ('es_infante_por_edad'), ('_ajustar_sillas_nucleo'), ('_guardar_pasajeros_nucleo'), ('_autorizado_escribir_pasajeros')) as f(nombre);

insert into pg_temp.preflight_167_reporte
select '167-no-aplicada', '_pasajeros_exentos_167',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = '_pasajeros_exentos_167'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = '_pasajeros_exentos_167'
  ) then 'YA existe — la 167 parece aplicada; revisar antes de reintentar.'
    else 'No existe todavía' end;

-- 2) Dependencias que la 167 necesita ya existentes.
insert into pg_temp.preflight_167_reporte
select '167-dependencias', t.nombre,
  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.nombre)
    then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.nombre)
    then 'Presente' else 'FALTA' end
from (values ('contrato_pasajeros'), ('sillas'), ('ventas')) as t(nombre);

insert into pg_temp.preflight_167_reporte
select '167-dependencias', f.nombre,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nombre) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nombre) then 'Presente' else 'FALTA' end
from (values ('mi_rol'), ('puede_ver_contrato'), ('soy_asesor_del_contrato')) as f(nombre);

insert into pg_temp.preflight_167_reporte
select '167-dependencias', 'ventas.bloqueo_ref_id',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ventas' and column_name = 'bloqueo_ref_id'
  ) then 'OK' else 'BLOCKED' end,
  'ajustar_sillas_por_pasajeros lee ventas.bloqueo_ref_id (migración 022) como fuente PRIMARIA del bloqueo — sin ella, no hay forma de redescubrirlo tras liberar todas las sillas de un contrato.';

insert into pg_temp.preflight_167_reporte
select '167-dependencias', 'ventas.fecha_salida',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ventas' and column_name = 'fecha_salida'
  ) then 'OK' else 'BLOCKED' end,
  'guardar_pasajeros_contrato y fn_validar_responsable_infante usan ventas.fecha_salida como referencia de edad.';

insert into pg_temp.preflight_167_reporte
select '167-dependencias', 'contrato_pasajeros.es_infante',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name = 'es_infante'
  ) then 'OK' else 'BLOCKED' end,
  'La 167 exige es_infante=true para permitir responsable_id.';

insert into pg_temp.preflight_167_reporte
select '167-dependencias', 'sillas.estado enum estado_silla',
  case when exists (
    select 1 from pg_type where typname = 'estado_silla'
  ) then 'OK' else 'BLOCKED' end,
  'ajustar_sillas_por_pasajeros compara sillas.estado contra disponible/cambio_entrante/en_plazo/confirmada.';

do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.preflight_167_reporte;
  select count(*) into v_bad from pg_temp.preflight_167_reporte where estado = 'BLOCKED';
  if v_bad = 0 then
    raise notice 'PREFLIGHT 167: %/% chequeos OK (0 BLOCKED) — la migración 167 se puede aplicar.', v_total, v_total;
  else
    raise notice 'PREFLIGHT 167: % chequeos, % BLOCKED — revisar antes de aplicar.', v_total, v_bad;
  end if;
  raise notice 'VEREDICTO PREFLIGHT 167: %', (case when v_bad = 0 then 'OK' else 'BLOQUEADO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.preflight_167_reporte order by estado desc, seccion, nombre;
