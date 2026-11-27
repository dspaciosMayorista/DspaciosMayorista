-- 327 · Reusable named date sets by year (holidays, Easter, school recess, mid-year break, custom) for hotel validity exclusions. Additive, idempotent.
--
-- WHY: a hotel validity (`hotel_temporadas.rangos`) already carries its own exclusions (`hotel_temporadas.blackouts`, migration 053: every exclusion must sit inside a coverage range).
-- What did not exist is a way to NAME and REUSE a group of dates ("Semana Santa 2027") so the same dates are not retyped for every validity and hotel.
--
-- DESIGN DECISIONS (owner-visible):
--   · APPLYING A SET COPIES ITS DATES into the validity's own `blackouts` (snapshot). There is NO foreign key from a validity to a set: editing or deleting a set later never changes a validity,
--     a published tariff or a price. (Linking would silently change sellable nights; the brief forbids silent propagation.)
--   · Sets are a GLOBAL catalogue (not per hotel): the same holidays/recess repeat across hotels. Each hotel still owns its copy.
--   · NOTHING IS SEEDED. No holiday or school calendar is invented here; the owner creates each set for each year.
--   · `anio` is the year the set belongs to (identification); ranges may cross the new year (school recess Dec→Jan), so ranges are validated as dates, not as "inside anio".
-- Rollback: supabase/scripts/rollback_327_conjuntos_fechas.sql · Preflight/postcheck: supabase/scripts/preflight_327_conjuntos_fechas.sql / postcheck_327_conjuntos_fechas.sql

do $$
begin
  if to_regclass('public.hotel_temporadas') is null then raise exception '327 ABORTADA: falta hotel_temporadas (migración 016/053).'; end if;
  if to_regprocedure('public.mi_rol()') is null then raise exception '327 ABORTADA: falta mi_rol().'; end if;
  if to_regprocedure('public.puede_escribir_catalogo_global()') is null then raise exception '327 ABORTADA: falta puede_escribir_catalogo_global() (migración 237).'; end if;
end $$;

-- [{"fecha_inicio":"2027-03-25","fecha_fin":"2027-03-28"}, ...]: arreglo de rangos con fechas reales y fin >= inicio (vacío permitido: un conjunto recién creado).
create or replace function public.conjunto_fechas_rangos_validos(p jsonb)
returns boolean language plpgsql immutable as $f$
declare e jsonb; ini date; fin date;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    ini := (e ->> 'fecha_inicio')::date; fin := (e ->> 'fecha_fin')::date;
    if ini is null or fin is null or fin < ini then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end
$f$;

create table if not exists public.conjuntos_fechas (
  id          bigint generated always as identity primary key,
  nombre      text not null check (length(btrim(nombre)) between 1 and 80),
  anio        integer not null check (anio between 2000 and 2100),
  tipo        text not null default 'personalizado' check (tipo in ('festivos', 'semana_santa', 'receso_escolar', 'mitad_de_anio', 'personalizado')),
  rangos      jsonb not null default '[]'::jsonb check (public.conjunto_fechas_rangos_validos(rangos)),
  nota        text check (nota is null or length(nota) <= 500),
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Un mismo nombre no se repite en el mismo año (sí en años distintos: «Semana Santa» 2026 y 2027).
create unique index if not exists conjuntos_fechas_nombre_anio_uq on public.conjuntos_fechas (lower(btrim(nombre)), anio);
create index if not exists conjuntos_fechas_anio_idx on public.conjuntos_fechas (anio, tipo);

create or replace function public.conjuntos_fechas_tocar() returns trigger language plpgsql as $f$
begin new.updated_at := now(); new.nombre := btrim(new.nombre); return new; end
$f$;
drop trigger if exists conjuntos_fechas_tocar on public.conjuntos_fechas;
create trigger conjuntos_fechas_tocar before insert or update on public.conjuntos_fechas for each row execute function public.conjuntos_fechas_tocar();

alter table public.conjuntos_fechas enable row level security;
drop policy if exists "conjuntos_fechas: lectura" on public.conjuntos_fechas;
create policy "conjuntos_fechas: lectura" on public.conjuntos_fechas for select to authenticated using (public.mi_rol() is not null);
drop policy if exists "conjuntos_fechas: escritura" on public.conjuntos_fechas;
create policy "conjuntos_fechas: escritura" on public.conjuntos_fechas for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
-- Misma frontera que el resto de catálogos globales (237): solo se escribe con la agencia Mayorista activa.
drop policy if exists "catalogo global: insertar solo Mayorista" on public.conjuntos_fechas;
create policy "catalogo global: insertar solo Mayorista" on public.conjuntos_fechas as restrictive for insert to public with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: actualizar solo Mayorista" on public.conjuntos_fechas;
create policy "catalogo global: actualizar solo Mayorista" on public.conjuntos_fechas as restrictive for update to public using ((select public.puede_escribir_catalogo_global())) with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: borrar solo Mayorista" on public.conjuntos_fechas;
create policy "catalogo global: borrar solo Mayorista" on public.conjuntos_fechas as restrictive for delete to public using ((select public.puede_escribir_catalogo_global()));

revoke all on public.conjuntos_fechas from anon;
grant select, insert, update, delete on public.conjuntos_fechas to authenticated;

do $$ begin
  if to_regprocedure('public.fn_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.conjuntos_fechas';
    execute 'create trigger trg_auditoria after insert or update or delete on public.conjuntos_fechas for each row execute function public.fn_auditoria()';
  end if;
end $$;

comment on table public.conjuntos_fechas is 'Conjuntos de fechas con nombre y año (festivos, Semana Santa, receso escolar, mitad de año, personalizado). Catálogo global SIN datos sembrados. Aplicar un conjunto COPIA sus fechas a hotel_temporadas.blackouts (instantánea): no hay vínculo, editar o borrar un conjunto nunca cambia una vigencia ni un precio.';
