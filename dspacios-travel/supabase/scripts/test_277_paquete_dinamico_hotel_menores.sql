-- Prueba de la 277 (#82, capacidad de niños y edades del hotel manual) contra un Postgres LOCAL desechable con 001-276 (+277).
-- Una transacción que termina en ROLLBACK. Cada control imprime: n | control | esperado | observado | veredicto.
-- Uso: psql -X -q -t -A -F' | ' -d <base> -f supabase/scripts/test_277_paquete_dinamico_hotel_menores.sql
begin;
create temp table res (n serial, control text, esperado text, observado text, ok boolean);
create function pg_temp.reg(c text, e text, o text) returns void language sql as $$
  insert into res(control, esperado, observado, ok) values (c, e, o, e is not distinct from o) $$;
create function pg_temp.msg(q text) returns text language plpgsql as $$
begin
  begin execute q; return 'ok'; exception when others then return sqlerrm; end;
end $$;
create function pg_temp.val(q text) returns text language plpgsql as $$
declare r text;
begin
  begin execute q into r; exception when others then r := 'ERR:' || left(sqlerrm, 90); end;
  return coalesce(r, '');
end $$;
create function pg_temp.como(uid uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', uid)::text, true);
  set local role authenticated;
  begin execute q into r; exception when others then r := 'ERR:' || left(sqlerrm, 160); end;
  reset role;
  return r;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000277002', 'u2@t277.test') on conflict do nothing;
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-000000277002', '00000000-0000-0000-0000-000000277002') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000277002', 'u2@t277.test', 'AdminM', 'administracion', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.destinos (id, nombre, pais) values (277001, 'T277 A', 'Colombia');
insert into public.hoteles (id, destino_id, nombre, activo, moneda) values (277001, 277001, 'H ficha', true, 'COP');
insert into public.paquete_din (id, tenant, nombre, destino_id, moneda, esquema, pvp_modo, usa_hotel, noches)
values (277001, 'mayorista', 'P277', 277001, 'COP', 'solo_pvp', 'por_componente', true, 3);

select pg_temp.reg('hotel manual NUEVO sin capacidad ni edades', 'DIN_82_MENORES: el hotel manual «Manual» necesita la capacidad máxima de niños por habitación y las edades de infante y niño.',
  pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre) values (277001, 'Manual')$q$));
select pg_temp.reg('hotel manual con solo la capacidad (faltan las edades)', 'DIN_82_MENORES',
  split_part(pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos) values (277001, 'Manual', 1)$q$), ':', 1));
select pg_temp.reg('hotel manual completo (capacidad 1, infante hasta 2, niño hasta 10)', 'ok',
  pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max) values (277001, 'Manual OK', 1, 2, 10)$q$));
select pg_temp.reg('capacidad 0 (no admite niños) es un valor válido', 'ok',
  pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max) values (277001, 'Sin niños', 0, 2, 10)$q$));
select pg_temp.reg('capacidad mayor que 2 (el sistema solo cobra Niño 1 y Niño 2 por habitación)', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max) values (277001, 'Cap 3', 3, 2, 10)$q$) like '%paquete_din_hoteles_menores_check%')::text);
select pg_temp.reg('edad de niño que no supera la de infante', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max) values (277001, 'Edades', 1, 5, 5)$q$) like '%paquete_din_hoteles_menores_check%')::text);
select pg_temp.reg('edad de niño mayor que 17', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max) values (277001, 'Edad 18', 1, 2, 18)$q$) like '%paquete_din_hoteles_menores_check%')::text);
select pg_temp.reg('hotel con FICHA: no guarda otra copia de capacidad/edades (se leen de la ficha)', '||',
  pg_temp.val($q$with i as (insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max) values (277001, 277001, 'H ficha', 2, 1, 5) returning coalesce(capacidad_ninos::text, '') || '|' || coalesce(edad_infante_max::text, '') || '|' || coalesce(edad_nino_max::text, '')) select * from i$q$));

