-- ───────────────────────────────────────────────────────────────────────────
-- CONSULTA PREVENTIVA (solo lectura) — correr en producción ANTES de aplicar
-- la migración 159, revisión posterior al PR #274, ítem 2 "DOBLE PREFIJO AL
-- RECICLAR MINORISTA".
--
-- POR QUÉ: `siguiente_numero_contrato_para_tenant('minorista')` (migración
-- 159) delega en `siguiente_numero_contrato()` y decide si antepone 'MIN-' o
-- no mirando si el valor devuelto YA empieza por 'MIN-'. Esa decisión
-- funciona para cualquier fila que ya exista hoy en
-- `numeros_contrato_liberados` — pero esta consulta sirve para CONFIRMARLO
-- con los datos reales de producción antes de aplicar la migración, no solo
-- de forma teórica: si aparece un formato que NO es ni 'MIN-...' ni
-- '00-NNNN' puro, hay que revisarlo a mano antes de continuar (la función
-- trataría cualquier cosa que no empiece por 'MIN-' como "crudo" y le
-- antepondría 'MIN-', lo cual solo es correcto si en efecto es un número sin
-- prefijar).
--
-- Esto es de SOLO LECTURA: no modifica nada. Sin INSERT/UPDATE/DELETE/DDL.
-- ───────────────────────────────────────────────────────────────────────────

select
  case
    when numero ~ '^MIN-'      then 'ya_prefijado_MIN'
    when numero ~ '^00-[0-9]+$' then 'crudo_00_NNNN (se le antepondrá MIN-)'
    else 'FORMATO_INESPERADO — revisar a mano antes de aplicar la 159'
  end as clasificacion,
  count(*) as cantidad,
  min(numero) as ejemplo_min,
  max(numero) as ejemplo_max
from public.numeros_contrato_liberados
group by 1
order by 1;
