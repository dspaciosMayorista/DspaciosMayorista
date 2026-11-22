-- ════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #62 B5/B6 (migración 324). Máquina de estados del registro B2B por código, llamada por las RPC REALES como service_role. SOLO base desechable, termina en ROLLBACK.
-- Uso (desde supabase/scripts, base con 001-324):  psql -v ON_ERROR_STOP=1 -f test_324_registro_candados.sql <base>
-- La CARRERA entre sesiones reales (candado de fila, esperas observadas en pg_locks) vive en real_62/registro_concurrente.mjs; aquí se prueban las reglas de cada transición.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql

create schema t324;
create function t324.rpc(p_sql text) returns text language sql volatile as $$ select t216.escalar('service_role', null, p_sql) $$;
create function t324.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-0000003240' || lpad(n::text, 2, '0'))::uuid $$;
-- Cuenta creada como la deja el paso 1: sin verificar, marcada por el flujo, inactiva, aliado agencia.
create function t324.cuenta(n int, p_rol text default 'agencia', p_activo boolean default false) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_app_meta_data) values (t324.uid(n), 'c324-' || n || '@x.test', '{"registro_b2b_codigo": true, "intentos_codigo": 0}'::jsonb) on conflict (id) do nothing;
  insert into public.usuarios (id, email, nombre, rol, activo, tenant) values (t324.uid(n), 'c324-' || n || '@x.test', 'C324 Aliado ' || n, p_rol::public.rol_usuario, p_activo, 'mayorista')
    on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, nombre = excluded.nombre;
end $$;
create function t324.confirmar(n int) returns void language sql as $$ update auth.users set email_confirmed_at = now() where id = t324.uid(n) $$;
create function t324.estado(n int) returns text language sql stable as $$
  select estado || '/' || reclamados || '/' || fallos || '/' || en_vuelo from public.registro_b2b_estado where usuario_id = t324.uid(n) $$;
create function t324.datos() returns jsonb language sql immutable as $$
  select '{"nit":"324001","tipo_documento":"NIT","contacto":"Persona 324","telefono":"3000000","ciudad":"Cali","notas":"n","acepta_notificaciones":true}'::jsonb $$;

-- ── A. Reservar intentos: 5 reservas y la sexta espera (hay intentos sin resolver) ──────────────────────────────────────────────────────────────────────
select t324.cuenta(1);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(1), t324.datos()));
select t216.afirma('A1 iniciar crea la fila pendiente 0/0/0', t324.estado(1) = 'pendiente/0/0/0', t324.estado(1));
select t216.afirma('A2 cinco reservas devuelven ok', (select count(*) filter (where r = 'ok') = 5 from (select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(1))) r from generate_series(1, 5)) x));
select t216.afirma('A3 la sexta espera («en_curso»): hay cinco sin resolver, no se agotó nada', t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(1))) = 'en_curso', t324.estado(1));
select t216.afirma('A4 con intentos sin resolver NO se autoriza el borrado («ocupado»)', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(1))) = 'ocupado', t324.estado(1));

-- ── B. Cinco rechazos definitivos: el quinto BORRA la cuenta sin verificar en la misma llamada (atómico); después ya no hay nada que reservar ─────────────────────────────────────
select t216.afirma('B1 los cuatro primeros fallos devuelven «fallo»', (select count(*) filter (where r = 'fallo') = 4 from (select t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(1))) r from generate_series(1, 4)) x), t324.estado(1));
select set_config('t324.b2', t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(1))), true);
select t216.afirma('B2 el quinto fallo devuelve «descartada» y la cuenta, su perfil y su estado YA NO existen (borrado atómico, sin paso intermedio)',
  current_setting('t324.b2') = 'descartada' and not exists (select 1 from auth.users where id = t324.uid(1)) and not exists (select 1 from public.usuarios where id = t324.uid(1))
  and not exists (select 1 from public.registro_b2b_estado where usuario_id = t324.uid(1)), current_setting('t324.b2'));
