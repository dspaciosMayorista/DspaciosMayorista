-- ═══════════════════════════════════════════════════════════════════════════
-- Prueba LOCAL del PREFLIGHT (`preflight_162_tarifario_resumen.sql`) y del
-- POSTCHECK (`verificar_162_tarifario_resumen.sql`) de la migración 162.
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
-- Cómo funciona: cada escenario es UNA transacción `begin; ... rollback;` que
-- (1) monta el estado, (2) corre el script REAL vía `\i`, y (3) aserta sobre
-- el REPORTE YA MATERIALIZADO (pg_temp.preflight_162_reporte para el preflight
-- y pg_temp.postcheck_162_reporte para el verificar) — NO se re-escriben los
-- predicados bajo prueba, se inspecciona el resultado real del script. Si el
-- veredicto real no coincide con el esperado, se lanza `raise exception` y,
-- con `\set ON_ERROR_STOP 1`, la prueba FALLA automáticamente en ese punto.
--
-- Cobertura:
--   1) limpio                    → preflight OK (+ conteos calculados: base válida)
--   2) colisión exacta en public → preflight BLOQUEADO (fila 1 bloqueante)
--   3) homónimo en otro schema   → preflight OK, informativo (temp table), sin
--      asumir que el total de homónimos externos es exactamente 1
--   4) tabla base AUSENTE (rename) → preflight BLOQUEADO SIN error SQL, conteos NULL
--   5) columna NO del GROUP BY ausente → preflight BLOQUEADO (fila 4), conteos NULL
--   6) columna DEL GROUP BY ausente → preflight BLOQUEADO SIN error SQL, conteos NULL
--   7) orden de columnas invertido en la vista → postcheck detecta FAILED (fila A)
--
-- Toda la DDL/DML de prueba vive en transacciones con ROLLBACK garantizado:
-- ningún objeto ni fila persiste. Los cambios son DDL/DML transitorios sobre
-- objetos/registros de PRUEBA; ninguna fila real de negocio se modifica. En
-- el escenario 4 la tabla base se RENOMBRA (no se borra) y el rollback la
-- restaura.
--
-- ⚠️ IMPORTANTE: este archivo NO ha sido ejecutado contra una base PostgreSQL
-- real en esta sesión (el entorno no dispone de `psql` ni de un daemon de
-- Docker activo). Está revisado estáticamente, no "validado" en ejecución.
-- Correrlo localmente es el paso pendiente antes de considerar la ronda cerrada.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP 1
\pset pager off

