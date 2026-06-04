-- 033 · Facturas con múltiples ítems (gravables / no gravables)
-- Una factura puede tener varios ítems; cada ítem se marca gravable o no.
--   base_gravable    = Σ ítems gravables       (genera IVA 19%)
--   base_no_gravable = Σ ítems no gravables    (no genera IVA)

alter table public.facturacion
  add column if not exists base_no_gravable numeric not null default 0;

create table if not exists public.factura_items (
  id          bigserial primary key,
  factura_id  bigint not null references public.facturacion(id) on delete cascade,
  descripcion text,
  valor       numeric not null default 0,
  gravable    boolean not null default true,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_factura_items_factura on public.factura_items(factura_id);

alter table public.factura_items enable row level security;
drop policy if exists "factura_items: acceso contable" on public.factura_items;
create policy "factura_items: acceso contable"
  on public.factura_items for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
