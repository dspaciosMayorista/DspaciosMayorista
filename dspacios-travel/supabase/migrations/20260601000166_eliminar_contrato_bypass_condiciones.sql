-- ───────────────────────────────────────────────────────────────────────────
-- Migración 166 — bypass controlado de inmutabilidad para eliminar_contrato()
--
-- Hallazgo del review estricto de PR #282 (Blocker B1), VERIFICADO empírica-
-- mente contra un Postgres local desechable (nunca remoto, nunca contra
-- producción): desde la migración 165, prácticamente todo contrato nuevo
-- creado por reservar/tarifario/programas/carrito termina con al menos una
-- fila en `contrato_condiciones`. `contrato_condiciones.numero_contrato`
-- referencia `ventas(numero_contrato) on delete cascade` (migración 164), y
-- el trigger `trg_contrato_condiciones_inmutable` (también 164) bloquea
-- UPDATE/DELETE INCONDICIONALMENTE, sin distinguir si el DELETE llega
-- directo o por cascada desde `ventas`. Como `eliminar_contrato()`
-- (migración 159, vigente) borra de `ventas` sin ningún `exception when
-- others`, el cascade dispara el trigger, la excepción aborta TODA la
-- función — el superadmin ya no puede eliminar NINGÚN contrato que tenga
-- condiciones congeladas. Antes de la 165 esto solo afectaba al camino
-- angosto de cotización manual (`convertir_cotizacion_a_contrato`); desde la
-- 165 pasa a afectar a casi todos los contratos nuevos.
--
-- NO se toca la migración 164 (archivo inmutable, ya aplicado en Supabase
-- real) ni la 165. Esta migración es ADITIVA en el sentido de que no cambia
-- esquema — REEMPLAZA (`create or replace function`), como ya es el patrón
-- establecido en este repo (`eliminar_contrato()` ya fue reemplazada 3 veces:
-- 060→117→159; `contrato_condiciones_inmutable()` se reemplaza aquí por
-- primera vez desde que la creó la 164), las DOS funciones involucradas:
--
--   A) `contrato_condiciones_inmutable()` (el trigger) — gana UN escape
--      MUY estrecho: si la operación es DELETE (nunca UPDATE) Y la
--      transacción trae encendido el flag de sesión
--      `app.eliminando_contrato = 'true'`, deja pasar el DELETE. Cualquier
--      otro caso (UPDATE, o DELETE sin el flag) sigue rechazándose
--      exactamente igual que antes — comportamiento por defecto sin cambios,
--      el flag nunca está encendido salvo durante la única ventana descrita
--      abajo.
--
--   B) `eliminar_contrato()` — enciende el flag con `set local` (alcance:
--      SOLO la transacción/llamada RPC actual — cada invocación de una
--      función vía `.rpc()` es su propia transacción implícita; `set local`
--      se revierte solo al terminar esa transacción) INMEDIATAMENTE ANTES
--      del `delete from ventas` que ya tenía, y lo APAGA de nuevo
--      INMEDIATAMENTE DESPUÉS — la ventana en la que el bypass está activo
--      es exactamente la duración de esa UNA sentencia DELETE (con su
--      cascada), nunca el resto de la función ni cualquier otra operación
--      posterior dentro de la misma transacción. El resto del cuerpo
--      (candado de rol superadmin, candado DTM-/p_reusar, limpieza de
--      hijas sin cascade, `numeros_contrato_liberados`) es IDÉNTICO al de
--      la migración 159 — ni un carácter cambiado fuera de las 2 líneas del
--      bypass.
--
-- ── Por qué esto NO relaja la inmutabilidad general de contrato_condiciones ──
-- El bypass NO es "cualquiera puede borrar una condición congelada": sigue
-- siendo imposible hacerlo con una llamada DELETE directa sobre
-- `contrato_condiciones` (el flag nunca está encendido en esa sesión — cada
-- llamada REST/RPC de PostgREST es su propia transacción aislada, no hay
-- forma de que un cliente "prenda" el flag y luego haga un DELETE aparte en
-- la misma transacción: son dos requests HTTP distintas, dos transacciones
-- distintas). Tampoco permite UPDATE bajo ninguna circunstancia — la
-- condición original de un contrato que SIGUE VIVO nunca se puede alterar,
-- que es la garantía de negocio real que exige la 164 ("nunca se recalcula
-- desde catálogos vivos"). Lo único que este bypass habilita es que
-- `eliminar_contrato()` — ya protegida por su propio candado de rol
-- (`mi_rol() = 'superadmin'`, `security definer`) — pueda borrar el
-- CONTRATO COMPLETO, condiciones incluidas, como una unidad — exactamente
-- la misma operación que ya podía hacer con CUALQUIER otra tabla hija del
-- contrato (`contrato_pasajeros`, `contrato_hoteles`, `facturacion`,
-- `abonos`, etc., ninguna de las cuales es inmutable). La inmutabilidad de
-- la 164 protege "el contrato sigue vivo, la condición no cambia bajo sus
-- pies"; el borrado administrativo completo del contrato es un caso
-- categóricamente distinto que YA estaba autorizado para el resto de las
-- hijas — esto solo cierra la asimetría de que UNA tabla hija (la más
-- nueva) quedara fuera de ese mismo alcance ya autorizado.
--
-- Riesgo residual documentado (no nuevo, no ampliado por este cambio):
-- cualquiera con una conexión SQL directa como `service_role`/`postgres`
-- (fuera de la API REST de la app — nunca alcanzable por un cliente HTTP)
-- ya podía saltarse CUALQUIER regla de este esquema (deshabilitar el
-- trigger, hacer DROP, editar `usuarios` para volverse superadmin) —
-- ese nivel de acceso es, por definición, de confianza total y está fuera
-- del modelo de amenazas de RLS/triggers de PostgREST. Este bypass no le da
-- a ese nivel de acceso ninguna capacidad que no tuviera ya.
--
-- Pruebas: supabase/scripts/test_166_eliminar_contrato_bypass.sql (local,
-- desechable). Preflight/postcheck: supabase/scripts/preflight_166_…/
-- postcheck_166_….
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- A) contrato_condiciones_inmutable() — escape estrecho SOLO para DELETE con
--    el flag de sesión encendido. Idéntica en todo lo demás a la de la 164.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.contrato_condiciones_inmutable()
returns trigger language plpgsql as $$
begin
  -- Bypass administrativo estrecho: SOLO DELETE (nunca UPDATE), y SOLO
  -- cuando la transacción trae el flag que ÚNICAMENTE eliminar_contrato()
  -- enciende (con set local, apagado de nuevo apenas termina su propio
  -- DELETE de ventas) — ver cabecera de esta migración para el porqué.
  if TG_OP = 'DELETE'
     and coalesce(current_setting('app.eliminando_contrato', true), 'false') = 'true'
  then
    return old;
  end if;
  raise exception 'contrato_condiciones es permanente: no se puede modificar ni eliminar una condición ya congelada en el contrato %.',
    coalesce(old.numero_contrato, new.numero_contrato);
