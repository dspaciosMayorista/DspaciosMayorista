-- ───────────────────────────────────────────────────────────────────────────
-- 234 · PREFLIGHT + POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = falta algo o requiere decisión · INFO = dato (o pendiente de una fase anterior).
-- Se corre DOS veces con el mismo archivo (requiere la 233 aplicada: lee armado_paquetes.moneda_publicacion):
--   1) ANTES de la 234: la estructura sale REVISAR ("pendiente") y los controles de datos ya son decisivos
--      (ninguna oferta/contrato #63 debe estar ya en una moneda distinta de la elegida por su paquete).
--   2) DESPUÉS de la 234: TODO debe salir OK (los INFO son solo datos). Comparar 'tarifarios_publicables' con el del preflight: no debe cambiar.
-- No imprime filas de negocio: solo conteos, ids (máx. 20) y estados.
-- ───────────────────────────────────────────────────────────────────────────
with
p as (
  select x.id, x.activo, x.tipo::text as tipo, x.modo_oferta, x.trm_oferta, x.moneda, x.moneda_publicacion as mp,
         x.tarifario_snapshot_publicable as publicable,
         exists (select 1 from public.tarifario_resultado r where r.paquete_id = x.id) as con_snapshot
    from public.armado_paquetes x
),
est as (
  select
    not exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_modo63_moneda_chk') as chk_libre,
    exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_moneda_publicacion_chk') as chk_mp,
    coalesce((select pg_get_functiondef(f.oid) like '%v_otra%' from pg_proc f
               where f.proname = 'p63_requiere_trm' and f.pronamespace = 'public'::regnamespace), false) as fn_requiere_usd,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'p63_aceptacion' and column_name = 'trm_provisional') as col_prov,
    coalesce((select pg_get_functiondef(f.oid) like '%trm_provisional%' from pg_proc f
               where f.proname = 'p63_financiero_derivado' and f.pronamespace = 'public'::regnamespace), false) as fn_derivado,
    -- 234: aceptar_oferta_63 con el 6.º parámetro p_trm_provisional (OBLIGATORIO en una oferta USD sin TRM; sin respaldo en trm_referencia) y UNA sola firma (la de 5 argumentos se elimina).
    (coalesce((select bool_and(pg_get_functiondef(f.oid) like '%p_trm_provisional%' and pg_get_functiondef(f.oid) like '%p63_trm_requerida%' and pg_get_functiondef(f.oid) not like '%trm_referencia%' and f.pronargs = 6)
                from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace), false)
      and (select count(*) from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace) = 1) as fn_aceptar_prov,
    coalesce((select pg_get_functiondef(f.oid) like '%trm_provisional%' from pg_proc f
               where f.proname = 'p63_registrar_financiero' and f.pronamespace = 'public'::regnamespace), false) as fn_registrar,
    coalesce((select pg_get_functiondef(f.oid) like '%trm_provisional%' from pg_proc f
               where f.proname = 'trg_p63_inmutable' and f.pronamespace = 'public'::regnamespace), false) as fn_inmutable,
    coalesce((select pg_get_functiondef(f.oid) like '%debe ser COP o USD%' from pg_proc f
               where f.proname = 'publicar_tarifario_resultado_63' and f.pronamespace = 'public'::regnamespace), false) as fn_publicar,
    coalesce((select pg_get_functiondef(f.oid) like '%la moneda de publicación del paquete cambió mientras se cotizaba%' from pg_proc f
               where f.proname = 'crear_cotizacion_oferta_63' and f.pronamespace = 'public'::regnamespace), false) as fn_cotizar,
    coalesce((select pg_get_functiondef(f.oid) like '%la moneda de publicación del paquete cambió desde la cotización%' from pg_proc f
               where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace), false) as fn_aceptar,
    -- 234: cierre de las vías de entrada (publicador base solo por el envoltorio + TRM del paquete finita).
    exists (select 1 from pg_constraint c where c.conrelid = 'public.armado_paquetes'::regclass and c.conname = 'armado_paquetes_trm_finita_chk') as guardas,
    -- 234 punto 6: frontera de publicación sin banderas de sesión.
    coalesce(has_function_privilege('anon', to_regprocedure('public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)'), 'EXECUTE'), true) as interno_anon,
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)'), 'EXECUTE'), true) as interno_auth,
    coalesce((select pg_get_functiondef(f.oid) like '%p63_publicador%' and pg_get_functiondef(f.oid) like '%publicar_tarifario_resultado_interno%' and pg_get_functiondef(f.oid) not like '%p63_pub''%'
                from pg_proc f where f.proname = 'publicar_tarifario_resultado' and f.pronamespace = 'public'::regnamespace), false) as fachada_ok,
    coalesce((select pg_get_functiondef(f.oid) like '%publicar_tarifario_resultado_interno(%' and pg_get_functiondef(f.oid) not like '%app.p63_pub%'
                from pg_proc f where f.proname = 'publicar_tarifario_resultado_63' and f.pronamespace = 'public'::regnamespace), false) as envoltorio_ok,
    not (has_table_privilege('anon', 'public.tarifario_resultado', 'INSERT, UPDATE, DELETE, TRUNCATE')
         or has_table_privilege('authenticated', 'public.tarifario_resultado', 'INSERT, UPDATE, DELETE, TRUNCATE')) as tabla_cerrada,
    not exists (select 1 from pg_trigger t where t.tgrelid = 'public.tarifario_resultado'::regclass and t.tgname = 'trg_tarifario_resultado_solo_por_63') as sin_trigger_bandera
),
ap as (select (chk_libre and chk_mp and fn_requiere_usd and fn_publicar and fn_cotizar and fn_aceptar
                and col_prov and fn_derivado and fn_aceptar_prov and fn_registrar and fn_inmutable and guardas and fachada_ok and envoltorio_ok and not interno_anon and not interno_auth and tabla_cerrada and sin_trigger_bandera) as aplicada from est),
