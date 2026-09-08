-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 170 (`cuentas_por_pagar.servicio_id`).
--
-- Seguro de correr: la columna es puramente aditiva y NO se hizo backfill, así
-- que borrarla no pierde ningún dato que existiera antes de la 170 — solo el
-- vínculo servicio↔CxP creado DESPUÉS de aplicarla. Las cuentas por pagar en
-- sí (el dinero) no se tocan.
--
-- ⚠️ Después de este rollback, `actualizarServiciosContrato` vuelve a NO poder
-- reconciliar CxP al editar los servicios de un contrato: el código lo detecta
-- y BLOQUEA la edición cuando hay CxP de servicio en juego (falla cerrado, ver
-- `reconciliarCxPServicios`), en vez de dejar contrato y contabilidad
-- distintos en silencio.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- Informativo: cuántos vínculos se van a perder (0 si la 170 nunca se usó).
do $$
declare n bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name = 'servicio_id'
  ) then
    execute 'select count(*) from public.cuentas_por_pagar where servicio_id is not null' into n;
    raise notice 'rollback_170: se perderán % vínculos servicio↔CxP (las filas de CxP NO se borran)', n;
  else
    raise notice 'rollback_170: la columna servicio_id no existe (nada que revertir)';
  end if;
end $$;

drop index if exists public.cuentas_por_pagar_contrato_servicio_idx;
alter table public.cuentas_por_pagar drop column if exists servicio_id;

commit;
