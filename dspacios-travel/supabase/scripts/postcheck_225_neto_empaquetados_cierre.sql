-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 225 · cierre de la lectura de netos de `empaquetados` para venta. SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 225. UNA fila consolidada: veredicto OK si todos los controles dan verdadero.
--   C1  la policy "lectura operativa" (6 roles, con venta) ya no existe
--   C2  ninguna policy de SELECT/ALL sobre empaquetados nombra a venta
--   C3  la policy "lectura con costos" existe, es SELECT y nombra EXACTAMENTE a los 5 roles con tabla base
--   C4  la policy "escritura control" sigue presente (los mismos 5 roles, sin venta)
--   C5  RLS activa en empaquetados y todas sus policies pasan por mi_rol() (anon no lee)
--   C6  la vista de la 224 sigue intacta: existe, security_barrier, sin columnas de costo y con los 6 roles
--       en su where (venta SIGUE alcanzando sus filas por la vista)
--   C7  ACL de la vista: anon sin privilegios; authenticated solo SELECT
--   C8  las policies de empaquetado_cambios y armado_empaquetados no cambiaron
--   C9  ninguna función SECURITY DEFINER ni otra vista de public menciona tarifa_proveedor
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
cols as (
  select column_name from information_schema.columns where table_schema = 'public' and table_name = 'empaquetados_basica'
),
pol as (
  select policyname, cmd, coalesce(qual, '') as qual from pg_policies where schemaname = 'public' and tablename = 'empaquetados'
),
c as (
  select 'C1' as codigo,
         not exists (select 1 from pol where policyname = 'empaquetados: lectura operativa') as ok,
         'La policy de lectura de 6 roles (156) ya no existe' as detalle
  union all
  select 'C2', not exists (select 1 from pol where cmd in ('SELECT', 'ALL') and qual like '%''venta''%'),
         'Ninguna policy de lectura de empaquetados nombra a venta'
  union all
  select 'C3',
         exists (select 1 from pol
                  where policyname = 'empaquetados: lectura con costos' and cmd = 'SELECT'
                    and qual like '%''superadmin''%' and qual like '%''gerencia''%' and qual like '%''administracion''%'
                    and qual like '%''operaciones''%' and qual like '%''control_vuelo''%' and qual not like '%''venta''%'),
         'La policy de lectura con costos nombra a superadmin, gerencia, administracion, operaciones y control_vuelo'
  union all
  select 'C4',
         exists (select 1 from pol where policyname = 'empaquetados: escritura control' and cmd = 'ALL'
                                      and qual like '%''control_vuelo''%' and qual not like '%''venta''%'),
         'La policy de escritura de los 5 roles sigue presente y sin venta'
  union all
  select 'C5',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.empaquetados')), false)
         and not exists (select 1 from pol where qual not like '%mi_rol()%'),
         'RLS activa y todas las policies pasan por mi_rol()'
  union all
  select 'C6',
         exists (select 1 from pg_class cl
                  where cl.oid = to_regclass('public.empaquetados_basica') and cl.relkind = 'v'
                    and coalesce(cl.reloptions @> array['security_barrier=true'], false)
                    and not coalesce(cl.reloptions @> array['security_invoker=true'], false))
         and exists (select 1 from cols)
         and not exists (select 1 from cols where column_name in ('tarifa_proveedor', 'fee_infante', 'tarifa_para_empaquetar', 'estado_pago', 'notas'))
         and coalesce(pg_get_viewdef(to_regclass('public.empaquetados_basica'), true), '') ~ '''venta''',
         'La vista de la 224 intacta: security_barrier, sin costos, y venta en su where'
  union all
  select 'C7',
         to_regclass('public.empaquetados_basica') is not null
         and not has_table_privilege('anon', 'public.empaquetados_basica', 'SELECT')
         and has_table_privilege('authenticated', 'public.empaquetados_basica', 'SELECT')
         and not has_table_privilege('authenticated', 'public.empaquetados_basica', 'INSERT')
         and not has_table_privilege('authenticated', 'public.empaquetados_basica', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.empaquetados_basica', 'DELETE'),
         'anon sin privilegios sobre la vista; authenticated solo SELECT'
  union all
  select 'C8',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'empaquetado_cambios' and policyname = 'empaquetado_cambios: lectura control')
         and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'empaquetado_cambios' and policyname = 'empaquetado_cambios: escritura control')
         and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'armado_empaquetados' and policyname = 'armado_empaquetados: interno'),
         'Policies de empaquetado_cambios y armado_empaquetados conservadas'
  union all
  select 'C9',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%tarifa_proveedor%')
         and not exists (select 1 from pg_views where schemaname = 'public' and viewname <> 'empaquetados_basica' and definition ilike '%tarifa_proveedor%'),
         'Sin funciones SECURITY DEFINER ni otras vistas que mencionen tarifa_proveedor'
)
select case when bool_and(ok) then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where ok) as ok,
       count(*) filter (where not ok) as fallos,
       count(*) as chequeos,
       coalesce(string_agg(codigo, ',' order by codigo) filter (where not ok), 'ninguno') as fallidos,
       string_agg(codigo || '=' || case when ok then 't' else 'f' end, ';' order by codigo) as resumen,
       jsonb_agg(jsonb_build_object('codigo', codigo, 'ok', ok, 'detalle', detalle) order by codigo) as detalle
  from c;

rollback;
