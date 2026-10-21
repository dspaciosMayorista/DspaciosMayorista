-- ─────────────────────────────────────────────────────────────────────────
-- 220 · PAQUETES — destinos aéreos alternativos (#67), Bloqueo/Sistema
--
-- PROBLEMA. El editor de un paquete de Bloqueo solo ofrecía los vuelos cuyo
-- `destino_id` fuera EXACTAMENTE el destino comercial del paquete: un hotel de
-- Juan Dolio no podía vender un vuelo que llega a Santo Domingo (SDQ) o a Punta
-- Cana (PUJ). Y ese filtro vivía solo en la pantalla: `setVuelo`/`setEmpaquetado`
-- hacían upsert por ID sin validar nada.
--
-- REGLA (única; la repiten el servidor y esta migración):
--   · check APAGADO  → destino comercial EXACTO (el filtro de siempre).
--   · check ENCENDIDO → destino comercial + alternativas elegidas que sigan siendo
--     válidas: existen, están activas y tienen el MISMO país que el destino
--     comercial. País comparable = sin espacios de más, sin mayúsculas ni tildes
--     (`pais_comparable_67`); SIN alias ("RD" no es "República Dominicana").
--   · Sin destino comercial no hay respaldo "todos los vuelos".
--   · País ausente o no comparable NO autoriza alternativas.
--   · El IATA es solo una etiqueta; los destinos se identifican por ID.
--   · Hotel, destino público y servicios conservan su alcance; no hay traslados.
--
-- QUÉ AGREGA (todo ADITIVO; no se edita ninguna migración anterior):
--   A. `armado_paquetes.destinos_aereos_alternativos` (check por paquete).
--   B. `armado_paquete_destinos_aereos` (paquete_id, destino_id): SOLO las
--      alternativas elegidas; el comercial nunca se guarda ahí. Sin FK a
--      destinos (ver el comentario de la tabla): borrar o fusionar un destino
--      NO se bloquea por ser alternativa; el id huérfano se ignora al leer.
--   C. `pais_comparable_67` y `destinos_aereos_efectivos_67` (reglas puras).
--   D. Guardas de INTEGRIDAD con triggers de restricción DIFERIDOS (se evalúan
--      al CONFIRMAR, sobre el estado final de la transacción):
--        · vincular un vuelo (armado_vuelos / armado_empaquetados) exige que su
--          destino esté entre los efectivos del paquete — también por lote;
--        · guardar la configuración exige alternativas válidas del mismo país,
--          al menos una si el check está encendido, y que NINGÚN vuelo ya
--          vinculado quede incompatible (hay que desvincularlo explícitamente:
--          jamás se borra en silencio).
--      Cada validación toma el candado del paquete (`FOR NO KEY UPDATE`), así
--      que una configuración y una vinculación concurrentes se serializan y
--      ninguna salta la guarda de la otra.
--   E. Invalidación del tarifario (extensión de la revisión de la 181, NO
--      bloqueante) cuando cambia el check, las alternativas, el destino de una
--      fuente aérea o el país/estado de un destino. Las filas ya publicadas se
--      siguen ocultando EN LECTURA por la regla viva; esto solo deja registrada
--      la revisión nueva.
--   F. `guardar_destinos_aereos_67`: guarda destino + check + alternativas en
--      UNA transacción (SECURITY INVOKER, candado de rol interno).
--
-- QUÉ NO HACE. No reasigna aeropuertos de cotizaciones ni toca contratos ya
-- emitidos; no valida vuelos ya vinculados al aplicar la migración (los datos
-- antiguos incoherentes se reportan en preflight_220 y se corrigen a mano); no
-- crea vínculos de promociones de Dinámico (eso es #63, que consumirá esta misma
-- configuración).
--
-- PRUEBAS: supabase/scripts/test_220_*.  ROLLBACK: rollback_220_*.sql (se
-- NIEGA si hay configuración en uso por paquetes con ventas o cotizaciones).
-- ─────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if to_regclass('public.armado_paquetes') is null or to_regclass('public.armado_vuelos') is null
     or to_regclass('public.armado_empaquetados') is null or to_regclass('public.bloqueos_vuelo') is null
     or to_regclass('public.empaquetados') is null or to_regclass('public.destinos') is null then
    raise exception '220 ABORTADA: faltan tablas base del armado/tarifario (018, 156, 004).';
  end if;
  if to_regprocedure('public.tarifario_invalidar(bigint[], boolean)') is null then
    raise exception '220 ABORTADA: falta public.tarifario_invalidar (181).';
  end if;
  if to_regprocedure('public.mi_rol()') is null then
    raise exception '220 ABORTADA: falta public.mi_rol().';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'destinos' and column_name = 'pais') then
    raise exception '220 ABORTADA: destinos.pais no existe (050).';
  end if;
