-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 194 · retira las funciones del traslado/mover atómico.
--
-- Quita SOLO el código: las 8 funciones públicas y sus 12 ayudantes. NO borra
-- datos: `operaciones_vuelo` y las columnas nuevas de `movimientos_silla` se
-- conservan, porque guardan el historial real de traslados y movimientos ya
-- hechos (quién, cuándo, de qué record a cuál, cupos antes/después). Borrarlas
-- perdería ese historial sin forma de reconstruirlo.
--
-- ⚠️ ORDEN: desplegar ANTES el código anterior. El código nuevo de Vuelos llama
-- a estas funciones; sin ellas, trasladar, mover, retirar, cambiar estado,
-- asignar/quitar manual, liberar y editar pasajero fallan.
--
-- ⚠️ El estado `retirada` (migración 192) NO se puede quitar: Postgres no
-- permite borrar un valor de un enum. Las sillas ya retiradas siguen así y,
-- con el código anterior, aparecen en la tabla del record con ese estado. Son
-- filas que NO cuentan como cupo (cupos_total ya se descontó al retirarlas).
-- ───────────────────────────────────────────────────────────────────────────
begin;

drop function if exists public.trasladar_cupos(bigint, bigint, integer, text, uuid);
drop function if exists public.mover_pasajero(bigint, bigint, text, boolean, text, uuid);
drop function if exists public.retirar_cupo(bigint, text, uuid);
drop function if exists public.cambiar_estado_silla(bigint, text, text, boolean);
drop function if exists public.asignar_contrato_manual(bigint, text);
drop function if exists public.quitar_contrato_manual(bigint);
drop function if exists public.liberar_silla(bigint);
drop function if exists public.editar_pasajero_silla(bigint, jsonb);

drop function if exists public._vuelos_actor();
drop function if exists public._autorizar_contrato_silla(text, text, text, boolean);
drop function if exists public._resolver_contrato_manual(text);
drop function if exists public._ref_manual_normalizada(text);
drop function if exists public._silla_libre(public.sillas);
drop function if exists public._silla_con_datos(public.sillas);
drop function if exists public._reservar_operacion(uuid, text, text, uuid);
drop function if exists public._validar_record_destino(public.bloqueos_vuelo, public.bloqueos_vuelo);
drop function if exists public._sillas_activas(bigint);
drop function if exists public._tramo_usa_ida(public.contrato_vuelos);
drop function if exists public._tramo_usa_regreso(public.contrato_vuelos);
drop function if exists public._tramo_legado(public.contrato_vuelos);

-- Verificación: no debe quedar ninguna.
do $$
declare n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in (
     'trasladar_cupos', 'mover_pasajero', 'retirar_cupo', 'cambiar_estado_silla',
     'asignar_contrato_manual', 'quitar_contrato_manual', 'liberar_silla', 'editar_pasajero_silla',
     '_vuelos_actor', '_autorizar_contrato_silla', '_resolver_contrato_manual', '_ref_manual_normalizada',
     '_silla_libre', '_reservar_operacion', '_validar_record_destino', '_sillas_activas',
     '_tramo_legado', '_tramo_usa_ida', '_tramo_usa_regreso', '_silla_con_datos');
  if n > 0 then raise exception 'Rollback 194 incompleto: quedan % funciones.', n; end if;
end $$;

commit;
