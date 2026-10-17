-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBAS · #35 cotizaciones comparativas (migración 211).
-- SOLO base LOCAL DESECHABLE con las migraciones 001–211 (nunca remota).
-- Corre dentro de UNA transacción y termina en ROLLBACK: no deja datos.
--
--   psql -v ON_ERROR_STOP=1 -f test_211_cotizaciones_comparativas.sql <base>
--
-- Cada prueba usa roles REALES (`set role`) y JWT reales (request.jwt.claims):
-- anon, authenticated (interno de cada agencia, B2B propietario / no
-- propietario / sin vínculo / inactivo) y service_role.
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

\ir test_211_fixtures.sql

-- Todo este archivo corre como el dueño de la base (supabase_admin) salvo donde se cambia de rol.
-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBAS
-- ═════════════════════════════════════════════════════════════════════════
\echo '--- 1. Creación y forma de la madre'
do $$
declare m bigint; c public.cotizaciones; n int;
begin
  m := t211.madre_manual('00000000-0000-0000-0000-000000211002');
  insert into t211.ids values ('manual', m);
  select * into c from public.cotizaciones where id = m;
  perform t211.afirma('1.1 madre: modo=comparativa, tipo, estado abierta, precio NULL',
      c.modo = 'comparativa' and c.tipo = 'comparativa_manual' and c.estado = 'abierta' and c.precio_venta is null);
  perform t211.afirma('1.2 madre: sello presente y recalculable', c.sello_economico is not null and c.sello_economico = f211_priv.sello_madre(m));
  select count(*) into n from public.cotizacion_opciones where cotizacion_id = m;
  perform t211.afirma('1.3 dos opciones guardadas (A/B x unica)', n = 2);
  select count(*) into n from public.cotizacion_comparativa_eventos where cotizacion_id = m and tipo = 'creada';
  perform t211.afirma('1.4 evento creada registrado', n = 1);
  perform t211.afirma('1.5 NO existe estado elegida en ningún lado',
      not exists (select 1 from public.cotizaciones where estado = 'elegida'));
end $$;

