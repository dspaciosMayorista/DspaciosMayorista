-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 238 (aliado activo + candado de unicidad de la conversión B2B).
--   · Elimina aliados.activo. SE NIEGA si hay aliados inactivos: al quitar la columna volverían a quedar elegibles en una venta B2B asistida sin
--     que nadie lo decida. Reactívalos (o decide conscientemente dejarlos elegibles) y vuelve a correr este script.
--   · Elimina el índice único, el CHECK y las columnas ventas.cotizacion_origen_id / grupo_conversion. Son solo marcas de idempotencia: quitarlas
--     NO toca precios, comisiones ni contratos; solo deja de impedir que dos conversiones simultáneas de la misma cotización creen dos contratos.
--   · Elimina el disparador trg_cot_b2b_asistido_inmutable (y su función): vuelve a ser posible editar payload.b2bAsistido de una cotización.
-- Si el código nuevo sigue desplegado, su selector de aliados de la venta B2B asistida, la página /dashboard/aliados y la conversión B2B fallan sin
-- esas columnas: revierte primero el despliegue.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aliados' and column_name = 'activo') then
    raise exception 'ROLLBACK 238 ABORTADO: la 238 no está aplicada (no existe aliados.activo).';
  end if;
  if exists (select 1 from public.aliados where activo is not true) then
    raise exception 'ROLLBACK 238 ABORTADO: hay % aliado(s) inactivo(s); al quitar la columna volverían a quedar elegibles.',
      (select count(*) from public.aliados where activo is not true);
  end if;
end;
$$;

drop trigger if exists trg_cot_b2b_asistido_inmutable on public.cotizaciones;
drop function if exists public.tg_cot_b2b_asistido_inmutable();
drop index if exists public.ux_ventas_conversion_cotizacion_grupo;
alter table public.ventas drop constraint if exists ventas_conversion_par_chk;
alter table public.ventas drop column if exists cotizacion_origen_id, drop column if exists grupo_conversion;
alter table public.aliados drop column activo;

commit;
