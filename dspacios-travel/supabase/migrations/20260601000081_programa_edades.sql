-- Edades de niño / infante POR PROGRAMA (circuitos de terceros).
-- Cada proveedor define qué cuenta como niño/infante en SU programa; estas
-- columnas alimentan la validación de pasajeros al reservar el programa.
alter table programas add column if not exists edad_nino_min int default 2;
alter table programas add column if not exists edad_nino_max int default 11;
alter table programas add column if not exists edad_infante_max int default 1;
