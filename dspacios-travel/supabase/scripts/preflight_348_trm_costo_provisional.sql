-- PREFLIGHT 348 (TRM de costos provisional de obligaciones previstas) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 348.
with t as (
  select to_regclass('public.contrato_obligaciones_previstas') as prev,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_costo', 'trm_costo'))::int as cols236,
         to_regclass('public.contrato_trm_costo_historial') as hist,
         to_regprocedure('public.prevista_trm_costo_actualizar(text,text,uuid,text,numeric,numeric,text)') as fn,
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.prevista_cxp_aplicar(text,bigint[],jsonb,jsonb)')) as md5_prev,
         (select count(*) from public.cuentas_por_pagar where valor_cop_costo is not null)::int as cxp_con_par,
         (select count(*) from public.contrato_obligaciones_previstas where clase = 'cxp' and materializada_en is null and upper(coalesce(payload->>'moneda','')) = 'USD' and payload->>'trm_costo' is not null)::int as previstas_usd_con_par
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe contrato_obligaciones_previstas (288)' as control, coalesce(prev::text, 'no existe') as observado, 'existe' as esperado, case when prev is not null then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'cuentas_por_pagar tiene valor_cop_costo y trm_costo (236)', cols236::text, '2', case when cols236 = 2 then 'OK' else 'FALLO' end from t
  union all select 3, 'La 348 NO está aplicada (sin historial ni función)', coalesce(hist::text, 'sin tabla') || ' / ' || coalesce(fn::text, 'sin función'), 'sin tabla / sin función', case when hist is null and fn is null then 'OK' else 'FALLO' end from t
  union all select 4, 'INFO: CxP con equivalente de costos (la 348 NO las toca; guarda esta cifra para el postcheck)', cxp_con_par::text, 'n/a', 'INFO' from t
  union all select 6, 'prevista_cxp_aplicar (288) tiene EXACTAMENTE la definición que la 348 reemplaza (md5)', coalesce(md5_prev, 'no existe'), '2d7d0d442c8b9c978c0dd5a35729ee67', case when md5_prev = '2d7d0d442c8b9c978c0dd5a35729ee67' then 'OK' else 'FALLO' end from t
  union all select 5, 'INFO: previstas en USD con TRM de costos (las únicas que la 348 permite corregir)', previstas_usd_con_par::text, 'n/a', 'INFO' from t
) r order by orden;
