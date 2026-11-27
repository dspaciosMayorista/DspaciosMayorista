-- PREFLIGHT 336 + 337 (#40 conversion claim; #18 atomic air voucher). READ ONLY, ONE QUERY (control | observed | expected | verdict). Run BEFORE applying 336 and 337.
-- Verdicts: OK · REVIEW (apply is safe, decide first) · BLOCK. No personal data (contract numbers and counts only).
begin transaction read only;

with
duplicados as (
  select numero_contrato, count(*) as n from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1
),
pendientes as (
  select v.numero_contrato from public.ventas v where v.cotizacion_id is not null and v.financiero_estado = 'pendiente'
),
chequeos as (
  select 1 as n, 'Required objects exist (cotizaciones, vouchers, ventas.financiero_estado, ventas_cotizacion_id_key)' as control,
         ((to_regclass('public.cotizaciones') is not null)::int + (to_regclass('public.vouchers') is not null)::int
          + (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_estado'))::int
          + (exists (select 1 from pg_constraint where conname = 'ventas_cotizacion_id_key'))::int)::text as observado, '4' as esperado,
         case when to_regclass('public.cotizaciones') is not null and to_regclass('public.vouchers') is not null
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_estado')
                   and exists (select 1 from pg_constraint where conname = 'ventas_cotizacion_id_key') then 'OK' else 'BLOCK' end as veredicto
  union all
  select 2, '336 not yet applied (no cotizacion_conversion_reclamo table)',
         (to_regclass('public.cotizacion_conversion_reclamo') is not null)::text, 'false',
         case when to_regclass('public.cotizacion_conversion_reclamo') is null then 'OK' else 'REVIEW' end
  union all
  select 3, '337 not yet applied (no vouchers_vuelo_uno_por_contrato index)',
         (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato'))::text, 'false',
         case when not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato') then 'OK' else 'REVIEW' end
  union all
  select 4, '337 precondition: contracts with MORE THAN ONE air voucher (the unique index cannot be created; resolve by hand, nothing is deleted automatically)',
         (select count(*)::text from duplicados), '0', case when (select count(*) from duplicados) = 0 then 'OK' else 'BLOCK' end
  union all
  select 5, 'Existing air vouchers (informational; 337 keeps them, regeneration updates them in place and keeps their public links)',
         (select count(*)::text from public.vouchers where tipo = 'vuelo'), 'any', 'OK'
  union all
  select 6, 'Conversions in flight or stuck: headers stamped with cotizacion_id still financiero_estado = pendiente (apply 336 when none is running; the reconciler reverts stuck ones)',
         coalesce((select string_agg(numero_contrato, ', ' order by numero_contrato) from (select numero_contrato from pendientes order by numero_contrato limit 15) s), 'none'), 'none',
         case when (select count(*) from pendientes) = 0 then 'OK' else 'REVIEW' end
)
select control, observado as observed, esperado as expected, veredicto as verdict from chequeos order by n;

rollback;
