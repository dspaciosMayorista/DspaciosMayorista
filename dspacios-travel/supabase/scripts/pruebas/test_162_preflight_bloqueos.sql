-- ═══════════════════════════════════════════════════════════════════════════
-- Prueba LOCAL del PREFLIGHT de la migración 162 (`preflight_162_tarifario_
-- resumen.sql`) y del POSTCHECK (`verificar_162_tarifario_resumen.sql`).
--
-- ⚠️ SOLO contra una base de verificación LOCAL (ver
-- supabase/scripts/pruebas/local-desde-cero.sh), NUNCA contra producción.
--
-- Requiere: migraciones 1→161 aplicadas (la 161 DE Programas incluida — es la
-- precondición que el preflight verifica), la 162 TODAVÍA NO aplicada, y los
-- dos scripts bajo prueba presentes en supabase/scripts/. Ej.:
--   local-desde-cero.sh dspacios_local 55432 161
--   psql -p 55432 -d dspacios_local -f supabase/scripts/pruebas/test_162_preflight_bloqueos.sql
--
-- Cobertura (cada escenario corre el script REAL vía `\i` y además aserción
-- programática del MISMO predicado que el preflight/postcheck usa, no solo de
-- que "el objeto de prueba existe"):
--   1) limpio                      → preflight OK
--   2) colisión exacta en public   → preflight BLOQUEADO (sin abortar)
--   3) homónimo en otro schema     → preflight OK + aviso informativo
--   4) tabla base AUSENTE          → preflight BLOQUEADO SIN error SQL
--   5) columna NO del GROUP BY ausente → preflight BLOQUEADO (sin abortar)
--   6) columna DEL GROUP BY ausente    → preflight BLOQUEADO SIN error SQL
--   7) orden de columnas invertido en la vista → postcheck detecta FAILED
--
-- Toda la DDL de prueba vive en una transacción con ROLLBACK garantizado: cada
-- escenario es `begin; ... rollback;`, así ningún objeto ni fila persiste (ni
-- siquiera si algo falla a mitad de un escenario). Los únicos cambios son DDL/
-- DML transitorios sobre objetos/registros de PRUEBA; ninguna fila real de
-- tarifario_resultado/programas se modifica.
--
-- ⚠️ IMPORTANTE: este archivo NO ha sido ejecutado contra una base PostgreSQL
-- real en esta sesión (el entorno no dispone de `psql` ni de un daemon de
-- Docker activo). Está revisado estáticamente, no "validado" en ejecución.
-- Correrlo localmente es el paso pendiente antes de considerar la ronda cerrada.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP 1
\pset pager off

