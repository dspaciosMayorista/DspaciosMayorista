-- ═══════════════════════════════════════════════════════════════════════════
-- POST-DEPLOY · SOLO LECTURA · migración 20260601000161_programa_modalidad_mk_comisionable.sql
-- PR #277 (rama programas-comisionable-mk-modalidad) · commit 943785022fe560079d33135876417f67ffab1d49
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) INMEDIATAMENTE
-- DESPUÉS de aplicar la migración 161 y ANTES de probar el Vercel preview
-- del PR (paso 4 del orden de despliegue) — el chequeo 6 de abajo (datos
-- históricos) solo es un veredicto duro en esa ventana, porque una vez que
-- alguien guarda un programa en la modalidad nueva desde el preview, dejar
-- de ver el 100% en 'historica' es esperado y correcto, no una falla.
--
-- NO contiene ningún INSERT/UPDATE/DELETE/DDL — únicamente SELECT sobre
-- catálogos del sistema y sobre public.programas. Se puede correr las veces
-- que haga falta sin ningún efecto secundario.
--
-- Orden de despliegue completo (ver también el cuerpo del PR #277):
--   1) preflight_161_programa_modalidad_mk.sql   → confirmar veredicto = OK
--   2) 20260601000161_programa_modalidad_mk_comisionable.sql
--   3) este script (postcheck)                   → confirmar veredicto = PASSED
--   4) probar en el Vercel preview del PR
--   5) recién ahí, fusionar el PR #277
-- ═══════════════════════════════════════════════════════════════════════════

with

-- 1) Columna: tipo/nullable/default EXACTOS.
chk_columna as (
  select
    1 as orden,
    'columna: public.programas.regla_comisionable_modalidad_mk' as chequeo,
    case
      when count(*) = 0 then
        'FALLÓ — la columna no existe; la migración no se aplicó correctamente'
      when max(data_type) = 'text'
        and max(is_nullable) = 'NO'
        and max(column_default) = '''historica''::text'
      then
        'PASÓ — tipo=text, not null, default=''historica''::text'
      else
        'FALLÓ — tipo=' || coalesce(max(data_type), '?') ||
        ' nullable=' || coalesce(max(is_nullable), '?') ||
        ' default=' || coalesce(max(column_default), 'NULL')
    end as resultado,
    not (
      count(*) = 1
      and max(data_type) = 'text'
      and max(is_nullable) = 'NO'
      and max(column_default) = '''historica''::text'
    ) as fallo
  from information_schema.columns
  where table_schema = 'public' and table_name = 'programas'
    and column_name = 'regla_comisionable_modalidad_mk'
),

-- 2) CHECK: definición normalizada EXACTA (mismo texto que audita la propia
--    migración con pg_get_constraintdef).
chk_check as (
  select
    2 as orden,
    'constraint: programas_regla_comisionable_modalidad_mk_check' as chequeo,
    case
      when c.oid is null then 'FALLÓ — el CHECK no existe'
      when pg_get_constraintdef(c.oid) =
        'CHECK ((regla_comisionable_modalidad_mk = ANY (ARRAY[''historica''::text, ''base_neta_impuestos_al_final''::text])))'
      then 'PASÓ — definición exacta esperada'
      else 'FALLÓ — definición distinta: ' || pg_get_constraintdef(c.oid)
    end as resultado,
    (c.oid is null or pg_get_constraintdef(c.oid) is distinct from
      'CHECK ((regla_comisionable_modalidad_mk = ANY (ARRAY[''historica''::text, ''base_neta_impuestos_al_final''::text])))'
    ) as fallo
  from (select 1) _uno
  left join pg_constraint c
    on c.conname = 'programas_regla_comisionable_modalidad_mk_check'
   and c.conrelid = 'public.programas'::regclass
),

