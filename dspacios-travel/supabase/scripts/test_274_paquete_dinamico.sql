-- Prueba de la 274 (#82) contra un Postgres LOCAL desechable con 001-273 + 274 aplicadas.
-- Una sola transacción que termina en ROLLBACK. Cada comprobación imprime una fila (control, esperado, observado, veredicto).
-- Uso: psql -X -v ON_ERROR_STOP=1 -d <base> -f supabase/scripts/test_274_paquete_dinamico.sql
\set ON_ERROR_STOP on
begin;
create temp table res (n serial, control text, esperado text, observado text, ok boolean);
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$
  insert into res(control, esperado, observado, ok) values (c, e, o, e is not distinct from o) $$;
create or replace function pg_temp.falla(sql text) returns text language plpgsql as $$
begin execute sql; return 'sin error'; exception when others then return left(sqlerrm, 40); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000274001', 'din274@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000274001', 'din274@x.test', 'Din 274', 'superadmin', true, 'mayorista')
on conflict (id) do update set rol = 'superadmin', activo = true, tenant = 'mayorista';

insert into public.paquete_din (id, nombre, esquema, pvp_modo, usa_vuelo, usa_hotel, usa_servicios, moneda)
values (9001, 'Prueba 274', 'solo_pvp', 'por_componente', true, true, true, 'COP');

-- Dos cotizaciones: A (se edita) y B (se convierte).
do $$
declare
  cab jsonb; srv jsonb; ida bigint; idb bigint;
begin
  cab := jsonb_build_object(
    'payload', jsonb_build_object('cliente', jsonb_build_object('nombres','Ana','apellidos','P','tipoDoc','CC','numeroDoc','123','nacimiento','1990-01-01'),
       'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'tipoAsesor', 'interno', 'pax', 2),
    'detalle', jsonb_build_object('venta', jsonb_build_object('precio_venta', 3000000), 'items',
       jsonb_build_array(jsonb_build_object('descripcion','PAQ','cantidad',1,'tarifa_unit',3000000,'valor',3000000,'orden',0))),
    'cliente','Ana P','cliente_documento','123','destino','CARTAGENA','hotel','H','plan_nombre','Prueba 274','pax',2,
    'precio_venta',3000000,'moneda','COP','fecha_salida', (current_date + 30)::text, 'fecha_regreso', (current_date + 33)::text,
    'vigencia_hasta', (current_date + 10)::text, 'asesor','Din 274');
  srv := jsonb_build_array(
    jsonb_build_object('tipo_servicio','aereo','nombre_servicio','Vuelo','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',1000000,'componente','vuelo','exige_costo',true),
    jsonb_build_object('tipo_servicio','hotel','nombre_servicio','H','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',1500000,'componente','hotel','exige_costo',true),
    jsonb_build_object('tipo_servicio','otro','nombre_servicio','Tour','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',500000,'componente','servicio:1','exige_costo',true));
  ida := public.crear_cotizacion_din('00000000-0000-0000-0000-000000274001', 'mayorista', 9001, cab, srv);
  idb := public.crear_cotizacion_din('00000000-0000-0000-0000-000000274001', 'mayorista', 9001, cab, srv);
  perform set_config('t274.a', ida::text, false);
  perform set_config('t274.b', idb::text, false);
end $$;

select pg_temp.reg('crear: enlace al paquete', '9001', (select paquete_din_id::text from public.cotizaciones where id = current_setting('t274.a')::bigint));
select pg_temp.reg('crear: versión 1 sin costos', '1|false', (select count(*)||'|'||bool_or(lineas::text like '%costo%') from public.cotizacion_versiones where cotizacion_id = current_setting('t274.a')::bigint));
select pg_temp.reg('crear: 3 componentes con costo exigido', '3', (select count(*)::text from public.cotizacion_servicios where cotizacion_id = current_setting('t274.a')::bigint and exige_costo));
select pg_temp.reg('crear: costos pendientes = 3', '3', (select array_length(public.din_costos_pendientes(current_setting('t274.a')::bigint),1)::text));

-- Guardas
select pg_temp.reg('guarda: editor manual no puede tocar componentes', 'DIN_82_USAR_EDITOR',
  split_part(pg_temp.falla(format('update public.cotizacion_servicios set valor = 1 where cotizacion_id = %s', current_setting('t274.a'))), ':', 1));
select pg_temp.reg('guarda: precio no cambia por fuera del editor', 'DIN_82_USAR_EDITOR',
  split_part(pg_temp.falla(format('update public.cotizaciones set precio_venta = 1 where id = %s', current_setting('t274.a'))), ':', 1));
select pg_temp.reg('guarda: moneda distinta a la del paquete', 'DIN_82_MONEDA',
  split_part(pg_temp.falla($f$select public.crear_cotizacion_din('00000000-0000-0000-0000-000000274001','mayorista',9001,'{"moneda":"USD"}'::jsonb,'[]'::jsonb)$f$), ':', 1));

-- Edición con versión
do $$
declare v int; rev int; cid bigint := current_setting('t274.a')::bigint;
begin
  select economico_rev into rev from public.cotizaciones where cotizaciones.id = cid;
  v := public.editar_cotizacion_din('00000000-0000-0000-0000-000000274001', cid, rev, 'Ajuste de precio hotel',
    jsonb_build_array(
      jsonb_build_object('tipo_servicio','aereo','nombre_servicio','Vuelo','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',1000000,'componente','vuelo','exige_costo',true),
      jsonb_build_object('tipo_servicio','hotel','nombre_servicio','H','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',1700000,'componente','hotel','exige_costo',true),
      jsonb_build_object('tipo_servicio','otro','nombre_servicio','Tour','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',500000,'componente','servicio:1','exige_costo',true)),
    jsonb_build_object('precio_venta', 3200000, 'items', jsonb_build_array(jsonb_build_object('descripcion','PAQ','cantidad',1,'tarifa_unit',3200000,'valor',3200000,'orden',0))));
  perform set_config('t274.v', v::text, false);
end $$;
select pg_temp.reg('editar: versión nueva = 2', '2', current_setting('t274.v'));
select pg_temp.reg('editar: precio actual', '3200000.00', (select precio_venta::text from public.cotizaciones where id = current_setting('t274.a')::bigint));
select pg_temp.reg('editar: v1 conserva lo mostrado', '3000000.00', (select precio_venta::text from public.cotizacion_versiones where cotizacion_id = current_setting('t274.a')::bigint and version = 1));
select pg_temp.reg('editar: v2 guarda 3.200.000', '3200000.00', (select precio_venta::text from public.cotizacion_versiones where cotizacion_id = current_setting('t274.a')::bigint and version = 2));
select pg_temp.reg('editar: sigue sin costos', '3', (select array_length(public.din_costos_pendientes(current_setting('t274.a')::bigint),1)::text));
select pg_temp.reg('editar: revisión desactualizada se rechaza', 'EDICION_39_REVISION',
  split_part(pg_temp.falla(format($f$select public.editar_cotizacion_din('00000000-0000-0000-0000-000000274001', %s, 1, 'x', '[]'::jsonb, '{}'::jsonb)$f$, current_setting('t274.a'))), ':', 1));
select pg_temp.reg('editar: total que no cuadra se rechaza', 'EDICION_39_INCOHERENTE',
  split_part(pg_temp.falla(format($f$select public.editar_cotizacion_din('00000000-0000-0000-0000-000000274001', %s, (select economico_rev from public.cotizaciones where id=%s), 'x',
     '[{"tipo_servicio":"hotel","costo_neto":0,"valor":10}]'::jsonb, '{"precio_venta":99,"items":[{"valor":99}]}'::jsonb)$f$, current_setting('t274.a'), current_setting('t274.a'))), ':', 1));

-- Versión mostrada
select public.marcar_version_mostrada('00000000-0000-0000-0000-000000274001', current_setting('t274.a')::bigint, 1);
select pg_temp.reg('mostrada: v1 marcada', 'true', (select (mostrada_en is not null)::text from public.cotizacion_versiones where cotizacion_id = current_setting('t274.a')::bigint and version = 1));
select pg_temp.reg('mostrada: v2 sin marcar', 'false', (select (mostrada_en is not null)::text from public.cotizacion_versiones where cotizacion_id = current_setting('t274.a')::bigint and version = 2));
select pg_temp.reg('versión inmutable', 'DIN_82_VERSION_INMUTABLE',
  split_part(pg_temp.falla(format('update public.cotizacion_versiones set precio_venta = 1 where cotizacion_id = %s and version = 1', current_setting('t274.a'))), ':', 1));

-- Conversión sin costos: falla antes de numerar y sin dejar nada
update public.cotizaciones set condicion_pago_congelada_en = now(), moneda_congelada = 'COP', trm_autoritativa = 1,
       precio_total_congelado = 3000000, monto_exigido_total_cop = 100000
 where id = current_setting('t274.b')::bigint;
insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, trm, forma_pago, referencia, registrado_por_id, estado)
values (current_setting('t274.b')::bigint, 'mayorista', 100000, 100000, 'COP', 1, 'transferencia', 'R1', '00000000-0000-0000-0000-000000274001', 'activo');
select pg_temp.reg('convertir sin costos: rechazo', 'DIN_82_COSTOS_PENDIENTES',
  split_part(pg_temp.falla(format($f$select public.convertir_cotizacion_din(%s, '00000000-0000-0000-0000-000000274001')$f$, current_setting('t274.b'))), ':', 1));
select pg_temp.reg('convertir sin costos: 0 ventas / 0 CxP', '0|0',
  (select (select count(*) from public.ventas where cotizacion_id = current_setting('t274.b')::bigint)||'|'||(select count(*) from public.cuentas_por_pagar c join public.ventas v on v.numero_contrato = c.numero_contrato where v.cotizacion_id = current_setting('t274.b')::bigint)));
select pg_temp.reg('ruta manual directa también bloqueada (sin ventas)', '0',
  (select (case when pg_temp.falla(format($f$select public.convertir_cotizacion_manual_controlada(%s, '00000000-0000-0000-0000-000000274001')$f$, current_setting('t274.b'))) = 'sin error' then 1 else 0 end)::text));
select pg_temp.reg('ruta manual: sigue sin ventas', '0', (select count(*)::text from public.ventas where cotizacion_id = current_setting('t274.b')::bigint));

-- Costos parciales / inválidos
select pg_temp.reg('costos: valor 0 rechazado', 'DIN_82_COSTOS',
  split_part(pg_temp.falla(format($f$select public.registrar_costos_cotizacion_din('00000000-0000-0000-0000-000000274001', %s, '[{"orden":0,"costo_neto":0,"proveedor":"P"}]'::jsonb)$f$, current_setting('t274.b'))), ':', 1));
select pg_temp.reg('costos: parcial deja pendientes', '2',
  (select array_length(public.registrar_costos_cotizacion_din('00000000-0000-0000-0000-000000274001', current_setting('t274.b')::bigint,
     '[{"orden":0,"costo_neto":800000,"proveedor":"Aerolínea X"}]'::jsonb),1)::text));
select pg_temp.reg('costos: aún no convierte', 'DIN_82_COSTOS_PENDIENTES',
  split_part(pg_temp.falla(format($f$select public.convertir_cotizacion_din(%s, '00000000-0000-0000-0000-000000274001')$f$, current_setting('t274.b'))), ':', 1));
select pg_temp.reg('costos: completos', '0',
  (select coalesce(array_length(public.registrar_costos_cotizacion_din('00000000-0000-0000-0000-000000274001', current_setting('t274.b')::bigint,
     '[{"orden":1,"costo_neto":1200000,"proveedor":"Hotel Y"},{"orden":2,"costo_neto":350000,"proveedor":"Tours Z"}]'::jsonb),1),0)::text));

-- Conversión completa
do $$
declare n text; b bigint := current_setting('t274.b')::bigint;
begin
  n := public.convertir_cotizacion_din(b, '00000000-0000-0000-0000-000000274001');
  perform set_config('t274.n', n, false);
  -- idempotente: segunda llamada devuelve el mismo número
  perform set_config('t274.n2', public.convertir_cotizacion_din(b, '00000000-0000-0000-0000-000000274001'), false);
end $$;
select pg_temp.reg('convertir: contrato creado', '1', (select count(*)::text from public.ventas where numero_contrato = current_setting('t274.n') and cotizacion_id = current_setting('t274.b')::bigint));
select pg_temp.reg('convertir: reintento mismo número', current_setting('t274.n'), current_setting('t274.n2'));
select pg_temp.reg('convertir: precio y moneda del contrato', '3000000.00|COP', (select precio_venta::text||'|'||moneda from public.ventas where numero_contrato = current_setting('t274.n')));
select pg_temp.reg('convertir: 3 CxP, una por componente', '3', (select count(*)::text from public.cuentas_por_pagar where numero_contrato = current_setting('t274.n')));
select pg_temp.reg('convertir: CxP = costos reales, no PVP', '2350000.00', (select sum(valor_total)::text from public.cuentas_por_pagar where numero_contrato = current_setting('t274.n')));
select pg_temp.reg('convertir: CxP en la moneda de la cotización', 'COP', (select string_agg(distinct coalesce(moneda,'COP'), ',') from public.cuentas_por_pagar where numero_contrato = current_setting('t274.n')));
select pg_temp.reg('convertir: proveedores reales', 'Aerolínea X,Hotel Y,Tours Z', (select string_agg(proveedor, ',' order by proveedor) from public.cuentas_por_pagar where numero_contrato = current_setting('t274.n')));
select pg_temp.reg('convertir: sin duplicar CxP tras reintento', '3', (select count(*)::text from public.cuentas_por_pagar where numero_contrato = current_setting('t274.n')));
select pg_temp.reg('convertir: costo_hotel del contrato', '1200000.00', (select costo_hotel::text from public.ventas where numero_contrato = current_setting('t274.n')));

select control, esperado, observado, case when ok then 'OK' else 'FALLA' end as veredicto from res order by n;
select case when count(*) filter (where not ok) = 0 then 'TODO OK (' || count(*) || ' controles)' else 'HAY FALLAS: ' || count(*) filter (where not ok) end as resumen from res;
rollback;
