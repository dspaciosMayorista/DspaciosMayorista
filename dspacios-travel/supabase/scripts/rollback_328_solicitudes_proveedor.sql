-- Rollback 328: removes EVERYTHING migration 328 created (supplier requests/payment notices, events, notices, the promotion-code catalogue and every function/trigger/policy/guard row). Vouchers and payments are NOT touched.
-- ORDER: roll back 329 FIRST (it depends on solicitudes_proveedor). Rolling back 328 DELETES data: every request, event, notice and configured promotion code is lost.
-- GUARD: with data present this script REFUSES to run. Take a backup/export first, then confirm in the SAME session:   select set_config('app.confirmar_perdida_328', 'si', false);
-- ATOMIC + RACE-SAFE (R3-1): one transaction; bounded lock wait (5 s); every table this script can drop is locked ACCESS EXCLUSIVE, in ONE fixed parent-to-child order shared with rollback 329
-- (hotel_codigos_promocion, solicitudes_proveedor, solicitud_proveedor_eventos, solicitud_proveedor_avisos, solicitud_proveedor_pagos, cxp_pago_soportes), BEFORE anything is counted. A writer that is still in flight
-- is waited for and then SEEN by the guard (which refuses); new writers wait until this transaction ends. If a lock is not obtained in 5 s the script FAILS and nothing (data, schema, guard row) changes.
-- MAINTENANCE IMPACT: while it runs, requests/notices/codes cannot be read or written (milliseconds when no long transaction is open). Run it in a quiet window.
begin;
set local lock_timeout = '5s';
do $$
declare t text;
begin
  foreach t in array array['hotel_codigos_promocion','solicitudes_proveedor','solicitud_proveedor_eventos','solicitud_proveedor_avisos','solicitud_proveedor_pagos','cxp_pago_soportes'] loop
    if to_regclass('public.' || t) is not null then execute format('lock table public.%I in access exclusive mode', t); end if;
  end loop;
end $$;
do $$
declare n_sol bigint := 0; n_ev bigint := 0; n_av bigint := 0; n_cod bigint := 0;
begin
  if to_regclass('public.solicitud_proveedor_pagos') is not null or to_regclass('public.cxp_pago_soportes') is not null then
    raise exception 'ROLLBACK 328 ABORTADO: la 329 sigue aplicada (solicitud_proveedor_pagos / cxp_pago_soportes dependen de solicitudes_proveedor). Revierte primero la 329.';
  end if;
  if to_regclass('public.solicitudes_proveedor') is not null then execute 'select count(*) from public.solicitudes_proveedor' into n_sol; end if;
  if to_regclass('public.solicitud_proveedor_eventos') is not null then execute 'select count(*) from public.solicitud_proveedor_eventos' into n_ev; end if;
  if to_regclass('public.solicitud_proveedor_avisos') is not null then execute 'select count(*) from public.solicitud_proveedor_avisos' into n_av; end if;
  if to_regclass('public.hotel_codigos_promocion') is not null then execute 'select count(*) from public.hotel_codigos_promocion' into n_cod; end if;
  if n_sol + n_ev + n_av + n_cod > 0 and coalesce(current_setting('app.confirmar_perdida_328', true), '') <> 'si' then
    raise exception 'ROLLBACK 328 ABORTADO: borraría datos (solicitudes=%, eventos=%, avisos=%, códigos de promoción=%). Exporta/respalda y confirma con: select set_config(''app.confirmar_perdida_328'', ''si'', false);', n_sol, n_ev, n_av, n_cod;
  end if;
end $$;

-- identity (284): the guard row and the trigger go first so the installer does not see an unclassified table
delete from public.contrato_guardas_config where tabla = 'solicitudes_proveedor';
drop table if exists public.solicitud_proveedor_avisos;
drop table if exists public.solicitud_proveedor_eventos;
drop table if exists public.solicitudes_proveedor;            -- drops its triggers (uid, code, audit, guard) and policies with it
drop table if exists public.hotel_codigos_promocion;          -- drops trg_codigo_promocion_coherente / audit / policies
drop function if exists public.registrar_evento_solicitud_proveedor(bigint, text, text, text, jsonb, uuid[]);
drop function if exists public.reclamar_envio_solicitud_proveedor(bigint, text, timestamptz, integer);
drop function if exists public.solicitud_proveedor_rango(text);
drop function if exists public.fn_solicitud_proveedor_uid();
drop function if exists public.fn_solicitud_proveedor_codigo();
drop function if exists public.fn_codigo_promocion_coherente();
select public.contrato_instalar_guardas();
commit;
