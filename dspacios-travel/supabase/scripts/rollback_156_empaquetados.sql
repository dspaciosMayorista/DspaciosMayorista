-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 156 (inventario de Empaquetados)
--
-- Borra por completo `armado_empaquetados` y `empaquetados` — no hay forma
-- de "revertir parcialmente" una tabla aditiva nueva salvo borrarla. Si ya
-- se cargaron empaquetados reales en producción, este rollback los PIERDE
-- (no hay a dónde migrar esos datos de vuelta: la tabla no existía antes de
-- la 156) — úsalo solo si la migración se corrió por error o antes de tener
-- datos reales cargados. Revisa el conteo antes de correrlo:
--
--   select count(*) from public.empaquetados;
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`). Se
-- pega en el editor SQL de Supabase. Es idempotente (`drop ... if exists`).
-- ───────────────────────────────────────────────────────────────────────────

begin;

drop policy if exists "armado_empaquetados: interno"      on public.armado_empaquetados;
drop policy if exists "empaquetados: lectura operativa"   on public.empaquetados;
drop policy if exists "empaquetados: escritura control"   on public.empaquetados;

drop table if exists public.armado_empaquetados;
drop table if exists public.empaquetados;

commit;
