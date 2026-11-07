-- ──────────────────────────────────────────────────────────────────
-- 281 · PRUEBAS DETERMINISTAS EN BASE de soportes de pago y avisos (#86). SOLO base LOCAL desechable (la lanza test_281_soportes.sh).
-- Una sola transacción que termina en ROLLBACK; imprime UNA tabla: control · esperado · observado · estado.
-- Cubre: límite, reemplazo/retiro con historial, reemplazo estando EXCEDIDO (y su anulación real con anular_abono), sustitución forjada,
-- inmutabilidad, destinatarios de avisos (ambigüedad), reclamar ≠ leído, RLS por rol/agencia, privilegios y bucket.
-- Las carreras (dos sesiones) las corre el .sh con commits reales.
-- ──────────────────────────────────────────────────────────────────
begin;
create temp table res (n serial, control text, esperado text, observado text, estado text);
create function pg_temp.chk(c text, esp text, obs text) returns void language plpgsql as $$
begin insert into res (control, esperado, observado, estado) values (c, esp, coalesce(obs, 'NULL'), case when esp = coalesce(obs, 'NULL') then 'OK' else 'FALLA' end); end $$;

-- Ejecuta una sentencia con el rol dado; 'OK' o el SQLSTATE. Todo lo que haga se deshace si falla (subtransacción).
create function pg_temp.try(sentencia text, rol text default 'service_role') returns text language plpgsql as $$
begin
  execute 'set local role ' || rol;
  execute sentencia;
  execute 'reset role';
  return 'OK';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.reg(num text, actor uuid) returns text language plpgsql as $$
begin
  return pg_temp.try(format($q$select public.soporte_registrar(%L, %L, %L, 'comprobante.pdf', 'application/pdf', 1000, %L)$q$,
    num, actor, num || '/' || gen_random_uuid() || '.pdf', repeat('a', 64)));
end $$;

create function pg_temp.vig(num text) returns bigint language sql as $$ select count(*) from public.contrato_soportes_pago where numero_contrato = num and vigente $$;
create function pg_temp.tot(num text) returns bigint language sql as $$ select count(*) from public.contrato_soportes_pago where numero_contrato = num $$;
create function pg_temp.ab(num text) returns bigint language sql as $$ select count(*) from public.abonos where numero_contrato = num $$;
create function pg_temp.forzar() returns text language plpgsql as $$
begin
  set constraints all immediate; set constraints all deferred; return 'OK';
exception when others then return sqlstate;
end $$;
create function pg_temp.visibles(uid uuid, num text) returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.contrato_soportes_pago where numero_contrato = num;
  reset role;
  return n::text;
exception when others then
  reset role; return sqlstate;
end $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000281001','sup@t.test'),('00000000-0000-0000-0000-000000281002','ger@t.test'),('00000000-0000-0000-0000-000000281003','adm@t.test'),
 ('00000000-0000-0000-0000-000000281004','ope@t.test'),('00000000-0000-0000-0000-000000281005','germin@t.test'),('00000000-0000-0000-0000-000000281006','ana@t.test'),
 ('00000000-0000-0000-0000-000000281007','otro@t.test'),('00000000-0000-0000-0000-000000281008','anamin@t.test'),('00000000-0000-0000-0000-000000281009','pd1@t.test'),
 ('00000000-0000-0000-0000-000000281010','pd2@t.test'),('00000000-0000-0000-0000-000000281011','aliado@t.test'),('00000000-0000-0000-0000-000000281012','inactivo@t.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
 ('00000000-0000-0000-0000-000000281001','sup@t.test','Super 281','superadmin',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281002','ger@t.test','Gerente 281','gerencia',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281003','adm@t.test','Admin 281','administracion',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281004','ope@t.test','Operaciones 281','operaciones',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281005','germin@t.test','Gerente Min 281','gerencia',true,'minorista'),
 ('00000000-0000-0000-0000-000000281006','ana@t.test','Ana Venta','venta',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281007','otro@t.test','Otro Venta','venta',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281008','anamin@t.test','Ana Venta','venta',true,'minorista'),
 ('00000000-0000-0000-0000-000000281009','pd1@t.test','Pedro Dup','venta',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281010','pd2@t.test','pedro dup ','venta',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281011','aliado@t.test','Aliado 281','agencia',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281012','inactivo@t.test','Inactivo 281','gerencia',false,'mayorista')
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values
 ('DTM-8101','Cliente 1','mayorista','CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 'Ana Venta'),
 ('MIN-8102','Cliente 2','minorista','CARTAGENA', current_date + 30, 'activo', 1000000, 'COP', 'Ana Venta'),
 ('DTM-8103','Cliente 3','mayorista','CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 'Pedro Dup'),
 ('DTM-8104','Cliente 4','mayorista','CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 'Nadie Existe'),
 ('DTM-8105','Cliente 5','mayorista','CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 'Ana Venta');
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values
 ('DTM-8101',100,'Transferencia','mayorista'),('DTM-8101',100,'Transferencia','mayorista'),('DTM-8101',100,'Transferencia','mayorista'),
 ('MIN-8102',100,'Transferencia','minorista'),
 ('DTM-8103',100,'Transferencia','mayorista'),('DTM-8103',100,'Transferencia','mayorista'),
 ('DTM-8104',100,'Transferencia','mayorista'),
 ('DTM-8105',100,'Transferencia','mayorista');

-- ── 1. Límite = abonos ────────────────────────────────────────────────────
select pg_temp.chk('registrar 1/3', 'OK', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('registrar 2/3', 'OK', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('registrar 3/3', 'OK', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('registrar 4º con 3 abonos → F4515', 'F4515', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('vigentes DTM-8101 = 3', '3', pg_temp.vig('DTM-8101')::text);
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values ('DTM-8199','C','mayorista','X',current_date,'confirmado',1,'COP','z');
select pg_temp.chk('contrato sin abonos no admite soportes', 'F4515', pg_temp.reg('DTM-8199', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('contrato inexistente → F4510', 'F4510', pg_temp.reg('DTM-9999', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('actor inexistente → F4511', 'F4511', pg_temp.reg('DTM-8105', '00000000-0000-0000-0000-000000281099'));
select pg_temp.chk('actor inactivo → F4511', 'F4511', pg_temp.reg('DTM-8105', '00000000-0000-0000-0000-000000281012'));
select pg_temp.chk('registrar en MIN-8102', 'OK', pg_temp.reg('MIN-8102', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('tenant minorista estampado', 'minorista', (select tenant from public.contrato_soportes_pago where numero_contrato = 'MIN-8102'));

-- ── 2. Reemplazo y retiro conservan historial ─────────────────────────────
create temp table ids as select id, row_number() over (order by id) as k from public.contrato_soportes_pago where numero_contrato = 'DTM-8101';
select pg_temp.chk('reemplazar con 3/3', 'OK',
  pg_temp.try(format($q$select public.soporte_reemplazar(%s, '00000000-0000-0000-0000-000000281011', 'DTM-8101/r1.pdf', 'nuevo.pdf', 'application/pdf', 2000, %L)$q$, (select id from ids where k = 1), repeat('b', 64))));
select pg_temp.chk('reemplazo: tras forzar el commit diferido', 'OK', pg_temp.forzar());
select pg_temp.chk('reemplazo mantiene vigentes = 3', '3', pg_temp.vig('DTM-8101')::text);
select pg_temp.chk('reemplazo conserva la fila anterior (4 filas)', '4', pg_temp.tot('DTM-8101')::text);
select pg_temp.chk('fila anterior retirada por reemplazo', 'reemplazo|false',
  (select motivo_retiro || '|' || vigente::text from public.contrato_soportes_pago where id = (select id from ids where k = 1)));
select pg_temp.chk('sucesor apunta a la anterior', '1',
  (select count(*)::text from public.contrato_soportes_pago where reemplaza_id = (select id from ids where k = 1)));
select pg_temp.chk('reemplazar dos veces la misma fila → F4513', 'F4513',
  pg_temp.try(format($q$select public.soporte_reemplazar(%s, '00000000-0000-0000-0000-000000281011', 'DTM-8101/r2.pdf', 'x.pdf', 'application/pdf', 10, %L)$q$, (select id from ids where k = 1), repeat('c', 64))));
select pg_temp.chk('reemplazar soporte inexistente → F4512', 'F4512',
  pg_temp.try($q$select public.soporte_reemplazar(999999, '00000000-0000-0000-0000-000000281011', 'DTM-8101/r3.pdf', 'x.pdf', 'application/pdf', 10, repeat('c', 64))$q$));
select pg_temp.chk('retirar', 'OK', pg_temp.try(format($q$select public.soporte_retirar(%s, '00000000-0000-0000-0000-000000281011', 'ya no aplica')$q$, (select id from ids where k = 2))));
select pg_temp.chk('retirar deja vigentes = 2 y conserva la fila', '2|4', pg_temp.vig('DTM-8101') || '|' || pg_temp.tot('DTM-8101'));
select pg_temp.chk('retirar dos veces → F4513', 'F4513', pg_temp.try(format($q$select public.soporte_retirar(%s, '00000000-0000-0000-0000-000000281011', null)$q$, (select id from ids where k = 2))));
select pg_temp.chk('retiro guarda actor, fecha y nota', 'retiro|ya no aplica|true|true',
  (select motivo_retiro || '|' || nota_retiro || '|' || (retirado_por is not null)::text || '|' || (retirado_en is not null)::text from public.contrato_soportes_pago where id = (select id from ids where k = 2)));
select pg_temp.chk('tras retirar vuelve a caber uno', 'OK', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('y el siguiente ya no', 'F4515', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));

-- ── 3. Sustitución forjada (sin bandera) ──────────────────────────────────
select pg_temp.chk('INSERT con reemplaza_id de fila VIGENTE → F4516', 'F4516',
  pg_temp.try(format($q$insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, reemplaza_id)
    values ('DTM-8101','mayorista','DTM-8101/f1.pdf','f.pdf','application/pdf',1,%L,'00000000-0000-0000-0000-000000281011',%s)$q$, repeat('d', 64), (select id from ids where k = 3)), 'supabase_admin'));
select pg_temp.chk('INSERT con reemplaza_id de fila retirada por RETIRO → F4516', 'F4516',
  pg_temp.try(format($q$insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, reemplaza_id)
    values ('DTM-8101','mayorista','DTM-8101/f2.pdf','f.pdf','application/pdf',1,%L,'00000000-0000-0000-0000-000000281011',%s)$q$, repeat('d', 64), (select id from ids where k = 2)), 'supabase_admin'));
select pg_temp.chk('INSERT con reemplaza_id de OTRO contrato → F4516', 'F4516',
  pg_temp.try(format($q$insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, reemplaza_id)
    values ('DTM-8103','mayorista','DTM-8103/f3.pdf','f.pdf','application/pdf',1,%L,'00000000-0000-0000-0000-000000281011',%s)$q$, repeat('d', 64), (select id from ids where k = 1)), 'supabase_admin'));
select pg_temp.chk('INSERT directo con tenant distinto al del contrato → F4514', 'F4514',
  pg_temp.try(format($q$insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
    values ('DTM-8105','minorista','DTM-8105/f4.pdf','f.pdf','application/pdf',1,%L,'00000000-0000-0000-0000-000000281011')$q$, repeat('d', 64)), 'supabase_admin'));
select pg_temp.chk('INSERT directo sin abonos que lo respalden (límite, aun siendo dueño) → F4515', 'F4515',
  pg_temp.try(format($q$insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
    values ('DTM-8199','mayorista','DTM-8199/f5.pdf','f.pdf','application/pdf',1,%L,'00000000-0000-0000-0000-000000281011')$q$, repeat('d', 64)), 'supabase_admin'));
select pg_temp.chk('retirar por reemplazo SIN sucesor falla al confirmar → F4519', 'F4519',
  pg_temp.try(format($q$update public.contrato_soportes_pago set vigente = false, retirado_en = now(), retirado_por = '00000000-0000-0000-0000-000000281011', motivo_retiro = 'reemplazo' where id = %s;
    set constraints all immediate$q$, (select id from public.contrato_soportes_pago where numero_contrato = 'DTM-8101' and vigente order by id limit 1)), 'supabase_admin'));

-- ── 4. Inmutabilidad ──────────────────────────────────────────────────────
select pg_temp.chk('UPDATE de la ruta → F4517', 'F4517', pg_temp.try($q$update public.contrato_soportes_pago set path = path || 'x' where numero_contrato = 'DTM-8101'$q$, 'supabase_admin'));
select pg_temp.chk('UPDATE del hash → F4517', 'F4517', pg_temp.try($q$update public.contrato_soportes_pago set sha256 = repeat('e', 64) where numero_contrato = 'DTM-8101'$q$, 'supabase_admin'));
select pg_temp.chk('reactivar un retirado → F4517', 'F4517', pg_temp.try(format($q$update public.contrato_soportes_pago set vigente = true, retirado_en = null, retirado_por = null, motivo_retiro = null where id = %s$q$, (select id from ids where k = 2)), 'supabase_admin'));
select pg_temp.chk('cambiar el motivo de un retirado → F4517', 'F4517', pg_temp.try(format($q$update public.contrato_soportes_pago set motivo_retiro = 'reemplazo' where id = %s$q$, (select id from ids where k = 2)), 'supabase_admin'));
select pg_temp.chk('DELETE → F4518', 'F4518', pg_temp.try($q$delete from public.contrato_soportes_pago$q$, 'supabase_admin'));
select pg_temp.chk('TRUNCATE → F4518', 'F4518', pg_temp.try($q$truncate public.contrato_soportes_pago$q$, 'supabase_admin'));

-- ── 5. Privilegios ────────────────────────────────────────────────────────
select pg_temp.chk('authenticated no inserta directo', '42501', pg_temp.try($q$insert into public.contrato_soportes_pago (numero_contrato) values ('x')$q$, 'authenticated'));
select pg_temp.chk('anon no lee soportes', '42501', pg_temp.try($q$select * from public.contrato_soportes_pago$q$, 'anon'));
select pg_temp.chk('service_role no escribe directo', '42501', pg_temp.try($q$delete from public.contrato_soportes_pago$q$, 'service_role'));
select pg_temp.chk('authenticated no ejecuta soporte_registrar', '42501', pg_temp.try($q$select public.soporte_registrar('DTM-8105','00000000-0000-0000-0000-000000281011','DTM-8105/x.pdf','x','application/pdf',1,repeat('a',64))$q$, 'authenticated'));
select pg_temp.chk('anon no ejecuta soporte_reemplazar', '42501', pg_temp.try($q$select public.soporte_reemplazar(1,'00000000-0000-0000-0000-000000281011','x/x.pdf','x','application/pdf',1,repeat('a',64))$q$, 'anon'));
select pg_temp.chk('authenticated no lee avisos', '42501', pg_temp.try($q$select * from public.avisos$q$, 'authenticated'));
select pg_temp.chk('authenticated no reclama avisos', '42501', pg_temp.try($q$select * from public.avisos_reclamar('00000000-0000-0000-0000-000000281002')$q$, 'authenticated'));

-- ── 6. RLS de lectura interna (DTM-8101: asesor «Ana Venta», mayorista) ───
select pg_temp.chk('RLS superadmin ve', '5', pg_temp.visibles('00000000-0000-0000-0000-000000281001', 'DTM-8101'));
select pg_temp.chk('RLS gerencia mayorista ve', '5', pg_temp.visibles('00000000-0000-0000-0000-000000281002', 'DTM-8101'));
select pg_temp.chk('RLS administración mayorista ve', '5', pg_temp.visibles('00000000-0000-0000-0000-000000281003', 'DTM-8101'));
select pg_temp.chk('RLS operaciones mayorista ve', '5', pg_temp.visibles('00000000-0000-0000-0000-000000281004', 'DTM-8101'));
select pg_temp.chk('RLS gerencia MINORISTA no ve', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281005', 'DTM-8101'));
select pg_temp.chk('RLS venta asesor del contrato ve', '5', pg_temp.visibles('00000000-0000-0000-0000-000000281006', 'DTM-8101'));
select pg_temp.chk('RLS venta que NO es el asesor no ve', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281007', 'DTM-8101'));
select pg_temp.chk('RLS venta homónimo de OTRA agencia no ve', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281008', 'DTM-8101'));
select pg_temp.chk('RLS aliado (agencia) no ve por tabla', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281011', 'DTM-8101'));
select pg_temp.chk('RLS usuario inactivo no ve', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281012', 'DTM-8101'));
select pg_temp.chk('RLS venta ve los de su contrato minorista solo en su agencia', '1', pg_temp.visibles('00000000-0000-0000-0000-000000281008', 'MIN-8102'));
select pg_temp.chk('RLS gerencia mayorista no ve el contrato minorista', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281002', 'MIN-8102'));

-- ── 7. Reemplazar y retirar ESTANDO EXCEDIDO (con anulación real) ─────────
-- DTM-8101: 3 abonos y 3 vigentes. Se anula un abono con la RPC real de la 248 (service_role): el contrato queda excedido.
select pg_temp.chk('estado previo: 3 vigentes / 3 abonos', '3|3', pg_temp.vig('DTM-8101') || '|' || pg_temp.ab('DTM-8101'));
select pg_temp.chk('anular_abono (248) no se bloquea por los soportes', 'OK',
  pg_temp.try(format($q$select public.anular_abono(%s, 'DTM-8101', 'mayorista', '00000000-0000-0000-0000-000000281002', 'prueba exceso')$q$, (select min(id) from public.abonos where numero_contrato = 'DTM-8101'))));
select pg_temp.chk('tras anular: 2 abonos, 3 vigentes (excedido, calculado)', '2|3|true', pg_temp.ab('DTM-8101') || '|' || pg_temp.vig('DTM-8101') || '|' || (pg_temp.vig('DTM-8101') > pg_temp.ab('DTM-8101'))::text);
select pg_temp.chk('anular no borró ni retiró soportes', '5', pg_temp.tot('DTM-8101')::text);
select pg_temp.chk('excedido: subir uno nuevo → F4515', 'F4515', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));
create temp table vig_ids as select id, row_number() over (order by id) k from public.contrato_soportes_pago where numero_contrato = 'DTM-8101' and vigente;
select pg_temp.chk('excedido: REEMPLAZAR funciona', 'OK',
  pg_temp.try(format($q$select public.soporte_reemplazar(%s, '00000000-0000-0000-0000-000000281011', 'DTM-8101/ex1.pdf', 'ex.pdf', 'application/pdf', 3000, %L)$q$, (select id from vig_ids where k = 1), repeat('f', 64))));
select pg_temp.chk('excedido: el reemplazo confirma (diferido)', 'OK', pg_temp.forzar());
select pg_temp.chk('excedido: reemplazar mantiene 3 vigentes', '3', pg_temp.vig('DTM-8101')::text);
select pg_temp.chk('excedido: reemplazar conserva el anterior (6 filas)', '6', pg_temp.tot('DTM-8101')::text);
select pg_temp.chk('excedido: RETIRAR funciona', 'OK', pg_temp.try(format($q$select public.soporte_retirar(%s, '00000000-0000-0000-0000-000000281011', 'baja el exceso')$q$, (select id from vig_ids where k = 2))));
select pg_temp.chk('excedido: retirar deja 2 vigentes = 2 abonos', '2', pg_temp.vig('DTM-8101')::text);
select pg_temp.chk('ya sin exceso: subir sigue sin caber (2/2)', 'F4515', pg_temp.reg('DTM-8101', '00000000-0000-0000-0000-000000281011'));

-- ── 8. Avisos: destinatarios inequívocos y sin datos de más ───────────────
create temp table dest as
  select 'DTM-8101'::text c, array_agg(usuario_id order by usuario_id) u from public.f281_destinatarios('DTM-8101', '00000000-0000-0000-0000-000000281011')
  union all select 'MIN-8102', array_agg(usuario_id order by usuario_id) from public.f281_destinatarios('MIN-8102', '00000000-0000-0000-0000-000000281011')
  union all select 'DTM-8103', array_agg(usuario_id order by usuario_id) from public.f281_destinatarios('DTM-8103', '00000000-0000-0000-0000-000000281011')
  union all select 'DTM-8104', array_agg(usuario_id order by usuario_id) from public.f281_destinatarios('DTM-8104', '00000000-0000-0000-0000-000000281011');
select pg_temp.chk('DTM-8101: superadmin+cargos mayorista+asesor único', '281001,281002,281003,281004,281006',
  (select string_agg(right(x::text, 6), ',' order by x) from dest, unnest(u) x where c = 'DTM-8101'));
select pg_temp.chk('MIN-8102: superadmin+gerencia minorista+asesor minorista', '281001,281005,281008',
  (select string_agg(right(x::text, 6), ',' order by x) from dest, unnest(u) x where c = 'MIN-8102'));
select pg_temp.chk('DTM-8103: asesor AMBIGUO (dos «Pedro Dup») → solo cargos', '281001,281002,281003,281004',
  (select string_agg(right(x::text, 6), ',' order by x) from dest, unnest(u) x where c = 'DTM-8103'));
select pg_temp.chk('DTM-8104: asesor sin usuario → solo cargos', '281001,281002,281003,281004',
  (select string_agg(right(x::text, 6), ',' order by x) from dest, unnest(u) x where c = 'DTM-8104'));
select pg_temp.chk('el actor nunca se avisa a sí mismo', '0', (select count(*)::text from public.f281_destinatarios('DTM-8101', '00000000-0000-0000-0000-000000281002') where usuario_id = '00000000-0000-0000-0000-000000281002'));
select pg_temp.chk('inactivo y aliado nunca son destinatarios', '0',
  (select count(*)::text from public.f281_destinatarios('DTM-8101', '00000000-0000-0000-0000-000000281011') where usuario_id in ('00000000-0000-0000-0000-000000281012','00000000-0000-0000-0000-000000281011')));
select pg_temp.chk('los avisos guardan solo tipo y contrato (columnas)', 'archivado_en,creado_en,id,leido_en,notificado_en,numero_contrato,soporte_id,tipo,usuario_id',
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'avisos'));
select pg_temp.chk('las altas de DTM-8101 avisaron a las 5 personas esperadas, ni más ni menos', '5',
  (select count(distinct usuario_id)::text from public.avisos where numero_contrato = 'DTM-8101' and tipo = 'soporte_pago_nuevo' and soporte_id is not null));

-- ── 9. Reclamar ≠ leído ───────────────────────────────────────────────────
create temp table pend as select count(*) n from public.avisos where usuario_id = '00000000-0000-0000-0000-000000281002' and notificado_en is null and leido_en is null;
create temp table rec1 as select * from public.avisos_reclamar('00000000-0000-0000-0000-000000281002', 50);
select pg_temp.chk('reclamar devuelve todos los pendientes', (select n::text from pend), (select count(*)::text from rec1));
select pg_temp.chk('reclamar NO marca leído', '0', (select count(*)::text from public.avisos where usuario_id = '00000000-0000-0000-0000-000000281002' and leido_en is not null));
select pg_temp.chk('reclamar marca notificado', '0', (select count(*)::text from public.avisos where usuario_id = '00000000-0000-0000-0000-000000281002' and notificado_en is null));
select pg_temp.chk('segundo reclamo no repite el mismo evento', '0', (select count(*)::text from public.avisos_reclamar('00000000-0000-0000-0000-000000281002', 50)));
select pg_temp.chk('lo reclamado sigue contando como no leído', (select n::text from pend), (select count(*)::text from public.avisos where usuario_id = '00000000-0000-0000-0000-000000281002' and leido_en is null));
select pg_temp.chk('reclamar solo toca avisos del propio usuario', '0', (select count(*)::text from public.avisos where usuario_id = '00000000-0000-0000-0000-000000281003' and notificado_en is not null));
select pg_temp.chk('marcar leídos devuelve la cantidad', (select n::text from pend), public.avisos_marcar_leidos('00000000-0000-0000-0000-000000281002', null)::text);
select pg_temp.chk('un aviso ya leído no se vuelve a reclamar', '0', (select count(*)::text from public.avisos_reclamar('00000000-0000-0000-0000-000000281002', 50)));
create temp table marcados as select public.avisos_marcar_leidos('00000000-0000-0000-0000-000000281003', null) n;
select pg_temp.chk('marcar leído antes de reclamar: había avisos', 'true', (select (n > 0)::text from marcados));
select pg_temp.chk('marcar leído antes de reclamar evita la notificación posterior', '0', (select count(*)::text from public.avisos_reclamar('00000000-0000-0000-0000-000000281003', 50)));

-- ── 11. Identidad del contrato vs consecutivo reutilizable (eliminar contrato → mismo número) ──
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values
 ('MIN-00-9201','Cliente viejo','minorista','SAN ANDRES', current_date + 30, 'activo', 1000000, 'COP', 'Asesor Viejo');
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('MIN-00-9201', 100, 'Transferencia', 'minorista');
select pg_temp.chk('A: alta de un soporte', 'OK', pg_temp.reg('MIN-00-9201', '00000000-0000-0000-0000-000000281011'));
create temp table viejo as select id from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9201';
create temp table avisos_viejos as select id from public.avisos where numero_contrato = 'MIN-00-9201';
select pg_temp.chk('A: hay avisos para el personal', 'true', (select (count(*) > 0)::text from avisos_viejos));
select pg_temp.chk('el trigger de archivado existe en ventas', '1', (select count(*)::text from pg_trigger where tgrelid = 'public.ventas'::regclass and tgname = 'trg_f281_archivar_evidencia' and not tgisinternal));
-- el contrato desaparece (lo que hace eliminar_contrato: hijas sin cascade y luego la venta)
delete from public.abonos where numero_contrato = 'MIN-00-9201';
delete from public.ventas where numero_contrato = 'MIN-00-9201';
select pg_temp.chk('eliminar A archiva su evidencia (soportes) sin borrarla', '1|1', (select count(*) || '|' || count(archivado_en) from public.contrato_soportes_pago where id in (select id from viejo)));
select pg_temp.chk('eliminar A archiva sus avisos sin borrarlos', (select count(*)::text from avisos_viejos) || '|' || (select count(*)::text from avisos_viejos), (select count(*) || '|' || count(archivado_en) from public.avisos where id in (select id from avisos_viejos)));
-- el consecutivo se reutiliza: B, otro contrato con el MISMO número
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values
 ('MIN-00-9201','Cliente nuevo','minorista','CARTAGENA', current_date + 30, 'activo', 900000, 'COP', 'Asesor Nuevo');
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('MIN-00-9201', 100, 'Transferencia', 'minorista');
select pg_temp.chk('B: la evidencia de A NO cuenta contra su límite (1 abono, cabe 1 soporte)', 'OK', pg_temp.reg('MIN-00-9201', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('B: el segundo ya no cabe (cuenta solo los suyos)', 'F4515', pg_temp.reg('MIN-00-9201', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('la evidencia de A se conserva: 2 filas en total, 1 archivada', '2|1', (select count(*) || '|' || count(archivado_en) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9201'));
select pg_temp.chk('B no puede REEMPLAZAR un soporte archivado de A → F4520', 'F4520',
  pg_temp.try(format($q$select public.soporte_reemplazar(%s, '00000000-0000-0000-0000-000000281011', 'MIN-00-9201/x.pdf', 'x.pdf', 'application/pdf', 10, repeat('9', 64))$q$, (select id from viejo))));
select pg_temp.chk('B no puede RETIRAR un soporte archivado de A → F4520', 'F4520',
  pg_temp.try(format($q$select public.soporte_retirar(%s, '00000000-0000-0000-0000-000000281011', null)$q$, (select id from viejo))));
select pg_temp.chk('lo archivado está congelado: UPDATE → F4520', 'F4520', pg_temp.try(format($q$update public.contrato_soportes_pago set vigente = false, retirado_en = now(), retirado_por = '00000000-0000-0000-0000-000000281011', motivo_retiro = 'retiro' where id = %s$q$, (select id from viejo)), 'supabase_admin'));
select pg_temp.chk('lo archivado no se borra: DELETE → F4518', 'F4518', pg_temp.try(format($q$delete from public.contrato_soportes_pago where id = %s$q$, (select id from viejo)), 'supabase_admin'));
select pg_temp.chk('el UPDATE de archivar no puede cambiar nada más (retirar a la vez) → F4517', 'F4517',
  pg_temp.try(format($q$update public.contrato_soportes_pago set archivado_en = now(), vigente = false, retirado_en = now(), retirado_por = '00000000-0000-0000-0000-000000281011', motivo_retiro = 'retiro' where id = (select min(id) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9201' and archivado_en is null)$q$), 'supabase_admin'));
select pg_temp.chk('los avisos archivados no se reclaman', '0', (select count(*)::text from public.avisos_reclamar('00000000-0000-0000-0000-000000281005', 50) r where r.id in (select id from avisos_viejos)));
select pg_temp.chk('RLS: la gerencia minorista de B ve SOLO el soporte de B', '1', pg_temp.visibles('00000000-0000-0000-0000-000000281005', 'MIN-00-9201'));
select pg_temp.chk('RLS: superadmin conserva el acceso a la evidencia archivada (ve las 2)', '2', pg_temp.visibles('00000000-0000-0000-0000-000000281001', 'MIN-00-9201'));
select pg_temp.chk('un contrato eliminado sin soportes no deja nada que archivar (idempotente)', 'OK',
  pg_temp.try($q$insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values ('MIN-00-9202','C','minorista','X',current_date,'activo',1,'COP','z'); delete from public.ventas where numero_contrato = 'MIN-00-9202'$q$, 'supabase_admin'));

-- ── 12. Renumerar un contrato (fn_renumerar_contrato REAL): el MISMO contrato conserva su evidencia bajo el número nuevo ──
-- Contrato R (minorista, asesor «Ana Venta»): 2 abonos, 3 soportes (S1 reemplazado por S3 → historial; S2 vigente; S3 vigente), avisos para el personal.
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values
 ('MIN-00-9301','Cliente renumerado','minorista','SAN ANDRES', current_date + 30, 'activo', 1000000, 'COP', 'Ana Venta');
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('MIN-00-9301', 100, 'Transferencia', 'minorista'), ('MIN-00-9301', 100, 'Transferencia', 'minorista');
select pg_temp.chk('R: dos altas', 'OK|OK', pg_temp.reg('MIN-00-9301', '00000000-0000-0000-0000-000000281011') || '|' || pg_temp.reg('MIN-00-9301', '00000000-0000-0000-0000-000000281011'));
create temp table rs as select id, row_number() over (order by id) k from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9301';
select pg_temp.chk('R: se reemplaza el primero (queda historial)', 'OK',
  pg_temp.try(format($q$select public.soporte_reemplazar(%s, '00000000-0000-0000-0000-000000281011', 'MIN-00-9301/reemplazo.pdf', 'r.pdf', 'application/pdf', 5, repeat('7', 64))$q$, (select id from rs where k = 1))));
select pg_temp.chk('confirmación diferida (reemplazos con sucesor)', 'OK', pg_temp.forzar());
create temp table antes as select
  (select count(*) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9301') filas,
  (select count(*) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9301' and vigente) vigentes,
  (select md5(string_agg(path, ',' order by id)) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9301') rutas,
  (select count(*) from public.avisos where numero_contrato = 'MIN-00-9301') avisos,
  (select acl_original || '/' || propietario from public.f281_respaldo_funciones where nombre = 'fn_renumerar_contrato') permisos;
select pg_temp.chk('R: estado previo (3 filas, 2 vigentes, avisos)', '3|2|true', (select filas || '|' || vigentes || '|' || (avisos > 0)::text from antes));

-- renumerar con la función REAL, como superadmin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000281001', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000281001","role":"authenticated"}', true);
select pg_temp.chk('R: renumerar con fn_renumerar_contrato (superadmin)', 'OK', pg_temp.try($q$select public.fn_renumerar_contrato('MIN-00-9301', 'MIN-00-9302')$q$, 'authenticated'));
select pg_temp.chk('confirmación diferida (reemplazos con sucesor)', 'OK', pg_temp.forzar());
select pg_temp.chk('R: el contrato existe con el número nuevo y no con el viejo', '1|0',
  (select (select count(*) from public.ventas where numero_contrato = 'MIN-00-9302') || '|' || (select count(*) from public.ventas where numero_contrato = 'MIN-00-9301')));
select pg_temp.chk('R: continuidad — MISMAS filas, vigentes e historial bajo el número NUEVO, ninguna archivada', (select filas || '|' || vigentes || '|0' from antes),
  (select count(*) || '|' || count(*) filter (where vigente) || '|' || count(archivado_en) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9302'));
select pg_temp.chk('R: nada queda bajo el número viejo', '0', (select count(*)::text from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9301'));
select pg_temp.chk('R: las RUTAS FÍSICAS no cambiaron', (select rutas from antes), (select md5(string_agg(path, ',' order by id)) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9302'));
select pg_temp.chk('R: el historial conserva su relación (S1 reemplazado por su sucesor)', '1|reemplazo',
  (select count(*) || '|' || min(motivo_retiro) from public.contrato_soportes_pago s where numero_contrato = 'MIN-00-9302' and not vigente and exists (select 1 from public.contrato_soportes_pago t where t.reemplaza_id = s.id)));
select pg_temp.chk('R: los avisos pasaron al número nuevo (ninguno bajo el viejo)', (select avisos::text from antes) || '|0',
  (select count(*) filter (where numero_contrato = 'MIN-00-9302') || '|' || count(*) filter (where numero_contrato = 'MIN-00-9301') from public.avisos where numero_contrato in ('MIN-00-9301', 'MIN-00-9302')));
select pg_temp.chk('R: los abonos (por FK) y el límite siguen: 2 abonos / 2 vigentes → no caben más', 'F4515', pg_temp.reg('MIN-00-9302', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('R: RLS — la gerencia minorista ve la evidencia COMPLETA bajo el número nuevo', '3', pg_temp.visibles('00000000-0000-0000-0000-000000281005', 'MIN-00-9302'));
select pg_temp.chk('R: RLS — el asesor del contrato (venta) la sigue viendo', '3', pg_temp.visibles('00000000-0000-0000-0000-000000281008', 'MIN-00-9302'));
select pg_temp.chk('R: RLS — nada visible bajo el número viejo', '0', pg_temp.visibles('00000000-0000-0000-0000-000000281005', 'MIN-00-9301'));
select pg_temp.chk('R: reemplazar y retirar siguen funcionando bajo el número nuevo', 'OK|OK',
  pg_temp.try(format($q$select public.soporte_reemplazar(%s, '00000000-0000-0000-0000-000000281011', 'MIN-00-9302/otro.pdf', 'o.pdf', 'application/pdf', 5, repeat('6', 64))$q$, (select id from rs where k = 2)))
  || '|' || pg_temp.try(format($q$select public.soporte_retirar(%s, '00000000-0000-0000-0000-000000281011', 'baja')$q$, (select max(id) from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9302' and vigente))));
select pg_temp.chk('confirmación diferida (reemplazos con sucesor)', 'OK', pg_temp.forzar());

-- el número VIEJO queda libre y lo reutiliza OTRO contrato (otro aliado): B no hereda nada de R
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values
 ('MIN-00-9301','Cliente B (reutiliza el número viejo)','minorista','CARTAGENA', current_date + 30, 'activo', 900000, 'COP', 'Otro Asesor');
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('MIN-00-9301', 100, 'Transferencia', 'minorista');
select pg_temp.chk('B: la evidencia de R NO cuenta contra su límite (1 abono: cabe 1)', 'OK', pg_temp.reg('MIN-00-9301', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('B: el segundo ya no cabe', 'F4515', pg_temp.reg('MIN-00-9301', '00000000-0000-0000-0000-000000281011'));
select pg_temp.chk('B: bajo el número viejo hay SOLO su soporte', '1', pg_temp.visibles('00000000-0000-0000-0000-000000281005', 'MIN-00-9301'));
select pg_temp.chk('B: sus avisos son solo los suyos (ninguno de R)', '1', (select count(distinct soporte_id)::text from public.avisos where numero_contrato = 'MIN-00-9301'));
select pg_temp.chk('R sigue intacto bajo el número nuevo tras la reutilización', '4', (select count(*)::text from public.contrato_soportes_pago where numero_contrato = 'MIN-00-9302'));

-- el traslado NO es accesible ni forjable
select pg_temp.chk('f281_trasladar_evidencia: service_role no puede ejecutarla', '42501', pg_temp.try($q$select public.f281_trasladar_evidencia('MIN-00-9302', 'MIN-00-9399')$q$, 'service_role'));
select pg_temp.chk('f281_trasladar_evidencia: authenticated no puede ejecutarla', '42501', pg_temp.try($q$select public.f281_trasladar_evidencia('MIN-00-9302', 'MIN-00-9399')$q$, 'authenticated'));
select pg_temp.chk('f281_trasladar_evidencia: anon no puede ejecutarla', '42501', pg_temp.try($q$select public.f281_trasladar_evidencia('MIN-00-9302', 'MIN-00-9399')$q$, 'anon'));
select pg_temp.chk('traslado entre contratos NO relacionados (distinto created_at) → F4521 (coherencia)', 'F4521',
  pg_temp.try($q$update public.ventas set created_at = created_at - interval '1 day' where numero_contrato = 'MIN-00-9301'; select public.f281_trasladar_evidencia('MIN-00-9302', 'MIN-00-9301')$q$, 'supabase_admin'));
select pg_temp.chk('cambiar el número con UPDATE directo (sin la marca de la renumeración) → F4517', 'F4517',
  pg_temp.try($q$update public.contrato_soportes_pago set numero_contrato = 'MIN-00-9301' where numero_contrato = 'MIN-00-9302' and archivado_en is null$q$, 'supabase_admin'));
select pg_temp.chk('la marca sola tampoco basta: incoherente (distinto created_at) → F4517', 'F4517',
  pg_temp.try($q$update public.ventas set created_at = created_at - interval '1 day' where numero_contrato = 'MIN-00-9301'; select set_config('app.f281_traslado', 'MIN-00-9302>MIN-00-9301', true); update public.contrato_soportes_pago set numero_contrato = 'MIN-00-9301' where numero_contrato = 'MIN-00-9302' and archivado_en is null$q$, 'supabase_admin'));
select pg_temp.chk('authenticated / service_role no pueden actualizar la tabla (sin escritura directa)', '42501|42501',
  pg_temp.try($q$update public.contrato_soportes_pago set numero_contrato = 'X' where false$q$, 'authenticated') || '|' || pg_temp.try($q$update public.contrato_soportes_pago set numero_contrato = 'X' where false$q$, 'service_role'));

-- permisos y comportamiento previo de fn_renumerar_contrato
select pg_temp.chk('fn_renumerar_contrato: permisos y propietario IDÉNTICOS a los originales', (select permisos from antes),
  (select coalesce(p.proacl::text, '<defecto>') || '/' || p.proowner::regrole::text from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure));
select pg_temp.chk('fn_renumerar_contrato sigue exigiendo rol: un venta no puede renumerar', 'P0001',
  (select pg_temp.try($q$select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000281006', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000281006","role":"authenticated"}', true); select public.fn_renumerar_contrato('MIN-00-9302', 'MIN-00-9398')$q$, 'authenticated')));
select pg_temp.chk('fn_renumerar_contrato sigue negando un número nuevo que ya existe', 'P0001',
  pg_temp.try($q$select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000281001', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000281001","role":"authenticated"}', true); select public.fn_renumerar_contrato('MIN-00-9302', 'MIN-00-9301')$q$, 'authenticated'));

-- ── 10. Bucket ────────────────────────────────────────────────────────────
select pg_temp.chk('bucket privado, 5 MB, pdf/jpeg/png', 'false|5242880|application/pdf,image/jpeg,image/png',
  (select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'soportes-pago'));
select pg_temp.chk('ninguna policy de storage.objects menciona soportes-pago', '0',
  (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%soportes-pago%'));
select pg_temp.chk('las policies del bucket contratos siguen (4)', '4',
  (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'contratos files:%'));

select n, control, esperado, observado, estado from res order by n;
select 'RESUMEN' as control, count(*) filter (where estado = 'OK') || ' OK / ' || count(*) filter (where estado <> 'OK') || ' FALLAS' as resultado from res;
rollback;
