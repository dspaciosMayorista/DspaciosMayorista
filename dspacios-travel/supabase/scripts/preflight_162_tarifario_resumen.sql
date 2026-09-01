-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-DEPLOY · SOLO LECTURA · migración 20260601000162_tarifario_resumen.sql
-- PR #276 (rama tarifario-rendimiento-carga / deepseek/pr276-audit)
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) ANTES de aplicar la
-- migración 162. NO contiene ningún INSERT/UPDATE/DELETE/DDL — únicamente
-- SELECT sobre catálogos del sistema, `tarifario_resultado` y `programas`.
-- Se puede correr las veces que haga falta sin ningún efecto secundario.
--
-- ⚠️ Precondiciones documentadas del PR #276:
--   · La migración 161 de Programas (`programa_modalidad_mk_comisionable`)
--     DEBE estar ya aplicada en el entorno. La 162 de este PR se RENUMERÓ de
--     161 a 162 precisamente para correr DESPUÉS de ella (ver aviso de
--     numeración en el encabezado de la propia 161). Este preflight verifica
--     su marcador (columna `programas.regla_comisionable_modalidad_mk`) y
--     BLOQUEA si falta.
--   · La vista `public.tarifario_resumen` NO debe existir todavía (la 162
--     aborta sola vía `to_regclass` si algo ocupa ese nombre — este preflight
--     lo comprueba ANTES, para no depender de un error a mitad de camino).
--   · `public.tarifario_resultado` debe existir con las 25 columnas que la
--     vista 162 referencia (modulo/paquete_*/bloqueo_*/empaquetado_id/
--     salida_id/hotel_*/servicio_*/destino_*/categoria/regimen/fecha_ida/
--     fecha_regreso/noches/moneda/acomodacion/precio_pvp/descripcion/
--     recargo_individual/tipo_tarifa).
--
-- Orden de despliegue completo de la migración 162:
--   1) este script (preflight)           → confirmar veredicto = OK
--   2) 20260601000162_tarifario_resumen.sql
--   3) verificar_162_tarifario_resumen.sql (postcheck) → confirmar estructura
--      (definición, security_invoker, ACL, columnas) y sincronía de conteos
--   4) medir el preview en Vercel (carga inicial del tarifario con la app
--      nueva — el preview apunta al MISMO Supabase pero el código nuevo solo
--      se activa en esa URL hasta hacer merge; NO afecta producción)
--   5) recién ahí, fusionar el PR #276
--   6) verificar en PRODUCCIÓN: re-correr verificar_162_tarifario_resumen.sql
--      contra el proyecto real post-merge (mismo script que el paso 3).
--
-- La consulta de magnitud/reducción (chk_resumen_estimado y chk_reduccion)
-- usa EXACTAMENTE el mismo `group by` de 20 columnas y el mismo filtro
-- `paquete_activo = true` que `create view public.tarifario_resumen` de la
-- migración 162. Si alguna vez se edita el `group by` de la vista, este
-- script debe actualizarse en el mismo commit para no volver a desincronizar
-- el conteo estimado. ⚠️ Este conteo es una ESTIMACIÓN: la vista aplica
-- además un `min()` por acomodación dentro de cada grupo (no cambia el número
-- de grupos), y los filtros post-carga de vigencia/empaquetados corren en
-- TypeScript (`lib/tarifario/filtrosPostCarga.ts`) — no reproducibles en SQL
-- puro. El número de GRUPOS sí es exacto; los grupos que sobrevivan a la
-- vigencia solo se saben tras aplicar la vista.
-- ═══════════════════════════════════════════════════════════════════════════

with

-- 1) Colisión de objeto: `public.tarifario_resumen` no debe resolver a NINGUNA
--    relación (tabla, vista, secuencia, materialized view, lo que sea). La
--    migración 162 aborta sola con `raise exception` si esto no se cumple;
--    este chequeo lo anticipa. Se verifica con `to_regclass` y además se
--    barre `pg_class` por cualquier objeto con ese nombre en cualquier schema.
chk_colision as (
  select
    1 as orden,
    'colisión: relación public.tarifario_resumen (debe NO existir antes de la 162)' as chequeo,
    case
      when to_regclass('public.tarifario_resumen') is null and not exists (
        select 1 from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where c.relname = 'tarifario_resumen'
      ) then
        'OK — no existe ninguna relación con ese nombre; la 162 la creará limpia'
      else
        'BLOQUEADO — ya existe una relación con ese nombre (ver la fila 1 del detalle de pg_class debajo); la 162 abortaría con raise exception. Revisar manualmente qué es antes de reintentar.'
    end as resultado,
    (not (to_regclass('public.tarifario_resumen') is null and not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relname = 'tarifario_resumen'
    ))) as bloqueante
),

