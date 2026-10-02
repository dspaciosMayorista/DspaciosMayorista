-- ───────────────────────────────────────────────────────────────────────────
-- Batería de la migración 193 (registro/aprobación B2B). Base LOCAL con la 193
-- aplicada. Todo corre en UNA transacción que termina en ROLLBACK.
-- NO correr contra Supabase. Lanzador: test_193_registro_b2b.sh
--
-- Casos negativos y positivos:
--   T01-T05  Trigger: ningún rol privilegiado desde la metadata; todo inactivo.
--   T06      Cambiar la metadata después (updateUser) no cambia el perfil.
--   T07      Un perfil inactivo no puede autoactivarse ni ver nada.
--   T08-T10  b2b_solicitudes: anon no inserta/lee; authenticated no escribe
--            directo (ni admin); admin sí lee la pendiente.
--   T11-T12  RPC: anon y roles sin permiso no aprueban/rechazan.
--   T13-T19  Aprobación: correo distinto, sin cuenta, solo-por-correo,
--            perfil interno/activo, tipo distinto, ficha inexistente, modo
--            inválido → error y NADA cambia.
--   T20-T22  Aprobación correcta; segunda aprobación y rechazo posterior
--            fallan; modo 'nueva' crea y enlaza la ficha.
--   T23      Rechazo correcto; la cuenta sigue inactiva; no se re-aprueba.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
begin;

