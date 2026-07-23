-- Backfill de aliados_b2b.tenant para filas EXISTENTES que quedaron mal
-- estampadas (siempre en el default 'mayorista'), sin importar la agencia
-- real del contrato al que pertenecen.
--
--   · Causa: hasta ahora, `crearComisionB2B` (el botón "Agregar comisión B2B
--     (aliado)" en la pestaña Comisiones de un contrato) insertaba en
--     aliados_b2b sin estampar `tenant` -- quedaba siempre 'mayorista' por el
--     default de la columna, aunque el contrato fuera de minorista. El
--     contrato mismo mostraba la comisión bien (esa consulta no filtra por
--     tenant), pero /dashboard/comisiones sí filtra por tenant, así que la
--     comisión desaparecía de la lista y el contrato quedaba mostrado como
--     "Por definir" pese a tener la comisión ya cargada. Ya corregido en
--     código (ahora toma el tenant del contrato); este script solo corrige
--     las filas que se crearon ANTES del fix.
--   · Solo toca filas cuyo tenant NO coincide con el de su venta -- no toca
--     nada más.

update public.aliados_b2b b
set tenant = v.tenant
from public.ventas v
where v.numero_contrato = b.numero_contrato
  and b.tenant is distinct from v.tenant;

-- Para revisar qué quedó corregido (opcional, correr ANTES del update para
-- ver el antes; después del update ya no mostrará filas):
-- select b.id, b.numero_contrato, b.tenant as tenant_comision, v.tenant as tenant_contrato
-- from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
-- where b.tenant is distinct from v.tenant;
