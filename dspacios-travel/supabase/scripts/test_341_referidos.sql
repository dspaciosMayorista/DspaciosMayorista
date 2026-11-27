-- ═══════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #76 (migración 341). Referidos: asignación, código, atribución por contrato, elegibilidad (100 % pagado) y permisos. SOLO base desechable, termina en ROLLBACK.
-- Uso (base con 001-341): se lanza con supabase/scripts/test_341_referidos.sh (que une las fixtures; `psql` corre dentro del contenedor).
-- Esperado calculado A MANO: base = max(0, PVP − impuesto); 1 % y 2 % de esa base; elegible solo con el contrato 100 % pagado (tolerancia 0,5 COP).
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql

create schema t341;
create function t341.rpc(p_sql text) returns text language sql volatile as $$ select t216.escalar('service_role', null, p_sql) $$;
create function t341.j(p_sql text) returns jsonb language sql volatile as $$ select (t216.escalar('service_role', null, p_sql))::jsonb $$;
-- Fila de comisión del aliado (aliados_b2b), con la forma exacta que deja la 205: precio_venta = PVP bruto, base_comision = base guardada, base_explicita = true.
create function t341.fila(p_num text, p_aliado bigint, p_base numeric, p_bruto numeric, p_neto boolean, p_pct numeric default 0.11, p_explicita boolean default true) returns void
language plpgsql as $$
begin
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio)
  select p_num, v.tenant, a.nombre, a.nit, a.tipo, a.id, p_bruto, p_base, p_explicita, p_pct, 0, 0, false, 0, case when p_neto then 'pagada' else 'pendiente' end, p_neto
    from public.ventas v, public.aliados a where v.numero_contrato = p_num and a.id = p_aliado;
end $$;
create function t341.venta(p_num text, p_tenant text, p_precio numeric, p_imp numeric, p_aliado bigint default null, p_b2b uuid default null, p_moneda text default 'COP', p_estado text default 'confirmado', p_comision_estado text default null) returns void
language plpgsql as $$
begin
  insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, b2b_usuario_id, comision_estado, created_at)
  values (p_num, p_tenant, 'bloqueo', p_estado, 'Cliente ' || p_num, 'Asesor T341', p_precio, p_imp, p_moneda, p_aliado, p_b2b, p_comision_estado, clock_timestamp());  -- como en producción: el contrato se crea DESPUÉS de que la asignación quedó vigente
  -- La comisión del aliado nace como en registrar_comision_b2b_reserva (205): base GUARDADA = max(0, PVP − impuesto), explícita. Es la evidencia de la base del referido. NETO y «sin comisión» se arman a mano.
  if p_comision_estado is distinct from 'descontada' and not exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_num) and coalesce(p_aliado, (select u.aliado_id from public.usuarios u where u.id = p_b2b)) is not null then
    perform t341.fila(p_num, coalesce(p_aliado, (select u.aliado_id from public.usuarios u where u.id = p_b2b)), greatest(0, p_precio - p_imp), p_precio, false);
  end if;
end $$;
create function t341.neto(p_num text, p_pvp numeric, p_imp numeric, p_aliado bigint, p_pct numeric default 0.11, p_moneda text default 'COP', p_estado text default 'confirmado') returns numeric
language plpgsql as $$
declare v_base numeric := greatest(0, p_pvp - p_imp); v_com numeric := round(greatest(0, p_pvp - p_imp) * p_pct);
begin
  insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, comision_estado, modo_compra, comision_b2b, created_at)
  values (p_num, 'mayorista', 'bloqueo', p_estado, 'Cliente ' || p_num, 'Asesor T341', p_pvp - v_com, p_imp, p_moneda, p_aliado, 'descontada', 'neta', v_com, clock_timestamp());
  perform t341.fila(p_num, p_aliado, v_base, p_pvp, true, p_pct);
  return v_com;
end $$;
create function t341.abono(p_num text, p_valor numeric) returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, tenant) values (p_num, 'Cliente', current_date, p_valor, 'transferencia', (select tenant from public.ventas where numero_contrato = p_num)) returning id into v;
  return v;
end $$;
create function t341.estado(p_num text, p_actor text default 'super') returns text language sql volatile as $$
  select coalesce((select x.estado || '|' || coalesce(x.comision::text, 'NULL') from public.referidos_contratos(t216.u(p_actor)) x where x.numero_contrato = p_num), 'sin_fila')
$$;
create function t341.atrib(p_num text) returns text language sql stable as $$
  select coalesce((select cr.referidor_id || '|' || cr.pct::text || '|' || cr.origen from public.contrato_referidos cr join public.ventas v on v.contrato_uid = cr.contrato_uid where v.numero_contrato = p_num), 'ninguna')
$$;

-- Fixtures: aliados (agencia, freelance, otro), usuario B2B del aliado 9301, referidores de las dos agencias, códigos.
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9301, 'Agencia T341', '93010', 'agencia', 0.12, false, 0, true), (9302, 'Freelance T341', '93020', 'freelance', 0.11, false, 0, true), (9303, 'Otro T341', '93030', 'agencia', 0.12, false, 0, true);
update public.usuarios set aliado_id = 9301 where id = t216.u('agencia');
select set_config('t341.r1', (t341.j(format('select public.referidor_guardar(%L, null, ''mayorista'', ''Odair Referidor'', ''CC'', ''7001001'', ''odair@x.test'', ''3000000000'', null, true)::text', t216.u('super'))) ->> 'id'), true);

