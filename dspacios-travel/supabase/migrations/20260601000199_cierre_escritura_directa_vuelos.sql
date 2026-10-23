-- ═══════════════════════════════════════════════════════════════════════════
-- 199 · Fase C: cierre de la escritura directa de `sillas` y `bloqueos_vuelo`
--       (diseño docs/futuro/traslado-cupos-y-mover-pasajero.md §4.4, §6.5,
--       §6.8.2 y §12, paso 7)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ NO EJECUTAR antes de la BARRERA B→C (diseño §6.5 y §6.8.3). Requiere 192,
-- 194, 195, 196 y 197 aplicadas y el código que ya no escribe directo (fase B)
-- DESPLEGADO Y VERIFICADO EN PRODUCCIÓN. La base es la misma para Producción y
-- para todos los Preview: con esta migración activa, cualquier despliegue con
-- código anterior a B (Producción incluida, o un Preview sin rebasar) deja de
-- poder crear/eliminar records, cambiar sillas o mover pasajeros.
-- Antes de retroceder Vercel a un despliegue anterior a B: revertir PRIMERO
-- esta migración (supabase/scripts/rollback_199_cierre_escritura_directa.sql).
--
-- Qué cierra, para los roles de cliente de la API (`authenticated` y `anon`):
--
--   sillas
--     · INSERT, DELETE y TRUNCATE: privilegio de tabla revocado y, además,
--       rechazados por el trigger (por si alguien vuelve a conceder el privilegio).
--     · UPDATE: solo columnas del grupo D (datos operativos del pasajero, más
--       `updated_at`) y solo en sillas SIN contrato (`numero_contrato` y
--       `contrato_manual` vacíos). Cualquier otra columna —estructura (id,
--       bloqueo_id, numero_silla, created_at), vínculo y ocupación (estado,
--       numero_contrato, contrato_manual) o una columna NUEVA que se agregue en
--       el futuro— queda rechazada: el trigger lista lo PERMITIDO, así que una
--       columna sin clasificar falla cerrada.
--     · Una silla `retirada` no admite ningún cambio.
--   bloqueos_vuelo
--     · INSERT, DELETE y TRUNCATE: revocados y rechazados por el trigger
--       (los records se crean y eliminan con crear_bloqueo / eliminar_bloqueo).
--     · UPDATE: todo lo demás del record sigue editable (actualizarBloqueo,
--       cambio operacional, control), salvo `id` y `cupos_total`.
--   Policies: la `FOR ALL` de la 137 se reemplaza por una `FOR UPDATE` con
--   los roles de vuelos y AUT-1 (superadmin o agencia mayorista). La lectura
--   no cambia.
--
-- Quién queda exento (igual que el diseño, hasta la fase D):
--   · las funciones SECURITY DEFINER del dueño (dentro de ellas
--     current_user = dueño): reservas, confirmación, liberaciones, traslados,
--     mover, retirar, crear/eliminar record, renumerar contrato, fusionar
--     destino…;
--   · `service_role` (copia de datos al reservar W8, cron).
--
-- Por qué el trigger es SECURITY INVOKER: necesita ver el current_user de quien
-- escribe. Uno SECURITY DEFINER vería siempre al dueño y no distinguiría nada.
--
-- Error de la guarda: SQLSTATE 42501 con mensaje 'GUARDA_ESCRITURA: …'. El
-- prefijo distingue un rechazo de la guarda de uno de la RLS o del privilegio
-- (que también usan 42501 con otro mensaje).
--
-- Cambio de comportamiento a tener en cuenta: con AUT-1 en la policy de
-- UPDATE, un usuario de Minorista ya no actualiza `bloqueos_vuelo` (tampoco por
-- `actualizar_control_bloqueo`, que es INVOKER y depende de esta policy). El
-- módulo de vuelos es de la mayorista; lo mismo pasaba ya con las funciones de
-- la 194/195.
--
-- Si se corrió el modo aviso opcional (supabase/scripts/c0_aviso_guarda_escritura.sql),
-- esta migración retira sus triggers; la tabla de avisos se conserva como evidencia.
--
-- Idempotente. Rollback: supabase/scripts/rollback_199_cierre_escritura_directa.sql.
-- Postcheck (solo lectura): supabase/scripts/postcheck_199_cierre_escritura_directa.sql.
-- Pruebas locales: supabase/scripts/test_cierre_escritura_directa.sql.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Precondición: la fase B-bis está en la base ─────────────────────────────
do $$
begin
  if to_regprocedure('public.crear_bloqueo(jsonb, integer)') is null
     or to_regprocedure('public.eliminar_bloqueo(bigint)') is null
     or to_regprocedure('public.trasladar_cupos(bigint, bigint, integer, text, uuid)') is null
     or to_regprocedure('public._vaciar_sillas(bigint[], text)') is null
     or to_regprocedure('public.confirmar_venta(text)') is null then
    raise exception 'La 199 requiere las migraciones 194, 195, 196 y 197 aplicadas.';
  end if;