\echo '--- 2. Validaciones de creación'
do $$
declare r text;
begin
  -- una sola opción
  r := t211.intenta('supabase_admin', null, format($q$ select public.crear_cotizacion_comparativa(%L, t211.cab_manual(), t211.servicios_manual(),
        (select jsonb_build_array(t211.opciones_manual()->0)), null) $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.1 una sola opción se rechaza', r, 'entre 2 y 3 hoteles');
  -- cuatro hoteles
  r := t211.intenta('supabase_admin', null, format($q$ select public.crear_cotizacion_comparativa(%L, t211.cab_manual(), t211.servicios_manual(),
        (select t211.opciones_manual() || jsonb_build_array(
            jsonb_set(jsonb_set(t211.opciones_manual()->0, '{opcion_ref}', '"C"'), '{etiqueta}', '"H C"'),
            jsonb_set(jsonb_set(t211.opciones_manual()->0, '{opcion_ref}', '"D"'), '{etiqueta}', '"H D"'))), null) $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.2 cuatro hoteles / opcion_ref fuera de A-C se rechaza', r, 'COMPARATIVA');
  -- moneda mixta
  r := t211.intenta('supabase_admin', null, format($q$ select public.crear_cotizacion_comparativa(%L, t211.cab_manual(), t211.servicios_manual(),
        (select jsonb_build_array(t211.opciones_manual()->0, jsonb_set(t211.opciones_manual()->1, '{moneda}', '"USD"'))), null) $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.3 monedas mezcladas se rechazan', r, 'misma moneda');
  -- total <= 0
  r := t211.intenta('supabase_admin', null, format($q$ select public.crear_cotizacion_comparativa(%L, t211.cab_manual(), t211.servicios_manual(),
        (select jsonb_build_array(t211.opciones_manual()->0, jsonb_set(t211.opciones_manual()->1, '{total}', '0'))), null) $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.4 total no positivo se rechaza', r, 'total positivo');
  -- manual por B2B
  r := t211.intenta('supabase_admin', null, format($q$ select t211.madre_manual(%L) $q$, '00000000-0000-0000-0000-000000211005'));
  perform t211.rechaza('2.5 comparativa manual por un B2B se rechaza', r, 'personal interno');
  -- usuario inactivo
  r := t211.intenta('supabase_admin', null, format($q$ select t211.madre_manual(%L) $q$, '00000000-0000-0000-0000-000000211009'));
  perform t211.rechaza('2.6 usuario inactivo no crea', r, 'NO_AUTORIZADO');
  -- tenant del cliente ignorado para no superadmin: admin mayorista pide minorista
  declare v_nuevo bigint;
  begin
    v_nuevo := public.crear_cotizacion_comparativa('00000000-0000-0000-0000-000000211002'::uuid,
        jsonb_set(t211.cab_manual(), '{tenant}', '"minorista"'), t211.servicios_manual(), t211.opciones_manual(), null);
    perform t211.afirma('2.7 un no superadmin no elige tenant (queda el suyo)',
        (select tenant from public.cotizaciones where id = v_nuevo) = 'mayorista');
  end;
  -- interno + aliado
  r := t211.intenta('supabase_admin', null, format($q$ select t211.madre_manual(%L, 921101, 'interno') $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.8 tipo interno con aliado se rechaza', r, 'no admite aliado');
  -- agencia con aliado freelance
  r := t211.intenta('supabase_admin', null, format($q$ select t211.madre_manual(%L, 921103, 'agencia') $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.9 aliado de otro tipo se rechaza', r, 'otro tipo');
  -- vigencia pasada
  r := t211.intenta('supabase_admin', null, format($q$ select public.crear_cotizacion_comparativa(%L, jsonb_set(t211.cab_manual(), '{vigencia_hasta}', to_jsonb((public.fecha_negocio() - 1)::text)), t211.servicios_manual(), t211.opciones_manual(), null) $q$, '00000000-0000-0000-0000-000000211002'));
  perform t211.rechaza('2.10 vigencia vencida se rechaza', r, 'vigencia');
end $$;

\echo '--- 3. Grants y RLS con roles reales'
do $$
declare r text; m bigint; t text;
  admin_ uuid := '00000000-0000-0000-0000-000000211002'; min_ uuid := '00000000-0000-0000-0000-000000211004';
  super_ uuid := '00000000-0000-0000-0000-000000211001'; b2b uuid := '00000000-0000-0000-0000-000000211005';
begin
  select v into m from t211.ids where k = 'manual';
  -- lectura por tabla y actor
  foreach t in array array['cotizacion_opciones','cotizacion_comparativa_eventos'] loop
    perform t211.afirma('3.1 interno mismo tenant lee ' || t,
        t211.escalar('authenticated', admin_, format('select count(*) from public.%I where cotizacion_id = %s', t, m))::int > 0);
    perform t211.afirma('3.2 interno de OTRO tenant no ve ' || t,
        t211.escalar('authenticated', min_, format('select count(*) from public.%I where cotizacion_id = %s', t, m)) = '0');
    perform t211.afirma('3.3 superadmin (global) ve ' || t,
        t211.escalar('authenticated', super_, format('select count(*) from public.%I where cotizacion_id = %s', t, m))::int > 0);
    perform t211.afirma('3.4 B2B no ve ' || t,
        t211.escalar('authenticated', b2b, format('select count(*) from public.%I where cotizacion_id = %s', t, m)) = '0');
    perform t211.rechaza('3.5 anon sin privilegios sobre ' || t, t211.escalar('anon', null, format('select count(*) from public.%I', t)), 'permission denied');
    perform t211.afirma('3.6 service_role lee ' || t,
        t211.escalar('service_role', null, format('select count(*) from public.%I where cotizacion_id = %s', t, m))::int > 0);
  end loop;
  -- recibos: nadie salvo service_role
  perform t211.rechaza('3.7 authenticated no lee recibos', t211.escalar('authenticated', admin_, 'select count(*) from public.cotizacion_comparativa_validaciones'), 'permission denied');
  perform t211.rechaza('3.8 anon no lee recibos', t211.escalar('anon', null, 'select count(*) from public.cotizacion_comparativa_validaciones'), 'permission denied');
  perform t211.acepta('3.9 service_role lee recibos', t211.intenta('service_role', null, 'select count(*) from public.cotizacion_comparativa_validaciones'));
  -- solicitudes: lectura interna del mismo tenant únicamente
  perform t211.afirma('3.10 interno de otro tenant no ve solicitudes', t211.escalar('authenticated', min_, 'select count(*) from public.cotizacion_comparativa_solicitudes') = '0');
  perform t211.rechaza('3.11 anon no lee solicitudes', t211.escalar('anon', null, 'select count(*) from public.cotizacion_comparativa_solicitudes'), 'permission denied');
  -- NINGUNA escritura directa para nadie en las 4 tablas (ni service_role)
  foreach t in array array['cotizacion_opciones','cotizacion_comparativa_eventos','cotizacion_comparativa_validaciones','cotizacion_comparativa_solicitudes'] loop
    perform t211.rechaza('3.12 authenticated no inserta en ' || t, t211.intenta('authenticated', admin_, format('insert into public.%I default values', t)), 'permission denied');
    perform t211.rechaza('3.13 service_role no inserta en ' || t, t211.intenta('service_role', null, format('insert into public.%I default values', t)), 'permission denied');
    perform t211.rechaza('3.14 authenticated no actualiza ' || t, t211.intenta('authenticated', admin_, format('update public.%I set cotizacion_id = cotizacion_id', t)), 'permission denied');
    perform t211.rechaza('3.15 authenticated no borra de ' || t, t211.intenta('authenticated', admin_, format('delete from public.%I', t)), 'permission denied');
    perform t211.rechaza('3.16 anon no escribe en ' || t, t211.intenta('anon', null, format('insert into public.%I default values', t)), 'permission denied');
  end loop;
  -- ejecución de RPC
  perform t211.rechaza('3.20 authenticated no ejecuta crear_cotizacion_comparativa', t211.intenta('authenticated', admin_, format('select public.crear_cotizacion_comparativa(%L, ''{}'', ''[]'', ''[]'', null)', admin_)), 'permission denied');
  perform t211.rechaza('3.21 anon no ejecuta registrar_validacion_comparativa', t211.intenta('anon', null, format('select public.registrar_validacion_comparativa(%s, ''A'', ''unica'', 1, ''interno'', null, 1, ''COP'', true, null)', m)), 'permission denied');
  perform t211.rechaza('3.22 authenticated no ejecuta la elección pública', t211.intenta('authenticated', admin_, 'select public.elegir_opcion_comparativa_publica(gen_random_uuid(), ''clave-12345'')'), 'permission denied');
  perform t211.rechaza('3.23 anon no ejecuta la elección con sesión', t211.intenta('anon', null, 'select public.elegir_opcion_comparativa_sesion(gen_random_uuid(), ''clave-12345'')'), 'permission denied');
  perform t211.rechaza('3.24 authenticated no ejecuta registrar_solicitud (service-only)', t211.intenta('authenticated', admin_, format('select public.registrar_solicitud_comparativa(%s, ''A'', ''unica'', 1, ''Ana'', ''3101112233'', null, null, ''clave-12345'', null)', m)), 'permission denied');
  perform t211.rechaza('3.25 anon no ejecuta comparativas_b2b_visibles', t211.intenta('anon', null, 'select * from public.comparativas_b2b_visibles()'), 'permission denied');
  perform t211.rechaza('3.26 authenticated no ve el esquema privado', t211.intenta('authenticated', admin_, 'select f211_priv.sello_madre(1)'), 'permission denied');
  perform t211.rechaza('3.27 service_role no ve el esquema privado', t211.intenta('service_role', null, 'select f211_priv.sello_madre(1)'), 'permission denied');
  -- service_role NO puede usar las RPC "con sesión": ni siquiera con un JWT falsificado de un B2B real.
  perform t211.rechaza('3.29 service_role + JWT falsificado no lista comparativas B2B', t211.intenta('service_role', b2b, 'select * from public.comparativas_b2b_visibles()'), 'permission denied');
  perform t211.rechaza('3.30 service_role + JWT falsificado no elige con sesión', t211.intenta('service_role', admin_, 'select public.elegir_opcion_comparativa_sesion(gen_random_uuid(), ''clave-12345'')'), 'permission denied');
  perform t211.rechaza('3.31 service_role + JWT falsificado no resuelve solicitudes', t211.intenta('service_role', admin_, 'select public.resolver_solicitud_comparativa(1, ''rechazar'', null, null)'), 'permission denied');
  perform t211.rechaza('3.32 authenticated no puede ejecutar la elección pública ni con el JWT del dueño', t211.intenta('authenticated', admin_, 'select public.elegir_opcion_comparativa_publica(gen_random_uuid(), ''clave-12345'')'), 'permission denied');
  perform t211.afirma('3.28 sin EXECUTE a PUBLIC en las 7 RPC',
      not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('crear_cotizacion_comparativa','registrar_validacion_comparativa','elegir_opcion_comparativa_sesion',
                   'elegir_opcion_comparativa_publica','registrar_solicitud_comparativa','resolver_solicitud_comparativa','comparativas_b2b_visibles')
                     and has_function_privilege('public', p.oid, 'execute')));
end $$;

\echo '--- 4. La madre es económicamente inmutable (API y GUC falsificado)'
do $$
declare r text; m bigint; admin_ uuid := '00000000-0000-0000-0000-000000211002';
begin
  select v into m from t211.ids where k = 'manual';
  perform t211.rechaza('4.1 authenticated no cambia precio_venta de la madre', t211.intenta('authenticated', admin_, format('update public.cotizaciones set precio_venta = 5 where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.2 authenticated no cambia payload', t211.intenta('authenticated', admin_, format('update public.cotizaciones set payload = ''{}'' where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.3 authenticated no cambia moneda', t211.intenta('authenticated', admin_, format('update public.cotizaciones set moneda = ''USD'' where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.4 authenticated no cambia el sello', t211.intenta('authenticated', admin_, format('update public.cotizaciones set sello_economico = ''x'' where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.5 service_role (sin RPC) tampoco', t211.intenta('service_role', null, format('update public.cotizaciones set precio_venta = 5 where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.6 la madre no pasa a convertida (service_role)', t211.intenta('service_role', null, format('update public.cotizaciones set estado = ''convertida'' where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.7 ni a elegida', t211.intenta('authenticated', admin_, format('update public.cotizaciones set estado = ''elegida'' where id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.8 ni siquiera el dueño: CHECK de estados de la madre', t211.intenta('supabase_admin', null, format('update public.cotizaciones set estado = ''convertida'' where id = %s', m)), 'cotizaciones_comparativa_forma');
  perform t211.rechaza('4.9 no se amplía la vigencia', t211.intenta('authenticated', admin_, format('update public.cotizaciones set vigencia_hasta = vigencia_hasta + 10 where id = %s', m)), 'solo puede reducirse');
  perform t211.acepta('4.10 sí se puede reducir la vigencia', t211.intenta('authenticated', admin_, format('update public.cotizaciones set vigencia_hasta = vigencia_hasta - 1 where id = %s', m)));
  -- Servicios de la madre
  perform t211.rechaza('4.11 no se inserta un servicio en la madre', t211.intenta('authenticated', admin_, format('insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, valor) values (%s, ''otro'', 1)', m)), 'INMUTABLE');
  perform t211.rechaza('4.12 no se edita un servicio de la madre', t211.intenta('authenticated', admin_, format('update public.cotizacion_servicios set valor = 1 where cotizacion_id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.13 no se borra un servicio de la madre', t211.intenta('service_role', null, format('delete from public.cotizacion_servicios where cotizacion_id = %s', m)), 'INMUTABLE');
  perform t211.rechaza('4.14 no se borra la madre', t211.intenta('authenticated', admin_, format('delete from public.cotizaciones where id = %s', m)), 'COMPARATIVA');
  -- Opciones inmutables incluso para el dueño
  perform t211.rechaza('4.15 opciones: UPDATE rechazado (dueño)', t211.intenta('supabase_admin', null, format('update public.cotizacion_opciones set total = 1 where cotizacion_id = %s', m)), 'solo inserción');
  perform t211.rechaza('4.16 opciones: DELETE rechazado (dueño)', t211.intenta('supabase_admin', null, format('delete from public.cotizacion_opciones where cotizacion_id = %s', m)), 'solo inserción');
  perform t211.rechaza('4.17 eventos: UPDATE rechazado', t211.intenta('supabase_admin', null, format('update public.cotizacion_comparativa_eventos set tipo = ''creada'' where cotizacion_id = %s', m)), 'solo inserción');
  perform t211.rechaza('4.18 eventos: TRUNCATE rechazado', t211.intenta('supabase_admin', null, 'truncate public.cotizacion_comparativa_eventos'), 'solo inserción');
  -- No se fabrican comparativas ni hijas por la API
  perform t211.rechaza('4.20 authenticated no inserta una comparativa', t211.intenta('authenticated', admin_,
      $q$ insert into public.cotizaciones (tenant, tipo, modo, estado, payload, vigencia_hasta, moneda) values ('mayorista', 'comparativa_manual', 'comparativa', 'abierta', '{}', current_date, 'COP') $q$), 'SOLO_RPC');
  perform t211.rechaza('4.21 authenticated no marca una simple como hija', t211.intenta('authenticated', admin_, format(
      $q$ insert into public.cotizaciones (tenant, tipo, payload, precio_venta, moneda, cotizacion_origen_id, opcion_ref, acomodacion_ref, madre_version, madre_sello, vigencia_tope)
         values ('mayorista', 'manual', '{}', 100, 'COP', %s, 'A', 'unica', 1, 'x', current_date) $q$, m)), 'SOLO_RPC');
  perform t211.rechaza('4.22 authenticated no se pone aliado/propietario en una simple', t211.intenta('authenticated', admin_,
      $q$ insert into public.cotizaciones (tenant, tipo, payload, moneda, aliado_id) values ('mayorista', 'manual', '{}', 'COP', 921101) $q$), 'SOLO_RPC');
  -- GUC falsificado: un authenticated puede escribir cualquier variable, pero nada la consulta
  perform t211.rechaza('4.30 GUC app.comparativa_rpc falsificado no salta el trigger',
     t211.intenta('authenticated', admin_, format($q$ select set_config('app.comparativa_rpc', %L, true), set_config('app.factura_rpc', %L, true), set_config('app.posteo_abono', 'x', true);
        update public.cotizaciones set precio_venta = 1 where id = %s $q$, m::text, m::text, m)), 'INMUTABLE');
  perform t211.rechaza('4.31 GUC falsificado tampoco permite insertar servicios en la madre',
     t211.intenta('authenticated', admin_, format($q$ select set_config('app.comparativa_rpc', %L, true);
        insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, valor) values (%s, 'otro', 1) $q$, m::text, m)), 'INMUTABLE');
  perform t211.rechaza('4.32 GUC falsificado tampoco crea una comparativa',
     t211.intenta('authenticated', admin_, $q$ select set_config('app.comparativa_rpc', '1', true);
        insert into public.cotizaciones (tenant, tipo, modo, estado, payload, vigencia_hasta, moneda) values ('mayorista', 'comparativa_manual', 'comparativa', 'abierta', '{}', current_date, 'COP') $q$), 'SOLO_RPC');
  perform t211.afirma('4.33 el código de 211 no lee ninguna variable de sesión (sin GUC)',
     not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where (n.nspname = 'f211_priv' or p.proname like '%comparativa%') and p.prosrc ilike '%current_setting%'));
end $$;

\echo '--- 5. Una madre no genera pago, congelado, venta, CxP ni contrato (llamadas directas)'
do $$
declare r text; m bigint; admin_ uuid := '00000000-0000-0000-0000-000000211002';
begin
  select v into m from t211.ids where k = 'manual';
  r := t211.intenta('service_role', null, format($q$ select public.registrar_pago_previo(%s, 100000, 'COP', 1, 'Transferencia', 'REF-211', current_date, %L, 'idem-211-0001', '[]'::jsonb, 100000, 100) $q$, m, admin_));
  raise notice 'DETALLE 5.1: %', r;
  perform t211.afirma('5.1 registrar_pago_previo directo sobre la madre falla POR EL CANDADO DE LA MADRE', r like '%COMPARATIVA_%', r);
  perform t211.afirma('5.2 …y no dejó pago, congelado ni condiciones',
     not exists (select 1 from public.cotizacion_pagos_previos where cotizacion_id = m)
     and not exists (select 1 from public.cotizacion_condiciones where cotizacion_id = m)
     and (select condicion_pago_congelada_en is null from public.cotizaciones where id = m));
  perform t211.rechaza('5.3 INSERT directo de un pago previo (dueño) bloqueado', t211.intenta('supabase_admin', null, format(
      $q$ insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, forma_pago, referencia, registrado_por_id)
         values (%s, 'mayorista', 1, 1, 'COP', 'Transferencia', 'R1', %L) $q$, m, admin_)), 'NO_COBRABLE');
  perform t211.rechaza('5.4 INSERT directo de condiciones bloqueado', t211.intenta('supabase_admin', null, format(
      $q$ insert into public.cotizacion_condiciones (cotizacion_id, tipo_componente, referencia_externa, orden) values (%s, 'hotel', 'x', 0) $q$, m)), 'NO_COBRABLE');
  r := t211.intenta('service_role', null, format('select public.convertir_cotizacion_a_contrato(%s, %L)', m, admin_));
  raise notice 'DETALLE 5.5: %', r;
  perform t211.afirma('5.5 convertir_cotizacion_a_contrato (RPC 198) sobre la madre falla', r <> 'ok', r);
  perform t211.rechaza('5.6 INSERT directo de una venta ligada a la madre bloqueado', t211.intenta('supabase_admin', null, format(
      $q$ insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, cotizacion_id, estado) values ('DTM-2110', 'C', 'mayorista', 1000, %s, 'pendiente') $q$, m)), 'NO_COBRABLE');
  perform t211.afirma('5.7 …y no existe venta, abono ni CxP de la madre',
     not exists (select 1 from public.ventas where cotizacion_id = m)
     and (select count(*) from public.cuentas_por_pagar where observaciones ilike '%cotización dinámica%' and numero_contrato in (select numero_contrato from public.ventas where cotizacion_id = m)) = 0);
  perform t211.afirma('5.8 la madre sigue abierta y sin número de contrato',
     (select estado = 'abierta' and numero_contrato is null from public.cotizaciones where id = m));
end $$;

\echo '--- 6. Recibos de un solo uso, identidad y elección con sesión'
do $$
declare m bigint; rid uuid; r text; h bigint; h2 bigint; c public.cotizaciones; n int; s numeric;
  admin_ uuid := '00000000-0000-0000-0000-000000211002'; venta_ uuid := '00000000-0000-0000-0000-000000211003';
  min_ uuid := '00000000-0000-0000-0000-000000211004'; inact uuid := '00000000-0000-0000-0000-000000211009';
begin
  -- madre nueva y limpia para este bloque
  m := t211.madre_manual(admin_);
  insert into t211.ids values ('manual2', m) on conflict (k) do update set v = excluded.v;
  -- recibo con precio distinto → rechazo
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'interno', %L, 1599999, 'COP', true, null) $q$, m, admin_));
  perform t211.rechaza('6.1 recibo con precio distinto se rechaza', r, 'PRECIO_CAMBIO');
  -- versión distinta
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 2, 'interno', %L, 1600000, 'COP', true, null) $q$, m, admin_));
  perform t211.rechaza('6.2 versión desactualizada se rechaza', r, 'VERSION');
  -- opción inexistente
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'C', 'unica', 1, 'interno', %L, 1600000, 'COP', true, null) $q$, m, admin_));
  perform t211.rechaza('6.3 opción inexistente se rechaza', r, 'OPCION');
  -- sin disponibilidad
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'interno', %L, 1600000, 'COP', false, null) $q$, m, admin_));
  perform t211.rechaza('6.4 sin disponibilidad atestada no hay recibo (CHECK)', r, 'disponibilidad_ok');
  -- actor de otro tenant / inactivo / sin rol interno
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'interno', %L, 1600000, 'COP', true, null) $q$, m, min_));
  perform t211.rechaza('6.5 interno de OTRO tenant no obtiene recibo', r, 'NO_AUTORIZADO');
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'interno', %L, 1600000, 'COP', true, null) $q$, m, inact));
  perform t211.rechaza('6.6 usuario inactivo no obtiene recibo', r, 'NO_AUTORIZADO');
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'interno', %L, 1600000, 'COP', true, null) $q$, m, '00000000-0000-0000-0000-000000211005'));
  perform t211.rechaza('6.7 un B2B no obtiene recibo por el canal interno', r, 'NO_AUTORIZADO');
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'publico', null, 1600000, 'COP', true, %L) $q$, m, t211.cliente_ok()));
  perform t211.rechaza('6.8 canal público sobre una madre NO anónima', r, 'NO_AUTORIZADO');

  -- recibo válido
  rid := public.registrar_validacion_comparativa(m, 'A', 'unica', 1, 'interno', admin_, 1600000, 'COP', true, null);
  insert into t211.recibos values ('r1', rid);
  -- otro usuario intenta consumirlo
  r := t211.intenta('authenticated', venta_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-aaaa-1'')', rid));
  perform t211.rechaza('6.10 otro usuario no consume el recibo', r, 'RECIBO');
  r := t211.intenta('authenticated', null, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-aaaa-1'')', rid));
  perform t211.rechaza('6.11 sin sesión no consume', r, 'inicia sesión');
  r := t211.intenta('authenticated', min_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-aaaa-1'')', rid));
  perform t211.rechaza('6.12 interno de otro tenant no consume', r, 'RECIBO');
  -- el canal público no consume recibos de sesión
  r := t211.intenta('service_role', null, format('select public.elegir_opcion_comparativa_publica(%L, ''clave-aaaa-1'')', rid));
  perform t211.rechaza('6.13 la elección pública no consume un recibo de sesión', r, 'RECIBO');
  -- el dueño legítimo
  h := (t211.escalar('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-aaaa-1'')', rid)))::bigint;
  perform t211.afirma('6.14 el usuario del recibo crea la hija', h is not null);
  select * into c from public.cotizaciones where id = h;
  perform t211.afirma('6.15 hija: simple, tipo manual, origen, opción, precio numérico',
     c.modo = 'simple' and c.tipo = 'manual' and c.cotizacion_origen_id = m and c.opcion_ref = 'A'
     and c.acomodacion_ref = 'unica' and c.precio_venta = 1600000 and c.estado = 'abierta');
  perform t211.afirma('6.16 hija: vigencia no posterior a la madre',
     c.vigencia_hasta <= (select vigencia_hasta from public.cotizaciones where id = m) and c.vigencia_tope = (select vigencia_hasta from public.cotizaciones where id = m));
  perform t211.afirma('6.17 hija trae solo lo común + la opción elegida (3 servicios, sin Hotel B)',
     (select count(*) from public.cotizacion_servicios where cotizacion_id = h) = 3
     and not exists (select 1 from public.cotizacion_servicios where cotizacion_id = h and nombre_servicio = 'Hotel B')
     and not exists (select 1 from public.cotizacion_servicios where cotizacion_id = h and opcion_ref is not null));
  select coalesce(sum(valor), 0) into s from public.cotizacion_servicios where cotizacion_id = h;
  perform t211.afirma('6.18 Σ servicios de la hija = precio de la opción (común contado UNA vez)', s = 1600000, s::text);
  perform t211.afirma('6.18b hija: el orden de sus servicios se renumera 0..n-1 (igual que una cotización dinámica común)',
     (select array_agg(orden order by orden) from public.cotizacion_servicios where cotizacion_id = h) = array[0,1,2]);
  perform t211.afirma('6.19 la madre sigue abierta, precio NULL, sin estado elegida',
     (select estado = 'abierta' and precio_venta is null from public.cotizaciones where id = m));
  perform t211.afirma('6.20 recibo consumido, datos_cliente anulado, hija enlazada',
     (select consumida_en is not null and hija_id = h and datos_cliente is null from public.cotizacion_comparativa_validaciones where id = rid));
  -- idempotencia / reintento
  perform t211.afirma('6.21 reintento con la misma clave devuelve la MISMA hija',
     t211.escalar('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-aaaa-1'')', rid))::bigint = h);
  r := t211.intenta('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-otra-22'')', rid));
  perform t211.rechaza('6.22 recibo ya usado con OTRA clave se rechaza', r, 'ya fue usado');
  -- segunda elección con hija activa
  rid := public.registrar_validacion_comparativa(m, 'B', 'unica', 1, 'interno', admin_, 1800000, 'COP', true, null);
  r := t211.intenta('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-bbbb-2'')', rid));
  perform t211.rechaza('6.23 con hija activa no se elige otra', r, 'HIJA_ACTIVA');
  select count(*) into n from public.cotizaciones where cotizacion_origen_id = m;
  perform t211.afirma('6.24 sigue habiendo UNA sola hija', n = 1);
  -- el rechazo de 6.23 NO dejó evento (la transacción interna abortó) ni consumió el recibo
  perform t211.afirma('6.25 el intento rechazado no consumió el recibo ni dejó evento',
     (select consumida_en is null from public.cotizacion_comparativa_validaciones where id = rid)
     and (select count(*) from public.cotizacion_comparativa_eventos where cotizacion_id = m and tipo = 'elegida') = 1);
  -- unique parcial a nivel de datos (defensa en profundidad)
  r := t211.intenta('supabase_admin', null, format($q$ insert into public.cotizaciones (tenant, tipo, payload, precio_venta, moneda, cotizacion_origen_id, opcion_ref, acomodacion_ref, madre_version, madre_sello, vigencia_tope)
         values ('mayorista', 'manual', '{}', 100, 'COP', %s, 'B', 'unica', 1, 'x', current_date) $q$, m));
  perform t211.rechaza('6.26 el índice único impide una segunda hija activa (aun siendo el dueño)', r, 'uq_cotizaciones_hija_activa');
  -- editar el precio de la hija sí es posible (simple); extender más allá del tope, no
  perform t211.acepta('6.27 la hija se edita como una simple (descripción)', t211.intenta('authenticated', admin_, format('update public.cotizaciones set cliente = ''Otro'' where id = %s', h)));
  perform t211.rechaza('6.28 la hija no extiende su vigencia más allá de la madre', t211.intenta('authenticated', admin_, format('update public.cotizaciones set vigencia_hasta = vigencia_hasta + 30 where id = %s', h)), 'no puede superar');
  perform t211.rechaza('6.29 la hija no cambia su origen/opción por la API', t211.intenta('authenticated', admin_, format('update public.cotizaciones set opcion_ref = ''B'' where id = %s', h)), 'SOLO_RPC');
  perform t211.rechaza('6.30 la hija no se borra', t211.intenta('authenticated', admin_, format('delete from public.cotizaciones where id = %s', h)), 'COMPARATIVA');

  -- descarte y reelección
  perform t211.acepta('6.40 la hija se descarta (flujo existente, sin pagos)', t211.intenta('authenticated', admin_, format('update public.cotizaciones set estado = ''descartada'' where id = %s', h)));
  perform t211.afirma('6.41 el descarte dejó evento hija_descartada',
     exists (select 1 from public.cotizacion_comparativa_eventos where cotizacion_id = m and tipo = 'hija_descartada' and hija_id = h));
  h2 := (t211.escalar('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-bbbb-2'')', rid)))::bigint;
  perform t211.afirma('6.42 tras descartar sin pagos se puede elegir OTRA opción', h2 is not null and h2 <> h);
  perform t211.afirma('6.43 historial íntegro: ambas hijas existen (una descartada)',
     (select count(*) from public.cotizaciones where cotizacion_origen_id = m) = 2
     and (select estado from public.cotizaciones where id = h) = 'descartada');
  perform t211.afirma('6.44 eventos: 2 elegidas + 1 descartada, en orden',
     (select string_agg(tipo, ',' order by id) from public.cotizacion_comparativa_eventos where cotizacion_id = m and tipo in ('elegida','hija_descartada')) = 'elegida,hija_descartada,elegida');
  perform t211.rechaza('6.45 no se descarta la madre con hija activa', t211.intenta('authenticated', admin_, format('update public.cotizaciones set estado = ''descartada'' where id = %s', m)), 'HIJA_ACTIVA');
