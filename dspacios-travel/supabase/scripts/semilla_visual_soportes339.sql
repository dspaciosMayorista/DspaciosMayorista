-- Semilla SINTÉTICA (solo bases desechables) para la inspección de la app compilada: soportes de pago con el cupo adicional (339).
-- Aliado con 6 contratos en los estados de cupo que muestra la interfaz; personal interno (gerencia, superadmin, asesor); otro aliado con su propio contrato.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000003390a1', 'ali339@x.test'), ('00000000-0000-4000-8000-0000003390a2', 'otro339@x.test'),
  ('00000000-0000-4000-8000-0000003390b1', 'ger339@x.test'), ('00000000-0000-4000-8000-0000003390b2', 'sup339@x.test'), ('00000000-0000-4000-8000-0000003390b3', 'ven339@x.test')
  on conflict do nothing;
insert into public.aliados (id, nombre, tipo, nit, activo) values
  (8101, 'Agencia Alfa 339', 'agencia', '900339001', true), (8102, 'Freelance Beta 339', 'freelance', '1033900002', true) on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  ('00000000-0000-4000-8000-0000003390a1', 'ali339@x.test', 'Agencia Alfa 339', 'agencia', true, 'mayorista', 8101),
  ('00000000-0000-4000-8000-0000003390a2', 'otro339@x.test', 'Freelance Beta 339', 'freelance', true, 'mayorista', 8102),
  ('00000000-0000-4000-8000-0000003390b1', 'ger339@x.test', 'Gerente 339', 'gerencia', true, 'mayorista', null),
  ('00000000-0000-4000-8000-0000003390b2', 'sup339@x.test', 'Super 339', 'superadmin', true, 'mayorista', null),
  ('00000000-0000-4000-8000-0000003390b3', 'ven339@x.test', 'Asesor 339', 'venta', true, 'mayorista', null)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;

insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, asesor) values
  ('DTM-8301', 'Cliente de nombre muy largo: María Fernanda de los Ángeles Rodríguez-Castañeda y Acompañantes', 'mayorista', 'CARTAGENA', current_date + 40, 'pendiente', 2500000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 339'),
  ('DTM-8302', 'Cliente 8302', 'mayorista', 'SAN ANDRES', current_date + 41, 'pendiente', 1800000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 339'),
  ('DTM-8303', 'Cliente 8303', 'mayorista', 'SANTA MARTA', current_date + 42, 'confirmado', 3200000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 339'),
  ('DTM-8304', 'Cliente 8304', 'mayorista', 'CARTAGENA', current_date + 43, 'confirmado', 2100000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 339'),
  ('DTM-8305', 'Cliente 8305', 'mayorista', 'CARTAGENA', current_date + 44, 'confirmado', 2700000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 339'),
  ('DTM-8306', 'Cliente 8306', 'mayorista', 'SAN ANDRES', current_date + 45, 'confirmado', 2900000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 339'),
  ('DTM-8399', 'Cliente de otro aliado', 'mayorista', 'CARTAGENA', current_date + 46, 'confirmado', 1000000, 'COP', 8102, null, 'Freelance Beta 339', 'freelance', 'Asesor 339');

insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant, fecha_abono) values
  ('DTM-8303', 600000, 'Transferencia', 'mayorista', current_date - 10),
  ('DTM-8304', 500000, 'Transferencia', 'mayorista', current_date - 9),
  ('DTM-8305', 300000, 'Transferencia', 'mayorista', current_date - 8), ('DTM-8305', 300000, 'Transferencia', 'mayorista', current_date - 7), ('DTM-8305', 300000, 'Transferencia', 'mayorista', current_date - 6),
  ('DTM-8306', 400000, 'Transferencia', 'mayorista', current_date - 5), ('DTM-8306', 400000, 'Efectivo', 'mayorista', current_date - 4);

-- Soportes (la base aplica el límite: se insertan en orden y por debajo del máximo abonos + 1).
insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, subido_en) values
  ('DTM-8302', 'mayorista', 'DTM-8302/s1.pdf', 'COMPROBANTE_TRANSFERENCIA_BANCOLOMBIA_ENERO_2026_REF_00998877665544332211_FIRMADO.pdf', 'application/pdf', 182400, repeat('a1', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '3 days'),
  ('DTM-8303', 'mayorista', 'DTM-8303/s1.pdf', 'pago-1.pdf', 'application/pdf', 91000, repeat('b1', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '2 days'),
  ('DTM-8304', 'mayorista', 'DTM-8304/s1.pdf', 'pago-1.pdf', 'application/pdf', 91000, repeat('c1', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '2 days'),
  ('DTM-8304', 'mayorista', 'DTM-8304/s2.png', 'captura-pago-sin-registrar.png', 'image/png', 55000, repeat('c2', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '1 day'),
  ('DTM-8305', 'mayorista', 'DTM-8305/s1.pdf', 'a.pdf', 'application/pdf', 1000, repeat('d1', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '6 days'),
  ('DTM-8305', 'mayorista', 'DTM-8305/s2.pdf', 'b.pdf', 'application/pdf', 1000, repeat('d2', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '5 days'),
  ('DTM-8305', 'mayorista', 'DTM-8305/s3.pdf', 'c.pdf', 'application/pdf', 1000, repeat('d3', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '4 days'),
  ('DTM-8305', 'mayorista', 'DTM-8305/s4.pdf', 'd.pdf', 'application/pdf', 1000, repeat('d4', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '3 days'),
  ('DTM-8306', 'mayorista', 'DTM-8306/s1.pdf', 'p1.pdf', 'application/pdf', 1000, repeat('e1', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '3 days'),
  ('DTM-8306', 'mayorista', 'DTM-8306/s2.pdf', 'p2.pdf', 'application/pdf', 1000, repeat('e2', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '2 days'),
  ('DTM-8306', 'mayorista', 'DTM-8306/s3.pdf', 'p3-sin-registrar.pdf', 'application/pdf', 1000, repeat('e3', 32), '00000000-0000-4000-8000-0000003390a1', now() - interval '1 day');
-- DTM-8305 nace con 3 abonos y 4 soportes (4 = máximo) y luego se anula un abono: queda EXCEDIDO (2 abonos, máximo 3, 4 vigentes).
delete from public.abonos where id = (select min(id) from public.abonos where numero_contrato = 'DTM-8305');
