-- ROLLBACK 334 + 335 (#29 / #37). Restores `fn_fusionar_destino` to its 275 body, drops the delete guard on `destinos`, and removes the air-evidence
-- predicate from `ventas_vuelo_sistema`. Touches NO data (no sale, destination or alternative row is modified). Idempotent.
begin;

drop trigger if exists trg_destino_alternativa_aerea_guard on public.destinos;
drop function if exists public.tg_destino_alternativa_aerea_guard();

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

  delete from public.destinos where id = p_origen;
end;
$function$;

do $$
declare
  d text;
  viejo constant text := '\(v\.tipo_paquete = ''dinamico''::text\) AND \([\s\S]*?cvx\.numero_contrato = v\.numero_contrato\)\)\)\)';
begin
  d := pg_get_viewdef('public.ventas_vuelo_sistema'::regclass, false);
  if d not like '%cvx.numero_contrato%' then
    return; -- 335 no está aplicada
  end if;
  if d !~ viejo then
    raise exception 'ventas_vuelo_sistema tiene una forma inesperada; no se revierte automáticamente.';
  end if;
  execute 'create or replace view public.ventas_vuelo_sistema as ' || regexp_replace(d, viejo, '(v.tipo_paquete = ''dinamico''::text)');
end $$;

notify pgrst, 'reload schema';
commit;
