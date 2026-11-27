-- PREFLIGHT 346 (B95-15 origen de la compra del hotel) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 346.
with t as (
  select to_regclass('public.contrato_hoteles') as tab,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name in ('compra_origen', 'plataforma'))::int as cols_nuevas,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name in ('numero_contrato', 'nombre', 'proveedor', 'acomodacion'))::int as cols_base,
         (select count(*) from pg_constraint where conrelid = to_regclass('public.contrato_hoteles') and conname in ('contrato_hoteles_compra_origen_check', 'contrato_hoteles_plataforma_coherente_check'))::int as checks,
         (select count(*) from public.contrato_hoteles)::int as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe contrato_hoteles con sus columnas base (numero_contrato, nombre, proveedor, acomodacion)' as control, coalesce(tab::text, 'falta') || ' / ' || cols_base::text as observado, 'existe / 4' as esperado, case when tab is not null and cols_base = 4 then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Aún NO existen las columnas compra_origen ni plataforma (existen si la 346 ya se corrió)', cols_nuevas::text, '0', case when cols_nuevas = 0 then 'OK' else 'REVISAR' end from t
  union all select 3, 'Aún NO existen los dos CHECK de la 346', checks::text, '0', case when checks = 0 then 'OK' else 'REVISAR' end from t
  union all select 4, 'INFO: filas existentes de contrato_hoteles (no se tocan; quedan con origen NULL)', filas::text, 'n/a', 'INFO' from t
) r order by orden;
