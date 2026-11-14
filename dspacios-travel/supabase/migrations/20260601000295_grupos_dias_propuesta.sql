-- ─────────────────────────────────────────────────────────────────────────────
-- 295 · #43/#60 incremento 3 — Preparar grupos de días y sus tarifas como PROPUESTA (inactiva)
-- ─────────────────────────────────────────────────────────────────────────────
-- NÚMERO PROVISIONAL (2026-11-11): 292 y 294 son de #75 (la 294 = mantenimiento), 293 es de este
-- frente (APLICADA). 295 estaba libre en todos los worktrees y ramas. Se confirma con el dueño y
-- #75/#97 antes de aplicarla; si otro frente la toma mientras no esté aplicada, se renumera.
--
-- NO modifica la 293 ni retira su candado: los grupos siguen inactivos y ninguna tarifa por grupo
-- puede existir en `tarifa_hotel`. Las tarifas por grupo se guardan en una tabla de PROPUESTA que
-- el motor no lee. Nada de esto cambia precios, tarifas vigentes, promociones ni publicaciones.
--
-- QUÉ AGREGA:
--   1) `hotel_grupo_tarifa_propuesta`: borrador de tarifas por grupo × categoría × régimen.
--   2) Grupos solo en vigencias de tipo 'tarifa' (las promociones por grupo son la entrega 4), y
--      una vigencia con grupos no cambia de tipo.
--   3) Huella de la configuración de una vigencia (vigencia, grupos, propuestas, tarifas de origen
--      y promociones vinculadas) y cuatro RPC: leer, guardar grupos, guardar propuesta (3 modos),
--      borrar grupo (solo el grupo y SUS propuestas). Las escrituras comparan la huella dentro de
--      la transacción, bajo candados compatibles con la 293 (grupos → vigencia → tarifas de origen y
--      promociones vinculadas en modo compartido → candado del hotel → hotel); si cambió, rechazan
--      con SQLSTATE PT409 (HTTP 409) y piden recargar. Sin reintentos.
--
-- ORDEN: preflight_295 → esta migración → postcheck_295 → recién después el código.
-- Rollback: rollback_295 (protegido: aborta si hay propuestas guardadas).
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.hotel_temporada_grupos') is null
     or not exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43') then
    raise exception '295 ABORTADA: requiere la 293 aplicada con su candado de inactividad';
  end if;
  if to_regprocedure('public.t43_60_candado_hotel(bigint, boolean)') is null
     or to_regprocedure('public.fn_auditoria()') is null or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.puede_escribir_catalogo_global()') is null then
    raise exception '295 ABORTADA: faltan funciones base (candado 293, auditoría, mi_rol, catálogo global)';
  end if;
end $$;

