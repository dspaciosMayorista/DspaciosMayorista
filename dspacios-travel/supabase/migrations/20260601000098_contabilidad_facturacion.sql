-- ───────────────────────────────────────────────────────────────────────────
-- 098 · CONTABILIDAD — facturación por contrato (IRT / Ingreso propio)
--
--  Configuración MANUAL de cómo se factura cada contrato. Vive en el módulo
--  Contabilidad → Facturación (se saca del contrato individual). Dos naturalezas:
--    · irt            = Ingreso Recibido para Terceros (hoteles/aerolíneas; la
--                       empresa no presta ese servicio, solo intermedia).
--    · ingreso_propio = ingreso por intermediación de la empresa. Puede llevar
--                       IVA incluido (entonces base = valor/1.19, iva = base*0.19).
--  Las PROVISIONES de rentabilidad se calculan solo sobre el ingreso propio; el
--  IRT no provisiona. Mientras un contrato no esté configurado aquí, rentabilidad
--  usa el cálculo por defecto (sobre el PVP completo).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.contrato_facturacion (
  numero_contrato  text primary key references public.ventas(numero_contrato) on delete cascade,
  irt              numeric(15,2) not null default 0,   -- ingreso para terceros
  ingreso_propio   numeric(15,2) not null default 0,   -- ingreso propio (IVA incl. si lleva_iva)
  lleva_iva        boolean       not null default false,
  observacion      text,
  updated_at       timestamptz   not null default now()
);

alter table public.contrato_facturacion enable row level security;

drop policy if exists "contrato_facturacion: acceso contable" on public.contrato_facturacion;
create policy "contrato_facturacion: acceso contable"
  on public.contrato_facturacion for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
