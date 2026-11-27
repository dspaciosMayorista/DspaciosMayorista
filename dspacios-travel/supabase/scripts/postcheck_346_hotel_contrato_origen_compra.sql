-- POSTCHECK 346 (B95-15 origen de la compra del hotel) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 346.
with t as (
  select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name = 'compra_origen' and data_type = 'text' and is_nullable = 'YES')::int as c_origen,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name = 'plataforma' and data_type = 'text' and is_nullable = 'YES')::int as c_plat,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.contrato_hoteles') and conname = 'contrato_hoteles_compra_origen_check') as chk_origen,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.contrato_hoteles') and conname = 'contrato_hoteles_plataforma_coherente_check') as chk_plat,
         (select count(*) from public.contrato_hoteles where compra_origen is not null or plataforma is not null)::int as con_origen,
         (select count(*) from public.contrato_hoteles)::int as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'compra_origen existe, es text y admite NULL' as control, c_origen::text as observado, '1' as esperado, case when c_origen = 1 then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'plataforma existe, es text y admite NULL', c_plat::text, '1', case when c_plat = 1 then 'OK' else 'FALLO' end from t
  union all select 3, 'CHECK de valores (directa | plataforma | NULL)', coalesce(chk_origen, 'no existe'), 'incluye directa y plataforma', case when chk_origen like '%directa%' and chk_origen like '%plataforma%' then 'OK' else 'FALLO' end from t
  union all select 4, 'CHECK de coherencia: plataforma solo con compra_origen = plataforma', coalesce(chk_plat, 'no existe'), 'existe', case when chk_plat is not null then 'OK' else 'FALLO' end from t
  union all select 5, 'Ninguna fila anterior fue modificada por la migración (origen/plataforma siguen NULL en las existentes)', con_origen::text || ' de ' || filas::text, '0 de N justo tras aplicar', case when con_origen = 0 then 'OK' else 'INFO' end from t
) r order by orden;
