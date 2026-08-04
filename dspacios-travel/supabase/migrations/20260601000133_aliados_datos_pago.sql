-- ───────────────────────────────────────────────────────────────────────────
-- 133 · Datos de pago del aliado B2B + enlace catálogo → comisión
--
-- La cuenta de cobro (/portal/comision/[numero]) se rediseña para parecerse
-- a una cuenta de cobro real (formato de referencia del dueño): encabezado
-- con documento/dirección del aliado y datos bancarios de A QUIÉN se le va a
-- consignar la comisión — datos que hoy no existen en ningún lado del
-- sistema (ni en `aliados` ni en `aliados_b2b`).
--
-- Se agregan a `aliados` (catálogo, editable en /dashboard/aliados):
-- tipo de documento (NIT/CC), dirección y cuenta bancaria. `aliados_b2b`
-- gana `aliado_id` (FK opcional al catálogo) para que la comisión pueda
-- traer esos datos automáticamente cuando se eligió del catálogo en el
-- formulario "Agregar comisión B2B" (antes solo copiaba nombre/nit/% como
-- texto suelto, sin quedar enlazada). Si la comisión se tipeó a mano (sin
-- elegir del catálogo), `aliado_id` queda null y esos campos del documento
-- simplemente no aparecen.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.aliados
  add column if not exists tipo_documento text not null default 'NIT',
  add column if not exists direccion text,
  add column if not exists banco text,
  add column if not exists tipo_cuenta text,
  add column if not exists numero_cuenta text;

alter table public.aliados_b2b
  add column if not exists aliado_id bigint references public.aliados(id) on delete set null;
create index if not exists idx_aliados_b2b_aliado on public.aliados_b2b(aliado_id);
