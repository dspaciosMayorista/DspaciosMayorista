-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 212 · SOLO LECTURA (read only + ROLLBACK). Correr DESPUÉS de aplicar la 212.
-- Una fila por verificación: codigo | ok | detalle. Todas deben dar ok = true.
-- No escribe ni invoca la RPC (el comportamiento se prueba en local: test_212_*).
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with f as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner
    from pg_proc p where p.oid = to_regprocedure('public.reemplazar_ruta_programa(bigint,jsonb)')
)
select * from (
  select 'C1' as codigo,
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programa_ciudades'
                   and column_name = 'alojamiento_previsto' and data_type = 'text' and is_nullable = 'YES' and column_default is null) as ok,
         'Columna alojamiento_previsto text NULL sin default' as detalle
  union all
  select 'C2',
         exists (select 1 from pg_constraint where conrelid = 'public.programa_ciudades'::regclass
                   and conname = 'programa_ciudades_alojamiento_previsto_len' and convalidated),
         'CHECK de 200 caracteres presente y validado'
  union all
  select 'C3', exists (select 1 from f where not prosecdef),
         'reemplazar_ruta_programa existe y es SECURITY INVOKER (manda la RLS)'
  union all
  select 'C4', exists (select 1 from f where coalesce(proconfig, '{}') @> array['search_path=public, pg_temp']),
         'search_path fijado a public, pg_temp'
  union all
  select 'C5', exists (select 1 from f) and not has_function_privilege('anon', 'public.reemplazar_ruta_programa(bigint,jsonb)', 'execute'),
         'anon NO ejecuta la RPC'
  union all
  select 'C6', exists (select 1 from f)
               and not exists (select 1 from f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0),
         'PUBLIC NO ejecuta la RPC'
  union all
  select 'C7', exists (select 1 from f) and has_function_privilege('authenticated', 'public.reemplazar_ruta_programa(bigint,jsonb)', 'execute'),
         'authenticated SÍ ejecuta la RPC'
  union all
  select 'C8', to_regprocedure('public.clave_ciudad_ruta(text)') is not null
               and coalesce((select provolatile = 'i' from pg_proc where oid = to_regprocedure('public.clave_ciudad_ruta(text)')), false),
         'clave_ciudad_ruta(text) presente e IMMUTABLE'
  union all
  select 'C9', coalesce((select relrowsecurity from pg_class where oid = 'public.programa_ciudades'::regclass), false)
               and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'programa_ciudades' and cmd = 'ALL'),
         'RLS sigue activa en programa_ciudades con su política de escritura interna'
  union all
  select 'C10', not exists (select 1 from public.programa_ciudades pc where char_length(coalesce(to_jsonb(pc)->>'alojamiento_previsto', '')) > 200),
         'Ninguna fila excede 200 caracteres'
  union all
  select 'C11', true,
         'Filas con alojamiento_previsto: ' || (select count(*) from public.programa_ciudades pc where to_jsonb(pc)->>'alojamiento_previsto' is not null)
         || ' de ' || (select count(*) from public.programa_ciudades) || ' (los programas anteriores quedan en NULL)'
) c order by length(codigo), codigo;

rollback;