-- Fila ANTERIOR a la 277 (sin capacidad/edades): se puede seguir actualizando lo demás sin rechazarla.
alter table public.paquete_din_hoteles disable trigger trg_din_hotel_menores;
insert into public.paquete_din_hoteles (id, paquete_id, nombre) values (277900, 277001, 'Heredado');
alter table public.paquete_din_hoteles enable trigger trg_din_hotel_menores;
select pg_temp.reg('hotel manual heredado: cambiar su nombre no se rechaza', 'ok', pg_temp.msg($q$update public.paquete_din_hoteles set nombre = 'Heredado 2' where id = 277900$q$));
select pg_temp.reg('... pero tocar sus edades sin completar la configuración sí', 'DIN_82_MENORES',
  split_part(pg_temp.msg($q$update public.paquete_din_hoteles set edad_infante_max = 2 where id = 277900$q$), ':', 1));

-- guardar_paquete_din (atómico, como administración de Mayorista) guarda los tres campos del hotel manual.
select pg_temp.reg('guardar_paquete_din persiste capacidad y edades del hotel manual', 'num',
  case when pg_temp.como('00000000-0000-0000-0000-000000277002', $q$select public.guardar_paquete_din(null, '{"nombre":"G277","destino_id":277001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"Hotel G","capacidad_ninos":2,"edad_infante_max":1,"edad_nino_max":11,"pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$) ~ '^[0-9]+$' then 'num' else 'otro' end);
select pg_temp.reg('... y quedó guardado', '2|1|11',
  pg_temp.val($q$select h.capacidad_ninos || '|' || h.edad_infante_max || '|' || h.edad_nino_max from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G277'$q$));
select pg_temp.reg('guardar_paquete_din rechaza un hotel manual sin esos datos', 'DIN_82_MENORES',
  split_part(substr(pg_temp.como('00000000-0000-0000-0000-000000277002', $q$select public.guardar_paquete_din(null, '{"nombre":"G277b","destino_id":277001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"Hotel G","pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$), 5), ':', 1));
select pg_temp.reg('... y no deja nada a medias', '0', (select count(*)::text from public.paquete_din where nombre = 'G277b'));

-- ═══ Servicios vinculados: pvp_infante, y venta → cotización → CONVERSIÓN con los mismos números de pruebas/paqueteDinamico82ServicioCobro.test.ts ═══
select pg_temp.reg('pvp_infante negativo rechazado', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_servicios (paquete_id, nombre, pvp, pvp_infante) values (277001, 'Tour', 120000, -1)$q$) like '%paquete_din_servicios_pvp_infante_check%')::text);
-- (dos sentencias: lo que escribe la función no se ve dentro de la misma sentencia que la llama)
select pg_temp.como('00000000-0000-0000-0000-000000277002', $q$select public.guardar_paquete_din(null, '{"nombre":"G277c","destino_id":277001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"usa_servicios":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"Hotel G","capacidad_ninos":2,"edad_infante_max":1,"edad_nino_max":11,"pvp":{"doble":1}}]'::jsonb, '[{"nombre":"Tour A","pvp":120000,"pvp_infante":40000},{"nombre":"Tour B","pvp":120000,"pvp_infante":0},{"nombre":"Cena","pvp":720000}]'::jsonb)::text$q$) as guardado;
select pg_temp.reg('guardar_paquete_din persiste el PVP de infante del servicio por persona (0 = gratis explícito)', '40000.00|0.00|',
  (select string_agg(coalesce(pvp_infante::text, ''), '|' order by s.orden) from public.paquete_din_servicios s join public.paquete_din p on p.id = s.paquete_id where p.nombre = 'G277c'));

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000277001', 'din277@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000277001', 'din277@x.test', 'Din 277', 'superadmin', true, 'mayorista')
  on conflict (id) do update set rol = 'superadmin', activo = true, tenant = 'mayorista';
insert into public.paquete_din (id, tenant, nombre, destino_id, moneda, esquema, pvp_modo, usa_hotel, usa_servicios, noches, activo, publicado)
values (277020, 'mayorista', 'P277 conversión', 277001, 'COP', 'solo_pvp', 'por_componente', true, false, 3, true, true);
insert into public.paquete_din_hoteles (id, paquete_id, nombre, pvp, capacidad_ninos, edad_infante_max, edad_nino_max) values (277020, 277020, 'Hotel M', '{"doble":1000000}'::jsonb, 2, 2, 10);

-- Crea la cotización con los componentes que arma el código (valor, costo, exige_costo y NOMBRE con la unidad de cobro), la deja lista y la convierte.
create function pg_temp.convertir_caso(srv jsonb, total numeric, costos jsonb) returns text language plpgsql as $$
declare cab jsonb; cid bigint; n text; uid uuid := '00000000-0000-0000-0000-000000277001';
begin
  cab := jsonb_build_object(
    'payload', jsonb_build_object('cliente', jsonb_build_object('nombres','Ana','apellidos','P','tipoDoc','CC','numeroDoc','123','nacimiento','1990-01-01','email','a@x.co','telefono','3001234567'),
       'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'tipoAsesor', 'interno', 'pax', 2, 'dinamico', jsonb_build_object('hotelId', 277020, 'vueloId', null)),
    'detalle', jsonb_build_object('venta', jsonb_build_object('precio_venta', total), 'items', jsonb_build_array(jsonb_build_object('descripcion','PAQ','cantidad',1,'tarifa_unit',total,'valor',total,'orden',0))),
    'cliente','Ana P','cliente_documento','123','destino','CARTAGENA','hotel','Hotel M','plan_nombre','P277 conversión','pax',2,
    'precio_venta', total,'moneda','COP','fecha_salida', (public.fecha_negocio() + 30)::text, 'fecha_regreso', (public.fecha_negocio() + 33)::text,
    'vigencia_hasta', (public.fecha_negocio() + 10)::text, 'asesor','Din 277');
  cid := public.crear_cotizacion_din(uid, 'mayorista', 277020, cab, srv);
  update public.cotizaciones set condicion_pago_congelada_en = now(), moneda_congelada = 'COP', trm_autoritativa = 1, precio_total_congelado = total, monto_exigido_total_cop = 100000 where id = cid;
  insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, trm, forma_pago, referencia, registrado_por_id, estado)
    values (cid, 'mayorista', 100000, 100000, 'COP', 1, 'transferencia', 'R277', uid, 'activo');
  if costos is not null then perform public.registrar_costos_cotizacion_din(uid, cid, costos); end if;
  n := public.convertir_cotizacion_din(cid, uid);
  perform set_config('t277.cot', cid::text, false);
  return n;
end $$;

-- A) SOLO PVP por componente: hotel 2.900.000 + Cena (por GRUPO, una vez) 720.000 + Tour (4 personas + 1 infante) 520.000 = 4.140.000. Costos reales a mano.
select set_config('t277.a', pg_temp.convertir_caso(
  jsonb_build_array(
    jsonb_build_object('tipo_servicio','hotel','nombre_servicio','Hotel M','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',2900000,'componente','hotel','exige_costo',true),
    jsonb_build_object('tipo_servicio','otro','nombre_servicio','Cena show · 1 grupo (4 pasajeros con silla)','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',720000,'componente','servicio:1','exige_costo',true),
    jsonb_build_object('tipo_servicio','otro','nombre_servicio','Tour Islas · 4 personas + 1 infante (menor de 2 años)','costo_neto',0,'modo','mk','pct_markup',0,'ta',0,'valor',520000,'componente','servicio:2','exige_costo',true)),
  4140000,
  '[{"orden":0,"costo_neto":2400000,"proveedor":"Hotel M SAS"},{"orden":1,"costo_neto":600000,"proveedor":"Operador Tours SAS"},{"orden":2,"costo_neto":410000,"proveedor":"Operador Tours SAS"}]'::jsonb), false);
select pg_temp.reg('SOLO PVP: la cotización quedó con la unidad en el componente', '2', (select count(*)::text from public.cotizacion_servicios where cotizacion_id = current_setting('t277.cot')::bigint and (nombre_servicio like '%1 grupo (4 pasajeros con silla)' or nombre_servicio like '%4 personas + 1 infante%')));
select pg_temp.reg('SOLO PVP: el contrato conserva el total de la venta', '4140000.00', (select precio_venta::text from public.ventas where numero_contrato = current_setting('t277.a')));
select pg_temp.reg('SOLO PVP: 3 CxP, una por componente, con el COSTO real (no el PVP)', '3|3410000.00', (select count(*)::text || '|' || sum(valor_total)::text from public.cuentas_por_pagar where numero_contrato = current_setting('t277.a')));
select pg_temp.reg('SOLO PVP: el servicio por grupo genera UNA CxP por el costo del grupo (no × pasajeros)', '600000.00', (select valor_total::text from public.cuentas_por_pagar where numero_contrato = current_setting('t277.a') and valor_total = 600000));
select pg_temp.reg('SOLO PVP: la CxP del servicio por persona lleva el costo registrado', '410000.00', (select valor_total::text from public.cuentas_por_pagar where numero_contrato = current_setting('t277.a') and valor_total = 410000));

-- B) NETAS+MARKUP: el costo sale de la ficha (Cena 600.000 por grupo; Tour 4 × 100.000 + infante 30.000 = 430.000) y NO se pide registrar costos.
select set_config('t277.b', pg_temp.convertir_caso(
  jsonb_build_array(
    jsonb_build_object('tipo_servicio','hotel','nombre_servicio','Hotel M','costo_neto',2320000,'modo','mk','pct_markup',20,'ta',0,'valor',2900000,'componente','hotel','exige_costo',false),
    jsonb_build_object('tipo_servicio','otro','nombre_servicio','Cena show · 1 grupo (4 pasajeros con silla)','costo_neto',600000,'modo','mk','pct_markup',20,'ta',0,'valor',750000,'componente','servicio:1','exige_costo',false),
    jsonb_build_object('tipo_servicio','otro','nombre_servicio','Tour Islas · 4 personas + 1 infante (menor de 2 años)','costo_neto',430000,'modo','mk','pct_markup',20,'ta',0,'valor',538000,'componente','servicio:2','exige_costo',false)),
  4188000, null), false);
select pg_temp.reg('NETAS: el contrato conserva el total de la venta', '4188000.00', (select precio_venta::text from public.ventas where numero_contrato = current_setting('t277.b')));
select pg_temp.reg('NETAS: 3 CxP con el costo de la ficha', '3|3350000.00', (select count(*)::text || '|' || sum(valor_total)::text from public.cuentas_por_pagar where numero_contrato = current_setting('t277.b')));
select pg_temp.reg('NETAS: el servicio por grupo cuesta UNA vez 600.000 y el de persona 430.000 (con infante)', '600000.00|430000.00',
  (select max(valor_total) filter (where valor_total = 600000)::text || '|' || max(valor_total) filter (where valor_total = 430000)::text from public.cuentas_por_pagar where numero_contrato = current_setting('t277.b')));
select pg_temp.reg('NETAS: sin costos pendientes que registrar', '0', (select coalesce(array_length(public.din_costos_pendientes(current_setting('t277.cot')::bigint), 1), 0)::text));

select n, control, esperado, observado, case when ok then 'OK' else 'FALLA' end as veredicto from res order by n;
select 'TOTAL: ' || count(*) filter (where ok) || ' OK / ' || count(*) filter (where not ok) || ' FALLA' from res;
rollback;
