-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 199 · retira la fase C (cierre de la escritura directa de sillas y
-- bloqueos_vuelo) y deja todo como estaba con la 137/194–197.
--
-- Cuándo: ANTES de retroceder Vercel a un despliegue anterior a la fase B, o
-- si C rompe un escritor legítimo que no se detectó. ⚠️ Si la 200 (historial
-- inmutable) también está activa y se va a volver a código anterior a B,
-- revertir PRIMERO la 200 (rollback_200_…) y después esta: el código viejo
-- borra historial.
--
-- Qué hace: quita los cuatro triggers y sus tres funciones; devuelve la policy
-- `FOR ALL` "escritura control" (137) en lugar de la `FOR UPDATE` con AUT-1;
-- vuelve a conceder INSERT, DELETE y TRUNCATE a authenticated/anon y UPDATE a
-- anon (los privilegios por defecto de Supabase en public, que eran los que
-- tenían estas tablas). No toca datos.
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop trigger if exists sillas_guarda_escritura on public.sillas;
drop trigger if exists sillas_guarda_truncate on public.sillas;
drop trigger if exists bloqueos_guarda_cupos on public.bloqueos_vuelo;
drop trigger if exists bloqueos_guarda_truncate on public.bloqueos_vuelo;
drop function if exists public._sillas_guarda_escritura();
drop function if exists public._bloqueos_guarda_cupos();
drop function if exists public._vuelos_guarda_truncate();

drop policy if exists "sillas: edicion directa (AUT-1)" on public.sillas;
drop policy if exists "sillas: escritura control" on public.sillas;
create policy "sillas: escritura control" on public.sillas
  for all
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'))
  with check (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'));

drop policy if exists "bloqueos: edicion directa (AUT-1)" on public.bloqueos_vuelo;
drop policy if exists "bloqueos: escritura control" on public.bloqueos_vuelo;
create policy "bloqueos: escritura control" on public.bloqueos_vuelo
  for all
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'))
  with check (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'));

grant insert, update, delete, truncate on public.sillas to authenticated, anon;
grant insert, update, delete, truncate on public.bloqueos_vuelo to authenticated, anon;

do $$
begin
  if exists (select 1 from pg_trigger where not tgisinternal
              and tgname in ('sillas_guarda_escritura', 'sillas_guarda_truncate', 'bloqueos_guarda_cupos', 'bloqueos_guarda_truncate'))
     or exists (select 1 from pg_proc where proname in ('_sillas_guarda_escritura', '_bloqueos_guarda_cupos', '_vuelos_guarda_truncate'))
     or not has_table_privilege('authenticated', 'public.sillas', 'INSERT')
     or not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'DELETE')
     or (select count(*) from pg_policies where schemaname = 'public'
          and policyname in ('sillas: escritura control', 'bloqueos: escritura control') and cmd = 'ALL') <> 2 then
    raise exception 'Rollback 199 incompleto.';
  end if;
end $$;

commit;
