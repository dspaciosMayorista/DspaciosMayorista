-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 167 · vínculo INF→adulto (autoridad SQL) + creación/edición
-- transaccional de pasajeros + sillas. Solo lectura + una transacción de
-- PRUEBA REAL que termina en ROLLBACK (no deja datos ficticios). Pensada
-- para correr contra una base LOCAL desechable — nunca contra Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create temp table if not exists pg_temp.postcheck_167_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.postcheck_167_reporte;

-- `local-desde-cero.sh` (harness LOCAL, no Supabase real) hace, como último
-- paso DESPUÉS de aplicar TODAS las migraciones, un `grant all on all
-- tables in schema public to anon, authenticated, service_role` — a
-- diferencia de Supabase real, donde ese grant nace de `ALTER DEFAULT
-- PRIVILEGES` (se aplica automáticamente AL CREAR cada tabla, así que el
-- `revoke` explícito de la propia migración 167, que corre justo después
-- del `create table`, sí queda como última palabra). Ese único paso del
-- harness le vuelve a otorgar acceso a `_pasajeros_exentos_167` DESPUÉS de
-- que la migración ya revocó todo — es una limitación conocida del arnés
-- de pruebas local, no de la migración. Se re-revoca aquí, una sola vez,
-- para poder probar la propiedad real (nadie de aplicación puede escribir
-- la foto congelada) tal como se comportaría en Supabase real.
revoke all on public._pasajeros_exentos_167 from anon, authenticated, service_role;

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
select 'esquema', '_pasajeros_exentos_167: sin GRANT para ningún rol de aplicación',
  case when not exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='_pasajeros_exentos_167'
      and grantee in ('anon','authenticated','service_role','public')
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_167_reporte
select 'esquema', f.nombre||'() existe',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=f.nombre
  ) then 'OK' else 'FALLA' end, ''
from (values ('ajustar_sillas_por_pasajeros'), ('guardar_pasajeros_contrato'), ('crear_pasajeros_contrato'), ('crear_pasajeros_contrato_multi'), ('_guardar_pasajeros_nucleo'), ('_reemplazar_pasajeros_nucleo'), ('_ajustar_sillas_bloqueo_nucleo')) as f(nombre);

