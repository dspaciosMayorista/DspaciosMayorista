-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBA · #35 · EQUIVALENCIA FINANCIERA PVP de la hija manual.
-- SOLO base LOCAL DESECHABLE con las migraciones 001–211. ROLLBACK al final.
--
-- Decisión del dueño: la hija manual se convierte por el RPC 198 INTACTO, en PVP.
-- Esta prueba NO supone que la hija "hereda" #358: lo demuestra. Para cada
-- escenario:
--   1. se crea una madre y se elige una opción → hija H;
--   2. se arma una cotización SIMPLE S con EL MISMO contenido que H pero sin
--      ninguna columna de comparativa (es lo que produciría el flujo manual de hoy);
--   3. a H y a S se les registra el mismo pago previo y se convierten por
--      public.convertir_cotizacion_a_contrato (198, sin tocar);
--   4. se comparan, normalizando ids/números: venta, ítems, pasajero, condiciones,
--      abonos, CxP, comisión del aliado y TODOS los asientos;
--   5. se factura cada contrato con facturar_factura (208) y se comparan sus asientos.
-- Si la hija difiriera en algo económico, esta prueba lo mostraría.
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_211_fixtures.sql

create schema t211e;

-- Huella económica normalizada de un contrato (sin ids, fechas de creación ni su propio número).
create function t211e.huella(p_numero text, p_cot bigint) returns jsonb
language plpgsql as $$
declare
  v_quitar text[] := array['id','numero_contrato','created_at','updated_at','cotizacion_id','abono_id','fecha_registro','financiero_registrado_en','share_token','codigo'];
  r jsonb := '{}'::jsonb; v_sec jsonb; v_ref text;
begin
  v_ref := p_numero;
  -- ventas
  select jsonb_agg(replace(((to_jsonb(v) - v_quitar)::text), p_numero, '#')::jsonb) into v_sec from public.ventas v where v.numero_contrato = p_numero;
  r := r || jsonb_build_object('ventas', v_sec);
  -- hijas del contrato
  select jsonb_agg(x order by x::text) into v_sec from (select replace(((to_jsonb(t) - v_quitar)::text), p_numero, '#')::jsonb x from public.contrato_items t where t.numero_contrato = p_numero) q;
  r := r || jsonb_build_object('items', v_sec);
  select jsonb_agg(x order by x::text) into v_sec from (select replace(((to_jsonb(t) - v_quitar)::text), p_numero, '#')::jsonb x from public.contrato_pasajeros t where t.numero_contrato = p_numero) q;
  r := r || jsonb_build_object('pasajeros', v_sec);
  select jsonb_agg(x order by x::text) into v_sec from (select replace(((to_jsonb(t) - v_quitar)::text), p_numero, '#')::jsonb x from public.contrato_condiciones t where t.numero_contrato = p_numero) q;
  r := r || jsonb_build_object('condiciones', v_sec);
  select jsonb_agg(x order by x::text) into v_sec from (select replace(((to_jsonb(t) - v_quitar)::text), p_numero, '#')::jsonb x from public.abonos t where t.numero_contrato = p_numero) q;
  r := r || jsonb_build_object('abonos', v_sec);
  select jsonb_agg(x order by x::text) into v_sec from (select replace(((to_jsonb(t) - v_quitar)::text), p_numero, '#')::jsonb x from public.cuentas_por_pagar t where t.numero_contrato = p_numero) q;
  r := r || jsonb_build_object('cxp', v_sec);
  select jsonb_agg(x order by x::text) into v_sec from (select replace(((to_jsonb(t) - v_quitar)::text), p_numero, '#')::jsonb x from public.aliados_b2b t where t.numero_contrato = p_numero) q;
  r := r || jsonb_build_object('aliados_b2b', v_sec);
  -- pagos previos de la cotización de origen (estado y montos, no ids)
  select jsonb_agg(x order by x::text) into v_sec from (
    select jsonb_build_object('monto_cop', p.monto_cop, 'monto_moneda', p.monto_moneda, 'moneda', p.moneda, 'trm', p.trm,
                              'forma', p.forma_pago, 'ref', p.referencia, 'estado', p.estado, 'tiene_abono', p.abono_id is not null) x
      from public.cotizacion_pagos_previos p where p.cotizacion_id = p_cot) q;
  r := r || jsonb_build_object('pagos_previos', v_sec);
  -- asientos: de la CxP, de la aplicación del pago previo y el del propio pago previo
  select jsonb_agg(x order by x::text) into v_sec from (
    select jsonb_build_object('origen', a.origen,
              'desc', regexp_replace(replace(a.descripcion, p_numero, '#'), 'cotización [0-9]+', 'cotización #'),
              'cuenta', pc.codigo,
              'tercero', regexp_replace(replace(coalesce(l.tercero,''), p_numero, '#'), 'cotizacion:[0-9]+', 'cotizacion:#'),
              'ldesc', l.descripcion, 'debe', l.debe, 'haber', l.haber) x
      from public.asientos_contables a
      join public.asiento_lineas l on l.asiento_id = a.id
      join public.puc_cuentas pc on pc.id = l.cuenta_id
     where a.referencia in (select 'cxp:' || c.id from public.cuentas_por_pagar c where c.numero_contrato = p_numero)
        or a.referencia in (select 'pago_previo:' || p.id from public.cotizacion_pagos_previos p where p.cotizacion_id = p_cot)
        or a.referencia like any (select 'pago_previo:' || p.id || ':abono:%' from public.cotizacion_pagos_previos p where p.cotizacion_id = p_cot)
        or a.referencia like 'facturacion:' || p_numero || '%'
        or a.referencia like 'facturacion_reversion:' || p_numero || '%') q;
  r := r || jsonb_build_object('asientos', v_sec);
  return r;