-- Helpers (viven solo dentro de esta transacción).
create function public.t193_como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"anon"}'
         else json_build_object('sub', p_uid::text, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

create function public.t193_debe_fallar(p_sql text, p_estado text, p_caso text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_estado then
      raise exception 'FALLO %: error % (%) en vez de %', p_caso, sqlstate, sqlerrm, p_estado;
    end if;
    raise notice 'OK %: % (%)', p_caso, sqlstate, sqlerrm;
    return;
  end;
  raise exception 'FALLO %: se esperaba error % y no hubo', p_caso, p_estado;
end $$;
grant execute on function public.t193_como(uuid), public.t193_debe_fallar(text, text, text) to anon, authenticated;

create function public.t193_ok(p_cond boolean, p_caso text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALLO %', p_caso; end if;
  raise notice 'OK %', p_caso;
end $$;
grant execute on function public.t193_ok(boolean, text) to anon, authenticated;

-- ── Fixtures: personal interno (rol y activo EXPLÍCITOS, como crearUsuario) ─
insert into auth.users (id, email, raw_user_meta_data) values
  ('19300000-0000-0000-0000-0000000000a1', 't193.gerencia@t', '{"nombre":"T193 Gerencia"}'),
  ('19300000-0000-0000-0000-0000000000a2', 't193.venta@t',    '{"nombre":"T193 Venta"}'),
  ('19300000-0000-0000-0000-0000000000a3', 't193.agencia.activa@t', '{"rol":"agencia"}'),
  ('19300000-0000-0000-0000-0000000000a4', 't193.operaciones@t', '{"nombre":"T193 Ope"}');
update public.usuarios set rol = 'gerencia', activo = true, tenant = 'mayorista' where id = '19300000-0000-0000-0000-0000000000a1';
update public.usuarios set rol = 'venta', activo = true, tenant = 'mayorista' where id = '19300000-0000-0000-0000-0000000000a2';
update public.usuarios set activo = true where id = '19300000-0000-0000-0000-0000000000a3';
update public.usuarios set rol = 'operaciones', activo = true, tenant = 'mayorista' where id = '19300000-0000-0000-0000-0000000000a4';

-- ── T01-T05 · Trigger de alta ─────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('19300000-0000-0000-0000-000000000001', 't193.super@t',     '{"rol":"superadmin"}'),
  ('19300000-0000-0000-0000-000000000002', 't193.gerencia2@t', '{"rol":"gerencia"}'),
  ('19300000-0000-0000-0000-000000000003', 't193.venta2@t',    '{"rol":"venta"}'),
  ('19300000-0000-0000-0000-000000000004', 't193.cv@t',        '{"rol":"control_vuelo"}'),
  ('19300000-0000-0000-0000-000000000005', 't193.mayus@t',     '{"rol":" SUPERADMIN "}'),
  ('19300000-0000-0000-0000-000000000006', 't193.basura@t',    '{"rol":"rol-que-no-existe"}'),
  ('19300000-0000-0000-0000-000000000007', 't193.google@t',    null),
  ('19300000-0000-0000-0000-000000000008', 't193.agencia@t',   '{"rol":"agencia","nombre":"Agencia T193"}'),
  ('19300000-0000-0000-0000-000000000009', 't193.free@t',      '{"rol":"FreeLance"}'),
  ('19300000-0000-0000-0000-000000000010', 't193.json@t',      '{"rol":["superadmin"]}');

select public.t193_ok(
  (select bool_and(rol = 'cliente_final' and not activo) from public.usuarios
    where id in ('19300000-0000-0000-0000-000000000001','19300000-0000-0000-0000-000000000002',
                 '19300000-0000-0000-0000-000000000003','19300000-0000-0000-0000-000000000004',
                 '19300000-0000-0000-0000-000000000005','19300000-0000-0000-0000-000000000010'))
  and (select count(*) from public.usuarios
        where id in ('19300000-0000-0000-0000-000000000001','19300000-0000-0000-0000-000000000002',
                     '19300000-0000-0000-0000-000000000003','19300000-0000-0000-0000-000000000004',
                     '19300000-0000-0000-0000-000000000005','19300000-0000-0000-0000-000000000010')) = 6,
  'T01 metadata con rol privilegiado → cliente_final inactivo');
select public.t193_ok(
  (select rol = 'cliente_final' and not activo from public.usuarios where id = '19300000-0000-0000-0000-000000000006'),
  'T02 metadata basura no rompe el alta y no da rol');
select public.t193_ok(
  (select rol = 'cliente_final' and not activo and nombre = 't193.google' from public.usuarios where id = '19300000-0000-0000-0000-000000000007'),
  'T03 alta OAuth/directa sin metadata → cliente_final inactivo');
select public.t193_ok(
  (select rol = 'agencia' and not activo and nombre = 'Agencia T193' from public.usuarios where id = '19300000-0000-0000-0000-000000000008')
  and (select rol = 'freelance' and not activo from public.usuarios where id = '19300000-0000-0000-0000-000000000009'),
  'T04 registro B2B → agencia/freelance INACTIVO desde el trigger (sin intervalo activo)');
select public.t193_ok(
  position('superadmin' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) = 0
  and position('::rol_usuario' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) = 0
  and position('::public.rol_usuario' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) = 0,
  'T05 el trigger no conoce superadmin ni castea texto libre a rol');

-- ── T06 · Cambiar la metadata después no cambia el perfil ─────────────────
update auth.users set raw_user_meta_data = '{"rol":"superadmin"}' where id = '19300000-0000-0000-0000-000000000008';
select public.t193_ok(
  (select rol = 'agencia' and not activo from public.usuarios where id = '19300000-0000-0000-0000-000000000008')
  and not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
                     and (t.tgtype & 16) <> 0),  -- 16 = UPDATE
  'T06 no hay trigger de UPDATE en auth.users: updateUser({rol}) no escala');

-- ── T07 · Perfil inactivo: sin rol, sin autoactivación ────────────────────
set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-000000000001');
select public.t193_ok(public.mi_rol() is null, 'T07a mi_rol() de un perfil inactivo es null');
update public.usuarios set activo = true, rol = 'superadmin' where id = '19300000-0000-0000-0000-000000000001';
reset role;
select public.t193_ok(
  (select rol = 'cliente_final' and not activo from public.usuarios where id = '19300000-0000-0000-0000-000000000001'),
  'T07b un perfil inactivo no puede activarse ni subirse el rol (RLS)');

-- Solicitudes de prueba (como las crea el registro, con service-role).
insert into public.b2b_solicitudes (id, tipo, nombre, nit, tipo_documento, email, estado, usuario_id) values
  (1930001, 'agencia',   'Agencia T193',   '900193001', 'NIT', 't193.agencia@t', 'pendiente', '19300000-0000-0000-0000-000000000008'),
  (1930002, 'agencia',   'Correo Distinto', '900193002', 'NIT', 'otro@t',        'pendiente', '19300000-0000-0000-0000-000000000008'),
  (1930003, 'agencia',   'Sin Cuenta',     '900193003', 'NIT', 't193.agencia@t', 'pendiente', null),
  (1930004, 'agencia',   'Apunta a Venta', '900193004', 'NIT', 't193.venta@t',   'pendiente', '19300000-0000-0000-0000-0000000000a2'),
  (1930005, 'agencia',   'Ya Activa',      '900193005', 'NIT', 't193.agencia.activa@t', 'pendiente', '19300000-0000-0000-0000-0000000000a3'),
  (1930006, 'agencia',   'Tipo Distinto',  '900193006', 'CC',  't193.free@t',    'pendiente', '19300000-0000-0000-0000-000000000009'),
  (1930007, 'freelance', 'Free T193',      '100193007', 'CC',  't193.free@t',    'pendiente', '19300000-0000-0000-0000-000000000009'),
  (1930008, 'agencia',   'Para Rechazar',  '900193008', 'NIT', 't193.cv@t',      'pendiente', '19300000-0000-0000-0000-000000000004');
-- 1930008 apunta a un cliente_final (alta directa con rol privilegiado en la metadata)

-- ── T08-T10 · Permisos efectivos sobre b2b_solicitudes ────────────────────
set local role anon;
select public.t193_como(null);
select public.t193_debe_fallar(
  $q$insert into public.b2b_solicitudes (tipo, nombre, email, estado, usuario_id)
     values ('agencia', 'Falsa', 't193.venta@t', 'pendiente', '19300000-0000-0000-0000-0000000000a2')$q$,
  '42501', 'T08a anon NO puede insertar solicitudes (REST directo)');
select public.t193_debe_fallar($q$select count(*) from public.b2b_solicitudes$q$, '42501', 'T08b anon NO puede leer solicitudes');
reset role;

set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a1');  -- gerencia, activo
select public.t193_debe_fallar(
  $q$insert into public.b2b_solicitudes (tipo, nombre, email) values ('agencia', 'Directa', 'x@t')$q$,
  '42501', 'T09a ni un admin inserta solicitudes por la API');
select public.t193_debe_fallar(
  $q$update public.b2b_solicitudes set estado = 'aprobada' where id = 1930001$q$,
  '42501', 'T09b ni un admin cambia el estado por la API (solo por la RPC)');
select public.t193_debe_fallar($q$delete from public.b2b_solicitudes where id = 1930001$q$, '42501', 'T09c ni un admin borra por la API');
select public.t193_ok((select count(*) from public.b2b_solicitudes where id = 1930001 and estado = 'pendiente') = 1,
  'T10 el admin SÍ ve la solicitud pendiente (bandeja /dashboard/usuarios/b2b)');

select public.t193_como('19300000-0000-0000-0000-0000000000a2');  -- venta, activo
select public.t193_ok((select count(*) from public.b2b_solicitudes) = 0, 'T10b venta no ve solicitudes');
reset role;

-- ── T11-T12 · Quién puede llamar las RPC ──────────────────────────────────
set local role anon;
select public.t193_como(null);
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001)$q$, '42501', 'T11a anon no ejecuta aprobar');
select public.t193_debe_fallar($q$select public.rechazar_solicitud_b2b(1930001)$q$, '42501', 'T11b anon no ejecuta rechazar');
reset role;

