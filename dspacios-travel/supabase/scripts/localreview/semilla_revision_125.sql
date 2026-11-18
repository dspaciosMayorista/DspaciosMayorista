-- REVISIÓN CONSOLIDADA — semilla SINTÉTICA de #125 (promociones que siguen la base ganadora + un niño gratis por habitación). Solo la base local rev_revision.
-- ADITIVA: solo toca los ids 9125xx que crea aquí (hoteles, vigencias, tarifas, calculadoras, paquetes); NO borra ni modifica ningún otro dato de la revisión.
-- SE CARGA UNA SOLA VEZ: borra y recrea SUS PROPIOS ids para poder rehacerse sobre una base limpia, así que con los ejemplos ya creados (contratos y cotizaciones que referencian los paquetes 912503/912504) falla por
-- llaves foráneas y revierte (nada se corrompe). `localreview.ps1 ampliar125` y `preparar` ya lo saltan cuando los cuatro hoteles existen.
-- Requiere la migración 310 (columnas promo_sigue_base / nino_gratis…) y la 311 (edades del hotel sin default: cada hotel las declara explícitamente).
--
-- H1 912501 «Hotel PRE BF 125» — para configurar en pantalla: BASE A (1–5 dic 2026, doble 100.000) y BASE B (6–12 dic, doble 150.000), promoción «PRE BF» (4–8 dic, −10 %, prioridad 5)
--    SIN el modo nuevo: cruza dos bases, así que la calculadora Mixta la rechaza con «cruza varias temporadas base» y ofrece «Calcular por noche sobre la base ganadora».
-- H2 912502 «Hotel un solo tramo 125» — compatibilidad: BASE C (1–12 dic) y PROMO UNICA (2–4 dic, −10 %, una sola base): se comporta exactamente como siempre.
-- H3 912503 «Hotel PRE BF 125 ACTIVO» — igual que H1 pero «PRE BF» ya sigue la base ganadora y concede un niño gratis por habitación (sin edad propia: rige la edad del hotel).
-- H4 912504 «Hotel noches sucesivas 125» — R1/R2: BASE (1–10 dic: doble 100.000 · Niño 1 56.000 · Niño 2 40.000), promoción UNO (4 dic) y promoción DOS (5 dic), −10 % y niño gratis cada una; markup 0.
-- Paquetes 912501, 912503 (markup 20 %) y 912504 (markup 0) de porción terrestre; el tarifario se publica con la acción REAL (localreview.ps1 ampliar125).
-- Valores esperados: ver docs/tecnico/pending-owner-local-review.md §3.9.
begin;
insert into public.destinos (nombre) select 'DEMO 125' where not exists (select 1 from public.destinos where nombre = 'DEMO 125');
insert into public.categorias_habitacion (nombre) select 'Estandar' where not exists (select 1 from public.categorias_habitacion where nombre = 'Estandar');
insert into public.planes_alimentacion (codigo, nombre) select 'PAM', 'Pensión alimentación media' where not exists (select 1 from public.planes_alimentacion where codigo = 'PAM');
insert into public.proveedores (id, nombre) values (912501, 'Proveedor Hotel 125') on conflict (id) do nothing;

-- Limpieza SOLO de lo propio (ids 9125xx) para poder volver a correrla.
delete from public.armado_hoteles where paquete_id in (912501, 912503, 912504);
delete from public.armado_paquetes where id in (912501, 912503, 912504);
delete from public.hotel_acomodaciones where hotel_id between 912501 and 912504;
delete from public.hotel_calculadora where hotel_id between 912501 and 912504;
delete from public.tarifa_hotel where hotel_id between 912501 and 912504;
delete from public.hotel_promocion_reglas where promocion_id in (select id from public.hotel_temporadas where hotel_id between 912501 and 912504);
delete from public.hotel_temporadas where hotel_id between 912501 and 912504;
delete from public.hotel_categorias where hotel_id between 912501 and 912504;
delete from public.hotel_regimenes where hotel_id between 912501 and 912504;
delete from public.hoteles where id between 912501 and 912504;

create or replace function pg_temp.hotel(p_id bigint, p_nombre text) returns void language plpgsql as $f$
begin
  insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
    select p_id, d.id, p_nombre, 'persona', 'COP', 912501, 0, 2, 2, 10 from public.destinos d where d.nombre = 'DEMO 125';
  insert into public.hotel_categorias (hotel_id, categoria_id) select p_id, id from public.categorias_habitacion where nombre = 'Estandar' limit 1;
  insert into public.hotel_regimenes (hotel_id, plan_id) select p_id, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
  -- Habitación doble: 2 adultos y hasta 2 niños (Niño 1 y Niño 2) + 2 infantes; sin ella el sistema no admite menores.
  insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (p_id, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
end $f$;
create or replace function pg_temp.base(p_hotel bigint, p_vig bigint, p_nombre text, p_ini date, p_fin date, p_sen numeric, p_doble numeric, p_nino numeric, p_nino2 numeric, p_inf numeric) returns void language plpgsql as $f$
begin
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (p_vig, p_hotel, p_nombre, p_ini, p_fin, 1, 'tarifa');
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values (p_hotel, 'Estandar', 'PAM', p_nombre, p_sen, p_doble, p_nino, p_nino2, p_inf);
end $f$;
-- Promoción que SIGUE la base ganadora con niño gratis (la vigencia con sus banderas primero, luego su regla del 10 %).
create or replace function pg_temp.sigue(p_hotel bigint, p_vig bigint, p_nombre text, p_ini date, p_fin date) returns void language plpgsql as $f$
begin
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, promo_sigue_base, nino_gratis)
    values (p_vig, p_hotel, p_nombre, p_ini, p_fin, 5, 'descuento_pct', 10, true, true);
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (p_vig, null, 10, null);
end $f$;
create or replace function pg_temp.paquete(p_id bigint, p_hotel bigint, p_nombre text, p_mk numeric) returns void language plpgsql as $f$
begin
  insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
    select p_id, p_nombre, d.id, '2026-12-01', '2026-12-31', p_mk, 'porcion_terrestre', 3, 'COP' from public.destinos d where d.nombre = 'DEMO 125';
  insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (p_id, p_hotel, array['Estandar'], array['PAM']);
