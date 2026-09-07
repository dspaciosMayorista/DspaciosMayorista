-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 168 · guardar_infante_vuelo (RPC estrecho, alta/edición de UN
-- infante directamente desde el detalle de un vuelo) — SOLO LECTURA.
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_168_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.preflight_168_reporte;

-- 1) No aplicada todavía.
insert into pg_temp.preflight_168_reporte
select '168-no-aplicada', 'guardar_infante_vuelo',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_infante_vuelo'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_infante_vuelo'
  ) then 'YA existe — la 168 parece aplicada; revisar antes de reintentar (create or replace es seguro re-aplicar, pero revisar primero).'
    else 'No existe todavía' end;

-- 2) Dependencias que la 168 necesita ya existentes — NO se modifican, solo se reutilizan.
insert into pg_temp.preflight_168_reporte
select '168-dependencias', t.nombre,
  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.nombre)
    then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.nombre)
    then 'Presente' else 'FALTA' end
from (values ('contrato_pasajeros'), ('sillas'), ('ventas'), ('bloqueos_vuelo')) as t(nombre);

insert into pg_temp.preflight_168_reporte
select '168-dependencias', f.nombre,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nombre) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nombre) then 'Presente' else 'FALTA' end
from (values ('mi_rol'), ('edad_anios'), ('es_infante_por_edad'), ('_autorizado_escribir_pasajeros')) as f(nombre);

insert into pg_temp.preflight_168_reporte
select '168-dependencias', 'contrato_pasajeros.responsable_id',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros' and column_name = 'responsable_id'
  ) then 'OK' else 'BLOCKED' end,
  'Columna agregada por la migración 167 — guardar_infante_vuelo la usa pero NO la crea ni la altera.';

insert into pg_temp.preflight_168_reporte
select '168-dependencias', 'trg_validar_responsable_infante (migración 167)',
  case when exists (
    select 1 from pg_trigger where tgname = 'trg_validar_responsable_infante'
      and tgrelid = 'public.contrato_pasajeros'::regclass
  ) then 'OK' else 'BLOCKED' end,
  'Es la AUTORIDAD final sobre es_infante/responsable — la 168 no la reemplaza ni la desactiva.';

insert into pg_temp.preflight_168_reporte
select '168-dependencias', 'sillas.contrato_manual',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sillas' and column_name = 'contrato_manual'
  ) then 'OK' else 'BLOCKED' end,
  'Columna de la migración 085 — necesaria para resolver el caso MIN-00-0541 (referencia externa a una venta interna).';

insert into pg_temp.preflight_168_reporte
select '168-dependencias', 'ventas_numero_contrato_formato_por_tenant',
  case when exists (
    select 1 from pg_constraint where conname = 'ventas_numero_contrato_formato_por_tenant'
  ) then 'OK (informativo)' else 'AUSENTE (informativo)' end,
  'Migración 160 — si está presente, numero_contrato de mayorista usa formato DTM-NNNN, no 00-NNNN; solo afecta fixtures de prueba, no la lógica de la 168.';

select seccion, nombre, estado, detalle from pg_temp.preflight_168_reporte order by seccion, nombre;

select
  count(*) filter (where estado like 'BLOCKED%') as bloqueados,
  count(*) as total
from pg_temp.preflight_168_reporte;