end $$;

\echo '--- 7. Sello: manipulación fuera de la API'
do $$
declare m bigint; rid uuid; r text; n_antes int; admin_ uuid := '00000000-0000-0000-0000-000000211002';
begin
  m := t211.madre_manual(admin_);
  -- el dueño de la base (o un SQL directo) altera un valor económico sin pasar por la API
  update public.cotizacion_servicios set valor = valor + 1000 where cotizacion_id = m and opcion_ref = 'A';
  rid := public.registrar_validacion_comparativa(m, 'A', 'unica', 1, 'interno', admin_, 1600000, 'COP', true, null);
  select count(*) into n_antes from public.cotizacion_comparativa_eventos where cotizacion_id = m;
  r := t211.intenta('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-sell-1'')', rid));
  perform t211.rechaza('7.1 madre alterada: la elección aborta', r, 'MADRE_ALTERADA');
  perform t211.afirma('7.2 NO se promete evento: la transacción abortó y no dejó evento, hija ni consumo',
     (select count(*) from public.cotizacion_comparativa_eventos where cotizacion_id = m) = n_antes
     and not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m)
     and (select consumida_en is null from public.cotizacion_comparativa_validaciones where id = rid));
  -- alterar una opción (tabla inmutable) es imposible aun para el dueño
  perform t211.rechaza('7.3 la tabla de opciones no se puede alterar', t211.intenta('supabase_admin', null, format('update public.cotizacion_opciones set total = 1 where cotizacion_id = %s', m)), 'solo inserción');
