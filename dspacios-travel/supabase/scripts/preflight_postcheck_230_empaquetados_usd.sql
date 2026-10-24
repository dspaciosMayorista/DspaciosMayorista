-- ───────────────────────────────────────────────────────────────────────────
-- 230 · PREFLIGHT + POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Columnas: control · valor · esperado · estado.
--   OK = cumple lo esperado · REVISAR = falta algo o requiere decisión · INFO = dato (o pendiente de una fase anterior).
-- Se corre TRES veces con el mismo archivo:
--   1) ANTES de la migración 230: los controles de estructura salen REVISAR/INFO ("pendiente") y los de datos INFO.
--   2) DESPUÉS de la migración y ANTES de la corrección de datos: la estructura sale OK y los controles de datos con "(tras la
--      corrección)" salen REVISAR (es lo esperado: falta corregir).
--   3) DESPUÉS de la corrección de datos (correccion_230_datos_usd.sql): TODO debe salir OK (los INFO son solo informativos).
-- No imprime filas de negocio: solo conteos y estados.
-- ───────────────────────────────────────────────────────────────────────────
with
obj as (select unnest(array[3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])::bigint as id),
mig as (
  select
    exists (select 1 from pg_constraint where conrelid = 'public.empaquetados'::regclass and conname = 'empaquetados_moneda_chk')
      and not exists (select 1 from pg_constraint where conrelid = 'public.empaquetados'::regclass and conname = 'empaquetados_moneda_cop_chk') as chk_emp,
    coalesce((select pg_get_constraintdef(oid) not like '%COP%' from pg_constraint
               where conrelid = 'public.salidas_dinamicas'::regclass and conname = 'salidas_dinamicas_vinculada_chk'), false) as chk_vinc,
    coalesce((select pg_get_triggerdef(oid) like '%moneda%' from pg_trigger where tgname = 'tr_salida_vinculada_63' and tgrelid = 'public.salidas_dinamicas'::regclass), false) as trg_salida,
    coalesce((select pg_get_triggerdef(oid) like '%moneda%' from pg_trigger where tgname = 'tarifario_trg_empaquetados' and tgrelid = 'public.empaquetados'::regclass), false) as trg_226,
    coalesce((select pg_get_triggerdef(oid) like '%moneda%' from pg_trigger where tgname = 'trg_p63_costos_empaquetados' and tgrelid = 'public.empaquetados'::regclass), false) as trg_costos,
    coalesce((select pg_get_functiondef(p.oid) like '%not in (''COP'', ''USD'')%' and pg_get_functiondef(p.oid) like '%v_s.moneda is distinct from v_e.moneda%'
                 and pg_get_functiondef(p.oid) not like '%v_e.moneda is distinct from ''COP''%'
                from pg_proc p where p.proname = 'aceptar_oferta_63' and p.pronamespace = 'public'::regnamespace), false) as fn_aceptar,
    coalesce((select has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                      and not has_function_privilege('anon', p.oid, 'EXECUTE')
                from pg_proc p where p.proname = 'aceptar_oferta_63' and p.pronamespace = 'public'::regnamespace), false) as acl_aceptar
),
ap as (select (select m.chk_emp and m.chk_vinc and m.trg_salida and m.trg_226 and m.trg_costos and m.fn_aceptar from mig m) as aplicada),
emp as (
  select o.id, e.id as existe, e.moneda, e.record, e.notas,
         to_jsonb(e) ->> 'tarifa_proveedor' as n, to_jsonb(e) ->> 'tarifa_para_empaquetar' as r, to_jsonb(e) ->> 'fee_infante' as f
    from obj o left join public.empaquetados e on e.id = o.id
),
vinc as (
  select s.id, s.paquete_id, s.empaquetado_id, s.moneda as moneda_salida, e.moneda as moneda_fuente
    from public.salidas_dinamicas s join public.empaquetados e on e.id = s.empaquetado_id
)
select control, valor, esperado, estado
  from (
    select 1 as ord, 'migracion_230_estructura' as control,
           case when (select aplicada from ap) then 'aplicada' else 'pendiente' end as valor, 'aplicada' as esperado,
           case when (select aplicada from ap) then 'OK' else 'REVISAR' end as estado
    union all select 2, 'check_empaquetados_cop_y_usd', (select chk_emp from mig)::text, 'true', case when (select chk_emp from mig) then 'OK' else 'REVISAR' end
    union all select 3, 'check_vinculada_sin_forzar_cop', (select chk_vinc from mig)::text, 'true', case when (select chk_vinc from mig) then 'OK' else 'REVISAR' end
    union all select 4, 'trigger_salida_vigila_moneda', (select trg_salida from mig)::text, 'true', case when (select trg_salida from mig) then 'OK' else 'REVISAR' end
    union all select 5, 'trigger_226_empaquetados_vigila_moneda', (select trg_226 from mig)::text, 'true', case when (select trg_226 from mig) then 'OK' else 'REVISAR' end
    union all select 6, 'trigger_costos_63_vigila_moneda', (select trg_costos from mig)::text, 'true', case when (select trg_costos from mig) then 'OK' else 'REVISAR' end
    union all select 7, 'aceptar_oferta_63_acepta_usd_y_compara_salida', (select fn_aceptar from mig)::text, 'true', case when (select fn_aceptar from mig) then 'OK' else 'REVISAR' end
    union all select 8, 'aceptar_oferta_63_solo_service_role', (select acl_aceptar from mig)::text, 'true', case when (select acl_aceptar from mig) then 'OK' else 'REVISAR' end
    union all
    select 9, 'empaquetados_objetivo_existentes', count(existe)::text || ' de 17', '17 de 17',
           case when count(existe) = 17 then 'OK' else 'REVISAR' end from emp
    union all
    select 10, 'empaquetados_objetivo_en_usd (tras la corrección)', count(*) filter (where moneda = 'USD')::text || ' de 17', '17 de 17',
           case when not (select aplicada from ap) then 'INFO' when count(*) filter (where moneda = 'USD') = 17 then 'OK' else 'REVISAR' end from emp
    union all
    select 11, 'empaquetados_objetivo_con_record_pnr', count(*) filter (where nullif(btrim(coalesce(record, '')), '') is not null)::text, '0 (con record no se vinculan)',
           case when count(*) filter (where nullif(btrim(coalesce(record, '')), '') is not null) = 0 then 'OK' else 'INFO' end from emp
    union all
    select 12, 'empaquetados_objetivo_sin_ruta (el 5, informativo)', count(*) filter (where existe is not null and nullif(btrim(coalesce((select e2.ruta from public.empaquetados e2 where e2.id = emp.id), '')), '') is null)::text, '1', 'INFO' from emp
    union all
    select 13, 'tiquete_cop_menor_1000_en_empaquetados', count(*)::text, '0',
           case when count(*) = 0 then 'OK' else 'REVISAR' end
      from public.empaquetados e
     where e.moneda = 'COP'
       and ((e.tarifa_proveedor > 0 and e.tarifa_proveedor < 1000) or (e.tarifa_para_empaquetar > 0 and e.tarifa_para_empaquetar < 1000) or (e.fee_infante > 0 and e.fee_infante < 1000))
    union all
    select 14, 'tiquete_cop_menor_1000_en_salidas_de_paquetes_modo_63', count(*)::text, '0',
           case when count(*) = 0 then 'OK' else 'REVISAR' end
      from public.salidas_dinamicas s join public.armado_paquetes p on p.id = s.paquete_id
     where p.modo_oferta = 'cop_trm_63' and s.moneda = 'COP'
       and ((s.valor_tiquete > 0 and s.valor_tiquete < 1000) or (s.ta > 0 and s.ta < 1000) or (s.fee_infante > 0 and s.fee_infante < 1000))
    union all
    select 15, 'salidas_manuales_1_y_2_del_paquete_71_en_usd (tras la corrección)', count(*) filter (where moneda = 'USD')::text || ' de ' || count(*)::text, '2 de 2',
           case when not (select aplicada from ap) then 'INFO' when count(*) = 2 and count(*) filter (where moneda = 'USD') = 2 then 'OK' else 'REVISAR' end
      from public.salidas_dinamicas where id in (1, 2) and paquete_id = 71 and empaquetado_id is null
    union all
    select 16, 'salidas_vinculadas_a_los_empaquetados_objetivo_en_usd (tras la corrección)',
           count(*) filter (where moneda_salida = 'USD')::text || ' de ' || count(*)::text, 'todas',
           case when not (select aplicada from ap) then 'INFO' when count(*) filter (where moneda_salida = 'USD') = count(*) then 'OK' else 'REVISAR' end
      from vinc where empaquetado_id in (select id from obj)
    union all
    select 17, 'salidas_vinculadas_con_moneda_distinta_de_su_fuente', count(*)::text, '0', case when count(*) = 0 then 'OK' else 'REVISAR' end
      from vinc where moneda_salida is distinct from moneda_fuente
    union all
    select 18, 'paquete_70_sigue_inactivo_y_sin_snapshot_publicable',
           coalesce((select (not activo and not coalesce(tarifario_snapshot_publicable, false))::text from public.armado_paquetes where id = 70), 'no existe'), 'true',
           case when coalesce((select not activo and not coalesce(tarifario_snapshot_publicable, false) from public.armado_paquetes where id = 70), false) then 'OK' else 'REVISAR' end
    union all
    select 19, 'ventas_ofertas_aceptadas_o_aceptaciones_vigentes_de_los_paquetes_70_y_71',
           ((select count(*) from public.ventas where paquete_armado_id in (70, 71))
            + (select count(*) from public.p63_oferta where paquete_id in (70, 71) and estado = 'aceptada')
            + (select count(*) from public.p63_aceptacion a join public.p63_oferta o on o.id = a.oferta_id where o.paquete_id in (70, 71) and a.estado <> 'descartada'))::text,
           '0 (nunca se vendió ni se aceptó nada)',
           case when (select count(*) from public.ventas where paquete_armado_id in (70, 71))
                   + (select count(*) from public.p63_oferta where paquete_id in (70, 71) and estado = 'aceptada')
                   + (select count(*) from public.p63_aceptacion a join public.p63_oferta o on o.id = a.oferta_id where o.paquete_id in (70, 71) and a.estado <> 'descartada') = 0 then 'OK' else 'REVISAR' end
    union all
    select 20, 'ventas_con_un_empaquetado_objetivo_como_origen', count(*)::text, '0',
           case when count(*) = 0 then 'OK' else 'REVISAR' end
      from public.ventas where empaquetado_ref_id in (select id from obj)
    union all
    select 21, 'constancia_de_la_decision_en_notas (tras la corrección)', count(*) filter (where notas like '%[230] Moneda corregida%')::text || ' de 17', '17 de 17',
           case when not (select aplicada from ap) then 'INFO' when count(*) filter (where notas like '%[230] Moneda corregida%') = 17 then 'OK' else 'REVISAR' end from emp
    union all
    select 22, 'informativo_salidas_manuales_de_paquetes_legacy_con_cop_menor_1000',
           count(*)::text, 'dato (en un paquete legacy la moneda de la salida no es significativa)', 'INFO'
      from public.salidas_dinamicas s join public.armado_paquetes p on p.id = s.paquete_id
     where p.modo_oferta = 'legacy' and s.moneda = 'COP' and s.valor_tiquete > 0 and s.valor_tiquete < 1000
    union all
    select 23, 'informativo_bloqueos_con_tarifa_menor_1000 (bloqueos_vuelo no tiene moneda)', count(*)::text, 'dato', 'INFO'
      from public.bloqueos_vuelo where tarifa_para_empaquetar > 0 and tarifa_para_empaquetar < 1000
    union all
    select 24, 'informativo_ofertas_abiertas_de_los_paquetes_70_y_71 (no bloquean; su aceptación se rechaza por revalidación)',
           count(*)::text || coalesce(' · ' || string_agg('oferta ' || o.id || ' (cotización ' || o.cotizacion_id || ', paquete ' || o.paquete_id || ')', ', ' order by o.id), ''),
           'dato', 'INFO'
      from public.p63_oferta o where o.paquete_id in (70, 71) and o.estado = 'abierta'
  ) q
 order by ord;
