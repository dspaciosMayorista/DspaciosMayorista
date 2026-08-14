-- Migración 149: CIERRE — `venta` deja de leer la tabla base `contrato_vuelos`
--
-- ⚠️ CORRER SOLO DESPUÉS DE DESPLEGAR EL CÓDIGO QUE USA `contrato_vuelos_basica`.
--    El orden completo está documentado al final de la migración 148. Resumido:
--       148 (aditiva) → fusionar y desplegar → validar → **149** → pruebas.
--
-- POR QUÉ VA SEPARADA DE LA 148
--   La 148 es aditiva: crea la vista y no le quita acceso a nadie, así que se
--   puede correr con el código viejo arriba. Esta sí quita un acceso que el
--   código viejo usa, y por eso tiene que ir después del despliegue. Si las dos
--   fueran una sola, entre el momento de correrla y el fin del despliegue
--   habría un rato con el código viejo pidiendo una tabla que ya no puede leer:
--   los vuelos desaparecerían de la pantalla del contrato para el rol `venta`.
--
-- QUÉ CIERRA EXACTAMENTE
--   Desde que la 148 está corrida y el código nuevo desplegado, la PANTALLA ya
--   no muestra el PNR ajeno: lee la vista, que lo enmascara. Pero eso es
--   control de interfaz, no de base de datos — con su token, un asesor todavía
--   podía pedir `GET /rest/v1/contrato_vuelos?select=record` y sacar el
--   localizador de cualquier contrato de su agencia. Es la misma lección de la
--   144: RLS filtra FILAS, no COLUMNAS, y lo que la app oculte no cuenta como
--   candado. Aquí se cierra la puerta de verdad.
--
--   El record/PNR no es información comercial: con él se entra al sitio de la
--   aerolínea y se puede modificar o ANULAR la reserva.
--
-- QUÉ NO CAMBIA
--   · Los roles administrativos siguen leyendo la tabla base completa.
--   · Las ESCRITURAS de `venta` sobre `contrato_vuelos` quedan como las dejó la
--     147: solo sobre contratos propios. No se tocan aquí.
--   · `venta` sigue viendo el itinerario (aerolínea, ruta, número de vuelo,
--     fechas y horas) de todos los contratos de su agencia por
--     `contrato_vuelos_basica`, y el record solo en los suyos.
--
-- Idempotente: se dropea el nombre antes de crearlo, así que re-correrla no
-- falla (la lección de la 142 y la 146).

drop policy if exists "contrato_vuelos: lectura" on public.contrato_vuelos;
create policy "contrato_vuelos: lectura" on public.contrato_vuelos for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
         and public.puede_ver_contrato(numero_contrato));

notify pgrst, 'reload schema';
