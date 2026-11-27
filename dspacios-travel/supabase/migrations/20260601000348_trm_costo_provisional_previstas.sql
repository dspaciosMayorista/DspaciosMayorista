-- 348 · NETA-05/06 — la TRM de costos PROVISIONAL de las obligaciones PREVISTAS se puede corregir después de guardar el contrato (mientras siga pendiente).
--
-- Contexto. La 236 congela el equivalente en COP de una CxP en USD a una «TRM de costos» y la hace inmutable desde que nace la fila (`trg_cxp_costo_inmutable`, Z9610). La 288 hizo que un contrato PENDIENTE
-- no tenga CxP sino obligaciones PREVISTAS (`contrato_obligaciones_previstas.payload`, con `valor_cop_costo`/`trm_costo` dentro), que nacen como CxP al confirmar. Mientras el contrato está pendiente esa TRM es
-- solo una estimación de costeo (PROVISIONAL): no devenga nada, no hay pagos ni asientos. El dueño necesita corregirla tras guardar el contrato; antes no había dónde.
--
-- Qué hace (aditiva; NO toca ninguna fila existente; NO toca cuentas_por_pagar ni su disparador de inmutabilidad):
--   · `contrato_trm_costo_historial`: quién, cuándo y de qué TRM a cuál (por obligación prevista). Solo service_role.
--   · `prevista_trm_costo_actualizar(...)`: SECURITY DEFINER, solo service_role. Valida actor (activo; superadmin/gerencia/administración/operaciones; agencia del contrato salvo superadmin/gerencia — la misma
--     regla que la RLS «cpp: acceso contable»), contrato PENDIENTE (bloqueado FOR UPDATE: serializa con confirmar_venta), TRM positiva y finita, y compara-y-cambia contra la TRM que la persona vio
--     (`p_trm_esperada`): otra edición concurrente → error, no pisa. Solo toca previstas USD que YA traen el par (equivalente, TRM) de la 236; recalcula `valor_cop_costo = round(valor_total × TRM, 2)`
--     (lo que exige el CHECK de la 236 al materializar). Alcance: una prevista (p_clave) o todas las previstas con par del contrato (p_clave null; deben compartir la TRM esperada, si no se rechaza).
--   · `prevista_cxp_aplicar` (288) pasa a recalcular el equivalente de una prevista con par cuando cambia su valor (ver el bloque final): defecto reproducido que impedía confirmar.
--   · Una obligación YA CONFIRMADA (cuenta por pagar) NO se edita aquí: su equivalente ya devengó asiento contable; corregirlo exige un proceso contable de corrección (reversión) que el dueño debe aprobar aparte.
--     Las CxP históricas en USD sin par tampoco se reclasifican.
--
-- Preflight: supabase/scripts/preflight_348_trm_costo_provisional.sql · Postcheck: postcheck_348_… · Rollback: rollback_348_… · Pruebas: pruebas/trmCostoProvisional348.pg.ts (supabase/scripts/test_348_trm_costo_provisional.sh)
begin;

do $$ begin
  if to_regclass('public.contrato_obligaciones_previstas') is null then
    raise exception '348 ABORTADA: falta contrato_obligaciones_previstas (288).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name = 'trm_costo') then
    raise exception '348 ABORTADA: falta cuentas_por_pagar.trm_costo (236).';
  end if;
  if to_regclass('public.contrato_trm_costo_historial') is not null then
    raise exception '348: ya aplicada (existe contrato_trm_costo_historial). No se re-aplica.';
  end if;
end $$;

create table public.contrato_trm_costo_historial (
  id               bigserial primary key,
  numero_contrato  text not null references public.ventas(numero_contrato) on delete cascade,
  tenant           text not null,
  clave            text not null,
  moneda           text not null default 'USD' check (moneda = 'USD'),
  valor_total      numeric(15,2) not null,
  trm_anterior     numeric(15,4) not null check (trm_anterior > 0),
  trm_nueva        numeric(15,4) not null check (trm_nueva > 0),
  valor_cop_anterior numeric(15,2) not null,
  valor_cop_nuevo  numeric(15,2) not null,
  nota             text check (nota is null or char_length(nota) <= 300),
  actor            uuid not null,
  creado_en        timestamptz not null default now()
);
create index contrato_trm_costo_historial_contrato_idx on public.contrato_trm_costo_historial (numero_contrato, creado_en desc);
comment on table public.contrato_trm_costo_historial is 'Migración 348: historial de correcciones de la TRM de costos PROVISIONAL de obligaciones previstas (contrato pendiente). Solo lo escribe prevista_trm_costo_actualizar; solo service_role.';
alter table public.contrato_trm_costo_historial enable row level security;
revoke all on public.contrato_trm_costo_historial from public, anon, authenticated;
grant all on public.contrato_trm_costo_historial to service_role;
grant usage, select on sequence public.contrato_trm_costo_historial_id_seq to service_role;

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

-- ── Corrección del camino «editar el valor de una prevista» (288 · prevista_cxp_aplicar) ─────────────────────────────────────────────────────────────
-- Reproducido con las acciones y RPC reales (pruebas/trmCostoProvisional348.pg.ts T11): una prevista USD con par (236) cuyo valor cambia por la edición de servicios del contrato pendiente conservaba el equivalente VIEJO; al confirmar,
-- la CHECK `cuentas_por_pagar_cop_costo_chk` rechazaba la CxP y el contrato no se podía confirmar. Se reemplaza SOLO esa función (copia verbatim de la 288 + el recálculo del equivalente); la CHECK de la 236 queda intacta.
do $$ begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.prevista_cxp_aplicar(text,bigint[],jsonb,jsonb)')) is distinct from '2d7d0d442c8b9c978c0dd5a35729ee67' then
    raise exception '348 ABORTADA: la definición de prevista_cxp_aplicar en esta base NO es la de la 288 que se copió (md5 2d7d0d44…). No se reemplaza una versión distinta.';
  end if;
end $$;

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
