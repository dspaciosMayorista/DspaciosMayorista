-- 278 (#90) · Reglas de promoción configurables por hotel: EBB (días entre reserva y check-in) y Long Stay (noches).
-- ADITIVA: una tabla nueva. No toca tarifa_hotel, hotel_temporadas ni ningún precio publicado; sin filas el motor calcula exactamente lo de siempre.
-- Semántica (la implementa lib/calc/descuentoHotel.ts): el descuento recae sobre la NETA HOTELERA antes del markup; si se cumplen varias
-- reglas aplica SOLO la de mayor porcentaje (no se suman ni encadenan); ninguna cumplida = tarifa base.
-- Orden: preflight_278 -> esta migración -> postcheck_278 -> código. Rollback: scripts/rollback_278_hotel_reglas_descuento.sql.
begin;

do $$
begin
  if to_regclass('public.hotel_reglas_descuento') is not null then
    raise exception '278: hotel_reglas_descuento ya existe; no se reaplica';
  end if;
end $$;

create table public.hotel_reglas_descuento (
  id         bigint generated always as identity primary key,
  hotel_id   bigint not null references public.hoteles(id) on delete cascade,
  tipo       text   not null check (tipo in ('ebb', 'long_stay')),
  -- EBB: días mínimos entre la fecha de reserva y el check-in. Long Stay: noches mínimas de la estadía.
  umbral     integer not null check (umbral >= 1),
  pct        numeric(5,2) not null check (pct > 0 and pct < 100),
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hotel_id, tipo, umbral)
);
create index hotel_reglas_descuento_hotel_idx on public.hotel_reglas_descuento (hotel_id) where activa;

alter table public.hotel_reglas_descuento enable row level security;
-- authenticated hereda ALL por defecto en Supabase (incl. TRUNCATE, que la RLS no controla): se revoca y se concede solo el CRUD.
revoke all on table public.hotel_reglas_descuento from public, anon, authenticated;
grant select, insert, update, delete on table public.hotel_reglas_descuento to authenticated;

create policy "reglas descuento: leer interno" on public.hotel_reglas_descuento
  for select to authenticated using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta'));
create policy "reglas descuento: escribir" on public.hotel_reglas_descuento
  for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

-- Mismo candado que el resto de catálogos globales (237): solo la agencia Mayorista escribe.
create policy "catalogo global: insertar solo Mayorista" on public.hotel_reglas_descuento as restrictive for insert to public with check ((select public.puede_escribir_catalogo_global()));
create policy "catalogo global: actualizar solo Mayorista" on public.hotel_reglas_descuento as restrictive for update to public using ((select public.puede_escribir_catalogo_global())) with check ((select public.puede_escribir_catalogo_global()));
create policy "catalogo global: borrar solo Mayorista" on public.hotel_reglas_descuento as restrictive for delete to public using ((select public.puede_escribir_catalogo_global()));

commit;
