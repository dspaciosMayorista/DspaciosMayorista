-- POSTCHECK 255 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto.
-- Pegar COMPLETA en el editor SQL de Supabase DESPUÉS de correr la migración 255, SIN envolver en begin/rollback.
-- Veredictos: OK · FALLA · INFO. La ÚLTIMA fila (n = 99) es el VEREDICTO GLOBAL. Si la 255 no está aplicada, cada control devuelve FALLA (no lanza error).
with
f as (
  select to_regclass('public.servicio_suplementos_franja') as rel
),
cols as (
  select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) as s
    from information_schema.columns where table_schema = 'public' and table_name = 'servicio_suplementos_franja'
),
p259 as (
  select count(*) as n from pg_proc p
   where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'),
                   to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'))
     and coalesce(p.proconfig, '{}'::text[]) @> array['statement_timeout=30s', 'lock_timeout=8s']::text[]
),
cons as (
  select (select count(*) from pg_constraint where conrelid = (select rel from f) and contype = 'p') as pk,
         (select count(*) from pg_constraint where conrelid = (select rel from f) and contype = 'f' and confrelid = to_regclass('public.servicio_temporadas') and confdeltype = 'c' and convalidated) as fk,
         (select count(*) from pg_constraint where conrelid = (select rel from f) and contype = 'c' and convalidated
            and conname in ('servicio_suplementos_franja_desde_chk', 'servicio_suplementos_franja_hasta_chk', 'servicio_suplementos_franja_distintas_chk',
                            'servicio_suplementos_franja_tramo_chk', 'servicio_suplementos_franja_tipo_chk', 'servicio_suplementos_franja_cobro_chk', 'servicio_suplementos_franja_valor_chk')) as chk
),
dyn as (
  -- Consultas dinámicas: solo se ejecutan si los objetos existen (CASE garantiza el orden); si no, devuelven un texto y el control da FALLA.
  select case when to_regprocedure('public.fn_franja_minutos(text)') is not null and to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is not null
              then (xpath('/row/r/text()', query_to_xml($q$select public.fn_franja_minutos('24:00')::text || ' / ' || public.fn_franja_contiene(1380, 1140, 360)::text || ',' || public.fn_franja_contiene(120, 1140, 360)::text || ',' || public.fn_franja_contiene(360, 1140, 360)::text || ',' || public.fn_franja_contiene(720, 1140, 360)::text as r$q$, false, true, '')))[1]::text else 'funciones ausentes' end as fn,
         case when to_regclass('public.servicio_suplementos_franja') is not null and to_regprocedure('public.fn_franja_minutos(text)') is not null and to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is not null
              then (xpath('/row/n/text()', query_to_xml($q$select count(*) as n from public.servicio_suplementos_franja a join public.servicio_suplementos_franja b on b.servicio_temporada_id = a.servicio_temporada_id and b.id > a.id and (a.tramo = 'ambos' or b.tramo = 'ambos' or a.tramo = b.tramo) where public.fn_franja_contiene(public.fn_franja_minutos(b.hora_desde), public.fn_franja_minutos(a.hora_desde), public.fn_franja_minutos(a.hora_hasta)) or public.fn_franja_contiene(public.fn_franja_minutos(a.hora_desde), public.fn_franja_minutos(b.hora_desde), public.fn_franja_minutos(b.hora_hasta))$q$, false, true, '')))[1]::text else 'n/a (tabla o funciones ausentes)' end as solapes,
         case when to_regclass('public.servicio_suplementos_franja') is not null
              then (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.servicio_suplementos_franja', false, true, '')))[1]::text else 'tabla ausente' end as filas
),
c as (
  select 1 as n, 'tabla servicio_suplementos_franja existe con RLS activa' as control,
         case when (select rel from f) is null then 'no existe' else 'existe; rls=' || (select relrowsecurity::text from pg_class where oid = (select rel from f)) end as observado,
         'existe; rls=true' as esperado,
         case when coalesce((select relrowsecurity from pg_class where oid = (select rel from f)), false) then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'columnas exactas (nombre:tipo:nulable, en orden)', coalesce((select s from cols), 'sin columnas'),
         'id:bigint:NO,servicio_temporada_id:bigint:NO,hora_desde:text:NO,hora_hasta:text:NO,tramo:text:NO,tipo:text:NO,valor:numeric:NO,cobro:text:NO,created_at:timestamp with time zone:NO',
         case when (select s from cols) = 'id:bigint:NO,servicio_temporada_id:bigint:NO,hora_desde:text:NO,hora_hasta:text:NO,tramo:text:NO,tipo:text:NO,valor:numeric:NO,cobro:text:NO,created_at:timestamp with time zone:NO' then 'OK' else 'FALLA' end
  union all
  select 3, 'restricciones: PK, FK a servicio_temporadas ON DELETE CASCADE y los 7 CHECK nombrados, todas validadas',
         'pk=' || (select pk from cons) || ' fk_cascade=' || (select fk from cons) || ' checks=' || (select chk from cons), 'pk=1 fk_cascade=1 checks=7',
         case when (select pk from cons) = 1 and (select fk from cons) = 1 and (select chk from cons) = 7 then 'OK' else 'FALLA' end
  union all
  select 4, 'índice idx_servicio_suplementos_franja_temporada sobre servicio_temporada_id',
         (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'servicio_suplementos_franja' and indexname = 'idx_servicio_suplementos_franja_temporada')::text, '1',
         case when (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'servicio_suplementos_franja' and indexname = 'idx_servicio_suplementos_franja_temporada') = 1 then 'OK' else 'FALLA' end
  union all
  select 5, 'trigger de solape: BEFORE INSERT OR UPDATE FOR EACH ROW, habilitado (tgtype=23, tgenabled=O)',
         coalesce((select t.tgtype::text || '/' || t.tgenabled::text from pg_trigger t where t.tgrelid = (select rel from f) and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal), 'ausente'), '23/O',
         case when exists (select 1 from pg_trigger t where t.tgrelid = (select rel from f) and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal and t.tgtype = 23 and t.tgenabled = 'O') then 'OK' else 'FALLA' end
  union all
  select 6, 'policy única FOR ALL restringida a superadmin, gerencia, administracion y operaciones',
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja')::text || ' policy · cmd=' ||
         coalesce((select string_agg(cmd, ',') from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja'), '-') || ' · roles en qual=' ||
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja' and qual like '%superadmin%' and qual like '%gerencia%' and qual like '%administracion%' and qual like '%operaciones%')::text,
         '1 policy · cmd=ALL · roles en qual=1',
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja') = 1
               and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja' and cmd = 'ALL' and qual like '%superadmin%' and qual like '%gerencia%' and qual like '%administracion%' and qual like '%operaciones%') = 1 then 'OK' else 'FALLA' end
  union all
  select 7, 'privilegios: anon sin ninguno; authenticated y service_role con select e insert',
         case when (select rel from f) is null then 'tabla ausente' else
           'anon=' || has_table_privilege('anon', (select rel from f), 'select,insert,update,delete')::text ||
           ' auth=' || (has_table_privilege('authenticated', (select rel from f), 'select') and has_table_privilege('authenticated', (select rel from f), 'insert'))::text ||
           ' service=' || (has_table_privilege('service_role', (select rel from f), 'select') and has_table_privilege('service_role', (select rel from f), 'insert'))::text end,
         'anon=false auth=true service=true',
         case when (select rel from f) is not null and not has_table_privilege('anon', (select rel from f), 'select,insert,update,delete')
               and has_table_privilege('authenticated', (select rel from f), 'select') and has_table_privilege('authenticated', (select rel from f), 'insert')
               and has_table_privilege('service_role', (select rel from f), 'select') and has_table_privilege('service_role', (select rel from f), 'insert') then 'OK' else 'FALLA' end
  union all
  select 8, 'funciones de apoyo: 2 inmutables con search_path fijo; la del trigger sin EXECUTE para anon/authenticated',
         'minutos=' || coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('public.fn_franja_minutos(text)')), '-') ||
         ' contiene=' || coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('public.fn_franja_contiene(integer,integer,integer)')), '-') ||
         ' sp=' || (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.fn_franja_minutos(text)'), to_regprocedure('public.fn_franja_contiene(integer,integer,integer)'), to_regprocedure('public.tg_servicio_suplementos_franja_solape()')) and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[])::text ||
         ' tg_anon_auth=' || coalesce((has_function_privilege('anon', to_regprocedure('public.tg_servicio_suplementos_franja_solape()')::oid, 'execute') or has_function_privilege('authenticated', to_regprocedure('public.tg_servicio_suplementos_franja_solape()')::oid, 'execute'))::text, 'ausente'),
         'minutos=i contiene=i sp=3 tg_anon_auth=false',
         case when (select provolatile from pg_proc where oid = to_regprocedure('public.fn_franja_minutos(text)')) = 'i'
               and (select provolatile from pg_proc where oid = to_regprocedure('public.fn_franja_contiene(integer,integer,integer)')) = 'i'
               and (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.fn_franja_minutos(text)'), to_regprocedure('public.fn_franja_contiene(integer,integer,integer)'), to_regprocedure('public.tg_servicio_suplementos_franja_solape()')) and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[]) = 3
               and to_regprocedure('public.tg_servicio_suplementos_franja_solape()') is not null
               and not (has_function_privilege('anon', to_regprocedure('public.tg_servicio_suplementos_franja_solape()')::oid, 'execute') or has_function_privilege('authenticated', to_regprocedure('public.tg_servicio_suplementos_franja_solape()')::oid, 'execute')) then 'OK' else 'FALLA' end
  union all
  select 9, 'comportamiento de las funciones: 24:00 = 1440; la franja 19:00-06:00 contiene 23:00 y 02:00 pero no 06:00 ni 12:00',
         (select fn from dyn), '1440 / true,true,false,false',
         case when (select fn from dyn) = '1440 / true,true,false,false' then 'OK' else 'FALLA' end
  union all
  select 10, 'ninguna pareja de franjas existentes se solapa dentro de su vigencia (tabla vacía = 0)',
         (select solapes from dyn), '0',
         case when (select solapes from dyn) = '0' then 'OK' else 'FALLA' end
  union all
  select 11, 'la 259 sigue intacta (2 entradas con statement_timeout=30s y lock_timeout=8s)', (select n from p259)::text, '2', case when (select n from p259) = 2 then 'OK' else 'FALLA' end
  union all
  select 12, 'filas en servicio_suplementos_franja (recién aplicada = 0; solo informa)',
         (select filas from dyn), '0 recién aplicada', 'INFO'
  union all
  select 13, 'filas de servicio_temporadas / servicios_adicionales: DEBEN ser iguales a las del preflight (la 255 no las toca)',
         (select count(*) from public.servicio_temporadas)::text || ' / ' || (select count(*) from public.servicios_adicionales)::text, 'igual al preflight', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'controles con problema: ' || (select count(*) from c where veredicto = 'FALLA')::text, '0',
       case when (select count(*) from c where veredicto = 'FALLA') = 0 then 'MIGRACIÓN 255 VERIFICADA (falta comparar la fila 13 con el preflight)' else 'FALLA: NO CONTINUAR A LA 256' end
order by n;