select t216.afirma('B3 tras el borrado: reservar, descartar y completar → «sin_cuenta»; resolver → «sin_registro»',
  t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(1))) = 'sin_cuenta' and t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(1))) = 'sin_cuenta' and t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(1))) = 'sin_cuenta'
  and t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''exito'')', t324.uid(1))) = 'sin_registro');

-- ── C. B5: el código correcto gana a una limpieza por fallos ─────────────────────────────────────────────────────────────────────────────────────────────
select t324.cuenta(2);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(2), t324.datos()));
do $$ declare i int; begin for i in 1 .. 4 loop perform t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(2))); perform t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(2))); end loop; end $$;
select t216.afirma('C1 cuatro fallos resueltos y ninguno en vuelo (4/4/0)', t324.estado(2) = 'pendiente/4/4/0', t324.estado(2));
select set_config('t324.c_ok', t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(2))), true);   -- intento correcto, en vuelo
select t216.afirma('C2 el quinto intento queda reservado (ok) y una limpieza simultánea NO puede borrar («ocupado»)',
  current_setting('t324.c_ok') = 'ok' and t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(2))) = 'ocupado', t324.estado(2));
select t324.confirmar(2);   -- Auth confirma el correo con el código correcto
select t216.afirma('C3 el intento incorrecto simultáneo llega DESPUÉS de la verificación: NO descarta, informa «verificado»',
  t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(2))) = 'verificado', t324.estado(2));
select t216.afirma('C4 el éxito se resuelve igual («verificado») y descartar JAMÁS autoriza el borrado',
  t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''exito'')', t324.uid(2))) = 'verificado' and t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(2))) = 'verificado', t324.estado(2));
select t216.afirma('C5 aun con el contador en 5 fallos, una cuenta confirmada no se descarta',
  (select t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(2))) = 'verificado'));

-- ── D. Reinicio del registro: la base borra SOLO si el correo sigue sin confirmar; sin fila (cuenta anterior a la 324) también se protege ─────────────────────────────────────────
select t324.cuenta(3);
select t324.confirmar(3);
select set_config('t324.d1', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(3))), true);   -- (la lectura del estado va en otra sentencia: ve la fila ya creada)
select t216.afirma('D1 cuenta confirmada SIN fila (anterior a la 324): descartar → «verificado», la cuenta SIGUE ahí y se crea la fila', current_setting('t324.d1') = 'verificado' and t324.estado(3) like 'verificado/%' and exists (select 1 from auth.users where id = t324.uid(3)), t324.estado(3));
select t324.cuenta(4);
select set_config('t324.d2', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(4))), true);
select t216.afirma('D2 cuenta sin verificar y sin intentos en vuelo (reinicio): descartar → «borrada» y la cuenta ya no existe', current_setting('t324.d2') = 'borrada' and not exists (select 1 from auth.users where id = t324.uid(4)), current_setting('t324.d2'));
select t324.cuenta(5);
select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(5)));
update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = t324.uid(5);
select set_config('t324.d3', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(5))), true);
select t216.afirma('D3 un intento reservado hace más de 2 minutos (la app murió) no bloquea el reinicio: «borrada» (la cuenta nunca se confirmó)', current_setting('t324.d3') = 'borrada' and not exists (select 1 from auth.users where id = t324.uid(5)), current_setting('t324.d3'));
select t324.cuenta(6);
do $$ declare i int; begin for i in 1 .. 5 loop perform t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(6))); end loop; end $$;
update public.registro_b2b_estado set fallos = 4, ultimo_reclamo = now() - interval '3 minutes' where usuario_id = t324.uid(6);
select set_config('t324.d4', t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(6))), true);
select t216.afirma('D4 una reserva vencida NO se convierte en rechazo: con 4 fallos reales y 5 reservas vencidas la siguiente reserva da «ok» y los fallos siguen en 4 (no se inventa el quinto)',
  current_setting('t324.d4') = 'ok' and (select fallos = 4 from public.registro_b2b_estado where usuario_id = t324.uid(6)) and exists (select 1 from auth.users where id = t324.uid(6)), t324.estado(6));

