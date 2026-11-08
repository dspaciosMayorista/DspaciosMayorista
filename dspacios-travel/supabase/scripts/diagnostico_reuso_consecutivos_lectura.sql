-- DIAGNÓSTICO DE SOLO LECTURA · reutilización de consecutivos de contratos eliminados.
-- UNA sola consulta (pegar completa en el editor SQL de Supabase). No escribe nada.
-- Columnas: control · detalle · valor · esperado · estado (OK / REVISAR / INFO).
with
v as (select numero_contrato n, tenant, estado from public.ventas),
lib as (select numero n from public.numeros_contrato_liberados),
tiene as (
  select v.n, v.tenant,
    exists(select 1 from public.abonos a where a.numero_contrato=v.n)                         as abonos,
    exists(select 1 from public.abonos_anulados a where a.numero_contrato=v.n)                as anulados,
    exists(select 1 from public.cuentas_por_pagar c join public.cxp_pagos p on p.cuenta_por_pagar_id=c.id where c.numero_contrato=v.n) as pagos_prov,
    exists(select 1 from public.cuentas_por_pagar c join public.retenciones_cxp r on r.cuenta_por_pagar_id=c.id where c.numero_contrato=v.n) as retenciones,
    exists(select 1 from public.aliados_b2b b join public.comision_b2b_pagos p on p.aliado_b2b_id=b.id where b.numero_contrato=v.n) as pagos_comision,
    exists(select 1 from public.facturacion f where f.numero_contrato=v.n)                    as factura,
    exists(select 1 from public.cotizaciones c join public.cotizacion_pagos_previos pp on pp.cotizacion_id=c.id where c.numero_contrato=v.n) as pago_previo,
    exists(select 1 from public.conciliacion_sistema s where s.numero_contrato=v.n)           as conciliado,
    exists(select 1 from public.asientos_contables s where s.referencia ilike '%'||v.n||'%')  as asiento,
    exists(select 1 from public.contrato_adjuntos j where j.numero_contrato=v.n)              as adjuntos,
    exists(select 1 from public.liquidacion_descuentos d where d.numero_contrato=v.n)         as descuentos
  from v),
c as (
  select
   'candidatos: ' || tenant as control,
   'contratos totales / sin ningún vínculo financiero (aptos fase 1)' as detalle,
   count(*)::text || ' / ' || count(*) filter (where not (abonos or anulados or pagos_prov or retenciones or pagos_comision or factura or pago_previo or conciliado or asiento or descuentos))::text as valor,
   'INFO' as estado, 1 as o from tiene group by tenant
  union all select 'fuera por tener: '||k, 'contratos (cualquier tenant)', count(*) filter (where flag)::text, 'INFO', 2
   from tiene t, lateral (values ('abonos',t.abonos),('abono anulado (huella)',t.anulados),('pagos a proveedor',t.pagos_prov),('retenciones',t.retenciones),
     ('pagos de comisión',t.pagos_comision),('factura',t.factura),('pago previo de cotización',t.pago_previo),('conciliación bancaria',t.conciliado),
     ('asiento contable',t.asiento),('descuento de liquidación',t.descuentos)) x(k,flag) group by k
  union all select 'pool: números liberados','filas en numeros_contrato_liberados',(select count(*) from lib)::text,'INFO',3
  union all select 'pool: liberado que YA existe en ventas','colisión segura de PK al reutilizar',(select count(*) from lib join v on v.n=lib.n)::text,'0',4
  union all select 'pool: con prefijo DTM-','mayorista no recicla (159)',(select count(*) from lib where n like 'DTM-%')::text,'0',5
  union all select 'pool: formato sin prefijo MIN-','históricos 00-#### (se les antepone MIN-)',(select count(*) from lib where n !~ '^MIN-')::text,'INFO',6
  union all select 'pool: con huella financiera sobreviviente','abonos_anulados / movimientos_silla / conciliación / p63 sobre un número liberado',
     (select count(*) from lib l where exists(select 1 from public.abonos_anulados a where a.numero_contrato=l.n)
        or exists(select 1 from public.movimientos_silla m where m.numero_contrato=l.n)
        or exists(select 1 from public.conciliacion_sistema s where s.numero_contrato=l.n)
        or exists(select 1 from public.p63_aceptacion p where p.numero_contrato=l.n))::text,'0',7
  union all select 'storage: archivos de contratos que ya no existen','objetos bucket contratos con prefijo sin venta (huérfanos)',
     (select count(*) from storage.objects o where o.bucket_id='contratos' and o.name not like 'pe-empleados/%'
        and not exists(select 1 from v where v.n=split_part(o.name,'/',1)))::text,'0',8
  union all select 'storage: archivos huérfanos en números LIBERADOS','los heredaría el contrato nuevo (acceso_archivo_contratos)',
     (select count(*) from storage.objects o join lib l on l.n=split_part(o.name,'/',1) where o.bucket_id='contratos')::text,'0',9
  union all select 'auditoría: filas de números liberados','historia que se mezclaría con el contrato nuevo',
     (select count(*) from public.auditoria a join lib l on l.n=a.registro_id)::text,'INFO',10
)
select control, detalle, valor,
       case when estado='INFO' then 'INFO'
            when valor = estado then 'OK' else 'REVISAR' end as estado
from c order by o, control;
