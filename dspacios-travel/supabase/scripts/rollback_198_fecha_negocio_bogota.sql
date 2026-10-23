-- ROLLBACK de la migración 198 (fecha_negocio_bogota).
--
-- Devuelve las cinco funciones de pagos previos a su cuerpo EXACTO de la 164
-- (con `current_date`, generado desde ese archivo), restaura los defaults
-- `current_date` de abonos.fecha_abono y cotizacion_pagos_previos.fecha_pago y
-- elimina public.fecha_negocio(timestamptz) si ya nada depende de ella.
-- No toca datos: lo registrado mientras la 198 estuvo activa conserva su fecha.
--
-- Uso: correrlo completo en el editor SQL. Es una sola transacción.

begin;

alter table public.abonos alter column fecha_abono set default current_date;
alter table public.cotizacion_pagos_previos alter column fecha_pago set default current_date;

-- ── _huella_pago_previo — cuerpo original de la 164 ───────────────────────────────
create or replace function public._huella_pago_previo(
  p_cotizacion_id bigint,
  p_valor numeric,
  p_moneda text,
  p_forma_pago text,
  p_referencia text,
  p_fecha_pago date
) returns text language sql immutable as $$
  select md5(
    jsonb_build_array(
      p_cotizacion_id,
      to_char(round(coalesce(p_valor,0), 2), 'FM999999999999999999990.99'),
      upper(coalesce(nullif(trim(p_moneda),''), '')),
      upper(coalesce(nullif(trim(p_forma_pago),''), '')),
      coalesce(nullif(trim(p_referencia),''), ''),
      coalesce(p_fecha_pago, current_date)::text
    )::text
  );
$$;

-- ── registrar_pago_previo — cuerpo original de la 164 ─────────────────────────────
create or replace function public.registrar_pago_previo(
  p_cotizacion_id bigint,
  p_valor numeric,
  p_moneda text,
  p_trm numeric,
  p_forma_pago text,
  p_referencia text,
  p_fecha_pago date,
  p_usuario_id uuid,
  p_idempotency_key text,
  p_snapshot jsonb default null,
  p_exigido_total_moneda numeric default null,
  p_pct_efectivo numeric default null
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_moneda_cot text;
  v_precio_venta numeric;
  v_congelada timestamptz;
  v_trm_congelada numeric;
  v_moneda_congelada text;
  v_precio_congelado numeric;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_huella text := public._huella_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_forma_pago, p_referencia, p_fecha_pago);
  v_ex_id bigint;
  v_ex_huella text;
  v_suma numeric;
  v_tot_cop numeric;
  v_monto_cop numeric;
  v_email text;
  v_pago_id bigint;
  v_numero bigint;
  v_caja text := public._cuenta_disponible(p_forma_pago, p_moneda);
  v_anticipo bigint;