end $$;

\echo '--- 8. Canal público (checkout)'
do $$
declare m bigint; rid uuid; r text; h bigint; c public.cotizaciones; admin_ uuid := '00000000-0000-0000-0000-000000211002';
begin
  m := t211.madre_carrito(null);
  insert into t211.ids values ('carrito', m) on conflict (k) do update set v = excluded.v;
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'doble', 1, 'publico', null, 1400000, 'COP', true, '{"nombres":"Ana"}') $q$, m));
  perform t211.rechaza('8.1 datos del checkout incompletos: la BASE rechaza el recibo', r, 'comparativa_validaciones_datos');
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'doble', 1, 'publico', %L, 1400000, 'COP', true, %L) $q$, m, admin_, t211.cliente_ok()));
  perform t211.rechaza('8.2 canal público con actor se rechaza', r, 'NO_AUTORIZADO');
  rid := public.registrar_validacion_comparativa(m, 'A', 'doble', 1, 'publico', null, 1400000, 'COP', true, t211.cliente_ok());
  r := t211.intenta('authenticated', admin_, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-pub-001'')', rid));
  perform t211.rechaza('8.3 un autenticado no consume un recibo público', r, 'RECIBO');
  h := (t211.escalar('service_role', null, format('select public.elegir_opcion_comparativa_publica(%L, ''clave-pub-001'')', rid)))::bigint;
  perform t211.afirma('8.4 el checkout público crea la hija', h is not null);
  select * into c from public.cotizaciones where id = h;
  perform t211.afirma('8.5 hija carrito: tipo, precio de la opción doble (items + tours) y datos del cliente',
     c.tipo = 'carrito' and c.precio_venta = 1400000 and c.cliente = 'Ana Prueba' and c.cliente_documento = '99887766'
     and c.payload#>>'{cliente,telefono}' = '3101112233');
  perform t211.afirma('8.6 vigencia de la hija pública: ≤ hoy+1 y ≤ madre', c.vigencia_hasta <= public.fecha_negocio() + 1 and c.vigencia_hasta <= (select vigencia_hasta from public.cotizaciones where id = m));
  perform t211.afirma('8.7 el payload del carrito trae SOLO el hotel elegido (sin Hotel Dos)', c.payload::text like '%Hotel Uno%' and c.payload::text not like '%Hotel Dos%');
  perform t211.afirma('8.8 la acomodación sencilla del mismo hotel NO entró (acomodacion_ref propia)', c.acomodacion_ref = 'doble');
  perform t211.afirma('8.9 reintento idempotente devuelve la misma hija',
     t211.escalar('service_role', null, format('select public.elegir_opcion_comparativa_publica(%L, ''clave-pub-001'')', rid))::bigint = h);
  r := t211.intenta('service_role', null, format('select public.elegir_opcion_comparativa_publica(%L, ''clave-pub-002'')', rid));
  perform t211.rechaza('8.10 el recibo no se reutiliza con otra clave', r, 'ya fue usado');
  -- madre creada por un interno: el público NO puede continuar por checkout
  m := t211.madre_carrito(admin_);
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'doble', 1, 'publico', null, 1400000, 'COP', true, %L) $q$, m, t211.cliente_ok()));
  perform t211.rechaza('8.11 madre de un interno no admite el canal público', r, 'NO_AUTORIZADO');
