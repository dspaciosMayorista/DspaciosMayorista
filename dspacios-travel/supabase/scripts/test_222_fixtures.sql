-- Fixtures de #50 (migraciones 222/223). Se incluyen con \ir DENTRO de una transacción ya abierta,
-- después de test_216_fixtures.sql y test_211_fixtures.sql (usan sus usuarios, aliados y ayudantes).
-- SOLO bases desechables (CI o local); nunca una base remota. Nunca se corre suelto.
--
-- Requiere \set vect '<json de pruebas/netoHija50.vectores.json>' (lo pone el runner).
create schema t222;

-- ── Aliados propios de #50 ────────────────────────────────────────────────
insert into public.aliados (id, nombre, nit, tipo, pct_comision) values
  (922201, 'C222 Agencia', '922201', 'agencia', 0.12),
  (922202, 'C222 Freelance', '922202', 'freelance', null),
  (922203, 'C222 Otra Agencia', '922203', 'agencia', 0.10),
  (922204, 'C222 Comision Cero', '922204', 'agencia', 0);

-- ── Vectores compartidos con el test TS ───────────────────────────────────
create table t222.vectores (id text primary key, v jsonb not null);
insert into t222.vectores select e->>'id', e from jsonb_array_elements(:'vect'::jsonb) e;
create function t222.vec(p_id text) returns jsonb language sql stable as $$
  select v from t222.vectores where id = p_id
$$;

-- Centavos de un valor en unidades (numeric exacto).
create function t222.c(p numeric) returns bigint language sql immutable as $$ select round(p * 100)::bigint $$;

-- ── Cotización manual DIRECTA (sin comparativa) con las filas de un vector: para la paridad del cálculo ──
create function t222.cot_directa(p_e jsonb, p_moneda text default 'COP') returns bigint
language plpgsql as $$
declare v bigint; s jsonb; i int := 0;
begin
  insert into public.cotizaciones (tenant, tipo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
      plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por)
  values ('mayorista', 'manual', 'abierta',
      jsonb_build_object('tipoAsesor', 'agencia', 'ninos', coalesce((p_e->>'ninos')::numeric, 0), 'tarifaNino', coalesce((p_e->>'tarifaNino')::numeric, 0),
                         'recobro', coalesce((p_e->>'recobro')::numeric, 0), 'recobroAliado', coalesce((p_e->>'recobroAliado')::numeric, 0)),
      '{}'::jsonb, 'Cliente Prueba', '1234567', 'Cartagena', 'Hotel A', 'manual', 'Cotización dinámica', 2,
      (p_e->>'precioVenta')::numeric, p_moneda, public.fecha_negocio() + 20, public.fecha_negocio() + 24, public.fecha_negocio() + 5,
      'Asesor 222', 'c222@x.test')
  returning id into v;
  for s in select x from jsonb_array_elements(p_e->'servicios') x loop
    insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto, modo, pct_markup, ta, valor)
    values (v, (s->>'orden')::int, s->>'tipo', 'T222', (s->>'tipo') || ' ' || (s->>'id'), 'Prov ' || (s->>'tipo'),
            (s->>'costoNeto')::numeric, 'mk', 0, 0, (s->>'valor')::numeric);
    i := i + 1;
  end loop;
  return v;
end $$;

-- ── Comparativa manual con las filas de un vector (A y B comparten TODO; el total sale de las filas) ──
create function t222.madre(p_uid uuid, p_aliado bigint, p_tipo text, p_e jsonb, p_moneda text default 'COP') returns bigint
language plpgsql as $$
declare
  v_serv jsonb := '[]'::jsonb; v_ops jsonb; v_pay jsonb; v_total numeric := 0; s jsonb; v_cab jsonb;
