-- 349 · NETA — un servicio en USD AGREGADO después de crear el contrato pendiente (editor de servicios) nace con su TRM de costos provisional (o se puede fijar después de guardar).
--
-- Defecto que cierra (reproducido con la acción real `actualizarServiciosContrato`, ver pruebas/trmCostoServicioUsd349.pg.ts): `prevista_cxp_aplicar` (288/348) insertaba la obligación prevista de un servicio NUEVO con
-- moneda USD pero SIN el par (equivalente en pesos, TRM de costos) de la 236. Resultado: «TRM de costos pendiente» sin ningún lugar donde fijarla (la 348 solo corrige previstas que YA traen par), y al confirmar la CxP nacía en
-- USD sin equivalente aunque las otras obligaciones USD del mismo contrato sí lo tenían (devengo mezclado).
--
-- Qué hace (aditiva; NO toca ninguna fila existente ni cuentas_por_pagar ni su disparador de inmutabilidad Z9610):
--   1. `prevista_cxp_aplicar`: al INSERTAR una prevista en USD sin par, hereda el par SOLO si las previstas USD con par del contrato pendiente comparten UNA misma TRM (equivalente = round(round(valor,2) × TRM, 2), lo que exige la CHECK de la 236).
--      Sin par en el contrato, o con TRMs distintas, NO inventa una: la obligación queda «TRM de costos pendiente». Contratos con aceptación #63 y obligaciones en COP: sin cambio.
--   2. `prevista_trm_costo_actualizar`: con `p_trm_esperada` NULL fija la TRM INICIAL de las previstas USD sin par que nacieron de la edición de servicios (clave `cxp:ed:…`); las demás previstas sin par (otras rutas, históricas) siguen sin
--      poder recibir TRM. Con `p_trm_esperada` informada, comportamiento idéntico a la 348 (compara-y-cambia).
--   3. `contrato_trm_costo_historial`: `trm_anterior`/`valor_cop_anterior` admiten NULL (una TRM inicial no tiene valor anterior; no se inventa uno). Las filas existentes no cambian.
--
-- Preflight: supabase/scripts/preflight_349_trm_costo_servicio_usd.sql · Postcheck: postcheck_349_… · Rollback: rollback_349_… · Pruebas: pruebas/trmCostoServicioUsd349.pg.ts (supabase/scripts/test_349_trm_costo_servicio_usd.sh)
begin;

do $$ begin
  if to_regclass('public.contrato_trm_costo_historial') is null then
    raise exception '349 ABORTADA: falta la 348 (contrato_trm_costo_historial).';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.prevista_cxp_aplicar(text,bigint[],jsonb,jsonb)')) is distinct from '51be918d5eedffcbb46344665d1424d8' then
    raise exception '349 ABORTADA: prevista_cxp_aplicar no es la definición de la 348 que se reemplaza (md5 51be918d…). No se reemplaza una versión distinta o ya reemplazada.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.prevista_trm_costo_actualizar(text,text,uuid,text,numeric,numeric,text)')) is distinct from 'e741f1c2818a645ee325a0fb89e43127' then
    raise exception '349 ABORTADA: prevista_trm_costo_actualizar no es la definición de la 348 que se reemplaza (md5 e741f1c2…).';
  end if;
end $$;

alter table public.contrato_trm_costo_historial alter column trm_anterior drop not null, alter column valor_cop_anterior drop not null;

create or replace function public.prevista_cxp_aplicar(p_numero text, p_eliminar bigint[], p_actualizar jsonb, p_insertar jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.ventas; e jsonb; n_ins integer := 0; n_upd integer := 0; n_del integer := 0; v_pl jsonb; v_trm numeric; v_n_trm integer;
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
       -- 348: si la prevista ya trae el par de la 236 (equivalente + TRM de costos) y cambia su valor, el equivalente se recalcula con SU TRM (a centavos, como la CHECK de la 236: round(valor_total × TRM, 2)).
                          || case when payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null and nullif(e->>'valor_total', '') is not null
                                  then jsonb_build_object('valor_cop_costo', round(round((e->>'valor_total')::numeric, 2) * (payload->>'trm_costo')::numeric, 2)) else '{}'::jsonb end
     where id = (e->>'id')::bigint and numero_contrato = p_numero and clase = 'cxp' and materializada_en is null;
    n_upd := n_upd + 1;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p_insertar, '[]'::jsonb)) loop
    if coalesce(btrim(e->>'tipo_proveedor'), '') = '' or nullif(e->>'valor_total', '') is null or (e->>'valor_total')::numeric < 0 then
      raise exception 'prevista_cxp_aplicar: fila inválida (tipo_proveedor y valor_total >= 0 son obligatorios)';
    end if;
    v_pl := jsonb_build_object('numero_contrato', p_numero, 'tenant', v.tenant, 'moneda', coalesce(v.moneda, 'COP')) || e;
    -- 349: una prevista NUEVA en USD hereda la TRM de costos provisional del contrato solo si las previstas USD con par comparten una única TRM (no se elige entre TRMs distintas ni se inventa una).
    if upper(coalesce(v_pl->>'moneda', '')) = 'USD' and v.aceptacion_63_id is null and v_pl->>'trm_costo' is null and v_pl->>'valor_cop_costo' is null then
      select min(round((payload->>'trm_costo')::numeric, 4)), count(distinct round((payload->>'trm_costo')::numeric, 4)) into v_trm, v_n_trm
        from public.contrato_obligaciones_previstas
       where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null
         and upper(coalesce(payload->>'moneda', '')) = 'USD' and payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null and payload->>'aceptacion_63_id' is null;
      if v_n_trm = 1 and v_trm > 0 then
        v_pl := v_pl || jsonb_build_object('trm_costo', v_trm, 'valor_cop_costo', round(round((v_pl->>'valor_total')::numeric, 2) * v_trm, 2));
      end if;
    end if;
    insert into public.contrato_obligaciones_previstas (numero_contrato, clase, clave, payload)
    values (p_numero, 'cxp', 'cxp:ed:' || gen_random_uuid()::text, v_pl);
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('aplicado', true, 'eliminadas', n_del, 'actualizadas', n_upd, 'insertadas', n_ins);
end $$;
revoke all on function public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb) to service_role;

