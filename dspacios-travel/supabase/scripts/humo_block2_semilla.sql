-- SEMILLA SINTÉTICA del recorrido navegado de #76 (referidos) y #78 (aviso de cotización pública + «atendida»). Solo base LOCAL desechable; todo ficticio.
-- Usuarios (el proxy mínimo responde como correo de la sesión `<id>@humo.test`, así que `usuarios.email` usa ese mismo valor):
--   a01 administracion (mayorista) · a06 gerencia (mayorista) · a07 operaciones (mayorista) · a02 venta (mayorista) · a03 agencia (aliado B2B, mayorista) · a05 administracion de MINORISTA
--   a08 freelance PENDIENTE de aprobación (cuenta inactiva + solicitud) para probar el código de referido al aprobar.
-- Catálogo: un paquete de porción terrestre con un hotel BAJO SOLICITUD (el visitante pide cotización) y otro tarifado. Referidos: el referidor «Odair Referidor» (códigos ODAIR-1 al 1 % y ODAIR-2 al 2 %), dos aliados
-- ya asignados y cinco contratos creados DESPUÉS de la asignación (elegible, pendiente parcial, USD elegible, NETO, cancelado).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a01@humo.test'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a02@humo.test'),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000a03@humo.test'),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000a05@humo.test'),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000a06@humo.test'),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-000000000a07@humo.test'),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-000000000a08@humo.test') on conflict do nothing;
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9801, 'Agencia Humo Uno', '9801', 'agencia', 0.10, false, 0, true),
  (9802, 'Freelance Humo Dos', '9802', 'freelance', 0.10, false, 0, true),
  (9803, 'Agencia Humo Tres', '9803', 'agencia', 0.10, false, 0, true),
  (9804, 'Aliado Por Aprobacion', '9804', 'freelance', 0.10, false, 0, true),
  (9805, 'Aliado Codigo Manual', '9805', 'agencia', 0.10, false, 0, true) on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a01@humo.test', 'Administracion Humo', 'administracion', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a02@humo.test', 'Venta Humo', 'venta', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000a03@humo.test', 'Agencia Humo Uno', 'agencia', true, 'mayorista', 9801),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000a05@humo.test', 'Admin Minorista Humo', 'administracion', true, 'minorista', null),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000a06@humo.test', 'Gerencia Humo', 'gerencia', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-000000000a07@humo.test', 'Operaciones Humo', 'operaciones', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-000000000a08@humo.test', 'Solicitante Humo', 'freelance', false, 'mayorista', null)
  on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where email like '%@humo.test' on conflict do nothing;
insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where email like '%@humo.test' on conflict do nothing;
-- La lista de correos de config_solicitudes YA NO decide los avisos de cotizaciones públicas (política del dueño): se deja una que nombra al aliado, para comprobar que no influye.
update public.config_solicitudes set emails = '00000000-0000-0000-0000-000000000a03@humo.test' where id = 1;
-- Registros B2B por el camino REAL (registro_b2b_iniciar + registro_b2b_completar, migraciones 324/342): a08 = código válido (ODAIR-2) por aprobar; a09 = código que no existe; a0b = sin código;
-- a0a = registro YA aprobado (ficha 9804) cuyo código ODAIR-1 quedó POR CONFIRMAR (lo aprobó administración, que no puede asignar el referido).
alter table auth.users add column if not exists email_confirmed_at timestamptz;   -- la plantilla local trae un auth.users simplificado
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-000000000a09@humo.test', now(), '{"registro_b2b_codigo": true}'),
  ('00000000-0000-0000-0000-000000000a0a', '00000000-0000-0000-0000-000000000a0a@humo.test', now(), '{"registro_b2b_codigo": true}'),
  ('00000000-0000-0000-0000-000000000a0b', '00000000-0000-0000-0000-000000000a0b@humo.test', now(), '{"registro_b2b_codigo": true}'),
  ('00000000-0000-0000-0000-000000000a0c', '00000000-0000-0000-0000-000000000a0c@humo.test', now(), '{"registro_b2b_codigo": true}') on conflict do nothing;
update auth.users set email_confirmed_at = now(), raw_app_meta_data = '{"registro_b2b_codigo": true}'::jsonb where id = '00000000-0000-0000-0000-000000000a08';
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-000000000a09@humo.test', 'Freelance Codigo Invalido', 'freelance', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000000a0a', '00000000-0000-0000-0000-000000000a0a@humo.test', 'Freelance Ya Aprobado', 'freelance', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000000a0b', '00000000-0000-0000-0000-000000000a0b@humo.test', 'Freelance Sin Codigo', 'freelance', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000000a0c', '00000000-0000-0000-0000-000000000a0c@humo.test', 'Freelance Aprueba Admin', 'freelance', false, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = false, nombre = excluded.nombre;
select public.registro_b2b_iniciar(id, jsonb_build_object('nit', n, 'tipo_documento', 'CC', 'codigo_referido', c, 'acepta_notificaciones', true))
  from (values ('00000000-0000-0000-0000-000000000a08'::uuid, '99001', ' odair-2 '), ('00000000-0000-0000-0000-000000000a09', '99002', 'NOEXISTE'), ('00000000-0000-0000-0000-000000000a0a', '99003', 'ODAIR-1'), ('00000000-0000-0000-0000-000000000a0b', '99004', null), ('00000000-0000-0000-0000-000000000a0c', '99005', 'ODAIR-1')) v(id, n, c);
