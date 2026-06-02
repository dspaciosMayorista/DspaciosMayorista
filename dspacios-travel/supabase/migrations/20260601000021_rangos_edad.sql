-- Migración 021: catálogo de RANGOS DE EDAD + selección por componente
--
-- Hotel, vuelos y servicios manejan rangos de edad distintos para clasificar
-- infantes/niños. Se define un catálogo de rangos (denominación + edad mín/máx)
-- administrable desde Parámetros, y cada hotel / bloqueo / servicio selecciona
-- cuáles rangos le aplican.

create table if not exists public.rangos_edad (
  id           bigserial primary key,
  denominacion text not null,        -- ej. "Infante", "Niño"
  edad_min     integer not null default 0,
  edad_max     integer not null default 0,
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Selección de rangos aplicables por componente (array de ids del catálogo).
alter table public.hoteles               add column if not exists rangos_edad bigint[];
alter table public.bloqueos_vuelo        add column if not exists rangos_edad bigint[];
alter table public.servicios_adicionales add column if not exists rangos_edad bigint[];

-- ── RLS (interno) ─────────────────────────────────────────────────────────
alter table public.rangos_edad enable row level security;
drop policy if exists "rangos_edad: interno" on public.rangos_edad;
create policy "rangos_edad: interno" on public.rangos_edad for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