end $$;

-- Cotización simple S = mismo contenido que la hija H, sin ninguna columna de comparativa.
create function t211e.simple_como(p_hija bigint) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into public.cotizaciones (tenant, tipo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
      plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por)
  select tenant, tipo, 'abierta', payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre, pax,
         precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por
    from public.cotizaciones where id = p_hija
  returning id into v;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor,
      costo_neto, modo, pct_markup, ta, valor, opcion_ref)
  select v, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto, modo, pct_markup, ta, valor, null
    from public.cotizacion_servicios where cotizacion_id = p_hija;
  return v;
end $$;

-- Pago previo idéntico + conversión por el 198 (devuelve el número de contrato).
create function t211e.pagar_y_convertir(p_cot bigint, p_uid uuid) returns text
language plpgsql as $$
declare v_snap jsonb; v_num text;
begin
  v_snap := jsonb_build_array(
    jsonb_build_object('orden', 0, 'tipo_componente', 'hotel', 'referencia_externa', 'Hotel', 'valor_componente', 500000,
       'condicion_pago_tipo', 'sin_condicion', 'monto_exigido', 100000, 'restriccion_comercial', 'normal'),
    jsonb_build_object('orden', 1, 'tipo_componente', 'servicio', 'referencia_externa', 'Traslados', 'valor_componente', 100000,
       'condicion_pago_tipo', 'sin_condicion', 'monto_exigido', 0, 'restriccion_comercial', 'normal'));
  perform public.registrar_pago_previo(p_cot, 500000, 'COP', 1, 'Transferencia', 'REF-EQ-' || 1, public.fecha_negocio(),
            p_uid, 'idem-eq-' || p_cot || '-a', v_snap, 100000, null);
  v_num := public.convertir_cotizacion_a_contrato(p_cot, p_uid);
  return v_num;
end $$;

-- Opciones con recobro/niños variables: total = Σ(servicios comunes + hotel) + recobro + niños.
create function t211e.madre(p_uid uuid, p_asesor text, p_rec numeric, p_rec_ali numeric, p_ninos int, p_tarifa_nino numeric, p_aliado bigint) returns bigint
language plpgsql as $$
declare
  v_cab jsonb; v_pay jsonb; v_ops jsonb; v_a numeric := 1600000 + p_rec + p_ninos * p_tarifa_nino; v_b numeric := 1800000 + p_rec + p_ninos * p_tarifa_nino;
  v_det jsonb;
