-- POSTCHECK 326 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 326.
with f as (
  select p.oid as fid, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as dueno, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cotizacion_pasajeros_aliado_guardar'
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La función existe (una sola)' as control, count(*)::text as observado, '1' as esperado, case when count(*) = 1 then 'OK' else 'REVISAR' end as estado from f
  union all select 2, 'Ya usa el tope por universo declarado (unidades independientes / cota de seguridad)', coalesce((select (prosrc like '%v_unidades%' and prosrc like '%hotelRef%')::text from f), 'sin función'), 'true', case when coalesce((select prosrc like '%v_unidades%' and prosrc like '%hotelRef%' from f), false) then 'OK' else 'REVISAR' end
  union all select 2.5, 'Aplica el límite técnico de captura (30 = CHECK de la tabla) con mensaje propio, sin llegar al CHECK', coalesce((select (prosrc like '%v_limite constant integer := 30%' and prosrc like '%Aquí se pueden dejar hasta %')::text from f), 'sin función'), 'true', case when coalesce((select prosrc like '%v_limite constant integer := 30%' and prosrc like '%Aquí se pueden dejar hasta %' from f), false) then 'OK' else 'REVISAR' end
  union all select 3, 'Conserva las reglas de la 325 (F4722, F4723, F4720, F4721)', coalesce((select (prosrc like '%F4722%' and prosrc like '%F4723%' and prosrc like '%F4720%' and prosrc like '%F4721%')::text from f), 'sin función'), 'true', case when coalesce((select prosrc like '%F4722%' and prosrc like '%F4723%' and prosrc like '%F4720%' and prosrc like '%F4721%' from f), false) then 'OK' else 'REVISAR' end
  union all select 4, 'SECURITY DEFINER con search_path fijo', coalesce((select (prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%'))::text from f), 'sin función'), 'true', case when coalesce((select prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%') from f), false) then 'OK' else 'REVISAR' end
  union all select 5, 'service_role ejecuta; anon y authenticated NO', coalesce((select (has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute'))::text from f), 'sin función'), 'true', case when coalesce((select has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute') from f), false) then 'OK' else 'REVISAR' end
  union all select 6, 'Listas de pasajeros guardadas (deben seguir intactas)', (select count(*) from public.cotizacion_pasajeros_aliado)::text, 'igual que en el preflight', 'INFO'
) r order by orden;
