# Reutilización de consecutivos DTM de contratos pendientes (#75)

> **NUMERACIÓN FINAL (entrega 3, 2026-11-08):** la migración del reuso que en las secciones 1–14 se llama «282» es ahora **`20260601000287_reuso_consecutivos_dtm.sql`** (scripts `*_287_*`). La 282 queda vacía, la 283 es de #25 (aplicada), la 284/285 son de identidad (#75) y la **286 es de #97** (`cotizacion_comision_acuerdo`). Orden: 284 → 285 → (286 independiente) → 287. Ver §17.

Estado: **IMPLEMENTADO en la rama `claude/75-reuso-dtm` (sobre origin/main c9b25ffe1): migración 282 + código + pruebas. SIN staging, commit, push ni SQL remoto; la migración NO está aplicada en producción. EL REUSO NACE DESHABILITADO (`dtm_reuso_config.habilitado = false`) porque queda un riesgo abierto: escrituras desde pantallas antiguas sobre el contrato nuevo (§13).** Lo implementado está en §12; §1–§11 son el historial de la investigación (K, UUID y separación de vidas NO se implementaron).
**Alcance confirmado por el dueño (2026-11-07): Mayorista (DTM-), empezando por contratos sin pagos ni huella financiera incompatible. Minorista (MIN-) queda fuera y su mecanismo no se modifica.** El alcance vigente está acotado en §10 (solo DTM pendientes que nunca se confirmaron); la propuesta K de §8 está en pausa.
Cierre de la investigación: no se implementan marcadores por `max(auditoria.id)`, por `last_value` de secuencia ni por fechas para atribuir historial.
Fecha: 2026-11-07. Relacionado: #75 (consecutivos DTM, diferida), #21 (borrado con pagos previos), #86 (la atiende otro ejecutor; no se toca aquí).

## 1. Comportamiento vigente (verificado en el código)

- `eliminar_contrato(p_numero, p_reusar)`: versión de la migración 196. Solo superadmin. Rechaza `p_reusar` si el número empieza por `DTM-`. Libera sillas, desvincula la cotización (queda `abierta`), borra facturación, rentabilidad, liquidación, comisiones B2B, CxP y abonos, borra la venta (las hijas caen por cascada) y, si `p_reusar`, inserta el número en `numeros_contrato_liberados`.
- `siguiente_numero_contrato_para_tenant(p_tenant)` (159): **mayorista** usa `contrato_seq_mayorista` y nunca lee el pool (decisión explícita de la 159); **minorista** delega en `siguiente_numero_contrato()` (060), que hace `delete … where numero = (select min …) returning` y, si no hay liberados, avanza `contrato_seq`.
- Único generador desde la aplicación: `lib/contrato/numeracion.ts`, llamado en 4 puntos (`contratos/actions.ts`, `reservar/actions.ts` ×3).
- UI: `EliminarContrato.tsx` → `admin-actions.ts` (superadmin). `lib/contrato/reciclaje.ts` oculta la casilla para `DTM-`.
- **Hoy solo Minorista recicla.** Mayorista no, por diseño (159) y por #75 ("sin convertir el registro en el contrato de otro cliente").
- `ventas` no tiene identidad propia: su PK es `numero_contrato`. `fn_renumerar_contrato` (115) existe y es accesible a superadmin/gerencia, pero no tiene llamadores en `app/`, `lib/` ni `components/` (ni en el historial git de esas rutas); solo migración 115, `fn_arreglar_numeros_minorista` (manual, "ejecutar UNA vez") y pruebas.

## 2. Defectos reproducidos (base local, esquema hasta la 268)

1. **Liberar números con pagos.** Un contrato minorista con un abono de $300.000 se eliminó con `p_reusar=true`: el abono se borró y el número entró al pool sin ninguna guarda. Solo frena el trigger F4415 cuando el abono ya tiene asiento contable. Queda únicamente rastro en `auditoria`. → **hallazgo para #21**, no se amplía su implementación aquí.
2. **Herencia de archivos.** Los objetos de `storage.objects` bajo `contratos/<numero>/…` sobreviven (solo cae la fila de `contrato_adjuntos`). `acceso_archivo_contratos` (150) valida por prefijo → un gerente de minorista accedió desde el contrato nuevo al archivo del contrato borrado.
3. **Mezcla de historial.** `auditoria` conserva todas las filas por `registro_id = numero`; el contrato nuevo comparte historial con el anterior. También sobreviven sin FK: `abonos_anulados`, `movimientos_silla`, `conciliacion_sistema`, `liquidacion_descuentos`, `p63_aceptacion`, `abono_operaciones`, `factura_revision_fuera_libros`, `contrato_vuelo_control_cambios`, `persona_capturas.contrato_numero`.
4. **Sí funciona el caso básico:** crear `MIN-00-0482` → eliminar con reuso → crear otro devolvió `MIN-00-0482`; sin duplicados, prefijo correcto. DTM: `reusar=true` rechazado; con `false` queda hueco (`DTM-0001` → siguiente `DTM-0002`).

## 3. Consumo de números: limitaciones que se documentan y NO se arreglan en esta entrega

- La llamada que consume el número del pool es su propia transacción RPC: si la creación del contrato falla después, el número **no** vuelve (deducido del código; en una sola transacción local sí se restauró).
- Concurrencia: 8 sesiones simultáneas con 8 liberados dieron 8 números distintos (sin duplicados; la PK de `ventas` es el respaldo), pero 3 sesiones perdieron la carrera y avanzaron la secuencia mientras 3 liberados quedaron sin usar.
- Mayorista deja huecos al eliminar (por diseño).

## 4. Pruebas locales y sus límites

Hechas: contenedor Docker con Postgres 15.8.1.085, 262 migraciones hasta la 268, base desechable; reproducciones de la sección 2; 8 sesiones concurrentes; dos escenarios de ids de `auditoria` (reservar un id y confirmar después de otro; marcador tomado con una fila abierta).

Límites que impiden afirmar cobertura completa:
- Esquema hasta la **268**; `origin/main` tiene hasta la **280** (leídas 269–280: ninguna toca estos objetos). Antes de implementar hay que rehacer la plantilla hasta el esquema vigente.
- Todo en una base local; **nada** contra producción. Se desconoce cuántos números hay hoy en el pool real, si alguno tiene archivos o historia, y si `fn_renumerar_contrato` se usó alguna vez en producción.
- Escenarios de concurrencia acotados (no una batería exhaustiva); la pérdida de número por fallo de creación no se probó entre transacciones separadas.
- Prueba de ids de `auditoria`: mostró que `max(id)` visible falla (fila de la vida anterior confirmada después del marcador queda del lado "nuevo") y que `last_value` aguantó esos dos órdenes, pero **no se prueba separación exacta general** (depende de supuestos: nada del contrato viejo escribe después de ofrecer el número, secuencia sin `setval`/restauración, caché por defecto). **Se descarta como mecanismo**; no se implementa.
- Los lectores de `auditoria` en la aplicación: solo `app/(dashboard)/dashboard/auditoria/page.tsx` (filtra por `registro_id` parcial). Scripts de `supabase/scripts/` y el editor de Supabase también la leen y no se pueden controlar.
- No se verificó el reloj de `storage.objects.created_at` frente al de la base: por eso las fechas tampoco son prueba de pertenencia.

## 5. Dos líneas de trabajo separadas

### Línea 1 — Guardas (restringen; **no** resuelven la reutilización)
Impedir `p_reusar=true` cuando el contrato tenga pagos o referencias incompatibles (abonos, abonos anulados, asientos, pagos/retenciones a proveedor, comisiones pagadas, factura, pago previo de cotización, conciliación, descuentos de liquidación, filas en las tablas sin FK de la sección 2, archivos bajo `contratos/<numero>/`), y verificar los números ya liberados antes de ofrecerlos. No borra evidencia. **Aun así el historial de `auditoria` se mezcla** en los casos que permite, por lo que por sí sola no cumple "sin mezcla". El defecto de borrar contratos con pagos pertenece a #21. **Estado: no implementada; se decide aparte.**

### Línea 2 — Reutilización completa
Requiere una **identidad explícita del contrato y de su historial** (no inferida por fechas, ids o secuencias): qué contrato es el dueño de cada archivo, fila de historial y referencia superviviente, resuelta por esa identidad y no por coincidencia de número; y un tratamiento de los lectores de `auditoria` (página, scripts). #86 define lo suyo por separado y no es dependencia. **Estado: sin diseño aprobado ni implementación.**

## 6. Decisiones del dueño

