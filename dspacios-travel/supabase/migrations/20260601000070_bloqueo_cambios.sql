-- ───────────────────────────────────────────────────────────────────────────
-- 070 · CAMBIOS OPERACIONALES de bloqueos de vuelo
--
-- Registro/historial de cambios operacionales de un bloqueo (la aerolínea
-- cambia seguido las horas e incluso el número de vuelo). Cada cambio queda
-- con el detalle (antes→después), una nota opcional y quién lo registró.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.bloqueo_cambios (
  id              bigserial primary key,
  bloqueo_id      bigint not null references public.bloqueos_vuelo(id) on delete cascade,
  fecha           timestamptz not null default now(),
  detalle         text,              -- "Vuelo ida 5440→5450; Hora salida ida 08:47→09:10"
  nota            text,              -- nota libre del operador
  registrado_por  text
);
create index if not exists idx_bloqueo_cambios_bloqueo on public.bloqueo_cambios(bloqueo_id);

alter table public.bloqueo_cambios enable row level security;

drop policy if exists "bloqueo_cambios: lectura operativa" on public.bloqueo_cambios;
create policy "bloqueo_cambios: lectura operativa"
  on public.bloqueo_cambios for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

drop policy if exists "bloqueo_cambios: escritura control" on public.bloqueo_cambios;
create policy "bloqueo_cambios: escritura control"
  on public.bloqueo_cambios for all
  using (public.mi_rol() in ('superadmin','administracion','operaciones','control_vuelo'));