-- 1) Propuesta ------------------------------------------------------------------
create table if not exists public.hotel_grupo_tarifa_propuesta (
  id                bigserial primary key,
  grupo_id          uuid not null references public.hotel_temporada_grupos(id) on delete restrict,
  tipo_habitacion   text not null,
  alimentacion      text not null,
  neto_sencilla     numeric, neto_doble numeric, neto_triple numeric, neto_multiple numeric,
  neto_nino         numeric, neto_nino2 numeric, neto_infante numeric,
  nota_infante      text,
  notas             text,
  edad_infante_min  integer, edad_infante_max integer, edad_nino_min integer, edad_nino_max integer,
  origen_tarifa_id  bigint,  -- tarifa «todos los días» cuya sugerencia se aceptó (null = escrito a mano)
  origen_huella     text,    -- huella de esa fila al aceptarla (para detectarla obsoleta al activar)
  confirmado_por    uuid,
  confirmado_en     timestamptz not null default now(),
  constraint hotel_grupo_tarifa_propuesta_clave_uq unique (grupo_id, tipo_habitacion, alimentacion),
  constraint hotel_grupo_tarifa_propuesta_textos check (
    tipo_habitacion = btrim(tipo_habitacion) and tipo_habitacion <> ''
    and alimentacion = btrim(alimentacion) and alimentacion <> ''),
  constraint hotel_grupo_tarifa_propuesta_netos check (
    coalesce(neto_sencilla, 0) >= 0 and coalesce(neto_doble, 0) >= 0 and coalesce(neto_triple, 0) >= 0
    and coalesce(neto_multiple, 0) >= 0 and coalesce(neto_nino, 0) >= 0 and coalesce(neto_nino2, 0) >= 0
    and coalesce(neto_infante, 0) >= 0),
  -- Una fila sin ningún neto no dice nada: no se guarda (la ausencia ya significa «no se vende»).
  constraint hotel_grupo_tarifa_propuesta_algun_neto check (
    num_nonnulls(neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante) > 0),
  constraint hotel_grupo_tarifa_propuesta_edades_todas_o_ninguna check (
    num_nulls(edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) in (0, 4)),
  constraint hotel_grupo_tarifa_propuesta_edades_rangos check (
    edad_infante_min is null or (edad_infante_min = 0 and edad_infante_max >= 0
      and edad_nino_min = edad_infante_max + 1 and edad_nino_max >= edad_nino_min and edad_nino_max <= 17)),
  constraint hotel_grupo_tarifa_propuesta_origen check ((origen_tarifa_id is null) = (origen_huella is null))
);
comment on table public.hotel_grupo_tarifa_propuesta is
  '#43/#60: PROPUESTA de tarifas por grupo de días (inactiva). El motor no la lee; solo la futura activación (3c) la pasará a tarifa_hotel.';
create index if not exists hotel_grupo_tarifa_propuesta_grupo_idx on public.hotel_grupo_tarifa_propuesta (grupo_id);

alter table public.hotel_grupo_tarifa_propuesta enable row level security;
drop policy if exists "hotel_grupo_tarifa_propuesta: interno" on public.hotel_grupo_tarifa_propuesta;
create policy "hotel_grupo_tarifa_propuesta: interno" on public.hotel_grupo_tarifa_propuesta
  for select using (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]));
-- Lectura directa igual que tarifa_hotel; las escrituras SOLO por las RPC (huella y candados).
revoke all on public.hotel_grupo_tarifa_propuesta from public, anon, authenticated;
grant select on public.hotel_grupo_tarifa_propuesta to authenticated;
grant all on public.hotel_grupo_tarifa_propuesta to service_role;
revoke all on sequence public.hotel_grupo_tarifa_propuesta_id_seq from public, anon, authenticated;

drop trigger if exists trg_auditoria on public.hotel_grupo_tarifa_propuesta;
create trigger trg_auditoria after insert or update or delete on public.hotel_grupo_tarifa_propuesta
  for each row execute function public.fn_auditoria();

-- 2) Grupos solo en vigencias de tipo 'tarifa' ------------------------------------
create or replace function public.tg_hotel_temporada_grupos_tipo_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tipo text;
begin
  -- Fila de la vigencia bloqueada (mismo orden que la 293: grupo → vigencia).
  select coalesce(t.tipo, 'tarifa') into v_tipo from public.hotel_temporadas t where t.id = new.temporada_id for update;
  if found and v_tipo <> 'tarifa' then
    raise exception 'Los grupos de días solo se configuran en vigencias de tarifa (esta es de tipo %).', v_tipo
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_hotel_temporada_grupos_tipo_43 on public.hotel_temporada_grupos;
create trigger trg_hotel_temporada_grupos_tipo_43
  before insert or update of temporada_id on public.hotel_temporada_grupos
  for each row execute function public.tg_hotel_temporada_grupos_tipo_43();

create or replace function public.tg_hotel_temporadas_tipo_grupos_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.tipo, 'tarifa') <> 'tarifa'
     and exists (select 1 from public.hotel_temporada_grupos g where g.temporada_id = new.id) then
    raise exception 'La vigencia "%" tiene grupos de días; no puede pasar a tipo %.', new.nombre, new.tipo
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_hotel_temporadas_tipo_grupos_43 on public.hotel_temporadas;
create trigger trg_hotel_temporadas_tipo_grupos_43
  before update of tipo on public.hotel_temporadas
  for each row when (new.tipo is distinct from old.tipo)
  execute function public.tg_hotel_temporadas_tipo_grupos_43();

