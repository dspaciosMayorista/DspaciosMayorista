-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 212 (número reservado por Coordinación para el hotfix #51).
-- Independiente de la 211 (cotizaciones comparativas #35): no la requiere ni la
-- toca; pueden aplicarse en cualquier orden.
--
-- programa_ciudades.alojamiento_previsto: texto libre OPCIONAL por ciudad de la
-- ruta de un programa (hotel, categoría o "similar"). Es una referencia
-- informativa para el cliente: NO es FK al catálogo de hoteles, NO es un hotel
-- confirmado y NO interviene en precios ni salidas.
--
-- ADITIVA e IDEMPOTENTE: una columna nullable sin default (no reescribe la
-- tabla; los programas anteriores quedan en NULL = "sin alojamiento previsto").
--
-- Además crea la RPC reemplazar_ruta_programa(): guardar o reimportar la ruta
-- reemplaza TODAS las ciudades del programa en UNA transacción (antes la app
-- hacía DELETE y luego INSERT por separado: un INSERT fallido o un DELETE
-- denegado dejaba la ruta vacía o mezclada y perdía los alojamientos). La RPC:
--   · es SECURITY INVOKER: manda la RLS de siempre (escritura interna);
--   · serializa por programa con un lock de transacción (dos sesiones no
--     intercalan su DELETE/INSERT: gana una, la otra parte del resultado);
--   · lee los alojamientos vigentes DENTRO del lock y los reaplica por nombre
--     (sin mayúsculas/tildes/espacios extra) y orden de aparición cuando el
--     elemento NO trae la clave alojamiento_previsto (reimportación);
--   · si el DELETE borra menos filas de las que veía (RLS filtra en silencio)
--     aborta: nunca deja la ruta a medias.
-- No toca precios, salidas ni programa_categoria_hoteles.
--
-- La app nueva exige columna y RPC: aplicar el SQL ANTES de desplegar el código.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

alter table public.programa_ciudades
  add column if not exists alojamiento_previsto text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.programa_ciudades'::regclass
      and conname = 'programa_ciudades_alojamiento_previsto_len'
  ) then
    alter table public.programa_ciudades
      add constraint programa_ciudades_alojamiento_previsto_len
      check (alojamiento_previsto is null or char_length(alojamiento_previsto) <= 200);
  end if;
end $$;

comment on column public.programa_ciudades.alojamiento_previsto is
  'Texto libre opcional (hotel, categoría o "similar") mostrado como alojamiento previsto. Informativo: no es FK, no afecta precios.';

create or replace function public.clave_ciudad_ruta(p_nombre text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $f$
  select lower(translate(btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')),
         'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))
$f$;

create or replace function public.reemplazar_ruta_programa(p_programa_id bigint, p_ciudades jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $f$
declare
  v_previas integer;
  v_borradas integer;
  v_filas jsonb;
  v_insertadas integer;
begin
  if p_programa_id is null then
    raise exception 'programa requerido' using errcode = '22023';
  end if;
  if p_ciudades is null or jsonb_typeof(p_ciudades) <> 'array' then
    raise exception 'p_ciudades debe ser un arreglo JSON' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_ciudades) e
              where jsonb_typeof(e) <> 'object' or btrim(coalesce(e->>'nombre', '')) = ''
                 or coalesce((e->>'noches')::int, 0) < 0) then
    raise exception 'cada ciudad requiere nombre y noches >= 0' using errcode = '22023';
  end if;

  -- Serializa el reemplazo por programa hasta el COMMIT/ROLLBACK.
  perform pg_advisory_xact_lock(hashtextextended('programa_ruta:' || p_programa_id, 212));

  if not exists (select 1 from public.programas where id = p_programa_id) then
    raise exception 'programa % no existe o no es visible', p_programa_id using errcode = 'P0002';
  end if;

  select count(*) into v_previas from public.programa_ciudades where programa_id = p_programa_id;

  -- Filas finales, calculadas ANTES de borrar y con las previas leídas bajo el lock.
  with previas as (
    select public.clave_ciudad_ruta(nombre) k, alojamiento_previsto aloj,
           row_number() over (partition by public.clave_ciudad_ruta(nombre) order by orden, id) n
      from public.programa_ciudades where programa_id = p_programa_id
  ), nuevas as (
    select e, ord, public.clave_ciudad_ruta(e->>'nombre') k,
           row_number() over (partition by public.clave_ciudad_ruta(e->>'nombre') order by ord) n
      from jsonb_array_elements(p_ciudades) with ordinality t(e, ord)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'orden', nu.ord - 1,
           'nombre', btrim(nu.e->>'nombre'),
           'codigo_iata', nullif(btrim(coalesce(nu.e->>'codigo_iata', '')), ''),
           'noches', coalesce((nu.e->>'noches')::int, 0),
           'alojamiento_previsto',
             case when nu.e ? 'alojamiento_previsto'
                  then nullif(btrim(coalesce(nu.e->>'alojamiento_previsto', '')), '')
                  else pr.aloj end
         ) order by nu.ord), '[]'::jsonb)
    into v_filas
    from nuevas nu
    left join previas pr on pr.k = nu.k and pr.n = nu.n;

  delete from public.programa_ciudades where programa_id = p_programa_id;
  get diagnostics v_borradas = row_count;
  if v_borradas <> v_previas then
    raise exception 'sin permiso para reemplazar la ruta del programa % (se veían % ciudades y se pudieron borrar %)',
      p_programa_id, v_previas, v_borradas using errcode = '42501';
  end if;

  insert into public.programa_ciudades (programa_id, orden, nombre, codigo_iata, noches, alojamiento_previsto)
  select p_programa_id, (f->>'orden')::int, f->>'nombre', f->>'codigo_iata', (f->>'noches')::int, f->>'alojamiento_previsto'
    from jsonb_array_elements(v_filas) f
   order by (f->>'orden')::int;
  get diagnostics v_insertadas = row_count;
  return v_insertadas;
end
$f$;

revoke all on function public.reemplazar_ruta_programa(bigint, jsonb) from public, anon;
grant execute on function public.reemplazar_ruta_programa(bigint, jsonb) to authenticated, service_role;

commit;
