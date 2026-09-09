-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 171 (escritura financiera atómica del contrato).
--
-- Solo borra las tres funciones que creó la 171. NO toca ni un dato: las
-- cuentas por pagar y los costos que se escribieron mientras estuvo activa
-- son dinero real y quedan como están.
--
-- ⚠️ ANTES de correrlo: el código de `reservarDesdeTarifarioInterno` y
-- `convertirCotizacionCarrito` LLAMA a estas funciones. Sin ellas, las dos
-- fallan al crear un contrato (fallan CERRADO — revierten y devuelven error,
-- no crean contratos incompletos), así que este rollback va acompañado de
-- volver el código a la versión anterior, no solo.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f rollback_171_financiero_atomico.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

drop function if exists public.registrar_financiero_contrato(text, text, jsonb, jsonb);
drop function if exists public.revertir_contrato_incompleto(text, text);
drop function if exists public.marca_cxp_automatica();

commit;

\echo '=== Verificación: las tres funciones ya no existen ==='
select
  to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is null as registrar_borrada,
  to_regprocedure('public.revertir_contrato_incompleto(text, text)')                is null as revertir_borrada,
  to_regprocedure('public.marca_cxp_automatica()')                                  is null as marca_borrada;
\echo 'esperado: t | t | t'