begin
  for s in select x from jsonb_array_elements(p_e->'servicios') x order by (x->>'orden')::int loop
    v_serv := v_serv || jsonb_build_array(jsonb_build_object('orden', (s->>'orden')::int, 'tipo_servicio', s->>'tipo', 'plataforma', 'T222',
       'nombre_servicio', (s->>'tipo') || ' ' || (s->>'id'), 'proveedor', 'Prov ' || (s->>'tipo'), 'costo_neto', (s->>'costoNeto')::numeric,
       'modo', 'mk', 'pct_markup', 0, 'ta', 0, 'valor', (s->>'valor')::numeric, 'opcion_ref', null));
    v_total := v_total + (s->>'valor')::numeric;
  end loop;
  v_total := v_total + coalesce((p_e->>'recobro')::numeric, 0)
             + floor(coalesce((p_e->>'ninos')::numeric, 0)) * coalesce((p_e->>'tarifaNino')::numeric, 0);
  v_pay := jsonb_build_object('tipoAsesor', p_tipo, 'pax', 2, 'ninos', coalesce((p_e->>'ninos')::numeric, 0),
     'tarifaNino', coalesce((p_e->>'tarifaNino')::numeric, 0), 'recobro', coalesce((p_e->>'recobro')::numeric, 0),
     'recobroAliado', coalesce((p_e->>'recobroAliado')::numeric, 0),
     'cliente', jsonb_build_object('nombres', 'Cliente', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '1234567',
                                   'telefono', '3000000000', 'email', 'c@x.test', 'nacimiento', '1990-01-01'));
  v_ops := jsonb_build_array(
    jsonb_build_object('opcion_ref', 'A', 'acomodacion_ref', 'unica', 'orden', 0, 'etiqueta', 'Opción A', 'moneda', p_moneda,
       'tarifa_persona', round(v_total / 2, 2), 'total', v_total,
       'resumen_publico', jsonb_build_object('hotel', 'Opción A', 'total', v_total, 'pax', 2),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel A', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2,
          'payload', v_pay,
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel A', 'precio_venta', v_total, 'estado', 'cotizacion'),
             'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'incluye', 'x', 'noIncluye', '',
             'recobro', jsonb_build_object('total', coalesce((p_e->>'recobro')::numeric, 0), 'empresa', coalesce((p_e->>'recobro')::numeric, 0) - coalesce((p_e->>'recobroAliado')::numeric, 0), 'aliado', coalesce((p_e->>'recobroAliado')::numeric, 0)),
             'items', '[]'::jsonb))),
    jsonb_build_object('opcion_ref', 'B', 'acomodacion_ref', 'unica', 'orden', 1, 'etiqueta', 'Opción B', 'moneda', p_moneda,
       'tarifa_persona', round(v_total / 2, 2), 'total', v_total,
       'resumen_publico', jsonb_build_object('hotel', 'Opción B', 'total', v_total, 'pax', 2),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel B', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2,
          'payload', v_pay,
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel B', 'precio_venta', v_total, 'estado', 'cotizacion'),
             'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'incluye', 'x', 'noIncluye', '',
             'recobro', jsonb_build_object('total', coalesce((p_e->>'recobro')::numeric, 0), 'empresa', coalesce((p_e->>'recobro')::numeric, 0) - coalesce((p_e->>'recobroAliado')::numeric, 0), 'aliado', coalesce((p_e->>'recobroAliado')::numeric, 0)),
             'items', '[]'::jsonb))));
  v_cab := t211.cab_manual(p_tipo, case when p_tipo = 'agencia' then 'C222 Agencia' else '' end) || jsonb_build_object('moneda', p_moneda);
  return public.crear_cotizacion_comparativa(p_uid, v_cab, v_serv, v_ops, p_aliado);
end $$;

-- Total (PVP) de la opción A de una madre.
create function t222.total(p_madre bigint) returns numeric language sql stable as $$
  select total from public.cotizacion_opciones where cotizacion_id = p_madre and opcion_ref = 'A'
$$;

-- ── Elegir la opción A como lo hace la app: recibo (service_role) + elección con sesión (authenticated) ──
-- p_viejo = true usa la firma ANTERIOR (sin modalidad). Devuelve el id de la hija como texto o 'ERR <sqlstate>: …'.
create function t222.elegir(p_madre bigint, p_k text, p_mod text, p_rec boolean, p_aut boolean, p_clave text,
                            p_viejo boolean default false, p_opcion text default 'A', p_canal text default 'interno',
                            p_acom text default 'unica') returns text
language plpgsql as $$
declare v_val text; v_tot numeric; v_mon text;
begin
  select total, moneda into v_tot, v_mon from public.cotizacion_opciones
   where cotizacion_id = p_madre and opcion_ref = p_opcion and acomodacion_ref = p_acom;
  if p_viejo then
    v_val := t216.escalar('service_role', null, format(
      'select public.registrar_validacion_comparativa(%s, %L, %L, 1, %L, %L, %s, %L, true, null)::text',
      p_madre, p_opcion, p_acom, p_canal, t216.u(p_k), v_tot, v_mon));
  else
    v_val := t216.escalar('service_role', null, format(
      'select public.registrar_validacion_comparativa_n50(%s, %L, %L, 1, %L, %L, %s, %L, true, null, %L, %L, %L)::text',
      p_madre, p_opcion, p_acom, p_canal, t216.u(p_k), v_tot, v_mon, p_mod, p_rec, p_aut));
  end if;
  if v_val like 'ERR%' then return v_val; end if;
  return t216.escalar('authenticated', t216.u(p_k), format('select public.elegir_opcion_comparativa_sesion(%L, %L)::text', v_val, p_clave));
