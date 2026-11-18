-- PREFLIGHT 309 (#106 gestión integral de contratos) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 309. Todo OK; los INFO se anotan: el postcheck debe dar
-- las mismas cifras de contratos/abonos/vouchers (la 309 no cambia ninguna fila existente) y 0 acuses.
with pre as (
  select
    (to_regclass('public.ventas') is not null and to_regclass('public.abonos') is not null and to_regclass('public.vouchers') is not null
     and to_regclass('public.facturacion') is not null and to_regclass('public.contrato_facturacion') is not null
     and to_regclass('public.aliados_b2b') is not null and to_regclass('public.comision_b2b_pagos') is not null) as tablas,
    (to_regclass('public.comision_b2b_revision') is not null) as rev268,
    (to_regclass('public.comision_plan') is not null) as plan286,
    (to_regclass('public.contrato_guardas_config') is not null
     and to_regprocedure('public.contrato_declarar_identidad(text,uuid)') is not null and to_regprocedure('public.contrato_instalar_guardas()') is not null) as ident284,
    (to_regprocedure('public.comision_b2b_total(public.aliados_b2b)') is not null and to_regprocedure('public.comision_b2b_descontada(public.aliados_b2b)') is not null) as com205,
    (to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.fn_auditoria()') is not null) as base,
    (to_regclass('public.contrato_seguimiento') is null) as sin_tabla,
    (to_regprocedure('public.fn_gestion_contratos(jsonb,text,integer,integer)') is null and to_regprocedure('public.registrar_seguimiento_contrato(text,uuid,text,text,text,text)') is null
     and to_regprocedure('public.seguimiento_referencia(text,text)') is null) as sin_funciones,
    (select count(*) from public.contrato_guardas_config where tabla = 'contrato_seguimiento')::int as ya_clasificada,
    (select count(*) from public.ventas)::bigint as ventas,
    (select count(*) from public.abonos)::bigint as abonos,
    (select count(*) from public.vouchers)::bigint as vouchers,
    (select count(*) from public.ventas where tenant = 'mayorista')::bigint as mayorista,
    (select count(*) from public.ventas where tenant = 'minorista')::bigint as minorista,
    (select count(*) from public.usuarios where rol = 'superadmin' and activo)::int as superadmins
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Tablas base presentes (ventas, abonos, vouchers, facturación, comisiones B2B)' as control, tablas::text as observado, 'true' as esperado, case when tablas then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, 'comision_b2b_revision (268) presente', rev268::text, 'true', case when rev268 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'comision_plan (286) presente', plan286::text, 'true', case when plan286 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Identidad del contrato (284) y guardas instalables', ident284::text, 'true', case when ident284 then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Funciones de comisión de la 205 presentes', com205::text, 'true', case when com205 then 'OK' else 'REVISAR' end from pre
  union all select 6, 'mi_rol() y fn_auditoria() presentes', base::text, 'true', case when base then 'OK' else 'REVISAR' end from pre
  union all select 7, 'contrato_seguimiento aún NO existe (la 309 se corre una sola vez)', sin_tabla::text, 'true', case when sin_tabla then 'OK' else 'REVISAR' end from pre
  union all select 8, 'Funciones de la 309 aún NO existen', sin_funciones::text, 'true', case when sin_funciones then 'OK' else 'REVISAR' end from pre
  union all select 9, 'contrato_seguimiento aún sin clasificar en las guardas', ya_clasificada::text, '0', case when ya_clasificada = 0 then 'OK' else 'REVISAR' end from pre
  union all select 10, 'Al menos un superadmin activo (quién usará la pantalla)', superadmins::text, '>= 1', case when superadmins >= 1 then 'OK' else 'REVISAR' end from pre
  union all select 11, 'Contratos Mayorista / Minorista (anotar; igual en el postcheck)', mayorista::text || ' / ' || minorista::text, 'anotar', 'INFO' from pre
  union all select 12, 'Total contratos, abonos y vouchers (anotar; igual en el postcheck)', ventas::text || ' / ' || abonos::text || ' / ' || vouchers::text, 'anotar', 'INFO' from pre
) r order by orden;
