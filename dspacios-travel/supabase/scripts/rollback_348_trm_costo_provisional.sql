-- ROLLBACK 348. Se NIEGA si ya hay correcciones registradas (el historial es la única evidencia de por qué una prevista cambió de TRM): exportarlo o decidir con el dueño antes.
-- No toca ninguna prevista ni CxP: retira la función y la tabla de historial y restablece prevista_cxp_aplicar a la versión de la 288. (Las previstas ya recalculadas conservan su equivalente correcto.)
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.contrato_trm_costo_historial') is not null and exists (select 1 from public.contrato_trm_costo_historial) then
    raise exception 'ROLLBACK 348 detenido: hay correcciones de TRM de costos en el historial. Expórtalo o confirma con el dueño antes de revertir.';
  end if;
end $$;
drop function if exists public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text);
drop table if exists public.contrato_trm_costo_historial;
-- Restablece prevista_cxp_aplicar a la definición EXACTA de la 288 (md5 2d7d0d44…).
create or replace function public.prevista_cxp_aplicar(p_numero text, p_eliminar bigint[], p_actualizar jsonb, p_insertar jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.ventas; e jsonb; n_ins integer := 0; n_upd integer := 0; n_del integer := 0;
begin
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found or v.estado is distinct from 'pendiente' then
    return jsonb_build_object('aplicado', false, 'motivo', 'no_pendiente');
  end if;
  delete from public.contrato_obligaciones_previstas
   where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null and id = any (coalesce(p_eliminar, '{}'::bigint[]));
  get diagnostics n_del = row_count;
  for e in select * from jsonb_array_elements(coalesce(p_actualizar, '[]'::jsonb)) loop
    update public.contrato_obligaciones_previstas
       set payload = payload || jsonb_strip_nulls(jsonb_build_object('valor_total', e->'valor_total', 'servicio', e->'servicio', 'tipo_proveedor', e->'tipo_proveedor', 'proveedor', e->'proveedor'))
     where id = (e->>'id')::bigint and numero_contrato = p_numero and clase = 'cxp' and materializada_en is null;
    n_upd := n_upd + 1;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p_insertar, '[]'::jsonb)) loop
    if coalesce(btrim(e->>'tipo_proveedor'), '') = '' or nullif(e->>'valor_total', '') is null or (e->>'valor_total')::numeric < 0 then
      raise exception 'prevista_cxp_aplicar: fila inválida (tipo_proveedor y valor_total >= 0 son obligatorios)';
    end if;
    insert into public.contrato_obligaciones_previstas (numero_contrato, clase, clave, payload)
    values (p_numero, 'cxp', 'cxp:ed:' || gen_random_uuid()::text,
            jsonb_build_object('numero_contrato', p_numero, 'tenant', v.tenant, 'moneda', coalesce(v.moneda, 'COP')) || e);
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('aplicado', true, 'eliminadas', n_del, 'actualizadas', n_upd, 'insertadas', n_ins);
end $$;
revoke all on function public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb) to service_role;
commit;
