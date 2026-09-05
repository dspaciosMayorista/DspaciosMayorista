-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 167 · vínculo INF→adulto + guardar_pasajeros_contrato + sillas
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
select 'esquema', 'FK responsable_id -> contrato_pasajeros(id) ON DELETE RESTRICT',
  case when exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'contrato_pasajeros' and c.contype = 'f'
      and pg_get_constraintdef(c.oid) like '%responsable_id%contrato_pasajeros%'
      and c.confdeltype = 'r'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'trigger trg_validar_responsable_infante',
  case when exists (
    select 1 from pg_trigger tg join pg_class rel on rel.oid = tg.tgrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname='public' and rel.relname='contrato_pasajeros' and tg.tgname='trg_validar_responsable_infante'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'ajustar_sillas_por_pasajeros() existe (returns table)',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ajustar_sillas_por_pasajeros'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', 'guardar_pasajeros_contrato() existe',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='guardar_pasajeros_contrato'
  ) then 'OK' else 'FALLA' end, '';

-- ── Pruebas de ejecución real, aisladas en una transacción con ROLLBACK ────
do $$
declare
  -- Formato exigido por ventas_numero_contrato_formato_por_tenant (migración
  -- 160) para tenant='mayorista': ^DTM-[0-9]{4,}$ — solo dígitos tras el
  -- prefijo, así que el número de prueba no puede llevar texto libre.
  v_num          text := 'DTM-9'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num2         text := 'DTM-8'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num3         text := 'DTM-7'||to_char(clock_timestamp(),'HH24MISSMS');
  v_bloqueo_id   bigint;
  v_bloqueo2_id  bigint;
  v_p_adulto     bigint;
  v_p_infante    bigint;
  v_p_otro       bigint;
  v_ok           boolean;
  v_ret          integer;
  v_ids          bigint[];
  v_uid          uuid := gen_random_uuid();
  v_id_adulto    bigint;
  v_id_infante   bigint;