-- 3) Configuración, huella y autorización ------------------------------------------
create or replace function public._grupos_43_autorizar(p_escritura boolean)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'Sin permiso para los grupos de días.' using errcode = '42501';
  end if;
  if p_escritura and not public.puede_escribir_catalogo_global() then
    raise exception 'Los catálogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;
end $$;

-- Configuración completa de UNA vigencia + su huella. Única fuente para leer y para comparar.
create or replace function public._grupos_43_config(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v public.hotel_temporadas;
  r jsonb;
begin
  select * into v from public.hotel_temporadas where id = p_temporada_id;
  if not found then
    raise exception 'La vigencia % no existe.', p_temporada_id using errcode = 'P0002';
  end if;
  with
  grupos as (select g.* from public.hotel_temporada_grupos g where g.temporada_id = v.id),
  props as (select p.* from public.hotel_grupo_tarifa_propuesta p join grupos g on g.id = p.grupo_id),
  origen as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = btrim(v.nombre) and t.grupo_id is null),
  promo_filas as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada_base, '')) = btrim(v.nombre)),
  promo_vigs as (
    select ht.* from public.hotel_temporadas ht
    where ht.hotel_id = v.hotel_id and btrim(ht.nombre) in (select btrim(coalesce(temporada, '')) from promo_filas))
  select jsonb_build_object(
    'vigencia', jsonb_build_object('id', v.id, 'nombre', v.nombre, 'hotel_id', v.hotel_id, 'tipo', coalesce(v.tipo, 'tarifa'),
                  'prioridad', v.prioridad, 'fecha_inicio', v.fecha_inicio, 'fecha_fin', v.fecha_fin,
                  'nombre_repetido', exists (select 1 from public.hotel_temporadas o
                                             where o.hotel_id = v.hotel_id and o.id <> v.id and btrim(o.nombre) = btrim(v.nombre))),
    'hotel', (select jsonb_build_object('id', h.id, 'modelo_tarifario', h.modelo_tarifario) from public.hoteles h where h.id = v.hotel_id),
    'categorias', coalesce((select jsonb_agg(c.nombre order by c.nombre) from public.hotel_categorias hc
                            join public.categorias_habitacion c on c.id = hc.categoria_id where hc.hotel_id = v.hotel_id), '[]'),
    'regimenes', coalesce((select jsonb_agg(pa.codigo order by pa.codigo) from public.hotel_regimenes hr
                           join public.planes_alimentacion pa on pa.id = hr.plan_id where hr.hotel_id = v.hotel_id), '[]'),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'dias', g.dias, 'activo', g.activo)
                                         order by g.dias[1], g.id) from grupos g), '[]'),
    'propuestas', coalesce((select jsonb_agg((to_jsonb(p) - 'confirmado_por') order by p.id) from props p), '[]'),
    'origen', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'tipo_habitacion', t.tipo_habitacion, 'alimentacion', t.alimentacion,
        'neto_sencilla', t.neto_sencilla, 'neto_doble', t.neto_doble, 'neto_triple', t.neto_triple, 'neto_multiple', t.neto_multiple,
        'neto_nino', t.neto_nino, 'neto_nino2', t.neto_nino2, 'neto_infante', t.neto_infante, 'nota_infante', t.nota_infante, 'notas', t.notas,
        'edad_infante_min', t.edad_infante_min, 'edad_infante_max', t.edad_infante_max, 'edad_nino_min', t.edad_nino_min, 'edad_nino_max', t.edad_nino_max,
        'huella', md5(to_jsonb(t)::text)) order by t.id) from origen t), '[]'),
    'promociones', coalesce((select jsonb_agg(jsonb_build_object('temporada', x.temporada, 'filas', x.n) order by x.temporada)
                             from (select temporada, count(*) as n from promo_filas group by temporada) x), '[]'),
    'huella', md5(concat_ws('|',
        to_jsonb(v)::text,
        coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from grupos g)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from props p)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from origen t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from promo_filas t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from promo_vigs t)::text, '[]'))))
  into r;
  return r;
end $$;

