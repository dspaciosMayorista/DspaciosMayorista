-- ═══════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #76 (migración 342). Código de referido en el registro B2B público: CANDIDATO (nunca asignación), confirmación SOLO por superadmin/gerencia, administración solo ve.
-- SOLO base desechable, termina en ROLLBACK. Lo lanza supabase/scripts/test_341_referidos.sh con el argumento 342 (que une las fixtures de test_216 y aplica 340, 341 y 342).
-- Esperado calculado a mano: el código se normaliza a MAYÚSCULAS y solo vale con 4 a 20 letras/números/guiones; el % de la asignación sale de la regla guardada del código.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql

-- La plantilla local trae un auth.users simplificado: en Supabase la columna ya existe (esto se revierte con el ROLLBACK final).
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create schema t342;
create function t342.rpc(p_sql text) returns text language sql volatile as $$ select t216.escalar('service_role', null, p_sql) $$;
create function t342.j(p_sql text) returns jsonb language sql volatile as $$ select (t216.escalar('service_role', null, p_sql))::jsonb $$;
create function t342.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000003420' || lpad(n::text, 2, '0'))::uuid $$;
-- Una cuenta de registro B2B (freelance, INACTIVA) con su estado de registro y datos del paso 1 (el código viaja DENTRO de los datos que el servidor guardó).
create function t342.registrante(n int, p_datos jsonb, p_confirmado boolean default true, p_marcada boolean default true) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (t342.uid(n), 'reg342-' || n || '@x.test', case when p_confirmado then now() else null end, case when p_marcada then '{"registro_b2b_codigo": true}'::jsonb else '{}'::jsonb end)
  on conflict (id) do update set email_confirmed_at = excluded.email_confirmed_at, raw_app_meta_data = excluded.raw_app_meta_data;
  insert into public.usuarios (id, email, nombre, rol, activo, tenant)
  values (t342.uid(n), 'reg342-' || n || '@x.test', 'Registrante ' || n, 'freelance', false, 'mayorista')
  on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = false, tenant = 'mayorista', aliado_id = null;
  perform public.registro_b2b_iniciar(t342.uid(n), p_datos);
end $$;
create function t342.completar(n int, p_extra jsonb default null) returns text language sql volatile as $$ select t342.rpc(format('select public.registro_b2b_completar(%L, %L)', t342.uid(n), p_extra)) $$;
create function t342.sol(n int) returns text language sql stable as $$
  select coalesce((select s.id || '|' || coalesce(s.codigo_referido, '-') || '|' || s.referido_estado || '|' || s.estado from public.b2b_solicitudes s where s.usuario_id = t342.uid(n)), 'sin_solicitud')
$$;
create function t342.sid(n int) returns bigint language sql stable as $$ select id from public.b2b_solicitudes where usuario_id = t342.uid(n) $$;
create function t342.decidir(p_actor text, n int, p_dec text, p_ref bigint default null, p_pct numeric default null) returns text language sql volatile as $$
  select t342.rpc(format('select public.referido_decidir_solicitud(%L, %s, %L, %L, %L)::text', t216.u(p_actor), t342.sid(n), p_dec, p_ref, p_pct))
$$;
create function t342.aprobar(p_actor text, n int, p_aliado bigint) returns text language sql volatile as $$
  select t216.escalar('authenticated', t216.u(p_actor), format('select public.aprobar_solicitud_b2b(%s, ''ficha'', %s)::text', t342.sid(n), p_aliado))
$$;
create function t342.vigente(p_aliado bigint) returns text language sql stable as $$
  select coalesce((select a.referidor_id || '|' || a.pct::text || '|' || a.origen || '|' || coalesce(a.codigo, '-') from public.aliado_referidores a where a.aliado_id = p_aliado and a.vigente_hasta is null), 'ninguna')
$$;
create function t342.cuantas(p_aliado bigint) returns bigint language sql stable as $$ select count(*) from public.aliado_referidores where aliado_id = p_aliado $$;

-- Fixtures: aliados catalogados, referidores y códigos (reglas guardadas) de las dos agencias.
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9501, 'Ficha T342 Uno', '95010', 'freelance', 0.11, false, 0, true), (9502, 'Ficha T342 Dos', '95020', 'freelance', 0.11, false, 0, true),
  (9503, 'Ficha T342 Tres', '95030', 'freelance', 0.11, false, 0, true), (9504, 'Ficha T342 Cuatro', '95040', 'freelance', 0.11, false, 0, true);