-- 2) Migración 161 de Programas ya aplicada: marcador = columna
--    `programas.regla_comisionable_modalidad_mk` (creada por la 161, tipo
--    text not null default 'historica'). La 162 de este PR se renumeró para
--    correr DESPUÉS de ella; si no está aplicada, el orden de despliegue del
--    PR se rompió y conviene revisar antes de seguir.
chk_161_aplicada as (
  select
    2 as orden,
    'precondición: migración 161 de Programas aplicada (columna programas.regla_comisionable_modalidad_mk)' as chequeo,
    case
      when count(*) = 1 and max(data_type) = 'text' and max(is_nullable) = 'NO'
        and max(column_default) = '''historica''::text'
      then
        'OK — la 161 está aplicada (columna con tipo/nullable/default esperados)'
      when count(*) = 0 then
        'BLOQUEADO — la 161 NO está aplicada en este entorno; la 162 debe correr después. Aplicar la 161 primero.'
      else
        'BLOQUEADO — la 161 está aplicada pero la columna no tiene el tipo/nullable/default esperados (tipo=' ||
        coalesce(max(data_type), '?') || ' nullable=' || coalesce(max(is_nullable), '?') ||
        ' default=' || coalesce(max(column_default), 'NULL') || ')'
    end as resultado,
    (count(*) <> 1 or not (
      max(data_type) = 'text' and max(is_nullable) = 'NO' and max(column_default) = '''historica''::text'
    )) as bloqueante
  from information_schema.columns
  where table_schema = 'public' and table_name = 'programas'
    and column_name = 'regla_comisionable_modalidad_mk'
),

-- 3) Tabla base: `public.tarifario_resultado` debe existir (la vista 162 lee
--    de ella). Si no existe, no hay nada que resumir — bloquea.
chk_tabla_base as (
  select
    3 as orden,
    'tabla base: public.tarifario_resultado existe' as chequeo,
    case
      when to_regclass('public.tarifario_resultado') is not null then
        'OK — public.tarifario_resultado existe (relkind=' ||
        (select c.relkind::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'tarifario_resultado') || ')'
      else
        'BLOQUEADO — public.tarifario_resultado NO existe; la vista 162 no tendría de dónde leer.'
    end as resultado,
    (to_regclass('public.tarifario_resultado') is null) as bloqueante
),

-- 4) Columnas requeridas por la vista 162 sobre `tarifario_resultado`. Las 25
--    columnas listadas son exactamente las que el `select ... from public.
--    tarifario_resultado r ... group by` de la migración referencia. Cualquier
--    columna faltante rompería la creación de la vista — bloquea y las enumera.
chk_columnas as (
  select
    4 as orden,
    'columnas: 25 requeridas por la vista 162 en public.tarifario_resultado' as chequeo,
    case
      when count(*) filter (where c.column_name is null) = 0 then
        'OK — las 25 columnas requeridas existen en public.tarifario_resultado'
      else
        'BLOQUEADO — faltan en public.tarifario_resultado: ' ||
        coalesce(string_agg(r.columna, ', ' order by r.columna) filter (where c.column_name is null), '')
    end as resultado,
    (count(*) filter (where c.column_name is null) > 0) as bloqueante
  from (values
    ('modulo'),('paquete_id'),('paquete_nombre'),('paquete_activo'),('bloqueo_id'),
    ('bloqueo_label'),('empaquetado_id'),('salida_id'),('hotel_id'),('hotel_nombre'),
    ('servicio_id'),('servicio_nombre'),('destino_id'),('destino_nombre'),('categoria'),
    ('regimen'),('fecha_ida'),('fecha_regreso'),('noches'),('moneda'),('acomodacion'),
    ('precio_pvp'),('descripcion'),('recargo_individual'),('tipo_tarifa')
  ) as r(columna)
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'tarifario_resultado'
   and c.column_name = r.columna
),

