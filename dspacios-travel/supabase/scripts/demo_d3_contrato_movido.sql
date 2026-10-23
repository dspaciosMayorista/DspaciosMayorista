-- ───────────────────────────────────────────────────────────────────────────
-- DEMOSTRACIÓN D3-c (aprobada 2026-10-01) · contrato ORGÁNICO movido de Y a X
-- SOLO base LOCAL o DESECHABLE. Crea un contrato de ejemplo con la MISMA
-- forma que deja la reserva desde el tarifario (reservar/actions.ts: tramos
-- de contrato_vuelos copiados del record, columnas de vuelo en ventas,
-- costo_aereo = tarifa neta × pax y CxP aérea al proveedor), lo mueve con
-- mover_pasajero (migración 194) y muestra, campo por campo, el resultado:
--   1) a D3XXX1 (OTRAS fechas) → rechazado por D3-c, nada cambia;
--   2) a D3ZZZ1 (MISMAS fechas, otros vuelos y horas) → sillas, vínculo y
--      tramos del contrato pasan a X en la misma transacción.
-- Importes sin cambios. Termina en ROLLBACK: no deja nada.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
\pset pager off
begin;
set local client_min_messages = warning;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000d003', 'd3@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'D3 Control'
 where id = '00000000-0000-0000-0000-00000000d003';
insert into public.destinos (nombre) values ('D3 SAN ANDRES');
insert into public.proveedores (nombre) values ('D3 AEROLINEA SAS');

-- Y: salida original. X: misma ruta y proveedor, OTRA fecha y otros vuelos/horas.
insert into public.bloqueos_vuelo (record, aerolinea, ruta, destino_id, proveedor_id,
  fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg,
  tarifa_neta, tarifa_para_empaquetar, cupos_total)
select v.record, 'AVIANCA', 'BOG-ADZ', d.id, p.id, v.ida, v.reg, v.vi, v.vr, v.hsi, v.hli, v.hsr, v.hlr, v.neta, v.emp, 4
  from (values
    ('D3YYY1', current_date + 40, current_date + 44, 'AV9301', 'AV9302', '06:00'::time, '07:55'::time, '18:10'::time, '20:05'::time, 400000, 480000),
    ('D3XXX1', current_date + 47, current_date + 51, 'AV9451', 'AV9452', '10:30'::time, '12:25'::time, '14:40'::time, '16:35'::time, 400000, 480000),
    ('D3ZZZ1', current_date + 40, current_date + 44, 'AV9601', 'AV9602', '11:15'::time, '13:10'::time, '16:20'::time, '18:15'::time, 400000, 480000)
  ) v(record, ida, reg, vi, vr, hsi, hli, hsr, hlr, neta, emp),
  public.destinos d, public.proveedores p
 where d.nombre = 'D3 SAN ANDRES' and p.nombre = 'D3 AEROLINEA SAS';
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 4) g where b.record in ('D3YYY1', 'D3XXX1', 'D3ZZZ1');

-- Contrato DTM-9970: 2 pax en Y, tal como lo deja la reserva.
insert into public.ventas (numero_contrato, cliente, tenant, destino, pax, aerolinea, fecha_salida, fecha_regreso,
  costo_aereo, precio_venta, bloqueo_ref_id)
select 'DTM-9970', 'CLIENTE DE EJEMPLO', 'mayorista', 'SAN ANDRES', 2, b.aerolinea, b.fecha_ida, b.fecha_regreso,
       b.tarifa_neta * 2, 3200000, b.id
  from public.bloqueos_vuelo b where b.record = 'D3YYY1';
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo,
  numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden)
select 'DTM-9970', b.aerolinea, b.record, t.dir, t.o, t.d, t.vuelo, t.hs, t.hl, t.f, t.ord
  from public.bloqueos_vuelo b,
  lateral (values ('ida', 'BOG', 'ADZ', b.vuelo_ida, b.hora_salida_ida, b.hora_llegada_ida, b.fecha_ida, 0),
                  ('regreso', 'ADZ', 'BOG', b.vuelo_regreso, b.hora_salida_reg, b.hora_llegada_reg, b.fecha_regreso, 1)
          ) t(dir, o, d, vuelo, hs, hl, f, ord)
 where b.record = 'D3YYY1';
insert into public.contrato_hoteles (numero_contrato, nombre, fecha_ingreso, fecha_salida)
select 'DTM-9970', 'HOTEL DE EJEMPLO', b.fecha_ida, b.fecha_regreso from public.bloqueos_vuelo b where b.record = 'D3YYY1';
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant)
values ('DTM-9970', 'D3 AEROLINEA SAS', 'aereo', 'Aéreo AVIANCA', 800000, 'mayorista');
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9970', pasajero_nombres = 'PAX ' || numero_silla, numero_doc = '10' || numero_silla
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'D3YYY1') and numero_silla in (1, 2);