-- A. Permisos: solo superadmin y gerencia gestionan; el resto, no; sin sesión ni authenticated, tampoco.
select t216.afirma('A1 superadmin crea referidor', current_setting('t341.r1') ~ '^[0-9]+$');
select set_config('t341.r2', (t341.j(format('select public.referidor_guardar(%L, null, ''minorista'', ''Gerencia Referidora'', null, null, null, null, null, true)::text', t216.u('gerencia'))) ->> 'id'), true);
select t216.afirma('A2 gerencia crea referidor (también de la otra agencia: alcance de ambas)', current_setting('t341.r2') ~ '^[0-9]+$');
do $$
declare k text; r text;
begin
  foreach k in array array['admin', 'oper', 'ventaA', 'agencia', 'vuelo', 'inactivo'] loop
    r := t216.escalar('service_role', null, format('select public.referidor_guardar(%L, null, ''mayorista'', ''No Debe Crear'', null, null, null, null, null, true)::text', t216.u(k)));
    perform t216.afirma('A3 ' || k || ' NO crea referidor', r like 'ERR F4701%', r);
    r := t216.escalar('service_role', null, format('select public.referido_asignar(%L, 9301, %s, 0.01, null)::text', t216.u(k), current_setting('t341.r1')));
    perform t216.afirma('A4 ' || k || ' NO asigna referidor', r like 'ERR F4701%', r);
  end loop;
end $$;
select t216.rechaza('A5 anon no ejecuta', t216.escalar('anon', null, format('select public.referidor_guardar(%L, null, ''mayorista'', ''Anon Nombre'', null, null, null, null, null, true)::text', t216.u('super'))), 'permission denied');
select t216.rechaza('A6 authenticated no ejecuta', t216.escalar('authenticated', t216.u('super'), format('select public.referidor_guardar(%L, null, ''mayorista'', ''Auth Nombre'', null, null, null, null, null, true)::text', t216.u('super'))), 'permission denied');
select t216.rechaza('A7 authenticated no lee las tablas', t216.escalar('authenticated', t216.u('super'), 'select count(*)::text from public.aliado_referidores'), 'permission denied');
select t216.rechaza('A8 anon no lee las tablas', t216.escalar('anon', null, 'select count(*)::text from public.contrato_referidos'), 'permission denied');
select t216.rechaza('A9 documento duplicado en la misma agencia', t341.rpc(format('select public.referidor_guardar(%L, null, ''mayorista'', ''Otro Nombre'', ''CC'', ''7001001'', null, null, null, true)::text', t216.u('super'))), 'F4703');
select t216.rechaza('A10 datos inválidos (nombre corto)', t341.rpc(format('select public.referidor_guardar(%L, null, ''mayorista'', ''ab'', null, null, null, null, null, true)::text', t216.u('super'))), 'F4708');
select t216.rechaza('A11 un referidor no cambia de agencia', t341.rpc(format('select public.referidor_guardar(%L, %s, ''minorista'', ''Odair Referidor'', ''CC'', ''7001001'', null, null, null, true)::text', t216.u('super'), current_setting('t341.r1'))), 'F4702');

-- B. Códigos = reglas guardadas.
select t216.afirma('B1 código se guarda en mayúsculas con su porcentaje', (t341.j(format('select public.referidor_codigo_definir(%L, %s, ''odair-2'', 0.02, true)::text', t216.u('super'), current_setting('t341.r1'))) ->> 'codigo') = 'ODAIR-2');
select t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-1'', 0.01, true)::text', t216.u('gerencia'), current_setting('t341.r1')));
select t216.rechaza('B2 porcentaje solo 1 % o 2 % (3 %)', t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-3'', 0.03, true)::text', t216.u('super'), current_setting('t341.r1'))), 'F4704');
select t216.rechaza('B3 porcentaje solo 1 % o 2 % (1,5 %)', t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-4'', 0.015, true)::text', t216.u('super'), current_setting('t341.r1'))), 'F4704');
select t216.rechaza('B4 formato de código', t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''a b'', 0.01, true)::text', t216.u('super'), current_setting('t341.r1'))), 'F4709');
select t216.rechaza('B5 código ya usado por OTRO referidor', t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-1'', 0.02, true)::text', t216.u('super'), current_setting('t341.r2'))), 'F4710');
select t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''GER-1'', 0.02, true)::text', t216.u('super'), current_setting('t341.r2')));

-- C. Asignación manual: agencia (1 %) y freelance (2 %); idempotencia; cambio con historial.
select t216.afirma('C1 asigna 1 % a la AGENCIA 9301', (t341.j(format('select public.referido_asignar(%L, 9301, %s, 0.01, ''alta'')::text', t216.u('super'), current_setting('t341.r1'))) ->> 'estado') = 'asignada');
select t216.afirma('C2 asigna 2 % al FREELANCE 9302', (t341.j(format('select public.referido_asignar(%L, 9302, %s, 0.02, null)::text', t216.u('gerencia'), current_setting('t341.r1'))) ->> 'estado') = 'asignada');
select t216.afirma('C3 repetir lo mismo no cambia nada (sin_cambio)', (t341.j(format('select public.referido_asignar(%L, 9301, %s, 0.01, null)::text', t216.u('super'), current_setting('t341.r1'))) ->> 'estado') = 'sin_cambio'
  and (select count(*) from public.aliado_referidores where aliado_id = 9301) = 1);
select t216.rechaza('C4 porcentaje 3 % rechazado', t341.rpc(format('select public.referido_asignar(%L, 9303, %s, 0.03, null)::text', t216.u('super'), current_setting('t341.r1'))), 'F4704');
select t216.rechaza('C5 aliado inexistente', t341.rpc(format('select public.referido_asignar(%L, 999999, %s, 0.01, null)::text', t216.u('super'), current_setting('t341.r1'))), 'F4706');
select t216.rechaza('C6 referidor inexistente', t341.rpc(format('select public.referido_asignar(%L, 9303, 999999, 0.01, null)::text', t216.u('super'))), 'F4705');

