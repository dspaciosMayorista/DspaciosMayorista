-- Ejecutar solo despues de la migracion 189. La transaccion revierte la
-- fixture; usa valores ficticios y nunca consulta cuentas reales.
begin;

do $$
declare
  v_fila public.auditoria%rowtype;
begin
  insert into public.auditoria (
    accion, tabla, registro_id, antes, despues, cambios, tenant
  ) values (
    'UPDATE', 'proveedores', 'test-189-redaccion',
    '{"nombre":"Hotel prueba","numero_cuenta":"CUENTA_ANTERIOR_FICTICIA"}'::jsonb,
    '{"nombre":"Hotel prueba","numero_cuenta":"CUENTA_NUEVA_FICTICIA"}'::jsonb,
    '{"numero_cuenta":{"antes":"CUENTA_ANTERIOR_FICTICIA","despues":"CUENTA_NUEVA_FICTICIA"}}'::jsonb,
    'mayorista'
  ) returning * into v_fila;

  if v_fila.antes ? 'numero_cuenta'
     or v_fila.despues ? 'numero_cuenta'
     or v_fila.cambios->'numero_cuenta'
          is distinct from '{"antes":"[REDACTADO]","despues":"[REDACTADO]"}'::jsonb
     or v_fila.antes->>'nombre' is distinct from 'Hotel prueba'
     or v_fila.registro_id is distinct from 'test-189-redaccion' then
    raise exception 'Fallo la redaccion de auditoria de proveedores';
  end if;
end;
$$;

rollback;