begin
  if v_key is null then
    raise exception 'Se requiere una clave de idempotencia para registrar un pago previo.';
  end if;
  if not (coalesce(p_valor,0) > 0) then
    raise exception 'El valor del pago debe ser mayor a cero.';
  end if;
  if nullif(trim(coalesce(p_forma_pago,'')),'') is null then
    raise exception 'Indica la forma de pago.';
  end if;

  -- 1) Lock + releer estado/congelado.
  select tenant, moneda, precio_venta, condicion_pago_congelada_en
    into v_tenant, v_moneda_cot, v_precio_venta, v_congelada
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  -- 2) estado + moneda.
  if exists (select 1 from public.cotizaciones where id = p_cotizacion_id and estado <> 'abierta') then
    raise exception 'La cotización % no está abierta (no se puede registrar un pago previo).', p_cotizacion_id;
  end if;
  if upper(coalesce(p_moneda,'')) <> upper(coalesce(v_moneda_cot,'COP')) then
    raise exception 'La moneda del pago (%) no coincide con la de la cotización (%).', p_moneda, v_moneda_cot;
  end if;

  -- 3) IDEMPOTENCIA (B1): misma clave ya usada → recuperar el resultado original
  --    SI la huella canónica de esta solicitud es idéntica a la registrada. Si
  --    CUALQUIER dato material difiere (cotización, monto, moneda, forma/banco
  --    destino, referencia, fecha), la clave se rechaza (fail-closed).
  select id, huella_solicitud
    into v_ex_id, v_ex_huella
  from public.cotizacion_pagos_previos where idempotency_key = v_key for update;
  if v_ex_id is not null then
    if v_ex_huella is distinct from v_huella then
      raise exception 'La clave de idempotencia ya se usó para un pago con datos distintos: no se reutiliza. Reintenta con una clave nueva o verifica si el pago ya se confirmó.';
    end if;
    return 'OK|' || v_ex_id;
  end if;

  -- 4) PRIMER pago: escribir snapshot + resumen y congelar (todo en una tx).
  if v_congelada is null then
    v_trm_congelada := case when upper(coalesce(p_moneda,'')) = 'COP' then 1 else coalesce(nullif(p_trm,0),1) end;
    if p_snapshot is null or p_exigido_total_moneda is null then
      raise exception 'Primer pago: falta el snapshot de condiciones para congelar la cotización.';
    end if;
    delete from public.cotizacion_condiciones where cotizacion_id = p_cotizacion_id;
    insert into public.cotizacion_condiciones
      (cotizacion_id, orden, tipo_componente, referencia_externa, valor_componente,
       condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
       condicion_pago_fecha_limite, monto_exigido, restriccion_comercial,
       hotel_temporada_id, paquete_id, programa_id, congelado)
    select p_cotizacion_id,
           coalesce((r->>'orden')::int, 0),
           r->>'tipo_componente',
           nullif(r->>'referencia_externa',''),
           coalesce((r->>'valor_componente')::numeric, 0),
           coalesce(r->>'condicion_pago_tipo','sin_condicion'),
           nullif(r->>'condicion_pago_pct_aplicable','')::numeric,
           nullif(r->>'condicion_pago_dias_saldo','')::int,
           nullif(r->>'condicion_pago_fecha_limite','')::date,
           coalesce((r->>'monto_exigido')::numeric, 0),
           coalesce(r->>'restriccion_comercial','normal'),
           nullif(r->>'hotel_temporada_id','')::bigint,
           nullif(r->>'paquete_id','')::bigint,
           nullif(r->>'programa_id','')::bigint,
           true
    from jsonb_array_elements(p_snapshot) r;
    update public.cotizaciones set
      condicion_pago_congelada_en = now(),
      moneda_congelada = upper(p_moneda),
      trm_autoritativa = v_trm_congelada,
      precio_total_congelado = v_precio_venta,
      monto_exigido_total = p_exigido_total_moneda,
      monto_exigido_total_cop = round(p_exigido_total_moneda * v_trm_congelada, 2),
      pct_efectivo_informativo = p_pct_efectivo
    where id = p_cotizacion_id;
  end if;

  -- 5) Ya congelada (o recién): reutilizar EXACTAMENTE snapshot/TRM/precio.
  select trm_autoritativa, moneda_congelada, precio_total_congelado
    into v_trm_congelada, v_moneda_congelada, v_precio_congelado
  from public.cotizaciones where id = p_cotizacion_id;
  if upper(coalesce(p_moneda,'')) <> upper(coalesce(v_moneda_congelada,'')) then
    raise exception 'Moneda del pago % no coincide con la congelada % de la cotización.', p_moneda, v_moneda_congelada;
  end if;
  v_monto_cop := round(p_valor * v_trm_congelada, 2);

  -- 6) Sobrepago (COP vs COP con la TRM congelada).
  select coalesce(sum(monto_cop),0) into v_suma
  from public.cotizacion_pagos_previos
  where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado');
  v_tot_cop := round(coalesce(v_precio_congelado,0) * v_trm_congelada, 2);
  if v_suma + v_monto_cop > v_tot_cop + 0.005 then
    raise exception 'Sobrepago rechazado: ya hay % pagados y % excede el total % de la cotización.', v_suma, v_monto_cop, v_tot_cop;
  end if;

  -- 7) Insertar el pago + asiento.
  select email into v_email from public.usuarios where id = p_usuario_id;

  insert into public.cotizacion_pagos_previos
    (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, trm, forma_pago,
     referencia, fecha_pago, registrado_por_id, registrado_por_email,
     idempotency_key, huella_solicitud)
  values
    (p_cotizacion_id, v_tenant, v_monto_cop, p_valor, upper(p_moneda), v_trm_congelada,
     p_forma_pago, nullif(trim(coalesce(p_referencia,'')),''),
     coalesce(p_fecha_pago, current_date), p_usuario_id, v_email, v_key, v_huella)
  returning id into v_pago_id;

  v_numero := public._siguiente_numero_asiento(v_tenant);
  v_anticipo := public._puc_id(v_tenant, '280510');
  insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
  values (v_tenant, v_numero, coalesce(p_fecha_pago, current_date),
    'Pago previo a cotización ' || p_cotizacion_id || ' (' || p_moneda || ')',
    'pago_previo', 'pago_previo:' || v_pago_id, v_email);
  insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
  values
    (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
     public._puc_id(v_tenant, v_caja), 'cotizacion:' || p_cotizacion_id, 'Pago previo recibido', v_monto_cop, 0),
    (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
     v_anticipo, 'cotizacion:' || p_cotizacion_id, 'Anticipo sin identificar', 0, v_monto_cop);

  return 'OK|' || v_pago_id;
