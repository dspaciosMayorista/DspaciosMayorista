-- POSTCHECK 322 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 322.
with t as (
  select to_regclass('public.aliado_clientes') as tabla
), c as (
  select
    (select relrowsecurity from pg_class where oid = to_regclass('public.aliado_clientes')) as rls,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'aliado_clientes')::int as politicas,
    (select count(*) from pg_constraint where conrelid = to_regclass('public.aliado_clientes') and contype = 'u' and conname = 'aliado_clientes_nombre_unico')::int as unico,
    (select count(*) from pg_constraint where conrelid = to_regclass('public.aliado_clientes') and contype = 'f')::int as fks,
    has_table_privilege('service_role', 'public.aliado_clientes', 'select, insert, update, delete') as service_role_ok,
    has_sequence_privilege('service_role', 'public.aliado_clientes_id_seq', 'usage') as secuencia_ok,
    (has_table_privilege('anon', 'public.aliado_clientes', 'select, insert, update, delete')
      or has_table_privilege('authenticated', 'public.aliado_clientes', 'select, insert, update, delete')) as clientes_tocan,
    (select count(*) from pg_trigger where tgrelid = to_regclass('public.aliado_clientes') and tgname = 'trg_auditoria' and not tgisinternal)::int as auditoria,
    (select count(*) from public.aliado_clientes)::bigint as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla existe' as control, coalesce(t.tabla::text, 'no existe') as observado, 'public.aliado_clientes' as esperado, case when t.tabla is not null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'RLS activa y sin políticas (solo service_role entra)', c.rls::text || ' / ' || c.politicas::text, 'true / 0', case when c.rls is true and c.politicas = 0 then 'OK' else 'REVISAR' end from c
  union all select 3, 'Un nombre por aliado (única aliado_id + clave) y FK al aliado', c.unico::text || ' / ' || c.fks::text, '1 / 1', case when c.unico = 1 and c.fks = 1 then 'OK' else 'REVISAR' end from c
  union all select 4, 'service_role: select/insert/update/delete y la secuencia', c.service_role_ok::text || ' / ' || c.secuencia_ok::text, 'true / true', case when c.service_role_ok and c.secuencia_ok then 'OK' else 'REVISAR' end from c
  union all select 5, 'anon y authenticated NO tienen ningún permiso', c.clientes_tocan::text, 'false', case when c.clientes_tocan is false then 'OK' else 'REVISAR' end from c
  union all select 6, 'Auditoría (trg_auditoria) adjunta', c.auditoria::text, '1', case when c.auditoria = 1 then 'OK' else 'REVISAR' end from c
  union all select 7, 'Filas (esperado 0 recién creada)', c.filas::text, 'anotar', 'INFO' from c
) r order by orden;
