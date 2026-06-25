-- ───────────────────────────────────────────────────────────────────────────
-- 103 · CONTABILIDAD — movimientos de pagos fuera de contrato
--
--  Compras y pagos (e ingresos) que NO están ligados a un contrato/venta:
--  arriendo, servicios, compras de oficina, reintegros, etc. Alimentan los
--  estados financieros y la conciliación bancaria.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.contabilidad_movimientos (
  id           bigserial primary key,
  fecha        date not null default current_date,
  tipo         text not null default 'egreso',   -- 'ingreso' | 'egreso'
  concepto     text not null,
  tercero      text,                              -- proveedor / beneficiario
  categoria    text,
  medio_pago   text,                              -- efectivo, transferencia, tarjeta…
  valor        numeric(15,2) not null default 0,
  comprobante  text,
  observacion  text,
  created_at   timestamptz not null default now()
);

alter table public.contabilidad_movimientos enable row level security;

drop policy if exists "contabilidad_movimientos: acceso contable" on public.contabilidad_movimientos;
create policy "contabilidad_movimientos: acceso contable"
  on public.contabilidad_movimientos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