-- D. Atribución al crear el contrato (foto): por id del aliado y por el usuario B2B del aliado; agencia y freelance; ambos porcentajes.
select t341.venta('DTM-9301', 'mayorista', 1000000, 200000, 9301);          -- agencia, 1 %  → base 800.000 → 8.000
select t341.venta('DTM-9302', 'mayorista', 3000000, 0, 9302);               -- freelance, 2 % → base 3.000.000 → 60.000
select t341.venta('DTM-9303', 'mayorista', 500000, 50000, null, t216.u('agencia'));   -- solo usuario B2B del aliado 9301 (id estable) → 1 %
select t341.venta('DTM-9304', 'mayorista', 700000, 0, 9303);                -- aliado SIN asignación → ninguna
select t341.venta('MIN-00-9305', 'minorista', 700000, 0, 9301);             -- agencia distinta: la asignación es de mayorista → ninguna
select t341.venta('DTM-9306', 'mayorista', 700000, 0, null);                -- sin aliado (venta interna) → ninguna
select t216.afirma('D1 agencia: foto con referidor, 1 % y origen manual', t341.atrib('DTM-9301') = current_setting('t341.r1') || '|0.0100|manual', t341.atrib('DTM-9301'));
select t216.afirma('D2 freelance: 2 %', t341.atrib('DTM-9302') = current_setting('t341.r1') || '|0.0200|manual', t341.atrib('DTM-9302'));
select t216.afirma('D3 solo con el usuario B2B del aliado (id estable): atribuida con el 1 % del aliado', t341.atrib('DTM-9303') = current_setting('t341.r1') || '|0.0100|manual', t341.atrib('DTM-9303'));
select t216.afirma('D4 aliado sin asignación, otra agencia y venta sin aliado: sin atribución', t341.atrib('DTM-9304') = 'ninguna' and t341.atrib('MIN-00-9305') = 'ninguna' and t341.atrib('DTM-9306') = 'ninguna');
select t216.afirma('D5 el contrato conserva su identidad (contrato_uid) y no se inventa nada para ventas históricas', (select count(*) from public.contrato_referidos) = 3);

-- E. Cambios futuros: no tocan lo atribuido; el nuevo contrato toma lo nuevo; quitar corta lo futuro.
select set_config('t341.r3', (t341.j(format('select public.referidor_guardar(%L, null, ''mayorista'', ''Segundo Referidor'', null, null, null, null, null, true)::text', t216.u('gerencia'))) ->> 'id'), true);
select set_config('t341.e1', t341.rpc(format('select public.referido_asignar(%L, 9301, %s, 0.02, ''cambio'')::text', t216.u('gerencia'), current_setting('t341.r3'))), true);
select t216.afirma('E1 cambio de referidor y de porcentaje (2 %) dentro de mayorista: cierra la vigente y abre otra', current_setting('t341.e1')::jsonb ->> 'estado' = 'cambiada', current_setting('t341.e1'));
select t216.afirma('E2 historial íntegro: 2 filas del aliado en mayorista, una vigente y la cerrada con fecha', (select count(*) = 2 and count(*) filter (where vigente_hasta is null) = 1 and count(*) filter (where vigente_hasta is not null) = 1 from public.aliado_referidores where aliado_id = 9301 and tenant = 'mayorista'));
select t216.afirma('E3 contratos ya atribuidos NO cambian (siguen con r1 y 1 %)', t341.atrib('DTM-9301') = current_setting('t341.r1') || '|0.0100|manual' and t341.atrib('DTM-9303') = current_setting('t341.r1') || '|0.0100|manual');
select t341.rpc(format('select public.referidor_guardar(%L, %s, ''minorista'', ''Gerencia Referidora'', null, null, null, null, null, true)::text', t216.u('super'), current_setting('t341.r2')));
select set_config('t341.e4', t341.rpc(format('select public.referido_asignar(%L, 9301, %s, 0.02, null)::text', t216.u('super'), current_setting('t341.r2'))), true);
select t216.afirma('E4 un referidor de minorista es una asignación aparte (por agencia), no cambia la de mayorista', current_setting('t341.e4')::jsonb ->> 'estado' = 'asignada' and (select count(*) from public.aliado_referidores where aliado_id = 9301 and vigente_hasta is null) = 2);
select t341.venta('MIN-00-9307', 'minorista', 800000, 0, 9301);
select t341.venta('DTM-9308', 'mayorista', 800000, 0, 9301);
select t216.afirma('E5 contrato NUEVO de minorista toma r2 (2 %) y el NUEVO de mayorista toma r3 (2 %); el anterior conserva r1 (1 %)', t341.atrib('MIN-00-9307') = current_setting('t341.r2') || '|0.0200|manual' and t341.atrib('DTM-9308') = current_setting('t341.r3') || '|0.0200|manual' and t341.atrib('DTM-9301') = current_setting('t341.r1') || '|0.0100|manual', t341.atrib('MIN-00-9307') || ' / ' || t341.atrib('DTM-9308'));
select set_config('t341.e6', t341.rpc(format('select public.referido_quitar(%L, 9302, ''mayorista'', ''fin de acuerdo'')::text', t216.u('super'))), true);
select t216.afirma('E6 quitar la asignación corta lo futuro y conserva lo atribuido', current_setting('t341.e6')::jsonb ->> 'estado' = 'quitada'
  and (select count(*) from public.aliado_referidores where aliado_id = 9302 and vigente_hasta is not null) = 1 and t341.atrib('DTM-9302') = current_setting('t341.r1') || '|0.0200|manual', current_setting('t341.e6'));
select t341.venta('DTM-9309', 'mayorista', 900000, 0, 9302);
select t216.afirma('E7 compra posterior a quitar: sin atribución', t341.atrib('DTM-9309') = 'ninguna');
select t216.afirma('E8 quitar dos veces es idempotente', (t341.j(format('select public.referido_quitar(%L, 9302, ''mayorista'', null)::text', t216.u('super'))) ->> 'estado') = 'sin_asignacion');

-- F. Sin backfill ni atribución retroactiva por actualizar el vínculo después.
select t341.venta('DTM-9310', 'mayorista', 800000, 0, null);
select t216.afirma('F1 contrato creado SIN aliado: sin atribución', t341.atrib('DTM-9310') = 'ninguna');
update public.ventas set aliado_id = 9301 where numero_contrato = 'DTM-9310';
select t216.afirma('F2 al enlazar el aliado después, entra con lo vigente CUANDO se creó el contrato (determinista, no retroactivo)', t341.atrib('DTM-9310') = current_setting('t341.r3') || '|0.0200|manual', t341.atrib('DTM-9310'));
select t341.venta('DTM-9311', 'mayorista', 800000, 0, null);
set local session_replication_role = replica; update public.ventas set created_at = created_at - interval '2 days' where numero_contrato = 'DTM-9311'; set local session_replication_role = origin;
update public.ventas set aliado_id = 9301 where numero_contrato = 'DTM-9311';
select t216.afirma('F3 contrato ANTERIOR a la asignación: nunca se atribuye retroactivamente aunque se enlace hoy', t341.atrib('DTM-9311') = 'ninguna', t341.atrib('DTM-9311'));