end $$;

-- ── A. Check por paquete ──────────────────────────────────────────────────
alter table public.armado_paquetes
  add column if not exists destinos_aereos_alternativos boolean not null default false;

comment on column public.armado_paquetes.destinos_aereos_alternativos is
  'Migración 220 (#67). false = los vuelos del paquete llegan SOLO al destino comercial (destino_id); true = también a las alternativas de armado_paquete_destinos_aereos (activas y del mismo país).';

-- ── B. Alternativas elegidas ──────────────────────────────────────────────
create table if not exists public.armado_paquete_destinos_aereos (
  paquete_id bigint not null references public.armado_paquetes(id) on delete cascade,
  -- SIN llave foránea a destinos(id), a propósito: una FK nueva obligaría a tocar el modal de
  -- eliminación de destinos (lib/producto/usoDestino.ts) y a `fn_fusionar_destino` (112), que re-apunta
  -- toda FK a destinos y chocaría con la PK de esta tabla. La integridad la dan las guardas diferidas
  -- (la alternativa debe existir, estar activa y ser del mismo país) y los lectores ignoran cualquier id
  -- que ya no exista; un id huérfano se limpia al volver a guardar la configuración.
  destino_id bigint not null,
  creado_en  timestamptz not null default now(),
  primary key (paquete_id, destino_id)
);

create index if not exists idx_armado_paquete_destinos_aereos_destino
  on public.armado_paquete_destinos_aereos (destino_id);

comment on table public.armado_paquete_destinos_aereos is
  'Migración 220 (#67). Destinos de llegada ALTERNATIVOS de un paquete de Bloqueo/Sistema. Solo cuenta con armado_paquetes.destinos_aereos_alternativos = true. El destino comercial NO se guarda aquí. Sin vuelos ni hoteles duplicados.';

alter table public.armado_paquete_destinos_aereos enable row level security;

-- El armado es interno (operación/administración/gerencia arma; el asesor no): misma política que armado_vuelos.
drop policy if exists "armado_paquete_destinos_aereos: interno" on public.armado_paquete_destinos_aereos;
create policy "armado_paquete_destinos_aereos: interno" on public.armado_paquete_destinos_aereos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

revoke all on table public.armado_paquete_destinos_aereos from anon, public;
grant select, insert, update, delete on table public.armado_paquete_destinos_aereos to authenticated, service_role;

-- ── C. Reglas puras ───────────────────────────────────────────────────────
-- País comparable. Idéntico a normalizarPais() de lib/paquetes/destinosAereos67.ts:
-- espacios compactados y recortados, tildes/ñ/ç quitadas y minúsculas SOLO
-- ASCII (translate, no lower(): `lower()` depende del locale de la base).
create or replace function public.pais_comparable_67(p_pais text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    translate(
      btrim(regexp_replace(coalesce(p_pais, ''), '\s+', ' ', 'g')),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõúùüûñç',
      'abcdefghijklmnopqrstuvwxyzaaaaaaeeeeiiiiooooouuuunc' || 'aaaaaaeeeeiiiiooooouuuunc'
    ),
    ''
  );
$$;

comment on function public.pais_comparable_67(text) is
  'Migración 220 (#67). País comparable: sin espacios de más, mayúsculas ni tildes; NULL si está vacío. Sin alias.';

