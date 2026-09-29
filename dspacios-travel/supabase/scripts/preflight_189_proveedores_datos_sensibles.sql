-- Solo lectura. Ejecutar antes de la migracion 189 y compartir resultados.
select current_user as ejecutor,
       pg_get_userbyid(c.relowner) as propietario_proveedores,
       to_regclass('public.proveedores_datos_sensibles') as tabla_sensible_ya_existe
from pg_class c
where c.oid = 'public.proveedores'::regclass;

select count(*) as proveedores,
       count(*) filter (where nit is not null or razon_social is not null
         or datos_pago is not null or banco is not null or tipo_cuenta is not null
         or numero_cuenta is not null or politica_reservas is not null
         or voucher_contacto is not null) as con_datos_sensibles
from public.proveedores;

-- Una vista dependiente impediria retirar columnas en la fase final.
select distinct v.oid::regclass::text as vista,
       a.attname as columna
from pg_attribute a
join pg_depend d on d.refobjid = a.attrelid and d.refobjsubid = a.attnum
join pg_rewrite r on r.oid = d.objid
join pg_class v on v.oid = r.ev_class and v.relkind in ('v', 'm')
where a.attrelid = 'public.proveedores'::regclass
  and a.attname in (
    'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
    'numero_cuenta', 'politica_reservas', 'voucher_contacto'
  )
order by vista, columna;

-- Detectar triggers ajenos a esta migracion que lean columnas antiguas.
select tgname as trigger, pg_get_triggerdef(oid) as definicion
from pg_trigger
where tgrelid = 'public.proveedores'::regclass and not tgisinternal
order by tgname;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'proveedores'
order by policyname;

-- Solo cuenta eventos y nombres de claves; nunca devuelve valores sensibles.
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
         or coalesce(cambios, '{}'::jsonb) ?| array[
           'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
           'numero_cuenta', 'politica_reservas', 'voucher_contacto'
         ]
       ) as eventos_con_claves_sensibles
from public.auditoria
where tabla = 'proveedores';

select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'auditoria'
order by policyname;
