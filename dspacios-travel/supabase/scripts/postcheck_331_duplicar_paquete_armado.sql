-- POSTCHECK 331 (duplicar paquete armado) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 331.
with f as (
  select p.oid as fid, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'duplicar_paquete_armado'
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La función existe (una sola)' as control, count(*)::text as observado, '1' as esperado, case when count(*) = 1 then 'OK' else 'REVISAR' end as estado from f
  union all select 2, 'SECURITY INVOKER (rige la RLS y la auditoría de quien llama)', coalesce((select (not prosecdef)::text from f), 'sin función'), 'true', case when coalesce((select not prosecdef from f), false) then 'OK' else 'REVISAR' end
  union all select 3, 'search_path fijo', coalesce((select exists (select 1 from unnest(proconfig) x where x like 'search_path=%')::text from f), 'sin función'), 'true', case when coalesce((select exists (select 1 from unnest(proconfig) x where x like 'search_path=%') from f), false) then 'OK' else 'REVISAR' end
  union all select 4, 'authenticated ejecuta; anon NO', coalesce((select (has_function_privilege('authenticated', fid, 'execute') and not has_function_privilege('anon', fid, 'execute'))::text from f), 'sin función'), 'true', case when coalesce((select has_function_privilege('authenticated', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') from f), false) then 'OK' else 'REVISAR' end
  union all select 5, 'La copia nace inactiva y NO llama a generar/publicar el tarifario', coalesce((select (prosrc like '%o.moneda_publicacion, false%' and prosrc not ilike '%generar_tarifario%' and prosrc not ilike '%tarifario_resultado%')::text from f), 'sin función'), 'true', case when coalesce((select prosrc like '%o.moneda_publicacion, false%' and prosrc not ilike '%generar_tarifario%' and prosrc not ilike '%tarifario_resultado%' from f), false) then 'OK' else 'REVISAR' end
  union all select 6, 'Paquetes armados existentes (debe ser igual al preflight: la 331 no crea ni toca paquetes)', (select count(*) from public.armado_paquetes)::text, 'igual que en el preflight', 'INFO'
) r order by orden;
