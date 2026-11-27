-- ═══════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #78 (migración 340). Aviso interno por una cotización pública (visitante sin sesión), por la RPC REAL y con avisos persistidos.
-- Política (decisión del dueño, 2026-11-24): destinatarios = quienes PUEDEN generar/asistir cotizaciones (rol y agencia según la RLS de `cotizaciones`); «atendida» = convertida a contrato;
-- leído/no leído es por persona. SOLO base desechable, termina en ROLLBACK. Se lanza con test_341_referidos.sh <contenedor> <plantilla> 340 (une las fixtures).
-- Esperado a mano para una cotización de mayorista: reciben super (global), admin, gerencia, oper, ventaA y ventaB (activos, rol permitido, agencia mayorista) = 6;
-- NO reciben adminMin ni ventaMin (otra agencia), vuelo (control_vuelo, sin acceso a cotizaciones), agencia (rol externo) ni inactivo.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql

create schema t340;
create function t340.cot(p_tipo text, p_creado_por text default null, p_tenant text default 'mayorista', p_estado text default 'abierta',
                         p_din boolean default false, p_armado boolean default false, p_creado_por_id uuid default null, p_aliado bigint default null) returns bigint
language plpgsql as $$
declare v bigint;
begin
  set local session_replication_role = replica;
  insert into public.cotizaciones (tipo, estado, payload, creado_por, creado_por_id, aliado_id, tenant, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, pax, paquete_din_id, paquete_armado_id)
  values (p_tipo, p_estado, '{}'::jsonb, p_creado_por, p_creado_por_id, p_aliado, p_tenant, 1000000, 'COP', current_date + 60, current_date + 63, current_date + 5, 2,
          case when p_din then 987001 end, case when p_armado then 987002 end)
  returning id into v;
  set local session_replication_role = origin;
  return v;
end $$;
create function t340.avisar(p_cot bigint) returns text language sql volatile as $$
  select t216.escalar('service_role', null, format('select public.avisar_cotizacion_publica(%s)::text', p_cot))
$$;
create function t340.n(p_cot bigint) returns bigint language sql stable as $$
  select count(*) from public.avisos where tipo = 'cotizacion_publica' and cotizacion_id = p_cot
$$;
create function t340.quienes(p_cot bigint) returns text language sql stable as $$
  select coalesce(string_agg(split_part(u.email, '@', 1), ',' order by u.email), '') from public.avisos a join public.usuarios u on u.id = a.usuario_id where a.tipo = 'cotizacion_publica' and a.cotizacion_id = p_cot
$$;
-- Quién puede LEER esa cotización con su sesión (RLS real de «cotizaciones: lectura»).
create function t340.puede_leer(p_k text, p_cot bigint) returns boolean language sql volatile as $$
  select t216.escalar('authenticated', t216.u(p_k), format('select count(*)::text from public.cotizaciones where id = %s', p_cot)) = '1'
$$;

-- A. Carrito de un visitante: avisa a quienes pueden generar/asistir cotizaciones en esa agencia (6), nadie más.
select set_config('t340.a', t340.cot('carrito')::text, true);
select set_config('t340.ra', t340.avisar(current_setting('t340.a')::bigint), true);
select t216.afirma('A1 avisada con 6 notificados', current_setting('t340.ra') like '%"estado": "avisada"%' and current_setting('t340.ra') like '%"notificados": 6%', current_setting('t340.ra'));
select t216.afirma('A2 reciben exactamente: super, admin, gerencia, oper, ventaA y ventaB (con cotizacion_id y el código como referencia)',
  t340.quienes(current_setting('t340.a')::bigint) = 'c216-admin,c216-gerencia,c216-oper,c216-super,c216-ventaA,c216-ventaB'
  and (select bool_and(tipo = 'cotizacion_publica' and cotizacion_id = current_setting('t340.a')::bigint and numero_contrato = (select codigo from public.cotizaciones where id = current_setting('t340.a')::bigint))
         from public.avisos where cotizacion_id = current_setting('t340.a')::bigint), t340.quienes(current_setting('t340.a')::bigint));
select t216.afirma('A3 NO reciben: otra agencia (adminMin, ventaMin), control_vuelo, aliado externo ni inactivo',
  not exists (select 1 from public.avisos where cotizacion_id = current_setting('t340.a')::bigint and usuario_id in (t216.u('adminMin'), t216.u('ventaMin'), t216.u('vuelo'), t216.u('agencia'), t216.u('inactivo'))));
