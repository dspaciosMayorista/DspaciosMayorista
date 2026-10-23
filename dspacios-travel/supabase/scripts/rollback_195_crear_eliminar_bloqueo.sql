-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 195 · retira crear_bloqueo y eliminar_bloqueo.
--
-- La 195 es aditiva (solo crea estas dos funciones; no cambia tablas,
-- policies, privilegios ni datos), así que el rollback solo las quita.
--
-- ⚠️ ORDEN: desplegar ANTES el código anterior. El código nuevo de Vuelos
-- (crearBloqueo, cargarBloqueosMasivo, eliminarBloqueo) llama a estas
-- funciones; sin ellas, crear, cargar por CSV y eliminar bloqueos fallan con
-- "falta la migración" (no escriben nada).
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop function if exists public.crear_bloqueo(jsonb, integer);
drop function if exists public.eliminar_bloqueo(bigint);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and p.proname in ('crear_bloqueo', 'eliminar_bloqueo')) then
    raise exception 'Rollback 195 incompleto.';
  end if;
end $$;

commit;
