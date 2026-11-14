-- ─────────────────────────────────────────────────────────────────────────────
-- 293 · #43/#60 incremento 1 — Grupos de días por vigencia: ESQUEMA ADITIVO E INACTIVO
-- ─────────────────────────────────────────────────────────────────────────────
-- NÚMERO PROVISIONAL (2026-11-11): 293 era el siguiente sin usar tras revisar los
-- worktrees locales sin commit (#75 llega a la 292, #97 a la 290/291) y las ramas.
-- Se vuelve a confirmar con el dueño y con #75/#97 ANTES de aplicarla; si otro
-- frente toma el 293 mientras esta migración no esté aplicada, se renumera.
--
-- QUÉ HACE (aditivo; nada lo usa todavía):
--   1) `hotel_temporada_grupos`: grupos de días de la semana (1 = lunes … 7 = domingo)
--      de UNA vigencia (`hotel_temporadas.id`), con identidad estable (uuid).
--   2) `tarifa_hotel.grupo_id` (FK restrict) y `tarifa_hotel.grupo_dias` (copia de los
--      días del grupo en ESA versión de la fila: el historial de la 203 guarda la fila
--      completa, así que cada versión conserva su grupo y sus días aunque el grupo
--      cambie después). NULL = «todos los días» = todo el dato actual.
--   3) Controles de consistencia, índice único SOLO para filas con grupo, RLS y
--      auditoría iguales a `tarifa_hotel`.
--
-- INACTIVO POR DISEÑO: `hotel_temporada_grupos.activo` tiene un CHECK que lo obliga a
-- ser false, y una tarifa solo puede apuntar a un grupo ACTIVO. Resultado: hoy NINGUNA
-- fila de `tarifa_hotel` puede tener grupo, así que el motor (que todavía no conoce
-- grupos) no puede leer una tarifa por grupo como si fuera «todos los días». Activar
-- exige una migración futura que quite ese CHECK cuando el motor los soporte.
--
-- NO CAMBIA: precios, tarifas, vigencias, publicaciones ni el comportamiento de ningún
-- hotel. Agregar columnas NULL sin default no reescribe filas ni dispara triggers de
-- fila (ni el historial ni la invalidación del tarifario). Los duplicados históricos
-- NO se corrigen: el índice único es parcial (solo filas con grupo).
--
-- ORDEN: preflight_293 (solo lectura) → esta migración → postcheck_293 (solo lectura)
-- → recién después el código (solo tipos). Rollback: rollback_293 (protegido).
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

-- Candado de versión: no reaplicar sobre un esquema distinto al esperado.
do $$
begin
  if to_regclass('public.tarifa_hotel') is null or to_regclass('public.hotel_temporadas') is null
     or to_regclass('public.hoteles') is null then
    raise exception '293 ABORTADA: faltan tablas base del tarifario de hoteles';
  end if;
  if to_regprocedure('public.fn_auditoria()') is null or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.puede_escribir_catalogo_global()') is null then
    raise exception '293 ABORTADA: faltan fn_auditoria / mi_rol / puede_escribir_catalogo_global';
  end if;
end $$;

-- 1) Grupos de días ------------------------------------------------------------
create table if not exists public.hotel_temporada_grupos (
  id              uuid primary key default gen_random_uuid(),
  temporada_id    bigint not null references public.hotel_temporadas(id) on delete restrict,
  nombre          text not null,
  dias            smallint[] not null,
  activo          boolean not null default false,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint hotel_temporada_grupos_nombre_valido
    check (btrim(nombre) <> '' and char_length(nombre) <= 60),
  constraint hotel_temporada_grupos_dias_validos
    check (cardinality(dias) between 1 and 7
           and array_position(dias, null) is null
           and dias <@ array[1,2,3,4,5,6,7]::smallint[]),
  -- Candado de inactividad (#43/#60): se quita SOLO cuando el motor soporte grupos.
  constraint hotel_temporada_grupos_inactivos_43
    check (not activo)
);
comment on table public.hotel_temporada_grupos is
  '#43/#60: grupos de días de la semana (1=lun … 7=dom) de una vigencia. INACTIVOS hasta que el motor los soporte (check hotel_temporada_grupos_inactivos_43).';

create unique index if not exists hotel_temporada_grupos_nombre_uq
  on public.hotel_temporada_grupos (temporada_id, lower(btrim(nombre)));
create index if not exists hotel_temporada_grupos_temporada_idx
  on public.hotel_temporada_grupos (temporada_id);

-- 2) Columnas en tarifa_hotel ---------------------------------------------------
alter table public.tarifa_hotel
  add column if not exists grupo_id   uuid references public.hotel_temporada_grupos(id) on delete restrict,
  add column if not exists grupo_dias smallint[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarifa_hotel_grupo_dias_coherente'
                 and conrelid = 'public.tarifa_hotel'::regclass) then
    alter table public.tarifa_hotel
      add constraint tarifa_hotel_grupo_dias_coherente
      check ((grupo_id is null) = (grupo_dias is null));
  end if;
