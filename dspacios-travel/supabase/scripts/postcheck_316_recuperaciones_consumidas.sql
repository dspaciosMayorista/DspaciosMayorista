-- POSTCHECK 316 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 316.
with t as (
  select to_regclass('public.recuperaciones_consumidas') as tabla
), c as (
  select
    (select relrowsecurity from pg_class where oid = to_regclass('public.recuperaciones_consumidas')) as rls,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'recuperaciones_consumidas')::int as politicas,
    (select count(*) from pg_constraint where conrelid = to_regclass('public.recuperaciones_consumidas') and contype = 'p')::int as pk,
    has_table_privilege('service_role', 'public.recuperaciones_consumidas', 'select, insert, update, delete') as service_role_ok,
    (has_table_privilege('anon', 'public.recuperaciones_consumidas', 'select, insert, update, delete')
      or has_table_privilege('authenticated', 'public.recuperaciones_consumidas', 'select, insert, update, delete')) as clientes_tocan,
    (select count(*) from public.recuperaciones_consumidas)::bigint as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla existe' as control, coalesce(t.tabla::text, 'no existe') as observado, 'public.recuperaciones_consumidas' as esperado, case when t.tabla is not null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'RLS activa y sin políticas (solo service_role entra)', c.rls::text || ' / ' || c.politicas::text, 'true / 0', case when c.rls is true and c.politicas = 0 then 'OK' else 'REVISAR' end from c
  union all select 3, 'Clave primaria (usuario, evento): el reclamo es atómico', c.pk::text, '1', case when c.pk = 1 then 'OK' else 'REVISAR' end from c
  union all select 4, 'service_role tiene select/insert/update/delete', c.service_role_ok::text, 'true', case when c.service_role_ok then 'OK' else 'REVISAR' end from c
  union all select 5, 'anon y authenticated NO tienen ningún permiso', c.clientes_tocan::text, 'false', case when c.clientes_tocan is false then 'OK' else 'REVISAR' end from c
  union all select 6, 'Filas (esperado 0 recién creada)', c.filas::text, 'anotar', 'INFO' from c
) r order by orden;
