-- POSTCHECK 348 (TRM de costos provisional de obligaciones previstas) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 348.
with t as (
  select to_regclass('public.contrato_trm_costo_historial') as hist,
         (select relrowsecurity from pg_class where oid = to_regclass('public.contrato_trm_costo_historial')) as rls,
         (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'contrato_trm_costo_historial' and grantee in ('anon', 'authenticated', 'public'))::int as grants_cliente,
         to_regprocedure('public.prevista_trm_costo_actualizar(text,text,uuid,text,numeric,numeric,text)') as fn,
         (select count(*) from pg_trigger where tgname = 'trg_cxp_costo_inmutable' and not tgisinternal)::int as trg236,
         (select count(*) from public.cuentas_por_pagar where valor_cop_costo is not null)::int as cxp_con_par,
         (select count(*) from public.contrato_trm_costo_historial)::int as filas_hist,
         (select p.prosecdef and p.prosrc like '%valor_cop_costo%' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.prevista_cxp_aplicar(text,bigint[],jsonb,jsonb)')) as prev_ok,
         (select count(*) from public.contrato_trm_costo_historial h where not exists (select 1 from public.ventas v where v.numero_contrato = h.numero_contrato))::int as hist_huerfano
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'historial existe con RLS activa y SIN privilegios para anon/authenticated' as control, coalesce(hist::text, 'no existe') || ' / rls=' || coalesce(rls::text, 'null') || ' / grants cliente=' || grants_cliente as observado, 'existe / rls=true / grants cliente=0' as esperado, case when hist is not null and rls and grants_cliente = 0 then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'prevista_trm_costo_actualizar: SECURITY DEFINER; solo service_role la ejecuta',
         case when fn is null then 'no existe' else (select p.prosecdef::text from pg_proc p where p.oid = fn) || ' / service_role=' || has_function_privilege('service_role', fn, 'execute')::text || ' authenticated=' || has_function_privilege('authenticated', fn, 'execute')::text || ' anon=' || has_function_privilege('anon', fn, 'execute')::text end,
         'true / service_role=true authenticated=false anon=false',
         case when fn is not null and (select p.prosecdef from pg_proc p where p.oid = fn) and has_function_privilege('service_role', fn, 'execute') and not has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute') then 'OK' else 'FALLO' end from t
  union all select 3, 'La inmutabilidad de la 236 en cuentas_por_pagar sigue intacta (disparador presente)', trg236::text, '1', case when trg236 = 1 then 'OK' else 'FALLO' end from t
  union all select 4, 'INFO: CxP con equivalente de costos — debe ser IGUAL a la cifra del preflight (la 348 no las toca)', cxp_con_par::text, 'igual al preflight', 'INFO' from t
  union all select 5, 'Historial sin contrato (huérfano)', hist_huerfano::text, '0', case when hist_huerfano = 0 then 'OK' else 'FALLO' end from t
  union all select 7, 'prevista_cxp_aplicar recalcula el equivalente de una prevista con par al cambiar su valor; SECURITY DEFINER y solo service_role', coalesce(prev_ok::text, 'no existe'), 'true', case when prev_ok is true then 'OK' else 'FALLO' end from t
  union all select 6, 'INFO: correcciones registradas (0 justo tras aplicar)', filas_hist::text, 'n/a', 'INFO' from t
) r order by orden;
