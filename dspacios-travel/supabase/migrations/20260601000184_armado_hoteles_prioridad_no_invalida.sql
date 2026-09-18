-- ───────────────────────────────────────────────────────────────────────────
-- 184 · armado_hoteles.prioridad NO invalida el snapshot del tarifario
--
-- Defecto P1 (confirmado en Preview): la 181 creó UN trigger genérico
-- (`tarifario_trg_armado_hoteles` → `tarifario_trg_bump_armado_directo()`) para
-- las cuatro tablas de "armado", con la regla "cualquier operación invalida".
-- Esa regla es correcta para `paquete_id`/`hotel_id`/`categorias`/`regimenes`
-- (cambian el paquete completo), pero `armado_hoteles` ganó DESPUÉS (183) una
-- columna de PRESENTACIÓN — `prioridad` ("hotel recomendado") — que no
-- participa del snapshot publicado. Consecuencia real: guardar una prioridad
-- disparaba el UPDATE genérico → `tarifario_invalidar(..., true)` →
-- `tarifario_revision_fuente + 1`, `tarifario_estado = 'pendiente'` y
-- `tarifario_snapshot_publicable = false`; el paquete desaparecía de Vista
-- Booking por el solo hecho de marcar un hotel como recomendado.
--
-- Arquitectura de la corrección: `armado_hoteles` pasa a tener su PROPIA
-- función de trigger (`tarifario_trg_bump_armado_hoteles()`), con la MISMA
-- forma que las demás (SECURITY DEFINER, `search_path` fijo, revoke total):
--   · INSERT y DELETE → invalidan como siempre (agregar o quitar un hotel del
--     paquete cambia el paquete completo).
--   · UPDATE cuyo ÚNICO cambio real es `prioridad` → NO hace nada: ni revisión,
--     ni estado, ni `tarifario_snapshot_publicable`.
--   · UPDATE que cambia `prioridad` JUNTO CON cualquier otro campo real, o que
--     cambia cualquier otro campo → invalida como siempre.
--
-- La comparación es `to_jsonb(NEW) - 'prioridad'` vs `to_jsonb(OLD) -
-- 'prioridad'`: compara TODAS las columnas menos esa, así que una columna
-- nueva en el futuro queda cubierta sola. Enumerar los campos "reales" a mano
-- sería frágil — una columna nueva se colaría sin invalidar.
--
-- ⚠️ Las otras tres tablas de armado (`armado_vuelos`, `armado_servicios`,
-- `armado_empaquetados`) NO se tocan: conservan el trigger genérico y su
-- comportamiento de siempre. Tampoco se modifica
-- `tarifario_trg_bump_armado_directo()` (la siguen usando esas tres).
--
-- ⚠️ No rehabilita snapshots ya bloqueados: un guardado de prioridad no toca
-- ninguna columna del paquete. Los paquetes que el comportamiento viejo dejó
-- con `tarifario_snapshot_publicable = false` se recuperan PUBLICANDO de nuevo
-- (publicación exitosa), nunca por esta migración.
--
-- Migración ADITIVA e IDEMPOTENTE (`create or replace` + `drop trigger if
-- exists`) — se puede re-correr sin duplicar nada y sin reescribir datos.
--
-- Preflight / postcheck / rollback / test propios:
-- supabase/scripts/{preflight,postcheck,rollback,test}_184_armado_hoteles_prioridad_no_invalida.sql
-- Rollback: restaura el trigger EXACTAMENTE como lo dejó la 181 (misma función
-- genérica, mismas columnas de evento) y elimina la función nueva.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- Guarda: la columna `prioridad` la aporta la 183. Sin ella esta migración no
-- tendría sentido (el trigger nuevo no tendría nada que excluir) — se aborta
-- explícitamente en vez de dejar una función que compare contra una clave
-- inexistente.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'armado_hoteles' and column_name = 'prioridad'
  ) then
    raise exception 'ABORTADO: falta public.armado_hoteles.prioridad (migración 183). Aplica la 183 antes de la 184.';
  end if;
end $$;

create or replace function public.tarifario_trg_bump_armado_hoteles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  -- UPDATE cuyo ÚNICO cambio real es `prioridad` (columna de presentación,
  -- fuera del snapshot): no invalida nada. Se comparan TODAS las columnas
  -- menos `prioridad`, así que cualquier otro cambio —solo o acompañando a la
  -- prioridad— sigue cayendo al camino que invalida.
  if TG_OP = 'UPDATE'
    and (to_jsonb(NEW) - 'prioridad') = (to_jsonb(OLD) - 'prioridad')
  then
    return NEW;
  end if;

  v_ids := array_remove(array[OLD.paquete_id, NEW.paquete_id], null);
  perform public.tarifario_invalidar(v_ids, true);
  return coalesce(NEW, OLD);
end;
$$;

comment on function public.tarifario_trg_bump_armado_hoteles() is
  'Trigger propio de armado_hoteles (migración 184). INSERT/DELETE y cualquier UPDATE que cambie algo distinto de prioridad invalidan el snapshot del tarifario (tarifario_invalidar(..., true)). Un UPDATE cuyo único cambio real es prioridad NO invalida: prioridad es una columna de PRESENTACIÓN (hotel recomendado, migración 183) que no forma parte del snapshot. Las otras tres tablas de armado siguen usando tarifario_trg_bump_armado_directo().';

revoke all on function public.tarifario_trg_bump_armado_hoteles() from public, anon, authenticated;

-- Se re-apunta SOLO el trigger de armado_hoteles. Las columnas de evento son
-- las mismas de la 181 (insert/update/delete); el filtro de "solo prioridad"
-- vive DENTRO de la función (un trigger `update of ...` no podría distinguir
-- "prioridad cambió junto con otro campo").
drop trigger if exists tarifario_trg_armado_hoteles on public.armado_hoteles;
create trigger tarifario_trg_armado_hoteles
  after insert or update or delete on public.armado_hoteles
  for each row execute function public.tarifario_trg_bump_armado_hoteles();

commit;
