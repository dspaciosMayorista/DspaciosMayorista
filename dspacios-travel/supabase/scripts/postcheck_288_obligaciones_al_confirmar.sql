-- POSTCHECK de la migración 288. SOLO LECTURA. UNA consulta integral. Pegar completa DESPUÉS de aplicar la 288 y ANTES de desplegar el código.
select * from (
  select 1 as o, 'Tabla de previstas con RLS y sin acceso para anon/authenticated' as control,
         (select (c.relrowsecurity and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select'))::text from pg_class c where c.oid = to_regclass('public.contrato_obligaciones_previstas')) as valor, 'true' as esperado,
         case when (select c.relrowsecurity and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select') from pg_class c where c.oid = to_regclass('public.contrato_obligaciones_previstas')) then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Guarda de identidad instalada en la tabla de previstas',
         (exists (select 1 from pg_trigger where tgrelid = 'public.contrato_obligaciones_previstas'::regclass and tgname = 'trg_contrato_guarda'))::text, 'true',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.contrato_obligaciones_previstas'::regclass and tgname = 'trg_contrato_guarda') then 'OK' else 'REVISAR' end
  union all select 3, 'Columnas e índice únicos (ventas.obligaciones_materializadas_en, cuentas_por_pagar.clave_prevista, cxp_clave_prevista_uq)',
         ((select count(*) from information_schema.columns where table_schema='public' and ((table_name='ventas' and column_name='obligaciones_materializadas_en') or (table_name='cuentas_por_pagar' and column_name='clave_prevista')))
           + (select count(*) from pg_indexes where indexname = 'cxp_clave_prevista_uq'))::text, '3',
         case when (select count(*) from information_schema.columns where table_schema='public' and ((table_name='ventas' and column_name='obligaciones_materializadas_en') or (table_name='cuentas_por_pagar' and column_name='clave_prevista')))
                    + (select count(*) from pg_indexes where indexname = 'cxp_clave_prevista_uq') = 3 then 'OK' else 'REVISAR' end
  union all select 4, 'confirmar_venta materializa (llama p75_priv.materializar_obligaciones) y sigue siendo SECURITY INVOKER',
         (select (position('p75_priv.materializar_obligaciones' in p.prosrc) > 0 and not p.prosecdef)::text from pg_proc p where p.oid = 'public.confirmar_venta(text)'::regprocedure), 'true',
         case when (select position('p75_priv.materializar_obligaciones' in p.prosrc) > 0 and not p.prosecdef from pg_proc p where p.oid = 'public.confirmar_venta(text)'::regprocedure) then 'OK' else 'REVISAR' end
  union all select 5, 'registrar_abono y registrar_financiero_contrato envuelven a sus bases verbatim',
         (select (position('p75_priv.registrar_abono_base' in a.prosrc) > 0 and position('p75_priv.registrar_financiero_base' in f.prosrc) > 0)::text
            from pg_proc a, pg_proc f where a.oid = 'public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)'::regprocedure and f.oid = 'public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure), 'true',
         case when (select position('p75_priv.registrar_abono_base' in a.prosrc) > 0 and position('p75_priv.registrar_financiero_base' in f.prosrc) > 0
            from pg_proc a, pg_proc f where a.oid = 'public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)'::regprocedure and f.oid = 'public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure) then 'OK' else 'REVISAR' end
  union all select 6, 'confirmar_por_pago: SOLO service_role (nadie confirma «como» otro)',
         (has_function_privilege('service_role', 'p75_priv.confirmar_por_pago(text,uuid)', 'execute') and not has_function_privilege('authenticated', 'p75_priv.confirmar_por_pago(text,uuid)', 'execute')
            and not has_function_privilege('anon', 'p75_priv.confirmar_por_pago(text,uuid)', 'execute'))::text, 'true',
         case when has_function_privilege('service_role', 'p75_priv.confirmar_por_pago(text,uuid)', 'execute') and not has_function_privilege('authenticated', 'p75_priv.confirmar_por_pago(text,uuid)', 'execute')
                   and not has_function_privilege('anon', 'p75_priv.confirmar_por_pago(text,uuid)', 'execute') then 'OK' else 'REVISAR' end
  union all select 7, 'Las bases no son invocables por anon/authenticated',
         (not has_function_privilege('authenticated', 'p75_priv.registrar_financiero_base(text,text,jsonb,jsonb)', 'execute') and not has_function_privilege('anon', 'p75_priv.registrar_financiero_base(text,text,jsonb,jsonb)', 'execute')
            and not has_function_privilege('authenticated', 'p75_priv.registrar_abono_base(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)', 'execute'))::text, 'true',
         case when not has_function_privilege('authenticated', 'p75_priv.registrar_financiero_base(text,text,jsonb,jsonb)', 'execute') and not has_function_privilege('anon', 'p75_priv.registrar_financiero_base(text,text,jsonb,jsonb)', 'execute')
                   and not has_function_privilege('authenticated', 'p75_priv.registrar_abono_base(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)', 'execute') then 'OK' else 'REVISAR' end
  union all select 8, 'Invariante: ningún contrato CONFIRMADO con previstas sin materializar y sin marcador',
         (select count(*)::text from public.contrato_obligaciones_previstas p join public.ventas v on v.numero_contrato = p.numero_contrato where v.estado = 'confirmado' and p.materializada_en is null and v.obligaciones_materializadas_en is null), '0',
         case when (select count(*) from public.contrato_obligaciones_previstas p join public.ventas v on v.numero_contrato = p.numero_contrato where v.estado = 'confirmado' and p.materializada_en is null and v.obligaciones_materializadas_en is null) = 0 then 'OK' else 'REVISAR' end
  union all select 8.1, 'Escritores 1b presentes: la conversión envuelve su base, el trigger #63 respeta el traslado, y existen edición atómica, reintento y paso final de conversión',
         ((select position('p75_priv.convertir_cotizacion_base' in prosrc) > 0 from pg_proc where oid = 'public.convertir_cotizacion_a_contrato(bigint,uuid)'::regprocedure)
          and (select position('app.p75_traslado' in prosrc) > 0 from pg_proc where oid = 'public.trg_cxp_borrada_63()'::regprocedure)
          and to_regprocedure('public.pendiente_aplicar_servicios(text,bigint[],jsonb,jsonb,bigint[],jsonb,jsonb,bigint[],jsonb)') is not null
          and to_regprocedure('public.reintentar_confirmacion_pago(text)') is not null and to_regprocedure('public.confirmar_tras_conversion(text,uuid)') is not null)::text, 'true',
         case when (select position('p75_priv.convertir_cotizacion_base' in prosrc) > 0 from pg_proc where oid = 'public.convertir_cotizacion_a_contrato(bigint,uuid)'::regprocedure)
          and (select position('app.p75_traslado' in prosrc) > 0 from pg_proc where oid = 'public.trg_cxp_borrada_63()'::regprocedure)
          and to_regprocedure('public.pendiente_aplicar_servicios(text,bigint[],jsonb,jsonb,bigint[],jsonb,jsonb,bigint[],jsonb)') is not null
          and to_regprocedure('public.reintentar_confirmacion_pago(text)') is not null and to_regprocedure('public.confirmar_tras_conversion(text,uuid)') is not null then 'OK' else 'REVISAR' end
  union all select 8.2, 'Permisos 1b: edición atómica y paso final de conversión SOLO service_role; el reintento solo usuarios autenticados (nunca anon)',
         (has_function_privilege('service_role', 'public.pendiente_aplicar_servicios(text,bigint[],jsonb,jsonb,bigint[],jsonb,jsonb,bigint[],jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.pendiente_aplicar_servicios(text,bigint[],jsonb,jsonb,bigint[],jsonb,jsonb,bigint[],jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.confirmar_tras_conversion(text,uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.reintentar_confirmacion_pago(text)', 'execute')
          and not has_function_privilege('anon', 'public.reintentar_confirmacion_pago(text)', 'execute'))::text, 'true',
         case when has_function_privilege('service_role', 'public.pendiente_aplicar_servicios(text,bigint[],jsonb,jsonb,bigint[],jsonb,jsonb,bigint[],jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.pendiente_aplicar_servicios(text,bigint[],jsonb,jsonb,bigint[],jsonb,jsonb,bigint[],jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.confirmar_tras_conversion(text,uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.reintentar_confirmacion_pago(text)', 'execute')
          and not has_function_privilege('anon', 'public.reintentar_confirmacion_pago(text)', 'execute') then 'OK' else 'REVISAR' end
  union all select o, c, v, e, case when v = e then 'OK' else 'REVISAR' end from (select 8.3 as o, 'Parte 3 · firmas: regla_confirmacion(text) jsonb, pagado_en(text,text,numeric) numeric, estado_minimo(text) jsonb, normalizar_abonos_previos(text) void, contrato_es_neto(text) boolean' as c,
         concat_ws(',', pg_get_function_result('p75_priv.regla_confirmacion(text)'::regprocedure), pg_get_function_result('p75_priv.pagado_en(text,text,numeric)'::regprocedure), pg_get_function_result('p75_priv.estado_minimo(text)'::regprocedure), pg_get_function_result('p75_priv.normalizar_abonos_previos(text)'::regprocedure), pg_get_function_result('public.contrato_es_neto(text)'::regprocedure)) as v, 'jsonb,numeric,jsonb,void,boolean' as e) z
  union all select o, c, v, e, case when v = e then 'OK' else 'REVISAR' end from (select 8.4 as o, 'Parte 3 · permisos: las 4 de p75_priv SOLO service_role (ni anon ni authenticated); contrato_es_neto lo ejecutan authenticated y service_role, nunca anon' as c,
         (has_function_privilege('service_role','p75_priv.regla_confirmacion(text)','execute') and not has_function_privilege('authenticated','p75_priv.regla_confirmacion(text)','execute') and not has_function_privilege('anon','p75_priv.regla_confirmacion(text)','execute')
          and has_function_privilege('service_role','p75_priv.pagado_en(text,text,numeric)','execute') and not has_function_privilege('authenticated','p75_priv.pagado_en(text,text,numeric)','execute') and not has_function_privilege('anon','p75_priv.pagado_en(text,text,numeric)','execute')
          and has_function_privilege('service_role','p75_priv.estado_minimo(text)','execute') and not has_function_privilege('authenticated','p75_priv.estado_minimo(text)','execute') and not has_function_privilege('anon','p75_priv.estado_minimo(text)','execute')
          and has_function_privilege('service_role','p75_priv.normalizar_abonos_previos(text)','execute') and not has_function_privilege('authenticated','p75_priv.normalizar_abonos_previos(text)','execute') and not has_function_privilege('anon','p75_priv.normalizar_abonos_previos(text)','execute')
          and has_function_privilege('authenticated','public.contrato_es_neto(text)','execute') and has_function_privilege('service_role','public.contrato_es_neto(text)','execute') and not has_function_privilege('anon','public.contrato_es_neto(text)','execute'))::text as v, 'true' as e) z
  union all select o, c, v, e, case when v = e then 'OK' else 'REVISAR' end from (select 8.5 as o, 'Parte 3 · comportamiento SIN escrituras (STABLE): contrato inexistente → regla y estado nulos, pagado 0, no NETO' as c,
         concat_ws('|', (p75_priv.regla_confirmacion('__sin_contrato__') is null)::text, (p75_priv.estado_minimo('__sin_contrato__') is null)::text, (p75_priv.pagado_en('__sin_contrato__','COP',1) = 0)::text, public.contrato_es_neto('__sin_contrato__')::text) as v, 'true|true|true|false' as e) z
  union all select o, c, v, e, case when v = e then 'OK' else 'REVISAR' end from (select 8.6 as o, 'Parte 3 · contratos reales (solo lectura): ninguno con regla fuera de {neto_total, condicion_congelada, legacy_pct}, moneda fuera de {COP,USD} o mínimo nulo/negativo' as c,
         (select count(*)::text from public.ventas x, lateral (select p75_priv.regla_confirmacion(x.numero_contrato) g) r where r.g is null or (r.g->>'regla') not in ('neto_total','condicion_congelada','legacy_pct') or (r.g->>'moneda') not in ('COP','USD') or coalesce((r.g->>'minimo')::numeric, -1) < 0) as v, '0' as e) z
  union all select o, c, v, e, case when v = e then 'OK' else 'REVISAR' end from (select 8.7 as o, 'Parte 3 · invariante: ningún contrato NETO o con condiciones congeladas resuelve por legacy_pct (el 30 % paralelo)' as c,
         (select count(*)::text from public.ventas x where p75_priv.regla_confirmacion(x.numero_contrato)->>'regla' = 'legacy_pct' and (x.comision_estado = 'descontada' or exists (select 1 from public.contrato_condiciones c where c.numero_contrato = x.numero_contrato))) as v, '0' as e) z
  union all select 8.8, 'Parte 3 · INFO: contratos PENDIENTES que ya alcanzan su mínimo (confirmación pendiente por reintentar)',
         (select count(*)::text from public.ventas x where x.estado = 'pendiente' and coalesce((p75_priv.estado_minimo(x.numero_contrato)->>'alcanza')::boolean, false)), '(informativo)', 'INFO'
  union all select 9, 'Previstas pendientes de materializar (hoy)', (select count(*)::text from public.contrato_obligaciones_previstas where materializada_en is null), '(informativo)', 'INFO'
  union all select 10, '#97: public.materializar_comision_b2b existe (la llama la materialización si está)', (to_regprocedure('public.materializar_comision_b2b(text)') is not null)::text, '(informativo; la 286 va DESPUÉS de la 288)', 'INFO'
) q order by o;