select public.registro_b2b_completar(id, null) from (values ('00000000-0000-0000-0000-000000000a08'::uuid), ('00000000-0000-0000-0000-000000000a09'), ('00000000-0000-0000-0000-000000000a0a'), ('00000000-0000-0000-0000-000000000a0b'), ('00000000-0000-0000-0000-000000000a0c')) v(id);
update public.usuarios set activo = true, aliado_id = 9804 where id = '00000000-0000-0000-0000-000000000a0a';   -- resultado de aprobar_solicitud_b2b (simulado: ya aprobado, ficha 9804)
update public.b2b_solicitudes set estado = 'aprobada', revisado_por = 'Administracion Humo', revisado_at = now() where usuario_id = '00000000-0000-0000-0000-000000000a0a';

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

-- REFERIDOS (migración 341): referidor, códigos y asignaciones hechas por gerencia (a06) con las funciones REALES.
insert into public.referidores (id, tenant, nombre, tipo_documento, documento, email) overriding system value values (9901, 'mayorista', 'Odair Referidor', 'CC', '7001001', 'odair@humo.test');
select public.referidor_codigo_definir('00000000-0000-0000-0000-000000000a06', 9901, 'ODAIR-1', 0.01, true);
select public.referidor_codigo_definir('00000000-0000-0000-0000-000000000a06', 9901, 'ODAIR-2', 0.02, true);
select public.referido_asignar('00000000-0000-0000-0000-000000000a06', 9801, 9901, 0.01, 'seed');
select public.referido_asignar('00000000-0000-0000-0000-000000000a06', 9802, 9901, 0.02, 'seed');
-- Contratos creados DESPUÉS de las asignaciones (la atribución es la foto de lo vigente al crearse).
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at) values
  ('DTM-7001', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Humo 1', 'Asesor Humo', 1000000, 200000, 'COP', 9801, clock_timestamp()),   -- 1 %: base 800.000 → 8.000, se paga completo
  ('DTM-7002', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Humo 2', 'Asesor Humo', 3000000, 0, 'COP', 9802, clock_timestamp()),        -- 2 %: base 3.000.000 → 60.000, pago parcial
  ('DTM-7003', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Humo 3', 'Asesor Humo', 2500, 0, 'USD', 9801, clock_timestamp()),            -- USD, 1 % → 25, se paga completo
  ('DTM-7004', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Humo 4', 'Asesor Humo', 890000, 0, 'COP', 9802, clock_timestamp()),       -- NETO: PVP original 1.000.000, comisión del aliado 110.000 descontada → cobra 890.000
  ('DTM-7005', 'mayorista', 'bloqueo', 'cancelado',  'Cliente Humo 5', 'Asesor Humo', 1000000, 0, 'COP', 9802, clock_timestamp());
update public.ventas set comision_estado = 'descontada', modo_compra = 'neta', comision_b2b = 110000 where numero_contrato = 'DTM-7004';   -- NETO
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at)
  values ('DTM-7006', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Humo 6', 'Asesor Humo', 1500000, 0, 'COP', 9802, clock_timestamp());   -- SIN comisión del aliado guardada (no hay evidencia de la base)
-- Comisión del aliado = evidencia de la base del referido (misma forma que deja la 205). DTM-7004 (NETO) guarda la base ORIGINAL (1.000.000) y precio bruto; DTM-7006 NO tiene fila.
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio)
select v.numero_contrato, 'mayorista', a.nombre, a.id, case when v.numero_contrato = 'DTM-7004' then 1000000 else v.precio_venta end,
       case when v.numero_contrato = 'DTM-7004' then 1000000 else greatest(0, v.precio_venta - v.impuesto) end, true, 0.10, 0, 0, false, 0,
       case when v.numero_contrato = 'DTM-7004' then 'pagada' else 'pendiente' end, v.numero_contrato = 'DTM-7004'
  from public.ventas v join public.aliados a on a.id = v.aliado_id where v.numero_contrato in ('DTM-7001', 'DTM-7002', 'DTM-7003', 'DTM-7004', 'DTM-7005');
insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, tenant) values
  ('DTM-7001', 'Cliente Humo 1', current_date, 1000000, 'transferencia', 'mayorista'),
  ('DTM-7002', 'Cliente Humo 2', current_date, 1000000, 'transferencia', 'mayorista'),
  ('DTM-7003', 'Cliente Humo 3', current_date, 2500, 'transferencia', 'mayorista');
