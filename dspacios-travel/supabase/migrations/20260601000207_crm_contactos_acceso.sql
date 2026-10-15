-- ───────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 207 · HOTFIX de acceso a `crm_contactos`
--
-- Número reservado por el Coordinador el 2026-10-12 (WORKSTREAMS.md). Es
-- independiente de la 206 (#30 B) y de la 208: no depende de ninguna de las
-- dos y se probó sobre el esquema vigente (hasta la 209) sin ellas. Por
-- prioridad de acceso se integra/despliega antes que #30 B.
-- Scripts: `supabase/scripts/*_207_crm_contactos_acceso.sql` y
-- `supabase/scripts/pruebas/*207*`.
--
-- QUÉ CORRIGE
--   La 042 dejó la lectura de `crm_contactos` como
--       for select using (auth.uid() is not null)        -- rol `public`
--   o sea: CUALQUIER sesión con UID la satisface — también agencia/freelance/
--   cliente_final (B2B) y un `control_vuelo` — y la tabla no tiene tenant, así
--   que tampoco separa mayorista de minorista. La ruta /crm bloquea la lista
--   para B2B con un guard de página, pero eso NO protege la tabla: la API de
--   Supabase (PostgREST) responde con la policy, no con la página.
--   Verificado en Producción (2026-10-10, solo metadatos): RLS activo, policy
--   SELECT `public` con `auth.uid() IS NOT NULL`, y `anon`/`authenticated` con
--   privilegio de tabla SELECT/INSERT/UPDATE.
--
-- QUÉ HACE
--   1. `tenant` NUEVA y NULLABLE. Las filas históricas quedan en NULL: NO se
--      atribuyen aquí. La atribución es una decisión del dueño con evidencia
--      del preflight (ver `atribuir_207_crm_contactos_acceso.sql`, aparte).
--   2. Default `crm_contactos_tenant_default()`: la agencia "home" de quien
--      inserta CON sesión (`mi_tenant()`); sin sesión (service_role, editor
--      SQL) devuelve NULL — nunca adivina. Sirve para que el código VIEJO
--      siga creando contactos durante la ventana entre esta migración y el
--      despliegue; el código nuevo estampa el tenant activo explícitamente.
--   3. CHECK de valores y trigger: el tenant de una fila ya atribuida no se
--      cambia por UPDATE (igual que `cotizaciones`, 154). NULL → valor sí, que
--      es justamente la atribución.
--   4. Policies nuevas, solo `to authenticated`:
--        · personal interno (superadmin, gerencia, administracion, operaciones,
--          venta) y solo dentro de su agencia — `puede_ver_tenant()` (107):
--          superadmin y gerencia ven ambas, decisión #4 del dueño.
--        · filas SIN atribuir (tenant NULL): solo superadmin y gerencia, que ya
--          tienen alcance sobre las dos agencias. No se abre acceso global a
--          nadie más para "resolverlas".
--        · B2B (agencia/freelance/cliente_final), control_vuelo, usuarios
--          inactivos (mi_rol() = NULL, 140) y `anon`: sin policy → nada.
--   5. `anon` pierde todo privilegio de tabla y de secuencia (defensa en
--      profundidad: la RLS ya lo negaba, el GRANT sobraba). `authenticated`
--      pierde TRUNCATE/REFERENCES/TRIGGER, que la RLS no cubre.
--
-- QUÉ NO HACE (a propósito)
--   · No edita la 042 ni la 047. Los índices únicos de la 047 (documento,
--     email, teléfono) siguen GLOBALES: un interno de una agencia que intente
--     crear un contacto que ya existe en la otra recibe "ya existe" (23505).
--     Revela existencia, no datos. Cambiar la clave de identidad es #32.
--   · No crea vistas, RPC ni funciones SECURITY DEFINER que lean la tabla.
--   · No modela "asignación" por asesor: la tabla no tiene dueño. Dentro de su
--     agencia, `venta` ve los contactos de su agencia (igual criterio que la
--     142 para contratos). Asignación fina = #32/#42.
--   · No toca `crm_leads` (202), `crm_campanas`, `crm_difusion_*` ni la vista
--     de pasajeros de contratos (188).
--
-- ORDEN DE DESPLIEGUE (Producción: todo lo remoto lo ejecuta el usuario)
--   1. sonda HEAD `api_207_crm_contactos_acceso.mjs --fase=pre` (constancia)
--   2. `preflight_207_crm_contactos_acceso.sql` (un SELECT)
--   3. ESTA migración
--   4. `postcheck_207_crm_contactos_acceso.sql` (un SELECT)
--   5. despliegue del código
--   6. sonda HEAD `--fase=post --totales="S / M / N"` (fila 20 del
--      postcheck) con anon, B2B, internos de cada agencia, gerencia y
--      superadmin: falla por fuga y también por pérdida de acceso legítimo
--   Correrla ANTES del código es seguro: el default cubre al código viejo.
--   Desplegar el código ANTES de la migración NO: el código nuevo manda
--   `tenant` y la columna aún no existe → falla crear contacto.
--   La atribución de históricos NO es parte de este despliegue: requiere
--   decisión explícita del dueño (`atribuir_207_crm_contactos_acceso.sql`).
--
-- Re-ejecutable: idempotente; también es el camino de vuelta al cierre
-- completo después de una recuperación.
-- Recuperación preferida (conserva el cierre): revertir el despliegue, o
--   supabase/scripts/recuperacion_207_crm_contactos_acceso.sql
-- Rollback de ÚLTIMO RECURSO (reabre la fuga, exige confirmación):
--   supabase/scripts/rollback_207_crm_contactos_acceso.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 0) Guardas: el esquema que esta migración asume.
do $$
begin
  if to_regclass('public.crm_contactos') is null then
    raise exception 'crm_contactos_acceso ABORTADA: no existe public.crm_contactos.';
  end if;
  if to_regprocedure('public.puede_ver_tenant(text)') is null
     or to_regprocedure('public.mi_tenant()') is null
     or to_regprocedure('public.mi_rol()') is null then
    raise exception 'crm_contactos_acceso ABORTADA: faltan mi_rol()/mi_tenant()/puede_ver_tenant(text) (migraciones 005/107/140).';
  end if;
