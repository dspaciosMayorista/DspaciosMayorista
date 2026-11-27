-- SEMILLA SINTÉTICA del recorrido navegado del bloque 3 (#11 presencia reciente de personal Y aliados · #13 avisos de fin de compra en la campana global · #36 estado de publicación). Solo base LOCAL desechable; todo ficticio.
-- Fechas RELATIVAS a hoy en Bogotá (public.fecha_negocio()). Usuarios (el proxy mínimo responde con el correo `<id>@humo.test`, así que usuarios.email usa ese mismo valor):
--   b01 superadmin · b02 gerencia · b03 operaciones · b04 venta · b05..b08 personal adicional con actividad variada (nombres largos para probar el diseño).
alter table auth.users add column if not exists last_sign_in_at timestamptz;   -- la plantilla local trae un auth.users simplificado; Supabase real ya lo tiene
insert into auth.users (id, email, last_sign_in_at)
select ('00000000-0000-0000-0000-000000000' || n)::uuid, '00000000-0000-0000-0000-000000000' || n || '@humo.test', ts
  from (values ('b01', now() - interval '25 minutes'), ('b02', now() - interval '2 hours'), ('b03', now() - interval '3 days'), ('b04', null::timestamptz),
               ('b05', now() - interval '1 day'), ('b06', now() - interval '6 days'), ('b07', now() - interval '40 minutes'), ('b08', null::timestamptz), ('b09', now() - interval '1 hour'), ('b0a', null::timestamptz)) v(n, ts)
on conflict (id) do update set last_sign_in_at = excluded.last_sign_in_at;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select ('00000000-0000-0000-0000-000000000' || n)::uuid, '00000000-0000-0000-0000-000000000' || n || '@humo.test', nombre, rol::public.rol_usuario, activo, tenant
  from (values
    ('b01', 'Odair Superadmin Humo', 'superadmin', true, 'mayorista'),
    ('b02', 'Gerencia Humo', 'gerencia', true, 'mayorista'),
    ('b03', 'Operaciones Humo', 'operaciones', true, 'mayorista'),
    ('b04', 'Venta Humo', 'venta', true, 'mayorista'),
    ('b05', 'Administración y Operaciones Regionales de la Costa Caribe y San Andrés', 'administracion', true, 'mayorista'),
    ('b06', 'Asesora Comercial Minorista', 'venta', true, 'minorista'),
    ('b07', 'Contabilidad Humo', 'administracion', true, 'mayorista'),
    ('b08', 'Usuario Desactivado Humo', 'venta', false, 'mayorista'),
    ('b09', 'Agencia Aliada Humo Viajes', 'agencia', true, 'mayorista'),
    ('b0a', 'Freelance Aliado Humo', 'freelance', true, 'mayorista')) v(n, nombre, rol, activo, tenant)
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where email like '%@humo.test' on conflict do nothing;
insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where email like '%@humo.test' on conflict do nothing;

-- Aliados B2B (agencia y freelance) con su ficha de catálogo.
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (12901, 'Humo Viajes S.A.S.', '129010', 'agencia', 0.10, false, 0, true), (12902, 'Freelance Humo', '129020', 'freelance', 0.10, false, 0, true) on conflict (id) do nothing;
update public.usuarios set aliado_id = 12901 where id = '00000000-0000-0000-0000-000000000b09';
update public.usuarios set aliado_id = 12902 where id = '00000000-0000-0000-0000-000000000b0a';

-- #11 · PRESENCIA observada (instantes relativos a AHORA): b01 3 min y b09 (agencia) 4 min y b07 8 min = recientes (≤10 min); b02 2 h y b05 ayer = hoy / antes; b0a (freelance) 3 días.
-- b03 (operaciones), b04, b06 y b08 SIN observación: b03 sirve para probar el aviso REAL del navegador (su primera carga debe crear su fila).
insert into public.presencia_usuario (usuario_id, visto_en)
select ('00000000-0000-0000-0000-000000000' || n)::uuid, now() - m * interval '1 minute'
  from (values ('b01', 3), ('b09', 4), ('b07', 8), ('b02', 120), ('b05', 1500), ('b0a', 4320)) v(n, m);

-- #11 · auditoría (actor + tiempo relativo a AHORA): b01 muy reciente; b07 reciente; b02 hoy; b05 hace días; b03, b04 y b06 sin actividad en la ventana; b08 inactivo (no debe aparecer).
insert into public.auditoria (creado_en, actor_id, actor_email, actor_rol, accion, tabla, registro_id)
select now() - m * interval '1 minute', ('00000000-0000-0000-0000-000000000' || n)::uuid, 'x@humo.test', 'x', 'UPDATE', 'ventas', 'seed'
  from (values ('b01', 4), ('b01', 70), ('b01', 400), ('b01', 3000), ('b07', 12), ('b07', 90), ('b02', 200), ('b05', 5000), ('b05', 5100), ('b08', 3)) v(n, m);

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
update public.config_notificaciones set destinatarios = 'operaciones@humo.test', activo = true where id = 1;

-- #13 · avisos en la campana: UNA ejecución del generador diario (como el cron), con los paquetes y vigencias de arriba ya en su estado final.
select public.generar_avisos_compra();