end $$;

comment on column public.tarifa_hotel.grupo_id is
  '#43/#60: grupo de días de la vigencia. NULL = todos los días (todo el dato previo). Solo admite grupos activos.';
comment on column public.tarifa_hotel.grupo_dias is
  '#43/#60: copia de los días del grupo en esta versión de la fila (la fija el trigger; el historial la conserva).';

-- Único SOLO para filas con grupo (el legado y sus duplicados no se tocan).
create unique index if not exists tarifa_hotel_grupo_clave_uq
  on public.tarifa_hotel (hotel_id, btrim(coalesce(tipo_habitacion, '')), btrim(coalesce(alimentacion, '')),
                          btrim(coalesce(temporada, '')), grupo_id)
  where grupo_id is not null;
-- Índice de apoyo para la FK (borrado de grupos) y para el control de mezcla.
create index if not exists tarifa_hotel_grupo_idx
  on public.tarifa_hotel (grupo_id) where grupo_id is not null;

-- 3) Funciones de control -------------------------------------------------------
-- Clave de candado por hotel: serializa las escrituras que deciden «tiene grupos».
create or replace function public.t43_60_candado_hotel(p_hotel bigint, p_exclusivo boolean)
returns void language plpgsql volatile set search_path = public, pg_temp as $$
begin
  if p_exclusivo then
    perform pg_advisory_xact_lock(hashtextextended('t43_60_hotel:' || p_hotel::text, 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('t43_60_hotel:' || p_hotel::text, 0));
  end if;
end $$;

-- 3.1 Grupos: días sin repetir y ordenados; vigencia fija; sin solape; nombre de la
--     vigencia único en el hotel; hotel no por unidad.
create or replace function public.tg_hotel_temporada_grupos_validar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel  bigint;
  v_nombre text;
  v_modelo text;
  v_otro   text;
begin
  if tg_op = 'UPDATE' and new.temporada_id is distinct from old.temporada_id then
    raise exception 'Un grupo de días no se puede mover a otra vigencia (grupo %).', old.id
      using errcode = '23514';
  end if;
  if (select count(distinct d) from unnest(new.dias) d) <> cardinality(new.dias) then
    raise exception 'El grupo "%" repite días.', new.nombre using errcode = '23514';
  end if;
  new.dias := coalesce((select array_agg(d order by d) from unnest(new.dias) d), '{}'::smallint[]);
  new.nombre := btrim(new.nombre);
  new.actualizado_en := now();

  -- Orden de candados, igual en todos los caminos: fila del grupo → fila de la vigencia →
  -- candado consultivo del hotel → fila del hotel. La vigencia se bloquea ANTES de leer su
  -- hotel y su nombre: un renombre o un cambio de hotel en curso se espera y luego se lee
  -- la versión confirmada (FOR UPDATE devuelve la última). Mientras esta transacción viva,
  -- nadie más puede cambiar ese hotel ni ese nombre. Sin reintentos.
  select t.hotel_id, btrim(t.nombre) into v_hotel, v_nombre
  from public.hotel_temporadas t where t.id = new.temporada_id
  for update;
  if not found then
    raise exception 'La vigencia % no existe.', new.temporada_id using errcode = '23503';
  end if;
  perform public.t43_60_candado_hotel(v_hotel, true);
  select h.modelo_tarifario into v_modelo from public.hoteles h where h.id = v_hotel for share;

  if v_modelo = 'unidad' then
    raise exception 'Los hoteles de modelo por unidad no admiten grupos de días (hotel %).', v_hotel
      using errcode = '23514';
  end if;
  if exists (select 1 from public.hotel_temporadas t
             where t.hotel_id = v_hotel and t.id <> new.temporada_id and btrim(t.nombre) = v_nombre) then
    raise exception 'La vigencia "%" tiene el nombre repetido en el hotel %; solo una vigencia con nombre único puede tener grupos.',
      v_nombre, v_hotel using errcode = '23514';
  end if;
  select g.nombre into v_otro
  from public.hotel_temporada_grupos g
  where g.temporada_id = new.temporada_id and g.id <> new.id and g.dias && new.dias
  limit 1;
  if v_otro is not null then
    raise exception 'El grupo "%" comparte días con el grupo "%" de la misma vigencia.', new.nombre, v_otro
      using errcode = '23514';
  end if;
  return new;
end $$;

-- 3.2 Al cambiar los días de un grupo, cada tarifa enlazada recibe la copia nueva; el
--     historial de la 203 guarda la versión anterior con sus días.
create or replace function public.tg_hotel_temporada_grupos_propagar_dias()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tarifa_hotel set grupo_dias = new.dias
  where grupo_id = new.id and grupo_dias is distinct from new.dias;
  return null;
end $$;

-- 3.3 Tarifas: grupo activo, mismo hotel y vigencia; copia de días; sin mezclar filas
--     «todos los días» y por grupo en la misma vigencia.
create or replace function public.tg_tarifa_hotel_grupo_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g record;
  v record;
begin
  if new.grupo_id is null then
    -- Camino de TODA tarifa actual: candado compartido (no bloquea otras tarifas sin
    -- grupo) y un EXISTS sobre un índice parcial vacío mientras no haya grupos.
    perform public.t43_60_candado_hotel(new.hotel_id, false);
    if exists (select 1 from public.tarifa_hotel x
               where x.grupo_id is not null and x.hotel_id = new.hotel_id
                 and btrim(coalesce(x.temporada, '')) = btrim(coalesce(new.temporada, ''))
                 and x.id <> new.id) then
      raise exception 'La vigencia "%" del hotel % ya tiene tarifas por grupo de días; no admite tarifas de todos los días.',
        new.temporada, new.hotel_id using errcode = '23514';
    end if;
    return new;
  end if;

  -- Mismo orden de candados que el trigger de grupos: grupo → vigencia → hotel. Cada fila
  -- se lee bajo su candado (versión confirmada), sin reintentos.
  select gr.id, gr.activo, gr.dias, gr.temporada_id into g
  from public.hotel_temporada_grupos gr where gr.id = new.grupo_id
  for share;
  if not found then
    raise exception 'El grupo % no existe.', new.grupo_id using errcode = '23503';
  end if;
  select t.hotel_id as hotel_id, btrim(t.nombre) as vigencia into v
  from public.hotel_temporadas t where t.id = g.temporada_id
  for share;
  perform public.t43_60_candado_hotel(new.hotel_id, true);
  if not g.activo then
    raise exception 'Los grupos de días están inactivos (#43/#60): ninguna tarifa puede usar un grupo hasta que el motor los soporte.'
      using errcode = '23514';
  end if;
  if v.hotel_id <> new.hotel_id or v.vigencia <> btrim(coalesce(new.temporada, '')) then
    raise exception 'La tarifa no coincide con el hotel y la vigencia de su grupo (grupo %).', new.grupo_id
      using errcode = '23514';
  end if;
  if exists (select 1 from public.tarifa_hotel x
             where x.grupo_id is null and x.hotel_id = new.hotel_id
               and btrim(coalesce(x.temporada, '')) = v.vigencia and x.id <> new.id) then
    raise exception 'La vigencia "%" del hotel % tiene tarifas de todos los días; no admite tarifas por grupo.',
      v.vigencia, new.hotel_id using errcode = '23514';
  end if;
  new.grupo_dias := g.dias;
  return new;
end $$;

-- 3.4 Vigencias: no repetir el nombre de una vigencia con grupos, no moverla de hotel.
create or replace function public.tg_hotel_temporadas_grupos_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.t43_60_candado_hotel(new.hotel_id, false);
  if tg_op = 'UPDATE' and new.hotel_id is distinct from old.hotel_id
     and exists (select 1 from public.hotel_temporada_grupos g where g.temporada_id = old.id) then
    raise exception 'La vigencia "%" tiene grupos de días; no se puede mover a otro hotel.', old.nombre
      using errcode = '23514';
  end if;
  if exists (select 1 from public.hotel_temporada_grupos g
             join public.hotel_temporadas t on t.id = g.temporada_id
             where t.hotel_id = new.hotel_id and t.id <> new.id
               and btrim(t.nombre) = btrim(new.nombre)) then
    raise exception 'Ya existe en el hotel % una vigencia "%" con grupos de días; el nombre no se puede repetir.',
      new.hotel_id, btrim(new.nombre) using errcode = '23514';
  end if;
  if tg_op = 'UPDATE'
     and exists (select 1 from public.hotel_temporada_grupos g where g.temporada_id = new.id)
     and exists (select 1 from public.hotel_temporadas t
                 where t.hotel_id = new.hotel_id and t.id <> new.id and btrim(t.nombre) = btrim(new.nombre)) then
    raise exception 'La vigencia "%" tiene grupos de días; su nombre no puede repetir el de otra vigencia del hotel.',
      btrim(new.nombre) using errcode = '23514';
  end if;
  return new;
end $$;

-- 3.5 Hoteles: un hotel con grupos no pasa a modelo por unidad.
create or replace function public.tg_hoteles_modelo_grupos_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.modelo_tarifario = 'unidad'
     and exists (select 1 from public.hotel_temporada_grupos g
                 join public.hotel_temporadas t on t.id = g.temporada_id
                 where t.hotel_id = new.id) then
    raise exception 'El hotel % tiene grupos de días; no puede pasar a modelo por unidad.', new.id
      using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.t43_60_candado_hotel(bigint, boolean) from public, anon, authenticated;
revoke all on function public.tg_hotel_temporada_grupos_validar() from public, anon, authenticated;
revoke all on function public.tg_hotel_temporada_grupos_propagar_dias() from public, anon, authenticated;
revoke all on function public.tg_tarifa_hotel_grupo_43() from public, anon, authenticated;
revoke all on function public.tg_hotel_temporadas_grupos_43() from public, anon, authenticated;
revoke all on function public.tg_hoteles_modelo_grupos_43() from public, anon, authenticated;

-- 4) Triggers --------------------------------------------------------------------
drop trigger if exists trg_hotel_temporada_grupos_validar on public.hotel_temporada_grupos;
create trigger trg_hotel_temporada_grupos_validar
  before insert or update on public.hotel_temporada_grupos
  for each row execute function public.tg_hotel_temporada_grupos_validar();

