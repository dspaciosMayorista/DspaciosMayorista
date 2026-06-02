-- Migración 017: Configuración general de hoteles (catálogos maestros)
--
-- Bases de datos que se llenan una vez y luego se seleccionan al crear un hotel:
--   - categorias_habitacion (Estándar, Junior Suite, Suite, …)
--   - régimen de alimentación: se usa planes_alimentacion (ya existe)
-- Y los enlaces de qué aplica a cada hotel (hotel_categorias, hotel_regimenes).

create table if not exists public.categorias_habitacion (
  id          bigserial primary key,
  nombre      text not null unique,
  descripcion text,
  activo      boolean default true,
  created_at  timestamptz not null default now()
);

-- Qué categorías de habitación aplican a cada hotel
create table if not exists public.hotel_categorias (
  hotel_id     bigint not null references public.hoteles(id) on delete cascade,
  categoria_id bigint not null references public.categorias_habitacion(id) on delete cascade,
  primary key (hotel_id, categoria_id)
);

-- Qué regímenes de alimentación aplican a cada hotel
create table if not exists public.hotel_regimenes (
  hotel_id bigint not null references public.hoteles(id) on delete cascade,
  plan_id  bigint not null references public.planes_alimentacion(id) on delete cascade,
  primary key (hotel_id, plan_id)
);

-- ── RLS (interno) ─────────────────────────────────────────────────────────
alter table public.categorias_habitacion enable row level security;
alter table public.hotel_categorias       enable row level security;
alter table public.hotel_regimenes        enable row level security;

drop policy if exists "categorias_habitacion: interno" on public.categorias_habitacion;
drop policy if exists "hotel_categorias: interno"      on public.hotel_categorias;
drop policy if exists "hotel_regimenes: interno"       on public.hotel_regimenes;

create policy "categorias_habitacion: interno" on public.categorias_habitacion for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "hotel_categorias: interno" on public.hotel_categorias for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "hotel_regimenes: interno" on public.hotel_regimenes for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

-- planes_alimentacion: permitir gestión (escritura) a operaciones/administración
drop policy if exists "planes: escritura interna" on public.planes_alimentacion;
create policy "planes: escritura interna" on public.planes_alimentacion for all
  using (public.mi_rol() in ('superadmin','operaciones','administracion'))
  with check (public.mi_rol() in ('superadmin','operaciones','administracion'));
