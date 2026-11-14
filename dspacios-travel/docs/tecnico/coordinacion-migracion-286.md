# Coordinación de migraciones con #75 — uso de la 286 (#97)

Redactado 2026-11-08 para que el dueño lo reenvíe al responsable de #75 antes de integrar. No se envió a ninguna sesión: no hay forma de confirmar cuál es la de #75.

## Números en juego
| Número | Dueño | Estado |
| --- | --- | --- |
| 281 `soportes_pago`, 283 `perfil_portal_atomico` | `main` (#443, #444) | aplicadas |
| 282 `reuso_consecutivos_dtm`, 284 `identidad_contrato`, 285 `identidad_funciones_storage` | #75 (`claude/75-reuso-dtm`) | en su rama, sin aplicar |
| **286 `cotizacion_comision_acuerdo`** | **#97** (`claude/portal-b2b-bloque-97-98-84-32`) | en esta rama, sin aplicar |

Petición a #75: **no usar la 286**; si necesita más números, desde la **287**. Si #75 ya reservó la 286 en otro lado, avisar antes de integrar: la 286 se renumera sin tocar su contenido (el nombre del archivo es lo único que cambia).

## Superficie compartida (verificada por lectura, no por ejecución conjunta)
- La 286 **reemplaza** `public.convertir_cotizacion_manual_controlada` (copia íntegra de la 242 + dos `perform p97_priv.*`) y `p50_priv.calcular` (copia de la 222 con 4 líneas cambiadas).
  Ni la 282, ni la 284 ni la 285 de #75 redefinen esas funciones (solo mencionan `convertir_cotizacion_a_contrato` en un comentario de la 282).
- La 282 reemplaza `eliminar_contrato` y borra `aliados_b2b` del contrato: compatible con la fila única que deja la 286.
- La 286 **ensancha** `aliados_b2b.pct_recobro_aliado` a `numeric(25,20)`. La 284 (registro de tablas con `numero_contrato`) no depende del tipo de esa columna.
- La tabla nueva `cotizacion_comision_acuerdo` se indexa por `cotizacion_id`, no por `numero_contrato`: no necesita entrada en el registro de identidad de la 284.
- Código: #75 modifica `contratos/actions.ts` y `reservar/actions.ts`; esta rama también toca `contratos/actions.ts` (comisión PVP y cierre del negociado). Habrá que resolver conflictos de fusión a mano.

## Orden sugerido en producción
282 → 284 → 285 → 286 (la 286 no depende de las otras tres). Cada una con su preflight y postcheck; una a la vez.
Para la 286: `preflight_286` → migración → `postcheck_286` → recién después el código. El código nuevo exige `crear_cotizacion_manual_con_acuerdo`.

## Actualización 2026-11-08 (verificación ejecutada)
Fusión de tres vías de `contratos/actions.ts` y `reservar/actions.ts` en el scratchpad (cambios sin confirmar de `75-reuso-dtm` contra esta rama): 0 conflictos de texto, pero **choque semántico**: #75 cambia `revertirContratoManual` a `(idc, numero, tenant)` y esta rama tiene 2 llamadas con la firma vieja (cierre del negociado y su rollback) → no compilarían al fusionar. Detalle y pasos en `comision-asistida-97.md` §7.5. Compatibilidad por lectura ≠ prueba integrada de comisión e identidad (no ejecutada).

## Actualización 2026-11-08 (5)
- #75 ya usa la **287** para el reuso (284 y 285 de identidad siguen): la 286 queda libre para #97. La tabla de arriba (282/284/285) está desactualizada en ese punto.
- Choque semántico real: ver `integracion-97-con-75.diff` (3 llamadas) y §8.4 de `comision-asistida-97.md`. Probado con arnés integrado 19/19.
- La 286 revisada se activa en fases (esquema compatible → código → exigir): `activar_286_exigir_acuerdo.sql`; no depende de la 287.

## Actualización 2026-11-08 (8) — ciclo de vida
- Orden recomendado: **288 de #75 antes que la 286** (#75 llama a `materializar_comision_b2b` dentro de `confirmar_venta`). Si la 286 se aplica sola, la comisión conserva su momento histórico (modo sin gancho, probado): no hay comisiones que nunca se materialicen.
- Esquema integrado probado localmente: 284 + 285 + 287 + 288 reales de #75 + 286 de #97. El conjunto fusionado debe repetir `tsc` y el arnés (21 casos) tras aplicar el parche `integracion-97-con-75.diff`.
- La 286 clasifica `comision_plan` en el registro de guardas de #75 **si la 284 ya existe** (si la 284 se aplicara después, #75 debe clasificar esa tabla: tiene `numero_contrato`).

## Actualización 2026-11-08 (9) — identidad y ciclo explícito
- La 286 **requiere la 284** (`ventas.contrato_uid`) y deja el ciclo **APAGADO**. El orden de despliegue ya no depende de detectar funciones: 284 (aplicada) → 288 de #75 → 286 → desplegar código → `preflight_286_ciclo.sql` → `activar_286_ciclo_comision.sql`. Sin la 288 el ciclo no se enciende.
- Un solo gancho: #75 llama a `materializar_comision_b2b` dentro de `confirmar_venta`; #97 no modifica la confirmación.
- Conflicto de fusión a resolver por #75 (ver `integracion-97-con-75.diff`): solo las tres llamadas con `idc`. El estado de nacimiento de #75 es incondicional y **se conserva** (`tenant === "minorista" ? "activo" : "pendiente"`); no hay `estadoNacimiento` ni conflicto: el ciclo se enciende **antes** de desplegar el código.
- Hallazgo para #75: reintento/carrera de conversión sobre un contrato ya confirmado por el pago falla en `mover_cxp_a_prevista`.

## Cierre 2026-11-09 — estado de nacimiento y reintento de conversión
- Estado de nacimiento: Mayorista manual = pendiente; Minorista conserva. Es la regla de #75 (mismo texto en #97, sin conflicto); el interruptor de comisión no decide confirmaciones. Sin ciclo encendido, #97 rechaza (antes de numerar) el manual B2B de Mayorista; nunca lo marca activo.
- Reintento de conversión: #75 debe corregir su envoltura (`parche-75-reintento-conversion.diff`); #97 ya lo cumple en su función. Q97-5/6/7 estrictas sobre el árbol combinado real.
- Un solo gancho de confirmación (#75), una sola materialización (#97), identidad por `contrato_uid`. Sin 286/288 en remoto; reuso apagado.

## Hallazgos para #97 (2026-11-10, arnés app→PostgREST sobre el árbol integrado 75+97, base nueva) — SIN corregir, pendiente de decisión de #97
Reproducidos con `pruebas/contratoManualNeto206.pg.ts` (PORT-1, PORT-3). La causa es la combinación de la **205** (`registrar_comision_b2b_manual`, ya aplicada en producción) con el registro automático de #97 al crear el contrato. En la base común `e39224313` no aparecen porque allí el PVP B2B nacía «Por definir».
1. **Pendiente con comisión exigible por el alta manual interna (PORT-1).** Contrato manual de Mayorista PVP con aliado → nace pendiente con su PLAN. Un rol interno (`administracion`) llama a `registrar_comision_b2b_manual` y la 205 inserta una fila **exigible** en `aliados_b2b` (respuesta `{"data":19,"error":null}`): rompe la invariante «pendiente = solo plan». La guarda «ya tiene comisión registrada» de la 205 solo existe en la rama del aliado (agencia/freelance), no en la interna, y no mira `comision_plan`.
2. **Doble comisión del mismo aliado (PORT-3).** Contrato manual de Minorista PVP (nace `activo`): la RPC de reserva crea la fila de 200.000 y el alta manual interna del MISMO aliado crea otra → el portal muestra **$ 400.000**. `materializar` ya evita duplicar una fila del mismo aliado, pero la 205 no.
Propuesta a decidir por #97: migración nueva (no editar la 205) que, en la rama interna, rechace el alta si el contrato está `pendiente` (o tiene plan) y si ya existe una fila del mismo `aliado_id`; o que el alta interna de un pendiente se convierta en plan. El arnés deja ambos casos ROJOS a propósito (PORT-1 con la aserción de la invariante; PORT-3 con su aserción original).

### Resolución de los hallazgos PORT-1/PORT-3 — migración 290 (2026-11-10, escrita y probada en local; SIN aplicar)
- `20260601000290_comision_manual_pendiente_y_duplicado.sql`: reemplaza `registrar_comision_b2b_manual` (cuerpo íntegro de la 205 + regla de pendiente, `COMISION_PENDIENTE`) y agrega el trigger `trg_aliados_b2b_sin_duplicado_aliado` (BEFORE INSERT, toda ruta, candado de `ventas`): rechaza `COMISION_DUPLICADA` cuando el MISMO `aliado_id` ya tiene en el contrato una fila con el MISMO concepto (ordinaria —valor/%, o NETO descontada— o recobro). Aliados distintos: permitidos (#440). Ordinaria y recobro en filas separadas: permitidos (forma de la 198/267). Fila sin concepto: no duplica nada (MAN14 de la 205).
- Preflight/postcheck integrales (`preflight_290_comision_manual.sql`, `postcheck_290_comision_manual.sql`); el preflight diagnostica duplicados históricos por concepto (REVISAR) y no toca filas ni pagos. Huella de la 205 normalizada sin CR (`dc89361b…`; con CRLF `871d2946…`).
- Rollback `rollback_290_comision_manual.sql` (cuerpo copiado literal de la 205, verificado por md5). Pruebas: `test_290_comision_manual.sql` (42 casos, ambas posiciones del interruptor), `test_290_carrera.sh` (18: carreras automático↔manual, manual↔manual, reserva↔inserción directa; preflight con histórico; rollback y reaplicación), y test_205 (135 OK) / test_206 (53 OK) sin regresión con la 290.
- **Ampliación (2026-11-10): duplicación por UPDATE.** El trigger también dispara en `UPDATE OF numero_contrato, aliado_id, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, descontada_en_precio` y rechaza solo el cambio que INTRODUCE para (contrato, aliado) un concepto que otra fila suya ya tiene (dar ordinaria a una fila sin concepto o de solo recobro; acreditar un recobro repetido; mover la fila de contrato/aliado). Editar sin añadir concepto —también un histórico duplicado— pasa; el candado de `ventas` solo se toma cuando hay algo que comprobar. Reproducido antes del cambio con las acciones reales (`crearComisionB2B` + `actualizarComisionB2B`, PORT-4 del arnés de #75: `{"ok":true}` con la versión solo-INSERT). Pruebas: `test_290_comision_manual.sql` sección 9 (56 casos; contra la versión solo-INSERT fallan 9c/9d/9f/9k) y `test_290_carrera.sh` E1/E2 (edición↔alta, ambos sentidos; 23 casos).
