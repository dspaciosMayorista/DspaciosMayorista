-- PREFLIGHT de la migración 288 (#75, parte 1: obligaciones al confirmar). SOLO LECTURA. UNA consulta integral: pegar completa en el editor SQL ANTES de aplicarla.
-- Columnas: control · valor · esperado · estado (OK / REVISAR / INFO). NO se asume que el remoto coincida con el repo: se comparan las definiciones que la 288
-- envuelve o reemplaza (md5 del cuerpo sin CR). Si algún control dice REVISAR, NO aplicar: la migración también lo comprueba y aborta.
with md as (select p.oid::regprocedure::text as f, md5(replace(p.prosrc, chr(13), '')) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
             where p.proname in ('confirmar_venta','registrar_abono','registrar_financiero_contrato','_confirmar_sillas_de_venta','p63_registrar_financiero','convertir_cotizacion_a_contrato','transferir_pagos_previos_a_abonos','trg_cxp_borrada_63'))
select * from (
  select 1 as o, 'Identidad del contrato (284/285) y reuso (287) aplicados' as control,
         (to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null and to_regprocedure('public.soporte_verificar_identidad(text)') is not null
          and to_regclass('public.numeros_dtm_liberados') is not null)::text as valor, 'true' as esperado,
         case when to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null and to_regprocedure('public.soporte_verificar_identidad(text)') is not null
               and to_regclass('public.numeros_dtm_liberados') is not null then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La 288 NO está aplicada (tabla, esquema y columna ausentes)',
         (to_regclass('public.contrato_obligaciones_previstas') is not null or to_regnamespace('p75_priv') is not null
          or exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='obligaciones_materializadas_en'))::text, 'false',
         case when to_regclass('public.contrato_obligaciones_previstas') is null and to_regnamespace('p75_priv') is null then 'OK' else 'REVISAR' end
  union all select 3, 'confirmar_venta es la de la 197',
         coalesce((select m from md where f = 'confirmar_venta(text)'), 'NO EXISTE'), '97809e36dab24bc4ecfddf37a9ef4016',
         case when (select m from md where f = 'confirmar_venta(text)') = '97809e36dab24bc4ecfddf37a9ef4016' then 'OK' else 'REVISAR' end
  union all select 4, 'registrar_abono es la de la 248',
         coalesce((select m from md where f like 'registrar_abono(%'), 'NO EXISTE'), 'b2e0d1e0aa37bcf11e00c58afbabffd9',
         case when (select m from md where f like 'registrar_abono(%') = 'b2e0d1e0aa37bcf11e00c58afbabffd9' then 'OK' else 'REVISAR' end
  union all select 5, 'registrar_financiero_contrato es la de la 236',
         coalesce((select m from md where f like 'registrar_financiero_contrato(%'), 'NO EXISTE'), '33e309dc1181020d20809a4f79394dbc',
         case when (select m from md where f like 'registrar_financiero_contrato(%') = '33e309dc1181020d20809a4f79394dbc' then 'OK' else 'REVISAR' end
  union all select 6, '_confirmar_sillas_de_venta (la usa confirmar_venta) es la de la 197',
         coalesce((select m from md where f = '_confirmar_sillas_de_venta(text)'), 'NO EXISTE'), 'e6e1ca72047d70ecd5c68a47a03d32b0',
         case when (select m from md where f = '_confirmar_sillas_de_venta(text)') = 'e6e1ca72047d70ecd5c68a47a03d32b0' then 'OK' else 'REVISAR' end
  union all select 7, 'p63_registrar_financiero (la llama la base; sus CxP #63 NO se trasladan) es la de la 227',
         coalesce((select m from md where f like 'p63_registrar_financiero(%'), 'NO EXISTE'), 'b2eee9739b907f88db171f123dead8d3',
         case when (select m from md where f like 'p63_registrar_financiero(%') = 'b2eee9739b907f88db171f123dead8d3' then 'OK' else 'REVISAR' end
  union all select 7.1, 'convertir_cotizacion_a_contrato es la de la 198 (la 288 la envuelve)',
         coalesce((select m from md where f like 'convertir_cotizacion_a_contrato(%'), 'NO EXISTE'), 'edc9975010746e53e4af6a75ad9763dc',
         case when (select m from md where f like 'convertir_cotizacion_a_contrato(%') = 'edc9975010746e53e4af6a75ad9763dc' then 'OK' else 'REVISAR' end
  union all select 7.2, 'transferir_pagos_previos_a_abonos es la de la 164',
         coalesce((select m from md where f like 'transferir_pagos_previos_a_abonos(%'), 'NO EXISTE'), '4814691695eb7587c18628ede17f266f',
         case when (select m from md where f like 'transferir_pagos_previos_a_abonos(%') = '4814691695eb7587c18628ede17f266f' then 'OK' else 'REVISAR' end
  union all select 7.3, 'trg_cxp_borrada_63 (protección de obligaciones #63) es la de la 227',
         coalesce((select m from md where f like 'trg_cxp_borrada_63(%'), 'NO EXISTE'), 'c3150ccad0ef87818956ebc1e53f82d9',
         case when (select m from md where f like 'trg_cxp_borrada_63(%') = 'c3150ccad0ef87818956ebc1e53f82d9' then 'OK' else 'REVISAR' end
  union all select 8, 'Funciones de soporte presentes (marca_cxp_automatica, contrato_instalar_guardas, config_cobros)',
         (to_regprocedure('public.marca_cxp_automatica()') is not null and to_regprocedure('public.contrato_instalar_guardas()') is not null and to_regclass('public.config_cobros') is not null)::text, 'true',
         case when to_regprocedure('public.marca_cxp_automatica()') is not null and to_regprocedure('public.contrato_instalar_guardas()') is not null and to_regclass('public.config_cobros') is not null then 'OK' else 'REVISAR' end
  union all select 9, 'ORDEN con #97: la 286 (materializar_comision_b2b) aplicada ANTES que la 288 deja una ventana en la que las comisiones diferidas no se materializan; aplicar la 288 primero',
         (to_regprocedure('public.materializar_comision_b2b(text)') is not null)::text, 'false',
         case when to_regprocedure('public.materializar_comision_b2b(text)') is null then 'OK' else 'REVISAR' end
  union all select 10, 'DIAGNÓSTICO (D5): contratos PENDIENTES que ya tienen CxP (flujo anterior). No se modifican; no serán elegibles para reuso hasta conciliarlos',
         (select count(distinct v.numero_contrato)::text from public.ventas v join public.cuentas_por_pagar c on c.numero_contrato = v.numero_contrato where v.estado = 'pendiente'), '(informativo)', 'INFO'
  union all select 11, 'DIAGNÓSTICO: contratos PENDIENTES con comisión B2B ya creada en aliados_b2b',
         (select count(distinct v.numero_contrato)::text from public.ventas v join public.aliados_b2b b on b.numero_contrato = v.numero_contrato where v.estado = 'pendiente'), '(informativo)', 'INFO'
  union all select 12, 'DIAGNÓSTICO: contratos PENDIENTES en total',
         (select count(*)::text from public.ventas where estado = 'pendiente'), '(informativo)', 'INFO'
  union all select 13, 'Parte 3: columnas que usan la regla única y la normalización de abonos existen (ventas.moneda_cobro/total_cobro/trm_cobro/comision_estado, contrato_condiciones.monto_exigido/moneda/trm, cotizacion_pagos_previos.abono_id/moneda/monto_moneda, abonos.monto_cop/trm, config_cobros.pct_abono)',
         (select count(*)::text from information_schema.columns where table_schema='public' and (
            (table_name='ventas' and column_name in ('moneda_cobro','total_cobro','trm_cobro','comision_estado')) or (table_name='contrato_condiciones' and column_name in ('monto_exigido','moneda','trm'))
            or (table_name='cotizacion_pagos_previos' and column_name in ('abono_id','moneda','monto_moneda')) or (table_name='abonos' and column_name in ('monto_cop','trm')) or (table_name='config_cobros' and column_name='pct_abono'))), '13',
         case when (select count(*) from information_schema.columns where table_schema='public' and (
            (table_name='ventas' and column_name in ('moneda_cobro','total_cobro','trm_cobro','comision_estado')) or (table_name='contrato_condiciones' and column_name in ('monto_exigido','moneda','trm'))
            or (table_name='cotizacion_pagos_previos' and column_name in ('abono_id','moneda','monto_moneda')) or (table_name='abonos' and column_name in ('monto_cop','trm')) or (table_name='config_cobros' and column_name='pct_abono'))) = 13 then 'OK' else 'REVISAR' end
  union all select 14, 'Parte 3: regla_confirmacion, pagado_en, estado_minimo, normalizar_abonos_previos y contrato_es_neto NO existen aún (la 288 las crea)',
         (to_regprocedure('public.contrato_es_neto(text)') is not null or to_regnamespace('p75_priv') is not null)::text, 'false',
         case when to_regprocedure('public.contrato_es_neto(text)') is null and to_regnamespace('p75_priv') is null then 'OK' else 'REVISAR' end
  union all select 15, 'DIAGNÓSTICO Parte 3: abonos de pagos previos cuyo valor_abono difiere de monto_cop (la 288 los normaliza SOLO al convertir; no reescribe históricos)',
         (select count(*)::text from public.abonos a join public.cotizacion_pagos_previos p on p.abono_id = a.id where a.monto_cop is not null and a.valor_abono is distinct from a.monto_cop), '(informativo)', 'INFO'
) q order by o;
