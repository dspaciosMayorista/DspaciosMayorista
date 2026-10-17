-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 213 (número reservado por Coordinación para el hotfix #23).
-- Rama codex/23-programas-destino-fijo, base main ef03a489.
--
-- LISTA FIJA "destino de programas" + destino fijo asignado a cada programa.
--
--  · programa_destinos_fijos: lista comercial administrada A MANO (Producto >
--    Destinos > Listas fijas). Es independiente del catálogo `destinos`
--    (ciudades/IATA) y de la ruta de cada circuito.
--  · programas.destino_fijo_id: UN destino de esa lista por programa. Nullable:
--    NO se asigna ni se deduce nada para los programas existentes; mientras sea
--    NULL el programa queda oculto del tarifario público (regla en la app) y
--    visible/editable en el panel interno.
--
-- DESTINO PROVISIONAL «Por clasificar»: para el despliegue, el usuario crea un destino marcado
-- `es_provisional` y asigna allí los programas existentes (siguen visibles); luego crea los
-- destinos reales y reasigna cada programa. La marca (no el nombre) lo identifica: renombrar el
-- destino no lo vuelve un destino real. A lo sumo UNO por base (índice único parcial).
--
-- Valores asignados no se borran en silencio: la FK es ON DELETE RESTRICT.
-- Duplicados: índice único sobre la clave normalizada (sin mayúsculas, tildes ni
-- espacios repetidos) usando clave_ciudad_ruta() de la 212.
--
-- ADITIVA e IDEMPOTENTE; no toca precios, ruta ni alojamiento_previsto (212).
-- Orden de despliegue: ver docs/tecnico/programas-destino-fijo.md
-- (aplicar la 213 ANTES del código; con el código nuevo desplegado los programas
-- sin destino dejan de verse en el tarifario público hasta que se asignen).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regprocedure('public.clave_ciudad_ruta(text)') is null then
    raise exception 'La 213 requiere la 212 (public.clave_ciudad_ruta). Aplica primero la 212.' using errcode = '42883';
  end if;
  if to_regprocedure('public.mi_rol()') is null then
    raise exception 'La 213 requiere public.mi_rol().' using errcode = '42883';
  end if;
end $$;

create table if not exists public.programa_destinos_fijos (
  id         bigserial primary key,
  nombre     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programa_destinos_fijos_nombre_ck
    check (nombre = btrim(nombre) and char_length(nombre) between 1 and 80)
);

create unique index if not exists programa_destinos_fijos_clave_uk
  on public.programa_destinos_fijos (public.clave_ciudad_ruta(nombre));

-- Marca estable del destino provisional (ver cabecera). NOT NULL DEFAULT false: no reescribe datos.
alter table public.programa_destinos_fijos
  add column if not exists es_provisional boolean not null default false;

create unique index if not exists programa_destinos_fijos_provisional_uk
  on public.programa_destinos_fijos (es_provisional) where es_provisional;

alter table public.programa_destinos_fijos enable row level security;

-- Lectura pública: el filtro del tarifario público necesita el nombre del destino.
drop policy if exists "programa_destinos_fijos: lectura pública" on public.programa_destinos_fijos;
create policy "programa_destinos_fijos: lectura pública" on public.programa_destinos_fijos
  for select using (true);

-- Escritura: mismo grupo que escribe el resto del producto (lib/roles.ts ESCRITURA.producto).
drop policy if exists "programa_destinos_fijos: escritura interna" on public.programa_destinos_fijos;
create policy "programa_destinos_fijos: escritura interna" on public.programa_destinos_fijos
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

-- Privilegios mínimos: anon solo lee; authenticated escribe (la RLS decide el rol).
revoke all on public.programa_destinos_fijos from anon;
revoke all on public.programa_destinos_fijos from authenticated;
grant select on public.programa_destinos_fijos to anon, authenticated;
grant insert, update, delete on public.programa_destinos_fijos to authenticated;
grant usage, select on sequence public.programa_destinos_fijos_id_seq to authenticated;

-- Destino fijo de cada programa. RESTRICT: no se puede borrar un valor asignado.
alter table public.programas
  add column if not exists destino_fijo_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.programas'::regclass and conname = 'programas_destino_fijo_fk'
  ) then
    alter table public.programas
      add constraint programas_destino_fijo_fk
      foreign key (destino_fijo_id) references public.programa_destinos_fijos(id) on delete restrict;
  end if;
end $$;

create index if not exists idx_programas_destino_fijo on public.programas(destino_fijo_id);

comment on table public.programa_destinos_fijos is
  'Lista comercial fija de destinos de programas (administrada a mano). No es el catálogo destinos ni la ruta del circuito.';
comment on column public.programa_destinos_fijos.es_provisional is
  'true = destino provisional «Por clasificar»: los programas asignados son visibles en el tarifario pero están pendientes de su destino real. A lo sumo uno.';
comment on column public.programas.destino_fijo_id is
  'Destino fijo del programa (programa_destinos_fijos). NULL = sin destino: oculto del tarifario público y visible en el panel interno.';

-- Auditoría genérica (087/108) solo en la tabla nueva.
drop trigger if exists trg_auditoria on public.programa_destinos_fijos;
create trigger trg_auditoria after insert or update or delete on public.programa_destinos_fijos
  for each row execute function public.fn_auditoria();

notify pgrst, 'reload schema';

commit;
