-- Backfill de comision_b2b_pagos.tenant para filas EXISTENTES que quedaron
-- mal estampadas (siempre en el default 'mayorista'), sin importar la
-- agencia real de la comisión a la que pertenecen.
--
--   · Causa: `registrarPagoComisionB2B` (botón "Registrar abono" en la fila
--     expandida de /dashboard/comisiones) insertaba en comision_b2b_pagos
--     sin estampar `tenant` -- quedaba siempre 'mayorista' por el default de
--     la columna, aunque la comisión fuera de minorista. El insert pasaba la
--     RLS igual (superadmin/gerencia ven ambos tenants), así que no se veía
--     ningún error -- pero /dashboard/comisiones filtra por tenant, así que
--     el abono desaparecía de la lista y la comisión seguía viéndose sin
--     abonos ("no se guardó nada"). Ya corregido en código (ahora toma el
--     tenant de la comisión/aliados_b2b); este script solo corrige las filas
--     que se crearon ANTES del fix.
--   · Solo toca filas cuyo tenant NO coincide con el de su comisión -- no
--     toca nada más.

update public.comision_b2b_pagos p
set tenant = b.tenant
from public.aliados_b2b b
where b.id = p.aliado_b2b_id
  and p.tenant is distinct from b.tenant;

-- Para revisar qué quedó corregido (opcional, correr ANTES del update para
-- ver el antes; después del update ya no mostrará filas):
-- select p.id, p.aliado_b2b_id, p.tenant as tenant_pago, b.tenant as tenant_comision
-- from public.comision_b2b_pagos p join public.aliados_b2b b on b.id = p.aliado_b2b_id
-- where p.tenant is distinct from b.tenant;