end $$;

-- Elegir y exigir éxito (devuelve el id de la hija).
create function t222.hija(p_madre bigint, p_k text, p_mod text, p_rec boolean, p_aut boolean, p_clave text, p_viejo boolean default false) returns bigint
language plpgsql as $$
declare r text := t222.elegir(p_madre, p_k, p_mod, p_rec, p_aut, p_clave, p_viejo);
begin
  if r is null or r !~ '^\d+$' then raise exception 'fixture t222.hija(madre %): %', p_madre, r; end if;
  return r::bigint;
end $$;

-- Crea madre + hija de un vector en un paso.
create function t222.hija_de(p_vec text, p_aliado bigint, p_tipo text, p_mod text, p_rec boolean, p_k text, p_clave text,
                             p_aut boolean default false, p_viejo boolean default false, p_moneda text default 'COP') returns bigint
language plpgsql as $$
declare m bigint := t222.madre(t216.u('admin'), p_aliado, p_tipo, t222.vec(p_vec)->'entrada', p_moneda);
begin
  return t222.hija(m, p_k, p_mod, p_rec, p_aut, p_clave, p_viejo);
end $$;

-- ── Snapshot del primer pago a VALORES NETO (30 % no aéreo, 100 % aéreo) ──
create function t222.snap_neto(p_cot bigint) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('orden', m.orden, 'tipo_componente', m.tipo_componente,
           'referencia_externa', m.referencia_externa, 'valor_componente', n.neto,
           'condicion_pago_tipo', case when m.tipo_componente = 'hotel' then 'sin_condicion' else 'normal' end,
           'monto_exigido', case when m.tipo_componente = 'aereo_empaquetado' then n.neto else round(n.neto * 0.3, 2) end,
           'restriccion_comercial', 'normal') order by m.orden), '[]'::jsonb)
    from p39_priv.componentes_manual(p_cot) m
    join public.cotizacion_neto_componentes n on n.cotizacion_id = p_cot and n.orden = m.orden
$$;
create function t222.exigido_snap(p_snap jsonb) returns numeric language sql immutable as $$
  select coalesce(round(sum((r->>'monto_exigido')::numeric), 2), 0) from jsonb_array_elements(p_snap) r
$$;
-- SQL del wrapper de pago con un snapshot dado (lo ejecuta t216.escalar como service_role).
create function t222.pago_sql(p_cot bigint, p_k text, p_valor numeric, p_clave text, p_snap jsonb, p_moneda text default 'COP',
                              p_trm numeric default 1, p_exigido numeric default null, p_rev integer default null) returns text
language sql stable as $$
  select format('select public.registrar_pago_previo_rev(%s, %s, %L, %s, ''Transferencia'', %L, public.fecha_negocio(), %L, %L, %s, %L::jsonb, %s, null)',
                p_cot, p_valor, p_moneda, p_trm, 'REF-' || p_clave, t216.u(p_k), p_clave,
                coalesce(p_rev, t216.rev(p_cot)), p_snap, coalesce(p_exigido, t222.exigido_snap(p_snap)))
$$;
-- Primer pago NETO por el wrapper; devuelve el id del pago o falla la fixture.
create function t222.pagar_neto(p_cot bigint, p_valor numeric, p_clave text, p_moneda text default 'COP', p_trm numeric default 1) returns bigint
language plpgsql as $$
declare r text;
begin
  r := t216.escalar('service_role', null, t222.pago_sql(p_cot, 'admin', p_valor, p_clave, t222.snap_neto(p_cot), p_moneda, p_trm));
  if r is null or r !~ '^OK\|\d+$' then raise exception 'fixture t222.pagar_neto(%): %', p_cot, r; end if;
  return substr(r, 4)::bigint;
end $$;

-- Una venta por número: sus datos clave.
create function t222.venta(p_numero text) returns public.ventas language sql stable as $$
  select * from public.ventas where numero_contrato = p_numero
$$;

-- Fallo inyectado (D6): un disparador que rompe el insert de aliados_b2b.
create function t222.falla() returns trigger language plpgsql as $$
begin
  raise exception 'falla inyectada';
end $$;
