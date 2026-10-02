-- ═══════════════════════════════════════════════════════════════════════════
-- PRUEBA · migración 198 (fecha de negocio America/Bogota en SQL).
--
-- SOLO contra una base PostgreSQL LOCAL DESECHABLE con la 164 aplicada (nunca
-- Supabase real ni preview). Correr como superusuario:
--   psql -X -v ON_ERROR_STOP=1 -f test_198_fecha_negocio.sql
-- Todo va en UNA transacción que termina en ROLLBACK: no deja datos ni cambios.
-- Cualquier aserción que falle lanza excepción → psql sale con código ≠ 0.
--
-- Reloj fijo: Postgres no permite fijar now(), así que dentro de la transacción
-- se reemplaza el CUERPO de public.fecha_negocio() (misma firma) por uno que
-- devuelve el día de Bogotá de un instante fijo. Las funciones de la 164 llaman
-- a fecha_negocio(), así que ven ese reloj. La FÓRMULA real se prueba aparte
-- (bloque T1) pasándole instantes explícitos.
--
-- Antes de la 198, esta prueba FALLA en T0 (las funciones aún usan
-- current_date y fecha_negocio() no existe): así se reproduce el defecto.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

create schema _t198;
create function _t198.expect(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) = false then raise exception 'ASSERT %', p_msg; end if;
end $$;

-- ── T0 · estructura ────────────────────────────────────────────────────────
do $$
declare v_n int; v_def text;
begin
  perform _t198.expect(to_regprocedure('public.fecha_negocio(timestamptz)') is not null,
    'T0: existe public.fecha_negocio(timestamptz) (¿aplicada la 198?)');
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('_huella_pago_previo', 'registrar_pago_previo', 'anular_pago_previo',
                      'transferir_pagos_previos_a_abonos', 'convertir_cotizacion_a_contrato')
    and p.prosrc not ilike '%current_date%' and p.prosrc like '%public.fecha_negocio()%';
  perform _t198.expect(v_n = 5, format('T0: las 5 funciones usan fecha_negocio() y no current_date (%s/5)', v_n));
  select provolatile into v_def from pg_proc where oid = 'public._huella_pago_previo'::regproc;
  perform _t198.expect(v_def = 's', 'T0: _huella_pago_previo es STABLE');
  for v_def in
    select column_default from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (('abonos','fecha_abono'), ('cotizacion_pagos_previos','fecha_pago'))
  loop
    perform _t198.expect(v_def in ('fecha_negocio()', 'public.fecha_negocio()'), 'T0: default = fecha_negocio(), es ' || v_def);
  end loop;
  -- ACL de la 164 intacta: authenticated sigue sin poder ejecutar las RPC.
  perform _t198.expect(not has_function_privilege('authenticated', 'public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric)', 'execute'),
    'T0: authenticated no ejecuta registrar_pago_previo');
  perform _t198.expect(has_function_privilege('service_role', 'public.convertir_cotizacion_a_contrato(bigint, uuid)', 'execute'),
    'T0: service_role ejecuta convertir_cotizacion_a_contrato');
  perform _t198.expect(has_function_privilege('authenticated', 'public.fecha_negocio(timestamptz)', 'execute'),
    'T0: authenticated puede evaluar el default fecha_negocio()');
  raise notice 'T0 estructura: OK';
end $$;

