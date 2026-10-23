-- ───────────────────────────────────────────────────────────────────────────
-- Retira el modo aviso C0 (c0_aviso_guarda_escritura.sql) sin aplicar la 199.
-- La 199 hace lo mismo al aplicarse. La tabla `vuelos_guarda_avisos` se
-- CONSERVA (es la evidencia del ciclo); borrarla es una decisión aparte.
-- ───────────────────────────────────────────────────────────────────────────
begin;
drop trigger if exists sillas_aviso_escritura on public.sillas;
drop trigger if exists bloqueos_aviso_cupos on public.bloqueos_vuelo;
drop function if exists public._c0_sillas_aviso_escritura();
drop function if exists public._c0_bloqueos_aviso_cupos();
drop function if exists public._c0_registrar_aviso(text, text, text, bigint, text);
commit;
