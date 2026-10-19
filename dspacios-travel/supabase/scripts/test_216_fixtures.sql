-- Fixtures compartidas por test_216_*.sql y los runners test_216_*.sh (#39, migraciones 216/217).
-- Se incluyen con \ir DENTRO de una transacción ya abierta, o con begin/commit explícitos en los
-- runners de carreras. SOLO bases desechables (CI o local); nunca una base remota.
create schema t216;
create table t216.res (nombre text, ok boolean, detalle text);
create table t216.ids (k text primary key, v bigint);

-- Ejecuta SQL como un rol de la API con su JWT y devuelve 'ok' o 'SQLSTATE: mensaje'.
create function t216.intenta(p_rol text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_r text := 'ok';
begin
  perform set_config('request.jwt.claims',
     case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql;
  exception when others then
    v_r := sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_r;
end $$;

-- Igual, pero devuelve el escalar (text) de una consulta; si falla, 'ERR <sqlstate>: <mensaje>'.
create function t216.escalar(p_rol text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_r text;
begin
  perform set_config('request.jwt.claims',
     case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into v_r;
  exception when others then
    v_r := 'ERR ' || sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_r;
end $$;

create function t216.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t216.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;
create function t216.rechaza(p_nombre text, p_res text, p_patron text) returns void
language plpgsql as $$
begin
  perform t216.afirma(p_nombre, p_res is not null and p_res <> 'ok' and p_res not like 'OK|%' and p_res like '%' || p_patron || '%', p_res);
end $$;
create function t216.acepta(p_nombre text, p_res text) returns void
language plpgsql as $$
begin
  perform t216.afirma(p_nombre, p_res = 'ok', p_res);
end $$;

-- ── Usuarios (ids fijos reconocibles) ─────────────────────────────────────
create function t216.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000216' || case p_k
    when 'super' then '001' when 'admin' then '002' when 'gerencia' then '003' when 'oper' then '004'
    when 'ventaA' then '005' when 'ventaB' then '006' when 'adminMin' then '007' when 'ventaMin' then '008'
    when 'inactivo' then '009' when 'agencia' then '010' when 'vuelo' then '011' else '999' end)::uuid
$$;

insert into auth.users (id, email)
select t216.u(k), 'c216-' || k || '@x.test'
from unnest(array['super','admin','gerencia','oper','ventaA','ventaB','adminMin','ventaMin','inactivo','agencia','vuelo']) k
on conflict do nothing;

insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t216.u(k), 'c216-' || k || '@x.test', 'C216 ' || k, r::rol_usuario, a, t
from (values ('super','superadmin',true,'mayorista'), ('admin','administracion',true,'mayorista'),
             ('gerencia','gerencia',true,'mayorista'), ('oper','operaciones',true,'mayorista'),
             ('ventaA','venta',true,'mayorista'), ('ventaB','venta',true,'mayorista'),
             ('adminMin','administracion',true,'minorista'), ('ventaMin','venta',true,'minorista'),
             ('inactivo','administracion',false,'mayorista'), ('agencia','agencia',true,'mayorista'),
             ('vuelo','control_vuelo',true,'mayorista')) v(k, r, a, t)
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                               activo = excluded.activo, tenant = excluded.tenant;

-- ── Constructores ─────────────────────────────────────────────────────────
-- Servicios de siempre: aéreo 800.000 → 1.000.000 y hotel 400.000 → 500.000 (markup 20%).
create function t216.serv(p_hotel numeric default 500000, p_prov_hotel text default 'Hoteles A') returns jsonb
language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('orden', 0, 'tipo_servicio', 'aereo', 'plataforma', 'Despegar', 'nombre_servicio', 'Aéreo BOG-CTG',
       'proveedor', 'Avianca', 'costo_neto', 800000, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 1000000),
    jsonb_build_object('orden', 1, 'tipo_servicio', 'hotel', 'plataforma', 'Booking', 'nombre_servicio', 'Hotel A',
       'proveedor', p_prov_hotel, 'costo_neto', round(p_hotel * 0.8), 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', p_hotel))
$$;

-- Líneas del documento que suman `p_precio` (adultos + niños).
create function t216.items(p_precio numeric, p_ninos int default 0, p_tarifa numeric default 0) returns jsonb
language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('descripcion', 'PAQUETE TURÍSTICO A CARTAGENA', 'cantidad', 2,
            'tarifa_unit', round((p_precio - p_ninos * p_tarifa) / 2), 'valor', p_precio - p_ninos * p_tarifa, 'orden', 0))
         || case when p_ninos > 0 then jsonb_build_array(jsonb_build_object('descripcion', 'Tarifa por niño', 'cantidad', p_ninos,
            'tarifa_unit', p_tarifa, 'valor', p_ninos * p_tarifa, 'orden', 1)) else '[]'::jsonb end
$$;

create function t216.cab(p_tipo_asesor text default 'interno', p_recobro numeric default 0, p_ninos int default 0,
                         p_tarifa numeric default 0, p_moneda text default 'COP', p_suma numeric default 1500000) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'payload', jsonb_build_object('tipoAsesor', p_tipo_asesor, 'agenciaNombre', case when p_tipo_asesor = 'agencia' then 'Agencia 216' else '' end,
        'freelanceNombre', '', 'asesorInterno', 'Asesor 216', 'pax', 2, 'ninos', p_ninos, 'tarifaNino', p_tarifa,
        'recobro', p_recobro, 'recobroAliado', 0, 'moneda', p_moneda, 'destino', 'Cartagena', 'servicios', '[]'::jsonb,
        'cliente', jsonb_build_object('nombres', 'Cliente', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '1234567',
                                      'telefono', '3000000000', 'email', 'c@x.test', 'nacimiento', '1990-01-01')),
    'detalle', jsonb_build_object(
        'venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel A', 'aerolinea', 'Aéreo BOG-CTG',
                                    'precio_venta', p_suma + p_recobro + p_ninos * p_tarifa, 'moneda', p_moneda, 'estado', 'cotizacion'),
        'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'incluye', 'Aéreo y hotel', 'noIncluye', '',
        'recobro', jsonb_build_object('total', p_recobro, 'empresa', p_recobro, 'aliado', 0),
        'items', t216.items(p_suma + p_recobro + p_ninos * p_tarifa, p_ninos, p_tarifa)),
    'cliente', 'Cliente Prueba', 'cliente_documento', '1234567', 'destino', 'Cartagena', 'hotel', 'Hotel A',
    'plan_nombre', 'Cotización dinámica', 'pax', 2, 'precio_venta', p_suma + p_recobro + p_ninos * p_tarifa,
    'moneda', p_moneda, 'fecha_salida', (public.fecha_negocio() + 20)::text, 'fecha_regreso', (public.fecha_negocio() + 24)::text,
    'vigencia_hasta', (public.fecha_negocio() + 5)::text, 'asesor', 'Asesor 216')
$$;

-- Crea una manual por la RPC REAL, como lo hace el servidor (service_role).
create function t216.crear(p_k text, p_cab jsonb default null, p_tenant text default 'mayorista', p_serv jsonb default null) returns bigint
language plpgsql as $$
declare r text;
begin
  r := t216.escalar('service_role', null, format('select public.crear_cotizacion_manual(%L, %L, %L::jsonb, %L::jsonb)::text',
         t216.u(p_k), p_tenant, coalesce(p_cab, t216.cab()), coalesce(p_serv, t216.serv())));
  if r is null or r !~ '^\d+$' then raise exception 'fixture t216.crear(%): %', p_k, r; end if;
  return r::bigint;
end $$;

-- Manual "antigua" (anterior a #39): sin creado_por_id, insertada por el dueño de la base.
create function t216.crear_legada(p_tenant text default 'mayorista') returns bigint
language plpgsql as $$
declare v bigint; c jsonb := t216.cab();
begin
  insert into public.cotizaciones (tenant, tipo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
      plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por)
  values (p_tenant, 'manual', 'abierta', c->'payload', c->'detalle', 'Cliente Prueba', '1234567', 'Cartagena', 'Hotel A', 'manual',
      'Cotización dinámica', 2, 1500000, 'COP', public.fecha_negocio() + 20, public.fecha_negocio() + 24, public.fecha_negocio() + 5,
      'Asesor 216', 'legado@x.test')
  returning id into v;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto, modo, pct_markup, ta, valor)
  select v, (e->>'orden')::int, e->>'tipo_servicio', e->>'plataforma', e->>'nombre_servicio', e->>'proveedor', (e->>'costo_neto')::numeric,
         e->>'modo', (e->>'pct_markup')::numeric, (e->>'ta')::numeric, (e->>'valor')::numeric
    from jsonb_array_elements(t216.serv()) e;
  return v;
end $$;

create function t216.rev(p_cot bigint) returns integer language sql stable as $$
  select economico_rev from public.cotizaciones where id = p_cot
$$;

-- Snapshot del primer pago a partir de los servicios ACTUALES (30% exigido por componente).
create function t216.snap(p_cot bigint) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('orden', m.orden, 'tipo_componente', m.tipo_componente,
           'referencia_externa', m.referencia_externa, 'valor_componente', m.valor_componente,
           'condicion_pago_tipo', case when m.tipo_componente = 'hotel' then 'sin_condicion' else 'normal' end,
           'monto_exigido', round(m.valor_componente * 0.3, 2), 'restriccion_comercial', 'normal') order by m.orden), '[]'::jsonb)
    from p39_priv.componentes_manual(p_cot) m