-- ── T1 · fórmula real, con la SESIÓN en distintas zonas ────────────────────
-- (current_date con la sesión en UTC es el cálculo viejo: se compara contra él.)
do $$
declare tz text; c record;
begin
  foreach tz in array array['UTC', 'America/Bogota', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'] loop
    perform set_config('TimeZone', tz, true);
    for c in select * from (values
      (timestamptz '2026-09-30 23:30:00+00', date '2026-09-30', '18:30 Bogotá'),
      (timestamptz '2026-09-30 23:59:59+00', date '2026-09-30', '18:59:59 Bogotá'),
      (timestamptz '2026-10-01 00:00:00+00', date '2026-09-30', '19:00 Bogotá'),
      (timestamptz '2026-10-01 00:30:00+00', date '2026-09-30', '19:30 Bogotá'),
      (timestamptz '2026-10-01 04:59:59+00', date '2026-09-30', '23:59:59 Bogotá'),
      (timestamptz '2026-10-01 05:00:00+00', date '2026-10-01', '00:00 Bogotá día siguiente'),
      (timestamptz '2027-01-01 03:00:00+00', date '2026-12-31', '22:00 Bogotá 31-dic')
    ) as t(instante, esperado, etiqueta) loop
      perform _t198.expect(public.fecha_negocio(c.instante) = c.esperado,
        format('T1: %s con TimeZone=%s → %s (dio %s)', c.etiqueta, tz, c.esperado, public.fecha_negocio(c.instante)));
    end loop;
  end loop;
  -- El cálculo viejo, con la sesión en UTC, ya es el día siguiente a las 19:30.
  perform set_config('TimeZone', 'UTC', true);
  perform _t198.expect((timestamptz '2026-10-01 00:30:00+00')::date = date '2026-10-01',
    'T1: reproducción — current_date (sesión UTC) a las 19:30 Bogotá da 1-oct');
  -- Sin argumento = ahora, y estable dentro de la transacción.
  perform _t198.expect(public.fecha_negocio() = (now() at time zone 'America/Bogota')::date, 'T1: default now()');
  raise notice 'T1 fórmula (5 zonas × 7 instantes): OK';
end $$;

-- ── Datos de partida (mismo patrón que la batería #40) ─────────────────────
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000198', 'adm198@t', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('aaaaaaaa-0000-0000-0000-000000000198', 'adm198@t', 'ADM 198', 'superadmin', true, 'mayorista')
on conflict (id) do update set rol = 'superadmin', activo = true, tenant = 'mayorista';
insert into public.proveedores (nombre, tipo, ciudad, aplica_retencion, pct_retencion, clasificacion)
values ('PROV HOTEL 198', 'hotel', 'Cartagena', false, 0, 'hotel') on conflict do nothing;

-- Cotización manual abierta, congelada con su PRIMER pago previo (fecha p_fecha;
-- null = la RPC elige la fecha). Devuelve el id.
create function _t198.mk_cot(p_clave text, p_fecha date) returns bigint language plpgsql as $$
declare v_cot bigint;
begin
  insert into public.cotizaciones
    (tenant, estado, tipo, cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
     pax, precio_venta, moneda, asesor, payload, detalle)
  values
    ('mayorista', 'abierta', 'manual', 'CLIENTE ' || p_clave, 'CC 198', 'CARTAGENA', '2026-11-01', '2026-11-04',
     2, 2000000, 'COP', 'Asesor 198',
     jsonb_build_object(
       'cliente', jsonb_build_object('nombres','Cliente','apellidos',p_clave,'tipoDoc','CC',
         'numeroDoc','198' || length(p_clave),'nacimiento','1990-01-01','telefono','300123'),
       'tipoAsesor','interno','ninos',0,'tarifaNino',0,'recobro',0,'recobroAliado',0),
     '{}'::jsonb)
  returning id into v_cot;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 0, 'aereo', 'Avianca', 'VUELO BOG-CTG', null, 800000),
         (v_cot, 1, 'hotel', null, 'Hotel 198', 'PROV HOTEL 198', 700000);
  perform public.registrar_pago_previo(
    v_cot, 1000000, 'COP', 1, 'Transferencia', 'REF-' || p_clave, p_fecha,
    'aaaaaaaa-0000-0000-0000-000000000198', 'key-198-' || p_clave,
    jsonb_build_array(
      jsonb_build_object('orden',0,'tipo_componente','aereo_empaquetado','referencia_externa','Vuelo',
        'valor_componente',800000,'condicion_pago_tipo','sin_condicion','monto_exigido',0,'restriccion_comercial','normal'),
      jsonb_build_object('orden',1,'tipo_componente','hotel','referencia_externa','Hotel 198',
        'valor_componente',700000,'condicion_pago_tipo','anticipo_saldo','condicion_pago_pct_aplicable',0.5,
        'condicion_pago_dias_saldo',30,'monto_exigido',350000,'restriccion_comercial','normal')),
    350000, 50.0);
  return v_cot;
end $$;

-- Escenario completo para un reloj fijo `p_instante`; `p_esperado` = día de
-- Bogotá que debe salir en todo lo AUTOMÁTICO. Corre con la sesión en `p_tz`.
create function _t198.escenario(p_instante timestamptz, p_esperado date, p_tz text, p_clave text)
returns void language plpgsql as $$
declare
  v_cot bigint; v_cot2 bigint; v_cot3 bigint; v_pago bigint; v_pago_manual bigint;
  v_num text; v_num2 text; v_f date; v_n int; v_creado timestamptz;
begin
  perform set_config('TimeZone', p_tz, true);
  -- Reloj fijo: misma firma, cuerpo con el instante dado.
  execute format($f$
    create or replace function public.fecha_negocio(p_instante timestamptz default now())
    returns date language sql stable parallel safe as $b$
      select (%L::timestamptz at time zone 'America/Bogota')::date
    $b$ $f$, p_instante);

  -- (a) pago previo SIN fecha → la elige la RPC: día de Bogotá; asiento igual; timestamp intacto.
  v_cot := _t198.mk_cot(p_clave || '-auto', null);
  select id, fecha_pago, created_at into v_pago, v_f, v_creado
  from public.cotizacion_pagos_previos where cotizacion_id = v_cot;
  perform _t198.expect(v_f = p_esperado, format('[%s] (a) fecha_pago automática = %s (dio %s)', p_clave, p_esperado, v_f));
  select fecha into v_f from public.asientos_contables where origen = 'pago_previo' and referencia = 'pago_previo:' || v_pago;
  perform _t198.expect(v_f = p_esperado, format('[%s] (a) asiento del pago previo = %s (dio %s)', p_clave, p_esperado, v_f));
  perform _t198.expect(v_creado = now(), format('[%s] (a) created_at sigue siendo el instante de la transacción', p_clave));

  -- (b) pago previo con fecha MANUAL → se respeta en el pago y en su asiento.
  v_cot2 := _t198.mk_cot(p_clave || '-manual', date '2026-09-15');
  select id, fecha_pago into v_pago_manual, v_f from public.cotizacion_pagos_previos where cotizacion_id = v_cot2;
  perform _t198.expect(v_f = date '2026-09-15', format('[%s] (b) fecha_pago manual intacta (dio %s)', p_clave, v_f));
  select fecha into v_f from public.asientos_contables where origen = 'pago_previo' and referencia = 'pago_previo:' || v_pago_manual;
  perform _t198.expect(v_f = date '2026-09-15', format('[%s] (b) asiento con la fecha manual (dio %s)', p_clave, v_f));

  -- (c) anular el pago manual → la reversión lleva el día de la anulación (regla
  --     sin cambio), calculado en Bogotá.
  perform public.anular_pago_previo(v_pago_manual, 'aaaaaaaa-0000-0000-0000-000000000198', 'prueba 198');
  select fecha into v_f from public.asientos_contables
  where origen = 'pago_previo_reversion' and referencia = 'pago_previo:' || v_pago_manual;
  perform _t198.expect(v_f = p_esperado, format('[%s] (c) reversión del pago previo = %s (dio %s)', p_clave, p_esperado, v_f));

  -- (d) convertir: el abono hereda la fecha del pago (manual 2026-09-01); la
  --     aplicación contable y las CxP llevan el día de Bogotá.
  v_cot3 := _t198.mk_cot(p_clave || '-conv', date '2026-09-01');
  v_num := public.convertir_cotizacion_a_contrato(v_cot3, 'aaaaaaaa-0000-0000-0000-000000000198');
  select fecha_abono into v_f from public.abonos where numero_contrato = v_num;
  perform _t198.expect(v_f = date '2026-09-01', format('[%s] (d) abono transferido conserva la fecha del pago (dio %s)', p_clave, v_f));
  select count(*) into v_n from public.asientos_contables
  where origen = 'pago_previo_aplicacion' and referencia like 'pago_previo:%:abono:%'
    and referencia in (select 'pago_previo:' || p.id || ':abono:' || p.abono_id from public.cotizacion_pagos_previos p where p.cotizacion_id = v_cot3)
    and fecha = p_esperado;
  perform _t198.expect(v_n = 1, format('[%s] (d) asiento de aplicación con fecha %s (%s)', p_clave, p_esperado, v_n));
  select count(*), min(fecha_obligacion) into v_n, v_f from public.cuentas_por_pagar where numero_contrato = v_num;
  perform _t198.expect(v_n = 2 and v_f = p_esperado and v_f = (select max(fecha_obligacion) from public.cuentas_por_pagar where numero_contrato = v_num),
    format('[%s] (d) CxP fecha_obligacion = %s (n=%s, dio %s)', p_clave, p_esperado, v_n, v_f));
  select count(*) into v_n from public.asientos_contables a
  where a.referencia in (select 'cxp:' || c.id from public.cuentas_por_pagar c where c.numero_contrato = v_num)
    and a.fecha = p_esperado;
  perform _t198.expect(v_n = 2, format('[%s] (d) asientos de CxP con fecha %s (%s/2)', p_clave, p_esperado, v_n));

  -- (e) default de abonos.fecha_abono: inserción sin fecha → día de Bogotá.
  insert into public.abonos (numero_contrato, cliente, valor_abono, monto_cop, trm, tenant)
  values (v_num, 'CLIENTE', 1000, 1000, 1, 'mayorista');
  select fecha_abono into v_f from public.abonos where numero_contrato = v_num order by id desc limit 1;
  perform _t198.expect(v_f = p_esperado, format('[%s] (e) default fecha_abono = %s (dio %s)', p_clave, p_esperado, v_f));

  -- (f) default de cotizacion_pagos_previos.fecha_pago: inserción directa sin fecha.
  insert into public.cotizacion_pagos_previos (cotizacion_id, monto_cop, monto_moneda, forma_pago, referencia, registrado_por_id, estado)
  values (v_cot, 1, 1, 'Transferencia', 'T198-DEFAULT', 'aaaaaaaa-0000-0000-0000-000000000198', 'anulado')
  returning fecha_pago into v_f;
  perform _t198.expect(v_f = p_esperado, format('[%s] (f) default fecha_pago = %s (dio %s)', p_clave, p_esperado, v_f));

  -- (g) transferir_pagos_previos_a_abonos (ruta independiente de la conversión):
  --     contrato espejo apuntando a la cotización (a), que sigue con su pago activo.
  update public.cotizaciones set estado = 'convertida' where id = v_cot;
  v_num2 := 'DTM-98' || lpad((abs(hashtext(p_clave)) % 10000)::text, 4, '0');  -- formato DTM-#### exigido por ventas
  insert into public.ventas
  select (jsonb_populate_record(null::public.ventas,
           to_jsonb(v) || jsonb_build_object('numero_contrato', v_num2, 'cotizacion_id', v_cot,
                                            'share_token', gen_random_uuid()))).*
  from public.ventas v where v.numero_contrato = v_num;
  perform public.transferir_pagos_previos_a_abonos(v_cot, v_num2, 'aaaaaaaa-0000-0000-0000-000000000198');
  select fecha_abono into v_f from public.abonos where numero_contrato = v_num2;
  perform _t198.expect(v_f = p_esperado, format('[%s] (g) abono transferido = fecha del pago automático %s (dio %s)', p_clave, p_esperado, v_f));
  select count(*) into v_n from public.asientos_contables
  where origen = 'pago_previo_aplicacion' and referencia like 'pago_previo:' || v_pago || ':abono:%' and fecha = p_esperado;
  perform _t198.expect(v_n = 1, format('[%s] (g) asiento de aplicación con fecha %s (%s)', p_clave, p_esperado, v_n));

  raise notice '[%] escenario OK (TimeZone=%)', p_clave, p_tz;
end $$;

-- ── T2 · reloj fijo antes y después de las 7 p. m., sesión en UTC y en Tokio ─
select _t198.escenario('2026-09-30 23:30:00+00', '2026-09-30', 'UTC',        '1830-utc');
select _t198.escenario('2026-10-01 00:30:00+00', '2026-09-30', 'UTC',        '1930-utc');
select _t198.escenario('2026-10-01 00:30:00+00', '2026-09-30', 'Asia/Tokyo', '1930-tokio');
select _t198.escenario('2026-10-01 05:00:00+00', '2026-10-01', 'UTC',        '0000-dia-siguiente');

\echo 'TEST 198: TODO OK (se revierte todo)'
rollback;
