-- ───────────────────────────────────────────────────────────────────────────
-- 170 · `cuentas_por_pagar.servicio_id` — vínculo DURABLE entre una cuenta por
-- pagar y el servicio del catálogo que la originó.
--
-- Problema real que resuelve (revisión del PR #294, punto 7):
-- `actualizarServiciosContrato` (editar los servicios de un contrato
-- PENDIENTE) recalcula `ventas.costo_receptivo` y reescribe los ítems del
-- contrato, pero NO podía tocar las cuentas por pagar: no existía forma de
-- saber cuál CxP corresponde a cuál servicio. Emparejar por NOMBRE está
-- prohibido (dos servicios pueden llamarse igual; el texto se edita) y
-- emparejar por `tipo_proveedor` es ambiguo (tres categorías de servicio se
-- reparten en `receptivo`/`asistencia`/`otro`, y hotel/aéreo comparten tabla).
-- Resultado: al quitar o agregar un servicio, el contrato y las obligaciones
-- contables quedaban distintos, sin forma segura de reconciliar.
--
-- Con esta columna la reconciliación es exacta y por ID: se sabe qué fila
-- pertenece a qué servicio, se actualiza el valor de las que siguen, se borran
-- las de servicios quitados (solo si no tienen pagos ni retenciones — ese
-- candado vive en la aplicación, ver `actualizarServiciosContrato`) y se
-- insertan las nuevas.
--
-- ADITIVA y compatible hacia atrás:
--  · Columna NULLABLE, sin default. Toda CxP existente queda en NULL y sigue
--    funcionando igual (las filas de hotel/aéreo y las cargadas a mano NUNCA
--    tendrán servicio_id — no son de un servicio del catálogo).
--  · NO se hace backfill: no hay dato de origen confiable para deducir a qué
--    servicio pertenece una CxP histórica (justamente el problema que la
--    columna viene a resolver). Inventarlo por nombre sería exactamente el
--    emparejamiento frágil que se está eliminando. Las CxP viejas quedan
--    fuera de la reconciliación automática: se editan a mano como hoy.
--  · `on delete set null`: si alguien borra un servicio del catálogo, la CxP
--    (una obligación real de dinero) NO se borra en cascada; solo pierde el
--    vínculo y vuelve a comportarse como una fila manual.
--
-- No toca RLS: `cuentas_por_pagar` ya tiene sus políticas y esta columna no
-- cambia quién ve la fila.
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.cuentas_por_pagar
  add column if not exists servicio_id bigint references public.servicios_adicionales(id) on delete set null;

-- Índice parcial: solo las filas que SÍ vienen de un servicio (las de
-- hotel/aéreo/manuales son NULL y no se buscan por esta vía).
create index if not exists cuentas_por_pagar_contrato_servicio_idx
  on public.cuentas_por_pagar (numero_contrato, servicio_id)
  where servicio_id is not null;

comment on column public.cuentas_por_pagar.servicio_id is
  'Servicio del catálogo (servicios_adicionales) que originó esta CxP. NULL = fila de hotel/aéreo, creada a mano, o anterior a la migración 170 (no se hizo backfill a propósito: no hay dato de origen confiable). Es la ÚNICA llave válida para reconciliar CxP de servicios al editar los servicios de un contrato — nunca emparejar por nombre ni por tipo_proveedor.';

commit;
