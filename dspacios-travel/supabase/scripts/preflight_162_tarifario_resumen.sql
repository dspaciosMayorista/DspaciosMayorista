-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-DEPLOY · SOLO LECTURA (sobre datos y objetos de negocio) ·
-- migración 20260601000162_tarifario_resumen.sql · PR #276
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) ANTES de aplicar la
-- migración 162. Devuelve UN ÚNICO reporte consolidado con veredicto
-- OK/BLOQUEADO. No escribe ni modifica ninguna fila ni ningún objeto
-- persistente (solo crea una tabla temporal de sesión para transportar unos
-- conteos; se descarta sola al cerrar la sesión del editor).
--
-- ⚠️ LIMITACIÓN EXPLICADA (requisito: no referenciar estáticamente una
-- tabla/columna que el preflight admite que puede faltar):
--   Los CHEQUEOS ESTRUCTURALES (existencia de public.tarifario_resultado,
--   relkind, presencia de las 25 columnas, colisión, migración 161) son
--   SELECT puros sobre catálogos (pg_catalog / information_schema) y NUNCA
--   abortan: una tabla o columna ausente simplemente devuelve 0 filas.
--   Pero los CONTEO de filas y el resumen estimado exigen leer la tabla
--   real (`select count(*) from public.tarifario_resultado ... group by
--   <20 columnas>`). En SQL exclusivamente SELECT es IMPOSIBLE proteger esa
--   lectura ante una tabla/columna ausente: PostgreSQL resuelve relaciones y
--   columnas en tiempo de parseo, así que esa consulta ABORTARÍA el script si
--   la tabla o cualquiera de las 20 columnas del GROUP BY no existiera, sin
--   importar cuántos CASE/WHERE la envuelvan. Por eso los conteos se calculan
--   con un bloque `do $$ ... $$` que ejecuta las lecturas con `execute` DINÁMICO
--   SOLO cuando la estructura es válida (tabla base presente con relkind r/p Y
--   las 25 columnas presentes) — si la estructura es inválida, el bloque no
--   ejecuta la lectura y deja los conteos en NULL; el reporte los muestra como
--   "NO CALCULADO". Esto NO simula cobertura: cubre de verdad el caso
--   "estructura inválida" sin abortar, a costa de que los conteos solo existen
--   cuando la estructura es válida (que es lo único que tiene sentido medir).
--
-- ⚠️ El conteo estimado (columna filas_resumen) usa EXACTAMENTE el mismo
-- `group by` de 20 columnas y el mismo filtro `paquete_activo = true` que
-- `create view public.tarifario_resumen` de la migración 162. Si alguna vez se
-- edita el `group by` de la vista, este script debe actualizarse en el mismo
-- commit. La vista además aplica `min()` por acomodación dentro de cada grupo
-- (no cambia el número de grupos) y los filtros post-carga de vigencia/
-- empaquetados corren en TypeScript (`lib/tarifario/filtrosPostCarga.ts`),
-- no reproducibles en SQL puro — el número de GRUPOS sí es exacto.
--
-- ⚠️ Solo `public.tarifario_resumen` BLOQUEA. Un homónimo en otro schema es
-- INFORMATIVO (no bloquea) — la migración 162 solo hace `create view public.
-- tarifario_resumen` y su guarda `to_regclass('public.tarifario_resumen')`.
--
-- Precondiciones documentadas del PR #276:
--   · La migración 161 de Programas DEBE estar aplicada (marcador:
--     programas.regla_comisionable_modalidad_mk). La 162 se renumeró de 161 a
--     162 para correr DESPUÉS de ella. Este preflight lo verifica y BLOQUEA.
--   · La vista `public.tarifario_resumen` NO debe existir todavía.
--   · `public.tarifario_resultado` debe existir como TABLA ordinaria o
--     particionada con las 25 columnas que la vista 162 referencia.
--
-- Orden de despliegue de la migración 162:
--   1) este script (preflight)           → confirmar veredicto = OK
--   2) 20260601000162_tarifario_resumen.sql
--   3) verificar_162_tarifario_resumen.sql (postcheck) → confirmar PASSED
--   4) medir el preview en Vercel (el preview apunta al MISMO Supabase; el
--      código nuevo solo se activa en esa URL hasta hacer merge)
--   5) fusionar el PR #276
--   6) verificar en PRODUCCIÓN: re-correr verificar_162 (mismo script que 3).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Bloque de CONTEO condicional. Solo calcula los conteos cuando la estructura
-- es válida (tabla base con relkind r/p Y las 25 columnas presentes). Crea
-- una tabla TEMPORAL de sesión (pg_temp), no un objeto persistente.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  _valida boolean;
begin
  execute 'drop table if exists pg_temp.preflight_162_conteos';

  select
      to_regclass('public.tarifario_resultado') is not null
  and exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resultado'
      and c.relkind in ('r', 'p')
  )
  and not exists (
    select 1 from (values
      ('modulo'),('paquete_id'),('paquete_nombre'),('paquete_activo'),('bloqueo_id'),
      ('bloqueo_label'),('empaquetado_id'),('salida_id'),('hotel_id'),('hotel_nombre'),
      ('servicio_id'),('servicio_nombre'),('destino_id'),('destino_nombre'),('categoria'),
      ('regimen'),('fecha_ida'),('fecha_regreso'),('noches'),('moneda'),('acomodacion'),
      ('precio_pvp'),('descripcion'),('recargo_individual'),('tipo_tarifa')
    ) r(columna)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'tarifario_resultado'
        and c.column_name = r.columna
    )
  )
  into _valida;

  if _valida then
    -- SOLO aquí se toca la tabla real, y solo con lecturas (count). El
    -- `group by` es EXACTAMENTE el de la vista 162.
    execute $cnt$
      create temp table pg_temp.preflight_162_conteos as
      select
        (select count(*) from public.tarifario_resultado) as filas_totales,
        (select count(*) from public.tarifario_resultado where paquete_activo = true) as filas_activas,
        (select count(*) from (
          select
            modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
            empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
            destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
          from public.tarifario_resultado
          where paquete_activo = true
          group by
            modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
            empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
            destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
        ) s) as filas_resumen
    $cnt$;
  else
    -- Estructura inválida: no ejecutar la lectura; dejar conteos en NULL.
    create temp table pg_temp.preflight_162_conteos as
      select null::bigint as filas_totales, null::bigint as filas_activas, null::bigint as filas_resumen;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- ÚNICO REPORTE CONSOLIDADO (último statement del script; nada después).
