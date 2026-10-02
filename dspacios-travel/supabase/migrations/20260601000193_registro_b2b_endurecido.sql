-- ───────────────────────────────────────────────────────────────────────────
-- 193 · Registro y aprobación B2B endurecidos (sin flujo nuevo)
--
-- Mismo flujo de siempre: /portal/registro crea la cuenta + una solicitud
-- "pendiente"; /dashboard/usuarios/b2b la aprueba o la rechaza. Esta migración
-- cierra cuatro huecos de ese flujo:
--
-- 1) TRIGGER DE ALTA (`handle_new_user`, migraciones 001/007).
--    Convertía `raw_user_meta_data->>'rol'` directamente en el rol del perfil,
--    con `activo` en su default (true). Esa metadata la escribe QUIEN SE
--    REGISTRA: `supabase.auth.signUp({ options: { data: { rol: 'superadmin' }}})`
--    con la llave anónima creaba un superadmin ACTIVO si el proyecto acepta
--    registros. Además, un alta por Google (OAuth) sin metadata nacía 'venta'
--    activa (ve contratos de su agencia), y el perfil B2B del registro nacía
--    ACTIVO hasta que la Server Action lo desactivaba (intervalo activo).
--    Ahora:
--      · TODO perfil nace con `activo = false`. Sin excepciones.
--      · De la metadata solo se acepta 'agencia' o 'freelance' (roles externos,
--        y además inactivos). Cualquier otro valor —incluidos los privilegiados
--        o basura que antes hacía fallar el cast— se ignora y el perfil nace
--        'cliente_final' (el rol de menor alcance).
--      · Se retira el "primer usuario = superadmin" (007): en una base vacía
--        esa regla le regalaba superadmin a la primera alta directa. El primer
--        superadmin de una base nueva se activa desde el editor SQL.
--    Quien crea cuentas internas o accesos aprobados (crearUsuario,
--    cargue B2B del CRM, agentes del portal, atajo de pruebas) ya no depende
--    del trigger: escribe rol y `activo` explicitamente con service-role.
--    Un perfil inactivo no tiene rol para la RLS (`mi_rol()`, migración 140)
--    y no puede activarse a sí mismo: en `usuarios` solo superadmin escribe
--    (policy "usuarios: superadmin gestiona", migración 005).
--
-- 2) INSERT PÚBLICO EN `b2b_solicitudes` (migración 074).
--    La policy "registro público" (`with check (true)`) dejaba a anon insertar
--    filas arbitrarias por la API REST, saltándose las validaciones del
--    registro (y con cualquier `estado`/`usuario_id`). El registro inserta con
--    service-role, así que esa policy sobraba. Se elimina, y la gestión
--    administrativa pasa de `for all` a SOLO LECTURA: las escrituras de estado
--    van únicamente por las dos funciones de abajo.
--
-- 3) APROBACIÓN (`aprobar_solicitud_b2b`). Antes buscaba el perfil por CORREO
--    y lo reasignaba/activaba sin mirar estado ni errores; una solicitud podía
--    aprobarse dos veces y quedar "aprobada" aunque la activación fallara.
--    Ahora, en una sola transacción y con la fila bloqueada (FOR UPDATE):
--      · exige permiso (mismos roles que el módulo b2b) dentro de la función;
--      · exige `estado = 'pendiente'` (una segunda aprobación falla);
--      · identifica la cuenta por `usuario_id`, nunca por correo, y exige que
--        el correo de la cuenta (usuarios y auth.users) coincida con el de la
--        solicitud;
--      · exige que esa cuenta sea un aliado B2B pendiente: rol = tipo de la
--        solicitud (agencia/freelance) y `activo = false`. No reasigna ni
--        activa ningún otro perfil;
--      · comprueba filas afectadas: si la activación o el cambio de estado no
--        afectan exactamente 1 fila, aborta todo (nada queda a medias, ni la
--        ficha "nueva" del catálogo).
--
-- 4) RECHAZO (`rechazar_solicitud_b2b`): mismo candado y solo desde
--    'pendiente' (no se puede "rechazar" algo ya aprobado).
--
-- 5) "APROBAR SIN ENLAZAR" SIGNIFICA SIN HISTÓRICO.
--    El portal B2B y los documentos por URL (cuenta de cobro, estado de
--    cuenta, plan de cobro, recibo) se leen con service-role y resolvían la
--    pertenencia también por NOMBRE para toda cuenta sin ficha: una cuenta
--    aprobada "sin enlazar" con el mismo nombre que un aliado antiguo veía sus
--    contratos. Ahora:
--      · `usuarios.acceso_legacy_nombre` (boolean, default false) es la ÚNICA
--        puerta del respaldo por nombre. La aplicación lo exige junto con rol
--        agencia/freelance, cuenta activa, contrato SIN ningún id (incluida
--        una ficha en CUALQUIER comisión manual, verificada fail-closed) y
--        tenant EXPLÍCITO e IGUAL entre usuario y contrato: el nombre nunca
--        cruza Mayorista/Minorista (los vínculos por id sí, como antes)
--        (lib/auth/accesoDocumentoContrato.ts y lib/auth/contratosPortalB2B.ts).
--      · La única evidencia por nombre son `ventas.agencia_nombre` y
--        `ventas.freelance_nombre`. El texto libre `aliados_b2b.aliado` NO
--        abre nada (antes abría la cuenta de cobro, pero no el portal ni el
--        estado de cuenta). Esos contratos se recuperan enlazando por id.
--      · Ninguna cuenta lo recibe sola: nace false y la aprobación lo deja en
--        false. Solo lo escribe superadmin/service-role, explícitamente.
--      · La aprobación fija `usuarios.aliado_id` EXACTAMENTE a lo elegido:
--        'ninguno' (o 'sugerido' sin sugerencia) lo deja en NULL aunque la
--        cuenta inactiva trajera uno de antes.
--    ⚠️ ESTA MIGRACIÓN NO HACE BACKFILL de `acceso_legacy_nombre`. Sin
--    backfill, los aliados ya activos que hoy ven contratos SOLO por nombre
--    dejan de verlos al desplegar. Decidir antes de publicar (ver
--    preflight_193, consulta D, y las opciones documentadas en la entrega).
--
-- ⚠️ ORDEN DE DESPLIEGUE: correr esta migración ANTES de desplegar el código
-- que llama a las RPC. El código nuevo de alta interna escribe `activo`
-- explícito y funciona con el trigger viejo o el nuevo; el de aprobación
-- necesita las funciones. Mientras tanto, el código viejo de aprobación seguirá
-- funcionando con service-role (no depende de la policy eliminada) y el viejo
-- `crearUsuario` dejaría INACTIVOS los usuarios internos que cree en ese
-- intervalo (se activan con el interruptor de /dashboard/usuarios).
--
-- ⚠️ ANTES DE CORRERLA (solo lectura): supabase/scripts/preflight_193_registro_b2b_lectura.sql
-- lista las solicitudes pendientes que la aprobación nueva rechazaría (sin
-- cuenta, correo distinto, cuenta ya activa o con otro rol) y los perfiles
-- activos que pudieron nacer por alta directa/OAuth con el trigger viejo.
--
-- Rollback: supabase/scripts/rollback_193_registro_b2b_endurecido.sql
-- (reabre los huecos; usar solo para volver a un estado conocido).
-- Pruebas (base LOCAL desechable): supabase/scripts/pruebas/test_193_registro_b2b.sh
-- ───────────────────────────────────────────────────────────────────────────
begin;

