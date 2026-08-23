-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 157 (editor operativo de vuelos del contrato)
--
-- Puramente aditiva → revertirla es borrar TODO lo que agregó y restaurar
-- `ventas_vuelo_sistema` EXACTA a como la dejó la migración 156 (sin
-- `aerolinea` coalesced, sin `estado_emision`/`estado_pago`/conteos de CxP
-- aéreas). No hay ningún dato que "devolver": `contrato_vuelo_control` /
-- `contrato_vuelo_control_cambios` son tablas NUEVAS de esta migración — si
-- ya se usó el editor en producción y se cargaron estados de emisión
-- reales, este rollback los PIERDE (no hay a dónde migrarlos: no existían
-- antes de la 157). Revisa antes de correrlo:
--
--   select count(*) from public.contrato_vuelo_control where estado_emision is not null;
--
-- `contrato_vuelos`/`cuentas_por_pagar`/`cxp_pagos`/`retenciones_cxp` (datos
-- REALES, de otras migraciones) NUNCA se tocan aquí — este rollback solo
-- quita el ACCESO nuevo (funciones/vista) a esos datos, no los datos en sí.
--
-- Orden de DROP (dependencias): la vista `ventas_vuelo_sistema` depende de
-- `contrato_vuelo_control` y de `acceso_editar_vuelos_contrato()` — se
-- restaura PRIMERO a su forma de la 156 (sin esas columnas), lo que libera
-- la dependencia. Los dos RPC y la vista `contrato_vuelos_editor` dependen
-- de `acceso_editar_vuelos_contrato()` — se sueltan antes que ella.
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`). Se
-- pega en el editor SQL de Supabase. Es idempotente (`drop ... if exists`).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) `ventas_vuelo_sistema` restaurada EXACTA a la forma de la migración 156
--    (20 columnas: sin aerolinea-coalesced, sin estado_emision/estado_pago/
--    conteos de CxP aéreas). Esto suelta la dependencia sobre
--    contrato_vuelo_control y acceso_editar_vuelos_contrato().
--    ⚠️ `DROP` + `CREATE` (no `CREATE OR REPLACE`): Postgres rechaza un
--    `CREATE OR REPLACE VIEW` que quite columnas ("cannot drop columns from
--    view") — la versión de la 157 tiene 24, esta tiene 20.
drop view public.ventas_vuelo_sistema;
create view public.ventas_vuelo_sistema as
  select
    v.numero_contrato, v.tenant, v.tipo_paquete, v.aerolinea,
    v.fecha_salida, v.fecha_regreso, v.empaquetado_ref_id,
    case when v.empaquetado_ref_id is not null then 'empaquetado' else 'dinamico' end as origen,
    coalesce(ida.record, reg.record) as record,
    ida.origen_codigo, ida.destino_codigo,
    case
      when ida.origen_codigo is not null and ida.destino_codigo is not null then
        ida.origen_codigo || ' - ' || ida.destino_codigo
        || case when reg.destino_codigo is not null then ' - ' || reg.destino_codigo else '' end
      else null
    end as ruta,
    ida.numero_vuelo as vuelo_ida,
    reg.numero_vuelo as vuelo_regreso,
    ida.hora_salida as hora_salida_ida,
    ida.hora_llegada as hora_llegada_ida,
    reg.hora_salida as hora_salida_reg,
    reg.hora_llegada as hora_llegada_reg,
    ida.fecha_salida as vuelo_fecha_ida,
    reg.fecha_salida as vuelo_fecha_regreso
  from public.ventas v
  left join lateral (
    select cv.record, cv.origen_codigo, cv.destino_codigo, cv.numero_vuelo,
           cv.hora_salida, cv.hora_llegada, cv.fecha_salida
      from public.contrato_vuelos cv
     where cv.numero_contrato = v.numero_contrato and cv.direccion = 'ida'
     order by cv.orden asc, cv.id asc
     limit 1
  ) ida on true
  left join lateral (
    select cv.record, cv.numero_vuelo, cv.destino_codigo,
           cv.hora_salida, cv.hora_llegada, cv.fecha_salida
      from public.contrato_vuelos cv
     where cv.numero_contrato = v.numero_contrato and cv.direccion = 'regreso'
     order by cv.orden asc, cv.id asc
     limit 1
  ) reg on true
  where (v.tipo_paquete = 'dinamico' or v.empaquetado_ref_id is not null)
    and public.acceso_ventas_vuelo_sistema(v.tenant);

grant select on public.ventas_vuelo_sistema to authenticated;

-- 2) RPC de reemplazo de tramos y vista del editor.
drop function if exists public.guardar_tramos_contrato(text, jsonb);
drop view if exists public.contrato_vuelos_editor;

-- 3) RPC y tablas de estado de emisión (policies se van con el DROP TABLE).
drop function if exists public.actualizar_estado_emision_contrato(text, text, text);
drop table if exists public.contrato_vuelo_control_cambios;
drop table if exists public.contrato_vuelo_control;

-- 4) Helper de autorización — último, nada más depende de él ya.
drop function if exists public.acceso_editar_vuelos_contrato(text);

commit;