end;
$$;
-- El trigger ya existe (creado por la 164) y sigue apuntando a esta misma
-- función por nombre — no hace falta recrearlo, `create or replace function`
-- alcanza para que tome el nuevo cuerpo.

-- ───────────────────────────────────────────────────────────────────────────
-- B) eliminar_contrato() — MISMO cuerpo que la migración 159 (candado de rol,
--    candado DTM-/p_reusar, limpieza de hijas, reciclaje de número), con el
--    flag encendido/apagado alrededor del ÚNICO `delete from ventas`.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  if p_reusar and p_numero ~ '^DTM-' then
    raise exception
      'No se puede reutilizar el consecutivo de un contrato DTM- (mayorista): '
      'esa numeración usa una secuencia dedicada que nunca lee de '
      'numeros_contrato_liberados. Vuelve a eliminar el contrato con '
      'p_reusar=false si no necesitas reciclar el número.';
  end if;

  -- Libera las sillas asociadas (vuelven a 'disponible').
  update public.sillas
     set estado = 'disponible', numero_contrato = null,
         pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null,
         numero_doc = null, nacimiento = null, asesor = null, hotel = null,
         acomodacion = null, plazo = null
   where numero_contrato = p_numero;

  -- Desvincula la cotización de origen (vuelve a 'abierta' para reconvertir).
  update public.cotizaciones set numero_contrato = null, estado = 'abierta'
   where numero_contrato = p_numero;

  -- Hijas SIN cascade (factura_items cae por cascade de facturacion).
  delete from public.facturacion          where numero_contrato = p_numero;
  delete from public.rentabilidad         where numero_contrato = p_numero;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero;
  delete from public.aliados_b2b          where numero_contrato = p_numero;
  delete from public.cuentas_por_pagar    where numero_contrato = p_numero;
  delete from public.abonos               where numero_contrato = p_numero;

  -- Ventana ESTRECHA del bypass (migración 166): encendida justo antes del
  -- ÚNICO delete que puede cascadear a contrato_condiciones, apagada
  -- inmediatamente después. `set local` ya está acotado a esta transacción
  -- (esta llamada RPC); apagarlo explícitamente además acota la ventana al
  -- tiempo de esta única sentencia, no al resto de la transacción.
  set local app.eliminando_contrato = 'true';

  -- La venta (contrato_pasajeros/hoteles/vuelos/items/condiciones, vouchers,
  -- adjuntos: cascade).
  delete from public.ventas where numero_contrato = p_numero;

  set local app.eliminando_contrato = 'false';

  if p_reusar then
    insert into public.numeros_contrato_liberados(numero) values (p_numero)
      on conflict do nothing;
  end if;
end;
$$;

notify pgrst, 'reload schema';
