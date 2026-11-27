-- Migration 334 (#29): alternative air destinations take part in destination merge/delete integrity.
--
-- Why: `armado_paquete_destinos_aereos.destino_id` (migration 220) has NO foreign key to `destinos` (deliberate, see 220).
-- Consequences found while reconciling #29:
--   A. `fn_fusionar_destino` (latest: 275) only re-points FK columns, so merging X into Y left rows (P, X) pointing at a
--      deleted id, while `bloqueos_vuelo`/`empaquetados` of X WERE re-pointed to Y: the linked flights silently stopped being eligible.
--   B. Deleting X directly (no merge) when it was only an alternative: the usage counter saw 0 rows, so the UI offered a plain
--      DELETE, which succeeded and left an orphan id.
--
-- What this migration does (additive, no historical rewrite):
--   1. `fn_fusionar_destino`: EXACT copy of the 275 body plus ONE block before the final DELETE that moves the alternatives:
--        · a row (P, origin) is dropped only when it is redundant (P's commercial destination is already the target, or (P, target) already exists);
--        · every other (P, origin) is re-pointed to (P, target);
--        · a row (P, target) that became the commercial destination of P through the FK re-pointing is dropped (an alternative can
--          never equal the commercial destination).
--      A country mismatch is NOT guessed away: the deferred validator of 220 (`validar_config_destinos_aereos_67`) still runs at
--      commit and aborts the whole merge with `destino_aereo_config`, exactly like any other invalid configuration.
--   2. BEFORE DELETE guard on `destinos` (same pattern as `tg_din_destino_extra_guard`, 275): a destination that is still an
--      alternative of some package cannot be deleted directly (23503). The merge removes those rows first, so it is unaffected.
--   Sales are untouched: no sale stores these ids (packages are referenced by `paquete_id`).
--
-- Existing orphan ids (if any) are NOT cleaned here; the combined preflight lists them for a manual decision.
-- Rollback: supabase/scripts/rollback_334_335_vuelos_destinos.sql

begin;

create or replace function public.tg_destino_alternativa_aerea_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.armado_paquete_destinos_aereos a where a.destino_id = old.id) then
    raise exception 'DESTINO_AEREO_ALTERNATIVO_EN_USO: el destino % es destino aéreo alternativo de un paquete; fusiónalo en otro destino en lugar de borrarlo.', old.id using errcode = '23503';
  end if;
  return old;
end $$;
revoke all on function public.tg_destino_alternativa_aerea_guard() from public, anon, authenticated;

drop trigger if exists trg_destino_alternativa_aerea_guard on public.destinos;
create trigger trg_destino_alternativa_aerea_guard before delete on public.destinos
  for each row execute function public.tg_destino_alternativa_aerea_guard();

CREATE OR REPLACE FUNCTION public.fn_fusionar_destino(p_origen bigint, p_destino bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fk record;
begin
  if public.mi_rol() not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'No autorizado para fusionar destinos.';
  end if;
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;
  if p_origen = p_destino then
    raise exception 'El origen y el destino no pueden ser el mismo.';
  end if;
  if not exists (select 1 from public.destinos where id = p_destino) then
    raise exception 'El destino de llegada no existe.';
  end if;
  if not exists (select 1 from public.destinos where id = p_origen) then
    return; -- ya no existe, nada que fusionar
  end if;

  -- Re-apunta cada columna con FK a destinos(id), del origen al destino.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.destinos'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
      using p_destino, p_origen;
  end loop;

  -- 275 (#82): `paquete_din.destinos_extra` es un arreglo sin FK; se reapunta aparte.
  update public.paquete_din p
     set destinos_extra = coalesce((
           select array_agg(x order by n)
             from (select x, min(n) as n from unnest(array_replace(p.destinos_extra, p_origen, p_destino)) with ordinality as t(x, n)
                    where x is distinct from p.destino_id group by x) s), '{}'::bigint[])
   where p_origen = any (p.destinos_extra);

  -- 334 (#29): destinos aéreos alternativos (tabla sin FK). Ya se re-apuntó `armado_paquetes.destino_id` arriba.
  -- 1) Redundantes: el destino comercial del paquete ya es el de llegada (una alternativa nunca iguala al comercial) o (P, destino) ya existe.
  delete from public.armado_paquete_destinos_aereos a
   where a.destino_id in (p_origen, p_destino)
     and exists (select 1 from public.armado_paquetes p where p.id = a.paquete_id and p.destino_id = p_destino);
  delete from public.armado_paquete_destinos_aereos a
   where a.destino_id = p_origen
     and exists (select 1 from public.armado_paquete_destinos_aereos b where b.paquete_id = a.paquete_id and b.destino_id = p_destino);
  -- 2) El resto pasa del origen al destino de llegada.
  update public.armado_paquete_destinos_aereos set destino_id = p_destino where destino_id = p_origen;

  delete from public.destinos where id = p_origen;
end;
$function$;

notify pgrst, 'reload schema';
commit;