end $$;

-- ── Retirar el modo aviso C0 si se había instalado ──────────────────────────
drop trigger if exists sillas_aviso_escritura on public.sillas;
drop trigger if exists bloqueos_aviso_cupos on public.bloqueos_vuelo;
drop function if exists public._c0_sillas_aviso_escritura();
drop function if exists public._c0_bloqueos_aviso_cupos();
drop function if exists public._c0_registrar_aviso(text, text, text, bigint, text);

-- ── Guarda de `sillas` ──────────────────────────────────────────────────────
create or replace function public._sillas_guarda_escritura()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Grupo D: lo ÚNICO que un rol de cliente puede cambiar, y solo sin contrato.
  c_datos constant text[] := array[
    'pasajero_nombres', 'pasajero_apellidos', 'tipo_doc', 'numero_doc', 'nacimiento',
    'asesor', 'agencia', 'hotel', 'acomodacion', 'plazo',
    'inf_nombres', 'inf_apellidos', 'inf_tipo_doc', 'inf_numero', 'inf_nacimiento',
    'responsable_menor', 'updated_at'];
  v_old jsonb;
  v_new jsonb;
  v_prohibidas text;
  v_datos text;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception using errcode = '42501',
      message = 'GUARDA_ESCRITURA: las sillas no se crean por la API (use crear_bloqueo).';
  elsif tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'GUARDA_ESCRITURA: las sillas no se borran por la API (use retirar_cupo o eliminar_bloqueo).';
  end if;

  if old.estado = 'retirada' then
    raise exception using errcode = '42501',
      message = format('GUARDA_ESCRITURA: la silla %s está retirada y no admite cambios.', old.id);
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  select string_agg(k, ', ' order by k) filter (where not (k = any (c_datos))),
         string_agg(k, ', ' order by k) filter (where k = any (c_datos))
    into v_prohibidas, v_datos
    from jsonb_object_keys(v_new) as t(k)
   where v_new -> k is distinct from v_old -> k;

  if v_prohibidas is not null then
    raise exception using errcode = '42501',
      message = format('GUARDA_ESCRITURA: la silla %s no admite cambios directos en %s (use las funciones de vuelos).',
                       old.id, v_prohibidas);
  end if;

  if v_datos is not null
     and (nullif(btrim(old.numero_contrato), '') is not null
          or nullif(btrim(old.contrato_manual), '') is not null) then
    raise exception using errcode = '42501',
      message = format('GUARDA_ESCRITURA: la silla %s tiene contrato; sus datos se editan con editar_pasajero_silla.', old.id);
  end if;

  return new;
end $$;

comment on function public._sillas_guarda_escritura() is
  'Fase C (199): a authenticated/anon solo les deja cambiar datos (grupo D) de sillas sin contrato; '
  'rechaza INSERT, DELETE, columnas no clasificadas y sillas retiradas con 42501 GUARDA_ESCRITURA. '
  'SECURITY INVOKER a propósito: el dueño (funciones DEFINER) y service_role quedan exentos.';

drop trigger if exists sillas_guarda_escritura on public.sillas;
create trigger sillas_guarda_escritura
  before insert or update or delete on public.sillas
  for each row execute function public._sillas_guarda_escritura();