select set_config('t342.r1', (t342.j(format('select public.referidor_guardar(%L, null, ''mayorista'', ''Odair Referidor'', ''CC'', ''7002001'', null, null, null, true)::text', t216.u('super'))) ->> 'id'), true);
select set_config('t342.r2', (t342.j(format('select public.referidor_guardar(%L, null, ''mayorista'', ''Segundo Referidor'', null, null, null, null, null, true)::text', t216.u('super'))) ->> 'id'), true);
select set_config('t342.r3', (t342.j(format('select public.referidor_guardar(%L, null, ''minorista'', ''Referidor Minorista'', null, null, null, null, null, true)::text', t216.u('super'))) ->> 'id'), true);
select t342.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-1'', 0.01, true)::text', t216.u('super'), current_setting('t342.r1')));
select t342.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-2'', 0.02, true)::text', t216.u('super'), current_setting('t342.r1')));
select t342.rpc(format('select public.referidor_codigo_definir(%L, %s, ''MIN-1'', 0.01, true)::text', t216.u('super'), current_setting('t342.r3')));

-- A. El registro captura el CANDIDATO (texto), nunca una asignación.
select t342.registrante(1, '{"nit": "1001", "tipo_documento": "CC", "codigo_referido": " odair-1 "}');
select set_config('t342.x', t342.completar(1), true);
select t216.afirma('A1 completar crea la solicitud (como siempre)', current_setting('t342.x') = 'creada');
select t216.afirma('A2 el código queda NORMALIZADO (mayúsculas, sin espacios) y en estado candidato', split_part(t342.sol(1), '|', 2) = 'ODAIR-1' and split_part(t342.sol(1), '|', 3) = 'candidato', t342.sol(1));
select t216.afirma('A3 el candidato NO asigna nada: ninguna asignación ni atribución nueva', (select count(*) from public.aliado_referidores) = 0);
select set_config('t342.x', t342.completar(1), true);
select t216.afirma('A4 repetir completar es idempotente (ya_existia) y no cambia el candidato', current_setting('t342.x') = 'ya_existia' and (select count(*) from public.b2b_solicitudes where usuario_id = t342.uid(1)) = 1 and split_part(t342.sol(1), '|', 3) = 'candidato');
select t342.registrante(2, '{"nit": "1002", "codigo_referido": "a b"}');
select set_config('t342.x', t342.completar(2), true);
select t216.afirma('A5 un código con formato inválido NO impide el registro: se crea sin candidato', current_setting('t342.x') = 'creada' and split_part(t342.sol(2), '|', 3) = 'sin_codigo' and split_part(t342.sol(2), '|', 2) = '-', t342.sol(2));
select t342.registrante(3, '{"nit": "1003"}');
select set_config('t342.x', t342.completar(3), true);
select t216.afirma('A6 sin código: sin candidato', current_setting('t342.x') = 'creada' and split_part(t342.sol(3), '|', 3) = 'sin_codigo');
select t342.registrante(4, '{"nit": "1004", "codigo_referido": "odair-2"}');
select set_config('t342.x', t342.completar(4, '{"codigo_referido": "ODAIR-1"}'), true);
select t216.afirma('A7 reanudación: los datos guardados en el paso 1 MANDAN sobre los que llegan después (un código distinto en p_datos no lo reemplaza)', current_setting('t342.x') = 'creada' and split_part(t342.sol(4), '|', 2) = 'ODAIR-2', t342.sol(4));
select t342.registrante(5, '{"nit": "1005", "codigo_referido": "ODAIR-1"}', false);
select set_config('t342.x', t342.completar(5), true);
select t216.afirma('A8 correo SIN confirmar: no se crea solicitud (comportamiento de la 324 intacto)', current_setting('t342.x') = 'sin_verificar' and t342.sol(5) = 'sin_solicitud');
select t342.registrante(6, '{"nit": "1006", "codigo_referido": "ODAIR-1"}', true, false);
select set_config('t342.x', t342.completar(6), true);
select t216.afirma('A9 cuenta que NO viene de este flujo: no_aplica y sin solicitud', current_setting('t342.x') = 'no_aplica' and t342.sol(6) = 'sin_solicitud');
select t216.rechaza('A10 la base exige coherencia: un código sin estado candidato no se puede insertar a mano', (select t216.escalar('service_role', null, 'insert into public.b2b_solicitudes (tipo, nombre, email, codigo_referido, referido_estado) values (''freelance'', ''Incoherente'', ''inco342@x.test'', ''ODAIR-1'', ''sin_codigo'')')), 'b2b_solicitudes_referido_coherente');
select t216.rechaza('A11 el formato del código lo exige la tabla (no solo la función)', (select t216.escalar('service_role', null, 'insert into public.b2b_solicitudes (tipo, nombre, email, codigo_referido, referido_estado) values (''freelance'', ''Formato'', ''form342@x.test'', ''x'', ''candidato'')')), 'check');

