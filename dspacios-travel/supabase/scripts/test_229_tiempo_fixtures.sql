-- ─────────────────────────────────────────────────────────────────────────────
-- FIXTURES DE TIEMPO · 229. SOLO bases desechables; NO es una transacción: DEJA datos (los usa test_229_fases.sh para
-- medir la publicación con commits reales, como en producción).
-- Uso:  psql -v n=5062 -f test_229_tiempo_fixtures.sql   (n = filas del payload; puede repetirse con otro n)
-- Deja: usuario `operaciones`, destino, 2 hoteles, un bloqueo, el paquete 229301 y public.t229_payload(n, filas) con un
-- payload del tamaño y la forma de un tarifario real: 7 acomodaciones por combinación, procedencia uniforme o mixta,
-- ≈ 35 claves por fila y los mismos 6 FK / 6 CHECK / 5 índices de la tabla.
-- ─────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000229004', 'c229-tiempo@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000229004', 'c229-tiempo@x.test', 'C229 tiempo', 'operaciones', true, 'mayorista')
on conflict (id) do update set rol = 'operaciones', activo = true;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (229010, 'T229 DESTINO', 'CTG', 'Colombia', true) on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre) values (229020, 229010, 'T229 hotel A'), (229021, 229010, 'T229 hotel B') on conflict do nothing;
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values (229301, 'T229 paquete grande', 'bloqueo', true, 229010) on conflict do nothing;
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar)
values (229600, 'T229TM', 'AEROTEST', 'BOG - CTG - BOG', '2031-01-10', '2031-01-13', 2, 200000) on conflict do nothing;

create table if not exists public.t229_payload (n int primary key, filas jsonb not null);
grant select on public.t229_payload to authenticated;
delete from public.t229_payload where n = :n;

insert into public.t229_payload (n, filas)
select :n, jsonb_agg(f order by i)
from (
  select i,
    jsonb_build_object(
      'paquete_id', 229301, 'paquete_nombre', 'T229 paquete grande', 'paquete_activo', true, 'modulo', 'bloqueo',
      'bloqueo_id', 229600, 'bloqueo_label', 'T229TM BOG-CTG',
      'hotel_id', case when i % 2 = 0 then 229020 else 229021 end, 'hotel_nombre', 'T229 hotel ' || (i % 2),
      'destino_id', 229010, 'destino_nombre', 'T229 DESTINO',
      'categoria', 'CATEGORIA ' || ((i / 7) % 25), 'regimen', 'REGIMEN ' || ((i / 175) % 5),
      'acomodacion', (array['sencilla','doble','triple','multiple','nino','nino2','infante'])[1 + (i % 7)],
      'noches', 3, 'fecha_ida', (date '2031-01-10' + ((i / 700) % 30))::text, 'fecha_regreso', (date '2031-01-13' + ((i / 700) % 30))::text,
      'base_comisionable', 1000000 + i, 'impuesto', 599000, 'precio_pvp', 2000000 + i,
      'precio_pvp_menor2', case when i % 7 = 6 then 155000 else null end,
      'descripcion', null, 'moneda', 'COP', 'salida_id', null, 'pax_desde', null, 'pax_hasta', null, 'tipo_tarifa', null, 'recargo_individual', null,
      'temporada_ganadora', case when i % 5 = 0 then null else 'ALTA' end,
      'es_promocion', case when i % 5 = 0 then null else false end,
      'precio_final_autoritativo', case when i % 5 = 0 then null else false end,
      'procedencia_temporadas', case when i % 5 = 0
          then '[{"temporada":"ALTA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"MEDIA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO FIN DE AÑO","es_promocion":true,"precio_final_autoritativo":true}]'::jsonb
          else '[{"temporada":"ALTA","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb end,
      'procedencia_mixta', (i % 5 = 0)
    ) as f
  from generate_series(0, :n - 1) i
) s;

select n as filas_payload, jsonb_array_length(filas) as elementos, pg_size_pretty(pg_column_size(filas)::bigint) as tamano_jsonb,
       pg_size_pretty(length(filas::text)::bigint) as tamano_texto
  from public.t229_payload where n = :n;
