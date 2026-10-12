-- ─────────────────────────────────────────────────────────────────────────
-- Conteo POR PAQUETE de servicios INCLUIDOS con costo positivo y sin
-- proveedor (PR #353 / #14).
--
-- ⚠️ NO EJECUTAR sin autorización explícita del usuario. Preparado, no corrido.
--
-- Por qué: desde #353 la conversión de una cotización a contrato se detiene
-- si un servicio incluido con costo no tiene proveedor en el catálogo (su CxP
-- no se podría pagar — lib/reservar/incluidosCotizados.ts). Esta consulta
-- mide qué paquetes quedarían bloqueados ANTES de desplegar.
--
-- "Costo positivo" replica `costoNetoServicioIncluido`
-- (lib/reservar/serviciosPaquete.ts):
--   · modo 'persona' → `servicios_adicionales.precio_persona` > 0;
--   · modo 'grupo'   → algún rango GENERAL de `servicio_tarifa_pax` con
--     precio > 0 (aproximación: el costo real depende del pax de la reserva).
--   · otro modo, incluido NULL → se cuenta aparte (`modo_no_valido`):
--     `computarReserva` ya rechaza la reserva por modo inválido. Se usa
--     `modo_valido` (calculado una vez) y no `modo not in (...)`, que con
--     NULL da NULL y dejaría esa fila fuera del conteo y del HAVING.
-- `proveedor_id` tiene FK a `proveedores`, así que "sin proveedor" es
-- `proveedor_id is null`.
--
-- Garantías:
--   · SOLO LECTURA (transacción `read only` + rollback).
--   · Devuelve id de paquete, si está activo y conteos. Sin nombres de
--     paquete, servicio ni proveedor; sin PII; sin importes.
--   · No modifica nada. Completar proveedores se hace desde
--     Producto → Servicios, con su propia autorización.
-- ─────────────────────────────────────────────────────────────────────────
begin read only;

with incluidos as (
  select
    a.paquete_id,
    a.modo,
    coalesce(a.modo in ('persona', 'grupo'), false) as modo_valido,
    s.proveedor_id is null as sin_proveedor,
    case
      when a.modo = 'persona' then coalesce(s.precio_persona, 0) > 0
      when a.modo = 'grupo' then exists (
        select 1 from public.servicio_tarifa_pax t
        where t.servicio_id = a.servicio_id and t.temporada = 'GENERAL' and t.precio > 0
      )
      else false
    end as costo_positivo
  from public.armado_servicios a
  join public.servicios_adicionales s on s.id = a.servicio_id
  where a.incluido = true
)
select
  i.paquete_id,
  p.activo as paquete_activo,
  count(*) as incluidos,
  count(*) filter (where i.costo_positivo) as incluidos_con_costo,
  count(*) filter (where i.costo_positivo and i.sin_proveedor) as con_costo_sin_proveedor,
  count(*) filter (where i.costo_positivo and i.sin_proveedor and i.modo = 'grupo') as de_ellos_por_grupo,
  count(*) filter (where not i.modo_valido) as modo_no_valido
from incluidos i
join public.armado_paquetes p on p.id = i.paquete_id
group by i.paquete_id, p.activo
having count(*) filter (where i.costo_positivo and i.sin_proveedor) > 0
    or count(*) filter (where not i.modo_valido) > 0
order by p.activo desc, i.paquete_id;

rollback;
