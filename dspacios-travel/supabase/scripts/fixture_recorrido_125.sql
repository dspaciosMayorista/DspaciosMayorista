-- Datos del recorrido REAL de #125 (promociones que siguen la base ganadora + un niño gratis por habitación). Base desechable clonada de plantilla304 + migraciones 303–306 y 310.
-- INTEGRADO: la migración 311 (O3) elimina los valores por defecto de las edades del hotel; cada hotel del fixture declara explícitamente 0–2 infante y 2–10 niño (los antiguos defaults).
-- Todo en COP, markup 20 % (pct_mk 0.2), paquetes de porción terrestre con viaje 2026-12-01..2027-01-31. Usuarios: operaciones y venta (mayorista) + aliados del catálogo.
-- Cuentas a mano de cada escenario: ver recorrido_125.mjs.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000012501', 't125-oper@x.test'),
  ('00000000-0000-4000-8000-000000012502', 't125-venta@x.test')
on conflict do nothing;
insert into auth.sessions (id, user_id) values
  ('00000000-0000-4000-8000-00000000b501', '00000000-0000-4000-8000-000000012501'),
  ('00000000-0000-4000-8000-00000000b502', '00000000-0000-4000-8000-000000012502')
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, tenant, activo) values
  ('00000000-0000-4000-8000-000000012501', 't125-oper@x.test',  'T125 Operaciones', 'operaciones', 'mayorista', true),
  ('00000000-0000-4000-8000-000000012502', 't125-venta@x.test', 'T125 Venta',       'venta',       'mayorista', true)
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, tenant = excluded.tenant, activo = excluded.activo;
insert into public.aliados (id, nombre, tipo, pct_comision, activo) values
  (12501, 'Viajes Aurora 125', 'agencia', 0.10, true)
on conflict (id) do nothing;
insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values
  ('COMISION_AGENCIA', 0.12, 'base_comisionable', 'Comisión agencia'), ('COMISION_FREELANCE', 0.11, 'base_comisionable', 'Comisión freelance')
on conflict (parametro) do nothing;

insert into public.destinos (id, nombre) values (12501, 'R125 DESTINO') on conflict (id) do nothing;
insert into public.categorias_habitacion (nombre) select 'Estandar' where not exists (select 1 from public.categorias_habitacion where nombre = 'Estandar');
insert into public.planes_alimentacion (codigo, nombre) select 'PAM', 'Pensión alimentación media' where not exists (select 1 from public.planes_alimentacion where codigo = 'PAM');
insert into public.proveedores (id, nombre) values (12501, 'Proveedor Hotel 125') on conflict (id) do nothing;

-- Un hotel + su paquete de porción (mismo id).
create or replace function pg_temp.hotel(p_id bigint, p_nombre text, p_ini date, p_fin date) returns void language plpgsql as $f$
begin
  insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values (p_id, 12501, p_nombre, 'persona', 'COP', 12501, 0, 2, 2, 10);
  insert into public.hotel_categorias (hotel_id, categoria_id) select p_id, id from public.categorias_habitacion where nombre = 'Estandar' limit 1;
  insert into public.hotel_regimenes (hotel_id, plan_id) select p_id, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
  insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
    values (p_id, p_nombre || ' (paquete)', 12501, p_ini, p_fin, 0.2, 'porcion_terrestre', 3, 'COP');
  insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (p_id, p_id, array['Estandar'], array['PAM']);
  -- Configuración de la habitación doble: 2 adultos, hasta 2 niños (Niño 1 y Niño 2) y hasta 2 infantes (sin ella el sistema no admite menores).
  insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (p_id, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
end $f$;
-- Vigencia + tarifa neta de una base (doble / niño 1 / niño 2 / infante por persona y noche).
create or replace function pg_temp.base(p_hotel bigint, p_vig bigint, p_nombre text, p_ini date, p_fin date, p_doble numeric, p_nino numeric, p_nino2 numeric, p_inf numeric) returns void language plpgsql as $f$
begin
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (p_vig, p_hotel, p_nombre, p_ini, p_fin, 1, 'tarifa');
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_nino, neto_nino2, neto_infante) values (p_hotel, 'Estandar', 'PAM', p_nombre, p_doble, p_nino, p_nino2, p_inf);
end $f$;
-- Promoción que SIGUE la base ganadora con niño gratis (la fila de la vigencia con sus banderas primero, luego su regla; sin marca de «promoción nueva» no hay coincidencias que decidir).
create or replace function pg_temp.sigue(p_hotel bigint, p_vig bigint, p_nombre text, p_ini date, p_fin date, p_emin int, p_emax int) returns void language plpgsql as $f$
begin
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, promo_sigue_base, nino_gratis, nino_gratis_edad_min, nino_gratis_edad_max)
    values (p_vig, p_hotel, p_nombre, p_ini, p_fin, 5, 'descuento_pct', 10, true, true, p_emin, p_emax);
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (p_vig, null, 10, null);
end $f$;

