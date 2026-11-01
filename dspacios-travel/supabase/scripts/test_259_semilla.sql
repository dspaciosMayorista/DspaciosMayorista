-- Semilla de la prueba de la 259 (SOLO base local desechable). Forma del paquete 73: tipo bloqueo, 28 hoteles, 32 vuelos, tabla de ~16k filas vivas con ~1,5k muertas.
-- Cargas de prueba: 3.187 filas (paquete 33), 7.413 y 12.669 (paquete 73, 12.668 de bloqueo + ver nota), en la FORMA que arma generarTarifario.
\set ON_ERROR_STOP on

-- Entorno (no es esquema de la app): auth.uid() de la imagen lee el GUC legado; PostgREST entrega los claims en JSON, como Supabase real.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'prueba259@local.test') on conflict do nothing;
update public.usuarios set rol = 'superadmin', activo = true where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.armado_paquetes (id, nombre, tipo, activo) overriding system value select g, 'paquete ' || g, 'bloqueo'::public.tarifario_modulo, true from generate_series(1, 80) g;
insert into public.hoteles (id, destino_id, nombre) overriding system value select 2000 + g, 1, 'Hotel ' || g from generate_series(0, 27) g;
insert into public.bloqueos_vuelo (id, record, ruta) overriding system value select 3000 + g, 'REC' || g, 'BOG-CTG' from generate_series(0, 31) g;
insert into public.servicios_adicionales (id, nombre) overriding system value values (1, 'Asistencia médica') on conflict do nothing;

alter table public.tarifario_resultado set (autovacuum_enabled = false);
insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, hotel_id, hotel_nombre, destino_id, destino_nombre, categoria, regimen, acomodacion, noches, fecha_ida, fecha_regreso, base_comisionable, impuesto, precio_pvp, moneda, temporada_ganadora, es_promocion, precio_final_autoritativo, procedencia_temporadas, procedencia_mixta)
select 1 + i / 400, 'p', true, 'bloqueo', 3000 + i % 32, 2000 + i % 28, 'Hotel', 1, 'CARTAGENA', 'Cat ' || (i % 4), 'Plan ' || (i % 3), (array['sencilla','doble','triple','multiple','nino','nino2','infante'])[1 + i % 7]::public.acomodacion_tipo, 3, date '2026-12-01', date '2026-12-04', 1000000, 120000, 1200000, 'COP', 'ALTA', false, false, '[{"temporada":"ALTA","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb, false
from generate_series(0, 15999) i;
insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, destino_id, acomodacion, noches, base_comisionable, impuesto, precio_pvp, moneda, procedencia_mixta)
select 79, 'x', true, 'bloqueo', 2000, 1, 'doble', 3, 1, 1, 1, 'COP', false from generate_series(1, 1500);
delete from public.tarifario_resultado where paquete_id = 79;   -- ~1.500 tuplas muertas
analyze public.tarifario_resultado;

create or replace function public.bench_filas(n int, paquete bigint) returns jsonb language sql as $$
  select (select coalesce(jsonb_agg(jsonb_build_object(
    'paquete_id', paquete, 'paquete_nombre', 'Paquete de prueba ' || paquete, 'paquete_activo', true, 'modulo', 'bloqueo',
    'bloqueo_id', 3000 + (i / 400) % 32, 'bloqueo_label', 'BOG-CTG', 'empaquetado_id', null,
    'hotel_id', 2000 + (i % 700) / 7 % 28, 'hotel_nombre', 'Hotel de ejemplo número ' || ((i % 700) / 7 % 28),
    'destino_id', 1, 'destino_nombre', 'CARTAGENA',
    'categoria', 'Categoria ' || ((i % 700) / 7 % 4), 'regimen', 'Plan ' || ((i % 700) / 7 % 3),
    'acomodacion', (array['sencilla','doble','triple','multiple','nino','nino2','infante'])[1 + i % 7],
    'noches', 3, 'fecha_ida', '2026-12-01', 'fecha_regreso', '2026-12-04',
    'pax_desde', null, 'pax_hasta', null, 'tipo_tarifa', null, 'servicio_id', null, 'servicio_nombre', null,
    'base_comisionable', 1000000 + i, 'impuesto', 120000, 'precio_pvp', 1200000 + i, 'precio_pvp_menor2', case when i % 7 >= 4 then 300000 else null end,
    'precio_pvp_sin_fijo', null, 'precio_pvp_menor2_sin_fijo', null,
    'descripcion', null, 'recargo_individual', null, 'moneda', 'COP', 'salida_id', null,
    'temporada_ganadora', 'ALTA', 'es_promocion', false, 'precio_final_autoritativo', false,
    'procedencia_temporadas', jsonb_build_array(jsonb_build_object('temporada', 'ALTA', 'es_promocion', false, 'precio_final_autoritativo', false)),
    'procedencia_mixta', false) order by i), '[]'::jsonb)
  from generate_series(0, n - 2) i)
  || jsonb_build_array(jsonb_build_object(
    'paquete_id', paquete, 'paquete_nombre', 'Paquete de prueba ' || paquete, 'paquete_activo', true, 'modulo', 'servicios',
    'servicio_id', 1, 'servicio_nombre', 'Asistencia médica', 'destino_id', 1, 'destino_nombre', 'CARTAGENA', 'tipo_tarifa', 'persona',
    'base_comisionable', 50000, 'impuesto', 0, 'precio_pvp', 50000, 'precio_pvp_menor2', null, 'recargo_individual', 0, 'moneda', 'COP',
    'descripcion', null, 'fechas_disponibles', null, 'temporada_ganadora', null, 'es_promocion', null, 'precio_final_autoritativo', null,
    'procedencia_temporadas', null, 'procedencia_mixta', false))
$$;
create table public.bench_payload (n int primary key, filas jsonb, texto text);
insert into public.bench_payload select n, public.bench_filas(n, 73), null from unnest(array[3187, 7413, 12669, 22401]) n;
update public.bench_payload set texto = filas::text;
-- Mismo payload sin claves null (lo que envía la app desde la 259: compactarFilasPublicacion)
alter table public.bench_payload add column texto_c text;
update public.bench_payload set texto_c = (select jsonb_agg(jsonb_strip_nulls(e))::text from jsonb_array_elements(filas) e);
grant select on public.bench_payload to authenticated;
select n, pg_size_pretty(length(texto)::bigint) as cuerpo_json from public.bench_payload order by n;