-- Paquetes en modo 63 en USD que TIENEN fuentes en COP y no tienen TRM: no pueden publicar ni cotizar (con todo en USD la TRM no hace falta).
usd_sin_trm as (select id from p where p.modo_oferta = 'cop_trm_63' and p.mp = 'USD' and p.trm_oferta is null and public.p63_requiere_trm(p.id)),
-- Ofertas #63 abiertas cuyo snapshot está en una moneda distinta de la que hoy elige su paquete (no se podrían aceptar).
ofertas_desfasadas as (
  select o.cotizacion_id
    from public.p63_oferta o join p on p.id = o.paquete_id
   where o.estado = 'abierta' and coalesce(nullif(o.snapshot ->> 'moneda', ''), 'COP') is distinct from coalesce(p.mp, 'COP')
),
-- Contratos nacidos de una oferta #63 cuya moneda no es la del snapshot aceptado (nunca debe pasar: lo vigila el trigger de cabecera).
contratos_desfasados as (
  select v.numero_contrato
    from public.ventas v join public.p63_aceptacion a on a.id = v.aceptacion_63_id
   where v.moneda is distinct from coalesce(nullif(a.snapshot ->> 'moneda', ''), 'COP')
),
-- Dependencia CONTABLE: la contabilidad está en pesos; una obligación aceptada en USD debe traer su equivalente COP y la TRM congelada.
cxp_usd_sin_equivalente as (
  select c.id from public.cuentas_por_pagar c
   where c.aceptacion_63_id is not null and c.moneda = 'USD' and (c.trm_63 is null or c.valor_cop_63 is null)
),
cxp63 as (select c.id from public.cuentas_por_pagar c where c.aceptacion_63_id is not null),
cxp63_sin_asiento as (
  select c.id from cxp63 c0 join public.cuentas_por_pagar c on c.id = c0.id
   where not exists (select 1 from public.asientos_contables a where a.origen = 'cxp' and a.referencia = 'cxp:' || c.id)
)
select control, valor, esperado, estado
  from (
    select 1 as ord, 'migracion_234_estructura' as control,
           case when (select aplicada from ap) then 'aplicada' else 'pendiente' end as valor, 'aplicada' as esperado,
           case when (select aplicada from ap) then 'OK' else 'REVISAR' end as estado
    union all select 2, 'check_que_ataba_el_modo63_a_cop_eliminado', (select chk_libre from est)::text, 'true', case when (select chk_libre from est) then 'OK' else 'REVISAR' end
    union all select 3, 'check_moneda_publicacion_cop_usd_sigue_vigente', (select chk_mp from est)::text, 'true', case when (select chk_mp from est) then 'OK' else 'REVISAR' end
    union all select 4, 'p63_requiere_trm_solo_si_hay_fuentes_en_la_otra_moneda', (select fn_requiere_usd from est)::text, 'true', case when (select fn_requiere_usd from est) then 'OK' else 'REVISAR' end
    union all select 5, 'rpc_publicar_acepta_usd_y_contrasta_la_moneda_elegida', (select fn_publicar from est)::text, 'true', case when (select fn_publicar from est) then 'OK' else 'REVISAR' end
    union all select 6, 'rpc_cotizar_exige_misma_moneda_en_snapshot_cabecera_y_cotizacion', (select fn_cotizar from est)::text, 'true', case when (select fn_cotizar from est) then 'OK' else 'REVISAR' end
    union all select 7, 'rpc_aceptar_rechaza_si_cambio_la_moneda_de_publicacion', (select fn_aceptar from est)::text, 'true', case when (select fn_aceptar from est) then 'OK' else 'REVISAR' end
    union all select 8, 'acl_p63_requiere_trm_ni_anon_ni_authenticated',
           (not has_function_privilege('anon', 'public.p63_requiere_trm(bigint)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.p63_requiere_trm(bigint)', 'EXECUTE'))::text, 'true',
           case when not has_function_privilege('anon', 'public.p63_requiere_trm(bigint)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'public.p63_requiere_trm(bigint)', 'EXECUTE') then 'OK' else 'REVISAR' end
    union all select 9, 'acl_cotizar_y_aceptar_solo_service_role_y_publicar_solo_authenticated',
           (not exists (select 1 from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and has_function_privilege('anon', f.oid, 'EXECUTE'))
            and not exists (select 1 from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', f.oid, 'EXECUTE'))
            and not has_function_privilege('anon', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
            and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE'))::text, 'true',
           case when not exists (select 1 from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and has_function_privilege('anon', f.oid, 'EXECUTE'))
                     and not exists (select 1 from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', f.oid, 'EXECUTE'))
                     and not has_function_privilege('anon', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
                     and not has_function_privilege('anon', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
                     and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
                then 'OK' else 'REVISAR' end
    union all select 10, 'tablas_privadas_63_con_rls_y_sin_acceso_anon_ni_authenticated',
           ((select relrowsecurity from pg_class where oid = 'public.p63_oferta'::regclass)
            and (select relrowsecurity from pg_class where oid = 'public.tarifario_oferta_63'::regclass)
            and not has_table_privilege('anon', 'public.p63_oferta', 'SELECT') and not has_table_privilege('authenticated', 'public.p63_oferta', 'SELECT')
            and not has_table_privilege('anon', 'public.tarifario_oferta_63', 'SELECT') and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'SELECT'))::text, 'true',
           case when (select relrowsecurity from pg_class where oid = 'public.p63_oferta'::regclass)
                     and (select relrowsecurity from pg_class where oid = 'public.tarifario_oferta_63'::regclass)
                     and not has_table_privilege('anon', 'public.p63_oferta', 'SELECT') and not has_table_privilege('authenticated', 'public.p63_oferta', 'SELECT')
                     and not has_table_privilege('anon', 'public.tarifario_oferta_63', 'SELECT') and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'SELECT')
                then 'OK' else 'REVISAR' end
    union all
    -- DECISIVO ANTES Y DESPUÉS: una oferta abierta cuya moneda ya no es la que elige su paquete no se podría aceptar (se debe recotizar).
    select 11, 'ofertas_63_abiertas_cotizadas_en_otra_moneda_que_la_del_paquete', (select count(*) from ofertas_desfasadas)::text, '0',
           case when (select count(*) from ofertas_desfasadas) = 0 then 'OK' else 'REVISAR' end
    union all select 12, 'contratos_63_con_moneda_distinta_a_la_del_snapshot_aceptado', (select count(*) from contratos_desfasados)::text, '0',
           case when (select count(*) from contratos_desfasados) = 0 then 'OK' else 'REVISAR' end
    union all
    -- DECISIVO tras la 234: un paquete 63 en USD sin TRM no puede publicar ni cotizar (la TRM es explícita y obligatoria en USD).
    select 13, 'paquetes_63_en_usd_con_fuentes_en_cop_sin_trm', (select count(*) from usd_sin_trm)::text, '0',
           case when (select count(*) from usd_sin_trm) = 0 then 'OK' else 'REVISAR' end
    union all select 14, 'ids_de_esos_paquetes (máx. 20)',
           coalesce((select string_agg(id::text, ', ' order by id) from (select id from usd_sin_trm order by id limit 20) t), 'ninguno'), 'ninguno',
           case when (select count(*) from usd_sin_trm) = 0 then 'OK' else 'REVISAR' end
    union all select 15, 'paquetes_63_total / en_cop / en_usd / sin_moneda_elegida (NULL = COP)',
           (select count(*) from p where p.modo_oferta = 'cop_trm_63')::text || ' / '
           || (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.mp = 'COP')::text || ' / '
           || (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.mp = 'USD')::text || ' / '
           || (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.mp is null)::text, 'dato (en_usd es 0 antes de usar la 234)', 'INFO'
    union all
    -- Un paquete 63 con tarifario publicado en una moneda distinta de la que hoy elige (p. ej. cambió a USD sin regenerar): hay que regenerar antes de cotizar.
    select 16, 'paquetes_63_publicados_en_otra_moneda_que_la_elegida (regenerar el tarifario)',
           (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.con_snapshot and p.moneda in ('COP', 'USD') and p.moneda is distinct from coalesce(p.mp, 'COP'))::text, 'dato (0 = nada que regenerar)',
           case when (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.con_snapshot and p.moneda in ('COP', 'USD') and p.moneda is distinct from coalesce(p.mp, 'COP')) = 0 then 'OK' else 'INFO' end
    union all select 17, 'tarifarios_publicables (comparar antes/después: la 234 NO debe cambiarlo)',
           (select count(*) from p where coalesce(p.publicable, false))::text, 'igual al preflight', 'INFO'
    union all select 18, 'ofertas_63_abiertas / aceptaciones_63 / contratos_63_en_usd',
           (select count(*) from public.p63_oferta where estado = 'abierta')::text || ' / '
           || (select count(*) from public.p63_aceptacion)::text || ' / '
           || (select count(*) from public.ventas v where v.aceptacion_63_id is not null and v.moneda = 'USD')::text, 'dato (los contratos en USD son 0 antes de usar la 234)', 'INFO'
    union all
    -- DEPENDENCIA CONTABLE: toda obligación aceptada en USD debe traer su TRM congelada y su equivalente COP (el asiento se devenga por ese importe).
    select 19, 'obligaciones_63_en_usd_sin_trm_o_sin_equivalente_cop', (select count(*) from cxp_usd_sin_equivalente)::text, '0',
           case when (select count(*) from cxp_usd_sin_equivalente) = 0 then 'OK' else 'REVISAR' end
    union all select 20, 'obligaciones_63_total / sin_asiento_contable_aun (la contabilidad las reintenta; dato)',
           (select count(*) from cxp63)::text || ' / ' || (select count(*) from cxp63_sin_asiento)::text, 'dato', 'INFO'
    union all select 21, 'trm_provisional_columna_derivado_aceptar_registrar_e_inmutabilidad',
           ((select col_prov and fn_derivado and fn_aceptar_prov and fn_registrar and fn_inmutable and guardas and fachada_ok and envoltorio_ok and not interno_anon and not interno_auth and tabla_cerrada and sin_trigger_bandera from est))::text, 'true',
           case when (select col_prov and fn_derivado and fn_aceptar_prov and fn_registrar and fn_inmutable and guardas and fachada_ok and envoltorio_ok and not interno_anon and not interno_auth and tabla_cerrada and sin_trigger_bandera from est) then 'OK' else 'REVISAR' end
    union all select 24, 'frontera_de_publicacion_63: fachada rechaza cop_trm_63 · envoltorio llama al interno sin bandera · interno sin EXECUTE para anon/authenticated · tarifario_resultado sin INSERT/UPDATE/DELETE/TRUNCATE para anon/authenticated · sin trigger de bandera',
           ((select fachada_ok and envoltorio_ok and not interno_anon and not interno_auth and tabla_cerrada and sin_trigger_bandera from est))::text, 'true',
           case when (select fachada_ok and envoltorio_ok and not interno_anon and not interno_auth and tabla_cerrada and sin_trigger_bandera from est) then 'OK' else 'REVISAR' end
    union all
    select 23, 'aceptaciones_63_con_trm_provisional (dato; 0 hasta contratar una oferta USD sin TRM)',
           (select count(*) from public.p63_aceptacion a where to_jsonb(a) ->> 'trm_provisional' is not null)::text, 'dato', 'INFO'
  ) q
 order by ord;
