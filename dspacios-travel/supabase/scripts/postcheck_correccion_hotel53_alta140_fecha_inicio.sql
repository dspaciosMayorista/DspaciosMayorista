-- ─────────────────────────────────────────────────────────────────────────
-- POSTCHECK (solo lectura, UNA consulta) · después de correccion_hotel53_alta140_fecha_inicio.sql
-- ─────────────────────────────────────────────────────────────────────────
with v as (select * from public.hotel_temporadas where id = 140 and hotel_id = 53 and nombre = 'ALTA'),
r as (select e from v, jsonb_array_elements(case when jsonb_typeof(v.rangos) = 'array' then v.rangos else '[]'::jsonb end) e),
controles as (
  select 1 as n, 'La columna fecha_inicio vale 2026-12-24' as control, coalesce((select fecha_inicio::text from v), 'NO EXISTE') as observado, '2026-12-24' as esperado
  union all
  select 2, 'La columna fecha_fin sigue valiendo 2027-01-03', coalesce((select fecha_fin::text from v), 'NO EXISTE'), '2027-01-03'
  union all
  select 3, 'rangos contiene exactamente UN elemento {2026-12-24 → 2027-01-03}',
         (select count(*) from r where e->>'fecha_inicio' = '2026-12-24' and e->>'fecha_fin' = '2027-01-03')::text, '1'
  union all
  select 4, 'Ya no queda ningún elemento de rangos con año 0206',
         (select count(*) from r where e->>'fecha_inicio' like '0206-%' or e->>'fecha_fin' like '0206-%')::text, '0'
  union all
  select 5, 'La versión anterior quedó en el historial de vigencias (inicio 0206-12-24)',
         (select count(*) from public.hotel_temporadas_historial h
          where h.temporada_id = 140 and h.operacion = 'UPDATE' and h.datos->>'fecha_inicio' = '0206-12-24')::text, '1 o más'
  union all
  select 6, 'Fila completa tal como quedó (comparar con la evidencia del preflight: solo cambian fecha_inicio y rangos)',
         coalesce((select to_jsonb(v)::text from v), 'NO EXISTE'), 'informativo'
)
select n as orden, control, observado, esperado,
       case when esperado = 'informativo' then 'INFO'
            when esperado = '1 o más' then case when observado::int >= 1 then 'OK' else 'NO COINCIDE' end
            when observado = esperado then 'OK' else 'NO COINCIDE' end as estado
from controles
union all
select 99, 'VEREDICTO', '', '',
       case when (select count(*) from controles where esperado not in ('informativo', '1 o más') and observado <> esperado) = 0
                 and (select observado::int from controles where n = 5) >= 1 then 'CORRECCIÓN VERIFICADA' else 'REVISAR' end
order by orden;
