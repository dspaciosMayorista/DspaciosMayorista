-- Preflight 179 — SOLO LECTURA. Corre ANTES de aplicar la migración 179.
-- Objetivo: confirmar que no hay nada que la migración pudiera romper (es
-- puramente aditiva: columnas + función) y dimensionar cuántas filas de
-- tarifa_hotel existen hoy (todas quedarán con precio_final_autoritativo =
-- false, sin backfill).
--
-- ⚠️ Las migraciones 177 y 178 YA ESTÁN APLICADAS Y VERIFICADAS en el entorno
-- remoto (confirmado por el dueño) — este preflight es SOLO para la 179.
--
-- Paso 1 de 4 del orden OBLIGATORIO de despliegue — ver la cabecera de
-- 20260601000179_tarifa_hotel_precio_final_autoritativo.sql: preflight (este
-- script, REMOTO) → 179 (REMOTO) → postcheck (REMOTO) → recién ahí desplegar
-- el código. `generarTarifasDubai`/`generarTarifasCalculadora` intentan
-- escribir las columnas nuevas y llamar al RPC
-- `reemplazar_tarifas_hotel_calculadora`, y el motor de liquidación las
-- selecciona explícitamente — desplegar el código antes de la migración
-- rompe "Generar tarifas" (todos los hoteles con calculadora) y las
-- consultas de tarifa neta de CUALQUIER hotel persona (no solo Dubai), mismo
-- patrón que la 177.

-- 1) Las columnas NO deben existir todavía.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifa_hotel'
  and column_name in ('precio_final_autoritativo', 'temporada_base');
-- Esperado: 0 filas.

-- 2) Volumen de filas afectadas (todas quedarán en `precio_final_autoritativo
--    = false` / `temporada_base = null` tras la migración).
select count(*) as total_filas_tarifa_hotel from public.tarifa_hotel;

-- 3) Confirmar que no hay ningún CHECK previo con el mismo nombre EN ESTA
--    TABLA. Filtrado por `conrelid`: el nombre de un constraint es único por
--    tabla en Postgres, no global.
select conname
from pg_constraint
where conrelid = 'public.tarifa_hotel'::regclass
  and conname = 'tarifa_hotel_temporada_base_solo_si_final_check';
-- Esperado: 0 filas.

-- 4) La función del RPC transaccional no debe existir todavía (evita un
--    "ya existe con otra firma" inesperado).
select proname, pg_get_function_identity_arguments(oid) as argumentos
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'reemplazar_tarifas_hotel_calculadora';
-- Esperado: 0 filas.

-- 5) Confirmar que `mi_rol()` existe (la función del RPC depende de ella para
--    el candado de rol — debe existir de migraciones anteriores).
select proname
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'mi_rol';
-- Esperado: 1 fila.
