-- Migración 007: Primer usuario registrado recibe superadmin automáticamente

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol rol_usuario;
begin
  -- Si la tabla usuarios está vacía, el primero es superadmin
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
