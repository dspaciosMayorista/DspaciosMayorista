-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #39 fase 1 (migraciones 216 + 217 aplicadas: frontera ACTIVA).
-- SOLO base desechable (CI o local). Corre en UNA transacción y termina en ROLLBACK.
--
--   psql -v ON_ERROR_STOP=1 -f test_216_edicion39.sql <base>     (desde supabase/scripts: usa \ir)
--
-- Grupos (Gate 2): P permisos · T rol/tenant/autor · E edición · V renovación (decisión A) ·
-- D DML directo · O firmas antiguas · F primer pago · S interruptor · I reintentos ·
-- G regresiones 164/198/208/211 · R regresión de reservar/actions.ts · B fallos inyectados (atomicidad).
-- Las carreras (C), la API HTTP (X/L) y las fases A/B/rollback viven en los runners .sh.
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

\ir test_216_fixtures.sql

do $$
begin
  if not p39_priv.frontera_activa() then
    raise exception 'test_216_edicion39 exige la 216 y la 217 aplicadas (frontera activa).';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- P. Permisos efectivos (con la frontera activa)'
do $$
declare r record; v_ok boolean;
begin
  perform t216.afirma('P1 p39_priv: sin USAGE para anon/authenticated; con USAGE para service_role',
    not has_schema_privilege('anon', 'p39_priv', 'USAGE') and not has_schema_privilege('authenticated', 'p39_priv', 'USAGE')
    and has_schema_privilege('service_role', 'p39_priv', 'USAGE'));
  for r in select * from (values
      ('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)', false, false, true),
      ('public.editar_servicios_cotizacion_manual(uuid,bigint,integer,text,jsonb,jsonb)', false, false, true),
      ('public.actualizar_recobro_ninos_manual(uuid,bigint,integer,text,jsonb)', false, false, true),
      ('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)', false, false, true),
      ('public.anular_pago_previo_controlado(bigint,uuid,text)', false, false, true),
      ('public.convertir_cotizacion_manual_controlada(bigint,uuid)', false, false, true),
      ('public.edicion_cotizaciones_habilitada()', false, true, false),
      ('p39_priv.emitir(bigint,text,uuid)', false, false, true),
      ('p39_priv.cerrar(bigint)', false, false, true),
      ('p39_priv.autorizada(bigint,text)', false, false, true),
      ('p39_priv.composicion_coincide(bigint,jsonb)', false, false, true),
      ('p39_priv.frontera_activa()', false, false, false),
      ('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)', false, false, false),
      ('p39_priv.componentes_manual(bigint)', false, false, false),
      ('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)', false, false, true),
      ('public.convertir_cotizacion_a_contrato(bigint,uuid)', false, false, true)
    ) v(f, anon_, auth_, serv_) loop
    v_ok := has_function_privilege('anon', r.f, 'EXECUTE') = r.anon_
        and has_function_privilege('authenticated', r.f, 'EXECUTE') = r.auth_
        and has_function_privilege('service_role', r.f, 'EXECUTE') = r.serv_;
    perform t216.afirma('P2 EXECUTE ' || r.f, v_ok,
      format('anon=%s auth=%s serv=%s', has_function_privilege('anon', r.f, 'EXECUTE'),
             has_function_privilege('authenticated', r.f, 'EXECUTE'), has_function_privilege('service_role', r.f, 'EXECUTE')));
  end loop;
  perform t216.afirma('P3 cotizacion_servicios: lectura sí, escritura nadie de la API',
    has_table_privilege('authenticated', 'public.cotizacion_servicios', 'SELECT') and has_table_privilege('service_role', 'public.cotizacion_servicios', 'SELECT')
    and not has_table_privilege('anon', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('service_role', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE'));
  perform t216.afirma('P4 pagos previos: anon/authenticated sin escritura; service_role sin DELETE/TRUNCATE, conserva INSERT/UPDATE',
    not has_table_privilege('anon', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('authenticated', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'DELETE,TRUNCATE')
    and has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'INSERT')
    and has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'UPDATE'));
  perform t216.afirma('P5 condiciones: anon/authenticated sin escritura; service_role sin TRUNCATE',
    not has_table_privilege('anon', 'public.cotizacion_condiciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('authenticated', 'public.cotizacion_condiciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('service_role', 'public.cotizacion_condiciones', 'TRUNCATE')
    and has_table_privilege('service_role', 'public.cotizacion_condiciones', 'INSERT'));
  perform t216.afirma('P6 cotizacion_ediciones: authenticated solo lee; nadie de la API escribe',
    has_table_privilege('authenticated', 'public.cotizacion_ediciones', 'SELECT')
    and not has_table_privilege('anon', 'public.cotizacion_ediciones', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('authenticated', 'public.cotizacion_ediciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('service_role', 'public.cotizacion_ediciones', 'INSERT,UPDATE,DELETE,TRUNCATE'));
  perform t216.afirma('P7 tablas de p39_priv: ningún privilegio para la API',
    not exists (select 1 from (values ('p39_priv.autorizacion_emitida'), ('p39_priv.autorizacion_cerrada'), ('p39_priv.suspension_edicion')) t(n),
                       (values ('anon'), ('authenticated'), ('service_role')) api(rol)
                 where has_table_privilege(api.rol, t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')));
  perform t216.afirma('P8 la RPC 198 (4 funciones) no cambió: mismo md5 que en main',
    (select string_agg(coalesce(md5(replace(p.prosrc, chr(13), '')), 'falta'), ',' order by f.n)
       from (values (1, 'public.anular_pago_previo(bigint,uuid,text)'), (2, 'public.convertir_cotizacion_a_contrato(bigint,uuid)'),
                    (3, 'public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)'),
                    (4, 'public.transferir_pagos_previos_a_abonos(bigint,text,uuid)')) f(n, sig)
       left join pg_proc p on p.oid = to_regprocedure(f.sig))
    = '49bb1f21f071141d30926ad426f87369,edc9975010746e53e4af6a75ad9763dc,146d0275f5a97b9ecd6a52e11161b248,4814691695eb7587c18628ede17f266f');
  perform t216.afirma('P9 wrappers INVOKER; RPC de edición DEFINER',
    (select bool_and(not prosecdef) from pg_proc where oid in (to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)'),
       to_regprocedure('public.anular_pago_previo_controlado(bigint,uuid,text)'), to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')))
    and (select bool_and(prosecdef) from pg_proc where oid in (to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)'),
       to_regprocedure('public.editar_servicios_cotizacion_manual(uuid,bigint,integer,text,jsonb,jsonb)'),
       to_regprocedure('public.actualizar_recobro_ninos_manual(uuid,bigint,integer,text,jsonb)'))));
  perform t216.afirma('P10 la edición está habilitada para authenticated (frontera activa, sin suspensión)',
    t216.escalar('authenticated', t216.u('admin'), 'select public.edicion_cotizaciones_habilitada()::text') = 'true');
  perform t216.rechaza('P11 anon no consulta la habilitación', t216.intenta('anon', null, 'select public.edicion_cotizaciones_habilitada()'), 'permission denied');
  perform t216.rechaza('P12 authenticated no llama p39_priv.emitir', t216.intenta('authenticated', t216.u('admin'), 'select p39_priv.emitir(1, ''pago'', null)'), 'permission denied');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- E0. Creación por la RPC (autor estable)'
do $$
declare c bigint; m bigint; r text; v public.cotizaciones;
begin
  c := t216.crear('ventaA');
  insert into t216.ids values ('ventaA', c);
  select * into v from public.cotizaciones where id = c;
  perform t216.afirma('E0.1 creado_por_id = actor, creado_por = su correo, tipo manual simple abierta, rev 1+',
    v.creado_por_id = t216.u('ventaA') and v.creado_por = 'c216-ventaA@x.test' and v.tipo = 'manual' and v.modo = 'simple'
    and v.estado = 'abierta' and v.economico_rev >= 1, row_to_json(v)::text);
  perform t216.afirma('E0.2 servicios creados en la misma operación (2)', (select count(*) from public.cotizacion_servicios where cotizacion_id = c) = 2);
  -- Un no superadmin no elige agencia (queda la suya); superadmin sí.
  m := t216.crear('admin', null, 'minorista');
  perform t216.afirma('E0.3 un no superadmin no elige agencia', (select tenant from public.cotizaciones where id = m) = 'mayorista');
  m := t216.crear('super', null, 'minorista');
  insert into t216.ids values ('min_super', m);
  perform t216.afirma('E0.4 superadmin crea en la agencia elegida', (select tenant from public.cotizaciones where id = m) = 'minorista');
  r := t216.escalar('service_role', null, format('select public.crear_cotizacion_manual(%L, ''mayorista'', %L::jsonb, %L::jsonb)::text',
         t216.u('admin'), t216.cab() || jsonb_build_object('precio_venta', 999), t216.serv()));
  perform t216.rechaza('E0.5 total incoherente se rechaza', r, 'EDICION_39_INCOHERENTE');
  r := t216.escalar('service_role', null, format('select public.crear_cotizacion_manual(%L, ''mayorista'', %L::jsonb, ''[]''::jsonb)::text', t216.u('admin'), t216.cab()));
  perform t216.rechaza('E0.6 sin servicios se rechaza', r, 'EDICION_39_SERVICIOS');
  r := t216.escalar('service_role', null, format('select public.crear_cotizacion_manual(%L, ''mayorista'', %L::jsonb, %L::jsonb)::text',
         t216.u('admin'), t216.cab() || jsonb_build_object('vigencia_hasta', (public.fecha_negocio() - 1)::text), t216.serv()));
  perform t216.rechaza('E0.7 vigencia pasada se rechaza', r, 'EDICION_39_INCOHERENTE');
  for r in select unnest(array['inactivo', 'agencia', 'vuelo', 'nadie']) loop
    perform t216.rechaza('E0.8 ' || r || ' no crea', t216.escalar('service_role', null, format('select public.crear_cotizacion_manual(%L, ''mayorista'', %L::jsonb, %L::jsonb)::text',
         t216.u(r), t216.cab(), t216.serv())), 'EDICION_39_NO_AUTORIZADO');
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- T. Rol, tenant y autor de la edición (C1/C2)'
do $$
declare cA bigint := (select v from t216.ids where k = 'ventaA'); legacy bigint; cMin bigint := (select v from t216.ids where k = 'min_super');
        s jsonb := t216.serv(600000); r text; k text;
begin
  legacy := t216.crear_legada();
  insert into t216.ids values ('legacy', legacy);
  perform t216.acepta('T1 venta edita SU cotización', t216.intenta('service_role', null, t216.editar_sql(cA, 'ventaA', s)));
  perform t216.rechaza('T2 venta NO edita la de otro asesor (V2: autoría)', t216.intenta('service_role', null, t216.editar_sql(cA, 'ventaB', t216.serv(650000))), 'EDICION_39_AUTOR');
  perform t216.rechaza('T3 venta NO edita una manual antigua sin autor (V4)', t216.intenta('service_role', null, t216.editar_sql(legacy, 'ventaA', s)), 'EDICION_39_AUTOR');
  foreach k in array array['admin', 'gerencia', 'oper', 'super'] loop
    perform t216.acepta('T4 ' || k || ' edita en su agencia (incluida la antigua)', t216.intenta('service_role', null, t216.editar_sql(legacy, k, t216.serv(500000 + length(k) * 1000))));
  end loop;
  perform t216.rechaza('T5 otra agencia no edita (adminMin sobre mayorista)', t216.intenta('service_role', null, t216.editar_sql(cA, 'adminMin', s)), 'EDICION_39_NO_AUTORIZADO');
  perform t216.acepta('T6 superadmin edita la de minorista', t216.intenta('service_role', null, t216.editar_sql(cMin, 'super', s)));
  foreach k in array array['inactivo', 'agencia', 'vuelo', 'nadie'] loop
    perform t216.rechaza('T7 ' || k || ' no edita', t216.intenta('service_role', null, t216.editar_sql(legacy, k, s)), 'EDICION_39_NO_AUTORIZADO');
  end loop;
  perform t216.rechaza('T8 authenticated no llama la RPC de edición', t216.intenta('authenticated', t216.u('admin'), t216.editar_sql(legacy, 'admin', s)), 'permission denied');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- E. Edición funcional'
do $$
declare c bigint; v0 public.cotizaciones; v1 public.cotizaciones; h public.cotizacion_ediciones; s jsonb; r text;
begin
  c := t216.crear('admin', t216.cab('interno', 100000, 1, 200000));
  select * into v0 from public.cotizaciones where id = c;
  s := jsonb_build_array(t216.serv()->0, jsonb_set(t216.serv(800000)->1, '{nombre_servicio}', '"Hotel Nuevo"'),
         jsonb_build_object('orden', 2, 'tipo_servicio', 'traslado', 'plataforma', 'Directo', 'nombre_servicio', 'Traslado',
           'proveedor', 'TransCo', 'costo_neto', 80000, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 100000));
  perform t216.acepta('E1 modificar y agregar', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s, '  el cliente cambió de hotel ')));
  select * into v1 from public.cotizaciones where id = c;
  perform t216.afirma('E1.1 precio = Σ servicios + recobro + niños', v1.precio_venta = 1000000 + 800000 + 100000 + 100000 + 200000, v1.precio_venta::text);
  perform t216.afirma('E1.2 documento coherente (items suman el total, venta.precio_venta y hotel)',
    (select sum((i->>'valor')::numeric) from jsonb_array_elements(v1.detalle->'items') i) = v1.precio_venta
    and (v1.detalle->'venta'->>'precio_venta')::numeric = v1.precio_venta and v1.hotel = 'Hotel Nuevo'
    and v1.detalle->'venta'->>'hotel' = 'Hotel Nuevo');
  perform t216.afirma('E1.3 servicios reemplazados (3, orden 0..2)',
    (select array_agg(orden order by orden) from public.cotizacion_servicios where cotizacion_id = c) = array[0, 1, 2]);
  perform t216.afirma('E1.4 la revisión subió', v1.economico_rev > v0.economico_rev, v0.economico_rev || ' -> ' || v1.economico_rev);
  perform t216.afirma('E1.5 recobro, niños, titular e incluye intactos',
    v1.payload->'recobro' = v0.payload->'recobro' and v1.payload->'ninos' = v0.payload->'ninos'
    and v1.payload->'cliente' = v0.payload->'cliente' and v1.detalle->'incluye' = v0.detalle->'incluye' and v1.detalle->'recobro' = v0.detalle->'recobro');
  select * into h from public.cotizacion_ediciones where cotizacion_id = c order by id desc limit 1;
  perform t216.afirma('E1.6 historial: motivo recortado, actor, rol, revisiones, antes/después',
    h.motivo = 'el cliente cambió de hotel' and h.actor_id = t216.u('admin') and h.actor_rol = 'administracion' and h.tipo = 'servicios'
    and h.rev_anterior = v0.economico_rev and h.rev_nueva = v1.economico_rev and h.precio_anterior = v0.precio_venta and h.precio_nuevo = v1.precio_venta
    and jsonb_array_length(h.antes->'servicios') = 2 and jsonb_array_length(h.despues->'servicios') = 3, row_to_json(h)::text);
  perform t216.acepta('E2 quitar un servicio', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', jsonb_build_array(s->0))));
  perform t216.rechaza('E2.1 quitar el último servicio se rechaza', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', '[]'::jsonb, 'x', null,
       jsonb_build_object('precio_venta', 300000, 'items', t216.items(300000, 1, 200000)))), 'EDICION_39_SERVICIOS');
  perform t216.rechaza('E3 motivo vacío', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s, '   ')), 'EDICION_39_MOTIVO');
  perform t216.rechaza('E3.1 motivo de más de 500', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s, repeat('x', 501))), 'EDICION_39_MOTIVO');
  perform t216.rechaza('E4 total incoherente', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s, 'x', null,
       t216.cambios(c, s) || jsonb_build_object('precio_venta', 1))), 'EDICION_39_INCOHERENTE');
  perform t216.rechaza('E4.1 líneas que no suman el total', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s, 'x', null,
       t216.cambios(c, s) || jsonb_build_object('items', t216.items(10)))), 'EDICION_39_INCOHERENTE');
  perform t216.rechaza('E5 tipo de servicio inválido', t216.intenta('service_role', null, t216.editar_sql(c, 'admin',
       jsonb_build_array(jsonb_set(s->0, '{tipo_servicio}', '"crucero"')))), 'EDICION_39_SERVICIOS');
  perform t216.rechaza('E5.1 TA en un hotel', t216.intenta('service_role', null, t216.editar_sql(c, 'admin',
       jsonb_build_array(jsonb_set(s->1, '{modo}', '"ta"')))), 'EDICION_39_SERVICIOS');
  perform t216.rechaza('E5.2 valor como texto', t216.intenta('service_role', null, t216.editar_sql(c, 'admin',
       jsonb_build_array(jsonb_set(s->0, '{valor}', '"1000000"')), 'x', null, t216.cambios(c, jsonb_build_array(s->0)))), 'EDICION_39_SERVICIOS');
  perform t216.rechaza('E5.3 valor negativo', t216.intenta('service_role', null, t216.editar_sql(c, 'admin',
       jsonb_build_array(jsonb_set(s->0, '{valor}', '-5')), 'x', null, jsonb_build_object('precio_venta', 299995, 'items', t216.items(299995, 1, 200000)))), 'EDICION_39_SERVICIOS');
  perform t216.rechaza('E6 revisión vieja', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s, 'x', t216.rev(c) - 1)), 'EDICION_39_REVISION');
  -- Vencida: se rechaza; renovada (como hoy), se acepta.
  update public.cotizaciones set vigencia_hasta = public.fecha_negocio() - 1 where id = c;
  perform t216.rechaza('E7 vencida se rechaza', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s)), 'EDICION_39_VENCIDA');
  perform t216.acepta('E7.1 renovar la vigencia (authenticated, como hoy)', t216.intenta('authenticated', t216.u('admin'),
       format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 3 where id = %s', c)));
  perform t216.acepta('E7.2 renovada, la edición se acepta', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', s)));
  update public.cotizaciones set vigencia_hasta = public.fecha_negocio() where id = c;
  perform t216.acepta('E7.4 vence hoy: se acepta', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(510000))));
  -- Niños y recobro (C5).
  perform t216.acepta('E8 niños/recobro por su RPC', t216.intenta('service_role', null, t216.recobro_sql(c, 'admin', 2, 150000, 80000)));
  select * into v1 from public.cotizaciones where id = c;
  perform t216.afirma('E8.1 precio, payload, recobro y líneas coherentes',
    v1.precio_venta = 1510000 + 80000 + 300000 and (v1.payload->>'ninos')::int = 2 and (v1.payload->>'recobro')::numeric = 80000
    and (v1.detalle->'recobro'->>'total')::numeric = 80000 and (v1.detalle->'venta'->>'ninos')::int = 2
    and (select sum((i->>'valor')::numeric) from jsonb_array_elements(v1.detalle->'items') i) = v1.precio_venta, v1.precio_venta::text);
  perform t216.afirma('E8.2 historial de niños/recobro', exists (select 1 from public.cotizacion_ediciones where cotizacion_id = c and tipo = 'recobro_ninos' and precio_nuevo = v1.precio_venta));
  perform t216.rechaza('E8.3 interno con parte del aliado se rechaza', t216.intenta('service_role', null, t216.recobro_sql(c, 'admin', 0, 0, 1000, 500)), 'EDICION_39_INCOHERENTE');
  perform t216.rechaza('E8.4 total que no cuadra', t216.intenta('service_role', null, t216.recobro_sql(c, 'admin', 0, 0, 1000, 0, 'x', null, 5)), 'EDICION_39_INCOHERENTE');
  perform t216.rechaza('E8.5 recobro sin motivo', t216.intenta('service_role', null, t216.recobro_sql(c, 'admin', 0, 0, 0, 0, ' ')), 'EDICION_39_MOTIVO');
  perform t216.rechaza('E8.6 niños fraccionarios', t216.intenta('service_role', null, replace(t216.recobro_sql(c, 'admin', 1, 0, 0), '"ninos": 1', '"ninos": 1.5')), 'EDICION_39_INCOHERENTE');
  insert into t216.ids values ('editada', c);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- E9. No elegibles (C1)'
do $$
declare c bigint; p bigint; r text; madre bigint; hija bigint; rid uuid;
begin
  -- Congelada por un pago (aunque luego se anule).
  c := t216.crear('admin');
  p := t216.pagar(c, 100000, 'e9-pago-1');
  perform t216.rechaza('E9.1 con pago (congelada) no se edita', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_CONGELADA');
  perform t216.rechaza('E9.2 ni su recobro (decisión 1)', t216.intenta('service_role', null, t216.recobro_sql(c, 'admin', 0, 0, 5000)), 'EDICION_39_CONGELADA');
  perform t216.acepta('E9.3 se anula el pago', t216.intenta('service_role', null, format('select public.anular_pago_previo_controlado(%s, %L, ''prueba'')', p, t216.u('admin'))));
  perform t216.rechaza('E9.4 anulado el pago, sigue sin editarse', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_CONGELADA');
  insert into t216.ids values ('congelada_anulada', c);
  -- Un pago sin congelado (estado imposible por la app; se fabrica como dueño) → CON_PAGOS.
  c := t216.crear('admin');
  insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, forma_pago, referencia, registrado_por_id, estado)
  values (c, 'mayorista', 1, 1, 'COP', 'Transferencia', 'R-E9-5', t216.u('admin'), 'anulado');
  perform t216.rechaza('E9.5 con cualquier fila de pago (anulado) no se edita', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_CON_PAGOS');
  -- Descartada / convertida.
  c := t216.crear('admin');
  perform t216.acepta('E9.6 descartar (authenticated)', t216.intenta('authenticated', t216.u('admin'), format('update public.cotizaciones set estado = ''descartada'' where id = %s', c)));
  perform t216.rechaza('E9.7 descartada no se edita', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_NO_ELEGIBLE');
  -- Madre e hija de la 211.
  madre := public.crear_cotizacion_comparativa(t216.u('admin'),
    jsonb_build_object('tipo', 'comparativa_manual', 'tenant', 'mayorista', 'moneda', 'COP', 'vigencia_hasta', (public.fecha_negocio() + 5)::text,
      'cliente', 'Cliente Prueba', 'cliente_documento', '1234567', 'destino', 'Cartagena', 'plan_nombre', 'Comparativa', 'pax', 2,
      'asesor', 'Asesor 216', 'fecha_salida', (public.fecha_negocio() + 20)::text, 'fecha_regreso', (public.fecha_negocio() + 24)::text,
      'payload', t216.cab()->'payload', 'detalle', jsonb_build_object('comparativa', true, 'venta', jsonb_build_object('cliente', 'Cliente Prueba', 'estado', 'cotizacion'))),
    jsonb_build_array(t216.serv()->0,
      jsonb_set(jsonb_set(t216.serv()->1, '{opcion_ref}', '"A"'), '{orden}', '1'),
      jsonb_set(jsonb_set(jsonb_set(t216.serv(700000)->1, '{opcion_ref}', '"B"'), '{orden}', '2'), '{nombre_servicio}', '"Hotel B"')),
    jsonb_build_array(
      jsonb_build_object('opcion_ref', 'A', 'acomodacion_ref', 'unica', 'orden', 0, 'etiqueta', 'Hotel A', 'moneda', 'COP', 'tarifa_persona', 750000, 'total', 1500000,
        'resumen_publico', jsonb_build_object('hotel', 'Hotel A', 'total', 1500000),
        'plantilla_hija', jsonb_build_object('hotel', 'Hotel A', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2,
          'payload', t216.cab()->'payload', 'detalle', t216.cab()->'detalle')),
      jsonb_build_object('opcion_ref', 'B', 'acomodacion_ref', 'unica', 'orden', 1, 'etiqueta', 'Hotel B', 'moneda', 'COP', 'tarifa_persona', 850000, 'total', 1700000,
        'resumen_publico', jsonb_build_object('hotel', 'Hotel B', 'total', 1700000),
        'plantilla_hija', jsonb_build_object('hotel', 'Hotel B', 'destino', 'Cartagena', 'plan_nombre', 'Cotización dinámica', 'pax', 2,
          'payload', t216.cab()->'payload', 'detalle', t216.cab(p_suma => 1700000)->'detalle'))), null);
  insert into t216.ids values ('madre', madre);
  perform t216.rechaza('E9.8 la madre no se edita', t216.intenta('service_role', null, t216.editar_sql(madre, 'admin', t216.serv())), 'EDICION_39_NO_ELEGIBLE');
  rid := public.registrar_validacion_comparativa(madre, 'A', 'unica', 1, 'interno', t216.u('admin'), 1500000, 'COP', true, null);
  r := t216.escalar('authenticated', t216.u('admin'), format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-216-hija'')::text', rid));
  perform t216.afirma('E9.9 se elige una opción (hija)', r ~ '^\d+$', r);
  hija := r::bigint;
  insert into t216.ids values ('hija', hija);
  perform t216.rechaza('E9.10 la hija no se edita en fase 1', t216.intenta('service_role', null, t216.editar_sql(hija, 'admin', t216.serv())), 'EDICION_39_NO_ELEGIBLE');
  perform t216.rechaza('E9.11 ni su recobro', t216.intenta('service_role', null, t216.recobro_sql(hija, 'admin', 0, 0, 1000)), 'EDICION_39_NO_ELEGIBLE');
  perform t216.afirma('E9.12 la madre conserva su revisión y su sello',
    (select economico_rev = 1 and sello_economico = f211_priv.sello_madre(id) from public.cotizaciones where id = madre));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- E11. Historial: lectura por rol'
do $$
declare c bigint := (select v from t216.ids where k = 'ventaA'); n text;
begin
  perform t216.afirma('E11.1 venta ve el historial de SU cotización',
    t216.escalar('authenticated', t216.u('ventaA'), format('select count(*)::text from public.cotizacion_ediciones where cotizacion_id = %s', c))::int >= 1);
  perform t216.afirma('E11.2 otro asesor no lo ve',
    t216.escalar('authenticated', t216.u('ventaB'), format('select count(*)::text from public.cotizacion_ediciones where cotizacion_id = %s', c)) = '0');
  perform t216.afirma('E11.3 administración lo ve',
    t216.escalar('authenticated', t216.u('admin'), format('select count(*)::text from public.cotizacion_ediciones where cotizacion_id = %s', c))::int >= 1);
  perform t216.afirma('E11.4 otra agencia no lo ve',
    t216.escalar('authenticated', t216.u('adminMin'), format('select count(*)::text from public.cotizacion_ediciones where cotizacion_id = %s', c)) = '0');
  perform t216.rechaza('E11.5 nadie de la API inserta en el historial', t216.intenta('service_role', null,
    format('insert into public.cotizacion_ediciones (cotizacion_id, tenant, tipo, actor_id, actor_rol, motivo, rev_anterior, rev_nueva, antes, despues) values (%s, ''mayorista'', ''servicios'', %L, ''x'', ''x'', 1, 2, ''{}'', ''{}'')', c, t216.u('admin'))), 'permission denied');
  perform t216.rechaza('E11.6 ni el dueño cambia una fila del historial (solo inserción)', t216.intenta('supabase_admin', null,
    format('update public.cotizacion_ediciones set motivo = ''otro'' where cotizacion_id = %s', c)), 'EDICION_39_HISTORIAL');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- V. Renovación de vigencia (decisión A: como hoy; la autoría rige la edición)'
do $$
declare cA bigint; legacy bigint := (select v from t216.ids where k = 'legacy'); cong bigint := (select v from t216.ids where k = 'congelada_anulada');
        hija bigint := (select v from t216.ids where k = 'hija'); tar bigint; r text; v_antes jsonb;
begin
  cA := t216.crear('ventaA');
  update public.cotizaciones set vigencia_hasta = public.fecha_negocio() - 1 where id = cA;
  perform t216.acepta('V1 venta renueva SU manual', t216.intenta('authenticated', t216.u('ventaA'), format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 2 where id = %s', cA)));
  perform t216.acepta('V1.1 …y luego la edita (C1 se cumple)', t216.intenta('service_role', null, t216.editar_sql(cA, 'ventaA', t216.serv(520000))));
  perform t216.acepta('V2 venta renueva una manual AJENA de su agencia (como hoy)', t216.intenta('authenticated', t216.u('ventaB'), format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 4 where id = %s', cA)));
  perform t216.afirma('V2.1 la renovación quedó', (select vigencia_hasta from public.cotizaciones where id = cA) = public.fecha_negocio() + 4);
  perform t216.rechaza('V2.2 …pero no la edita (C2)', t216.intenta('service_role', null, t216.editar_sql(cA, 'ventaB', t216.serv(530000))), 'EDICION_39_AUTOR');
  perform t216.afirma('V3 otra agencia no la renueva (0 filas por la 154)',
    t216.escalar('authenticated', t216.u('adminMin'), format('with u as (update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 9 where id = %s returning 1) select count(*)::text from u', cA)) = '0');
  perform t216.acepta('V4 venta renueva una manual antigua sin autor (como hoy)', t216.intenta('authenticated', t216.u('ventaA'), format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 4 where id = %s', legacy)));
  perform t216.rechaza('V4.1 …pero no la edita (C2)', t216.intenta('service_role', null, t216.editar_sql(legacy, 'ventaA', t216.serv(530000))), 'EDICION_39_AUTOR');
  perform t216.acepta('V6 el autor renueva una con pago anulado', t216.intenta('authenticated', t216.u('admin'), format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 4 where id = %s', cong)));
  perform t216.rechaza('V6.1 …y sigue sin editarse (C1)', t216.intenta('service_role', null, t216.editar_sql(cong, 'admin', t216.serv(530000))), 'EDICION_39_CONGELADA');
  r := t216.intenta('authenticated', t216.u('admin'), format('update public.cotizaciones set vigencia_hasta = vigencia_tope where id = %s', hija));
  perform t216.acepta('V8 la hija se renueva dentro de su tope', r);
  perform t216.rechaza('V8.1 más allá del tope lo rechaza la 211', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set vigencia_hasta = vigencia_tope + 1 where id = %s', hija)), 'COMPARATIVA_VIGENCIA');
  perform t216.rechaza('V8.2 …y la hija sigue sin editarse', t216.intenta('service_role', null, t216.editar_sql(hija, 'admin', t216.serv())), 'EDICION_39_NO_ELEGIBLE');
  perform t216.rechaza('V9 venta no se vuelve autora por REST (frontera y 211)', t216.intenta('authenticated', t216.u('ventaB'),
    format('update public.cotizaciones set creado_por_id = %L where id = %s', t216.u('ventaB'), cA)), '42501');
  perform t216.rechaza('V9.1 ni cambia el origen (frontera y 211)', t216.intenta('authenticated', t216.u('ventaB'),
    format('update public.cotizaciones set cotizacion_origen_id = %s where id = %s', hija, cA)), '42501');
  -- V10: tarifario/carrito igual que hoy.
  r := t216.escalar('authenticated', t216.u('ventaB'), $q$ insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta)
        values ('mayorista', 'tarifario', 'abierta', '{}', 'COP', 1000, public.fecha_negocio() + 3) returning id::text $q$);
  perform t216.afirma('V10 una de tarifario se crea por la API como siempre', r ~ '^\d+$', r);
  tar := r::bigint;
  perform t216.acepta('V10.1 …y otro asesor la renueva y le cambia el precio, como hoy (fuera de fase 1)', t216.intenta('authenticated', t216.u('ventaA'),
    format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 9, precio_venta = 2000 where id = %s', tar)));
  -- V13: PATCH solo de vigencia pasa; mezclado con precio o congelado, falla entero.
  select to_jsonb(c) - 'vigencia_hasta' into v_antes from public.cotizaciones c where id = cA;
  perform t216.acepta('V13 PATCH solo de vigencia (service_role) pasa', t216.intenta('service_role', null, format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 6 where id = %s', cA)));
  perform t216.rechaza('V13.1 vigencia + precio falla', t216.intenta('authenticated', t216.u('ventaA'),
    format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 7, precio_venta = 1 where id = %s', cA)), 'FRONTERA_39');
  perform t216.rechaza('V13.2 vigencia + congelado falla', t216.intenta('service_role', null,
    format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 7, monto_exigido_total = 0 where id = %s', cA)), 'FRONTERA_39');
  perform t216.afirma('V13.3 nada cambió a medias', (select vigencia_hasta from public.cotizaciones where id = cA) = public.fecha_negocio() + 6
    and (select to_jsonb(c) - 'vigencia_hasta' from public.cotizaciones c where id = cA) = v_antes);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- D. Escrituras directas (Data API) con la frontera activa'
do $$
declare c bigint; p bigint; s bigint; v_antes jsonb; pagada bigint; r text; rol text;
begin
  c := t216.crear('admin');
  s := (select min(id) from public.cotizacion_servicios where cotizacion_id = c);
  select to_jsonb(x) into v_antes from public.cotizaciones x where id = c;
  foreach rol in array array['service_role', 'authenticated'] loop
    perform t216.rechaza('D1 ' || rol || ' no inserta servicios', t216.intenta(rol, t216.u('admin'),
      format('insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, valor) values (%s, ''hotel'', 5)', c)), 'permission denied');
    perform t216.rechaza('D1.1 ' || rol || ' no cambia servicios', t216.intenta(rol, t216.u('admin'), format('update public.cotizacion_servicios set valor = 1 where id = %s', s)), 'permission denied');
    perform t216.rechaza('D1.2 ' || rol || ' no borra servicios', t216.intenta(rol, t216.u('admin'), format('delete from public.cotizacion_servicios where id = %s', s)), 'permission denied');
    perform t216.rechaza('D2 ' || rol || ' no cambia el precio', t216.intenta(rol, t216.u('admin'), format('update public.cotizaciones set precio_venta = 1 where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D2.1 ' || rol || ' no forja el PRIMER congelado sin pago (COP, exigido 0)', t216.intenta(rol, t216.u('admin'),
      format('update public.cotizaciones set condicion_pago_congelada_en = now(), moneda_congelada = ''COP'', trm_autoritativa = 1, precio_total_congelado = precio_venta, monto_exigido_total = 0, monto_exigido_total_cop = 0 where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D2.2 ' || rol || ' no fija una TRM a voluntad', t216.intenta(rol, t216.u('admin'),
      format('update public.cotizaciones set trm_autoritativa = 9999 where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D2.3 ' || rol || ' no cambia recobro ni niños del payload', t216.intenta(rol, t216.u('admin'),
      format('update public.cotizaciones set payload = jsonb_set(payload, ''{recobro}'', ''9'') where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D2.4 ' || rol || ' no cambia las líneas del documento', t216.intenta(rol, t216.u('admin'),
      format('update public.cotizaciones set detalle = jsonb_set(detalle, ''{items}'', ''[]'') where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D3 ' || rol || ' no la marca convertida', t216.intenta(rol, t216.u('admin'),
      format('update public.cotizaciones set estado = ''convertida'' where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D4 ' || rol || ' no inserta una manual', t216.intenta(rol, t216.u('admin'),
      $q$ insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta) values ('mayorista', 'manual', 'abierta', '{}', 'COP', 1, public.fecha_negocio() + 3) $q$), 'FRONTERA_39');
    perform t216.rechaza('D4.1 ' || rol || ' no borra una manual', t216.intenta(rol, t216.u('admin'), format('delete from public.cotizaciones where id = %s', c)), 'FRONTERA_39');
    perform t216.rechaza('D4.2 ' || rol || ' no convierte una de tarifario en manual', t216.intenta(rol, t216.u('admin'),
      format('update public.cotizaciones set tipo = ''manual'' where id = (select id from public.cotizaciones where tipo = ''tarifario'' order by id desc limit 1)')), 'FRONTERA_39');
  end loop;
  perform t216.afirma('D5 nada cambió', (select to_jsonb(x) from public.cotizaciones x where id = c) = v_antes);
  perform t216.afirma('D5.1 PATCH de economico_rev se ignora (la revisión es derivada)',
    t216.intenta('authenticated', t216.u('admin'), format('update public.cotizaciones set economico_rev = 999 where id = %s', c)) = 'ok'
    and t216.rev(c) = (v_antes->>'economico_rev')::int);
  -- Pagos y condiciones.
  pagada := t216.crear('admin');
  p := t216.pagar(pagada, 100000, 'd-pago-1');
  insert into t216.ids values ('pagada', pagada);
  perform t216.rechaza('D6 authenticated no inserta pagos', t216.intenta('authenticated', t216.u('admin'),
    format('insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, forma_pago, referencia, registrado_por_id) values (%s, ''mayorista'', 1, 1, ''COP'', ''Transferencia'', ''R-D6'', %L)', c, t216.u('admin'))), 'permission denied');
  perform t216.rechaza('D6.1 service_role no inserta un pago sin la operación', t216.intenta('service_role', null,
    format('insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, forma_pago, referencia, registrado_por_id) values (%s, ''mayorista'', 1, 1, ''COP'', ''Transferencia'', ''R-D61'', %L)', c, t216.u('admin'))), 'FRONTERA_39');
  perform t216.rechaza('D6.2 service_role no cambia el importe de un pago', t216.intenta('service_role', null, format('update public.cotizacion_pagos_previos set monto_cop = 1 where id = %s', p)), 'FRONTERA_39');
  perform t216.rechaza('D6.3 ni lo mueve a otra cotización ("nunca tuvo pago")', t216.intenta('service_role', null, format('update public.cotizacion_pagos_previos set cotizacion_id = %s where id = %s', c, p)), 'FRONTERA_39');
  perform t216.rechaza('D6.4 ni lo anula sin la operación', t216.intenta('service_role', null, format('update public.cotizacion_pagos_previos set estado = ''anulado'' where id = %s', p)), 'FRONTERA_39');
  perform t216.rechaza('D6.5 ni lo marca aplicado', t216.intenta('service_role', null, format('update public.cotizacion_pagos_previos set estado = ''aplicado'' where id = %s', p)), 'FRONTERA_39');
  perform t216.rechaza('D6.6 service_role no borra pagos', t216.intenta('service_role', null, format('delete from public.cotizacion_pagos_previos where id = %s', p)), 'permission denied');
  perform t216.rechaza('D6.7 authenticated no borra pagos', t216.intenta('authenticated', t216.u('admin'), format('delete from public.cotizacion_pagos_previos where id = %s', p)), 'permission denied');
  perform t216.rechaza('D6.8 service_role no quita el congelado ("nunca tuvo pago")', t216.intenta('service_role', null,
    format('update public.cotizaciones set condicion_pago_congelada_en = null where id = %s', pagada)), 'FRONTERA_39');
  perform t216.rechaza('D7 service_role no escribe condiciones sin la operación', t216.intenta('service_role', null,
    format('insert into public.cotizacion_condiciones (cotizacion_id, tipo_componente, orden) values (%s, ''servicio'', 9)', c)), 'FRONTERA_39');
  perform t216.rechaza('D7.1 authenticated tampoco', t216.intenta('authenticated', t216.u('admin'),
    format('insert into public.cotizacion_condiciones (cotizacion_id, tipo_componente, orden) values (%s, ''servicio'', 9)', c)), 'permission denied');
  perform t216.rechaza('D7.2 service_role no borra condiciones congeladas', t216.intenta('service_role', null,
    format('delete from public.cotizacion_condiciones where cotizacion_id = %s', pagada)), 'FRONTERA_39');
  perform t216.afirma('D8 el pago y su congelado siguen intactos',
    (select estado = 'activo' and monto_cop = 100000 and cotizacion_id = pagada from public.cotizacion_pagos_previos where id = p)
    and (select condicion_pago_congelada_en is not null from public.cotizaciones where id = pagada));
  -- Lo que SIGUE permitido.
  perform t216.acepta('D9 titular por la API (no es económico)', t216.intenta('authenticated', t216.u('ventaB'),
    format($q$ update public.cotizaciones set cliente = 'Otro Nombre', cliente_documento = '999',
        payload = jsonb_set(payload, '{cliente,nombres}', '"Otro"'), detalle = jsonb_set(detalle, '{venta,cliente}', '"Otro Nombre"') where id = %s $q$, c)));
  perform t216.acepta('D9.1 incluye/no incluye por la API', t216.intenta('authenticated', t216.u('ventaB'),
    format($q$ update public.cotizaciones set detalle = detalle || '{"incluye":"x","noIncluye":"y"}', payload = payload || '{"incluye":"x","noIncluye":"y"}' where id = %s $q$, c)));
  perform t216.afirma('D9.2 titular e incluye no mueven la revisión', t216.rev(c) = (v_antes->>'economico_rev')::int);
  perform t216.rechaza('D9.3 titular con servicios VIEJOS en el payload (otra pestaña) se rechaza', t216.intenta('authenticated', t216.u('ventaB'),
    format($q$ update public.cotizaciones set cliente = 'Viejo', payload = jsonb_set(payload, '{servicios}', '[{"tipo":"hotel"}]') where id = %s $q$, c)), 'FRONTERA_39');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- F. Primer pago: revisión, composición y tenant'
do $$
declare c bigint; r text; snap jsonb; n0 int;
begin
  c := t216.crear('admin');
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'f1', t216.rev(c) - 1));
  perform t216.rechaza('F1 revisión vieja se rechaza', r, 'PAGO_39_REVISION');
  snap := t216.snap(c);
  snap := jsonb_set(jsonb_set(snap, '{0,valor_componente}', to_jsonb((snap->0->>'valor_componente')::numeric - 100000)),
                    '{1,valor_componente}', to_jsonb((snap->1->>'valor_componente')::numeric + 100000));
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'f2', null, snap));
  perform t216.rechaza('F2 misma suma, otra composición se rechaza', r, 'PAGO_39_COMPOSICION');
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'f2b', null, t216.snap(c) - 1));
  perform t216.rechaza('F2.1 un componente de menos se rechaza', r, 'PAGO_39_COMPOSICION');
  perform t216.acepta('F3.0 cambio SOLO de proveedor (por la RPC de edición)', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(500000, 'Otro Proveedor'))));
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'f3', t216.rev(c) - 1, t216.snap(c)));
  perform t216.rechaza('F3 cambio solo de proveedor: la revisión vieja se rechaza', r, 'PAGO_39_REVISION');
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'adminMin', 100000, 'f4'));
  perform t216.rechaza('F4 otra agencia no paga', r, '42501');
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'ventaA', 100000, 'f5'));
  perform t216.rechaza('F5 venta no registra pagos (rol de la 164)', r, 'no autorizado');
  perform t216.afirma('F6 nada se escribió con los rechazos', not exists (select 1 from public.cotizacion_pagos_previos where cotizacion_id = c)
    and (select condicion_pago_congelada_en is null from public.cotizaciones where id = c)
    and not exists (select 1 from public.cotizacion_condiciones where cotizacion_id = c));
  select count(*) into n0 from p39_priv.autorizacion_emitida;
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'f7'));
  perform t216.afirma('F7 primer pago correcto por el wrapper', r ~ '^OK\|\d+$', r);
  perform t216.afirma('F7.1 congelado, condiciones = snapshot, pago y asiento 280510',
    (select condicion_pago_congelada_en is not null and monto_exigido_total = t216.exigido(c) from public.cotizaciones where id = c)
    and (select count(*) from public.cotizacion_condiciones where cotizacion_id = c) = jsonb_array_length(t216.snap(c))
    and exists (select 1 from public.asientos_contables where referencia = 'pago_previo:' || substr(r, 4) and origen = 'pago_previo'));
  perform t216.afirma('F7.2 la autorización se emitió y se cerró (una de cada)',
    (select count(*) from p39_priv.autorizacion_emitida) = n0 + 1
    and (select count(*) from p39_priv.autorizacion_emitida e where e.id > 0
           and not exists (select 1 from p39_priv.autorizacion_cerrada x where x.autorizacion_id = e.id)) = 0);
  perform t216.rechaza('F8 la madre no recibe pagos por el wrapper', t216.escalar('service_role', null,
    t216.pago_sql((select v from t216.ids where k = 'madre'), 'admin', 1, 'f8', 1, '[]'::jsonb)), 'solo aplican a cotizaciones dinámicas');
end $$;

-- USD con servicios a escala (total 1500 USD).
do $$
declare c bigint; r text; s jsonb;
begin
  s := jsonb_build_array(jsonb_build_object('orden', 0, 'tipo_servicio', 'hotel', 'plataforma', 'Booking', 'nombre_servicio', 'Hotel USD',
         'proveedor', 'HU', 'costo_neto', 1200, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', 1500));
  c := t216.crear('admin', t216.cab('interno', 0, 0, 0, 'USD', 1500), 'mayorista', s);
  r := t216.escalar('service_role', null, format('select public.registrar_pago_previo_rev(%s, 100, ''USD'', 4000, ''Transferencia'', ''REF-usd2'', public.fecha_negocio(), %L, ''f9-usd2'', %s, %L::jsonb, %s, null)',
         c, t216.u('admin'), t216.rev(c), t216.snap(c), t216.exigido(c)));
  perform t216.afirma('F9.1 USD: primer pago con TRM 4000', r ~ '^OK\|\d+$', r);
  perform t216.afirma('F9.2 TRM y monto COP congelados con esa TRM',
    (select trm_autoritativa = 4000 and moneda_congelada = 'USD' from public.cotizaciones where id = c)
    and (select monto_cop = 400000 from public.cotizacion_pagos_previos where cotizacion_id = c));
  perform t216.rechaza('F9.3 la TRM congelada no se cambia por la API', t216.intenta('service_role', null,
    format('update public.cotizaciones set trm_autoritativa = 1 where id = %s', c)), 'FRONTERA_39');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- O. Firmas antiguas (la 198 llamada directo) con la frontera activa'
do $$
declare c bigint; p bigint; r text; n_v int; v_num text; conv bigint; h jsonb; h2 jsonb; d0 bigint; dd bigint;
begin
  -- H2: cada llamada directa rechazada (y cada réplica sin escritura) se compara con la
  -- huella de dinero tomada justo antes (t216.huella_dinero: venta, contrato, abonos, CxP,
  -- comisiones B2B, condiciones, asientos y su numeración, pagos previos y la cotización).
  c := t216.crear('admin');
  h := t216.huella_dinero(c);
  r := t216.intenta('service_role', null, format('select public.registrar_pago_previo(%s, 100000, ''COP'', 1, ''Transferencia'', ''REF-o1'', public.fecha_negocio(), %L, ''o1'', %L::jsonb, %s, null)',
         c, t216.u('admin'), t216.snap(c), t216.exigido(c)));
  perform t216.rechaza('O1 primer pago directo a la 198 falla', r, 'FRONTERA_39');
  perform t216.afirma('O1.1 sin restos (ni pago, ni condiciones, ni congelado)', not exists (select 1 from public.cotizacion_pagos_previos where cotizacion_id = c)
    and not exists (select 1 from public.cotizacion_condiciones where cotizacion_id = c)
    and (select condicion_pago_congelada_en is null from public.cotizaciones where id = c));
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O1.2 sin efectos financieros: huella de dinero idéntica', h2 = h, t216.dif_huella(h, h2));
  p := t216.pagar(c, 450000, 'o2-legit');
  h := t216.huella_dinero(c);
  r := t216.intenta('service_role', null, format('select public.registrar_pago_previo(%s, 10000, ''COP'', 1, ''Transferencia'', ''REF-o2'', public.fecha_negocio(), %L, ''o2'', null, null, null)', c, t216.u('admin')));
  perform t216.rechaza('O2 segundo pago directo a la 198 falla', r, 'FRONTERA_39');
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O2.3 sin efectos financieros tras el segundo pago directo', h2 = h, t216.dif_huella(h, h2));
  perform t216.afirma('O2.1 el replay con la MISMA clave devuelve el pago original sin escribir',
    t216.escalar('service_role', null, format('select public.registrar_pago_previo(%s, 450000, ''COP'', 1, ''Transferencia'', ''REF-o2-legit'', public.fecha_negocio(), %L, ''o2-legit'', null, null, null)', c, t216.u('admin'))) = 'OK|' || p);
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O2.4 el replay no escribe: huella de dinero idéntica', h2 = h, t216.dif_huella(h, h2));
  perform t216.rechaza('O2.2 la misma clave con otros datos se rechaza (huella)', t216.escalar('service_role', null,
    format('select public.registrar_pago_previo(%s, 1, ''COP'', 1, ''Transferencia'', ''REF-o2-legit'', public.fecha_negocio(), %L, ''o2-legit'', null, null, null)', c, t216.u('admin'))), 'datos distintos');
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O2.5 la clave con otros datos no escribe: huella de dinero idéntica', h2 = h, t216.dif_huella(h, h2));
  perform t216.rechaza('O3 anular directo a la 198 falla', t216.intenta('service_role', null, format('select public.anular_pago_previo(%s, %L, ''x'')', p, t216.u('admin'))), 'FRONTERA_39');
  perform t216.afirma('O3.1 sigue activo y sin asiento de reversa', (select estado from public.cotizacion_pagos_previos where id = p) = 'activo'
    and not exists (select 1 from public.asientos_contables where origen = 'pago_previo_reversion' and referencia = 'pago_previo:' || p));
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O3.2 sin efectos financieros tras anular directo', h2 = h, t216.dif_huella(h, h2));
  select count(*) into n_v from public.ventas where cotizacion_id = c;
  d0 := t216.ultimo_dtm();
  r := t216.intenta('service_role', null, format('select public.convertir_cotizacion_a_contrato(%s, %L)', c, t216.u('admin')));
  perform t216.rechaza('O4 convertir directo a la 198 falla (aunque alcance el mínimo)', r, 'FRONTERA_39');
  perform t216.afirma('O4.1 sin venta, abonos ni contrato (el consecutivo DTM sí se consume: hueco documentado)',
    (select count(*) from public.ventas where cotizacion_id = c) = n_v and (select estado from public.cotizaciones where id = c) = 'abierta'
    and (select estado from public.cotizacion_pagos_previos where id = p) = 'activo');
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O4.2 sin efectos financieros tras convertir directo (venta, contrato, abonos, CxP, B2B, condiciones, asientos)',
    h2 = h, t216.dif_huella(h, h2));
  dd := t216.ultimo_dtm() - d0;
  raise notice 'INFO  O4.3 consecutivos DTM consumidos por la conversión directa rechazada: %', dd;
  -- La 198 numera (paso 7) ANTES de su primera escritura vigilada (pagos → aplicado y la
  -- cotización → convertida): si O4 falló con FRONTERA_39, llegó a numerar exactamente una vez.
  perform t216.afirma('O4.3 la conversión directa rechazada consume exactamente UN consecutivo DTM (hueco documentado)', dd = 1, dd::text);
  -- Convertida por la puerta: la 198 directo devuelve el número sin escribir (replay).
  v_num := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('O5 por el wrapper sí convierte', v_num !~ '^ERR', v_num);
  h := t216.huella_dinero(c);
  perform t216.afirma('O5.1 la 198 directo sobre la convertida devuelve el mismo número (replay sin escritura)',
    t216.escalar('service_role', null, format('select public.convertir_cotizacion_a_contrato(%s, %L)', c, t216.u('admin'))) = v_num);
  h2 := t216.huella_dinero(c);
  perform t216.afirma('O5.2 el replay de la conversión no escribe: huella de dinero idéntica', h2 = h, t216.dif_huella(h, h2));
  -- transferir directo: un pago ACTIVO en una convertida (estado fabricado como dueño) no se aplica.
  conv := t216.crear('admin');
  p := t216.pagar(conv, 100000, 'o6');
  insert into public.ventas (numero_contrato, cliente, asesor, tenant, cotizacion_id) values ('DTM-9216', 'x', 'x', 'mayorista', conv);
  update public.cotizaciones set estado = 'convertida', numero_contrato = 'DTM-9216' where id = conv;
  h := t216.huella_dinero(conv);
  r := t216.intenta('service_role', null, format('select public.transferir_pagos_previos_a_abonos(%s, ''DTM-9216'', %L)', conv, t216.u('admin')));
  perform t216.rechaza('O6 transferir directo falla', r, 'FRONTERA_39');
  perform t216.afirma('O6.1 sin abonos y el pago sigue activo', not exists (select 1 from public.abonos where numero_contrato = 'DTM-9216')
    and (select estado from public.cotizacion_pagos_previos where id = p) = 'activo');
  h2 := t216.huella_dinero(conv);
  perform t216.afirma('O6.2 sin efectos financieros tras transferir directo', h2 = h, t216.dif_huella(h, h2));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- G. Regresiones 164/198/208 por la puerta nueva'
do $$
declare c bigint; p1 bigint; p2 bigint; r text; v_num text; v_num2 text;
begin
  c := t216.crear('admin');
  p1 := t216.pagar(c, 100000, 'g1');
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 2000000, 'g-sobre'));
  perform t216.rechaza('G1 sobrepago rechazado (164/198)', r, 'Sobrepago');
  p2 := t216.pagar(c, 400000, 'g2');
  perform t216.afirma('G1.1 segundo pago por el wrapper', p2 > p1);
  perform t216.afirma('G1.2 reintento con la misma clave devuelve el mismo pago (I)', t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 400000, 'g2')) = 'OK|' || p2);
  perform t216.acepta('G2 anulación por el wrapper', t216.intenta('service_role', null, format('select public.anular_pago_previo_controlado(%s, %L, ''error'')', p2, t216.u('admin'))));
  perform t216.afirma('G2.1 anulado con su reversa', (select estado from public.cotizacion_pagos_previos where id = p2) = 'anulado'
    and exists (select 1 from public.asientos_contables where origen = 'pago_previo_reversion' and referencia = 'pago_previo:' || p2));
  perform t216.rechaza('G2.2 anular otra agencia (adminMin) falla en SQL', t216.intenta('service_role', null, format('select public.anular_pago_previo_controlado(%s, %L, ''x'')', p1, t216.u('adminMin'))), '42501');
  r := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.rechaza('G3 bajo el mínimo no convierte', r, 'no alcanza el mínimo');
  p2 := t216.pagar(c, 400000, 'g3');
  v_num := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('G3.1 alcanzado el mínimo, convierte', v_num ~ '^[A-Z]+-\d+$', v_num);
  perform t216.afirma('G3.2 venta, ítem, pasajero, condiciones y CxP', exists (select 1 from public.ventas where numero_contrato = v_num and cotizacion_id = c)
    and exists (select 1 from public.contrato_items where numero_contrato = v_num)
    and exists (select 1 from public.contrato_pasajeros where numero_contrato = v_num)
    and (select count(*) from public.contrato_condiciones where numero_contrato = v_num) = (select count(*) from public.cotizacion_condiciones where cotizacion_id = c)
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num) = 2);
  perform t216.afirma('G3.3 pagos activos → aplicados y abonos; el anulado no', (select count(*) from public.cotizacion_pagos_previos where cotizacion_id = c and estado = 'aplicado') = 2
    and (select count(*) from public.abonos where numero_contrato = v_num) = 2);
  perform t216.afirma('G3.4 reclasificación 280510 → 280505 por cada abono', (select count(*) from public.asientos_contables a where a.origen = 'pago_previo_aplicacion'
    and a.referencia like any (select 'pago_previo:' || p.id || ':abono:%' from public.cotizacion_pagos_previos p where p.cotizacion_id = c)) = 2);
  perform t216.afirma('G3.5 208: los abonos de la conversión siguen con contabilizable = false (contexto service_role intacto)',
    (select bool_and(contabilizable is false) from public.abonos where numero_contrato = v_num));
  v_num2 := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('G4 conversión idempotente por el wrapper (I)', v_num2 = v_num and (select count(*) from public.ventas where cotizacion_id = c) = 1);
  perform t216.rechaza('G4.1 una convertida no se edita', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_NO_ELEGIBLE');
  perform t216.rechaza('G4.2 venta no convierte (rol de la 164)', t216.escalar('service_role', null, t216.convertir_sql(t216.crear('admin'), 'ventaA')), 'no autorizado');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- G211. La madre no cobra; la hija se paga y se convierte por la puerta'
do $$
declare madre bigint := (select v from t216.ids where k = 'madre'); hija bigint := (select v from t216.ids where k = 'hija'); r text; v_num text;
begin
  perform t216.rechaza('G5 la madre no se convierte por el wrapper', t216.escalar('service_role', null, t216.convertir_sql(madre)), 'COMPARATIVA_NO_COBRABLE');
  perform t216.pagar(hija, 450000, 'g5-hija');
  v_num := t216.escalar('service_role', null, t216.convertir_sql(hija));
  perform t216.afirma('G5.1 la hija elegida se paga y se convierte por el wrapper', v_num ~ '^[A-Z]+-\d+$', v_num);
  perform t216.afirma('G5.2 la madre sigue sin dinero, con su sello', not exists (select 1 from public.cotizacion_pagos_previos where cotizacion_id = madre)
    and (select sello_economico = f211_priv.sello_madre(id) from public.cotizaciones where id = madre));
  perform t216.afirma('G5.3 la hija quedó convertida y enlazada', (select estado = 'convertida' and numero_contrato = v_num from public.cotizaciones where id = hija));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- S. Interruptor de suspensión (solo la nueva edición)'
do $$
declare c bigint; c2 bigint; p bigint; r text;
begin
  c := t216.crear('admin');
  c2 := t216.crear('admin');
  update p39_priv.suspension_edicion set suspendida = true, motivo = 'prueba S', actualizado_en = now();
  perform t216.afirma('S1 habilitación apagada para la ficha', t216.escalar('authenticated', t216.u('admin'), 'select public.edicion_cotizaciones_habilitada()::text') = 'false');
  perform t216.rechaza('S2 edición rechazada', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_SUSPENDIDA');
  perform t216.rechaza('S3 niños/recobro rechazado', t216.intenta('service_role', null, t216.recobro_sql(c, 'admin', 1, 1, 1)), 'EDICION_39_SUSPENDIDA');
  p := t216.pagar(c2, 450000, 's-pago');
  perform t216.afirma('S4 pagos siguen', p > 0);
  perform t216.afirma('S5 conversiones siguen', t216.escalar('service_role', null, t216.convertir_sql(c2)) ~ '^[A-Z]+-\d+$');
  p := t216.pagar(c, 100000, 's-pago-2');
  perform t216.acepta('S6 anulaciones siguen', t216.intenta('service_role', null, format('select public.anular_pago_previo_controlado(%s, %L, ''x'')', p, t216.u('admin'))));
  perform t216.afirma('S7 creación sigue (no es edición)', t216.crear('admin') > 0);
  update p39_priv.suspension_edicion set suspendida = false, motivo = null, actualizado_en = now();
  perform t216.afirma('S8 reanudada: habilitada otra vez', t216.escalar('authenticated', t216.u('admin'), 'select public.edicion_cotizaciones_habilitada()::text') = 'true');
  delete from p39_priv.suspension_edicion;
  perform t216.afirma('S9 sin la fila del interruptor: falla cerrado (apagada)', t216.escalar('authenticated', t216.u('admin'), 'select public.edicion_cotizaciones_habilitada()::text') = 'false');
  insert into p39_priv.suspension_edicion (id, suspendida) values (true, false);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- I. Reintentos'
do $$
declare c bigint; rev0 int;
begin
  c := t216.crear('admin');
  rev0 := t216.rev(c);
  perform t216.acepta('I1 primera edición con la revisión leída', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000), 'x', rev0)));
  perform t216.rechaza('I1.1 la MISMA edición reenviada con la revisión vieja se rechaza', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000), 'x', rev0)), 'EDICION_39_REVISION');
  perform t216.afirma('I1.2 una sola fila de historial', (select count(*) from public.cotizacion_ediciones where cotizacion_id = c) = 1);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- R. Regresión de reservar/actions.ts (sin tocarlo) con la frontera activa'
do $$
declare c bigint; pagada bigint := (select v from t216.ids where k = 'pagada'); hija2 bigint; r text; n int;
begin
  c := t216.crear('ventaA');
  perform t216.acepta('R1 actualizarVigenciaCotizacion (UPDATE de vigencia con la sesión) sobre una manual', t216.intenta('authenticated', t216.u('ventaB'),
    format('update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 2 where id = %s and estado = ''abierta''', c)));
  perform t216.acepta('R2 descartarCotizacion sin pagos', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set estado = ''descartada'' where id = %s and estado = ''abierta''', c)));
  perform t216.rechaza('R2.1 con un pago activo lo detiene la 164 (mensaje de siempre)', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set estado = ''descartada'' where id = %s and estado = ''abierta''', pagada)), 'pagos previos activos');
  r := t216.escalar('authenticated', t216.u('ventaB'), $q$ insert into public.cotizaciones (tenant, estado, payload, moneda, precio_venta, vigencia_hasta)
        values ('mayorista', 'abierta', '{}', 'COP', 1000, public.fecha_negocio() + 3) returning id::text $q$);
  perform t216.afirma('R3 crearCotizacion (tarifario, tipo por defecto) inserta como siempre', r ~ '^\d+$', r);
  r := t216.escalar('service_role', null, $q$ insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta)
        values ('mayorista', 'carrito', 'abierta', '{"items":[]}', 'COP', 1000, public.fecha_negocio() + 1) returning id::text $q$);
  perform t216.afirma('R3.1 el checkout (carrito, service_role) inserta como siempre', r ~ '^\d+$', r);
  perform t216.acepta('R3.2 y su conversión cierra el estado como siempre', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set detalle = ''{"contratos":[]}'' where id = %s', r::bigint)));
  perform t216.rechaza('R4 convertirCotizacion con el id de una MANUAL no la marca convertida (paso final, con la sesión)', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set estado = ''convertida'', numero_contrato = null where id = %s', pagada)), 'FRONTERA_39');
  -- Descartar una hija deja su evento (211) también con la frontera activa.
  select count(*) into n from public.cotizacion_comparativa_eventos where tipo = 'hija_descartada';
  hija2 := t216.crear('admin');  -- (una simple: la 211 solo registra el evento para hijas)
  perform t216.acepta('R5 descartar una simple no registra evento de comparativa', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set estado = ''descartada'' where id = %s', hija2)));
  perform t216.afirma('R5.1 sin eventos nuevos', (select count(*) from public.cotizacion_comparativa_eventos where tipo = 'hija_descartada') = n);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- G208. Un abono posterior registrado con sesión sigue contabilizable (la 208 decide por current_user)'
do $$
declare c bigint; v_num text; r text;
begin
  c := t216.crear('admin');
  perform t216.pagar(c, 450000, 'g208');
  v_num := t216.escalar('service_role', null, t216.convertir_sql(c));
  r := t216.escalar('authenticated', t216.u('admin'), format($q$ insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia, recibido_por, trm, monto_cop, tenant)
         values (%L, 'Cliente Prueba', public.fecha_negocio(), 100000, 'Transferencia', 'R-G208', 'c216-admin@x.test', 1, 100000, 'mayorista') returning contabilizable::text $q$, v_num));
  perform t216.afirma('G6 abono posterior con la sesión: contabilizable = true (registrarAbono postea su asiento en TS, fuera de esta batería)', r = 'true', r);
  perform t216.afirma('G6.1 los abonos de la conversión siguen en false', (select bool_and(contabilizable is false) from public.abonos where numero_contrato = v_num and referencia is distinct from 'R-G208'));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- B. Fallos inyectados: cada operación es atómica (no deja restos)'
create function t216.falla() returns trigger language plpgsql as $$
begin
  raise exception 'FALLA_INYECTADA en %', tg_table_name;
end $$;
do $$
declare n0 bigint; c bigint; r text; v0 jsonb; s jsonb; e0 bigint;
begin
  -- B1: la creación falla en el SEGUNDO servicio → ni cabecera ni servicios.
  create trigger t216_falla_serv after insert on public.cotizacion_servicios for each row
    when (new.nombre_servicio = 'FALLA-216') execute function t216.falla();
  select count(*) into n0 from public.cotizaciones;
  s := jsonb_build_array(t216.serv()->0, jsonb_set(t216.serv()->1, '{nombre_servicio}', '"FALLA-216"'));
  r := t216.escalar('service_role', null, format('select public.crear_cotizacion_manual(%L, ''mayorista'', %L::jsonb, %L::jsonb)::text', t216.u('admin'), t216.cab(), s));
  perform t216.rechaza('B1 fallo en el segundo servicio de una creación', r, 'FALLA_INYECTADA');
  perform t216.afirma('B1.1 no quedó la cabecera ni servicios sueltos', (select count(*) from public.cotizaciones) = n0
    and not exists (select 1 from public.cotizacion_servicios where nombre_servicio = 'FALLA-216'));
  drop trigger t216_falla_serv on public.cotizacion_servicios;

  -- B2: la edición falla DESPUÉS de escribir el historial → servicios, precio y revisión intactos.
  c := t216.crear('admin');
  select to_jsonb(x) into v0 from public.cotizaciones x where id = c;
  create trigger t216_falla_hist after insert on public.cotizacion_ediciones for each row execute function t216.falla();
  r := t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000)));
  perform t216.rechaza('B2 fallo tras el historial de una edición', r, 'FALLA_INYECTADA');
  perform t216.afirma('B2.1 la cotización, sus servicios y el historial quedaron como antes',
    (select to_jsonb(x) from public.cotizaciones x where id = c) = v0
    and (select valor from public.cotizacion_servicios where cotizacion_id = c and tipo_servicio = 'hotel') = 500000
    and not exists (select 1 from public.cotizacion_ediciones where cotizacion_id = c));
  drop trigger t216_falla_hist on public.cotizacion_ediciones;

  -- B3: el primer pago falla DESPUÉS del congelado → ni congelado, ni condiciones, ni pago, ni autorización.
  select count(*) into e0 from p39_priv.autorizacion_emitida;
  create trigger t216_falla_pago after insert on public.cotizacion_pagos_previos for each row execute function t216.falla();
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'b3-falla'));
  perform t216.rechaza('B3 fallo tras el congelado del primer pago', r, 'FALLA_INYECTADA');
  perform t216.afirma('B3.1 sin congelado, condiciones, pago ni autorización',
    (select condicion_pago_congelada_en is null from public.cotizaciones where id = c)
    and not exists (select 1 from public.cotizacion_condiciones where cotizacion_id = c)
    and not exists (select 1 from public.cotizacion_pagos_previos where cotizacion_id = c)
    and (select count(*) from p39_priv.autorizacion_emitida) = e0);
  drop trigger t216_falla_pago on public.cotizacion_pagos_previos;
  perform t216.afirma('B3.2 sin el fallo, el mismo pago entra', t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 100000, 'b3-ok')) ~ '^OK\|');
end $$;

-- ── Resumen ────────────────────────────────────────────────────────────────
\echo '=== RESUMEN ==='
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, left(detalle, 600) from t216.res where not ok order by nombre;
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from t216.res;
  if f > 0 then raise exception 'test_216_edicion39: % de % prueba(s) fallaron', f, t; end if;
  raise notice 'TEST 216 SQL: TODO OK (% verificaciones)', t;
end $$;
rollback;
