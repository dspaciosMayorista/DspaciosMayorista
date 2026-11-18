-- SEMILLA SINTÉTICA del recorrido navegado de #1 (personas de TODA cotización en el CRM). Solo base LOCAL desechable; todo ficticio.
-- Usuarios: el proxy mínimo (humo_14a_proxy.mjs) responde como correo de la sesión `<id>@humo.test`, así que `usuarios.email` usa ese mismo valor.
--   staff (administracion, mayorista) · venta · agencia1/agencia2 (aliados B2B) · adminMin (administracion, minorista)
-- Catálogo: un paquete de porción terrestre con un hotel BAJO SOLICITUD (el visitante pide cotización) y otro tarifado.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a01@humo.test'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a02@humo.test'),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000a03@humo.test'),
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000a04@humo.test'),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000a05@humo.test') on conflict do nothing;
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9801, 'Agencia Humo Uno', '9801', 'agencia', 0.10, false, 0, true), (9802, 'Agencia Humo Dos', '9802', 'agencia', 0.10, false, 0, true) on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a01@humo.test', 'Staff Humo', 'administracion', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a02@humo.test', 'Venta Humo', 'venta', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000a03@humo.test', 'Agencia Humo Uno', 'agencia', true, 'mayorista', 9801),
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000a04@humo.test', 'Agencia Humo Dos', 'agencia', true, 'mayorista', 9802),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000a05@humo.test', 'Admin Minorista Humo', 'administracion', true, 'minorista', null)
  on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where email like '%@humo.test' on conflict do nothing;
insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where email like '%@humo.test' on conflict do nothing;

insert into public.destinos (id, nombre) values (9801, 'CARTAGENA HUMO') on conflict do nothing;
insert into public.proveedores (id, nombre) values (9801, 'Proveedor Humo') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, activo) overriding system value values
  (9803, 9801, 'Hotel Solicitud Humo', 9801, 'COP', true), (9804, 9801, 'Hotel Tarifado Humo', 9801, 'COP', true);
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
  (9803, 'Porcion terrestre Humo', 'porcion_terrestre', 3, 9801, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id) values (9803, 9803), (9803, 9804);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, tipo, prioridad) values (9804, 'ALTA', '2030-05-01', '2030-05-31', 'tarifa', 1);
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
  values (9804, 'Estandar', 'PC', 'ALTA', 300000, 300000, 300000, 300000, 150000, 150000, 0);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  values (9803, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (9804, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
update public.hoteles set tarifa_bajo_solicitud = true where id = 9803;
