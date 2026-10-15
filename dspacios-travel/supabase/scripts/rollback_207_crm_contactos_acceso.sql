-- ───────────────────────────────────────────────────────────────────────────
-- ⛔ ROLLBACK DE ÚLTIMO RECURSO · hotfix de acceso a `crm_contactos`
--
-- ESTO REABRE LA FUGA. Restaura la policy insegura de la 042
-- (`using (auth.uid() is not null)`): cualquier sesión —B2B incluida— vuelve
-- a leer TODOS los contactos de las dos agencias por la API.
--
-- Antes de usarlo, agotar en este orden:
--   1. Si falla el CÓDIGO nuevo: revertir el despliegue en Vercel. El código
--      anterior funciona con la migración aplicada; el cierre se mantiene.
--   2. Si el aislamiento entre agencias impide trabajar al personal interno:
--      `recuperacion_207_crm_contactos_acceso.sql` (sigue cerrado para anon, B2B
--      y control_vuelo).
--   3. Solo si el CRM interno quedó inservible incluso con (1) y (2): este
--      archivo, con aprobación explícita del dueño, y re-aplicar la migración
--      apenas se resuelva la causa.
--
-- Candado: la confirmación vale SOLO dentro de la transacción de este
-- archivo. Para confirmar, quitar el `--` de la línea marcada [CONFIRMAR]
-- (justo después del `begin;`). Esa línea guarda 'REABRIR_FUGA:<id de la
-- transacción>' como ajuste LOCAL; el candado lo compara con
-- `txid_current()`. Por eso:
--   · sin la línea → aborta antes de tocar nada;
--   · un valor de una sesión o transacción ANTERIOR (o un `set` de sesión)
--     lleva otro id → aborta;
--   · correr las sentencias sueltas (sin el `begin`) → cada una es otra
--     transacción → aborta;
--   · al terminar (commit o error) el ajuste local desaparece: la próxima
--     ejecución vuelve a necesitar su propia confirmación.
--
-- Conserva la columna `tenant`, su default, el CHECK, el trigger, las
-- atribuciones y la revocación a anon: el código desplegado escribe `tenant`,
-- y con la 042 anon ya quedaba negado igualmente (sin UID ni rol).
-- Volver al cierre: re-correr la migración (idempotente) y su postcheck.
--
-- NIVEL 2 (comentado al final): quitar también columna y objetos. Solo con el
-- código ya revertido y sin filas atribuidas.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- [CONFIRMAR] quitar el `--` de la línea siguiente para reabrir (solo esta transacción):
-- select set_config('app.reabrir_crm_contactos', 'REABRIR_FUGA:' || txid_current(), true);

do $$
begin
  if coalesce(current_setting('app.reabrir_crm_contactos', true), '') <> 'REABRIR_FUGA:' || txid_current() then
    raise exception 'Rollback de último recurso NO ejecutado: reabre la fuga de crm_contactos. Probar antes revertir el despliegue o recuperacion_207_crm_contactos_acceso.sql. Para confirmar, quitar el -- de la línea [CONFIRMAR] (vale solo dentro de esta transacción).';
  end if;
end $$;


drop policy if exists "crm_contactos: interno lectura"    on public.crm_contactos;
drop policy if exists "crm_contactos: interno insertar"   on public.crm_contactos;
drop policy if exists "crm_contactos: interno actualizar" on public.crm_contactos;
drop policy if exists "crm_contactos: interno eliminar"   on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion lectura"    on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion insertar"   on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion actualizar" on public.crm_contactos;
drop policy if exists "crm_contactos: recuperacion eliminar"   on public.crm_contactos;

drop policy if exists "crm_contactos: lectura"   on public.crm_contactos;
drop policy if exists "crm_contactos: escritura" on public.crm_contactos;

-- Copia literal de la 042.
create policy "crm_contactos: lectura" on public.crm_contactos
  for select using (auth.uid() is not null);

create policy "crm_contactos: escritura" on public.crm_contactos
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

commit;

-- Verificación: debe listar exactamente las dos policies de la 042.
select policyname, cmd, roles::text, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'crm_contactos'
 order by policyname;

-- ── NIVEL 2 (solo con el código ya revertido) ─────────────────────────────
-- begin;
-- do $$ begin
--   if exists (select 1 from public.crm_contactos where tenant is not null) then
--     raise exception 'Rollback nivel 2 cancelado: hay contactos con agencia atribuida. Borrar la columna perdería esa atribución.';
--   end if;
-- end $$;
-- drop trigger if exists trg_crm_contactos_bloquear_cambio_tenant on public.crm_contactos;
-- drop function if exists public.crm_contactos_bloquear_cambio_tenant();
-- alter table public.crm_contactos alter column tenant drop default;
-- drop function if exists public.crm_contactos_tenant_default();
-- alter table public.crm_contactos drop constraint if exists crm_contactos_tenant_valido;
-- drop index if exists public.idx_crm_contactos_tenant;
-- alter table public.crm_contactos drop column if exists tenant;
-- notify pgrst, 'reload schema';
-- commit;