-- Los chequeos 1-4 son SELECT puros sobre catálogos (nunca abortan); los
-- conteos (5-7) leen la tabla temporal de arriba.
-- ───────────────────────────────────────────────────────────────────────────
with

estructura as (
  select
    (to_regclass('public.tarifario_resultado') is not null) as tabla_existe,
    coalesce((
      select c.relkind::text
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tarifario_resultado'
    ), '') as relkind,
    (to_regclass('public.tarifario_resultado') is not null
      and exists (
        select 1 from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'tarifario_resultado'
          and c.relkind in ('r','p')
      )) as relkind_ok,
    (not exists (
      select 1 from (values
        ('modulo'),('paquete_id'),('paquete_nombre'),('paquete_activo'),('bloqueo_id'),
        ('bloqueo_label'),('empaquetado_id'),('salida_id'),('hotel_id'),('hotel_nombre'),
        ('servicio_id'),('servicio_nombre'),('destino_id'),('destino_nombre'),('categoria'),
        ('regimen'),('fecha_ida'),('fecha_regreso'),('noches'),('moneda'),('acomodacion'),
        ('precio_pvp'),('descripcion'),('recargo_individual'),('tipo_tarifa')
      ) r(columna)
      where not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'tarifario_resultado'
          and c.column_name = r.columna
      )
    )) as columnas_ok
),

colision as (
  select
    exists(
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tarifario_resumen'
    ) as public_ocupado,
    (select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relname = 'tarifario_resumen' and n.nspname <> 'public') as homonimos_otros_schemas
),

conteos as (
  select filas_totales, filas_activas, filas_resumen
  from pg_temp.preflight_162_conteos
),

