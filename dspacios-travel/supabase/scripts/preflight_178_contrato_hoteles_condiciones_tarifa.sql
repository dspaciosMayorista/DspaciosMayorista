-- Preflight 178 — SOLO LECTURA. Corre ANTES de aplicar la migración 178.
-- Objetivo: confirmar que no hay nada que la migración pudiera romper (es
-- puramente aditiva) y dimensionar cuántas filas de contrato_hoteles existen
-- hoy (todas quedarán con la columna nueva en NULL — sin backfill).
--
-- ⚠️ Paso 1 de 4 del orden OBLIGATORIO de despliegue — ver la cabecera de
-- 20260601000178_contrato_hoteles_condiciones_tarifa.sql: preflight (este
-- script, REMOTO) → migración 178 (REMOTO) → postcheck (REMOTO) → recién ahí
-- desplegar el código. Alcance real: las 2 páginas de cotización nunca leen
-- `contrato_hoteles` (siguen igual). Las 2 páginas de contrato sí seleccionan
-- esta columna vía `select("*")`, pero el campo es opcional y la ausencia
-- física de la columna no rompe por sí sola esa selección/render. El riesgo
-- concreto es `convertirCotizacionCarrito`: su INSERT nombra explícitamente
-- `condiciones_tarifa` en cada hotel "persona" — desplegar ese código antes de
-- la migración bloquea (por columna inexistente) la conversión de
-- cotizaciones de carrito con al menos un hotel persona. Por eso se conserva
-- el orden SQL-antes-que-código.

-- 1) La columna NO debe existir todavía (si ya existe, la migración es un
--    no-op seguro por el `if not exists`, pero es bueno saberlo antes).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_hoteles'
  and column_name = 'condiciones_tarifa';
-- Esperado: 0 filas (columna nueva, todavía no existe).

-- 2) Volumen de filas afectadas (todas quedarán en NULL tras la migración —
--    ningún contrato existente gana condiciones retroactivas).
select count(*) as total_filas_contrato_hoteles from public.contrato_hoteles;

-- 3) Confirmar que no hay ningún CHECK previo con el mismo nombre EN ESTA
--    TABLA (evita un error de "constraint ya existe" con un cuerpo distinto
--    al esperado). Filtrado por `conrelid`: el nombre de un constraint es
--    único por tabla en Postgres, no global.
select conname
from pg_constraint
where conrelid = 'public.contrato_hoteles'::regclass
  and conname = 'contrato_hoteles_condiciones_tarifa_array_check';
-- Esperado: 0 filas.
