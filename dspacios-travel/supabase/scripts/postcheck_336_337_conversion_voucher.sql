-- POSTCHECK 336 + 337. READ ONLY, ONE QUERY (control | observed | expected | verdict). Run AFTER applying 336 and 337. Verdicts: OK · FAIL · REVIEW.
begin transaction read only;

with chequeos as (
  select 1 as n, '336: claim table exists with RLS on and no direct grants for anon/authenticated' as control,
         ((to_regclass('public.cotizacion_conversion_reclamo') is not null)::int
          + coalesce((select c.relrowsecurity::int from pg_class c where c.oid = to_regclass('public.cotizacion_conversion_reclamo')), 0)
          + (not has_table_privilege('anon', 'public.cotizacion_conversion_reclamo', 'select') and not has_table_privilege('authenticated', 'public.cotizacion_conversion_reclamo', 'select'))::int)::text as observado, '3' as esperado,
         case when to_regclass('public.cotizacion_conversion_reclamo') is not null
                   and (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.cotizacion_conversion_reclamo'))
                   and not has_table_privilege('anon', 'public.cotizacion_conversion_reclamo', 'select')
                   and not has_table_privilege('authenticated', 'public.cotizacion_conversion_reclamo', 'select') then 'OK' else 'FAIL' end as veredicto
  union all
  select 2, '336: claim/release functions are service_role only (SECURITY DEFINER)',
         (has_function_privilege('service_role', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')::int
          + has_function_privilege('anon', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')::int
          + has_function_privilege('authenticated', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')::int
          + has_function_privilege('authenticated', 'public.liberar_conversion_cotizacion(bigint,uuid)', 'execute')::int)::text, '1',
         case when has_function_privilege('service_role', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')
                   and not has_function_privilege('anon', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')
                   and not has_function_privilege('authenticated', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')
                   and not has_function_privilege('authenticated', 'public.liberar_conversion_cotizacion(bigint,uuid)', 'execute')
                   and (select bool_and(p.prosecdef) from pg_proc p where p.proname in ('reclamar_conversion_cotizacion', 'liberar_conversion_cotizacion')) then 'OK' else 'FAIL' end
  union all
  select 3, '336: expired claims left behind (informational; the next attempt takes them over)',
         (select count(*)::text from public.cotizacion_conversion_reclamo where expira_en <= now()), '0 (any is harmless)', 'OK'
  union all
  select 4, '336: live claims right now (a conversion is running)',
         (select count(*)::text from public.cotizacion_conversion_reclamo where expira_en > now()), '0 when idle',
         case when (select count(*) from public.cotizacion_conversion_reclamo where expira_en > now()) = 0 then 'OK' else 'REVIEW' end
  union all
  select 5, '337: unique partial index exists (one air voucher per contract)',
         (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato' and indexdef ilike '%unique%' and indexdef ilike '%tipo%vuelo%'), '1',
         case when (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato' and indexdef ilike '%unique%' and indexdef ilike '%tipo%vuelo%') = 1 then 'OK' else 'FAIL' end
  union all
  select 6, '337: guardar_voucher_vuelo is SECURITY INVOKER (RLS and the contract identity guard still apply) and not executable by anon',
         ((select p.prosecdef::text from pg_proc p where p.proname = 'guardar_voucher_vuelo') || '/' || has_function_privilege('anon', 'public.guardar_voucher_vuelo(text,jsonb)', 'execute')::text), 'false/false',
         case when not (select p.prosecdef from pg_proc p where p.proname = 'guardar_voucher_vuelo') and not has_function_privilege('anon', 'public.guardar_voucher_vuelo(text,jsonb)', 'execute')
                   and has_function_privilege('authenticated', 'public.guardar_voucher_vuelo(text,jsonb)', 'execute') then 'OK' else 'FAIL' end
  union all
  select 7, '337: no contract has more than one air voucher',
         (select count(*)::text from (select 1 from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1) d), '0',
         case when not exists (select 1 from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1) then 'OK' else 'FAIL' end
)
select control, observado as observed, esperado as expected, veredicto as verdict from chequeos order by n;

rollback;
