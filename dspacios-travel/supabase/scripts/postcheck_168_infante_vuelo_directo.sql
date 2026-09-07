-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 168 · guardar_infante_vuelo (alta/edición estrecha de UN infante
-- desde el detalle de un vuelo). Prueba de ejecución REAL en una única
-- transacción que termina en ROLLBACK (no deja datos ficticios). Pensada
-- para correr contra una base LOCAL desechable — nunca contra Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create temp table if not exists pg_temp.postcheck_168_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.postcheck_168_reporte;

insert into pg_temp.postcheck_168_reporte
select 'esquema', 'función guardar_infante_vuelo existe',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_infante_vuelo'
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_168_reporte
select 'esquema', 'guardar_infante_vuelo es SECURITY DEFINER',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_infante_vuelo' and p.prosecdef
  ) then 'OK' else 'FALLA' end, '';

insert into pg_temp.postcheck_168_reporte
select 'permisos', 'anon NO puede ejecutar guardar_infante_vuelo',
  case when has_function_privilege('anon', 'public.guardar_infante_vuelo(bigint,bigint,bigint,text,text,text,text,date)', 'execute')
    then 'FALLA' else 'OK' end, '';

insert into pg_temp.postcheck_168_reporte
select 'permisos', 'authenticated SÍ puede ejecutar guardar_infante_vuelo',
  case when has_function_privilege('authenticated', 'public.guardar_infante_vuelo(bigint,bigint,bigint,text,text,text,text,date)', 'execute')
    then 'OK' else 'FALLA' end, '';

-- ═══════════════════════════════════════════════════════════════════════
-- Ejecución real: fixtures + los 8 escenarios exigidos + controles
-- negativos adicionales (responsable inválido, ambigüedad, referencia
-- externa, sesión inválida) y verificación de "sin escritura parcial" y
-- "nunca toca sillas/capacidad".
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_super       uuid := '11111111-1111-1111-1111-111111111111';
  v_cv          uuid := '22222222-2222-2222-2222-222222222222';
  v_venta_ajeno uuid := '33333333-3333-3333-3333-333333333333';
  v_bloqueo     bigint;
  v_bloqueo2    bigint;
  v_r           record;
  v_ok          boolean;
  v_msg         text;
  v_cnt_sillas_antes int;
  v_cnt_sillas_despues int;
  v_infante_id  bigint;