checks as (
  -- 1) Colisión: SOLO public.tarifario_resumen bloquea; homónimos informativos.
  select
    1 as orden,
    'colisión: public.tarifario_resumen (bloquea solo si existe EN public)' as chequeo,
    case
      when not colision.public_ocupado then
        'OK — no existe ninguna relación public.tarifario_resumen' ||
        case when colision.homonimos_otros_schemas = 0 then '' else
          ' · ' || colision.homonimos_otros_schemas::text || ' homónimo(s) en otros schemas (informativo, no bloquea)' end
      else
        'BLOQUEADO — ya existe una relación public.tarifario_resumen; la 162 abortaría con raise exception. Revisar antes de reintentar.'
    end as resultado,
    colision.public_ocupado as bloqueante
  from colision

  union all

  -- 2) Migración 161 de Programas aplicada (marcador: columna con tipo/
  --    nullable/default esperados). SELECT puro sobre información del schema.
  select
    2 as orden,
    'precondición: migración 161 de Programas aplicada (programas.regla_comisionable_modalidad_mk)' as chequeo,
    case
      when (select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'programas'
               and column_name = 'regla_comisionable_modalidad_mk'
               and data_type = 'text' and is_nullable = 'NO' and column_default = '''historica''::text') = 1 then
        'OK — la 161 está aplicada (columna con tipo/nullable/default esperados)'
      when (select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'programas'
               and column_name = 'regla_comisionable_modalidad_mk') = 0 then
        'BLOQUEADO — la 161 NO está aplicada en este entorno; la 162 debe correr después. Aplicar la 161 primero.'
      else
        'BLOQUEADO — la columna existe pero con tipo/nullable/default inesperados'
    end as resultado,
    not ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'programas'
             and column_name = 'regla_comisionable_modalidad_mk'
             and data_type = 'text' and is_nullable = 'NO' and column_default = '''historica''::text') = 1) as bloqueante

  union all

  -- 3) Tabla base: debe existir y ser TABLA ordinaria (r) o particionada (p).
  select
    3 as orden,
    'tabla base: public.tarifario_resultado (tabla ordinaria o particionada)' as chequeo,
    case
      when not estructura.tabla_existe then 'BLOQUEADO — public.tarifario_resultado NO existe'
      when estructura.relkind_ok then 'OK — existe, relkind=' || estructura.relkind || ' (tabla ordinaria/particionada)'
      else 'BLOQUEADO — existe pero NO es tabla ordinaria/particionada (relkind=' || estructura.relkind || ')'
    end as resultado,
    (not estructura.relkind_ok) as bloqueante
  from estructura

  union all

  -- 4) Columnas: las 25 requeridas (incluidas las 20 del GROUP BY).
  select
    4 as orden,
    'columnas: 25 requeridas por la vista 162 en public.tarifario_resultado (incluye las 20 del GROUP BY)' as chequeo,
    case
      when estructura.columnas_ok then 'OK — las 25 columnas existen'
      else 'BLOQUEADO — faltan: ' || coalesce((
        select string_agg(r.columna, ', ' order by r.columna)
        from (values
          ('modulo'),('paquete_id'),('paquete_nombre'),('paquete_activo'),('bloqueo_id'),
          ('bloqueo_label'),('empaquetado_id'),('salida_id'),('hotel_id'),('hotel_nombre'),
          ('servicio_id'),('servicio_nombre'),('destino_id'),('destino_nombre'),('categoria'),
          ('regimen'),('fecha_ida'),('fecha_regreso'),('noches'),('moneda'),('acomodacion'),
          ('precio_pvp'),('descripcion'),('recargo_individual'),('tipo_tarifa')
        ) r(columna)
        where not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'tarifario_resultado'
            and c.column_name = r.columna
        )
      ), '')
    end as resultado,
    (not estructura.columnas_ok) as bloqueante
  from estructura

  union all

  -- 5) Conteo crudo (solo si estructura válida).
  select
    5 as orden,
    'conteo crudo: filas de public.tarifario_resultado' as chequeo,
    case
      when estructura.relkind_ok and estructura.columnas_ok then
        'totales=' || coalesce(conteos.filas_totales::text, 'NULL') ||
        ' · activas(paquete_activo=true)=' || coalesce(conteos.filas_activas::text, 'NULL')
      else 'NO CALCULADO — estructura inválida (ver filas 3-4)'
    end as resultado,
    false as bloqueante
  from estructura, conteos

  union all

  -- 6) Resumen estimado (mismo GROUP BY de 20 columnas que la vista 162).
  select
    6 as orden,
    'conteo estimado del resumen (mismo GROUP BY de 20 columnas que la vista 162, paquete_activo=true)' as chequeo,
    case
      when estructura.relkind_ok and estructura.columnas_ok then
        coalesce(conteos.filas_resumen::text, 'NULL') || ' filas (grupos) estimadas'
      else 'NO CALCULADO — estructura inválida (ver filas 3-4)'
    end as resultado,
    false as bloqueante
  from estructura, conteos

  union all

  -- 7) Reducción absoluta y relativa frente a filas ACTIVAS.
  select
    7 as orden,
    'reducción del resumen frente a filas activas (absoluta y %) — el propósito de la 162' as chequeo,
    case
      when estructura.relkind_ok and estructura.columnas_ok then
        'absoluta=' || (coalesce(conteos.filas_activas,0) - coalesce(conteos.filas_resumen,0))::text || ' filas · relativa=' ||
        round(100.0 * (coalesce(conteos.filas_activas,0) - coalesce(conteos.filas_resumen,0))
              / nullif(conteos.filas_activas, 0), 2)::text || '% de las filas activas' ||
        case when coalesce(conteos.filas_activas,0) <= coalesce(conteos.filas_resumen,0)
          then ' · AVISO: el resumen NO reduce (≈ el mismo número de filas activas) — revisar el GROUP BY antes de aplicar'
          else '' end
      else 'NO CALCULADO — estructura inválida (ver filas 3-4)'
    end as resultado,
    false as bloqueante
  from estructura, conteos
)

select
  orden,
  chequeo,
  resultado,
  bloqueante,
  case
    when bool_or(bloqueante) over () then 'BLOQUEADO — no aplicar la migración 162 hasta resolver la(s) fila(s) marcada(s) bloqueante=true'
    else 'OK — puede aplicarse la migración 162'
  end as veredicto_final
from checks
order by orden;