-- 5) Conteo de filas CRUDAS reales de tarifario_resultado — total y activas
--    (`paquete_activo = true`). Informativo (no bloquea: una tabla vacía sigue
--    siendo aplicable la vista), pero necesario para interpretar la reducción.
chk_filas_crudas as (
  select
    5 as orden,
    'conteo crudo: filas totales y activas de public.tarifario_resultado' as chequeo,
    (select count(*) from public.tarifario_resultado)::text || ' filas totales · ' ||
    (select count(*) from public.tarifario_resultado where paquete_activo = true)::text ||
    ' filas con paquete_activo=true (base de la vista)' as resultado,
    false as bloqueante
),

-- 6) Conteo ESTIMADO del resumen: filas que produciría la vista, usando
--    EXACTAMENTE el mismo `group by` de 20 columnas y el mismo filtro que la
--    migración 162 (ver nota de cabecera). Este es el número de grupos — y por
--    tanto de filas que el cliente recibe en la carga inicial, ya que esta
--    versión de la app NO expande el resumen a filas sintéticas.
chk_resumen_estimado as (
  select
    6 as orden,
    'conteo estimado del resumen (mismo group by de 20 columnas que la vista 162, paquete_activo=true)' as chequeo,
    count(*)::text || ' filas (grupos) estimadas' as resultado,
    false as bloqueante
  from (
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
  ) t
),

-- 7) Reducción absoluta y porcentual que logra el resumen frente a las filas
--    ACTIVAS de tarifario_resultado (la vista filtra por paquete_activo=true,
--    así que la comparación justa es contra esas filas, no contra el total).
--    Informativo; si la reducción es 0 o negativa (resumen ≈ crudo), la vista
--    no está colapsando la dimensión acomodación como se espera → AVISO
--    (no bloquea: la vista igual crea y funciona, solo pierde su propósito).
chk_reduccion as (
  select
    7 as orden,
    'reducción del resumen frente a filas activas (absoluta y %) — el propósito de la 162' as chequeo,
    'absoluta=' ||
      ((select count(*) from public.tarifario_resultado where paquete_activo = true) -
       (select count(*) from (
          select 1
          from public.tarifario_resultado
          where paquete_activo = true
          group by
            modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
            empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
            destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
        ) s))::text ||
    ' filas · relativa=' ||
    round(
      100.0 * ((select count(*) from public.tarifario_resultado where paquete_activo = true) -
        (select count(*) from (
          select 1
          from public.tarifario_resultado
          where paquete_activo = true
          group by
            modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
            empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
            destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
        ) s))
      / nullif((select count(*) from public.tarifario_resultado where paquete_activo = true), 0),
      2
    )::text || '% de las filas activas' ||
    case
      when (select count(*) from public.tarifario_resultado where paquete_activo = true)
           <= (select count(*) from (
                select 1
                from public.tarifario_resultado
                where paquete_activo = true
                group by
                  modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
                  empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
                  destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
              ) s)
      then ' · AVISO: el resumen NO reduce (≈ el mismo número de filas activas) — revisar el group by antes de aplicar'
      else ''
    end as resultado,
    false as bloqueante
),

filas as (
  select * from chk_colision
  union all select * from chk_161_aplicada
  union all select * from chk_tabla_base
  union all select * from chk_columnas
  union all select * from chk_filas_crudas
  union all select * from chk_resumen_estimado
  union all select * from chk_reduccion
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
from filas
order by orden;

-- ═══════════════════════════════════════════════════════════════════════════
-- Anexo diagnóstico (independiente, SOLO LECTURA): detalle de colisión — 0
-- filas = sin colisión; si la hay, muestra QUÉ objeto ocupa el nombre
-- `tarifario_resumen` y en qué schema. Va como statement aparte (no puede
-- compartir el `with` de arriba, que solo pertenece a la primera consulta).
-- ═══════════════════════════════════════════════════════════════════════════
select
  n.nspname as schema,
  c.relname as nombre,
  c.relkind as tipo
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relname = 'tarifario_resumen';
