-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 161 (vista `tarifario_resumen`)
--
-- Es aditiva pura: no toca ninguna tabla, columna, policy ni función
-- existente. Revertirla es simplemente borrar la vista — nada más depende de
-- ella salvo el código de la app (que, si se hace rollback, debe volver a la
-- versión anterior a esta ronda, la que ya usaba `cargarDatosTarifario()` con
-- el catálogo completo).
--
-- Se pega en el editor SQL de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

drop view if exists public.tarifario_resumen;
