-- Migración 135: contrato_vuelos vuelve a ser "1 fila = 1 trayecto"
--
-- La migración 030 le agregó a contrato_vuelos columnas de ida Y regreso
-- (vuelo_ida/vuelo_regreso, hora_salida_ida/hora_salida_reg, etc.), forzando
-- a mezclar dos trayectos en una sola fila. Eso rompe cuando hay más de un
-- vuelo (ej. multi-ciudad) o cuando conviene registrar cada tramo por
-- separado. El shape ORIGINAL de la tabla (migración 010) ya era correcto:
-- una fila = un trayecto (origen, destino, fecha, aerolínea). Esta migración
-- agrega las columnas que faltaban con nombre genérico (no atadas a
-- ida/regreso) para completar ese modelo: número de vuelo y horas.
--
-- No se borran columnas viejas (vuelo_ida/vuelo_regreso/hora_*_ida/hora_*_reg
-- de la 030): siguen existiendo para los contratos ya creados con ese shape
-- (ContratoDocumento las sigue leyendo como fallback). El código nuevo ya no
-- las escribe.

alter table public.contrato_vuelos
  add column if not exists numero_vuelo  text,
  add column if not exists hora_salida   text,
  add column if not exists hora_llegada  text,
  add column if not exists direccion     text; -- 'ida' | 'regreso' | null (tramo suelto)