-- Destinos de llegada aceptados para (destino comercial, check, alternativas).
create or replace function public.destinos_aereos_efectivos_67(
  p_destino_id    bigint,
  p_alternativos  boolean,
  p_alternativas  bigint[]
)
returns bigint[]
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_pais text;
  v_alts bigint[];
begin
  if p_destino_id is null then
    return '{}'::bigint[];          -- sin destino comercial: nada, nunca "todos"
  end if;
  if not coalesce(p_alternativos, false) then
    return array[p_destino_id];     -- check apagado: destino comercial exacto
  end if;
  select public.pais_comparable_67(d.pais) into v_pais from public.destinos d where d.id = p_destino_id;
  if v_pais is null then
    return array[p_destino_id];     -- país ausente: las alternativas no autorizan nada
  end if;
  select coalesce(array_agg(d.id order by d.id), '{}'::bigint[]) into v_alts
    from public.destinos d
   where d.id = any (coalesce(p_alternativas, '{}'::bigint[]))
     and d.id <> p_destino_id
     and coalesce(d.activo, false)
     and public.pais_comparable_67(d.pais) = v_pais;
  return array[p_destino_id] || v_alts;
end;
$$;

comment on function public.destinos_aereos_efectivos_67(bigint, boolean, bigint[]) is
  'Migración 220 (#67). Destinos de llegada aceptados: sin comercial = {}; check apagado = {comercial}; encendido = comercial + alternativas activas del mismo país comparable.';