begin
  -- ajustar_sillas_por_pasajeros()/guardar_pasajeros_contrato() exigen
  -- mi_rol()/puede_ver_contrato() reales (leen auth.uid() vía
  -- request.jwt.claims) — un superusuario de Postgres salta la RLS de las
  -- tablas, pero NO hace que esas funciones "vean" un rol si no hay un
  -- usuario autenticado de verdad. Se crea uno superadmin y se fija el claim
  -- para el resto de esta transacción (se revierte con el ROLLBACK final).
  -- `on_auth_user_created` (migración 001) crea la fila de `usuarios`
  -- automáticamente al insertar en `auth.users` — no se inserta `usuarios` a
  -- mano (colisionaría con lo que el trigger ya hizo).
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'postcheck167@test.local', jsonb_build_object('rol', 'superadmin', 'nombre', 'Postcheck 167'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);

  -- Fixture 1: bloqueo con 2 sillas, una venta con bloqueo_ref_id estampado.
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
    values ('PC167TEST', 'TEST', 'BOG-CTG', current_date + 30, 2)
    returning id into v_bloqueo_id;
  insert into public.sillas (bloqueo_id, numero_silla, estado)
    values (v_bloqueo_id, 1, 'disponible'), (v_bloqueo_id, 2, 'disponible');
  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant, bloqueo_ref_id)
    values (v_num, 'Cliente Postcheck 167', current_date + 30, 2, 100000, 'pendiente', 'mayorista', v_bloqueo_id);

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
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'auto-referencia: rechazada', case when v_ok then 'OK' else 'FALLA' end, '');
  update public.contrato_pasajeros set responsable_id = v_p_adulto where id = v_p_infante; -- restaurar

  -- 3) CHD (niño, es_infante=false pero menor de edad) como responsable: debe rechazarse.
  declare
    v_p_chd bigint;
  begin
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values (v_num, 'Nino Ocho Anios', 'TI', '1000167010', (current_date - interval '8 years')::date, false, 2)
      returning id into v_p_chd;
    begin
      update public.contrato_pasajeros set responsable_id = v_p_chd where id = v_p_infante;
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    delete from public.contrato_pasajeros where id = v_p_chd;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'CHD (menor de edad, no infante) como responsable: rechazado', case when v_ok then 'OK' else 'FALLA' end, '');
  update public.contrato_pasajeros set responsable_id = v_p_adulto where id = v_p_infante; -- restaurar (por si el rollback interno del begin/exception lo tocó)

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

  -- 5-bis) asignar_sillas_creacion (wrapper de CREACIÓN, service_role):
  --    debe ACEPTAR con un usuario real y activo aunque su rol sea externo
  --    (agencia/freelance) — la reserva B2B usa este camino, nunca el de
  --    ajustar_sillas_por_pasajeros (que exige rol interno).
  declare
    v_uid_b2b uuid := gen_random_uuid();
    v_ret2 integer;
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_uid_b2b, 'postcheck167-b2b@test.local', jsonb_build_object('rol', 'agencia', 'nombre', 'Postcheck B2B'));
    -- v_num todavía no tiene sillas asignadas en este punto del script (0
    -- holders reales) — pedir 1 ejercita la asignación de verdad, no un no-op.
    select holders_total into v_ret2 from public.asignar_sillas_creacion(v_num, 1, v_uid_b2b);
    insert into pg_temp.postcheck_167_reporte
      values ('rpc', 'asignar_sillas_creacion: usuario externo (agencia) activo -> aceptado', case when v_ret2 = 1 then 'OK' else 'FALLA' end, 'retorno='||v_ret2);
    perform public.asignar_sillas_creacion(v_num, 0, v_uid_b2b); -- deja limpio para los pasos siguientes
  end;

  -- 5-ter) asignar_sillas_creacion con usuario inexistente: debe rechazarse.
  begin
    perform public.asignar_sillas_creacion(v_num, 1, gen_random_uuid());
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'asignar_sillas_creacion: usuario inexistente -> rechazado', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 5-quater) ajustar_sillas_por_pasajeros (wrapper de EDICIÓN) rechaza una
  --    llamada SIN sesión de usuario interno real (mismo escenario que
  --    intentaría un B2B externo si llamara por el camino equivocado).
  perform set_config('request.jwt.claims', null, true); -- limpia el claim: sin sesión
  begin
    perform public.ajustar_sillas_por_pasajeros(v_num, 1);
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true); -- restaura la sesión superadmin
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'ajustar_sillas_por_pasajeros: sin sesión interna -> rechazado', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 6) ajustar_sillas_por_pasajeros: contrato existente pero SIN sillas
  --    propias (v_num2 — nunca se le asignó bloqueo) -> no-op (0).
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num2, 3);
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'sin sillas propias -> no-op', case when v_ret = 0 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 7) Simular sillas ya asignadas a v_num (1 en_plazo) y pedir subir a 2.
  update public.sillas set estado = 'en_plazo', numero_contrato = v_num where bloqueo_id = v_bloqueo_id and numero_silla = 1;
  select holders_total, silla_ids into v_ret, v_ids from public.ajustar_sillas_por_pasajeros(v_num, 2);
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'aumentar 1->2 con 1 disponible: asigna la segunda', case when v_ret = 2 and array_length(v_ids,1) = 2 then 'OK' else 'FALLA' end, 'retorno='||v_ret||' ids='||v_ids::text);

  -- 8) Pedir bajar a 1 -> libera una silla.
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num, 1);
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'bajar 2->1: libera una silla', case when v_ret = 1 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 9) Pedir más de las que hay disponibles en el bloqueo (agotado): debe
  --    fallar ENTERO, sin modificar pasajeros NI inventario.
  update public.sillas set estado='no_vendida' where bloqueo_id = v_bloqueo_id and numero_contrato is null;
  declare
    v_pasajeros_antes int; v_pasajeros_despues int;
    v_sillas_antes text; v_sillas_despues text;
  begin
    select count(*) into v_pasajeros_antes from public.contrato_pasajeros where numero_contrato = v_num;
    select string_agg(estado||':'||coalesce(numero_contrato,''), ',' order by numero_silla) into v_sillas_antes
      from public.sillas where bloqueo_id = v_bloqueo_id;
    begin
      perform public.ajustar_sillas_por_pasajeros(v_num, 5);
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    select count(*) into v_pasajeros_despues from public.contrato_pasajeros where numero_contrato = v_num;
    select string_agg(estado||':'||coalesce(numero_contrato,''), ',' order by numero_silla) into v_sillas_despues
      from public.sillas where bloqueo_id = v_bloqueo_id;
    v_ok := v_ok and v_pasajeros_antes = v_pasajeros_despues and v_sillas_antes = v_sillas_despues;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'capacidad agotada: falla entero sin cambios parciales (pasajeros NI sillas tocados)', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 10) 1 -> 0 -> 1 conservando el bloqueo (redescubierto vía ventas.bloqueo_ref_id).
  update public.sillas set estado = 'disponible' where bloqueo_id = v_bloqueo_id; -- reset
  update public.sillas set estado = 'en_plazo', numero_contrato = v_num where bloqueo_id = v_bloqueo_id and numero_silla = 1;
  perform public.ajustar_sillas_por_pasajeros(v_num, 0); -- libera TODO (numero_contrato queda null en todas)
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num, 1); -- debe redescubrir por bloqueo_ref_id
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', '1->0->1 conserva el bloqueo (ventas.bloqueo_ref_id)', case when v_ret = 1 then 'OK' else 'FALLA' end, 'retorno='||v_ret);
  perform public.ajustar_sillas_por_pasajeros(v_num, 0); -- deja limpio para lo que sigue

  -- ═════════════════════════════════════════════════════════════════════════
  -- guardar_pasajeros_contrato: pruebas de extremo a extremo
  -- ═════════════════════════════════════════════════════════════════════════

  -- 11) Infante NUEVO sin responsable_orden -> rechazado (obligatorio).
  begin
    perform * from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
      jsonb_build_object('nombre','Adulto Nuevo','tipoId','CC','identificacion','1000167201','fechaNacimiento',(current_date - interval '25 years')::date::text),
      jsonb_build_object('nombre','Infante Nuevo Sin Link','tipoId','RC','identificacion','1000167202','fechaNacimiento',(current_date - interval '6 months')::date::text)
    ));
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'infante NUEVO sin responsable: rechazado', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 12) Guardado válido: 1 adulto + 1 infante vinculado -> acepta, holders=1.
  update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id = v_bloqueo_id;
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('nombre','Adulto Uno','tipoId','CC','identificacion','1000167001','fechaNacimiento',(current_date - interval '30 years')::date::text),
    jsonb_build_object('nombre','Infante Uno','tipoId','RC','identificacion','1000167002','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
  ));
  select id into v_id_adulto from public.contrato_pasajeros where numero_contrato = v_num and orden = 0;
  select id into v_id_infante from public.contrato_pasajeros where numero_contrato = v_num and orden = 1;
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'guardado válido con vínculo: acepta y asigna 1 silla', case when exists (
      select 1 from public.contrato_pasajeros where id = v_id_infante and responsable_id = v_id_adulto
    ) and exists (
      select 1 from public.sillas where numero_contrato = v_num and estado = 'en_plazo'
    ) then 'OK' else 'FALLA' end, '');

  -- 13) Round-trip: "recarga" (usa los ids reales ya persistidos) y vuelve a
  --     guardar sin tocar nada -> el vínculo debe seguir exactamente igual.
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('id',v_id_adulto,'nombre','Adulto Uno','tipoId','CC','identificacion','1000167001','fechaNacimiento',(current_date - interval '30 years')::date::text),
    jsonb_build_object('id',v_id_infante,'nombre','Infante Uno','tipoId','RC','identificacion','1000167002','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'round-trip: vínculo persiste tras recargar y volver a guardar', case when exists (
      select 1 from public.contrato_pasajeros where id = v_id_infante and responsable_id = v_id_adulto
    ) then 'OK' else 'FALLA' end, '');

  -- 14) Segunda edición: cambia un dato ajeno (nombre del adulto) manteniendo
  --     el mismo vínculo -> el vínculo debe seguir intacto (no es frágil a
  --     ediciones no relacionadas).
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('id',v_id_adulto,'nombre','Adulto Uno Editado','tipoId','CC','identificacion','1000167001','fechaNacimiento',(current_date - interval '30 years')::date::text),
    jsonb_build_object('id',v_id_infante,'nombre','Infante Uno','tipoId','RC','identificacion','1000167002','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'segunda edición no relacionada conserva el vínculo', case when exists (
      select 1 from public.contrato_pasajeros where id = v_id_infante and responsable_id = v_id_adulto
    ) and exists (
      select 1 from public.contrato_pasajeros where id = v_id_adulto and nombre = 'Adulto Uno Editado'
    ) then 'OK' else 'FALLA' end, '');

  -- 15) Grandfather: infante HISTÓRICO sin vínculo (insertado directo, sin
  --     pasar por el RPC) se vuelve a guardar SIN responsableOrden -> debe
  --     ACEPTARSE (no se migra/inventa un vínculo histórico).
  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
    values (v_num3, 'Cliente Postcheck 167 C', current_date + 30, 2, 60000, 'pendiente', 'mayorista');
  declare
    v_id_hist_adulto bigint; v_id_hist_infante bigint;
  begin
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values (v_num3, 'Adulto Historico', 'CC', '1000167301', (current_date - interval '35 years')::date, false, 0)
      returning id into v_id_hist_adulto;
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values (v_num3, 'Infante Historico', 'RC', '1000167302', (current_date - interval '1 years')::date, true, 1)
      returning id into v_id_hist_infante;

    begin
      perform 1 from public.guardar_pasajeros_contrato(v_num3, jsonb_build_array(
        jsonb_build_object('id',v_id_hist_adulto,'nombre','Adulto Historico','tipoId','CC','identificacion','1000167301','fechaNacimiento',(current_date - interval '35 years')::date::text),
        jsonb_build_object('id',v_id_hist_infante,'nombre','Infante Historico','tipoId','RC','identificacion','1000167302','fechaNacimiento',(current_date - interval '1 years')::date::text)
      ));
      v_ok := true;
    exception when others then
      v_ok := false;
    end;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'grandfather: infante histórico sin vínculo se sigue guardando sin forzar uno', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 16) Eliminar el INF (quitarlo del guardado) no debe afectar la silla del
  --     ADT restante (INF nunca ocupó silla) — reutiliza v_num (adulto+infante).
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num, 1); -- confirma 1 silla activa (ADT)
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('id',v_id_adulto,'nombre','Adulto Uno Editado','tipoId','CC','identificacion','1000167001','fechaNacimiento',(current_date - interval '30 years')::date::text)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'eliminar INF no libera la silla del ADT', case when exists (
      select 1 from public.sillas where numero_contrato = v_num and estado = 'en_plazo'
    ) then 'OK' else 'FALLA' end, '');

  -- 17) Eliminar el ADT (dejando solo servicios sin pax con silla) SÍ libera su silla.
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('nombre','Solo Terrestre','tipoId','CC','identificacion','1000167401','fechaNacimiento',(current_date - interval '50 years')::date::text)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'reemplazar el único ADT libera la silla vieja (nueva silla al nuevo ADT)', case when (
      select count(*) from public.sillas where numero_contrato = v_num and estado = 'en_plazo'
    ) = 1 then 'OK' else 'FALLA' end, '');

  raise notice 'postcheck 167: fixtures creados bajo %/%/% (se revierten con ROLLBACK)', v_num, v_num2, v_num3;
