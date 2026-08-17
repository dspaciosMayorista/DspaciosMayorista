-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 154 (COTIZACIONES: aislamiento por tenant — cierre)
--
-- Deja `cotizaciones`/`cotizacion_servicios` EXACTAMENTE como las dejó la 153:
-- `tenant` nullable, sin las policies con aislamiento, sin el trigger que
-- bloquea el cambio de tenant, con la policy única "interno" (solo por rol,
-- sin tenant) restaurada tal cual estaba antes de la 154.
--
-- ⚠️ VOLVER ATRÁS REABRE LA FUGA ENTRE AGENCIAS que la 154 cierra: cualquier
-- interno de una agencia vuelve a leer/escribir cotizaciones de la otra.
-- Úsalo solo si la 154 rompe un flujo real y hace falta tiempo para
-- arreglarla — no como paso normal de operación.
--
-- No toca el backfill de la 153 (los 18 IDs con tenant='mayorista' quedan
-- igual; solo se relaja la restricción NOT NULL). Se pega en el editor SQL
-- de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

-- `cotizacion_servicios`: restaurar la policy única "interno".
drop policy if exists "cotizacion_servicios: lectura"    on public.cotizacion_servicios;
drop policy if exists "cotizacion_servicios: insertar"   on public.cotizacion_servicios;
drop policy if exists "cotizacion_servicios: actualizar" on public.cotizacion_servicios;
drop policy if exists "cotizacion_servicios: eliminar"   on public.cotizacion_servicios;

create policy "cotizacion_servicios: interno" on public.cotizacion_servicios for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

-- El helper se va con las policies: nada más lo usa.
drop function if exists public.puede_ver_cotizacion(bigint);

-- `cotizaciones`: quitar el trigger de bloqueo de cambio de tenant.
drop trigger if exists trg_cotizaciones_bloquear_cambio_tenant on public.cotizaciones;
drop function if exists public.cotizaciones_bloquear_cambio_tenant();

-- `cotizaciones`: restaurar la policy única "interno".
drop policy if exists "cotizaciones: lectura"    on public.cotizaciones;
drop policy if exists "cotizaciones: insertar"   on public.cotizaciones;
drop policy if exists "cotizaciones: actualizar" on public.cotizaciones;
drop policy if exists "cotizaciones: eliminar"   on public.cotizaciones;

create policy "cotizaciones: interno" on public.cotizaciones for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

-- Vuelve a nullable (deshace el `set not null` de la 154).
alter table public.cotizaciones alter column tenant drop not null;