-- G. Renumerar conserva la atribución y NO crea una nueva; eliminar la borra; un fallo de atribución nunca bloquea el contrato.
select set_config('t341.g1', t216.escalar('authenticated', t216.u('super'), 'select public.fn_renumerar_contrato(''DTM-9301'', ''DTM-9391'')::text'), true);
select t216.afirma('G1 renumerar (función real) no falla', current_setting('t341.g1') not like 'ERR%', current_setting('t341.g1'));
select t216.afirma('G2 …la atribución sigue bajo el número nuevo, con la misma foto, y el número viejo ya no existe', t341.atrib('DTM-9391') = current_setting('t341.r1') || '|0.0100|manual' and t341.atrib('DTM-9301') = 'ninguna' and not exists (select 1 from public.ventas where numero_contrato = 'DTM-9301'), t341.atrib('DTM-9391'));
select t341.venta('DTM-9312', 'mayorista', 800000, 0, 9303);
select t216.escalar('authenticated', t216.u('super'), 'select public.fn_renumerar_contrato(''DTM-9312'', ''DTM-9392'')::text');
select t341.rpc(format('select public.referido_asignar(%L, 9303, %s, 0.01, null)::text', t216.u('super'), current_setting('t341.r1')));
select t216.escalar('authenticated', t216.u('super'), 'select public.fn_renumerar_contrato(''DTM-9392'', ''DTM-9393'')::text');
select t216.afirma('G3 renumerar un contrato SIN atribución cuando ya hay asignación vigente NO le inventa una (la copia no es una compra nueva)', t341.atrib('DTM-9393') = 'ninguna', t341.atrib('DTM-9393'));
-- La comisión del aliado (evidencia de la base) viaja con el contrato renumerado: el referido sigue calculándose sobre la MISMA base guardada.
select t216.afirma('G3b renumerar conserva la evidencia de la base: sigue «pendiente_pago» sobre la base guardada (800.000 al 1 % = 8.000), no «sin_evidencia_base»', t341.estado('DTM-9391') = 'pendiente_pago|8000.00', t341.estado('DTM-9391'));
delete from public.aliados_b2b where numero_contrato = 'DTM-9391';   -- el FK de la comisión del aliado impide borrar el contrato suelto (se va con él)
delete from public.ventas where numero_contrato = 'DTM-9391';
select t216.afirma('G4 al eliminar el contrato su atribución se va con él', (select count(*) from public.contrato_referidos cr where cr.contrato_uid not in (select contrato_uid from public.ventas)) = 0);
alter table public.contrato_referidos add constraint zz_fallo_forzado check (false) not valid;
select t341.venta('DTM-9313', 'mayorista', 800000, 0, 9301);
select t216.afirma('G5 si la atribución FALLA, el contrato igual se crea (la atribución es secundaria)', exists (select 1 from public.ventas where numero_contrato = 'DTM-9313') and t341.atrib('DTM-9313') = 'ninguna');
alter table public.contrato_referidos drop constraint zz_fallo_forzado;

-- H. Elegibilidad: base = PVP − impuesto; pagable SOLO con el contrato 100 % pagado; el abono anulado la revierte.
-- DTM-9303: PVP 500.000, impuesto 50.000 → base 450.000 → 1 % = 4.500. DTM-9302: PVP 3.000.000 → 2 % = 60.000.
select t216.afirma('H1 sin abonos: pendiente_pago y la comisión calculada sobre la base (4.500)', t341.estado('DTM-9303') = 'pendiente_pago|4500.00', t341.estado('DTM-9303'));
select set_config('t341.ab1', t341.abono('DTM-9303', 200000)::text, true);
select t216.afirma('H2 abono PARCIAL (200.000 de 500.000): sigue pendiente_pago', t341.estado('DTM-9303') = 'pendiente_pago|4500.00', t341.estado('DTM-9303'));
select set_config('t341.ab2', t341.abono('DTM-9303', 300000)::text, true);
select t216.afirma('H3 100 % pagado: elegible (misma cifra)', t341.estado('DTM-9303') = 'elegible|4500.00', t341.estado('DTM-9303'));
select t216.afirma('H4 el referido (agencia 1 %) y el freelance (2 %) se distinguen por su porcentaje: 3.000.000 → 60.000', t341.estado('DTM-9302') = 'pendiente_pago|60000.00', t341.estado('DTM-9302'));
select t341.abono('DTM-9302', 2999999.60);
select t216.afirma('H5 la tolerancia de redondeo del criterio existente (0,5 COP) cuenta como pagado', t341.estado('DTM-9302') = 'elegible|60000.00', t341.estado('DTM-9302'));
-- Reversa REAL de un pago (anular_abono, 248): el contrato deja de ser elegible.
select set_config('t341.h6', t216.escalar('service_role', null, format('select (public.anular_abono(%s, ''DTM-9303'', ''mayorista'', %L, ''prueba de reversa'')->>''estado'')', current_setting('t341.ab2'), t216.u('super'))), true);
select t216.afirma('H6a la reversa real (anular_abono) se ejecuta sin error', current_setting('t341.h6') not like 'ERR%', current_setting('t341.h6'));
select t216.afirma('H6b …el abono salió de abonos y el contrato vuelve a pendiente_pago', not exists (select 1 from public.abonos where id = current_setting('t341.ab2')::bigint) and t341.estado('DTM-9303') = 'pendiente_pago|4500.00', t341.estado('DTM-9303'));
select t216.afirma('H7 recuperado el pago completo vuelve a ser elegible', (select t341.abono('DTM-9303', 300000) is not null) and t341.estado('DTM-9303') = 'elegible|4500.00', t341.estado('DTM-9303'));
select t341.venta('DTM-9314', 'mayorista', 1000000, 0, 9303, null, 'USD');
select t216.afirma('H8 contrato en USD: la comisión queda en USD (1 % de 1.000.000 = 10.000) y la moneda viaja', (select moneda || '|' || comision::text from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9314') = 'USD|10000.00', (select moneda || '|' || comision::text from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9314'));
select t341.venta('DTM-9315', 'mayorista', 1000000, 0, 9303, null, 'COP', 'cancelado');
select t341.neto('DTM-9316', 1000000, 0, 9303);   -- PVP original 1.000.000, ally 11 % → comisión 110.000, precio_venta (NETO) 890.000
select t341.venta('DTM-9317', 'mayorista', 100000, 100000, 9303);
select t216.afirma('H9 contrato cancelado: cancelado, comisión 0', t341.estado('DTM-9315') = 'cancelado|0', t341.estado('DTM-9315'));
select t216.afirma('H10 contrato NETO: se calcula sobre la base ORIGINAL guardada (1.000.000 al 1 % = 10.000), NO sobre lo cobrado (890.000) ni sobre la comisión del aliado (110.000)', t341.estado('DTM-9316') = 'pendiente_pago|10000.00', t341.estado('DTM-9316'));
select t216.afirma('H11 base 0: sin_base', t341.estado('DTM-9317') = 'sin_base|0', t341.estado('DTM-9317'));
-- Un contrato cancelado NUNCA es elegible aunque esté pagado completo.
select t341.abono('DTM-9315', 1000000);
select t216.afirma('H12 cancelado y pagado: sigue cancelado', t341.estado('DTM-9315') = 'cancelado|0', t341.estado('DTM-9315'));

