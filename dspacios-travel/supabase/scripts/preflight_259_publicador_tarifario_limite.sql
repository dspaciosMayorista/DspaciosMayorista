-- PREFLIGHT 259 · publicador del tarifario con límite propio · SOLO LECTURA · UNA consulta con columna de estado.
-- Pegar completa en el editor SQL de Supabase ANTES de correr 20260601000259_publicador_tarifario_limite_acotado.sql y guardar el resultado
-- (las huellas md5 se comparan con las del postcheck: la 259 NO debe cambiar ningún cuerpo). No devuelve datos de negocio ni texto de sentencias.
--
-- Cada una de las DOS entradas que llama la aplicación (publicar_tarifario_resultado y publicar_tarifario_resultado_63) está en exactamente UNO de tres estados:
--   SIN_LIMITES   → su configuración es solo `search_path=public, pg_temp`.                                  La 259 se puede correr.
--   APLICADA_259  → además, EXACTAMENTE `lock_timeout=8s` y `statement_timeout=30s`.                         La 259 ya está; reaplicarla es un no-op.
--   AJENA         → cualquier otra cosa (otro statement_timeout, un lock_timeout suelto, work_mem…, o un search_path distinto).
--                   La 259 ABORTARÁ sin cambiar nada: REVISAR con quién la puso ANTES de seguir.
with f as (
  select p.proname, p.oid, p.prosecdef, p.prosrc,
         (select array_agg(c order by c) from unnest(coalesce(p.proconfig, '{}'::text[])) c where c not like 'search_path=%') as extra,
         (select array_agg(c order by c) from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%') as sp,
         (select string_agg(a.rolname, ',' order by a.rolname) from pg_roles a where has_function_privilege(a.oid, p.oid, 'execute') and a.rolname in ('anon', 'authenticated', 'service_role')) as ejecutan
    from pg_proc p
   where p.oid in (
     to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'),
     to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'),
     to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)'))
),
est as (
  select proname,
         case when sp is distinct from array['search_path=public, pg_temp'] then 'AJENA'
              when extra is null then 'SIN_LIMITES'
              when extra = array['lock_timeout=8s', 'statement_timeout=30s'] then 'APLICADA_259'
              else 'AJENA' end as estado,
         coalesce(array_to_string(extra, ' '), '-') as limites,
         coalesce(array_to_string(sp, ' '), 'SIN search_path') as ruta
    from f where proname <> 'publicar_tarifario_resultado_interno'
)
select n, seccion, lectura, estado from (
  select 1 as n, 'existen los dos puntos de entrada y el interno' as seccion,
         (select count(*)::text || ' de 3' from f) as lectura,
         case when (select count(*) from f) = 3 then 'OK' else 'REVISAR: faltan funciones; no correr la 259' end as estado
  union all
  select 2, 'publicar_tarifario_resultado: estado (SIN_LIMITES, APLICADA_259 o AJENA) y configuración propia',
         (select estado || ' · ' || limites || ' · ' || ruta from est where proname = 'publicar_tarifario_resultado'),
         (select case estado when 'SIN_LIMITES' then 'OK: la 259 se puede correr' when 'APLICADA_259' then 'OK: ya aplicada (no-op)' else 'REVISAR: configuración ajena; la 259 abortará sin cambiar nada' end from est where proname = 'publicar_tarifario_resultado')
  union all
  select 3, 'publicar_tarifario_resultado_63: estado (SIN_LIMITES, APLICADA_259 o AJENA) y configuración propia',
         (select estado || ' · ' || limites || ' · ' || ruta from est where proname = 'publicar_tarifario_resultado_63'),
         (select case estado when 'SIN_LIMITES' then 'OK: la 259 se puede correr' when 'APLICADA_259' then 'OK: ya aplicada (no-op)' else 'REVISAR: configuración ajena; la 259 abortará sin cambiar nada' end from est where proname = 'publicar_tarifario_resultado_63')
  union all
  select 4, 'veredicto sobre las dos entradas',
         (select string_agg(proname || '=' || estado, ' | ' order by proname) from est),
         case when exists (select 1 from est where estado = 'AJENA') then 'REVISAR: hay configuración ajena; NO correr la 259 hasta resolverla'
              when (select count(distinct estado) from est) = 1 and (select max(estado) from est) = 'SIN_LIMITES' then 'OK: ambas SIN_LIMITES; correr la 259'
              when (select count(distinct estado) from est) = 1 then 'OK: ambas con la 259 ya aplicada; no hace falta correrla'
              else 'INFO: estado mixto (una sin límites, otra con la 259); la 259 completa la que falta, es segura' end
  union all
  select 5, 'entradas: SECURITY DEFINER (deben seguir igual después)',
         (select string_agg(proname || ': ' || prosecdef::text, ' | ' order by proname) from f where proname <> 'publicar_tarifario_resultado_interno'),
         case when exists (select 1 from f where proname <> 'publicar_tarifario_resultado_interno' and not prosecdef) then 'REVISAR' else 'OK' end
  union all
  select 6, 'quién puede ejecutar cada función (no debe cambiar: authenticated sí en las entradas, anon no, interno nadie)',
         (select string_agg(proname || ': ' || coalesce(ejecutan, '-'), ' | ' order by proname) from f),
         case when exists (select 1 from f where proname <> 'publicar_tarifario_resultado_interno' and (ejecutan is null or ejecutan like '%anon%' or ejecutan not like '%authenticated%')) then 'REVISAR'
              when exists (select 1 from f where proname = 'publicar_tarifario_resultado_interno' and ejecutan like '%authenticated%') then 'REVISAR: el interno no debe ser ejecutable por authenticated' else 'OK' end
  union all
  select 7, 'huellas md5 de los cuerpos (guardar; el postcheck debe dar las mismas)',
         (select string_agg(proname || '=' || md5(replace(prosrc, chr(13), '')), ' | ' order by proname) from f), 'INFO'
  union all
  select 8, 'límites de los roles que llaman (la 259 no los toca): authenticated / authenticator',
         (select concat(
            (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticated' and (c like 'statement_timeout=%' or c like 'lock_timeout=%')), ' / ',
            (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticator' and (c like 'statement_timeout=%' or c like 'lock_timeout=%')))),
         'INFO'
  union all
  select 9, 'publicaciones en curso AHORA (conviene correr la 259 sin ninguna activa)',
         (select count(*)::text from pg_stat_activity a where a.state = 'active' and a.pid <> pg_backend_pid() and a.datname = current_database() and a.query ilike '%publicar_tarifario_resultado%'),
         case when (select count(*) from pg_stat_activity a where a.state = 'active' and a.pid <> pg_backend_pid() and a.datname = current_database() and a.query ilike '%publicar_tarifario_resultado%') > 0 then 'REVISAR: esperar a que terminen' else 'OK' end
  union all
  select 10, 'filas hoy en tarifario_resultado / paquetes con filas',
         (select concat(count(*), ' / ', count(distinct paquete_id)) from public.tarifario_resultado), 'INFO'
) q order by n;
