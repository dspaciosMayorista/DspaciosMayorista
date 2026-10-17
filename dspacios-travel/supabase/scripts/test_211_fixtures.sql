-- Fixtures compartidas por test_211_*.sql (se incluyen con \ir DENTRO de una transacción
-- ya abierta; nunca se corre suelto). SOLO base local desechable.
create schema t211;
create table t211.res (nombre text, ok boolean, detalle text);

-- Ejecuta SQL como un rol/JWT y devuelve 'ok' o 'SQLSTATE: mensaje'.
create function t211.intenta(p_rol text, p_uid uuid, p_sql text) returns text
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

-- Igual, pero devuelve el escalar (text) de una consulta; si falla, el error.
create function t211.escalar(p_rol text, p_uid uuid, p_sql text) returns text
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

create function t211.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t211.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

-- Espera que el resultado de intenta() sea un error cuyo texto contiene p_patron.
create function t211.rechaza(p_nombre text, p_res text, p_patron text) returns void
language plpgsql as $$
begin
  perform t211.afirma(p_nombre, p_res <> 'ok' and p_res like '%' || p_patron || '%', p_res);
end $$;
create function t211.acepta(p_nombre text, p_res text) returns void
language plpgsql as $$
begin
  perform t211.afirma(p_nombre, p_res = 'ok', p_res);
end $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Ids fijos reconocibles.
\set u_super   '''00000000-0000-0000-0000-000000211001'''
\set u_admin   '''00000000-0000-0000-0000-000000211002'''
\set u_venta   '''00000000-0000-0000-0000-000000211003'''
\set u_min     '''00000000-0000-0000-0000-000000211004'''
\set u_b2b_a   '''00000000-0000-0000-0000-000000211005'''
\set u_b2b_a2  '''00000000-0000-0000-0000-000000211006'''
\set u_b2b_b   '''00000000-0000-0000-0000-000000211007'''
\set u_b2b_sin '''00000000-0000-0000-0000-000000211008'''
\set u_inact   '''00000000-0000-0000-0000-000000211009'''
\set u_b2b_min '''00000000-0000-0000-0000-000000211010'''

insert into auth.users (id, email)
select id::uuid, 'c211-' || right(id, 3) || '@x.test'
from (values (:u_super), (:u_admin), (:u_venta), (:u_min), (:u_b2b_a), (:u_b2b_a2), (:u_b2b_b), (:u_b2b_sin), (:u_inact), (:u_b2b_min)) v(id);

insert into public.aliados (id, nombre, nit, tipo) values
  (921101, 'C211 Agencia A', '921101', 'agencia'),
  (921102, 'C211 Agencia B', '921102', 'agencia'),
  (921103, 'C211 Freelance', '921103', 'freelance');

insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  (:u_super,   'c211-001@x.test', 'C211 Super',   'superadmin',     true,  'mayorista', null),
  (:u_admin,   'c211-002@x.test', 'C211 Admin',   'administracion', true,  'mayorista', null),
  (:u_venta,   'c211-003@x.test', 'C211 Venta',   'venta',          true,  'mayorista', null),
  (:u_min,     'c211-004@x.test', 'C211 Min',     'administracion', true,  'minorista', null),
  (:u_b2b_a,   'c211-005@x.test', 'C211 B2B A',   'agencia',        true,  'mayorista', 921101),
  (:u_b2b_a2,  'c211-006@x.test', 'C211 B2B A2',  'agencia',        true,  'mayorista', 921101),
  (:u_b2b_b,   'c211-007@x.test', 'C211 B2B B',   'agencia',        true,  'mayorista', 921102),
  (:u_b2b_sin, 'c211-008@x.test', 'C211 B2B sin', 'freelance',      true,  'mayorista', null),
  (:u_inact,   'c211-009@x.test', 'C211 Inact',   'administracion', false, 'mayorista', null),
  (:u_b2b_min, 'c211-010@x.test', 'C211 B2B min', 'agencia',        true,  'minorista', 921101)
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;