-- I. La participación del referidor NO es la comisión del aliado: ninguna fila de aliados_b2b ni cambios en ella.
select set_config('t341.i_n', (select count(*) from public.aliados_b2b)::text, true);
create temp table t341_antes as select to_jsonb(a) as fila from public.aliados_b2b a;
select t341.rpc(format('select public.referido_quitar(%L, 9301, ''mayorista'', null)::text', t216.u('super')));
select t341.rpc(format('select public.referido_asignar(%L, 9301, %s, 0.02, null)::text', t216.u('super'), current_setting('t341.r1')));
select t216.afirma('I1 ninguna operación de referidos toca aliados_b2b (ni filas nuevas ni cambios en ninguna de las filas, que son la evidencia de la base)', (select count(*) from public.aliados_b2b) = current_setting('t341.i_n')::int and (select jsonb_agg(fila order by fila ->> 'id') from t341_antes) = (select jsonb_agg(to_jsonb(a) order by a.id::text) from public.aliados_b2b a));

-- J. Listado y catálogo: alcance por rol y agencia, filtros, paginación.
select t216.afirma('J1 superadmin y gerencia ven contratos de ambas agencias', (select count(*) from public.referidos_contratos(t216.u('super')) where tenant = 'minorista') >= 1 and (select count(*) from public.referidos_contratos(t216.u('gerencia')) where tenant = 'minorista') >= 1);
select t216.afirma('J2 administración (mayorista) ve SOLO mayorista', (select count(*) from public.referidos_contratos(t216.u('admin'))) >= 1 and (select count(*) from public.referidos_contratos(t216.u('admin')) where tenant <> 'mayorista') = 0);
select t216.afirma('J3 administración de minorista ve solo minorista', (select count(*) from public.referidos_contratos(t216.u('adminMin'))) >= 1 and (select count(*) from public.referidos_contratos(t216.u('adminMin')) where tenant <> 'minorista') = 0);
do $$
declare k text; r text;
begin
  foreach k in array array['oper', 'ventaA', 'agencia', 'vuelo', 'inactivo'] loop
    r := t216.escalar('service_role', null, format('select count(*)::text from public.referidos_contratos(%L)', t216.u(k)));
    perform t216.afirma('J4 ' || k || ' NO ve contratos de referidos', r like 'ERR F4701%', r);
    r := t216.escalar('service_role', null, format('select public.referidos_catalogo(%L)::text', t216.u(k)));
    perform t216.afirma('J5 ' || k || ' NO ve el catálogo', r like 'ERR F4701%', r);
  end loop;
end $$;
select t216.afirma('J6 filtro por estado y por referidor', (select count(*) from public.referidos_contratos(t216.u('super'), null, null, 'elegible') where estado <> 'elegible') = 0
  and (select count(*) from public.referidos_contratos(t216.u('super'), current_setting('t341.r2')::bigint) where referidor_id <> current_setting('t341.r2')::bigint) = 0);
select t216.afirma('J7 paginación: límite 2 devuelve 2 filas y hay_mas', (select count(*) from public.referidos_contratos(t216.u('super'), null, null, null, 2)) = 2 and (select bool_and(hay_mas) from public.referidos_contratos(t216.u('super'), null, null, null, 2)));
select t216.afirma('J8 catálogo: referidores con códigos y asignaciones vigentes', (select jsonb_array_length(public.referidos_catalogo(t216.u('super')) -> 'referidores')) = 3
  and (select jsonb_array_length(public.referidos_catalogo(t216.u('admin')) -> 'referidores')) = 2, (public.referidos_catalogo(t216.u('admin')) -> 'referidores')::text);

-- K. Código como ruta adicional: identidad y tarifa SALEN de la regla guardada.
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values (9304, 'Nuevo por codigo', '93040', 'freelance', 0.11, false, 0, true), (9305, 'Segundo por codigo', '93050', 'agencia', 0.12, false, 0, true);
select set_config('t341.k1', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9304, ''odair-2'')::text', t216.u('gerencia'))), true);
select t216.afirma('K1 gerencia aplica un código a un aliado SIN referidor: toma el referidor y el 2 % guardados', current_setting('t341.k1')::jsonb ->> 'estado' = 'asignada'
  and (select pct || '|' || origen || '|' || codigo from public.aliado_referidores where aliado_id = 9304 and vigente_hasta is null) = '0.0200|codigo|ODAIR-2', current_setting('t341.k1'));