-- Candados de escritura (orden de la 293) + huella comparada dentro de la transacción.
create or replace function public._grupos_43_bloquear_y_comparar(p_temporada_id bigint, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel bigint;
  v_nombre text;
  v_modelo text;
  r jsonb;
begin
  perform 1 from public.hotel_temporada_grupos g where g.temporada_id = p_temporada_id order by g.id for update;
  select t.hotel_id, btrim(t.nombre) into v_hotel, v_nombre from public.hotel_temporadas t where t.id = p_temporada_id for update;
  if not found then
    raise exception 'La vigencia % no existe.', p_temporada_id using errcode = 'P0002';
  end if;
  -- Tarifas de origen («todos los días» de la vigencia) y filas de las promociones vinculadas: se
  -- bloquean en modo compartido ANTES del candado del hotel. Un cambio en curso en cualquiera de ellas
  -- (también un cambio de solo precio, que no pasa por el trigger de la 293) se espera y luego se lee
  -- confirmado; mientras dure esta transacción nadie las cambia.
  perform 1 from public.tarifa_hotel t
   where t.hotel_id = v_hotel
     and ((t.grupo_id is null and btrim(coalesce(t.temporada, '')) = v_nombre) or btrim(coalesce(t.temporada_base, '')) = v_nombre)
   order by t.id for share;
  -- Vigencias de esas promociones: también quietas hasta confirmar.
  perform 1 from public.hotel_temporadas ht
   where ht.hotel_id = v_hotel and ht.id <> p_temporada_id
     and btrim(ht.nombre) in (select btrim(coalesce(t.temporada, '')) from public.tarifa_hotel t
                              where t.hotel_id = v_hotel and btrim(coalesce(t.temporada_base, '')) = v_nombre)
   order by ht.id for share;
  -- Exclusivo: espera a que terminen las altas/cambios de tarifas en curso de este hotel (293 las toma
  -- en modo compartido), así una tarifa de origen NUEVA tampoco se cuela entre la lectura y la escritura.
  perform public.t43_60_candado_hotel(v_hotel, true);
  select h.modelo_tarifario into v_modelo from public.hoteles h where h.id = v_hotel for share;
  if v_modelo = 'unidad' then
    raise exception 'Los hoteles de modelo por unidad no admiten grupos de días.' using errcode = '23514';
  end if;
  r := public._grupos_43_config(p_temporada_id);
  if p_huella is null or r->>'huella' is distinct from p_huella then
    raise exception 'CONFIG_DESACTUALIZADA: la configuración de esta vigencia cambió desde que la abriste. Recarga y revisa de nuevo antes de confirmar.'
      using errcode = 'PT409';
  end if;
  return r;
end $$;

-- 4) RPC ---------------------------------------------------------------------------
create or replace function public.grupos_dias_config(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._grupos_43_autorizar(false);
  return public._grupos_43_config(p_temporada_id);
end $$;

-- Alta y edición de grupos (el borrado va por grupos_dias_borrar, con su propia vista previa).
create or replace function public.grupos_dias_guardar(p_temporada_id bigint, p_huella text, p_grupos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  v_id uuid;
  v_dias smallint[];
  v_viejos smallint[];
  n_alta int := 0; n_cambio int := 0;
  pasada int;
begin
  perform public._grupos_43_autorizar(true);
  if jsonb_typeof(p_grupos) is distinct from 'array' then
    raise exception 'p_grupos debe ser un arreglo.' using errcode = '22023';
  end if;
  perform public._grupos_43_bloquear_y_comparar(p_temporada_id, p_huella);
  -- Tres pasadas para que un cambio que libera días no choque con otro que los toma:
  -- 1) cambios que solo QUITAN días, 2) el resto de cambios, 3) altas. (Intercambiar días entre dos
  -- grupos existentes en un solo guardado no es posible: se hace en dos pasos.)
  for pasada in 1..3 loop
    for e in select x from jsonb_array_elements(p_grupos) x loop
      select coalesce(array_agg(d::smallint), '{}') into v_dias from jsonb_array_elements_text(e->'dias') d;
      if e->>'id' is not null then
        v_id := (e->>'id')::uuid;
        select dias into v_viejos from public.hotel_temporada_grupos where id = v_id and temporada_id = p_temporada_id;
        if not found then
          raise exception 'El grupo % no pertenece a esta vigencia.', v_id using errcode = '23514';
        end if;
        if (pasada = 1 and v_dias <@ v_viejos) or (pasada = 2 and not v_dias <@ v_viejos) then
          update public.hotel_temporada_grupos set nombre = e->>'nombre', dias = v_dias where id = v_id;
          n_cambio := n_cambio + 1;
        end if;
      elsif pasada = 3 then
        insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (p_temporada_id, e->>'nombre', v_dias);
        n_alta := n_alta + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'config', public._grupos_43_config(p_temporada_id));
