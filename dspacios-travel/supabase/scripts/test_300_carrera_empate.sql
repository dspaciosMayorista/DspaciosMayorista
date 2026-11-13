-- Carrera de conflictos de la 300 (la usa test_300_promociones_grupo.sh con dos sesiones reales). Variables psql:
--   :id (promoción que se sube a prioridad 7), :espera (segundos con la transacción abierta antes de confirmar).
-- Cada cambio por separado no empata; los dos juntos sí: exactamente uno debe confirmar.
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;
begin;
update public.hotel_temporadas set prioridad = 7 where id = :id;
select pg_sleep(:espera);
commit;
