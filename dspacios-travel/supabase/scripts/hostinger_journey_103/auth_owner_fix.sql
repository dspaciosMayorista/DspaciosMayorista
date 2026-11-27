-- ENTORNO LOCAL #43/#60: la plantilla local se armó entera como supabase_admin, así que el esquema auth no
-- pertenece a supabase_auth_admin (en Supabase sí). GoTrue necesita ser dueño para correr sus migraciones.
-- Solo para la base local; no es un cambio de esquema del proyecto.
do $$
declare r record;
begin
  execute 'alter schema auth owner to supabase_auth_admin';
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' loop
    execute format('alter function %s owner to supabase_auth_admin', r.f);
  end loop;
  for r in select c.oid::regclass as t, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'auth' and c.relkind in ('r', 'p', 'S', 'v') loop
    execute format('alter %s %s owner to supabase_auth_admin', case r.relkind when 'S' then 'sequence' when 'v' then 'view' else 'table' end, r.t);
  end loop;
  for r in select t.oid::regtype as ty from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'auth' and t.typtype in ('e', 'd') loop
    execute format('alter type %s owner to supabase_auth_admin', r.ty);
  end loop;
end $$;
-- La plantilla trae auth.sessions como el stub de preparar_esquema_local.sh (creado antes que el esquema real de
-- GoTrue, así que su migración la dio por existente): le falta updated_at, que GoTrue escribe al crear la sesión.
alter table auth.sessions add column if not exists updated_at timestamptz;