select t216.rechaza('K2 administración NO aplica códigos (decisión del dueño: consulta, no asigna ni cambia)', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9304, ''ODAIR-1'')::text', t216.u('admin'))), 'F4701');
select t216.afirma('K2b y la asignación vigente quedó intacta (2 %)', (select pct from public.aliado_referidores where aliado_id = 9304 and vigente_hasta is null) = 0.0200);
select set_config('t341.k3', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9304, ''odair-1'')::text', t216.u('super'))), true);
select t216.afirma('K3 superadmin SÍ cambia por código (cambiada, 1 %)', current_setting('t341.k3')::jsonb ->> 'estado' = 'cambiada' and (select pct from public.aliado_referidores where aliado_id = 9304 and tenant = 'mayorista' and vigente_hasta is null) = 0.0100, current_setting('t341.k3'));
select t216.rechaza('K4 código desconocido: mensaje único', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9305, ''NOEXISTE'')::text', t216.u('gerencia'))), 'F4707');
select t341.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-OFF'', 0.01, false)::text', t216.u('super'), current_setting('t341.r1')));
select t216.rechaza('K5 código inactivo: el mismo mensaje (no se puede sondear qué códigos existen)', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9305, ''ODAIR-OFF'')::text', t216.u('gerencia'))), 'F4707');
select t216.rechaza('K6 administración de MINORISTA tampoco aplica códigos (ni el de su propia agencia)', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9305, ''GER-1'')::text', t216.u('adminMin'))), 'F4701');
select t216.rechaza('K7 roles sin permiso no aplican códigos', t341.rpc(format('select public.referido_aplicar_codigo(%L, 9305, ''ODAIR-1'')::text', t216.u('ventaA'))), 'F4701');
select t341.venta('DTM-9320', 'mayorista', 1000000, 0, 9304);
select t216.afirma('K8 el contrato posterior hereda origen código y el 1 % vigente', t341.atrib('DTM-9320') = current_setting('t341.r1') || '|0.0100|codigo', t341.atrib('DTM-9320'));

-- M. #76 (decisión del dueño, 2026-11-25): el referido usa EXACTAMENTE la base con la que se calculó la comisión del aliado. En NETO, la base ORIGINAL guardada (antes de descontar la comisión),
--    no lo cobrado en NETO ni el monto de la comisión del aliado. Sin evidencia: se dice, no se adivina ni se muestra un cero calculado. Elegible = contrato 100 % pagado (sobre lo que el comprador debe pagar).
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9406, 'Ordinario M', '94060', 'freelance', 0.11, false, 0, true), (9407, 'Neto M', '94070', 'freelance', 0.11, false, 0, true), (9408, 'Sin evidencia M', '94080', 'freelance', 0.11, false, 0, true), (9409, 'Otro aliado M', '94090', 'agencia', 0.12, false, 0, true);
select t341.rpc(format('select public.referido_asignar(%L, %s, %s, 0.02, ''M'')::text', t216.u('super'), a, current_setting('t341.r1'))) from unnest(array[9406, 9407, 9408]) a;
-- Mismo producto, misma base: PVP original 3.000.000, impuesto 400.000, aliado 11 %.
select t341.venta('DTM-9401', 'mayorista', 3000000, 400000, 9406);                    -- ordinario: precio_venta 3.000.000, base guardada 2.600.000
select set_config('t341.com_neto', t341.neto('DTM-9402', 3000000, 400000, 9407)::text, true);   -- NETO: comisión 286.000 descontada → precio_venta 2.714.000; la fila guarda precio 3.000.000 y base 2.600.000
select t216.afirma('M0 fixtures: NETO cobra 2.714.000 (PVP − comisión 286.000) y guarda la base original 2.600.000', current_setting('t341.com_neto') = '286000'
  and (select precio_venta from public.ventas where numero_contrato = 'DTM-9402') = 2714000
  and (select base_comision || '|' || precio_venta || '|' || descontada_en_precio from public.aliados_b2b where numero_contrato = 'DTM-9402') = '2600000.00|3000000.00|true');
select t216.afirma('M1 MISMA base ⇒ MISMO monto: ordinario y NETO dan 52.000 (2 % de 2.600.000)', t341.estado('DTM-9401') = 'pendiente_pago|52000.00' and t341.estado('DTM-9402') = 'pendiente_pago|52000.00', t341.estado('DTM-9401') || ' / ' || t341.estado('DTM-9402'));
select t216.afirma('M2 la base del referido ES la base guardada de la comisión del aliado (ordinario y NETO), y esa misma base × % reproduce la comisión del aliado (286.000)',
  (select bool_and(x.base = a.base_comision and round(public.comision_b2b_total(a)) = round(a.base_comision * 0.11))
     from public.referidos_contratos(t216.u('super')) x join public.aliados_b2b a on a.id = x.comision_aliado_id where x.numero_contrato in ('DTM-9401', 'DTM-9402')));
select t216.afirma('M3 NO se calcula desde lo cobrado en NETO (2.714.000 − 400.000 = 2.314.000 → 46.280) ni desde el monto de la comisión del aliado (286.000 → 5.720)',
  (select comision from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9402') not in (46280, 5720) and (select base from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9402') = 2600000);
