-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-DEPLOY · SOLO LECTURA · migración 20260601000163_programa_impuesto_por_acomodacion.sql
-- rama programas-impuestos-por-acomodacion
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) ANTES de aplicar la
-- migración 163. NO contiene ningún INSERT/UPDATE/DELETE/DDL — únicamente
-- SELECT sobre catálogos del sistema y sobre public.programas/programa_salidas.
-- Se puede correr las veces que haga falta sin ningún efecto secundario.
--
-- Orden de despliegue completo:
--   1) este script (preflight)              → confirmar veredicto = OK
--   2) 20260601000163_programa_impuesto_por_acomodacion.sql
--   3) postcheck_163_programa_impuesto_por_acomodacion.sql → confirmar veredicto = PASSED
--   4) probar en el Vercel preview del PR (activar "Impuesto distinto por
--      acomodación" en un programa, guardar los 4 impuestos, confirmar que
--      Niño no desaparece del resumen/detalle/editor; NO afecta producción,
--      el preview apunta al MISMO Supabase pero el código nuevo solo se
--      activa en esa URL hasta hacer merge)
--   5) recién ahí, fusionar el PR a main
--
-- No ejecutar contra producción real ni fusionar sin validación explícita del
-- dueño — ver CLAUDE.md.
-- ═══════════════════════════════════════════════════════════════════════════

with

-- 1) La columna nueva de `programas` no debe existir todavía (o, si ya
--    existe, debe tener EXACTAMENTE el tipo/nullable/default que la
--    migración va a auditar — en ese caso el ALTER TABLE es un no-op seguro).
chk_columna_programas as (
  select
    1 as orden,
    'columna: public.programas.regla_comisionable_impuesto_por_acomodacion' as chequeo,
    case
      when count(*) = 0 then
        'OK — no existe todavía; la migración la creará limpia'
      when count(*) = 1
        and max(data_type) = 'boolean'
        and max(is_nullable) = 'NO'
        and max(column_default) = 'false'
      then
        'OK (ya aplicada) — existe con el tipo/nullable/default esperado; el ALTER TABLE será un no-op seguro'
      else
        'BLOQUEADO — existe con tipo=' || coalesce(max(data_type), '?') ||
        ' nullable=' || coalesce(max(is_nullable), '?') ||
        ' default=' || coalesce(max(column_default), 'NULL') ||
        ' (no coincide con lo esperado; el propio audit de la migración abortará)'
    end as resultado,
    (count(*) = 1 and not (
      max(data_type) = 'boolean'
      and max(is_nullable) = 'NO'
      and max(column_default) = 'false'
    )) as bloqueante
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
      when count(*) filter (where existe) = 0 then
        'OK — ninguna existe todavía; la migración las creará limpias'
      when count(*) filter (where existe) = 4
        and count(*) filter (where existe and not compatible) = 0
      then
        'OK (ya aplicadas) — las 4 existen con tipo=numeric, nullable; el ALTER TABLE será un no-op seguro'
      when count(*) filter (where existe and not compatible) > 0 then
        'BLOQUEADO — ' || string_agg(v_col || ' (tipo=' || coalesce(v_tipo, '?') || ' nullable=' || coalesce(v_nullable, '?') || ')', ', ') filter (where existe and not compatible) ||
        ' no coincide(n) con lo esperado; el propio audit de la migración abortará'
      else
        'OK (parcial) — solo algunas existen ya (' || count(*) filter (where existe) || ' de 4); las que falten se crearán limpias, las existentes coinciden'
    end as resultado,
    (count(*) filter (where existe and not compatible) > 0) as bloqueante
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

-- 3) Si ya existe un CHECK con el mismo nombre en `programas`, su definición
--    normalizada debe coincidir EXACTO con la que la migración espera.
chk_check_programas as (
  select
    3 as orden,
    'constraint: programas_impuesto_por_acomodacion_modo_check' as chequeo,
    case
      when c.oid is null then
        'OK — no existe todavía; la migración lo creará'
      when pg_get_constraintdef(c.oid) =
        'CHECK (((NOT regla_comisionable_impuesto_por_acomodacion) OR (regla_comisionable_modo = ''impuesto''::text)))'
      then
        'OK (ya aplicado) — existe con la definición exacta esperada'
      else
        'BLOQUEADO — existe con OTRA definición: ' || pg_get_constraintdef(c.oid)
    end as resultado,
    (c.oid is not null and pg_get_constraintdef(c.oid) is distinct from
      'CHECK (((NOT regla_comisionable_impuesto_por_acomodacion) OR (regla_comisionable_modo = ''impuesto''::text)))'
    ) as bloqueante
  from (select 1) _uno
  left join pg_constraint c
    on c.conname = 'programas_impuesto_por_acomodacion_modo_check'
   and c.conrelid = 'public.programas'::regclass
),

