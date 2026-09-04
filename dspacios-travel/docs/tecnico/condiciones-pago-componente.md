# Condiciones de pago por componente (migraciones 164, 165 y 166)

> Qué es / Dónde vive / Modelo de datos / Funciones clave / Flujo / Reglas de negocio y
> fórmulas / Gotchas / Enlaces cruzados — ver convención en `README.md`.
>
> **Estado (04-sep-2026):** PR #280 (migración 164) y PR #282 (migraciones 165/166, "Rama B")
> están **fusionados en `main` y desplegados**. Las tres migraciones están **aplicadas en
> Supabase real** — preflight/postcheck de las tres pasaron. Todavía **no hay ningún caso real**
> (reserva/contrato nuevo por tarifario/programas/carrito) que haya ejercitado el camino de la
> Rama B en producción — ver "Checklist de smoke test" más abajo para cuando aparezca el primero.

## Qué es

Antes de esta migración, una cotización manual (`cotizacion_manual`) solo admitía **una**
condición de pago global (anticipo % + saldo a N días) para TODO el paquete. En la práctica el
proveedor de hotel puede exigir 100% de anticipo mientras el vuelo se paga después, o un
receptivo no exige nada por adelantado — **una condición por componente**, no una global.

La migración `20260601000164_condiciones_pago_componente.sql` (única, acumulativa — Commits
1-6 de la rama `condiciones-pago-componentes`, PR #280, nunca dividida mientras no se había
aplicado en producción) agrega: condición de pago por componente en el catálogo (hotel/paquete/
programa), snapshot congelado por cotización al primer pago, registro atómico de pagos previos
a una cotización (antes de que exista contrato), conversión de UNA cotización manual a UN
contrato (con reclasificación contable), y candados de inmutabilidad autoritativos en base de
datos. Su alcance original era **solo la cotización manual** (ver más abajo).

PR #282 ("Rama B", migraciones **165** y **166**, ya con la 164 en producción — por eso sí
llevan número nuevo en vez de acumularse en la 164) cierra el pendiente que PR #280 dejó
documentado: los contratos que nacen **directo de catálogo/tarifario/reservar/programas/
carrito** (fuera de la cotización manual) ahora también congelan condiciones de pago reales al
crearse. Ver "Rama B — congelado fuera de la cotización manual" más abajo para el detalle
completo.

## Dónde vive

- **Esquema:** `supabase/migrations/20260601000164_condiciones_pago_componente.sql` (único
  archivo, ~1500 líneas — todo el feature).
- **Resolver puro compartido (TS):** `lib/cotizacion/condicionPago.ts` (reglas por componente),
  `lib/cotizacion/componentesManual.ts` (deriva componentes de una cotización manual),
  `lib/cotizacion/snapshotCondiciones.ts` (`construirSnapshot`, espejo TS del snapshot que
  arma `registrar_pago_previo` en SQL — mismas fórmulas, verificadas en
  `pruebas/snapshotCondiciones.test.ts`), `lib/cotizacion/condicionesParaUI.ts` (adapta filas
  para la tabla de la UI).
- **UI:** `app/(dashboard)/dashboard/cotizaciones/` (formulario de condiciones por componente
  al crear/editar una cotización manual), `app/(dashboard)/dashboard/contratos/[numero]/`
  (`OverrideRestriccionForm.tsx` — excepción manual, solo superadmin).
- **PDF/documento:** `components/contrato/CotizacionManualDocumento.tsx` y el documento del
  contrato ya generado muestran las condiciones congeladas (no las del catálogo — ver
  "TRM y precio congelados" abajo).
- **Scripts de despliegue/verificación** (todos `supabase/scripts/`): `preflight_164_...sql`,
  `postcheck_164_...sql`, `rollback_164_...sql`, `test_164_commit6_...sql` (candados/overrides),
  `test_164_conversion_battery.sql` (conversión/CxP/ACL, cadena real 1→163+164),
  `test_164_concurrencia_real.sql`/`.sh` (concurrencia real de 2 conexiones + idempotencia,
  cadena real — sin Docker), `test_164_schema.sql`/`test_164_secuencial.sql`/
  `test_164_concurrencia.sh`/`.sql`/`test_164_conversion_concurrency.sh` (espejo manual +
  Docker, Commits 4-5, complementario a lo anterior), `test_164_espejo.sh` (guard de que el
  espejo Docker no diverge de la migración real — ver "Guard de espejo" abajo),
  `supabase/scripts/lib/espejo164.mjs` (lógica pura de ese guard, con controles negativos en
  `pruebas/espejo164.test.ts`).
