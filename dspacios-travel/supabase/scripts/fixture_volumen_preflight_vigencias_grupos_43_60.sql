-- Datos SINTÉTICOS de VOLUMEN para medir preflight_vigencias_grupos_43_60_lectura.sql en una base LOCAL DESECHABLE.
-- No usar contra ninguna base real. Reproducible (semilla fija). Parámetros (psql -v):
--   hoteles (def. 300) · vigs (vigencias por hotel, def. 20) · cats (categorías por hotel, def. 5) · regs (regímenes por hotel, def. 3)
-- Requiere el esquema mínimo del fixture pequeño; se crea aquí si no existe.
\if :{?hoteles} \else \set hoteles 300 \endif
\if :{?vigs} \else \set vigs 20 \endif
\if :{?cats} \else \set cats 5 \endif
\if :{?regs} \else \set regs 3 \endif

create or replace function public.fecha_negocio(p_instante timestamptz default now()) returns date language sql stable as $$ select (p_instante at time zone 'America/Bogota')::date $$;
create table if not exists public.hoteles (id bigint primary key, nombre text, modelo_tarifario text not null default 'persona', adults_only boolean not null default false);
create table if not exists public.categorias_habitacion (id bigserial primary key, nombre text unique);
create table if not exists public.planes_alimentacion (id bigserial primary key, codigo text unique);
create table if not exists public.hotel_categorias (hotel_id bigint, categoria_id bigint);
create table if not exists public.hotel_regimenes (hotel_id bigint, plan_id bigint);
create table if not exists public.hotel_acomodaciones (hotel_id bigint, acomodacion text, pax_tarifa int not null default 1, pax_max int not null default 1);
create table if not exists public.hotel_temporadas (id bigserial primary key, hotel_id bigint, nombre text not null, fecha_inicio date, fecha_fin date, prioridad int not null default 1,
  compra_inicio date, compra_fin date, tipo text not null default 'tarifa', descuento_valor numeric, rangos jsonb not null default '[]', blackouts jsonb not null default '[]', regimen_restringido text);
create table if not exists public.tarifa_hotel (id bigserial primary key, hotel_id bigint, tipo_habitacion text, alimentacion text, temporada text,
  neto_sencilla numeric, neto_doble numeric, neto_triple numeric, neto_multiple numeric, neto_nino numeric, neto_nino2 numeric,
  precio_final_autoritativo boolean not null default false, temporada_base text);

select setseed(0.4243);
insert into categorias_habitacion(nombre) select 'Cat ' || g from generate_series(1, 12) g on conflict do nothing;
insert into planes_alimentacion(codigo) select unnest(array['PC','PAM','PAE','PA','FULL','SA']) on conflict do nothing;
insert into hoteles(id, nombre, modelo_tarifario, adults_only)
  select h, 'Hotel ' || h, case when h % 20 = 0 then 'unidad' else 'persona' end, h % 11 = 0 from generate_series(1, :hoteles) h;
insert into hotel_categorias select h, c from generate_series(1, :hoteles) h, generate_series(1, :cats) c;
insert into hotel_regimenes select h, r from generate_series(1, :hoteles) h, generate_series(1, :regs) r;
insert into hotel_acomodaciones select h, a, 2, 2 from generate_series(1, :hoteles) h, unnest(array['sencilla','doble','triple','multiple']) a where h % 3 = 0;

-- Vigencias: 70 % base, 22 % promoción (descuento_pct, prioridad 4, mismas fechas que su base), 5 % «N noches gratis»,
-- 3 % con la compra cerrada. Viaje: inicio entre hoy-30 y hoy+330, 7–60 días. 15 % con segundo rango, 10 % con blackout, 5 % con régimen restringido.
with base as (
  select h, v,
         current_date - 30 + (random() * 360)::int as ini,
         7 + (random() * 53)::int as largo,
         1 + (random() * 2)::int as prio,
         random() as r_tipo, random() as r_rangos, random() as r_black, random() as r_reg, random() as r_compra
  from generate_series(1, :hoteles) h, generate_series(1, :vigs) v
)
insert into hotel_temporadas(hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, compra_fin, tipo, descuento_valor, rangos, blackouts, regimen_restringido)
select h,
       case when r_tipo < 0.70 then 'T' || v when r_tipo < 0.92 then 'P' || v else 'G' || v end,
       ini, ini + largo,
       case when r_tipo < 0.70 then prio when r_tipo < 0.92 then 4 else 5 end,
       case when r_compra < 0.03 then current_date - 3 else null end,
       case when r_tipo < 0.70 then 'tarifa' when r_tipo < 0.92 then 'descuento_pct' else 'promo_noche_gratis' end,
       case when r_tipo >= 0.70 and r_tipo < 0.92 then 10 else null end,
       case when r_rangos < 0.15
            then jsonb_build_array(jsonb_build_object('fecha_inicio', ini::text, 'fecha_fin', (ini + largo)::text),
                                   jsonb_build_object('fecha_inicio', (ini + largo + 20)::text, 'fecha_fin', (ini + largo + 35)::text))
            else jsonb_build_array(jsonb_build_object('fecha_inicio', ini::text, 'fecha_fin', (ini + largo)::text)) end,
       case when r_black < 0.10 then jsonb_build_array(jsonb_build_object('fecha_inicio', (ini + 2)::text, 'fecha_fin', (ini + 4)::text)) else '[]'::jsonb end,
       case when r_reg < 0.05 then 'PAM' else null end
from base;

-- Tarifas: una fila por (vigencia con precio) × categoría × régimen. 3 % de las combinaciones no tiene fila; cada acomodación
-- falta con 10 % de probabilidad (niño 30 %). Las promociones llevan precio final y temporada_base = la base del mismo número.
insert into tarifa_hotel(hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, precio_final_autoritativo, temporada_base)
select t.hotel_id, 'Cat ' || c, (array['PC','PAM','PAE','PA','FULL','SA'])[r], t.nombre,
       case when random() < 0.9 then 100000 + (random() * 100000)::int end,
       case when random() < 0.9 then 80000 + (random() * 100000)::int end,
       case when random() < 0.9 then 70000 + (random() * 100000)::int end,
       case when random() < 0.9 then 60000 + (random() * 100000)::int end,
       case when random() < 0.7 then 30000 + (random() * 30000)::int end,
       case when random() < 0.7 then 20000 + (random() * 30000)::int end,
       t.tipo = 'descuento_pct',
       case when t.tipo = 'descuento_pct' then 'T' || substr(t.nombre, 2) end
from hotel_temporadas t
join hoteles h on h.id = t.hotel_id and h.modelo_tarifario = 'persona'
cross join generate_series(1, :cats) c cross join generate_series(1, :regs) r
where t.tipo <> 'promo_noche_gratis' and random() > 0.03;

analyze;
select 'hoteles' k, count(*) from hoteles union all select 'vigencias', count(*) from hotel_temporadas union all select 'tarifas', count(*) from tarifa_hotel;
