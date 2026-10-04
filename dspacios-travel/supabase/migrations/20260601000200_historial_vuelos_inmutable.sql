-- ═══════════════════════════════════════════════════════════════════════════
-- 200 · Fase E: historial de vuelos inmutable (`movimientos_silla` y
--       `operaciones_vuelo`) — diseño docs/futuro/traslado-cupos-y-mover-pasajero.md
--       §4.4, §6.8.2 ("Historial") y §12, paso 9
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ NO EJECUTAR antes de la BARRERA PREVIA A E (diseño §6.5 y §6.8.3, paso 7):
-- ninguna versión desplegada (Producción ni Preview) puede escribir, editar ni
-- borrar el historial. El código anterior a la fase B borra `movimientos_silla`
-- (eliminarCupo, eliminarBloqueo) e inserta filas sin operación (cambiarSillas):
-- con esta migración activa esas acciones fallan. La base es compartida.
-- Antes de retroceder Vercel a un despliegue anterior a B: revertir PRIMERO
-- esta migración (supabase/scripts/rollback_200_historial_vuelos_inmutable.sql)
-- y después la 199.
--
-- Qué hace:
--   1. Policies: `movimientos_silla` pasa de `FOR ALL` (005/137) a SOLO
--      SELECT para los roles de vuelos (los mismos cinco de antes; la lectura
--      no cambia). `operaciones_vuelo` ya era solo SELECT (194).
--   2. Privilegios: INSERT, UPDATE, DELETE y TRUNCATE revocados en las dos
--      tablas a `authenticated`, `anon` y `service_role`. Solo las funciones
--      SECURITY DEFINER del dueño (194) insertan historial.
--   3. Trigger BEFORE INSERT OR UPDATE OR DELETE por fila en las dos tablas:
--      UPDATE y DELETE se rechazan SIEMPRE, también al dueño y a service_role
--      (la última barrera si alguien vuelve a conceder el privilegio); un
--      `DELETE` sin `WHERE` dispara el trigger en la primera fila y se revierte
--      entero. INSERT se rechaza a los roles de la API (authenticated, anon,
--      service_role) y se permite al dueño: así siguen insertando las funciones.
--   4. Trigger BEFORE TRUNCATE por sentencia en las dos tablas (TRUNCATE no
--      dispara triggers por fila).
--
-- Dos únicas salidas, ambas acotadas:
--   a) Mantenimiento: `set local app.correccion_historial = 'on'` en una
--      transacción revisada, ejecutada por el dueño o un administrador de la
--      base (nunca authenticated, anon ni service_role, aunque activen la
--      bandera). Ninguna función de la app la activa. El cambio queda en
--      `auditoria` (trigger 087 de movimientos_silla).
--   b) `mover_pasajero` (194) completa, en la MISMA transacción en que lo
--      insertó, `movimientos_silla.tramos_contrato_actualizados` (de NULL a un
--      número) cuando actualiza los tramos del contrato (D3-c). Se permite solo
--      si: cambia únicamente esa columna, el valor anterior es NULL, quien
--      escribe no es un rol de cliente, y la operación de la fila
--      (`operaciones_vuelo`) se creó en esta misma transacción
--      (`created_at = now()`, la hora de inicio de la transacción). Una fila
--      ya confirmada nunca vuelve a cambiar. Así no se edita la 194.
--
-- Riesgo residual (documentado en el diseño): un superusuario de la base puede
-- desactivar triggers (session_replication_role / disable trigger). Eso queda
-- fuera de la API y del alcance de la app.
--
-- Independiente de la 199: se puede activar antes o después, cada una con su
-- barrera. Requiere la 194.
-- Idempotente. Rollback: supabase/scripts/rollback_200_historial_vuelos_inmutable.sql.
-- Postcheck (solo lectura): supabase/scripts/postcheck_200_historial_vuelos_inmutable.sql.
-- Pruebas locales: supabase/scripts/test_historial_inmutable.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.operaciones_vuelo') is null
     or to_regprocedure('public.mover_pasajero(bigint, bigint, text, boolean, text, uuid)') is null then
    raise exception 'La 200 requiere la migración 194 aplicada.';
  end if;
end $$;

-- ── 1. Policies ─────────────────────────────────────────────────────────────
drop policy if exists "movimientos: registro operativo" on public.movimientos_silla;
drop policy if exists "movimientos: lectura vuelos" on public.movimientos_silla;
create policy "movimientos: lectura vuelos" on public.movimientos_silla
  for select
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'));

