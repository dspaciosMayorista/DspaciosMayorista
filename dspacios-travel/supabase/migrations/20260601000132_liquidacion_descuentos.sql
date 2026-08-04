-- ───────────────────────────────────────────────────────────────────────────
-- 132 · Descuentos a la liquidación de comisión de un asesor interno
--
-- `/dashboard/liquidacion` calcula la comisión del mes en vivo (suma de PVP
-- de ventas del asesor → escala → % → bruta → retención → neta), sin ningún
-- mecanismo para restar nada de ahí. Caso real: un asesor le da un descuento
-- al cliente que sale de su propio bolsillo (de su comisión), o cualquier
-- otro descuento puntual con su descripción — hay que reflejarlo en la
-- liquidación del mes, restado del valor neto a pagar.
--
-- Un descuento es por asesor + mes (no por contrato — puede no venir de
-- ningún contrato puntual, ej. un ajuste administrativo), con valor y
-- descripción libres, log ilimitado (mismo patrón que cxp_pagos/
-- comision_b2b_pagos: varias filas, no una columna fija).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.liquidacion_descuentos (
  id            bigserial primary key,
  usuario_id    uuid not null references public.usuarios(id) on delete cascade,
  mes           text not null,              -- 'YYYY-MM'
  valor         numeric(15,2) not null,
  descripcion   text,
  numero_contrato text,                     -- opcional, trazabilidad si viene de un contrato puntual
  created_at    timestamptz not null default now()
);
create index if not exists idx_liquidacion_descuentos_asesor_mes on public.liquidacion_descuentos(usuario_id, mes);

alter table public.liquidacion_descuentos enable row level security;
drop policy if exists "liquidacion_descuentos: acceso contable" on public.liquidacion_descuentos;
create policy "liquidacion_descuentos: acceso contable" on public.liquidacion_descuentos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));