-- ── 1) Trigger de alta ─────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Solo para ELEGIR entre los dos roles externos. Nunca se castea el texto
  -- libre a `rol_usuario`: se compara contra una lista cerrada.
  v_tipo text := lower(btrim(coalesce(new.raw_user_meta_data->>'rol', '')));
  v_rol  public.rol_usuario;
begin
  if v_tipo = 'agencia' then
    v_rol := 'agencia';
  elsif v_tipo = 'freelance' then
    v_rol := 'freelance';
  else
    v_rol := 'cliente_final';
  end if;

  insert into public.usuarios (id, email, nombre, rol, activo)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'nombre'), ''), split_part(new.email, '@', 1)),
    v_rol,
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- (Sin revoke sobre esta función: una función de trigger no puede invocarse
-- directamente, y no se toca nada que pueda interferir con las altas que hace
-- Supabase Auth.)

-- ── 1b) Puerta explícita del respaldo legacy por nombre ────────────────────
alter table public.usuarios
  add column if not exists acceso_legacy_nombre boolean not null default false;
comment on column public.usuarios.acceso_legacy_nombre is
  'Migración 193: única puerta del respaldo legacy por NOMBRE (portal B2B y documentos por URL). Default false; nunca se concede al registrarse ni al aprobar. Solo superadmin/service-role, explícitamente.';

