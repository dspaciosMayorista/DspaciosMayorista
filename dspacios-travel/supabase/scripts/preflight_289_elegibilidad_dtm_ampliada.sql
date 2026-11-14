-- PREFLIGHT de la migración 289 (#75, elegibilidad ampliada). SOLO LECTURA. UNA consulta integral: pegar completa ANTES de aplicarla. Si algún control dice REVISAR, NO aplicar.
select * from (
  select 1 as o, 'La 287 está aplicada y sus dos funciones son EXACTAMENTE las que la 289 reemplaza (md5)' as control,
         concat_ws('|', coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')), 'NO EXISTE'), coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.eliminar_contrato(text,boolean)')), 'NO EXISTE')) as valor,
         '286eb0058b7593e0f1dfff59fe0f442a|c7a510c064a67fd40e5cb84ea6a3d8d1' as esperado,
         case when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')) = '286eb0058b7593e0f1dfff59fe0f442a' and (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.eliminar_contrato(text,boolean)')) = 'c7a510c064a67fd40e5cb84ea6a3d8d1' then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La 284 (guardas de identidad) y la 288 (previstas) están aplicadas',
         (to_regclass('public.contrato_guardas_config') is not null and to_regclass('public.contrato_obligaciones_previstas') is not null)::text, 'true',
         case when to_regclass('public.contrato_guardas_config') is not null and to_regclass('public.contrato_obligaciones_previstas') is not null then 'OK' else 'REVISAR' end
  union all select 3, 'La 289 NO está aplicada (dtm_reuso_bloqueos aún sin lista de preparación)',
         (select (position('prep' in prosrc) > 0)::text from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')), 'false',
         case when (select position('prep' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')) then 'REVISAR' else 'OK' end
  union all select 4, 'El REUSO debe seguir APAGADO (esta migración no lo habilita)',
         coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'sin fila'), 'false',
         case when coalesce((select habilitado from public.dtm_reuso_config limit 1), false) then 'REVISAR' else 'OK' end
  union all select 5, 'Columnas que usa la clasificación existen (vuelo_control.estado_emision, contrato_facturacion.dian_emitida/asiento_factura_id/revision_id, aliados_b2b.descontada_en_precio, cuentas_por_pagar.aceptacion_63_id)',
         (select count(*) from information_schema.columns where table_schema='public' and ((table_name='contrato_vuelo_control' and column_name='estado_emision') or (table_name='contrato_facturacion' and column_name in ('dian_emitida','asiento_factura_id','revision_id'))
            or (table_name='aliados_b2b' and column_name='descontada_en_precio') or (table_name='cuentas_por_pagar' and column_name='aceptacion_63_id')))::text, '6', case when (select count(*) from information_schema.columns where table_schema='public' and ((table_name='contrato_vuelo_control' and column_name='estado_emision') or (table_name='contrato_facturacion' and column_name in ('dian_emitida','asiento_factura_id','revision_id'))
            or (table_name='aliados_b2b' and column_name='descontada_en_precio') or (table_name='cuentas_por_pagar' and column_name='aceptacion_63_id'))) = 6 then 'OK' else 'REVISAR' end
  union all select 6, 'Tablas auxiliares de la clasificación existen (cxp_pagos, retenciones_cxp, comision_b2b_pagos, comision_b2b_revision)',
         (select count(*) from (values ('public.cxp_pagos'),('public.retenciones_cxp'),('public.comision_b2b_pagos'),('public.comision_b2b_revision')) t(n) where to_regclass(t.n) is not null)::text, '4', case when (select count(*) from (values ('public.cxp_pagos'),('public.retenciones_cxp'),('public.comision_b2b_pagos'),('public.comision_b2b_revision')) t(n) where to_regclass(t.n) is not null) = 4 then 'OK' else 'REVISAR' end
  union all select 7, 'INFO #97: versión de la liberación del plan en la 286 aplicada (esperada: LIBERACION_PLAN_V2; otra o ausente → un pendiente con plan de comisión seguirá NO elegible: PLAN_COMISION_SIN_LIBERACION_97)',
         coalesce((select left(coalesce(obj_description(p.oid, 'pg_proc'), 'sin versión'), 20) from pg_proc p where p.oid = to_regprocedure('p97_priv.tg_solo_insercion()')), 'la 286 no está aplicada'), 'LIBERACION_PLAN_V2: (si la 286 ya está)', 'INFO'
  union all select 8, 'DIAGNÓSTICO: contratos DTM pendientes hoy (solo cuenta; no modifica nada)',
         (select count(*)::text from public.ventas where estado = 'pendiente' and numero_contrato ~ '^DTM-'), '(informativo)', 'INFO'
) q order by o;