$$;
create function t216.exigido(p_cot bigint) returns numeric language sql stable as $$
  select coalesce(round(sum(m.valor_componente * 0.3), 2), 0) from p39_priv.componentes_manual(p_cot) m
$$;

-- SQL de una llamada al wrapper de pago (lo ejecuta t216.intenta/escalar como service_role).
create function t216.pago_sql(p_cot bigint, p_k text, p_valor numeric, p_clave text,
                              p_rev integer default null, p_snap jsonb default null, p_moneda text default 'COP', p_trm numeric default 1) returns text
language sql stable as $$
  select format('select public.registrar_pago_previo_rev(%s, %s, %L, %s, ''Transferencia'', %L, public.fecha_negocio(), %L, %L, %s, %L::jsonb, %s, null)',
                p_cot, p_valor, p_moneda, p_trm, 'REF-' || p_clave, t216.u(p_k), p_clave,
                coalesce(p_rev, t216.rev(p_cot)), coalesce(p_snap, t216.snap(p_cot)), t216.exigido(p_cot))
$$;
-- Paga por el wrapper y devuelve el id del pago (falla la prueba si no se pudo).
create function t216.pagar(p_cot bigint, p_valor numeric, p_clave text, p_k text default 'admin') returns bigint
language plpgsql as $$
declare r text;
begin
  r := t216.escalar('service_role', null, t216.pago_sql(p_cot, p_k, p_valor, p_clave));
  if r is null or r !~ '^OK\|\d+$' then raise exception 'fixture t216.pagar(%): %', p_cot, r; end if;
  return substr(r, 4)::bigint;
