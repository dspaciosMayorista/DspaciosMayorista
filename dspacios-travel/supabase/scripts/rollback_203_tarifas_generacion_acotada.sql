-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK · migración 203.
-- Antes: volver a desplegar el código anterior (que llama a
-- `reemplazar_tarifas_hotel_calculadora`, intacta desde la 179). Si se corre
-- este rollback con el código nuevo arriba, "Generar tarifas" falla con
-- "function does not exist" sin borrar nada y la ficha muestra el historial
-- como "no disponible".
--
-- ⚠️ NO borra `tarifa_hotel_historial` ni `hotel_temporadas_historial`:
-- guardan las únicas copias de tarifas y vigencias ya reemplazadas o borradas.
-- Solo deja de alimentarlas (quita los triggers) y retira las funciones
-- nuevas. Borrar esas tablas es una decisión aparte y explícita.
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop function if exists public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text);
drop function if exists public._tarifa_huella(jsonb);
drop function if exists public._tarifa_clave(jsonb);
drop function if exists public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer);
drop function if exists public.reconstruir_tarifas_desde_auditoria(bigint);
drop trigger if exists trg_tarifa_hotel_historial on public.tarifa_hotel;
drop trigger if exists trg_hotel_temporadas_historial on public.hotel_temporadas;
drop function if exists public.fn_tarifa_hotel_historial();
drop function if exists public.fn_hotel_temporadas_historial();

commit;

-- Verificación (solo lectura):
select
  to_regprocedure('public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text)') is null
    and to_regprocedure('public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer)') is null
    and to_regprocedure('public.reconstruir_tarifas_desde_auditoria(bigint)') is null
    and to_regprocedure('public._tarifa_huella(jsonb)') is null
    and to_regprocedure('public._tarifa_clave(jsonb)') is null                                  as funciones_retiradas,
  not exists (select 1 from pg_trigger where tgname in ('trg_tarifa_hotel_historial', 'trg_hotel_temporadas_historial')) as triggers_retirados,
  to_regclass('public.tarifa_hotel_historial') is not null
    and to_regclass('public.hotel_temporadas_historial') is not null                           as historiales_conservados;
