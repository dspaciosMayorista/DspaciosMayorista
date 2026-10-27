-- ───────────────────────────────────────────────────────────────────────────
-- INVENTARIO previo al despliegue del PR #409: programas PUBLICADOS cuyo itinerario no trae exactamente los días 1..N (N = programas.dias), sin faltantes,
-- repetidos ni fuera de rango. SOLO LECTURA, una sola consulta (compatible con el SQL Editor de Supabase).
--
-- Desde el PR #409 un programa con itinerario incompleto NO se puede calcular, publicar ni reservar. Los que hoy están publicados siguen visibles, pero su
-- reserva se rechazará hasta completar el itinerario: este listado dice cuáles son para arreglarlos ANTES de desplegar. Estado: INCOMPLETO (corregir) | OK.
-- ───────────────────────────────────────────────────────────────────────────
with
dias_prog as (
  select d.programa_id, array_agg(d.dia order by d.dia) as presentes, count(*) as cargados
    from public.programa_dias d group by d.programa_id
),
repetidos as (
  select r.programa_id, string_agg(r.dia::text, ',' order by r.dia) as dias
    from (select programa_id, dia from public.programa_dias group by programa_id, dia having count(*) > 1) r
   group by r.programa_id
),
evaluado as (
  select p.id, p.nombre, p.publicado, p.activo, p.modo_precio, p.dias as dias_programa, coalesce(dp.cargados, 0) as dias_cargados,
         case when p.dias is null or p.dias < 1 then null
              else (select string_agg(g::text, ',' order by g) from generate_series(1, p.dias) g where g <> all (coalesce(dp.presentes, '{}'::int[]))) end as faltantes,
         rp.dias as repetidos,
         (select string_agg(x::text, ',' order by x) from unnest(coalesce(dp.presentes, '{}'::int[])) x where p.dias is null or x < 1 or x > p.dias) as fuera_de_rango
    from public.programas p
    left join dias_prog dp on dp.programa_id = p.id
    left join repetidos rp on rp.programa_id = p.id
   where p.publicado
)
select e.id as programa_id, e.nombre, e.modo_precio, e.activo, e.dias_programa, e.dias_cargados,
       case when e.dias_programa is null or e.dias_programa < 1 then 'sin días en la cabecera' else coalesce(e.faltantes, '') end as dias_faltantes,
       coalesce(e.repetidos, '') as dias_repetidos,
       coalesce(e.fuera_de_rango, '') as dias_fuera_de_rango,
       case when e.dias_programa is null or e.dias_programa < 1 or e.faltantes is not null or e.repetidos is not null or e.fuera_de_rango is not null
            then 'INCOMPLETO' else 'OK' end as estado
  from evaluado e
 order by (case when e.dias_programa is null or e.dias_programa < 1 or e.faltantes is not null or e.repetidos is not null or e.fuera_de_rango is not null then 0 else 1 end), e.id;
