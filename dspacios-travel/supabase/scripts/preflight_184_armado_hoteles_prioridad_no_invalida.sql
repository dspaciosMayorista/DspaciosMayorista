-- Preflight 184 — SOLO LECTURA. Corre ANTES de aplicar la migración 184.
--
-- ⚠️ Devuelve UNA SOLA fila JSON como último (y único) resultado: el editor SQL
-- de Supabase muestra principalmente el ÚLTIMO result set, así que todas las
-- comprobaciones van consolidadas en un `jsonb_build_object` en vez de repartirse
-- en varios SELECT. Si ves el JSON, el script llegó al final.
--
-- Objetivo: confirmar las precondiciones (la 183 aplicada) y dimensionar el
-- efecto — cuántos paquetes están HOY bloqueados por el comportamiento viejo,
-- que ESTA migración NO rehabilita (se recuperan publicando de nuevo).

with
  col as (
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'armado_hoteles' and column_name = 'prioridad'
  ),
  trg as (
    select t.tgname, p.proname as funcion, t.tgenabled, pg_get_triggerdef(t.oid) as definicion
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.armado_hoteles'::regclass and not t.tgisinternal
      and t.tgname = 'tarifario_trg_armado_hoteles'
  ),
  otras as (
    select c.relname as tabla, p.proname as funcion
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and t.tgname like 'tarifario_trg_armado_%'
      and c.relname in ('armado_vuelos', 'armado_servicios', 'armado_empaquetados')
  ),
  volumen as (
    select count(*) as filas, count(prioridad) as con_prioridad, count(distinct paquete_id) as paquetes
    from public.armado_hoteles
  ),
  bloqueados as (
    select id, nombre, tarifario_estado, tarifario_revision_fuente, tarifario_snapshot_publicable
    from public.armado_paquetes
    where tarifario_snapshot_publicable = false
    order by id
  ),
  funcion184 as (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tarifario_trg_bump_armado_hoteles'
  ),
  -- Estado detectado: la 184 ya aplicada (el trigger de armado_hoteles apunta a
  -- su función propia) o todavía pendiente (apunta a la genérica). LAS DOS son
  -- válidas para el preflight — lo que NO es válido es cualquier otra función.
  estado as (
    select
      (select funcion from trg) as funcion_hoteles,
      (select count(*) from trg where funcion = 'tarifario_trg_bump_armado_hoteles') = 1 as ya_aplicada_184,
      coalesce(
        (select funcion from trg) in ('tarifario_trg_bump_armado_directo', 'tarifario_trg_bump_armado_hoteles'),
        false
      ) as funcion_valida,
      (select count(*) from otras) = 3 as otras_presentes,
      (select count(*) from otras where funcion = 'tarifario_trg_bump_armado_directo') = 3 as otras_con_generica
  )
select jsonb_pretty(jsonb_build_object(
  'script', 'preflight_184_armado_hoteles_prioridad_no_invalida',
  'ok', (
    (select count(*) from col) = 1                       -- la 183 aplicada
    and (select count(*) from trg) = 1                   -- el trigger de armado_hoteles existe
    and (select funcion_valida from estado)              -- y apunta a una función válida para el estado
    and (select otras_presentes from estado)             -- las 3 tablas de armado están
    and (select otras_con_generica from estado)          -- las 3 con la función genérica exacta
  ),
  'migracion_184', jsonb_build_object(
    'ya_aplicada', (select ya_aplicada_184 from estado),
    'funcion_instalada', (select count(*) from funcion184) = 1,
    'funcion_del_trigger_armado_hoteles', (select funcion_hoteles from estado),
    'funcion_valida_para_el_estado', (select funcion_valida from estado),
    'esperado', 'tarifario_trg_bump_armado_directo antes de aplicar la 184 · tarifario_trg_bump_armado_hoteles si ya está aplicada'
  ),
  'precondicion_183_prioridad', jsonb_build_object(
    'existe', (select count(*) from col) = 1,
    'detalle', coalesce((select to_jsonb(col) from col), 'null'::jsonb)
  ),
  'trigger_armado_hoteles_actual', jsonb_build_object(
    'existe', (select count(*) from trg) = 1,
    'funcion', (select funcion from trg),
    'definicion', (select definicion from trg)
  ),
  'otras_tablas_de_armado_sin_cambios', jsonb_build_object(
    'tablas', coalesce((select jsonb_agg(to_jsonb(otras) order by tabla) from otras), '[]'::jsonb),
    'presentes', (select otras_presentes from estado),
    'todas_con_la_funcion_generica', (select otras_con_generica from estado)
  ),
  'volumen_armado_hoteles', (select to_jsonb(volumen) from volumen),
  'paquetes_hoy_bloqueados', jsonb_build_object(
    'total', (select count(*) from bloqueados),
    'detalle', coalesce((select jsonb_agg(to_jsonb(bloqueados) order by id) from bloqueados), '[]'::jsonb),
    'nota', 'La 184 NO los rehabilita: se recuperan publicando de nuevo (publicación exitosa). Este listado es a quiénes hay que republicar.'
  )
)) as preflight_184;
