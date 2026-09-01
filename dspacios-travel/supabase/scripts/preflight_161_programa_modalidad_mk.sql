-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-DEPLOY · SOLO LECTURA · migración 20260601000161_programa_modalidad_mk_comisionable.sql
-- PR #277 (rama programas-comisionable-mk-modalidad) · commit 943785022fe560079d33135876417f67ffab1d49
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) ANTES de aplicar la
-- migración 161. NO contiene ningún INSERT/UPDATE/DELETE/DDL — únicamente
-- SELECT sobre catálogos del sistema y sobre public.programas. Se puede
-- correr las veces que haga falta sin ningún efecto secundario.
--
-- Orden de despliegue completo (ver también el cuerpo del PR #277):
--   1) este script (preflight)         → confirmar veredicto = OK
--   2) 20260601000161_programa_modalidad_mk_comisionable.sql
--   3) postcheck_161_programa_modalidad_mk.sql → confirmar veredicto = PASSED
--   4) probar en el Vercel preview del PR (guardar un programa con la
--      modalidad nueva y con la histórica; probar el caso límite de base
--      neta negativa; NO afecta producción, el preview apunta al MISMO
--      Supabase pero el código nuevo solo se activa en esa URL hasta hacer
--      merge)
--   5) recién ahí, fusionar el PR #277
--
-- No toca ni depende de la migración 161 propuesta por PR #276
-- (`tarifario_resumen.sql`, PAUSADA) — ver el aviso de numeración en la
-- cabecera de la propia migración 161 de este PR.
-- ═══════════════════════════════════════════════════════════════════════════

with

-- 1) La columna nueva no debe existir todavía (o, si ya existe, debe tener
--    EXACTAMENTE el tipo/nullable/default que la migración va a auditar —
--    en ese caso el ALTER TABLE de la migración es un no-op seguro).
chk_columna as (
  select
    1 as orden,
    'columna: public.programas.regla_comisionable_modalidad_mk' as chequeo,
    case
      when count(*) = 0 then
        'OK — no existe todavía; la migración la creará limpia'
      when count(*) = 1
        and max(data_type) = 'text'
        and max(is_nullable) = 'NO'
        and max(column_default) = '''historica''::text'
      then
        'OK (ya aplicada) — existe con el tipo/nullable/default esperado; el ALTER TABLE de la migración será un no-op seguro'
      else
        'BLOQUEADO — existe con tipo=' || coalesce(max(data_type), '?') ||
        ' nullable=' || coalesce(max(is_nullable), '?') ||
        ' default=' || coalesce(max(column_default), 'NULL') ||
        ' (no coincide con lo esperado; el propio audit de la migración abortará)'
    end as resultado,
    (count(*) = 1 and not (
      max(data_type) = 'text'
      and max(is_nullable) = 'NO'
      and max(column_default) = '''historica''::text'
    )) as bloqueante
  from information_schema.columns
  where table_schema = 'public' and table_name = 'programas'
    and column_name = 'regla_comisionable_modalidad_mk'
),

-- 2) Si ya existe un CHECK con el mismo nombre, su definición normalizada
--    debe coincidir EXACTO con la que la migración espera (mismo criterio
--    que el audit interno de la propia migración — pg_get_constraintdef).
chk_check as (
  select
    2 as orden,
    'constraint: programas_regla_comisionable_modalidad_mk_check' as chequeo,
    case
      when c.oid is null then
        'OK — no existe todavía; la migración lo creará'
      when pg_get_constraintdef(c.oid) =
        'CHECK ((regla_comisionable_modalidad_mk = ANY (ARRAY[''historica''::text, ''base_neta_impuestos_al_final''::text])))'
      then
        'OK (ya aplicado) — existe con la definición exacta esperada'
      else
        'BLOQUEADO — existe con OTRA definición: ' || pg_get_constraintdef(c.oid)
    end as resultado,
    (c.oid is not null and pg_get_constraintdef(c.oid) is distinct from
      'CHECK ((regla_comisionable_modalidad_mk = ANY (ARRAY[''historica''::text, ''base_neta_impuestos_al_final''::text])))'
    ) as bloqueante
  from (select 1) _uno
  left join pg_constraint c
    on c.conname = 'programas_regla_comisionable_modalidad_mk_check'
   and c.conrelid = 'public.programas'::regclass
),