create or replace function public.prevista_trm_costo_actualizar(
  p_numero text, p_tenant text, p_actor uuid, p_clave text, p_trm_nueva numeric, p_trm_esperada numeric, p_nota text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; u record; r record; v_trm numeric(15,4); v_esp numeric(15,4); v_cop numeric(15,2);
  v_n integer := 0; v_filas jsonb := '[]'::jsonb; v_nota text; v_inicial boolean := (p_trm_esperada is null);
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
  if p_trm_nueva is null or p_trm_nueva <= 0 or p_trm_nueva >= 100000000000 or (not v_inicial and p_trm_esperada <= 0) then
    raise exception using errcode = 'F4732', message = 'La TRM de costos debe ser un número positivo y finito (pesos por dólar).';
  end if;
  v_trm := round(p_trm_nueva, 4); v_esp := round(p_trm_esperada, 4);
  if v_trm <= 0 then raise exception using errcode = 'F4732', message = 'La TRM de costos debe ser un número positivo y finito (pesos por dólar).'; end if;
  v_nota := nullif(left(btrim(coalesce(p_nota, '')), 300), '');

  -- Modo INICIAL (349, p_trm_esperada nula): solo las previstas USD SIN par que nacieron de la edición de servicios (clave cxp:ed:…); compara-y-cambia contra «sin TRM» (si otra edición ya la fijó, ya no son candidatas).
  -- Modo CORRECCIÓN (348): previstas USD con par; compara-y-cambia contra la TRM que la persona vio.
  for r in
    select id, clave, payload from public.contrato_obligaciones_previstas
     where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null
       and upper(coalesce(payload->>'moneda', '')) = 'USD' and payload->>'aceptacion_63_id' is null
       and (p_clave is null or clave = p_clave)
       and case when v_inicial then (payload->>'trm_costo' is null and payload->>'valor_cop_costo' is null and clave like 'cxp:ed:%')
                else (payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null) end
     order by id for update
  loop
    if not v_inicial and round((r.payload->>'trm_costo')::numeric, 4) is distinct from v_esp then
      raise exception using errcode = 'F4733', message = 'La TRM de costos cambió mientras la editabas. Recarga la página y revisa el valor actual antes de corregirla.';
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception using errcode = 'F4734', message = case when v_inicial then 'No hay servicios en USD sin TRM de costos para fijar en este contrato (recarga la página: otra edición pudo fijarla).'
                                                              else 'No hay obligaciones previstas en USD con TRM de costos para corregir en este contrato.' end;
  end if;
  if not v_inicial and v_trm = v_esp then
    return jsonb_build_object('cambiadas', 0, 'trm_anterior', v_esp, 'trm_nueva', v_trm, 'filas', '[]'::jsonb);
  end if;

  for r in
    select id, clave, payload from public.contrato_obligaciones_previstas
     where numero_contrato = p_numero and clase = 'cxp' and materializada_en is null
       and upper(coalesce(payload->>'moneda', '')) = 'USD' and payload->>'aceptacion_63_id' is null
       and (p_clave is null or clave = p_clave)
       and case when v_inicial then (payload->>'trm_costo' is null and payload->>'valor_cop_costo' is null and clave like 'cxp:ed:%')
                else (payload->>'trm_costo' is not null and payload->>'valor_cop_costo' is not null) end
     order by id
  loop
    v_cop := round(round((r.payload->>'valor_total')::numeric, 2) * v_trm, 2);
    insert into public.contrato_trm_costo_historial (numero_contrato, tenant, clave, valor_total, trm_anterior, trm_nueva, valor_cop_anterior, valor_cop_nuevo, nota, actor)
    values (p_numero, v.tenant, r.clave, (r.payload->>'valor_total')::numeric, case when v_inicial then null else v_esp end, v_trm, case when v_inicial then null else (r.payload->>'valor_cop_costo')::numeric end, v_cop, v_nota, p_actor);
    update public.contrato_obligaciones_previstas
       set payload = payload || jsonb_build_object('trm_costo', v_trm, 'valor_cop_costo', v_cop)
     where id = r.id;
    v_filas := v_filas || jsonb_build_object('clave', r.clave, 'valor_total', (r.payload->>'valor_total')::numeric, 'valor_cop_anterior', case when v_inicial then null else (r.payload->>'valor_cop_costo')::numeric end, 'valor_cop_nuevo', v_cop);
  end loop;
  return jsonb_build_object('cambiadas', v_n, 'trm_anterior', v_esp, 'trm_nueva', v_trm, 'filas', v_filas);
end $$;
revoke all on function public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text) to service_role;
comment on function public.prevista_trm_costo_actualizar(text, text, uuid, text, numeric, numeric, text) is 'Migración 348/349: corrige (p_trm_esperada informada) o fija por primera vez (p_trm_esperada nula, solo servicios USD agregados por la edición de servicios) la TRM de costos PROVISIONAL de previstas USD de un contrato PENDIENTE; solo service_role.';

commit;
