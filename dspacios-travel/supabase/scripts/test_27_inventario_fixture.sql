-- FIXTURE SINTÉTICO del inventario 27 (solo base local desechable; termina en ROLLBACK cuando se corre con test_27_inventario.sh). Todo ficticio.
-- Esperado calculado A MANO (no con la consulta):
--   mayorista / bloqueo            : contratos 6 (1-6), titulares 3 (1000001, 1000002, 1000003), sin documento 2 (#5 nulo, #6 corto «123»), con doc sin tipo 1 (#2),
--                                    en contactos 1 (#1), en personas 1 (#2), en ninguno 2 (#3 y #4, el MISMO titular), titulares en ninguno 1. El anulado (#7) no cuenta.
--   mayorista / porcion_terrestre  : contratos 1, titulares 1, sin documento 0, con doc sin tipo 1, en contactos 1 (contacto SIN agencia vale para ambas), en ninguno 0.
--   mayorista / (todos)            : contratos 7, titulares 4, sin documento 2, sin tipo 2, contactos 2, personas 1, en ninguno 2, titulares en ninguno 1.
--   minorista / dinamico           : contratos 1 (doc 2000001; su contacto es de OTRA agencia → no cuenta), en ninguno 1, titulares en ninguno 1.
--   minorista / bloqueo            : contratos 1 (doc 2000002 en personas de minorista), en personas 1, en ninguno 0.
--   minorista / (todos)            : contratos 2, titulares 2, personas 1, contactos 0, en ninguno 1.
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, cliente_documento, cliente_tipo_documento) values
  ('DTM-9001', 'mayorista', 'bloqueo', 'confirmado', 'Titular Uno',    '1000001',    'CC'),
  ('DTM-9002', 'mayorista', 'bloqueo', 'confirmado', 'Titular Dos',    '1.000.002',  null),
  ('DTM-9003', 'mayorista', 'bloqueo', 'pendiente',  'Titular Tres',   '1000003',    'CC'),
  ('DTM-9004', 'mayorista', 'bloqueo', 'pendiente',  'Titular Tres',   '1000003',    'CC'),
  ('DTM-9005', 'mayorista', 'bloqueo', 'confirmado', 'Sin Documento',  null,         null),
  ('DTM-9006', 'mayorista', 'bloqueo', 'confirmado', 'Documento Corto', '123',       'CC'),
  ('DTM-9007', 'mayorista', 'bloqueo', 'anulado',    'Anulado',        '1000009',    'CC'),
  ('DTM-9008', 'mayorista', 'porcion_terrestre', 'confirmado', 'Titular Ocho', '1000010', null),
  ('MIN-00-9009', 'minorista', 'dinamico', 'confirmado', 'Titular Nueve', '2000001', 'CC'),
  ('MIN-00-9010', 'minorista', 'bloqueo',  'confirmado', 'Titular Diez',  '2000002', 'CC');
insert into public.crm_contactos (categoria, nombre, documento, tenant) values
  ('cliente_final', 'Contacto Uno',   '1000001', 'mayorista'),
  ('cliente_final', 'Contacto Ocho',  '1000010', null),
  ('cliente_final', 'Contacto Nueve', '2000001', 'mayorista');   -- otra agencia: no representa al titular del contrato minorista MIN-00-9009
insert into public.personas (tenant, tipo_doc_original, documento_original) values
  ('mayorista', 'CC', '1000002'),
  ('minorista', 'CC', '2000002');
