-- Semilla LOCAL (nunca producción) que reproduce el caso real de DTM-0057:
-- 3 pasajeros (uno infante con responsable, para ejercer el trigger de la 167),
-- 2 vuelos, 1 hotel, 1 ítem, 4 CxP con sus asientos automáticos; sin abonos,
-- sillas ni vouchers. Secuencia mayorista en last_value=57, is_called=true.
-- DTM-0056 y un contrato minorista quedan de control (no deben cambiar).
begin;
insert into public.ventas (numero_contrato, tenant, cliente, destino, fecha_salida, fecha_regreso, pax, precio_venta, estado, asesor)
values ('DTM-0056', 'mayorista', 'Cliente control', 'SAN ANDRES', current_date + 30, current_date + 34, 2, 3000000, 'activo', 'Asesor A'),
       ('DTM-0057', 'mayorista', 'Cliente real',    'CARTAGENA',  current_date + 45, current_date + 49, 3, 5400000, 'pendiente', 'Asesor B'),
       ('MIN-00-0100', 'minorista', 'Cliente minorista', 'MIAMI', current_date + 60, current_date + 65, 1, 2000000, 'activo', 'Asesor C');

insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, orden)
values ('DTM-0057', 'ADULTO UNO', 'CC', '1001', '1985-03-10', 1),
       ('DTM-0057', 'ADULTO DOS', 'CC', '1002', '1987-07-21', 2),
       ('DTM-0056', 'CONTROL',    'CC', '2001', '1980-01-01', 1);
insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, orden, responsable_id)
select 'DTM-0057', 'INFANTE', 'RC', '1003', current_date - 300, 3, id
  from public.contrato_pasajeros where numero_contrato = 'DTM-0057' and identificacion = '1001';

insert into public.contrato_vuelos (numero_contrato, aerolinea, origen_codigo, destino_codigo, fecha_salida, direccion, numero_vuelo, record)
values ('DTM-0057', 'AVIANCA', 'BOG', 'CTG', current_date + 45, 'ida', 'AV9500', 'XYZ123'),
       ('DTM-0057', 'AVIANCA', 'CTG', 'BOG', current_date + 49, 'regreso', 'AV9501', 'XYZ123'),
       ('DTM-0056', 'LATAM',   'BOG', 'ADZ', current_date + 30, 'ida', 'LA4000', 'ABC999');
insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, fecha_ingreso, fecha_salida)
values ('DTM-0057', 'HOTEL CARIBE', 'CARTAGENA', current_date + 45, current_date + 49),
       ('DTM-0056', 'HOTEL CONTROL', 'SAN ANDRES', current_date + 30, current_date + 34);
insert into public.contrato_items (numero_contrato, descripcion, adultos, tarifa_adulto)
values ('DTM-0057', 'PAQUETE CARTAGENA', 2, 2700000),
       ('DTM-0056', 'PAQUETE CONTROL', 2, 1500000);

insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant)
values ('DTM-0057', 'HOTEL CARIBE SAS', 'hotel',      'Hotel',      2000000, 'mayorista'),
       ('DTM-0057', 'AVIANCA',          'aereo',      'Aéreo',      1800000, 'mayorista'),
       ('DTM-0057', 'TRASLADOS CTG',    'receptivo',  'Traslados',   300000, 'mayorista'),
       ('DTM-0057', 'ASISTCARD',        'asistencia', 'Asistencia',  120000, 'mayorista'),
       ('DTM-0056', 'HOTEL CONTROL',    'hotel',      'Hotel',      1000000, 'mayorista');

-- Perfil de producción (preflight del 2026-10-02): 1 comisión B2B y 2
-- servicios del contrato.
insert into public.aliados_b2b (numero_contrato, aliado, tipo_aliado, precio_venta, base_comision, pct_comision, estado, tenant)
values ('DTM-0057', 'AGENCIA ALIADA', 'agencia', 5400000, 5000000, 0.10, 'pendiente', 'mayorista');
insert into public.contrato_servicios (numero_contrato, tipo, descripcion, proveedor, costo, orden)
values ('DTM-0057', 'traslado',   'Traslado aeropuerto - hotel - aeropuerto', 'TRASLADOS CTG', 300000, 1),
       ('DTM-0057', 'asistencia', 'Asistencia médica',                         'ASISTCARD',     120000, 2),
       ('DTM-0056', 'traslado',   'Traslado control',                          'CONTROL',        50000, 1);

-- Asientos automáticos de CxP, con el mismo formato que postearAsientoCxp().
with cxp as (select * from public.cuentas_por_pagar where numero_contrato in ('DTM-0056','DTM-0057')),
asi as (
  insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia)
  select 'mayorista', 1000 + row_number() over (order by id), current_date,
         servicio || ' — ' || proveedor || ' (' || numero_contrato || ')', 'cxp', 'cxp:' || id
    from cxp
  returning id, referencia)
insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
select 'mayorista', a.id, (select min(id) from public.puc_cuentas where tenant = 'mayorista'),
       x.tercero, c.servicio, x.debe, x.haber
  from asi a join cxp c on a.referencia = 'cxp:' || c.id
  cross join lateral (values (c.numero_contrato, c.valor_total, 0::numeric),
                             (c.proveedor, 0::numeric, c.valor_total)) x(tercero, debe, haber);

select setval('public.contrato_seq_mayorista', 57, true);
commit;
