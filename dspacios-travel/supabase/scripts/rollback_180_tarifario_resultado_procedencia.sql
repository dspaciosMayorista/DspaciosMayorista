-- Rollback 180 — revierte 20260601000180_tarifario_resultado_procedencia.sql
-- ⚠️ Si el código nuevo (VistaBooking/detalle-actions, que ya no recalculan
-- desde fecha_ida) sigue desplegado cuando se corre este rollback, la
-- identidad Base/Promoción/mixta deja de mostrarse en el detalle público
-- (las columnas ya no existen) — no rompe la página (los campos quedan
-- `undefined`), pero pierde la funcionalidad hasta que se revierta también
-- el código. Ningún precio se ve afectado (estas columnas son solo metadata
-- de presentación, nunca participan del cálculo monetario).

begin;

alter table public.tarifario_resultado
  drop constraint if exists tarifario_resultado_procedencia_estado_check,
  drop constraint if exists tarifario_resultado_procedencia_no_vacia_check,
  drop constraint if exists tarifario_resultado_procedencia_elementos_validos_check,
  drop constraint if exists tarifario_resultado_procedencia_es_arreglo_check;

-- Las funciones helper solo las usan estos CHECK — se eliminan DESPUÉS de
-- soltar los constraints que las referencian (si no, `drop function` falla
-- por dependencia).
drop function if exists public._tarifario_resultado_procedencia_valida(text, boolean, boolean, jsonb, boolean);
drop function if exists public._procedencia_temporadas_elementos_validos(jsonb);

alter table public.tarifario_resultado
  drop column if exists procedencia_mixta,
  drop column if exists procedencia_temporadas,
  drop column if exists precio_final_autoritativo,
  drop column if exists es_promocion,
  drop column if exists temporada_ganadora;

commit;
