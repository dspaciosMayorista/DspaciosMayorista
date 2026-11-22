-- ROLLBACK de la 316 (#62 B4). Borra la tabla de eventos de recuperación consumidos. Solo contiene registros de «ya se usó»; borrarla reabre el uso de
-- enlaces de recuperación ya consumidos mientras su sesión siga viva (15 min). Úsalo solo con el código de B4 retirado.
begin;
drop table if exists public.recuperaciones_consumidas;
commit;
