-- ═══════════════════════════════════════════════════════════════════════════
-- POST-DEPLOY · SOLO LECTURA · migración 20260601000163_programa_impuesto_por_acomodacion.sql
-- rama programas-impuestos-por-acomodacion
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) INMEDIATAMENTE
-- DESPUÉS de aplicar la migración 163 y ANTES de probar el Vercel preview del
-- PR — el chequeo 8 de abajo (datos históricos) solo es un veredicto duro en
-- esa ventana, porque una vez que alguien activa la opción nueva desde el
-- preview, dejar de ver el 100% en false es esperado y correcto, no una falla.
--
-- NO contiene ningún INSERT/UPDATE/DELETE/DDL — únicamente SELECT sobre
-- catálogos del sistema y sobre public.programas/programa_salidas. Se puede
-- correr las veces que haga falta sin ningún efecto secundario.
--
-- Orden de despliegue completo:
--   1) preflight_163_programa_impuesto_por_acomodacion.sql → confirmar veredicto = OK
--   2) 20260601000163_programa_impuesto_por_acomodacion.sql
--   3) este script (postcheck)                              → confirmar veredicto = PASSED
--   4) probar en el Vercel preview del PR
--   5) recién ahí, fusionar el PR a main
-- ═══════════════════════════════════════════════════════════════════════════

with

-- 1) Columna de `programas`: tipo/nullable/default EXACTOS.
chk_columna_programas as (
  select
    1 as orden,
    'columna: public.programas.regla_comisionable_impuesto_por_acomodacion' as chequeo,
    case
      when count(*) = 0 then
        'FALLÓ — la columna no existe; la migración no se aplicó correctamente'
      when max(data_type) = 'boolean'
        and max(is_nullable) = 'NO'
        and max(column_default) = 'false'
      then
        'PASÓ — tipo=boolean, not null, default=false'
      else
        'FALLÓ — tipo=' || coalesce(max(data_type), '?') ||
        ' nullable=' || coalesce(max(is_nullable), '?') ||
        ' default=' || coalesce(max(column_default), 'NULL')
    end as resultado,
    not (
      count(*) = 1
      and max(data_type) = 'boolean'
      and max(is_nullable) = 'NO'
      and max(column_default) = 'false'
    ) as fallo
  from information_schema.columns
  where table_schema = 'public' and table_name = 'programas'
    and column_name = 'regla_comisionable_impuesto_por_acomodacion'
),

-- 2) Las cuatro columnas nuevas de `programa_salidas` (numeric nullable).
chk_columnas_salidas as (
  select
    2 as orden,
    'columnas: public.programa_salidas.impuesto_{sencilla,doble,triple,multiple}' as chequeo,
    case
      when count(*) filter (where compatible) = 4 then
        'PASÓ — las 4 existen con tipo=numeric, nullable'
      else
        'FALLÓ — solo ' || count(*) filter (where compatible) || ' de 4 columnas tienen el tipo/nullable esperado: ' ||
        string_agg(v_col || ' (existe=' || existe::text || ' tipo=' || coalesce(v_tipo, '?') || ' nullable=' || coalesce(v_nullable, '?') || ')', ', ')
    end as resultado,
    (count(*) filter (where compatible) <> 4) as fallo
  from (
    select
      v_col,
      (c.column_name is not null) as existe,
      c.data_type as v_tipo,
      c.is_nullable as v_nullable,
      (c.data_type = 'numeric' and c.is_nullable = 'YES') as compatible
    from unnest(array['impuesto_sencilla', 'impuesto_doble', 'impuesto_triple', 'impuesto_multiple']) as v_col
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = 'programa_salidas' and c.column_name = v_col
  ) _cols
),

-- 3) CHECK de programas: definición normalizada EXACTA.
chk_check_programas as (
  select
    3 as orden,
    'constraint: programas_impuesto_por_acomodacion_modo_check' as chequeo,
    case
      when c.oid is null then 'FALLÓ — el CHECK no existe'
      when pg_get_constraintdef(c.oid) =
        'CHECK (((NOT regla_comisionable_impuesto_por_acomodacion) OR (regla_comisionable_modo = ''impuesto''::text)))'
      then 'PASÓ — definición exacta esperada'
      else 'FALLÓ — definición distinta: ' || pg_get_constraintdef(c.oid)
    end as resultado,
    (c.oid is null or pg_get_constraintdef(c.oid) is distinct from
      'CHECK (((NOT regla_comisionable_impuesto_por_acomodacion) OR (regla_comisionable_modo = ''impuesto''::text)))'
    ) as fallo
  from (select 1) _uno
  left join pg_constraint c
    on c.conname = 'programas_impuesto_por_acomodacion_modo_check'
   and c.conrelid = 'public.programas'::regclass
),