-- ── 2) b2b_solicitudes: sin INSERT público; gestión solo lectura ───────────
drop policy if exists "b2b_solicitudes: registro público" on public.b2b_solicitudes;
drop policy if exists "b2b_solicitudes: gestión admin" on public.b2b_solicitudes;
drop policy if exists "b2b_solicitudes: lectura admin" on public.b2b_solicitudes;
create policy "b2b_solicitudes: lectura admin" on public.b2b_solicitudes for select
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia'));

-- Defensa en profundidad: aunque sin policy de escritura la RLS ya niega, se
-- retira el privilegio de tabla (TRUNCATE ni siquiera pasa por RLS). anon no
-- tiene nada que hacer aquí. A authenticated se le deja EXACTAMENTE SELECT:
-- se revoca todo (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER y,
-- en Postgres 17, MAINTAIN) y se vuelve a conceder solo la lectura, que la
-- policy filtra. service_role conserva todo (registro).
revoke all on public.b2b_solicitudes from public, anon;
revoke all on public.b2b_solicitudes from authenticated;
grant select on public.b2b_solicitudes to authenticated;
revoke all on sequence public.b2b_solicitudes_id_seq from public, anon, authenticated;

-- ── 3) Aprobación atómica ──────────────────────────────────────────────────
-- p_modo:
--   'sugerido' → enlaza con `aliado_sugerido_id` de la solicitud; sin
--                sugerencia se comporta como 'ninguno'
--   'ficha'    → enlaza con p_aliado_id (debe existir en `aliados`)
--   'nueva'    → crea la ficha en `aliados` con los datos de la solicitud
--   'ninguno'  → aprueba SIN enlazar: `aliado_id` queda NULL (aunque la cuenta
--                trajera uno) y `acceso_legacy_nombre` en false. No obtiene
--                contratos históricos ni por ficha ni por nombre.
create or replace function public.aprobar_solicitud_b2b(
  p_id bigint,
  p_modo text default 'sugerido',
  p_aliado_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sol        public.b2b_solicitudes%rowtype;
  v_email_perf text;
  v_rol_perf   public.rol_usuario;
  v_act_perf   boolean;
  v_email_auth text;
  v_aliado     bigint;
  v_quien      text;
  v_n          integer;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('superadmin', 'administracion', 'gerencia') then
    raise exception 'No tienes permiso para aprobar registros B2B.' using errcode = '42501';
  end if;

  select * into v_sol from public.b2b_solicitudes where id = p_id for update;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'P0002';
  end if;
  if v_sol.estado is distinct from 'pendiente' then
    raise exception 'La solicitud ya fue procesada (estado: %).', v_sol.estado using errcode = '55000';
  end if;
  if v_sol.tipo not in ('agencia', 'freelance') then
    raise exception 'Tipo de solicitud inválido.' using errcode = '22023';
  end if;
  if v_sol.usuario_id is null then
    raise exception 'La solicitud no tiene una cuenta asociada; no se puede aprobar. Pide al aliado que se registre de nuevo.' using errcode = '55000';
  end if;

  select email, rol, activo into v_email_perf, v_rol_perf, v_act_perf
    from public.usuarios where id = v_sol.usuario_id for update;
  if not found then
    raise exception 'La cuenta asociada a la solicitud ya no existe.' using errcode = '55000';
  end if;
  select email into v_email_auth from auth.users where id = v_sol.usuario_id;
  if lower(btrim(coalesce(v_email_perf, ''))) <> lower(btrim(v_sol.email))
     or lower(btrim(coalesce(v_email_auth, ''))) <> lower(btrim(v_sol.email)) then
    raise exception 'El correo de la cuenta no coincide con el de la solicitud; no se aprueba.' using errcode = '55000';
  end if;
  if v_rol_perf::text <> v_sol.tipo then
    raise exception 'La cuenta asociada no es un aliado B2B pendiente (rol %); no se reasigna.', v_rol_perf using errcode = '55000';
  end if;
  if v_act_perf then
    raise exception 'La cuenta asociada ya está activa; no se aprueba desde esta solicitud.' using errcode = '55000';
  end if;

  if p_modo = 'sugerido' then
    v_aliado := v_sol.aliado_sugerido_id;
  elsif p_modo = 'ficha' then
    if p_aliado_id is null or not exists (select 1 from public.aliados where id = p_aliado_id) then
      raise exception 'La ficha de aliado elegida no existe.' using errcode = '22023';
    end if;
    v_aliado := p_aliado_id;
  elsif p_modo = 'nueva' then
    insert into public.aliados (nombre, nit, tipo_documento, tipo, email, telefono, contacto)
    values (
      v_sol.nombre, v_sol.nit,
      coalesce(nullif(btrim(v_sol.tipo_documento), ''), case when v_sol.tipo = 'agencia' then 'NIT' else 'CC' end),
      v_sol.tipo, v_sol.email, v_sol.telefono, v_sol.contacto
    )
    returning id into v_aliado;
  elsif p_modo = 'ninguno' then
    v_aliado := null;
  else
    raise exception 'Modo de enlace inválido.' using errcode = '22023';
  end if;

  -- El enlace queda EXACTAMENTE como lo eligió quien aprueba: con 'ninguno'
  -- (o 'sugerido' sin sugerencia) `aliado_id` queda NULL aunque la cuenta
  -- trajera uno de antes. Y nunca se concede el respaldo legacy por nombre.
  update public.usuarios
     set activo = true,
         aliado_id = v_aliado,
         acceso_legacy_nombre = false
   where id = v_sol.usuario_id
     and activo = false
     and rol::text = v_sol.tipo;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo activar la cuenta (filas afectadas: %).', v_n using errcode = '55000';
  end if;

  select coalesce(nullif(btrim(nombre), ''), email) into v_quien
    from public.usuarios where id = auth.uid();

  update public.b2b_solicitudes
     set estado = 'aprobada',
         revisado_por = v_quien,
         revisado_at = now(),
         aliado_sugerido_id = coalesce(v_aliado, aliado_sugerido_id)
   where id = p_id
     and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo marcar la solicitud como aprobada (filas afectadas: %).', v_n using errcode = '55000';
  end if;

  return jsonb_build_object('usuario_id', v_sol.usuario_id, 'aliado_id', v_aliado);
end;
$$;

revoke all on function public.aprobar_solicitud_b2b(bigint, text, bigint) from public, anon;
grant execute on function public.aprobar_solicitud_b2b(bigint, text, bigint) to authenticated;

-- ── 4) Rechazo: solo desde 'pendiente' ─────────────────────────────────────
create or replace function public.rechazar_solicitud_b2b(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_quien  text;
  v_n      integer;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('superadmin', 'administracion', 'gerencia') then
    raise exception 'No tienes permiso para gestionar registros B2B.' using errcode = '42501';
  end if;

  select estado into v_estado from public.b2b_solicitudes where id = p_id for update;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'P0002';
  end if;
  if v_estado is distinct from 'pendiente' then
    raise exception 'La solicitud ya fue procesada (estado: %).', v_estado using errcode = '55000';
  end if;

  select coalesce(nullif(btrim(nombre), ''), email) into v_quien
    from public.usuarios where id = auth.uid();

  update public.b2b_solicitudes
     set estado = 'rechazada', revisado_por = v_quien, revisado_at = now()
   where id = p_id and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo rechazar la solicitud (filas afectadas: %).', v_n using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.rechazar_solicitud_b2b(bigint) from public, anon;
grant execute on function public.rechazar_solicitud_b2b(bigint) to authenticated;

commit;
