-- 059 · Vouchers (Fase 1: voucher de servicios al cliente, uno por proveedor)
--
-- Un voucher se genera desde un contrato y se guarda con su contenido editable
-- (jsonb) + token público para imprimir/compartir (como contratos y cotizaciones).
-- 'tipo' deja espacio para futuros vouchers (hotel, tiquete).

create table if not exists public.vouchers (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  tipo            text not null default 'servicios',   -- servicios | hotel | tiquete
  proveedor       text,                                 -- proveedor agrupado (para 'servicios')
  contenido       jsonb not null,                       -- campos editables del voucher
  share_token     uuid not null default gen_random_uuid(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_vouchers_contrato on public.vouchers(numero_contrato);
create unique index if not exists vouchers_share_token_key on public.vouchers(share_token);

alter table public.vouchers enable row level security;
drop policy if exists "vouchers: interno" on public.vouchers;
create policy "vouchers: interno" on public.vouchers for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

-- Contacto que aparece en el voucher (nombre del contacto · celular · operador).
alter table public.proveedores
  add column if not exists voucher_contacto text;