end $$;

-- 1) Columna tenant (nullable, SIN backfill). Idempotente: si ya existe (re-
--    ejecución tras una recuperación o un rollback) se conserva con sus
--    atribuciones.
alter table public.crm_contactos add column if not exists tenant text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.crm_contactos'::regclass
                    and conname = 'crm_contactos_tenant_valido') then
    alter table public.crm_contactos
      add constraint crm_contactos_tenant_valido
      check (tenant is null or tenant in ('mayorista', 'minorista'));
  end if;
end $$;

create index if not exists idx_crm_contactos_tenant on public.crm_contactos (tenant);

-- 2) Default: agencia home de quien inserta con sesión; NULL sin sesión.
--    INVOKER a propósito: mi_tenant() ya es SECURITY DEFINER y solo lee la
--    fila del propio usuario.
create or replace function public.crm_contactos_tenant_default()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null then null else public.mi_tenant() end;
$$;

alter table public.crm_contactos
  alter column tenant set default public.crm_contactos_tenant_default();

-- 3) El tenant de una fila YA atribuida no cambia por UPDATE.
create or replace function public.crm_contactos_bloquear_cambio_tenant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.tenant is not null and new.tenant is distinct from old.tenant then
    raise exception 'No se puede cambiar la agencia de un contacto ya atribuido (id=%). Reasignarlo es una operación manual aparte.', old.id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_contactos_bloquear_cambio_tenant on public.crm_contactos;
create trigger trg_crm_contactos_bloquear_cambio_tenant
  before update of tenant on public.crm_contactos
  for each row execute function public.crm_contactos_bloquear_cambio_tenant();

-- 4) Policies. Se borran las de la 042 y cualquier resto de esta misma
--    migración (por si se corrió a medias en una sesión anterior).
drop policy if exists "crm_contactos: lectura"            on public.crm_contactos;
drop policy if exists "crm_contactos: escritura"          on public.crm_contactos;
drop policy if exists "crm_contactos: interno lectura"    on public.crm_contactos;
drop policy if exists "crm_contactos: interno insertar"   on public.crm_contactos;
drop policy if exists "crm_contactos: interno actualizar" on public.crm_contactos;
drop policy if exists "crm_contactos: interno eliminar"   on public.crm_contactos;
-- Y las de `recuperacion_207_crm_contactos_acceso.sql`: re-correr esta migración
-- es el camino de vuelta al cierre completo tras una recuperación.
drop policy if exists "crm_contactos: recuperacion lectura"    on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion insertar"   on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion actualizar" on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion eliminar"   on public.crm_contactos;

-- Predicado único, escrito igual en las cuatro:
--   interno activo  Y  ( fila de una agencia que puede ver
--                        O fila sin atribuir y es superadmin/gerencia )
create policy "crm_contactos: interno lectura" on public.crm_contactos
  for select to authenticated
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (
      (tenant is not null and public.puede_ver_tenant(tenant))
      or (tenant is null and public.mi_rol() in ('superadmin','gerencia'))
    )
  );

-- Insertar: nunca una fila sin atribuir desde la API (el default la llena; si
-- quedara NULL, se rechaza).
create policy "crm_contactos: interno insertar" on public.crm_contactos
  for insert to authenticated
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and tenant is not null
    and public.puede_ver_tenant(tenant)
  );

create policy "crm_contactos: interno actualizar" on public.crm_contactos
  for update to authenticated
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (
      (tenant is not null and public.puede_ver_tenant(tenant))
      or (tenant is null and public.mi_rol() in ('superadmin','gerencia'))
    )
  )
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (
      (tenant is not null and public.puede_ver_tenant(tenant))
      or (tenant is null and public.mi_rol() in ('superadmin','gerencia'))
    )
  );

create policy "crm_contactos: interno eliminar" on public.crm_contactos
  for delete to authenticated
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and (
      (tenant is not null and public.puede_ver_tenant(tenant))
      or (tenant is null and public.mi_rol() in ('superadmin','gerencia'))
    )
  );

-- 5) Privilegios de tabla.
revoke all on table public.crm_contactos from anon;
revoke truncate, references, trigger on table public.crm_contactos from authenticated;
do $$
declare
  v_seq text := pg_get_serial_sequence('public.crm_contactos', 'id');
begin
  if v_seq is not null then
    execute format('revoke all on sequence %s from anon', v_seq);
  end if;
end $$;
-- `authenticated` conserva SELECT/INSERT/UPDATE/DELETE: el CRM interno los usa
-- con la sesión del usuario y la RLS de arriba es la frontera.
-- `service_role` no cambia: el checkout público (servidor) inserta con ella.

-- Las funciones nuevas no se exponen a anon por RPC.
revoke all on function public.crm_contactos_tenant_default() from public, anon;
grant execute on function public.crm_contactos_tenant_default() to authenticated, service_role;
revoke all on function public.crm_contactos_bloquear_cambio_tenant() from public, anon, authenticated;

comment on column public.crm_contactos.tenant is
  'Agencia del contacto (mayorista/minorista). NULL = histórico sin atribuir: solo superadmin y gerencia lo ven hasta que el dueño lo atribuya. Hotfix de acceso (migración 207).';

-- PostgREST debe ver la columna nueva antes de que el código la mande.
notify pgrst, 'reload schema';

commit;
