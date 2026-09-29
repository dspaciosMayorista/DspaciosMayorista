-- Solo lectura. Ejecutar despues de la migracion 189, antes de adaptar la app.
select count(*) as proveedores,
       count(s.proveedor_id) as filas_sensibles_mayorista,
       count(*) filter (
         where s.proveedor_id is null
            or row(p.nit, p.razon_social, p.datos_pago, p.banco,
                   p.tipo_cuenta, p.numero_cuenta, p.politica_reservas,
                   p.voucher_contacto)
               is distinct from
               row(s.nit, s.razon_social, s.datos_pago, s.banco,
                   s.tipo_cuenta, s.numero_cuenta, s.politica_reservas,
                   s.voucher_contacto)
       ) as faltantes_o_diferentes
from public.proveedores p
left join public.proveedores_datos_sensibles s
  on s.proveedor_id = p.id and s.tenant = 'mayorista';

select c.relrowsecurity as rls_activo,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('anon', c.oid, 'TRUNCATE') as anon_truncate,
       has_table_privilege('authenticated', c.oid, 'TRUNCATE') as authenticated_truncate,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c
where c.oid = 'public.proveedores_datos_sensibles'::regclass;

select has_function_privilege('anon', 'public.mi_tenant_real()', 'EXECUTE') as anon_ejecuta_tenant_real,
       has_function_privilege('authenticated', 'public.mi_tenant_real()', 'EXECUTE') as authenticated_ejecuta_tenant_real,
       has_function_privilege('anon', 'public.sincronizar_proveedor_sensible_legacy()', 'EXECUTE') as anon_ejecuta_trigger;

select tgname as trigger, tgenabled as habilitado
from pg_trigger
where (tgrelid = 'public.proveedores'::regclass
       and tgname in ('proveedores_sensibles_legacy_insert',
                      'proveedores_sensibles_legacy_update'))
   or (tgrelid = 'public.proveedores_datos_sensibles'::regclass
       and tgname = 'trg_auditoria')
   or (tgrelid = 'public.auditoria'::regclass
       and tgname = 'auditoria_proveedores_redactar')
order by tgname;

select count(*) as eventos_proveedores,
       count(*) filter (
         where coalesce(antes, '{}'::jsonb) ?| array[
           'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
           'numero_cuenta', 'politica_reservas', 'voucher_contacto'
         ]
         or coalesce(despues, '{}'::jsonb) ?| array[
           'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
           'numero_cuenta', 'politica_reservas', 'voucher_contacto'
         ]
       ) as eventos_con_valores_en_snapshots,
       count(*) filter (
         where exists (
           select 1 from jsonb_each(coalesce(cambios, '{}'::jsonb)) as c(k, v)
           where c.k = any(array[
             'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
             'numero_cuenta', 'politica_reservas', 'voucher_contacto'
           ])
             and c.v <> '{"antes":"[REDACTADO]","despues":"[REDACTADO]"}'::jsonb
         )
       ) as eventos_con_cambios_sensibles_sin_redactar
from public.auditoria
where tabla in ('proveedores', 'proveedores_datos_sensibles');

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('proveedores', 'proveedores_datos_sensibles', 'auditoria')
order by tablename, policyname;
