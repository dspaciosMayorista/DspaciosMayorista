-- PREFLIGHT 265 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto. Pegar COMPLETA en el editor SQL de Supabase (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL. La 265 REEMPLAZA el enlace por descripción de la 264 por un enlace con clave estable (no modifica filas existentes ni las funciones financieras).
-- Orden de la secuencia: 262 -> 263 -> 264 -> (este preflight) -> 265 -> postcheck_265. La 265 exige la 262 y la 264 aplicadas.
with
obj265 as (   -- los 11 objetos que crea la 265: 1 columna, 1 índice, 4 triggers, 5 funciones
    select 'col:contrato_servicios.clave_enlace' as o from information_schema.columns where table_schema = 'public' and table_name = 'contrato_servicios' and column_name = 'clave_enlace'
    union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' and indexname = 'uq_contrato_servicios_clave_enlace'
    union all select 'trg:' || tgname from pg_trigger where not tgisinternal and tgname in ('cxp_enlace_por_clave', 'cxp_enlace_inmutable', 'linea_enlazada_protegida', 'ventas_completo_exige_enlaces')
    union all select 'fn:' || proname from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('tg_cxp_enlace_por_clave', 'tg_cxp_enlace_inmutable', 'tg_linea_enlazada_protegida', 'tg_ventas_completo_exige_enlaces', 'corregir_enlace_cxp_alcance')
),
c(n, control, observado, esperado, veredicto) as (
    select 1, '262 aplicada: contrato_servicios.alcance_traslado y tabla servicio_precio_alcance',
           (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_servicios' and column_name = 'alcance_traslado'))::text || ' / ' || (to_regclass('public.servicio_precio_alcance') is not null)::text,
           'true / true',
           case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_servicios' and column_name = 'alcance_traslado') and to_regclass('public.servicio_precio_alcance') is not null then 'OK' else 'BLOQUEA' end
    union all select 2, '264 aplicada: columnas (cuentas_por_pagar.alcance_traslado/contrato_servicio_id, contrato_servicios.servicio_id), índice único uq_cxp_contrato_servicio y CHECK de alcance',
           (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'cuentas_por_pagar' and column_name in ('alcance_traslado', 'contrato_servicio_id')) or (table_name = 'contrato_servicios' and column_name = 'servicio_id')))::text
             || ' / ' || (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'uq_cxp_contrato_servicio')::text
             || ' / ' || (select count(*) from pg_constraint where conname = 'cuentas_por_pagar_alcance_traslado_chk' and convalidated)::text,
           '3 / 1 / 1',
           case when (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'cuentas_por_pagar' and column_name in ('alcance_traslado', 'contrato_servicio_id')) or (table_name = 'contrato_servicios' and column_name = 'servicio_id'))) = 3
                 and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_cxp_contrato_servicio')
                 and exists (select 1 from pg_constraint where conname = 'cuentas_por_pagar_alcance_traslado_chk' and convalidated) then 'OK' else 'BLOQUEA' end
    union all select 3, 'marca_cxp_automatica() existe (171) y mi_rol() existe',
           coalesce((select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'marca_cxp_automatica'), 'AUSENTE') || ' / ' || (to_regprocedure('public.mi_rol()') is not null)::text,
           'text / true',
           case when to_regprocedure('public.marca_cxp_automatica()') is not null and to_regprocedure('public.mi_rol()') is not null then 'OK' else 'BLOQUEA' end
    union all select 4, 'las dos RPC financieras existen (la 265 NO las reemplaza): registrar_financiero_contrato y p63_registrar_financiero',
           (to_regprocedure('public.registrar_financiero_contrato(text,text,jsonb,jsonb)') is not null)::text || ' / ' || (to_regprocedure('public.p63_registrar_financiero(text,text,jsonb,jsonb,bigint)') is not null)::text,
           'true / true',
           case when to_regprocedure('public.registrar_financiero_contrato(text,text,jsonb,jsonb)') is not null and to_regprocedure('public.p63_registrar_financiero(text,text,jsonb,jsonb,bigint)') is not null then 'OK' else 'BLOQUEA' end
    union all select 5, 'estado de la 265 (11 objetos): 0 = limpio · 11 = ya aplicada · otro = a medias',
           (select count(*) from obj265)::text || ' de 11', '0 o 11',
           case (select count(*) from obj265) when 0 then 'OK' when 11 then 'YA APLICADA' else 'BLOQUEA' end
    union all select 6, 'trigger de la 264 (cxp_enlazar_servicio_alcance): presente antes de aplicar (la 265 lo retira) o ausente si ya está aplicada',
           (select count(*) from pg_trigger where not tgisinternal and tgname = 'cxp_enlazar_servicio_alcance')::text, '1 antes · 0 después',
           case when (select count(*) from pg_trigger where not tgisinternal and tgname = 'cxp_enlazar_servicio_alcance') = 1 then 'OK'
                when (select count(*) from obj265) = 11 then 'OK' else 'BLOQUEA' end
    union all select 7, 'datos existentes con alcance (la 265 los deja INTACTOS y sin clave; no se infiere ningún enlace): líneas / líneas con costo > 0 / CxP enlazadas por la 264 / CxP con alcance',
           (select count(*) from public.contrato_servicios where alcance_traslado is not null)::text || ' / ' || (select count(*) from public.contrato_servicios where alcance_traslado is not null and coalesce(costo, 0) > 0)::text
             || ' / ' || (select count(*) from public.cuentas_por_pagar where contrato_servicio_id is not null)::text || ' / ' || (select count(*) from public.cuentas_por_pagar where alcance_traslado is not null)::text,
           'anotar para el postcheck (no cambian)', 'INFO'
    union all select 8, 'huellas md5 de registrar_financiero_contrato / p63_registrar_financiero (se comparan en el postcheck: deben ser idénticas tras la 265)',
           left(md5(replace(pg_get_functiondef('public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure), chr(13), '')), 32) || ' / ' || left(md5(replace(pg_get_functiondef('public.p63_registrar_financiero(text,text,jsonb,jsonb,bigint)'::regprocedure), chr(13), '')), 32),
           'anotar para el postcheck', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'controles con problema: ' || (select count(*) from c where veredicto = 'BLOQUEA')::text, '0',
       case when (select count(*) from c where veredicto = 'BLOQUEA') > 0 then 'NO APLICAR'
            when exists (select 1 from c where veredicto = 'YA APLICADA') then 'YA APLICADA (reaplicar es idempotente)' else 'APTO PARA APLICAR' end
order by n;
