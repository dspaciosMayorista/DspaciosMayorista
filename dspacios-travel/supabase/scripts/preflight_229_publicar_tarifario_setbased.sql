-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 229 · publicar_tarifario_resultado set-based (#100). SOLO LECTURA: una sola sentencia SELECT (sin begin ni rollback, para que el editor SQL de Supabase muestre la tabla).
-- Correr ANTES de aplicar la 229. UNA sola consulta: control · valor · esperado · estado (OK / REVISAR / INFO).
--   OK      el valor coincide con lo esperado.   REVISAR  conviene mirar el caso antes de aplicar.   INFO  dato de contexto.
-- Ningún control bloquea: la migración valida sus propios prerrequisitos y aborta sola.
-- ───────────────────────────────────────────────────────────────────────────

with
pub as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado'
),
filas as (select paquete_id, count(*) n from public.tarifario_resultado group by paquete_id),
chequeos(orden, control, valor, esperado, estado) as (
  select 1, 'P1 publicador (firma exacta) presente',
         (to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is not null)::int::text, '1',
         case when to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is not null then 'OK' else 'REVISAR' end
  union all select 2, 'P2 sobrecargas del publicador (debe haber UNA)', (select count(*) from pub)::text, '1',
         case when (select count(*) from pub) = 1 then 'OK' else 'REVISAR' end
  union all select 3, 'P3 226 aplicada (columna precio_pvp_menor2)',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2')::text, '1',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2') = 1 then 'OK' else 'REVISAR' end
  union all select 4, 'P4 envoltorio 227 (publicar_..._63) presente',
         (to_regprocedure('public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)') is not null)::int::text, '1',
         case when to_regprocedure('public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)') is not null then 'OK' else 'REVISAR' end
  union all select 5, 'P5 cuerpo vigente con bucle por fila (226); INFO si ya es set-based (229 aplicada)',
         (select count(*) from pub where prosrc like '%for v_fila in%')::text, '1',
         case when (select count(*) from pub where prosrc like '%for v_fila in%') = 1 then 'OK'
              when (select count(*) from pub where prosrc like '%with ordinality%') = 1 then 'INFO' else 'REVISAR' end
  union all select 6, 'P6 SECURITY DEFINER con search_path fijo',
         (select count(*) from pub where prosecdef and coalesce(proconfig::text, '') like '%search_path%')::text, '1',
         case when (select count(*) from pub where prosecdef and coalesce(proconfig::text, '') like '%search_path%') = 1 then 'OK' else 'REVISAR' end
  union all select 7, 'P7 dueño de la función con bypassrls (la RLS no suma costo)',
         coalesce((select r.rolbypassrls::int::text from pub join pg_roles r on r.oid = pub.proowner), '<sin función>'), '1',
         case when coalesce((select r.rolbypassrls from pub join pg_roles r on r.oid = pub.proowner), false) then 'OK' else 'REVISAR' end
  union all select 8, 'P8 ACL: anon sin EXECUTE y authenticated con EXECUTE',
         (not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE'))::int::text, '1',
         case when not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE') then 'OK' else 'REVISAR' end
  union all select 9, 'P9 triggers propios (no internos) en tarifario_resultado',
         (select count(*) from pg_trigger where tgrelid = 'public.tarifario_resultado'::regclass and not tgisinternal)::text, '0',
         case when (select count(*) from pg_trigger where tgrelid = 'public.tarifario_resultado'::regclass and not tgisinternal) = 0 then 'OK' else 'REVISAR' end
  union all select 10, 'P10 CHECK de tarifario_resultado (la carga set-based los sigue evaluando)',
         (select count(*) from pg_constraint where conrelid = 'public.tarifario_resultado'::regclass and contype = 'c')::text, '6',
         case when (select count(*) from pg_constraint where conrelid = 'public.tarifario_resultado'::regclass and contype = 'c') = 6 then 'OK' else 'REVISAR' end
  union all select 11, 'P11 vistas materializadas en public (dependencias ocultas)', (select count(*) from pg_matviews where schemaname = 'public')::text, '0',
         case when (select count(*) from pg_matviews where schemaname = 'public') = 0 then 'OK' else 'REVISAR' end
  union all select 12, 'P12 filas vivas / muertas de tarifario_resultado',
         coalesce((select n_live_tup || ' / ' || n_dead_tup from pg_stat_user_tables where relid = 'public.tarifario_resultado'::regclass), '<sin datos>'), 'muertas << vivas', 'INFO'
  union all select 13, 'P13 paquetes con snapshot / filas del más grande',
         (select count(*) || ' / ' || coalesce(max(n), 0) from filas), 'más grande < 20000',
         case when coalesce((select max(n) from filas), 0) < 20000 then 'INFO' else 'REVISAR' end
  union all select 14, 'P14 md5 del cuerpo vigente (para comparar con el rollback)', coalesce((select md5(replace(prosrc, E'\r', '')) from pub), '<sin función>'), '(informativo)', 'INFO'
)
select control, valor, esperado, estado from chequeos order by orden;