-- H1 «R125 SIGUE»: BASE A 1–5 dic (100.000 / 50.000 / 40.000 / 20.000), BASE B 6–12 dic (150.000 / 75.000 / 60.000 / 30.000), PRE BF 4–8 dic −10 % + niño gratis.
select pg_temp.hotel(126001, 'R125 SIGUE', '2026-12-01', '2026-12-31');
select pg_temp.base(126001, 12600101, 'BASE A', '2026-12-01', '2026-12-05', 100000, 50000, 40000, 20000);
select pg_temp.base(126001, 12600102, 'BASE B', '2026-12-06', '2026-12-12', 150000, 75000, 60000, 30000);
select pg_temp.sigue(126001, 12600103, 'PRE BF', '2026-12-04', '2026-12-08', null, null);

-- H1b «R125 SIGUE 2 HAB»: igual que H1 pero con chd_min = 1 por habitación doble (así dos niños en dos habitaciones caen UNO por habitación).
select pg_temp.hotel(126007, 'R125 SIGUE 2 HAB', '2026-12-01', '2026-12-31');
select pg_temp.base(126007, 12600701, 'BASE A', '2026-12-01', '2026-12-05', 100000, 50000, 40000, 20000);
select pg_temp.base(126007, 12600702, 'BASE B', '2026-12-06', '2026-12-12', 150000, 75000, 60000, 30000);
select pg_temp.sigue(126007, 12600703, 'PRE BF', '2026-12-04', '2026-12-08', null, null);
update public.hotel_acomodaciones set chd_min = 1 where hotel_id = 126007 and acomodacion = 'doble';

-- H2 «R125 ESTADIA» (F1, noche gratis «promedio»): BASE X 1–12 dic (200.000 / 100.000 / 80.000); promoción con niño gratis 5–12 dic; promoción de estadía NOCHE GRATIS (prioridad 4, mín. 2 noches).
select pg_temp.hotel(126002, 'R125 ESTADIA', '2026-12-01', '2026-12-31');
select pg_temp.base(126002, 12600201, 'BASE X', '2026-12-01', '2026-12-12', 200000, 100000, 80000, 40000);
select pg_temp.sigue(126002, 12600202, 'SIGUE X', '2026-12-05', '2026-12-12', null, null);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, min_noches) values
  (12600203, 126002, 'NOCHE GRATIS', '2026-12-01', '2026-12-12', 4, 'promo_noche_gratis', 2);
-- H2b: noche gratis elegida «ultima» (todos los días); promoción con niño gratis todo el rango.
select pg_temp.hotel(126005, 'R125 ESTADIA ULTIMA', '2026-12-01', '2026-12-31');
select pg_temp.base(126005, 12600501, 'BASE X', '2026-12-01', '2026-12-12', 200000, 100000, 80000, 40000);
select pg_temp.sigue(126005, 12600502, 'SIGUE X', '2026-12-01', '2026-12-12', null, null);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, min_noches, noche_gratis_regla, dias_promo) values
  (12600503, 126005, 'NOCHE GRATIS', '2026-12-01', '2026-12-12', 4, 'promo_noche_gratis', 2, 'ultima', array[1,2,3,4,5,6,7]::smallint[]);
-- H2c: monto fijo por persona de la estadía (30.000).
select pg_temp.hotel(126006, 'R125 ESTADIA MONTO', '2026-12-01', '2026-12-31');
select pg_temp.base(126006, 12600601, 'BASE X', '2026-12-01', '2026-12-12', 200000, 100000, 80000, 40000);
select pg_temp.sigue(126006, 12600602, 'SIGUE X', '2026-12-01', '2026-12-12', null, null);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, descuento_unidad, dias_promo) values
  (12600603, 126006, 'MONTO ESTADIA', '2026-12-01', '2026-12-12', 4, 'descuento_monto', 30000, 'persona_estadia', array[1,2,3,4,5,6,7]::smallint[]);

-- H3 «R125 EDAD» (F2/F4): como H1, pero el niño gratis es solo de 3 a 6 años.
select pg_temp.hotel(126003, 'R125 EDAD', '2026-12-01', '2026-12-31');
select pg_temp.base(126003, 12600301, 'BASE A', '2026-12-01', '2026-12-05', 100000, 50000, 40000, 20000);
update public.tarifa_hotel set notas = 'NOTA R125 no reembolsable' where hotel_id = 126003 and temporada = 'BASE A';
select pg_temp.base(126003, 12600302, 'BASE B', '2026-12-06', '2026-12-12', 150000, 75000, 60000, 30000);
select pg_temp.sigue(126003, 12600303, 'PRE BF', '2026-12-04', '2026-12-08', 3, 6);

