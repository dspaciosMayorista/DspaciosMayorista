-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 246 (PR #409: alcance de los blackouts de un programa y guardado atómico). SOLO LECTURA. Correr DESPUÉS de aplicar la 246.
-- Una sola consulta (control · valor · esperado · estado OK/REVISAR/INFO). Si la 246 NO está aplicada marca REVISAR (no falla).
-- ───────────────────────────────────────────────────────────────────────────
with
col as (
  select c.data_type, c.is_nullable, c.column_default
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'programa_blackouts' and c.column_name = 'alcance'
),
chk as (
  select c.conname, c.convalidated, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
   where c.conrelid = 'public.programa_blackouts'::regclass and c.conname in ('programa_blackouts_alcance_chk', 'programa_blackouts_extremos_chk')
),
fn as (
  select p.oid, p.prosecdef, p.proconfig
    from pg_proc p where p.oid = to_regprocedure('public.guardar_programa_blackouts(bigint, jsonb)')
),
controles as (
  select 10 as orden, 'columna programa_blackouts.alcance'::text as control,
         coalesce((select data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-') from col), 'falta') as valor,
         'text null=NO default=''entrada''::text'::text as esperado,
         case when exists (select 1 from col where data_type = 'text' and is_nullable = 'NO' and column_default like '''entrada''%') then 'OK' else 'REVISAR' end as estado
  union all
  select 11, 'alcance_chk: solo entrada o viaje (validada sobre las filas existentes)',
         coalesce((select def || case when convalidated then ' · validada' else ' · NO validada' end from chk where conname = 'programa_blackouts_alcance_chk'), 'falta'),
         'alcance in (entrada, viaje) · validada',
         case when exists (select 1 from chk where conname = 'programa_blackouts_alcance_chk' and convalidated and def like '%entrada%' and def like '%viaje%') then 'OK' else 'REVISAR' end
  union all
  select 12, 'extremos_chk: ambos extremos e inicio <= fin (NOT VALID: solo filas nuevas o modificadas)',
         coalesce((select def || case when convalidated then ' · validada' else ' · NOT VALID' end from chk where conname = 'programa_blackouts_extremos_chk'), 'falta'),
         'fecha_inicio y fecha_fin no nulos, inicio <= fin · NOT VALID',
         case when exists (select 1 from chk where conname = 'programa_blackouts_extremos_chk' and not convalidated and def like '%fecha_inicio <= fecha_fin%') then 'OK' else 'REVISAR' end
  union all
  select 20, 'función guardar_programa_blackouts(bigint, jsonb)', case when exists (select 1 from fn) then 'existe' else 'falta' end, 'existe',
         case when exists (select 1 from fn) then 'OK' else 'REVISAR' end
  union all
  select 21, 'la función respeta la RLS de quien llama (SECURITY INVOKER)',
         coalesce((select case when prosecdef then 'security definer' else 'security invoker' end from fn), 'n/d'), 'security invoker',
         case when exists (select 1 from fn where not prosecdef) then 'OK' else 'REVISAR' end
  union all
  select 22, 'search_path fijado en la función',
         coalesce((select array_to_string(proconfig, ',') from fn), 'n/d'), 'search_path=public, pg_temp',
         case when exists (select 1 from fn where proconfig::text like '%search_path=public, pg_temp%') then 'OK' else 'REVISAR' end
  union all
  select 23, 'authenticated puede ejecutarla',
         case when exists (select 1 from fn) then has_function_privilege('authenticated', (select oid from fn), 'execute')::text else 'n/d' end, 'true',
         case when exists (select 1 from fn) and has_function_privilege('authenticated', (select oid from fn), 'execute') then 'OK' else 'REVISAR' end
  union all
  select 24, 'anon NO puede ejecutarla',
         case when exists (select 1 from fn) then has_function_privilege('anon', (select oid from fn), 'execute')::text else 'n/d' end, 'false',
         case when exists (select 1 from fn) and not has_function_privilege('anon', (select oid from fn), 'execute') then 'OK' else 'REVISAR' end
  union all
  select 30, 'filas con alcance fuera de entrada/viaje (debe ser 0)',
         case when exists (select 1 from col) then (select count(*)::text from public.programa_blackouts where alcance not in ('entrada', 'viaje')) else 'n/d' end, '0',
         case when exists (select 1 from col) and (select count(*) from public.programa_blackouts where alcance not in ('entrada', 'viaje')) = 0 then 'OK' else 'REVISAR' end
  union all
  select 40, 'función guardar_programa_dias(bigint, jsonb, integer) (SECURITY INVOKER, search_path fijo)',
         coalesce((select case when p.prosecdef then 'security definer' else 'security invoker' end || ' · ' || coalesce(array_to_string(p.proconfig, ','), '-')
                     from pg_proc p where p.oid = to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)')), 'falta'),
         'security invoker · search_path=public, pg_temp',
         case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)') and not p.prosecdef and p.proconfig::text like '%search_path=public, pg_temp%') then 'OK' else 'REVISAR' end
  union all
  select 41, 'función itinerario_programa_problema(bigint, integer)',
         case when to_regprocedure('public.itinerario_programa_problema(bigint, integer)') is not null then 'existe' else 'falta' end, 'existe',
         case when to_regprocedure('public.itinerario_programa_problema(bigint, integer)') is not null then 'OK' else 'REVISAR' end
  union all
  select 42, 'authenticated ejecuta guardar_programa_dias y anon NO',
         case when to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)') is null then 'n/d'
              else has_function_privilege('authenticated', to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)'), 'execute')::text || '/' || has_function_privilege('anon', to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)'), 'execute')::text end,
         'true/false',
         case when to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)') is not null
                   and has_function_privilege('authenticated', to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)'), 'execute')
                   and not has_function_privilege('anon', to_regprocedure('public.guardar_programa_dias(bigint, jsonb, integer)'), 'execute') then 'OK' else 'REVISAR' end
  union all
  select 43, 'trigger de constraint DIFERIDO sobre programa_dias (itinerario de un publicado)',
         coalesce((select case when t.tgdeferrable and t.tginitdeferred then 'diferido' else 'inmediato' end from pg_trigger t where t.tgname = 'trg_programa_dias_itinerario_publicado' and not t.tgisinternal), 'falta'),
         'diferido',
         case when exists (select 1 from pg_trigger t where t.tgname = 'trg_programa_dias_itinerario_publicado' and not t.tgisinternal and t.tgdeferrable and t.tginitdeferred) then 'OK' else 'REVISAR' end
  union all
  select 44, 'trigger de constraint DIFERIDO sobre programas (publicar o cambiar el total de días)',
         coalesce((select case when t.tgdeferrable and t.tginitdeferred then 'diferido' else 'inmediato' end from pg_trigger t where t.tgname = 'trg_programas_itinerario_publicado' and not t.tgisinternal), 'falta'),
         'diferido',
         case when exists (select 1 from pg_trigger t where t.tgname = 'trg_programas_itinerario_publicado' and not t.tgisinternal and t.tgdeferrable and t.tginitdeferred) then 'OK' else 'REVISAR' end
  union all
  select 46, 'función bloquear_itinerario_programa(bigint) (candado por programa que serializa las comprobaciones diferidas)',
         case when to_regprocedure('public.bloquear_itinerario_programa(bigint)') is null then 'falta'
              else 'existe · authenticated=' || has_function_privilege('authenticated', to_regprocedure('public.bloquear_itinerario_programa(bigint)'), 'execute')::text
                   || ' · anon=' || has_function_privilege('anon', to_regprocedure('public.bloquear_itinerario_programa(bigint)'), 'execute')::text end,
         'existe · authenticated=true · anon=false',
         case when to_regprocedure('public.bloquear_itinerario_programa(bigint)') is not null
                   and has_function_privilege('authenticated', to_regprocedure('public.bloquear_itinerario_programa(bigint)'), 'execute')
                   and not has_function_privilege('anon', to_regprocedure('public.bloquear_itinerario_programa(bigint)'), 'execute') then 'OK' else 'REVISAR' end
  union all
  select 47, 'el trigger de programa_dias se dispara también al CAMBIAR de programa (UPDATE) y usa el candado',
         case when exists (select 1 from pg_proc p where p.proname = 'tg_programa_itinerario_publicado' and pg_get_functiondef(p.oid) like '%bloquear_itinerario_programa%' and pg_get_functiondef(p.oid) like '%old.programa_id, new.programa_id%') then 'sí' else 'no' end,
         'sí',
         case when exists (select 1 from pg_proc p where p.proname = 'tg_programa_itinerario_publicado' and pg_get_functiondef(p.oid) like '%bloquear_itinerario_programa%' and pg_get_functiondef(p.oid) like '%old.programa_id, new.programa_id%') then 'OK' else 'REVISAR' end
  union all
  select 48, 'el trigger de programas cubre INSERT y UPDATE (un programa que nace publicado sin itinerario se rechaza al cerrar la transacción)',
         case when exists (select 1 from pg_trigger t where t.tgname = 'trg_programas_itinerario_publicado' and not t.tgisinternal and (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0 and t.tgdeferrable and t.tginitdeferred) then 'insert+update' else 'incompleto o falta' end,
         'insert+update',
         case when exists (select 1 from pg_trigger t where t.tgname = 'trg_programas_itinerario_publicado' and not t.tgisinternal and (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0 and t.tgdeferrable and t.tginitdeferred) then 'OK' else 'REVISAR' end
  union all
  select 45, 'INFO programas PUBLICADOS con itinerario incompleto hoy (no se tocan; editar sus días o su total exige completarlos o despublicarlos)',
         case when to_regprocedure('public.itinerario_programa_problema(bigint, integer)') is null then 'n/d'
              else (select count(*)::text from public.programas p where p.publicado and public.itinerario_programa_problema(p.id, p.dias) is not null) end,
         'dato', 'INFO'
  union all
  select 31, 'INFO blackouts con alcance «entrada» (todos los cargados antes de la 246 lo conservan)',
         case when exists (select 1 from col) then (select count(*)::text from public.programa_blackouts where alcance = 'entrada') else 'n/d' end, 'dato', 'INFO'
  union all
  select 32, 'INFO blackouts con alcance «viaje»',
         case when exists (select 1 from col) then (select count(*)::text from public.programa_blackouts where alcance = 'viaje') else 'n/d' end, 'dato', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
