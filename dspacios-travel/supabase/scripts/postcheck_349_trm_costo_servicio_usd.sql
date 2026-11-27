-- POSTCHECK 349 (TRM de costos de servicios USD agregados después de crear el contrato) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 349.
with t as (
  select (select p.prosecdef and p.prosrc like '%349: una prevista NUEVA en USD hereda%' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
            from pg_proc p where p.oid = to_regprocedure('public.prevista_cxp_aplicar(text,bigint[],jsonb,jsonb)')) as aplicar_ok,
         (select p.prosecdef and p.prosrc like '%v_inicial%' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
            from pg_proc p where p.oid = to_regprocedure('public.prevista_trm_costo_actualizar(text,text,uuid,text,numeric,numeric,text)')) as actualizar_ok,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_trm_costo_historial' and column_name in ('trm_anterior', 'valor_cop_anterior') and is_nullable = 'NO')::int as cols_not_null,
         (select count(*) from pg_trigger where tgname = 'trg_cxp_costo_inmutable' and not tgisinternal)::int as trg236,
         (select count(*) from public.cuentas_por_pagar where valor_cop_costo is not null)::int as cxp_con_par,
         (select count(*) from public.cuentas_por_pagar)::int as cxp_total,
         (select count(*) from public.contrato_trm_costo_historial where trm_anterior is null)::int as iniciales
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'prevista_cxp_aplicar hereda la TRM común a una prevista USD nueva; SECURITY DEFINER y solo service_role' as control, coalesce(aplicar_ok::text, 'no existe') as observado, 'true' as esperado, case when aplicar_ok is true then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'prevista_trm_costo_actualizar admite la TRM inicial (p_trm_esperada nula); SECURITY DEFINER y solo service_role', coalesce(actualizar_ok::text, 'no existe'), 'true', case when actualizar_ok is true then 'OK' else 'FALLO' end from t
  union all select 3, 'El historial admite una TRM inicial (columnas anteriores ya no son NOT NULL)', cols_not_null::text, '0', case when cols_not_null = 0 then 'OK' else 'FALLO' end from t
  union all select 4, 'La inmutabilidad de la 236 en cuentas_por_pagar sigue intacta (disparador presente)', trg236::text, '1', case when trg236 = 1 then 'OK' else 'FALLO' end from t
  union all select 5, 'INFO: CxP con equivalente de costos — debe ser IGUAL a la cifra del preflight (la 349 no las toca)', cxp_con_par::text, 'igual al preflight', 'INFO' from t
  union all select 6, 'INFO: total de cuentas por pagar — debe ser IGUAL a la cifra del preflight', cxp_total::text, 'igual al preflight', 'INFO' from t
  union all select 7, 'INFO: TRM iniciales registradas (0 justo tras aplicar)', iniciales::text, 'n/a', 'INFO' from t
) r order by orden;
