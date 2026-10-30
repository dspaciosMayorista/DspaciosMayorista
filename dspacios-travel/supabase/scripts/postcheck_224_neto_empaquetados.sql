-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 224 · vista `empaquetados_basica` (fase 1, aditiva). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 224. UNA fila consolidada: veredicto OK si todos los controles dan verdadero.
--   C1  la vista empaquetados_basica existe, es security_barrier y NO es security_invoker
--   C2  la vista no expone ninguna columna de costo (tarifa_proveedor, fee_infante, tarifa_para_empaquetar,
--       estado_pago, notas) y su definición no las menciona
--   C3  la vista expone lo que necesita la reserva (id, activo, compra_inicio, compra_fin, destino_id, record, ruta)
--   C4  ACL de la vista: anon sin ningún privilegio; authenticated solo SELECT
--   C5  la 224 NO quitó acceso: la policy "lectura operativa" de la 156 sigue presente y nombra a venta
--       (compatibilidad con el código anterior hasta la 225)
--   C6  la policy "escritura control" sigue presente (los 5 roles de escritura, sin venta)
--   C7  RLS sigue activa en empaquetados y todas sus policies pasan por mi_rol() (anon no lee)
--   C8  las policies de empaquetado_cambios y armado_empaquetados no cambiaron (se conservan presentes)
--   C9  ninguna función SECURITY DEFINER ni otra vista de public menciona tarifa_proveedor (sin otro camino al neto)
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
         exists (select 1 from pg_class cl
                  where cl.oid = to_regclass('public.empaquetados_basica') and cl.relkind = 'v'
                    and coalesce(cl.reloptions @> array['security_barrier=true'], false)
                    and not coalesce(cl.reloptions @> array['security_invoker=true'], false)) as ok,
         'Vista empaquetados_basica security_barrier, sin security_invoker' as detalle
  union all
  select 'C2',
         exists (select 1 from cols)
         and not exists (select 1 from cols where column_name in ('tarifa_proveedor', 'fee_infante', 'tarifa_para_empaquetar', 'estado_pago', 'notas'))
         and coalesce(pg_get_viewdef(to_regclass('public.empaquetados_basica'), true), '') !~* '(tarifa_proveedor|fee_infante|tarifa_para_empaquetar|estado_pago|notas)',
         'La vista no expone ni menciona columnas de costo'
  union all
  select 'C3',
         (select count(*) from cols where column_name in ('id', 'activo', 'compra_inicio', 'compra_fin', 'destino_id', 'record', 'ruta')) = 7,
         'La vista conserva lo que necesita computarReserva y la vitrina'
  union all
  select 'C4',
         to_regclass('public.empaquetados_basica') is not null
         and not has_table_privilege('anon', 'public.empaquetados_basica', 'SELECT')
         and not has_table_privilege('anon', 'public.empaquetados_basica', 'INSERT')
         and not has_table_privilege('anon', 'public.empaquetados_basica', 'UPDATE')
         and not has_table_privilege('anon', 'public.empaquetados_basica', 'DELETE')
         and has_table_privilege('authenticated', 'public.empaquetados_basica', 'SELECT')
         and not has_table_privilege('authenticated', 'public.empaquetados_basica', 'INSERT')
         and not has_table_privilege('authenticated', 'public.empaquetados_basica', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.empaquetados_basica', 'DELETE'),
         'anon sin privilegios; authenticated solo SELECT'
  union all
  select 'C5',
         exists (select 1 from pol where policyname = 'empaquetados: lectura operativa' and cmd = 'SELECT' and qual like '%''venta''%'),
         'La policy de lectura de 6 roles (156) sigue intacta: la 224 no quita acceso a venta'
  union all
  select 'C6',
         exists (select 1 from pol where policyname = 'empaquetados: escritura control' and cmd = 'ALL'
                                      and qual like '%''control_vuelo''%' and qual not like '%''venta''%'),
         'La policy de escritura de los 5 roles sigue presente y sin venta'
  union all
  select 'C7',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.empaquetados')), false)
         and not exists (select 1 from pol where qual not like '%mi_rol()%'),
         'RLS activa y todas las policies pasan por mi_rol() (anon, sin rol, no lee)'
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