end $$;

-- ── Concurrencia real (dos conexiones) — ver test_167_concurrencia.sh ──────
insert into pg_temp.postcheck_167_reporte
  values ('concurrencia', 'dos conexiones compitiendo por la última silla', 'VER_SCRIPT', 'supabase/scripts/test_167_concurrencia.sh — no se puede probar con dos conexiones reales dentro de esta única transacción/sesión psql.');

do $$
declare v_bad int; v_total int; v_verificables int;
begin
  select count(*) into v_total from pg_temp.postcheck_167_reporte;
  select count(*) into v_bad from pg_temp.postcheck_167_reporte where estado='FALLA';
  select count(*) into v_verificables from pg_temp.postcheck_167_reporte where estado <> 'VER_SCRIPT';
  raise notice 'POSTCHECK 167: %/% OK (% FALLA, % delegada a test_167_concurrencia.sh)', v_verificables - v_bad, v_verificables, v_bad, v_total - v_verificables;
  raise notice 'VEREDICTO POSTCHECK 167: %', (case when v_bad=0 then 'OK' else 'FALLO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_167_reporte order by (estado = 'FALLA') desc, seccion, nombre;

-- Termina SIEMPRE en ROLLBACK — ningún dato de este script queda persistido
-- (incluida la fila de auth.users/usuarios creada para poder invocar el RPC
-- con un rol real).
rollback;
