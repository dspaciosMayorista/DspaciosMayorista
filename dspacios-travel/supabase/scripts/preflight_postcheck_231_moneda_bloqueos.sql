-- ───────────────────────────────────────────────────────────────────────────
-- 231 · PREFLIGHT + POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Columnas: control · valor · esperado · estado.
--   OK = cumple lo esperado · REVISAR = falta algo o requiere decisión · INFO = dato (o pendiente de una fase anterior).
-- Se corre CUATRO veces con el mismo archivo:
--   1) ANTES de la migración 231: la estructura sale REVISAR ("pendiente") y los datos INFO. Los controles 'tarifas_cop_menor_1000' y
--      'paquetes_activos_en_usd_con_bloqueo_sin_acreditar_o_no_usd' ya son decisivos: deben salir OK antes de acreditar.
--   2) DESPUÉS de la migración y ANTES de la acreditación: la estructura sale OK; 'bloqueos_sin_acreditar' sale REVISAR (falta acreditar).
--   3) DESPUÉS de acreditar los 95 (acreditar_231_bloqueos_cop.sql): TODO OK salvo 'interruptor_estricto' en REVISAR (falta encenderlo).
--   4) DESPUÉS de encender el interruptor (encender_231_moneda_obligatoria.sql, paso OBLIGATORIO): TODO debe salir OK (los INFO son solo datos).
--      Este es el postcheck FINAL del despliegue; sin interruptor encendido el cierre no está completo.
-- No imprime filas de negocio: solo conteos, ids de Bloqueos sin acreditar (máx. 20) y estados.
-- ───────────────────────────────────────────────────────────────────────────
with
b as (
  select x.id, x.record, x.tarifa_neta, x.tarifa_para_empaquetar, x.fee_infante, to_jsonb(x) as j
    from public.bloqueos_vuelo x
),
bm as (
  select id, record, tarifa_neta, tarifa_para_empaquetar, fee_infante,
         j ->> 'moneda' as moneda, j ->> 'moneda_acreditada_en' as en, j ->> 'moneda_acreditada_ref' as ref
    from b
),
mig as (
  select
    (select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'bloqueos_vuelo'
        and column_name in ('moneda', 'moneda_acreditada_en', 'moneda_acreditada_por', 'moneda_acreditada_ref')) as cols,
    exists (select 1 from pg_constraint where conrelid = 'public.bloqueos_vuelo'::regclass and conname = 'bloqueos_vuelo_moneda_chk') as chk_moneda,
    exists (select 1 from pg_constraint where conrelid = 'public.bloqueos_vuelo'::regclass and conname = 'bloqueos_vuelo_moneda_constancia_chk') as chk_constancia,
    exists (select 1 from pg_trigger where tgrelid = 'public.bloqueos_vuelo'::regclass and tgname = 'trg_bloqueos_moneda_90' and tgenabled = 'O') as trg_guarda,
    coalesce((select pg_get_triggerdef(oid) like '%, moneda%' from pg_trigger
               where tgrelid = 'public.bloqueos_vuelo'::regclass and tgname = 'tarifario_trg_bloqueos_vuelo'), false) as trg_invalida,
    coalesce((select pg_get_functiondef(p.oid) like '%OLD.moneda is null and NEW.moneda = ''COP''%'
                from pg_proc p where p.proname = 'tarifario_trg_bump_por_bloqueo' and p.pronamespace = 'public'::regnamespace), false) as fn_bump,
    coalesce((select pg_get_functiondef(p.oid) like '%v_moneda%' and pg_get_functiondef(p.oid) not like '%coalesce(v_moneda%'
                from pg_proc p where p.proname = 'crear_bloqueo' and p.pronamespace = 'public'::regnamespace), false) as fn_crear,
    coalesce((select has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                from pg_proc p where p.proname = 'crear_bloqueo' and p.pronamespace = 'public'::regnamespace), false) as acl_crear,
    to_regclass('p90_priv.config') is not null as tiene_interruptor
),
ap as (
  select (m.cols and m.chk_moneda and m.chk_constancia and m.trg_guarda and m.trg_invalida and m.fn_bump and m.fn_crear and m.acl_crear and m.tiene_interruptor) as aplicada
    from mig m
),
estricto as (
  select case when (select tiene_interruptor from mig)
              then (xpath('/row/v/text()', query_to_xml('select exigir_moneda_bloqueo::text as v from p90_priv.config', false, true, '')))[1]::text
              else null end as v
),
-- Paquetes activos en USD vinculados a un Bloqueo que NO está acreditado en USD (sin acreditar o en COP): al regenerar se rechazarían.
-- Usa bm (moneda leída por jsonb), así que funciona igual antes y después de aplicar la 231 (antes, todo Bloqueo cuenta como sin acreditar).
paq_usd as (
  select count(distinct p.id) as n
    from public.armado_paquetes p
    join public.armado_vuelos av on av.paquete_id = p.id
    join bm on bm.id = av.bloqueo_id
   where coalesce(p.activo, false) and p.moneda = 'USD' and bm.moneda is distinct from 'USD'
),
paq_pub as (
  select count(distinct p.id) as n
    from public.armado_paquetes p join public.armado_vuelos av on av.paquete_id = p.id
   where coalesce(p.activo, false) and coalesce(p.tarifario_snapshot_publicable, false)
)
select control, valor, esperado, estado
  from (
    select 1 as ord, 'migracion_231_estructura' as control,
           case when (select aplicada from ap) then 'aplicada' else 'pendiente' end as valor, 'aplicada' as esperado,
           case when (select aplicada from ap) then 'OK' else 'REVISAR' end as estado
    union all select 2, 'columnas_moneda_y_constancia', (select cols from mig)::text, 'true', case when (select cols from mig) then 'OK' else 'REVISAR' end
    union all select 3, 'check_moneda_cop_usd_y_constancia', ((select chk_moneda from mig) and (select chk_constancia from mig))::text, 'true',
           case when (select chk_moneda and chk_constancia from mig) then 'OK' else 'REVISAR' end
    union all select 4, 'trigger_guarda_moneda_activo', (select trg_guarda from mig)::text, 'true', case when (select trg_guarda from mig) then 'OK' else 'REVISAR' end
    union all select 5, 'trigger_invalidacion_vigila_moneda', (select trg_invalida from mig)::text, 'true', case when (select trg_invalida from mig) then 'OK' else 'REVISAR' end
    union all select 6, 'funcion_invalidacion_exceptua_null_a_cop', (select fn_bump from mig)::text, 'true', case when (select fn_bump from mig) then 'OK' else 'REVISAR' end
    union all select 7, 'crear_bloqueo_recibe_moneda_sin_suponer_cop', (select fn_crear from mig)::text, 'true', case when (select fn_crear from mig) then 'OK' else 'REVISAR' end
    union all select 8, 'crear_bloqueo_authenticated_si_anon_no', (select acl_crear from mig)::text, 'true', case when (select acl_crear from mig) then 'OK' else 'REVISAR' end
    union all select 9, 'interruptor_estricto',
           coalesce((select case v when 'true' then 'encendido' else 'apagado' end from estricto), 'no existe'), 'encendido (paso OBLIGATORIO tras acreditar los 95)',
           case when not (select tiene_interruptor from mig) then 'REVISAR'
                when (select v from estricto) = 'true' then 'OK'
                -- apagado: INFO mientras falte acreditar (todavía no toca encenderlo), REVISAR cuando ya no queda ninguno sin acreditar
                when (select count(*) from bm where moneda is null) > 0 then 'INFO'
                else 'REVISAR' end
    union all select 10, 'anon_sin_escritura_en_bloqueos_vuelo',
           (not has_table_privilege('anon', 'public.bloqueos_vuelo', 'INSERT') and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'UPDATE')
            and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'DELETE'))::text, 'true',
           case when not has_table_privilege('anon', 'public.bloqueos_vuelo', 'INSERT') and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'UPDATE')
                     and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'DELETE') then 'OK' else 'REVISAR' end
    union all select 11, 'bloqueos_total', count(*)::text, 'dato', 'INFO' from bm
    union all select 12, 'bloqueos_con_tarifa_neta_positiva', count(*) filter (where tarifa_neta > 0)::text || ' de ' || count(*)::text, 'dato', 'INFO' from bm
    union all
    -- DECISIVO ANTES de acreditar (regla del dueño): ningún importe positivo < 1.000 en Bloqueos sin acreditar ni en COP.
    select 13, 'tarifas_cop_menor_1000 (neta, reventa o fee en Bloqueos sin acreditar o en COP)', count(*)::text, '0',
           case when count(*) = 0 then 'OK' else 'REVISAR' end
      from bm
     where (moneda is null or moneda = 'COP')
       and ((tarifa_neta > 0 and tarifa_neta < 1000) or (tarifa_para_empaquetar > 0 and tarifa_para_empaquetar < 1000) or (fee_infante > 0 and fee_infante < 1000))
    union all
    select 14, 'bloqueos_sin_acreditar (tras la acreditación)', count(*) filter (where moneda is null)::text, '0',
           case when not (select aplicada from ap) then 'INFO' when count(*) filter (where moneda is null) = 0 then 'OK' else 'REVISAR' end from bm
    union all
    select 15, 'ids_de_bloqueos_sin_acreditar (máx. 20, para detectar altas posteriores a la decisión)',
           coalesce((select string_agg(id::text, ', ' order by id) from (select id from bm where moneda is null order by id limit 20) t), 'ninguno'), 'dato', 'INFO'
    union all select 16, 'bloqueos_acreditados_en_cop', count(*) filter (where moneda = 'COP')::text, 'dato', 'INFO' from bm
    union all select 17, 'bloqueos_acreditados_en_usd', count(*) filter (where moneda = 'USD')::text, 'dato', 'INFO' from bm
    union all
    select 18, 'acreditados_en_bloque_con_constancia_de_la_decision_D2 (tras la acreditación)',
           count(*) filter (where ref like 'D2 del dueño 2026-10-23%')::text || ' de 95', '95 de 95',
           case when not (select aplicada from ap) then 'INFO' when count(*) filter (where ref like 'D2 del dueño 2026-10-23%') = 95 then 'OK' else 'REVISAR' end from bm
    union all
    select 19, 'monedas_invalidas_o_constancia_incoherente', count(*)::text, '0',
           case when count(*) = 0 then 'OK' else 'REVISAR' end
      from bm where (moneda is not null and moneda not in ('COP', 'USD')) or ((moneda is null) <> (en is null))
    union all
    -- DECISIVO: un paquete activo en USD vinculado a un Bloqueo sin acreditar o en COP se rechazaría al regenerar (regla D8, fuera del modo 63).
    -- Un paquete USD con Bloqueo acreditado en USD es válido y NO cuenta.
    select 20, 'paquetes_activos_en_usd_con_bloqueo_sin_acreditar_o_no_usd', (select n from paq_usd)::text, '0',
           case when (select n from paq_usd) = 0 then 'OK' else 'REVISAR' end
    union all
    select 21, 'paquetes_activos_con_bloqueo_y_tarifario_publicable (comparar antes/después: acreditar NULL a COP NO debe cambiarlo)',
           (select n from paq_pub)::text, 'dato', 'INFO'
  ) q
 order by ord;
