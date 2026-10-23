-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 197 · retira confirmar_venta y _confirmar_sillas_de_venta.
--
-- La 197 es aditiva (solo crea estas dos funciones). ⚠️ ORDEN: desplegar
-- ANTES el código anterior: el nuevo confirmarVenta/recalcularEstadoAbono
-- llama a confirmar_venta y, sin ella, la confirmación falla (no escribe).
--
-- La autorización del ayudante DEFINER (testigo `app.confirmar_venta_token`)
-- es un parámetro LOCAL de cada transacción: no deja objetos ni datos que
-- deshacer. Retirar las dos funciones retira también esa vía; si quedara
-- solo el ayudante sin confirmar_venta, sería invocable directo sin el
-- testigo, por eso se borran juntos y se verifica abajo que no quede ninguno
-- ni ninguna función que todavía mencione el testigo.
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop function if exists public.confirmar_venta(text);
drop function if exists public._confirmar_sillas_de_venta(text);

do $$
begin
  if exists (select 1 from pg_proc where proname in ('confirmar_venta', '_confirmar_sillas_de_venta'))
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%app.confirmar_venta_token%') then
    raise exception 'Rollback 197 incompleto.';
  end if;
end $$;

commit;
