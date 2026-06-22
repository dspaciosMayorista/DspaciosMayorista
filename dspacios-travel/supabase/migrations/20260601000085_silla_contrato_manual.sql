-- 085 · Contrato MANUAL en la silla (ventas fuera del flujo del sistema)
--
-- `sillas.numero_contrato` tiene FK a ventas(numero_contrato): solo sirve para
-- contratos ORGÁNICOS (los que nacen del flujo de venta del sistema). Para
-- registrar ventas externas que NO pasan por el sistema, se agrega un campo de
-- texto libre `contrato_manual`.
--
-- Regla de negocio (validada en la app y reforzada aquí):
--   una silla puede tener contrato ORGÁNICO (numero_contrato) **o** MANUAL
--   (contrato_manual), nunca los dos a la vez.

alter table public.sillas
  add column if not exists contrato_manual text;

-- No puede tener ambos contratos a la vez.
alter table public.sillas
  drop constraint if exists sillas_contrato_unico;
alter table public.sillas
  add constraint sillas_contrato_unico
  check (numero_contrato is null or contrato_manual is null);

comment on column public.sillas.contrato_manual is
  'Número de contrato MANUAL (venta externa al sistema). Excluyente con numero_contrato (orgánico).';