-- Constructor de comparativa MANUAL (A y B comparten aéreo + traslado; hotel exclusivo de cada una).
create function t211.cab_manual(p_asesor text default 'interno', p_nombre_aliado text default '') returns jsonb
language sql as $$
  select jsonb_build_object(
    'tipo', 'comparativa_manual', 'tenant', 'mayorista', 'moneda', 'COP',
    'vigencia_hasta', (public.fecha_negocio() + 5)::text,
    'cliente', 'Cliente Prueba', 'cliente_documento', '1234567', 'destino', 'Cartagena',
    'plan_nombre', 'Cotización comparativa', 'pax', 2, 'asesor', 'Asesor 211', 'creado_por', 'c211@x.test',
    'fecha_salida', (public.fecha_negocio() + 20)::text, 'fecha_regreso', (public.fecha_negocio() + 24)::text,
    'payload', jsonb_build_object('tipoAsesor', p_asesor, 'agenciaNombre', p_nombre_aliado, 'freelanceNombre', '',
         'pax', 2, 'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'recobroAliado', 0,
         'cliente', jsonb_build_object('nombres', 'Cliente', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '1234567',
                                       'telefono', '3000000000', 'email', 'c@x.test', 'nacimiento', '1990-01-01')),
    'detalle', jsonb_build_object('comparativa', true, 'venta', jsonb_build_object('cliente', 'Cliente Prueba', 'estado', 'cotizacion')));
$$;
create function t211.servicios_manual() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('orden', 0, 'tipo_servicio', 'aereo', 'plataforma', 'Despegar', 'nombre_servicio', 'Aéreo BOG-CTG',
       'proveedor', 'Avianca', 'costo_neto', 800000, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 1000000, 'opcion_ref', null),
    jsonb_build_object('orden', 1, 'tipo_servicio', 'traslado', 'plataforma', 'Directo', 'nombre_servicio', 'Traslados',
       'proveedor', 'Transportes S.A.', 'costo_neto', 80000, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 100000, 'opcion_ref', null),
    jsonb_build_object('orden', 2, 'tipo_servicio', 'hotel', 'plataforma', 'Booking', 'nombre_servicio', 'Hotel A',
       'proveedor', 'Hoteles A', 'costo_neto', 400000, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 500000, 'opcion_ref', 'A'),
    jsonb_build_object('orden', 3, 'tipo_servicio', 'hotel', 'plataforma', 'Booking', 'nombre_servicio', 'Hotel B',
       'proveedor', 'Hoteles B', 'costo_neto', 560000, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 700000, 'opcion_ref', 'B'));
$$;
create function t211.opciones_manual() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('opcion_ref', 'A', 'acomodacion_ref', 'unica', 'orden', 0, 'etiqueta', 'Hotel A', 'moneda', 'COP',
       'tarifa_persona', 800000, 'total', 1600000,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel A', 'total', 1600000, 'pax', 2),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel A', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2,
          'payload', jsonb_build_object('tipoAsesor', 'interno', 'pax', 2, 'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'recobroAliado', 0,
             'cliente', jsonb_build_object('nombres', 'Cliente', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '1234567',
                'telefono', '3000000000', 'email', 'c@x.test', 'nacimiento', '1990-01-01')),
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel A', 'precio_venta', 1600000, 'estado', 'cotizacion'),
             'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'incluye', 'x', 'noIncluye', '',
             'recobro', jsonb_build_object('total', 0, 'empresa', 0, 'aliado', 0), 'items', '[]'::jsonb))),
    jsonb_build_object('opcion_ref', 'B', 'acomodacion_ref', 'unica', 'orden', 1, 'etiqueta', 'Hotel B', 'moneda', 'COP',
       'tarifa_persona', 900000, 'total', 1800000,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel B', 'total', 1800000, 'pax', 2),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel B', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2,
          'payload', jsonb_build_object('tipoAsesor', 'interno', 'pax', 2, 'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'recobroAliado', 0,
             'cliente', jsonb_build_object('nombres', 'Cliente', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '1234567',
                'telefono', '3000000000', 'email', 'c@x.test', 'nacimiento', '1990-01-01')),
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Cliente Prueba', 'hotel', 'Hotel B', 'precio_venta', 1800000, 'estado', 'cotizacion'),
             'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'incluye', 'x', 'noIncluye', '',
             'recobro', jsonb_build_object('total', 0, 'empresa', 0, 'aliado', 0), 'items', '[]'::jsonb))));
$$;
create function t211.madre_manual(p_uid uuid, p_aliado bigint default null, p_asesor text default 'interno') returns bigint
language sql as $$
  select public.crear_cotizacion_comparativa(p_uid, t211.cab_manual(p_asesor), t211.servicios_manual(), t211.opciones_manual(), p_aliado)
$$;

