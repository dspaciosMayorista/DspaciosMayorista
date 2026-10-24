-- 232 · POSTCHECK (#109). SOLO LECTURA. UNA sola consulta integral: control | observado | esperado | estado.
-- Después de la 232 TODO debe dar OK (INFO solo en conteos de filas, que se comparan con el preflight).
-- Cualquier FALLA = DETENERSE y diagnosticar (compartir la salida completa); no declarar cerrado #109 y NO ejecutar el
-- rollback por reflejo: devolver TRUNCATE a anon es una decisión excepcional y explícita (ver rollback_232).
with t(tabla) as (values ('public.cxp_pagos'), ('public.retenciones_cxp')),
priv(p) as (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')),
anon_w as (
  select 'anon puede ' || lower(p) || ' en ' || tabla as control,
         case when (p in ('INSERT', 'UPDATE') and has_any_column_privilege('anon', tabla, p))
                or (p in ('DELETE', 'TRUNCATE') and has_table_privilege('anon', tabla, p)) then 'si' else 'no' end as observado
    from t, priv
),
roles_ok as (
  select r || ' puede ' || lower(p) || ' en ' || tabla as control,
         case when has_table_privilege(r, tabla, p) then 'si' else 'no' end as observado
    from t, (values ('authenticated'), ('service_role')) x(r), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) q(p)
),
rls as (
  select 'RLS activa en ' || c.relname as control, c.relrowsecurity::text as observado
    from pg_class c where c.oid in ('public.cxp_pagos'::regclass, 'public.retenciones_cxp'::regclass)
),
pol as (
  select 'policies en ' || t2.tabla as control, count(p2.policyname)::text as observado
    from (values ('cxp_pagos'), ('retenciones_cxp')) t2(tabla)
    left join pg_policies p2 on p2.schemaname = 'public' and p2.tablename = t2.tabla
   group by t2.tabla
),
trg as (
  select 'triggers de guarda 228 en ' || t3.tabla as control, count(g.tgname)::text as observado
    from (values ('cxp_pagos'), ('retenciones_cxp')) t3(tabla)
    left join pg_class c on c.relname = t3.tabla and c.relnamespace = 'public'::regnamespace
    left join pg_trigger g on g.tgrelid = c.oid and not g.tgisinternal and g.tgname like '%guarda%'
   group by t3.tabla
),
filas as (
  select 'filas cxp_pagos' as control, count(*)::text as observado from public.cxp_pagos
  union all
  select 'filas retenciones_cxp', count(*)::text from public.retenciones_cxp
)
select control, observado, 'no' as esperado,
       case observado when 'no' then 'OK' else 'FALLA' end as estado
  from anon_w
union all
select control, observado, 'si', case observado when 'si' then 'OK' else 'FALLA' end from roles_ok
union all
select control, observado, 'true', case observado when 'true' then 'OK' else 'FALLA' end from rls
union all
select control, observado, '>= 1', case when observado::int >= 1 then 'OK' else 'FALLA' end from pol
union all
select control, observado, '>= 1', case when observado::int >= 1 then 'OK' else 'FALLA' end from trg
union all
select control, observado, 'igual al preflight', 'INFO' from filas
order by 1;
