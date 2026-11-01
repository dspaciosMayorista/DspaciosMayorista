-- Fixture de la prueba de COBERTURA de evidencia (fila 12 del postcheck 258). Solo para bases LOCALES desechables, dentro de begin ... rollback (lo orquesta test_258_gates.sh, paso 3b).
-- Cada paquete dibuja un caso distinto de pareja paquete + fecha_ida publicada frente a la evidencia (generación publicada = tarifario_generacion_publicada, regla vigente = 1):
--   9101  2 fechas, SIN evidencia                                    -> faltan 2/2
--   9102  2 fechas, evidencia SOLO de una (el caso del hallazgo)     -> faltan 1/2   (un EXISTS por paquete lo daba por cubierto)
--   9103  2 fechas, evidencia vigente de ambas                       -> completo, NO aparece
--   9104  1 fecha, evidencia de una generación anterior              -> faltan 1/1
--   9105  1 fecha, evidencia con otra regla                          -> faltan 1/1
--   9106  1 fila publicada SIN fecha_ida (no se puede acreditar)     -> faltan 1/1
--   9107  paquete inactivo con 1 fecha y sin evidencia               -> fuera de la vista publicable, NO cuenta
-- Totales esperados: faltan 6 de 9 fechas · 5 paquetes.
insert into public.armado_paquetes (id, nombre, tipo, activo, tarifario_estado, tarifario_generacion, tarifario_generacion_publicada, tarifario_snapshot_publicable) values
 (9101, 'COB A sin evidencia',          'bloqueo', true,  'listo', 3, 3, true),
 (9102, 'COB B evidencia de una fecha', 'dinamico', true, 'listo', 5, 5, true),
 (9103, 'COB C completo',               'bloqueo', true,  'listo', 4, 4, true),
 (9104, 'COB D generacion anterior',    'dinamico', true, 'listo', 7, 7, true),
 (9105, 'COB E otra regla',             'bloqueo', true,  'listo', 2, 2, true),
 (9106, 'COB F sin fecha_ida',          'bloqueo', true,  'listo', 2, 2, true),
 (9107, 'COB G inactivo',               'bloqueo', false, 'listo', 2, 2, true);
insert into public.tarifario_resultado (paquete_id, modulo, paquete_activo, fecha_ida) values
 (9101, 'bloqueo', true, '2027-01-10'), (9101, 'bloqueo', true, '2027-01-17'),
 (9102, 'dinamico', true, '2027-02-10'), (9102, 'dinamico', true, '2027-02-17'),
 (9103, 'bloqueo', true, '2027-03-10'), (9103, 'bloqueo', true, '2027-03-17'),
 (9104, 'dinamico', true, '2027-04-10'),
 (9105, 'bloqueo', true, '2027-05-10'),
 (9106, 'bloqueo', true, null),
 (9107, 'bloqueo', false, '2027-07-10');
insert into public.tarifario_composicion_publicada (paquete_id, fecha_ida, generacion, regla, servicios_incluidos) values
 (9102, '2027-02-10', 5, 1, '[]'),
 (9103, '2027-03-10', 4, 1, '[]'), (9103, '2027-03-17', 4, 1, '[10]'),
 (9104, '2027-04-10', 6, 1, '[]'),
 (9105, '2027-05-10', 2, 2, '[]');
