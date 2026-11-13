-- POSTCHECK 301 (#43/#60 entrega 5) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 301 y ANTES del código.
-- Todo OK; los controles 9 y 10 deben ser IDÉNTICOS a los 5 y 6 del preflight (la 301 no cambia reglas ni vigencias).
with post as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_reglas_descuento'
       and column_name in ('autorizada', 'propuesta'))::int as columnas,
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.hotel_promocion_combinacion')), false) as rls,
    (select count(*) from pg_trigger where tgname = 'trg_e5_revisar' and tgdeferrable and tginitdeferred
       and tgrelid in ('public.hotel_temporadas'::regclass, 'public.hotel_reglas_descuento'::regclass,
                       'public.hotel_promocion_reglas'::regclass, coalesce(to_regclass('public.hotel_promocion_combinacion'), 0::oid)))::int as disparadores,
    (has_function_privilege('authenticated', 'public.promocion_guardar_combinacion(bigint, jsonb, jsonb)', 'execute')
     and has_function_privilege('authenticated', 'public.regla_descuento_guardar(bigint, bigint, text, integer, numeric, boolean)', 'execute')
     and not has_function_privilege('anon', 'public.promocion_guardar_combinacion(bigint, jsonb, jsonb)', 'execute')
     and not has_function_privilege('anon', 'public.regla_descuento_guardar(bigint, bigint, text, integer, numeric, boolean)', 'execute')) as grants_rpc,
    (not has_function_privilege('authenticated', 'public._e5_revisar(bigint, bigint)', 'execute')
     and not has_function_privilege('authenticated', 'public._e5_requeridas(bigint, jsonb)', 'execute')
     and not has_table_privilege('authenticated', 'public.hotel_promocion_combinacion', 'insert')) as internas_cerradas,
    (select count(*) from public.hotel_reglas_descuento where not autorizada or propuesta is not null)::bigint as reglas_retenidas,
    (select count(*) from public.hotel_promocion_combinacion where estado <> 'heredada')::bigint as no_heredadas,
    (select count(*) from public.hotel_promocion_combinacion)::bigint as heredadas,
    (select md5(coalesce(string_agg((to_jsonb(r) - 'autorizada' - 'propuesta')::text, E'\n' order by r.id), '')) from public.hotel_reglas_descuento r) as huella_reglas,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.hotel_temporadas t) as huella_vigencias,
    public._e5_max_noches() as max_noches
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Columnas autorizada/propuesta en hotel_reglas_descuento' as control, columnas::text as observado, '2' as esperado,
         case when columnas = 2 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'hotel_promocion_combinacion con RLS', rls::text, 'true', case when rls then 'OK' else 'REVISAR' end from post
  union all select 3, 'Disparadores de revisión diferidos (4 tablas)', disparadores::text, '4', case when disparadores = 4 then 'OK' else 'REVISAR' end from post
  union all select 4, 'RPC: authenticated sí, anon no', grants_rpc::text, 'true', case when grants_rpc then 'OK' else 'REVISAR' end from post
  union all select 5, 'Funciones internas y escritura directa cerradas', internas_cerradas::text, 'true', case when internas_cerradas then 'OK' else 'REVISAR' end from post
  union all select 6, 'Reglas retenidas tras aplicar (todas siguen autorizadas)', reglas_retenidas::text, '0', case when reglas_retenidas = 0 then 'OK' else 'REVISAR' end from post
  union all select 7, 'Combinaciones no heredadas tras aplicar', no_heredadas::text, '0', case when no_heredadas = 0 then 'OK' else 'REVISAR' end from post
  union all select 8, 'Promociones que ya coincidían (quedan «heredada»: acumulan como hoy)', heredadas::text, 'anotar', 'INFO' from post
  union all select 9, 'Huella de reglas sin columnas nuevas (= preflight control 5)', huella_reglas, 'igual al preflight', 'INFO' from post
  union all select 10, 'Huella de vigencias (= preflight control 6)', huella_vigencias, 'igual al preflight', 'INFO' from post
  union all select 11, 'Estadía máxima para coincidencias', max_noches::text, '30', case when max_noches = 30 then 'OK' else 'REVISAR' end from post
) r order by orden;