-- ── D bis. VERIFICACIÓN TARDÍA (B5 residual): el tiempo no prueba que Auth terminó; el borrado atómico decide por el estado REAL de la cuenta en ese instante ─────────────────────
-- (a) la verificación ya iniciada confirma el correo DESPUÉS de que su reserva «venció» y ANTES del reinicio: el reinicio no borra y la cuenta queda verificada y completable.
select t324.cuenta(30);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(30), t324.datos()));
select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(30)));
update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = t324.uid(30);   -- «vencida»: la edad NO prueba que Auth haya terminado
select t324.confirmar(30);                                                                                              -- la verificación tardía de Auth completa ahora
select set_config('t324.l1', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(30))), true);
select t216.afirma('L1 verificación tardía confirmada antes del reinicio: descartar → «verificado» (NO borra), la cuenta sigue y queda verificada', current_setting('t324.l1') = 'verificado' and exists (select 1 from auth.users where id = t324.uid(30) and email_confirmed_at is not null), current_setting('t324.l1'));
select set_config('t324.l2', t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(30))), true);
select t216.afirma('L2 y el registro se COMPLETA sin pérdida (la solicitud se crea una vez)', current_setting('t324.l2') = 'creada' and (select count(*) = 1 from public.b2b_solicitudes where usuario_id = t324.uid(30)), current_setting('t324.l2'));
-- (b) el reinicio gana la carrera: borra; la confirmación tardía ya no encuentra la cuenta (0 filas) y nunca queda una cuenta confirmada borrada ni una solicitud huérfana.
select t324.cuenta(31);
select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(31)));
update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = t324.uid(31);
select set_config('t324.l3', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(31))), true);
do $$ declare n int; begin update auth.users set email_confirmed_at = now() where id = t324.uid(31); get diagnostics n = row_count; perform set_config('t324.l3n', n::text, true); end $$;   -- la confirmación tardía de Auth
select t216.afirma('L3 el reinicio gana: «borrada»; la confirmación tardía actualiza 0 filas y la cuenta no reaparece', current_setting('t324.l3') = 'borrada' and current_setting('t324.l3n') = '0' and not exists (select 1 from auth.users where id = t324.uid(31)), current_setting('t324.l3') || '/' || current_setting('t324.l3n'));
select t216.afirma('L4 el resultado tardío de ese intento («exito») no resucita nada: «sin_registro»; completar → «sin_cuenta»; ninguna solicitud',
  t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''exito'')', t324.uid(31))) = 'sin_registro' and t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(31))) = 'sin_cuenta' and not exists (select 1 from public.b2b_solicitudes where usuario_id = t324.uid(31)));
-- (c) quinto rechazo en vuelo cuando Auth ya confirmó: el rechazo registrado no borra («verificado»), aunque la reserva sea vieja.
select t324.cuenta(32);
do $$ declare i int; begin for i in 1 .. 4 loop perform t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(32))); perform t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(32))); end loop; end $$;
select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(32)));
update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = t324.uid(32);
select t324.confirmar(32);
select t216.afirma('L5 cuatro rechazos + un intento que Auth confirma tarde: el quinto registro de rechazo y la reserva siguiente dan «verificado», la cuenta no se borra',
  t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(32))) = 'verificado' and t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(32))) = 'verificado' and exists (select 1 from auth.users where id = t324.uid(32)));
-- (d) cinco rechazos reales y una reserva vencida: se agota y se borra (liveness: no queda atascado) pero solo por rechazos DEFINITIVOS.
select t324.cuenta(33);
do $$ declare i int; begin for i in 1 .. 5 loop perform t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(33))); perform t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(33))); end loop; end $$;
select t216.afirma('L6 cinco rechazos definitivos: la cuenta sin verificar ya no existe (borrada por el quinto) y no hay estado huérfano', not exists (select 1 from auth.users where id = t324.uid(33)) and not exists (select 1 from public.registro_b2b_estado where usuario_id = t324.uid(33)));

