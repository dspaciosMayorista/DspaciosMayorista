-- REVISION CONSOLIDADA — semilla 30: #88 (informacion del hotel del catalogo en «Dinamicos») + costo aereo de bloqueo desde la tarifa neta.
-- Rango de ids 91100–91299. Se aplica UNA vez, despues de fijar los perfiles. Todo sintetico. Fechas relativas a hoy (Bogota).
-- Las «fotos» de los hoteles son imagenes SVG diminutas embebidas (data URI) con una etiqueta legible: la pagina las muestra tal cual (next/image sin optimizar).

create or replace function pg_temp.svg88(color text, etiqueta text) returns text language sql immutable as $$
  select 'data:image/svg+xml;base64,' || replace(encode(convert_to(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="' || color || '"/><text x="24" y="210" font-size="34" font-family="sans-serif" fill="#ffffff">' || etiqueta || '</text></svg>', 'UTF8'), 'base64'), E'\n', '');
$$;

begin;

-- ============================================================ PARTE A — #88 ============================================================
insert into public.destinos (id, nombre) values (91101, 'CARTAGENA CATALOGO 88') on conflict do nothing;

-- Hoteles del catalogo. 91102 y 91103 se llaman IGUAL a proposito (la tarjeta debe usar el dato de SU hotel por id, no por nombre).
insert into public.hoteles (id, destino_id, nombre, estrellas, clasificacion, descripcion, ubicacion, moneda, activo) values
  (91101, 91101, 'Hotel Catalogo Uno',     4,    null,     'Descripcion de CATALOGO UNO: hotel frente al mar con piscina y spa.',            'Bocagrande, Cartagena',  'COP', true),
  (91102, 91101, 'Hotel Duplicado',        4,    null,     'Descripcion del catalogo del Duplicado A: habitaciones amplias y terraza.',      'Bocagrande A, Cartagena', 'COP', true),
  (91103, 91101, 'Hotel Duplicado',        5,    null,     'Descripcion del catalogo del Duplicado B: hotel historico de lujo.',             'Getsemani B, Cartagena',  'COP', true),
  (91104, 91101, 'Hotel Sin Estrellas',    null, 'Posada', 'Descripcion del catalogo de la posada: casa colonial sin estrellas.',            'Centro historico, Cartagena', 'COP', true),
  (91105, 91101, 'Hotel Copia Antigua',    3,    null,     'Descripcion ACTUAL del catalogo (la copia guardada en el paquete es vieja).',    'Manga ACTUAL, Cartagena', 'COP', true),
  (91106, 91101, 'Hotel Vacio',            null, null,     null,                                                                              null,                      'COP', true)
on conflict (id) do nothing;

update public.hoteles set edad_infante_max = 2, edad_nino_max = 11 where id between 91101 and 91106;

-- Galeria del catalogo (portada = la marcada; la tarjeta debe mostrarla primero).
insert into public.hotel_fotos (hotel_id, path, url, orden, es_portada)
select h, 'revision88/' || h || '-' || n || '.svg', pg_temp.svg88(c, l), n, (n = p)
  from (values
    (91101, 1, '#1D7C9A', 'UNO-1',          2), (91101, 2, '#26BBD9', 'UNO-2 PORTADA', 2), (91101, 3, '#66B596', 'UNO-3', 2),
    (91102, 1, '#1D7C9A', 'DUP-A-1 PORTADA', 1), (91102, 2, '#26BBD9', 'DUP-A-2', 1),
    (91103, 1, '#66B596', 'DUP-B-1 PORTADA', 1),
    (91104, 1, '#1D7C9A', 'POSADA-1 PORTADA', 1), (91104, 2, '#26BBD9', 'POSADA-2', 1)
  ) v(h, n, c, l, p)
where not exists (select 1 from public.hotel_fotos where hotel_id = v.h);

-- Paquete dinamico total (solo hotel, solo PVP por componente), publicado, sin ventana de compra. Todos los importes por persona de la estadia de 3 noches.
insert into public.paquete_din (id, nombre, destino_id, esquema, pvp_modo, usa_hotel, usa_vuelo, usa_servicios, noches, activo, publicado, descripcion)
values (91101, 'Dinamico 88 - Hoteles del catalogo', 91101, 'solo_pvp', 'por_componente', true, false, false, 3, true, true, 'Paquete de revision #88: hoteles vinculados al catalogo, hoteles manuales y casos de datos faltantes.')
on conflict (id) do nothing;

-- Filas de hotel. hotel_id = hotel del catalogo vinculado; null = hotel manual. «estrellas/descripcion/ubicacion/foto_url» = lo GUARDADO en el paquete.
-- «Desde» (doble) por hotel: Uno 500.000 · Dup A 600.000 · Dup B 700.000 · Sin Estrellas 400.000 · Copia Antigua 520.000 · Vacio 450.000 · Manual Pleno 550.000 · Manual Pelado 350.000.
insert into public.paquete_din_hoteles (id, paquete_id, hotel_id, nombre, categoria, regimen, descripcion, foto_url, estrellas, ubicacion, proveedor, neto, pvp, orden, capacidad_ninos, edad_infante_max, edad_nino_max)
select id, 91101, hid, nombre, cat, reg, descr, foto, est, ubic, 'Proveedor interno 88',
       '{}'::jsonb,
       jsonb_build_object('sencilla', doble + 200000, 'doble', doble, 'triple', doble - 50000, 'multiple', doble - 100000, 'nino', 250000, 'nino2', 200000, 'infante', 0),
       orden, 2, 2, 11 -- solo cuentan en los hoteles manuales (el disparador las anula en los vinculados)
from (values
  (91101, 91101, 'Hotel Catalogo Uno',  'Superior', 'PAM', null::text, null::text, null::smallint, null::text, 500000, 1),
  (91102, 91102, 'Hotel Duplicado',     'Estandar', 'PC',  null,       null,       null,           null,       600000, 2),
  (91103, 91103, 'Hotel Duplicado',     'Superior', 'PAM', null,       null,       null,           null,       700000, 3),
  (91104, 91104, 'Hotel Sin Estrellas', 'Estandar', 'PA',  null,       null,       null,           null,       400000, 4),
  (91105, 91105, 'Hotel Copia Antigua', 'Estandar', 'PAM', 'Descripcion VIEJA guardada en el paquete', pg_temp.svg88('#d97706', 'COPIA-GUARDADA'), 2::smallint, 'Ubicacion VIEJA guardada', 520000, 5),
  (91106, 91106, 'Hotel Vacio',         null,       null,  null,       null,       null,           null,       450000, 6),
  (91107, null,  'Hotel Manual Pleno',  'Estandar', 'PAM', 'Descripcion MANUAL escrita a mano en el paquete.', pg_temp.svg88('#7c3aed', 'MANUAL-FOTO'), 3::smallint, 'Baru, Cartagena', 550000, 7),
  (91108, null,  'Hotel Manual Pelado', null,       null,  null,       null,       null,           null,       350000, 8)
) v(id, hid, nombre, cat, reg, descr, foto, est, ubic, doble, orden)
where not exists (select 1 from public.paquete_din_hoteles where paquete_id = 91101);

-- ===================================================== PARTE B — costo del bloqueo desde la neta =====================================================
insert into public.destinos (id, nombre, codigo_iata) values (91201, 'CARTAGENA NETA', 'NTA') on conflict do nothing;
insert into public.proveedores (id, nombre, tipo) values (91201, 'Proveedor Hotel Neta', 'hotel'), (91202, 'Aerolinea Neta SAS', 'aereo') on conflict do nothing;
insert into public.categorias_habitacion (nombre) values ('Estándar') on conflict do nothing;

-- Hoteles: uno en pesos y uno en dolares (el bloqueo y el hotel de un paquete deben ser de la misma moneda).
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_max, edad_nino_max, activo) values
  (91201, 91201, 'Hotel Neta Peso',   91201, 'COP', 2, 11, true),
  (91202, 91201, 'Hotel Neta Dolar',  91201, 'USD', 2, 11, true)
on conflict (id) do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id) select h, c.id from unnest(array[91201, 91202]) h, public.categorias_habitacion c where c.nombre = 'Estándar' and not exists (select 1 from public.hotel_categorias x where x.hotel_id = h);
insert into public.hotel_regimenes (hotel_id, plan_id) select h, p.id from unnest(array[91201, 91202]) h, public.planes_alimentacion p where p.codigo = 'PAM' and not exists (select 1 from public.hotel_regimenes x where x.hotel_id = h);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (91201, 91201, 'ALTA', public.fecha_negocio() + 30, public.fecha_negocio() + 200, 1, 'tarifa'),
  (91202, 91202, 'ALTA', public.fecha_negocio() + 30, public.fecha_negocio() + 200, 1, 'tarifa')
on conflict (id) do nothing;
-- Netos por persona y por noche. COP: doble 70.000 x 2 pax x 3 noches = 420.000 de costo de hotel. USD: doble 20 x 2 x 3 = 120.
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_infante)
select * from (values (91201, 'Estándar', 'PAM', 'ALTA', 100000, 70000, 35000, 0), (91202, 'Estándar', 'PAM', 'ALTA', 30, 20, 10, 0)) v(h, t, a, tp, s, d, n, i)
where not exists (select 1 from public.tarifa_hotel where hotel_id = v.h);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
select h, a.acomodacion::public.acomodacion_tipo, a.pax_tarifa, a.pax_max, a.adt_min, a.adt_max, a.chd_min, a.chd_max, a.inf_min, a.inf_max
from unnest(array[91201, 91202]) h,
     (values ('doble', 2, 4, 2, 2, 0, 2, 0, 2), ('sencilla', 1, 2, 1, 1, 0, 1, 0, 1)) a(acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
on conflict do nothing;

-- Bloqueos. A: neta 300.000 / reventa 349.000 (con neta). B: reventa 349.000 SIN neta. U: dolares, neta 100 / reventa 120. Fee de infante: 80.500 COP / 20 USD.
insert into public.bloqueos_vuelo (id, record, aerolinea, origen, ruta, vuelo_ida, vuelo_regreso, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, fee_infante, destino_id, proveedor_id, moneda) values
  (91201, 'NTA301', 'Avianca', 'BOG', 'BOG - CTG - BOG', 'AV391', 'AV392', public.fecha_negocio() + 60, public.fecha_negocio() + 63, 6, 349000, 300000, 80500, 91201, 91202, 'COP'),
  (91202, 'NTB302', 'Avianca', 'BOG', 'BOG - CTG - BOG', 'AV393', 'AV394', public.fecha_negocio() + 70, public.fecha_negocio() + 73, 6, 349000, null,   80500, 91201, 91202, 'COP'),
  (91203, 'NTU303', 'Avianca', 'BOG', 'BOG - CTG - BOG', 'AV395', 'AV396', public.fecha_negocio() + 80, public.fecha_negocio() + 83, 6, 120,    100,    20,    91201, 91202, 'USD')
on conflict (id) do nothing;
insert into public.sillas (bloqueo_id, numero_silla, estado)
select b, g, 'disponible' from unnest(array[91201, 91202, 91203]) b, generate_series(1, 6) g
where not exists (select 1 from public.sillas where bloqueo_id = b);

-- Paquetes de bloqueo: 91201 (pesos; dos record: A con neta y B sin neta) y 91202 (dolares; record U).
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) values
  (91201, 'Paquete bloqueo Neta COP', 'bloqueo', 3, 91201, 0.2, 'fijo', 0, public.fecha_negocio() + 40, public.fecha_negocio() + 120, 'COP', 'COP', true),
  (91202, 'Paquete bloqueo Neta USD', 'bloqueo', 3, 91201, 0.2, 'fijo', 0, public.fecha_negocio() + 40, public.fecha_negocio() + 120, 'USD', 'USD', true)