-- ── Pruebas de ejecución real, aisladas en una transacción con ROLLBACK ────
do $$
declare
  -- Formato exigido por ventas_numero_contrato_formato_por_tenant (migración
  -- 160) para tenant='mayorista': ^DTM-[0-9]{4,}$ — solo dígitos tras el
  -- prefijo, así que el número de prueba no puede llevar texto libre.
  v_num          text := 'DTM-9'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num2         text := 'DTM-8'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num3         text := 'DTM-7'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num4         text := 'DTM-6'||to_char(clock_timestamp(),'HH24MISSMS');
  v_num5         text := 'DTM-5'||to_char(clock_timestamp(),'HH24MISSMS');
  v_bloqueo_id   bigint;
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

  -- ═══════════════════════════════════════════════════════════════════════
  -- 0) LA AUTORIDAD ES EL TRIGGER, no una función en particular: un INSERT
  --    DIRECTO (sin pasar por NINGÚN RPC) de un infante NUEVO sin
  --    responsable debe rechazarse siempre. Este es el hallazgo B1 #1/#2 de
  --    la segunda revisión de alto riesgo, probado de la forma más directa
  --    posible.
  -- ═══════════════════════════════════════════════════════════════════════
  begin
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values (v_num, 'Infante Colado Por Insert Directo', 'RC', '1000167099', (current_date - interval '1 years')::date, true, 9);
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'INSERT directo de INF NUEVO sin responsable (sin pasar por ningún RPC): rechazado por la autoridad SQL', case when v_ok then 'OK' else 'FALLA' end, '');

  -- Fixture normal: el infante SOLO puede nacer YA vinculado (insertarlo sin
  -- responsable_id, aunque sea en la misma sentencia que el resto de sus
  -- datos, ya no es posible — se prueba arriba). Se crea el par
  -- adulto+infante vinculado directamente para las pruebas de integridad
  -- del vínculo (2-5) que siguen.
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values (v_num, 'Adulto Uno', 'CC', '1000167001', (current_date - interval '30 years')::date, false, 0)
    returning id into v_p_adulto;
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden, responsable_id)
    values (v_num, 'Infante Uno', 'RC', '1000167002', (current_date - interval '1 years')::date, true, 1, v_p_adulto)
    returning id into v_p_infante;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', 'INSERT directo de INF nuevo CON responsable válido: aceptado', case when v_p_infante is not null then 'OK' else 'FALLA' end, '');

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

  -- 5-bis) Nadie de aplicación puede auto-otorgarse la exención histórica:
  --    ni `authenticated` ni `service_role` tienen GRANT sobre
  --    `_pasajeros_exentos_167` — solo el dueño del esquema (esta migración).
  set role service_role;
  begin
    insert into public._pasajeros_exentos_167 (pasajero_id) values (v_p_infante);
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  insert into pg_temp.postcheck_167_reporte
    values ('trigger', '_pasajeros_exentos_167: service_role NO puede escribir (sin GRANT)', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 6) crear_pasajeros_contrato (wrapper de CREACIÓN, service_role): debe
  --    ACEPTAR con un usuario real y activo aunque su rol sea externo
  --    (agencia/freelance) — la reserva B2B usa este camino, nunca el de
  --    guardar_pasajeros_contrato (que exige rol interno).
  declare
    v_uid_b2b uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_uid_b2b, 'postcheck167-b2b@test.local', jsonb_build_object('rol', 'agencia', 'nombre', 'Postcheck B2B'));
    insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
      values (v_num5, 'Cliente Postcheck 167 B2B', current_date + 30, 1, 70000, 'pendiente', 'mayorista');
    perform 1 from public.crear_pasajeros_contrato(v_num5, jsonb_build_array(
      jsonb_build_object('nombre','Cliente B2B','tipoId','CC','identificacion','1000167501','fechaNacimiento',(current_date - interval '28 years')::date::text)
    ), 0, v_uid_b2b);
    insert into pg_temp.postcheck_167_reporte
      values ('rpc', 'crear_pasajeros_contrato: usuario externo (agencia) activo -> aceptado', case when exists (
        select 1 from public.contrato_pasajeros where numero_contrato = v_num5 and identificacion = '1000167501'
      ) then 'OK' else 'FALLA' end, '');
  end;

  -- 7) crear_pasajeros_contrato con usuario inexistente: debe rechazarse (y
  --    no debe dejar NADA insertado del intento).
  begin
    perform 1 from public.crear_pasajeros_contrato(v_num5, jsonb_build_array(
      jsonb_build_object('nombre','Intento Colado','tipoId','CC','identificacion','1000167502','fechaNacimiento',(current_date - interval '30 years')::date::text)
    ), 0, gen_random_uuid());
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'crear_pasajeros_contrato: usuario inexistente -> rechazado, sin dejar rastro', case when v_ok and not exists (
      select 1 from public.contrato_pasajeros where identificacion = '1000167502'
    ) then 'OK' else 'FALLA' end, '');

  -- 8) guardar_pasajeros_contrato (wrapper de EDICIÓN) rechaza una llamada
  --    SIN sesión de usuario interno real (mismo escenario que intentaría un
  --    B2B externo si llamara por el camino equivocado).
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

  -- 9) ajustar_sillas_por_pasajeros: contrato existente pero SIN sillas
  --    propias (v_num2 — nunca se le asignó bloqueo) -> no-op (0).
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num2, 3);
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'sin sillas propias -> no-op', case when v_ret = 0 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 10) Simular sillas ya asignadas a v_num (1 en_plazo) y pedir subir a 2.
  update public.sillas set estado = 'en_plazo', numero_contrato = v_num where bloqueo_id = v_bloqueo_id and numero_silla = 1;
  select holders_total, silla_ids into v_ret, v_ids from public.ajustar_sillas_por_pasajeros(v_num, 2);
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'aumentar 1->2 con 1 disponible: asigna la segunda', case when v_ret = 2 and array_length(v_ids,1) = 2 then 'OK' else 'FALLA' end, 'retorno='||v_ret||' ids='||v_ids::text);

  -- 11) Pedir bajar a 1 -> libera una silla.
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num, 1);
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', 'bajar 2->1: libera una silla', case when v_ret = 1 then 'OK' else 'FALLA' end, 'retorno='||v_ret);

  -- 12) Pedir más de las que hay disponibles en el bloqueo (agotado): debe
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

  -- 13) 1 -> 0 -> 1 conservando el bloqueo (redescubierto vía ventas.bloqueo_ref_id).
  update public.sillas set estado = 'disponible' where bloqueo_id = v_bloqueo_id; -- reset
  update public.sillas set estado = 'en_plazo', numero_contrato = v_num where bloqueo_id = v_bloqueo_id and numero_silla = 1;
  perform public.ajustar_sillas_por_pasajeros(v_num, 0); -- libera TODO (numero_contrato queda null en todas)
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num, 1); -- debe redescubrir por bloqueo_ref_id
  insert into pg_temp.postcheck_167_reporte
    values ('rpc', '1->0->1 conserva el bloqueo (ventas.bloqueo_ref_id)', case when v_ret = 1 then 'OK' else 'FALLA' end, 'retorno='||v_ret);
  perform public.ajustar_sillas_por_pasajeros(v_num, 0); -- deja limpio para lo que sigue

  -- ═════════════════════════════════════════════════════════════════════════
  -- guardar_pasajeros_contrato: pruebas de extremo a extremo (EDICIÓN)
  -- ═════════════════════════════════════════════════════════════════════════

  -- 14) Infante NUEVO sin responsable_orden -> rechazado (obligatorio),
  --     y NO deja rastro (ni el adulto que lo acompañaba queda guardado:
  --     todo el guardado se revierte junto).
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
    values ('guardar', 'infante NUEVO sin responsable: rechazado, sin dejar ni al adulto acompañante', case when v_ok and not exists (
      select 1 from public.contrato_pasajeros where identificacion in ('1000167201','1000167202')
    ) then 'OK' else 'FALLA' end, '');

  -- 15) Guardado válido: 1 adulto + 1 infante vinculado -> acepta, holders=1.
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

  -- 16) Round-trip: "recarga" (usa los ids reales ya persistidos) y vuelve a
  --     guardar sin tocar nada -> el vínculo debe seguir exactamente igual.
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('id',v_id_adulto,'nombre','Adulto Uno','tipoId','CC','identificacion','1000167001','fechaNacimiento',(current_date - interval '30 years')::date::text),
    jsonb_build_object('id',v_id_infante,'nombre','Infante Uno','tipoId','RC','identificacion','1000167002','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'round-trip: vínculo persiste tras recargar y volver a guardar', case when exists (
      select 1 from public.contrato_pasajeros where id = v_id_infante and responsable_id = v_id_adulto
    ) then 'OK' else 'FALLA' end, '');

  -- 17) Segunda edición: cambia un dato ajeno (nombre del adulto) manteniendo
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

  -- 18) Grandfather REAL: se simula un infante que YA EXISTÍA (con
  --     responsable_id=null) ANTES de que existiera esta regla —
  --     desactivando el trigger un instante y congelando su id en
  --     `_pasajeros_exentos_167` exactamente como lo hace el `INSERT ...
  --     SELECT` de la propia migración al aplicarse sobre datos ya
  --     existentes (nunca "regalando" la exención por otro medio). Guardarlo
  --     de nuevo SIN responsableOrden debe ACEPTARSE (no se migra/inventa un
  --     vínculo histórico).
  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
    values (v_num3, 'Cliente Postcheck 167 C', current_date + 30, 2, 60000, 'pendiente', 'mayorista');
  declare
    v_id_hist_adulto bigint; v_id_hist_infante bigint;
  begin
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values (v_num3, 'Adulto Historico', 'CC', '1000167301', (current_date - interval '35 years')::date, false, 0)
      returning id into v_id_hist_adulto;

    alter table public.contrato_pasajeros disable trigger trg_validar_responsable_infante;
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values (v_num3, 'Infante Historico', 'RC', '1000167302', (current_date - interval '1 years')::date, true, 1)
      returning id into v_id_hist_infante;
    alter table public.contrato_pasajeros enable trigger trg_validar_responsable_infante;
    insert into public._pasajeros_exentos_167 (pasajero_id) values (v_id_hist_infante); -- foto congelada, como la migración

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
    values ('guardar', 'grandfather REAL (id congelado en _pasajeros_exentos_167): infante histórico sigue guardándose sin forzar vínculo', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 19) UN INFANTE CREADO DESPUÉS DE LA 167 NUNCA PUEDE ACOGERSE AL
  --     GRANDFATHERING: se crea con crear_pasajeros_contrato (post-167, con
  --     responsable real desde el nacimiento de la fila) y LUEGO se intenta
  --     "soltar" el vínculo (omitir responsableOrden) en una edición
  --     posterior — a diferencia del infante histórico de la prueba 18, su
  --     id JAMÁS estuvo en `_pasajeros_exentos_167`, así que debe
  --     rechazarse SIEMPRE, sin importar cuántas ediciones pasen.
  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
    values (v_num4, 'Cliente Postcheck 167 D', current_date + 30, 2, 80000, 'pendiente', 'mayorista');
  declare
    v_id_nuevo_adulto bigint; v_id_nuevo_infante bigint; v_uid_creador uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_uid_creador, 'postcheck167-creador@test.local', jsonb_build_object('rol', 'venta', 'nombre', 'Postcheck Creador'));
    perform 1 from public.crear_pasajeros_contrato(v_num4, jsonb_build_array(
      jsonb_build_object('nombre','Adulto Nuevo Post167','tipoId','CC','identificacion','1000167601','fechaNacimiento',(current_date - interval '33 years')::date::text),
      jsonb_build_object('nombre','Infante Nuevo Post167','tipoId','RC','identificacion','1000167602','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
    ), 0, v_uid_creador);
    select id into v_id_nuevo_adulto from public.contrato_pasajeros where numero_contrato = v_num4 and orden = 0;
    select id into v_id_nuevo_infante from public.contrato_pasajeros where numero_contrato = v_num4 and orden = 1;

    begin
      perform 1 from public.guardar_pasajeros_contrato(v_num4, jsonb_build_array(
        jsonb_build_object('id',v_id_nuevo_adulto,'nombre','Adulto Nuevo Post167','tipoId','CC','identificacion','1000167601','fechaNacimiento',(current_date - interval '33 years')::date::text),
        jsonb_build_object('id',v_id_nuevo_infante,'nombre','Infante Nuevo Post167','tipoId','RC','identificacion','1000167602','fechaNacimiento',(current_date - interval '1 years')::date::text)
      ));
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    -- El vínculo real (puesto al nacer la fila) debe seguir intacto tras el
    -- intento fallido de soltarlo.
    v_ok := v_ok and exists (
      select 1 from public.contrato_pasajeros where id = v_id_nuevo_infante and responsable_id = v_id_nuevo_adulto
    );
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'INF creado DESPUÉS de 167 (vía crear_pasajeros_contrato) no puede acogerse al grandfather ni perder su vínculo real después', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 20) Eliminar el INF (quitarlo del guardado) no debe afectar la silla del
  --     ADT restante (INF nunca ocupó silla) — reutiliza v_num (adulto+infante).
  select holders_total into v_ret from public.ajustar_sillas_por_pasajeros(v_num, 1); -- confirma 1 silla activa (ADT)
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('id',v_id_adulto,'nombre','Adulto Uno Editado','tipoId','CC','identificacion','1000167001','fechaNacimiento',(current_date - interval '30 years')::date::text)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'eliminar INF no libera la silla del ADT', case when exists (
      select 1 from public.sillas where numero_contrato = v_num and estado = 'en_plazo'
    ) then 'OK' else 'FALLA' end, '');

  -- 21) Eliminar el ADT (dejando solo servicios sin pax con silla) SÍ libera su silla.
  perform 1 from public.guardar_pasajeros_contrato(v_num, jsonb_build_array(
    jsonb_build_object('nombre','Solo Terrestre','tipoId','CC','identificacion','1000167401','fechaNacimiento',(current_date - interval '50 years')::date::text)
  ));
  insert into pg_temp.postcheck_167_reporte
    values ('guardar', 'reemplazar el único ADT libera la silla vieja (nueva silla al nuevo ADT)', case when (
      select count(*) from public.sillas where numero_contrato = v_num and estado = 'en_plazo'
    ) = 1 then 'OK' else 'FALLA' end, '');

  -- ═════════════════════════════════════════════════════════════════════════
  -- crear_pasajeros_contrato: CREACIÓN atómica (pasajeros + responsables +
  -- sillas en UNA sola transacción — cierra B5)
  -- ═════════════════════════════════════════════════════════════════════════

  -- 22) Falta de sillas en la creación: debe fallar ENTERO — no deja NI el
  --     pasajero nombrado NI ninguna silla tomada (nunca ok:true con estado
  --     parcial). Se agota el bloqueo explícitamente aquí (las pruebas 13/15
  --     ya devolvieron sillas libres al pool, así que no se puede asumir el
  --     estado que dejó la prueba 12).
  update public.sillas set estado = 'no_vendida'
   where bloqueo_id = v_bloqueo_id and estado in ('disponible', 'cambio_entrante');
  insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant, bloqueo_ref_id)
    values ('DTM-4'||to_char(clock_timestamp(),'HH24MISSMS'), 'Cliente Postcheck 167 Sin Cupo', current_date + 30, 1, 40000, 'pendiente', 'mayorista', v_bloqueo_id);
  declare
    v_num_sincupo text; v_pax_antes int; v_pax_despues int; v_sillas_estado_antes text; v_sillas_estado_despues text;
  begin
    select numero_contrato into v_num_sincupo from public.ventas where cliente = 'Cliente Postcheck 167 Sin Cupo';
    select count(*) into v_pax_antes from public.contrato_pasajeros where numero_contrato = v_num_sincupo;
    select string_agg(estado||':'||coalesce(numero_contrato,''), ',' order by numero_silla) into v_sillas_estado_antes
      from public.sillas where bloqueo_id = v_bloqueo_id;
    begin
      perform 1 from public.crear_pasajeros_contrato(v_num_sincupo, jsonb_build_array(
        jsonb_build_object('nombre','Pasajero Sin Cupo','tipoId','CC','identificacion','1000167701','fechaNacimiento',(current_date - interval '30 years')::date::text)
      ), 0, v_uid);
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    select count(*) into v_pax_despues from public.contrato_pasajeros where numero_contrato = v_num_sincupo;
    select string_agg(estado||':'||coalesce(numero_contrato,''), ',' order by numero_silla) into v_sillas_estado_despues
      from public.sillas where bloqueo_id = v_bloqueo_id;
    v_ok := v_ok and v_pax_antes = 0 and v_pax_despues = 0 and v_sillas_estado_antes = v_sillas_estado_despues;
  end;
  insert into pg_temp.postcheck_167_reporte
    values ('crear', 'falta de sillas en creación: nunca ok, sin pasajero ni silla parcial', case when v_ok then 'OK' else 'FALLA' end, '');

  -- 23) p_holders_min: creación SIN pasajeros nombrados (convertirCotizacion
  --     con override) todavía debe reservar las sillas que declara la
  --     composición de habitaciones (nunca sub-reservar por lista vacía).
  update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id = v_bloqueo_id;
  declare
    v_num_vacio text := 'DTM-3'||to_char(clock_timestamp(),'HH24MISSMS');
  begin
    insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant, bloqueo_ref_id)
      values (v_num_vacio, 'Cliente Postcheck 167 Vacio', current_date + 30, 2, 90000, 'pendiente', 'mayorista', v_bloqueo_id);
    perform 1 from public.crear_pasajeros_contrato(v_num_vacio, '[]'::jsonb, 2, v_uid);
    select count(*) into v_ret from public.sillas where numero_contrato = v_num_vacio and estado = 'en_plazo';
    insert into pg_temp.postcheck_167_reporte
      values ('crear', 'p_holders_min: pasajeros vacíos igual reserva el piso declarado (composición de habitaciones)', case when v_ret = 2 and not exists (
        select 1 from public.contrato_pasajeros where numero_contrato = v_num_vacio
      ) then 'OK' else 'FALLA' end, 'sillas_en_plazo='||v_ret);
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- crear_pasajeros_contrato_multi: CREACIÓN atómica con VARIOS bloqueos
  -- bajo un mismo contrato (revisión de alto riesgo, ronda 3 — B6). Cubre
  -- los escenarios #6 y #7 exigidos: "carrito con INF y adulto responsable
  -- funciona" y "carrito con INF sin responsable falla antes de dejar datos
  -- parciales". El escenario #8 (concurrencia real, dos conexiones) está en
  -- test_167_concurrencia.sh — no se puede simular con dos conexiones
  -- reales dentro de esta única transacción/sesión psql.
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_num6          text := 'DTM-2'||to_char(clock_timestamp(),'HH24MISSMS');
    v_num7          text := 'DTM-1'||to_char(clock_timestamp(),'HH24MISSMS');
    v_bloqueo2_id   bigint;
    v_id_multi_adt  bigint;
    v_id_multi_inf  bigint;
  begin
    -- La prueba 23 (arriba) agotó las sillas de v_bloqueo_id (2 cupos, los 2
    -- tomados por v_num_vacio) — se libera aquí antes de reutilizarlo, igual
    -- que hacen las pruebas 15/18 más arriba.
    update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id = v_bloqueo_id;

    -- Segundo bloqueo, DISTINTO del de arriba — el caso real de
    -- convertirCotizacionCarrito (varios ítems tipo bloqueo, un mismo
    -- contrato, cada uno con su propio record de vuelo).
    insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
      values ('PC167TEST2', 'TEST', 'CTG-SMR', current_date + 30, 2)
      returning id into v_bloqueo2_id;
    insert into public.sillas (bloqueo_id, numero_silla, estado)
      values (v_bloqueo2_id, 1, 'disponible'), (v_bloqueo2_id, 2, 'disponible');
    -- Sin bloqueo_ref_id: un contrato de carrito con varios bloqueos no
    -- estampa uno solo (sería arbitrario cuál) — exactamente el caso que
    -- crear_pasajeros_contrato_multi resuelve sin inventar esa relación.
    insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
      values (v_num6, 'Cliente Postcheck 167 Multi', current_date + 30, 2, 120000, 'pendiente', 'mayorista');

    -- 24) #6 — 1 adulto + 1 infante VINCULADO, volando en los DOS bloqueos
    --     (mismo grupo, dos tramos/records) -> acepta, reserva 1 silla del
    --     adulto en CADA bloqueo (el infante nunca ocupa silla), y el
    --     vínculo queda persistido igual que en el camino de un solo
    --     bloqueo.
    perform 1 from public.crear_pasajeros_contrato_multi(
      v_num6,
      jsonb_build_array(
        jsonb_build_object('nombre','Adulto Multi','tipoId','CC','identificacion','1000167801','fechaNacimiento',(current_date - interval '30 years')::date::text),
        jsonb_build_object('nombre','Infante Multi','tipoId','RC','identificacion','1000167802','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
      ),
      jsonb_build_array(
        jsonb_build_object('bloqueoId', v_bloqueo_id, 'holdersMin', 1, 'posiciones', jsonb_build_array(1,2)),
        jsonb_build_object('bloqueoId', v_bloqueo2_id, 'holdersMin', 1, 'posiciones', jsonb_build_array(1,2))
      ),
      v_uid
    );
    select id into v_id_multi_adt from public.contrato_pasajeros where numero_contrato = v_num6 and orden = 0;
    select id into v_id_multi_inf from public.contrato_pasajeros where numero_contrato = v_num6 and orden = 1;
    insert into pg_temp.postcheck_167_reporte
      values ('multi', '#6 carrito con INF y adulto responsable: acepta y reserva 1 silla del adulto en CADA bloqueo (nunca el infante)', case when exists (
        select 1 from public.contrato_pasajeros where id = v_id_multi_inf and responsable_id = v_id_multi_adt
      ) and (
        select count(*) from public.sillas where numero_contrato = v_num6 and bloqueo_id = v_bloqueo_id and estado = 'en_plazo'
      ) = 1 and (
        select count(*) from public.sillas where numero_contrato = v_num6 and bloqueo_id = v_bloqueo2_id and estado = 'en_plazo'
      ) = 1 then 'OK' else 'FALLA' end, '');

    -- 25) #7 — infante SIN responsable en un carrito multi-bloqueo: falla
    --     ENTERO (autoridad real: el trigger, igual que en el caso de un
    --     solo bloqueo) y no deja NI el pasajero NI ninguna silla tomada en
    --     NINGUNO de los dos bloqueos — nunca un estado parcial (ej. las
    --     sillas del primer bloqueo procesado quedando tomadas mientras el
    --     segundo o la escritura de pasajeros falla).
    update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id in (v_bloqueo_id, v_bloqueo2_id);
    insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
      values (v_num7, 'Cliente Postcheck 167 Multi Sin Resp', current_date + 30, 2, 130000, 'pendiente', 'mayorista');
    begin
      perform 1 from public.crear_pasajeros_contrato_multi(
        v_num7,
        jsonb_build_array(
          jsonb_build_object('nombre','Adulto Multi Sin Resp','tipoId','CC','identificacion','1000167901','fechaNacimiento',(current_date - interval '30 years')::date::text),
          jsonb_build_object('nombre','Infante Multi Sin Resp','tipoId','RC','identificacion','1000167902','fechaNacimiento',(current_date - interval '1 years')::date::text)
        ),
        jsonb_build_array(
          jsonb_build_object('bloqueoId', v_bloqueo_id, 'holdersMin', 1, 'posiciones', jsonb_build_array(1,2)),
          jsonb_build_object('bloqueoId', v_bloqueo2_id, 'holdersMin', 1, 'posiciones', jsonb_build_array(1,2))
        ),
        v_uid
      );
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    v_ok := v_ok
      and not exists (select 1 from public.contrato_pasajeros where identificacion in ('1000167901','1000167902'))
      and not exists (select 1 from public.sillas where numero_contrato = v_num7);
    insert into pg_temp.postcheck_167_reporte
      values ('multi', '#7 carrito con INF sin responsable: falla ENTERO, sin dejar pasajero ni silla en ningún bloqueo', case when v_ok then 'OK' else 'FALLA' end, '');

    -- 26) Deadlock avoidance (parte determinista, sin concurrencia real —
    --     la parte real con dos conexiones está en test_167_concurrencia.sh,
    --     tercera carrera): las entradas de p_reservas_sillas en orden
    --     DESCENDENTE (al revés de bloqueo_id) deben reconciliarse
    --     exactamente igual que en orden ascendente — confirma que el orden
    --     del PAYLOAD nunca decide el orden real de los candados.
    update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id in (v_bloqueo_id, v_bloqueo2_id);
    perform 1 from public.crear_pasajeros_contrato_multi(
      v_num6,
      jsonb_build_array(
        jsonb_build_object('id', v_id_multi_adt, 'nombre','Adulto Multi','tipoId','CC','identificacion','1000167801','fechaNacimiento',(current_date - interval '30 years')::date::text),
        jsonb_build_object('id', v_id_multi_inf, 'nombre','Infante Multi','tipoId','RC','identificacion','1000167802','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
      ),
      -- Orden DESCENDENTE a propósito (el mayor bloqueo_id primero).
      jsonb_build_array(
        jsonb_build_object('bloqueoId', greatest(v_bloqueo_id, v_bloqueo2_id), 'holdersMin', 1, 'posiciones', jsonb_build_array(1,2)),
        jsonb_build_object('bloqueoId', least(v_bloqueo_id, v_bloqueo2_id), 'holdersMin', 1, 'posiciones', jsonb_build_array(1,2))
      ),
      v_uid
    );
    insert into pg_temp.postcheck_167_reporte
      values ('multi', 'el orden del payload de p_reservas_sillas no cambia el resultado (se reconcilia en orden ascendente siempre)', case when (
        select count(*) from public.sillas where numero_contrato = v_num6 and bloqueo_id = v_bloqueo_id and estado = 'en_plazo'
      ) = 1 and (
        select count(*) from public.sillas where numero_contrato = v_num6 and bloqueo_id = v_bloqueo2_id and estado = 'en_plazo'
      ) = 1 then 'OK' else 'FALLA' end, '');

    -- 27) bloqueoId repetido dentro del mismo payload: rechazado (ambigüedad
    --     real — no tiene sentido reconciliar el mismo bloqueo dos veces en
    --     una sola llamada).
    begin
      perform 1 from public.crear_pasajeros_contrato_multi(
        v_num6,
        jsonb_build_array(jsonb_build_object('nombre','X','tipoId','CC','identificacion','1000167999','fechaNacimiento',(current_date - interval '30 years')::date::text)),
        jsonb_build_array(
          jsonb_build_object('bloqueoId', v_bloqueo_id, 'posiciones', jsonb_build_array(1)),
          jsonb_build_object('bloqueoId', v_bloqueo_id, 'posiciones', jsonb_build_array(1))
        ),
        v_uid
      );
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    insert into pg_temp.postcheck_167_reporte
      values ('multi', 'bloqueoId repetido en el mismo payload: rechazado', case when v_ok then 'OK' else 'FALLA' end, '');

    -- 28) B11 (ronda 3): posición REPETIDA dentro de la MISMA reserva de
    --     bloqueo: rechazada (contaría dos sillas para la misma persona en
    --     el mismo ítem). Repetirse ENTRE reservas de bloqueo DISTINTAS
    --     sigue siendo válido — ya probado en la prueba 24 (mismas
    --     posiciones en v_bloqueo_id y v_bloqueo2_id).
    update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id in (v_bloqueo_id, v_bloqueo2_id);
    begin
      perform 1 from public.crear_pasajeros_contrato_multi(
        v_num6,
        jsonb_build_array(
          jsonb_build_object('id', v_id_multi_adt, 'nombre','Adulto Multi','tipoId','CC','identificacion','1000167801','fechaNacimiento',(current_date - interval '30 years')::date::text),
          jsonb_build_object('id', v_id_multi_inf, 'nombre','Infante Multi','tipoId','RC','identificacion','1000167802','fechaNacimiento',(current_date - interval '1 years')::date::text,'responsableOrden',1)
        ),
        jsonb_build_array(
          jsonb_build_object('bloqueoId', v_bloqueo_id, 'posiciones', jsonb_build_array(1, 1))
        ),
        v_uid
      );
      v_ok := false;
    exception when others then
      v_ok := true;
    end;
    insert into pg_temp.postcheck_167_reporte
      values ('multi', '#B11 posición repetida DENTRO de la misma reserva de bloqueo: rechazada', case when v_ok then 'OK' else 'FALLA' end, '');
  end;

  -- ═════════════════════════════════════════════════════════════════════════
  -- R5 — B14: consolidación de `reservasSillas` por `bloqueoId` en
  -- `convertirCotizacionCarrito` (lib/reservar/carritoAsignaciones.ts,
  -- `consolidarReservasSillasPorBloqueo`). El carrito permite agregar 2+
  -- ítems sobre el MISMO bloqueo (ej. dos hoteles distintos que comparten el
  -- mismo vuelo negociado) — antes de B14 cada ítem generaba su PROPIA
  -- entrada de `p_reservas_sillas`, y la prueba "multi" de arriba
  -- ("bloqueoId repetido en el mismo payload: rechazado") ya demuestra que
  -- el RPC rechaza ese caso sin consolidar. Estas dos pruebas verifican el
  -- resultado REAL, contra el RPC de verdad, de la entrada YA CONSOLIDADA
  -- que produce `consolidarReservasSillasPorBloqueo` (unión de posiciones,
  -- suma de holdersMin) — exactamente lo que TypeScript arma antes de
  -- llamar. El caso de bloqueos DISTINTOS con un pasajero compartido (#9 de
  -- la ronda 5) ya lo cubre la prueba "#6" de arriba (misma persona en
  -- posición 1 de v_bloqueo_id Y v_bloqueo2_id, una silla en cada uno).
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_num8 text := 'DTM-3'||to_char(clock_timestamp(),'HH24MISSMS');
    v_num9 text := 'DTM-2'||to_char(clock_timestamp(),'HH24MISSMS')||'9';
  begin
    update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id = v_bloqueo_id;

    -- 29) B14 #7 — dos ítems (conceptuales) sobre el MISMO bloqueo, con los
    --     MISMOS 2 pasajeros: la unión de posiciones es [1,2] (no [1,2,1,2])
    --     y holdersMin se SUMA (1+1=2, coincide con el conteo real) — la
    --     entrada consolidada debe reservar EXACTAMENTE 2 sillas, nunca 4
    --     (una por persona, no una por persona-por-ítem).
    insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
      values (v_num8, 'Cliente R5 B14 Mismos Pasajeros', current_date + 30, 2, 100000, 'pendiente', 'mayorista');
    perform 1 from public.crear_pasajeros_contrato_multi(
      v_num8,
      jsonb_build_array(
        jsonb_build_object('nombre','B14 Adulto 1','tipoId','CC','identificacion','100016781001','fechaNacimiento',(current_date - interval '30 years')::date::text),
        jsonb_build_object('nombre','B14 Adulto 2','tipoId','CC','identificacion','100016781002','fechaNacimiento',(current_date - interval '30 years')::date::text)
      ),
      jsonb_build_array(
        jsonb_build_object('bloqueoId', v_bloqueo_id, 'holdersMin', 2, 'posiciones', jsonb_build_array(1,2))
      ),
      v_uid
    );
    insert into pg_temp.postcheck_167_reporte
      values ('multi', 'B14 #7: mismo bloqueo + mismos pasajeros de 2 ítems consolidados en 1 sola entrada -> exactamente 1 silla por persona (nunca duplicada)', case when (
        select count(*) from public.sillas where numero_contrato = v_num8 and bloqueo_id = v_bloqueo_id and estado = 'en_plazo'
      ) = 2 then 'OK' else 'FALLA' end, '');

    -- 30) B14 #8 — dos ítems sobre el MISMO bloqueo con subconjuntos
    --     PARCIALMENTE distintos: ítem A=[1,2], ítem B=[2,3] -> unión=[1,2,3]
    --     (3 personas reales, la posición 2 se comparte y NO se duplica).
    --     holdersMin sumado (1+1=2) queda por DEBAJO del conteo real (3) —
    --     el propio `greatest(holdersMin, holders_reales)` del núcleo (ver
    --     prueba de esquema "p_holders_min es un PISO") debe hacer valer el
    --     conteo real: exactamente 3 sillas, nunca 2.
    update public.sillas set estado = 'disponible', numero_contrato = null where bloqueo_id = v_bloqueo_id;
    -- v_bloqueo_id nació con 2 cupos (fixture inicial) — esta unión real
    -- necesita 3 sillas distintas, así que se agrega una tercera aquí.
    insert into public.sillas (bloqueo_id, numero_silla, estado) values (v_bloqueo_id, 3, 'disponible');
    insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
      values (v_num9, 'Cliente R5 B14 Solapamiento Parcial', current_date + 30, 3, 100000, 'pendiente', 'mayorista');
    perform 1 from public.crear_pasajeros_contrato_multi(
      v_num9,
      jsonb_build_array(
        jsonb_build_object('nombre','B14 Solap 1','tipoId','CC','identificacion','100016782001','fechaNacimiento',(current_date - interval '30 years')::date::text),
        jsonb_build_object('nombre','B14 Solap 2','tipoId','CC','identificacion','100016782002','fechaNacimiento',(current_date - interval '30 years')::date::text),
        jsonb_build_object('nombre','B14 Solap 3','tipoId','CC','identificacion','100016782003','fechaNacimiento',(current_date - interval '30 years')::date::text)
      ),
      jsonb_build_array(
        jsonb_build_object('bloqueoId', v_bloqueo_id, 'holdersMin', 2, 'posiciones', jsonb_build_array(1,2,3))
      ),
      v_uid
    );
    insert into pg_temp.postcheck_167_reporte
      values ('multi', 'B14 #8: mismo bloqueo con subconjuntos parcialmente distintos ([1,2]+[2,3]) consolidados en la unión [1,2,3] -> exactamente 3 sillas (el piso real gana sobre la suma de holdersMin)', case when (
        select count(*) from public.sillas where numero_contrato = v_num9 and bloqueo_id = v_bloqueo_id and estado = 'en_plazo'
      ) = 3 then 'OK' else 'FALLA' end, '');
  end;

  raise notice 'postcheck 167: fixtures creados bajo %/%/%/%/% (se revierten con ROLLBACK)', v_num, v_num2, v_num3, v_num4, v_num5;
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
