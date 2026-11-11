-- DIAGNÓSTICO D5 (#75, solo lectura): contratos PENDIENTES que ya tienen obligaciones creadas por el flujo anterior.
-- No se modifican. Quedan fuera del reuso de su DTM hasta conciliarlos (borrar o regularizar a mano, con decisión del dueño).
select v.numero_contrato, v.tenant, v.cliente,
       (select count(*) from public.cuentas_por_pagar c where c.numero_contrato = v.numero_contrato) as cxp,
       (select count(*) from public.cxp_pagos p join public.cuentas_por_pagar c on c.id = p.cuenta_por_pagar_id where c.numero_contrato = v.numero_contrato) as pagos_cxp,
       (select count(*) from public.aliados_b2b b where b.numero_contrato = v.numero_contrato and b.estado is distinct from 'pagada') as comision_exigible,
       (select count(*) from public.abonos a where a.numero_contrato = v.numero_contrato) as abonos,
       v.obligaciones_materializadas_en is not null as materializado
  from public.ventas v
 where v.estado = 'pendiente'
   and (exists (select 1 from public.cuentas_por_pagar c where c.numero_contrato = v.numero_contrato)
        or exists (select 1 from public.aliados_b2b b where b.numero_contrato = v.numero_contrato and b.estado is distinct from 'pagada'))
 order by v.numero_contrato;
