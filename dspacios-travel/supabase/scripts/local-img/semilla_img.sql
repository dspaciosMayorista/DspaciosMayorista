-- SYNTHETIC seed for the image-delivery measurements (no production data). Runs on dspacios_img, a private COPY of
-- lote_revision (the lote database is never touched). Image URLs point at servidor_imagenes.mjs (127.0.0.1:54371).
--   45 receptivos (3 destinos x 15) with ~2.3 MB photos, grouped in 3 «servicios» packages (916001-916003)
--   12 published Programas with covers: 6 camera originals (~9 MB), 3 large (~2.3 MB), 3 sized (~300 KB)
\set ON_ERROR_STOP 1
begin;
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, liquidacion, activo, tipo_tarifa, precio_persona, categoria, tipo_receptivo, descripcion, moneda, foto_url)
select 916000 + n, 'IMG Tour ' || lpad(n::text, 2, '0') || ' ' || d.nombre, 915001, d.id, 'paquete', true, 'persona', 50000 + n * 1000, 'tour', 'tour',
       'Receptivo sintético ' || n || ' para medir carga de imágenes.', 'COP',
       'http://127.0.0.1:54371/img/large-' || (1 + n % 6) || '.jpg?s=' || (916000 + n)
from generate_series(1, 45) n
join lateral (select id, nombre from (values (1, 'CARTAGENA'), (2, 'SAN ANDRÉS'), (3, 'SANTA MARTA')) v(id, nombre) where v.id = 1 + (n - 1) / 15) d on true;
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, prioridad, precio_persona)
select 916000 + n, 916000 + n, 'IMG 2026-2027', '2026-11-01', '2027-12-31', 1, 50000 + n * 1000 from generate_series(1, 45) n;
insert into public.armado_paquetes (id, nombre, activo, tipo, noches, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, moneda, moneda_publicacion)
values (916001, 'IMG Receptivos Cartagena', true, 'servicios', 3, 1, '2026-12-01', '2027-12-28', 0.2, 'COP', 'COP'),
       (916002, 'IMG Receptivos San Andrés', true, 'servicios', 3, 2, '2026-12-01', '2027-12-28', 0.2, 'COP', 'COP'),
       (916003, 'IMG Receptivos Santa Marta', true, 'servicios', 3, 3, '2026-12-01', '2027-12-28', 0.2, 'COP', 'COP');
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido)
select 916001 + (n - 1) / 15, 916000 + n, 'persona', false from generate_series(1, 45) n;
insert into public.programas (id, nombre, subtitulo, dias, noches, moneda, activo, publicado, tipo_transporte, pct_mk, desde_precio, texto_condiciones, portada_url)
select 916000 + n, 'IMG Programa ' || lpad(n::text, 2, '0'), 'Circuito sintético ' || n, 6 + n % 5, 5 + n % 5, 'USD', true, false,
       (array['aereo', 'terrestre', 'ninguno'])[1 + n % 3], 0.2, 900 + n * 25, 'Condiciones sintéticas.',
       case when n <= 6 then 'http://127.0.0.1:54371/img/huge-' || n || '.jpg?p=' || (916000 + n)
            when n <= 9 then 'http://127.0.0.1:54371/img/large-' || (n - 6) || '.jpg?p=' || (916000 + n)
            else 'http://127.0.0.1:54371/img/ok-' || (n - 9) || '.jpg?p=' || (916000 + n) end
from generate_series(1, 12) n;
insert into public.programa_dias (programa_id, dia, titulo, descripcion)
select p.id, d, 'Día ' || d, 'Actividad sintética' from public.programas p cross join lateral generate_series(1, p.dias) d where p.id between 916001 and 916012;
update public.programas set publicado = true where id between 916001 and 916012;
commit;

-- Public visibility of a Programa requires a fixed destination (migration 213). Applied after the main block.
begin;
insert into public.programa_destinos_fijos (id, nombre, es_provisional) values (916001, 'EUROPA IMG', false), (916002, 'CARIBE IMG', false), (916003, 'ANDES IMG', false) on conflict do nothing;
update public.programas set destino_fijo_id = 916001 + (id % 3) where id between 916001 and 916012;
commit;

-- ENVIRONMENT ADJUSTMENT (private copy only, NOT a production claim): the repo's RLS lets only internal roles read
-- servicios_adicionales, and the tarifario loads the photo map with the visitor's own session. The measurement browser is
-- anonymous (no GoTrue in this stack), so this policy emulates an authorized viewer to make the photo path measurable.
create policy "img_medicion: lectura" on public.servicios_adicionales for select to anon, authenticated using (true);
