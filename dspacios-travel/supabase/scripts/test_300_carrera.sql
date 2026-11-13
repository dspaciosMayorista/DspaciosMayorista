-- Carrera de la 300 (la usa test_300_promociones_grupo.sh con dos sesiones reales). Variables psql:
--   :grupo, :valor, :espera (segundos con la transacción abierta después de guardar).
-- Ambas sesiones guardan sobre la MISMA foto (sin reglas): la segunda debe esperar el candado y recibir PT409.
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;
begin;
select public.promocion_guardar_reglas(930120, 930101,
  jsonb_build_array(jsonb_build_object('grupo_id', :'grupo', 'valor', :valor, 'dias', null)),
  '{"base":930101,"reglas":[]}');
select pg_sleep(:espera);
commit;
