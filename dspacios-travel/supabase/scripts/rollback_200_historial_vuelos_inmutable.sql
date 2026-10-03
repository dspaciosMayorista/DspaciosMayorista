-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 200 · retira la fase E (historial de vuelos inmutable) y deja
-- `movimientos_silla` y `operaciones_vuelo` como estaban con la 194.
--
-- Cuándo: ANTES de retroceder Vercel a un despliegue anterior a la fase B
-- (el código viejo borra `movimientos_silla` en eliminarCupo/eliminarBloqueo
-- e inserta movimientos sin operación en cambiarSillas). Si la 199 también se
-- va a revertir, esta va PRIMERO.
--
-- Qué hace: quita los cuatro triggers y sus dos funciones; devuelve la policy
-- `FOR ALL` "movimientos: registro operativo" (005/137) en lugar de la de
-- solo lectura; vuelve a conceder INSERT/UPDATE/DELETE/TRUNCATE de
-- `movimientos_silla` a authenticated/anon/service_role, y de
-- `operaciones_vuelo` solo a service_role (la 194 ya se los había quitado a
-- authenticated/anon). No toca datos: el historial queda intacto.
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop trigger if exists movimientos_historial_inmutable on public.movimientos_silla;
drop trigger if exists movimientos_historial_sin_truncate on public.movimientos_silla;
drop trigger if exists operaciones_historial_inmutable on public.operaciones_vuelo;
drop trigger if exists operaciones_historial_sin_truncate on public.operaciones_vuelo;
drop function if exists public._historial_vuelos_inmutable();
drop function if exists public._historial_vuelos_sin_truncate();

drop policy if exists "movimientos: lectura vuelos" on public.movimientos_silla;
drop policy if exists "movimientos: registro operativo" on public.movimientos_silla;
create policy "movimientos: registro operativo" on public.movimientos_silla
  for all
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'))
  with check (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'));

grant insert, update, delete, truncate on public.movimientos_silla to authenticated, anon, service_role;
grant insert, update, delete, truncate on public.operaciones_vuelo to service_role;

do $$
begin
  if exists (select 1 from pg_trigger where not tgisinternal
              and tgname in ('movimientos_historial_inmutable', 'movimientos_historial_sin_truncate',
                             'operaciones_historial_inmutable', 'operaciones_historial_sin_truncate'))
     or exists (select 1 from pg_proc where proname in ('_historial_vuelos_inmutable', '_historial_vuelos_sin_truncate'))
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'movimientos_silla'
                     and policyname = 'movimientos: registro operativo' and cmd = 'ALL') then
    raise exception 'Rollback 200 incompleto.';
  end if;
end $$;

commit;