-- H4 «R125 EBB»: enero de 2027 (EBB exige ≥ 30 días de anticipación); como H2 (noche gratis «promedio») + EBB 12 %.
select pg_temp.hotel(126004, 'R125 EBB', '2027-01-01', '2027-01-31');
select pg_temp.base(126004, 12600401, 'BASE E', '2027-01-01', '2027-01-31', 200000, 100000, 80000, 40000);
insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (126004, 'ebb', 30, 12, true);
-- La promoción nace con su marca de «nueva» (301): coincide con EBB ⇒ queda PENDIENTE hasta que el recorrido la configure con la acción de la ficha.
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, promo_sigue_base, nino_gratis) values
  (12600402, 126004, 'SIGUE E', '2027-01-01', '2027-01-31', 5, 'descuento_pct', 10, true, true);
begin;
select set_config('app.e5_promocion_nueva', '12600402', true);
insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (12600402, null, 10, null);
commit;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, min_noches) values
  (12600403, 126004, 'NOCHE GRATIS', '2027-01-01', '2027-01-31', 4, 'promo_noche_gratis', 2);

-- H5 «R125 TRM USD» (S7, F4): hotel en USD, paquete DINÁMICO en modo cop_trm_63 (oferta en COP, TRM 4.000, markup 20 %), salida manual MDE-MIA con tiquete 400.000 COP por adulto.
-- BASE T 1–12 dic: doble 100 USD / niño 50 / niño 2 40 / infante 20 por persona y noche; promoción que sigue la base −10 % con niño gratis (1–12 dic).
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values (126008, 12501, 'R125 TRM USD', 'persona', 'USD', 12501, 0, 2, 2, 10);
insert into public.hotel_categorias (hotel_id, categoria_id) select 126008, id from public.categorias_habitacion where nombre = 'Estandar' limit 1;
insert into public.hotel_regimenes (hotel_id, plan_id) select 126008, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (126008, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
select pg_temp.base(126008, 12600801, 'BASE T', '2026-12-01', '2026-12-12', 100, 50, 40, 20);
select pg_temp.sigue(126008, 12600802, 'SIGUE T', '2026-12-01', '2026-12-12', null, null);
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion, modo_oferta, trm_oferta, impuesto_tipo, impuesto_fijo)
  values (126008, 'R125 TRM (paquete)', 12501, '2026-12-01', '2026-12-31', 0.2, 'dinamico', 3, 'COP', 'cop_trm_63', 4000, 'fijo', 0);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (126008, 126008, array['Estandar'], array['PAM']);
insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, moneda, activo)
  values (12600801, 126008, 'R125 Air', 'MDE - MIA - MDE', 'MDE', '2026-12-04', '2026-12-07', 400000, true, 0, 50000, 'COP', true);

-- ═══ S9 (re-auditoría R1/R2): el MISMO niño recibe alojamiento gratis de DOS promociones SUCESIVAS (cada una cubre UNA noche, misma prioridad, sin solaparse ⇒ sin empate). ═══
-- Hotel + paquete con markup configurable (pg_temp.hotel de arriba fija 0,2).
create or replace function pg_temp.hotelmk(p_id bigint, p_nombre text, p_ini date, p_fin date, p_mk numeric) returns void language plpgsql as $f$
begin
  insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values (p_id, 12501, p_nombre, 'persona', 'COP', 12501, 0, 2, 2, 10);
  insert into public.hotel_categorias (hotel_id, categoria_id) select p_id, id from public.categorias_habitacion where nombre = 'Estandar' limit 1;
  insert into public.hotel_regimenes (hotel_id, plan_id) select p_id, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
  insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
    values (p_id, p_nombre || ' (paquete)', 12501, p_ini, p_fin, p_mk, 'porcion_terrestre', 3, 'COP');
  insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (p_id, p_id, array['Estandar'], array['PAM']);
  insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (p_id, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
end $f$;
-- Hotel + paquete DINÁMICO en modo cop_trm_63 (TRM 4.000, markup 20 %) con una salida manual de tiquete 400.000 COP por adulto; moneda del hotel y de publicación configurables.
create or replace function pg_temp.hotel_din(p_id bigint, p_nombre text, p_moneda text, p_ini date, p_fin date, p_salida bigint, p_regreso date) returns void language plpgsql as $f$
begin
  insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values (p_id, 12501, p_nombre, 'persona', p_moneda, 12501, 0, 2, 2, 10);
  insert into public.hotel_categorias (hotel_id, categoria_id) select p_id, id from public.categorias_habitacion where nombre = 'Estandar' limit 1;
  insert into public.hotel_regimenes (hotel_id, plan_id) select p_id, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
  insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (p_id, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
  insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion, modo_oferta, trm_oferta, impuesto_tipo, impuesto_fijo)
    values (p_id, p_nombre || ' (paquete)', 12501, p_ini, p_fin, 0.2, 'dinamico', 3, p_moneda, 'cop_trm_63', 4000, 'fijo', 0);
  insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (p_id, p_id, array['Estandar'], array['PAM']);
  insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, moneda, activo)
    values (p_salida, p_id, 'R125 Air', 'MDE - MIA - MDE', 'MDE', p_ini + 3, p_regreso, 400000, true, 0, 50000, 'COP', true);