end $f$;
-- Calculadora Mixta con los MISMOS valores (la vista previa de la calculadora los lee de aquí).
create or replace function pg_temp.mixta(p_hotel bigint, p_bases jsonb) returns void language plpgsql as $f$
begin
  insert into public.hotel_calculadora (hotel_id, tipo, params) values (p_hotel, 'mixta', jsonb_build_object(
    'regimen', 'PAM', 'iva_pct', 19,
    'acom', jsonb_build_object('sencilla', jsonb_build_object('modo','pax','iva',false), 'doble', jsonb_build_object('modo','pax','iva',false),
                               'triple', jsonb_build_object('modo','pax','iva',false), 'multiple', jsonb_build_object('modo','pax','iva',false)),
    'nino', jsonb_build_object('iva', false), 'pax', jsonb_build_object('sencilla',1,'doble',2,'triple',3,'multiple',4), 'bases', p_bases));
end $f$;

-- H1 + paquete 912501
select pg_temp.hotel(912501, 'Hotel PRE BF 125');
select pg_temp.base(912501, 91250101, 'BASE A', '2026-12-01', '2026-12-05', 120000, 100000, 50000, 40000, 20000);
select pg_temp.base(912501, 91250102, 'BASE B', '2026-12-06', '2026-12-12', 180000, 150000, 75000, 60000, 30000);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values (91250103, 912501, 'PRE BF', '2026-12-04', '2026-12-08', 5, 'descuento_pct', 10);
select pg_temp.paquete(912501, 912501, 'Paquete PRE BF 125 (configurar)', 0.2);
select pg_temp.mixta(912501, jsonb_build_array(
  jsonb_build_object('categoria','Estandar','temporada','BASE A','sencilla',120000,'doble',100000,'triple',95000,'multiple',90000,'nino',50000,'nino2',40000,'infante',20000),
  jsonb_build_object('categoria','Estandar','temporada','BASE B','sencilla',180000,'doble',150000,'triple',140000,'multiple',135000,'nino',75000,'nino2',60000,'infante',30000),
  jsonb_build_object('categoria','Estandar','temporada','PRE BF','sencilla',0,'doble',0,'triple',0,'multiple',0,'nino',0)));

-- H2 (compatibilidad; sin paquete: solo se mira en la calculadora)
select pg_temp.hotel(912502, 'Hotel un solo tramo 125');
select pg_temp.base(912502, 91250201, 'BASE C', '2026-12-01', '2026-12-12', 120000, 100000, 50000, 40000, 20000);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values (91250202, 912502, 'PROMO UNICA', '2026-12-02', '2026-12-04', 5, 'descuento_pct', 10);
select pg_temp.mixta(912502, jsonb_build_array(
  jsonb_build_object('categoria','Estandar','temporada','BASE C','sencilla',120000,'doble',100000,'triple',95000,'multiple',90000,'nino',50000,'nino2',40000,'infante',20000),
  jsonb_build_object('categoria','Estandar','temporada','PROMO UNICA','sencilla',0,'doble',0,'triple',0,'multiple',0,'nino',0)));

-- H3 + paquete 912503 (ya configurado: sigue la base ganadora + niño gratis)
select pg_temp.hotel(912503, 'Hotel PRE BF 125 ACTIVO');
select pg_temp.base(912503, 91250301, 'BASE A', '2026-12-01', '2026-12-05', 120000, 100000, 50000, 40000, 20000);
select pg_temp.base(912503, 91250302, 'BASE B', '2026-12-06', '2026-12-12', 180000, 150000, 75000, 60000, 30000);
select pg_temp.sigue(912503, 91250303, 'PRE BF', '2026-12-04', '2026-12-08');
select pg_temp.paquete(912503, 912503, 'Paquete PRE BF 125 ACTIVO', 0.2);

-- H4 + paquete 912504 (R1/R2: dos promociones sucesivas para el mismo niño; markup 0)
select pg_temp.hotel(912504, 'Hotel noches sucesivas 125');
select pg_temp.base(912504, 91250401, 'BASE', '2026-12-01', '2026-12-10', 120000, 100000, 56000, 40000, 20000);
select pg_temp.sigue(912504, 91250402, 'PROMO UNO', '2026-12-04', '2026-12-04');
select pg_temp.sigue(912504, 91250403, 'PROMO DOS', '2026-12-05', '2026-12-05');
select pg_temp.paquete(912504, 912504, 'Paquete noches sucesivas 125', 0);
commit;