drop trigger if exists trg_hotel_temporada_grupos_propagar_dias on public.hotel_temporada_grupos;
create trigger trg_hotel_temporada_grupos_propagar_dias
  after update of dias on public.hotel_temporada_grupos
  for each row when (new.dias is distinct from old.dias)
  execute function public.tg_hotel_temporada_grupos_propagar_dias();

drop trigger if exists trg_auditoria on public.hotel_temporada_grupos;
create trigger trg_auditoria
  after insert or update or delete on public.hotel_temporada_grupos
  for each row execute function public.fn_auditoria();

drop trigger if exists trg_tarifa_hotel_grupo_43 on public.tarifa_hotel;
create trigger trg_tarifa_hotel_grupo_43
  before insert or update of grupo_id, grupo_dias, hotel_id, temporada on public.tarifa_hotel
  for each row execute function public.tg_tarifa_hotel_grupo_43();

drop trigger if exists trg_hotel_temporadas_grupos_43 on public.hotel_temporadas;
create trigger trg_hotel_temporadas_grupos_43
  before insert or update of nombre, hotel_id on public.hotel_temporadas
  for each row execute function public.tg_hotel_temporadas_grupos_43();

drop trigger if exists trg_hoteles_modelo_grupos_43 on public.hoteles;
create trigger trg_hoteles_modelo_grupos_43
  before update of modelo_tarifario on public.hoteles
  for each row when (new.modelo_tarifario is distinct from old.modelo_tarifario)
  execute function public.tg_hoteles_modelo_grupos_43();

