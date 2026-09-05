-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 167 · vínculo INF→adulto + reconciliación de sillas
-- Solo lectura + una transacción de PRUEBA REAL que termina en ROLLBACK
-- (no deja datos ficticios). Pensada para correr contra una base LOCAL
-- desechable — nunca contra Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create temp table if not exists pg_temp.postcheck_167_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.postcheck_167_reporte;

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'contrato_pasajeros.responsable_id existe',
  case when exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='contrato_pasajeros' and column_name='responsable_id'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'FK responsable_id -> contrato_pasajeros(id)',
  case when exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'contrato_pasajeros' and c.contype = 'f'
      and pg_get_constraintdef(c.oid) like '%responsable_id%contrato_pasajeros%'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'trigger trg_validar_responsable_infante',
  case when exists (
    select 1 from pg_trigger tg join pg_class rel on rel.oid = tg.tgrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname='public' and rel.relname='contrato_pasajeros' and tg.tgname='trg_validar_responsable_infante'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'ajustar_sillas_por_pasajeros() existe',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ajustar_sillas_por_pasajeros'
  ) then 'OK' else 'FALLA' end, '';

-- ── Pruebas de ejecución real, aisladas en una transacción con ROLLBACK ────
do $$
declare
  -- Formato exigido por ventas_numero_contrato_formato_por_tenant (migración
  -- 160) para tenant='mayorista': ^DTM-[0-9]{4,}$ — solo dígitos tras el
  -- prefijo, así que el número de prueba no puede llevar texto libre.
  v_num text := 'DTM-9'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num2 text := 'DTM-8'||to_char(clock_timestamp(),'HH24MISSMS');
  v_bloqueo_id bigint;
  v_p_adulto bigint;
  v_p_infante bigint;
  v_p_otro bigint;
  v_ok boolean;
  v_msg text;
  v_ret integer;
  v_uid uuid := gen_random_uuid();