-- B. Quién puede decidir: SOLO superadmin y gerencia. Administración ve, no decide (tampoco por la aprobación).
do $$
declare k text; r text;
begin
  foreach k in array array['admin', 'adminMin', 'oper', 'ventaA', 'agencia', 'vuelo', 'inactivo'] loop
    r := t342.decidir(k, 1, 'descartar');
    perform t216.afirma('B1 ' || k || ' NO decide', r like 'ERR F4701%', r);
  end loop;
end $$;
select t216.rechaza('B2 anon no ejecuta', t216.escalar('anon', null, format('select public.referido_decidir_solicitud(%L, %s, ''descartar'')::text', t216.u('super'), t342.sid(1))), 'permission denied');
select t216.rechaza('B3 authenticated no ejecuta (ni con su propia sesión de superadmin)', t216.escalar('authenticated', t216.u('super'), format('select public.referido_decidir_solicitud(%L, %s, ''descartar'')::text', t216.u('super'), t342.sid(1))), 'permission denied');
select t216.rechaza('B4 authenticated no lee los candidatos por la función', t216.escalar('authenticated', t216.u('super'), format('select public.referidos_candidatos(%L)::text', t216.u('super'))), 'permission denied');
select t216.afirma('B5 el estado del candidato sigue intacto tras los intentos', split_part(t342.sol(1), '|', 3) = 'candidato');
-- Un aprobador NO puede tocar el campo por la API de tablas (la política de la 193 es solo de lectura).
select t216.escalar('authenticated', t216.u('admin'), format('update public.b2b_solicitudes set referido_estado = ''confirmado'' where id = %s returning 1', t342.sid(1)));
select t216.afirma('B6 un aprobador no cambia referido_estado por la tabla', split_part(t342.sol(1), '|', 3) = 'candidato', t342.sol(1));

-- C. Antes de aprobar no se asigna; se puede descartar; datos inválidos.
select t216.rechaza('C1 asignar exige registro APROBADO y enlazado', t342.decidir('gerencia', 1, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), 'F4711');
select t216.rechaza('C2 decisión desconocida', t342.decidir('gerencia', 1, 'quizas'), 'F4713');
select t216.rechaza('C3 una solicitud SIN código no tiene candidato', t342.decidir('gerencia', 3, 'descartar'), 'F4713');
select t216.rechaza('C4 solicitud inexistente', t342.rpc(format('select public.referido_decidir_solicitud(%L, 999999, ''descartar'')::text', t216.u('super'))), 'F4713');
select set_config('t342.x', t342.j(format('select public.referido_decidir_solicitud(%L, %s, ''descartar'')::text', t216.u('gerencia'), t342.sid(4)))::text, true);
select t216.afirma('C5 descartar antes de aprobar cierra el candidato SIN asignar', (current_setting('t342.x')::jsonb ->> 'estado') = 'descartada' and split_part(t342.sol(4), '|', 3) = 'descartado' and (select count(*) from public.aliado_referidores) = 0);

-- D. Aprobación REAL (administración aprueba) y confirmación por gerencia.
select set_config('t342.x', t342.aprobar('admin', 1, 9501), true);
select t216.afirma('D1 administración APRUEBA el registro (enlaza la ficha 9501) y eso no asigna referido', current_setting('t342.x') like '%"aliado_id": 9501%' and split_part(t342.sol(1), '|', 4) = 'aprobada' and t342.vigente(9501) = 'ninguna', t342.sol(1) || ' / ' || t342.vigente(9501));
select t216.rechaza('D2 administración NO confirma ni cambiando los valores', t342.decidir('admin', 1, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), 'F4701');
select t216.rechaza('D3 gerencia: lo que VIO no coincide con la regla (pct 2 % en vez de 1 %) → rechaza y no asigna', t342.decidir('gerencia', 1, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.02), 'F4712');
select t216.rechaza('D4 gerencia: referidor distinto al de la regla → rechaza', t342.decidir('gerencia', 1, 'confirmar_codigo', current_setting('t342.r2')::bigint, 0.01), 'F4712');
select t216.afirma('D5 tras los rechazos no hay asignación y el candidato sigue pendiente', t342.vigente(9501) = 'ninguna' and split_part(t342.sol(1), '|', 3) = 'candidato');
select set_config('t342.x', t342.decidir('gerencia', 1, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), true);
select t216.afirma('D6 gerencia CONFIRMA: la asignación sale de la regla guardada (referidor 1, 1 %, origen código ODAIR-1)', (current_setting('t342.x')::jsonb ->> 'estado') = 'asignada' and t342.vigente(9501) = current_setting('t342.r1') || '|0.0100|codigo|ODAIR-1' and split_part(t342.sol(1), '|', 3) = 'confirmado', t342.vigente(9501) || ' / ' || t342.sol(1));
select set_config('t342.x', t342.decidir('super', 1, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), true);
select t216.afirma('D7 repetir/competir NO duplica: «ya_decidida» y una sola asignación', (current_setting('t342.x')::jsonb ->> 'estado') = 'ya_decidida' and t342.cuantas(9501) = 1);