end $$;

\echo '--- 9. Propiedad B2B autoritativa'
do $$
declare m bigint; rid uuid; r text; h bigint; kk text; n int;
  admin_ uuid := '00000000-0000-0000-0000-000000211002';
  a uuid := '00000000-0000-0000-0000-000000211005'; a2 uuid := '00000000-0000-0000-0000-000000211006';
  b uuid := '00000000-0000-0000-0000-000000211007'; sin uuid := '00000000-0000-0000-0000-000000211008';
  bmin uuid := '00000000-0000-0000-0000-000000211010'; inact uuid := '00000000-0000-0000-0000-000000211009';
begin
  -- interno crea para el aliado A (catálogo, por id)
  m := t211.madre_manual(admin_, 921101, 'agencia');
  insert into t211.ids values ('aliadoA', m) on conflict (k) do update set v = excluded.v;
  perform t211.afirma('9.1 la madre guarda aliado_id y quién la creó (no el email)',
     (select aliado_id = 921101 and creado_por_id = admin_ and propietario_id is null from public.cotizaciones where id = m));
  r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'b2b', %L, 1600000, 'COP', true, null) $q$, m, a));
  perform t211.acepta('9.2 usuario activo vinculado al aliado A obtiene recibo', r);
  perform t211.acepta('9.3 OTRO usuario activo del mismo aliado también (actúan por el aliado)',
     t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'b2b', %L, 1600000, 'COP', true, null) $q$, m, a2)));
  foreach kk in array array['b','sin','bmin','inact'] loop
    r := t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'b2b', %L, 1600000, 'COP', true, null) $q$, m,
        case kk when 'b' then b when 'sin' then sin when 'bmin' then bmin else inact end));
    perform t211.rechaza('9.4 ' || kk || ' no obtiene recibo', r, 'NO_AUTORIZADO');
  end loop;
  -- elegir con la sesión del propietario
  rid := public.registrar_validacion_comparativa(m, 'A', 'unica', 1, 'b2b', a, 1600000, 'COP', true, null);
  r := t211.intenta('authenticated', b, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-b2b-01'')', rid));
  perform t211.rechaza('9.5 un B2B de otro aliado no consume el recibo de A', r, 'RECIBO');
  r := t211.intenta('authenticated', a2, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-b2b-01'')', rid));
  perform t211.rechaza('9.6 el recibo es del usuario que lo obtuvo (a2 no es a)', r, 'RECIBO');
  h := (t211.escalar('authenticated', a, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-b2b-01'')', rid)))::bigint;
  perform t211.afirma('9.7 el propietario crea la hija', h is not null);
  perform t211.afirma('9.8 la hija hereda aliado_id (propiedad coherente)', (select aliado_id = 921101 from public.cotizaciones where id = h));
  -- si el vínculo del usuario cambia DESPUÉS, el acceso cambia con él (la identidad se relee)
  update public.usuarios set aliado_id = 921102 where id = a2;
  perform t211.rechaza('9.9 vínculo cambiado: ya no obtiene recibo', t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'b2b', %L, 1600000, 'COP', true, null) $q$, m, a2)), 'NO_AUTORIZADO');
  update public.usuarios set aliado_id = 921101 where id = a2;
  update public.usuarios set activo = false where id = a;
  perform t211.rechaza('9.10 usuario desactivado ya no actúa (aunque tuviera recibo)', t211.intenta('authenticated', a, format('select public.elegir_opcion_comparativa_sesion(%L, ''clave-b2b-01'')', rid)), 'NO_AUTORIZADO');
  update public.usuarios set activo = true where id = a;

  -- Listado: identidad de la SESIÓN, un solo predicado
  perform t211.afirma('9.20 listado: a (aliado A) ve la comparativa de A', t211.escalar('authenticated', a, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '1');
  perform t211.afirma('9.21 listado: a2 (mismo aliado) también', t211.escalar('authenticated', a2, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '1');
  perform t211.afirma('9.22 listado: b (otro aliado) no', t211.escalar('authenticated', b, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '0');
  perform t211.afirma('9.23 listado: B2B sin vínculo no', t211.escalar('authenticated', sin, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '0');
  perform t211.afirma('9.24 listado: B2B del otro tenant no', t211.escalar('authenticated', bmin, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '0');
  perform t211.afirma('9.25 listado: un interno no recibe nada por esta vía', t211.escalar('authenticated', admin_, 'select count(*) from public.comparativas_b2b_visibles()') = '0');
  perform t211.afirma('9.26 listado: sin sesión devuelve vacío (o error), nunca datos', coalesce(t211.escalar('authenticated', null, 'select count(*) from public.comparativas_b2b_visibles()'), '0') in ('0') or t211.escalar('authenticated', null, 'select count(*) from public.comparativas_b2b_visibles()') like 'ERR%');
  perform t211.afirma('9.27 el listado muestra la hija activa del aliado',
     t211.escalar('authenticated', a2, format($q$ select (hija->>'id')::bigint from public.comparativas_b2b_visibles() where id = %s $q$, m)) = h::text);
  -- el listado NO se puede engañar con el cuerpo de la petición: no recibe parámetros
  perform t211.afirma('9.28 la función de listado no tiene parámetros (no hay uid que falsificar)',
     (select pronargs from pg_proc where proname = 'comparativas_b2b_visibles') = 0);
  -- el nombre NO cuenta: una comparativa sin aliado del catálogo no es de nadie B2B
  m := t211.madre_manual(admin_, null, 'agencia');
  perform t211.afirma('9.30 comparativa sin aliado del catálogo: ningún B2B la ve ni elige',
     t211.escalar('authenticated', a, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '0'
     and t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'b2b', %L, 1600000, 'COP', true, null) $q$, m, a)) like '%NO_AUTORIZADO%');
  -- carrito creado por un B2B sin aliado → propietario
  m := t211.madre_carrito(sin);
  perform t211.afirma('9.31 B2B sin vínculo que creó el carrito es el propietario',
     (select propietario_id = sin and aliado_id is null from public.cotizaciones where id = m)
     and t211.escalar('authenticated', sin, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '1'
     and t211.escalar('authenticated', a, format('select count(*) from public.comparativas_b2b_visibles() where id = %s', m)) = '0');
  -- No se muta la propiedad por la API
  perform t211.rechaza('9.32 aliado_id/propietario_id no se mutan por la API', t211.intenta('authenticated', admin_, format('update public.cotizaciones set aliado_id = 921102 where id = %s', t211.escalar('supabase_admin', null, 'select i.v from t211.ids i where i.k=''aliadoA''')::bigint)), 'INMUTABLE');
end $$;

\echo '--- 10. Solicitudes manuales: coexisten, topes, resolución, IP'
do $$
declare m bigint; r text; sa jsonb; sb_ jsonb; i int; n int; h bigint; sid bigint;
  admin_ uuid := '00000000-0000-0000-0000-000000211002'; min_ uuid := '00000000-0000-0000-0000-000000211004';
  a uuid := '00000000-0000-0000-0000-000000211005'; venta_ uuid := '00000000-0000-0000-0000-000000211003';
begin
  m := t211.madre_manual(admin_);
  insert into t211.ids values ('sol', m) on conflict (k) do update set v = excluded.v;
  sa := public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Ana Uno', '310 111 2233', null, 'nota', 'sol-clave-001', 'ip-1');
  sb_ := public.registrar_solicitud_comparativa(m, 'B', 'unica', 1, 'Beto Dos', null, 'Beto@X.test', null, 'sol-clave-002', 'ip-2');
  perform t211.afirma('10.1 dos personas distintas coexisten pendientes', (select count(*) from public.cotizacion_comparativa_solicitudes where cotizacion_id = m and estado = 'pendiente') = 2);
  perform t211.afirma('10.2 una solicitud NO cambia la madre ni crea hija',
     not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m) and (select estado = 'abierta' and precio_venta is null from public.cotizaciones where id = m));
  -- misma persona: se actualiza, no se duplica
  r := public.registrar_solicitud_comparativa(m, 'B', 'unica', 1, 'Ana Uno', '3101112233', null, null, 'sol-clave-003', 'ip-1')::text;
  perform t211.afirma('10.3 mismo teléfono (otro formato) actualiza su solicitud, sin duplicar',
     (select count(*) from public.cotizacion_comparativa_solicitudes where cotizacion_id = m and estado = 'pendiente') = 2
     and (select opcion_ref from public.cotizacion_comparativa_solicitudes where id = (sa->>'id')::bigint) = 'B');
  -- reintento con la misma clave
  r := public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Ana Uno', '3101112233', null, null, 'sol-clave-001', 'ip-1')::text;
  perform t211.afirma('10.4 reintento con la misma clave es idempotente', r like '%"repetida": true%', r);
  -- validación de entrada
  perform t211.rechaza('10.5 sin contacto se rechaza', t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Zoe Tres', null, null, null, 'sol-clave-004', 'ip-3') $q$, m)), 'teléfono o un correo');
  perform t211.rechaza('10.6 teléfono corto se rechaza', t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Zoe Tres', '123', null, null, 'sol-clave-004', 'ip-3') $q$, m)), 'teléfono');
  perform t211.rechaza('10.7 correo inválido se rechaza', t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Zoe Tres', null, 'no-es-correo', null, 'sol-clave-004', 'ip-3') $q$, m)), 'correo');
  perform t211.rechaza('10.8 opción inexistente se rechaza', t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'C', 'unica', 1, 'Zoe Tres', '3100000001', null, null, 'sol-clave-004', 'ip-3') $q$, m)), 'OPCION');
  perform t211.rechaza('10.9 versión desactualizada se rechaza', t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 9, 'Zoe Tres', '3100000001', null, null, 'sol-clave-004', 'ip-3') $q$, m)), 'VERSION');
  -- Topes por IP: 3 por hora
  for i in 1..3 loop
    perform public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Persona ' || i, '31200000' || lpad(i::text, 2, '0'), null, null, 'ip-clave-0' || i, 'ip-tope');
  end loop;
  r := t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Persona 4', '3120000099', null, null, 'ip-clave-04', 'ip-tope') $q$, m));
  perform t211.rechaza('10.10 la 4ª solicitud de la misma IP en una hora se limita', r, 'LIMITE');
  perform t211.acepta('10.11 otra IP sigue pudiendo registrar (nadie monopoliza el canal)',
     t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Persona 5', '3120000098', null, null, 'ip-clave-05', 'ip-otra') $q$, m)));
  -- Tope por contacto/día: 3 (la misma persona, solicitudes ya resueltas)
  update public.cotizacion_comparativa_solicitudes set estado = 'rechazada', motivo = 'x' where cotizacion_id = m and contacto_huella_tel = encode(sha256(convert_to('tel:3130000001','UTF8')),'hex');
  for i in 1..3 loop
    perform public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Repite', '3130000001', null, null, 'rep-clave-0' || i, 'ip-rep' || i);
    update public.cotizacion_comparativa_solicitudes set estado = 'rechazada', motivo = 'x' where cotizacion_id = m and clave = 'rep-clave-0' || i;
  end loop;
  r := t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Repite', '3130000001', null, null, 'rep-clave-04', 'ip-rep9') $q$, m));
  perform t211.rechaza('10.12 más de 3 solicitudes del mismo contacto en un día se limita', r, 'LIMITE');
  -- Tope de pendientes por madre: 50
  select count(*) into n from public.cotizacion_comparativa_solicitudes where cotizacion_id = m and estado = 'pendiente';
  for i in n + 1 .. 50 loop
    perform public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Lote ' || i, '3140' || lpad(i::text, 6, '0'), null, null, 'lote-clave-' || lpad(i::text, 3, '0'), 'ip-lote' || i);
  end loop;
  perform t211.afirma('10.13 se llegó a 50 pendientes', (select count(*) from public.cotizacion_comparativa_solicitudes where cotizacion_id = m and estado = 'pendiente') = 50);
  r := t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'unica', 1, 'Lote 51', '3149999999', null, null, 'lote-clave-051', 'ip-lote51') $q$, m));
  perform t211.rechaza('10.14 la solicitud 51 se limita (tope blando de la madre)', r, 'LIMITE');
  perform t211.afirma('10.15 pese al tope, la madre sigue legible y eligible (no se monopoliza)',
     (select estado = 'abierta' from public.cotizaciones where id = m)
     and t211.intenta('service_role', null, format($q$ select public.registrar_validacion_comparativa(%s, 'A', 'unica', 1, 'interno', %L, 1600000, 'COP', true, null) $q$, m, admin_)) = 'ok');
  -- anónima de carrito: continúa por checkout, no por solicitud
  perform t211.rechaza('10.16 una madre de carrito anónima no admite solicitud', t211.intenta('service_role', null, format($q$ select public.registrar_solicitud_comparativa(%s, 'A', 'doble', 1, 'Zoe Tres', '3100000001', null, null, 'sol-clave-009', 'ip-9') $q$, (select v from t211.ids where k = 'carrito'))), 'NO_AUTORIZADO');

  -- Resolver: permisos
  sid := (sa->>'id')::bigint;
  perform t211.rechaza('10.20 anon no resuelve', t211.intenta('anon', null, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-001'')', sid)), 'permission denied');
  perform t211.rechaza('10.21 un B2B no resuelve', t211.intenta('authenticated', a, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-001'')', sid)), 'NO_AUTORIZADO');
  perform t211.rechaza('10.22 interno de otro tenant no resuelve', t211.intenta('authenticated', min_, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-001'')', sid)), 'NO_AUTORIZADO');
  perform t211.rechaza('10.23 sin sesión no resuelve', t211.intenta('authenticated', null, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-001'')', sid)), 'inicia sesión');
  -- Confirmar: crea hija; las demás quedan superadas
  h := t211.escalar('authenticated', venta_, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-001'')', sid))::bigint;
  perform t211.afirma('10.24 un interno del tenant confirma → hija (opción B por el cambio de opinión de Ana)',
     h is not null and (select opcion_ref = 'B' and cotizacion_origen_id = m from public.cotizaciones where id = h));
  perform t211.afirma('10.25 la solicitud queda atendida con hija y verificadora',
     (select estado = 'atendida' and hija_id = h and verificada_por = venta_ and ip_huella is null from public.cotizacion_comparativa_solicitudes where id = sid));
  perform t211.afirma('10.26 las demás pendientes quedan superadas, con evento',
     not exists (select 1 from public.cotizacion_comparativa_solicitudes where cotizacion_id = m and estado = 'pendiente')
     and (select count(*) from public.cotizacion_comparativa_eventos where cotizacion_id = m and tipo = 'solicitud_superada') > 40);
  perform t211.afirma('10.27 reintento de confirmar devuelve la misma hija',
     t211.escalar('authenticated', venta_, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-001'')', sid))::bigint = h);
  perform t211.rechaza('10.28 una solicitud resuelta no cambia (dueño)', t211.intenta('supabase_admin', null, format('update public.cotizacion_comparativa_solicitudes set estado = ''pendiente'' where id = %s', sid)), 'resuelta');
  perform t211.rechaza('10.29 las solicitudes no se borran', t211.intenta('supabase_admin', null, format('delete from public.cotizacion_comparativa_solicitudes where id = %s', sid)), 'no se borran');
  -- Vencida por 72 h y rechazo
  m := t211.madre_manual(admin_);
  sa := public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Vieja Cuatro', '3150000001', null, null, 'vie-clave-001', 'ip-v');
  perform t211.envejece((sa->>'id')::bigint, 73);
  perform t211.rechaza('10.30 solicitud de más de 72 h no se confirma', t211.intenta('authenticated', admin_, format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''vie-res-001'')', (sa->>'id'))), 'venció');
  perform t211.acepta('10.31 pero sí se puede rechazar', t211.intenta('authenticated', admin_, format('select public.resolver_solicitud_comparativa(%s, ''rechazar'', ''spam'', null)', (sa->>'id'))));
  perform t211.afirma('10.32 rechazar: estado y hash de IP anulado', (select estado = 'rechazada' and ip_huella is null from public.cotizacion_comparativa_solicitudes where id = (sa->>'id')::bigint));
end $$;

\echo '--- 11. Limpieza del hash de IP'
do $$
declare m bigint; sa jsonb; n int; admin_ uuid := '00000000-0000-0000-0000-000000211002';
begin
  m := t211.madre_manual(admin_);
  sa := public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Limpia Uno', '3160000001', null, null, 'lim-clave-001', 'ip-limpieza');
  perform t211.afirma('11.1 la solicitud guarda el hash de IP', (select ip_huella = 'ip-limpieza' from public.cotizacion_comparativa_solicitudes where id = (sa->>'id')::bigint));
  perform t211.envejece((sa->>'id')::bigint, 25);
  n := f211_priv.purgar_ip_huella();
  perform t211.afirma('11.2 a las 25 h la purga anula el hash', n >= 1 and (select ip_huella is null from public.cotizacion_comparativa_solicitudes where id = (sa->>'id')::bigint));
  perform t211.afirma('11.3 el resto de la solicitud queda intacta', (select contacto_nombre = 'Limpia Uno' and estado = 'pendiente' from public.cotizacion_comparativa_solicitudes where id = (sa->>'id')::bigint));
  -- la purga también corre sola al registrar otra solicitud
  perform t211.envejece((sa->>'id')::bigint, 30, 'ip-vieja');
  perform public.registrar_solicitud_comparativa(m, 'A', 'unica', 1, 'Limpia Dos', '3160000002', null, null, 'lim-clave-002', 'ip-limpieza2');
  perform t211.afirma('11.4 registrar otra solicitud dispara la purga de las viejas', (select ip_huella is null from public.cotizacion_comparativa_solicitudes where id = (sa->>'id')::bigint));
  perform t211.rechaza('11.5 el hash de IP solo se puede anular, no cambiar a otro valor', t211.intenta('supabase_admin', null, format('update public.cotizacion_comparativa_solicitudes set ip_huella = ''otra'' where id = %s', (sa->>'id'))), 'solo puede anularse');
end $$;

\echo '--- 12. Regresión: cotizaciones simples siguen funcionando como antes'
do $$
declare r text; c bigint; admin_ uuid := '00000000-0000-0000-0000-000000211002';
begin
  r := t211.escalar('authenticated', admin_, $q$ insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta)
        values ('mayorista', 'manual', 'abierta', '{}', 'COP', 1000, current_date + 3) returning id::text $q$);
  perform t211.afirma('12.1 un interno crea una cotización simple como siempre', r ~ '^\d+$', r);
  c := r::bigint;
  perform t211.acepta('12.2 …y la edita (precio, vigencia, estado)', t211.intenta('authenticated', admin_, format('update public.cotizaciones set precio_venta = 2000, vigencia_hasta = current_date + 10 where id = %s', c)));
  perform t211.acepta('12.3 …y agrega/edita/borra servicios', t211.intenta('authenticated', admin_, format('insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, valor) values (%s, ''hotel'', 5)', c)));
  perform t211.acepta('12.4 …y puede registrar pagos previos como antes (trigger no la afecta)',
     t211.intenta('supabase_admin', null, format($q$ insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, forma_pago, referencia, registrado_por_id)
         values (%s, 'mayorista', 1, 1, 'COP', 'Transferencia', 'R-REG-1', %L) $q$, c, admin_)));
  perform t211.afirma('12.5 el hash del RPC 198 no cambió respecto de main (md5 capturado en el preflight)',
     (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')) = 'edc9975010746e53e4af6a75ad9763dc');
end $$;

-- ── Resumen ────────────────────────────────────────────────────────────────
\echo '=== RESUMEN ==='
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos, count(*) as total from t211.res;
select nombre, detalle from t211.res where not ok order by nombre;
do $$
declare f int;
begin
  select count(*) into f from t211.res where not ok;
  if f > 0 then raise exception 'test_211: % prueba(s) fallaron', f; end if;
end $$;
rollback;
