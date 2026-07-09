-- ───────────────────────────────────────────────────────────────────────────
-- 125 · Retenciones practicadas a proveedores (retefuente)
--
-- Hoy `cuentas_por_pagar.aplica_retencion`/`pct_retencion` son solo un % fijo
-- informativo — no se descontaba del saldo pendiente ni quedaba registro de
-- CUÁNDO se practicó la retención ni en qué mes se va a declarar/pagar a la
-- DIAN. Esta tabla es un log (puede haber más de una retención por cuenta,
-- ej. una por cada abono parcial) que SÍ se descuenta del saldo del
-- proveedor, igual que un abono — ver app/(dashboard)/dashboard/pagos y
-- app/(dashboard)/dashboard/contabilidad/retenciones.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.retenciones_cxp (
  id                  bigserial primary key,
  cuenta_por_pagar_id bigint not null references public.cuentas_por_pagar(id) on delete cascade,
  valor               numeric(15,2) not null,
  fecha_practica      date not null,       -- cuándo se le practicó la retención al proveedor
  mes_declaracion     text not null,       -- YYYY-MM, mes en que se declara/paga a la DIAN
  observaciones       text,
  tenant              text not null default 'mayorista',
  created_at          timestamptz not null default now()
);
create index if not exists idx_retenciones_cxp_cuenta on public.retenciones_cxp(cuenta_por_pagar_id);
create index if not exists idx_retenciones_cxp_mes on public.retenciones_cxp(mes_declaracion);

alter table public.retenciones_cxp enable row level security;
drop policy if exists "retenciones_cxp: contable" on public.retenciones_cxp;
create policy "retenciones_cxp: contable" on public.retenciones_cxp for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
