-- REVISION CONSOLIDADA (correcciones 2026-11-26) — H88: datos de catalogo para un hotel de un PAQUETE COMUN (porcion terrestre) + un hotel «gemelo» que NO debe mezclarse.
-- ADITIVA e idempotente (no pisa datos existentes; sin DELETE). Solo sintetica. NO se aplica a rev_consolidada sin decision del coordinador (el dueño conserva su avance).
-- Ids 91300–91399. Depende de que exista el hotel 12001 «Hotel Caribe Plaza» (semilla del bloque 3) con paquetes 12001/12008/12011 visibles en /tarifario.
create or replace function pg_temp.svg88(color text, etiqueta text) returns text language sql immutable as $$
  select 'data:image/svg+xml;base64,' || replace(encode(convert_to(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="' || color || '"/><text x="24" y="210" font-size="34" font-family="sans-serif" fill="#ffffff">' || etiqueta || '</text></svg>', 'UTF8'), 'base64'), E'\n', '')
$$;
begin;
-- Ficha REAL del hotel de los paquetes comunes: solo se completa lo que esta vacio.
update public.hoteles set
  estrellas   = coalesce(estrellas, 4),
  descripcion = coalesce(descripcion, 'Descripcion de CATALOGO CARIBE PLAZA (paquete comun): hotel frente al mar.'),
  ubicacion   = coalesce(ubicacion, 'Bocagrande, Cartagena')
where id = 12001;
insert into public.hotel_fotos (hotel_id, path, url, orden, es_portada)
select 12001, 'revision88b/12001-' || n || '.svg', pg_temp.svg88(c, l), n, (n = 2)
  from (values (1, '#1D7C9A', 'CARIBE-1'), (2, '#26BBD9', 'CARIBE-2 PORTADA')) v(n, c, l)
where not exists (select 1 from public.hotel_fotos where hotel_id = 12001);
-- Gemelo: MISMO nombre, mismo destino, otros datos; no esta en ningun paquete. Si algun dato suyo aparece en la tarjeta de 12001, hay mezcla por nombre.
insert into public.hoteles (id, destino_id, nombre, estrellas, descripcion, ubicacion, moneda, activo)
select 91301, destino_id, nombre, 2, 'Descripcion del GEMELO (no debe verse en el paquete): hostal sencillo.', 'Barrio Gemelo, Cartagena', 'COP', true
  from public.hoteles where id = 12001
on conflict (id) do nothing;
insert into public.hotel_fotos (hotel_id, path, url, orden, es_portada)
select 91301, 'revision88b/91301-1.svg', pg_temp.svg88('#d97706', 'GEMELO-1 PORTADA'), 1, true
where not exists (select 1 from public.hotel_fotos where hotel_id = 91301);
commit;
