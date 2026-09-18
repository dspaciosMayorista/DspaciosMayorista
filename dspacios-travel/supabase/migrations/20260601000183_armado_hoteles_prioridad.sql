-- ───────────────────────────────────────────────────────────────────────────
-- 183 · HOTELES RECOMENDADOS POR PAQUETE (armado_hoteles.prioridad)
--
-- La recomendación pertenece a la relación hotel↔paquete (`armado_hoteles`),
-- nunca al hotel físico global (`hoteles`): el mismo hotel puede ser
-- recomendado en un paquete y no en otro, y el mismo `hotel_id` puede
-- aparecer varias veces en la vitrina si pertenece a paquetes distintos
-- (ej. tarifa normal vs. paquete 3x2) — cada fila de `armado_hoteles` es una
-- OFERTA independiente, con su propio `paquete_id`.
--
-- `prioridad smallint null` — un solo campo, sin booleano redundante:
--   · NULL  = no recomendado (default, sin cambios para las filas existentes);
--   · 1..6  = recomendado, con esa prioridad manual DENTRO de su paquete.
--
-- CHECK: `prioridad is null or prioridad between 1 and 6` — rechaza 0, 7+, y
-- negativos a nivel de base, no solo en el formulario.
--
-- Unicidad PARCIAL por paquete: `unique (paquete_id, prioridad) where
-- prioridad is not null` — dos hoteles del MISMO paquete nunca pueden
-- compartir prioridad (el índice lo impide aunque dos requests concurrentes
-- intenten guardar la misma prioridad a la vez — la garantía vive en la base,
-- no solo en la validación de React/Server Action). La MISMA prioridad SÍ
-- puede repetirse en paquetes distintos (la unicidad es por `paquete_id`,
-- nunca global) — eso es business as usual, no una excepción del índice.
--
-- Desmarcar (prioridad → NULL) y cambiar de prioridad (prioridad → otro
-- valor) son, los dos, un UPDATE de la MISMA fila de `armado_hoteles`: no
-- existe una tabla aparte de "cupos" con residuos que limpiar — al cambiar el
-- valor de la columna, el cupo anterior queda libre automáticamente (ya no
-- hay ninguna fila con esa combinación paquete_id+prioridad). Eliminar la
-- asociación hotel↔paquete (`delete from armado_hoteles`) elimina la
-- recomendación con ella, por ser la misma fila — no hay tabla dependiente
-- que limpiar aparte.
--
-- Migración ADITIVA e idempotente (`add column if not exists`, guardas
-- `if not exists` para el CHECK, `create index if not exists`) — se puede
-- re-correr sin duplicar. Sin backfill: todas las filas existentes de
-- `armado_hoteles` quedan con `prioridad = null` (ningún hotel queda
-- recomendado "por accidente" al aplicar la migración).
--
-- Preflight / postcheck / rollback / test: ver
-- supabase/scripts/{preflight,postcheck,rollback,test}_183_armado_hoteles_prioridad.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.armado_hoteles
  add column if not exists prioridad smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'armado_hoteles_prioridad_rango_check'
      and conrelid = 'public.armado_hoteles'::regclass
  ) then
    alter table public.armado_hoteles add constraint armado_hoteles_prioridad_rango_check
      check (prioridad is null or (prioridad between 1 and 6));
  end if;
end $$;

-- Unicidad parcial: una prioridad no puede repetirse DENTRO del mismo
-- paquete; sí puede repetirse entre paquetes distintos (no está en el índice).
create unique index if not exists armado_hoteles_paquete_prioridad_unica
  on public.armado_hoteles (paquete_id, prioridad)
  where prioridad is not null;

comment on column public.armado_hoteles.prioridad is
  'Prioridad de "hotel recomendado" DENTRO de este paquete (1=más alta .. 6=más baja). NULL = no recomendado. Único por paquete_id (parcial, where prioridad is not null) — la misma prioridad puede repetirse en paquetes distintos. La recomendación es de la OFERTA hotel+paquete, nunca del hotel físico global.';

commit;
