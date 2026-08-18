-- ───────────────────────────────────────────────────────────────────────────
-- 154 · COTIZACIONES: aislamiento por tenant — CIERRE
--
-- ⚠️ NO CORRER en el mismo despliegue que la 153. Orden documentado:
--   1) migración 153 (aditiva) · 2) fusionar y desplegar el código nuevo ·
--   3) probar creación/edición/impresión/conversión · 4) consultar
--   `cotizaciones` con `tenant is null` (la 153 trae esa consulta comentada)
--   · 5) resolver cualquier fila nueva que haya quedado sin tenant · 6) recién
--   ENTONCES correr esta migración · 7) correr las pruebas RLS de después del
--   cierre (`supabase/scripts/test_cotizaciones_tenant_rls.sql`).
--
-- Todo el archivo corre dentro de UNA transacción explícita (`begin`/`commit`):
-- si cualquier statement falla (incluido el `raise exception` del punto 1),
-- Postgres revierte TODO lo hecho hasta ahí — nunca queda una migración a
-- medias (algunas policies nuevas creadas y otras no, o el NOT NULL puesto
-- pero sin policies). Antes se dependía de que el editor SQL de Supabase
-- envolviera el script pegado en una transacción implícita; ahora es
-- explícito y no depende de cómo se corra (editor, CLI, `psql -f`).
--
-- Qué hace:
--   1. Aborta si queda alguna fila con tenant NULL o fuera de
--      ('mayorista','minorista') — nunca fuerza un valor, prefiere fallar la
--      migración a adivinar.
--   2. `tenant` pasa a NOT NULL.
--   3-5. Reemplaza la policy única "cotizaciones: interno" (solo por rol, sin
--      tenant) por políticas separadas de SELECT/INSERT/UPDATE/DELETE con
--      aislamiento por tenant.
--
--      ⚠️ NO usa `puede_ver_tenant()` (la de la migración 107, que ya usan
--      `ventas`/`abonos`/`cuentas_por_pagar`): esa función da alcance GLOBAL
--      a `superadmin` Y `gerencia` por igual (`mi_rol() in
--      ('superadmin','gerencia') or mi_tenant() = t`). Para `cotizaciones`
--      el diseño pedido es distinto a propósito — SOLO superadmin tiene
--      alcance global; gerencia queda tan acotada a su propio tenant como
--      administracion/operaciones/venta. Por eso esta migración define
--      `puede_ver_tenant_cotizacion()`, una función NUEVA y EXCLUSIVA de
--      estas dos tablas — no se toca `puede_ver_tenant()` en sí (la usan
--      ~10 tablas más con el criterio viejo, que sigue siendo el correcto
--      para ellas; cambiarla de forma global habría ampliado o reducido el
--      acceso de gerencia en TODO el sistema, no solo aquí).
--
--      Mismo conjunto de roles para las 4 operaciones (igual que la policy
--      "interno" que reemplazan: nunca hubo distinción de permisos de
--      escritura entre esos 5 roles) — se separan en 4 policies con nombre
--      propio, no por diferir en el rol, sino porque UPDATE necesita
--      `using`+`with_check` distintos de SELECT/DELETE (solo `using`) e
--      INSERT (solo `with_check`), y porque así queda auditable policy por
--      policy — mismo estilo que usa el resto del repo (ver `ventas`).
--   6. `cotizacion_servicios` NUNCA tiene su propia columna `tenant`: hereda
--      el acceso de su cotización padre vía `puede_ver_cotizacion()` — mismo
--      patrón que `puede_ver_contrato()` para las tablas hijas de un
--      contrato. Por diseño no puede quedar con MÁS alcance que su padre: al
--      no ser SECURITY DEFINER, el `exists (...)` de adentro se evalúa con
--      la RLS real de `cotizaciones` ya aplicada (incluida la restricción de
--      gerencia del punto 3-5).
--   7. Un trigger (no una policy) bloquea que un UPDATE cambie `tenant` —
--      aplica a TODOS los roles, incluido superadmin: mover una cotización
--      de agencia no es una operación que deba poder pasar por un UPDATE
--      normal, ni siquiera por accidente.
--   8. Ningún GRANT a `anon` — la ausencia de policy para ese rol en
--      `mi_rol() in (...)` (NULL sin sesión) ya deniega todo.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) Abortar si queda algo sin resolver.
do $$
declare
  v_mal bigint;