-- TRUNCATE no dispara triggers por fila: barrera por sentencia.
create or replace function public._vuelos_guarda_truncate()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception using errcode = '42501',
      message = format('GUARDA_ESCRITURA: %s no se vacía por la API.', tg_table_name);
  end if;
  return null;
end $$;

drop trigger if exists sillas_guarda_truncate on public.sillas;
create trigger sillas_guarda_truncate
  before truncate on public.sillas
  for each statement execute function public._vuelos_guarda_truncate();

-- ── Guarda de `bloqueos_vuelo` ──────────────────────────────────────────────
create or replace function public._bloqueos_guarda_cupos()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception using errcode = '42501',
      message = 'GUARDA_ESCRITURA: los records no se crean por la API (use crear_bloqueo).';
  elsif tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'GUARDA_ESCRITURA: los records no se borran por la API (use eliminar_bloqueo).';
  end if;

  if new.id is distinct from old.id then
    raise exception using errcode = '42501',
      message = format('GUARDA_ESCRITURA: el record %s no admite cambiar su id.', old.id);
  end if;
  if new.cupos_total is distinct from old.cupos_total then
    raise exception using errcode = '42501',
      message = format('GUARDA_ESCRITURA: cupos_total del record %s solo cambia por trasladar_cupos, mover_pasajero o retirar_cupo.', old.id);
  end if;

  return new;
end $$;

comment on function public._bloqueos_guarda_cupos() is
  'Fase C (199): a authenticated/anon les rechaza INSERT, DELETE y cambiar id o cupos_total de bloqueos_vuelo '
  '(42501 GUARDA_ESCRITURA). El resto del record sigue editable. SECURITY INVOKER a propósito.';

drop trigger if exists bloqueos_guarda_cupos on public.bloqueos_vuelo;
create trigger bloqueos_guarda_cupos
  before insert or update or delete on public.bloqueos_vuelo
  for each row execute function public._bloqueos_guarda_cupos();

drop trigger if exists bloqueos_guarda_truncate on public.bloqueos_vuelo;
create trigger bloqueos_guarda_truncate
  before truncate on public.bloqueos_vuelo
  for each statement execute function public._vuelos_guarda_truncate();

revoke all on function public._sillas_guarda_escritura() from public, anon, authenticated;
revoke all on function public._bloqueos_guarda_cupos() from public, anon, authenticated;
revoke all on function public._vuelos_guarda_truncate() from public, anon, authenticated;

-- ── Privilegios de tabla ────────────────────────────────────────────────────
-- authenticated conserva UPDATE (grupo D de sillas y el resto del record).
-- anon no escribe nada en estas tablas.
revoke insert, delete, truncate on public.sillas from authenticated, anon;
revoke insert, delete, truncate on public.bloqueos_vuelo from authenticated, anon;
revoke update on public.sillas from anon;
revoke update on public.bloqueos_vuelo from anon;

-- ── Policies: FOR ALL (137) → FOR UPDATE con AUT-1 ──────────────────────────
drop policy if exists "sillas: escritura control" on public.sillas;
drop policy if exists "sillas: edicion directa (AUT-1)" on public.sillas;
create policy "sillas: edicion directa (AUT-1)" on public.sillas
  for update to authenticated
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo')
         and (public.mi_rol() = 'superadmin' or public.mi_tenant() = 'mayorista'))
  with check (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo')
         and (public.mi_rol() = 'superadmin' or public.mi_tenant() = 'mayorista'));

drop policy if exists "bloqueos: escritura control" on public.bloqueos_vuelo;
drop policy if exists "bloqueos: edicion directa (AUT-1)" on public.bloqueos_vuelo;
create policy "bloqueos: edicion directa (AUT-1)" on public.bloqueos_vuelo
  for update to authenticated
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo')
         and (public.mi_rol() = 'superadmin' or public.mi_tenant() = 'mayorista'))
  with check (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo')
         and (public.mi_rol() = 'superadmin' or public.mi_tenant() = 'mayorista'));

