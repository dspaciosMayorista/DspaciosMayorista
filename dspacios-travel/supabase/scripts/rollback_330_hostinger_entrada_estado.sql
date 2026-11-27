-- Rollback 330: removes the Hostinger sweep cursor and the parked-replies backlog. Nothing else depends on them (the recorded reply EVENTS live in solicitud_proveedor_eventos and are NOT touched).
-- Consequence: the next sweep starts from scratch (idempotent: recorded replies are skipped) and the parked (failed-download) replies are forgotten until a sweep finds them again while they are still inside the 72 h window.
-- GUARD: with a pending backlog this script REFUSES to run. Confirm in the SAME session:   select set_config('app.confirmar_perdida_330', 'si', false);
-- ATOMIC + RACE-SAFE (same pattern as rollbacks 322–329): one transaction, bounded lock wait (5 s), both tables locked ACCESS EXCLUSIVE in a fixed order (estado, pendientes) BEFORE anything is counted; a lock timeout leaves everything unchanged.
begin;
set local lock_timeout = '5s';
do $$
declare t text;
begin
  foreach t in array array['hostinger_estado_buzon', 'hostinger_respuestas_pendientes'] loop
    if to_regclass('public.' || t) is not null then execute format('lock table public.%I in access exclusive mode', t); end if;
  end loop;
end $$;
do $$
declare n_pend bigint := 0;
begin
  if to_regclass('public.hostinger_respuestas_pendientes') is not null then execute 'select count(*) from public.hostinger_respuestas_pendientes' into n_pend; end if;
  if n_pend > 0 and coalesce(current_setting('app.confirmar_perdida_330', true), '') <> 'si' then
    raise exception 'ROLLBACK 330 ABORTADO: hay % respuesta(s) de proveedor pendientes de descarga. Procésalas o confirma la pérdida con: select set_config(''app.confirmar_perdida_330'', ''si'', false);', n_pend;
  end if;
end $$;
drop function if exists public.hostinger_estado_avanzar(text, integer, bigint, bigint, bigint, timestamptz);
drop function if exists public.hostinger_estado_leer(text);
drop table if exists public.hostinger_respuestas_pendientes;
drop table if exists public.hostinger_estado_buzon;
commit;