exception when unique_violation then
  raise exception 'Clave de idempotencia ya registrada (intento duplicado o colisión): no se duplicó el pago. Reintenta o verifica si ya se confirmó.' using errcode = '23505';
end;
$$;

-- ── anular_pago_previo — cuerpo original de la 164 ────────────────────────────────
create or replace function public.anular_pago_previo(
  p_pago_id bigint,
  p_usuario_id uuid,
  p_motivo text default null
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_email text;
  v_estado text;
  v_monto numeric;
  v_moneda text;
  v_forma text;
  v_cotizacion bigint;
  v_numero bigint;
  v_caja text;
  v_anticipo bigint;
  v_activo_id bigint;
begin
  select tenant, estado, monto_cop, moneda, forma_pago, cotizacion_id
    into v_tenant, v_estado, v_monto, v_moneda, v_forma, v_cotizacion
  from public.cotizacion_pagos_previos where id = p_pago_id for update;
  if v_tenant is null then raise exception 'El pago previo % no existe.', p_pago_id; end if;
  if v_estado <> 'activo' then raise exception 'Solo se puede anular un pago previo ACTIVO (estado actual: %).', v_estado; end if;

  select email into v_email from public.usuarios where id = p_usuario_id;

  -- Reversa: líneas invertidas del asiento original 'pago_previo:<id>'.
  select id into v_activo_id from public.asientos_contables
  where tenant = v_tenant and origen = 'pago_previo' and referencia = 'pago_previo:' || p_pago_id
  order by numero desc limit 1;
  if v_activo_id is not null then
    v_numero := public._siguiente_numero_asiento(v_tenant);
    v_caja := public._cuenta_disponible(v_forma, v_moneda);
    v_anticipo := public._puc_id(v_tenant, '280510');
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_numero, current_date,
      'Reversión pago previo ' || p_pago_id || ' — ' || coalesce(nullif(trim(coalesce(p_motivo,'')),''), 'anulación'),
      'pago_previo_reversion', 'pago_previo:' || p_pago_id, v_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo, 'pago_previo:' || p_pago_id, 'Reversión de anticipo sin identificar', coalesce(v_monto,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       public._puc_id(v_tenant, v_caja), 'pago_previo:' || p_pago_id, 'Reversión de pago previo', 0, coalesce(v_monto,0));
  end if;

  update public.cotizacion_pagos_previos
  set estado = 'anulado', motivo_anulacion = p_motivo
  where id = p_pago_id;

  return 'OK';
end;
$$;

-- ── transferir_pagos_previos_a_abonos — cuerpo original de la 164 ─────────────────
create or replace function public.transferir_pagos_previos_a_abonos(
  p_cotizacion_id bigint,
  p_numero_contrato text,
  p_usuario_id uuid
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_email text;
  v_cliente text;
  v_estado text;
  v_num_ok bigint;
  v_numero bigint;
  v_anticipo_sin bigint;
  v_anticipo_con bigint;
  r record;
begin
  select tenant, estado, cliente into v_tenant, v_estado, v_cliente
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then raise exception 'La cotización % no existe.', p_cotizacion_id; end if;
  if v_estado <> 'convertida' then
    raise exception 'La cotización % no está convertida (estado: %) — la transferencia a abonos exige el contrato ya creado.', p_cotizacion_id, v_estado;
  end if;

  -- El contrato debe existir y apuntar a ESTA cotización (UNO-A-UNO).
  select count(*) into v_num_ok
  from public.ventas where numero_contrato = p_numero_contrato and cotizacion_id = p_cotizacion_id;
  if v_num_ok = 0 then
    raise exception 'El contrato % no corresponde a la cotización % (o no existe).', p_numero_contrato, p_cotizacion_id;
  end if;

  select email into v_email from public.usuarios where id = p_usuario_id;

  v_anticipo_sin := public._puc_id(v_tenant, '280510');
  v_anticipo_con := public._puc_id(v_tenant, '280505');

  for r in
    select * from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado = 'activo'
    order by id
    for update
  loop
    -- 1) Abono real del contrato (monto en COP, mismo trm del pago).
    insert into public.abonos
      (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia, recibido_por, trm, monto_cop, tenant)
    values
      (p_numero_contrato, coalesce(v_cliente, ''),
       r.fecha_pago, r.monto_cop, r.forma_pago, r.referencia, v_email, r.trm, r.monto_cop, v_tenant)
    returning id into v_num_ok;

    -- 2) Reclasificación contable: Debe 280510 / Haber 280505 (tercero = contrato).
    v_numero := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_numero, current_date,
      'Aplicación pago previo a contrato ' || p_numero_contrato,
      'pago_previo_aplicacion', 'pago_previo:' || r.id || ':abono:' || v_num_ok, v_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo_sin, p_numero_contrato, 'Anticipo sin identificar aplicado', coalesce(r.monto_cop,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo_con, p_numero_contrato, 'Anticipo de cliente del contrato', 0, coalesce(r.monto_cop,0));

    -- 3) Marcar aplicado.
    update public.cotizacion_pagos_previos
    set estado = 'aplicado', abono_id = v_num_ok
    where id = r.id;
  end loop;

  return 'OK';