-- ── D1. Guarda de un vínculo (vuelo negociado o empaquetado) ───────────────
create or replace function public.validar_vinculo_aereo_67(p_paquete_id bigint, p_tipo text, p_fuente_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destino  bigint;
  v_check    boolean;
  v_alts     bigint[];
  v_ef       bigint[];
  v_fuente   bigint;
  v_record   text;
  v_ruta     text;
  v_existe   boolean;
begin
  -- Candado del paquete: serializa esta vinculación con cualquier cambio de configuración.
  select p.destino_id, p.destinos_aereos_alternativos into v_destino, v_check
    from public.armado_paquetes p where p.id = p_paquete_id for no key update;
  if not found then
    raise exception 'destino_aereo_config: el paquete % no existe', p_paquete_id;
  end if;
  select coalesce(array_agg(a.destino_id), '{}'::bigint[]) into v_alts
    from public.armado_paquete_destinos_aereos a where a.paquete_id = p_paquete_id;
  v_ef := public.destinos_aereos_efectivos_67(v_destino, v_check, v_alts);

  if p_tipo = 'bloqueo' then
    select true, b.destino_id, b.record, b.ruta into v_existe, v_fuente, v_record, v_ruta from public.bloqueos_vuelo b where b.id = p_fuente_id;
  else
    select true, e.destino_id, e.record, e.ruta into v_existe, v_fuente, v_record, v_ruta from public.empaquetados e where e.id = p_fuente_id;
  end if;
  if not coalesce(v_existe, false) then
    raise exception 'destino_aereo_no_permitido: la fuente % (%) no existe', p_fuente_id, p_tipo;
  end if;
  if v_fuente is null or not (v_fuente = any (v_ef)) then
    raise exception 'destino_aereo_no_permitido: % % (#%) llega a un destino que no está permitido para el paquete %',
      p_tipo, coalesce(v_record, coalesce(v_ruta, 'sin record')), p_fuente_id, p_paquete_id;
  end if;
end;
$$;

create or replace function public.trg_vinculo_aereo_67()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_TABLE_NAME = 'armado_vuelos' then
    -- Si el vínculo ya no existe al confirmar (alta y baja en la misma transacción), no hay nada que validar.
    if exists (select 1 from public.armado_vuelos v where v.paquete_id = NEW.paquete_id and v.bloqueo_id = NEW.bloqueo_id) then
      perform public.validar_vinculo_aereo_67(NEW.paquete_id, 'bloqueo', NEW.bloqueo_id);
    end if;
  else
    if exists (select 1 from public.armado_empaquetados v where v.paquete_id = NEW.paquete_id and v.empaquetado_id = NEW.empaquetado_id) then
      perform public.validar_vinculo_aereo_67(NEW.paquete_id, 'empaquetado', NEW.empaquetado_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_vinculo_aereo_67 on public.armado_vuelos;
create constraint trigger tr_vinculo_aereo_67
  after insert or update of paquete_id, bloqueo_id on public.armado_vuelos
  deferrable initially deferred
  for each row execute function public.trg_vinculo_aereo_67();

drop trigger if exists tr_vinculo_aereo_67 on public.armado_empaquetados;
create constraint trigger tr_vinculo_aereo_67
  after insert or update of paquete_id, empaquetado_id on public.armado_empaquetados
  deferrable initially deferred
  for each row execute function public.trg_vinculo_aereo_67();

-- ── D2. Guarda de la configuración del paquete ─────────────────────────────
create or replace function public.validar_config_destinos_aereos_67(p_paquete_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destino  bigint;
  v_check    boolean;
  v_alts     bigint[];
  v_pais     text;
  v_malas    text;
  v_ef       bigint[];
  v_lista    text;
  v_n        int;
begin
  select p.destino_id, p.destinos_aereos_alternativos into v_destino, v_check
    from public.armado_paquetes p where p.id = p_paquete_id for no key update;
  if not found then
    return;                                   -- el paquete se eliminó en esta transacción
  end if;
  select array_agg(a.destino_id order by a.destino_id) into v_alts
    from public.armado_paquete_destinos_aereos a where a.paquete_id = p_paquete_id;

  -- 1. Las alternativas guardadas deben ser válidas (estricto, aunque el check esté apagado).
  if v_alts is not null then
    if v_destino is null then
      raise exception 'destino_aereo_config: hay destinos alternativos pero el paquete no tiene destino comercial';
    end if;
    select public.pais_comparable_67(d.pais) into v_pais from public.destinos d where d.id = v_destino;
    if v_pais is null then
      raise exception 'destino_aereo_config: el destino comercial no tiene país registrado; sin país comparable no se admiten destinos alternativos';
    end if;
    select string_agg(coalesce(d.nombre, 'destino #' || a.id::text), ', ' order by a.id) into v_malas
      from unnest(v_alts) as a(id)
      left join public.destinos d on d.id = a.id
     where d.id is null
        or a.id = v_destino
        or not coalesce(d.activo, false)
        or public.pais_comparable_67(d.pais) is distinct from v_pais;
    if v_malas is not null then
      raise exception 'destino_aereo_config: alternativas no válidas (deben ser destinos activos del mismo país que el comercial): %', v_malas;
    end if;
  end if;

  -- 2. Encendido exige destino comercial y al menos una alternativa.
  if v_check then
    if v_destino is null then
      raise exception 'destino_aereo_config: no se puede activar destinos alternativos sin destino comercial';
    end if;
    if coalesce(cardinality(v_alts), 0) = 0 then
      raise exception 'destino_aereo_config: para activar los destinos alternativos elige al menos uno distinto del comercial';
    end if;
  end if;

  -- 3. Ningún vuelo YA vinculado puede quedar fuera de los destinos efectivos.
  v_ef := public.destinos_aereos_efectivos_67(v_destino, v_check, coalesce(v_alts, '{}'::bigint[]));
  with incompatibles as (
    select 'vuelo ' || coalesce(b.record, 'sin record') || coalesce(' ' || b.ruta, '') || ' (#' || b.id || ')' as d
      from public.armado_vuelos av join public.bloqueos_vuelo b on b.id = av.bloqueo_id
     where av.paquete_id = p_paquete_id and (b.destino_id is null or not (b.destino_id = any (v_ef)))
    union all
    select 'vuelo Sistema ' || coalesce(e.record, 'sin record') || coalesce(' ' || e.ruta, '') || ' (#' || e.id || ')'
      from public.armado_empaquetados ae join public.empaquetados e on e.id = ae.empaquetado_id
     where ae.paquete_id = p_paquete_id and (e.destino_id is null or not (e.destino_id = any (v_ef)))
  )
  select count(*), string_agg(d, '; ') into v_n, v_lista from (select d from incompatibles limit 8) x;
  if coalesce(v_n, 0) > 0 then
    raise exception 'destino_aereo_vinculos: hay vuelos vinculados que dejarían de cumplir los destinos aéreos del paquete (desvincúlalos explícitamente): %', v_lista;
  end if;
end;
$$;

create or replace function public.trg_config_paquete_aereo_67()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.validar_config_destinos_aereos_67(coalesce(NEW.id, OLD.id));
  return null;
end;
$$;

create or replace function public.trg_config_alternativa_aerea_67()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.validar_config_destinos_aereos_67(coalesce(NEW.paquete_id, OLD.paquete_id));
  return null;
end;
$$;

drop trigger if exists tr_config_paquete_aereo_67_ins on public.armado_paquetes;
create constraint trigger tr_config_paquete_aereo_67_ins
  after insert on public.armado_paquetes
  deferrable initially deferred
  for each row when (NEW.destinos_aereos_alternativos)
  execute function public.trg_config_paquete_aereo_67();

drop trigger if exists tr_config_paquete_aereo_67_upd on public.armado_paquetes;
create constraint trigger tr_config_paquete_aereo_67_upd
  after update of destino_id, destinos_aereos_alternativos on public.armado_paquetes
  deferrable initially deferred
  for each row
  when (OLD.destino_id is distinct from NEW.destino_id or OLD.destinos_aereos_alternativos is distinct from NEW.destinos_aereos_alternativos)
  execute function public.trg_config_paquete_aereo_67();

drop trigger if exists tr_config_alternativa_aerea_67 on public.armado_paquete_destinos_aereos;
create constraint trigger tr_config_alternativa_aerea_67
  after insert or update or delete on public.armado_paquete_destinos_aereos
  deferrable initially deferred
  for each row execute function public.trg_config_alternativa_aerea_67();

-- ── E. Invalidación del tarifario (revisión 181, NO bloqueante) ────────────
create or replace function public.trg_invalidar_config_aerea_67()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_TABLE_NAME = 'armado_paquetes' then
    perform public.tarifario_invalidar(array[NEW.id], false);
  else
    perform public.tarifario_invalidar(array[coalesce(NEW.paquete_id, OLD.paquete_id)], false);
  end if;
  return null;
end;
$$;

drop trigger if exists tr_inv_check_aereo_67 on public.armado_paquetes;
create trigger tr_inv_check_aereo_67
  after update of destinos_aereos_alternativos on public.armado_paquetes
  for each row when (OLD.destinos_aereos_alternativos is distinct from NEW.destinos_aereos_alternativos)
  execute function public.trg_invalidar_config_aerea_67();

drop trigger if exists tr_inv_alternativas_aereas_67 on public.armado_paquete_destinos_aereos;
create trigger tr_inv_alternativas_aereas_67
  after insert or update or delete on public.armado_paquete_destinos_aereos
  for each row execute function public.trg_invalidar_config_aerea_67();

-- El destino de una fuente aérea o el país/estado de un destino cambian lo que el
-- paquete puede ofrecer. Las filas publicadas se ocultan en lectura por la regla
-- viva; esto deja la revisión registrada (y #63 la consume en su aceptación).
create or replace function public.trg_invalidar_origen_aereo_67()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  if TG_TABLE_NAME = 'bloqueos_vuelo' then
    select array_agg(distinct paquete_id) into v_ids from public.armado_vuelos where bloqueo_id = NEW.id;
  elsif TG_TABLE_NAME = 'empaquetados' then
    select array_agg(distinct paquete_id) into v_ids from public.armado_empaquetados where empaquetado_id = NEW.id;
  else -- destinos
    select array_agg(distinct x.id) into v_ids from (
      select p.id from public.armado_paquetes p where p.destino_id = NEW.id
      union
      select a.paquete_id from public.armado_paquete_destinos_aereos a where a.destino_id = NEW.id
    ) x;
  end if;
  perform public.tarifario_invalidar(v_ids, false);
  return null;
end;
$$;

drop trigger if exists tr_inv_destino_bloqueo_67 on public.bloqueos_vuelo;
create trigger tr_inv_destino_bloqueo_67
  after update of destino_id on public.bloqueos_vuelo
  for each row when (OLD.destino_id is distinct from NEW.destino_id)
  execute function public.trg_invalidar_origen_aereo_67();

drop trigger if exists tr_inv_destino_empaquetado_67 on public.empaquetados;
create trigger tr_inv_destino_empaquetado_67
  after update of destino_id on public.empaquetados
  for each row when (OLD.destino_id is distinct from NEW.destino_id)
  execute function public.trg_invalidar_origen_aereo_67();

drop trigger if exists tr_inv_destino_pais_67 on public.destinos;
create trigger tr_inv_destino_pais_67
  after update of pais, activo on public.destinos
  for each row when (OLD.pais is distinct from NEW.pais or OLD.activo is distinct from NEW.activo)
  execute function public.trg_invalidar_origen_aereo_67();

-- ── F. Guardado atómico de la configuración ────────────────────────────────
create or replace function public.guardar_destinos_aereos_67(
  p_paquete_id bigint,
  p_destino_id bigint,
  p_activo     boolean,
  p_destinos   bigint[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_destinos bigint[];
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'guardar_destinos_aereos_67: rol sin permiso de escritura sobre armado_paquetes';
  end if;

  perform 1 from public.armado_paquetes where id = p_paquete_id for no key update;
  if not found then
    raise exception 'destino_aereo_config: el paquete % no existe o no tienes permiso para editarlo', p_paquete_id;
  end if;

  select coalesce(array_agg(distinct d order by d), '{}'::bigint[]) into v_destinos
    from unnest(coalesce(p_destinos, '{}'::bigint[])) as d
   where d is not null and d is distinct from p_destino_id;

  update public.armado_paquetes
     set destino_id = p_destino_id,
         destinos_aereos_alternativos = coalesce(p_activo, false),
         updated_at = now()
   where id = p_paquete_id;

  delete from public.armado_paquete_destinos_aereos
   where paquete_id = p_paquete_id and destino_id <> all (v_destinos);

  insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id)
  select p_paquete_id, d from unnest(v_destinos) as d
  on conflict do nothing;

  -- Las guardas de la sección D validan el estado FINAL al confirmar la transacción.
  return jsonb_build_object('activo', coalesce(p_activo, false), 'destinos', to_jsonb(v_destinos));
end;
$$;

comment on function public.guardar_destinos_aereos_67(bigint, bigint, boolean, bigint[]) is
  'Migración 220 (#67). Guarda destino comercial + check + alternativas en UNA transacción (SECURITY INVOKER, candado de rol interno). Las guardas diferidas validan el estado final: país comparable, alternativas activas y ningún vuelo vinculado incompatible.';

-- ── G. ACL ────────────────────────────────────────────────────────────────
revoke all on function public.pais_comparable_67(text) from public, anon, authenticated;
revoke all on function public.destinos_aereos_efectivos_67(bigint, boolean, bigint[]) from public, anon, authenticated;
revoke all on function public.validar_vinculo_aereo_67(bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.validar_config_destinos_aereos_67(bigint) from public, anon, authenticated;
revoke all on function public.trg_vinculo_aereo_67() from public, anon, authenticated;
revoke all on function public.trg_config_paquete_aereo_67() from public, anon, authenticated;
revoke all on function public.trg_config_alternativa_aerea_67() from public, anon, authenticated;
revoke all on function public.trg_invalidar_config_aerea_67() from public, anon, authenticated;
revoke all on function public.trg_invalidar_origen_aereo_67() from public, anon, authenticated;

revoke all on function public.guardar_destinos_aereos_67(bigint, bigint, boolean, bigint[]) from public, anon;
grant execute on function public.guardar_destinos_aereos_67(bigint, bigint, boolean, bigint[]) to authenticated, service_role;

-- ── H. Auditoría de la tabla nueva (el bloque DO de la 087 solo adjunta a tablas ya existentes) ──
do $$
begin
  if to_regprocedure('public.fn_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.armado_paquete_destinos_aereos';
    execute 'create trigger trg_auditoria after insert or update or delete on public.armado_paquete_destinos_aereos
             for each row execute function public.fn_auditoria()';
  end if;
end $$;

commit;
