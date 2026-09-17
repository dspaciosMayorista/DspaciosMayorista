-- Rollback 181 — revierte la migración
-- 20260601000181_tarifario_snapshots_atomicos.sql por completo.
--
-- ⚠️ Si para cuando se corre este rollback el código ya fue adaptado a usar
-- `iniciar_generacion_tarifario`/`publicar_tarifario_resultado`/
-- `marcar_generacion_fallida` (Fase 1 de TypeScript), "Generar tarifario"
-- empieza a fallar con "function does not exist" hasta que el código también
-- se revierta al `delete`+`insert` directo — mismo criterio de orden que el
-- resto de migraciones de esta serie (SQL y código se revierten juntos).
--
-- ⚠️ Este rollback DESCARTA cualquier dato acumulado en las 8 columnas nuevas
-- (revisión, generación, estado, error, publicable) — es la corrección
-- completa de la migración 181, no una migración hacia adelante que deba
-- preservar columnas legacy. Ninguna fila de `tarifario_resultado` ni de
-- ninguna tabla fuente se toca (los triggers solo escriben en
-- `armado_paquetes`).

begin;

-- ── RPC públicos ─────────────────────────────────────────────────────────
drop function if exists public.marcar_generacion_fallida(bigint, bigint, bigint, text);
drop function if exists public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb);
drop function if exists public.iniciar_generacion_tarifario(bigint);

-- ── Triggers (antes que sus funciones) ──────────────────────────────────
drop trigger if exists tarifario_trg_destinos_nombre on public.destinos;
drop trigger if exists tarifario_trg_hoteles_moneda_modelo on public.hoteles;
drop trigger if exists tarifario_trg_armado_paquetes on public.armado_paquetes;
drop trigger if exists tarifario_trg_salidas_dinamicas on public.salidas_dinamicas;
drop trigger if exists tarifario_trg_empaquetados on public.empaquetados;
drop trigger if exists tarifario_trg_bloqueos_vuelo on public.bloqueos_vuelo;
drop trigger if exists tarifario_trg_armado_empaquetados on public.armado_empaquetados;
drop trigger if exists tarifario_trg_armado_servicios on public.armado_servicios;
drop trigger if exists tarifario_trg_armado_vuelos on public.armado_vuelos;
drop trigger if exists tarifario_trg_armado_hoteles on public.armado_hoteles;
drop trigger if exists tarifario_trg_servicios_adicionales on public.servicios_adicionales;
drop trigger if exists tarifario_trg_servicio_temporadas on public.servicio_temporadas;
drop trigger if exists tarifario_trg_servicio_tarifa_pax on public.servicio_tarifa_pax;
drop trigger if exists tarifario_trg_hotel_temporadas on public.hotel_temporadas;
drop trigger if exists tarifario_trg_tarifa_hotel on public.tarifa_hotel;

-- ── Funciones de trigger ─────────────────────────────────────────────────
drop function if exists public.tarifario_trg_bump_destino_nombre();
drop function if exists public.tarifario_trg_bump_hotel_moneda_modelo();
drop function if exists public.tarifario_trg_bump_armado_paquetes();
drop function if exists public.tarifario_trg_bump_salida_dinamica();
drop function if exists public.tarifario_trg_bump_por_empaquetado();
drop function if exists public.tarifario_trg_bump_por_bloqueo();
drop function if exists public.tarifario_trg_bump_armado_directo();
drop function if exists public.tarifario_trg_bump_servicio_catalogo();
drop function if exists public.tarifario_trg_bump_por_servicio();
drop function if exists public.tarifario_trg_bump_por_hotel();

-- ── Helper compartido ────────────────────────────────────────────────────
drop function if exists public.tarifario_invalidar(bigint[], boolean);

-- ── Constraint + índice + columnas ───────────────────────────────────────
drop index if exists public.idx_armado_paquetes_tarifario_estado;

alter table public.armado_paquetes
  drop constraint if exists armado_paquetes_tarifario_estado_check;

alter table public.armado_paquetes
  drop column if exists tarifario_snapshot_publicable,
  drop column if exists tarifario_actualizado_en,
  drop column if exists tarifario_error,
  drop column if exists tarifario_estado,
  drop column if exists tarifario_generacion_publicada,
  drop column if exists tarifario_generacion,
  drop column if exists tarifario_revision_publicada,
  drop column if exists tarifario_revision_fuente;

commit;