-- ───────────────────────────────────────────────────────────────────────────
-- Precondiciones de ENTORNO: si no se cumplen, la prueba no es representativa
-- → RAISE (falla en seco) para no leer resultados engañosos.
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'programas'
      and column_name = 'regla_comisionable_modalidad_mk'
      and data_type = 'text' and is_nullable = 'NO'
      and column_default = '''historica''::text'
  ) then
    raise exception 'PRECONDICIÓN: la migración 161 (Programas) no está aplicada con el marcador esperado';
  end if;
  if not (
    to_regclass('public.tarifario_resultado') is not null
    and exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tarifario_resultado'
        and c.relkind in ('r','p')
    )
  ) then
    raise exception 'PRECONDICIÓN: public.tarifario_resultado no existe como tabla ordinaria/particionada';
  end if;
  if to_regclass('public.tarifario_resumen') is not null then
    raise exception 'PRECONDICIÓN: la migración 162 ya está aplicada (tarifario_resumen existe) — la prueba exige que NO';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 1 — LIMPIO: sin colisiones ni faltantes → preflight OK y conteos
-- calculados (la base válida debe producir conteos reales, no NULL).
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 1 — limpio → preflight OK ───────────────────────────'
begin;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

do $$
begin
  if (select count(*) from pg_temp.preflight_162_reporte) = 0
    or (select veredicto_final from pg_temp.preflight_162_reporte limit 1) not like 'OK%' then
    raise exception 'ESC1 LIMPIO: veredicto esperado OK (got %)',
      coalesce((select veredicto_final from pg_temp.preflight_162_reporte limit 1), '(sin reporte)');
  end if;
  if exists (select 1 from pg_temp.preflight_162_reporte where bloqueante) then
    raise exception 'ESC1 LIMPIO: hay una fila bloqueante inesperada';
  end if;
  -- La base válida debe haberse tratado como tal: conteos calculados (no NULL).
  if (select filas_totales is null from pg_temp.preflight_162_conteos) then
    raise exception 'ESC1 LIMPIO: conteos no calculados — la base se consideró inválida';
  end if;
end $$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 2 — COLISIÓN EXACTA en public: preflight BLOQUEADO; la fila 1
-- (colisión) debe marcar bloqueante. Sin abortar (el `\i` llega hasta aquí).
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 2 — colisión public.tarifario_resumen → BLOQUEADO ──'
begin;

create table public.tarifario_resumen (x integer);
insert into public.tarifario_resumen values (1);

\i supabase/scripts/preflight_162_tarifario_resumen.sql

do $$
begin
  if (select veredicto_final from pg_temp.preflight_162_reporte limit 1) not like 'BLOQUEADO%' then
    raise exception 'ESC2 COLISIÓN: veredicto esperado BLOQUEADO (got %)',
      (select veredicto_final from pg_temp.preflight_162_reporte limit 1);
  end if;
  if not exists (select 1 from pg_temp.preflight_162_reporte where orden = 1 and bloqueante) then
    raise exception 'ESC2 COLISIÓN: la fila 1 (colisión en public) debe marcar bloqueante';
  end if;
end $$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 3 — HOMÓNIMO en otro schema (temp table): preflight OK. NO se
-- asume que el total de homónimos externos sea exactamente 1 — solo se exige
-- que NO bloquee y que la fila 1 lo reporte como aviso informativo.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 3 — homónimo en otro schema → OK (informativo) ─────'
begin;

create temp table tarifario_resumen (x integer);

\i supabase/scripts/preflight_162_tarifario_resumen.sql

do $$
begin
  if (select veredicto_final from pg_temp.preflight_162_reporte limit 1) not like 'OK%' then
    raise exception 'ESC3 HOMÓNIMO: veredicto esperado OK (got %)',
      (select veredicto_final from pg_temp.preflight_162_reporte limit 1);
  end if;
  if exists (select 1 from pg_temp.preflight_162_reporte where bloqueante) then
    raise exception 'ESC3 HOMÓNIMO: un homónimo en otro schema NO debe bloquear';
  end if;
  -- Debe haberlo anotado como informativo (sin afirmar el total exacto).
  if not exists (
    select 1 from pg_temp.preflight_162_reporte where orden = 1 and resultado like '%homónimo%'
  ) then
    raise exception 'ESC3 HOMÓNIMO: la fila 1 no reportó el homónimo como aviso informativo';
  end if;
end $$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 4 — TABLA BASE AUSENTE (RENAME dentro de la transacción, no DROP):
-- preflight BLOQUEADO SIN error SQL y conteos NULL (entró por el else del do).
-- El `\i` llega hasta aquí → no hubo "relation does not exist".
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 4 — tabla base ausente (rename) → BLOQUEADO sin error SQL ──'
begin;

alter table public.tarifario_resultado rename to tarifario_resultado_scratch;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

do $$
begin
  if (select veredicto_final from pg_temp.preflight_162_reporte limit 1) not like 'BLOQUEADO%' then
    raise exception 'ESC4 TABLA AUSENTE: veredicto esperado BLOQUEADO (got %)',
      (select veredicto_final from pg_temp.preflight_162_reporte limit 1);
  end if;
  if not exists (select 1 from pg_temp.preflight_162_reporte where orden = 3 and bloqueante) then
    raise exception 'ESC4 TABLA AUSENTE: la fila 3 (tabla base) debe marcar bloqueante';
  end if;
  -- Conteos NULL ⇒ el do tomó el else ⇒ no abortó en el execute.
  if (select filas_totales is not null from pg_temp.preflight_162_conteos) then
    raise exception 'ESC4 TABLA AUSENTE: conteos calculados pese a tabla ausente (¿abortó o fue parcial?)';
  end if;
end $$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 5 — COLUMNA NO del GROUP BY ausente (descripcion): preflight
-- BLOQUEADO; la fila 4 (columnas) debe marcar bloqueante; conteos NULL.
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 5 — columna no-GROUP-BY ausente → BLOQUEADO ────────'
begin;

alter table public.tarifario_resultado rename column descripcion to descripcion_scratch;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

do $$
begin
  if (select veredicto_final from pg_temp.preflight_162_reporte limit 1) not like 'BLOQUEADO%' then
    raise exception 'ESC5 COLUMNA FALTA: veredicto esperado BLOQUEADO (got %)',
      (select veredicto_final from pg_temp.preflight_162_reporte limit 1);
  end if;
  if not exists (select 1 from pg_temp.preflight_162_reporte where orden = 4 and bloqueante) then
    raise exception 'ESC5 COLUMNA FALTA: la fila 4 (columnas) debe marcar bloqueante';
  end if;
  if (select filas_totales is not null from pg_temp.preflight_162_conteos) then
    raise exception 'ESC5 COLUMNA FALTA: conteos calculados pese a columna ausente';
  end if;
end $$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 6 — COLUMNA DEL GROUP BY ausente (moneda): el caso que exige el
-- `execute` condicional. Sin él, la lectura `group by moneda` abortaría en
-- parseo. Con él: BLOQUEADO SIN error SQL (el `\i` llega hasta el DO).
-- ═════════════════════════════════════════════════════════════════════════
\echo '════════ ESCENARIO 6 — columna DEL GROUP BY ausente → BLOQUEADO sin error SQL ──'
begin;

alter table public.tarifario_resultado rename column moneda to moneda_scratch;

\i supabase/scripts/preflight_162_tarifario_resumen.sql

do $$
begin
  if (select veredicto_final from pg_temp.preflight_162_reporte limit 1) not like 'BLOQUEADO%' then
    raise exception 'ESC6 GROUPBY FALTA: veredicto esperado BLOQUEADO (got %)',
      (select veredicto_final from pg_temp.preflight_162_reporte limit 1);
  end if;
  if not exists (select 1 from pg_temp.preflight_162_reporte where orden = 4 and bloqueante) then
    raise exception 'ESC6 GROUPBY FALTA: la fila 4 (columnas) debe marcar bloqueante';
  end if;
  if (select filas_totales is not null from pg_temp.preflight_162_conteos) then
    raise exception 'ESC6 GROUPBY FALTA: conteos calculados pese a columna del group by ausente';
  end if;
end $$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════
-- ESCENARIO 7 — POSTCHECK: orden de columnas invertido en la vista creada. El
-- verificar debe materializar pg_temp.postcheck_162_reporte con la fila A
-- (definición/orden) en pass=false y veredicto FAILED. Se crea la vista con
-- descripcion/recargo_individual intercambiadas de POSICIÓN.
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
    -- ⚠️ DEFECTO A DETECTAR: posiciones 30 y 31 intercambiadas (la 30 debe ser
    -- descripcion, la 31 recargo_individual). El postcheck verifica nombre Y
    -- ordinal_position.
    min(tipo_tarifa)        as recargo_individual,   -- posición 30 (esperada: descripcion)
    min(recargo_individual) as descripcion,          -- posición 31 (esperada: recargo_individual)
    min(descripcion)        as tipo_tarifa           -- posición 32
  from public.tarifario_resultado
  where paquete_activo = true
  group by
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda;

grant select on public.tarifario_resumen to anon, authenticated;

\i supabase/scripts/verificar_162_tarifario_resumen.sql

do $$
begin
  if not exists (select 1 from pg_temp.postcheck_162_reporte where orden = 1 and not pass) then
    raise exception 'ESC7 POSTCHECK: la fila A (definición/orden) debe marcar pass=false';
  end if;
  if (select veredicto_final from pg_temp.postcheck_162_reporte limit 1) not like 'FAILED%' then
    raise exception 'ESC7 POSTCHECK: veredicto esperado FAILED (got %)',
      (select veredicto_final from pg_temp.postcheck_162_reporte limit 1);
  end if;
end $$;

rollback;

\echo '════════ FIN test_162_preflight_bloqueos.sql — todos los escenarios pasaron ════════'
\echo '   Si la prueba llegó hasta aquí sin excepción, cada veredicto coincidió'
\echo '   con lo esperado (E1 OK / E2 BLOQUEADO / E3 OK / E4 BLOQUEADO /'
\echo '   E5 BLOQUEADO / E6 BLOQUEADO / E7 FAILED). Ningún objeto ni fila de'
\echo '   prueba debe quedar (todas las transacciones hacen rollback).'