end $$;

-- Cambios del documento (`p_cambios`) coherentes con unos servicios nuevos.
create function t216.cambios(p_cot bigint, p_serv jsonb) returns jsonb language sql stable as $$
  with c as (select payload from public.cotizaciones where id = p_cot),
       s as (select coalesce(sum((e->>'valor')::numeric), 0) as suma from jsonb_array_elements(p_serv) e),
       t as (select s.suma + coalesce((c.payload->>'recobro')::numeric, 0)
                    + coalesce((c.payload->>'ninos')::numeric, 0) * coalesce((c.payload->>'tarifaNino')::numeric, 0) as precio,
                    coalesce((c.payload->>'ninos')::int, 0) as ninos, coalesce((c.payload->>'tarifaNino')::numeric, 0) as tarifa
               from c, s)
  select jsonb_build_object('precio_venta', t.precio,
           'hotel', (select e->>'nombre_servicio' from jsonb_array_elements(p_serv) e where e->>'tipo_servicio' = 'hotel' limit 1),
           'aerolinea', (select e->>'nombre_servicio' from jsonb_array_elements(p_serv) e where e->>'tipo_servicio' = 'aereo' limit 1),
           'items', t216.items(t.precio, t.ninos, t.tarifa), 'payload_servicios', '[]'::jsonb)
    from t
$$;
-- SQL de la edición de servicios por la RPC real (lo ejecuta t216.intenta como service_role).
create function t216.editar_sql(p_cot bigint, p_k text, p_serv jsonb, p_motivo text default 'cambio de prueba',
                                p_rev integer default null, p_cambios jsonb default null) returns text
