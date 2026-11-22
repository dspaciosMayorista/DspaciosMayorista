-- 324 · #62 (correcciones B5/B6): coordinación del registro B2B por código en el SERVIDOR DE DATOS.
-- B5 — antes, el contador de intentos se leía/sumaba/escribía desde la app (app_metadata) y la limpieza borraba la cuenta con una lectura vieja: un código correcto
-- y uno incorrecto simultáneos podían dejar la cuenta recién VERIFICADA borrada. Ahora cada transición (reclamar intento, resolverlo, descartar, reenviar, completar)
-- es una función SECURITY DEFINER que toma el candado de FILA de `registro_b2b_estado` (select … for update) y decide con el estado ACTUAL, nunca con una lectura anterior.
-- B5 residual (verificación tardía) — el TIEMPO no prueba que una verificación externa haya terminado: una petición a Auth ya iniciada puede confirmar el correo mucho después.
-- Por eso NINGUNA autorización de borrado depende de la edad de un intento. El borrado lo HACE la propia base, en la MISMA transacción y con la condición «correo SIN confirmar»
-- evaluada por la sentencia que borra (`delete from auth.users where id = … and email_confirmed_at is null`): la confirmación de Auth es un UPDATE de esa misma fila, que toma el mismo
-- candado, así que o gana la confirmación (el borrado no encuentra fila y la cuenta queda VERIFICADA) o gana el borrado (la verificación tardía ya no encuentra la cuenta y falla).
-- Nunca queda una cuenta confirmada borrada, ni una cuenta «autorizada a borrar» esperando un borrado aparte desde la app (esa ventana ya no existe).
-- Los intentos reservados que nunca se resuelven (la app murió, resultado desconocido) se LIBERAN pasado un tiempo SIN contarse como fallos; el tiempo solo decide si se espera o no, jamás si es seguro borrar.
-- B6 — la creación de la solicitud de aprobación es idempotente y reanudable: `registro_b2b_completar` valida la verificación EN LA BASE (auth.users) y crea la solicitud una sola vez;
-- si algo falla después de verificar, la cuenta queda verificada y se completa luego (la app exige correo + contraseña como prueba de titularidad; saber el correo no basta).
-- Solo service_role (código de servidor): sin políticas RLS y sin permisos para anon/authenticated. Cuentas existentes y sin fila: se crean perezosamente; NADA retroactivo.
-- Requiere que el dueño de las funciones pueda borrar de auth.users (en Supabase lo hace el rol que corre las migraciones); el preflight lo verifica. Aditiva e idempotente.
begin;

do $$
begin
  if to_regclass('public.usuarios') is null or to_regclass('public.b2b_solicitudes') is null or to_regclass('public.aliados') is null then
    raise exception '324 ABORTADA: faltan public.usuarios, public.b2b_solicitudes o public.aliados.';
  end if;
end $$;

create table if not exists public.registro_b2b_estado (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'verificado', 'completado')),
  -- Intentos de código: reclamados (reservados antes de llamar a Auth), fallos (resueltos como rechazo definitivo de Auth) y en vuelo (reservados sin resolver todavía).
  reclamados integer not null default 0 check (reclamados >= 0),
  fallos integer not null default 0 check (fallos >= 0),
  en_vuelo integer not null default 0 check (en_vuelo >= 0),
  ultimo_reclamo timestamptz,
  -- Datos del formulario capturados por el SERVIDOR en el paso 1 (sin contraseña); permiten completar la solicitud sin volver a pedirlos. Se borran al completar.
  datos jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.registro_b2b_estado is '#62 B5/B6: estado serializado del registro B2B por código. Solo service_role vía las funciones registro_b2b_*; sin políticas.';

alter table public.registro_b2b_estado enable row level security;
revoke all on table public.registro_b2b_estado from public, anon, authenticated;
grant select, insert, update, delete on table public.registro_b2b_estado to service_role;

