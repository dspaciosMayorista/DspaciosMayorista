-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 245 (#88). Devuelve el esquema a la forma de la 244.
--
-- ⚠ PÉRDIDA DE DATOS: se borran programas.proveedor_asistencia_id y, del registro de
--   costo de la estancia, asistencia_total / proveedor_asistencia_id / trm_costo.
--   El script ABORTA si alguna de esas columnas tiene valores, salvo confirmación:
--     set app.rollback_245_con_datos = 'si';   -- en la misma sesión, antes del script
--   Las CxP y los contratos NO se tocan.
-- ORDEN: revertir PRIMERO el código (despliegue anterior) y después este script: con el
--   código nuevo y las columnas ausentes, la reserva por hotel fallaría de forma visible.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_datos bigint := 0;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programas' and column_name = 'proveedor_asistencia_id') then
    raise exception 'ABORTADO: la 245 no está aplicada (programas.proveedor_asistencia_id no existe).';
  end if;
  select (select count(*) from public.programas where proveedor_asistencia_id is not null)
       + (select count(*) from public.contrato_programa_estancia_costo
           where asistencia_total <> 0 or proveedor_asistencia_id is not null or trm_costo is not null)
    into v_datos;
  if v_datos > 0 and coalesce(current_setting('app.rollback_245_con_datos', true), '') <> 'si' then
    raise exception 'ABORTADO: hay % fila(s) con proveedor de asistencia, asistencia total o TRM de costos; revertir las pierde. Confirma con: set app.rollback_245_con_datos = ''si'';', v_datos;
  end if;
end $$;

begin;

alter table public.programas drop constraint if exists programas_modo_hotel_terrestre_chk;
alter table public.contrato_programa_estancia_costo drop constraint if exists contrato_programa_estancia_costo_asistencia_check;
alter table public.contrato_programa_estancia_costo drop constraint if exists contrato_programa_estancia_costo_trm_check;

alter table public.contrato_programa_estancia_costo drop column if exists asistencia_total;
alter table public.contrato_programa_estancia_costo drop column if exists proveedor_asistencia_id;
alter table public.contrato_programa_estancia_costo drop column if exists trm_costo;
alter table public.programas drop column if exists proveedor_asistencia_id;

-- Forma de la 244: vínculos opcionales a las CxP (quedan en null).
alter table public.contrato_programa_estancia_costo
  add column if not exists cxp_programa_id bigint references public.cuentas_por_pagar(id) on delete set null,
  add column if not exists cxp_noches_id bigint references public.cuentas_por_pagar(id) on delete set null;

notify pgrst, 'reload schema';

commit;
