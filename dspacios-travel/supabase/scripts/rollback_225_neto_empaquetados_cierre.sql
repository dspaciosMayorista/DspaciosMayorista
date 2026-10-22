-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK 225 · deshacer el cierre y restaurar el estado EXACTO que dejó la 224.
--
-- Restaura la policy "empaquetados: lectura operativa" de la 156 (SELECT para superadmin, gerencia,
-- administracion, operaciones, venta, control_vuelo) y retira "empaquetados: lectura con costos". La vista
-- empaquetados_basica (224) NO se toca. No toca datos, ni "empaquetados: escritura control", ni las tablas
-- hermanas.
--
-- ⚠️ Rollback = VOLVER A ABRIR la lectura de netos a `venta` por la tabla base. Sin condiciones de uso: la 225
-- no guarda estado propio. Idempotente.
-- ═════════════════════════════════════════════════════════════════════════
begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.empaquetados') is null then
    raise exception 'ROLLBACK 225 ABORTADO: public.empaquetados no existe.';
  end if;
end $$;

drop policy if exists "empaquetados: lectura con costos" on public.empaquetados;
drop policy if exists "empaquetados: lectura operativa" on public.empaquetados;
create policy "empaquetados: lectura operativa"
  on public.empaquetados for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo'));

notify pgrst, 'reload schema';

commit;