begin
  select count(*) into v_mal
  from public.cotizaciones
  where tenant is null or tenant not in ('mayorista', 'minorista');

  if v_mal > 0 then
    raise exception '154 ABORTADA: % cotizaciones sin tenant válido (NULL o fuera de mayorista/minorista). Resuélvelas antes de cerrar — ver la consulta de verificación al final de la 153.', v_mal;
  end if;
end $$;

-- 2) NOT NULL.
alter table public.cotizaciones alter column tenant set not null;

-- Helper EXCLUSIVO de cotizaciones/cotizacion_servicios (ver nota arriba):
-- superadmin = alcance global; cualquier otro rol (incluida gerencia) = solo
-- su propio tenant.
create or replace function public.puede_ver_tenant_cotizacion(t text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.mi_rol() = 'superadmin' or public.mi_tenant() = t;
$$;

-- 3-5) Policies de `cotizaciones` con aislamiento por tenant.
drop policy if exists "cotizaciones: interno" on public.cotizaciones;

create policy "cotizaciones: lectura" on public.cotizaciones for select
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant_cotizacion(tenant)
  );

create policy "cotizaciones: insertar" on public.cotizaciones for insert
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant_cotizacion(tenant)
  );

create policy "cotizaciones: actualizar" on public.cotizaciones for update
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant_cotizacion(tenant)
  )
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant_cotizacion(tenant)
  );

create policy "cotizaciones: eliminar" on public.cotizaciones for delete
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant_cotizacion(tenant)
  );

-- 7) Trigger: ningún UPDATE (de ningún rol) puede cambiar `tenant`.
create or replace function public.cotizaciones_bloquear_cambio_tenant()
returns trigger language plpgsql as $$
begin
  if new.tenant is distinct from old.tenant then
    raise exception 'No se puede cambiar el tenant de una cotización existente (id=%, % → %). Si de verdad hay que reasignarla, es una operación manual aparte, no un UPDATE de la aplicación.', old.id, old.tenant, new.tenant;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cotizaciones_bloquear_cambio_tenant on public.cotizaciones;
create trigger trg_cotizaciones_bloquear_cambio_tenant
  before update on public.cotizaciones
  for each row execute function public.cotizaciones_bloquear_cambio_tenant();

-- 6) `cotizacion_servicios` hereda el acceso de su padre — NUNCA tiene tenant
-- propio. `puede_ver_cotizacion()` NO es SECURITY DEFINER (a propósito, mismo
-- criterio que `puede_ver_contrato()`): si lo fuera, se saltaría la RLS de
-- `cotizaciones` que acabamos de definir arriba y siempre devolvería true.
create or replace function public.puede_ver_cotizacion(p_cotizacion_id bigint)
returns boolean language sql stable as $$
  select exists (select 1 from public.cotizaciones c where c.id = p_cotizacion_id);
$$;

drop policy if exists "cotizacion_servicios: interno" on public.cotizacion_servicios;

create policy "cotizacion_servicios: lectura" on public.cotizacion_servicios for select
  using (public.puede_ver_cotizacion(cotizacion_id));

create policy "cotizacion_servicios: insertar" on public.cotizacion_servicios for insert
  with check (public.puede_ver_cotizacion(cotizacion_id));

create policy "cotizacion_servicios: actualizar" on public.cotizacion_servicios for update
  using (public.puede_ver_cotizacion(cotizacion_id))
  with check (public.puede_ver_cotizacion(cotizacion_id));

create policy "cotizacion_servicios: eliminar" on public.cotizacion_servicios for delete
  using (public.puede_ver_cotizacion(cotizacion_id));

commit;