select t216.afirma('M3b el contrato NETO se identifica (neto = true) y el ordinario no', (select neto from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9402') and not (select neto from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9401'));
-- Elegibilidad = 100 % pagado de lo que el comprador DEBE pagar (en NETO, el total exigible 2.714.000; no el PVP original).
select t341.abono('DTM-9401', 1000000); select t341.abono('DTM-9402', 1000000);
select t216.afirma('M4 pago PARCIAL (1.000.000): ordinario y NETO siguen pendiente_pago con el MISMO monto', t341.estado('DTM-9401') = 'pendiente_pago|52000.00' and t341.estado('DTM-9402') = 'pendiente_pago|52000.00', t341.estado('DTM-9401') || ' / ' || t341.estado('DTM-9402'));
select t341.abono('DTM-9401', 1999999); select t341.abono('DTM-9402', 1713999);
select t216.afirma('M5 un peso menos del total sigue pendiente (ordinario 2.999.999 de 3.000.000; NETO 2.713.999 de 2.714.000; la tolerancia es 0,5)', t341.estado('DTM-9401') = 'pendiente_pago|52000.00' and t341.estado('DTM-9402') = 'pendiente_pago|52000.00', t341.estado('DTM-9401') || ' / ' || t341.estado('DTM-9402'));
select t341.abono('DTM-9401', 1); select t341.abono('DTM-9402', 1);
select t216.afirma('M6 100 % pagado ⇒ elegible, mismo monto: ordinario con 3.000.000 y NETO con 2.714.000 (NO exige pagar el PVP original)', t341.estado('DTM-9401') = 'elegible|52000.00' and t341.estado('DTM-9402') = 'elegible|52000.00', t341.estado('DTM-9401') || ' / ' || t341.estado('DTM-9402'));
select set_config('t341.m_ab', t341.abono('DTM-9402', 500000)::text, true);
select set_config('t341.m_rev', t216.escalar('service_role', null, format('select (public.anular_abono(%s, ''DTM-9402'', ''mayorista'', %L, ''reversa M'')->>''estado'')', current_setting('t341.m_ab'), t216.u('super'))), true);
select t216.afirma('M7 un pago EXTRA anulado con la reversa real no cambia nada: el NETO sigue elegible (2.714.000 ya estaban pagados)', current_setting('t341.m_rev') not like 'ERR%' and t341.estado('DTM-9402') = 'elegible|52000.00', current_setting('t341.m_rev') || ' / ' || t341.estado('DTM-9402'));
select set_config('t341.m_rev3', t216.escalar('service_role', null, format('select (public.anular_abono(%s, ''DTM-9402'', ''mayorista'', %L, ''reversa M3'')->>''estado'')', (select id from public.abonos where numero_contrato = 'DTM-9402' order by id limit 1), t216.u('super'))), true);
select t216.afirma('M7c anular el primer abono (1.000.000) deja pagado 1.714.000 < 2.714.000: vuelve a pendiente_pago con el MISMO monto', current_setting('t341.m_rev3') not like 'ERR%' and t341.estado('DTM-9402') = 'pendiente_pago|52000.00', current_setting('t341.m_rev3') || ' / ' || t341.estado('DTM-9402'));

-- La base GUARDADA manda (no se recalcula): si la comisión del aliado se corrigió a mano a otra base, el referido la sigue.
select t341.venta('DTM-9403', 'mayorista', 3000000, 400000, 9406);
update public.aliados_b2b set base_comision = 2000000 where numero_contrato = 'DTM-9403';
select t216.afirma('M8 base guardada editada a 2.000.000 ⇒ el referido sigue ESA base (40.000), no PVP − impuesto', t341.estado('DTM-9403') = 'pendiente_pago|40000.00', t341.estado('DTM-9403'));
-- Lectura legado (base_explicita NULL): base 0/NULL cae al PVP guardado, EXACTAMENTE como comision_b2b_total.
select t341.venta('DTM-9404', 'mayorista', 3000000, 400000, 9406);
update public.aliados_b2b set base_explicita = null, base_comision = 0 where numero_contrato = 'DTM-9404';
select t216.afirma('M9 fila legado (base 0 sin marca explícita): el referido usa el mismo PVP guardado que la comisión (3.000.000 → 60.000)', t341.estado('DTM-9404') = 'pendiente_pago|60000.00'
  and (select round(public.comision_b2b_total(a)) from public.aliados_b2b a where numero_contrato = 'DTM-9404') = 330000, t341.estado('DTM-9404'));
-- Base guardada explícita = 0: es un 0 REAL (sin_base), no «sin evidencia».
select t341.venta('DTM-9405', 'mayorista', 400000, 400000, 9406);
select t216.afirma('M10 base guardada 0 (PVP = impuesto): sin_base, monto 0 (cero guardado, no calculado)', t341.estado('DTM-9405') = 'sin_base|0', t341.estado('DTM-9405'));

