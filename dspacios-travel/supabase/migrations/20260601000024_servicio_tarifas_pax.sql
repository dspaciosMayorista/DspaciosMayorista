-- Migración 024: tarifas de servicio por persona / por grupo (con escalas de pax)
--
-- Cada servicio tiene UN tipo de tarifa:
--   'persona' → el precio de cada escala es POR PERSONA (total = pax × precio).
--   'grupo'   → el precio de cada escala es FIJO del grupo para ese rango de pax.
-- Las escalas viven en `servicio_tarifa_pax` (rango de pax + precio neto).

alter table public.servicios_adicionales
  add column if not exists tipo_tarifa text not null default 'persona';  -- 'persona' | 'grupo'

create table if not exists public.servicio_tarifa_pax (
  id           bigserial primary key,
  servicio_id  bigint not null references public.servicios_adicionales(id) on delete cascade,
  pax_desde    integer not null default 1,
  pax_hasta    integer not null default 1,
  precio       numeric(15,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_servicio_tarifa_pax_servicio on public.servicio_tarifa_pax(servicio_id);

alter table public.servicio_tarifa_pax enable row level security;
drop policy if exists "servicio_tarifa_pax: interno" on public.servicio_tarifa_pax;
create policy "servicio_tarifa_pax: interno" on public.servicio_tarifa_pax for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

-- Para publicar las escalas de servicio en el tarifario (lectura pública)
alter table public.tarifario_resultado
  add column if not exists pax_desde   integer,
  add column if not exists pax_hasta   integer,
  add column if not exists tipo_tarifa text;
