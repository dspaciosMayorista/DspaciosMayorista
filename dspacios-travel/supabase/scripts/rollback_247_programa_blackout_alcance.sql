-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 247 (PR #409). Devuelve programa_blackouts a la forma anterior (sin alcance, sin CHECK de extremos, sin guardado atómico).
--
-- ⚠ PÉRDIDA DE DATOS: se borra programa_blackouts.alcance. El script ABORTA si algún blackout tiene alcance «viaje» (revertir lo convertiría en
--   «solo fecha de entrada» y dejaría pasar viajes que hoy están bloqueados), salvo confirmación:
--     set app.rollback_247_con_datos = 'si';   -- en la misma sesión, antes del script
-- ORDEN: revertir PRIMERO el código (despliegue anterior) y después este script: con el código nuevo y la columna ausente, el guardado y la reserva fallarían.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_viaje bigint := 0;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programa_blackouts' and column_name = 'alcance') then
    raise exception 'ABORTADO: la 247 no está aplicada (programa_blackouts.alcance no existe).';
  end if;
  select count(*) into v_viaje from public.programa_blackouts where alcance = 'viaje';
  if v_viaje > 0 and coalesce(current_setting('app.rollback_247_con_datos', true), '') <> 'si' then
    raise exception 'ABORTADO: hay % blackout(s) con alcance «viaje»; revertir los dejaría como «solo fecha de entrada». Confirma con: set app.rollback_247_con_datos = ''si'';', v_viaje;
  end if;
end $$;

begin;

drop trigger if exists trg_programa_dias_itinerario_publicado on public.programa_dias;
drop trigger if exists trg_programas_itinerario_publicado on public.programas;
drop trigger if exists trg_programas_traslado_posterior on public.programas;
drop function if exists public.tg_programa_traslado_posterior_sigue_dias();
drop function if exists public.tg_programa_itinerario_publicado();
drop function if exists public.bloquear_itinerario_programa(bigint);
drop function if exists public.guardar_programa_dias(bigint, jsonb, integer);
drop function if exists public.itinerario_programa_problema(bigint, integer);
drop function if exists public.guardar_programa_blackouts(bigint, jsonb);
alter table public.programa_blackouts drop constraint if exists programa_blackouts_extremos_chk;
alter table public.programa_blackouts drop constraint if exists programa_blackouts_alcance_chk;
alter table public.programa_blackouts drop column if exists alcance;

notify pgrst, 'reload schema';

commit;
