-- Migración 028: catálogo de FORMAS DE PAGO (editable) para abonos/cartera
--
-- Punto 5 del rediseño: la forma de pago en los abonos pasa de texto libre a una
-- lista desplegable, administrable desde Configuración.

create table if not exists public.formas_pago (
  id         bigserial primary key,
  nombre     text not null unique,
  activo     boolean not null default true,
  orden      integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.formas_pago (nombre, orden) values
  ('Efectivo', 1),
  ('Transferencia', 2),
  ('Tarjeta de crédito', 3),
  ('Tarjeta débito', 4),
  ('PSE', 5),
  ('Nequi', 6),
  ('Daviplata', 7),
  ('Consignación', 8)
on conflict (nombre) do nothing;

-- ── RLS: lectura para autenticados (la usa quien registra abonos);
--    escritura solo interna (administración/gerencia). ───────────────────────
alter table public.formas_pago enable row level security;

drop policy if exists "formas_pago: lectura"   on public.formas_pago;
drop policy if exists "formas_pago: escritura" on public.formas_pago;

create policy "formas_pago: lectura" on public.formas_pago
  for select using (auth.uid() is not null);

create policy "formas_pago: escritura" on public.formas_pago
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));
