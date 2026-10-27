-- Solo lectura. Una consulta integral después de la 246.
with objetivo(id, dias) as (
  values (7::bigint, 5), (8::bigint, 5), (9::bigint, 5), (11::bigint, 6), (13::bigint, 3)
), forma as (
  select o.id, p.id is not null as existe,
         (select count(*) from public.programa_dias d where d.programa_id=o.id and d.tipo_tramo='traslado_previo' and d.dia=0) = 1
         and (select count(*) from public.programa_dias d where d.programa_id=o.id and d.tipo_tramo='dia' and d.dia between 1 and o.dias) = o.dias
         and (select count(distinct d.dia) from public.programa_dias d where d.programa_id=o.id) = o.dias + 1
         and (select count(*) from public.programa_dias d where d.programa_id=o.id) = o.dias + 1 as convertido
  from objetivo o left join public.programas p on p.id=o.id
), controles as (
  select 'programa_dias.tipo_tramo: text NOT NULL default dia'::text as control,
         coalesce((select data_type || '/' || is_nullable || '/' || column_default from information_schema.columns
                    where table_schema='public' and table_name='programa_dias' and column_name='tipo_tramo'), 'falta') as valor,
         'text/NO/dia'::text as esperado,
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_dias'
                           and column_name='tipo_tramo' and data_type='text' and is_nullable='NO' and column_default like '''dia''%')
              then 'OK' else 'REVISAR' end as estado
  union all
  select 'restricción de tipos presente y validada',
         (select coalesce(bool_and(convalidated), false)::text from pg_constraint where conrelid='public.programa_dias'::regclass and conname='programa_dias_tipo_tramo_chk'),
         'true',
         case when exists (select 1 from pg_constraint where conrelid='public.programa_dias'::regclass and conname='programa_dias_tipo_tramo_chk' and convalidated)
              then 'OK' else 'REVISAR' end
  union all
  select 'programas históricos presentes reclasificados',
         count(*) filter (where existe and convertido)::text || '/' || count(*) filter (where existe)::text,
         'todos',
         case when count(*) filter (where existe and not convertido)=0 then 'OK' else 'REVISAR' end
    from forma
  union all
  select 'otros programas con traslado (informativo)',
         (select count(*)::text from public.programa_dias where tipo_tramo <> 'dia' and programa_id not in (7,8,9,11,13)),
         'dato', 'INFO'
)
select control, valor, esperado, estado from controles;
