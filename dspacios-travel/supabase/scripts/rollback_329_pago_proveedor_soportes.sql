-- Rollback 329: removes the payment-evidence metadata (cxp_pago_soportes) and the notice<->payment links. Payments (cxp_pagos) are NOT touched; the Storage bucket and its FILES are NOT removed (delete the objects by hand if wanted).
-- GUARD: with data present this script REFUSES to run (the links and the evidence index would be lost). Back up first, then confirm in the SAME session:   select set_config('app.confirmar_perdida_329', 'si', false);
-- ATOMIC + RACE-SAFE (R3-1): one transaction; bounded lock wait (5 s); both tables are locked ACCESS EXCLUSIVE BEFORE anything is counted, in the same fixed order as rollback 328
-- (hotel_codigos_promocion, solicitudes_proveedor, solicitud_proveedor_eventos, solicitud_proveedor_avisos, solicitud_proveedor_pagos, cxp_pago_soportes). A writer still in flight is waited for and then SEEN by the guard
-- (which refuses); new writers wait until this transaction ends. If a lock is not obtained in 5 s the script FAILS and nothing changes.
-- MAINTENANCE IMPACT: while it runs, linking a notice to a payment or uploading payment evidence waits (milliseconds when no long transaction is open). Run it in a quiet window.
begin;
set local lock_timeout = '5s';
do $$
declare t text;
begin
  foreach t in array array['solicitud_proveedor_pagos','cxp_pago_soportes'] loop
    if to_regclass('public.' || t) is not null then execute format('lock table public.%I in access exclusive mode', t); end if;
  end loop;
end $$;
do $$
declare n_sop bigint := 0; n_lin bigint := 0;
begin
  if to_regclass('public.cxp_pago_soportes') is not null then execute 'select count(*) from public.cxp_pago_soportes' into n_sop; end if;
  if to_regclass('public.solicitud_proveedor_pagos') is not null then execute 'select count(*) from public.solicitud_proveedor_pagos' into n_lin; end if;
  if n_sop + n_lin > 0 and coalesce(current_setting('app.confirmar_perdida_329', true), '') <> 'si' then
    raise exception 'ROLLBACK 329 ABORTADO: borraría datos (soportes=%, vínculos aviso↔pago=%). Respalda y confirma con: select set_config(''app.confirmar_perdida_329'', ''si'', false);', n_sop, n_lin;
  end if;
end $$;
drop table if exists public.solicitud_proveedor_pagos;
drop table if exists public.cxp_pago_soportes;
commit;