language sql stable as $$
  select format('select public.editar_servicios_cotizacion_manual(%L, %s, %s, %L, %L::jsonb, %L::jsonb)',
                t216.u(p_k), p_cot, coalesce(p_rev, t216.rev(p_cot)), p_motivo, p_serv, coalesce(p_cambios, t216.cambios(p_cot, p_serv)))
$$;
-- SQL de niños/recobro por la RPC real.
create function t216.recobro_sql(p_cot bigint, p_k text, p_ninos int, p_tarifa numeric, p_rec numeric, p_rec_ali numeric default 0,
                                 p_motivo text default 'ajuste de prueba', p_rev integer default null, p_precio numeric default null) returns text
language sql stable as $$
  with s as (select coalesce(sum(valor), 0) as suma from public.cotizacion_servicios where cotizacion_id = p_cot)
  select format('select public.actualizar_recobro_ninos_manual(%L, %s, %s, %L, %L::jsonb)',
                t216.u(p_k), p_cot, coalesce(p_rev, t216.rev(p_cot)), p_motivo,
                jsonb_build_object('ninos', p_ninos, 'tarifaNino', p_tarifa, 'recobro', p_rec, 'recobroAliado', p_rec_ali,
                  'precio_venta', coalesce(p_precio, s.suma + p_rec + p_ninos * p_tarifa),
                  'items', t216.items(coalesce(p_precio, s.suma + p_rec + p_ninos * p_tarifa), p_ninos, p_tarifa)))
    from s
$$;
create function t216.convertir_sql(p_cot bigint, p_k text default 'admin') returns text language sql immutable as $$
  select format('select public.convertir_cotizacion_manual_controlada(%s, %L)', p_cot, t216.u(p_k))
$$;

-- ── Huella de dinero (H2) ─────────────────────────────────────────────────
-- Todo lo que una llamada de dinero escribiría: conteos GLOBALES de venta, contrato,
-- abonos, CxP, comisiones B2B, condiciones, asientos y pagos previos; el último número
-- de asiento por agencia; la fila completa de la cotización y sus pagos previos. Una
-- llamada directa rechazada (o una réplica sin escritura) debe dejarla IDÉNTICA.
create function t216.huella_dinero(p_cot bigint) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ventas', (select count(*) from public.ventas),
    'contrato_items', (select count(*) from public.contrato_items),
    'contrato_pasajeros', (select count(*) from public.contrato_pasajeros),
    'contrato_condiciones', (select count(*) from public.contrato_condiciones),
    'abonos', (select count(*) from public.abonos),
    'cuentas_por_pagar', (select count(*) from public.cuentas_por_pagar),
    'aliados_b2b', (select count(*) from public.aliados_b2b),
    'asientos_contables', (select count(*) from public.asientos_contables),
    'asiento_lineas', (select count(*) from public.asiento_lineas),
    'ultimo_asiento', (select coalesce(jsonb_object_agg(x.t, x.n), '{}'::jsonb)
                         from (select coalesce(tenant, 'sin_tenant') as t, max(numero) as n from public.asientos_contables group by 1) x),
    'cotizacion_pagos_previos', (select count(*) from public.cotizacion_pagos_previos),
    'cotizacion_condiciones', (select count(*) from public.cotizacion_condiciones),
    'cotizacion', (select to_jsonb(c) from public.cotizaciones c where c.id = p_cot),
    'pagos_de_la_cotizacion', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
                                 from public.cotizacion_pagos_previos p where p.cotizacion_id = p_cot))
$$;
-- Claves en que dos huellas difieren (para el log del CI); NULL si son iguales.
create function t216.dif_huella(p_antes jsonb, p_despues jsonb) returns text language sql immutable as $$
  select string_agg(k, ', ' order by k)
    from (select jsonb_object_keys(p_antes) as k union select jsonb_object_keys(p_despues)) ks
   where p_antes -> k is distinct from p_despues -> k
$$;
-- Último número DTM consumido (mayorista). `nextval` no se revierte: es el hueco documentado.
create function t216.ultimo_dtm() returns bigint language sql volatile as $$
  select case when is_called then last_value else last_value - 1 end from public.contrato_seq_mayorista
$$;
