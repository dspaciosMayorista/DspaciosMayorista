-- ───────────────────────────────────────────────────────────────────────────
-- 112 · FUSIONAR DESTINO — mover todo lo de un destino a otro y eliminarlo
--
--  Para limpiar destinos duplicados (ej. "san andres" vs "san andrés") desde la
--  UI: al eliminar un destino que tiene hoteles, el sistema pregunta a qué
--  destino pasarlos. Esta función RE-APUNTA dinámicamente TODA columna con FK a
--  destinos(id) (hoteles, servicios, paquetes, armado, tarifario, etc. — incluso
--  tablas futuras) del origen al destino, y luego borra el origen.
--
--  SECURITY DEFINER (salta RLS para poder reasignar en todas las tablas), pero
--  exige rol interno con permiso de catálogo.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.fn_fusionar_destino(p_origen bigint, p_destino bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
begin
  if public.mi_rol() not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'No autorizado para fusionar destinos.';
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

  delete from public.destinos where id = p_origen;
end;
$$;

grant execute on function public.fn_fusionar_destino(bigint, bigint) to authenticated;