on conflict (id) do nothing;
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (91201, 91201, array['Estándar'], array['PAM']), (91202, 91202, array['Estándar'], array['PAM']);
insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (91201, 91201, true, 0), (91201, 91202, true, 0), (91202, 91203, true, 0);

-- Tarifario publicado (derivado a mano del motor: reventa/(1-0,2) + hotel/(1-0,2), techo al millar; infante = fee exacto).
--  COP doble : 210.000/0,8 + 349.000/0,8 = 262.500 + 436.250 = 698.750 -> 699.000     sencilla: 300.000/0,8 + 436.250 = 811.250 -> 812.000     nino: 105.000/0,8 + 436.250 = 567.500 -> 568.000
--  USD doble : 60/0,8 + 120/0,8 = 75 + 150 = 225                                       sencilla: 90/0,8 + 150 = 262,5 -> 263                     nino: 30/0,8 + 150 = 187,5 -> 188
insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label, hotel_id, hotel_nombre, destino_id, destino_nombre, categoria, regimen, acomodacion, noches, fecha_ida, fecha_regreso, precio_pvp, precio_pvp_menor2, moneda)
select p, pn, true, 'bloqueo', b, bl, h, hn, 91201, 'CARTAGENA NETA', 'Estándar', 'PAM', a::acomodacion_tipo, 3,
       public.fecha_negocio() + di, public.fecha_negocio() + di + 3, pr, case when a = 'infante' then pr end, mo