end;
$$;

-- ── convertir_cotizacion_a_contrato — cuerpo original de la 164 ───────────────────
create or replace function public.convertir_cotizacion_a_contrato(
  p_cotizacion_id bigint,
  p_usuario_id uuid
) returns text language plpgsql as $$
declare
  -- actor
  v_rol            text;
  v_actor_tenant   text;
  v_actor_email    text;
  -- cotización (re-lectura bajo lock)
  v_tenant         text;
  v_estado         text;
  v_tipo           text;
  v_congelada      timestamptz;
  v_moneda_cong    text;
  v_trm_cong       numeric;
  v_precio_cong    numeric;
  v_exigido_cop    numeric;
  v_cliente        text;
  v_cliente_doc    text;
  v_destino        text;
  v_fsalida        date;
  v_fregreso       date;
  v_pax            int;
  v_precio         numeric;
  v_moneda         text;
  v_asesor         text;
  v_payload        jsonb;
  v_detalle        jsonb;
  -- idempotencia
  v_existente      text;
  -- derivados
  v_tipo_asesor    text;
  v_agencia_nombre text;
  v_freelance_nombre text;
  v_observ         text;
  v_nombre_cliente text;
  v_t_doc          text;
  v_t_numero       text;
  v_t_nacimiento   text;
  v_nNinos         int;
  v_valorNino      numeric;
  v_totalNinos     numeric;
  v_recN           numeric;
  v_recEmp         numeric;
  v_recAli         numeric;
  v_esB2B          boolean;
  v_plan_nombre    text;
  v_tours          text;
  v_asist_med      boolean;
  v_costo_aereo    numeric;
  v_costo_hotel    numeric;
  v_costo_recept   numeric;
  v_costo_asist    numeric;
  v_costo_otro     numeric;
  v_hotel_venta    text;
  -- mín / número / item
  v_pagado         numeric;
  v_numero         text;
  v_pax_ad         int;
  v_adultSubtotal  numeric;
  v_tarifaAd       numeric;
  v_item_desc      text;
  v_dest_u         text;
  v_aliado_nombre  text;
  -- bucles
  r_pago           record;
  r_serv           record;
  -- CxP / asiento
  v_cxp_id         bigint;
  v_tipo_prov      text;
  v_proveedor      text;
  v_etiqueta       text;
  v_servicio       text;
  v_ret_aplica     boolean;
  v_ret_pct        numeric;
  v_hoy            date;
  v_codigos        text[];
  v_cuenta_cost    bigint;
  v_cuenta_prov    bigint;
  v_num_asiento    bigint;
  -- pago→abono
  v_abono_id       bigint;
  v_anticipo_sin   bigint;
  v_anticipo_con   bigint;
