-- TEST 322 (#76/#77) — comportamiento real de public.aliado_clientes sobre una COPIA del esquema completo (con la 322 aplicada). Todo dentro de una transacción
-- que termina en ROLLBACK. No tocar producción ni la base de revisión del dueño. NO EJECUTADO al escribirlo (Docker local caído): correrlo en la base desechable
-- (p. ej. `docker exec -i <pg> psql -U supabase_admin -d <copia> -v ON_ERROR_STOP=1 -f test_322_clientes_aliado.sql`) y exigir 0 filas FALLO.
begin;
create temp table r (n int, control text, estado text) on commit drop;
grant all on table r to public;

insert into public.aliados (id, nombre, tipo) values (990001, 'Aliado A test 322', 'freelance'), (990002, 'Aliado B test 322', 'agencia') on conflict (id) do nothing;

do $$
declare
  v_id1 bigint;
  v_fallo boolean;
  v_n int;
begin
  -- 1. service_role inserta, y la secuencia le funciona.
  set local role service_role;
  insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos) values (990001, 'María Pérez', 'maria perez', true) returning id into v_id1;
  insert into r values (1, 'service_role inserta una fila (y usa la secuencia)', case when v_id1 is not null then 'OK' else 'FALLO' end);

  -- 2. Un nombre por aliado: el mismo en el mismo aliado choca (23505); en OTRO aliado es otro cliente.
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos) values (990001, 'MARIA  PEREZ', 'maria perez', true); v_fallo := false;
  exception when unique_violation then v_fallo := true; end;
  insert into r values (2, 'mismo nombre en el mismo aliado: rechazado (23505)', case when v_fallo then 'OK' else 'FALLO' end);
  insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos) values (990002, 'María Pérez', 'maria perez', true);
  select count(*) into v_n from public.aliado_clientes where clave = 'maria perez' and aliado_id in (990001, 990002);
  insert into r values (3, 'mismo nombre en OTRO aliado: permitido (dos filas independientes)', case when v_n = 2 then 'OK' else 'FALLO' end);

  -- 4. Restricciones: autorización obligatoria y solo true; documento y tipo van juntos; tipo del catálogo; FK al aliado.
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos) values (990001, 'Sin autorizar', 'sin autorizar', false); v_fallo := false;
  exception when check_violation then v_fallo := true; end;
  insert into r values (4, 'autorizacion_datos=false: rechazado', case when v_fallo then 'OK' else 'FALLO' end);
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos, documento) values (990001, 'Doc suelto', 'doc suelto', true, '1234567'); v_fallo := false;
  exception when check_violation then v_fallo := true; end;
  insert into r values (5, 'documento sin tipo: rechazado', case when v_fallo then 'OK' else 'FALLO' end);
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos, tipo_documento, documento) values (990001, 'Tipo raro', 'tipo raro', true, 'XX', '1234567'); v_fallo := false;
  exception when check_violation then v_fallo := true; end;
  insert into r values (6, 'tipo de documento fuera del catálogo: rechazado', case when v_fallo then 'OK' else 'FALLO' end);
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos) values (999999999, 'Huérfano', 'huerfano', true); v_fallo := false;
  exception when foreign_key_violation then v_fallo := true; end;
  insert into r values (7, 'aliado inexistente: rechazado (FK)', case when v_fallo then 'OK' else 'FALLO' end);
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos, tenant) values (990001, 'Otra agencia', 'otra agencia', true, 'otra'); v_fallo := false;
  exception when check_violation then v_fallo := true; end;
  insert into r values (8, 'tenant fuera de mayorista/minorista: rechazado', case when v_fallo then 'OK' else 'FALLO' end);
  reset role;

  -- 9-11. anon y authenticated NO leen ni escriben (ni con una sesión de aliado): permiso denegado, no filas vacías por RLS.
  set local role authenticated;
  begin perform 1 from public.aliado_clientes limit 1; v_fallo := false; exception when insufficient_privilege then v_fallo := true; end;
  insert into r values (9, 'authenticated NO puede leer la libreta (permission denied)', case when v_fallo then 'OK' else 'FALLO' end);
  begin insert into public.aliado_clientes (aliado_id, nombre, clave, autorizacion_datos) values (990001, 'Intruso', 'intruso', true); v_fallo := false; exception when insufficient_privilege then v_fallo := true; end;
  insert into r values (10, 'authenticated NO puede escribir', case when v_fallo then 'OK' else 'FALLO' end);
  begin update public.aliado_clientes set telefono = '3000000000'; v_fallo := false; exception when insufficient_privilege then v_fallo := true; end;
  insert into r values (11, 'authenticated NO puede actualizar', case when v_fallo then 'OK' else 'FALLO' end);
  reset role;
  set local role anon;
  begin perform 1 from public.aliado_clientes limit 1; v_fallo := false; exception when insufficient_privilege then v_fallo := true; end;
  insert into r values (12, 'anon NO puede leer', case when v_fallo then 'OK' else 'FALLO' end);
  reset role;

  -- 13. La libreta NO está en crm_contactos (las campañas no la ven): la tabla de campañas no cambió.
  insert into r values (13, 'crm_contactos no tiene columna de aliado ni filas de esta prueba',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_contactos' and column_name like '%aliado%')
          and not exists (select 1 from public.crm_contactos where nombre like '%test 322%') then 'OK' else 'FALLO' end);

  -- 14. Auditoría: la inserción dejó rastro (si el esquema trae fn_auditoria).
  if to_regprocedure('public.fn_auditoria()') is not null and to_regclass('public.auditoria') is not null then
    select count(*) into v_n from public.auditoria where tabla = 'aliado_clientes';
    insert into r values (14, 'la escritura queda en auditoría (trg_auditoria)', case when v_n >= 1 then 'OK' else 'FALLO' end);
  else
    insert into r values (14, 'auditoría no disponible en este esquema (INFO)', 'OK');
  end if;
end $$;

select n, control, estado from r order by n;
rollback;
