-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK · migración 203 — SOLO LECTURA. Correr DESPUÉS de aplicarla.
-- Cada fila debe salir con ok = true.
-- ───────────────────────────────────────────────────────────────────────────
select 'tablas de historial existen' as chequeo,
  to_regclass('public.tarifa_hotel_historial') is not null and to_regclass('public.hotel_temporadas_historial') is not null as ok
union all
select 'RLS activa en ambos historiales',
  coalesce((select bool_and(relrowsecurity) from pg_class
            where oid in (to_regclass('public.tarifa_hotel_historial'), to_regclass('public.hotel_temporadas_historial'))), false)
union all
select 'solo policies de lectura en historiales',
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('tarifa_hotel_historial', 'hotel_temporadas_historial') and cmd = 'SELECT') = 2
  and not exists (select 1 from pg_policies where schemaname = 'public'
     and tablename in ('tarifa_hotel_historial', 'hotel_temporadas_historial') and cmd <> 'SELECT')
union all
select 'authenticated sin escritura en historiales',
  not (has_table_privilege('authenticated', 'public.tarifa_hotel_historial', 'INSERT')
       or has_table_privilege('authenticated', 'public.tarifa_hotel_historial', 'UPDATE')
       or has_table_privilege('authenticated', 'public.tarifa_hotel_historial', 'DELETE')
       or has_table_privilege('authenticated', 'public.hotel_temporadas_historial', 'INSERT')
       or has_table_privilege('authenticated', 'public.hotel_temporadas_historial', 'UPDATE')
       or has_table_privilege('authenticated', 'public.hotel_temporadas_historial', 'DELETE'))
union all
select 'anon sin lectura de historiales',
  not has_table_privilege('anon', 'public.tarifa_hotel_historial', 'SELECT')
  and not has_table_privilege('anon', 'public.hotel_temporadas_historial', 'SELECT')
union all
select 'triggers de historial activos',
  (select count(*) from pg_trigger
   where (tgname = 'trg_tarifa_hotel_historial' and tgrelid = 'public.tarifa_hotel'::regclass)
      or (tgname = 'trg_hotel_temporadas_historial' and tgrelid = 'public.hotel_temporadas'::regclass)) = 2
union all
select 'generar es SECURITY DEFINER',
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text)')), false)
union all
select 'consultas son SECURITY INVOKER (heredan la RLS)',
  coalesce((select bool_and(not prosecdef) from pg_proc where oid in (
    to_regprocedure('public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer)'),
    to_regprocedure('public.reconstruir_tarifas_desde_auditoria(bigint)'))), false)
union all
select 'authenticated ejecuta; anon no',
  has_function_privilege('authenticated', 'public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reconstruir_tarifas_desde_auditoria(bigint)', 'EXECUTE')
union all
select 'ayudantes internos (_tarifa_clave/_tarifa_huella) sin EXECUTE para la API',
  not has_function_privilege('authenticated', 'public._tarifa_clave(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._tarifa_huella(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public._tarifa_huella(jsonb)', 'EXECUTE')
union all
select 'la versión vieja de 4 argumentos no existe (solo la de p_previas)',
  to_regprocedure('public.generar_tarifas_hotel_calculadora(bigint, jsonb, boolean, text)') is null
union all
-- Re-correr también DESPUÉS de cualquier migración futura que instale
-- auditoría global (p. ej. la 202 de CRM): debe seguir en true.
select 'historiales sin triggers propios (ni trg_auditoria ni otro)',
  not exists (select 1 from pg_trigger
              where not tgisinternal
                and tgrelid in (to_regclass('public.tarifa_hotel_historial'), to_regclass('public.hotel_temporadas_historial')))
union all
select 'la 203 no escribió datos (historiales vacíos al aplicar)',
  (select count(*) from public.tarifa_hotel_historial) = 0 and (select count(*) from public.hotel_temporadas_historial) = 0;
-- La última solo vale justo después de aplicar: en cuanto alguien edite una
-- tarifa o una vigencia, los historiales empiezan a llenarse (es lo esperado).
