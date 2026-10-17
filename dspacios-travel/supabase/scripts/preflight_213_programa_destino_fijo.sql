-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 213 · destino fijo de programas. SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 213. Una fila por verificación: codigo | nivel | cantidad | detalle.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR · INFO.
-- H1/H2 responden la pregunta operativa: cuántos programas PUBLICADOS quedarían ocultos
-- del tarifario público en cuanto se despliegue el código (ninguno trae destino al inicio).
-- H1 es COMPLETO y sin truncar: una fila H1L por programa (id y nombre) y una fila H1V con sus ids.
-- H1 es la verificación de VISIBILIDAD PÚBLICA (publicados y activos sin destino).
-- N1 es el INVENTARIO completo de TODOS los programas con destino_fijo_id = NULL (publicados o no,
-- activos o no: también borradores e inactivos): una fila N1L por programa (id, estado y nombre) y una
-- fila N1V con los ids listos para pegar en la plantilla del provisional. Sin límite de filas ni recorte.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
-- to_jsonb permite leer destino_fijo_id aunque la columna todavía no exista.
prog as (
  select p.id, p.nombre, p.activo, p.publicado,
         nullif(to_jsonb(p)->>'destino_fijo_id', '') as destino_fijo_id
    from public.programas p
),
ocultos_pub as (select * from prog where publicado and activo and destino_fijo_id is null),
sin_destino as (select * from prog where destino_fijo_id is null),
chequeos as (
  select 'P1' as codigo,
         case when to_regclass('public.programas') is null or to_regprocedure('public.mi_rol()') is null
                or to_regprocedure('public.clave_ciudad_ruta(text)') is null
              then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regclass('public.programas') is not null)::int + (to_regprocedure('public.mi_rol()') is not null)::int
           + (to_regprocedure('public.clave_ciudad_ruta(text)') is not null)::int as cantidad,
         'programas, mi_rol() y clave_ciudad_ruta() (migración 212) presentes (esperado: 3). Sin la 212 la 213 se niega.' as detalle
  union all
  select 'P2',
         case when to_regclass('public.programa_destinos_fijos') is null
                   and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='programas' and column_name='destino_fijo_id')
              then 'INFO' else 'REVISAR' end,
         (to_regclass('public.programa_destinos_fijos') is not null)::int
           + (exists (select 1 from information_schema.columns where table_schema='public' and table_name='programas' and column_name='destino_fijo_id'))::int,
         '213 aún no aplicada (cantidad 0) / ya aplicada o parcial (la migración es idempotente)'
  union all
  select 'P3',
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='programas'
                              and column_name='destino_fijo_id' and data_type <> 'bigint') then 'BLOQUEANTE' else 'INFO' end,
         0,
         'Si programas.destino_fijo_id ya existe, debe ser bigint'
  union all
  select 'H1', 'INFO', (select count(*)::int from ocultos_pub),
         'Programas PUBLICADOS y activos SIN destino fijo = quedarían OCULTOS del tarifario público al desplegar el código: '
         || (select count(*) from ocultos_pub)
         || ' (lista COMPLETA en las filas H1L, una por programa; H1V trae los ids listos para pegar en la plantilla)'
  union all
  select 'H1L', 'INFO', o.id::bigint, o.id || ' ' || o.nombre from ocultos_pub o
  union all
  select 'H1V', 'INFO', (select count(*)::int from ocultos_pub),
         coalesce((select string_agg('(' || id || ')', ',' order by id) from ocultos_pub), '(ninguno)')
  union all
  select 'N1', 'INFO', (select count(*)::int from sin_destino),
         'INVENTARIO: TODOS los programas con destino_fijo_id = NULL (publicados, borradores e inactivos): '
         || (select count(*) from sin_destino)
         || ' · publicados y activos: ' || (select count(*) from sin_destino where publicado and activo)
         || ' · borradores activos: ' || (select count(*) from sin_destino where activo and not publicado)
         || ' · inactivos: ' || (select count(*) from sin_destino where not activo)
         || ' (lista COMPLETA en las filas N1L; N1V trae TODOS los ids para pegar en la plantilla del provisional)'
  union all
  select 'N1L', 'INFO', s.id::bigint,
         s.id || ' [' || case when s.publicado and s.activo then 'publicado' when s.activo then 'borrador' else 'inactivo' end || '] ' || s.nombre
    from sin_destino s
  union all
  select 'N1V', 'INFO', (select count(*)::int from sin_destino),
         coalesce((select string_agg('(' || id || ')', ',' order by id) from sin_destino), '(ninguno)')
  union all
  select 'H2', 'INFO', (select count(*)::int from prog where activo and destino_fijo_id is null),
         'Programas activos sin destino (los que contará el aviso del panel): ' || (select count(*) from prog where activo and destino_fijo_id is null)
         || ' de ' || (select count(*) from prog where activo) || ' activos · publicados activos con destino ya asignado: '
         || (select count(*) from prog where publicado and activo and destino_fijo_id is not null)
  union all
  select 'H3', 'INFO', (select count(*)::int from prog where not activo and publicado),
         'Programas publicados pero INACTIVOS (ya estaban fuera del tarifario por activo=false)'
  union all
  select 'P4',
         case when coalesce((select relrowsecurity from pg_class where oid = 'public.programas'::regclass), false) then 'INFO' else 'REVISAR' end,
         (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'programas'),
         'RLS y políticas de programas (la lectura pública sigue como estaba; la 213 no la cambia)'
  union all
  select 'P5', 'INFO', 1,
         'Despliegue: aplicar la 213 ANTES del código (el código viejo ignora la columna nueva). Luego, con supabase/scripts/plantilla_asignacion_213.sql: crear el destino provisional «Por clasificar» y asignarle TODOS los programas del inventario N1V (vista previa; verifica que no quede ningún programa sin destino y que H1 quede en 0) ANTES de desplegar el código. Después, en la app, crear los destinos reales y reasignar cada programa. Ver docs/tecnico/programas-destino-fijo.md sección 4.'
)
select codigo, nivel, cantidad, detalle from chequeos order by length(codigo), codigo, cantidad;

select case when to_regclass('public.programas') is null or to_regprocedure('public.mi_rol()') is null
              or to_regprocedure('public.clave_ciudad_ruta(text)') is null
              or exists (select 1 from information_schema.columns where table_schema='public' and table_name='programas'
                           and column_name='destino_fijo_id' and data_type <> 'bigint')
            then 'PREFLIGHT: hay BLOQUEANTES (P1/P3); no aplicar.'
            else 'PREFLIGHT: sin bloqueantes; pega N1V (inventario completo) en la plantilla del provisional y córrela antes de desplegar el código; H1L son los que se ocultarían.' end as veredicto;

rollback;