-- ── E. Intentos limitados por frecuencia no cuentan; sin registro no hay estado inventado ───────────────────────────────────────────────────────────────
select t324.cuenta(7);
select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(7)));
select set_config('t324.e1', t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''omitido'')', t324.uid(7))), true);
select t216.afirma('E1 «omitido» devuelve el cupo (0 reservados, 0 en vuelo)', current_setting('t324.e1') = 'omitido' and t324.estado(7) = 'pendiente/0/0/0', t324.estado(7));
select t216.afirma('E2 resolver sobre una cuenta sin fila → «sin_registro»', t324.rpc(format('select public.registro_b2b_resolver_intento(%L, ''fallo'')', t324.uid(99))) = 'sin_registro');
select t216.afirma('E3 la semilla de cuentas anteriores respeta el tope (p_previos = 9 → 5/5)', t324.rpc(format('select public.registro_b2b_reclamar_intento(%L, 5, 9)', t324.uid(2))) = 'verificado');
select t324.cuenta(8);
select t216.afirma('E4 semilla de una cuenta anterior sin fila: p_previos = 4 deja UN intento (ok y luego en_curso)',
  t324.rpc(format('select public.registro_b2b_reclamar_intento(%L, 5, 4)', t324.uid(8))) = 'ok' and t324.rpc(format('select public.registro_b2b_reclamar_intento(%L, 5, 4)', t324.uid(8))) = 'en_curso', t324.estado(8));

-- ── F. B6: completar es idempotente, exige verificación EN LA BASE y nunca borra ────────────────────────────────────────────────────────────────────────
select t324.cuenta(10);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(10), t324.datos()));
select t216.afirma('F1 sin correo confirmado: «sin_verificar» y NO se crea solicitud',
  t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(10))) = 'sin_verificar' and not exists (select 1 from public.b2b_solicitudes where usuario_id = t324.uid(10)));
select t324.confirmar(10);
select t216.afirma('F2 confirmado: «creada» (primera vez)', t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(10))) = 'creada');
select t216.afirma('F3 la solicitud nace pendiente con los datos del servidor (tipo, nombre, documento, contacto, teléfono, ciudad, notificaciones)',
  (select count(*) = 1 and bool_and(estado = 'pendiente' and tipo = 'agencia' and nombre = 'C324 Aliado 10' and nit = '324001' and tipo_documento = 'NIT' and contacto = 'Persona 324'
     and telefono = '3000000' and ciudad = 'Cali' and email = 'c324-10@x.test' and acepta_notificaciones) from public.b2b_solicitudes where usuario_id = t324.uid(10)));
select t216.afirma('F4 repetir (respuesta perdida, doble clic, reintento): «ya_existia» y SIGUE habiendo UNA solicitud',
  t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(10))) = 'ya_existia' and (select count(*) = 1 from public.b2b_solicitudes where usuario_id = t324.uid(10)));
select t216.afirma('F5 el estado queda «completado» y los datos del formulario se borran del estado', (select estado = 'completado' and datos is null from public.registro_b2b_estado where usuario_id = t324.uid(10)));
select t216.afirma('F6 completado no se descarta jamás', t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(10))) = 'completado');
-- Reanudación tras un fallo POSTERIOR a la verificación: la cuenta quedó «pendiente» en el estado pero Auth ya confirmó (se perdió la resolución): completar igual funciona.
select t324.cuenta(11);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(11), t324.datos()));
select t324.rpc(format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(11)));
select t324.confirmar(11);
select t216.afirma('F7 verificación sin resolver (la app falló justo después de Auth): completar → «creada» sin borrar nada',
  t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(11))) = 'creada' and exists (select 1 from auth.users where id = t324.uid(11)) and exists (select 1 from public.usuarios where id = t324.uid(11)));
-- Alcance: nunca para cuentas que no son de este flujo.
select t324.cuenta(12, 'agencia', true); select t324.confirmar(12);
select t216.afirma('F8 cuenta ACTIVA (ya aprobada): «no_aplica», sin solicitud', t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(12))) = 'no_aplica' and not exists (select 1 from public.b2b_solicitudes where usuario_id = t324.uid(12)));
select t324.cuenta(13, 'superadmin', false); select t324.confirmar(13);
select t216.afirma('F9 rol que no es agencia/freelance: «no_aplica»', t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(13))) = 'no_aplica');
insert into auth.users (id, email) values (t324.uid(14), 'c324-14@x.test') on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values (t324.uid(14), 'c324-14@x.test', 'C324 Aliado 14', 'agencia', false, 'mayorista') on conflict (id) do update set rol = 'agencia', activo = false;
select t324.confirmar(14);
select t216.afirma('F10 cuenta SIN el marcador del flujo (creada por otra vía): «no_aplica»', t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(14))) = 'no_aplica');
select t216.afirma('F11 usuario inexistente: no se inventa registro («sin_cuenta»), sin solicitud', t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(98))) = 'sin_cuenta');

