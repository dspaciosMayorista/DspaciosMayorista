-- ─────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 188 (crm_pasajeros_contrato_lectura) — SOLO LECTURA
-- ⚠️ Ver la nota de numeración en la cabecera de la migración: esta
-- migración se renumeró de 187 a 188 porque la migración 187 real
-- ("búsqueda de pasajero por documento", otra rama) ya se aplicó en
-- staging. Correr DESPUÉS de esa 187, nunca antes.
-- ─────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_188_crm_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.preflight_188_crm_reporte;

insert into pg_temp.preflight_188_crm_reporte
select '188crm-no-aplicada', 'crm_pasajeros_contrato_buscar',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_pasajeros_contrato_buscar'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_pasajeros_contrato_buscar'
  ) then 'YA existe — revisar antes de reintentar (¿ya se aplicó, o colisión con la 187 real, otra rama?).'
    else 'No existe todavía' end;

insert into pg_temp.preflight_188_crm_reporte
select '188crm-dependencias', f.nombre,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'OK' else 'BLOCKED' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
  ) then 'Existe' else 'FALTA — aplicar las migraciones previas antes de esta.' end
from (values ('mi_rol'), ('puede_ver_contrato'), ('puede_ver_tenant'), ('soy_asesor_del_contrato')) as f(nombre);

insert into pg_temp.preflight_188_crm_reporte
select '188crm-dependencias', 'contrato_pasajeros.columnas base',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_pasajeros'
      and column_name in ('id','numero_contrato','nombre','tipo_id','identificacion','fecha_nacimiento')
  ) = 6 then 'OK' else 'BLOCKED' end,
  'Columnas base de contrato_pasajeros requeridas por la función.';

select * from pg_temp.preflight_188_crm_reporte order by seccion, nombre;

select
  case when exists (select 1 from pg_temp.preflight_188_crm_reporte where estado = 'BLOCKED')
    then '❌ BLOCKED — no aplicar todavía, ver filas BLOCKED arriba.'
    else '✅ OK — puede aplicarse.'
  end as resultado_preflight_188_crm;