-- 4) CHECK de programa_salidas: definición normalizada EXACTA.
chk_check_salidas as (
  select
    4 as orden,
    'constraint: programa_salidas_impuestos_no_negativos_check' as chequeo,
    case
      when c.oid is null then 'FALLÓ — el CHECK no existe'
      when pg_get_constraintdef(c.oid) =
        'CHECK ((((impuesto_sencilla IS NULL) OR (impuesto_sencilla >= (0)::numeric)) AND ((impuesto_doble IS NULL) OR (impuesto_doble >= (0)::numeric)) AND ((impuesto_triple IS NULL) OR (impuesto_triple >= (0)::numeric)) AND ((impuesto_multiple IS NULL) OR (impuesto_multiple >= (0)::numeric))))'
      then 'PASÓ — definición exacta esperada'
      else 'FALLÓ — definición distinta: ' || pg_get_constraintdef(c.oid)
    end as resultado,
    (c.oid is null or pg_get_constraintdef(c.oid) is distinct from
      'CHECK ((((impuesto_sencilla IS NULL) OR (impuesto_sencilla >= (0)::numeric)) AND ((impuesto_doble IS NULL) OR (impuesto_doble >= (0)::numeric)) AND ((impuesto_triple IS NULL) OR (impuesto_triple >= (0)::numeric)) AND ((impuesto_multiple IS NULL) OR (impuesto_multiple >= (0)::numeric))))'
    ) as fallo
  from (select 1) _uno
  left join pg_constraint c
    on c.conname = 'programa_salidas_impuestos_no_negativos_check'
   and c.conrelid = 'public.programa_salidas'::regclass
),

-- 5) RPC: firma, lenguaje, NO security definer, y que el cuerpo contenga el
--    lock (SELECT ... FOR UPDATE) y la clave nueva `impuestoPorAcomodacion`.
chk_funcion as (
  select
    5 as orden,
    'función: guardar_programa_salidas(bigint, jsonb, jsonb)' as chequeo,
    case
      when p.oid is null then 'FALLÓ — la función no existe'
      when l.lanname <> 'plpgsql' then 'FALLÓ — lenguaje inesperado: ' || l.lanname
      when p.prosecdef then 'FALLÓ — quedó como SECURITY DEFINER (debe correr con el rol de quien llama)'
      when position('for update' in lower(pg_get_functiondef(p.oid))) = 0 then
        'FALLÓ — el cuerpo NO contiene "for update": el guardado no está bloqueando la fila'
      when position('impuestoporacomodacion' in lower(pg_get_functiondef(p.oid))) = 0 then
        'FALLÓ — el cuerpo NO contiene "impuestoPorAcomodacion": no parece la versión de la migración 163'
      else
        'PASÓ — lang=plpgsql, security_definer=false, contiene SELECT...FOR UPDATE e impuestoPorAcomodacion'
    end as resultado,
    (p.oid is null
      or l.lanname <> 'plpgsql'
      or p.prosecdef
      or position('for update' in lower(pg_get_functiondef(p.oid))) = 0
      or position('impuestoporacomodacion' in lower(pg_get_functiondef(p.oid))) = 0
    ) as fallo
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join pg_language l on l.oid = p.prolang
  where p.proname = 'guardar_programa_salidas'
    and pg_get_function_identity_arguments(p.oid) = 'p_programa_id bigint, p_regla jsonb, p_salidas jsonb'
),

-- 6) No deben quedar overloads con otra firma.
chk_funcion_overloads as (
  select
    6 as orden,
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

-- 7) ACL: PUBLIC y anon SIN ejecución; authenticated CON ejecución.
chk_acl as (
  select
    7 as orden,
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

-- 8) Datos históricos: TODOS los programas deben quedar con la opción nueva
--    en false justo después de la migración (sin backfill que cambie nada).
chk_datos_historicos as (
  select
    8 as orden,
    'datos existentes: todos con regla_comisionable_impuesto_por_acomodacion=false (correr ANTES de probar el preview)' as chequeo,
    case
      when count(*) = 0 then
        'PASÓ — ' || (select count(*) from public.programas) || ' programa(s) totales, 0 con la opción activa'
      else
        'AVISO — ' || count(*) || ' programa(s) YA tienen la opción activa. Si ya se probó el Vercel preview y se activó ' ||
        'a propósito, esto es ESPERADO, no una falla. Si este script se corrió inmediatamente después de la migración y ' ||
        'ANTES de cualquier prueba, investigar: id ' || string_agg(id::text, ', ')
    end as resultado,
    false as fallo  -- nunca bloquea el veredicto duro: depende del momento en que se corra (ver nota arriba)
  from public.programas
  where regla_comisionable_impuesto_por_acomodacion = true
),

filas as (
  select * from chk_columna_programas
  union all select * from chk_columnas_salidas
  union all select * from chk_check_programas
  union all select * from chk_check_salidas
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
    else 'PASSED — migración 163 aplicada correctamente (chequeo 8 es informativo, ver su nota)'
  end as veredicto_final
from filas
order by orden;
