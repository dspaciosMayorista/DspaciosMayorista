# Condiciones de pago por componente (migración 164)

> Qué es / Dónde vive / Modelo de datos / Funciones clave / Flujo / Reglas de negocio y
> fórmulas / Gotchas / Enlaces cruzados — ver convención en `README.md`.

## Qué es

Antes de esta migración, una cotización manual (`cotizacion_manual`) solo admitía **una**
condición de pago global (anticipo % + saldo a N días) para TODO el paquete. En la práctica el
proveedor de hotel puede exigir 100% de anticipo mientras el vuelo se paga después, o un
receptivo no exige nada por adelantado — **una condición por componente**, no una global.

La migración `20260601000164_condiciones_pago_componente.sql` (única, acumulativa — Commits
1-6 de la rama `condiciones-pago-componentes`, nunca dividida en una 165 por regla del
proyecto) agrega: condición de pago por componente en el catálogo (hotel/paquete/programa),
snapshot congelado por cotización al primer pago, registro atómico de pagos previos a una
cotización (antes de que exista contrato), conversión de UNA cotización manual a UN contrato
(con reclasificación contable), y candados de inmutabilidad autoritativos en base de datos.

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

## Restricciones no-reembolsable / no-endosable

`restriccion_comercial` viaja del catálogo → snapshot (`cotizacion_condiciones`) → contrato
(`contrato_condiciones`), congelada igual que el resto — cambiar la restricción en el catálogo
después no altera contratos ya congelados.

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

## Alcance actual: manual-only

Todo este mecanismo (condición por componente, congelado, pagos previos, conversión 1:1) hoy
**solo aplica al flujo de cotización manual** (`app/(dashboard)/dashboard/cotizaciones/`).
Pendiente, NO construido en esta migración: tarifario público, carrito de compra, y el flujo
"reservar" de un solo paquete (bloqueo/porción/servicios) no pasan por condiciones de pago por
componente — siguen con su flujo de siempre.

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

- La migración 164 sigue siendo el ÚNICO archivo para todo el feature (Commits 1-6) — regla
  explícita del proyecto: nunca dividir en una 165 mientras 164 no se haya corrido en
  producción. Confirmar el estado real de despliegue en `CLAUDE.md` §13 antes de tocarla.
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