-- 3) RPC: firma, lenguaje, NO security definer, y que el cuerpo contenga el
--    lock (SELECT ... FOR UPDATE) como primer paso — confirma que quedó la
--    versión de la ronda 2, no una versión anterior sin locking.
chk_funcion as (
  select
    3 as orden,
    'función: guardar_programa_salidas(bigint, jsonb, jsonb)' as chequeo,
    case
      when p.oid is null then 'FALLÓ — la función no existe'
      when l.lanname <> 'plpgsql' then 'FALLÓ — lenguaje inesperado: ' || l.lanname
      when p.prosecdef then 'FALLÓ — quedó como SECURITY DEFINER (debe correr con el rol de quien llama)'
      when position('for update' in lower(pg_get_functiondef(p.oid))) = 0 then
        'FALLÓ — el cuerpo NO contiene "for update": el guardado no está bloqueando la fila (versión vieja sin locking desplegada)'
      when position('for update' in lower(pg_get_functiondef(p.oid))) >
           coalesce(nullif(position('update public.programas' in lower(pg_get_functiondef(p.oid))), 0), 999999)
      then 'FALLÓ — "for update" aparece DESPUÉS del UPDATE de la tabla: el lock no se está tomando al inicio'
      else
        'PASÓ — lang=plpgsql, security_definer=false, contiene SELECT...FOR UPDATE antes del UPDATE de la fila'
    end as resultado,
    (p.oid is null
      or l.lanname <> 'plpgsql'
      or p.prosecdef
      or position('for update' in lower(pg_get_functiondef(p.oid))) = 0
    ) as fallo
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join pg_language l on l.oid = p.prolang
  where p.proname = 'guardar_programa_salidas'
    and pg_get_function_identity_arguments(p.oid) = 'p_programa_id bigint, p_regla jsonb, p_salidas jsonb'
),

-- 4) No deben quedar overloads con otra firma (el create or replace de la
--    migración no debió crear una función nueva en paralelo).
chk_funcion_overloads as (
  select
    4 as orden,
    'función: guardar_programa_salidas — overloads con OTRA firma' as chequeo,
    case
      when count(*) = 0 then 'PASÓ — no hay overloads con otra firma'
      else 'FALLÓ — existen ' || count(*) || ' overload(s) con firma distinta: ' ||
           string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    end as resultado,
    (count(*) > 0) as fallo
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.proname = 'guardar_programa_salidas'
    and pg_get_function_identity_arguments(p.oid) <> 'p_programa_id bigint, p_regla jsonb, p_salidas jsonb'
),

-- 5) ACL: PUBLIC y anon SIN ejecución; authenticated CON ejecución.
chk_acl as (
  select
    5 as orden,
    'ACL: guardar_programa_salidas(bigint,jsonb,jsonb)' as chequeo,
    'PUBLIC=' || has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' · anon=' || has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' · authenticated=' || has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    case
      when has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE') = false
        and has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE') = false
        and has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE') = true
      then ' → PASÓ'
      else ' → FALLÓ (se esperaba PUBLIC=false, anon=false, authenticated=true)'
    end as resultado,
    not (
      has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE') = false
      and has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE') = false
      and has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE') = true
    ) as fallo
),

-- 6) Datos históricos: TODOS los programas deben quedar en 'historica'
--    justo después de la migración (sin backfill que cambie nada). Correr
--    ANTES de probar el preview — si ya se probó el preview y alguien
--    guardó un programa en la modalidad nueva, este chequeo puede mostrar
--    >0 legítimamente; en ese caso no es una falla de la migración.
chk_datos_historicos as (
  select
    6 as orden,
    'datos existentes: todos en modalidad ''historica'' (correr ANTES de probar el preview)' as chequeo,
    case
      when count(*) = 0 then
        'PASÓ — ' || (select count(*) from public.programas) || ' programa(s) totales, 0 en otra modalidad'
      else
        'AVISO — ' || count(*) || ' programa(s) NO están en ''historica''. Si ya se probó el Vercel preview y se guardó ' ||
        'algún programa en la modalidad nueva a propósito, esto es ESPERADO, no una falla. Si este script se corrió ' ||
        'inmediatamente después de la migración y ANTES de cualquier prueba, investigar: id ' ||
        string_agg(id::text, ', ')
    end as resultado,
    false as fallo  -- nunca bloquea el veredicto duro: depende del momento en que se corra (ver nota arriba)
  from public.programas
  where regla_comisionable_modalidad_mk <> 'historica'
),

filas as (
  select * from chk_columna
  union all select * from chk_check
  union all select * from chk_funcion
  union all select * from chk_funcion_overloads
  union all select * from chk_acl
  union all select * from chk_datos_historicos
)

select
  orden,
  chequeo,
  resultado,
  fallo,
  case
    when bool_or(fallo) over () then 'FAILED — revisar la(s) fila(s) marcada(s) fallo=true antes de probar el preview o fusionar'
    else 'PASSED — migración 161 aplicada correctamente (chequeo 6 es informativo, ver su nota)'
  end as veredicto_final
from filas
order by orden;