-- Mover con su cupo (modo B) a X.
set local role authenticated;
\o /dev/null
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d003', 'role', 'authenticated')::text, true);
\o
\echo '== 1) Mover con su cupo a D3XXX1 (otras fechas): D3-c lo rechaza =='
do $$ begin
  perform public.mover_pasajero(
    (select id from public.sillas where numero_contrato = 'DTM-9970' order by numero_silla limit 1),
    (select id from public.bloqueos_vuelo where record = 'D3XXX1'),
    'con_cupo', false, 'cambio de fecha', gen_random_uuid());
  raise warning 'NO se rechazó (inesperado)';
exception when others then raise warning 'Rechazado: %', sqlerrm;
end $$;
\echo '== 2) Mover con su cupo a D3ZZZ1 (mismas fechas, otros vuelos) =='
select public.mover_pasajero(
  (select id from public.sillas where numero_contrato = 'DTM-9970' order by numero_silla limit 1),
  (select id from public.bloqueos_vuelo where record = 'D3ZZZ1'),
  'con_cupo', false, 'cambio de vuelo', gen_random_uuid()) as resultado;
reset role;

\echo '== Comparación: qué dice el contrato vs. el record donde realmente viajan =='
with y as (select * from public.bloqueos_vuelo where record = 'D3YYY1'),
     x as (select * from public.bloqueos_vuelo where record = 'D3ZZZ1'),
     v as (select * from public.ventas where numero_contrato = 'DTM-9970'),
     ida as (select * from public.contrato_vuelos where numero_contrato = 'DTM-9970' and direccion = 'ida'),
     reg as (select * from public.contrato_vuelos where numero_contrato = 'DTM-9970' and direccion = 'regreso')
select campo, record_y as "Y (origen)", record_x as "X (donde viajan)", contrato as "Contrato hoy",
       case when record_y is not distinct from record_x then 'igual en Y y X'
            when contrato is not distinct from record_x then 'ya apunta a X'
            when contrato is not distinct from record_y then 'SIGUE EN Y'
            else 'otro' end as estado
from (
  select 1::numeric o, 'sillas del contrato (record)' campo, (select record from y) record_y, (select record from x) record_x,
         (select string_agg(distinct b.record, ',') from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where s.numero_contrato = 'DTM-9970') contrato
  union all select 2, 'ventas.bloqueo_ref_id', (select id::text from y), (select id::text from x), (select bloqueo_ref_id::text from v)
  union all select 3, 'contrato_vuelos.record (PNR en el documento)', (select record from y), (select record from x), (select record from ida)
  union all select 4, 'ida: número de vuelo', (select vuelo_ida from y), (select vuelo_ida from x), (select numero_vuelo from ida)
  union all select 5, 'ida: fecha', (select fecha_ida::text from y), (select fecha_ida::text from x), (select fecha_salida::text from ida)
  union all select 6, 'ida: hora salida', (select hora_salida_ida::text from y), (select hora_salida_ida::text from x), (select hora_salida::text from ida)
  union all select 7, 'regreso: número de vuelo', (select vuelo_regreso from y), (select vuelo_regreso from x), (select numero_vuelo from reg)
  union all select 8, 'regreso: fecha', (select fecha_regreso::text from y), (select fecha_regreso::text from x), (select fecha_salida::text from reg)
  union all select 9, 'ventas.fecha_salida / fecha_regreso', (select fecha_ida || ' / ' || fecha_regreso from y), (select fecha_ida || ' / ' || fecha_regreso from x), (select fecha_salida || ' / ' || fecha_regreso from v)
  union all select 9.5, 'contrato_hoteles: ingreso / salida', (select fecha_ida || ' / ' || fecha_regreso from y), (select fecha_ida || ' / ' || fecha_regreso from x),
         (select fecha_ingreso || ' / ' || fecha_salida from public.contrato_hoteles where numero_contrato = 'DTM-9970')
  union all select 10, 'ventas.costo_aereo (tarifa neta × 2)', (select (tarifa_neta * 2)::numeric(14,2)::text from y), (select (tarifa_neta * 2)::numeric(14,2)::text from x), (select costo_aereo::numeric(14,2)::text from v)
  union all select 11, 'CxP aérea (valor_total)', (select (tarifa_neta * 2)::numeric(14,2)::text from y), (select (tarifa_neta * 2)::numeric(14,2)::text from x), (select valor_total::numeric(14,2)::text from public.cuentas_por_pagar where numero_contrato = 'DTM-9970' and tipo_proveedor = 'aereo')
) t order by o;

\echo '== Cupos e historial =='
select b.record, b.cupos_total,
       (select count(*) from public.sillas s where s.bloqueo_id = b.id and s.estado::text not in ('cambio','retirada')) as cupos_activos,
       (select count(*) from public.movimientos_silla m where b.id in (m.bloqueo_origen_id, m.bloqueo_destino_id)) as movimientos_historicos
  from public.bloqueos_vuelo b where b.record in ('D3YYY1', 'D3XXX1', 'D3ZZZ1') order by b.record desc;

rollback;