begin
  -- 1) Autorización (rol interno + activo) y datos del actor.
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select tenant, email into v_actor_tenant, v_actor_email
  from public.usuarios where id = p_usuario_id;

  -- 2) Lock de la cotización + RE-lectura (serializa pagos/conversiones).
  select tenant, estado, tipo, condicion_pago_congelada_en, moneda_congelada,
         trm_autoritativa, precio_total_congelado, monto_exigido_total_cop,
         cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
         pax, precio_venta, moneda, asesor, payload, detalle
    into v_tenant, v_estado, v_tipo, v_congelada, v_moneda_cong,
         v_trm_cong, v_precio_cong, v_exigido_cop,
         v_cliente, v_cliente_doc, v_destino, v_fsalida, v_fregreso,
         v_pax, v_precio, v_moneda, v_asesor, v_payload, v_detalle
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  v_payload := coalesce(v_payload, '{}'::jsonb);
  v_detalle := coalesce(v_detalle, '{}'::jsonb);

  -- 2bis) Tenant AUTORITATIVO, ANTES de la idempotencia y de escribir.
  -- superadmin = excepción global documentada (puede_ver_tenant lo incluye).
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant;
  end if;

  -- 3) Idempotencia: si ya se convirtió a UN contrato, devolverlo (replay / ya
  --    convertida). Ocurre bajo el lock y tras el cheque de tenant, así que un
  --    replay desde tenant ajeno se rechaza antes de tocar la venta existente.
  select numero_contrato into v_existente
  from public.ventas where cotizacion_id = p_cotizacion_id;
  if v_existente is not null then
    return v_existente;
  end if;

  -- 4) Frontera reutilizable: solo manual (raise si no).
  perform public._tipo_cotizacion_convertible(v_tipo);

  -- 5) Estado admitido + congelado OBLIGATORIO (fail-closed). El mínimo de abajo
  --    se mide contra el monto exigido CONGELADO en COP.
  if v_estado <> 'abierta' then
    raise exception 'La cotización % no está abierta (estado: %) — no se puede convertir.', p_cotizacion_id, v_estado;
  end if;
  if v_congelada is null or v_moneda_cong is null or v_trm_cong is null
     or v_precio_cong is null or v_exigido_cop is null then
    raise exception 'La cotización % no está congelada (falta snapshot/moneda/TRM/precio o monto exigido). Registra el pago previo que congela la condición antes de convertir.', p_cotizacion_id;
  end if;

  -- 5bis) Titular OBLIGATORIO (va como pasajero del contrato).
  v_nombre_cliente := btrim(coalesce(v_payload#>>'{cliente,nombres}','') || ' ' || coalesce(v_payload#>>'{cliente,apellidos}',''));
  v_t_doc        := btrim(coalesce(v_payload#>>'{cliente,tipoDoc}',''));
  v_t_numero     := btrim(coalesce(v_payload#>>'{cliente,numeroDoc}',''));
  v_t_nacimiento := btrim(coalesce(v_payload#>>'{cliente,nacimiento}',''));
  if v_nombre_cliente = '' or v_t_doc = '' or v_t_numero = '' or v_t_nacimiento = '' then
    raise exception 'Completa los datos del titular antes de generar el contrato: nombre, tipo de documento, número de documento y fecha de nacimiento.';
  end if;

  -- 6) Mínimo: Σ monto_cop de pagos válidos ≥ exigido congelado (anulados NO).
  --    Bloqueamos las filas de pago CONTADAS para serializar con un anular
  --    concurrente (anular_pago_previo bloquea el pago, no la cotización).
  for r_pago in
    select id from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado')
    order by id for update
  loop
    null; -- lock adquirido
  end loop;
  v_pagado := public._monto_cop_pagado(p_cotizacion_id);
  if v_pagado < v_exigido_cop then
    raise exception 'La cotización % no alcanza el mínimo exigido: pagado % COP < exigido % COP (los pagos anulados no cuentan).',
      p_cotizacion_id, v_pagado, v_exigido_cop;
  end if;

  -- 7) Número UNA sola vez (función real con nextval), tras la idempotencia.
  v_numero := public.siguiente_numero_contrato_para_tenant(v_tenant);

  -- Derivados equivalentes al builder manual.
  v_tipo_asesor      := coalesce(v_payload->>'tipoAsesor', 'interno');
  v_agencia_nombre   := v_payload->>'agenciaNombre';
  v_freelance_nombre := v_payload->>'freelanceNombre';
  v_observ           := nullif(v_payload->>'observaciones', '');
  v_pax              := coalesce(v_pax, 0);
  v_precio           := coalesce(v_precio, 0);
  v_moneda           := coalesce(v_moneda, 'COP');

  -- Niños y recobro (mismo cálculo que crear/editar; el recobro va oculto en la
  -- tarifa de adulto). totalNinos = cantidad × tarifa; recobro repartido B2B.
  v_nNinos     := greatest(floor(coalesce((v_payload->>'ninos')::numeric, 0)), 0)::int;
  v_valorNino  := greatest(coalesce((v_payload->>'tarifaNino')::numeric, 0), 0);
  v_totalNinos := v_nNinos * v_valorNino;
  v_recN       := greatest(coalesce((v_payload->>'recobro')::numeric, 0), 0);
  v_esB2B      := v_tipo_asesor <> 'interno';
  v_recAli     := case when v_esB2B then least(greatest(coalesce((v_payload->>'recobroAliado')::numeric, 0), 0), v_recN) else 0 end;
  v_recEmp     := v_recN - v_recAli;

  -- Cajas "Hoteles y Servicios" + costos netos por tipo (cotizacion_servicios).
  select coalesce(string_agg(btrim(coalesce(s.nombre_servicio,'')), ', ' order by s.orden), null)
    into v_plan_nombre
  from public.cotizacion_servicios s
  where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'hotel'
    and btrim(coalesce(s.nombre_servicio,'')) <> '';
  select coalesce(string_agg(btrim(coalesce(s.nombre_servicio,'')), ', ' order by s.orden), null)
    into v_tours
  from public.cotizacion_servicios s
  where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'traslado'
    and btrim(coalesce(s.nombre_servicio,'')) <> '';
  select exists(select 1 from public.cotizacion_servicios s
                where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'asistencia')
    into v_asist_med;
  select
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='aereo'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='hotel'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='traslado'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='asistencia'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='otro'), 0)
    into v_costo_aereo, v_costo_hotel, v_costo_recept, v_costo_asist, v_costo_otro
  from public.cotizacion_servicios s where s.cotizacion_id = p_cotizacion_id;

  -- Hotel/Aerolínea del snapshot (igual que el builder: plan_nombre manda sobre
  -- detalle.venta.hotel; aerolinea solo desde detalle.venta).
  v_hotel_venta := coalesce(nullif(v_plan_nombre,''), nullif(v_detalle->'venta'->>'hotel',''));

  -- 8) Crear la VENTA (reproducción fiel del builder manual + cotizacion_id).
  insert into public.ventas (
    numero_contrato, tenant, cliente, cliente_documento, cliente_telefono, destino,
    tipo_paquete, fecha_salida, fecha_regreso, pax, precio_venta, moneda, asesor,
    canal, tipo_cliente, hotel, aerolinea, plan_nombre, tours_traslados,
    asistencia_medica, costo_aereo, costo_hotel, costo_receptivo, costo_asistencia,
    otros_costos, recobro_total, recobro_empresa, recobro_aliado, comision_b2b,
    comision_estado, estado, observaciones, cotizacion_id
  ) values (
    v_numero, v_tenant, coalesce(v_cliente,''), nullif(v_cliente_doc,''),
    nullif(v_payload#>>'{cliente,telefono}',''), nullif(v_destino,''),
    'dinamico', v_fsalida, v_fregreso, nullif(v_pax,0), nullif(v_precio,0), v_moneda,
    nullif(v_asesor,''),
    case when v_tipo_asesor = 'interno' then 'B2C' else 'B2B' end,
    nullif(v_tipo_asesor,''), nullif(v_hotel_venta,''),
    nullif(v_detalle->'venta'->>'aerolinea',''), nullif(v_plan_nombre,''),
    nullif(v_tours,''), coalesce(v_asist_med,false),
    v_costo_aereo, v_costo_hotel, v_costo_recept, v_costo_asist, v_costo_otro,
    v_recN, v_recEmp, v_recAli,
    case when v_recAli > 0 then v_recAli else null end,
    case when v_recAli > 0 then 'pendiente' else null end,
    'pendiente', v_observ, p_cotizacion_id
  );

  -- 9) Ítem del paquete: adultos + niños. tarifa_adulto incluye el recobro (oculto).
  v_pax_ad        := greatest(v_pax, 1);
  v_adultSubtotal := v_precio - v_totalNinos;
  v_tarifaAd      := round(v_adultSubtotal / v_pax_ad);
  v_dest_u        := upper(btrim(coalesce(v_destino,'')));
  v_dest_u        := case when v_dest_u = '' then 'DESTINO' else v_dest_u end;
  v_item_desc     := 'PAQUETE TURÍSTICO A ' || v_dest_u || ' DEL '
                     || coalesce(to_char(v_fsalida,'DD/MM/YYYY'),'—') || ' AL '
                     || coalesce(to_char(v_fregreso,'DD/MM/YYYY'),'—');
  insert into public.contrato_items
    (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
  values
    (v_numero, v_item_desc, v_pax_ad, v_nNinos, v_tarifaAd, v_valorNino, 0);

  -- Titular como pasajero del contrato.
  insert into public.contrato_pasajeros
    (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
  values
    (v_numero, v_nombre_cliente, coalesce(nullif(v_t_doc,''),'CC'), nullif(v_t_numero,''),
     nullif(v_t_nacimiento,'')::date, false, 0);

  -- Comisión del aliado B2B por el recobro (entra al módulo de comisiones).
  if v_esB2B and v_recAli > 0 then
    v_aliado_nombre := coalesce(nullif(case when v_tipo_asesor='agencia' then v_agencia_nombre else v_freelance_nombre end,''),
                                nullif(coalesce(v_asesor,''),''), 'Aliado');
    insert into public.aliados_b2b
      (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision,
       recobro_total, pct_recobro_aliado, estado)
    values
      (v_numero, v_tenant, v_aliado_nombre, v_tipo_asesor, v_precio, v_recAli,
       v_recN, case when v_recN > 0 then v_recAli / v_recN else 0 end, 'pendiente');
  end if;

  -- 10) Copiar condiciones congeladas → contrato_condiciones (snapshot por fila).
  insert into public.contrato_condiciones (
    numero_contrato, tipo_componente, referencia_externa, orden, valor_componente,
    condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
    condicion_pago_fecha_limite, monto_exigido, restriccion_comercial, moneda, trm
  )
  select v_numero, c.tipo_componente, c.referencia_externa, c.orden, c.valor_componente,
         c.condicion_pago_tipo, c.condicion_pago_pct_aplicable, c.condicion_pago_dias_saldo,
         c.condicion_pago_fecha_limite, c.monto_exigido, c.restriccion_comercial,
         v_moneda_cong, v_trm_cong
  from public.cotizacion_condiciones c
  where c.cotizacion_id = p_cotizacion_id;

  -- 11) Transferir pagos ACTIVOS → ABONOS + reclasificar 280510→280505 + marcar.
  v_anticipo_sin := public._puc_id(v_tenant, '280510');
  v_anticipo_con := public._puc_id(v_tenant, '280505');
  for r_pago in
    select * from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado = 'activo'
    order by id for update
  loop
    insert into public.abonos
      (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia,
       recibido_por, trm, monto_cop, tenant)
    values
      (v_numero, coalesce(v_cliente,''), r_pago.fecha_pago, r_pago.monto_cop,
       r_pago.forma_pago, r_pago.referencia, v_actor_email, r_pago.trm,
       r_pago.monto_cop, v_tenant)
    returning id into v_abono_id;

    v_num_asiento := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num_asiento, current_date,
      'Aplicación pago previo a contrato ' || v_numero,
      'pago_previo_aplicacion', 'pago_previo:' || r_pago.id || ':abono:' || v_abono_id, v_actor_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_anticipo_sin, v_numero, 'Anticipo sin identificar aplicado', coalesce(r_pago.monto_cop,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_anticipo_con, v_numero, 'Anticipo de cliente del contrato', 0, coalesce(r_pago.monto_cop,0));

    update public.cotizacion_pagos_previos
    set estado = 'aplicado', abono_id = v_abono_id
    where id = r_pago.id;
  end loop;

  -- 12) CxP de proveedor + asientos Debe Costo / Haber Proveedores. Equivalencia
  --     de postearAsientoCxP. FALLO ATÓMICO (sin try/catch): cualquier cuenta
  --     ausente revierte toda la conversión. Proveedor = (proveedor o plataforma);
  --     retención por match de nombre en el catálogo (que NO lleva tenant).
  v_hoy := current_date;
  for r_serv in
    select * from public.cotizacion_servicios
    where cotizacion_id = p_cotizacion_id and (coalesce(costo_neto,0)) > 0
    order by orden
  loop
    v_tipo_prov := public._tipo_proveedor_cxp(r_serv.tipo_servicio);
    v_proveedor := coalesce(nullif(btrim(coalesce(r_serv.proveedor,'')), ''),
                            nullif(btrim(coalesce(r_serv.plataforma,'')), ''));
    v_etiqueta  := case coalesce(r_serv.tipo_servicio,'')
      when 'aereo' then 'Aéreo'
      when 'hotel' then 'Hotel'
      when 'traslado' then 'Traslado'
      when 'asistencia' then 'Asistencia médica'
      when 'otro' then 'Otro'
      else 'Servicio' end;
    v_servicio  := btrim(coalesce(v_etiqueta,'') || case when btrim(coalesce(r_serv.nombre_servicio,'')) <> '' then ' ' || btrim(r_serv.nombre_servicio) else '' end);

    -- Retención del catálogo por nombre (coincidencia exacta trim+lower).
    v_ret_aplica := false;
    v_ret_pct    := 0;
    if v_proveedor is not null then
      select coalesce(p.aplica_retencion,false), coalesce(p.pct_retencion,0)
        into v_ret_aplica, v_ret_pct
      from public.proveedores p
      where lower(btrim(p.nombre)) = lower(btrim(v_proveedor))
      order by p.id limit 1;
    end if;

    insert into public.cuentas_por_pagar
      (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total,
       moneda, fecha_obligacion, fecha_vencimiento, aplica_retencion, pct_retencion,
       observaciones)
    values
      (v_numero, v_tenant, v_proveedor, v_tipo_prov, v_servicio,
       greatest(0, coalesce(r_serv.costo_neto,0)), v_moneda, v_hoy, v_fsalida,
       v_ret_aplica, v_ret_pct, 'Generado automáticamente desde cotización dinámica')
    returning id into v_cxp_id;

    -- Asiento de la CxP (reemplazar es no-op en una conversión fresca, se deja
    -- por fidelidad a postearAsientoCxP): Debe Costo / Haber Proveedores.
    v_codigos     := public._cuentas_cxp(v_tipo_prov);  -- [1]=Proveedores, [2]=Costo
    v_cuenta_prov := public._puc_id(v_tenant, v_codigos[1]);
    v_cuenta_cost := public._puc_id(v_tenant, v_codigos[2]);
    v_num_asiento := public._siguiente_numero_asiento(v_tenant);
    delete from public.asientos_contables
    where tenant = v_tenant and origen = 'cxp' and referencia = 'cxp:' || v_cxp_id;
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num_asiento, v_hoy,
      coalesce(nullif(v_servicio,''),'Costo') || ' — ' || coalesce(v_proveedor,'Sin especificar') || ' (' || v_numero || ')',
      'cxp', 'cxp:' || v_cxp_id, v_actor_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_cuenta_cost, v_numero, v_servicio, greatest(0, coalesce(r_serv.costo_neto,0)), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_cuenta_prov, v_proveedor, v_servicio, 0, greatest(0, coalesce(r_serv.costo_neto,0)));
  end loop;

  -- 13) Enlazar + estado + número en el detalle (snapshot del documento).
  v_detalle := jsonb_set(v_detalle, '{venta,numero_contrato}', to_jsonb(v_numero));
  update public.cotizaciones
  set estado = 'convertida',
      numero_contrato = v_numero,
      condicion_pago_congelada_en = coalesce(v_congelada, now()),
      detalle = v_detalle
  where id = p_cotizacion_id;

  return v_numero;
end;
$$;
-- Sin CASCADE: si otro objeto empezó a usar fecha_negocio() después de la 198,
-- el DROP falla y la transacción entera se revierte (nada a medias).
drop function public.fecha_negocio(timestamptz);

commit;
