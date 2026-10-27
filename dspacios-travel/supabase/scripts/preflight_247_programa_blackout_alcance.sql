-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 247 (PR #409: alcance de los blackouts de un programa y guardado atómico). SOLO LECTURA. Correr ANTES de aplicar la 247
-- y DESPUÉS de la 244/245/246. Una sola consulta: todos los controles como filas (control · valor · esperado · estado). OK = cumple · REVISAR = no aplicar la
-- 247 hasta entenderlo · INFO = dato. Compatible con el SQL Editor de Supabase (una sentencia).
-- ───────────────────────────────────────────────────────────────────────────
with
cols as (
  select c.table_name, c.column_name from information_schema.columns c where c.table_schema = 'public'
),
controles as (
  select 1 as orden, 'PostgreSQL >= 15'::text as control, current_setting('server_version_num') as valor, '>= 150000'::text as esperado,
         case when current_setting('server_version_num')::int >= 150000 then 'OK' else 'REVISAR' end as estado
  union all
  select 10, 'la 245 está aplicada (programas.proveedor_asistencia_id existe)',
         case when exists (select 1 from cols where table_name = 'programas' and column_name = 'proveedor_asistencia_id') then 'existe' else 'falta' end, 'existe',
         case when exists (select 1 from cols where table_name = 'programas' and column_name = 'proveedor_asistencia_id') then 'OK' else 'REVISAR' end
  union all
  select 16, 'la 246 está aplicada (programa_dias.tipo_tramo existe)',
         case when exists (select 1 from cols where table_name = 'programa_dias' and column_name = 'tipo_tramo') then 'existe' else 'falta' end, 'existe',
         case when exists (select 1 from cols where table_name = 'programa_dias' and column_name = 'tipo_tramo') then 'OK' else 'REVISAR' end
  union all
  select 11, 'tabla public.programa_blackouts',
         case when to_regclass('public.programa_blackouts') is not null then 'existe' else 'falta' end, 'existe',
         case when to_regclass('public.programa_blackouts') is not null then 'OK' else 'REVISAR' end
  union all
  select 12, 'tabla public.programas', case when to_regclass('public.programas') is not null then 'existe' else 'falta' end, 'existe',
         case when to_regclass('public.programas') is not null then 'OK' else 'REVISAR' end
  union all
  select 13, 'programa_blackouts tiene fecha_inicio, fecha_fin, motivo y ciudad',
         (select count(*)::text from cols where table_name = 'programa_blackouts' and column_name in ('fecha_inicio', 'fecha_fin', 'motivo', 'ciudad')), '4',
         case when (select count(*) from cols where table_name = 'programa_blackouts' and column_name in ('fecha_inicio', 'fecha_fin', 'motivo', 'ciudad')) = 4 then 'OK' else 'REVISAR' end
  union all
  select 14, 'RLS activada en programa_blackouts',
         case when to_regclass('public.programa_blackouts') is null then 'n/d'
              when (select relrowsecurity from pg_class where oid = 'public.programa_blackouts'::regclass) then 'activa' else 'apagada' end, 'activa',
         case when to_regclass('public.programa_blackouts') is not null and (select relrowsecurity from pg_class where oid = 'public.programa_blackouts'::regclass) then 'OK' else 'REVISAR' end
  union all
  select 20, 'la columna programa_blackouts.alcance aún NO existe',
         case when exists (select 1 from cols where table_name = 'programa_blackouts' and column_name = 'alcance') then 'ya existe' else 'no existe' end, 'no existe',
         case when exists (select 1 from cols where table_name = 'programa_blackouts' and column_name = 'alcance') then 'REVISAR' else 'OK' end
  union all
  select 21, 'la restricción programa_blackouts_alcance_chk aún NO existe',
         case when exists (select 1 from pg_constraint where conname = 'programa_blackouts_alcance_chk') then 'ya existe' else 'no existe' end, 'no existe',
         case when exists (select 1 from pg_constraint where conname = 'programa_blackouts_alcance_chk') then 'REVISAR' else 'OK' end
  union all
  select 22, 'la restricción programa_blackouts_extremos_chk aún NO existe',
         case when exists (select 1 from pg_constraint where conname = 'programa_blackouts_extremos_chk') then 'ya existe' else 'no existe' end, 'no existe',
         case when exists (select 1 from pg_constraint where conname = 'programa_blackouts_extremos_chk') then 'REVISAR' else 'OK' end
  union all
  select 23, 'la función guardar_programa_blackouts aún NO existe',
         case when to_regprocedure('public.guardar_programa_blackouts(bigint, jsonb)') is not null then 'ya existe' else 'no existe' end, 'no existe',
         case when to_regprocedure('public.guardar_programa_blackouts(bigint, jsonb)') is not null then 'REVISAR' else 'OK' end
  union all
  select 30, 'INFO blackouts cargados (todos quedarán con alcance «entrada», sin tocarlos)',
         case when to_regclass('public.programa_blackouts') is null then 'n/d' else (select count(*)::text from public.programa_blackouts) end, 'dato', 'INFO'
  union all
  select 31, 'INFO blackouts con un solo extremo (siguen sin bloquear; la 247 no los cambia: corregirlos a mano)',
         case when to_regclass('public.programa_blackouts') is null then 'n/d'
              else (select count(*)::text from public.programa_blackouts where fecha_inicio is null or fecha_fin is null) end, 'dato', 'INFO'
  union all
  select 32, 'INFO blackouts con inicio posterior al fin (siguen sin bloquear; corregirlos a mano)',
         case when to_regclass('public.programa_blackouts') is null then 'n/d'
              else (select count(*)::text from public.programa_blackouts where fecha_inicio > fecha_fin) end, 'dato', 'INFO'
  union all
  select 24, 'la función guardar_programa_dias aún NO existe',
         case when to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)') is not null then 'ya existe' else 'no existe' end, 'no existe',
         case when to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)') is not null then 'REVISAR' else 'OK' end
  union all
  select 25, 'la función itinerario_programa_problema aún NO existe',
         case when to_regprocedure('public.itinerario_programa_problema(bigint, integer)') is not null then 'ya existe' else 'no existe' end, 'no existe',
         case when to_regprocedure('public.itinerario_programa_problema(bigint, integer)') is not null then 'REVISAR' else 'OK' end
  union all
  select 26, 'los triggers de itinerario publicado aún NO existen',
         (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgname in ('trg_programa_dias_itinerario_publicado', 'trg_programas_itinerario_publicado', 'trg_programas_traslado_posterior')), '0',
         case when (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('trg_programa_dias_itinerario_publicado', 'trg_programas_itinerario_publicado', 'trg_programas_traslado_posterior')) = 0 then 'OK' else 'REVISAR' end
  union all
  select 27, 'la función bloquear_itinerario_programa aún NO existe',
         case when to_regprocedure('public.bloquear_itinerario_programa(bigint)') is not null then 'ya existe' else 'no existe' end, 'no existe',
         case when to_regprocedure('public.bloquear_itinerario_programa(bigint)') is not null then 'REVISAR' else 'OK' end
  union all
  select 15, 'tabla public.programa_dias con programa_id, dia (la 247 valida el itinerario con ellas)',
         (select count(*)::text from cols where table_name = 'programa_dias' and column_name in ('programa_id', 'dia')), '2',
         case when (select count(*) from cols where table_name = 'programa_dias' and column_name in ('programa_id', 'dia')) = 2 then 'OK' else 'REVISAR' end
  union all
  select 33, 'INFO programas PUBLICADOS con itinerario incompleto (la 247 no los toca; para EDITAR sus días o su total habrá que completarlos o despublicarlos: ver inventario_programas_itinerario_247.sql)',
         case when to_regclass('public.programas') is null or to_regclass('public.programa_dias') is null then 'n/d'
              else (select count(*)::text from public.programas p
                     where p.publicado
                       and (p.dias is null or p.dias < 1
                            or exists (select 1 from generate_series(1, greatest(p.dias, 0)) g where not exists (select 1 from public.programa_dias d where d.programa_id = p.id and d.tipo_tramo = 'dia' and d.dia = g))
                            or exists (select 1 from public.programa_dias d where d.programa_id = p.id and d.tipo_tramo = 'dia' and (d.dia < 1 or d.dia > p.dias))
                            or exists (select 1 from public.programa_dias d where d.programa_id = p.id and d.tipo_tramo = 'dia' group by d.dia having count(*) > 1))) end,
         'dato', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