-- 5) RLS y permisos: iguales a tarifa_hotel (lectura y escritura solo internos;
--    escritura del catálogo global solo en sesión Mayorista; anon sin acceso).
alter table public.hotel_temporada_grupos enable row level security;

drop policy if exists "hotel_temporada_grupos: interno" on public.hotel_temporada_grupos;
create policy "hotel_temporada_grupos: interno" on public.hotel_temporada_grupos
  for all
  using (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]))
  with check (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]));

drop policy if exists "catalogo global: insertar solo Mayorista" on public.hotel_temporada_grupos;
create policy "catalogo global: insertar solo Mayorista" on public.hotel_temporada_grupos
  as restrictive for insert with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: actualizar solo Mayorista" on public.hotel_temporada_grupos;
create policy "catalogo global: actualizar solo Mayorista" on public.hotel_temporada_grupos
  as restrictive for update using ((select public.puede_escribir_catalogo_global()))
  with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: borrar solo Mayorista" on public.hotel_temporada_grupos;
create policy "catalogo global: borrar solo Mayorista" on public.hotel_temporada_grupos
  as restrictive for delete using ((select public.puede_escribir_catalogo_global()));

revoke all on public.hotel_temporada_grupos from public, anon;
grant select, insert, update, delete on public.hotel_temporada_grupos to authenticated;
grant all on public.hotel_temporada_grupos to service_role;

commit;
