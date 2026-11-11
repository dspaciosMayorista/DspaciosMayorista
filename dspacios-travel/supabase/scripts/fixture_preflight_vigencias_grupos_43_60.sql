-- Esquema MÍNIMO y datos SINTÉTICOS para probar preflight_vigencias_grupos_43_60_lectura.sql en una base LOCAL DESECHABLE.
-- No usar contra ninguna base real. Las fechas son relativas a current_date.
create or replace function public.fecha_negocio(p_instante timestamptz default now()) returns date language sql stable as $$ select (p_instante at time zone 'America/Bogota')::date $$;
create table public.hoteles (id bigint primary key, nombre text, modelo_tarifario text not null default 'persona', adults_only boolean not null default false);
create table public.categorias_habitacion (id bigserial primary key, nombre text unique);
create table public.planes_alimentacion (id bigserial primary key, codigo text unique);
create table public.hotel_categorias (hotel_id bigint, categoria_id bigint);
create table public.hotel_regimenes (hotel_id bigint, plan_id bigint);
create table public.hotel_acomodaciones (hotel_id bigint, acomodacion text, pax_tarifa int not null default 1, pax_max int not null default 1);
create table public.hotel_temporadas (id bigserial primary key, hotel_id bigint, nombre text not null, fecha_inicio date, fecha_fin date, prioridad int not null default 1,
  compra_inicio date, compra_fin date, tipo text not null default 'tarifa', descuento_valor numeric, rangos jsonb not null default '[]', blackouts jsonb not null default '[]', regimen_restringido text);
create table public.tarifa_hotel (id bigserial primary key, hotel_id bigint, tipo_habitacion text, alimentacion text, temporada text,
  neto_sencilla numeric, neto_doble numeric, neto_triple numeric, neto_multiple numeric, neto_nino numeric, neto_nino2 numeric,
  precio_final_autoritativo boolean not null default false, temporada_base text);

insert into categorias_habitacion(nombre) values ('Estándar');
insert into planes_alimentacion(codigo) values ('PAM');
insert into hoteles(id,nombre,modelo_tarifario) values (1,'rescate','persona'),(2,'empate','persona'),(3,'sin_fila','persona'),(4,'duplicado','persona'),
  (5,'unidad','unidad'),(6,'nombres','persona'),(7,'limpio','persona'),(8,'sin tarifa','persona'),(9,'acomodacion','persona'),(10,'sencilla sin doble','persona'),
  (11,'fechas invalidas','persona'),(12,'fuera de horizonte','persona');
insert into hotel_categorias select h, 1 from generate_series(1,12) h;
insert into hotel_regimenes select h, 1 from generate_series(1,12) h;

-- 1) rescate: PROMO-ALTA (p4) gana d+10..d+40; PUENTE (p3, d+20..d+22) es la base que gana esas 3 noches
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad,tipo,descuento_valor) values
 (1,'ALTA',current_date+10,current_date+40,1,'tarifa',null),(1,'PUENTE',current_date+20,current_date+22,3,'tarifa',null),(1,'PROMO-ALTA',current_date+10,current_date+40,4,'descuento_pct',10);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble,precio_final_autoritativo,temporada_base) values
 (1,'Estándar','PAM','ALTA',100000,false,null),(1,'Estándar','PAM','PUENTE',200000,false,null),(1,'Estándar','PAM','PROMO-ALTA',90000,true,'ALTA');

-- 2) empate (5 noches) + triple deshabilitada por configuración
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad) values (2,'TEMP-A',current_date+5,current_date+9,1),(2,'TEMP-B',current_date+5,current_date+9,1);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble) values (2,'Estándar','PAM','TEMP-A',100000),(2,'Estándar','PAM','TEMP-B',150000);
insert into hotel_acomodaciones values (2,'triple',0,0);

-- 3) PUENTE (p3, d+3..d+5) sin fila: 3 noches caen a ALTA (control 7); SOLA (d+20..d+21) sin fila y sin nadie más: 2 noches (control 8)
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad) values (3,'ALTA',current_date+1,current_date+10,1),(3,'PUENTE',current_date+3,current_date+5,3),(3,'SOLA',current_date+20,current_date+21,1);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble) values (3,'Estándar','PAM','ALTA',100000);