end $$;

-- Propuesta de tarifas. p_modo: 'actualizar' (solo las combinaciones que trae; una fila sin netos
-- quita esa combinación), 'reemplazar_grupo' (sustituye las de p_grupo_id) o 'reemplazar_vigencia'.
create or replace function public.grupos_dias_guardar_propuesta(
  p_temporada_id bigint, p_huella text, p_modo text, p_grupo_id uuid, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb;
  f jsonb;
  v_hotel bigint;
  v_nombre text;
  v_grupo uuid;
  v_cat text; v_reg text;
  v_origen public.tarifa_hotel;
  v_sin_netos boolean;
  n_ins int := 0; n_act int := 0; n_del int := 0; n_borradas int := 0;
  v_existia boolean;
begin
  perform public._grupos_43_autorizar(true);
  if p_modo not in ('actualizar', 'reemplazar_grupo', 'reemplazar_vigencia') then
    raise exception 'Modo no válido: %.', p_modo using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'p_filas debe ser un arreglo.' using errcode = '22023';
  end if;
  cfg := public._grupos_43_bloquear_y_comparar(p_temporada_id, p_huella);
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  v_nombre := btrim(cfg->'vigencia'->>'nombre');
  if p_modo = 'reemplazar_grupo' and not exists (
       select 1 from public.hotel_temporada_grupos where id = p_grupo_id and temporada_id = p_temporada_id) then
    raise exception 'El grupo indicado no pertenece a esta vigencia.' using errcode = '23514';
  end if;
  -- Combinaciones repetidas dentro del lote: error (nunca «la última gana» en una propuesta).
  if exists (select 1 from jsonb_array_elements(p_filas) x
             group by x->>'grupo_id', btrim(x->>'tipo_habitacion'), btrim(x->>'alimentacion') having count(*) > 1) then
    raise exception 'El lote repite una combinación de grupo, categoría y régimen.' using errcode = '23505';
  end if;

  if p_modo = 'reemplazar_grupo' then
    delete from public.hotel_grupo_tarifa_propuesta where grupo_id = p_grupo_id;
    get diagnostics n_borradas = row_count;
  elsif p_modo = 'reemplazar_vigencia' then
    delete from public.hotel_grupo_tarifa_propuesta p using public.hotel_temporada_grupos g
     where g.id = p.grupo_id and g.temporada_id = p_temporada_id;
    get diagnostics n_borradas = row_count;
  end if;

  for f in select x from jsonb_array_elements(p_filas) x loop
    v_grupo := (f->>'grupo_id')::uuid;
    v_cat := btrim(coalesce(f->>'tipo_habitacion', ''));
    v_reg := btrim(coalesce(f->>'alimentacion', ''));
    if not exists (select 1 from public.hotel_temporada_grupos where id = v_grupo and temporada_id = p_temporada_id) then
      raise exception 'El grupo % no pertenece a esta vigencia.', v_grupo using errcode = '23514';
    end if;
    if p_modo = 'reemplazar_grupo' and v_grupo <> p_grupo_id then
      raise exception 'Reemplazar un grupo solo admite filas de ese grupo.' using errcode = '23514';
    end if;
    if not (cfg->'categorias') ? v_cat then
      raise exception 'La categoría "%" no está configurada en el hotel.', v_cat using errcode = '23514';
    end if;
    if not (cfg->'regimenes') ? v_reg then
      raise exception 'El régimen "%" no está configurado en el hotel.', v_reg using errcode = '23514';
    end if;
    -- Campos: OMITIDO = se conserva lo guardado (o null en una fila nueva); presente con null = BORRADO
    -- intencional. Quitar una combinación exige los siete netos presentes y en null (en 'actualizar');
    -- en un reemplazo esa fila es un error (la ausencia ya significa que no se vende).
    if p_modo <> 'actualizar' and (select bool_and(f->k is null or jsonb_typeof(f->k) = 'null')
         from unnest(array['neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante']) k) then
      raise exception 'Una fila sin ningún neto no se guarda (la ausencia ya significa que no se vende).' using errcode = '23514';
    end if;
    v_sin_netos := (select bool_and(f ? k and jsonb_typeof(f->k) = 'null')
                      from unnest(array['neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante']) k);
    if v_sin_netos then
      delete from public.hotel_grupo_tarifa_propuesta where grupo_id = v_grupo and tipo_habitacion = v_cat and alimentacion = v_reg;
      get diagnostics n_borradas = row_count;
      n_del := n_del + n_borradas;
      continue;
    end if;
    -- Sugerencia aceptada: la fila de origen debe ser la tarifa «todos los días» de esta vigencia y combinación.
    v_origen := null;
    if f ? 'origen_tarifa_id' and jsonb_typeof(f->'origen_tarifa_id') = 'number' then
      select * into v_origen from public.tarifa_hotel t
       where t.id = (f->>'origen_tarifa_id')::bigint and t.hotel_id = v_hotel and t.grupo_id is null
         and btrim(coalesce(t.temporada, '')) = v_nombre
         and btrim(coalesce(t.tipo_habitacion, '')) = v_cat and btrim(coalesce(t.alimentacion, '')) = v_reg;
      if not found then
        raise exception 'La sugerencia aceptada no corresponde a una tarifa de esta vigencia y combinación.' using errcode = '23514';
      end if;
    end if;
    select true into v_existia from public.hotel_grupo_tarifa_propuesta
     where grupo_id = v_grupo and tipo_habitacion = v_cat and alimentacion = v_reg;
    -- Fila existente: UPDATE que solo cambia los campos PRESENTES en el JSON (omitido = se conserva). Las
    -- restricciones se evalúan sobre la fila fusionada. Sin fila: INSERT (omitido = null). Los candados
    -- tomados arriba (vigencia + candado del hotel) impiden que otra transacción inserte la misma clave.
    if coalesce(v_existia, false) then
      update public.hotel_grupo_tarifa_propuesta p set
        neto_sencilla = case when f ? 'neto_sencilla' then (f->>'neto_sencilla')::numeric else p.neto_sencilla end,
        neto_doble = case when f ? 'neto_doble' then (f->>'neto_doble')::numeric else p.neto_doble end,
        neto_triple = case when f ? 'neto_triple' then (f->>'neto_triple')::numeric else p.neto_triple end,
        neto_multiple = case when f ? 'neto_multiple' then (f->>'neto_multiple')::numeric else p.neto_multiple end,
        neto_nino = case when f ? 'neto_nino' then (f->>'neto_nino')::numeric else p.neto_nino end,
        neto_nino2 = case when f ? 'neto_nino2' then (f->>'neto_nino2')::numeric else p.neto_nino2 end,
        neto_infante = case when f ? 'neto_infante' then (f->>'neto_infante')::numeric else p.neto_infante end,
        nota_infante = case when f ? 'nota_infante' then nullif(btrim(f->>'nota_infante'), '') else p.nota_infante end,
        notas = case when f ? 'notas' then nullif(btrim(f->>'notas'), '') else p.notas end,
        edad_infante_min = case when f ? 'edad_infante_min' then (f->>'edad_infante_min')::integer else p.edad_infante_min end,
        edad_infante_max = case when f ? 'edad_infante_max' then (f->>'edad_infante_max')::integer else p.edad_infante_max end,
        edad_nino_min = case when f ? 'edad_nino_min' then (f->>'edad_nino_min')::integer else p.edad_nino_min end,
        edad_nino_max = case when f ? 'edad_nino_max' then (f->>'edad_nino_max')::integer else p.edad_nino_max end,
        origen_tarifa_id = case when f ? 'origen_tarifa_id' then v_origen.id else p.origen_tarifa_id end,
        origen_huella = case when f ? 'origen_tarifa_id' then (case when v_origen.id is null then null else md5(to_jsonb(v_origen)::text) end) else p.origen_huella end,
        confirmado_por = auth.uid(), confirmado_en = now()
       where p.grupo_id = v_grupo and p.tipo_habitacion = v_cat and p.alimentacion = v_reg;
    else
      insert into public.hotel_grupo_tarifa_propuesta (
        grupo_id, tipo_habitacion, alimentacion, neto_sencilla, neto_doble, neto_triple, neto_multiple,
        neto_nino, neto_nino2, neto_infante, nota_infante, notas,
        edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max,
        origen_tarifa_id, origen_huella, confirmado_por, confirmado_en)
      values (
        v_grupo, v_cat, v_reg,
        (f->>'neto_sencilla')::numeric, (f->>'neto_doble')::numeric, (f->>'neto_triple')::numeric, (f->>'neto_multiple')::numeric,
        (f->>'neto_nino')::numeric, (f->>'neto_nino2')::numeric, (f->>'neto_infante')::numeric,
        nullif(btrim(f->>'nota_infante'), ''), nullif(btrim(f->>'notas'), ''),
        (f->>'edad_infante_min')::integer, (f->>'edad_infante_max')::integer, (f->>'edad_nino_min')::integer, (f->>'edad_nino_max')::integer,
        v_origen.id, case when v_origen.id is null then null else md5(to_jsonb(v_origen)::text) end, auth.uid(), now());
    end if;
    if coalesce(v_existia, false) then n_act := n_act + 1; else n_ins := n_ins + 1; end if;
    v_existia := null;
  end loop;

  return jsonb_build_object(
    'modo', p_modo, 'nuevas', n_ins, 'actualizadas', n_act,
    'eliminadas', case when p_modo = 'actualizar' then n_del else n_borradas end,
    'config', public._grupos_43_config(p_temporada_id));
end $$;

-- Borrar un grupo preparado: elimina el grupo y ÚNICAMENTE sus propuestas. No toca promociones,
-- tarifas vigentes ni otra configuración comercial.
create or replace function public.grupos_dias_borrar(p_grupo_id uuid, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_temporada bigint;
  v_props int;
begin
  perform public._grupos_43_autorizar(true);
  select temporada_id into v_temporada from public.hotel_temporada_grupos where id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  perform public._grupos_43_bloquear_y_comparar(v_temporada, p_huella);
  delete from public.hotel_grupo_tarifa_propuesta where grupo_id = p_grupo_id;
  get diagnostics v_props = row_count;
  delete from public.hotel_temporada_grupos where id = p_grupo_id;
  return jsonb_build_object('propuestas_eliminadas', v_props, 'config', public._grupos_43_config(v_temporada));
end $$;

-- 5) Permisos de las funciones -----------------------------------------------------
revoke all on function public._grupos_43_autorizar(boolean) from public, anon, authenticated;
revoke all on function public._grupos_43_config(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_bloquear_y_comparar(bigint, text) from public, anon, authenticated;
revoke all on function public.tg_hotel_temporada_grupos_tipo_43() from public, anon, authenticated;
revoke all on function public.tg_hotel_temporadas_tipo_grupos_43() from public, anon, authenticated;
revoke all on function public.grupos_dias_config(bigint) from public, anon;
revoke all on function public.grupos_dias_guardar(bigint, text, jsonb) from public, anon;
revoke all on function public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb) from public, anon;
revoke all on function public.grupos_dias_borrar(uuid, text) from public, anon;
grant execute on function public.grupos_dias_config(bigint) to authenticated;
grant execute on function public.grupos_dias_guardar(bigint, text, jsonb) to authenticated;
grant execute on function public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb) to authenticated;
grant execute on function public.grupos_dias_borrar(uuid, text) to authenticated;

commit;