set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a2');  -- venta
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001)$q$, '42501', 'T12a venta no aprueba');
select public.t193_como('19300000-0000-0000-0000-0000000000a4');  -- operaciones
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001)$q$, '42501', 'T12b operaciones no aprueba');
select public.t193_como('19300000-0000-0000-0000-0000000000a3');  -- agencia activa
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001)$q$, '42501', 'T12c una agencia no aprueba');
select public.t193_debe_fallar($q$select public.rechazar_solicitud_b2b(1930001)$q$, '42501', 'T12d una agencia no rechaza');
select public.t193_como('19300000-0000-0000-0000-000000000001');  -- inactivo (alta con rol superadmin)
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001)$q$, '42501', 'T12e un perfil inactivo no aprueba');

-- ── T13-T19 · Aprobaciones que deben fallar sin cambiar nada ──────────────
select public.t193_como('19300000-0000-0000-0000-0000000000a1');  -- gerencia
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930002)$q$, '55000', 'T13 correo de la cuenta ≠ correo de la solicitud');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930003)$q$, '55000', 'T14 sin usuario_id no se busca por correo');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930004)$q$, '55000', 'T15 no reasigna/activa un perfil interno');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930005)$q$, '55000', 'T16 no aprueba sobre una cuenta ya activa');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930006)$q$, '55000', 'T17 tipo de solicitud ≠ rol de la cuenta');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930008)$q$, '55000', 'T17b no activa un alta directa (cliente_final)');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001, 'ficha', 987654321)$q$, '22023', 'T18 ficha de aliado inexistente');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001, 'ficha', null)$q$, '22023', 'T18b modo ficha sin id');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001, 'otra-cosa')$q$, '22023', 'T19 modo inválido');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(999999999)$q$, 'P0002', 'T19b solicitud inexistente');
reset role;

