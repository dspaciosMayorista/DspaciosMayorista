-- #105 (imágenes de Programas y Receptivos): catálogo SINTÉTICO sin fotos. Las fotos las pone cargar_imagenes_revision.mjs en el Storage LOCAL
-- (originales pesados «ya almacenados» + algunas medianas); las subidas nuevas las hace el dueño con los cargadores reales de la app.
-- NO se crea ninguna política de lectura artificial: lo que cada rol ve de las fotos es el comportamiento real del repositorio.
\set ON_ERROR_STOP 1
begin;
insert into public.destinos (id, nombre) values (916101, 'CARTAGENA IMG'), (916102, 'SAN ANDRÉS IMG') on conflict do nothing;
insert into public.proveedores (id, nombre) values (916101, 'Proveedor Receptivos IMG') on conflict do nothing;
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, liquidacion, activo, tipo_tarifa, precio_persona, categoria, tipo_receptivo, descripcion, moneda)
select 916100 + n, 'IMG Tour ' || lpad(n::text, 2, '0') || ' ' || d.nombre, 916101, d.id, 'paquete', true, 'persona', 50000 + n * 1000, 'tour', 'tour',
       'Receptivo sintético ' || n || ' para revisar fotos.', 'COP'
from generate_series(1, 12) n
join lateral (select id, nombre from (values (916101, 'CARTAGENA IMG'), (916102, 'SAN ANDRÉS IMG')) v(id, nombre) where v.id = 916101 + (n - 1) / 6) d on true;
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, prioridad, precio_persona)
select 916100 + n, 916100 + n, 'IMG 2030', '2030-01-01', '2030-12-31', 1, 50000 + n * 1000 from generate_series(1, 12) n;
insert into public.armado_paquetes (id, nombre, activo, tipo, noches, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, moneda, moneda_publicacion)
values (916101, 'IMG Receptivos Cartagena', true, 'servicios', 3, 916101, '2030-01-01', '2030-12-31', 0.2, 'COP', 'COP'),
       (916102, 'IMG Receptivos San Andrés', true, 'servicios', 3, 916102, '2030-01-01', '2030-12-31', 0.2, 'COP', 'COP');
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido)
select 916101 + (n - 1) / 6, 916100 + n, 'persona', false from generate_series(1, 12) n;
insert into public.programa_destinos_fijos (id, nombre, es_provisional) values (916101, 'EUROPA IMG', false), (916102, 'CARIBE IMG', false) on conflict do nothing;
insert into public.programas (id, nombre, subtitulo, dias, noches, moneda, activo, publicado, tipo_transporte, pct_mk, desde_precio, texto_condiciones, destino_fijo_id)
select 916100 + n, 'IMG Programa ' || lpad(n::text, 2, '0'), 'Circuito sintético ' || n, 6 + n % 5, 5 + n % 5, 'USD', true, false,
       (array['aereo', 'terrestre', 'ninguno'])[1 + n % 3], 0.2, 900 + n * 25, 'Condiciones sintéticas.', 916101 + (n % 2)
from generate_series(1, 6) n;
insert into public.programa_dias (programa_id, dia, titulo, descripcion)
select p.id, d, 'Día ' || d, 'Actividad sintética' from public.programas p cross join lateral generate_series(1, p.dias) d where p.id between 916101 and 916106;
update public.programas set publicado = true where id between 916101 and 916106;
commit;
