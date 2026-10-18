-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 214 · registro central de personas (#32). SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 214 y con el MISMO rol que la aplicará (en Supabase, el del SQL
-- editor): la consulta de la 214 es SECURITY DEFINER y depende de los atributos de ese rol.
-- Devuelve UNA sola fila consolidada:
--   veredicto   BLOQUEANTE si alguna verificación lo es; si no, INFO.
--   bloqueantes / revisar   cuántas verificaciones tienen ese nivel; chequeos = 10 (P1-P10).
--   resumen     P1=NIVEL/cantidad;P2=...;P10=...  (todas, en orden).
--   mensaje     qué hacer con este resultado.
--   detalle     jsonb con cada verificación: codigo, nivel, cantidad y su explicación.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR · INFO. Sin datos personales.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
cols(tabla, columna) as (
  values ('usuarios', 'id'), ('usuarios', 'rol'), ('usuarios', 'activo'), ('usuarios', 'tenant'), ('usuarios', 'nombre'),
         ('ventas', 'numero_contrato'), ('ventas', 'tenant'), ('ventas', 'asesor'),
         ('contrato_pasajeros', 'id'), ('contrato_pasajeros', 'numero_contrato')
),
faltan_cols as (
  select c.tabla || '.' || c.columna as col
    from cols c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.' || c.tabla) and a.attname = c.columna
                        and a.attnum > 0 and not a.attisdropped)
),
blandas as (
  -- Por catálogo: information_schema oculta las tablas que el rol que ejecuta no puede leer.
  select a.attrelid
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (a.attname in ('persona_id', 'captura_id') or a.attname like '%\_persona\_id' escape '\')
     and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_toast'
     and not pg_catalog.pg_is_other_temp_schema(n.oid)
     and not (n.nspname = 'public' and c.relname in ('personas', 'persona_capturas', 'persona_observaciones'))
),
yo as (
  select r.rolname, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user
),
lee_sin_rls as (
  select t.tabla,
         coalesce((select y.rolsuper or y.rolbypassrls from yo y), false)
           or coalesce((select pg_get_userbyid(c.relowner) = current_user from pg_class c where c.oid = to_regclass('public.' || t.tabla)), false) as ok
    from (values ('usuarios'), ('ventas')) t(tabla)
),
chequeos as (
  select 'P1' as codigo,
         case when to_regclass('public.usuarios') is null or to_regclass('public.ventas') is null
                or to_regclass('public.contrato_pasajeros') is null
                or to_regprocedure('public.soy_ese_asesor(text)') is null or to_regprocedure('auth.uid()') is null
              then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regclass('public.usuarios') is not null)::int + (to_regclass('public.ventas') is not null)::int
           + (to_regclass('public.contrato_pasajeros') is not null)::int
           + (to_regprocedure('public.soy_ese_asesor(text)') is not null)::int
           + (to_regprocedure('auth.uid()') is not null)::int as cantidad,
         'usuarios, ventas, contrato_pasajeros, soy_ese_asesor(text) (142) y auth.uid() presentes (esperado: 5)' as detalle
  union all
  select 'P2',
         case when exists (select 1 from faltan_cols) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from faltan_cols),
         'Columnas que la 214 lee: ' || coalesce((select string_agg(col, ', ') from faltan_cols), 'todas presentes')
  union all
  select 'P3',
         case when (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) = 3
              then 'INFO' else 'BLOQUEANTE' end,
         (select count(*)::int from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
         'Roles anon, authenticated y service_role presentes (esperado: 3)'
  union all
  select 'P4',
         case when exists (select 1 from lee_sin_rls where not ok) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from lee_sin_rls where ok),
         'El rol actual (' || current_user || ') lee usuarios y ventas sin RLS (superusuario, BYPASSRLS o dueño); esperado: 2. '
           || 'Si no, la consulta SECURITY DEFINER devolvería vacío a todos.'
  union all
  select 'P5',
         case when to_regclass('public.personas') is null and to_regclass('public.persona_capturas') is null
                   and to_regclass('public.persona_observaciones') is null and to_regnamespace('p214_priv') is null
              then 'INFO'
              when exists (select 1 from pg_catalog.pg_attribute a
                            where a.attrelid = to_regclass('public.personas') and a.attname = 'estado_doc'
                              and a.attnum > 0 and not a.attisdropped)
                   and to_regnamespace('p214_priv') is not null
              then 'REVISAR'
              else 'BLOQUEANTE' end,
         (to_regclass('public.personas') is not null)::int + (to_regclass('public.persona_capturas') is not null)::int
           + (to_regclass('public.persona_observaciones') is not null)::int + (to_regnamespace('p214_priv') is not null)::int,
         'Objetos de la 214: 0 = no aplicada (INFO); 4 con la estructura de la 214 = ya aplicada (REVISAR, es idempotente); '
           || 'nombres ocupados por otra cosa = BLOQUEANTE'
  union all
  select 'P6',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'buscar_personas_documento'
                              and pg_get_function_identity_arguments(p.oid) <> 'p_tenant text, p_tipo_doc text, p_numero text, p_limite integer, p_offset integer')
              then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'buscar_personas_documento'),
         'Funciones public.buscar_personas_documento existentes (una con otra firma bloquea)'
  union all
  select 'P7',
         case when exists (select 1 from blandas) then 'REVISAR' else 'INFO' end,
         (select count(*)::int from blandas),
         'Columnas ajenas llamadas persona_id / captura_id / *_persona_id (el rollback de la 214 se niega si existen; esperado: 0)'
  union all
  select 'P8', 'INFO',
         (select count(*)::int from public.usuarios u where u.tenant is null or u.tenant not in ('mayorista', 'minorista')),
         'Usuarios con tenant nulo o fuera de mayorista/minorista (la consulta les responde vacío)'
  union all
  select 'P9',
         case when exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and contype = 'p') then 'INFO' else 'REVISAR' end,
         (select count(*)::int from pg_constraint where conrelid = 'public.ventas'::regclass and contype = 'p'),
         'ventas.numero_contrato es PK global hoy; la 214 no depende de ello (compara número y tenant en la misma fila)'
  union all
  select 'P10',
         case when to_regprocedure('gen_random_uuid()') is null then 'BLOQUEANTE' else 'INFO' end,
         (to_regprocedure('gen_random_uuid()') is not null)::int,
         'gen_random_uuid() disponible (ids de personas y observaciones)'
),
orden as (
  select c.codigo, c.nivel, c.cantidad, c.detalle, row_number() over (order by length(c.codigo), c.codigo) as n
    from chequeos c
)
select case when count(*) filter (where o.nivel = 'BLOQUEANTE') > 0 then 'BLOQUEANTE' else 'INFO' end as veredicto,
       count(*) filter (where o.nivel = 'BLOQUEANTE')::int as bloqueantes,
       count(*) filter (where o.nivel = 'REVISAR')::int as revisar,
       count(*)::int as chequeos,
       string_agg(o.codigo || '=' || o.nivel || '/' || o.cantidad, ';' order by o.n) as resumen,
       case when count(*) filter (where o.nivel = 'BLOQUEANTE') > 0
            then 'PREFLIGHT: hay BLOQUEANTES; no aplicar la 214.'
            else 'PREFLIGHT: sin bloqueantes; revisa los REVISAR y aplica la 214 con este mismo rol.' end as mensaje,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'nivel', o.nivel, 'cantidad', o.cantidad, 'detalle', o.detalle)
                 order by o.n) as detalle
  from orden o;

rollback;
