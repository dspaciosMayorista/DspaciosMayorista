-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 162 (vista `tarifario_resumen`)
--
-- Es aditiva pura: no toca ninguna tabla, columna, policy ni función
-- existente. Revertirla es simplemente borrar la vista — nada más depende de
-- ella salvo el código de la app (que, si se hace rollback, debe volver a la
-- versión anterior a esta ronda, la que ya usaba `cargarDatosTarifario()` con
-- el catálogo completo).
--
-- Se pega en el editor SQL de Supabase. Idempotente y transaccional (mismo
-- criterio que la migración: si algo falla a mitad de camino, no queda un
-- estado intermedio).
-- ───────────────────────────────────────────────────────────────────────────

begin;

drop view if exists public.tarifario_resumen;

commit;
