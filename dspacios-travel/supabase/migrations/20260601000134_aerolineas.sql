-- ───────────────────────────────────────────────────────────────────────────
-- 134 · Catálogo de aerolíneas + tipos de tarifa/equipaje por aerolínea
--
-- Pedido del dueño: en la sección Vuelos del contrato manual/dinámico, la
-- aerolínea era texto libre y el campo "Servicios (equipaje…)" también —
-- había que redigitar a mano el texto completo del tipo de tarifa cada vez
-- (ej. "ARTICULO PERSONAL MOCHILA O BOLSO (45 x 35 x 20 cm) POR PERSONA
-- AVIANCA"). Se monta un catálogo, configurado en mayorista y compartido con
-- minorista (mismo criterio ya usado por `destinos`: sin columna `tenant`,
-- lectura pública, escritura solo superadmin/operaciones).
--
-- Cada aerolínea trae su propia lista de tipos de tarifa/equipaje (varía por
-- aerolínea: unas tienen 3 niveles, otras 4, otras con nombres distintos —
-- por eso `nombre`/`descripcion` quedan libres, no un enum fijo).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.aerolineas (
  id         bigserial primary key,
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.aerolinea_tarifas (
  id           bigserial primary key,
  aerolinea_id bigint not null references public.aerolineas(id) on delete cascade,
  nombre       text not null,   -- ej. "Artículo personal", "Personal + cabina + bodega"
  descripcion  text not null,   -- texto completo tal como debe verse en el contrato
  orden        int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_aerolinea_tarifas_aerolinea on public.aerolinea_tarifas(aerolinea_id);

alter table public.aerolineas enable row level security;
alter table public.aerolinea_tarifas enable row level security;

drop policy if exists "aerolineas: lectura pública" on public.aerolineas;
create policy "aerolineas: lectura pública" on public.aerolineas for select using (true);
drop policy if exists "aerolineas: escritura admin" on public.aerolineas;
create policy "aerolineas: escritura admin" on public.aerolineas for all
  using (public.mi_rol() in ('superadmin','operaciones'))
  with check (public.mi_rol() in ('superadmin','operaciones'));

drop policy if exists "aerolinea_tarifas: lectura pública" on public.aerolinea_tarifas;
create policy "aerolinea_tarifas: lectura pública" on public.aerolinea_tarifas for select using (true);
drop policy if exists "aerolinea_tarifas: escritura admin" on public.aerolinea_tarifas;
create policy "aerolinea_tarifas: escritura admin" on public.aerolinea_tarifas for all
  using (public.mi_rol() in ('superadmin','operaciones'))
  with check (public.mi_rol() in ('superadmin','operaciones'));
