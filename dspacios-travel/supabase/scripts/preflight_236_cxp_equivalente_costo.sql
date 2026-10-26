-- ───────────────────────────────────────────────────────────────────────────
-- 236 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 236. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No usa objetos de la 236 (se lee con to_jsonb / catálogo): corre igual con o sin ella aplicada (si ya está aplicada, 'migracion_236_no_aplicada' sale REVISAR).
-- No imprime filas de negocio: solo conteos, ids (máx. 20) y una huella.
-- ───────────────────────────────────────────────────────────────────────────
with
cxp as (
  select x.id, x.numero_contrato, x.tenant, x.moneda, x.valor_total, x.aceptacion_63_id, x.valor_cop_63, x.trm_63,
         to_jsonb(x) ->> 'valor_cop_costo' as vcc, to_jsonb(x) ->> 'trm_costo' as tc
    from public.cuentas_por_pagar x
),
fn as (
  select f.oid, pg_get_functiondef(f.oid) as def
    from pg_proc f where f.proname = 'registrar_financiero_contrato' and f.pronamespace = 'public'::regnamespace and f.pronargs = 4
),
pendientes as (select numero_contrato from public.ventas where financiero_estado = 'pendiente'),
usd as (select * from cxp where moneda = 'USD' and valor_total > 0),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'cadena_001_235_presente',
         (to_regclass('public.cuentas_por_pagar') is not null and to_regclass('public.p63_aceptacion') is not null
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'moneda_cobro'))::text,
         'true',
         case when to_regclass('public.cuentas_por_pagar') is not null and to_regclass('public.p63_aceptacion') is not null
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'moneda_cobro') then 'OK' else 'REVISAR' end
  union all
  select 2, 'migracion_236_no_aplicada',
         (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_costo', 'trm_costo'))
          and to_regprocedure('public.trg_cxp_costo_inmutable()') is null)::text,
         'true',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_costo', 'trm_costo'))
                   and to_regprocedure('public.trg_cxp_costo_inmutable()') is null then 'OK' else 'REVISAR' end
  union all
  -- La RPC vigente es la de la 227 (la que la 236 reemplaza): una sola firma de 4 argumentos, deriva #63 y no conoce las columnas nuevas.
  select 3, 'rpc_registrar_financiero_es_la_227',
         (select (count(*) = 1 and bool_and(def like '%p63_registrar_financiero%') and bool_and(def not like '%valor_cop_costo%'))::text from fn),
         'true',
         case when (select count(*) = 1 and bool_and(def like '%p63_registrar_financiero%') and bool_and(def not like '%valor_cop_costo%') from fn) then 'OK' else 'REVISAR' end
  union all
  select 4, 'rpc_solo_service_role',
         coalesce((select (has_function_privilege('service_role', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE'))::text from fn), 'false'),
         'true',
         case when coalesce((select has_function_privilege('service_role', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE') from fn), false) then 'OK' else 'REVISAR' end
  union all
  select 5, 'p63_registrar_financiero_presente', (to_regprocedure('public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint)') is not null)::text, 'true',
         case when to_regprocedure('public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint)') is not null then 'OK' else 'REVISAR' end
  union all
  select 6, 'check_cop63_vigente_no_se_toca',
         exists (select 1 from pg_constraint where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_cop63_chk')::text, 'true',
         case when exists (select 1 from pg_constraint where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_cop63_chk') then 'OK' else 'REVISAR' end
  union all
  -- Contratos con la escritura financiera en vuelo: la 236 no los toca, pero conviene aplicarla sin ninguno (la RPC cambia de cuerpo).
  select 7, 'contratos_financiero_pendiente', (select count(*) from pendientes)::text, '0', case when (select count(*) from pendientes) = 0 then 'OK' else 'REVISAR' end
  union all
  select 8, 'ids_contratos_financiero_pendiente_max20',
         coalesce((select string_agg(numero_contrato, ',' order by numero_contrato) from (select numero_contrato from pendientes order by numero_contrato limit 20) p), '-'), '-', 'INFO'
  union all
  select 9, 'payloads_guardados_en_contrato_financiero_pendiente', (select count(*) from public.contrato_financiero_pendiente)::text, '0 ideal', 'INFO'
  union all
  -- Datos que la 236 NO debe tocar: la huella se compara con la del postcheck.
  select 10, 'cxp_total_filas', (select count(*) from cxp)::text, 'igual en el postcheck', 'INFO'
  union all
  select 11, 'cxp_en_usd_con_valor', (select count(*) from usd)::text, 'igual en el postcheck', 'INFO'
  union all
  select 12, 'cxp_en_usd_con_equivalente_de_oferta_63', (select count(*) from usd where valor_cop_63 is not null)::text, 'igual en el postcheck', 'INFO'
  union all
  -- Históricas en USD SIN equivalente ni marca #63: se devengan por su valor nominal (límite contable conocido; la 236 no las reclasifica).
  select 13, 'cxp_en_usd_sin_equivalente_historicas', (select count(*) from usd where valor_cop_63 is null and vcc is null)::text, 'dato para contabilidad (#43)', 'INFO'
  union all
  select 14, 'monedas_de_cxp_distintas_de_cop_usd', (select count(*) from cxp where moneda is null or moneda not in ('COP', 'USD'))::text, '0', case when (select count(*) from cxp where moneda is null or moneda not in ('COP', 'USD')) = 0 then 'OK' else 'REVISAR' end
  union all
  select 15, 'huella_de_cxp_que_la_236_no_debe_tocar',
         md5(coalesce((select string_agg(id::text || ':' || coalesce(moneda, '') || ':' || valor_total::text || ':' || coalesce(valor_cop_63::text, '') || ':' || coalesce(trm_63::text, ''), '|' order by id) from cxp), '')),
         'igual en el postcheck', 'INFO'
  union all
  select 16, 'cotizaciones_de_carrito_abiertas_en_usd',
         (select count(*) from public.cotizaciones where tipo = 'carrito' and estado = 'abierta' and upper(coalesce(moneda, '')) = 'USD')::text,
         'estas pedirán la TRM de costos al convertirse', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
