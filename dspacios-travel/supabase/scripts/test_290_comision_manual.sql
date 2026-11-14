-- ───────────────────────────────────────────────────────────────
-- PRUEBAS de la migración 290 (#97): comisión manual en PENDIENTE y segunda comisión del MISMO aliado.
-- SOLO base LOCAL desechable con 001–285 + 287 + 288 (#75) + 286 + 289 + 290. Una transacción que termina en ROLLBACK.
--   psql … -v ciclo=false -f test_290_comision_manual.sql    ·    psql … -v ciclo=true -f test_290_comision_manual.sql
-- La carrera automático/manual (dos sesiones reales) está en test_290_carrera.sh. Cualquier fila distinta de 'OK' es un fallo.
-- ───────────────────────────────────────────────────────────────
begin;
create temp table _r (n serial, caso text, resultado text) on commit drop;
create function pg_temp.como(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is not null then execute 'set local role authenticated'; end if;
  begin execute p_sql; get diagnostics v_n = row_count; v_res := 'filas=' || v_n;
  exception when others then v_res := 'error: ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado) values (p_caso, case when p_obtenido ilike p_esperado then 'OK' else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000290001', 't290-venta@x.test'), ('00000000-0000-0000-0000-000000290002', 't290-admin@x.test'), ('00000000-0000-0000-0000-000000290003', 't290-super@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000290001', 't290-venta@x.test', 'T290 Asesor', 'venta', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000290002', 't290-admin@x.test', 'T290 Admin', 'administracion', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000290003', 't290-super@x.test', 'T290 Super', 'superadmin', true, 'mayorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values
  (290001, 'T290 Agencia Uno', 'agencia', 0.10, '900290001'), (290002, 'T290 Agencia Dos', 'agencia', 0.08, '900290002');

update p97_priv.ciclo set activo = :ciclo;
select pg_temp.chk('0 posición del interruptor', p97_priv.ciclo_activo()::text, :'ciclo');

insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, impuesto, estado, financiero_estado, tipo_asesor, aliado_id, canal, modo_compra, comision_b2b, comision_estado) values
  ('DTM-29001', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'pendiente',  'pendiente', 'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- pendiente PVP con plan
  ('DTM-29002', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'pendiente', 'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- confirmado con comisión automática
  ('DTM-29003', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'completo',  'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- dos aliados legítimos
  ('DTM-29004', 'C', 'mayorista', 'T290 Asesor', 1100000, 200000, 'confirmado', 'pendiente', 'agencia', 290001, 'B2B', 'neta',        100000, 'descontada'), -- NETO (como lo deja crearContrato)
  ('DTM-29005', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'completo',  'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- histórico duplicado
  ('DTM-29006', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'pendiente',  'pendiente', 'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- pendiente → confirmar
  ('DTM-29007', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'completo',  'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- conceptos separados
  ('DTM-29008', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'completo',  'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- acuerdo ordinaria + recobro
  ('DTM-29009', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'completo',  'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- UPDATE que introduce concepto
  ('DTM-29010', 'C', 'mayorista', 'T290 Asesor', 1000000, 200000, 'confirmado', 'completo',  'agencia', 290001, 'B2B', 'comisionable', 80000, 'pendiente');  -- UPDATE: mover de contrato

create function pg_temp.manual(p_uid uuid, p_n text, p_aliado bigint) returns text language sql as $$
  select pg_temp.como(p_uid, format($q$select public.registrar_comision_b2b_manual(%L, %L, %L, 'agencia', %s, 0.10, 0, 0, false, 0)$q$,
         p_n, (select nombre from public.aliados where id = p_aliado), (select nit from public.aliados where id = p_aliado), p_aliado)) $$;
create function pg_temp.manual_con(p_n text, p_aliado bigint, p_pct numeric, p_recobro numeric, p_pct_rec numeric) returns text language sql as $$
  select pg_temp.como('00000000-0000-0000-0000-000000290002', format($q$select public.registrar_comision_b2b_manual(%L, %L, %L, 'agencia', %s, %s, %s, %s, false, 0)$q$,
         p_n, (select nombre from public.aliados where id = p_aliado), (select nit from public.aliados where id = p_aliado), p_aliado, p_pct, p_recobro, p_pct_rec)) $$;
create function pg_temp.reserva(p_n text) returns text language sql as $$
  select pg_temp.como('00000000-0000-0000-0000-000000290001', format('select public.registrar_comision_b2b_reserva(%L, 290001)', p_n)) $$;
create function pg_temp.foto(p_n text) returns text language sql as $$
  select (select count(*) from public.aliados_b2b where numero_contrato = p_n) || '|' ||
         (select count(*) from public.comision_plan c join public.ventas v on v.contrato_uid = c.contrato_uid where v.numero_contrato = p_n) || '|' ||
         (select count(*) from public.comision_b2b_pagos g join public.aliados_b2b b on b.id = g.aliado_b2b_id where b.numero_contrato = p_n) || '|' ||
         (select estado from public.ventas where numero_contrato = p_n) $$;

-- 1) PENDIENTE: el alta manual (interna y del asesor) se rechaza y no cambia nada.
select pg_temp.chk('1a pendiente: la comisión automática queda como plan', pg_temp.reserva('DTM-29001'), 'filas=1');
create temp table _f1 on commit drop as select pg_temp.foto('DTM-29001') as f;
select pg_temp.chk('1b pendiente: alta manual de administración rechazada', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29001', 290001), 'error: COMISION_PENDIENTE:%');
select pg_temp.chk('1c pendiente: alta manual de superadmin rechazada', pg_temp.manual('00000000-0000-0000-0000-000000290003', 'DTM-29001', 290001), 'error: COMISION_PENDIENTE:%');
select pg_temp.chk('1d pendiente: alta manual del asesor rechazada', pg_temp.manual('00000000-0000-0000-0000-000000290001', 'DTM-29001', 290001), 'error: COMISION_PENDIENTE:%');
select pg_temp.chk('1e pendiente: alta manual de OTRO aliado también rechazada (la exigible nace al confirmar)', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29001', 290002), 'error: COMISION_PENDIENTE:%');
select pg_temp.chk('1f pendiente: sin cambios (filas|planes|pagos|estado)', pg_temp.foto('DTM-29001'), (select f from _f1));
select pg_temp.chk('1g pendiente: 0 filas exigibles, 1 plan', pg_temp.foto('DTM-29001'), '0|1|0|pendiente');

-- 2) CONFIRMADO con comisión automática: el alta manual del MISMO aliado se rechaza (cualquier rol).
select pg_temp.chk('2a confirmado: comisión automática registrada', pg_temp.reserva('DTM-29002'), 'filas=1');
select pg_temp.chk('2b confirmado: una fila exigible', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-29002' and not descontada_en_precio), '1');
select pg_temp.chk('2c manual del mismo aliado (administración) rechazada', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29002', 290001), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('2d manual del mismo aliado (superadmin) rechazada', pg_temp.manual('00000000-0000-0000-0000-000000290003', 'DTM-29002', 290001), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('2e inserción DIRECTA (sin RPC) del mismo aliado rechazada por el trigger',
  (select pg_temp.como(null, $q$insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, estado)
                               values ('DTM-29002', 'mayorista', 'T290 Agencia Uno', 'agencia', 290001, 1000000, 800000, 0.1, 'pendiente')$q$)), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('2f sigue UNA sola obligación', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-29002'), '1');
select pg_temp.chk('2g reintento de la RPC automática tampoco duplica', pg_temp.reserva('DTM-29002'), 'error: %ya tiene comisión B2B%');

-- 3) DOS ALIADOS LEGÍTIMOS: cada uno conserva su fila; el mismo aliado no repite (#440).
select pg_temp.chk('3a aliado Uno', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29003', 290001), 'filas=1');
select pg_temp.chk('3b aliado Dos (beneficiario distinto) permitido', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29003', 290002), 'filas=1');
select pg_temp.chk('3c aliado Uno otra vez rechazado', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29003', 290001), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('3d cada aliado con su fila', (select string_agg(aliado_id::text, ',' order by aliado_id) from public.aliados_b2b where numero_contrato = 'DTM-29003'), '290001,290002');

-- 4) NETO: descuento registrado (pagada, descontada), sin plan ni pago adicional; el alta manual sigue rechazada (205).
select pg_temp.chk('4a NETO registra su fila descontada', pg_temp.reserva('DTM-29004'), 'filas=1');
select pg_temp.chk('4b NETO: alta manual rechazada como siempre', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29004', 290002), 'error: %modo neta%');
select pg_temp.chk('4c NETO: 1 fila descontada pagada, sin plan, sin pagos',
  (select count(*) || '|' || bool_and(descontada_en_precio) || '|' || min(estado) from public.aliados_b2b where numero_contrato = 'DTM-29004') || '|' || split_part(pg_temp.foto('DTM-29004'), '|', 2) || '|' || split_part(pg_temp.foto('DTM-29004'), '|', 3), '1|true|pagada|0|0');

-- 5) HISTÓRICO duplicado (anterior a la 290, sembrado sin el trigger): se conserva, admite pagos y ediciones; no se consolida.
alter table public.aliados_b2b disable trigger trg_aliados_b2b_sin_duplicado_aliado;
insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, estado)
  values ('DTM-29005', 'mayorista', 'T290 Agencia Uno', 'agencia', 290001, 1000000, 800000, 0.1, 'pendiente'),
         ('DTM-29005', 'mayorista', 'T290 Agencia Uno', 'agencia', 290001, 1000000, 800000, 0.1, 'pendiente');
alter table public.aliados_b2b enable trigger trg_aliados_b2b_sin_duplicado_aliado;
select pg_temp.chk('5a histórico: el diagnóstico del preflight lo detecta',
  (select count(*)::text from (select 1 from public.aliados_b2b where aliado_id is not null group by numero_contrato, aliado_id having count(*) > 1) d), '1');
select pg_temp.chk('5b histórico: un pago sobre una de sus filas sigue funcionando',
  (select pg_temp.como(null, format($q$insert into public.comision_b2b_pagos (aliado_b2b_id, tenant, valor, fecha) values (%s, 'mayorista', 1000, current_date)$q$,
          (select min(id) from public.aliados_b2b where numero_contrato = 'DTM-29005')))), 'filas=1');
select pg_temp.chk('5c histórico: editar la fila SIN pagos (UPDATE) no lo bloquea el trigger de la 290',
  (select pg_temp.como(null, $q$update public.aliados_b2b set pct_comision = 0.09 where id = (select max(id) from public.aliados_b2b where numero_contrato = 'DTM-29005')$q$)), 'filas=1');
select pg_temp.chk('5d histórico: siguen las dos filas (no se consolidan)', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-29005'), '2');
select pg_temp.chk('5e histórico: una TERCERA del mismo aliado se rechaza', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29005', 290001), 'error: COMISION_DUPLICADA:%');

-- 6) Pendiente con plan → confirmar por el gancho real: UNA obligación; después el alta manual del mismo aliado se rechaza.
select pg_temp.chk('6a pendiente registra su plan', pg_temp.reserva('DTM-29006'), 'filas=1');
update public.ventas set financiero_estado = 'completo' where numero_contrato = 'DTM-29006';
select pg_temp.chk('6b confirmar_venta (gancho de #75)', pg_temp.como('00000000-0000-0000-0000-000000290002', $q$select public.confirmar_venta('DTM-29006')$q$), 'filas=1');
select pg_temp.chk('6c confirmado: una sola fila exigible desde su plan', (select count(*) || '|' || count(plan_id) from public.aliados_b2b where numero_contrato = 'DTM-29006'), '1|1');
select pg_temp.chk('6d después: alta manual del mismo aliado rechazada', pg_temp.manual('00000000-0000-0000-0000-000000290002', 'DTM-29006', 290001), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('6e reintento de materializar: misma fila', (select (public.materializar_comision_b2b('DTM-29006') = (select id from public.aliados_b2b where numero_contrato = 'DTM-29006'))::text), 'true');

-- 7) Línea de recobro SIN ficha (198) en un pendiente: el trigger no la bloquea (la 286 la retira en la conversión).
select pg_temp.chk('7 inserción sin aliado_id no se compara',
  (select pg_temp.como(null, $q$insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, recobro_total, pct_recobro_aliado, estado)
                               values ('DTM-29001', 'mayorista', 'texto libre', 'agencia', 1000000, 1, 50000, 0.5, 'pendiente')$q$)), 'filas=1');

-- 8) «Mismo concepto»: ordinaria y recobro. Separados en filas distintas no duplican; el mismo concepto otra vez, sí; el acuerdo con ambos bloquea ambos.
select pg_temp.chk('8a ordinaria sola del aliado Uno', pg_temp.manual_con('DTM-29007', 290001, 0.10, 0, 0), 'filas=1');
select pg_temp.chk('8b recobro SOLO del mismo aliado (concepto distinto) se admite', pg_temp.manual_con('DTM-29007', 290001, 0, 100000, 0.5), 'filas=1');
select pg_temp.chk('8c otro recobro del mismo aliado se rechaza', pg_temp.manual_con('DTM-29007', 290001, 0, 50000, 0.5), 'error: COMISION_DUPLICADA:%de recobro%');
select pg_temp.chk('8d otra ordinaria del mismo aliado se rechaza', pg_temp.manual_con('DTM-29007', 290001, 0.05, 0, 0), 'error: COMISION_DUPLICADA:%ordinaria%');
select pg_temp.chk('8e fila SIN concepto (% 0 y sin recobro, como MAN14 de la 205) no duplica nada', pg_temp.manual_con('DTM-29007', 290001, 0, 0, 0), 'filas=1');
select pg_temp.chk('8f acuerdo ordinaria + recobro registrado', pg_temp.manual_con('DTM-29008', 290001, 0.10, 100000, 0.5), 'filas=1');
select pg_temp.chk('8g con el acuerdo, una ordinaria adicional se rechaza', pg_temp.manual_con('DTM-29008', 290001, 0.10, 0, 0), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('8h con el acuerdo, un recobro adicional se rechaza', pg_temp.manual_con('DTM-29008', 290001, 0, 100000, 0.5), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('8i el acuerdo queda en UNA fila', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-29008'), '1');

-- 9) UPDATE: se rechaza el cambio que INTRODUCE un concepto que otra fila del mismo aliado ya tiene; lo demás pasa.
create function pg_temp.upd(p_sql text) returns text language sql as $$ select pg_temp.como(null, p_sql) $$;
select pg_temp.chk('9a ordinaria del aliado Uno', pg_temp.manual_con('DTM-29009', 290001, 0.10, 0, 0), 'filas=1');
select pg_temp.chk('9b fila SIN concepto del mismo aliado (permitida)', pg_temp.manual_con('DTM-29009', 290001, 0, 0, 0), 'filas=1');
create temp table _z on commit drop as select max(id) as id from public.aliados_b2b where numero_contrato = 'DTM-29009' and aliado_id = 290001;
select pg_temp.chk('9c editar la fila sin concepto para darle % ordinario → rechazado',
  pg_temp.upd(format('update public.aliados_b2b set pct_comision = 0.10 where id = %s', (select id from _z))), 'error: COMISION_DUPLICADA:%ordinaria%');
select pg_temp.chk('9d … o un valor ordinario fijo → rechazado',
  pg_temp.upd(format('update public.aliados_b2b set comision_valor = 5000 where id = %s', (select id from _z))), 'error: COMISION_DUPLICADA:%');
select pg_temp.chk('9e editarla a SOLO recobro (no se solapa con la ordinaria) → permitido',
  pg_temp.upd(format('update public.aliados_b2b set recobro_total = 50000, pct_recobro_aliado = 0.5 where id = %s', (select id from _z))), 'filas=1');
select pg_temp.chk('9f a esa fila de solo recobro añadirle ordinaria (ya hay otra ordinaria) → rechazado',
  pg_temp.upd(format('update public.aliados_b2b set pct_comision = 0.05 where id = %s', (select id from _z))), 'error: COMISION_DUPLICADA:%ordinaria%');
select pg_temp.chk('9g editar el % de la ordinaria EXISTENTE (no introduce concepto) → permitido',
  pg_temp.upd($q$update public.aliados_b2b set pct_comision = 0.12 where numero_contrato = 'DTM-29009' and aliado_id = 290001 and coalesce(recobro_total, 0) = 0$q$), 'filas=1');
select pg_temp.chk('9h editar retención/estado (columnas fuera del trigger) → permitido',
  pg_temp.upd(format('update public.aliados_b2b set aplica_retencion = true, pct_retencion = 0.11 where id = %s', (select id from _z))), 'filas=1');
select pg_temp.chk('9i reasignar la fila de recobro a OTRO aliado (sin recobro) → permitido',
  pg_temp.upd(format('update public.aliados_b2b set aliado_id = 290002, aliado = %L where id = %s', 'T290 Agencia Dos', (select id from _z))), 'filas=1');
select pg_temp.chk('9j al aliado Dos ya con su recobro, darle ordinaria en esa misma fila (no tiene otra) → permitido',
  pg_temp.upd(format('update public.aliados_b2b set pct_comision = 0.08 where id = %s', (select id from _z))), 'filas=1');
select pg_temp.chk('9k mover la ordinaria de Uno a un contrato donde Uno ya tiene ordinaria → rechazado',
  pg_temp.manual_con('DTM-29010', 290001, 0.10, 0, 0) || ' | ' ||
  pg_temp.upd($q$update public.aliados_b2b set numero_contrato = 'DTM-29010' where numero_contrato = 'DTM-29009' and aliado_id = 290001$q$), 'filas=1 | error: COMISION_DUPLICADA:%');
select pg_temp.chk('9l acreditar (como la 267) un recobro sin ficha al aliado Uno, que solo tiene ordinaria → permitido',
  pg_temp.upd($q$update public.aliados_b2b set aliado_id = 290001 where numero_contrato = 'DTM-29001' and aliado = 'texto libre'$q$), 'filas=1');
select pg_temp.chk('9m histórico duplicado: cambiar su % (concepto ya existente, no nuevo) → permitido',
  pg_temp.upd($q$update public.aliados_b2b set pct_comision = 0.08 where id = (select max(id) from public.aliados_b2b where numero_contrato = 'DTM-29005')$q$), 'filas=1');
select pg_temp.chk('9n histórico duplicado: siguen sus dos filas', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-29005'), '2');

select n, caso, resultado from _r order by n;
select 'FALLAS: ' || count(*) filter (where resultado <> 'OK') || ' de ' || count(*) from _r;
rollback;
