-- POSTCHECK 338 (ADL-041/042). READ ONLY, ONE QUERY (control | observed | expected | verdict). Run AFTER applying 338. Verdicts: OK · FAIL · REVIEW.
begin transaction read only;

with chequeos as (
  select 1 as n, 'vouchers has servicio_clave, revision (not null, default 0), actualizado_en, huella and estado (not null, default vigente)' as control,
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'vouchers'
            and ((column_name = 'servicio_clave') or (column_name = 'revision' and is_nullable = 'NO' and column_default = '0') or column_name in ('actualizado_en', 'huella') or (column_name = 'estado' and is_nullable = 'NO'))) as observado, '5' as esperado,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vouchers'
                      and ((column_name = 'servicio_clave') or (column_name = 'revision' and is_nullable = 'NO' and column_default = '0') or column_name in ('actualizado_en', 'huella') or (column_name = 'estado' and is_nullable = 'NO'))) = 5 then 'OK' else 'FAIL' end as veredicto
  union all
  select 2, 'every air voucher has a service key (no air voucher without one)',
         (select count(*)::text from public.vouchers where tipo = 'vuelo' and (servicio_clave is null or btrim(servicio_clave) = '')), '0',
         case when not exists (select 1 from public.vouchers where tipo = 'vuelo' and (servicio_clave is null or btrim(servicio_clave) = '')) then 'OK' else 'FAIL' end
  union all
  select 3, 'index per (contract, service) exists and the 337 one-per-contract index is gone',
         ((select count(*) from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_servicio') || '/' || (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato'))::text, '1/0',
         case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_servicio') and not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato') then 'OK' else 'FAIL' end
  union all
  select 4, 'guardar_vouchers_vuelo is SECURITY INVOKER, executable by authenticated, not by anon; the 337 function is gone',
         coalesce((select p.prosecdef::text from pg_proc p where p.proname = 'guardar_vouchers_vuelo'), 'missing') || '/' || coalesce(has_function_privilege('anon', to_regprocedure('public.guardar_vouchers_vuelo(text,jsonb)'), 'execute')::text, 'missing') || '/' || (select count(*) from pg_proc where proname = 'guardar_voucher_vuelo')::text, 'false/false/0',
         case when to_regprocedure('public.guardar_vouchers_vuelo(text,jsonb)') is not null
                   and not (select p.prosecdef from pg_proc p where p.proname = 'guardar_vouchers_vuelo') and not has_function_privilege('anon', to_regprocedure('public.guardar_vouchers_vuelo(text,jsonb)'), 'execute')
                   and has_function_privilege('authenticated', to_regprocedure('public.guardar_vouchers_vuelo(text,jsonb)'), 'execute') and not exists (select 1 from pg_proc where proname = 'guardar_voucher_vuelo') then 'OK' else 'FAIL' end
  union all
  select 5, 'the three 309 functions carry the revision logic and are still SECURITY DEFINER (the superadmin guard is inside them)',
         ((position('''rev''' in pg_get_functiondef('public.seguimiento_referencia(text,text)'::regprocedure)) > 0)::int
          + (position('''rev''' in pg_get_functiondef('public.registrar_seguimiento_contrato(text,uuid,text,text,text,text)'::regprocedure)) > 0)::int
          + (position('vou_actualizado' in pg_get_functiondef('public.fn_gestion_contratos(jsonb,text,integer,integer)'::regprocedure)) > 0)::int)::text, '3',
         case when position('''rev''' in pg_get_functiondef('public.seguimiento_referencia(text,text)'::regprocedure)) > 0
                   and position('''rev''' in pg_get_functiondef('public.registrar_seguimiento_contrato(text,uuid,text,text,text,text)'::regprocedure)) > 0
                   and position('vou_actualizado' in pg_get_functiondef('public.fn_gestion_contratos(jsonb,text,integer,integer)'::regprocedure)) > 0
                   and (select bool_and(p.prosecdef) from pg_proc p where p.proname in ('registrar_seguimiento_contrato', 'fn_gestion_contratos')) then 'OK' else 'FAIL' end
  union all
  select 6, 'right after install no voucher has a revision above 0 (a revision only appears when a regenerated voucher really changes)',
         (select count(*)::text from public.vouchers where revision > 0), '0 right after install',
         case when exists (select 1 from public.vouchers where revision > 0) then 'REVIEW' else 'OK' end
  union all
  select 8, 'contrato_vuelos.servicio_aereo exists, both views expose it, the three triggers exist (leg lock, default service, voucher flag), the read helper and the lock helper are not executable by anon',
         ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_vuelos' and column_name = 'servicio_aereo')
          + (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('contrato_vuelos_basica', 'contrato_vuelos_editor') and column_name = 'servicio_aereo')
          + (select count(*) from pg_trigger where tgrelid = 'public.contrato_vuelos'::regclass and tgname in ('t_00_tramo_candado', 't_tramo_servicio_por_defecto', 't_tramo_marca_vouchers') and not tgisinternal)
          + (case when to_regprocedure('public.servicios_aereos_contrato(text)') is not null and not has_function_privilege('anon', to_regprocedure('public.servicios_aereos_contrato(text)'), 'execute')
                   and to_regprocedure('public.bloquear_voucher_vuelo(text)') is not null and not has_function_privilege('anon', to_regprocedure('public.bloquear_voucher_vuelo(text)'), 'execute') then 1 else 0 end))::text, '7',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_vuelos' and column_name = 'servicio_aereo') = 1
                   and (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('contrato_vuelos_basica', 'contrato_vuelos_editor') and column_name = 'servicio_aereo') = 2
                   and (select count(*) from pg_trigger where tgrelid = 'public.contrato_vuelos'::regclass and tgname in ('t_00_tramo_candado', 't_tramo_servicio_por_defecto', 't_tramo_marca_vouchers') and not tgisinternal) = 3
                   and to_regprocedure('public.servicios_aereos_contrato(text)') is not null and not has_function_privilege('anon', to_regprocedure('public.servicios_aereos_contrato(text)'), 'execute')
                   and to_regprocedure('public.bloquear_voucher_vuelo(text)') is not null and not has_function_privilege('anon', to_regprocedure('public.bloquear_voucher_vuelo(text)'), 'execute') then 'OK' else 'FAIL' end
  union all
  select 9, 'legs left WITHOUT a saved service (historical ambiguity: associate them in the flight editor before generating air vouchers for that contract)',
         (select count(*)::text from public.contrato_vuelos where servicio_aereo is null), '0 (REVIEW otherwise)',
         case when exists (select 1 from public.contrato_vuelos where servicio_aereo is null) then 'REVIEW' else 'OK' end
  union all
  select 10, 'air vouchers that are not «vigente» right after the install (only legacy vouchers of contracts with ambiguous legs: estado revisar, key «legado-…»)',
         (select count(*)::text from public.vouchers where tipo = 'vuelo' and estado <> 'vigente'), '0 (REVIEW otherwise)',
         case when exists (select 1 from public.vouchers where tipo = 'vuelo' and estado <> 'vigente') then 'REVIEW' else 'OK' end
  union all
  select 7, 'air vouchers present (compare with preflight control 4: the install deletes none)',
         (select count(*)::text from public.vouchers where tipo = 'vuelo'), 'same as preflight control 4', 'REVIEW'
)
select control, observado as observed, esperado as expected, veredicto as verdict from chequeos order by n;

rollback;