select t216.afirma('A4 el aviso nace sin leer, sin reclamar y sin archivar', (select bool_and(leido_en is null and notificado_en is null and archivado_en is null) from public.avisos where cotizacion_id = current_setting('t340.a')::bigint));

-- A5. PARIDAD CON LA RLS: destinatarios == usuarios que pueden LEER la cotización con su sesión (nadie recibe un aviso de algo que no puede abrir; nadie que pueda abrirla se queda sin aviso).
do $$
declare k text; leer boolean; recibe boolean; mal text := '';
begin
  foreach k in array array['super', 'admin', 'gerencia', 'oper', 'ventaA', 'ventaB', 'adminMin', 'ventaMin', 'vuelo', 'agencia', 'inactivo'] loop
    leer := t340.puede_leer(k, current_setting('t340.a')::bigint);
    recibe := exists (select 1 from public.avisos where cotizacion_id = current_setting('t340.a')::bigint and usuario_id = t216.u(k));
    if leer is distinct from recibe then mal := mal || k || '(leer=' || leer || ',aviso=' || recibe || ') '; end if;
  end loop;
  perform t216.afirma('A5 destinatarios = quienes pueden leer la cotización por RLS (paridad exacta)', mal = '', mal);
end $$;

-- B. Repetir (reintento / doble clic / reparación por la misma clave de envío): idempotente.
select set_config('t340.rb', t340.avisar(current_setting('t340.a')::bigint), true);
select t216.afirma('B1 segunda llamada: 0 avisos nuevos', current_setting('t340.rb') like '%"notificados": 0%', current_setting('t340.rb'));
select t216.afirma('B2 siguen 6 avisos (uno por destinatario)', t340.n(current_setting('t340.a')::bigint) = 6);
select public.avisos_marcar_leidos(t216.u('admin'), null);
select t340.avisar(current_setting('t340.a')::bigint);
select t216.afirma('B3 tras leer y repetir: sigue 1 aviso de admin, leído', (select count(*) = 1 and bool_and(leido_en is not null) from public.avisos where cotizacion_id = current_setting('t340.a')::bigint and usuario_id = t216.u('admin')));

-- C. Los otros dos orígenes públicos: paquete dinámico del visitante y solicitud de hotel a solicitud.
select set_config('t340.c1', t340.cot('manual', null, 'mayorista', 'abierta', true, false)::text, true);
select set_config('t340.c2', t340.cot('tarifario', null, 'mayorista', 'pendiente_tarifa', false, true)::text, true);
select t340.avisar(current_setting('t340.c1')::bigint);
select t340.avisar(current_setting('t340.c2')::bigint);
select t216.afirma('C1 paquete dinámico del visitante avisa (6)', t340.n(current_setting('t340.c1')::bigint) = 6);
select t216.afirma('C2 solicitud de hotel pendiente_tarifa del visitante avisa (6)', t340.n(current_setting('t340.c2')::bigint) = 6);

