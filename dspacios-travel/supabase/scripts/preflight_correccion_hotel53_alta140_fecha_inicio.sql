-- ─────────────────────────────────────────────────────────────────────────
-- PREFLIGHT (solo lectura, UNA consulta) · corrección de UNA fecha: hotel 53, vigencia ALTA id 140
-- Decisión del dueño: el inicio del rango debía ser 2026-12-24; «0206-12-24» es un error de captura.
-- Esta es la ÚNICA corrección incluida. No corrige el hotel 9 (pendiente de confirmar) ni ninguna otra fila.
-- Pegar COMPLETA en el editor SQL. Si el veredicto no es «LISTO PARA CORREGIR», NO aplicar la corrección.
-- ─────────────────────────────────────────────────────────────────────────
with v as (select * from public.hotel_temporadas where id = 140),
r as (select e from v, jsonb_array_elements(case when jsonb_typeof(v.rangos) = 'array' then v.rangos else '[]'::jsonb end) e),
controles as (
  select 1 as n, 'La fila id=140 existe y es del hotel 53 con nombre ALTA' as control,
         (select count(*) from v where hotel_id = 53 and nombre = 'ALTA')::text as observado, '1' as esperado
  union all
  select 2, 'La columna fecha_inicio vale exactamente 0206-12-24',
         coalesce((select fecha_inicio::text from v), 'NO EXISTE'), '0206-12-24'
  union all
  select 3, 'La columna fecha_fin vale exactamente 2027-01-03',
         coalesce((select fecha_fin::text from v), 'NO EXISTE'), '2027-01-03'
  union all
  select 4, 'rangos contiene exactamente UN elemento {0206-12-24 → 2027-01-03}',
         (select count(*) from r where e->>'fecha_inicio' = '0206-12-24' and e->>'fecha_fin' = '2027-01-03')::text, '1'
  union all
  select 5, 'Ningún OTRO elemento de rangos empieza por 0206 (la corrección no toca nada más)',
         (select count(*) from r where e->>'fecha_inicio' like '0206-%' and not (e->>'fecha_inicio' = '0206-12-24' and e->>'fecha_fin' = '2027-01-03'))::text, '0'
  union all
  select 6, 'Número total de elementos en rangos (informativo; se conservan todos y su orden)',
         (select count(*) from r)::text, 'informativo'
  union all
  select 7, 'No hay otra fila ALTA en el hotel 53 que pueda confundirse con esta',
         (select count(*) from public.hotel_temporadas where hotel_id = 53 and nombre = 'ALTA')::text, '1'
  union all
  select 8, 'Fila completa tal como está hoy (para guardar como evidencia)',
         coalesce((select to_jsonb(v)::text from v), 'NO EXISTE'), 'informativo'
)
select n as orden, control, observado, esperado,
       case when esperado = 'informativo' then 'INFO' when observado = esperado then 'OK' else 'NO COINCIDE' end as estado
from controles
union all
select 99, 'VEREDICTO', '',
       '',
       case when (select count(*) from controles where esperado <> 'informativo' and observado <> esperado) = 0 then 'LISTO PARA CORREGIR' else 'NO APLICAR' end
order by orden;