begin
  -- ── Usuarios reales (vía auth.users → trigger handle_new_user) ─────────
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_super, 'super168-pc@test.local', jsonb_build_object('rol','superadmin','nombre','Super168PC')),
    (v_cv, 'cv168-pc@test.local', jsonb_build_object('rol','control_vuelo','nombre','CV168PC')),
    (v_venta_ajeno, 'ventaajeno168-pc@test.local', jsonb_build_object('rol','venta','nombre','VentaAjeno168PC'));

  -- ── Fixtures de vuelo/sillas/ventas ─────────────────────────────────────
  insert into bloqueos_vuelo (record, fecha_ida, cupos_total) values ('PC168A', '2026-06-15', 10) returning id into v_bloqueo;
  insert into bloqueos_vuelo (record, fecha_ida, cupos_total) values ('PC168B', '2026-07-01', 10) returning id into v_bloqueo2;

  -- Contrato orgánico mayorista (formato DTM-NNNN, migración 160) con un
  -- adulto responsable válido.
  insert into ventas (numero_contrato, cliente, tenant, fecha_salida) values ('DTM-9168', 'Cliente Postcheck 168', 'mayorista', '2026-06-15');
  insert into sillas (bloqueo_id, numero_contrato, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo, 'DTM-9168', 'confirmada', 'CC', '168000001', '1990-01-01');
  insert into contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values ('DTM-9168', 'ADULTO UNO PC168', 'CC', '168000001', '1990-01-01', false, 0);

  -- Segunda silla del mismo contrato, sin documento (responsable inválido).
  insert into sillas (bloqueo_id, numero_contrato, estado) values (v_bloqueo, 'DTM-9168', 'disponible');

  -- Silla ocupada por un MENOR del mismo contrato (responsable <18 inválido).
  insert into sillas (bloqueo_id, numero_contrato, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo, 'DTM-9168', 'confirmada', 'CC', '168000005', '2015-01-01');
  insert into contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values ('DTM-9168', 'MENOR PC168', 'CC', '168000005', '2015-01-01', false, 1);

  -- Adulto CON silla pero SIN fila correspondiente en contrato_pasajeros.
  insert into sillas (bloqueo_id, numero_contrato, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo, 'DTM-9168', 'confirmada', 'CC', '168999999', '1980-01-01');

  -- Silla del MISMO adulto pero en OTRO bloqueo (control_vuelo no debe
  -- poder usarla para autorizar una escritura sobre el bloqueo 1).
  insert into sillas (bloqueo_id, numero_contrato, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo2, 'DTM-9168', 'confirmada', 'CC', '168000001', '1990-01-01');

  -- Contrato minorista referenciado por contrato_manual = '00-0541' — el
  -- caso real que motiva esta migración (MIN-00-0541).
  insert into ventas (numero_contrato, cliente, tenant, fecha_salida) values ('MIN-00-0541', 'Cliente Minorista PC168', 'minorista', '2026-06-15');
  insert into sillas (bloqueo_id, contrato_manual, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo, '00-0541', 'confirmada', 'CC', '168000002', '1985-05-05');
  insert into contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
    values ('MIN-00-0541', 'ADULTO MIN PC168', 'CC', '168000002', '1985-05-05', false, 0);

  -- Referencia AMBIGUA: dos ventas candidatas.
  insert into ventas (numero_contrato, cliente, tenant, fecha_salida) values
    ('DTM-9177', 'Ambiguo A PC168', 'mayorista', '2026-06-15'),
    ('MIN-9177', 'Ambiguo B PC168', 'minorista', '2026-06-15');
  insert into sillas (bloqueo_id, contrato_manual, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo, '9177', 'confirmada', 'CC', '168000003', '1980-01-01');

  -- Referencia EXTERNA sin venta interna.
  insert into sillas (bloqueo_id, contrato_manual, estado, tipo_doc, numero_doc, nacimiento) values
    (v_bloqueo, '00-99999168', 'confirmada', 'CC', '168000004', '1980-01-01');

  select count(*) into v_cnt_sillas_antes from sillas;

  -- ═══ 1) INF de 1 año se guarda SIN silla, documento completo, responsable ═══
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text)::text, true);
  select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000001' and s.bloqueo_id = v_bloqueo;
  select * into v_r from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'BEBE', 'UNO', 'RC', '999168001', '2025-01-01');
  v_infante_id := v_r.id;
  insert into pg_temp.postcheck_168_reporte values ('1-alta',
    '1 año, sin silla, doc completo, responsable: aceptado',
    case when v_infante_id is not null and v_r.numero_contrato = 'DTM-9168' then 'OK' else 'FALLA' end,
    coalesce(v_r.numero_contrato,'null'));

  select count(*) into v_cnt_sillas_despues from sillas;
  insert into pg_temp.postcheck_168_reporte values ('1-alta',
    'crear infante NO crea/modifica sillas (conteo idéntico)',
    case when v_cnt_sillas_despues = v_cnt_sillas_antes then 'OK' else 'FALLA' end, v_cnt_sillas_despues::text);

  insert into pg_temp.postcheck_168_reporte values ('1-alta',
    'infante queda es_infante=true con responsable_id correcto (por documento)',
    case when exists (
      select 1 from contrato_pasajeros cp
       where cp.id = v_infante_id and cp.es_infante = true
         and cp.responsable_id = (select id from contrato_pasajeros where numero_contrato='DTM-9168' and identificacion='168000001')
    ) then 'OK' else 'FALLA' end, '');

  -- ═══ 2) Pasajero de 2 años (o más) al fecha_ida → requiere silla, rechazado ═══
  begin
    select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000001' and s.bloqueo_id = v_bloqueo;
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'NINO', 'DOS', 'RC', '999168002', '2024-06-14');
    v_ok := false;
  exception when others then
    v_ok := true; get stacked diagnostics v_msg = message_text;
  end;
  insert into pg_temp.postcheck_168_reporte values ('2-edad',
    'pasajero de 2 años+ al fecha_ida: rechazado (debe ir con silla, no INF)',
    case when v_ok then 'OK' else 'FALLA' end, coalesce(v_msg,''));

  -- ═══ 3) Caso real: 00-0541 (contrato_manual) → MIN-00-0541 ═══
  select s.id into v_r from sillas s where s.contrato_manual='00-0541' and s.bloqueo_id = v_bloqueo;
  select * into v_r from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'BEBE', 'MIN', 'RC', '999168003', '2025-06-01');
  insert into pg_temp.postcheck_168_reporte values ('3-contrato-manual',
    'contrato_manual=00-0541 resuelve a la venta MIN-00-0541 (caso real)',
    case when v_r.numero_contrato = 'MIN-00-0541' then 'OK' else 'FALLA' end, coalesce(v_r.numero_contrato,'null'));

  -- ═══ 4) control_vuelo: SOLO puede vía silla real de ESE bloqueo (RPC estrecho) ═══
  perform set_config('request.jwt.claims', json_build_object('sub', v_cv::text)::text, true);
  select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000001' and s.bloqueo_id = v_bloqueo;
  select * into v_r from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'BEBE', 'CV', 'RC', '999168004', '2025-03-01');
  insert into pg_temp.postcheck_168_reporte values ('4-control-vuelo',
    'control_vuelo agrega infante vía silla real del bloqueo: aceptado (sin permiso general)',
    case when v_r.id is not null then 'OK' else 'FALLA' end, '');

  begin
    select s.id into v_r from sillas s where s.bloqueo_id = v_bloqueo2 and s.numero_doc='168000001';
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168005', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('4-control-vuelo',
    'control_vuelo NO puede usar silla del adulto en OTRO bloqueo (sin acceso amplio a ventas)',
    case when v_ok then 'OK' else 'FALLA' end, '');

  select s.id into v_r from sillas s where s.contrato_manual='00-0541' and s.bloqueo_id = v_bloqueo;
  select * into v_r from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'BEBE2', 'CV', 'RC', '999168006', '2025-04-01');
  insert into pg_temp.postcheck_168_reporte values ('4-control-vuelo',
    'control_vuelo también funciona sobre contrato_manual (misma silla real, sin depender del tenant)',
    case when v_r.numero_contrato = 'MIN-00-0541' then 'OK' else 'FALLA' end, '');

  -- ═══ 5) Responsable inválido / ambigüedad / referencia externa: fallan SIN escritura parcial ═══
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text)::text, true);

  begin
    select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.estado='disponible' and s.tipo_doc is null;
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168007', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'silla del responsable sin documento: rechazado',
    case when v_ok then 'OK' else 'FALLA' end, '');

  begin
    select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000005';
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168008', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'responsable menor de 18 años: rechazado',
    case when v_ok then 'OK' else 'FALLA' end, '');

  begin
    select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168999999';
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168009', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'silla con documento pero SIN contraparte en contrato_pasajeros: rechazado',
    case when v_ok then 'OK' else 'FALLA' end, '');

  begin
    select s.id into v_r from sillas s where s.contrato_manual='9177';
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168010', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'referencia contrato_manual ambigua (2 ventas candidatas): rechazado, sin adivinar',
    case when v_ok then 'OK' else 'FALLA' end, '');

  begin
    select s.id into v_r from sillas s where s.contrato_manual='00-99999168';
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168011', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'referencia externa sin venta interna: rechazado',
    case when v_ok then 'OK' else 'FALLA' end, '');

  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'ningún rechazo anterior dejó escritura parcial en contrato_pasajeros',
    case when not exists (
      select 1 from contrato_pasajeros where identificacion in
        ('999168002','999168007','999168008','999168009','999168010','999168011')
    ) then 'OK' else 'FALLA' end, '');

  select count(*) into v_cnt_sillas_despues from sillas;
  insert into pg_temp.postcheck_168_reporte values ('5-invalidos',
    'ninguna prueba (éxito o rechazo) hasta aquí alteró el conteo de sillas',
    case when v_cnt_sillas_despues = v_cnt_sillas_antes then 'OK' else 'FALLA' end,
    format('antes=%s despues=%s', v_cnt_sillas_antes, v_cnt_sillas_despues));

  -- ═══ 6) rol venta sin autorización sobre el contrato ajeno: rechazado ═══
  perform set_config('request.jwt.claims', json_build_object('sub', v_venta_ajeno::text)::text, true);
  begin
    select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000001' and s.bloqueo_id = v_bloqueo;
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168012', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('6-autorizacion',
    'rol venta sin _autorizado_escribir_pasajeros sobre el contrato: rechazado (mismo candado que la 167)',
    case when v_ok then 'OK' else 'FALLA' end, '');

  -- ═══ 7) Edición: nunca toca sillas, no duplica fila ═══
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text)::text, true);
  select count(*) into v_cnt_sillas_antes from sillas;
  select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000001' and s.bloqueo_id = v_bloqueo;
  select * into v_r from guardar_infante_vuelo(v_bloqueo, v_r.id, v_infante_id, 'BEBE', 'UNO EDITADO', 'RC', '999168001', '2025-01-02');
  select count(*) into v_cnt_sillas_despues from sillas;
  insert into pg_temp.postcheck_168_reporte values ('7-edicion',
    'editar infante existente: actualiza la fila y NO toca sillas',
    case when v_r.nombre = 'BEBE UNO EDITADO' and v_r.fecha_nacimiento = '2025-01-02'
      and v_cnt_sillas_despues = v_cnt_sillas_antes then 'OK' else 'FALLA' end, '');

  insert into pg_temp.postcheck_168_reporte values ('7-edicion',
    'edición no duplica fila (sigue habiendo exactamente 1 con ese id)',
    case when (select count(*) from contrato_pasajeros where id = v_infante_id) = 1 then 'OK' else 'FALLA' end, '');

  -- ═══ 8) Control negativo: sin sesión (mi_rol() null) → rechazado ═══
  perform set_config('request.jwt.claims', null, true);
  begin
    select s.id into v_r from sillas s where s.numero_contrato='DTM-9168' and s.numero_doc='168000001' and s.bloqueo_id = v_bloqueo;
    perform * from guardar_infante_vuelo(v_bloqueo, v_r.id, null, 'X', 'Y', 'RC', '999168013', '2025-01-01');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  insert into pg_temp.postcheck_168_reporte values ('8-control-negativo',
    'sin sesión (mi_rol() null): rechazado',
    case when v_ok then 'OK' else 'FALLA' end, '');

  raise notice 'postcheck 168: fixtures creados bajo DTM-9168/MIN-00-0541/DTM-9177/MIN-9177 (se revierten con ROLLBACK)';
end $$;

do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.postcheck_168_reporte;
  select count(*) into v_bad from pg_temp.postcheck_168_reporte where estado='FALLA';
  raise notice 'POSTCHECK 168: %/% OK (% FALLA)', v_total - v_bad, v_total, v_bad;
  raise notice 'VEREDICTO POSTCHECK 168: %', (case when v_bad=0 then 'OK' else 'FALLO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_168_reporte order by (estado = 'FALLA') desc, seccion, nombre;

-- Termina SIEMPRE en ROLLBACK — ningún dato de este script queda persistido.
rollback;
