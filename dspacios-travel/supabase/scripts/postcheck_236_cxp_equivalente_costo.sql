-- ───────────────────────────────────────────────────────────────────────────
-- 236 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 236 (y puede repetirse cuando ya haya conversiones de carrito en USD).
--   Columnas: control · valor (observado) · esperado · estado.   OK = cumple · REVISAR = hay un defecto o falta algo · INFO = dato / compara con el preflight.
-- Tras aplicar la 236 y ANTES de la primera conversión en USD: todo OK, 0 REVISAR, y los INFO de huella/conteos IGUALES a los del preflight.
-- Con conversiones ya hechas: los controles de datos (coherencia, una TRM por contrato, devengo por el equivalente) siguen siendo decisivos.
-- No imprime filas de negocio: solo conteos, ids (máx. 20) y una huella.
-- ───────────────────────────────────────────────────────────────────────────
with
cxp as (select x.* from public.cuentas_por_pagar x),
conc as (select * from cxp where valor_cop_costo is not null or trm_costo is not null),
fn as (
  select f.oid, pg_get_functiondef(f.oid) as def
    from pg_proc f where f.proname = 'registrar_financiero_contrato' and f.pronamespace = 'public'::regnamespace and f.pronargs = 4
),
-- Fila con equivalente que no cumple lo que la base exige (el CHECK lo impide; esto detecta cualquier hueco).
incoherentes as (
  select id from conc
   where (valor_cop_costo is null) <> (trm_costo is null) or moneda <> 'USD' or trm_costo <= 0 or valor_cop_costo < 0
      or abs(valor_cop_costo - round(valor_total * trm_costo, 2)) > 0.01
      or aceptacion_63_id is not null or obligacion_63 is not null or valor_cop_63 is not null or trm_63 is not null
),
-- Una sola TRM de costos por contrato.
contratos_con_dos_trm as (
  select numero_contrato from conc group by numero_contrato having count(distinct trm_costo) > 1
),
-- Si una CxP de un contrato lleva equivalente, toda CxP en USD con importe de ese contrato lo lleva (nunca un devengo mixto).
usd_sin_equivalente_en_contrato_con_equivalente as (
  select c.id from cxp c
   where c.moneda = 'USD' and c.valor_total > 0 and c.valor_cop_costo is null and c.aceptacion_63_id is null
     and exists (select 1 from conc k where k.numero_contrato = c.numero_contrato)
),
-- La cabecera de esos contratos está en USD (las columnas de costo están en la moneda de la oferta).
contratos_conc_no_usd as (
  select distinct v.numero_contrato from public.ventas v join conc k on k.numero_contrato = v.numero_contrato where coalesce(v.moneda, 'COP') <> 'USD'
),
-- Devengo: el asiento de cada CxP con equivalente debita el equivalente en COP (no el nominal en dólares).
devengo as (
  select k.id,
         (select coalesce(sum(l.debe), 0) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id where a.origen = 'cxp' and a.referencia = 'cxp:' || k.id) as debe,
         exists (select 1 from public.asientos_contables a where a.origen = 'cxp' and a.referencia = 'cxp:' || k.id) as hay_asiento,
         k.valor_cop_costo
    from conc k where k.valor_total > 0
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'columnas_valor_cop_costo_y_trm_costo',
         (select string_agg(column_name || ':' || data_type || '(' || coalesce(numeric_precision::text, '') || ',' || coalesce(numeric_scale::text, '') || ')', ' ' order by column_name)
            from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_costo', 'trm_costo')),
         'trm_costo:numeric(15,4) valor_cop_costo:numeric(15,2)',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar'
                       and ((column_name = 'valor_cop_costo' and numeric_precision = 15 and numeric_scale = 2) or (column_name = 'trm_costo' and numeric_precision = 15 and numeric_scale = 4))) = 2 then 'OK' else 'REVISAR' end
  union all
  select 2, 'check_cuentas_por_pagar_cop_costo_chk_validado',
         coalesce((select (convalidated and pg_get_constraintdef(oid) like '%valor_cop_costo%' and pg_get_constraintdef(oid) like '%trm_costo%' and pg_get_constraintdef(oid) like '%aceptacion_63_id IS NULL%' and pg_get_constraintdef(oid) like '%''USD''%')::text
                     from pg_constraint where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_cop_costo_chk'), 'false'),
         'true',
         case when coalesce((select convalidated and pg_get_constraintdef(oid) like '%valor_cop_costo%' and pg_get_constraintdef(oid) like '%trm_costo%' and pg_get_constraintdef(oid) like '%aceptacion_63_id IS NULL%' and pg_get_constraintdef(oid) like '%''USD''%'
                              from pg_constraint where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_cop_costo_chk'), false) then 'OK' else 'REVISAR' end
  union all
  select 3, 'trigger_trg_cxp_costo_inmutable_habilitado_before_update',
         exists (select 1 from pg_trigger t where t.tgrelid = 'public.cuentas_por_pagar'::regclass and t.tgname = 'trg_cxp_costo_inmutable' and not t.tgisinternal
                    and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16)::text,
         'true',
         case when exists (select 1 from pg_trigger t where t.tgrelid = 'public.cuentas_por_pagar'::regclass and t.tgname = 'trg_cxp_costo_inmutable' and not t.tgisinternal
                              and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16) then 'OK' else 'REVISAR' end
  union all
  select 4, 'rpc_registrar_financiero_236',
         (select (count(*) = 1 and bool_and(def like '%valor_cop_costo%') and bool_and(def like '%trm_costo%') and bool_and(def like '%p63_registrar_financiero%') and bool_and(def like '%una sola TRM de costos%'))::text from fn),
         'true',
         case when (select count(*) = 1 and bool_and(def like '%valor_cop_costo%') and bool_and(def like '%trm_costo%') and bool_and(def like '%p63_registrar_financiero%') and bool_and(def like '%una sola TRM de costos%') from fn) then 'OK' else 'REVISAR' end
  union all
  -- El camino #63 se decide ANTES de leer el payload de siempre (sigue igual que en la 227).
  select 5, 'rpc_deriva_63_antes_de_validar_payload',
         (select (strpos(def, 'p63_registrar_financiero(p_numero_contrato') > 0 and strpos(def, 'p63_registrar_financiero(p_numero_contrato') < strpos(def, 'valor_cop_costo'))::text from fn),
         'true',
         case when (select strpos(def, 'p63_registrar_financiero(p_numero_contrato') > 0 and strpos(def, 'p63_registrar_financiero(p_numero_contrato') < strpos(def, 'valor_cop_costo') from fn) then 'OK' else 'REVISAR' end
  union all
  select 6, 'rpc_solo_service_role',
         coalesce((select (has_function_privilege('service_role', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE'))::text from fn), 'false'),
         'true',
         case when coalesce((select has_function_privilege('service_role', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE') from fn), false) then 'OK' else 'REVISAR' end
  union all
  select 7, 'rpc_security_definer_con_search_path_fijo',
         coalesce((select (f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public, pg_temp%')::text from pg_proc f where f.oid = (select oid from fn)), 'false'),
         'true',
         case when coalesce((select f.prosecdef and coalesce(f.proconfig::text, '') like '%search_path=public, pg_temp%' from pg_proc f where f.oid = (select oid from fn)), false) then 'OK' else 'REVISAR' end
  union all
  select 8, 'cxp_con_equivalente_de_costos', (select count(*) from conc)::text, 'dato', 'INFO'
  union all
  select 9, 'cxp_con_equivalente_incoherente', (select count(*) from incoherentes)::text, '0', case when (select count(*) from incoherentes) = 0 then 'OK' else 'REVISAR' end
  union all
  select 10, 'ids_incoherentes_max20', coalesce((select string_agg(id::text, ',' order by id) from (select id from incoherentes order by id limit 20) i), '-'), '-', 'INFO'
  union all
  select 11, 'contratos_con_mas_de_una_trm_de_costos', (select count(*) from contratos_con_dos_trm)::text, '0', case when (select count(*) from contratos_con_dos_trm) = 0 then 'OK' else 'REVISAR' end
  union all
  select 12, 'cxp_usd_sin_equivalente_en_contrato_que_si_lo_lleva', (select count(*) from usd_sin_equivalente_en_contrato_con_equivalente)::text, '0',
         case when (select count(*) from usd_sin_equivalente_en_contrato_con_equivalente) = 0 then 'OK' else 'REVISAR' end
  union all
  select 13, 'contratos_con_equivalente_cuya_cabecera_no_es_usd', (select count(*) from contratos_conc_no_usd)::text, '0', case when (select count(*) from contratos_conc_no_usd) = 0 then 'OK' else 'REVISAR' end
  union all
  -- Devengo: toda CxP con equivalente y asiento tiene su débito igual al equivalente en COP (nunca el nominal en dólares).
  select 14, 'cxp_con_equivalente_cuyo_asiento_no_debita_el_equivalente',
         (select count(*) from devengo where hay_asiento and debe <> valor_cop_costo)::text, '0',
         case when (select count(*) from devengo where hay_asiento and debe <> valor_cop_costo) = 0 then 'OK' else 'REVISAR' end
  union all
  select 15, 'cxp_con_equivalente_sin_asiento_de_devengo', (select count(*) from devengo where not hay_asiento)::text, '0 (la reconciliación los repone; REVISAR si persisten)',
         case when (select count(*) from devengo where not hay_asiento) = 0 then 'OK' else 'REVISAR' end
  union all
  -- Datos de antes que la 236 no debe haber tocado: comparar con el preflight (misma fórmula).
  select 16, 'cxp_total_filas', (select count(*) from cxp)::text, 'preflight + conversiones nuevas', 'INFO'
  union all
  select 17, 'cxp_en_usd_con_equivalente_de_oferta_63', (select count(*) from cxp where moneda = 'USD' and valor_total > 0 and valor_cop_63 is not null)::text, 'igual al preflight', 'INFO'
  union all
  select 18, 'cxp_en_usd_sin_equivalente_historicas',
         (select count(*) from cxp where moneda = 'USD' and valor_total > 0 and valor_cop_63 is null and valor_cop_costo is null)::text, 'igual al preflight (dato para contabilidad #43)', 'INFO'
  union all
  select 19, 'huella_de_cxp_que_la_236_no_debe_tocar',
         md5(coalesce((select string_agg(id::text || ':' || coalesce(moneda, '') || ':' || valor_total::text || ':' || coalesce(valor_cop_63::text, '') || ':' || coalesce(trm_63::text, ''), '|' order by id)
                         from cxp where valor_cop_costo is null), '')),
         'igual a la del preflight si aún no hay conversiones nuevas', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
