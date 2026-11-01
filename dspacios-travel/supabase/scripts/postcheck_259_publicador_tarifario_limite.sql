-- POSTCHECK 259 · publicador del tarifario con límite propio · SOLO LECTURA · UNA consulta con columna de estado.
-- Pegar completa en el editor SQL de Supabase DESPUÉS de correr la 259. Comparar la fila 5 con la del preflight (las huellas deben ser IDÉNTICAS).
-- Las dos entradas deben quedar en APLICADA_259: exactamente `lock_timeout=8s` + `statement_timeout=30s` (más el `search_path=public, pg_temp` de siempre).
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
  select 1 as n, 'las dos entradas: estado (debe ser APLICADA_259) y configuración propia' as seccion,
         (select string_agg(proname || ': ' || estado || ' · ' || limites || ' · ' || ruta, ' | ' order by proname) from est) as lectura,
         case when (select count(*) from est where estado = 'APLICADA_259') = 2 then 'OK'
              when exists (select 1 from est where estado = 'AJENA') then 'REVISAR: configuración ajena en alguna entrada'
              else 'REVISAR: la 259 no quedó aplicada' end as estado
  union all
  select 2, 'conservan SECURITY DEFINER',
         (select string_agg(proname || ': ' || prosecdef::text, ' | ' order by proname) from f where proname <> 'publicar_tarifario_resultado_interno'),
         case when exists (select 1 from f where proname <> 'publicar_tarifario_resultado_interno' and not prosecdef) then 'REVISAR' else 'OK' end
  union all
  select 3, 'el interno NO tiene límites propios (la 259 no lo toca)',
         (select coalesce(array_to_string((select array_agg(c order by c) from unnest(coalesce(proconfig, '{}'::text[])) c where c like 'statement_timeout=%' or c like 'lock_timeout=%'), ' '), '-') from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')),
         case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)') and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'statement_timeout=%' or c like 'lock_timeout=%')) then 'REVISAR' else 'OK' end
  union all
  select 4, 'quién puede ejecutar cada función (igual que antes: authenticated sí en las entradas, anon no, interno nadie)',
         (select string_agg(proname || ': ' || coalesce(ejecutan, '-'), ' | ' order by proname) from f),
         case when exists (select 1 from f where proname <> 'publicar_tarifario_resultado_interno' and (ejecutan is null or ejecutan like '%anon%' or ejecutan not like '%authenticated%')) then 'REVISAR'
              when exists (select 1 from f where proname = 'publicar_tarifario_resultado_interno' and ejecutan like '%authenticated%') then 'REVISAR' else 'OK' end
  union all
  select 5, 'huellas md5 de los cuerpos: comparar con el preflight (deben ser IDÉNTICAS)',
         (select string_agg(proname || '=' || md5(replace(prosrc, chr(13), '')), ' | ' order by proname) from f), 'INFO: comparar a mano con el preflight'
  union all
  select 6, 'los roles NO cambiaron (authenticated / authenticator)',
         (select concat(
            (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticated' and (c like 'statement_timeout=%' or c like 'lock_timeout=%')), ' / ',
            (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticator' and (c like 'statement_timeout=%' or c like 'lock_timeout=%')))),
         'INFO: deben ser los mismos del preflight'
  union all
  select 7, 'filas hoy en tarifario_resultado / paquetes con filas (no deben haber cambiado por la 259)',
         (select concat(count(*), ' / ', count(distinct paquete_id)) from public.tarifario_resultado), 'INFO'
) q order by n;
-- Después del postcheck: UN intento de «Generar tarifario» del paquete 33 y copiar la línea «generarTarifario: medicion …» de Vercel Logs (PR #416).
