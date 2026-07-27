-- Backfill de cuentas_por_pagar.tenant para filas EXISTENTES que quedaron mal
-- estampadas (siempre en el default 'mayorista'), sin importar la agencia
-- real del contrato al que pertenecen.
--
--   · Causa: dos funciones que agregan/completan proveedores DESPUÉS de creado
--     el contrato insertaban en cuentas_por_pagar sin estampar `tenant`:
--     `crearCuentaPorPagar` (botón "Agregar" en la pestaña Proveedores de un
--     contrato) y `asegurarCuentasPorPagar` (botón "Completar proveedores" /
--     respaldo automático al confirmar una venta). Quedaba siempre en el
--     default 'mayorista', aunque el contrato fuera de minorista. El contrato
--     mismo mostraba la CxP bien (esa consulta filtra solo por
--     numero_contrato), pero /dashboard/pagos (Finanzas → Proveedores) sí
--     filtra por tenant, así que la cuenta desaparecía de ese listado para
--     minorista (caso real: contrato MIN-00-0500). Mismo patrón ya corregido
--     antes para aliados_b2b (ver backfill_aliados_b2b_tenant.sql). Ya
--     corregido en código (ambas funciones ahora toman el tenant del
--     contrato); este script solo corrige las filas creadas ANTES del fix.
--   · Solo toca filas cuyo tenant NO coincide con el de su venta -- no toca
--     nada más (proveedor, valores, retención, etc. quedan intactos).

update public.cuentas_por_pagar c
set tenant = v.tenant
from public.ventas v
where v.numero_contrato = c.numero_contrato
  and c.tenant is distinct from v.tenant;

-- Para revisar qué quedó corregido (opcional, correr ANTES del update para
-- ver el antes; después del update ya no mostrará filas):
-- select c.id, c.numero_contrato, c.proveedor, c.tenant as tenant_cxp, v.tenant as tenant_contrato
-- from public.cuentas_por_pagar c join public.ventas v on v.numero_contrato = c.numero_contrato
-- where c.tenant is distinct from v.tenant;
