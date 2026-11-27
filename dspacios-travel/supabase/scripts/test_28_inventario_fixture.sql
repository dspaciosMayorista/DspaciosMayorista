-- FIXTURE SINTÉTICO del inventario 28 (solo base local desechable). Todo ficticio. Esperado calculado A MANO (ver los archivos test_28_*.esperado.txt):
--   Grupo DUP-1 (mayorista): usuario `venta` «Pepe Prueba» y usuario `freelance` «pepe prueba » (mayúsculas/espacio distintos: debe normalizar) con aliado A1.
--   Grupo DUP-2 (minorista): `venta` «Luis Doble» y `freelance` «LUIS DOBLE».
--   C28-2: TODOS los usuarios del fixture empiezan por el mismo prefijo `00000000` (8 caracteres): un prefijo no distingue ni los perfiles de un grupo ni los dos grupos; las etapas devuelven el UUID completo.
--   NO son grupos: «Ana Sola» (solo `venta`), «Rosa Inactiva» (su freelance está INACTIVO) y «Pepe Prueba» como freelance de minorista (otra agencia: no cruza con el `venta` de mayorista).
--   Ventas del grupo DUP-1: s1 y s2 solo texto en `asesor` · s3 freelance_nombre + b2b_usuario_id del perfil freelance (con comisión) · s4 solo b2b_usuario_id freelance ·
--   s5 solo aliado A1 + texto freelance (con comisión) · s6 aliado A2 (otro) + texto freelance · s7 texto en asesor + b2b freelance pero tipo_asesor 'interno' (conflicto) ·
--   s8 texto en asesor + b2b_usuario_id de un tercer usuario · s9 solo b2b_usuario_id del perfil venta. Fuera de grupo: DTM-9110 (Ana Sola) y MIN-00-9112 (Pepe en minorista).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000028001', 'v28-venta@x.test'), ('00000000-0000-0000-0000-000000028002', 'v28-free@x.test'),
  ('00000000-0000-0000-0000-000000028003', 'v28-otro@x.test'),  ('00000000-0000-0000-0000-000000028004', 'v28-ana@x.test'),
  ('00000000-0000-0000-0000-000000028005', 'v28-rosa-v@x.test'), ('00000000-0000-0000-0000-000000028006', 'v28-rosa-f@x.test'),
  ('00000000-0000-0000-0000-000000028007', 'v28-pepe-min@x.test'), ('00000000-0000-0000-0000-000000028008', 'v28-luis-v@x.test'),
  ('00000000-0000-0000-0000-000000028009', 'v28-luis-f@x.test') on conflict do nothing;
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9701, 'Aliado A1 Sintetico', '97010', 'freelance', 0.1, false, 0, true), (9702, 'Aliado A2 Sintetico', '97020', 'freelance', 0.1, false, 0, true) on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  ('00000000-0000-0000-0000-000000028001', 'v28-venta@x.test',    'Pepe Prueba',   'venta',     true,  'mayorista', null),
  ('00000000-0000-0000-0000-000000028002', 'v28-free@x.test',     'pepe prueba ',  'freelance', true,  'mayorista', 9701),
  ('00000000-0000-0000-0000-000000028003', 'v28-otro@x.test',     'Otro Aliado',   'agencia',   true,  'mayorista', null),
  ('00000000-0000-0000-0000-000000028004', 'v28-ana@x.test',      'Ana Sola',      'venta',     true,  'mayorista', null),
  ('00000000-0000-0000-0000-000000028005', 'v28-rosa-v@x.test',   'Rosa Inactiva', 'venta',     true,  'mayorista', null),
  ('00000000-0000-0000-0000-000000028006', 'v28-rosa-f@x.test',   'Rosa Inactiva', 'freelance', false, 'mayorista', null),
  ('00000000-0000-0000-0000-000000028007', 'v28-pepe-min@x.test', 'Pepe Prueba',   'freelance', true,  'minorista', null),
  ('00000000-0000-0000-0000-000000028008', 'v28-luis-v@x.test',   'Luis Doble',    'venta',     true,  'minorista', null),
  ('00000000-0000-0000-0000-000000028009', 'v28-luis-f@x.test',   'LUIS DOBLE',    'freelance', true,  'minorista', null)
  on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, tipo_asesor, canal, freelance_nombre, b2b_usuario_id, aliado_id) values
  ('DTM-9101', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S1', 'Pepe Prueba',  'interno',   'B2C', null,          null, null),
  ('DTM-9102', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S2', ' PEPE PRUEBA', 'interno',   'B2C', null,          null, null),
  ('DTM-9103', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S3', 'Sin dato',     'freelance', 'B2B', 'Pepe Prueba', '00000000-0000-0000-0000-000000028002', null),
  ('DTM-9104', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S4', 'Sin dato',     'freelance', 'B2B', null,          '00000000-0000-0000-0000-000000028002', null),
  ('DTM-9105', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S5', 'Sin dato',     'freelance', 'B2B', 'Pepe Prueba', null, 9701),
  ('DTM-9106', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S6', 'Sin dato',     'freelance', 'B2B', 'Pepe Prueba', null, 9702),
  ('DTM-9107', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S7', 'Pepe Prueba',  'interno',   'B2C', null,          '00000000-0000-0000-0000-000000028002', null),
  ('DTM-9108', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S8', 'Pepe Prueba',  'agencia',   'B2B', null,          '00000000-0000-0000-0000-000000028003', null),
  ('DTM-9109', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S9', 'Sin dato',     'freelance', 'B2B', null,          '00000000-0000-0000-0000-000000028001', null),
  ('DTM-9110', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Ana', 'Ana Sola',    'interno',   'B2C', null,          null, null),
  ('MIN-00-9111', 'minorista', 'bloqueo', 'confirmado', 'Cliente Luis', 'Luis Doble',  'interno', 'B2C', null, null, null),
  ('MIN-00-9112', 'minorista', 'bloqueo', 'confirmado', 'Cliente Pepe Min', 'Pepe Prueba', 'interno', 'B2C', null, null, null);
-- C28-1 (coincidencia estable por aliado) — ventas añadidas al grupo DUP-1 (el perfil freelance está enlazado al aliado 9701; otro aliado es 9702):
--   s10 DTM-9120: SOLO aliado 9701 (b2b_usuario_id NULL) y nombres que NO coinciden con nadie → debe entrar por aliado_id (ID_ALIADO_FREELANCE).
--   s11 DTM-9121: coincide por las CUATRO evidencias a la vez (asesor, freelance_nombre, b2b freelance, aliado 9701) → cuenta UNA sola vez (ID_PERFIL_FREELANCE).
--   s12 DTM-9122: b2b_usuario_id = perfil freelance pero aliado 9702 (otro) → identificadores en conflicto (CONFLICTO_ID_VS_ALIADO).
--   s13 DTM-9123: b2b_usuario_id de un tercer usuario pero aliado 9701 (el del freelance) → conflicto (CONFLICTO_ID_VS_ALIADO), entra por aliado_id.
--   s14 MIN-00-9124: aliado 9701 pero la venta es de MINORISTA (el grupo es de mayorista) → NO se atribuye: control 3 / FUERA_DE_AGENCIA.
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, tipo_asesor, canal, freelance_nombre, b2b_usuario_id, aliado_id) values
  ('DTM-9120', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S10', 'Zoe Distinta',  'freelance', 'B2B', 'Otra Persona', null, 9701),
  ('DTM-9121', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S11', 'Pepe Prueba',   'freelance', 'B2B', 'Pepe Prueba',  '00000000-0000-0000-0000-000000028002', 9701),
  ('DTM-9122', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S12', 'Sin dato',      'freelance', 'B2B', null,           '00000000-0000-0000-0000-000000028002', 9702),
  ('DTM-9123', 'mayorista', 'bloqueo', 'confirmado', 'Cliente S13', 'Sin dato',      'agencia',   'B2B', null,           '00000000-0000-0000-0000-000000028003', 9701),
  ('MIN-00-9124', 'minorista', 'bloqueo', 'confirmado', 'Cliente S14', 'Sin dato',   'freelance', 'B2B', null,           null, 9701);
-- Comisión B2B ya registrada en s3 y s5 (solo se CUENTA; nada la modifica).
insert into public.aliados_b2b (numero_contrato, aliado, tenant) values ('DTM-9103', 'Aliado A1 Sintetico', 'mayorista'), ('DTM-9105', 'Aliado A1 Sintetico', 'mayorista');
