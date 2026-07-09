-- ───────────────────────────────────────────────────────────────────────────
-- 124 · Conciliaciones: número de contrato en el lado "sistema" del cruce
--
-- El ítem del sistema (abono de cartera / pago a proveedor) ya sabe a qué
-- numero_contrato pertenece — se guarda como snapshot al momento de cruzar,
-- para poder mostrarlo/enlazarlo al consultar los conciliados sin tener que
-- volver a resolver el `ref` (que además puede apuntar a un abono o CxP ya
-- borrado/editado). Null para movimientos genéricos sin contrato asociado.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.conciliacion_sistema
  add column if not exists numero_contrato text;
