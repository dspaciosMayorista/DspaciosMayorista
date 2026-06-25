-- ───────────────────────────────────────────────────────────────────────────
-- 107 · MULTITENANT — dos agencias en la misma BD (mayorista / minorista)
--
--  Cada registro lleva una estampilla `tenant`. Por defecto 'mayorista' (todo lo
--  existente queda en mayorista, sin cambios). La minorista nace vacía. La app
--  filtra cada consulta por la agencia activa; aquí van la columna + helpers de
--  permisos para reforzar con RLS más adelante. Numeración independiente por
--  agencia (un número puede coincidir entre agencias sin relación).
-- ───────────────────────────────────────────────────────────────────────────

-- Tablas consultadas directamente en listados (las hijas cuelgan del contrato,
-- que ya es de una sola agencia, y se filtran vía la venta).
alter table public.ventas                   add column if not exists tenant text not null default 'mayorista';
alter table public.abonos                   add column if not exists tenant text not null default 'mayorista';
alter table public.cuentas_por_pagar        add column if not exists tenant text not null default 'mayorista';
alter table public.facturacion              add column if not exists tenant text not null default 'mayorista';
alter table public.aliados_b2b              add column if not exists tenant text not null default 'mayorista';
alter table public.liquidacion_comisiones   add column if not exists tenant text not null default 'mayorista';
alter table public.pe_empleados             add column if not exists tenant text not null default 'mayorista';
alter table public.pe_costos                add column if not exists tenant text not null default 'mayorista';
alter table public.contabilidad_movimientos add column if not exists tenant text not null default 'mayorista';
alter table public.conciliacion             add column if not exists tenant text not null default 'mayorista';
alter table public.conciliacion_extracto    add column if not exists tenant text not null default 'mayorista';
alter table public.usuarios                 add column if not exists tenant text not null default 'mayorista';

create index if not exists idx_ventas_tenant on public.ventas(tenant);
create index if not exists idx_cxp_tenant on public.cuentas_por_pagar(tenant);

-- Agencia "home" del usuario y qué agencias puede ver (superadmin/gerencia: ambas).
create or replace function public.mi_tenant() returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select tenant from public.usuarios where id = auth.uid()), 'mayorista');
$$;

create or replace function public.puede_ver_tenant(t text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.mi_rol() in ('superadmin','gerencia') or public.mi_tenant() = t;
$$;
