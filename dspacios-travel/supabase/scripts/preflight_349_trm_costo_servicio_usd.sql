-- PREFLIGHT 349 (TRM de costos de servicios USD agregados después de crear el contrato) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 349 (y después de la 348).
with t as (
  select to_regclass('public.contrato_trm_costo_historial') as hist,
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.prevista_cxp_aplicar(text,bigint[],jsonb,jsonb)')) as md5_aplicar,
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.prevista_trm_costo_actualizar(text,text,uuid,text,numeric,numeric,text)')) as md5_actualizar,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_trm_costo_historial' and column_name in ('trm_anterior', 'valor_cop_anterior') and is_nullable = 'NO')::int as cols_not_null,
         (select count(*) from public.cuentas_por_pagar where valor_cop_costo is not null)::int as cxp_con_par,
         (select count(*) from public.cuentas_por_pagar)::int as cxp_total,
         (select count(*) from public.contrato_obligaciones_previstas where clase = 'cxp' and materializada_en is null and upper(coalesce(payload->>'moneda','')) = 'USD' and payload->>'trm_costo' is null)::int as previstas_usd_sin_par
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La 348 está aplicada (tabla de historial)' as control, coalesce(hist::text, 'no existe') as observado, 'existe' as esperado, case when hist is not null then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'prevista_cxp_aplicar tiene EXACTAMENTE la definición de la 348 (md5; una versión ya reemplazada o distinta aborta la 349)', coalesce(md5_aplicar, 'no existe'), '51be918d5eedffcbb46344665d1424d8', case when md5_aplicar = '51be918d5eedffcbb46344665d1424d8' then 'OK' else 'FALLO' end from t
  union all select 3, 'prevista_trm_costo_actualizar tiene EXACTAMENTE la definición de la 348 (md5)', coalesce(md5_actualizar, 'no existe'), 'e741f1c2818a645ee325a0fb89e43127', case when md5_actualizar = 'e741f1c2818a645ee325a0fb89e43127' then 'OK' else 'FALLO' end from t
  union all select 4, 'El historial aún exige valor anterior (columnas NOT NULL que la 349 relaja)', cols_not_null::text, '2', case when cols_not_null = 2 then 'OK' else 'FALLO' end from t
  union all select 5, 'INFO: CxP con equivalente de costos (la 349 NO las toca; guarda esta cifra para el postcheck)', cxp_con_par::text, 'n/a', 'INFO' from t
  union all select 6, 'INFO: total de cuentas por pagar (la 349 no las toca)', cxp_total::text, 'n/a', 'INFO' from t
  union all select 7, 'INFO: previstas en USD sin TRM de costos hoy (la 349 NO les agrega TRM a las existentes)', previstas_usd_sin_par::text, 'n/a', 'INFO' from t
) r order by orden;