-- Constructor de comparativa CARRITO (tarifario): dos hoteles, una acomodación cada uno.
create function t211.madre_carrito(p_uid uuid default null, p_aliado bigint default null) returns bigint
language plpgsql as $$
declare v_cab jsonb; v_op jsonb;
begin
  v_cab := jsonb_build_object(
    'tipo', 'comparativa_carrito', 'moneda', 'COP', 'vigencia_hasta', (public.fecha_negocio() + 3)::text,
    'cliente', 'Visitante', 'cliente_documento', null, 'destino', 'CARTAGENA', 'plan_nombre', 'Comparativa', 'pax', 2,
    'fecha_salida', (public.fecha_negocio() + 20)::text, 'fecha_regreso', (public.fecha_negocio() + 24)::text,
    'payload', jsonb_build_object('tipoAsesor', 'interno'),
    'detalle', jsonb_build_object('comparativa', true));
  v_op := jsonb_build_array(
    jsonb_build_object('opcion_ref', 'A', 'acomodacion_ref', 'doble', 'orden', 0, 'etiqueta', 'Hotel Uno', 'moneda', 'COP',
       'tarifa_persona', 700000, 'total', 1400000,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel Uno', 'total', 1400000),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel Uno', 'destino', 'CARTAGENA', 'plan_nombre', 'Estándar · PAM', 'pax', 2,
          'payload', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('hotelNombre', 'Hotel Uno', 'precio', 1300000, 'pax', 2, 'modulo', 'porcion_terrestre')),
                                        'tours', jsonb_build_array(jsonb_build_object('nombre', 'City tour', 'precio', 100000, 'pax', 2, 'moneda', 'COP')),
                                        'serviciosIncluidos', '[]'::jsonb),
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Visitante', 'estado', 'pendiente', 'moneda', 'COP'),
                                        'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'items', '[]'::jsonb))),
    jsonb_build_object('opcion_ref', 'A', 'acomodacion_ref', 'sencilla', 'orden', 1, 'etiqueta', 'Hotel Uno', 'moneda', 'COP',
       'tarifa_persona', 900000, 'total', 1900000,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel Uno', 'total', 1900000),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel Uno', 'destino', 'CARTAGENA', 'plan_nombre', 'Estándar · PAM', 'pax', 2,
          'payload', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('hotelNombre', 'Hotel Uno', 'precio', 1800000, 'pax', 2, 'modulo', 'porcion_terrestre')),
                                        'tours', jsonb_build_array(jsonb_build_object('nombre', 'City tour', 'precio', 100000, 'pax', 2, 'moneda', 'COP')),
                                        'serviciosIncluidos', '[]'::jsonb),
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Visitante', 'estado', 'pendiente', 'moneda', 'COP'),
                                        'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'items', '[]'::jsonb))),
    jsonb_build_object('opcion_ref', 'B', 'acomodacion_ref', 'doble', 'orden', 2, 'etiqueta', 'Hotel Dos', 'moneda', 'COP',
       'tarifa_persona', 650000, 'total', 1300000,
       'resumen_publico', jsonb_build_object('hotel', 'Hotel Dos', 'total', 1300000),
       'plantilla_hija', jsonb_build_object('hotel', 'Hotel Dos', 'destino', 'CARTAGENA', 'plan_nombre', 'Estándar · PAM', 'pax', 2,
          'payload', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('hotelNombre', 'Hotel Dos', 'precio', 1300000, 'pax', 2, 'modulo', 'porcion_terrestre')),
                                        'tours', '[]'::jsonb, 'serviciosIncluidos', '[]'::jsonb),
          'detalle', jsonb_build_object('venta', jsonb_build_object('cliente', 'Visitante', 'estado', 'pendiente', 'moneda', 'COP'),
                                        'pasajeros', '[]'::jsonb, 'hoteles', '[]'::jsonb, 'vuelos', '[]'::jsonb, 'items', '[]'::jsonb))));
  return public.crear_cotizacion_comparativa(p_uid, v_cab, '[]'::jsonb, v_op, p_aliado);
end $$;

-- Datos cliente válidos del checkout público.
create function t211.cliente_ok() returns jsonb language sql as $$
  select jsonb_build_object('nombres', 'Ana', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '99887766', 'telefono', '3101112233', 'email', 'ana@x.test')
$$;

-- Envejece una solicitud (solo en pruebas: desactiva los triggers de inmutabilidad un instante).
create function t211.envejece(p_id bigint, p_horas int, p_ip text default '__igual__') returns void
language plpgsql as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.cotizacion_comparativa_solicitudes
     set created_at = now() - make_interval(hours => p_horas),
         ip_huella = case when p_ip = '__igual__' then ip_huella else p_ip end
   where id = p_id;
  perform set_config('session_replication_role', 'origin', true);
end $$;

-- IDs de trabajo.
create table t211.ids (k text primary key, v bigint);
create table t211.recibos (k text primary key, v uuid);