select public.t193_ok(
  (select count(*) from public.b2b_solicitudes where id between 1930001 and 1930008 and estado = 'pendiente' and revisado_at is null) = 8
  and (select rol = 'venta' and activo from public.usuarios where id = '19300000-0000-0000-0000-0000000000a2')
  and (select not activo from public.usuarios where id = '19300000-0000-0000-0000-000000000008')
  and (select not activo and rol = 'freelance' from public.usuarios where id = '19300000-0000-0000-0000-000000000009')
  and (select not activo and rol = 'cliente_final' from public.usuarios where id = '19300000-0000-0000-0000-000000000004'),
  'T13-T19 ningún intento fallido cambió estados ni perfiles');

-- ── T20-T22 · Aprobación correcta, sin segunda aprobación ─────────────────
set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a1');
select public.t193_ok(
  (public.aprobar_solicitud_b2b(1930001, 'ninguno'))->>'usuario_id' = '19300000-0000-0000-0000-000000000008',
  'T20a aprobación correcta devuelve la cuenta por usuario_id');
reset role;
select public.t193_ok(
  (select rol = 'agencia' and activo from public.usuarios where id = '19300000-0000-0000-0000-000000000008')
  and (select estado = 'aprobada' and revisado_por = 'T193 Gerencia' and revisado_at is not null
         from public.b2b_solicitudes where id = 1930001),
  'T20b cuenta activada y solicitud aprobada en la misma transacción');

set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a1');
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930001)$q$, '55000', 'T21a segunda aprobación rechazada');
select public.t193_debe_fallar($q$select public.rechazar_solicitud_b2b(1930001)$q$, '55000', 'T21b no se rechaza una ya aprobada');
select public.t193_ok(
  (public.aprobar_solicitud_b2b(1930007, 'nueva'))->>'aliado_id' is not null,
  'T22a modo nueva: aprueba freelance y crea su ficha');
reset role;
select public.t193_ok(
  (select u.activo and u.rol = 'freelance' and a.nit = '100193007' and a.tipo = 'freelance' and a.tipo_documento = 'CC'
     from public.usuarios u join public.aliados a on a.id = u.aliado_id
    where u.id = '19300000-0000-0000-0000-000000000009')
  and (select estado = 'aprobada' from public.b2b_solicitudes where id = 1930007),
  'T22b ficha creada con los datos de la solicitud y enlazada');
select public.t193_ok((select estado = 'pendiente' from public.b2b_solicitudes where id = 1930006),
  'T22c aprobar otra solicitud del mismo correo no tocó la que falló');

-- ── T23 · Rechazo ─────────────────────────────────────────────────────────
set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a1');
select public.rechazar_solicitud_b2b(1930008);
select public.t193_debe_fallar($q$select public.aprobar_solicitud_b2b(1930008)$q$, '55000', 'T23a no se aprueba una rechazada');
select public.t193_debe_fallar($q$select public.rechazar_solicitud_b2b(1930008)$q$, '55000', 'T23b no se rechaza dos veces');
reset role;
select public.t193_ok(
  (select estado = 'rechazada' and revisado_por = 'T193 Gerencia' from public.b2b_solicitudes where id = 1930008)
  and (select not activo from public.usuarios where id = '19300000-0000-0000-0000-000000000004'),
  'T23c rechazada y la cuenta sigue inactiva');

-- ── T25-T29 · "Aprobar sin enlazar" = sin histórico ───────────────────────
-- Ficha de un aliado ANTIGUO y tres solicitantes: dos con su MISMO nombre
-- (homónimos; la solicitud trae como sugerencia la ficha antigua) y una
-- cuenta inactiva que ya traía ficha y bandera legacy (dato viejo o manual).
insert into public.aliados (id, nombre, nit, tipo) values (1939001, 'Viajes Antiguos T193', '900193900', 'agencia');
insert into auth.users (id, email, raw_user_meta_data) values
  ('19300000-0000-0000-0000-000000000020', 't193.homonimo@t',    '{"rol":"agencia","nombre":"Viajes Antiguos T193"}'),
  ('19300000-0000-0000-0000-000000000021', 't193.homonimo2@t',   '{"rol":"agencia","nombre":"Viajes Antiguos T193"}'),
  ('19300000-0000-0000-0000-000000000022', 't193.preenlazada@t', '{"rol":"agencia","nombre":"Preenlazada T193"}'),
  ('19300000-0000-0000-0000-0000000000a5', 't193.superadmin@t',  '{"nombre":"T193 Super"}');
update public.usuarios set rol = 'superadmin', activo = true where id = '19300000-0000-0000-0000-0000000000a5';
update public.usuarios set aliado_id = 1939001, acceso_legacy_nombre = true
 where id = '19300000-0000-0000-0000-000000000022';
