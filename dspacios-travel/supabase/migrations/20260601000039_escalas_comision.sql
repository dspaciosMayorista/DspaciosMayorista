-- Migración 039: ESCALAS DE COMISIÓN del asesor interno
--
-- La comisión interna se liquida MENSUAL y ACUMULADA: la suma del PVP del mes
-- del asesor ubica el RANGO de su escala (no marginal: TODO se liquida con el %
-- del rango alcanzado), y ese % se aplica sobre la SUMA de la base comisionable
-- (PVP − BNC) del mes.
--
-- `escala_rangos.pct` se guarda como PORCENTAJE (0.5 = 0.5 %).
-- `pvp_hasta` NULL = rango abierto (de ahí en adelante).

create table if not exists public.escalas_comision (
  id         bigserial primary key,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.escala_rangos (
  id         bigserial primary key,
  escala_id  bigint not null references public.escalas_comision(id) on delete cascade,
  pvp_desde  numeric(15,2) not null default 0,
  pvp_hasta  numeric(15,2),               -- NULL = abierto
  pct        numeric(7,4) not null default 0,  -- porcentaje (0.5 = 0.5 %)
  orden      integer not null default 0
);
create index if not exists idx_escala_rangos_escala on public.escala_rangos(escala_id);

alter table public.asesores
  add column if not exists escala_id bigint references public.escalas_comision(id);

-- ── RLS: lectura autenticados; escritura interna ──────────────────────────
alter table public.escalas_comision enable row level security;
alter table public.escala_rangos    enable row level security;

drop policy if exists "escalas_comision: lectura"   on public.escalas_comision;
drop policy if exists "escalas_comision: escritura" on public.escalas_comision;
drop policy if exists "escala_rangos: lectura"      on public.escala_rangos;
drop policy if exists "escala_rangos: escritura"    on public.escala_rangos;

create policy "escalas_comision: lectura" on public.escalas_comision
  for select using (auth.uid() is not null);
create policy "escalas_comision: escritura" on public.escalas_comision
  for all using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));

create policy "escala_rangos: lectura" on public.escala_rangos
  for select using (auth.uid() is not null);
create policy "escala_rangos: escritura" on public.escala_rangos
  for all using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));