-- 4) duplicado exacto (2 filas) y variantes solo tras recortar espacios
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin) values (4,'ALTA',current_date+1,current_date+10);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble) values (4,'Estándar','PAM','ALTA',100000),(4,'Estándar','PAM','ALTA',110000),(4,'Estándar','PAM','ALTA ',120000),(4,'Estándar','PAM ','ALTA',130000);

-- 5) unidad con cruce de vigencias (4 noches)
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad) values (5,'U1',current_date+1,current_date+10,1),(5,'U2',current_date+7,current_date+12,2);

-- 6) nombre repetido en dos filas
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin) values (6,'ALTA',current_date+1,current_date+5),(6,'ALTA',current_date+30,current_date+35);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble) values (6,'Estándar','PAM','ALTA',100000);

-- 7) limpio: rangos múltiples + blackout + vigencia de compra vencida (no cuenta) + promoción escrita a mano (control 14)
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,rangos,blackouts) values
 (7,'ALTA',current_date+1,current_date+30,
  jsonb_build_array(jsonb_build_object('fecha_inicio',(current_date+1)::text,'fecha_fin',(current_date+10)::text), jsonb_build_object('fecha_inicio',(current_date+20)::text,'fecha_fin',(current_date+30)::text)),
  jsonb_build_array(jsonb_build_object('fecha_inicio',(current_date+22)::text,'fecha_fin',(current_date+23)::text)));
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad,compra_fin) values (7,'VIEJA',current_date+1,current_date+30,9,current_date-3);
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad,tipo,descuento_valor) values (7,'PROMO-MANUAL',current_date+1,current_date+5,2,'descuento_pct',5);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble) values (7,'Estándar','PAM','ALTA',100000),(7,'Estándar','PAM','PROMO-MANUAL',95000);

-- 8) combinación configurada sin ninguna tarifa (control 13): solo configuración
-- 9) ACOMODACIÓN: sencilla con precio en ALTA y PUENTE; doble con precio solo en ALTA (PUENTE tiene fila pero sin doble) -> control 7 con 3 noches (doble);
--    triple habilitada y sin precio en ninguna vigencia -> control 9
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad) values (9,'ALTA',current_date+1,current_date+10,1),(9,'PUENTE',current_date+3,current_date+5,3);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_sencilla,neto_doble) values (9,'Estándar','PAM','ALTA',100000,150000);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_sencilla) values (9,'Estándar','PAM','PUENTE',200000);
insert into hotel_acomodaciones values (9,'doble',2,2),(9,'triple',3,3);

-- 10) CASO PEDIDO: sencilla con precio y doble habilitada SIN precio en ninguna vigencia -> control 9 (doble)
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad) values (10,'ALTA',current_date+1,current_date+10,1);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_sencilla) values (10,'Estándar','PAM','ALTA',100000);
insert into hotel_acomodaciones values (10,'doble',2,2);

-- 11) FECHAS INVÁLIDAS (compra vigente): día inexistente, inicio > fin, elemento no objeto, objeto incompleto, blackout con mes 13
--     + una vigencia VÁLIDA con precio (para que el hotel tenga combinación vendida)
--     + una vigencia con compra CERRADA y fecha inválida (cuenta en el control 3, no en el 4)
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad,rangos,blackouts) values
 (11,'FEB',null,null,2,
  '[{"fecha_inicio":"2027-02-30","fecha_fin":"2027-03-05"},{"fecha_inicio":"2027-05-01","fecha_fin":"2027-04-01"},"abc",{"fecha_inicio":"x"}]'::jsonb,
  '[{"fecha_inicio":"2027-13-01","fecha_fin":"2027-13-02"}]'::jsonb);
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad) values (11,'ALTA',current_date+1,current_date+10,1);
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin,prioridad,compra_fin,rangos) values
 (11,'VIEJA-INVALIDA',null,null,1,current_date-3,'[{"fecha_inicio":"2026-02-29","fecha_fin":"2026-03-05"}]'::jsonb);
insert into tarifa_hotel(hotel_id,tipo_habitacion,alimentacion,temporada,neto_doble) values (11,'Estándar','PAM','ALTA',100000);

-- 12) vigencia con noches más allá del horizonte (control 12)
insert into hotel_temporadas(hotel_id,nombre,fecha_inicio,fecha_fin) values (12,'LARGA',current_date+300,current_date+400);