-- ¿Auth ya confirmó el correo? (autoridad única; el navegador nunca lo decide)
create or replace function public.p324_correo_confirmado(p_usuario uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce((select email_confirmed_at is not null from auth.users where id = p_usuario), false);
end $$;

-- ÚNICO punto que borra una cuenta del registro. Una sola sentencia atómica: borra SOLO si el correo sigue sin confirmar en el instante del borrado.
-- Devuelve: borrada | verificado (existe y está confirmada: NO se toca) | sin_cuenta (ya no existe). La fila de estado, usuarios y lo que cuelga de auth.users caen en cascada.
create or replace function public.p324_borrar_sin_verificar(p_usuario uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from auth.users where id = p_usuario and email_confirmed_at is null;
  get diagnostics n = row_count;
  if n = 1 then return 'borrada'; end if;
  if exists (select 1 from auth.users where id = p_usuario) then
    update public.registro_b2b_estado set estado = case when estado = 'completado' then estado else 'verificado' end, actualizado_en = now() where usuario_id = p_usuario;
    return 'verificado';
  end if;
  return 'sin_cuenta';
end $$;

-- Paso 1: cuenta nueva creada por el servidor.
create or replace function public.registro_b2b_iniciar(p_usuario uuid, p_datos jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.registro_b2b_estado (usuario_id, datos) values (p_usuario, p_datos) on conflict (usuario_id) do nothing;
  return 'ok';
end $$;

-- Reservar un intento ANTES de llamar a Auth. Devuelve: ok | verificado | completado | agotado (cinco rechazos: la cuenta sin verificar ya se borró) | en_curso | sin_cuenta.
-- p_previos solo siembra cuentas anteriores a esta migración (sin fila): su contador viejo de app_metadata.
create or replace function public.registro_b2b_reclamar_intento(p_usuario uuid, p_max integer default 5, p_previos integer default 0)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.registro_b2b_estado%rowtype; n integer := least(greatest(coalesce(p_previos, 0), 0), p_max); v text;
begin
  if not exists (select 1 from auth.users where id = p_usuario) then return 'sin_cuenta'; end if;
  begin
    insert into public.registro_b2b_estado (usuario_id, reclamados, fallos) values (p_usuario, n, n) on conflict (usuario_id) do nothing;
  exception when foreign_key_violation then return 'sin_cuenta';   -- la cuenta la borró otra sesión entre la comprobación y el alta
  end;
  select * into r from public.registro_b2b_estado where usuario_id = p_usuario for update;
  if not found then return 'sin_cuenta'; end if;   -- la cuenta se borró entre la comprobación y el candado
  if r.estado in ('verificado', 'completado') then return r.estado; end if;
  if public.p324_correo_confirmado(p_usuario) then
    update public.registro_b2b_estado set estado = 'verificado', actualizado_en = now() where usuario_id = p_usuario;
    return 'verificado';
  end if;
  -- Un reclamo sin resolver por más de 2 minutos (la app murió o el resultado se perdió) se LIBERA sin contarse como fallo: el cupo vuelve, pero no se «inventa» un rechazo
  -- (si esa verificación llega a confirmar el correo más tarde, la cuenta sigue ahí y queda verificada).
  if r.en_vuelo > 0 and r.ultimo_reclamo < now() - interval '2 minutes' then
    r.reclamados := greatest(r.reclamados - r.en_vuelo, r.fallos); r.en_vuelo := 0;
    update public.registro_b2b_estado set reclamados = r.reclamados, en_vuelo = 0, actualizado_en = now() where usuario_id = p_usuario;
  end if;
  if r.reclamados >= p_max then
    if r.fallos >= p_max then
      v := public.p324_borrar_sin_verificar(p_usuario);
      return case v when 'borrada' then 'agotado' when 'verificado' then 'verificado' else 'sin_cuenta' end;
    end if;
    return 'en_curso';
  end if;
  update public.registro_b2b_estado
     set reclamados = r.reclamados + 1, en_vuelo = r.en_vuelo + 1, ultimo_reclamo = now(), actualizado_en = now()
   where usuario_id = p_usuario;
  return 'ok';
end $$;

-- Resolver un intento reservado. p_resultado: exito | fallo (rechazo DEFINITIVO de Auth) | omitido (limitación de frecuencia o resultado desconocido: no cuenta).
-- Devuelve: verificado | completado | fallo | descartada (quinto rechazo: la cuenta sin verificar se borró aquí, atómicamente) | omitido | sin_registro.
create or replace function public.registro_b2b_resolver_intento(p_usuario uuid, p_resultado text, p_max integer default 5)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.registro_b2b_estado%rowtype; v text;
begin
  select * into r from public.registro_b2b_estado where usuario_id = p_usuario for update;
  if not found then return 'sin_registro'; end if;
  if p_resultado = 'exito' then
    update public.registro_b2b_estado
       set en_vuelo = greatest(en_vuelo - 1, 0), estado = case when estado = 'pendiente' then 'verificado' else estado end, actualizado_en = now()
     where usuario_id = p_usuario returning estado into r.estado;
    return r.estado;
  elsif p_resultado = 'omitido' then
    update public.registro_b2b_estado
       set en_vuelo = greatest(en_vuelo - 1, 0), reclamados = greatest(reclamados - 1, 0), actualizado_en = now()
     where usuario_id = p_usuario;
    return 'omitido';
  end if;
  -- fallo
  update public.registro_b2b_estado set en_vuelo = greatest(en_vuelo - 1, 0), actualizado_en = now() where usuario_id = p_usuario;
  if r.estado in ('verificado', 'completado') then return r.estado; end if;
  if public.p324_correo_confirmado(p_usuario) then
    update public.registro_b2b_estado set estado = 'verificado' where usuario_id = p_usuario;
    return 'verificado';
  end if;
  update public.registro_b2b_estado set fallos = fallos + 1 where usuario_id = p_usuario returning fallos into r.fallos;
  if r.fallos >= p_max then
    v := public.p324_borrar_sin_verificar(p_usuario);
    return case v when 'borrada' then 'descartada' when 'verificado' then 'verificado' else 'sin_registro' end;
  end if;
  return 'fallo';
end $$;

-- Reinicio del registro / limpieza de una cuenta sin verificar. La base BORRA (atómicamente, solo si el correo sigue sin confirmar). Devuelve:
-- borrada | verificado | completado (NO se borró) | ocupado (hay una verificación reciente en vuelo: cortesía para no pisar a quien está verificando) | sin_cuenta.
-- «Reciente» es solo liveness: una reserva vieja no bloquea el reinicio, y aun así NO hay riesgo de borrar una cuenta confirmada tarde (la sentencia de borrado lo impide).
create or replace function public.registro_b2b_descartar(p_usuario uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.registro_b2b_estado%rowtype;
begin
  if not exists (select 1 from auth.users where id = p_usuario) then return 'sin_cuenta'; end if;
  begin
    insert into public.registro_b2b_estado (usuario_id) values (p_usuario) on conflict (usuario_id) do nothing;
  exception when foreign_key_violation then return 'sin_cuenta';
  end;
  select * into r from public.registro_b2b_estado where usuario_id = p_usuario for update;
  if not found then return 'sin_cuenta'; end if;
  if r.estado in ('verificado', 'completado') then return r.estado; end if;
  if r.en_vuelo > 0 and r.ultimo_reclamo >= now() - interval '2 minutes' then return 'ocupado'; end if;
  return public.p324_borrar_sin_verificar(p_usuario);
end $$;

-- ¿Se puede reenviar el código? Solo una cuenta pendiente y sin verificar (serializa con el descarte).
create or replace function public.registro_b2b_permitir_reenvio(p_usuario uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare e text;
begin
  select estado into e from public.registro_b2b_estado where usuario_id = p_usuario for share;
  return exists (select 1 from auth.users where id = p_usuario) and coalesce(e, 'pendiente') = 'pendiente' and not public.p324_correo_confirmado(p_usuario);
end $$;

-- Crear la solicitud de aprobación UNA sola vez. Devuelve: creada | ya_existia | sin_verificar | no_aplica | sin_cuenta.
-- Exige, EN LA BASE: correo confirmado por Auth, cuenta marcada por este flujo (registro_b2b_codigo), rol agencia/freelance e inactiva. Nunca borra nada.
create or replace function public.registro_b2b_completar(p_usuario uuid, p_datos jsonb default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.registro_b2b_estado%rowtype; u record; d jsonb; doc text; cand integer; sug bigint; marcada boolean; correo text;
begin
  if not exists (select 1 from auth.users where id = p_usuario) then return 'sin_cuenta'; end if;
  begin
    insert into public.registro_b2b_estado (usuario_id) values (p_usuario) on conflict (usuario_id) do nothing;
  exception when foreign_key_violation then return 'sin_cuenta';
  end;
  select * into r from public.registro_b2b_estado where usuario_id = p_usuario for update;
  if not found then return 'sin_cuenta'; end if;
  if not public.p324_correo_confirmado(p_usuario) then return 'sin_verificar'; end if;
  select coalesce((raw_app_meta_data ->> 'registro_b2b_codigo') = 'true', false), lower(btrim(email)) into marcada, correo from auth.users where id = p_usuario;
  select id, rol, nombre, activo into u from public.usuarios where id = p_usuario;
  if not found or not marcada or u.activo is distinct from false or u.rol not in ('agencia', 'freelance') then return 'no_aplica'; end if;
  if exists (select 1 from public.b2b_solicitudes where usuario_id = p_usuario) then
    update public.registro_b2b_estado set estado = 'completado', datos = null, actualizado_en = now() where usuario_id = p_usuario;
    return 'ya_existia';
  end if;
  d := coalesce(r.datos, p_datos, '{}'::jsonb);
  doc := nullif(btrim(coalesce(d ->> 'nit', '')), '');
  -- SUGERENCIA (no enlace) de la ficha del catálogo por documento, solo si es inequívoca (migración 143).
  if doc is not null then
    select count(*), min(id) into cand, sug from public.aliados where nit = doc;
    if cand <> 1 then sug := null; end if;
  end if;
  insert into public.b2b_solicitudes (tipo, nombre, nit, tipo_documento, aliado_sugerido_id, contacto, email, telefono, ciudad, notas, acepta_notificaciones, estado, usuario_id)
  values (
    u.rol, btrim(coalesce(u.nombre, d ->> 'nombre', '')), doc,
    coalesce(nullif(btrim(coalesce(d ->> 'tipo_documento', '')), ''), case when u.rol = 'agencia' then 'NIT' else 'CC' end),
    sug, nullif(btrim(coalesce(d ->> 'contacto', '')), ''), correo,
    nullif(btrim(coalesce(d ->> 'telefono', '')), ''), nullif(btrim(coalesce(d ->> 'ciudad', '')), ''), nullif(btrim(coalesce(d ->> 'notas', '')), ''),
    coalesce((d ->> 'acepta_notificaciones') = 'true', false), 'pendiente', p_usuario
  );
  update public.registro_b2b_estado set estado = 'completado', datos = null, actualizado_en = now() where usuario_id = p_usuario;
  return 'creada';
end $$;

revoke all on function public.p324_correo_confirmado(uuid) from public, anon, authenticated;
revoke all on function public.p324_borrar_sin_verificar(uuid) from public, anon, authenticated;
revoke all on function public.registro_b2b_iniciar(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.registro_b2b_reclamar_intento(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.registro_b2b_resolver_intento(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.registro_b2b_descartar(uuid) from public, anon, authenticated;
revoke all on function public.registro_b2b_permitir_reenvio(uuid) from public, anon, authenticated;
revoke all on function public.registro_b2b_completar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.p324_correo_confirmado(uuid) to service_role;
grant execute on function public.p324_borrar_sin_verificar(uuid) to service_role;
grant execute on function public.registro_b2b_iniciar(uuid, jsonb) to service_role;
grant execute on function public.registro_b2b_reclamar_intento(uuid, integer, integer) to service_role;
grant execute on function public.registro_b2b_resolver_intento(uuid, text, integer) to service_role;
grant execute on function public.registro_b2b_descartar(uuid) to service_role;
grant execute on function public.registro_b2b_permitir_reenvio(uuid) to service_role;
grant execute on function public.registro_b2b_completar(uuid, jsonb) to service_role;

commit;
