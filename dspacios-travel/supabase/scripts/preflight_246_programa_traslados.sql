-- Solo lectura. Una consulta integral antes de la 246.
with objetivo(id, dias, titulo) as (
  values (7::bigint, 5, 'Medellín - Villavicencio'::text),
         (8::bigint, 5, 'MEDELLIN - BUCARAMANGA'),
         (9::bigint, 5, 'MEDELLIN - BOYACA'),
         (11::bigint, 6, 'MEDELLIN - CALI'),
         (13::bigint, 3, 'MEDELLIN - NEIVA')
), forma as (
  select o.id, p.id is not null as existe,
         p.dias = o.dias as duracion_ok,
         (select count(*) from public.programa_dias d where d.programa_id = o.id) = o.dias + 1
           and (select count(distinct d.dia) from public.programa_dias d where d.programa_id = o.id) = o.dias + 1
           and (select min(d.dia) from public.programa_dias d where d.programa_id = o.id) = 1
           and (select max(d.dia) from public.programa_dias d where d.programa_id = o.id) = o.dias + 1
           and (select d.titulo from public.programa_dias d where d.programa_id = o.id and d.dia = 1 limit 1) = o.titulo as filas_ok
  from objetivo o left join public.programas p on p.id = o.id
), controles as (
  select 'la 245 está aplicada'::text as control,
         (to_regclass('public.contrato_programa_estancia_costo') is not null)::text as valor,
         'true'::text as esperado,
         case when to_regclass('public.contrato_programa_estancia_costo') is not null then 'OK' else 'REVISAR' end as estado
  union all
  select 'programa_dias.tipo_tramo aún no existe',
         (not exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_dias' and column_name='tipo_tramo'))::text,
         'true',
         case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_dias' and column_name='tipo_tramo') then 'OK' else 'REVISAR' end
  union all
  select 'objetos de la antigua 246 de blackouts ausentes (su trigger rechazaría dia=0)',
         (select coalesce(string_agg(x, ', ' order by x), 'ninguno') from (
            select 'programa_blackouts.alcance' x where exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_blackouts' and column_name='alcance')
            union all select 'guardar_programa_blackouts' where to_regprocedure('public.guardar_programa_blackouts(bigint,jsonb)') is not null
            union all select 'itinerario_programa_problema' where to_regprocedure('public.itinerario_programa_problema(bigint,integer)') is not null
            union all select 'guardar_programa_dias' where to_regprocedure('public.guardar_programa_dias(bigint,jsonb,integer)') is not null
            union all select 'trg_programa_dias_itinerario_publicado' where exists (select 1 from pg_trigger where tgname='trg_programa_dias_itinerario_publicado' and not tgisinternal)
            union all select 'trg_programas_itinerario_publicado' where exists (select 1 from pg_trigger where tgname='trg_programas_itinerario_publicado' and not tgisinternal)
          ) o),
         'ninguno',
         case when to_regprocedure('public.guardar_programa_blackouts(bigint,jsonb)') is null
               and to_regprocedure('public.itinerario_programa_problema(bigint,integer)') is null
               and to_regprocedure('public.guardar_programa_dias(bigint,jsonb,integer)') is null
               and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_blackouts' and column_name='alcance')
               and not exists (select 1 from pg_trigger where tgname in ('trg_programa_dias_itinerario_publicado','trg_programas_itinerario_publicado') and not tgisinternal)
              then 'OK' else 'REVISAR' end
  union all
  select 'programas históricos presentes (informativo)', count(*) filter (where existe)::text, '0 a 5', 'INFO' from forma
  union all
  select 'programas históricos presentes coinciden con el inventario auditado',
         count(*) filter (where existe and coalesce(duracion_ok and filas_ok, false))::text || '/' || count(*) filter (where existe)::text,
         'todos',
         case when count(*) filter (where existe and not coalesce(duracion_ok and filas_ok, false)) = 0 then 'OK' else 'REVISAR' end
  from forma
)
select control, valor, esperado, estado from controles;
