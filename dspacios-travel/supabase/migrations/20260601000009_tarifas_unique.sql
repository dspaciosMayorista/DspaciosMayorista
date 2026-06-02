-- Migración 009: Constraint único para el upsert de tarifas
--
-- El server action guardarTarifa() hace upsert con
--   onConflict: "hotel_id,plan_id,temporada_id,noches"
-- pero la tabla tarifas no tenía un índice único que respaldara ese ON CONFLICT,
-- por lo que Postgres rechazaba el upsert ("no unique or exclusion constraint
-- matching the ON CONFLICT specification"). Esto rompía guardar/editar tarifas.
--
-- Definimos la combinación (hotel, plan, temporada, noches) como la llave natural
-- de una tarifa: un hotel no puede tener dos tarifas para el mismo plan, temporada
-- y duración. La habitación queda fuera de la llave a propósito (el formulario
-- actual no la usa todavía).

-- Limpieza defensiva de posibles duplicados previos (deja la fila más reciente).
delete from public.tarifas t
using public.tarifas dup
where t.hotel_id = dup.hotel_id
  and t.plan_id = dup.plan_id
  and t.temporada_id = dup.temporada_id
  and t.noches = dup.noches
  and t.id < dup.id;

create unique index if not exists tarifas_hotel_plan_temporada_noches_key
  on public.tarifas (hotel_id, plan_id, temporada_id, noches);