end $f$;

-- H6 «R125 SUCESIVAS» (S9a/S9b): markup 0. BASE S 1–12 dic: doble 100.000 / niño 56.000 / niño 2 40.000 por persona y noche; «S9 UNO» solo la noche del 4-dic y «S9 DOS» solo la del 5-dic (−10 % + niño gratis, sin rango de edad).
select pg_temp.hotelmk(126011, 'R125 SUCESIVAS', '2026-12-01', '2026-12-31', 0);
select pg_temp.base(126011, 12601101, 'BASE S', '2026-12-01', '2026-12-12', 100000, 56000, 40000, 0);
select pg_temp.sigue(126011, 12601102, 'S9 UNO', '2026-12-04', '2026-12-04', null, null);
select pg_temp.sigue(126011, 12601103, 'S9 DOS', '2026-12-05', '2026-12-05', null, null);

-- H7 «R125 SUCESIVAS EDAD» (S9c): markup 20 %. Mismas tarifas; «S9 EDAD UNO» (4-dic) solo niños de 3 a 6 años y «S9 EDAD DOS» (5-dic) solo de 7 a 10.
select pg_temp.hotelmk(126012, 'R125 SUCESIVAS EDAD', '2026-12-01', '2026-12-31', 0.2);
select pg_temp.base(126012, 12601201, 'BASE S', '2026-12-01', '2026-12-12', 100000, 56000, 40000, 0);
select pg_temp.sigue(126012, 12601202, 'S9 EDAD UNO', '2026-12-04', '2026-12-04', 3, 6);
select pg_temp.sigue(126012, 12601203, 'S9 EDAD DOS', '2026-12-05', '2026-12-05', 7, 10);

-- H8 «R125 SUC PARCIAL» (S9d): paquete DINÁMICO (COP, TRM 4.000, markup 20 %) con tiquete 400.000 COP; salida 4 → 7 dic (3 noches): noche 4 «S9 P UNO», noche 5 «S9 P DOS», noche 6 SIN promoción.
select pg_temp.hotel_din(126014, 'R125 SUC PARCIAL', 'COP', '2026-12-01', '2026-12-31', 12601401, '2026-12-07');
select pg_temp.base(126014, 12601401, 'BASE S', '2026-12-01', '2026-12-12', 100000, 56000, 40000, 0);
select pg_temp.sigue(126014, 12601402, 'S9 P UNO', '2026-12-04', '2026-12-04', null, null);
select pg_temp.sigue(126014, 12601403, 'S9 P DOS', '2026-12-05', '2026-12-05', null, null);

-- H9 «R125 SUC USD» (S9e): paquete DINÁMICO con oferta en USD (moneda_publicacion USD, TRM 4.000 para el tiquete en COP), hotel en USD; salida 4 → 6 dic (2 noches).
-- BASE: doble 100 USD, niño 33,33 USD (⇒ el neto del niño tiene centavos), niño 2 26 USD por persona y noche; «S9 USD UNO» (4-dic) y «S9 USD DOS» (5-dic): −10 % + niño gratis.
select pg_temp.hotel_din(126015, 'R125 SUC USD', 'USD', '2026-12-01', '2026-12-31', 12601501, '2026-12-06');
select pg_temp.base(126015, 12601501, 'BASE S', '2026-12-01', '2026-12-12', 100, 33.33, 26, 0);
select pg_temp.sigue(126015, 12601502, 'S9 USD UNO', '2026-12-04', '2026-12-04', null, null);
select pg_temp.sigue(126015, 12601503, 'S9 USD DOS', '2026-12-05', '2026-12-05', null, null);
