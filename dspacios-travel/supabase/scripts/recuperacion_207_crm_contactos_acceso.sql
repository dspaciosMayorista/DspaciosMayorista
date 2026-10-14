-- ───────────────────────────────────────────────────────────────────────────
-- RECUPERACIÓN QUE CONSERVA EL CIERRE · hotfix de acceso a `crm_contactos`
--
-- Úsese ANTES que el rollback. Escenario: tras la migración, personal
-- interno legítimo no puede trabajar por el aislamiento entre agencias (p. ej.
-- administración necesita ver contactos históricos aún sin atribuir) y no hay
-- arreglo inmediato por código ni decisión de atribución.
--
-- Qué hace: reemplaza las 4 policies del hotfix por 4 policies "de
-- recuperación" que SOLO miran el rol interno (sin agencia), como era el
-- acceso del personal interno antes. Lo que NO reabre:
--   · anon, agencia/freelance/cliente_final (B2B), control_vuelo e inactivos
--     siguen sin ver ni escribir nada (esa era la fuga grave);
--   · anon sigue sin privilegios; la columna, el default, el CHECK y el
--     trigger de tenant siguen igual; las atribuciones se conservan.
-- Lo que sí cede: entre personal interno vuelve a no haber separación
-- mayorista/minorista. Es temporal.
--
-- Volver al cierre completo: re-correr la migración del hotfix (es
-- idempotente y borra también estas policies de recuperación) y su postcheck.
--
-- Recuperación sin SQL, si el problema es el CÓDIGO desplegado: revertir el
-- despliegue en Vercel. El código anterior funciona con la migración aplicada
-- (el default de `tenant` lo cubre), así que el cierre se mantiene intacto.
-- ───────────────────────────────────────────────────────────────────────────

begin;

drop policy if exists "crm_contactos: interno lectura"    on public.crm_contactos;
drop policy if exists "crm_contactos: interno insertar"   on public.crm_contactos;
drop policy if exists "crm_contactos: interno actualizar" on public.crm_contactos;
drop policy if exists "crm_contactos: interno eliminar"   on public.crm_contactos;

drop policy if exists "crm_contactos: recuperacion lectura"    on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion insertar"   on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion actualizar" on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion eliminar"   on public.crm_contactos;

create policy "crm_contactos: recuperacion lectura" on public.crm_contactos
  for select to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create policy "crm_contactos: recuperacion insertar" on public.crm_contactos
  for insert to authenticated
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create policy "crm_contactos: recuperacion actualizar" on public.crm_contactos
  for update to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create policy "crm_contactos: recuperacion eliminar" on public.crm_contactos
  for delete to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

commit;

-- Verificación (solo lectura): 4 policies "recuperacion", todas de authenticated.
select policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'crm_contactos'
 order by policyname;
