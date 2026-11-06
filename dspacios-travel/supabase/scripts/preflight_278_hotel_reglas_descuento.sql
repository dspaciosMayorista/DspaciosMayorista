-- PREFLIGHT 278 (#90) · SOLO LECTURA · una consulta: n · control · observado · esperado · estado. Pegar COMPLETA en el editor SQL.
-- Fila 99 = VEREDICTO: APTO solo si ninguna fila es FALLA.
with filas as (
  select 1 as n, 'la tabla hotel_reglas_descuento NO existe todavía' as control,
         (to_regclass('public.hotel_reglas_descuento') is not null)::text as observado, 'false' as esperado, to_regclass('public.hotel_reglas_descuento') is null as ok
  union all select 2, 'existen hoteles (FK) y hotel_temporadas',
         (to_regclass('public.hoteles') is not null and to_regclass('public.hotel_temporadas') is not null)::text, 'true',
         to_regclass('public.hoteles') is not null and to_regclass('public.hotel_temporadas') is not null
  union all select 3, 'existen mi_rol() y la puerta de catálogos globales (237)',
         (to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_escribir_catalogo_global()') is not null)::text, 'true',
         to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_escribir_catalogo_global()') is not null
)
select n, control, observado, esperado, case when ok then 'OK' else 'FALLA' end as estado from filas
union all select 99, 'VEREDICTO', case when bool_and(ok) then 'APTO' else 'DETENER' end, 'APTO', case when bool_and(ok) then 'OK' else 'FALLA' end from filas
order by n;
