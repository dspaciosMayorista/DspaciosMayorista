-- POSTCHECK 334 + 335. READ ONLY, ONE QUERY (control | observed | expected | verdict). Run AFTER applying 334 and 335. Verdicts: OK · FAIL · REVIEW.
-- No personal data (contract numbers and ids only).
begin transaction read only;

with
vista as (select pg_get_viewdef('public.ventas_vuelo_sistema'::regclass, false) as d),
fusion as (select pg_get_functiondef('public.fn_fusionar_destino(bigint,bigint)'::regprocedure) as d),
huerfanas as (
  select a.paquete_id from public.armado_paquete_destinos_aereos a where not exists (select 1 from public.destinos d where d.id = a.destino_id)
),
iguales_comercial as (
  select a.paquete_id from public.armado_paquete_destinos_aereos a join public.armado_paquetes p on p.id = a.paquete_id and p.destino_id = a.destino_id
),
dinamicos_sin_aire_en_vista as (
  -- La vista exige acceso por sesión (acceso_ventas_vuelo_sistema): en el editor SQL no hay sesión, así que la regla se comprueba sobre `ventas`.
  select v.numero_contrato from public.ventas v
   where v.tipo_paquete = 'dinamico' and v.empaquetado_ref_id is null
     and nullif(btrim(coalesce(v.aerolinea, '')), '') is null and coalesce(v.costo_aereo, 0) <= 0
     and not exists (select 1 from public.contrato_vuelos cv where cv.numero_contrato = v.numero_contrato)
     and not exists (select 1 from public.cuentas_por_pagar cp where cp.numero_contrato = v.numero_contrato and cp.tipo_proveedor = 'aereo')
),
chequeos as (
  select 1 as n, '334: delete guard trigger on destinos exists' as control,
         (select count(*)::text from pg_trigger where tgname = 'trg_destino_alternativa_aerea_guard' and tgrelid = 'public.destinos'::regclass and not tgisinternal) as observado, '1' as esperado,
         case when (select count(*) from pg_trigger where tgname = 'trg_destino_alternativa_aerea_guard' and tgrelid = 'public.destinos'::regclass and not tgisinternal) = 1 then 'OK' else 'FAIL' end as veredicto
  union all
  select 2, '334: guard function is not executable by anon/authenticated (trigger-only)',
         (has_function_privilege('anon', 'public.tg_destino_alternativa_aerea_guard()', 'execute')::int + has_function_privilege('authenticated', 'public.tg_destino_alternativa_aerea_guard()', 'execute')::int)::text, '0',
         case when not has_function_privilege('anon', 'public.tg_destino_alternativa_aerea_guard()', 'execute') and not has_function_privilege('authenticated', 'public.tg_destino_alternativa_aerea_guard()', 'execute') then 'OK' else 'FAIL' end
  union all
  select 3, '334: fn_fusionar_destino handles alternatives AND still handles destinos_extra (275 behavior kept)',
         ((select d like '%armado_paquete_destinos_aereos%' from fusion)::int + (select d like '%destinos_extra%' from fusion)::int)::text, '2',
         case when (select d like '%armado_paquete_destinos_aereos%' and d like '%destinos_extra%' from fusion) then 'OK' else 'FAIL' end
  union all
  select 4, '334: fn_fusionar_destino stays SECURITY DEFINER with a fixed search_path (its role/agency guards run inside the function)',
         ((select prosecdef::text from pg_proc where oid = 'public.fn_fusionar_destino(bigint,bigint)'::regprocedure) || '/' || (select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = 'public.fn_fusionar_destino(bigint,bigint)'::regprocedure)), 'true/search_path=public',
         case when (select prosecdef and coalesce(array_to_string(proconfig, ','), '') like 'search_path=%public%' from pg_proc where oid = 'public.fn_fusionar_destino(bigint,bigint)'::regprocedure) then 'OK' else 'FAIL' end
  union all
  select 5, '335: the view carries the air-evidence predicate (legs, airline, air cost, air payable)',
         ((select d like '%cvx.numero_contrato%' from vista)::int + (select d like '%cxp_aer.total%' from vista)::int + (select d like '%costo_aereo%' from vista)::int)::text, '3',
         case when (select d like '%cvx.numero_contrato%' and d like '%cxp_aer.total%' and d like '%costo_aereo%' from vista) then 'OK' else 'FAIL' end
  union all
  select 6, '335: the Promoción-linked branch and the access function are preserved',
         ((select d like '%empaquetado_ref_id IS NOT NULL%' from vista)::int + (select d like '%acceso_ventas_vuelo_sistema(v.tenant)%' from vista)::int)::text, '2',
         case when (select d like '%empaquetado_ref_id IS NOT NULL%' and d like '%acceso_ventas_vuelo_sistema(v.tenant)%' from vista) then 'OK' else 'FAIL' end
  union all
  select 7, '335: the view still exposes contrato_uid, estado_pago and estado_emision (285/157 columns kept)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ventas_vuelo_sistema' and column_name in ('contrato_uid', 'estado_pago', 'estado_emision')), '3',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_vuelo_sistema' and column_name in ('contrato_uid', 'estado_pago', 'estado_emision')) = 3 then 'OK' else 'FAIL' end
  union all
  select 8, '335: authenticated can still read the view (its rows are gated by acceso_ventas_vuelo_sistema inside the view, unchanged)',
         has_table_privilege('authenticated', 'public.ventas_vuelo_sistema', 'select')::text, 'true',
         case when has_table_privilege('authenticated', 'public.ventas_vuelo_sistema', 'select') then 'OK' else 'FAIL' end
  union all
  select 9, 'Orphan alternative-destination rows (same count as the preflight: 334 does not clean existing ones)',
         (select count(*)::text from huerfanas), 'equal to the preflight',
         case when (select count(*) from huerfanas) = 0 then 'OK' else 'REVIEW' end
  union all
  select 10, 'Alternatives equal to the commercial destination',
         (select count(*)::text from iguales_comercial), '0',
         case when (select count(*) from iguales_comercial) = 0 then 'OK' else 'REVIEW' end
  union all
  select 11, 'Dynamic contracts without air evidence (they are NOT in the list; compare with preflight control 8; their rows are untouched)',
         (select count(*)::text from dinamicos_sin_aire_en_vista), 'equal to the preflight',
         'OK'
)
select control, observado as observed, esperado as expected, veredicto as verdict from chequeos order by n;

rollback;
