-- ───────────────────────────────────────────────────────────────────────────
-- 130 · Pagos a proveedor ILIMITADOS (reemplaza el modelo fijo de 3 abonos)
--
-- `cuentas_por_pagar.abono1/2/3` (+ `fecha_abono1/2/3` + `trm1/2/3`, migración
-- 097) modelaba los pagos como 3 columnas fijas — una cuenta con más de 3
-- pagos parciales simplemente no dejaba registrar el 4º ("Ya hay 3 pagos
-- registrados (máximo del modelo)"). Reportado como bug real en la agencia
-- minorista, con proveedores a los que se les paga en más de 3 cuotas.
--
-- Se reemplaza por un log ilimitado (mismo patrón ya usado por
-- `retenciones_cxp`, migración 125: una fila por movimiento, sin tope de
-- cantidad). Las columnas `abono1/2/3` NO se borran (convención del
-- proyecto: no se eliminan columnas), pero la app deja de leerlas/escribirlas
-- desde esta migración en adelante — este script las migra a la tabla nueva
-- para no perder el histórico ya cargado.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.cxp_pagos (
  id                  bigserial primary key,
  cuenta_por_pagar_id bigint not null references public.cuentas_por_pagar(id) on delete cascade,
  fecha               date not null default current_date,
  valor               numeric(15,2) not null,   -- en la moneda de la cuenta (USD si la CxP es USD)
  trm                 numeric(15,4) not null default 1, -- TRM del día de pago (1 si la cuenta es COP)
  tenant              text not null default 'mayorista',
  created_at          timestamptz not null default now()
);
create index if not exists idx_cxp_pagos_cuenta on public.cxp_pagos(cuenta_por_pagar_id);

alter table public.cxp_pagos enable row level security;
drop policy if exists "cxp_pagos: acceso contable" on public.cxp_pagos;
create policy "cxp_pagos: acceso contable" on public.cxp_pagos for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  )
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

-- Backfill: migra los pagos ya cargados en abono1/2/3 (idempotente vía WHERE —
-- si se vuelve a correr esta migración, no duplica porque exige valor <> 0 y
-- estas columnas dejan de escribirse desde ahora en adelante).
insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant)
select c.id, coalesce(c.fecha_abono1, c.created_at::date, current_date), c.abono1, coalesce(c.trm1, 1), c.tenant
from public.cuentas_por_pagar c
where c.abono1 is not null and c.abono1 <> 0
  and not exists (
    select 1 from public.cxp_pagos p
    where p.cuenta_por_pagar_id = c.id and p.valor = c.abono1 and p.fecha = coalesce(c.fecha_abono1, c.created_at::date, current_date)
  );

insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant)
select c.id, coalesce(c.fecha_abono2, c.created_at::date, current_date), c.abono2, coalesce(c.trm2, 1), c.tenant
from public.cuentas_por_pagar c
where c.abono2 is not null and c.abono2 <> 0
  and not exists (
    select 1 from public.cxp_pagos p
    where p.cuenta_por_pagar_id = c.id and p.valor = c.abono2 and p.fecha = coalesce(c.fecha_abono2, c.created_at::date, current_date)
  );

insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant)
select c.id, coalesce(c.fecha_abono3, c.created_at::date, current_date), c.abono3, coalesce(c.trm3, 1), c.tenant
from public.cuentas_por_pagar c
where c.abono3 is not null and c.abono3 <> 0
  and not exists (
    select 1 from public.cxp_pagos p
    where p.cuenta_por_pagar_id = c.id and p.valor = c.abono3 and p.fecha = coalesce(c.fecha_abono3, c.created_at::date, current_date)
  );