-- Sugerencia de ficha del catálogo por documento (solo si es inequívoca)
insert into public.aliados (id, nombre, nit, tipo) values (932401, 'C324 Ficha única', '324001', 'agencia') on conflict (id) do nothing;
select t324.cuenta(15); select t324.confirmar(15);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(15), t324.datos()));
select t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(15)));
select t216.afirma('F12 documento con UNA ficha: queda como SUGERENCIA (no se enlaza el usuario)',
  (select aliado_sugerido_id = 932401 from public.b2b_solicitudes where usuario_id = t324.uid(15)) and (select aliado_id is null from public.usuarios where id = t324.uid(15)));
insert into public.aliados (id, nombre, nit, tipo) values (932402, 'C324 Ficha duplicada', '324001', 'agencia') on conflict (id) do nothing;
select t324.cuenta(16); select t324.confirmar(16);
select t324.rpc(format('select public.registro_b2b_iniciar(%L, %L::jsonb)', t324.uid(16), t324.datos()));
select t324.rpc(format('select public.registro_b2b_completar(%L)', t324.uid(16)));
select t216.afirma('F13 documento con DOS fichas: sin sugerencia', (select aliado_sugerido_id is null from public.b2b_solicitudes where usuario_id = t324.uid(16)));

-- ── G. Reenvío ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select t324.cuenta(20); select t324.cuenta(21); select t324.confirmar(21); select t324.cuenta(22);
select t324.rpc(format('select public.registro_b2b_descartar(%L)', t324.uid(22)));   -- la borra
select t216.afirma('G1 reenviar: pendiente sin verificar → true', t324.rpc(format('select public.registro_b2b_permitir_reenvio(%L)', t324.uid(20))) = 'true');
select t216.afirma('G2 reenviar: correo ya confirmado → false', t324.rpc(format('select public.registro_b2b_permitir_reenvio(%L)', t324.uid(21))) = 'false');
select t216.afirma('G3 reenviar: cuenta ya borrada por el reinicio → false', t324.rpc(format('select public.registro_b2b_permitir_reenvio(%L)', t324.uid(22))) = 'false');

-- ── H. Solo service_role: ni anon ni authenticated ejecutan ni leen ──────────────────────────────────────────────────────────────────────────────────
select t216.rechaza('H1 anon no ejecuta reclamar', t216.escalar('anon', null, format('select public.registro_b2b_reclamar_intento(%L)', t324.uid(20))), 'permission denied');
select t216.rechaza('H2 authenticated no ejecuta descartar', t216.escalar('authenticated', t324.uid(20), format('select public.registro_b2b_descartar(%L)', t324.uid(20))), 'permission denied');
select t216.rechaza('H3 authenticated no ejecuta completar', t216.escalar('authenticated', t324.uid(20), format('select public.registro_b2b_completar(%L)', t324.uid(20))), 'permission denied');
select t216.rechaza('H4 authenticated no ejecuta resolver', t216.escalar('authenticated', t324.uid(20), format('select public.registro_b2b_resolver_intento(%L, ''exito'')', t324.uid(20))), 'permission denied');
select t216.rechaza('H5 authenticated no lee la tabla de estado', t216.escalar('authenticated', t324.uid(20), 'select count(*)::text from public.registro_b2b_estado'), 'permission denied');
select t216.rechaza('H6 anon no lee la tabla de estado', t216.escalar('anon', null, 'select count(*)::text from public.registro_b2b_estado'), 'permission denied');
select t216.afirma('H7 service_role sí ejecuta y lee', t324.rpc('select count(*)::text from public.registro_b2b_estado')::int >= 1);

select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_324: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