-- SIN evidencia: no se adivina ni se muestra un cero.
select t341.venta('DTM-9410', 'mayorista', 3000000, 400000, 9408);
delete from public.aliados_b2b where numero_contrato = 'DTM-9410';   -- el contrato tiene aliado (con asignación vigente) pero NO tiene comisión del aliado guardada
select t341.venta('DTM-9411', 'mayorista', 2714000, 400000, 9408, null, 'COP', 'confirmado', 'descontada');   -- NETO sin su fila de comisión
select t341.venta('DTM-9412', 'mayorista', 3000000, 400000, 9406);
delete from public.aliados_b2b where numero_contrato = 'DTM-9412';
select t341.fila('DTM-9412', 9409, 2600000, 3000000, false, 0.12);                  -- solo existe la comisión de OTRO aliado: no es la de este
select t216.afirma('M11 ordinario sin comisión del aliado guardada: sin_evidencia_base y monto NULL (no 0)', t341.estado('DTM-9410') = 'sin_evidencia_base|NULL', t341.estado('DTM-9410'));
select t216.afirma('M12 NETO sin su fila descontada: sin_evidencia_base y monto NULL (no se reconstruye desde lo cobrado)', t341.estado('DTM-9411') = 'sin_evidencia_base|NULL', t341.estado('DTM-9411'));
select t216.afirma('M13 la comisión de OTRO aliado en el mismo contrato no sirve de evidencia', t341.estado('DTM-9412') = 'sin_evidencia_base|NULL', t341.estado('DTM-9412'));
select t216.afirma('M14 con evidencia ausente, base y monto vienen NULL (la pantalla puede decir «falta la evidencia»), nunca 0', (select base is null and comision is null from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9410'));
-- Un NETO con una SEGUNDA fila B2B de revisión: la base es la de la fila nacida descontada, no la otra.
select t341.neto('DTM-9413', 3000000, 400000, 9407);
set session_replication_role = replica;   -- el trigger de la 205 impide crear una segunda fila en un NETO; aquí se simula una histórica
select t341.fila('DTM-9413', 9407, 1000000, 1000000, false, 0.05);
set session_replication_role = origin;
select t216.afirma('M15 NETO con una segunda fila de revisión: manda la fila descontada (base 2.600.000 → 52.000), no hay ambigüedad', t341.estado('DTM-9413') = 'pendiente_pago|52000.00', t341.estado('DTM-9413'));
-- Dos filas ordinarias con bases distintas del MISMO aliado y contrato (histórico anterior a la 290): ambiguo, sin monto.
select t341.venta('DTM-9414', 'mayorista', 3000000, 400000, 9406);
set session_replication_role = replica;
select t341.fila('DTM-9414', 9406, 1000000, 3000000, false, 0.11);
set session_replication_role = origin;
select t216.afirma('M16 dos comisiones ordinarias del mismo aliado con bases distintas: base_ambigua y monto NULL', t341.estado('DTM-9414') = 'base_ambigua|NULL', t341.estado('DTM-9414'));
-- Una fila de SOLO recobro (198/267) no es la base ordinaria.
select t341.venta('DTM-9415', 'mayorista', 3000000, 400000, 9406);
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, estado) values ('DTM-9415', 'mayorista', 'Ordinario M', 9406, 3000000, 0, true, 0, 100000, 0.5, 'pendiente');
select t216.afirma('M17 una fila de solo recobro (del MISMO aliado, 290 lo permite) no altera la base ordinaria (52.000)', t341.estado('DTM-9415') = 'pendiente_pago|52000.00', t341.estado('DTM-9415'));
-- USD y cancelado.
select t341.neto('DTM-9416', 3000, 400, 9407, 0.11, 'USD');
select t216.afirma('M18 NETO en USD: base original 2.600 USD → 52 USD, moneda USD', (select moneda || '|' || comision::text from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9416') = 'USD|52.00');
select t341.neto('DTM-9417', 3000000, 400000, 9407, 0.11, 'COP', 'cancelado');
select t216.afirma('M19 NETO cancelado: cancelado y monto 0 (aunque tenga evidencia)', t341.estado('DTM-9417') = 'cancelado|0', t341.estado('DTM-9417'));
select t216.afirma('M20 el estado «no_aplica_neto» ya no existe en ningún contrato', (select count(*) from public.referidos_contratos(t216.u('super')) where estado = 'no_aplica_neto') = 0);
-- C76-1: una fila SIN aliado_id (comisión manual con beneficiario en texto libre) no es evidencia del aliado referido.
select t341.venta('DTM-9420', 'mayorista', 3000000, 400000, 9406);
delete from public.aliados_b2b where numero_contrato = 'DTM-9420';
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, estado) values ('DTM-9420', 'mayorista', 'Beneficiario libre', null, 3000000, 1000000, true, 0.05, 'pendiente');
select t216.afirma('R1 solo existe una comisión con aliado_id NULL (otro beneficiario en texto libre): sin_evidencia_base y monto NULL, no 20.000', t341.estado('DTM-9420') = 'sin_evidencia_base|NULL', t341.estado('DTM-9420'));
select t341.venta('DTM-9421', 'mayorista', 3000000, 400000, 9406);   -- fila correcta del aliado (base 2.600.000) …
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, estado) values ('DTM-9421', 'mayorista', 'Beneficiario libre', null, 3000000, 1000000, true, 0.05, 'pendiente');   -- … más una ajena sin id con otra base
select t216.afirma('R2 fila correcta del aliado + fila ajena sin id con otra base: la base correcta sigue usable (2.600.000 → 52.000), sin base_ambigua', t341.estado('DTM-9421') = 'pendiente_pago|52000.00'
  and (select base from public.referidos_contratos(t216.u('super')) where numero_contrato = 'DTM-9421') = 2600000, t341.estado('DTM-9421'));
select t216.afirma('R3 la fila sin identidad nunca es la comision_aliado_id devuelta', (select a.aliado_id = 9406 from public.referidos_contratos(t216.u('super')) x join public.aliados_b2b a on a.id = x.comision_aliado_id where x.numero_contrato = 'DTM-9421'));
select t216.afirma('R4 la falta de identidad queda explícita y filtrable: el filtro por estado encuentra DTM-9420 y no DTM-9421', (select count(*) from public.referidos_contratos(t216.u('super'), null, null, 'sin_evidencia_base') where numero_contrato = 'DTM-9420') = 1
  and (select count(*) from public.referidos_contratos(t216.u('super'), null, null, 'sin_evidencia_base') where numero_contrato = 'DTM-9421') = 0);
-- NETO + fila ajena sin id: sigue mandando la fila nacida descontada del aliado.
select t341.neto('DTM-9422', 3000000, 400000, 9407);
set session_replication_role = replica;   -- como M15: el trigger de la 205 impide la segunda fila en un NETO; aquí se simula una histórica
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, estado) values ('DTM-9422', 'mayorista', 'Beneficiario libre', null, 3000000, 1000000, true, 0.05, 'pendiente');
set session_replication_role = origin;
select t216.afirma('R5 NETO correcto + fila ajena sin id: sigue la base original 2.600.000 (52.000)', t341.estado('DTM-9422') = 'pendiente_pago|52000.00', t341.estado('DTM-9422'));
select t216.afirma('M21 el filtro por estado encuentra la falta de evidencia', (select count(*) from public.referidos_contratos(t216.u('super'), null, null, 'sin_evidencia_base') where numero_contrato in ('DTM-9410', 'DTM-9411', 'DTM-9412')) = 3);

-- L. Auditoría genérica y secuencias cerradas.
select t216.afirma('L1 las tablas nuevas tienen el trigger de auditoría', (select count(*) from pg_trigger where tgname = 'trg_auditoria' and tgrelid in ('public.referidores'::regclass, 'public.referidor_codigos'::regclass, 'public.aliado_referidores'::regclass, 'public.contrato_referidos'::regclass)) = 4);
select t216.rechaza('L2 anon no usa las secuencias', t216.escalar('anon', null, 'select nextval(''public.referidores_id_seq'')::text'), 'permission denied');

select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_341: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
