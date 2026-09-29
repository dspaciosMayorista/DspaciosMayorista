-- Solo lectura. Ejecutar cada SELECT por separado despues de 190.
select p.proname as funcion,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_ejecuta
from pg_proc p
where p.oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure;

select tgname as trigger, tgenabled as habilitado
from pg_trigger
where tgrelid = 'public.proveedores'::regclass
  and tgname in ('proveedores_sensibles_legacy_insert',
                 'proveedores_sensibles_legacy_update')
order by tgname;

select count(*) as faltantes_o_diferentes
from public.proveedores p
left join public.proveedores_datos_sensibles s
  on s.proveedor_id = p.id and s.tenant = 'mayorista'
where s.proveedor_id is null
   or row(p.nit, p.razon_social, p.datos_pago, p.banco,
          p.tipo_cuenta, p.numero_cuenta, p.politica_reservas,
          p.voucher_contacto)
      is distinct from
      row(s.nit, s.razon_social, s.datos_pago, s.banco,
          s.tipo_cuenta, s.numero_cuenta, s.politica_reservas,
          s.voucher_contacto);
