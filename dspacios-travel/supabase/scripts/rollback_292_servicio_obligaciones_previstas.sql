-- ROLLBACK de la migración 292 (#75): restaura la guarda de línea EXACTA de la 265 y retira los triggers/funciones/índice de la 292. Una transacción.
-- Tras el rollback vuelve el hueco que la 292 cierra (servicio/línea borrables con previstas): solo junto con el rollback del código o de la 288.
begin;
drop trigger if exists servicio_con_previstas on public.servicios_adicionales;
drop trigger if exists prevista_valida on public.contrato_obligaciones_previstas;
drop function if exists public.tg_servicio_con_previstas();
drop function if exists public.tg_prevista_valida();
drop index if exists public.contrato_obligaciones_previstas_servicio_idx;
-- cuerpo verbatim de la 265 (§5)
create or replace function public.tg_linea_enlazada_protegida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.enlace_cxp_autorizado', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato) then
      raise exception 'contrato_servicios: la línea tiene una cuenta por pagar enlazada y no se puede borrar' using errcode = '23503';
    end if;
    return old;
  end if;
  if new.alcance_traslado is distinct from old.alcance_traslado or new.servicio_id is distinct from old.servicio_id or new.clave_enlace is distinct from old.clave_enlace then
    raise exception 'contrato_servicios: el alcance, el servicio y la clave de una línea con cuenta por pagar enlazada no se editan' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_linea_enlazada_protegida() from public, anon, authenticated;
drop function if exists p75_priv.prevista_enlaza_linea(text, bigint, uuid);
drop function if exists p75_priv.clave_enlace_de(text);
do $$ begin if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.tg_linea_enlazada_protegida()'::regprocedure) <> '336c54ae9bd8a9bfacd3127ed7e7d7b7' then raise exception 'rollback 292: la guarda restaurada no coincide con la 265'; end if; end $$;
commit;
