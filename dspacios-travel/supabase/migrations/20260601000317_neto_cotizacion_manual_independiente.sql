-- 317 · #48 (bloque Portal B2B, 2026-11-19) · Cotización dinámica B2B NUEVA con modalidad NETO (precio exigible = PVP − descuento del aliado).
--
-- La modalidad NETO ya existía para la hija elegida de una comparativa (#50, 222) y para el carrito/Reservar; la cotización dinámica NORMAL B2B solo conocía el PVP
-- con el acuerdo de comisión de #97. Esta migración reutiliza, SIN cambiar sus reglas aprobadas, el mismo sello (`cotizacion_neto`) y todo lo que ya lo consume
-- (pago previo, conversión, ficha): `p50_priv.validar_conversion`, `completar_conversion`, `registrar_pago_previo_rev` y `p97_priv.validar/aplicar` NO se tocan.
--   · NUEVA `public.crear_cotizacion_manual_neto`: crea la cotización (216), le fija `aliado_id` y la sella NETO en la MISMA transacción (cualquier rechazo deshace todo,
--     sin consumir consecutivo). Sin acuerdo #97: la participación va DENTRO del descuento (nunca una segunda comisión), igual que la hija NETO.
--   · `p50_priv.sellar_hija` (222, copia íntegra): ÚNICA diferencia = la guarda que exigía ser hija de una comparativa ahora acepta también la dinámica simple independiente.
--   · `p39_priv.bloquear_para_editar` (216, copia íntegra): UNA guarda más — una cotización con NETO fijado no se edita (el sello quedaría viejo; igual que la hija).
-- NO modifica filas existentes ni la 198, la 286 ni la regla del 6 %/2 %. Sin acuerdo de comisión: la BNC no interviene en NETO (la base excluye solo los tiquetes, como en la hija).
-- Orden: preflight_317 → 317 → postcheck_317 → código nuevo. Con SOLO la 317 y el código viejo nada cambia (la función nueva no se llama). Rollback: rollback_317_*.sql
begin;
set local lock_timeout = '10s';

do $g$
begin
  if to_regprocedure('p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)') is null
     or to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)') is null
     or to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') is null
     or to_regprocedure('p97_priv.validar(bigint)') is null
     or to_regclass('public.cotizacion_neto') is null then
    raise exception '317: faltan piezas de las migraciones 216/222/286. No se aplicó nada.';
  end if;
  -- Se reemplaza EXACTAMENTE el cuerpo auditado (222 / 216): si alguien lo cambió, no se pisa en silencio.
  if position('h.cotizacion_origen_id is null or h.tipo is distinct from ''manual''' in (select prosrc from pg_proc where oid = to_regprocedure('p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)'))) = 0 then
    raise exception '317: p50_priv.sellar_hija no tiene la guarda esperada de la 222 (¿ya aplicada o modificada?). No se aplicó nada.';
  end if;
  if position('solo se editan cotizaciones dinámicas simples' in (select prosrc from pg_proc where oid = to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)'))) = 0
     or position('NETO fijado' in (select prosrc from pg_proc where oid = to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)'))) > 0 then
    raise exception '317: p39_priv.bloquear_para_editar no es el cuerpo esperado de la 216 (¿ya aplicada o modificada?). No se aplicó nada.';
  end if;
end $g$;


-- 4.6 Sellar la hija recién creada (misma transacción que `crear_hija`).
create or replace function p50_priv.sellar_hija(
  p_hija bigint, p_modalidad text, p_reconoce boolean, p_autorizar boolean, p_actor uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h public.cotizaciones;
  u public.usuarios;
  a public.aliados;
  v_tipo text;
  v_moneda text;
  v_pct numeric;
  v_param numeric;
  v_rec_ali numeric;
  k jsonb;
  ev jsonb;
  v_solo boolean;
  v_neto bigint;
  v_costos bigint;
  v_autorizado boolean := false;
begin
  select * into h from public.cotizaciones where id = p_hija for update;
  -- 317 (#48): también sella una cotización dinámica SIMPLE independiente (sin origen de comparativa, sin paquete 100 % dinámico); antes solo la hija de una comparativa.
  if not found or h.tipo is distinct from 'manual'
     or (h.cotizacion_origen_id is null and (h.modo is distinct from 'simple' or h.paquete_din_id is not null)) then
    raise exception 'COMPARATIVA_DATOS: la modalidad PVP/NETO solo aplica a una cotización dinámica manual o a la elegida de una comparativa.' using errcode = 'P0001';
  end if;
  if p_modalidad is null or p_modalidad not in ('pvp', 'neto') then
    raise exception 'COMPARATIVA_DATOS: la modalidad debe ser PVP o NETO.' using errcode = 'P0001';
  end if;
  select * into u from public.usuarios where id = p_actor;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
     or (u.rol <> 'superadmin' and u.tenant is distinct from h.tenant) then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
  end if;
  if exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = p_hija) then
    raise exception 'COMPARATIVA_DATOS: la modalidad de esta cotización ya está fijada.' using errcode = 'P0001';
  end if;
  v_tipo := coalesce(nullif(h.payload->>'tipoAsesor', ''), 'interno');
  if v_tipo not in ('interno', 'agencia', 'freelance') then
    raise exception 'COMPARATIVA_DATOS: el tipo de venta de la cotización no es válido.' using errcode = 'P0001';
  end if;
  v_moneda := coalesce(nullif(h.moneda, ''), 'COP');

  -- B2C: solo PVP; el sello deja constancia de que se eligió.
  if v_tipo = 'interno' then
    if p_modalidad = 'neto' then
      raise exception 'COMPARATIVA_DATOS: el precio NETO solo aplica a ventas de una agencia o freelance del catálogo.' using errcode = 'P0001';
    end if;
    insert into public.cotizacion_neto (cotizacion_id, tenant, modalidad, aliado_id, tipo_asesor, moneda, pvp_total, creado_por_id)
    values (p_hija, h.tenant, 'pvp', null, 'interno', v_moneda, h.precio_venta, p_actor);
    return;
  end if;

  -- B2B sin aliado del catálogo (Q-5): PVP se permite SIN sellar (comportamiento de hoy,
  -- Q-4: la hija sigue legada y la 198 hace lo de siempre); solo NETO exige aliado.
  if h.aliado_id is null then
    if p_modalidad = 'pvp' then
      return;
    end if;
    raise exception 'COMPARATIVA_DATOS: el precio NETO necesita la agencia o freelance del catálogo; la comparativa no lo trae. Usa PVP o enlaza el aliado.' using errcode = 'P0001';
  end if;
  -- B2B con aliado: se verifica contra la base (no contra nombres).
  select * into a from public.aliados where id = h.aliado_id;
  if not found then
    raise exception 'COMPARATIVA_DATOS: el aliado de la cotización no existe en el catálogo.' using errcode = 'P0001';
  end if;
  if a.tipo is not null and lower(a.tipo) not like '%' || (case v_tipo when 'agencia' then 'agencia' else 'free' end) || '%' then
    raise exception 'COMPARATIVA_DATOS: el aliado es de otro tipo que la venta.' using errcode = 'P0001';
  end if;

  if p_modalidad = 'pvp' then
    insert into public.cotizacion_neto (cotizacion_id, tenant, modalidad, aliado_id, tipo_asesor, moneda, pvp_total, creado_por_id)
    values (p_hija, h.tenant, 'pvp', a.id, v_tipo, v_moneda, h.precio_venta, p_actor);
    return;
  end if;

  -- ── NETO ────────────────────────────────────────────────────────────────
  if not p50_priv.rol_fija_neto(u.rol::text) then
    raise exception 'COMPARATIVA_DATOS: tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones.' using errcode = 'P0001';
  end if;
  if p_reconoce is null then
    raise exception 'COMPARATIVA_DATOS: indica si se reconoce la participación del aliado en el recobro.' using errcode = 'P0001';
  end if;

  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v_tipo = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  -- A 4 decimales (la columna es numeric(5,4)): lo que se calcula es lo que queda sellado.
  v_pct := round(coalesce(a.pct_comision, v_param, case when v_tipo = 'agencia' then 0.12 else 0.11 end), 4);
  v_rec_ali := greatest(coalesce((h.payload->>'recobroAliado')::numeric, 0), 0);

  k := p50_priv.calcular(p_hija, p_reconoce, v_pct, v_rec_ali);
  v_neto := (k->>'neto')::bigint;
  v_costos := (k->>'costos')::bigint;
  v_solo := (k->>'solo_tiquetes')::boolean;

  if (k->>'descuento')::bigint <= 0 then
    raise exception 'COMPARATIVA_DATOS: con descuento 0 no hay precio NETO; esta venta se hace a PVP.' using errcode = 'P0001';
  end if;
  ev := p50_priv.evaluar_margen(v_neto, v_costos, v_solo);
  if (ev->>'costo_cero')::boolean then
    raise exception 'COMPARATIVA_DATOS: el costo total de la cotización es 0; no se puede fijar un precio NETO.' using errcode = 'P0001';
  end if;
  if (ev->>'bajo_costo')::boolean then
    raise exception 'COMPARATIVA_DATOS: el total NETO (%) queda por debajo del costo total (%); no se autoriza para ningún rol.',
      round(v_neto / 100.0), round(v_costos / 100.0) using errcode = 'P0001';
  end if;
  if not (ev->>'cumple')::boolean then
    if not coalesce(p_autorizar, false) then
      raise exception 'COMPARATIVA_DATOS: el total NETO (%) no cubre el margen mínimo del % % con costos de % (margen actual: % %). Requiere autorización de %.',
        round(v_neto / 100.0), (ev->>'piso_bps')::int / 100, '%', round(v_costos / 100.0),
        round((ev->>'margen')::numeric * 100, 2), '%',
        case when v_solo then 'superadmin' else 'superadmin o administración' end using errcode = 'P0001';
    end if;
    if not p50_priv.rol_autoriza_margen(u.rol::text, v_solo) then
      raise exception 'COMPARATIVA_DATOS: tu rol no puede autorizar un margen por debajo del mínimo; lo autoriza %.',
        case when v_solo then 'superadmin' else 'superadmin o administración' end using errcode = 'P0001';
    end if;
    v_autorizado := true;
  end if;

  insert into public.cotizacion_neto (
    cotizacion_id, tenant, modalidad, reconoce_recobro, aliado_id, tipo_asesor, moneda, pvp_total,
    tiquetes, recobro, ninos_total, recobro_aliado_original, base_comision, pct_comision,
    comision_ordinaria, participacion_recobro, descuento_total, neto_total, costo_total, margen, piso,
    solo_tiquetes, autorizado_por, autorizado_rol, autorizado_en, creado_por_id)
  values (
    p_hija, h.tenant, 'neto', p_reconoce, a.id, v_tipo, v_moneda, (k->>'precio')::numeric / 100,
    (k->>'tiquetes')::numeric / 100, (k->>'recobro')::numeric / 100, (k->>'ninos')::numeric / 100,
    v_rec_ali, (k->>'base')::numeric / 100, v_pct,
    (k->>'ordinaria')::numeric / 100, (k->>'participacion')::numeric / 100, (k->>'descuento')::numeric / 100,
    v_neto::numeric / 100, v_costos::numeric / 100, (ev->>'margen')::numeric, (ev->>'piso_bps')::numeric / 10000,
    v_solo, case when v_autorizado then p_actor end, case when v_autorizado then u.rol::text end,
    case when v_autorizado then now() end, p_actor);

  insert into public.cotizacion_neto_componentes (cotizacion_id, orden, servicio_id, tipo_servicio, pvp, descuento, neto)
  select p_hija, (f->>'orden')::int, (f->>'servicio_id')::bigint, f->>'tipo',
         (f->>'pvp')::numeric / 100, (f->>'descuento')::numeric / 100, (f->>'neto')::numeric / 100
    from jsonb_array_elements(k->'filas') f;

  -- La participación ya va DENTRO del descuento: la 198 no debe crear la fila de
  -- recobro pendiente (sería pagarla dos veces).
  update public.cotizaciones
     set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{recobroAliado}', '0'::jsonb, true)
   where id = p_hija;
end $$;

create or replace function p39_priv.bloquear_para_editar(
  p_cotizacion_id bigint, p_usuario_id uuid, p_rev_esperada integer, p_motivo text
) returns public.cotizaciones
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cotizaciones; u public.usuarios;
begin
  select * into u from public.usuarios where id = p_usuario_id;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
    raise exception 'EDICION_39_NO_AUTORIZADO: no tienes permiso para editar esta cotización.' using errcode = '42501';
  end if;
  select * into c from public.cotizaciones where id = p_cotizacion_id for update;
  if not found or (u.rol <> 'superadmin' and u.tenant is distinct from c.tenant) then
    raise exception 'EDICION_39_NO_AUTORIZADO: no tienes permiso para editar esta cotización.' using errcode = '42501';
  end if;
  if not (p39_priv.frontera_activa()
          and coalesce((select not s.suspendida from p39_priv.suspension_edicion s where s.id), false)) then
    raise exception 'EDICION_39_SUSPENDIDA: la edición de cotizaciones no está habilitada en este momento.' using errcode = 'P0001';
  end if;
  if c.tipo is distinct from 'manual' or c.modo is distinct from 'simple' or c.cotizacion_origen_id is not null then
    raise exception 'EDICION_39_NO_ELEGIBLE: solo se editan cotizaciones dinámicas simples (no comparativas ni opciones elegidas).' using errcode = 'P0001';
  end if;
  -- 317 (#48): con precio NETO fijado el sello (descuento, reparto, margen autorizado) quedaría desactualizado: no se edita; se crea otra cotización.
  if exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = c.id and n.modalidad = 'neto') then
    raise exception 'EDICION_39_NO_ELEGIBLE: la cotización tiene precio NETO fijado; no se edita (crea otra cotización).' using errcode = 'P0001';
  end if;
  if c.estado is distinct from 'abierta' or c.numero_contrato is not null
     or exists (select 1 from public.ventas v where v.cotizacion_id = c.id) then
    raise exception 'EDICION_39_NO_ELEGIBLE: la cotización no está abierta.' using errcode = 'P0001';
  end if;
  if c.condicion_pago_congelada_en is not null then
    raise exception 'EDICION_39_CONGELADA: la cotización ya tiene condiciones congeladas por un pago.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cotizacion_pagos_previos p where p.cotizacion_id = c.id) then
    raise exception 'EDICION_39_CON_PAGOS: la cotización tuvo pagos previos (aunque estén anulados); no se edita.' using errcode = 'P0001';
  end if;
  if c.vigencia_hasta is null or c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'EDICION_39_VENCIDA: la cotización está vencida; renueva su vigencia antes de editarla.' using errcode = 'P0001';
  end if;
  if u.rol = 'venta' and (c.creado_por_id is null or c.creado_por_id <> u.id) then
    raise exception 'EDICION_39_AUTOR: solo puedes editar las cotizaciones que tú creaste.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'EDICION_39_MOTIVO: indica el motivo del cambio.' using errcode = 'P0001';
  end if;
  if length(btrim(p_motivo)) > 500 then
    raise exception 'EDICION_39_MOTIVO: el motivo no puede pasar de 500 caracteres.' using errcode = 'P0001';
  end if;
  if p_rev_esperada is distinct from c.economico_rev then
    raise exception 'EDICION_39_REVISION: la cotización cambió mientras la editabas; recarga la página y vuelve a intentarlo.' using errcode = 'P0001';
  end if;
  return c;
end $$;

-- Crear una cotización dinámica B2B con precio NETO (una sola transacción). El rol que fija NETO, el margen (6 % / 2 % solo tiquetes), el tipo de aliado y el descuento
-- los decide `p50_priv.sellar_hija` con el actor real (p_usuario_id), exactamente como en la hija; aquí solo se exige el aliado del catálogo, por id.
create or replace function public.crear_cotizacion_manual_neto(
  p_usuario_id uuid, p_tenant text, p_cabecera jsonb, p_servicios jsonb, p_aliado_id bigint, p_reconoce boolean, p_autorizar boolean
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare v_id bigint;
begin
  if p_aliado_id is null or not exists (select 1 from public.aliados a where a.id = p_aliado_id) then
    raise exception 'COMPARATIVA_DATOS: el precio NETO necesita la agencia o freelance del catálogo.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(p_cabecera#>>'{payload,tipoAsesor}', ''), 'interno') not in ('agencia', 'freelance') then
    raise exception 'COMPARATIVA_DATOS: el precio NETO solo aplica a ventas de una agencia o freelance del catálogo.' using errcode = 'P0001';
  end if;
  v_id := public.crear_cotizacion_manual(p_usuario_id, p_tenant, p_cabecera, p_servicios);
  update public.cotizaciones set aliado_id = p_aliado_id where id = v_id;   -- identidad por id (la columna solo la escribe una RPC)
  perform p50_priv.sellar_hija(v_id, 'neto', p_reconoce, p_autorizar, p_usuario_id);
  return v_id;
end $$;

revoke all on function public.crear_cotizacion_manual_neto(uuid, text, jsonb, jsonb, bigint, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.crear_cotizacion_manual_neto(uuid, text, jsonb, jsonb, bigint, boolean, boolean) to service_role;
revoke all on function p50_priv.sellar_hija(bigint, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function p39_priv.bloquear_para_editar(bigint, uuid, integer, text) from public, anon, authenticated, service_role;

do $v$
begin
  if has_function_privilege('authenticated', 'public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)', 'EXECUTE') then
    raise exception '317: grants inesperados.';
  end if;
  if not p39_priv.frontera_activa() then raise exception '317: la frontera de #39 dejó de estar activa.'; end if;
end $v$;

commit;