-- E. Alternativa explícita (otro referidor/porcentaje), porcentajes válidos y reemplazo hacia adelante.
select t342.registrante(7, '{"nit": "1007", "codigo_referido": "ODAIR-1"}'); select t342.completar(7);
select t342.aprobar('admin', 7, 9502);
select t216.rechaza('E1 alternativa con 3 % → rechazada, el candidato queda pendiente', t342.decidir('gerencia', 7, 'asignar_otro', current_setting('t342.r2')::bigint, 0.03), 'F4704');
select t216.rechaza('E2 alternativa sin referidor', t342.decidir('gerencia', 7, 'asignar_otro', null, 0.02), 'F4705');
select t216.afirma('E3 tras los rechazos: candidato pendiente y sin asignación', split_part(t342.sol(7), '|', 3) = 'candidato' and t342.vigente(9502) = 'ninguna');
select set_config('t342.x', t342.decidir('super', 7, 'asignar_otro', current_setting('t342.r2')::bigint, 0.02), true);
select t216.afirma('E4 superadmin asigna OTRO referidor al 2 % (manual) y el candidato queda «reemplazado»', (current_setting('t342.x')::jsonb ->> 'estado') = 'asignada' and t342.vigente(9502) = current_setting('t342.r2') || '|0.0200|manual|-' and split_part(t342.sol(7), '|', 3) = 'reemplazado');
-- Compras futuras: un contrato anterior conserva su foto; el reemplazo solo rige hacia adelante.
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at)
values ('DTM-9501', 'mayorista', 'bloqueo', 'confirmado', 'Cliente 9501', 'Asesor', 1000000, 0, 'COP', 9501, clock_timestamp());
select t216.afirma('E5 el contrato creado DESPUÉS de confirmar toma la asignación vigente (1 %)', (select cr.referidor_id || '|' || cr.pct::text from public.contrato_referidos cr join public.ventas v on v.contrato_uid = cr.contrato_uid where v.numero_contrato = 'DTM-9501') = current_setting('t342.r1') || '|0.0100');
select t342.registrante(8, '{"nit": "1008", "codigo_referido": "ODAIR-2"}'); select t342.completar(8);
select t342.aprobar('admin', 8, 9501);
select set_config('t342.x', t342.decidir('gerencia', 8, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.02), true);
select t216.afirma('E6 un nuevo código para una ficha que YA tiene referidor lo reemplaza solo por decisión explícita (cambiada) y deja el historial', (current_setting('t342.x')::jsonb ->> 'estado') = 'cambiada' and t342.vigente(9501) = current_setting('t342.r1') || '|0.0200|codigo|ODAIR-2' and t342.cuantas(9501) = 2);
select t216.afirma('E7 el contrato anterior NO cambió (sin reasignación retroactiva)', (select cr.pct::text from public.contrato_referidos cr join public.ventas v on v.contrato_uid = cr.contrato_uid where v.numero_contrato = 'DTM-9501') = '0.0100' and (select count(*) from public.contrato_referidos) = 1);