- **Rama B (PR #282, migraciones 165/166) — esquema:**
  `supabase/migrations/20260601000165_congelar_condiciones_reservar.sql` (RPC
  `congelar_condiciones_contrato`, function-only) y
  `supabase/migrations/20260601000166_eliminar_contrato_bypass_condiciones.sql` (bypass
  controlado de `eliminar_contrato()`, function-only, corrige el Blocker B1 — ver más abajo).
- **Rama B — puente TypeScript:** `lib/contrato/congelarCondicionesContrato.ts`
  (`vigenciasCondicionDeHotel`, `componenteHotelReal`, `componentePaqueteReal`,
  `componenteProgramaReal`, `trmReferenciaAproximada`, `congelarCondicionesContrato`,
  `congelarCondicionesContratoBestEffort`) — reutiliza `condicionDesdeCatalogo.ts`,
  `snapshotCondiciones.ts` y `condicionPago.ts` SIN modificarlos.
- **Rama B — wiring:** `app/(dashboard)/dashboard/reservar/actions.ts`
  (`reservarDesdeTarifarioInterno`, `reservarProgramaInterno`, `convertirCotizacionCarrito`).
- **Rama B — scripts:** `preflight_165_...sql`/`postcheck_165_...sql`/
  `test_165_congelar_condiciones.sql`, `preflight_166_...sql`/`postcheck_166_...sql`/
  `test_166_eliminar_contrato_bypass.sql`,
  `supabase/scripts/pruebas/test_concurrencia_165_congelar_condiciones.sh` (concurrencia real,
  2 conexiones).
- **Rama B — pruebas TS:** `pruebas/congelarCondicionesContrato.test.ts` (17 pruebas de
  ejecución real, cliente Supabase falso inyectado), `pruebas/
  congelarCondicionesContratoWiring.test.ts` (5 pruebas de wiring por inspección de código).

## Modelo de datos (piezas nuevas de la 164)

- **Catálogo** (`hotel_temporadas`, `armado_paquetes`, `programas`): `condicion_pago_tipo`
  (`'sin_condicion'|'anticipo_saldo'`, default según tabla), `condicion_pago_pct_aplicable`,
  `condicion_pago_dias_saldo`. `armado_paquetes`/`programas` también ganan
  `restriccion_comercial` (`'normal'|'no_reembolsable'|'no_endosable'`, CHECK admite los 3).
- **`cotizacion_condiciones`**: snapshot CONGELADO por componente al momento del primer pago
  (1 fila por componente de esa cotización: orden, tipo_componente, referencia_externa,
  valor_componente, condición de pago, monto_exigido, restricción, `congelado=true`). Nunca se
  regenera — es la fuente de verdad de "qué se le exigió a este cliente", inmune a que el
  catálogo cambie después.
- **`cotizacion_pagos_previos`**: pagos recibidos ANTES de que exista un contrato (la
  cotización aún no se convirtió). `huella_solicitud` (hash canónico) + `idempotency_key`
  (UNIQUE) — ver "Idempotencia" abajo. `estado`: `activo|aplicado|anulado`.
- **`cotizaciones`** gana: `condicion_pago_congelada_en`, `trm_autoritativa`,
  `moneda_congelada`, `precio_total_congelado`, `monto_exigido_total(_cop)`,
  `pct_efectivo_informativo`.
- **`contrato_condiciones`**: copia PERMANENTE de `cotizacion_condiciones` al convertir a
  contrato (para que el contrato no dependa de que la cotización siga existiendo/editable).
- **`restriccion_overrides`** (Commit 6): excepción registrada a una restricción comercial de
  un `contrato_condiciones` puntual — append-only (ver "Overrides" abajo).
- **`ventas.cotizacion_id`** (UNIQUE nullable): fuerza **una cotización manual → un solo
  contrato** — ver "Un contrato por cotización" abajo. `NULL` en todo contrato histórico o de
  cualquier otro flujo (tarifario/reservar/programas) que no pase por cotización manual.
- **`config_cobros_componente`**: `%` de anticipo esperado por tipo de componente (seed:
  hotel/vuelo_bloqueo/servicio = 0.30; **sin fila para `aereo_empaquetado`** — el aéreo por
  sistema es 100% fijo en el motor, no configurable — ver postcheck sección `seed-config`).

## Funciones clave (PL/pgSQL, todas `SECURITY DEFINER`, EXECUTE solo `service_role`)

- **`registrar_pago_previo(...)`**: registra un pago sobre una cotización `abierta`. Si es el
  PRIMER pago de esa cotización, congela el snapshot completo (`p_snapshot` jsonb → una fila
  por componente en `cotizacion_condiciones`) y fija TRM/moneda/precio. Idempotente por
  `p_idempotency_key` — fail-closed si la misma clave llega con datos distintos (ver
  "Idempotencia" abajo). Bloquea con `select ... for update` sobre la fila de `cotizaciones`,
  así que dos llamadas concurrentes sobre la misma cotización se serializan por lock, no por
  ninguna lógica de aplicación.
- **`anular_pago_previo(...)`**: reversa contable de un pago `activo` (nunca borra el asiento
  original — inserta el reverso).
- **`convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id)`**: el único camino que
  convierte una cotización manual congelada en un contrato real. Ver "Flujo de conversión".
- **`registrar_override_restriccion(...)`** (Commit 6): excepción manual a una restricción
  comercial de un componente ya convertido — solo `superadmin`, exige motivo, append-only.
- **`_autorizado_pago_previo(p_usuario_id)`**: exige `usuarios.rol` ∈
  `{superadmin,administracion,gerencia,operaciones}` y `activo=true`.
- **`_huella_pago_previo(...)`**: hash canónico (cotización+monto+moneda+forma+referencia+
  fecha) usado por la idempotencia.

## Flujo de conversión (cotización → contrato)

`convertir_cotizacion_a_contrato`: autorización del actor → tenant → **replay** (si
`ventas.cotizacion_id` ya apunta a esta cotización, devuelve el contrato existente SIN
consumir un número nuevo) → tipo de cotización convertible → estado → cotización congelada →
titular presente → monto mínimo pagado → recién ahí genera `numero_contrato`. El orden importa:
generar el número es lo ÚLTIMO que hace la función, después de toda validación barata — un
replay o un rechazo nunca gasta un consecutivo (cubierto por
`pruebas/numeracionOrdenWiring.test.ts`, que lee el texto real de la migración y verifica el
orden de los marcadores).

## Un contrato por cotización

`ventas.cotizacion_id` es `UNIQUE NULLABLE`. Convertir la misma cotización dos veces devuelve
el MISMO contrato (replay por el UNIQUE + lectura antes de generar número), nunca crea un
segundo. Contratos que no nacen de una cotización manual (tarifario, reservar, programas,
histórico importado) quedan con `cotizacion_id = NULL` — el modelo no los toca ni los exige.

## TRM y precio congelados

El PRIMER pago fija `trm_autoritativa` (1.0 fijo si la cotización es COP; el valor pasado
por el usuario si es USD) y `precio_total_congelado`. Todo pago posterior sobre esa misma
cotización usa la TRM YA congelada — nunca la del momento del pago — así que dos pagos con TRM
distintas nunca mezclan tasas dentro de la misma cotización (verificado con dos conexiones
reales compitiendo por ser el primer pago: T4' en `test_164_concurrencia_real.sh`).

## Idempotencia (clave de intento, B1)

`p_idempotency_key` es única globalmente. Una clave repetida con la MISMA huella
(cotización+monto+moneda+forma+referencia+fecha) devuelve el pago YA registrado sin duplicar
— útil para reintentos de red/doble-click. Una clave repetida con CUALQUIER dato distinto se
**rechaza** (fail-closed): nunca se reutiliza en silencio ni se sobreescribe. Verificado con
dos conexiones reales enviando la MISMA clave a la vez (T3' en `test_164_concurrencia_real.sh`)
y con un replay exacto + un intento divergente en el mismo script.

## Reclasificación contable 280510 → 280505

Un pago previo (antes de que exista contrato/factura) se postea como **anticipo sin
identificar** (`280510`) porque todavía no hay CxC a la que aplicarlo. Al facturar el
contrato ya convertido, el motor de facturación existente (pre-164, ver `docs/tecnico/
contabilidad.md`) reclasifica ese anticipo a **anticipo de clientes identificado** (`280505`)
contra la CxC real. La 164 no introduce una cuenta nueva para esto — reutiliza el par
280510/280505 ya sembrado en la migración 129.

## CxP atómica

Cada componente con costo (hotel/aéreo/servicio) genera su cuenta por pagar dentro de la
MISMA transacción de conversión — nunca en un paso aparte que pueda quedar a medias. La
batería `test_164_conversion_battery.sql` (categoría C7) verifica tipo de proveedor,
retención y cuenta contable exacta por cada CxP generada.

## Restricciones no-reembolsable y no-endosable (SIEMPRE juntas)

Decisión del dueño: toda restricción comercial es **siempre** no reembolsable **y** no
endosable a la vez — no existe un estado intermedio (nunca "no reembolsable pero sí
endosable", ni al revés). Los tres valores válidos de `restriccion_comercial` son:

- `normal` — sin restricción.
- `promocional_no_reembolsable_no_endosable` — tarifa promocional (el caso más frecuente de
  esta restricción). El prefijo `promocional_` identifica únicamente el ORIGEN comercial —
  nunca un subconjunto distinto de restricciones.
- `no_reembolsable_no_endosable` — tarifa normal restringida. Mismo efecto exacto que la
  anterior; solo cambia el origen.

Ambos valores no-`normal` producen las MISMAS dos etiquetas ("No reembolsable" + "No
endosable", `etiquetasRestriccion()` en `lib/cotizacion/etiquetasCondicion.ts`) y el mismo
efecto (`esRestriccionComercial()` los trata igual). `restriccion_comercial` viaja del
catálogo → snapshot (`cotizacion_condiciones`) → contrato (`contrato_condiciones`), congelada
igual que el resto — cambiar la restricción en el catálogo después no altera contratos ya
congelados.

⚠️ El valor `promocional_no_reembolsable` (sin `_no_endosable`) fue un nombre PROVISIONAL,
eliminado antes de que la migración 164 se aplicara en cualquier entorno real — sugería que
una tarifa promocional pudiera ser no-reembolsable sin ser también no-endosable, lo cual nunca
fue una regla de negocio válida. No debe reaparecer en código nuevo.

## Overrides (excepción a una restricción) — append-only

`registrar_override_restriccion` (Commit 6) es la ÚNICA forma de dejar constancia de que una
restricción comercial se saltó en un caso puntual (ej. se aceptó reembolsar algo marcado
no-reembolsable). Reglas duras, todas a nivel de base de datos (no solo de la Server Action):
- Solo `superadmin` (verificado en el RPC, no solo en la UI — `registrar_override_restriccion`
  vuelve a exigir el rol server-side).
- Motivo obligatorio, actor y fecha se registran siempre.
- **Nunca se puede editar ni borrar** un override ya creado (`trg_restriccion_overrides_guardas`
  — sin policy de UPDATE/DELETE + trigger autoritativo incluso contra `service_role` o SQL
  directo de superusuario, verificado manualmente en el ciclo de Commit 7). Para "deshacer" un
  override hay que registrar uno nuevo que lo contradiga, dejando el historial completo.
- El motivo/actor NO son públicos (no aparecen en la vista pública por token del contrato,
  solo en la ficha administrativa).

## Candados de inmutabilidad (autoritativos, no solo de aplicación)

Tres triggers `BEFORE UPDATE/DELETE` bloquean alterar datos ya congelados/convertidos, **incluso
para `service_role` o una sesión de superusuario ejecutando SQL directo** (no dependen de RLS
ni de qué rol llama):
- `trg_cotizacion_condiciones_bloquear_congeladas` — ninguna fila de `cotizacion_condiciones`
  se puede tocar una vez la cotización está congelada.
- `trg_contrato_condiciones_inmutable` — ninguna fila de `contrato_condiciones` se puede tocar
  después de creada.
- `trg_ventas_cotizacion_id_inmutable` — `ventas.cotizacion_id` no se puede reasignar una vez
  puesto.
Verificado en el ciclo de Commit 7 con un `UPDATE`/`DELETE` directo como superusuario contra
una fila ya congelada — ambos rechazados por el trigger, no por RLS.

## Alcance — PR #280 (cotización manual) + PR #282 (Rama B)

PR #280 (migración 164) dejó el mecanismo completo (condición por componente, congelado, pagos
previos, conversión 1:1) funcionando **solo para la cotización manual**
(`app/(dashboard)/dashboard/cotizaciones/`), y dejó documentado como pendiente que tarifario/
reservar/programas/carrito no lo tocaban.

PR #282 ("Rama B") cierra exactamente ese pendiente: los 3 caminos que crean un contrato
DIRECTO (sin pasar por una cotización con etapa de "primer pago") ahora también congelan
condiciones de pago **reales** (no defaults) al crear el contrato, usando los mismos módulos
puros de la 164 (`condicionPago.ts`, `snapshotCondiciones.ts`, `condicionDesdeCatalogo.ts`,
ninguno modificado).

## Rama B — congelado fuera de la cotización manual (migraciones 165/166)

### Por qué necesitó dos migraciones nuevas, no una

164 ya estaba **aplicada en producción** cuando arrancó PR #282 (regla del proyecto: nunca
editar una migración ya corrida) — así que todo lo nuevo tuvo que ir en migraciones propias,
ambas *function-only* (cero cambios de esquema):

- **Migración 165** (`congelar_condiciones_contrato`): el RPC que congela un snapshot ya
  calculado en TypeScript hacia `contrato_condiciones`, para contratos que NO tienen una
  `cotizacion_condiciones` de la que copiar (no hay tabla de staging en estos 3 flujos — el
  snapshot se arma en memoria y se pasa directo).
- **Migración 166** (bypass de `eliminar_contrato()`): corrige un blocker real que apareció
  DESPUÉS de aplicar la 165 — ver "Blocker B1" más abajo.

### Migración 165 — `congelar_condiciones_contrato`

Dos funciones nuevas, ambas `EXECUTE` solo para `service_role` (mismo patrón que
`registrar_pago_previo`/`convertir_cotizacion_a_contrato` de la 164):

- **`_autorizado_congelar_condiciones(p_usuario_id)`**: mismo criterio que `ESCRITURA.ventas`
  en `lib/roles.ts` (`superadmin|administracion|gerencia|operaciones|venta`) — **distinto** del
  candado de pagos previos de la 164 (que excluye `venta`): congelar al crear un contrato es
  parte del mismo flujo de reservar que ya puede ejecutar `venta`, no una operación de dinero
  post-hecho.
- **`congelar_condiciones_contrato(p_numero_contrato, p_snapshot jsonb, p_moneda, p_trm,
  p_usuario_id)`**: bloquea la fila de `ventas` con `select ... for update` (serializa
  llamadas concurrentes para el MISMO contrato — verificado con 8 llamadas concurrentes reales
  durante la revisión, y con un script persistido de 2 conexiones,
  `test_concurrencia_165_congelar_condiciones.sh`), hace **no-op seguro** si el contrato ya
  tiene filas en `contrato_condiciones` (nunca duplica en un reintento/doble-click — a
  diferencia de `convertir_cotizacion_a_contrato`, aquí no hay ningún estado previo tipo
  "cotización ya convertida" que lo impida por sí solo), valida tenant/rol, e inserta desde el
  arreglo JSON.

### Migración 166 — bypass controlado de `eliminar_contrato()` (Blocker B1)

**El bug:** `contrato_condiciones.numero_contrato references ventas(numero_contrato) on delete
cascade` (164) + el trigger de inmutabilidad de esa misma migración (`trg_contrato_condiciones_
inmutable`) bloquea DELETE **incondicionalmente**, incluso cuando llega por cascada.
`eliminar_contrato()` (159, sin ningún `exception when others`) borra de `ventas` → dispara el
cascade → dispara el trigger → excepción → **toda la función aborta**. Antes de la 165 esto solo
afectaba al camino angosto de la cotización manual convertida; desde la 165, casi todo contrato
nuevo tiene alguna fila congelada, así que `eliminar_contrato()` (la herramienta que el
superadmin usa para limpiar contratos duplicados/de prueba/erróneos) habría quedado rota para
la inmensa mayoría de contratos nuevos si no se corregía.

**La corrección:** reemplaza (`create or replace function`, mismo patrón ya usado 3 veces con
`eliminar_contrato()` en este repo: 060→117→159) dos funciones existentes, sin tocar 164 ni 165:

- `contrato_condiciones_inmutable()` gana un escape MUY estrecho: solo para `TG_OP = 'DELETE'`
  (**nunca** UPDATE) y solo cuando la transacción trae encendido `app.eliminando_contrato =
  'true'`.
- `eliminar_contrato()` enciende ese flag con `set local` (transaction-scoped — nunca sobrevive
  a esa una llamada RPC, ni siquiera con connection pooling) inmediatamente antes de su único
  `delete from ventas`, y lo apaga inmediatamente después. El resto del cuerpo es idéntico a la
  migración 159.

**Por qué no relaja la inmutabilidad general** (mismo razonamiento documentado en la cabecera
de la migración 166): UPDATE sigue bloqueado siempre, con o sin flag. Un DELETE directo sobre
`contrato_condiciones` sin pasar por `eliminar_contrato()` sigue bloqueado — el flag nunca se
enciende en esa sesión (cada request de PostgREST es su propia transacción aislada). Lo único
que el bypass habilita es que `eliminar_contrato()` — ya protegida por su propio candado de rol
(`mi_rol() = 'superadmin'`) — borre el contrato COMPLETO como unidad, exactamente la misma
operación que ya podía hacer con cualquier otra tabla hija no-inmutable del contrato.

**Verificado empíricamente** (no solo razonado): el bug se reprodujo en una base local
construida solo hasta la 165 (sin la 166); después de aplicar la 166 se confirmó que
`eliminar_contrato()` funciona con condiciones congeladas, que un DELETE directo sigue
bloqueado, y que un UPDATE directo sigue bloqueado **incluso con el flag encendido a mano en la
misma sesión** (`supabase/scripts/test_166_eliminar_contrato_bypass.sql`, T1-T6b).

## Puente TypeScript (`lib/contrato/congelarCondicionesContrato.ts`)

Arma el `ComponenteSnapshot[]` con datos REALES de catálogo (nunca defaults inventados) y llama
al RPC de la 165:

- **Hotel** (`componenteHotelReal`/`vigenciasCondicionDeHotel`): NO usa el "ganador" del motor
  de precios (`lib/calc/paquetes.ts`, no tocado — su tipo `TemporadaRango` ni siquiera tiene un
  campo `id`, así que estructuralmente no puede exponer qué vigencia ganó una noche). En su
  lugar consulta **todas** las vigencias reales del hotel (`hotel_temporadas`, con `id`) en el
  momento de crear el contrato, y reduce a la condición más exigente de la estadía completa con
  `condicionHotelEstadia` (+ `barridoRestriccionEstadia` para la restricción comercial) —
  ambas funciones puras ya construidas y probadas en la 164, sin modificar.
  - Devuelve `null` (nunca congela un dato incorrecto) si la consulta de vigencias falla por un
    error técnico real — distinto de "el hotel legítimamente no tiene vigencias configuradas"
    (que sí resuelve a neutro, caso de negocio válido). Ver "Riesgos residuales" para el porqué
    de esta distinción.
- **Paquete/Programa** (`componentePaqueteReal`/`componenteProgramaReal`): usa
  `input.paqueteId`/`input.programaId` + `componenteDeArmadoPaquete`/`componenteDePrograma`
  (`condicionDesdeCatalogo.ts`, sin modificar). Devuelven `null` si la fila no existe.
- **TRM aproximada** (`trmReferenciaAproximada`): ver "Riesgos residuales" abajo.
- **`congelarCondicionesContrato`/`congelarCondicionesContratoBestEffort`**: arma el snapshot
  final (motor puro `construirSnapshot`, sin tocar) y llama al RPC. La variante *best-effort*
  nunca lanza ni bloquea la creación del contrato — solo registra en el log del servidor. El
  congelado es un enriquecimiento del contrato, no un requisito para que exista.

## Los 3 puntos de wiring + flujos fuera de alcance

Investigados explícitamente antes de cablear (no se asumió nada):

- **`reservarDesdeTarifarioInterno`**: con hotel (`!esServicios`), congela un componente
  `"hotel"` con **todo** `precio_venta`. Sin hotel (paquete tipo `servicios`), congela un
  componente `"paquete"` con la condición de `armado_paquetes`. Mutuamente excluyente por
  construcción de `computarReserva` (`esServicios=true` nunca genera `contrato_hoteles`).
- **`reservarProgramaInterno`**: un solo componente `"programa"` por el `precio_venta`
  completo, condicionado por la propia fila de `programas` (ya traída en el SELECT existente,
  ampliado con las 4 columnas de condición — sin consulta extra).
- **`convertirCotizacionCarrito`**: acumula un componente `"hotel"` por CADA hotel del grupo
  (su propio `hotelId` + su propio `precioVenta`) más un componente `"servicio"` neutro por
  cada tour con precio > 0 (no hay fuente de condición propia para tours), y congela **una
  sola vez** por `numero_contrato`, después de armar hoteles y tours.
- **`app/tarifario/checkout/actions.ts` — confirmado FUERA de alcance**: `crearCotizacionCarrito`/
  `crearSolicitudReserva` nunca insertan en `ventas` directamente, solo arman una fila
  `cotizaciones` (`tipo='carrito'`) que después se convierte vía `convertirCotizacionCarrito`
  (ya cableado) — no hay un segundo punto que cablear ahí.

## Riesgos residuales aceptados (Rama B, documentados a propósito — no bugs)

- **TRM aproximada en reservas directas**: a diferencia de la cotización manual (que congela
  `trm_autoritativa` con el primer pago previo), `reservarDesdeTarifarioInterno`/
  `reservarProgramaInterno` NO capturan una TRM del día al crear el contrato (limitación
  estructural preexistente, no introducida por esta rama). Para una reserva en moneda distinta
  de COP se usa `trm_referencia` (`parametros_tributarios`, la misma tasa informativa que ya
  usan rentabilidad/estados financieros) como aproximación; sin configurar, cae a 1. Esto NO
  afecta el monto exigido en la moneda de la reserva (autoritativo) — solo el equivalente en
  COP guardado junto al snapshot, mismo criterio que el resto de conversiones USD→COP
  pendientes de esta app.
- **El componente "hotel" toma TODO el `precio_venta` cuando hay hotel**: el motor de precios
  funde vuelo negociado + hotel negociado + servicios en un solo PVP por acomodación ANTES de
  que `reservar` lo use — no hay forma de recuperar "cuánto es hotel vs. cuánto es vuelo" sin
  tocar ese motor (fuera de alcance por decisión explícita del dueño). La condición del hotel
  (`hotel_temporadas`) gobierna entonces el PVP completo del contrato — es donde el dueño
  configura en la práctica la condición restrictiva de un bloqueo/porción negociado.
- **El componente "paquete" solo aplica cuando `esServicios`**: la condición propia de
  `armado_paquetes.condicion_pago_tipo` queda **sin efecto** cuando el paquete sí tiene hotel
  (el componente "hotel" manda todo el PVP en ese caso) — decisión documentada, pendiente de
  confirmar con el dueño si en algún momento se quiere combinar ambas fuentes de condición para
  un mismo contrato.
- **`regimen_restringido` fuera de alcance**: `condicionHotelEstadia` ya filtra por rango de
  fechas; el régimen de una vigencia solo importaría si DOS vigencias cubrieran la MISMA fecha
  con condición distinta por régimen — caso no observado en el catálogo actual. Si aparece,
  requiere revisión (no está cableado hoy).
- **La cotización manual (texto libre) sigue desacoplada del catálogo**: `componentesManual.ts`
  (PR #280) nunca tuvo FK a `hotel_temporadas`/`armado_paquetes`/`programas` — sus servicios son
  texto libre por diseño (ver su propia cabecera). La Rama B no cambia eso: sigue siendo
  neutro/`% normal` siempre, nunca condicionado por catálogo. Son dos mecanismos de congelado
  que conviven (uno por cotización manual con snapshot vía `cotizacion_condiciones`, otro
  directo a `contrato_condiciones` para los 3 flujos de la Rama B) — nunca se mezclan.
- **Error de consulta al leer vigencias de hotel**: corregido en la revisión de PR #282
  (finding F1) para que un error técnico real NUNCA se confunda con "el hotel no tiene
  vigencias" — ver "Puente TypeScript" arriba. Mencionado aquí porque, aunque ya está resuelto,
  es la clase de fallo a vigilar si en el futuro se agregan más fuentes de catálogo al
  congelado.

## Checklist de smoke test (pendiente — para cuando exista una reserva real por estos 3 caminos)

Ninguno de estos pasos se ha ejecutado todavía en producción (no había un caso real al momento
de escribir esto). Cuando el dueño haga la PRIMERA reserva real por cada camino después del
despliegue de PR #282, verificar en la BD real (solo lectura, sin crear datos ficticios
adicionales — usar la reserva real que ya se hizo):

1. **`reservarDesdeTarifarioInterno` (bloqueo/porción, con hotel)**: el contrato nuevo tiene
   exactamente 1 fila en `contrato_condiciones`, `tipo_componente='hotel'`,
   `valor_componente` = `ventas.precio_venta` de ese contrato, `condicion_pago_tipo` coincide
   con la vigencia real vigente del hotel para esas fechas (revisar `hotel_temporadas` del
   hotel reservado).
2. **`reservarDesdeTarifarioInterno` (paquete tipo `servicios`, sin hotel)**: 1 fila,
   `tipo_componente='paquete'`, condición coincide con `armado_paquetes.condicion_pago_tipo`
   del paquete usado.
3. **`reservarProgramaInterno`**: 1 fila, `tipo_componente='programa'`, condición coincide con
   `programas.condicion_pago_tipo` del programa reservado.
4. **`convertirCotizacionCarrito` (multi-hotel)**: N filas `tipo_componente='hotel'` (una por
   hotel del carrito) + filas `tipo_componente='servicio'` por cada tour con precio > 0; la
   SUMA de `valor_componente` de todas las filas del contrato = `ventas.precio_venta`.
5. **Panel del contrato** (`/dashboard/contratos/[numero]`,
   `CondicionesContratoPanel.tsx`): las condiciones se ven correctamente, sin romper para un
   contrato SIN condiciones congeladas (histórico — debe seguir sin mostrar sección, nunca
   inventar "sin restricciones").
6. **Contrato público por token** (`app/c/[token]/page.tsx`): NO expone motivo/actor de ningún
   override (no debería haber overrides todavía sobre estos contratos nuevos, pero confirmar
   que el render sigue igual que para los de cotización manual).
7. **`eliminar_contrato()` sobre uno de estos contratos** (solo si se necesita limpiar un
   contrato de prueba/erróneo, nunca sobre datos reales de un cliente): confirmar que SÍ
   funciona (era el Blocker B1, ya corregido por la 166) — no ejecutar contra un contrato real
   de cliente solo para "probar".
8. Confirmar que ningún log de servidor muestra `[congelarCondicionesContrato] contrato ...`
   (el prefijo que usa `congelarCondicionesContratoBestEffort` al fallar) — su presencia
   indicaría que el congelado falló silenciosamente para ese contrato (best-effort: el contrato
   se crea igual, pero sin condiciones).

## Guard de espejo (`test_164_espejo.sh`, corregido en Commit 7)

`test_164_schema.sql` (Commits 4-5) levanta un ESPEJO manual mínimo de las 3 funciones de
dinero en un contenedor Docker, porque no puede aplicar la migración 164 completa sin todo el
esquema previo 1→163. Para que ese espejo nunca diverja en silencio de la migración real,
`test_164_espejo.sh` compara el `prosrc` vivo contra el texto real de la migración.

**Bug corregido en Commit 7:** la versión original comparaba con `mig.includes(body)`. Como
`"".includes("")` es `true` en JavaScript, una extracción vacía o fallida (prosrc NULL/"" en
la BD, o el bloque no encontrado en la migración) reportaba "OK" sin comparar nada — falso
positivo. Ahora la decisión completa vive en un módulo puro
(`supabase/scripts/lib/espejo164.mjs`, función `verificarEspejo`) que valida explícitamente:
la función existe · existe con la firma exacta · `prosrc` no es NULL/vacío · hay EXACTAMENTE
una función con esa firma · el bloque se pudo extraer de la migración real · el cuerpo
extraído es igual (no solo "contenido") al `prosrc` vivo. Cada uno de esos 6 modos de falla
tiene un control negativo reproducible en `pruebas/espejo164.test.ts` (27 pruebas, sin Docker
ni base de datos — fixtures sintéticos + cruce contra el texto real de la migración 164).

## Concurrencia e idempotencia — vía real (sin Docker, Commit 7)

Además del espejo Docker (Commits 4-5, `test_164_concurrencia.sh`), el Commit 7 agrega
`test_164_concurrencia_real.sql`/`.sh`: mismas dos carreras (doble-click con la misma clave;
dos primeros pagos con TRM distintas) pero ejecutadas contra la migración 164 REAL, aplicada
sobre la cadena completa 1→163, con dos conexiones `psql` reales — reproducible en cualquier
PostgreSQL desechable, sin depender de Docker. Complementa, no reemplaza, al espejo Docker.

## Gotchas / decisiones no obvias

- La migración 164 sigue siendo el ÚNICO archivo para el feature original (Commits 1-6, PR
  #280) — regla explícita del proyecto: nunca editar una migración ya corrida en producción
  para "meterle" cambios nuevos. Por eso PR #282 (Rama B) fue con dos migraciones NUEVAS (165 y
  166, ambas *function-only*) en vez de reabrir la 164 — la 164 ya estaba aplicada en producción
  cuando arrancó ese trabajo. Las tres (164/165/166) están confirmadas aplicadas en Supabase
  real (04-sep-2026). Confirmar siempre el estado real de despliegue en `CLAUDE.md` §13 antes de
  tocar cualquiera de las tres.
- Los posteos automáticos de esta migración (igual que el resto del sistema, ver
  `docs/tecnico/contabilidad.md`) no convierten USD→COP salvo donde se documenta
  explícitamente (TRM congelada) — no asumir conversión automática en otros puntos.
- `test_164_schema.sql` es un esquema MÍNIMO standalone (no se aplica sobre la cadena real
  1→163) — aplicarlo por error sobre una base con las migraciones reales ya corridas choca
  contra seeds preexistentes (ej. `puc_cuentas`). No es un bug del script, es su diseño.

## Enlaces cruzados

- `docs/tecnico/contabilidad.md` — asientos automáticos, PUC, el par 280510/280505.
- `docs/tecnico/programas-y-cotizacion-manual.md` — el resto del flujo de cotización manual.
  La Server Action `convertirCotizacionManualAContrato` (`manual-actions.ts`) es un wrapper
  delgado que llama por `admin.rpc(...)` exactamente al RPC `convertir_cotizacion_a_contrato`
  descrito arriba — no son dos mecanismos distintos, es la misma pieza vista desde TS y desde SQL.
- `docs/tecnico/multitenant-auth-auditoria.md` — `puede_ver_contrato`, roles, RLS.
