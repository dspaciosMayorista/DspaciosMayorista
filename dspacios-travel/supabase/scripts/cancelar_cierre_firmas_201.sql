-- ───────────────────────────────────────────────────────────────────────────
-- CANCELAR un cierre PROGRAMADO de las firmas sin versión de Vuelos (201).
-- Rollback de la activación: vuelve a `abierto` y el código viejo sigue
-- funcionando sin fecha. Úsalo si hay que volver a desplegar el código
-- anterior a la 201 mientras la ventana sigue abierta.
--
-- ⚠️ Solo funciona ANTES de `cierra_en`. Una vez cerradas, las firmas viejas
-- no se reabren (el trigger de la 201 lo impide): el código anterior ya no se
-- puede volver a desplegar y la única vía es corregir hacia adelante.
-- Para volver a activarlo después: activar_cierre_firmas_201.sql.
-- ───────────────────────────────────────────────────────────────────────────
begin;
select public.cancelar_cierre_firmas_antiguas('Escribe aquí el motivo (p. ej. rollback del código a la versión anterior)');
select estado, cierra_en, nota from public.vuelos_cierre_firmas_201;
commit;
