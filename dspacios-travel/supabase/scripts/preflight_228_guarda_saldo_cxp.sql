-- 228 · PREFLIGHT (correr ANTES de la migración). SOLO LECTURA (SELECT): devuelve conteos y sumas agregados, nunca filas de negocio.

-- ▼ PREFLIGHT 1 · estado previo
-- Esperado según E0: sobreasignadas sobre tolerancia = 1 (la CxP USD 42) cuando se cuentan
-- SOLO pagos. E0 Q8 NO incluía retenciones: este control sí y puede diferir.
select 'pagos_importe_no_positivo' as control, count(*) as filas
  from public.cxp_pagos where valor is null or valor <= 0
union all
select 'retenciones_importe_no_positivo', count(*) from public.retenciones_cxp where valor is null or valor <= 0
union all
select 'cxp_moneda_fuera_de_cop_usd', count(*)
  from public.cuentas_por_pagar where moneda is null or moneda not in ('COP', 'USD')
union all
select 'cxp_sobreasignadas_sobre_tolerancia', count(*)
  from public.cuentas_por_pagar c
  left join (select cuenta_por_pagar_id, sum(valor) s from public.cxp_pagos group by 1) p on p.cuenta_por_pagar_id = c.id
  left join (select cuenta_por_pagar_id, sum(valor) s from public.retenciones_cxp group by 1) r on r.cuenta_por_pagar_id = c.id
 where coalesce(p.s, 0) + coalesce(r.s, 0) >
       coalesce(c.valor_total, 0) + case upper(coalesce(c.moneda, '')) when 'COP' then 10.00 when 'USD' then 0.10 else 0 end;

-- ▼ PREFLIGHT 2 · S3: retenciones sobre CxP en USD (unidad)
-- El código fija la unidad de retenciones_cxp.valor en la MONEDA DE LA CUENTA (formulario
-- rotulado con cuenta.moneda, RetencionesClient.tsx:459-482; saldo = valor_total − pagos −
-- retenciones, retenciones/actions.ts:138). Este control verifica que los DATOS históricos
-- sean coherentes con eso: una retención USD mayor que el valor_total de su cuenta sugiere
-- que se capturó en COP.
select count(distinct c.id)                                          as cxp_usd_con_retenciones,
       count(r.id)                                                   as retenciones_sobre_cxp_usd,
       coalesce(sum(r.valor), 0)                                     as suma_retenciones_cxp_usd,
       count(*) filter (where r.valor > coalesce(c.valor_total, 0))  as retenciones_mayores_que_valor_total
  from public.cuentas_por_pagar c
  join public.retenciones_cxp r on r.cuenta_por_pagar_id = c.id
 where c.moneda = 'USD';

-- ▼ PREFLIGHT 3 · S6: movimientos cuyo tenant difiere del de su CxP (pares, solo conteos)
-- No hay corrección automática en la 228: el tratamiento de estas filas lo decide el dueño.
select 'pagos' as tabla, p.tenant as tenant_del_movimiento, c.tenant as tenant_de_la_cxp, count(*) as filas
  from public.cxp_pagos p join public.cuentas_por_pagar c on c.id = p.cuenta_por_pagar_id
 where p.tenant is distinct from c.tenant
 group by p.tenant, c.tenant
union all
select 'retenciones', r.tenant, c.tenant, count(*)
  from public.retenciones_cxp r join public.cuentas_por_pagar c on c.id = r.cuenta_por_pagar_id
 where r.tenant is distinct from c.tenant
 group by r.tenant, c.tenant
order by 1, 2, 3;

-- ▼ PREFLIGHT 4 · triggers de usuario ya presentes en las tres tablas (orden y colisiones)
select c.relname as tabla, t.tgname as trigger, t.tgenabled as habilitado
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and c.relname in ('cuentas_por_pagar', 'cxp_pagos', 'retenciones_cxp')
 order by c.relname, t.tgname;

-- ▼ PREFLIGHT 3B · S6 (decisión del dueño: NO tocar filas históricas, solo contarlas)
select (select count(*) from public.cxp_pagos p join public.cuentas_por_pagar c on c.id = p.cuenta_por_pagar_id where p.tenant is distinct from c.tenant) as pagos_tenant_distinto,
       (select count(*) from public.retenciones_cxp r join public.cuentas_por_pagar c on c.id = r.cuenta_por_pagar_id where r.tenant is distinct from c.tenant) as retenciones_tenant_distinto;

-- ▼ PREFLIGHT 5 · filas totales (para comparar con el postcheck: la 228 no cambia datos)
select (select count(*) from public.cuentas_por_pagar) as cxp,
       (select count(*) from public.cxp_pagos) as pagos,
       (select count(*) from public.retenciones_cxp) as retenciones;
