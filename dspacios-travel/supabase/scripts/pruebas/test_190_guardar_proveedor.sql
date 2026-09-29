-- Prueba real con un usuario activo de Mayorista; todo se revierte.
-- Ejecutar completa (BEGIN a ROLLBACK) solo despues de aplicar 190.
begin;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.usuarios
   where activo and tenant = 'mayorista' and rol = 'superadmin'
   order by id limit 1),
  true
);
set local role authenticated;

do $$
declare
  v_id bigint;
begin
  v_id := public.guardar_proveedor(
    '{"tipo":"hotelero","nombre":"TEST 190 PROVEEDOR FICTICIO","nit":"NIT_FICTICIO","banco":"BANCO_FICTICIO","clasificacion":"costo"}'::jsonb
  );

  if not exists (
    select 1 from public.proveedores p
    join public.proveedores_datos_sensibles s
      on s.proveedor_id = p.id and s.tenant = 'mayorista'
    where p.id = v_id and p.nit = 'NIT_FICTICIO'
      and s.nit = 'NIT_FICTICIO' and s.banco = 'BANCO_FICTICIO'
  ) then
    raise exception '190: creacion sin sincronizacion';
  end if;

  perform public.guardar_proveedor(
    '{"tipo":"hotelero","nombre":"TEST 190 PROVEEDOR FICTICIO","nit":"NIT_EDITADO","banco":"BANCO_EDITADO","clasificacion":"costo"}'::jsonb,
    v_id
  );

  if not exists (
    select 1 from public.proveedores p
    join public.proveedores_datos_sensibles s
      on s.proveedor_id = p.id and s.tenant = 'mayorista'
    where p.id = v_id and p.nit = 'NIT_EDITADO'
      and s.nit = 'NIT_EDITADO' and s.banco = 'BANCO_EDITADO'
  ) then
    raise exception '190: actualizacion sin sincronizacion';
  end if;

  if exists (
    select 1 from public.auditoria a
    where a.tabla in ('proveedores', 'proveedores_datos_sensibles')
      and a.registro_id = v_id::text
      and (
        coalesce(a.antes, '{}'::jsonb) ?| array['nit', 'banco']
        or coalesce(a.despues, '{}'::jsonb) ?| array['nit', 'banco']
      )
  ) then
    raise exception '190: auditoria expuso datos sensibles';
  end if;
end;
$$;

rollback;
