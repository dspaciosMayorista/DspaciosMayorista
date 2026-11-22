-- #25 — prueba SOBRE LA BASE REAL (copia desechable con 001-314+): la edición del portal (283) deja DOS filas de auditoría gemelas (disparador + explícita con `_via`),
-- con el MISMO instante y los MISMOS cambios; es la premisa de `lib/aliados/historial.ts` (sinGemelas). Una transacción, termina en ROLLBACK.
-- Uso: docker exec -i <ct> psql -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f - < supabase/scripts/test_25_historial_gemelas.sql
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000025001', 'l25@x.test') on conflict do nothing;
insert into public.aliados (id, nombre, tipo, nit, telefono, email) values (925001, 'Laura 25', 'freelance', '925001', '3001112222', 'l25@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id, acceso_legacy_nombre)
values ('00000000-0000-0000-0000-000000025001', 'l25@x.test', 'Laura 25', 'freelance', true, 'mayorista', 925001, false)
on conflict (id) do update set aliado_id = 925001, acceso_legacy_nombre = false, rol = 'freelance', activo = true, tenant = 'mayorista', nombre = 'Laura 25';
do $$
declare r jsonb; n_upd int; n_via int; n_distintos int;
begin
  r := public.guardar_perfil_portal('00000000-0000-0000-0000-000000025001', 'l25@x.test', 'ficha', '{"telefono":"3009998888"}'::jsonb, '{"telefono":"3001112222"}'::jsonb);
  if (r->>'ok')::boolean is not true then raise exception 'FALLO: la edición del portal no se aplicó: %', r; end if;
  select count(*), count(*) filter (where despues->>'_via' = 'portal_b2b_perfil'), count(distinct (creado_en::text || cambios::text))
    into n_upd, n_via, n_distintos
    from public.auditoria where tabla = 'aliados' and registro_id = '925001' and accion = 'UPDATE';
  if n_upd <> 2 or n_via <> 1 or n_distintos <> 1 then
    raise exception 'FALLO: se esperaban 2 filas gemelas (1 con _via, mismo instante y cambios); hay % (% con _via, % combinaciones distintas)', n_upd, n_via, n_distintos;
  end if;
  raise notice 'OK: la edición del portal escribe 2 filas gemelas; el historial las muestra como una';
end $$;
rollback;
