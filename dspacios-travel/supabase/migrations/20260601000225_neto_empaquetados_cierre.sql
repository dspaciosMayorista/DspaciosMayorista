-- ─────────────────────────────────────────────────────────────────────────
-- 225 · HOTFIX (fase 2, CIERRE) — `venta` pierde la lectura de la tabla base `empaquetados`.
--
-- ⚠️ SE APLICA DESPUÉS de la 224 Y DESPUÉS de desplegar el código que lee la vista. La 224 creó
-- `public.empaquetados_basica` (sin netos) sin quitar acceso a nadie. Esta migración es la que cierra el
-- hueco: quita a `venta` la policy de SELECT de la tabla base —sin fila que leer no hay columna que filtrar—
-- y deja la lectura de `venta` únicamente por la vista (patrón 144/146).
--
-- Orden (ver 224): 1) 224 · 2) desplegar el código (computo.ts lee `empaquetados_basica`) · 3) validar con un
-- usuario `venta` real reservando un vuelo de Sistema · 4) ESTA migración. Con la 225 aplicada y el código
-- viejo, `computarReserva` no encuentra la fila con la sesión de `venta` y responde "El empaquetado
-- seleccionado ya no existe". La migración se NIEGA si la vista de la 224 no existe.
--
-- Se reemplaza la policy de 6 roles (156) por una de 5 (sin `venta`). Conservan la tabla base superadmin,
-- gerencia, administracion, operaciones y control_vuelo (este último edita el neto: formularios Nuevo/Editar
-- y policy de escritura de la 156). "empaquetados: escritura control" (FOR ALL, los mismos 5 roles) no se toca,
-- ni `empaquetado_cambios` ni `armado_empaquetados`. No toca datos.
--
-- Rollback: rollback_225_neto_empaquetados_cierre.sql (restaura la policy de la 156 EXACTA; vuelve a abrir la
-- lectura de netos a `venta`). Preflight/postcheck/pruebas: *_225_*.
-- ─────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.empaquetados') is null or to_regprocedure('public.mi_rol()') is null then
    raise exception '225: falta public.empaquetados (156) o public.mi_rol(); aplica las migraciones anteriores primero.';
  end if;
  if to_regclass('public.empaquetados_basica') is null then
    raise exception '225: falta la vista public.empaquetados_basica de la migración 224. Aplica la 224 y despliega el código ANTES de cerrar la lectura de la tabla base.';
  end if;
end $$;

drop policy if exists "empaquetados: lectura operativa" on public.empaquetados;
drop policy if exists "empaquetados: lectura con costos" on public.empaquetados;
create policy "empaquetados: lectura con costos"
  on public.empaquetados for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','control_vuelo'));

comment on policy "empaquetados: lectura con costos" on public.empaquetados is
  'Migración 225. Quién lee la tabla BASE (con tarifa_proveedor): los roles financieros y control_vuelo (que edita el neto en el inventario). venta lee empaquetados_basica.';

notify pgrst, 'reload schema';

commit;
