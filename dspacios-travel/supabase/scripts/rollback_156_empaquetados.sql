-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 156 (inventario de Empaquetados)
--
-- Borra por completo `armado_empaquetados`, `empaquetados` y
-- `empaquetado_cambios`, el RPC `actualizar_control_empaquetado()` y la
-- columna `tarifario_resultado.empaquetado_id` — no hay forma de "revertir
-- parcialmente" una tabla aditiva nueva salvo borrarla. Si ya se cargaron
-- empaquetados reales en producción, este rollback los PIERDE (no hay a
-- dónde migrar esos datos de vuelta: la tabla no existía antes de la 156) —
-- úsalo solo si la migración se corrió por error o antes de tener datos
-- reales cargados. Revisa el conteo antes de correrlo:
--
--   select count(*) from public.empaquetados;
--
-- ⚠️ Si `tarifario_resultado` ya tiene filas con `empaquetado_id` no nulo
-- (generadas por un paquete armado con empaquetados vinculados), este
-- rollback las deja con una referencia rota al borrar la columna — igual
-- que pasaría con cualquier columna de una tabla dependiente; revisa antes:
--
--   select count(*) from public.tarifario_resultado where empaquetado_id is not null;
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`). Se
-- pega en el editor SQL de Supabase. Es idempotente (`drop ... if exists`).
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.tarifario_resultado drop column if exists empaquetado_id;

drop policy if exists "armado_empaquetados: interno"        on public.armado_empaquetados;
drop policy if exists "empaquetados: lectura operativa"     on public.empaquetados;
drop policy if exists "empaquetados: escritura control"     on public.empaquetados;
drop policy if exists "empaquetado_cambios: lectura control"   on public.empaquetado_cambios;
drop policy if exists "empaquetado_cambios: escritura control" on public.empaquetado_cambios;

drop function if exists public.actualizar_control_empaquetado(bigint, text, text, text, text);

drop table if exists public.empaquetado_cambios;
drop table if exists public.armado_empaquetados;
drop table if exists public.empaquetados;

commit;