begin
  v_pay := jsonb_build_object('tipoAsesor', p_asesor, 'agenciaNombre', case when p_asesor = 'agencia' then 'C211 Agencia A' else '' end,
     'freelanceNombre', '', 'pax', 2, 'ninos', p_ninos, 'tarifaNino', p_tarifa_nino, 'recobro', p_rec, 'recobroAliado', p_rec_ali,
     'cliente', jsonb_build_object('nombres', 'Cliente', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '1234567',
        'telefono', '3000000000', 'email', 'c@x.test', 'nacimiento', '1990-01-01'));
  v_cab := t211.cab_manual(p_asesor, case when p_asesor = 'agencia' then 'C211 Agencia A' else '' end) || jsonb_build_object('payload', v_pay);
  v_det := jsonb_build_object('pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'incluye', 'x', 'noIncluye', '',
     'recobro', jsonb_build_object('total', p_rec, 'empresa', p_rec - p_rec_ali, 'aliado', p_rec_ali), 'items', '[]'::jsonb);
  v_ops := jsonb_build_array(
    jsonb_build_object('opcion_ref', 'A', 'acomodacion_ref', 'unica', 'orden', 0, 'etiqueta', 'Hotel A', 'moneda', 'COP', 'tarifa_persona', 800000, 'total', v_a,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel A', 'total', v_a),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel A', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2, 'payload', v_pay,
          'detalle', v_det || jsonb_build_object('venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel A', 'precio_venta', v_a, 'estado', 'cotizacion')))),
    jsonb_build_object('opcion_ref', 'B', 'acomodacion_ref', 'unica', 'orden', 1, 'etiqueta', 'Hotel B', 'moneda', 'COP', 'tarifa_persona', 900000, 'total', v_b,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel B', 'total', v_b),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel B', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2, 'payload', v_pay,
          'detalle', v_det || jsonb_build_object('venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel B', 'precio_venta', v_b, 'estado', 'cotizacion')))));
  return public.crear_cotizacion_comparativa(p_uid, v_cab, t211.servicios_manual(), v_ops, p_aliado);
end $$;

create function t211e.elegir(p_madre bigint, p_uid uuid, p_op text, p_total numeric, p_clave text) returns bigint
language plpgsql as $$
declare rid uuid;
begin
  rid := public.registrar_validacion_comparativa(p_madre, p_op, 'unica', 1, 'interno', p_uid, p_total, 'COP', true, null);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  return public.elegir_opcion_comparativa_sesion(rid, p_clave);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- Escenarios'
do $$
declare
  admin_ uuid := '00000000-0000-0000-0000-000000211002';
  esc record; m bigint; h bigint; s bigint; nh text; ns text; hh jsonb; hs jsonb; k text;
  sec text; ok_all boolean;