-- F. Reglas que cambian, inválidas, otra agencia, ficha sin enlazar y registros rechazados.
select t342.registrante(9, '{"nit": "1009", "codigo_referido": "NOEXISTE"}'); select t342.completar(9);
select t342.aprobar('admin', 9, 9503);
select t216.rechaza('F1 un código que no existe no se puede confirmar (mensaje único)', t342.decidir('gerencia', 9, 'confirmar_codigo', 1, 0.01), 'F4707');
select t342.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-1'', 0.01, false)::text', t216.u('super'), current_setting('t342.r1')));
select t342.registrante(10, '{"nit": "1010", "codigo_referido": "ODAIR-1"}'); select t342.completar(10);
select t342.aprobar('admin', 10, 9503);
select t216.rechaza('F2 un código DESACTIVADO no se confirma', t342.decidir('gerencia', 10, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), 'F4707');
select t342.rpc(format('select public.referidor_codigo_definir(%L, %s, ''ODAIR-1'', 0.01, true)::text', t216.u('super'), current_setting('t342.r1')));
select t342.registrante(11, '{"nit": "1011", "codigo_referido": "ODAIR-1"}'); select t342.completar(11);
select t216.escalar('authenticated', t216.u('admin'), format('select public.aprobar_solicitud_b2b(%s, ''ninguno'')::text', t342.sid(11)));
select t216.rechaza('F3 aprobado SIN enlazar ficha: no hay aliado al que asignar', t342.decidir('gerencia', 11, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), 'F4711');
select t342.registrante(12, '{"nit": "1012", "codigo_referido": "ODAIR-1"}'); select t342.completar(12);
select t216.escalar('authenticated', t216.u('admin'), format('select public.rechazar_solicitud_b2b(%s)::text', t342.sid(12)));
select t216.rechaza('F4 un registro RECHAZADO no genera asignación', t342.decidir('gerencia', 12, 'confirmar_codigo', current_setting('t342.r1')::bigint, 0.01), 'F4711');
select t342.registrante(13, '{"nit": "1013", "codigo_referido": "MIN-1"}'); select t342.completar(13);
select t342.aprobar('admin', 13, 9504);
select set_config('t342.x', t342.decidir('gerencia', 13, 'confirmar_codigo', current_setting('t342.r3')::bigint, 0.01), true);
select t216.afirma('F5 el código de OTRA agencia: gerencia/superadmin (alcance de ambas) lo confirman; la asignación queda en esa agencia', (current_setting('t342.x')::jsonb ->> 'estado') = 'asignada' and (select tenant from public.aliado_referidores where aliado_id = 9504 and vigente_hasta is null) = 'minorista');

-- G. Lectura de candidatos: administración ve (con su alcance), no decide; sin datos de contacto.
select t342.registrante(14, '{"nit": "1014", "codigo_referido": "ODAIR-2"}'); select t342.completar(14);
select t342.registrante(15, '{"nit": "1015", "codigo_referido": "MIN-1"}'); select t342.completar(15);
update public.usuarios set tenant = 'minorista' where id = t342.uid(15);
select t216.afirma('G1 administración (mayorista) VE el candidato resuelto: referidor, % y estado; no ve el de minorista',
  (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('admin')))) e where (e ->> 'solicitud_id')::bigint = t342.sid(14) and e ->> 'referidor_nombre' = 'Odair Referidor' and (e ->> 'pct')::numeric = 0.02 and e ->> 'referido_estado' = 'candidato') = 1
  and (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('admin')))) e where (e ->> 'solicitud_id')::bigint = t342.sid(15)) = 0);
select t216.afirma('G2 administración de MINORISTA ve solo el de su agencia', (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('adminMin')))) e where (e ->> 'solicitud_id')::bigint = t342.sid(15)) = 1
  and (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('adminMin')))) e where (e ->> 'solicitud_id')::bigint = t342.sid(14)) = 0);
select t216.afirma('G3 gerencia ve ambas agencias', (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('gerencia')))) e where (e ->> 'solicitud_id')::bigint in (t342.sid(14), t342.sid(15))) = 2);
select t216.afirma('G4 un código que no existe sale SIN referidor resuelto (no se inventa)', (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('super')))) e where (e ->> 'solicitud_id')::bigint = t342.sid(9) and e -> 'referidor_id' = 'null'::jsonb) = 1);
select t216.afirma('G5 operaciones, venta y aliado NO leen candidatos', t342.rpc(format('select public.referidos_candidatos(%L)::text', t216.u('oper'))) like 'ERR F4701%' and t342.rpc(format('select public.referidos_candidatos(%L)::text', t216.u('agencia'))) like 'ERR F4701%' and t342.rpc(format('select public.referidos_candidatos(%L)::text', t216.u('ventaA'))) like 'ERR F4701%');
select t216.afirma('G6 la lectura no expone contacto del solicitante', (select count(*) from jsonb_array_elements(t342.j(format('select public.referidos_candidatos(%L)::text', t216.u('super')))) e where e ? 'email' or e ? 'telefono' or e ? 'contacto' or e ? 'nit') = 0);

-- H. Sin efectos sobre las comisiones del aliado (aliados_b2b) y sin pagos.
select t216.afirma('H1 la confirmación no crea comisiones B2B ni pagos', (select count(*) from public.aliados_b2b) = 0 and (select count(*) from public.comision_b2b_pagos) = 0);

select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_342: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
