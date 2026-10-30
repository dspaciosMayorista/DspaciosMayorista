-- ───────────────────────────────────────────────────────────────────────────
-- 235 · PREFLIGHT + POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = falta algo o requiere decisión · INFO = dato (o pendiente de una fase anterior).
-- Se corre DOS veces con el mismo archivo (requiere la 234 aplicada):
--   1) ANTES de la 235: la estructura sale REVISAR ("pendiente"); los controles de datos ya son decisivos (no hay nada que convertir todavía) y
--      'huella_de_datos_que_la_235_no_debe_tocar' / 'tarifarios_publicables' se anotan para compararlos después.
--   2) DESPUÉS de la 235: TODO debe salir OK (los INFO son solo datos); la huella y los tarifarios publicables deben ser IGUALES a los del preflight.
-- No usa funciones ni columnas de la 235 (se lee con to_jsonb): corre igual antes y después. No imprime filas de negocio: solo conteos e ids (máx. 20).
-- ───────────────────────────────────────────────────────────────────────────
with
v as (
  select x.numero_contrato, x.tenant, x.moneda, x.precio_venta, x.aceptacion_63_id,
         to_jsonb(x) ->> 'moneda_cobro' as mc, (to_jsonb(x) ->> 'trm_cobro')::numeric as tc, (to_jsonb(x) ->> 'total_cobro')::numeric as tt
    from public.ventas x
),
a as (
  select x.id, x.numero_contrato, x.estado, x.snapshot,
         to_jsonb(x) ->> 'moneda_cobro' as mc, (to_jsonb(x) ->> 'trm_cobro')::numeric as tc, (to_jsonb(x) ->> 'total_cobro')::numeric as tt
    from public.p63_aceptacion x
),
-- Contratos que se cobran en una moneda DISTINTA de la de su oferta (conversión congelada).
conv as (select * from v where mc is not null and mc is distinct from coalesce(moneda, 'COP')),
-- La fórmula (espejo de p63_total_cobro, inline para correr también antes de la 235): el total congelado debe ser el recalculado.
conv_incoherentes as (
  select c.numero_contrato from conv c
   where c.tc is null or c.tc <= 0 or c.tt is null or c.tt <= 0
      or c.tt is distinct from (case when c.mc = 'COP' then ceil(round(c.precio_venta * c.tc, 2) / 1000) * 1000 else ceil(round(c.precio_venta / c.tc, 2)) end)
),
-- La cabecera de un contrato #63 lleva EXACTAMENTE el cobro congelado en su aceptación.
cab_vs_aceptacion as (
  select v.numero_contrato from v join a on a.id = v.aceptacion_63_id
   where v.mc is distinct from a.mc or v.tc is distinct from a.tc or v.tt is distinct from a.tt
),
-- Abonos de contratos convertidos: en la moneda de cobro valor_abono × trm = monto_cop (COP: trm 1 y valor = monto). Tolerancia de 1 peso por redondeo.
abonos_conv as (
  select ab.id, ab.numero_contrato from public.abonos ab join conv c on c.numero_contrato = ab.numero_contrato
   where (c.mc = 'COP' and (coalesce(ab.trm, 1) <> 1 or abs(coalesce(ab.monto_cop, 0) - ab.valor_abono) > 1))
      or (c.mc = 'USD' and (coalesce(ab.trm, 0) <= 0 or abs(coalesce(ab.monto_cop, 0) - ab.valor_abono * ab.trm) > 1))
),
sobrepago as (
  select c.numero_contrato from conv c
   where coalesce((select sum(ab.valor_abono) from public.abonos ab where ab.numero_contrato = c.numero_contrato), 0) > c.tt
),
est as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('ventas', 'p63_aceptacion') and column_name in ('moneda_cobro', 'trm_cobro', 'total_cobro')) = 6 as columnas,
    exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and conname = 'ventas_cobro_chk')
      and exists (select 1 from pg_constraint where conrelid = 'public.p63_aceptacion'::regclass and conname = 'p63_aceptacion_cobro_chk') as checks,
    to_regprocedure('public.p63_total_cobro(numeric, text, text, numeric)') is not null as fn_total,
    coalesce(has_function_privilege('anon', to_regprocedure('public.p63_total_cobro(numeric, text, text, numeric)'), 'EXECUTE'), true)
      or coalesce(has_function_privilege('authenticated', to_regprocedure('public.p63_total_cobro(numeric, text, text, numeric)'), 'EXECUTE'), true) as total_expuesta,
    (select count(*) from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace) = 1
      and coalesce((select f.pronargs = 8 and pg_get_functiondef(f.oid) like '%p_moneda_cobro%' and pg_get_functiondef(f.oid) like '%p63_cobro_cambio%'
                      and pg_get_functiondef(f.oid) not like '%trm_referencia%'
                      from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace), false) as fn_aceptar,
    coalesce((select has_function_privilege('service_role', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE') and not has_function_privilege('anon', f.oid, 'EXECUTE')
                from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and f.pronargs = 8), false) as acl_aceptar,
    coalesce((select pg_get_functiondef(f.oid) like '%moneda_cobro%' from pg_proc f where f.proname = 'trg_ventas_aceptacion_63_ins' and f.pronamespace = 'public'::regnamespace), false) as trg_cabecera,
    coalesce((select pg_get_functiondef(f.oid) like '%total_cobro%' from pg_proc f where f.proname = 'trg_p63_inmutable' and f.pronamespace = 'public'::regnamespace), false) as trg_inmutable,
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.ventas'::regclass and t.tgname = 'trg_ventas_cobro_congelado' and not t.tgisinternal) as trg_congelado,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica' and column_name in ('moneda_cobro', 'trm_cobro', 'total_cobro')) = 3 as vista,
    -- 1) La RPC rechaza la omisión de la moneda de cobro ANTES de revalidar y de reservar el número, y no hay valor por defecto.
    coalesce((select strpos(s.d, 'p63_cobro_requerido: elige la moneda') > 0
                 and strpos(s.d, 'p63_cobro_requerido: elige la moneda') < strpos(s.d, 'v_hoy := public.p63_hoy_bogota();')
                 and strpos(s.d, 'p63_cobro_requerido: elige la moneda') < strpos(s.d, 'siguiente_numero_contrato_para_tenant')
                 and strpos(s.d, 'v_mc := p_moneda_cobro;') > 0
                 and strpos(s.d, 'coalesce(p_moneda_cobro') = 0
                from (select pg_get_functiondef(f.oid) as d from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and f.pronargs = 8) s), false) as rpc_requerido,
    -- 2) Defensa en profundidad: trigger BEFORE INSERT por fila, habilitado, que impide insertar una aceptación nueva sin moneda de cobro.
    (exists (select 1 from pg_trigger t where t.tgrelid = 'public.p63_aceptacion'::regclass and t.tgname = 'trg_p63_aceptacion_cobro_requerido'
                and not t.tgisinternal and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4)
     and coalesce((select pg_get_functiondef(f.oid) like '%p63_cobro_requerido%' from pg_proc f where f.proname = 'trg_p63_aceptacion_cobro_requerido' and f.pronamespace = 'public'::regnamespace), false)) as trg_acept,
    -- 3) Cartera del dashboard: usa la moneda/total de cobro congelados, SECURITY INVOKER, STABLE, ejecutable por authenticated y service_role, no por anon.
    coalesce((select pg_get_functiondef(f.oid) like '%v.moneda_cobro%' and pg_get_functiondef(f.oid) like '%v.total_cobro%' and pg_get_functiondef(f.oid) like '%v.trm_cobro%'
                 and not f.prosecdef and f.provolatile = 's'
                 and has_function_privilege('authenticated', f.oid, 'EXECUTE') and has_function_privilege('service_role', f.oid, 'EXECUTE')
                 and not has_function_privilege('anon', f.oid, 'EXECUTE')
                from pg_proc f where f.proname = 'fn_dashboard_cartera_por_moneda' and f.pronamespace = 'public'::regnamespace), false) as dash,
    -- 4) Facturación: la fuente de importes de facturar_factura rechaza (F4451) un contrato con cobro en otra moneda ANTES de calcular nada; solo service_role.
    coalesce((select strpos(s.d, 'F4451') > 0 and strpos(s.d, 'F4451') < strpos(s.d, 'tenant := v.tenant') and s.d like '%v.moneda_cobro%' and s.priv
                from (select pg_get_functiondef(f.oid) as d,
                             has_function_privilege('service_role', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
                               and not has_function_privilege('anon', f.oid, 'EXECUTE') as priv
                        from pg_proc f where f.proname = 'importes_factura' and f.pronamespace = (select n.oid from pg_namespace n where n.nspname = 'f208_priv')) s), false) as importes,
    -- 5) Segunda barrera: trigger BEFORE INSERT OR UPDATE por fila sobre contrato_facturacion, habilitado, con función SECURITY DEFINER que lanza F4451.
    (exists (select 1 from pg_trigger t where t.tgrelid = 'public.contrato_facturacion'::regclass and t.tgname = 'trg_p235_cf_cobro_guarda'
                and not t.tgisinternal and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16)
     and coalesce((select pg_get_functiondef(f.oid) like '%F4451%' and f.prosecdef from pg_proc f where f.proname = 'p235_cf_cobro_guarda' and f.pronamespace = 'public'::regnamespace), false)) as trg_cf
),
ap as (select (columnas and checks and fn_total and not total_expuesta and fn_aceptar and acl_aceptar and trg_cabecera and trg_inmutable and trg_congelado and vista and rpc_requerido and trg_acept and dash and importes and trg_cf) as aplicada from est)
select control, valor, esperado, estado
  from (
    select 1 as ord, 'migracion_235_estructura' as control, case when (select aplicada from ap) then 'aplicada' else 'pendiente' end as valor, 'aplicada' as esperado,
           case when (select aplicada from ap) then 'OK' else 'REVISAR' end as estado
    union all select 2, 'columnas_moneda_cobro_trm_cobro_total_cobro_en_ventas_y_p63_aceptacion', (select columnas from est)::text, 'true', case when (select columnas from est) then 'OK' else 'REVISAR' end
    union all select 3, 'checks_de_coherencia_ventas_cobro_chk_y_p63_aceptacion_cobro_chk', (select checks from est)::text, 'true', case when (select checks from est) then 'OK' else 'REVISAR' end
    union all select 4, 'p63_total_cobro_existe_y_no_la_ejecuta_anon_ni_authenticated', ((select fn_total and not total_expuesta from est))::text, 'true',
           case when (select fn_total and not total_expuesta from est) then 'OK' else 'REVISAR' end
    union all select 5, 'aceptar_oferta_63_una_sola_firma_de_8_argumentos_con_p63_cobro_cambio_y_sin_trm_referencia', (select fn_aceptar from est)::text, 'true',
           case when (select fn_aceptar from est) then 'OK' else 'REVISAR' end
    union all select 6, 'aceptar_oferta_63_solo_service_role', (select acl_aceptar from est)::text, 'true', case when (select acl_aceptar from est) then 'OK' else 'REVISAR' end
    union all select 7, 'cabecera_inmutabilidad_y_cobro_congelado_en_triggers', ((select trg_cabecera and trg_inmutable and trg_congelado from est))::text, 'true',
           case when (select trg_cabecera and trg_inmutable and trg_congelado from est) then 'OK' else 'REVISAR' end
    union all select 8, 'ventas_basica_expone_la_moneda_de_cobro', (select vista from est)::text, 'true', case when (select vista from est) then 'OK' else 'REVISAR' end
    union all select 8.1, 'aceptar_oferta_63_rechaza_sin_moneda_de_cobro_p63_cobro_requerido_antes_de_numerar_y_sin_valor_por_defecto', (select rpc_requerido from est)::text, 'true',
           case when (select rpc_requerido from est) then 'OK' else 'REVISAR' end
    union all select 8.2, 'trigger_trg_p63_aceptacion_cobro_requerido_habilitado_antes_de_insertar', (select trg_acept from est)::text, 'true',
           case when (select trg_acept from est) then 'OK' else 'REVISAR' end
    union all select 8.3, 'fn_dashboard_cartera_por_moneda_con_moneda_de_cobro_invoker_stable_y_permisos', (select dash from est)::text, 'true',
           case when (select dash from est) then 'OK' else 'REVISAR' end
    union all select 8.4, 'f208_priv_importes_factura_rechaza_F4451_antes_de_calcular_y_solo_service_role', (select importes from est)::text, 'true',
           case when (select importes from est) then 'OK' else 'REVISAR' end
    union all select 8.5, 'trigger_trg_p235_cf_cobro_guarda_habilitado_sobre_contrato_facturacion', (select trg_cf from est)::text, 'true',
           case when (select trg_cf from est) then 'OK' else 'REVISAR' end
    -- ── DATOS (decisivos antes y después) ─────────────────────────────────────────────────────────────────────────────────────────────
    union all select 9, 'contratos_cobrados_en_otra_moneda_que_su_oferta (conversión congelada)', (select count(*) from conv)::text, 'dato (0 antes de usar la 235)', 'INFO'
    union all select 10, 'ids_de_esos_contratos (máx. 20)',
           coalesce((select string_agg(numero_contrato, ', ' order by numero_contrato) from (select numero_contrato from conv order by numero_contrato limit 20) t), 'ninguno'), 'dato', 'INFO'
    union all select 11, 'contratos_convertidos_con_total_o_TRM_incoherente_con_la_fórmula', (select count(*) from conv_incoherentes)::text, '0',
           case when (select count(*) from conv_incoherentes) = 0 then 'OK' else 'REVISAR' end
    union all select 12, 'contratos_63_cuya_cabecera_no_coincide_con_el_cobro_congelado_en_su_aceptación', (select count(*) from cab_vs_aceptacion)::text, '0',
           case when (select count(*) from cab_vs_aceptacion) = 0 then 'OK' else 'REVISAR' end
    union all select 13, 'abonos_de_contratos_convertidos_incoherentes (valor × TRM ≠ pesos, o COP con TRM ≠ 1)', (select count(*) from abonos_conv)::text, '0',
           case when (select count(*) from abonos_conv) = 0 then 'OK' else 'REVISAR' end
    union all select 14, 'contratos_convertidos_con_abonos_por_encima_del_total_a_cobrar (sobrepago)', (select count(*) from sobrepago)::text, '0',
           case when (select count(*) from sobrepago) = 0 then 'OK' else 'REVISAR' end
    union all select 15, 'aceptaciones_63_total / preparadas_o_materializando (en vuelo al desplegar; dato)',
           (select count(*) from a)::text || ' / ' || (select count(*) from a where estado in ('preparada', 'materializando'))::text, 'dato', 'INFO'
    union all select 16, 'contratos_63_total / sin_elección_de_cobro (anteriores a la 235: se cobran en la moneda de su oferta; dato)',
           (select count(*) from v where aceptacion_63_id is not null)::text || ' / ' || (select count(*) from v where aceptacion_63_id is not null and mc is null)::text, 'dato', 'INFO'
    -- ── LO QUE LA 235 NO DEBE TOCAR (comparar antes/después) ─────────────────────────────────────────────────────────────────────────
    union all select 17, 'tarifarios_publicables (comparar antes/después: la 235 NO debe cambiarlo)',
           (select count(*) from public.armado_paquetes where coalesce(tarifario_snapshot_publicable, false))::text, 'igual al preflight', 'INFO'
    union all select 18, 'ofertas_63 / cotizaciones / filas_de_tarifario_resultado (comparar antes/después)',
           (select count(*) from public.p63_oferta)::text || ' / ' || (select count(*) from public.cotizaciones)::text || ' / ' || (select count(*) from public.tarifario_resultado)::text, 'igual al preflight', 'INFO'
    union all select 19, 'huella_de_datos_que_la_235_no_debe_tocar (md5 de ofertas, cotizaciones y tarifario publicado)',
           md5(concat_ws('|',
             (select md5(coalesce(string_agg(o::text, ',' order by o.id), '')) from public.p63_oferta o),
             (select md5(coalesce(string_agg(c::text, ',' order by c.id), '')) from public.cotizaciones c),
             (select md5(coalesce(string_agg(r::text, ',' order by r.id), '')) from public.tarifario_resultado r))), 'igual al preflight', 'INFO'
  ) q
 order by ord;
