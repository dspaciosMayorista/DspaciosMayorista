-- ROLLBACK de la migración 182 (helper tarifario_paquete_publicable + policy
-- de lectura de tarifario_resultado reemplazada + tarifario_resultado_publicable
-- + tarifario_resumen reapuntada).
--
-- Restaura EXACTAMENTE el estado de la migración 018 para la policy de
-- lectura de tarifario_resultado ("for select using (true)") y elimina todo
-- objeto nuevo de la 182, en este orden:
--   1) tarifario_resumen vuelve a su definición de la migración 162 (fuente
--      = tarifario_resultado directo, sin el bloqueo de la 182) — mismo
--      cuerpo exacto que esa migración, para no depender de la vista que se
--      borra en el paso 3.
--   2) La policy "tarifario_resultado: lectura" vuelve a "for select using
--      (true)" (idéntica a la migración 018) — ANTES de borrar el helper,
--      para no dejar una policy que referencia una función inexistente ni
--      un instante intermedio sin policy de lectura.
--   3) Se borra tarifario_resultado_publicable.
--   4) Se borra la función tarifario_paquete_publicable.
--
-- Si se hace rollback, el código de la app (lectores que ahora apuntan a
-- `tarifario_resultado_publicable`) debe volver también a la versión anterior
-- a esta fase — este script NO toca TypeScript, solo el estado de la base.
--
-- Transaccional: si algo falla a mitad de camino, no queda un estado
-- intermedio (mismo criterio que 162/181).

begin;

-- 1) tarifario_resumen — definición original de la migración 162.
create or replace view public.tarifario_resumen
  with (security_invoker = true)
as
  select
    r.modulo,
    r.paquete_id,
    r.paquete_nombre,
    r.paquete_activo,
    r.bloqueo_id,
    r.bloqueo_label,
    r.empaquetado_id,
    r.salida_id,
    r.hotel_id,
    r.hotel_nombre,
    r.servicio_id,
    r.servicio_nombre,
    r.destino_id,
    r.destino_nombre,
    r.categoria,
    r.regimen,
    r.fecha_ida,
    r.fecha_regreso,
    r.noches,
    r.moneda,
    min(r.precio_pvp) filter (where r.acomodacion = 'sencilla' and r.precio_pvp > 0) as precio_sencilla,
    min(r.precio_pvp) filter (where r.acomodacion = 'doble'    and r.precio_pvp > 0) as precio_doble,
    min(r.precio_pvp) filter (where r.acomodacion = 'triple'   and r.precio_pvp > 0) as precio_triple,
    min(r.precio_pvp) filter (where r.acomodacion = 'multiple' and r.precio_pvp > 0) as precio_multiple,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino')    as precio_nino,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino2')   as precio_nino2,
    min(r.precio_pvp) filter (where r.acomodacion = 'infante') as precio_infante,
    min(r.precio_pvp) filter (
      where r.acomodacion in ('sencilla', 'doble', 'triple', 'multiple') and r.precio_pvp > 0
    ) as desde_adulto,
    min(r.precio_pvp) filter (where r.precio_pvp > 0) as desde_general,
    min(r.descripcion) as descripcion,
    min(r.recargo_individual) as recargo_individual,
    min(r.tipo_tarifa) as tipo_tarifa
  from public.tarifario_resultado r
  where r.paquete_activo = true
  group by
    r.modulo, r.paquete_id, r.paquete_nombre, r.paquete_activo, r.bloqueo_id, r.bloqueo_label,
    r.empaquetado_id, r.salida_id, r.hotel_id, r.hotel_nombre, r.servicio_id, r.servicio_nombre,
    r.destino_id, r.destino_nombre, r.categoria, r.regimen, r.fecha_ida, r.fecha_regreso, r.noches, r.moneda;

comment on view public.tarifario_resumen is
  'Resumen agregado de tarifario_resultado (colapsa la dimensión acomodación; una fila por módulo/paquete/bloqueo/hotel/servicio/categoría/régimen). Carga inicial liviana del tarifario en dos niveles — la matriz de acomodación completa (con descripción/recargo/escalas) sigue viviendo en tarifario_resultado, consultada bajo demanda. Incluye precio_nino/precio_nino2/precio_infante (nunca filtrados por precio_pvp>0: 0 es un precio válido para menores). security_invoker: hereda exactamente el mismo acceso público que ya tenía tarifario_resultado.';

revoke all on public.tarifario_resumen from public, anon, authenticated;
grant select on public.tarifario_resumen to anon, authenticated;

-- 2) Policy de lectura de tarifario_resultado — restaurada IDÉNTICA a la
--    migración 018.
drop policy if exists "tarifario_resultado: lectura" on public.tarifario_resultado;
create policy "tarifario_resultado: lectura" on public.tarifario_resultado
  for select using (true);

-- 3) Vista nueva — el DROP también elimina su ACL (incluido el grant
--    explícito de SELECT a service_role agregado en la segunda ronda de
--    auditoría) sin necesidad de un REVOKE aparte.
drop view if exists public.tarifario_resultado_publicable;

-- 4) Helper nuevo.
drop function if exists public.tarifario_paquete_publicable(bigint);

commit;