-- ── 2. Privilegios ──────────────────────────────────────────────────────────
revoke insert, update, delete, truncate on public.movimientos_silla from authenticated, anon, service_role;
revoke insert, update, delete, truncate on public.operaciones_vuelo from authenticated, anon, service_role;

-- ── 3. Trigger de inmutabilidad por fila ────────────────────────────────────
create or replace function public._historial_vuelos_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cliente boolean := current_user in ('authenticated', 'anon', 'service_role');
  v_dif text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    if v_cliente then
      raise exception using errcode = '42501',
        message = format('HISTORIAL_INMUTABLE: %s solo se escribe desde las funciones de vuelos.', tg_table_name);
    end if;
    return new;
  end if;

  -- a) Corrección de mantenimiento revisada (nunca desde la API).
  if not v_cliente and current_setting('app.correccion_historial', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- b) mover_pasajero completa tramos_contrato_actualizados en su transacción.
  -- (Las columnas se leen por jsonb: el mismo trigger sirve a operaciones_vuelo,
  -- que no tiene tramos_contrato_actualizados, y PL/pgSQL no cortocircuita el AND.)
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if tg_table_name = 'movimientos_silla' and not v_cliente then
      if jsonb_typeof(v_old -> 'tramos_contrato_actualizados') = 'null'
         and jsonb_typeof(v_new -> 'tramos_contrato_actualizados') = 'number'
         and (v_new - 'tramos_contrato_actualizados') = (v_old - 'tramos_contrato_actualizados')
         and exists (select 1 from public.operaciones_vuelo o
                      where o.operacion_id = (v_old ->> 'operacion_id')::uuid
                        and o.created_at = now()) then
        return new;
      end if;
    end if;
    select string_agg(k, ', ' order by k) into v_dif
      from jsonb_object_keys(v_new) as t(k)
     where v_new -> k is distinct from v_old -> k;
  end if;

  raise exception using errcode = '42501',
    message = format('HISTORIAL_INMUTABLE: %s no admite %s%s.',
                     tg_table_name, tg_op,
                     case when v_dif is not null then ' (' || v_dif || ')' else '' end);
end $$;

comment on function public._historial_vuelos_inmutable() is
  'Fase E (200): rechaza UPDATE y DELETE de movimientos_silla/operaciones_vuelo para todos, dueño incluido, '
  'e INSERT para authenticated/anon/service_role '
  '(42501 HISTORIAL_INMUTABLE). Salidas: app.correccion_historial=on fuera de los roles de la API, y '
  'tramos_contrato_actualizados NULL→valor de una operación creada en la misma transacción (mover_pasajero).';

drop trigger if exists movimientos_historial_inmutable on public.movimientos_silla;
create trigger movimientos_historial_inmutable
  before insert or update or delete on public.movimientos_silla
  for each row execute function public._historial_vuelos_inmutable();

drop trigger if exists operaciones_historial_inmutable on public.operaciones_vuelo;
create trigger operaciones_historial_inmutable
  before insert or update or delete on public.operaciones_vuelo
  for each row execute function public._historial_vuelos_inmutable();

-- ── 4. TRUNCATE ─────────────────────────────────────────────────────────────
create or replace function public._historial_vuelos_sin_truncate()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon', 'service_role')
     and current_setting('app.correccion_historial', true) = 'on' then
    return null;
  end if;
  raise exception using errcode = '42501',
    message = format('HISTORIAL_INMUTABLE: %s no admite TRUNCATE.', tg_table_name);
end $$;

drop trigger if exists movimientos_historial_sin_truncate on public.movimientos_silla;
create trigger movimientos_historial_sin_truncate
  before truncate on public.movimientos_silla
  for each statement execute function public._historial_vuelos_sin_truncate();

drop trigger if exists operaciones_historial_sin_truncate on public.operaciones_vuelo;
create trigger operaciones_historial_sin_truncate
  before truncate on public.operaciones_vuelo
  for each statement execute function public._historial_vuelos_sin_truncate();

revoke all on function public._historial_vuelos_inmutable() from public, anon, authenticated, service_role;
revoke all on function public._historial_vuelos_sin_truncate() from public, anon, authenticated, service_role;