from (values
  (91201, 'Paquete bloqueo Neta COP', 91201, 'NTA301 · AV391', 91201, 'Hotel Neta Peso', 60, 'COP', 'doble', 699000), (91201, 'Paquete bloqueo Neta COP', 91201, 'NTA301 · AV391', 91201, 'Hotel Neta Peso', 60, 'COP', 'sencilla', 812000),
  (91201, 'Paquete bloqueo Neta COP', 91201, 'NTA301 · AV391', 91201, 'Hotel Neta Peso', 60, 'COP', 'nino', 568000),  (91201, 'Paquete bloqueo Neta COP', 91201, 'NTA301 · AV391', 91201, 'Hotel Neta Peso', 60, 'COP', 'infante', 80500),
  (91201, 'Paquete bloqueo Neta COP', 91202, 'NTB302 · AV393', 91201, 'Hotel Neta Peso', 70, 'COP', 'doble', 699000), (91201, 'Paquete bloqueo Neta COP', 91202, 'NTB302 · AV393', 91201, 'Hotel Neta Peso', 70, 'COP', 'sencilla', 812000),
  (91201, 'Paquete bloqueo Neta COP', 91202, 'NTB302 · AV393', 91201, 'Hotel Neta Peso', 70, 'COP', 'nino', 568000),  (91201, 'Paquete bloqueo Neta COP', 91202, 'NTB302 · AV393', 91201, 'Hotel Neta Peso', 70, 'COP', 'infante', 80500),
  (91202, 'Paquete bloqueo Neta USD', 91203, 'NTU303 · AV395', 91202, 'Hotel Neta Dolar', 80, 'USD', 'doble', 225), (91202, 'Paquete bloqueo Neta USD', 91203, 'NTU303 · AV395', 91202, 'Hotel Neta Dolar', 80, 'USD', 'sencilla', 263),
  (91202, 'Paquete bloqueo Neta USD', 91203, 'NTU303 · AV395', 91202, 'Hotel Neta Dolar', 80, 'USD', 'nino', 188),   (91202, 'Paquete bloqueo Neta USD', 91203, 'NTU303 · AV395', 91202, 'Hotel Neta Dolar', 80, 'USD', 'infante', 20)
) v(p, pn, b, bl, h, hn, di, mo, a, pr)
where not exists (select 1 from public.tarifario_resultado where paquete_id in (91201, 91202));

-- Estado AUTORITATIVO de publicacion, fijado AL FINAL (vincular hoteles/vuelos lo invalida).
update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true, tarifario_generacion_publicada = 1 where id in (91201, 91202);

commit;