-- 3) La función guardar_programa_salidas(bigint,jsonb,jsonb) — la que la
--    migración 151 ya desplegó y que esta migración va a `create or
--    replace` — debe existir con exactamente esa firma. Se incluye un
--    fingerprint (md5 de pg_get_functiondef) para poder comparar antes/
--    después sin imprimir el cuerpo completo acá.
chk_funcion_firma as (
  select
    3 as orden,
    'función: guardar_programa_salidas — firma esperada (bigint, jsonb, jsonb)' as chequeo,
    case
      when p.oid is null then
        'BLOQUEADO — no existe ninguna guardar_programa_salidas con esta firma (se esperaba la de la migración 151 ya desplegada)'
      else
        'OK — existe · lang=' || l.lanname ||
        ' security_definer=' || p.prosecdef::text ||
        ' owner=' || pg_get_userbyid(p.proowner) ||
        ' md5_definicion_actual=' || md5(pg_get_functiondef(p.oid))
    end as resultado,
    (p.oid is null) as bloqueante
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join pg_language l on l.oid = p.prolang
  where p.proname = 'guardar_programa_salidas'
    and pg_get_function_identity_arguments(p.oid) = 'p_programa_id bigint, p_regla jsonb, p_salidas jsonb'
),

-- 4) No debe haber overloads de guardar_programa_salidas con OTRA firma —
--    si los hubiera, el `create or replace function` de la migración
--    agregaría un overload nuevo EN VEZ de reemplazar, dejando dos
--    funciones con el mismo nombre y ambigüedad de cuál llama PostgREST.
chk_funcion_overloads as (
  select
    4 as orden,
    'función: guardar_programa_salidas — overloads con OTRA firma' as chequeo,
    case
      when count(*) = 0 then 'OK — no hay overloads con otra firma'
      else
        'BLOQUEADO — existen ' || count(*) || ' overload(s) con firma distinta: ' ||
        string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    end as resultado,
    (count(*) > 0) as bloqueante
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.proname = 'guardar_programa_salidas'
    and pg_get_function_identity_arguments(p.oid) <> 'p_programa_id bigint, p_regla jsonb, p_salidas jsonb'
),

-- 5) Permisos ACTUALES (antes de la migración) sobre la función — la
--    migración siempre vuelve a fijar PUBLIC=false/anon=false/
--    authenticated=true, así que esto es informativo, no bloqueante.
chk_permisos as (
  select
    5 as orden,
    'permisos actuales sobre guardar_programa_salidas(bigint,jsonb,jsonb)' as chequeo,
    'PUBLIC=' || has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' · anon=' || has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' · authenticated=' || has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' (la migración 161 siempre vuelve a fijar PUBLIC=false, anon=false, authenticated=true)' as resultado,
    false as bloqueante
),

-- 6) Blast radius informativo: cuántos programas tienen la regla
--    comisionable activa hoy (todos seguirán en modalidad 'historica'
--    justo después de la migración, sin excepción — no hay backfill).
chk_programas_activos as (
  select
    6 as orden,
    'programas con regla_comisionable = true (informativo, blast radius)' as chequeo,
    count(*)::text || ' programa(s) — TODOS quedarán en modalidad ''historica'' tras la migración (sin backfill, sin cambio de comportamiento)' as resultado,
    false as bloqueante
  from public.programas
  where regla_comisionable = true
),

-- 7) Higiene de datos (no bloquea la 161: es ADITIVA y no valida filas
--    existentes — el ALTER TABLE agrega la columna con un DEFAULT
--    constante, sin evaluar ninguna otra columna de la fila). Solo avisa
--    si YA hay datos que no deberían existir según los CHECK de la 151
--    (que deberían garantizar 0 filas aquí; sirve de chequeo de integridad
--    independiente, por si algún CHECK fue deshabilitado a mano alguna vez).
chk_datos_corruptos as (
  select
    7 as orden,
    'programas con regla activa y modo/valor/comisión ya inválidos (higiene; NO bloquea la 161)' as chequeo,
    case
      when count(*) = 0 then
        'OK — 0 filas; los CHECK de la migración 151 ya garantizan esto'
      else
        'AVISO — ' || count(*) || ' fila(s) con datos que no deberían existir (revisar antes de activar la modalidad nueva en esos programas): id ' ||
        string_agg(id::text, ', ')
    end as resultado,
    false as bloqueante
  from public.programas
  where regla_comisionable = true
    and (
      regla_comisionable_modo not in ('pct', 'impuesto', 'ninguno')
      or regla_comisionable_pct_comision is null
      or regla_comisionable_pct_comision < 0
      or regla_comisionable_pct_comision > 100
      or (regla_comisionable_modo = 'pct'
          and (regla_comisionable_valor is null or regla_comisionable_valor < 0 or regla_comisionable_valor > 100))
      or (regla_comisionable_modo = 'impuesto'
          and (regla_comisionable_valor is null or regla_comisionable_valor < 0))
    )
),

filas as (
  select * from chk_columna
  union all select * from chk_check
  union all select * from chk_funcion_firma
  union all select * from chk_funcion_overloads
  union all select * from chk_permisos
  union all select * from chk_programas_activos
  union all select * from chk_datos_corruptos
)

select
  orden,
  chequeo,
  resultado,
  bloqueante,
  case
    when bool_or(bloqueante) over () then 'BLOQUEADO — no aplicar la migración 161 hasta resolver la(s) fila(s) marcada(s) bloqueante=true'
    else 'OK — puede aplicarse la migración 161'
  end as veredicto_final
from filas
order by orden;
