-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 193 · vuelve EXACTAMENTE al estado de 007/074.
--
-- ⚠️ Reabre los huecos que la 193 cierra (rol privilegiado desde la metadata,
-- perfiles que nacen activos, INSERT público en b2b_solicitudes). Usar solo
-- para volver a un estado conocido, y desplegar antes el código viejo de
-- aprobación: el código nuevo llama a `aprobar_solicitud_b2b` /
-- `rechazar_solicitud_b2b`, que este rollback elimina.
--
-- La columna `usuarios.acceso_legacy_nombre` se CONSERVA (no se borran
-- columnas en este proyecto, y guarda decisiones explícitas de acceso). El
-- código viejo no la lee: con él vuelve el respaldo por nombre para TODA
-- cuenta sin ficha, que es justamente lo que la 193 cierra.
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop function if exists public.aprobar_solicitud_b2b(bigint, text, bigint);
drop function if exists public.rechazar_solicitud_b2b(bigint);

-- Trigger tal como lo dejó la 007.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol rol_usuario;
begin
  if not exists (select 1 from public.usuarios limit 1) then
    v_rol := 'superadmin';
  else
    v_rol := coalesce(
      (new.raw_user_meta_data->>'rol')::rol_usuario,
      'venta'
    );
  end if;

  insert into public.usuarios (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    v_rol
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Policies y privilegios de la 074.
drop policy if exists "b2b_solicitudes: lectura admin" on public.b2b_solicitudes;
drop policy if exists "b2b_solicitudes: registro público" on public.b2b_solicitudes;
create policy "b2b_solicitudes: registro público" on public.b2b_solicitudes for insert with check (true);
drop policy if exists "b2b_solicitudes: gestión admin" on public.b2b_solicitudes;
create policy "b2b_solicitudes: gestión admin" on public.b2b_solicitudes for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia'));

grant all on public.b2b_solicitudes to anon, authenticated;
grant all on sequence public.b2b_solicitudes_id_seq to anon, authenticated;

commit;