insert into public.b2b_solicitudes (id, tipo, nombre, nit, tipo_documento, email, estado, usuario_id, aliado_sugerido_id) values
  (1930020, 'agencia', 'Viajes Antiguos T193', '900193900', 'NIT', 't193.homonimo@t',    'pendiente', '19300000-0000-0000-0000-000000000020', 1939001),
  (1930021, 'agencia', 'Viajes Antiguos T193', '900193900', 'NIT', 't193.homonimo2@t',   'pendiente', '19300000-0000-0000-0000-000000000021', 1939001),
  (1930022, 'agencia', 'Preenlazada T193',     '900193922', 'NIT', 't193.preenlazada@t', 'pendiente', '19300000-0000-0000-0000-000000000022', null);

select public.t193_ok(
  (select column_default = 'false' and is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios' and column_name = 'acceso_legacy_nombre')
  and (select bool_and(not acceso_legacy_nombre) from public.usuarios
        where id in ('19300000-0000-0000-0000-000000000020', '19300000-0000-0000-0000-000000000021',
                     '19300000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000007')),
  'T25 acceso_legacy_nombre nace false (registro, alta directa, OAuth)');

set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a1');  -- gerencia
select public.aprobar_solicitud_b2b(1930020, 'ninguno');
select public.aprobar_solicitud_b2b(1930022, 'ninguno');
select public.aprobar_solicitud_b2b(1930021, 'ficha', 1939001);
reset role;
select public.t193_ok(
  (select activo and aliado_id is null and not acceso_legacy_nombre from public.usuarios
    where id = '19300000-0000-0000-0000-000000000020'),
  'T26 homónimo aprobado "ninguno": sin ficha (aunque la sugerencia era la antigua) y sin legacy');
select public.t193_ok(
  (select activo and aliado_id is null and not acceso_legacy_nombre from public.usuarios
    where id = '19300000-0000-0000-0000-000000000022'),
  'T27 cuenta inactiva con aliado_id y bandera previos: "ninguno" los limpia, no los conserva');
select public.t193_ok(
  (select activo and aliado_id = 1939001 and not acceso_legacy_nombre from public.usuarios
    where id = '19300000-0000-0000-0000-000000000021'),
  'T28 homónimo aprobado CON enlace explícito: queda con la ficha antigua (sí ve su histórico por id)');

-- T29 · Conceder la bandera: solo superadmin (RLS) o service-role.
set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a1');  -- gerencia
update public.usuarios set acceso_legacy_nombre = true where id = '19300000-0000-0000-0000-000000000020';
select public.t193_como('19300000-0000-0000-0000-000000000020');  -- el propio aliado, ya activo
update public.usuarios set acceso_legacy_nombre = true, aliado_id = 1939001 where id = '19300000-0000-0000-0000-000000000020';
reset role;
select public.t193_ok(
  (select aliado_id is null and not acceso_legacy_nombre from public.usuarios where id = '19300000-0000-0000-0000-000000000020'),
  'T29a ni gerencia ni el propio aliado pueden concederse ficha o bandera por la API');
set local role authenticated;
select public.t193_como('19300000-0000-0000-0000-0000000000a5');  -- superadmin
update public.usuarios set acceso_legacy_nombre = true where id = '19300000-0000-0000-0000-000000000020';
reset role;
select public.t193_ok(
  (select acceso_legacy_nombre from public.usuarios where id = '19300000-0000-0000-0000-000000000020'),
  'T29b superadmin sí puede concederla, explícitamente');

-- ── Permisos efectivos declarados (catálogo) ──────────────────────────────
select public.t193_ok(
  not has_table_privilege('anon', 'public.b2b_solicitudes', 'INSERT')
  and not has_table_privilege('anon', 'public.b2b_solicitudes', 'SELECT')
  and not has_table_privilege('authenticated', 'public.b2b_solicitudes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.b2b_solicitudes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.b2b_solicitudes', 'DELETE')
  and not has_table_privilege('authenticated', 'public.b2b_solicitudes', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.b2b_solicitudes', 'REFERENCES')
  and not has_table_privilege('authenticated', 'public.b2b_solicitudes', 'TRIGGER')
  and has_table_privilege('authenticated', 'public.b2b_solicitudes', 'SELECT')
  and not has_function_privilege('anon', 'public.aprobar_solicitud_b2b(bigint,text,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.rechazar_solicitud_b2b(bigint)', 'EXECUTE')
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'b2b_solicitudes') = 1
  and (select cmd from pg_policies where schemaname = 'public' and tablename = 'b2b_solicitudes') = 'SELECT',
  'T24 privilegios: authenticated solo SELECT (sin INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER); una sola policy (SELECT)');

\echo '== test_193: todas las comprobaciones pasaron'
rollback;
