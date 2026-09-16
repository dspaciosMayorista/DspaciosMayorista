-- Preflight 180 — SOLO LECTURA. Corre ANTES de aplicar la migración 180.
--
-- Paso 1 de 3: preflight (este script, REMOTO) → 180 (REMOTO) → postcheck
-- (REMOTO) → recién ahí desplegar el código. `generarTarifario` (app/
-- (dashboard)/dashboard/paquetes/actions.ts, vía lib/tarifario/
-- procedenciaTarifario.ts) intenta escribir las 5 columnas nuevas en cada
-- insert de `tarifario_resultado` — desplegar ese código antes de la
-- migración rompe "Generar tarifario" para CUALQUIER paquete.

-- 1) Las 5 columnas NO deben existir todavía.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifario_resultado'
  and column_name in ('temporada_ganadora', 'es_promocion', 'precio_final_autoritativo', 'procedencia_temporadas', 'procedencia_mixta');
-- Esperado: 0 filas.

-- 2) Volumen de filas afectadas (todas quedarán sin procedencia tras la
--    migración — sin backfill, se pueblan al regenerar el tarifario).
select count(*) as total_filas_tarifario_resultado from public.tarifario_resultado;

-- 3) Confirmar la policy de lectura pública existente (no debe cambiar —
--    esta migración no toca RLS, solo documenta que sigue así).
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'tarifario_resultado' and policyname = 'tarifario_resultado: lectura';
-- Esperado: 1 fila, cmd = SELECT, qual = 'true'.

-- 4) Confirmar que no hay ya constraints con estos nombres en esta tabla.
select conname
from pg_constraint
where conrelid = 'public.tarifario_resultado'::regclass
  and conname in (
    'tarifario_resultado_procedencia_es_arreglo_check',
    'tarifario_resultado_procedencia_elementos_validos_check',
    'tarifario_resultado_procedencia_no_vacia_check',
    'tarifario_resultado_procedencia_estado_check'
  );
-- Esperado: 0 filas.

-- 5) Confirmar que no existen ya las funciones helper (idempotencia real:
--    `create or replace function` no falla si ya existen, pero si YA
--    existieran con otra firma incompatible se quiere saber antes).
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('_procedencia_temporadas_elementos_validos', '_tarifario_resultado_procedencia_valida');
-- Esperado: 0 filas (o, si ya se corrió antes, las mismas 2 con la firma de
-- esta migración — `create or replace` las deja idénticas de todas formas).
