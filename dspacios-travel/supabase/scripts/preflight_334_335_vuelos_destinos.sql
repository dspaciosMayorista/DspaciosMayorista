-- PREFLIGHT 334 + 335 (#29 alternative air destinations in merge/delete; #37 land-only contracts out of packaged flights).
-- READ ONLY, ONE QUERY (control | observed | expected | verdict). Run BEFORE applying 334 and 335. Verdicts: OK · REVIEW (apply is safe, decide first) · BLOCK.
-- It changes nothing and lists no personal data (contract numbers and ids only).
begin transaction read only;

with
huerfanas as (
  select a.paquete_id, a.destino_id from public.armado_paquete_destinos_aereos a
   where not exists (select 1 from public.destinos d where d.id = a.destino_id)
),
iguales_comercial as (
  select a.paquete_id, a.destino_id from public.armado_paquete_destinos_aereos a
    join public.armado_paquetes p on p.id = a.paquete_id and p.destino_id = a.destino_id
),
sin_aire as (
  -- Contratos `dinamico` que HOY están en la lista y dejarán de estar con la 335 (sin tramo, sin aerolínea, sin costo aéreo y sin CxP aérea).
  select v.numero_contrato from public.ventas v
   where v.tipo_paquete = 'dinamico' and v.empaquetado_ref_id is null
     and nullif(btrim(coalesce(v.aerolinea, '')), '') is null
     and coalesce(v.costo_aereo, 0) <= 0
     and not exists (select 1 from public.contrato_vuelos cv where cv.numero_contrato = v.numero_contrato)
     and not exists (select 1 from public.cuentas_por_pagar cp where cp.numero_contrato = v.numero_contrato and cp.tipo_proveedor = 'aereo')
),
vista as (select pg_get_viewdef('public.ventas_vuelo_sistema'::regclass, false) as d),
fusion as (select pg_get_functiondef('public.fn_fusionar_destino(bigint,bigint)'::regprocedure) as d),
chequeos as (
  select 1 as n, 'Required objects exist (armado_paquete_destinos_aereos, ventas_vuelo_sistema, fn_fusionar_destino)' as control,
         ((to_regclass('public.armado_paquete_destinos_aereos') is not null)::int + (to_regclass('public.ventas_vuelo_sistema') is not null)::int
          + (to_regprocedure('public.fn_fusionar_destino(bigint,bigint)') is not null)::int)::text as observado, '3' as esperado,
         case when to_regclass('public.armado_paquete_destinos_aereos') is not null and to_regclass('public.ventas_vuelo_sistema') is not null
                   and to_regprocedure('public.fn_fusionar_destino(bigint,bigint)') is not null then 'OK' else 'BLOCK' end as veredicto
  union all
  select 2, 'Migration 275 applied (fn_fusionar_destino re-points paquete_din.destinos_extra)',
         (select (d like '%destinos_extra%')::text from fusion), 'true',
         case when (select d like '%destinos_extra%' from fusion) then 'OK' else 'BLOCK' end
  union all
  select 3, '334 not yet applied (no delete guard on destinos, no alternatives block in the merge)',
         ((select count(*) from pg_trigger where tgname = 'trg_destino_alternativa_aerea_guard' and not tgisinternal)
          + (select (d like '%armado_paquete_destinos_aereos%')::int from fusion))::text, '0',
         case when (select count(*) from pg_trigger where tgname = 'trg_destino_alternativa_aerea_guard' and not tgisinternal) = 0
                   and not (select d like '%armado_paquete_destinos_aereos%' from fusion) then 'OK' else 'REVIEW' end
  union all
  select 4, '335 not yet applied (view without the air-evidence predicate)',
         (select (d like '%cvx.numero_contrato%')::text from vista), 'false',
         case when not (select d like '%cvx.numero_contrato%' from vista) then 'OK' else 'REVIEW' end
  union all
  select 5, '335 precondition: the dynamic predicate appears exactly once in the live view definition',
         (select count(*)::text from regexp_matches((select d from vista), 'v\.tipo_paquete = ''dinamico''::text', 'g')), '1',
         case when (select count(*) from regexp_matches((select d from vista), 'v\.tipo_paquete = ''dinamico''::text', 'g')) = 1
                   or (select d like '%cvx.numero_contrato%' from vista) then 'OK' else 'BLOCK' end
  union all
  select 6, 'Alternative air destinations pointing at a destination that no longer exists (orphans, NOT cleaned by 334; decide by hand)',
         (select count(*)::text from huerfanas), '0',
         case when (select count(*) from huerfanas) = 0 then 'OK' else 'REVIEW' end
  union all
  select 7, 'Alternatives equal to the package commercial destination (invalid since 220; 334 drops such rows only when it merges)',
         (select count(*)::text from iguales_comercial), '0',
         case when (select count(*) from iguales_comercial) = 0 then 'OK' else 'REVIEW' end
  union all
  select 8, 'Dynamic contracts without any air evidence that LEAVE the packaged-flights list with 335 (data untouched; first 15 listed in the next control)',
         (select count(*)::text from sin_aire), 'owner expects these to be land-only',
         case when (select count(*) from sin_aire) = 0 then 'OK' else 'REVIEW' end
  union all
  select 9, 'Sample of those contract numbers (REVIEW: confirm they are land-only; an air operation with no leg, airline, air cost or air payable would also leave)',
         coalesce((select string_agg(numero_contrato, ', ' order by numero_contrato) from (select numero_contrato from sin_aire order by numero_contrato limit 15) s), 'none'), 'n/a',
         case when (select count(*) from sin_aire) = 0 then 'OK' else 'REVIEW' end
  union all
  select 10, 'ventas.cotizacion_id unique key exists (one contract per quotation; guards double conversion)',
         (select count(*)::text from pg_constraint where conname = 'ventas_cotizacion_id_key'), '1',
         case when (select count(*) from pg_constraint where conname = 'ventas_cotizacion_id_key') = 1 then 'OK' else 'BLOCK' end
)
select control, observado as observed, esperado as expected, veredicto as verdict from chequeos order by n;

rollback;