-- 4) Ídem para el CHECK de no-negatividad en `programa_salidas`.
chk_check_salidas as (
  select
    4 as orden,
    'constraint: programa_salidas_impuestos_no_negativos_check' as chequeo,
    case
      when c.oid is null then
        'OK — no existe todavía; la migración lo creará'
      when pg_get_constraintdef(c.oid) =
        'CHECK ((((impuesto_sencilla IS NULL) OR (impuesto_sencilla >= (0)::numeric)) AND ((impuesto_doble IS NULL) OR (impuesto_doble >= (0)::numeric)) AND ((impuesto_triple IS NULL) OR (impuesto_triple >= (0)::numeric)) AND ((impuesto_multiple IS NULL) OR (impuesto_multiple >= (0)::numeric))))'
      then
        'OK (ya aplicado) — existe con la definición exacta esperada'
      else
        'BLOQUEADO — existe con OTRA definición: ' || pg_get_constraintdef(c.oid)
    end as resultado,
    (c.oid is not null and pg_get_constraintdef(c.oid) is distinct from
      'CHECK ((((impuesto_sencilla IS NULL) OR (impuesto_sencilla >= (0)::numeric)) AND ((impuesto_doble IS NULL) OR (impuesto_doble >= (0)::numeric)) AND ((impuesto_triple IS NULL) OR (impuesto_triple >= (0)::numeric)) AND ((impuesto_multiple IS NULL) OR (impuesto_multiple >= (0)::numeric))))'
    ) as bloqueante
  from (select 1) _uno
  left join pg_constraint c
    on c.conname = 'programa_salidas_impuestos_no_negativos_check'
   and c.conrelid = 'public.programa_salidas'::regclass
),

-- 5) La función guardar_programa_salidas(bigint,jsonb,jsonb) — la que la
--    migración 161 dejó y que esta migración va a `create or replace` —
--    debe existir con exactamente esa firma.
chk_funcion_firma as (
  select
    5 as orden,
    'función: guardar_programa_salidas — firma esperada (bigint, jsonb, jsonb)' as chequeo,
    case
      when p.oid is null then
        'BLOQUEADO — no existe ninguna guardar_programa_salidas con esta firma (se esperaba la de la migración 161 ya desplegada)'
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

-- 6) No debe haber overloads de guardar_programa_salidas con OTRA firma.
chk_funcion_overloads as (
  select
    6 as orden,
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

-- 7) Permisos ACTUALES sobre la función — informativo, la migración siempre
--    vuelve a fijar PUBLIC=false/anon=false/authenticated=true.
chk_permisos as (
  select
    7 as orden,
    'permisos actuales sobre guardar_programa_salidas(bigint,jsonb,jsonb)' as chequeo,
    'PUBLIC=' || has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' · anon=' || has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' · authenticated=' || has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE')::text ||
    ' (la migración 163 siempre vuelve a fijar PUBLIC=false, anon=false, authenticated=true)' as resultado,
    false as bloqueante
),

-- 8) Blast radius informativo: cuántos programas ya usan modo 'impuesto' con
--    la regla activa (candidatos naturales a usar la opción nueva).
chk_programas_modo_impuesto as (
  select
    8 as orden,
    'programas con regla_comisionable=true y modo=''impuesto'' (informativo, blast radius)' as chequeo,
    count(*)::text || ' programa(s) — todos nacen con regla_comisionable_impuesto_por_acomodacion=false tras la migración (sin backfill, sin cambio de comportamiento)' as resultado,
    false as bloqueante
  from public.programas
  where regla_comisionable = true and regla_comisionable_modo = 'impuesto'
),

-- 9) Higiene de datos (no bloquea la 163: es ADITIVA y no valida filas
--    existentes). Solo avisa si ya hay datos que no deberían existir según
--    los CHECK de migraciones previas.
chk_datos_corruptos as (
  select
    9 as orden,
    'programas con regla activa y modo/valor/comisión ya inválidos (higiene; NO bloquea la 163)' as chequeo,
    case
      when count(*) = 0 then
        'OK — 0 filas; los CHECK previos ya garantizan esto'
      else
        'AVISO — ' || count(*) || ' fila(s) con datos que no deberían existir (revisar antes de activar la opción nueva en esos programas): id ' ||
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
  select * from chk_columna_programas
  union all select * from chk_columnas_salidas
  union all select * from chk_check_programas
  union all select * from chk_check_salidas
  union all select * from chk_funcion_firma
  union all select * from chk_funcion_overloads
  union all select * from chk_permisos
  union all select * from chk_programas_modo_impuesto
  union all select * from chk_datos_corruptos
)

select
  orden,
  chequeo,
  resultado,
  bloqueante,
  case
    when bool_or(bloqueante) over () then 'BLOQUEADO — no aplicar la migración 163 hasta resolver la(s) fila(s) marcada(s) bloqueante=true'
    else 'OK — puede aplicarse la migración 163'
  end as veredicto_final
from filas
order by orden;
