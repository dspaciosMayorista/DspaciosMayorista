-- ROLLBACK 349. Se NIEGA si el historial tiene TRM iniciales (trm_anterior nula: no se pueden devolver a NOT NULL sin inventar un valor anterior): expórtalas o confirma con el dueño antes.
-- Restablece, con la definición EXACTA de la 348, prevista_cxp_aplicar y prevista_trm_costo_actualizar. No toca ninguna prevista ni CxP (las previstas que heredaron/recibieron TRM conservan su par, que es correcto).
begin;
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.contrato_trm_costo_historial where trm_anterior is null or valor_cop_anterior is null) then
    raise exception 'ROLLBACK 349 detenido: hay TRM iniciales en el historial (sin valor anterior). Expórtalo o confirma con el dueño antes de revertir.';
  end if;
end $$;
alter table public.contrato_trm_costo_historial alter column trm_anterior set not null, alter column valor_cop_anterior set not null;
create or replace function public.prevista_trm_costo_actualizar(
  p_numero text, p_tenant text, p_actor uuid, p_clave text, p_trm_nueva numeric, p_trm_esperada numeric, p_nota text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; u record; r record; v_trm numeric(15,4); v_esp numeric(15,4); v_cop numeric(15,2);
  v_n integer := 0; v_filas jsonb := '[]'::jsonb; v_nota text;
begin
  select rol, activo, tenant into u from public.usuarios where id = p_actor;
  if not found or u.activo is not true or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception using errcode = '42501', message = 'Tu rol no tiene permiso para corregir la TRM de costos.';
  end if;
  select * into v from public.ventas where numero_contrato = p_numero and tenant = p_tenant for update;
  if not found or (u.rol not in ('superadmin', 'gerencia') and u.tenant is distinct from v.tenant) then
    raise exception using errcode = 'F4730', message = 'Contrato no encontrado o sin acceso.';
  end if;
  if v.estado is distinct from 'pendiente' then
    raise exception using errcode = 'F4731', message = 'Solo se corrige la TRM de costos mientras el contrato está pendiente. Al confirmarlo la obligación nace y su equivalente en pesos queda congelado.';
  end if;
  if p_trm_nueva is null or p_trm_esperada is null or p_trm_nueva <= 0 or p_trm_nueva >= 100000000000 or p_trm_esperada <= 0 then
    raise exception using errcode = 'F4732', message = 'La TRM de costos debe ser un número positivo y finito (pesos por dólar).';
  end if;
  v_trm := round(p_trm_nueva, 4); v_esp := round(p_trm_esperada, 4);
  if v_trm <= 0 then raise exception using errcode = 'F4732', message = 'La TRM de costos debe ser un número positivo y finito (pesos por dólar).'; end if;
  v_nota := nullif(left(btrim(coalesce(p_nota, '')), 300), '');

  -- (El payload es to_jsonb de la fila: trae TODAS las columnas, también las nulas; por eso se compara con ->> is [not] null y no con el operador ?.)
  -- Todas las previstas USD con par (equivalente, TRM) de la 236; si se pidió una clave, solo esa (que debe existir y traer par).
  for r in
    select id, clave, payload from public.contrato_obligaciones_previstas
     where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null
       and upper(coalesce(payload->>'moneda', '')) = 'USD' and payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null and payload->>'aceptacion_63_id' is null
       and (p_clave is null or clave = p_clave)
     order by id for update
  loop
    if round((r.payload->>'trm_costo')::numeric, 4) is distinct from v_esp then
      raise exception using errcode = 'F4733', message = 'La TRM de costos cambió mientras la editabas. Recarga la página y revisa el valor actual antes de corregirla.';
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception using errcode = 'F4734', message = 'No hay obligaciones previstas en USD con TRM de costos para corregir en este contrato.';
  end if;
  if v_trm = v_esp then
    return jsonb_build_object('cambiadas', 0, 'trm_anterior', v_esp, 'trm_nueva', v_trm, 'filas', '[]'::jsonb);
  end if;

  for r in
    select id, clave, payload from public.contrato_obligaciones_previstas
     where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null
       and upper(coalesce(payload->>'moneda', '')) = 'USD' and payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null and payload->>'aceptacion_63_id' is null
       and (p_clave is null or clave = p_clave)
     order by id
  loop
    v_cop := round((r.payload->>'valor_total')::numeric * v_trm, 2);
    insert into public.contrato_trm_costo_historial (numero_contrato, tenant, clave, valor_total, trm_anterior, trm_nueva, valor_cop_anterior, valor_cop_nuevo, nota, actor)
    values (p_numero, v.tenant, r.clave, (r.payload->>'valor_total')::numeric, v_esp, v_trm, (r.payload->>'valor_cop_costo')::numeric, v_cop, v_nota, p_actor);
    update public.contrato_obligaciones_previstas
       set payload = payload || jsonb_build_object('trm_costo', v_trm, 'valor_cop_costo', v_cop)
     where id = r.id;
    v_filas := v_filas || jsonb_build_object('clave', r.clave, 'valor_total', (r.payload->>'valor_total')::numeric, 'valor_cop_anterior', (r.payload->>'valor_cop_costo')::numeric, 'valor_cop_nuevo', v_cop);
  end loop;
  return jsonb_build_object('cambiadas', v_n, 'trm_anterior', v_esp, 'trm_nueva', v_trm, 'filas', v_filas);
end $$;
revoke all on function public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text) to service_role;
comment on function public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text) is 'Migración 348: corrige la TRM de costos provisional de previstas USD de un contrato PENDIENTE (compara-y-cambia contra p_trm_esperada; historial; solo service_role).';
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
       -- 348: si la prevista ya trae el par de la 236 (equivalente + TRM de costos) y cambia su valor, el equivalente se recalcula con SU TRM (a centavos, como la CHECK de la 236: round(valor_total × TRM, 2));
       -- sin esto la prevista confirmaba con un equivalente viejo y la CHECK rechazaba la CxP (el contrato no se podía confirmar). Sin par (COP, #63 u obligaciones históricas) no se agrega nada.
                          || case when payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null and nullif(e->>'valor_total', '') is not null
                                  then jsonb_build_object('valor_cop_costo', round(round((e->>'valor_total')::numeric, 2) * (payload->>'trm_costo')::numeric, 2)) else '{}'::jsonb end
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
