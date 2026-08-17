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
-- Qué hace:
--   1. Aborta si queda alguna fila con tenant NULL o fuera de
--      ('mayorista','minorista') — nunca fuerza un valor, prefiere fallar la
--      migración a adivinar.
--   2. `tenant` pasa a NOT NULL.
--   3-5. Reemplaza la policy única "cotizaciones: interno" (solo por rol, sin
--      tenant) por políticas separadas de SELECT/INSERT/UPDATE/DELETE con
--      aislamiento por tenant, usando `puede_ver_tenant()` (migración 107) —
--      el mismo helper que ya usan `ventas`/`abonos`/`cuentas_por_pagar`, para
--      no introducir un criterio nuevo y distinto al del resto del sistema.
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
--      la RLS real de `cotizaciones` ya aplicada.
--   7. Un trigger (no una policy) bloquea que un UPDATE cambie `tenant` —
--      aplica a TODOS los roles, incluido superadmin: mover una cotización
--      de agencia no es una operación que deba poder pasar por un UPDATE
--      normal, ni siquiera por accidente.
--   8. Ningún GRANT a `anon` — la ausencia de policy para ese rol en
--      `mi_rol() in (...)` (NULL sin sesión) ya deniega todo.
-- ───────────────────────────────────────────────────────────────────────────

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

-- 3-5) Policies de `cotizaciones` con aislamiento por tenant.
drop policy if exists "cotizaciones: interno" on public.cotizaciones;

create policy "cotizaciones: lectura" on public.cotizaciones for select
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant(tenant)
  );

create policy "cotizaciones: insertar" on public.cotizaciones for insert
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant(tenant)
  );

create policy "cotizaciones: actualizar" on public.cotizaciones for update
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant(tenant)
  )
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant(tenant)
  );

create policy "cotizaciones: eliminar" on public.cotizaciones for delete
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_tenant(tenant)
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
