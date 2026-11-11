# #75 — Ciclo de vida pendiente → confirmado y elegibilidad ampliada (DISEÑO, 2026-11-08)

Estado: **solo diseño; nada implementado.** Origen: ampliación del dueño tras validar PR #445. Regla principal: un contrato pendiente, nunca confirmado, puede tener toda su información preparada y eso NO debe impedir eliminarlo y reutilizar su DTM.
**Base aplicada:** 284, 285 y 287 están aplicadas (se asume el contenido del commit `6a29bbe`, que coincide byte a byte con el árbol de trabajo). **No se editan.** Toda corrección SQL va en migraciones nuevas desde la **288** (la 286 es de #97; no hay otra migración posterior en ninguna rama/worktree). `dtm_reuso_bloqueos`, `eliminar_contrato`, `confirmar_venta`, etc. se reemplazan con `create or replace` en la nueva.

## 1. Hechos verificados en el código (no suposiciones)

| Hecho | Dónde |
|---|---|
| Hay DOS estados: `ventas.estado` (pendiente/confirmado) y `ventas.financiero_estado` (pendiente/completo = estado TÉCNICO de la escritura de costos+CxP). | migr. 172, 197 |
| Hoy los flujos de creación escriben **costo + CxP en la misma transacción que crea el contrato pendiente** (`registrar_financiero_contrato`), y la app postea los asientos de esas CxP (`postearAsiento`). | `lib/reservar/financieroContrato.ts`; `reservar/actions.ts` 977, 3659, 4721 (+ programa 4753 con `insert` directo); `contratos/actions.ts` 964 y 1582 (insert directo); SQL `convertir_cotizacion_*` |
| `asegurarCuentasPorPagar` ya existe como **respaldo por cobertura** al confirmar (`confirmarVenta`, `recalcularEstadoAbono`) y en «Completar proveedores». | `lib/reservar/asegurarCuentasPorPagar.ts` |
| La comisión B2B nace al crear: `registrar_comision_b2b_reserva` (reserva, cotización asistida, programa), `registrar_comision_b2b_manual`, y en #97 `p97_priv.aplicar` dentro de la conversión. NETO: `ventas.comision_b2b` + `comision_estado='descontada'` + fila `aliados_b2b.descontada_en_precio=true`. | migr. 205/206/222/286 |
| Confirmación interna: RPC `confirmar_venta` (197, INVOKER con la RLS de quien llama). Confirmación por pago: la RPC `registrar_abono` (248) registra el abono y **después, en otra transacción, la app** (`recalcularEstadoAbono`) compara lo abonado con `config_cobros.pct_abono` (30 % por defecto) y llama `confirmar_venta`. | `contratos/actions.ts` 1159–1190 |
| El documento/pantalla muestran el mínimo desde `contrato_condiciones` (congelado, por componente); el servidor confirma con `config_cobros.pct_abono × total`. **Son dos reglas distintas** (afecta el punto 3). | `lib/contrato/condicionesContrato.ts` |
| `eliminar_contrato` ya borra facturación, rentabilidad, liquidación, `aliados_b2b`, CxP y abonos cuando es elegible, libera sillas y devuelve la cotización a `abierta` con `numero_contrato = null`. La elegibilidad (`dtm_reuso_bloqueos`) hoy bloquea por 40+ campos comerciales de `ventas` y por **cualquier** fila en cualquier tabla relacionada. | migr. 287 |

## 2. Parte 1 — Diseño de la transición pendiente → confirmado

**Principio:** mientras `estado = 'pendiente'` el contrato guarda *información* (cliente, pasajeros, hoteles, vuelos previstos, ítems, servicios, condiciones, costos previstos, cotización vinculada, acuerdo de comisión) pero **ninguna obligación**: ni `cuentas_por_pagar`, ni asientos, ni `aliados_b2b` exigible, ni documento cobrable. Las obligaciones se **materializan una sola vez** al pasar a `confirmado`.

### 2.1 Qué se guarda en pendiente (nuevo)
- `ventas.costo_*` siguen guardándose (son costo previsto, no obligación).
- Tabla nueva `contrato_obligaciones_previstas(numero_contrato, clave, tipo, payload jsonb, creado_en)` (clasificada `estricto` en `contrato_guardas_config`): una fila por CxP prevista y una por la comisión prevista (acuerdo). Sale de los **mismos constructores** de hoy (los que arman `CxPFinanciera`), así que el cálculo no cambia, solo cuándo se escribe. Reutiliza el patrón durable de `contrato_financiero_pendiente` (172).
- `financiero_estado` pasa a `completo` al guardar costos + previstas (la guarda de `confirmar_venta` sigue funcionando).

### 2.2 Materialización
- Una función SQL interna `p75_priv.materializar_obligaciones(p_numero)` (SECURITY DEFINER, sin EXECUTE para ningún rol de la API, igual que `contrato_declarar_identidad`) que, **con la venta bloqueada `FOR UPDATE`**:
  1. inserta las CxP desde las previstas (índice único parcial `(numero_contrato, clave_origen)` para las automáticas → imposible duplicar);
  2. crea la comisión B2B exigible desde el acuerdo (PVP). **NETO no crea una segunda comisión**: la fila `descontada_en_precio` se conserva como parte del cálculo/acuerdo y nunca pasa a ser pagable;
  3. marca `ventas.obligaciones_materializadas_en = now()` (nueva columna nullable; si ya está marcada, la función no hace nada);
  4. devuelve los ids de CxP creadas.
- La llamada vive **dentro de `confirmar_venta`** (se reemplaza con `create or replace` en la 288: misma autorización, mismo testigo de transacción, mismos roles — **no se amplía quién confirma**). Confirmar y materializar son **una transacción**.
- Los asientos de las CxP siguen siendo código de aplicación pero **idempotentes por `cxp:<id>`** y los repone el reconciliador existente (`reconciliacionFinanciera.ts`); si el asiento falla, la CxP existe y el reintento no duplica.
- Camino por pago: se mueve la decisión a SQL — nueva `confirmar_si_alcanza_minimo(p_numero)` llamada **por `registrar_abono`** en su misma transacción (hoy son dos transacciones: ventana de carrera y de abono sin confirmación). Mismo umbral que el del punto 3.

### 2.3 Reintentos y concurrencia
`FOR UPDATE` sobre la venta + marcador + índice único: dos confirmaciones simultáneas (pago + botón interno, o doble clic) producen **exactamente un** juego de obligaciones. `confirmar_venta` sobre un contrato ya confirmado responde ok sin tocar nada (ya lo hace desde la 197).

### 2.4 Contratos existentes
**No se borra ni se adapta nada automáticamente.** Un pendiente que ya tiene CxP/asientos (creado con el flujo viejo) conserva sus obligaciones y **sigue sin ser elegible**; al confirmarse, la función ve cobertura por clave/marcador y no duplica. Se entrega una consulta de diagnóstico de solo lectura (cuántos pendientes tienen obligaciones históricas).

### 2.5 Escritores afectados (cada uno pasa de «escribir obligaciones» a «escribir previstas»)
1. `reservarDesdeTarifarioInterno` (tarifario/bloqueo/porción) — `reservar/actions.ts` ~977, y su comisión `registrarComisionReserva` ~603.
2. `convertirCotizacionCarrito` — ~3659 / comisión ~3060.
3. Modo hotel / dinámico — ~4721.
4. `reservarPrograma` — ~4753 (`insert` directo a CxP) y comisión ~4435.
5. `crearContrato` manual — `contratos/actions.ts` ~964 (`registrarFinancieroContrato`) y ~1582 (`insert` directo a CxP), comisión PVP de #97.
6. SQL `convertir_cotizacion_a_contrato` (164) y `convertir_cotizacion_manual_controlada` (242 → copia de #97 en la 286): **se tocan en la 288 sobre la versión de la 286** y se coordina con #97 (ver §6).
7. `registrar_financiero_contrato` (171/172/210/227/236) — pasa a guardar previstas; sigue siendo la única escritura atómica.
8. `asegurarCuentasPorPagar` (confirmar / «Completar proveedores») — deja de ser creador independiente: queda como reparación sobre contratos **confirmados**.
9. `crearCuentaPorPagar` manual (`GestionTabs`) — ver decisión D1.
10. Documentos cobrables: cuenta de cobro (`/portal/comision`), estado de cuenta, plan de cobro/cuotas, recibo → se condicionan a `confirmado` (D3).
- Fuera de alcance: importador histórico minorista (no es DTM).

## 3. Parte 2 — Elegibilidad DTM (clasificación por efecto)

Se reescribe `dtm_reuso_bloqueos` (288/289). Regla: **bloquea solo lo que representa un compromiso real que no puede revertirse legítimamente**; la información preparada se borra junto con el contrato.

| Clase | Tablas / datos | Efecto en la elegibilidad |
|---|---|---|
| Preparación (se elimina con el contrato) | `contrato_pasajeros/hoteles/items/servicios/condiciones/programa_estancia*`, `contrato_vuelos` previstos, `contrato_alojamiento_bernalo`, `cuotas` no emitidas, `aliados_b2b` NETO descontada sin pagos, `cotizaciones` vinculada, campos comerciales de `ventas`, costos previstos, `contrato_obligaciones_previstas`, `restriccion_overrides`, `p63_aceptacion` | **No bloquea.** |
| Compromiso real | `abonos`/`abonos_anulados`/`abono_operaciones` (dinero recibido o anulado), `cxp_pagos`, `retenciones_cxp`, CxP con pagos o con asiento, `asientos` que lo nombren, `facturacion`/`factura_items`/`factura_revision_fuera_libros`, `conciliacion_sistema`, `comision_b2b_pagos`/`_revision`, `liquidacion_comisiones`/`liquidacion_descuentos`, `vouchers` emitidos, `contrato_vuelo_control`(+cambios) con emisión, sillas `confirmada` | **Bloquea** (falla cerrado). |
| Ambiguo → decisión del dueño | `contrato_adjuntos`, `contrato_soportes_pago`, objetos de Storage `<numero>/…`, `persona_capturas`, `avisos` | Ver D2. Recomendación: **soportes de pago bloquean** (son evidencia de dinero); adjuntos/archivos también bloquean (Storage no es transaccional con SQL y nada debe heredarse). |
| Asignaciones operativas | sillas `en_plazo` | Se liberan (ya lo hace `_vaciar_sillas`); no bloquean. Vuelo con PNR emitido bloquea. |

- **Atomicidad:** eliminar + liberar siguen en una transacción bajo `FOR UPDATE`; auditoría y protección UUID no cambian.
- **Cotización vinculada:** ya vuelve a `abierta` con `numero_contrato = null`; se añade prueba de coherencia (sin FK/`cotizacion_id` apuntando al contrato eliminado; acuerdo de #97 sigue colgando de la cotización).
- El siguiente contrato **no hereda** nada: ninguna fila de preparación sobrevive (cascada), y lo que sobreviva por ser evidencia bloquea el número.

## 4. Partes 3–5 (se detallan al llegar a cada una)
3. **Pago mínimo NETO:** una función única (SQL + espejo puro en `lib/`) `minimo_confirmacion(contrato)` = total NETO exigible en la moneda del contrato para NETO aliado; el resto, la condición congelada de `contrato_condiciones`. La usan pantalla, documento y `confirmar_si_alcanza_minimo`/`recalcularEstadoAbono` (se elimina el `config_cobros × total` como regla paralela para estos contratos).
4. **Costos hotel + asistencia sin receptivo:** primero reproducir en prueba (clasificación compartida costo→proveedor→tipo de CxP); se corrige la clasificación, no el rótulo.
5. **Edición de tarifas:** operación única server-side que actualiza ítems, total, NETO/descuento y documento según el acuerdo **congelado**; rechaza si hay pagos (salvo la regla existente), no recalcula acuerdos históricos y es todo-o-nada.

## 5. Orden de entrega (partes verificables)
P1 ciclo de vida (288 + código + pruebas) → P2 elegibilidad (289 + pruebas de clasificación y cotización) → P3 mínimo NETO → P4 costos → P5 edición de tarifas. Cada parte con preflight/postcheck, rollback y pruebas locales; ninguna se aplica en remoto.

## 6. Coordinación con #97
La 286 reemplaza `convertir_cotizacion_manual_controlada` y `p50_priv.calcular`. La 288 debe reemplazar de nuevo la primera para que la conversión guarde previstas en vez de CxP/comisión exigible → depende de la forma final de la 286. Pedir a #97: confirmar que la 286 no cambia más y que reserva 286 únicamente; #75 usa 288 en adelante.

## 7. Decisiones que necesita el dueño (cada una con recomendación)
- **D1** Crear una CxP *manual* en un contrato pendiente: **recomendado bloquear** (mensaje claro) hasta confirmar; ¿o se permite como previsto?
- **D2** Archivos, adjuntos y soportes de pago: **recomendado bloquear la reutilización** (no borrar Storage de forma automática); ¿o se eliminan junto con el contrato?
- **D3** Plan de cobro/cuotas: **recomendado** permitir prepararlo, pero no mostrarlo ni descargarlo como documento cobrable hasta confirmar.
- **D4** «Condición vigente» para confirmar por pago: **recomendado** la congelada en `contrato_condiciones` (la que ya ve el cliente) y NETO aliado = 100 % del total NETO; ¿se retira `config_cobros.pct_abono` para estos contratos?
- **D5** Pendientes antiguos con CxP/asientos: **recomendado** dejarlos como están (no elegibles) y solo diagnosticarlos.

## 8. ESTADO — Parte 1 implementada (migración 288), 2026-11-08
Decisiones del dueño aplicadas: D1 (sin CxP reales en pendiente), D2 (archivos/adjuntos/soportes bloquean; se aplica en la Parte 2), D3 (plan/cuotas se pueden preparar; sin cuenta de cobro de comisión ni obligación futura como exigible), D4 (regla única del mínimo: Parte 3), D5 (históricos no se tocan; diagnóstico entregado).

### 8.1 Qué se hizo (nada aplicado en remoto; el reuso sigue apagado)
- **`20260601000288_obligaciones_al_confirmar.sql`** (no edita 284/285/287). Verifica por md5 las definiciones que envuelve (`confirmar_venta` 197, `registrar_abono` 248, `registrar_financiero_contrato` 236) y aborta si el remoto no coincide. Conserva COPIAS verbatim como «base» y las envuelve:
  - `registrar_financiero_contrato`: en PENDIENTE traslada las CxP automáticas a `contrato_obligaciones_previstas`; costos previstos en `ventas` sí se conservan. Respuesta con `previstas`.
  - `confirmar_venta`: igual (misma autorización, INVOKER) + `p75_priv.materializar_obligaciones` en la MISMA transacción, con el testigo de la 197, `FOR UPDATE`, marcador `ventas.obligaciones_materializadas_en` y clave única `(numero_contrato, clave_prevista)`. Inserta solo las columnas presentes (los DEFAULT de la tabla aplican). Llama a `public.materializar_comision_b2b` de #97 si existe.
  - `registrar_abono`: base verbatim + decisión de confirmar por pago EN LA MISMA transacción (`p75_priv.confirmar_por_pago`, solo service_role, con el actor ya validado): abono aceptado y, si alcanza el mínimo, confirmar+materializar son todo-o-nada en una subtransacción; si fallan, el abono se conserva y la respuesta trae `confirmacion_error`; el reintento de la misma operación lo repara. Mínimo en UN solo punto: `p75_priv.minimo_confirmacion` (hoy idéntico a la app: total de cobro × `config_cobros.pct_abono`; la Parte 3 cambia solo esta función).
  - `public.prevista_cxp_aplicar` (solo service_role): escritor de la app (edición de servicios, programa) sobre las previstas de un pendiente; `{aplicado:false}` si no está pendiente.
- **Código:** `financieroContrato.ts` (cuenta `previstas`, sin asientos), `asientosObligaciones.ts` (asiento de lo materializado, idempotente `cxp:<id>`; el reconciliador `listarCxpSinAsiento` repone fallos), `confirmarVenta` / `recalcularEstadoAbono` / `registrarAbono` (asientos y error de confirmación), D1 en `asegurarCuentasPorPagar` y `crearCuentaPorPagar`, `reservarPrograma` y `actualizarServiciosContrato` escriben previstas por RPC. Tipos en `types/database.ts`.
- **Comisión (coordinado con #97):** único responsable de DIFERIRLA y de crear la fila exigible = #97 (286: `comision_plan` + `materializar_comision_b2b`); #75 solo la llama dentro de la confirmación. **Orden obligatorio: 288 ANTES de la 286** (con la 286 primero, las comisiones diferidas no se materializan hasta aplicar la 288; el preflight lo marca). NETO: su fila descontada (estado `pagada`, `descontada_en_precio`) es el registro del descuento; la confirmación no crea otra (probado).
- Scripts: `preflight_288_*`, `postcheck_288_*`, `rollback_288_*` (se niega con previstas sin materializar; restaura las funciones y verifica md5), `diagnostico_288_pendientes_con_obligaciones.sql` (D5), `test_288_obligaciones_al_confirmar.sh`.

### 8.2 Pruebas (Postgres real local salvo indicación)
`test_288`: **41/41** (con la 286 de #97 aplicada después) · `test_287` con la 288: 152/152 · `test_284`: 133/133 · `test_285`: 51/51 · `test_97_acuerdo_dinamica`: 92 OK · unitarias: 9063 pasan / **29 fallan = exactamente la línea base** (0 nuevas) · `tsc` limpio · `obligacionesAlConfirmar288.test.ts` 9/9. Cubren: pendiente sin CxP; reintento sin pérdida; confirmación interna materializa una vez; permiso de confirmar sin ampliar (venta ajeno rechazado); carrera manual/manual y manual/pago; **pendiente histórico (CxP ya creadas, sin previstas ni marcador) se reconoce sin duplicar y queda marcado**; abono + confirmación + materialización (éxito, fallo con el abono conservado, reintento que repara); PVP/NETO con #97; escritores de la app sobre previstas.
`test_97_comision_pvp` falla 7 casos con o sin la 288: su prueba quedó vieja respecto de la 286 revisada de #97 (espera la fila exigible al crear).

### 8.3 Lo que NO está resuelto todavía (Parte 1b — escritores que siguen creando obligaciones al nacer un contrato pendiente)
1. **`convertir_cotizacion_a_contrato(bigint,uuid)`** (164, conversión de cotización con pagos previos): inserta CxP, **sus asientos** y `aliados_b2b` directamente. Exige envolverla igual que las demás y decidir qué pasa con el pago previo aplicado; la comisión es de #97.
2. **CxP de aceptación #63** (oferta COP con TRM): la base no las traslada (su trigger de borrado lo impide); siguen naciendo con el contrato.
3. `p50_priv.completar_conversion` (fila de recobro, 198) y la conversión de cotización manual: dependen de la versión final de la 286 de #97.
4. Documentos: la ficha/estado de cuenta aún no muestran las obligaciones previstas ni las rotulan como tales (D3); la cuenta de cobro de comisión ya no puede emitirse para PVP pendiente porque no existe la fila.
5. `actualizarServiciosContrato` no es atómica de extremo a extremo (ítems/precio y previstas son pasos separados, como antes); rechaza con error claro si la RPC falla.
6. Pendiente de verificación fuera de la base local: `npm run build`, recorrido en navegador, Preview.

## 9. ESTADO — Parte 1b implementada (misma migración 288, aún sin aplicar), 2026-11-09
Reuso APAGADO. Sin staging/commit/push/SQL remoto. Las Partes 2 (elegibilidad), 3 (mínimo NETO/D4), 4 (costos) y 5 (edición de tarifas) NO están abiertas.

### 9.1 Escritores cerrados (pendiente = preparación; confirmado = obligaciones materializadas)
| Escritor | Cómo queda |
|---|---|
| **Conversión de cotización** `convertir_cotizacion_a_contrato` (la usa la conversión controlada de #97 y `convertir_cotizacion_din`) | Base verbatim (`p75_priv.convertir_cotizacion_base`, md5 verificado) + envoltorio que traslada sus CxP **y borra los asientos de CxP que la base les creó** a «previstas». Los **pagos previos** quedan como abonos (no se descartan ni se duplican; el pago previo pasa a «aplicado»). |
| **Mínimo con pagos previos** | Paso FINAL `confirmar_tras_conversion(numero, actor)` (service_role; el actor debe ser uno de los 4 roles que ya confirman a mano): si los abonos ≥ mínimo, confirma con el gancho único `confirmar_venta` y materializa UNA vez. **Va después** de la conversión controlada porque #97 completa recobro y plan de comisión DESPUÉS de `convertir_cotizacion_a_contrato`; confirmar antes dejaría la comisión sin materializar. Si falla, la conversión se conserva y la ficha muestra «Abonos suficientes; confirmación pendiente» con «Reintentar confirmación». |
| **`transferir_pagos_previos_a_abonos`** | Base verbatim + evaluación del mínimo (sin llamadores en la app hoy). |
| **Oferta #63** | `mover_cxp_a_prevista` traslada también sus CxP; el trigger `trg_cxp_borrada_63` (227, md5 verificado) respeta el bypass transaccional `app.p75_traslado` (solo lo fija esa función; PostgREST no puede fijar `app.*`); la materialización las reinserta con el modo `app.p63_h` y conservan marca, equivalente en COP y TRM (probado). |
| **Contrato manual (Mayorista)** | `crearContrato` nace **`pendiente`** (antes «activo»); Minorista conserva «activo» (fuera de #75). ⚠ DECISIÓN TOMADA SIN CONSULTAR: el contrato manual de Mayorista ahora necesita pago/confirmación para materializar sus CxP, como cualquier otro. |
| **Edición de servicios de un pendiente** | `pendiente_aplicar_servicios` (service_role): ítems + precio + resumen + obligaciones previstas (+ CxP históricas) en UNA transacción. Si algo falla, **nada** se guarda y la pantalla lo dice (probado: fila inválida ⇒ ítems, precio y previstas intactos). Los asientos de CxP históricas se ajustan después (best-effort, idempotentes, repone el reconciliador). |

### 9.2 Abono registrado con confirmación fallida (sin llamarlo atomicidad del proceso completo)
El abono es dinero recibido y **siempre se conserva**; solo «confirmar + materializar» es todo-o-nada. La pantalla (ficha y Cartera) dice **«Abono registrado; confirmación pendiente»**, **bloquea «Registrar abono»** (otro envío no llega al servidor) y ofrece **«Reintentar confirmación»** con la MISMA operación (la base responde «ya registrado» y vuelve a evaluar). Probado: respuesta perdida, reintento, dos reintentos simultáneos, recuperación desde otro proceso (`reintentar_confirmacion_pago`), y la UI (jsdom).

### 9.3 Previstas vs. exigibles en pantalla y documentos (D3)
La ficha del contrato pendiente (solo roles con finanzas) muestra «Obligaciones previstas — aún no exigibles» aparte; el documento pendiente aclara que las condiciones e instrucciones de pago rigen para confirmar y que no hay obligaciones exigibles; las condiciones de pago siguen visibles. La cuenta de cobro de comisión no existe en pendiente (no hay fila exigible).

### 9.4 Coordinación con #97 (286)
Un solo gancho: `confirmar_venta` → `p75_priv.materializar_obligaciones` → `public.materializar_comision_b2b` (de #97). La 286 vigente verifica que ese gancho exista antes de activar su ciclo. **Orden: 288 → 286 → (activar el ciclo de #97 con sus scripts).** ⚠ Mientras el ciclo de #97 esté APAGADO (su valor por defecto), una comisión PVP sigue creándose exigible al crear el contrato: la regla «pendiente sin comisión exigible» solo se cumple para comisiones cuando se activa su ciclo. NETO: la fila descontada nunca genera otra comisión por pagar (probado con ciclo encendido).

### 9.5 Pruebas del conjunto final
Postgres real local, con 281, 283, 284, 285, 287, **288 y luego 286 de #97 (versión de hoy)**: `test_284` 133/133 · `test_285` 51/51 · **`test_288` 41/41** · **`test_288b` 30/30** (conversión sin pagos; pago previo inferior/igual/superior/varios; reintento concurrente; abono con confirmación fallida, respuesta perdida y otro proceso; #63; edición atómica) · `test_287` con la 288 152/152 · `test_285_postgrest_storage` 51/51 · `test_97_acuerdo_dinamica` 103 OK. Scripts: `preflight_288` (md5 de 8 definiciones remotas + orden con #97 + diagnóstico D5), `postcheck_288`, `rollback_288` (restaura todo por md5, se niega con previstas sin materializar), `diagnostico_288_pendientes_con_obligaciones`.
Aplicación: `tsc` limpio · `npm run build` compila · unitarias 9078 pasan / 29 fallan = **las mismas 29 de la línea base** (0 nuevas) · React 1638 pasan / 26 fallan = **las mismas 26 del commit anterior** (0 nuevas; se añadieron `abonoConfirmacionPendiente288`, `obligacionesPrevistasPanel288`, `avisoContratoCambio75`).

### 9.6 Límites y decisiones pendientes (honestos)
1. **Regla del mínimo duplicada hasta la Parte 3:** la conversión exige pagos previos ≥ el monto exigido congelado de la cotización, y la confirmación usa `config_cobros.pct_abono × total`. Son dos reglas; D4 (condición congelada, NETO aliado = 100 %) las unifica en `p75_priv.minimo_confirmacion`.
2. **USD:** la conversión aplica los pagos previos escribiendo `monto_cop` en `valor_abono` (comportamiento histórico); la evaluación del mínimo se probó en COP.
3. Asientos de CxP materializadas: los postea la app tras confirmar; si falla, el reconciliador (`listarCxpSinAsiento`) los repone.
4. Los pendientes históricos con CxP/comisión ya creadas NO se tocan (D5) y quedan fuera del reuso.
5. Sin recorrido en navegador real ni Preview. **No aplicar 288 ni 286 hasta la validación del dueño y hasta decidir el punto 9.1 (contrato manual pendiente) y la activación del ciclo de #97.**

## 10. Parte 3 — una sola regla del mínimo para confirmar (288)

- **Regla única** `p75_priv.regla_confirmacion` (espejo TS `lib/contrato/reglaConfirmacion.ts`), siempre identificada: `neto_total` (NETO aliado exige el TOTAL NETO exigible), `condicion_congelada` (suma de `contrato_condiciones.monto_exigido`, en su moneda y TRM congeladas) y `legacy_pct` (30 % solo para históricos SIN condiciones y sin NETO). Pantalla, documento, plan de cobro, conversión y confirmación por abono la leen; `recalcularEstadoAbono` ya no tiene 30 % propio.
- **Dos mínimos distintos por diseño**: el de CONVERTIR/emitir una cotización (pagos previos ≥ `monto_exigido_total_cop` congelado) y el de CONFIRMAR (esta regla). En NETO el de convertir es la condición y el de confirmar el total; los rótulos son distintos (`ROTULO_MINIMO_CONVERTIR` / `ROTULO_MINIMO_CONFIRMAR`).
- **USD**: la base legada de la conversión escribía en `abonos.valor_abono` los pesos aunque el contrato fuera USD. Los wrappers de `convertir_cotizacion_a_contrato` y `transferir_pagos_previos_a_abonos` normalizan `valor_abono = monto_moneda` (USD); `monto_cop`, TRM y asiento no cambian. Probado en `test_288c` sección 9 (conversión real).
- **Versión de #97 usada**: `20260601000286_cotizacion_comision_acuerdo.sql`, md5 `48f214e43581…`, 678 líneas. Orden: 288 → 286 → activar el ciclo de #97. Con el ciclo apagado una comisión PVP aún puede nacer exigible en un pendiente: no se presenta el ciclo como activo hasta activarlo.
- Pruebas (288+286 sobre base nueva): test_288 41/41, 288b 30/30, 288c 27/27; unitarias afectadas 102/102; tsc limpio; rollback verificado.

### 10.1 Regla monetaria de `valor_abono` (cierre de la Parte 3)
`abonos.valor_abono` va SIEMPRE en la **moneda de cobro** del contrato (la misma que usa `registrar_abono`: COP → `monto_cop`; USD → `monto_cop / TRM`), no en la moneda original del pago previo. `monto_cop`, la TRM y el asiento (que lee `monto_cop`) no cambian. La base legada de la conversión escribía pesos en `valor_abono`; `p75_priv.normalizar_abonos_previos(numero)` lo corrige al convertir/transferir (idempotente, no reescribe históricos). Matriz probada en `test_288c` §10: COP/COP, USD/USD, contrato USD cobrado en COP (pago USD → pesos), contrato COP cobrado en USD (pago COP → USD) y contrato USD con pago en COP.

### 10.2 Activación conjunta con #97
Ciclo APAGADO (por defecto): se conserva el comportamiento anterior de #97 (la comisión PVP nace exigible al crearse), pero ESE estado NO valida la regla final de pendientes: un contrato Mayorista nace `pendiente` (decisión ya aprobada) y puede tener una comisión PVP exigible. Solo con el ciclo ENCENDIDO (`activar_286_ciclo_comision.sql`, tras `preflight_286_ciclo.sql`) la comisión es plan hasta confirmar y la materializa el gancho único `confirmar_venta` (#75). Orden: 288 → 286 → preflight/activar ciclo → código. Se prueban ambos estados (ver resultados en la entrega).

## 11. Parte 2 — elegibilidad ampliada (migración 289, SIN aplicar)
Archivos: `20260601000289_elegibilidad_dtm_ampliada.sql` (SHA-256 `a5ed374c8f0b6875d7c60d6d87fd68bde25b3343782c288c13dcd802d6720861`), `preflight_289`, `postcheck_289`, `rollback_289` (verifica por md5 que restaura exactamente la 287), `test_289_elegibilidad_dtm_ampliada.sh` (73 comprobaciones). Reemplaza SOLO `dtm_reuso_bloqueos` y `eliminar_contrato` (la 287 y su pool, ticket e interruptor no cambian). Reuso APAGADO; Minorista intacto.
- **Preparación (no bloquea, se borra con el contrato):** pasajeros, hoteles, ítems, servicios, vuelos previstos, condiciones, previstas (288), cuotas, rentabilidad, avisos, cotización vinculada (se desvincula: queda `abierta` sin número), campos comerciales de `ventas` (salvo facturado/numero_documento/grupo_conversion), sillas **en_plazo** (se liberan), vuelo no emitido, clasificación de facturación sin DIAN/asiento/revisión, CxP sin pagos/retenciones/#63, comisión **NETO descontada** sin pagos ni revisión, plan de comisión de #97 (si su trigger honra `app.p75_eliminando`).
- **Compromiso real (bloquea):** abonos, abonos anulados, operaciones de abono, factura, conciliación, liquidaciones, vouchers, **adjuntos, soportes de pago y objetos de Storage (D2)**, asientos, silla distinta de en_plazo, vuelo emitido, comisión exigible o con pagos, CxP con pagos/retenciones, movimientos de sillas, referencia manual en silla, estado ≠ pendiente en la historia, financiero incompleto.
- **Historia inmutable que bloquea (decisión abierta):** `p63_aceptacion`, `persona_capturas`. Toda tabla futura sin clasificar con filas del contrato también bloquea (falla cerrado).
- **Atomicidad:** eliminar + liberar sillas + desvincular cotización + borrar + registrar en el pool, una transacción bajo `FOR UPDATE`; si falla la liberación (p. ej. clave duplicada en el pool) NO cambia nada (probado: contrato, pasajero y silla intactos). Auditoría y protección de identidad (UUID) no cambian.
- **Sin herencia:** el contrato siguiente con el mismo número tiene otro `contrato_uid`, ninguna fila hija, ninguna silla, campos comerciales vacíos y la cotización antigua sigue desvinculada.
- Coordinación con #97 (secuencia única, desactivación del ciclo, parche de una línea para el plan, corrección de textos): ver `coordinacion-75-97-secuencia-despliegue.md`.
- Hashes de las versiones probadas: 288 `33e53d69a2c5e0f14cdb3a7a344cd69e2cc2b409e9520ca8d7366978073e25a1`; 289 `a5ed374c8f0b6875d7c60d6d87fd68bde25b3343782c288c13dcd802d6720861`; 286 de #97 `34e5ae83b5a718527a37c6c619a443bec58fcf4e6ca45f7fac0390c9a067aeb2`.
