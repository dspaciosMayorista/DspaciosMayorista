-- REVISIÓN CONSOLIDADA — semilla derivada de humo_block3_semilla.sql.
-- Catálogo: 11 paquetes en cada estado real de publicación + vigencias de compra (paquete, salida dinámica, empaquetado, paquete dinámico total) a 0–5 días de hoy (Bogotá).
-- #36 / #13 · catálogo. Un destino, hoteles (persona / unidad / bajo solicitud) y paquetes en cada estado real de publicación.
insert into public.destinos (id, nombre) values (12001, 'HUMO3 DESTINO') on conflict (id) do nothing;
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, tarifa_bajo_solicitud, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values
  (12001, 12001, 'Hotel Caribe Plaza', 'persona', 'COP', false, 0, 2, 2, 10),
  (12004, 12001, 'Cabañas Bernalo Villa de Leyva', 'unidad', 'COP', false, 0, 2, 2, 10),
  (12005, 12001, 'Hotel Boutique Bajo Solicitud', 'persona', 'COP', true, 0, 2, 2, 10);
insert into public.hotel_tarifas_unidad (hotel_id, tarifa_id, version_tarifario, categoria, alimentacion, temporada, estado, payload)
  values (12004, 'humo3-unidad', 'v1', 'ESTANDAR', 'PC', 'BASE', 'publicada', '{"id":"humo3-unidad","versionTarifario":"v1"}'::jsonb);
insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin) values
  (12001, 'Cartagena 4 noches porción terrestre — Hotel Caribe Plaza todo incluido, temporada alta de diciembre', 12001, true,  'porcion_terrestre', 4, public.fecha_negocio() + 2,  public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12002, 'San Andrés 5 noches', 12001, true,  'porcion_terrestre', 5, public.fecha_negocio() + 30, public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12003, 'Santa Marta 3 noches', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio() + 30, public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12004, 'Villa de Leyva cabañas por unidad', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio(),      public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12005, 'Hotel boutique bajo solicitud', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio() + 30, public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12006, 'Cali inactivo con tarifas generadas', 12001, false, 'porcion_terrestre', 3, public.fecha_negocio() + 3,  public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12007, 'Cartagena bloqueado por cambios de fuentes', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio() - 3,  public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12008, 'Eje cafetero combinado persona y unidad', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio() + 30, public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12009, 'Miami dinámico con salidas por sistema', 12001, true,  'dinamico', 3, null, public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12010, 'Paquete sin oferta vendible', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio() + 30, public.fecha_negocio() + 40, public.fecha_negocio() + 80),
  (12011, 'Cartagena activo en promoción cercana', 12001, true,  'porcion_terrestre', 3, public.fecha_negocio() + 5,  public.fecha_negocio() + 40, public.fecha_negocio() + 80);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
  (12001, 12001, array['ESTANDAR'], array['PC']), (12004, 12004, array['ESTANDAR'], array['PC']), (12005, 12005, '{}', '{}'),
  (12008, 12001, array['ESTANDAR'], array['PC']), (12008, 12004, array['ESTANDAR'], array['PC']);
insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, hotel_nombre, destino_id, destino_nombre, categoria, regimen, acomodacion, precio_pvp, moneda)
  select p, 'x', (p <> 12006), 'porcion_terrestre', 12001, 'Hotel Caribe Plaza', 12001, 'HUMO3 DESTINO', c, 'PC', a::acomodacion_tipo, 1450000, 'COP'
    from unnest(array[12001, 12006, 12007, 12008, 12011]) p, unnest(array['ESTANDAR', 'SUPERIOR']) c, unnest(array['sencilla', 'doble']) a;
-- #13 · otras vigencias de compra: salida dinámica (paquete 12009), empaquetado vinculado a 12001 y paquete dinámico total.
insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, compra_fin, activo) values (12001, 12009, public.fecha_negocio() + 60, public.fecha_negocio() + 64, public.fecha_negocio() + 3, true);
insert into public.empaquetados (id, ruta, destino_id, fecha_ida, fecha_regreso, compra_fin, activo) values (12001, 'MDE - CTG - MDE', 12001, public.fecha_negocio() + 50, public.fecha_negocio() + 54, public.fecha_negocio() + 4, true);
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (12001, 12001);
insert into public.paquete_din (id, nombre, destino_id, esquema, pvp_modo, usa_hotel, compra_fin, activo, publicado) values
  (12001, 'Paquete dinámico total — Punta Cana 6 noches con vuelo y traslados', 12001, 'solo_pvp', 'general', true, public.fecha_negocio() + 1, true, true);

-- Estado AUTORITATIVO de publicación (181/256), fijado AL FINAL: vincular un empaquetado o un hotel a un paquete lo invalida (comportamiento real), así que se escribe tras todos los vínculos.
update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = activo, tarifario_generacion_publicada = 1 where id in (12001, 12004, 12005, 12006, 12008, 12010, 12011);
update public.armado_paquetes set tarifario_estado = 'pendiente', tarifario_generacion_publicada = null where id in (12002, 12009);
update public.armado_paquetes set tarifario_estado = 'fallido', tarifario_error = 'No se generaron tarifas: el hotel no tiene temporadas que cubran las fechas del viaje.' where id = 12003;
update public.armado_paquetes set tarifario_estado = 'pendiente', tarifario_snapshot_publicable = false, tarifario_generacion_publicada = 1 where id = 12007;
-- Destinatarios del correo diario (ficticios): el entorno NO tiene RESEND_API_KEY, así que nada puede enviarse.
update public.config_notificaciones set destinatarios = 'operaciones@consolidada.test', activo = true where id = 1;