1. **Tenant: Mayorista (DTM-). Resuelto, no volver a preguntar.** Minorista y sus MIN- quedan fuera; no se modifica su mecanismo (`numeros_contrato_liberados`, `siguiente_numero_contrato()`). Levantar el candado de la 159 para DTM es consecuencia de esta decisión.
2. Alcance inicial: contratos sin pagos ni huella financiera incompatible; con pagos quedan fuera (borrarlos es hallazgo de #21).
3. Las líneas 1 y 2 de §5 se fusionan en el único diseño mínimo de §8: las guardas son la verificación de elegibilidad y la identidad es lo que separa el historial.
4. Sigue prohibido atribuir historial con fechas o marcadores de secuencia, y borrar evidencia para hacer reutilizable un número.

## 7. Pruebas (prototipos desechables en bases locales; ninguna es la migración)

**Ronda 1 — esquema hasta la 268, identidad por UUID (`contrato_uid`) en `ventas` y `auditoria`.** Resultados que siguen vigentes: la atribución al producirse funciona para eventos de contrato vivo (cascada de borrado, transacción abierta durante la eliminación, escritor sin FK que ejecuta antes de eliminar); pero un escritor obsoleto sobre una tabla sin FK, **después** de reutilizar, queda atribuido al contrato nuevo porque el disparador solo ve "el contrato vigente de ese número". Con identidad por UUID, cerrar ese límite obliga a que cada escritor presente el UUID (ver §8.2). Esa ronda no se repite.

**Ronda 2 — esquema REAL hasta la 281** (migraciones 0–280 del repositorio más la 281 de #86 aplicada; `fn_renumerar_contrato` confirmada como la versión de la 281). Nota de entorno: la imagen local no trae `storage.buckets.file_size_limit`/`allowed_mime_types` y `preparar_esquema_local.sh` se detiene en la 281; se agregaron esas dos columnas en la preparación del entorno (no cambia el esquema de la aplicación).

| Prueba (diseño K: clave interna única por vida + número visible reutilizable) | Resultado |
|---|---|
| **K1** Elegibilidad con tablas reales: contrato con abono; con pago a proveedor (CxP con valor + `cxp_pagos`); contrato sin pagos (con CxP sin pagos) | Los dos primeros rechazados con el motivo y **sin cambiar nada** (el contrato sigue existiendo); el tercero se libera y entra al pool con siguiente generación 2. (En una primera corrida el pago a proveedor falló por `pago_excede_saldo`; se repitió con la CxP correctamente valorada.) |
| **K2** A reserva y tarda más que la vigencia (2 s); B reserva el mismo número; A intenta crear; B crea; A reintenta | Misma clave y tokens distintos. A: `RESERVA_AJENA`. B crea (queda un contrato con ese número visible). A reintenta: `RESERVA_INEXISTENTE`. Dos vivos con el mismo visible y reinserción de la clave muerta: rechazados por la tabla de claves (PK). |
| **K3** Escritores obsoletos de A (clave muerta `DTM-8001`) mientras B vive (`DTM-8001~2`): abono, pasajero, soporte de #86 (función real `f281_soportes_insert`), escritura en tabla sin FK auditada | Abono y pasajero: violación de FK. Soporte: `SOPORTE_CONTRATO_INEXISTENTE`. Tabla sin FK: la fila y su evento de auditoría quedan bajo la clave de A (`DTM-8001`), **0 filas de B afectadas**. |
| **K4** Archivos reales (`storage.objects`) con `acceso_archivo_contratos` | Un gerente de mayorista: archivo del contrato A → `false`; archivo de B → `true`; ningún archivo de A aparece bajo el prefijo de B. |
| **K5** Renumeración real (versión de la 281) de un contrato de reuso (`DTM-8001~2` → `DTM-8999`) | Funciona; las hijas siguieron; la tabla de claves conserva todas las claves (incluida la muerta). |
| **K6** 8 reservas simultáneas, pool de 4 elegibles | 4 números distintos, 4 sin número; sin duplicados. |
| **U1** `UNIQUE (contrato_uid) DEFERRABLE INITIALLY DEFERRED` en `ventas` | La renumeración real pasa (copia transitoria con el mismo UID, 1 fila al confirmar). Un duplicado real se acepta dentro de la transacción y **se rechaza al confirmar**. La misma restricción **no diferible rompe la renumeración** (la copia choca). Límite: una restricción diferible **no puede ser objetivo de una FK** (`cannot use a deferrable unique constraint for referenced table`). |

Límites de la ronda 2: motor y carga bajos; K6 mide reservas, no la carga completa; las tablas sin FK auditadas se modelaron con una tabla de prueba (las reales de la 281 sí se usaron en K3); no se probó la verificación de elegibilidad sobre `asientos_contables` (formato de `referencia` sin confirmar); el prototipo K no incluye UI ni creadores.

## 8. Diseño K para Mayorista (propuesta; SIN implementar; su alcance acotado y costo están en §10-§11)

### 8.1 Alcance real
- **Solo contratos futuros.** Este diseño permite reutilizar el consecutivo de contratos DTM que se **creen y eliminen después de la migración**. **No recupera consecutivos ya eliminados**: los DTM eliminados antes no están en ningún pool, y su uso futuro no se presume.
- Incluir números anteriores es una fase aparte que exige **evidencia suficiente** de que ese contrato no tuvo pagos ni huella financiera (p. ej. eventos de auditoría de borrado de abonos, pagos o facturas con esa clave), no atribución inventada. Requeriría una consulta remota de solo lectura que no se ha ejecutado; su resultado decidiría qué números, si alguno, califican. Sin esa evidencia quedan fuera.
- Minorista (MIN-) intacto. Contratos con pagos fuera de alcance (la eliminación de contratos con pagos es hallazgo de #21).

### 8.2 Escritores obsoletos: por qué se detiene la variante con UUID
Con una identidad por UUID aparte del número (variante U), una escritura del contrato A llega como "contrato DTM-0042" y el sistema solo puede resolverlo contra el contrato vigente de ese número. Para que A no actúe sobre B, **cada escritor tendría que presentar el UUID**. Escritores relevantes (esquema 281 + código del repositorio):
- **25 archivos de Server Actions** que reciben un contrato por número y escriben (contratos, reservar, cartera, pagos, comisiones, liquidación, retenciones, conciliaciones, libro diario, facturación, vouchers, adjuntos, cobros, condiciones, gestión, vuelos, empaquetados, cotizaciones manuales, importador…).
- **52 funciones SQL** con parámetro de contrato (37 SECURITY DEFINER; 18 ejecutables por `authenticated`), además de las funciones de #86 (`soporte_registrar` y relacionadas).
- Escrituras desde el navegador (adjuntos en Storage, rutas `contratos/<número>/…`), portal B2B y API B2B.
Cada una necesitaría recibir, propagar y verificar el UUID (formularios, URLs, parámetros de RPC y pruebas). **Ese costo excede una entrega razonable. Se detiene la variante U** y no se declara segura una reutilización con ese límite abierto. El disparador de auditoría tampoco puede resolverlo: buscando el contrato vigente por número atribuye al contrato nuevo la escritura del anterior (comprobado en la ronda 1).

### 8.3 Alternativa K — la clave interna es única por vida; solo el número visible se reutiliza
Idea: el consecutivo **visible** se reutiliza, pero `ventas.numero_contrato` (la clave que ya presentan todos los escritores, FK, rutas de archivos, auditoría, #86…) deja de repetirse. La primera vida conserva la clave actual (`DTM-0042`); las siguientes llevan generación: `DTM-0042~2`, `DTM-0042~3`. Es el mismo principio que ya usa Minorista (clave almacenada distinta del número visible, `numeroVisible()`).
- **Por qué cierra el límite sin tocar los escritores:** una escritura obsoleta de A presenta la clave de A. Si el destino es una tabla con FK, falla (K3); si es una tabla sin FK, queda bajo la clave de A, nunca de B. Auditoría, archivos (`contratos/<clave>/`) y evidencia de #86 quedan separados **por construcción**, sin atribuir nada ni usar fechas o secuencias. Probado con las tablas y funciones reales (K3, K4).
- **Piezas (migración nueva, número provisional 282; `origin/main` llega a la 281, confirmar con `ls`):**
  1. `dtm_claves(clave pk, visible, generacion, creada_en, eliminada_en)`: registro permanente; un trigger `BEFORE INSERT` en `ventas` (mayorista) inserta cada clave, y la PK impide reinsertar cualquier clave, viva o muerta (K2). Se rellena con las claves vivas actuales (y, si se quiere, con las de contratos ya eliminados que muestre la auditoría de `INSERT` en `ventas`, solo para bloquear su reinserción).
  2. Reemplazar `ventas_numero_contrato_formato_por_tenant` (migración 160) para aceptar `^DTM-[0-9]{4,}(~[0-9]+)?$` en mayorista; Minorista igual.
  3. Índice único sobre el número visible (`regexp_replace(numero_contrato,'~[0-9]+$','')`, solo mayorista): nunca dos contratos vivos con el mismo número visible.
  4. `numeros_dtm_liberados(visible pk, generacion_siguiente, clave_origen, estado, asignado_token, asignado_en)`.
  5. `eliminar_contrato` (versión 196) se reemplaza conservando idéntica la rama de Minorista y `p_reusar=false`; para `DTM-` con `p_reusar=true` evalúa la elegibilidad **financiera** (abonos, abonos anulados, operaciones de abono, pagos y retenciones a proveedor, pagos de comisión, facturación, pagos previos de cotización, conciliación, descuentos de liquidación; K1) y, solo si pasa, elimina y registra el número en el pool con la generación siguiente. Ya no hacen falta las reglas de "cero archivos / cero auditoría / cero soportes": esas referencias quedan bajo la clave muerta.
  6. `reservar_numero_contrato(p_tenant) → (clave, token)` (solo `service_role`); `siguiente_numero_contrato_para_tenant` no cambia.
- **Propiedad de la reserva (token):** el `INSERT` en `ventas` trae `reserva_token`, columna transitoria que el trigger valida contra el pool y deja en NULL. Si el número está en el pool exige estado `asignado`, token igual y generación igual; token sin reserva → rechaza; clave con generación >1 sin reserva → rechaza (K2). **Vigencia de la reserva: 30 minutos, valor técnico provisional, no una decisión comercial.** Una reserva vencida no se invalida sola: solo habilita a otro a tomarla y reemplazar el token; el dueño original sigue pudiendo crear mientras nadie la tome. A vencido contra B nuevo propietario: A es rechazado (K2).
- **Fallo de creación después de asignar:** la reserva sigue siendo del mismo creador hasta que otro la tome tras la vigencia; sin duplicados y sin números perdidos; el reintento funciona con el mismo token. Si el contrato llega a insertarse y falla un paso posterior, `revertir_contrato_incompleto` (172) borra la venta y el número no vuelve al pool (hueco; mismo límite de §3, no se trata aquí).
- **Concurrencia:** `for update skip locked` sobre el pool (K6) + PK de claves + índice único del número visible.
- **Permisos:** tablas nuevas con RLS y lectura solo superadmin; sin escritura directa; funciones SECURITY DEFINER con `search_path` fijo; `reservar_numero_contrato` solo `service_role`; `eliminar_contrato` conserva su candado de superadmin.
- **Renumeración existente:** `fn_renumerar_contrato` (versión de la 281) sigue funcionando sin reemplazarla (K5); una vida reutilizada que se renumera pasa a una clave simple nueva.
- **#86 (ya aplicado):** no se edita la 281. La evidencia archivada de A queda bajo la clave muerta y **no se traslada ni se atribuye al contrato nuevo**; un soporte dirigido a la clave de A falla con el error propio de #86 (K3).

### 8.4 Costos y límites de K (a aprobar antes de implementar)
- **Cambia el significado de `numero_contrato` para vidas reutilizadas** (incluye `~n`). Todo lo que muestre el número a una persona debe usar el número visible: documentos (contrato, plan de cobro, recibo, estado de cuenta, voucher, cotización), títulos de archivos, portal B2B, CRM, correos/WhatsApp, API B2B. Hoy `numeroVisible()` (solo quita `MIN-`) se usa en 25 puntos de 9 archivos; hay 53 `.tsx` que mencionan `numero_contrato`. Un punto omitido muestra `DTM-0042~2` (cosmético, no inseguro). Auditoría de puntos de presentación: pendiente.
- Búsqueda por número visible: debe encontrar solo el contrato vivo. Una URL vieja con la clave muerta (`/contratos/DTM-0042`) debe dar 404 y **no** resolverse al contrato nuevo.
- Archivos: `contratos/DTM-0042~2/…` (el carácter `~` es válido en rutas de Storage y URLs; K4 lo usó).
- Los documentos ya emitidos al cliente A siguen diciendo "DTM-0042": inherente a reutilizar el consecutivo.
- Tocan: la migración; `lib/contrato/numeracion.ts`, `numeracionPuro.ts` (clave y token) y los 4 inserts de `ventas` (`contratos/actions.ts`, `reservar/actions.ts` ×3) para enviar `reserva_token`; `lib/tenant.ts` (`numeroVisible`) y los puntos de presentación; `lib/contrato/reciclaje.ts`, `EliminarContrato.tsx`, `admin-actions.ts`; `types/database.ts`; `auditoria/page.tsx` (el filtro por número ya muestra ambas claves); pruebas que fijan "DTM nunca recicla" (`reciclajeContrato.test.ts`, `numeracionContrato.test.ts`, scripts `test_consecutivo_dtm_mayorista.sh` y `test_concurrencia_dtm_mayorista.sh`).
- Sin cambios: Minorista, la 281 y su worktree.

### 8.5 Unicidad de identidad (evaluación pedida)
Si se llegara a usar un UUID por contrato (variante U, detenida), `UNIQUE DEFERRABLE INITIALLY DEFERRED` sobre `ventas.contrato_uid` basta: permite la copia transitoria de la renumeración y rechaza duplicados al confirmar (U1), sin disparador propio. Límite: no puede ser objetivo de FK. En la alternativa K no se necesita (la unicidad la dan la PK de `ventas` y la de `dtm_claves`).

## 9. Material de apoyo (local, sin versionar)

- Consulta integral de solo lectura para el dueño: `supabase/scripts/diagnostico_reuso_consecutivos_lectura.sql` (no ejecutada en remoto). Mide aptos/no aptos por vínculo, estado del pool, archivos huérfanos y huella sobreviviente.

## 10. Alcance acotado (instrucción posterior del dueño): solo DTM pendientes que nunca se confirmaron

**Alcance:** Mayorista/DTM; contratos **pendientes que nunca se confirmaron ni tuvieron pagos o movimientos**. No se amplía a contratos confirmados sin pagos. El diseño K de §8 queda **en pausa** (no se retoma K ni UUID hasta decidir sobre esta viabilidad). Pruebas sobre el esquema real hasta la 281.

### 10.1 Cómo acredita el sistema «nunca confirmado»
- **El estado actual `pendiente` no lo demuestra.** Pruebas: (a) `confirmar_venta` (197) y `recalcularEstadoAbono` (abono ≥ mínimo) llevan `pendiente → confirmado`; (b) ningún trigger ni constraint impide volver a `pendiente` con una escritura directa (en la prueba, un superadmin devolvió a mano un contrato confirmado a `pendiente`; ver caso 9003); (c) `liberar_vencidas` lleva `pendiente → cancelado`; el contrato manual nace `activo` y el importador `confirmado`; no hay columna de fecha/actor de confirmación en `ventas`.
- **Única evidencia disponible: la auditoría de `ventas`** (`trg_auditoria`, migración 087), que registra INSERT con el estado inicial y cada UPDATE con antes/después, incluidas las escrituras de `service_role`. No hay purga de `auditoria` (ninguna función ni cron la borra). Todo contrato DTM nació después de la 087 (la 159 abortaba si ya existía un contrato mayorista), así que **su creación debe figurar en la auditoría**; si no hay evento INSERT, la historia es incompleta → EVIDENCIA INSUFICIENTE (caso 9012, con el trigger apagado a propósito).
- Reglas: «nunca confirmado» = hay evento INSERT, los estados vistos en toda la historia son solo `pendiente`/`cancelado` (ni `confirmado` ni `activo`) y ninguna silla pasó por `confirmada`. Los contratos `cancelado` (por plazo vencido) y los ya eliminados con evidencia insuficiente quedan **excluidos por ahora**.
- Límite: la auditoría puede omitir cambios hechos con triggers desactivados (`session_replication_role = replica`); eso no es detectable desde los datos.

### 10.2 Qué bloquea y qué rastro deja tras eliminar
| Bloqueo (código en `motivo`) | Fuente | ¿Demostrable si el contrato ya se eliminó? |
|---|---|---|
| `ESTADO_CONFIRMADO_EN_HISTORIA`, `ESTADO_ACTUAL_*` | auditoría de `ventas` / estado vivo | Sí |
| `SILLA_CONFIRMADA`, `MOVIMIENTO_SILLA`, `ACEPTACION_EMPAQUETADO` | auditoría de `sillas`, `movimientos_silla`, `p63_aceptacion` | Sí |
| `ABONOS` | auditoría de `abonos` + tabla viva | Sí |
| `ABONO_ANULADO_U_OPERACION`, `PAGO_PREVIO_COTIZACION`, `CONCILIACION`, `DESCUENTO_LIQUIDACION` | tablas sin FK que sobreviven | Sí |
| `FACTURA_O_CONFIG_FACTURACION` | auditoría de `facturacion` + `factura_revision_fuera_libros`; `contrato_facturacion` (cascada, sin auditoría) | Factura sí; solo la fila de configuración no |
| `PAGO_PROVEEDOR`, `RETENCION` | `cxp_pagos`, `retenciones_cxp`: **FK en cascada y sin auditoría** | **No** |
| `PAGO_COMISION` | `comision_b2b_pagos` (FK sin cascada: el pago impide borrar el contrato) | Sí (si se eliminó, no había) |
| `VOUCHER_EMITIDO`, `PLAN_DE_COBRO` | auditoría de `vouchers` y `cuotas` | Sí |
| `VUELO_EMITIDO` | `contrato_vuelo_control.estado_emision = 'emitido'` (cascada, sin auditoría) | **No** |
| `ARCHIVOS_O_SOPORTES` | adjuntos (auditados), objetos de Storage, soportes y avisos de #86 | Sí |
| `CAPTURA_PERSONAS` | `persona_capturas.contrato_numero` (sin FK) | Sí (ver 10.3) |
- **Documentos emitidos que no dejan registro:** el contrato/cotización pendiente impreso o compartido por enlace (`share_token`) no se registra en ningún lado, así que **no es demostrable ni su emisión ni su ausencia**; el documento de un pendiente se rotula «cotización pendiente». Se trata como **no bloqueante**; es una decisión del dueño que conviene confirmar, porque el cliente anterior conservaría un documento con ese DTM.
- `asientos_contables.referencia` usa ids (`retencion:<id>`, `conciliacion:<id>`), no el número de contrato: no sirve para probar ausencia por número.

### 10.3 Datos capturados (pasajeros) y sus dependencias
No se tratan como movimientos: `contrato_pasajeros`, items, hoteles, vuelos, servicios y condiciones se capturan al reservar y **se borran en cascada con el contrato**; los datos de pasajero copiados a `sillas` se limpian al liberar (migración 196). Dependencia que **sobrevive**: `persona_capturas` (registro central de personas, #32), con `contrato_numero` y **sin FK**; **verificado en el código vigente** (función `p214_priv.captura_visible`, versión de la migración 219): una captura con fuente `contrato_pasajero` es visible si **existe una venta con ese `numero_contrato`** (mismo tenant; para `venta`, además el asesor), sin comparar el pasajero ni ningún identificador del contrato; por lo tanto **un número reutilizado las volvería a mostrar con `contrato_numero` apuntando al contrato nuevo** (comprobado también por el caso 9013). **Pero** no se encontró ningún escritor de capturas con esa fuente: `upsert_persona`/`promover_persona` solo son invocadas por `registrar_personas_cotizacion` y `actualizar_titular_cotizacion` (fuente `cotizacion`, que no guarda número de contrato), y nada en `app/` ni `lib/` crea capturas `contrato_pasajero`. Es decir: el mecanismo de re-asociación existe y está verificado, pero lo esperable en datos reales es **cero** filas; eso solo lo confirma el conteo remoto (`capturas de personas` en la consulta). Mientras tanto `CAPTURA_PERSONAS` se conserva como **guarda de datos** (bloquea si hay filas), no como condición definitiva; el conteo de pasajeros capturados es solo informativo.

### 10.4 Clasificación: reglas y resultado de las pruebas
- **APTO** = **únicamente «candidato que cumple las guardas»; NO significa seguro para reutilizar** (la separación del historial sigue pendiente, §11). Contrato vivo en estado `pendiente`, evento INSERT en la auditoría, estados vistos solo `pendiente`, sin ningún bloqueo de 10.2 en las tablas vivas ni en la auditoría.
- **FUERA DE ALCANCE:** contrato vivo `cancelado` (no se evalúa por ahora).
- **NO APTO:** hay evidencia positiva de cualquiera de los bloqueos (se listan todos).
- **EVIDENCIA INSUFICIENTE:** sin evidencia en contra pero sin poder demostrar: contrato ya **eliminado** (no se pueden descartar pagos a proveedor, retenciones ni emisión de vuelo), **hueco** sin contrato ni rastro, o contrato **sin evento de creación**.
- Consulta de solo lectura para el dueño (no ejecutada en remoto): `supabase/scripts/diagnostico_75_pendientes_nunca_confirmados_lectura.sql` (una sola consulta; una fila por número DTM).
- Prueba local con 20 números sintéticos (esquema real 281): pendiente limpio y con pasajeros → APTO (candidato); cancelado por plazo → FUERA DE ALCANCE; confirmado y devuelto a `pendiente` → NO APTO; con abono, abono anulado, pago a proveedor, archivo en Storage, plan de cobro, vuelo emitido, estado `activo`, eliminado tras confirmarse, captura de personas → NO APTO (cada uno con su código); pendiente eliminado, contrato sin evento de creación y huecos de la secuencia → EVIDENCIA INSUFICIENTE.
- **Consecuencia:** con los datos de hoy ningún número **ya eliminado** puede ser APTO (pagos a proveedor, retenciones y emisión de vuelo no dejan rastro). **Solo un contrato vivo puede acreditarse APTO, y se evalúa antes de eliminarlo.** Recuperar huecos existentes exigiría evidencia externa que el sistema no tiene; no se inventa.

### 10.5 Viabilidad y cambio mínimo
Es viable para contratos futuros: la elegibilidad se evalúa **sobre las tablas vivas y la auditoría en el momento de eliminar** (mismas reglas que la consulta). Piezas mínimas (no implementadas): una función de elegibilidad con esas reglas; `eliminar_contrato` para `DTM-` con reuso que la exija antes de tocar nada; un pool propio de DTM (Minorista intacto); generador que tome del pool con `for update skip locked` y una reserva con token (R1–R3, K2 ya probados). En este alcance el único rastro técnico que sobrevive en un número APTO es la **auditoría de creación/edición del pendiente descartado** (se conserva; no equivale a venta confirmada), porque archivos, soportes, vouchers, pagos y capturas ya lo habrían vuelto NO APTO. **Queda abierto** cómo distinguir esa auditoría de la del contrato nuevo (§5-§8); no se resuelve aquí.

## 11. Propuesta final para conservar y distinguir la auditoría técnica de cada contrato

**Estado:** nada habilitado. `eliminar_contrato` no cambia; no hay pool ni reciclaje de DTM; Minorista intacto. «APTO» (§10) es solo candidato que cumple las guardas; **la garantía de separación de historial no existe todavía** y esta sección dice qué costaría darla.

### 11.1 Por qué hace falta una identidad distinta por vida
La auditoría, los archivos y **todos** los escritores se refieren al contrato por el texto de `ventas.numero_contrato`. Mientras dos contratos compartan esa cadena, ni un disparador ni un escritor atrasado pueden distinguirlos: p. ej. un asesor con la ficha del contrato A abierta registra un abono después de que el número se reutilizó y el abono cae en el contrato B (FK satisfecha por el mismo texto). Atribuir por fechas, por posición en una secuencia o por coincidencia de número queda descartado. La alternativa de que cada escritor presente un UUID obliga a modificar ≈ 25 archivos de Server Actions y 52 funciones SQL (más #86, el navegador y los portales): descartada por tamaño.

### 11.2 Propuesta única: la clave del contrato es única por vida (diseño K de §8)
- `ventas.numero_contrato` sigue siendo la identidad que ya presentan todos los escritores, pero **nunca se repite**: la primera vida conserva `DTM-0042`; las siguientes llevan generación (`DTM-0042~2`, `~3`…). Solo el **número visible** (sin `~n`) se reutiliza.
- **Auditoría:** cada fila queda bajo la clave exacta de su contrato (`registro_id`); no se reescribe, no se atribuye después, no se infiere. La del pendiente descartado queda bajo `DTM-0042`; la del contrato nuevo, bajo `DTM-0042~2`. La pantalla de auditoría, buscando por el número visible, muestra ambas con su clave.
- **Escrituras atrasadas (probado con el esquema real hasta la 281):** un escritor que aún presenta la clave del contrato anterior (a) en una tabla con FK (abonos, pasajeros…) falla por FK; (b) en #86 (soportes) falla con `SOPORTE_CONTRATO_INEXISTENTE`; (c) en una tabla sin FK deja la fila y su evento bajo la clave anterior, sin tocar al contrato nuevo; (d) en Storage no obtiene acceso (la ruta lleva la clave). Lo sostienen: un **registro permanente de claves** (ninguna clave, viva o muerta, vuelve a insertarse), el índice único del número visible entre contratos vivos y la **reserva con token** (A vencido contra B nuevo propietario: A es rechazado).
- Residuos que no se pueden eliminar sin dejar de reutilizar el consecutivo: documentos o mensajes ya entregados al cliente anterior con ese DTM; y procesos que resuelven un número visible tecleado por una persona, que resolverán —por definición— al contrato vivo.

### 11.3 Alcance del cambio (cuantificado) — es un cambio amplio, no mínimo
- **Base de datos:** 1 migración (≈ 2 tablas nuevas: registro de claves y pool; 1 trigger `BEFORE INSERT` en `ventas`; reemplazo del CHECK de formato de la 160; 1 índice único; funciones de elegibilidad y de reserva) + rollback + preflight/postcheck + pruebas SQL con concurrencia. El reemplazo de `eliminar_contrato` se haría después y **no se toca ahora**.
- **Servidor:** `lib/contrato/numeracion.ts`, `numeracionPuro.ts` y los **4** inserts de `ventas` (`contratos/actions.ts`, `reservar/actions.ts` ×3) para enviar el token.
- **Presentación al cliente (necesaria para que el consecutivo se vea igual):** 10 páginas con `tituloDocumento` (contrato, plan de cobro, estado de cuenta, recibo, voucher, cotización, enlaces públicos, portal de comisión), `ContratoDocumento.tsx`, `DocHeader.tsx` y el helper `numeroVisible` (`lib/tenant.ts`): ≈ 13 archivos.
- **Presentación interna:** 55 archivos `.tsx` / 134 ocurrencias muestran hoy el número (mostrarían `~2` hasta adaptarlos; cosmético, progresivo). Búsquedas y listas por número visible: ≈ 5 puntos (`ContratosList`, CRM, `PasajerosContratoClient`, `clientesContratos68`…).
- **Pruebas:** reescribir ≈ 6 (las que fijan «DTM nunca recicla» y la numeración) y agregar ≈ 5.
- **Total: ≈ 30 archivos esenciales y hasta ≈ 85 con la presentación interna.** Cambia el significado de `numero_contrato` para las vidas reutilizadas.

### 11.4 Decisión
(a) Aprobar K con ese alcance; (b) no reutilizar DTM y mantener todo como está; (c) volver a la idea original de #75 (borrador sin número hasta emitir, estado «No concretado»). Hasta que el dueño elija, no se implementa nada.

## 12. IMPLEMENTADO (migración 282) — alcance reducido aprobado por el dueño

> Esta sección es lo que **realmente quedó implementado** en la rama de trabajo (sin staging, commit ni SQL remoto; la migración **NO está aplicada en producción**). Las secciones 7–11 son el historial de la investigación: el diseño K (sufijos `~n`), los UUID y la separación de vidas **no se implementaron** porque el dueño aceptó conservar el historial técnico del número tal cual.

### 12.1 Alcance
- **Sí:** consecutivos DTM de Mayorista de contratos que **todavía existen**, están **pendientes**, **nunca se confirmaron** y están **vacíos salvo por el cliente titular**.
- **No:** Minorista (su mecanismo —`numeros_contrato_liberados`, `siguiente_numero_contrato()`, rama MIN de `eliminar_contrato`— queda idéntico); números ya eliminados y huecos de la secuencia; contratos con cualquier relación (aunque no tengan pagos); cancelados, activos y confirmados; la migración 281 y `fn_renumerar_contrato`.
- **Historial:** la auditoría del número no se borra ni se altera; el contrato nuevo comparte el texto del número con el anterior (el dueño aceptó conservar ese historial técnico interno). Solo superadmin y gerencia leen `auditoria` (policy 087/189): ni B2B ni B2C acceden a ese historial (probado). **Esto NO incluye escrituras del contrato anterior sobre el nuevo: el dueño no las autorizó** (§13).

### 12.2 Qué hace la migración `20260601000282_reuso_consecutivos_dtm.sql`
| Pieza | Comportamiento |
|---|---|
| `dtm_reuso_bloqueos(numero, vivo)` | ÚNICA definición de elegibilidad; **falla cerrado** (toda lectura fallida o evidencia insuficiente es un motivo de bloqueo). Con `vivo=true` exige: existe, mayorista, estado pendiente, financiero completo, evento de creación en auditoría, **ningún estado distinto de pendiente en toda la historia**, campos comerciales de `ventas` vacíos (solo cliente/titular/asesor/firma/cabecera) y **cero filas** en toda tabla de `public` con columna `numero_contrato`/`contrato_numero` o FK hacia `ventas` (detección dinámica: una tabla futura bloquea sin tocar la función), cero objetos de Storage con prefijo `<numero>/` y cero asientos que lo nombren. Con `vivo=false` exige además que ya no exista en `ventas`. |
| `eliminar_contrato(numero, true)` sobre `DTM-` | Bajo `FOR UPDATE` de la venta evalúa la elegibilidad **antes de tocar nada**; si hay motivos rechaza con `REUSO_NO_ELEGIBLE: …` y no cambia nada. Si pasa, elimina como siempre e inserta el número en `numeros_dtm_liberados` **en la misma transacción** (eliminación + liberación atómicas). Con `p_reusar=false` o sobre `MIN-` es la 196 sin cambios. |
| `reservar_numero_contrato(tenant)` (solo `service_role`) | Mayorista: toma el menor DTM liberado con `FOR UPDATE SKIP LOCKED`, lo **vuelve a verificar** (si ya no es elegible pasa a `bloqueado` con su motivo; nunca se borra) y lo entrega con un **ticket**; sin liberados elegibles usa la secuencia. Minorista: como antes (ticket nulo). |
| Trigger `trg_ventas_reserva_dtm` | Un DTM del pool solo se crea presentando **su** ticket (`ventas.reserva_token`, columna transitoria que se descarta); re-verifica la elegibilidad y consume la fila del pool en la misma transacción que crea el contrato. |
| `contrato_reuso_preview(numero)` | Solo superadmin: devuelve los motivos para la pantalla. |
| `numeros_dtm_liberados` | Pool (RLS: lectura solo superadmin; sin escritura directa). |
| Vigencia de la reserva | 30 minutos (valor técnico provisional): vencida, otra solicitud puede tomar el número y reemplaza el ticket; el anterior deja de servir. Si nadie la toma, su dueño aún puede crear. |
| Orden del pool | **Numérico** por consecutivo (`DTM-9999` antes que `DTM-10000`), no por texto (probado: el orden por texto entregaría `DTM-10000` primero). |
| Interruptor `dtm_reuso_config` | Una fila, **`habilitado = false` por defecto**: mientras esté apagado, `eliminar_contrato(DTM-…, true)` se rechaza con `REUSO_DESHABILITADO` (la vista previa lo muestra). Solo gobierna la liberación. Se enciende únicamente con una decisión explícita posterior a la protección de §13. |

### 12.3 Código de la aplicación
`lib/contrato/numeracion.ts` y `numeracionPuro.ts` (llaman `reservar_numero_contrato` y devuelven `reservaToken`); los **4** `INSERT` de `ventas` (`contratos/actions.ts`, `reservar/actions.ts` ×3) envían `reserva_token`; `lib/contrato/reciclaje.ts` (traducción de los motivos); `contratos/[numero]/admin-actions.ts` y `EliminarContrato.tsx` (vista previa de elegibilidad, casilla de reuso solo si es elegible, motivos en español); `types/database.ts`. **No cambia** `convertir_cotizacion_a_contrato` (164): sigue pidiendo su número a la secuencia, así que ese camino no consume el pool.

### 12.4 Orden de despliegue y reversión
`preflight_282` → migración 282 → `postcheck_282` → desplegar el código. La migración es **compatible con el código viejo** (que no consume el pool y no envía ticket; su casilla de reuso para DTM sigue oculta). Reversión: `rollback_282_reuso_consecutivos_dtm.sql` (se niega si el pool tiene números o si `eliminar_contrato` ya no es la de la 282; restaura la 196 exacta). Archivos: `supabase/migrations/20260601000282_reuso_consecutivos_dtm.sql`, `supabase/scripts/{preflight,postcheck,rollback}_282_*.sql`, `supabase/scripts/test_282_reuso_consecutivos_dtm.sh`. **Numeración:** verificada única entre los 79 worktrees: la **283** la tiene el perfil del portal B2B (#25, rama `codex/portal-b2b-vuelos`); esta es la **282**; el siguiente libre es la **284**. Ninguna depende de la otra.

### 12.5 Pruebas (Postgres real hasta la 281 + 282; 119 comprobaciones, 0 fallos)
Script `test_282_reuso_consecutivos_dtm.sh <contenedor>` (repetible en la misma base):
- **Contrato vacío con solo titular:** vista previa sin motivos → eliminar con reuso → el número queda `disponible` en la misma transacción → reservar entrega el liberado con ticket → crear con el ticket lo consume; el ticket no persiste; `share_token` del contrato nuevo es distinto; la auditoría se conserva (sin cambios de conteo ni del evento de creación).
- **Cada motivo de bloqueo** (rechaza sin cambiar nada: el contrato y su relación siguen, el pool no cambia): pasajeros, pago, pago anulado, comisión, vuelo, silla, servicio, hotel, ítem, cuenta por pagar, factura, plan de cobro, voucher, adjunto, soporte de pago y aviso de #86, cotización vinculada, captura de personas, archivo en Storage, asiento contable, estado confirmado / cancelado / activo, historia con confirmación, campos comerciales (precio, hotel, aliado B2B), financiero incompleto, **sin evento de creación** (evidencia insuficiente) y **lectura fallida** (una tabla ilegible bloquea todo). Sin reuso, el borrado de siempre no cambia.
- **Concurrencia:** dos eliminaciones simultáneas del mismo contrato (una gana, la otra espera y se rechaza); dos reservas simultáneas con un solo liberado (no reciben el mismo número); 8 reservas con un pool de 3 (8 números distintos, cada liberado una sola vez); dos creaciones con el mismo ticket (una sola); un pago que llega mientras se libera (la liberación espera a la venta y lo ve).
- **Fallo de creación después de asignar:** la creación falla (cliente nulo), no hay contrato, la reserva sigue asignada con el mismo ticket, nadie más recibe ese número mientras vige y el reintento con el **mismo ticket** funciona.
- **Reserva vencida:** A obtiene, vence, B obtiene el mismo número con otro ticket; A es rechazado (`RESERVA_AJENA`), B crea, A reintenta (`RESERVA_INEXISTENTE`); una reserva vencida que nadie tomó todavía deja crear a su dueño; sin ticket o con ticket inventado sobre un número del pool se rechaza.
- **Re-verificación al reutilizar:** un archivo que llega después de liberar hace que `reservar` marque el número `bloqueado` (con motivo) y entregue otro; un archivo que llega después de reservar hace que la creación se rechace y no se cree el contrato.
- **Sin herencia ni acceso:** el contrato nuevo no tiene archivos, soportes, avisos ni adjuntos; un usuario B2B (`agencia`) no lee la auditoría, no ve el contrato, no ve el pool, no puede consultar la elegibilidad, reservar ni ejecutar la elegibilidad; gerencia no puede eliminar con reuso.
- **Minorista intacto y compatibilidad:** `MIN-` se libera en `numeros_contrato_liberados` y `reservar('minorista')` lo devuelve con ticket nulo; `siguiente_numero_contrato_para_tenant` sigue entregando la secuencia; `fn_renumerar_contrato` (versión 281) funciona; el INSERT sin ticket de un número de secuencia (código viejo) funciona.
- Pruebas unitarias nuevas/actualizadas: `reciclajeContrato.test.ts`, `numeracionContrato.test.ts`, `reuso282.wiring.test.ts`.

### 12.6 Límites y riesgos que quedan (documentados, aceptados o fuera de alcance)
- **Escrituras atrasadas (RIESGO ABIERTO, no aceptado):** una pantalla del contrato anterior que todavía presente ese número escribe sobre el contrato nuevo (reproducido, §13). Por eso el reuso queda **deshabilitado por defecto**; no se debe habilitar sin la protección de §13.
- **Tablas sin FK:** un escritor que inserta entre la verificación al liberar y el commit se detecta al reservar y al crear (re-verificación) y el número queda bloqueado, no reutilizado.
- **Documentos ya entregados** al cliente anterior (cotización pendiente impresa/compartida) no dejan registro.
- **Camino SQL:** `convertir_cotizacion_a_contrato` no consume el pool.
- **Solo candidatos:** «elegible» significa que el contrato cumple las guardas; no certifica nada sobre lo que el cliente anterior conserva fuera del sistema.
- **Costo del escaneo:** la elegibilidad consulta ≈ 35 tablas por número (solo al liberar/reservar/crear con un número del pool); el preflight lista las tablas con muchas filas.
- **Fallos de creación posteriores al INSERT** (`revertir_contrato_incompleto`, 172) borran la venta y el número no vuelve al pool (limitación general, no tratada).

## 13. Escrituras desde pantallas antiguas — reproducción, operaciones afectadas y protección

**Regla del dueño:** conservar el historial técnico está aceptado; que una escritura del contrato ANTERIOR llegue al contrato NUEVO **no** lo está. Por eso el reuso nace deshabilitado (§12.2) y esta sección dice qué falta para habilitarlo.

### 13.1 Reproducción (esquema real: origin/main c9b25ffe1 + 281 + 282, base local desechable)
Script: `supabase/scripts/repro_282_escritura_antigua.sh <contenedor>` (habilita el interruptor solo en la base de prueba y lo deja apagado). Secuencia: A (pendiente, vacío, «Cliente A») existe y su pantalla queda abierta → A se elimina con reuso → B («Cliente B», otro asesor) nace con el MISMO número → la pantalla antigua de A dispara sus operaciones:

| Operación desde la pantalla de A | Efecto sobre el contrato NUEVO (B) |
|---|---|
| Registrar abono (`registrar_abono`, que la Server Action invoca como servidor) | **Afecta:** el pago de $500.000 queda en B |
| Confirmar venta (`confirmar_venta`) | **Afecta:** B queda confirmado |
| Editar datos del contrato (`UPDATE ventas`, EditarVentaForm) | **Afecta:** cliente, destino y precio de B se sobrescriben |
| Agregar pasajero / agregar servicio | **Afecta:** B recibe el pasajero y el servicio |
| Registrar cuenta por pagar | **Afecta:** B recibe la CxP |
| Subir un archivo a `contratos/<número>/` | **Afecta:** el archivo queda en el prefijo de B y un gerente (RLS real) accede a él |
| Eliminar el contrato (botón de la pantalla de A) | **Afecta cuando B no tiene aún un abono con asiento contable** (borra B; en una corrida previa B desapareció); si B ya recibió un abono, la guarda F4415 lo impide |

**Resultado: 7 de 8 operaciones probadas afectan a B.** En la auditoría todas quedan como operaciones sobre el mismo número, sin forma de distinguir de qué pantalla vinieron.

### 13.2 Qué operaciones pueden afectar al contrato nuevo
Todas las que reciben el contrato como número. Medido en el repositorio y en el esquema 281: **25 archivos de Server Actions** que reciben un contrato por número y escriben (contratos, reservar, cartera, pagos, comisiones, liquidación, retenciones, conciliaciones, libro diario, facturación, vouchers, adjuntos, cobros, condiciones, gestión, vuelos, empaquetados, cotizaciones manuales, importador…), **52 funciones SQL** con parámetro de contrato (37 SECURITY DEFINER; 18 ejecutables por `authenticated`), las funciones de #86 (soportes y avisos), las escrituras de Storage bajo `contratos/<número>/` y el portal/API B2B. Las 8 de §13.1 son una muestra, no la lista completa.

### 13.3 Por qué no se puede resolver en la base ni en la auditoría
La pantalla antigua y la legítima envían exactamente lo mismo: el texto del número. Ni un trigger, ni una RLS, ni la auditoría reciben ninguna otra identidad del contrato al que iba dirigida la operación; la PK de `ventas`, las FK de las hijas y las rutas de Storage usan ese texto. Por eso un candado "en el centro" no existe: o el texto que usan las operaciones es distinto por vida, o cada operación presenta una identidad adicional.

### 13.4 Protección mínima concreta y por qué amplía el alcance
- **Mínima: clave de contrato única por vida** (diseño K de §8): `ventas.numero_contrato` nunca se repite (`DTM-0042`, luego `DTM-0042~2`…) y solo el **número visible** se reutiliza. Las pantallas antiguas siguen presentando la clave vieja, que ya no existe: fallan por FK, por `SOPORTE_CONTRATO_INEXISTENTE` (#86) o dejan su fila bajo la clave muerta, sin tocar a B. Evidencia: prototipo K sobre el esquema 281 (pruebas K3–K6 de §7; **no se repitió sobre el estado integrado** porque no es parte de lo implementado).
- **Por qué amplía el alcance:** cambia el significado de `numero_contrato` para las vidas reutilizadas (incluye `~n`); exige un registro permanente de claves, reemplazar el CHECK de formato de la 160, ajustar el generador y los 4 creadores, y mostrar el número visible (sin `~n`) en documentos y portales (≈ 13 archivos al cliente; 55 archivos / 134 ocurrencias en pantallas internas) además de reescribir pruebas: ≈ 30 archivos esenciales (§11.3). Eso reabre una decisión del dueño (el sufijo `~n` en la clave) y no es una corrección de este PR.
- **Alternativas descartadas:** (a) un periodo de enfriamiento antes de reutilizar solo reduce la probabilidad (una pestaña puede quedar abierta días) y no es una prueba; (b) que cada operación envíe la versión/UUID del contrato que mostraba la pantalla exige tocar los mismos ≈ 25 archivos y 52 funciones; (c) restringir la reutilización a contratos que "nadie tiene abiertos" es imposible de saber.

### 13.5 Estado y condición para habilitar
**El reuso queda deshabilitado** (`dtm_reuso_config.habilitado = false`, §12.2): con esta migración aplicada nada se libera para reutilización. Para habilitarlo hace falta (1) decidir e implementar la protección de §13.4 (u otra que cierre las 7 operaciones de §13.1), (2) repetir `repro_282_escritura_antigua.sh` y comprobar que ninguna operación afecta a B, y (3) recién entonces `update public.dtm_reuso_config set habilitado = true`. El postcheck marca REVISAR si el interruptor está encendido.

## 14. Integración con origin/main y verificación (estado al 2026-11-08)
- **Integración:** rama `claude/75-reuso-dtm` en el worktree `.worktrees/75-reuso-dtm` creada sobre `origin/main` (c9b25ffe1, incluye 269–281); los cambios del árbol anterior se portaron con merge de 3 vías (un solo conflicto, `reservar/actions.ts`, por finales de línea; resuelto sin pérdida: solo 10 líneas añadidas). Sin commit.
- **Esquema:** plantilla local reconstruida con las 275 migraciones hasta la 281 de origin/main (el script `preparar_esquema_local.sh` ahora agrega `file_size_limit`/`allowed_mime_types` a `storage.buckets` en la preparación del entorno; sin eso la 281 no corre en la imagen local).
- **SQL sobre ese estado:** preflight (todo OK), migración 282, postcheck (18 controles, todo OK, interruptor en false), `test_282_reuso_consecutivos_dtm.sh` **119 PASS / 0 FALLO** (incluye: nace deshabilitado; orden numérico DTM-9999 antes que DTM-10000) y la reproducción de §13.1.
- **Pruebas unitarias, comparadas contra origin/main limpio** (worktree `75-base`): línea base **29 fallos** de 8892; con la rama, los mismos 29 + 1 fallo propio detectado (un error de sintaxis en una prueba nueva, ya corregido). **Los fallos de la línea base NO son del trabajo de #75 porque fallan igual sin él** (mismo conjunto de nombres en ambos, comparado con `comm`); no se afirma nada más sobre su causa.
- **Numeración de migración:** la 283 la tiene el perfil del portal B2B (#25, rama `codex/portal-b2b-vuelos`); la 282 es de #75; ninguna otra rama ni worktree (79 revisados) usa la 282 ni la 284.


## 15. ENTREGA 1 — Identidad del contrato y guardas (migración 284)

Estado: escrita y probada en local; **no aplicada en ningún entorno remoto**; el reuso sigue apagado (la 284 no puede activarlo: `nacio_de_reuso` es false en toda fila y solo lo escribirá la entrega 3).

### 15.1 Numeración (coordinada con #97)

| Número | Contenido | Entrega |
|---|---|---|
| 283 | Perfil B2B atómico (#25) — ya aplicada, no se toca | — |
| **284** | `20260601000284_identidad_contrato.sql` — uid, guardas, `contrato_guardas_config`, `contratos_identidades()` | 1 |
| **285** | funciones parchadas (`liberar_vencidas`, `soporte_*`, `registrar_financiero_contrato`/`revertir_contrato_incompleto`), `contrato_financiero_pendiente.contrato_uid`, políticas de Storage | 2 |
| **286** | **de #97** (`cotizacion_comision_acuerdo`) — NO es del reuso; la propuesta anterior de renumerar el reuso a 286 quedó descartada | — |
| **287** | reuso (`…287_reuso_consecutivos_dtm.sql`, antes 282): pool, elegibilidad, ticket, `nacio_de_reuso` | 3 |

#97 no tiene migración propia en su rama (`claude/portal-b2b-bloque-97-98-84-32`: solo la 283 de #25). Si #97 crea tablas con `numero_contrato`, deben **clasificarse en `contrato_guardas_config`**: el instalador aborta nombrándolas y el postcheck vuelve a comprobarlo.

### 15.2 Qué agrega la 284

- `ventas.contrato_uid` (único, `DEFERRABLE INITIALLY DEFERRED`, inmutable) y `ventas.nacio_de_reuso` (inmutable). El uid se conserva al renumerar porque `fn_renumerar_contrato` copia la fila completa.
- Declaración de la identidad: cabecera HTTP `x-contratos` = JSON `{"<numero>": "<uid>"}` (PostgREST la expone a triggers y funciones en la misma transacción) o, para tareas **automáticas** sin pantalla, `contrato_declarar_identidad()` (sin EXECUTE para ningún rol de la API). No hay excepción por rol.
- Guarda `contrato_guarda_identidad()` en las 36 tablas con `numero_contrato`/`contrato_numero` más 6 que cuelgan por id (`cxp_pagos`, `retenciones_cxp`, `comision_b2b_pagos`, `comision_b2b_revision`, `factura_items`, `_pasajeros_exentos_167`). Identidad declarada ≠ vigente → `CONTRATO_CAMBIO` (F4601). Ausente sobre un contrato nacido de reuso → `IDENTIDAD_REQUERIDA` (F4602). Contrato de siempre sin identidad → pasa como hoy.
- `contratos_identidades(text[])`: la pantalla lee el uid al cargar, con la regla de acceso de `puede_ver_contrato`. No se reescribió `ventas_basica`.
- Bloqueo: `FOR KEY SHARE` (el que la FK ya toma) con dos intentos de lectura: cierra la carrera «el contrato se borró y renació con el mismo número».
- Modos en `contrato_guardas_config`: `estricto` (por defecto), `vinculo` (`cotizaciones`: editar por id es libre, ligar/desligar el número exige identidad), `estado_personal` (`avisos`: solo `leido_en`/`notificado_en` quedan exentos), `desajuste` (`movimientos_silla`: bitácora solo de inserción; solo se rechaza una identidad declarada que no sea la vigente), `excluida`. Las referencias manuales de texto (`sillas.contrato_manual`) se resuelven con `_resolver_contrato_manual` (misma regla que el RPC).
- Renumerar verifica el **origen**: la excepción «mismo uid» solo exime el destino.
- **Falla cerrado:** una tabla de contrato sin clasificar aborta la migración.

### 15.3 Pruebas (Postgres real hasta la 281 + 282 original + 284)

`supabase/scripts/test_284_identidad_contrato.sh <contenedor> [base]` — **118 comprobaciones, 0 fallos**: estructura, inmutabilidad, cabecera mal formada, `contrato_pasajeros` (INSERT/UPDATE/DELETE × antigua/ausente/correcta/de siempre), mover entre contratos (ambos lados, varias filas), 22 tablas estrictas sembradas genéricamente + 5 explícitas (las 2 restantes, `persona_capturas` y `factura_revision_fuera_libros`, solo admiten su ruta legítima: el rechazo se prueba, el permiso queda PENDIENTE para la matriz de la entrega 2), sillas por número y por referencia manual × `mover_pasajero` (`solo_datos`/`con_cupo`), `guardar_infante_vuelo`, `editar_pasajero_silla`, `liberar_silla`, `asignar_contrato_manual` (silla libre hacia contrato de reuso), cotizaciones, avisos, soportes, `eliminar_contrato`, `fn_renumerar_contrato`, carrera, y regresión (contratos de siempre sin identidad; 500 sillas con la guarda en ~370 ms). `test_282_reuso_consecutivos_dtm.sh` sigue en **119/119** con la 284 aplicada.
Preflight, postcheck (13 controles) y rollback verificados: el rollback se **niega** si la migración del reuso sigue aplicada o si algún contrato nació de reuso; limpio, deja 0 columnas/0 triggers; la 284 es idempotente.

### 15.4 Diferencias respecto del diseño aprobado

1. Los parches a `liberar_vencidas`, `soporte_*` y el financiero **no** van en la 284 sino en la 285 (cambian funciones existentes: se aplican con el código que envía la identidad).
2. Códigos de error con SQLSTATE propio (`F4601`/`F4602`/`F4603`) en vez de `P0001`.
3. Bloqueo `FOR KEY SHARE` en vez de `FOR SHARE` (menos contención).
4. `conciliacion_sistema`, `abonos_anulados` y `factura_revision_fuera_libros` quedan **estrictas** (sin excepción), como se acordó.

### 15.5 Pendiente de la entrega 1

- Aplicar y validar en remoto (solo con autorización).
- Medir el costo de la resolución de referencias manuales con el volumen real de `sillas`.
- Reproducir con PostgREST/Storage reales contra la 284 (ya demostrado con prototipos equivalentes).


## 16. ENTREGA 2 — Propagación de la identidad, funciones, Storage y portal (migración 285)

Estado: escrita y probada en local; **no aplicada en ningún entorno remoto**; el reuso sigue apagado. La rama tiene preparado (sin commit) el merge de `origin/main` (e39224313, #444: perfil y vuelos del portal B2B, migración 283), sin conflictos.
Convenciones de código: [identidad-propagacion-285.md](identidad-propagacion-285.md).

### 16.1 Qué agrega la 285

- `contrato_financiero_pendiente.contrato_uid`: el registro pendiente **conserva la identidad del contrato desde su creación**; un trigger la completa solo para contratos de siempre (código anterior), exige uid explícito si el contrato nació de reuso y nunca deja cambiar un uid guardado. El cron declara ESA identidad, no la vigente.
- `liberar_vencidas`: única función que se auto-declara (tarea automática: no recibe contratos, los elige por estado bajo bloqueo).
- `soporte_registrar/reemplazar/retirar` comprueban la identidad antes de escribir y rechazan con `SOPORTE_IDENTIDAD` (F4521), prefijo que el clasificador del portal ya trata como rechazo **definitivo**; `soporte_verificar_identidad` (solo `service_role`) es la precomprobación ANTES de subir el archivo.
- Storage: las 4 políticas del bucket `contratos` exigen además `contrato_identidad_ok_archivo(name)` (superadmin incluido).
- Vistas: `ventas_basica`, `ventas_vuelo_sistema` y `contrato_vuelos_editor` exponen `contrato_uid` en la MISMA consulta que trae los datos (se añade al final de la definición viva; la migración aborta si su forma no es la esperada).

### 16.2 Pruebas (Postgres real hasta la 281 + 283 + 284 + 285; PostgREST v16.4 y storage-api v1.84.19 REALES)

| Prueba | Resultado |
|---|---|
| `test_284_identidad_contrato.sh` (guardas; incluye ahora los permisos de `persona_capturas` y `factura_revision_fuera_libros` por su ruta legítima: `facturar_factura`/`quitar_factura`) | 125 de 125 |
| `test_285_identidad_funciones_storage.sh` (pendiente financiero, `liberar_vencidas`, soportes, Storage, `ventas_basica`, **regresión Minorista**, **renumeración completa**) | 51 de 51 |
| `test_285_postgrest_storage.sh` (cabecera HTTP real → triggers/RPC; políticas reales de Storage: subir/descargar/listar/firmar/PUT/borrar; service_role y superadmin sin excepción; mover entre contratos) | 44 de 44 |
| `test_282_reuso_consecutivos_dtm.sh` sobre la base con 284 (regresión de la 282 original) | 119 de 119 (corrida de la entrega 1) |
| Preflight, postcheck y rollback de la 284 y la 285 | verificados (rollback: restaura el texto exacto de las funciones de la 281; se niega si algún contrato nació de reuso) |

Medición local del costo de la guarda (`medir_guarda_284.sh`, mismas filas y misma base, con y sin el trigger, mediana de 7, 2000 filas, transacción revertida): inserción de sillas libres 228 ms frente a 70 ms; actualización 433 ms frente a 182 ms; pasajeros en un contrato de siempre 148 frente a 95 ms; en uno de reuso con identidad 139 frente a 82 ms. Es una medición **local** de comparación, no una cifra de producción: la guarda cuesta del orden de 0,05–0,1 ms por fila en una base desechable. La resolución de referencias manuales sobre `sillas` es la parte más cara; no se ha medido con volumen real.

### 16.3 Cómo viaja el UUID (código)

`lib/contrato/identidad.ts` (puro) + `createClient(identidad?)` / `createAdminClient(identidad?)`. La página lee `contrato_uid` en la misma consulta que el contrato (o embebido, `ventas(contrato_uid)`), los componentes reciben `identidad` por prop y la reenvían como ÚLTIMO argumento obligatorio de cada acción; los flujos que crean un contrato toman el uid del propio INSERT (se genera en el servidor y viaja en el INSERT: el rol `venta` no puede leer `ventas`). El inventario es verificable: `pruebas/identidadPropagacion.wiring.test.ts` + `pruebas/support/inventarioIdentidad.*.json` (cada excepción `identidad:n/a — motivo`).

### 16.4 Límites de la entrega 2 (honestos)

1. `liquidacion_descuentos` y `conciliacion_sistema` no tienen FK a `ventas`: la identidad sale de la lectura que la pantalla ya hizo; si el número se escribió a mano y no aparece, va vacía y la base rechaza si el contrato nació de reuso (falla cerrado). Idem el «contrato de referencia» de un movimiento directo (texto libre).
2. Conversión de cotización manual/dinámica a contrato: se hace dentro de RPC SQL con `service_role`; con un número reutilizado las hijas serían rechazadas por la guarda. **Se resuelve en la entrega 3** (esas funciones SQL, al ser quienes crean el contrato, deben declarar la identidad del contrato que acaban de insertar).
3. Sillas con solo `contrato_manual` (texto): el uid de la misma carga de página se resuelve por la referencia (límite documentado: mientras exista una silla con esa referencia, la elegibilidad de la entrega 3 bloquea el número).
4. Los `.pg.ts` del repo que cubren soportes (`soportesPago281.pg.ts`) y `contratoManualNeto206.pg.ts` fueron adaptados a las firmas nuevas pero no se ejecutaron.
5. No se ejecutó `npm run build` ni un recorrido en navegador.
6. Nada de esto cambia el comportamiento de los contratos de siempre sin identidad.


## 17. ENTREGA 3 — Cierre de la integración (2026-11-08)

Estado: escrita y probada en local; **ninguna migración aplicada en remoto; el reuso sigue APAGADO** (`dtm_reuso_config.habilitado = false`). Sin staging, commit ni push.

### 17.1 Qué cambió
1. **control_vuelo y el UUID (284, sección 6b).** `sillas_identidades(p_bloqueo bigint default null)` (SECURITY DEFINER; roles superadmin/gerencia/administracion/operaciones/control_vuelo; `anon` sin EXECUTE; `venta` no recibe nada y sigue por `contratos_identidades`) devuelve solo `(silla_id, numero_contrato, contrato_uid)`. No concede lectura de `ventas`: control_vuelo sigue sin leerla (probado). Las páginas `vuelos/[id]` y `vuelos/pasajeros` la llaman **antes** de leer las sillas y usan el uid solo si el número de la silla coincide con el leído; si el contrato cambió en medio, la silla queda sin identidad y la base rechaza. Ya no se usa el embed `ventas(contrato_uid)` en esas pantallas. No hay consulta posterior por número para sustituir la identidad de una pantalla.
2. **Quien crea un contrato conoce su identidad (284, sección 1b).** Trigger AFTER INSERT en `ventas` que declara `(número, uid)` con `set_config(..., true)`: vale solo dentro de esa transacción. Las conversiones SQL (`convertir_cotizacion_*`, incluida la copia de #97) y cualquier otro creador que escriba las hijas en la misma transacción no se rechazan, **sin editar esas funciones** (por eso no choca con la 286). Una pantalla antigua nunca comparte transacción con la creación. Hecho comprobado: esas conversiones piden el número a la secuencia (`siguiente_numero_contrato_para_tenant`), nunca al pool; esta regla es la defensa general.
3. **Reserva y creación (287).** El trigger de `ventas` que consume el ticket del pool marca `nacio_de_reuso = true`; a partir de ahí toda escritura exige la identidad. La 287 se niega a aplicarse sin la 284 y la 285.
4. **Elegibilidad con referencias manuales (287).** `dtm_reuso_bloqueos` bloquea el número si alguna silla apunta al contrato por `sillas.contrato_manual` (resuelto con `_resolver_contrato_manual`, la misma regla de las guardas): motivo `REFERENCIA_MANUAL_EN_SILLA`; si la lectura falla, `LECTURA_FALLIDA_REFERENCIA_MANUAL` (falla cerrado).
5. **Aviso de eliminación/reemplazo y redirección.** `AvisoContratoCambio` (ficha del contrato) revisa cada 60 s y al volver el foco, vía `contratoSigueVigente(numero, uid)`, que solo devuelve `true/false/null` y nunca el uid vigente; si ya no es el vigente, muestra el aviso y lleva a `/dashboard` a los 8 s. **Es cortesía**: la protección de las escrituras es la identidad que verifica la base, con o sin aviso.
6. **Numeración.** Reuso = **287** (la 286 es de #97; su documento de coordinación pedía ≥ 287). Renumerados con el contenido: migración, preflight/postcheck/rollback, `test_287`, `repro_287`, wiring y comentarios de código; el md5 de `eliminar_contrato` cambió por los comentarios (rollback y postcheck actualizados: `c7a510c0…`). Preflight 287 ahora exige 284/285.

### 17.2 Integración con #97 (verificada en copia aparte; ninguna de las dos ramas fue modificada)
Fusión de tres vías (base e39224313) de los 15 archivos que #97 modifica: 8 los toma tal cual (#75 no los tocó), 6 se fusionan sin conflicto (`contratos/actions.ts`, `pagos-actions.ts`, `types/database.ts`, tres pruebas) y 1 conflicto real en `cotizaciones/manual-actions.ts` (resuelto conservando la estructura de #97 y la anotación `identidad:n/a` de #75). Al fusionar, **3 llamadas de #97 no compilan** (`revertirContratoManual` ×2 y `depsFinancieroManual`, que en #75 reciben la identidad `idc`) — es el parche de `integracion-97-con-75.diff`; aplicado, `tsc` queda limpio. Además la aserción de `comisionAsistidaPvp97.test.ts` debe esperar `revertirContratoManual(idc, numero, tenant)`. La propagación de identidad y el cálculo de comisiones PVP/negociado de #97 quedan ambos presentes.

### 17.3 Pruebas — qué es local, qué es simulado, qué falta
| Prueba | Resultado | Naturaleza |
|---|---|---|
| `test_284` (guardas + autodeclaración + sillas_identidades por rol) | 133 / 133, también con 286+287 aplicadas | Postgres real local |
| `test_285` | 51 / 51 (también con 286+287) | Postgres real local |
| `test_287` (reuso, elegibilidad, ticket, concurrencia, **ciclo completo con pantallas antiguas**) | 132 / 132 (con 281,283,284,285,286,287) | Postgres real local |
| `soportesPago281.pg.ts` (acciones reales, PostgREST v16.4, sesión y Storage simulados) | 36 / 36 | local, parcialmente simulado |
| `contratoManualNeto206.pg.ts` (esquema integrado) | 48 / 55; las **7 mismas** fallan sin los cambios de #75 (origen/main + 281 + 283, código de `75-base`): pruebas del portal B2B | local, simulado (sesión) |
| `test_97_acuerdo_dinamica` / `test_97_comision_pvp` sobre la base integrada | 71 OK / 22 OK | Postgres real local |
| Unitarias (identidad, reconciliación, soportes, numeración, reuso, #97) | 184/184 en la rama; 306 con #97 integrada, 2 fallos: uno de la línea base (`medicionFlujoWiring`, 37 ≠ 36) y la aserción de #97 descrita arriba (corregida en la copia) | local |
| `tsc --noEmit` | limpio en la rama y en la copia integrada | local |
**No hecho:** `npm run build`; recorrido en navegador del aviso y de las pantallas de vuelos con el rol real `control_vuelo` contra PostgREST (se probó la función con ese rol en SQL, no la página); storage-api real (`test_285_postgrest_storage.sh`, sin repetir tras estos cambios); medición de rendimiento con volumen real; **Preview del dueño**.

### 17.4 Pendiente
- Decisión del dueño sobre habilitar el reuso (aparte; hoy apagado) y revisión final de auditoría.
- Migraciones 284 → 285 → 287 (y 286 de #97) NO aplicadas: una etapa por vez, preflight → migración → postcheck.
- Al fusionar #97: aplicar el parche de 3 llamadas y la aserción; renumeración no necesaria.

## 18. Apagado del interruptor (corrección posterior a la entrega 3, 2026-11-08)

Antes, `habilitado=false` solo frenaba la LIBERACIÓN; un número ya en el pool se seguía entregando y consumiendo. Ahora el apagado cierra también la entrega y el consumo (migración 287):
- **`reservar_numero_contrato`** lee el interruptor con `FOR SHARE` al empezar; apagado → no toca el pool y usa la secuencia (ticket nulo).
- **Trigger de `ventas`**: con un ticket válido del pool, exige el interruptor encendido (`FOR SHARE`) antes de consumir; apagado → `REUSO_APAGADO: … esta reserva ya no sirve … Genera el contrato de nuevo (recibirá un número nuevo)`, sin crear contrato. Sin ticket sigue `RESERVA_AJENA`.
- **Nada se borra al apagar**: números liberados y reservas (con su ticket) quedan intactos; si se vuelve a encender, la reserva sigue siendo de su dueño.
- **Contratos ya reutilizados** conservan `nacio_de_reuso`, su uid y las guardas (el apagado no toca la 284/285).
- **Carrera apagar vs. consumir/reservar:** `UPDATE` del interruptor toma el bloqueo exclusivo de su fila; reservar y el trigger toman `FOR SHARE`. Gana el orden transaccional: si la creación confirma primero, el contrato existe y el apagado se aplica después; si el apagado va primero, la creación (o la reserva) espera y ve «apagado». Sin riesgo de interbloqueo (el pool se recorre con `SKIP LOCKED`).

Pruebas (`test_287` §11, Postgres real local, sesiones simultáneas reales): pool disponible + apagado → secuencia; ticket emitido + apagado → `REUSO_APAGADO`, sin contrato y reserva intacta; contrato reutilizado ya creado → uid antiguo/ausente rechazados y uid correcto funciona; carreras 4a (creación primero), 4b (apagado primero), 4c (apagado vs. reservar). `test_287`: 152/152.

### Pendientes cerrados en esta ronda (local)
- `npm run build`: compila (con la raíz de Turbopack ampliada temporalmente; `next.config.ts` restaurado).
- `test_285_postgrest_storage.sh`: 51/51 (PostgREST v16.4 y storage-api v1.84.19 reales) — se añadió el recorrido real de `control_vuelo` (A2): obtiene el uid por `sillas_identidades`, sigue sin leer `ventas`, y su escritura (RPC `editar_pasajero_silla`) exige esa identidad.
- Aviso de contrato cambiado: `pruebas/avisoContratoCambio75.react.ts` (4/4, jsdom, incluye la redirección automática a los 8 s).
- Sigue sin hacerse: recorrido en navegador real de las páginas de vuelos con sesión de `control_vuelo`, y Preview del dueño. El reuso sigue APAGADO; no se aplicó ninguna migración.
