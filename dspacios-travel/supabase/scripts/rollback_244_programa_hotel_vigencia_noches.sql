-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 244 (programas por hotel y vigencia, #88).
-- La 244 es puramente aditiva: crea 5 tablas y 1 función, y no toca ninguna tabla
-- ni función existente. Revertir = borrarlas.
--
-- ⚠ PÉRDIDA DE DATOS. Las tablas del catálogo (hoteles, precios base, noches) y,
--   sobre todo, la FOTO CONGELADA de los contratos ya reservados
--   (contrato_programa_estancia / _costo) se pierden. Por eso el script ABORTA si
--   existe alguna estancia congelada, salvo que se confirme de forma expresa:
--     set app.rollback_244_con_datos = 'si';   -- en la misma sesión, antes del script
--   Los contratos y sus CxP NO se borran (viven en ventas/cuentas_por_pagar): solo
--   desaparece el detalle de estancia/noches y su registro de costo.
-- ORDEN: revertir PRIMERO el código (despliegue anterior) y después este script.
--   Con el código nuevo desplegado y las tablas ausentes, un programa por hotel y
--   vigencia no cargaría su catálogo (falla visible, no un precio inventado).
-- Un programa que ya quedó en modo_precio = 'hotel' debe volver a 'categoria' o
--   'salida' antes (el código viejo lo trataría como categoría sin matriz).
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_estancias bigint := 0;
  v_programas bigint := 0;
begin
  if to_regclass('public.contrato_programa_estancia') is null
     and to_regclass('public.programa_hoteles') is null
     and to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)') is null then
    raise exception 'ABORTADO: la 244 no está aplicada (no existe ninguna de sus tablas ni su función).';
  end if;
  if to_regclass('public.contrato_programa_estancia') is not null then
    select count(*) into v_estancias from public.contrato_programa_estancia;
  end if;
  select count(*) into v_programas from public.programas where modo_precio = 'hotel';
  if v_estancias > 0 and coalesce(current_setting('app.rollback_244_con_datos', true), '') <> 'si' then
    raise exception 'ABORTADO: hay % contrato(s) con la estancia congelada; revertir los borraría. Confirma con: set app.rollback_244_con_datos = ''si'';', v_estancias;
  end if;
  if v_programas > 0 then
    raise warning 'Hay % programa(s) con modo_precio = hotel: cámbialos a categoria/salida (su catálogo de hoteles se borra con este rollback).', v_programas;
  end if;
end $$;

drop table if exists public.contrato_programa_estancia_costo;
drop table if exists public.contrato_programa_estancia;
drop function if exists public.guardar_programa_hoteles(bigint, jsonb);
drop table if exists public.programa_hotel_noches;
drop table if exists public.programa_hotel_precios;
drop table if exists public.programa_hoteles;

notify pgrst, 'reload schema';
