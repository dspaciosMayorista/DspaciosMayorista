-- ============================================================================
-- Rollback 215 — Calendario tributario (#43-1a).
--
-- Retira las tres tablas, sus triggers y helpers. NO toca ninguna tabla previa.
-- Falla cerrado si ya hay calendario cargado: borrarlo es perder la
-- configuracion que la persona digito (obligaciones, fechas y constancias).
-- Si de verdad se quiere retirar con datos, exportarlos primero y vaciar las
-- tablas a mano; luego correr este script.
--
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f rollback_215_calendario_tributario.sql
-- ============================================================================

\echo '=== ROLLBACK 215: calendario tributario ==='

begin;

do $$
declare n bigint := 0;
begin
  if to_regclass('public.obligacion_tributaria') is not null then
    select (select count(*) from public.obligacion_tributaria)
         + (select count(*) from public.obligacion_vencimiento)
         + (select count(*) from public.obligacion_cumplimiento) into n;
  end if;
  if n > 0 then
    raise exception 'ROLLBACK_DETENIDO: hay % fila(s) de calendario cargadas; exportarlas y vaciar las tablas antes de retirar la 215', n;
  end if;
end;
$$;

drop table if exists public.obligacion_cumplimiento;
drop table if exists public.obligacion_vencimiento;
drop table if exists public.obligacion_tributaria;

drop function if exists public.calendario_puede_registrar(text);
drop function if exists public.calendario_puede_configurar(text);
drop function if exists public.calendario_puede_ver(text);
drop function if exists public._obligacion_proteger_cambio();
drop function if exists public._obligacion_validar_fila();
drop function if exists public.periodos_por_anio(text);

commit;

notify pgrst, 'reload schema';

\echo '=== FIN ROLLBACK 215 ==='