-- D. NO aplica (misma respuesta, cero avisos): el aviso de B2C no se confunde con B2B, personal, convertidas ni de otra agencia.
select set_config('t340.d1', t340.cot('carrito', 'c216-agencia@x.test')::text, true);
select set_config('t340.d2', t340.cot('carrito', null, 'mayorista', 'abierta', false, false, t216.u('agencia'))::text, true);
select set_config('t340.d3', t340.cot('carrito', null, 'minorista')::text, true);
select set_config('t340.d4', t340.cot('carrito', null, 'mayorista', 'descartada')::text, true);
select set_config('t340.d5', t340.cot('manual')::text, true);        -- manual SIN paquete dinámico = cotización del personal
select set_config('t340.d6', t340.cot('tarifario')::text, true);     -- tarifario SIN paquete armado
select set_config('t340.d7', t340.cot('carrito')::text, true);
update public.cotizaciones set propietario_id = t216.u('agencia') where id = current_setting('t340.d7')::bigint;
select set_config('t340.d8', t340.cot('carrito')::text, true);
set local session_replication_role = replica;  -- el contrato real no se necesita: solo que la cotización figure convertida
update public.cotizaciones set numero_contrato = '00-9999' where id = current_setting('t340.d8')::bigint;
set local session_replication_role = origin;
select t216.afirma('D1 cotización con correo de autor (aliado/personal con sesión): no_aplica y 0 avisos', t340.avisar(current_setting('t340.d1')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d1')::bigint) = 0);
select t216.afirma('D2 con creado_por_id sellado: no_aplica', t340.avisar(current_setting('t340.d2')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d2')::bigint) = 0);
select t216.afirma('D3 de minorista: no_aplica (el tarifario público es solo de mayorista)', t340.avisar(current_setting('t340.d3')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d3')::bigint) = 0);
select t216.afirma('D4 descartada: no_aplica', t340.avisar(current_setting('t340.d4')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d4')::bigint) = 0);
select t216.afirma('D5 manual sin paquete dinámico: no_aplica', t340.avisar(current_setting('t340.d5')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d5')::bigint) = 0);
select t216.afirma('D6 tarifario sin paquete armado: no_aplica', t340.avisar(current_setting('t340.d6')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d6')::bigint) = 0);
select t216.afirma('D7 con propietario: no_aplica', t340.avisar(current_setting('t340.d7')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d7')::bigint) = 0);
select t216.afirma('D8 ya convertida en contrato: no_aplica', t340.avisar(current_setting('t340.d8')::bigint) like '%no_aplica%' and t340.n(current_setting('t340.d8')::bigint) = 0);
select t216.afirma('D9 id inexistente: no_aplica, sin error', t340.avisar(999999999) like '%no_aplica%');

-- E. La política YA NO depende de config_solicitudes (lista de correos): cambiarla o vaciarla no cambia los destinatarios.
update public.config_solicitudes set emails = null where id = 1;
select set_config('t340.e1', t340.cot('carrito')::text, true);
select t340.avisar(current_setting('t340.e1')::bigint);
select t216.afirma('E1 con la lista de correos VACÍA igual avisa a quienes pueden asistir (6)', t340.n(current_setting('t340.e1')::bigint) = 6);
update public.config_solicitudes set emails = 'c216-agencia@x.test, nadie@fuera.test' where id = 1;
select set_config('t340.e2', t340.cot('carrito')::text, true);
select t340.avisar(current_setting('t340.e2')::bigint);
select t216.afirma('E2 con una lista que nombra a un aliado externo NO se le avisa y los internos siguen avisados', t340.quienes(current_setting('t340.e2')::bigint) = 'c216-admin,c216-gerencia,c216-oper,c216-super,c216-ventaA,c216-ventaB', t340.quienes(current_setting('t340.e2')::bigint));
-- E3. Cambios de rol/agencia/estado se respetan en el aviso SIGUIENTE (no hay lista fija): un usuario desactivado ya no recibe; uno movido de agencia, tampoco.
update public.usuarios set activo = false where id = t216.u('ventaB');
update public.usuarios set tenant = 'minorista' where id = t216.u('oper');
select set_config('t340.e3', t340.cot('carrito')::text, true);
select t340.avisar(current_setting('t340.e3')::bigint);
select t216.afirma('E3 usuario desactivado y usuario movido a otra agencia ya no reciben', t340.quienes(current_setting('t340.e3')::bigint) = 'c216-admin,c216-gerencia,c216-super,c216-ventaA', t340.quienes(current_setting('t340.e3')::bigint));
update public.usuarios set activo = true where id = t216.u('ventaB');
update public.usuarios set tenant = 'mayorista' where id = t216.u('oper');

-- F. Compatibilidad: los tipos anteriores siguen admitidos y el tipo inválido no.
do $$ begin
  insert into public.avisos (usuario_id, tipo, numero_contrato) values (t216.u('admin'), 'soporte_pago_nuevo', '00-0001');
  insert into public.avisos (usuario_id, tipo, numero_contrato) values (t216.u('admin'), 'solicitud_contrato', 'COT-1');
  perform t216.afirma('F1 soporte_pago_nuevo y solicitud_contrato siguen admitidos', true);
exception when others then
  perform t216.afirma('F1 soporte_pago_nuevo y solicitud_contrato siguen admitidos', false, sqlerrm);
end $$;
do $$ begin
  begin
    insert into public.avisos (usuario_id, tipo, numero_contrato) values (t216.u('admin'), 'inventado', 'COT-1');
    perform t216.afirma('F2 un tipo desconocido se rechaza', false, 'se aceptó');
  exception when check_violation then
    perform t216.afirma('F2 un tipo desconocido se rechaza', true);
  end;
end $$;

-- G. Reclamar y leer siguen siendo operaciones distintas, también para el tipo nuevo.
select set_config('t340.g', (select count(*) from public.avisos_reclamar(t216.u('super'), 50) where tipo = 'cotizacion_publica')::text, true);
select t216.afirma('G1 reclamar entrega los avisos nuevos una sola vez', current_setting('t340.g')::int >= 1 and (select count(*) from public.avisos_reclamar(t216.u('super'), 50) where tipo = 'cotizacion_publica') = 0);
select t216.afirma('G2 reclamado no es leído', (select bool_and(notificado_en is not null and leido_en is null) from public.avisos where usuario_id = t216.u('super') and tipo = 'cotizacion_publica'));

-- H. «ATENDIDA» = convertida a contrato (estado convertida o numero_contrato), calculada en la misma consulta; leído/no leído es aparte; descartar NO es convertir.
select t216.afirma('H1 antes de convertir: ninguna atendida', (select count(*) filter (where atendida) = 0 and count(*) filter (where tipo = 'cotizacion_publica') >= 1 from public.avisos_recientes(t216.u('ventaA'), 50)));
update public.cotizaciones set estado = 'convertida' where id = current_setting('t340.a')::bigint;
select t216.afirma('H2 convertida (estado): atendida para TODOS sus destinatarios', (select bool_and(atendida) from public.avisos_recientes(t216.u('ventaA'), 50) where cotizacion_id = current_setting('t340.a')::bigint)
  and (select bool_and(atendida) from public.avisos_recientes(t216.u('gerencia'), 50) where cotizacion_id = current_setting('t340.a')::bigint));
select t216.afirma('H3 atendida NO significa leída: el aviso de ventaA sigue sin leer', (select bool_and(leido_en is null) from public.avisos where cotizacion_id = current_setting('t340.a')::bigint and usuario_id = t216.u('ventaA'))
  and (select bool_and(leido_en is null) from public.avisos_recientes(t216.u('ventaA'), 50) where cotizacion_id = current_setting('t340.a')::bigint));
select public.avisos_marcar_leidos(t216.u('admin'), null);
select t216.afirma('H4 leerlo no lo vuelve atendido (la cotización c1, sin convertir, leída por admin: atendida = false)', (select bool_and(not atendida) from public.avisos_recientes(t216.u('admin'), 50) where cotizacion_id = current_setting('t340.c1')::bigint)
  and (select bool_and(leido_en is not null) from public.avisos_recientes(t216.u('admin'), 50) where cotizacion_id = current_setting('t340.c1')::bigint));
set local session_replication_role = replica;  -- convertida por número de contrato (otro camino de conversión), sin tocar el estado
update public.cotizaciones set numero_contrato = '00-9998' where id = current_setting('t340.c2')::bigint;
set local session_replication_role = origin;
select t216.afirma('H5 convertida por numero_contrato: atendida', (select bool_and(atendida) from public.avisos_recientes(t216.u('ventaA'), 50) where cotizacion_id = current_setting('t340.c2')::bigint));
set local session_replication_role = replica;  -- la FK a un paquete de prueba se reevalúa al actualizar una fila creada en esta misma transacción
update public.cotizaciones set estado = 'descartada' where id = current_setting('t340.c1')::bigint;
set local session_replication_role = origin;
select t216.afirma('H6 DESCARTAR no es convertir: sigue sin atender', (select bool_and(not atendida) from public.avisos_recientes(t216.u('ventaA'), 50) where cotizacion_id = current_setting('t340.c1')::bigint));
select t216.afirma('H7 los avisos de otros tipos nunca figuran como atendidos (la solicitud de contrato B2B no cambia)', (select count(*) >= 1 and bool_and(not atendida) from public.avisos_recientes(t216.u('admin'), 50) where tipo <> 'cotizacion_publica'));
select t216.afirma('H8 avisos_recientes respeta el límite y trae solo los de esa persona', (select count(*) from public.avisos_recientes(t216.u('ventaA'), 2)) = 2
  and (select count(*) from public.avisos_recientes(t216.u('ventaA'), 50) r where not exists (select 1 from public.avisos x where x.id = r.id and x.usuario_id = t216.u('ventaA'))) = 0);
select t216.rechaza('H9 authenticated no ejecuta avisos_recientes', t216.escalar('authenticated', t216.u('admin'), format('select count(*)::text from public.avisos_recientes(%L, 10)', t216.u('admin'))), 'permission denied');

-- I. Solo service_role ejecuta las funciones y nadie con sesión lee `avisos` directamente.
select t216.rechaza('I1 anon no ejecuta la RPC', t216.escalar('anon', null, format('select public.avisar_cotizacion_publica(%s)::text', current_setting('t340.a'))), 'permission denied');
select t216.rechaza('I2 authenticated no ejecuta la RPC', t216.escalar('authenticated', t216.u('admin'), format('select public.avisar_cotizacion_publica(%s)::text', current_setting('t340.a'))), 'permission denied');
select t216.rechaza('I3 authenticated no lee avisos', t216.escalar('authenticated', t216.u('admin'), 'select count(*)::text from public.avisos'), 'permission denied');

select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_340: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
