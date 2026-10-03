-- ───────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO W7 · ¿se confirman ventas desde un estado distinto de
-- "pendiente"? — SOLO LECTURA (una consulta SELECT; no devuelve nombres,
-- documentos ni importes: solo estados y conteos).
--
-- Contexto: la migración 197 (`confirmar_venta`) solo confirma ventas en
-- `pendiente`; una ya `confirmado` devuelve ok sin cambios, y cualquier otro
-- estado (`activo`, `cancelado`…) se rechaza. Antes (código en HEAD),
-- `confirmarVenta` aceptaba cualquier estado si se llamaba directo. La
-- interfaz y `recalcularEstadoAbono` solo confirman desde `pendiente`, en
-- HEAD y ahora. Este diagnóstico busca si en la práctica hubo otra
-- transición, o si hay datos que la necesitarían.
--
-- Filas:
--   A · ventas por estado (para ver qué estados existen de verdad).
--   B · transiciones registradas en auditoria (087) HACIA 'confirmado',
--       agrupadas por estado de origen. Algo distinto de 'pendiente' (o de un
--       INSERT ya confirmado, p. ej. el importador de minorista) = evidencia de
--       un flujo que la 197 rechazaría.
--   C · ventas NO pendientes que todavía tienen sillas 'en_plazo' (solo esas
--       necesitarían que alguien confirme sus sillas fuera de 'pendiente').
-- ───────────────────────────────────────────────────────────────────────────
select 'A · ventas por estado' as bloque, estado::text as detalle, count(*) as n
  from public.ventas group by estado
union all
select 'B · transiciones a confirmado (auditoria)',
       case when accion = 'INSERT' then '(alta ya confirmada)' else 'desde ' || coalesce(cambios -> 'estado' ->> 'antes', '?') end
         || ' · ' || coalesce(actor_rol, 'sistema/service_role'),
       count(*)
  from public.auditoria
 where tabla = 'ventas'
   and ((accion = 'UPDATE' and cambios ? 'estado' and cambios -> 'estado' ->> 'despues' = 'confirmado')
     or (accion = 'INSERT' and despues ->> 'estado' = 'confirmado'))
 group by 2
union all
select 'C · ventas no pendientes con sillas en_plazo', v.estado::text, count(distinct v.numero_contrato)
  from public.ventas v join public.sillas s on s.numero_contrato = v.numero_contrato
 where s.estado = 'en_plazo' and v.estado::text <> 'pendiente'
 group by v.estado
order by 1, 3 desc;