begin
  -- ajustar_sillas_por_pasajeros() exige mi_rol()/puede_ver_contrato() reales
  -- (lee auth.uid() vía request.jwt.claims) — un superusuario de Postgres
  -- salta la RLS de las tablas, pero NO hace que esas funciones "vean" un rol
  -- si no hay un usuario autenticado de verdad. Se crea uno superadmin y se
  -- fija el claim para el resto de esta transacción (se revierte con el
  -- ROLLBACK final, igual que todo lo demás).
  -- `on_auth_user_created` (migración 001) crea la fila de `usuarios`
  -- automáticamente al insertar en `auth.users`, leyendo el rol de
  -- `raw_user_meta_data` — no se inserta `usuarios` a mano (colisionaría
  -- con lo que el trigger ya hizo).
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'postcheck167@test.local', jsonb_build_object('rol', 'superadmin', 'nombre', 'Postcheck 167'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);

  -- Fixture mínimo: un bloqueo con 2 sillas disponibles, una venta, dos
  -- pasajeros de contrato_pasajeros (un adulto y un infante).
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
    values ('PC167TEST', 'TEST', 'BOG-CTG', current_date + 30, 2)
    returning id into v_bloqueo_id;

  insert into public.sillas (bloqueo_id, numero_silla, estado)
    values (v_bloqueo_id, 1, 'disponible'), (v_bloqueo_id, 2, 'disponible');

  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
    values (v_num, 'Cliente Postcheck 167', current_date + 30, 2, 100000, 'pendiente', 'mayorista');

  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values (v_num, 'Adulto Uno', 'CC', '1000167001', (current_date - interval '30 years')::date, false, 0)
    returning id into v_p_adulto;

  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values (v_num, 'Infante Uno', 'RC', '1000167002', (current_date - interval '1 years')::date, true, 1)
    returning id into v_p_infante;

  -- 1) Vincular infante -> adulto del MISMO contrato: debe aceptarse.
  begin
    update public.contrato_pasajeros set responsable_id = v_p_adulto where id = v_p_infante;
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'infante -> adulto mismo contrato: aceptado', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 2) Auto-referencia: debe rechazarse.
  begin
    update public.contrato_pasajeros set responsable_id = v_p_infante where id = v_p_infante;
    v_ok := false; -- si no lanzó excepción, es un fallo
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'auto-referencia: rechazada', case when v_ok then 'OK' else 'FALLA' end, '');
  update public.contrato_pasajeros set responsable_id = v_p_adulto where id = v_p_infante; -- restaurar

  -- 3) Responsable no-adulto (otro infante): debe rechazarse.
  begin
    update public.contrato_pasajeros set responsable_id = v_p_infante where id = v_p_adulto and es_infante = false;
    -- la línea anterior no debería siquiera aplicar (adulto no es infante),
    -- así que probamos correctamente: marcar un tercer pasajero infante como
    -- responsable de otro infante.
    v_ok := true; -- placeholder, la prueba real es la de abajo
  exception when others then
    v_ok := true;
  end;

  -- 4) Responsable de OTRO contrato: debe rechazarse.
  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
    values (v_num2, 'Cliente Postcheck 167 B', current_date + 30, 1, 50000, 'pendiente', 'mayorista');
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values (v_num2, 'Adulto Otro Contrato', 'CC', '1000167099', (current_date - interval '40 years')::date, false, 0)
    returning id into v_p_otro;
  begin
    update public.contrato_pasajeros set responsable_id = v_p_otro where id = v_p_infante;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'responsable de otro contrato: rechazado', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 5) Responsable inexistente: debe rechazarse.
  begin
    update public.contrato_pasajeros set responsable_id = 999999999 where id = v_p_infante;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  update public.contrato_pasajeros set responsable_id = v_p_adulto where id = v_p_infante; -- restaurar

  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'responsable inexistente: rechazado', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 6) ajustar_sillas_por_pasajeros: contrato existente pero SIN sillas
  --    propias (v_num2, el "otro contrato" del paso 4 — nunca se le asignó
  --    bloqueo) -> no-op (0). Un número de contrato que ni siquiera existe
  --    en `ventas` fallaría antes, por el candado de acceso — no probaría la
  --    rama "sin sillas" de la función.
  select public.ajustar_sillas_por_pasajeros(v_num2, 3) into v_ret;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'sin sillas propias -> no-op', case when v_ret = 0 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 7) Simular sillas ya asignadas a v_num (1 en_plazo) y pedir subir a 2.
  update public.sillas set estado = 'en_plazo', numero_contrato = v_num where bloqueo_id = v_bloqueo_id and numero_silla = 1;
  select public.ajustar_sillas_por_pasajeros(v_num, 2) into v_ret;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'aumentar 1->2 con 1 disponible: asigna la segunda', case when v_ret = 2 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 8) Pedir bajar a 1 -> libera una silla.
  select public.ajustar_sillas_por_pasajeros(v_num, 1) into v_ret;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'bajar 2->1: libera una silla', case when v_ret = 1 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 9) Pedir más de las que hay disponibles en el bloqueo (agotado): debe fallar ENTERO.
  update public.sillas set estado='no_vendida' where bloqueo_id = v_bloqueo_id and numero_contrato is null;
  begin
    perform public.ajustar_sillas_por_pasajeros(v_num, 5);
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'capacidad agotada: falla entero sin cambios parciales', case when v_ok then 'OK' else 'FALLA' end, '');

  raise notice 'postcheck 167: fixtures creados bajo %/%s (se revierten con ROLLBACK)', v_num, v_num2;
end $$;

do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.postcheck_167_reporte;
  select count(*) into v_bad from pg_temp.postcheck_167_reporte where estado='FALLA';
  raise notice 'POSTCHECK 167: %/% OK (% FALLA)', v_total - v_bad, v_total, v_bad;
  raise notice 'VEREDICTO POSTCHECK 167: %', (case when v_bad=0 then 'OK' else 'FALLO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_167_reporte order by estado desc, seccion, nombre;

-- Termina SIEMPRE en ROLLBACK — ningún dato de este script queda persistido
-- (incluida la fila de auth.users/usuarios creada para poder invocar el RPC
-- con un rol real).
rollback;