begin
  for esc in select * from (values
      ('E1 interno PVP sin recobro',            'interno', 0::numeric,      0::numeric,     0, 0::numeric,     null::bigint),
      ('E2 interno PVP con recobro oculto',     'interno', 100000::numeric, 0::numeric,     0, 0::numeric,     null),
      ('E3 interno con niños y recobro',        'interno', 100000::numeric, 0::numeric,     1, 250000::numeric, null),
      ('E4 B2B agencia con recobro al aliado',  'agencia', 100000::numeric, 60000::numeric, 0, 0::numeric,     921101)
  ) v(nombre, asesor, rec, rec_ali, ninos, tarifa_nino, aliado) loop
    m := t211e.madre(admin_, esc.asesor, esc.rec, esc.rec_ali, esc.ninos, esc.tarifa_nino, esc.aliado);
    h := t211e.elegir(m, admin_, 'A', 1600000 + esc.rec + esc.ninos * esc.tarifa_nino, 'eq-clave-' || esc.nombre);
    s := t211e.simple_como(h);
    perform t211.afirma(esc.nombre || ' · la hija nace con el precio de su opción y la simple copia exactamente su contenido',
        (select precio_venta from public.cotizaciones where id = h) = 1600000 + esc.rec + esc.ninos * esc.tarifa_nino
        and (select precio_venta from public.cotizaciones where id = h) = (select precio_venta from public.cotizaciones where id = s));
    nh := t211e.pagar_y_convertir(h, admin_);
    ns := t211e.pagar_y_convertir(s, admin_);
    perform t211.afirma(esc.nombre || ' · ambas se convierten por el 198 y dan números distintos', nh is not null and ns is not null and nh <> ns);
    perform t211.afirma(esc.nombre || ' · la hija quedó convertida con su contrato; la madre sigue abierta, sin precio',
        (select estado = 'convertida' and numero_contrato = nh from public.cotizaciones where id = h)
        and (select estado = 'abierta' and precio_venta is null and numero_contrato is null from public.cotizaciones where id = m));
    hh := t211e.huella(nh, h);
    hs := t211e.huella(ns, s);
    ok_all := true;
    for sec in select jsonb_object_keys(hh) loop
      if hh->sec is distinct from hs->sec then
        ok_all := false;
        perform t211.afirma(esc.nombre || ' - equivalencia de ' || sec, false,
          'SOLO en hija=' || left(coalesce((select jsonb_agg(e)::text from jsonb_array_elements(coalesce(hh->sec,'[]'::jsonb)) e where not coalesce(hs->sec,'[]'::jsonb) @> jsonb_build_array(e)), 'null'), 700)
          || E'
 SOLO en simple=' || left(coalesce((select jsonb_agg(e)::text from jsonb_array_elements(coalesce(hs->sec,'[]'::jsonb)) e where not coalesce(hh->sec,'[]'::jsonb) @> jsonb_build_array(e)), 'null'), 700));
      else
        perform t211.afirma(esc.nombre || ' · equivalencia de «' || sec || '»', true);
      end if;
    end loop;
    perform t211.afirma(esc.nombre || ' · NO hay venta NETO: sin modo_compra ni aliado_id en la venta (NETO queda para el hotfix posterior)',
        (select modo_compra is null and aliado_id is null from public.ventas where numero_contrato = nh));
    perform t211.afirma(esc.nombre || ' · la CxP no incluye el hotel NO elegido (Hoteles B)',
        not exists (select 1 from public.cuentas_por_pagar where numero_contrato = nh and (proveedor = 'Hoteles B' or servicio ilike '%Hotel B%'))
        and (select count(*) from public.cuentas_por_pagar where numero_contrato = nh) = 3);
    perform t211.afirma(esc.nombre || ' · costos del contrato: aéreo+traslado comunes UNA vez, hotel de la opción',
        (select costo_aereo = 800000 and costo_receptivo = 80000 and costo_hotel = 400000 from public.ventas where numero_contrato = nh));
    perform t211.afirma(esc.nombre || ' · pagos previos de la madre: ninguno', not exists (select 1 from public.cotizacion_pagos_previos where cotizacion_id = m));
    if esc.rec_ali > 0 then
      perform t211.afirma(esc.nombre || ' · comisión del aliado por recobro creada en la hija (como en la simple)',
          exists (select 1 from public.aliados_b2b where numero_contrato = nh and base_comision = esc.rec_ali));
    end if;
    -- Facturación por la RPC de la 208: consulta de fotografía fuera de libros + factura
    declare
      imp record; foto jsonb; fh jsonb; fs jsonb; v_hash text;
    begin
      select * into imp from f208_priv.importes_factura(nh);
      set local role service_role;
      foto := public.consultar_factura_fuera_libros(nh, admin_, 'mayorista');
      v_hash := foto->>'hash';
      fh := public.facturar_factura(nh, admin_, 'mayorista', imp.pvp, imp.irt, 0, null, 'eq', v_hash, 'revisado en prueba');
      reset role;
      select * into imp from f208_priv.importes_factura(ns);
      set local role service_role;
      foto := public.consultar_factura_fuera_libros(ns, admin_, 'mayorista');
      v_hash := foto->>'hash';
      fs := public.facturar_factura(ns, admin_, 'mayorista', imp.pvp, imp.irt, 0, null, 'eq', v_hash, 'revisado en prueba');
      reset role;
      perform t211.afirma(esc.nombre || ' · facturar_factura sobre la hija responde igual que sobre la simple',
          replace((fh - 'asiento_id' - 'numero_asiento')::text, nh, '#') = replace((fs - 'asiento_id' - 'numero_asiento')::text, ns, '#'),
          fh::text || E'\n' || fs::text);
      hh := t211e.huella(nh, h);
      hs := t211e.huella(ns, s);
      perform t211.afirma(esc.nombre || ' · la factura de la hija SÍ generó su asiento contable (no es una igualdad vacía)',
          exists (select 1 from jsonb_array_elements(hh->'asientos') e where e->>'origen' = 'facturacion'),
          left((hh->'asientos')::text, 300));
      perform t211.afirma(esc.nombre || ' · tras facturar, venta/abonos/asientos (incluida la factura) siguen siendo equivalentes',
          hh = hs, 'asientos hija=' || left((hh->'asientos')::text, 300) || E'\n simple=' || left((hs->'asientos')::text, 300));
    exception when others then
      perform t211.afirma(esc.nombre || ' · facturación', false, sqlstate || ': ' || sqlerrm);
    end;
  end loop;
end $$;

\echo '=== RESUMEN ==='
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos, count(*) as total from t211.res;
select nombre, left(detalle, 700) from t211.res where not ok order by nombre;
do $$
declare f int;
begin
  select count(*) into f from t211.res where not ok;
  if f > 0 then raise exception 'test_211_equivalencia: % prueba(s) fallaron', f; end if;
end $$;
rollback;