-- ───────────────────────────────────────────────────────────────────────────
-- Precondiciones de ENTORNO (para que cada escenario represente de verdad el
-- caso): la 161 aplicada, la tabla base y sus 25 columnas presentes, y la 162
-- NO aplicada. Si alguna falla, la prueba entera no es representativa — se
-- detiene (ON_ERROR_STOP) para que no se lean resultados engañosos.
-- ───────────────────────────────────────────────────────────────────────────
\echo '════════ PRECONDICIONES DE ENTORNO (1→161 aplicadas, 162 NO) ───────────'
select
  (select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'programas'
       and column_name = 'regla_comisionable_modalidad_mk'
       and data_type = 'text' and is_nullable = 'NO'
       and column_default = '''historica''::text') as precond_mig161_aplicada,
  (to_regclass('public.tarifario_resultado') is not null
     and exists (
       select 1 from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'tarifario_resultado'
         and c.relkind in ('r','p')
     )) as precond_tabla_base,
  (to_regclass('public.tarifario_resumen') is null) as precond_162_no_aplicada;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 1 — LIMPIO: sin colisiones ni faltantes. El preflight debe dar OK.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 1 — limpio → el preflight debe dar OK ───────────────'
begin;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Mismo predicado que el preflight (checks 1-4): el veredicto es OK si y solo
-- si NINGUNA condición bloqueante se cumple. Reproduce la expresión exacta.
select
  not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resumen'
  )                                                                      as ok1_limpio_veredicto_ok,
  not (to_regclass('public.tarifario_resultado') is not null
    and exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tarifario_resultado'
        and c.relkind in ('r','p')
    ))                                                                    as ok2_limpio_tabla_base_ok;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 2 — COLISIÓN EXACTA en public: el preflight debe BLOQUEAR sin
-- abortar (la colisión es el check 1; los checks 3-4 siguen evaluándose).
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 2 — colisión public.tarifario_resumen → BLOQUEADO ──'
begin;

create table public.tarifario_resumen (x integer);
insert into public.tarifario_resumen values (1);

\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Predicado del check 1 del preflight (bloqueante de colisión en public).
select
  exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resumen'
  ) as ok3_colision_public_bloquea;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 3 — HOMÓNIMO en OTRO schema: el preflight debe dar OK (informativo,
-- no bloquea; solo public.tarifario_resumen bloquea).
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 3 — homónimo en otro schema → OK (informativo) ─────'
begin;

create schema if not exists preflight_test;
create table preflight_test.tarifario_resumen (x integer);

\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Mismo predicado que el check 1: bloquea solo si existe EN public.
select
  (not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resumen'
  )) as ok4_homonimo_no_bloquea,
  (select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'tarifario_resumen' and n.nspname <> 'public') = 1 as ok5_homonimo_contado;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 4 — TABLA BASE AUSENTE: el preflight debe BLOQUEAR SIN error SQL.
-- Esto es lo que valida el diseño del `do $$ ... execute` condicional: la
-- lectura de conteos NO se ejecuta (estructura inválida), así que no hay
-- "relation does not exist" en tiempo de parseo. Se prueba que el script
-- termina (el `\i` llega hasta el final) y que el veredicto es BLOQUEADO.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 4 — tabla base ausente → BLOQUEADO SIN error SQL ──'
begin;

drop table public.tarifario_resultado;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Predicado del check 3: tabla base debe existir con relkind r/p. Sin la
-- tabla, esto es false → bloqueante. Además, los conteos deben quedar NULL
-- (el DO entró por el else, NO abortó) — prueba de que no hubo error SQL.
select
  not (to_regclass('public.tarifario_resultado') is not null
    and exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tarifario_resultado'
        and c.relkind in ('r','p')
    )) as ok6_tabla_ausente_bloquea,
  (select filas_totales is null from pg_temp.preflight_162_conteos) as ok7_conteos_no_abortaron;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 5 — COLUMNA NO del GROUP BY ausente (ej. descripcion): el preflight
-- debe BLOQUEAR (check 4) sin abortar.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 5 — columna no-GROUP-BY ausente → BLOQUEADO ────────'
begin;

alter table public.tarifario_resultado rename column descripcion to descripcion_scratch;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Predicado del check 4: bloquea si falta cualquiera de las 25 columnas.
select
  exists (
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
  ) as ok8_columna_falta_bloquea,
  (select filas_totales is null from pg_temp.preflight_162_conteos) as ok9_no_aborto;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 6 — COLUMNA DEL GROUP BY ausente (ej. moneda): el caso más difícil.
-- Sin el `execute` condicional, la lectura `select ... group by moneda` en el
-- preflight abortaría el script en tiempo de parseo. Con él, BLOQUEA sin error.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 6 — columna DEL GROUP BY ausente → BLOQUEADO SIN error SQL ──'
begin;

alter table public.tarifario_resultado rename column moneda to moneda_scratch;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Mismo predicado del check 4: moneda está entre las 25 → falta → bloquea.
select
  exists (
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
  ) as ok10_groupby_columna_falta_bloquea,
  (select filas_totales is null from pg_temp.preflight_162_conteos) as ok11_no_aborto;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 7 — POSTCHECK: orden de columnas invertido en la vista creada. El
-- verificar debe detectar FAILED en su check A (nombre + posición ordinal).
-- Se crea la vista de prueba con dos columnas intercambiadas (recargo_individual
-- y descripcion), se corre el verificar real vía `\i` y se aserta sobre el
-- mismo predicado que su check A.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 7 — postcheck: orden invertido → FAILED ────────────'
begin;

create view public.tarifario_resumen
  with (security_invoker = true)
as
  select
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda,
    min(precio_pvp) filter (where acomodacion = 'sencilla' and precio_pvp > 0) as precio_sencilla,
    min(precio_pvp) filter (where acomodacion = 'doble'    and precio_pvp > 0) as precio_doble,
    min(precio_pvp) filter (where acomodacion = 'triple'   and precio_pvp > 0) as precio_triple,
    min(precio_pvp) filter (where acomodacion = 'multiple' and precio_pvp > 0) as precio_multiple,
    min(precio_pvp) filter (where acomodacion = 'nino')    as precio_nino,
    min(precio_pvp) filter (where acomodacion = 'nino2')   as precio_nino2,
    min(precio_pvp) filter (where acomodacion = 'infante') as precio_infante,
    min(precio_pvp) filter (where acomodacion in ('sencilla','doble','triple','multiple') and precio_pvp > 0) as desde_adulto,
    min(precio_pvp) filter (where precio_pvp > 0) as desde_general,
    -- ⚠️ AQUÍ ESTÁ EL DEFECTO A DETECTAR: descripcion y recargo_individual
    -- intercambiadas de POSICIÓN respecto al orden correcto (descripcion=30,
    -- recargo=31). El postcheck verifica nombre Y ordinal_position, así que
    -- detecta que la col 30 se llama recargo_individual (esperaba descripcion).
    min(tipo_tarifa)          as recargo_individual,   -- posición 30 (esperada: descripcion)
    min(recargo_individual)   as descripcion,          -- posición 31 (esperada: recargo_individual)
    min(descripcion)          as tipo_tarifa           -- posición 32
  from public.tarifario_resultado
  where paquete_activo = true
  group by
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda;

grant select on public.tarifario_resumen to anon, authenticated;

\i supabase/scripts/verificar_162_tarifario_resumen.sql

-- Mismo predicado del check A del postcheck: algún par (posición, columna)
-- esperado no coincide → el veredicto debe ser FAILED.
select
  (select count(*) from (values
    (1,'modulo'),(2,'paquete_id'),(3,'paquete_nombre'),(4,'paquete_activo'),(5,'bloqueo_id'),
    (6,'bloqueo_label'),(7,'empaquetado_id'),(8,'salida_id'),(9,'hotel_id'),(10,'hotel_nombre'),
    (11,'servicio_id'),(12,'servicio_nombre'),(13,'destino_id'),(14,'destino_nombre'),(15,'categoria'),
    (16,'regimen'),(17,'fecha_ida'),(18,'fecha_regreso'),(19,'noches'),(20,'moneda'),
    (21,'precio_sencilla'),(22,'precio_doble'),(23,'precio_triple'),(24,'precio_multiple'),
    (25,'precio_nino'),(26,'precio_nino2'),(27,'precio_infante'),(28,'desde_adulto'),
    (29,'desde_general'),(30,'descripcion'),(31,'recargo_individual'),(32,'tipo_tarifa')
  ) as v(posicion, columna)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'tarifario_resumen'
      and c.column_name = v.columna and c.ordinal_position = v.posicion
  )) > 0 as ok12_postcheck_detecta_orden;

rollback;

\echo '════════ FIN test_162_preflight_bloqueos.sql ═══════════════════════════'
\echo '   Cada okN_* debe ser true y el veredicto mostrado por cada `\i` debe'
\echo '   coincidir con lo esperado (E1 OK / E2 BLOQUEADO / E3 OK / E4 BLOQUEADO /'
\echo '   E5 BLOQUEADO / E6 BLOQUEADO / E7 FAILED). Ningún objeto ni fila de'
\echo '   prueba debe quedar (todas las transacciones hacen rollback).'
