# Comisión B2B del aliado vs. segunda comisión del usuario interno (#65)

**Auditoría y propuesta. Sin migraciones, sin cambios de datos, sin cambios de visibilidad.**
Script de lectura: `supabase/scripts/auditoria_dos_comisiones_65_solo_lectura.sql` (una sola consulta `SELECT`).
Pruebas: `pruebas/participacionEconomica65.react.ts`.

---

## 0. Correcciones a la versión anterior de este documento

La versión previa decía cosas que el resultado real de la consulta desmiente:

1. **«MIN-00-0519: la fila de Javier está en cero».** **Falso.** La fila **137** de Javier suma **$139.000** y tiene **un abono**.
   La prueba que la modelaba como cero era ficticia y se **sustituyó** (ver §5).
2. **«ALIADO_CLARO».** Esa etiqueta se le asignaba a Javier porque su cuenta vinculada hoy dice `freelance`. Eso **no prueba**
   que sea solo aliado: el dueño confirmó que **también actúa como interno**. Se eliminó la etiqueta.
3. **Clasificación automática como «interna» por nombre o por firmar la venta.** Se eliminó: ninguna fila se declara comisión
   interna por coincidencia de nombre ni por ser el firmante. Esos datos se muestran solo como **evidencia**.
4. **Un solo veredicto por fila.** Se separó en tres cosas distintas (§2).

## 1. Resultado real de la primera ejecución (dato aportado por el dueño)

- **10 ventas** y **20 filas positivas**. Están las siete esperadas y además tres: **MIN-00-0476, MIN-00-0498, MIN-00-0519**.
- Las filas de esos tres casos (lo único que se conoce de la salida real):

| Contrato | Filas | Lo que se sabe |
|---|---|---|
| MIN-00-0476 | 100 y 101 | **Ambas** vinculadas a la ficha **8** (Javier): dos filas, **un** beneficiario |
| MIN-00-0498 | 1 y 121 | Fila 1 «JAVIER VIEIRA» **sin ficha**; fila 121 «JAVIER A VIEIRA P» con ficha **8**. **Confirmado por el dueño: es la misma persona** |
| MIN-00-0519 | 135 y 137 | 135 = Yaqueline; **137 = Javier, $139.000, con un abono** |

**No se conocen** aquí las filas de las otras siete ventas: el script las lista (ver §7).

## 2. Tres cosas que no son lo mismo

El script ahora las separa en columnas distintas.

1. **Filas positivas.** Importe económico > 0 con la **misma fórmula del portal** (`comision_b2b_total` = espejo de
   `calcularComisionFila(...).totalPagar`) y **desglosado**: comisión base (valor fijo, o base × %), recobro para el aliado
   (`recobro_total × pct_recobro_aliado`, 0,5 si es nulo), retención y total, más **«positiva por»**: comisión base, recobro o ambos.
   *Una fila puede ser positiva solo por el recobro aunque base y % estén en 0* — que `base_comision = 0`, `pct_comision = 0` y
   `comision_valor` nulo **no** implica comisión cero.
2. **Beneficiarios distintos.** Dos filas no son dos personas. El script cuenta beneficiarios por ficha; una fila sin ficha **no**
   se funde con otra por nombre, salvo que el dueño lo haya confirmado (lista explícita al inicio del script). Cuando hay más
   filas que beneficiarios marca el contrato con `REVISAR` («dos o más filas para la misma persona»).
3. **Personas de doble rol.** Alguien que cobra como aliado y actúa como interno. Se reconoce por (a) la confirmación del dueño
   (ficha 8), (b) ficha vinculada a una cuenta de rol interno, o (c) un interno con el mismo primer nombre (**solo evidencia**).
   El rol de su cuenta vinculada **no** decide.

Clases que emite el script (ninguna dice «interna» ni «aliado seguro»):

- `CLASIFICAR_DOBLE_ROL` — beneficiario de doble rol: los datos **no** dicen si esta fila es comisión B2B o segunda comisión interna.
- `CLASIFICAR_SIN_FICHA` — fila sin ficha y sin confirmación: solo hay texto.
- `SIN_INDICIO_DE_DOBLE_ROL` — beneficiario con ficha y sin indicio de doble rol. **No es una prueba de que sea B2B**; solo que los
  datos no dan motivo para dudarlo.

## 3. La regla de comisiones internas ya existente y su límite

Tomada de `app/(dashboard)/dashboard/liquidacion/page.tsx` y `lib/finanzas/liquidacionAsesor.ts` (no es una regla nueva):
la comisión interna **no se guarda por contrato**; se calcula al abrir `/dashboard/liquidacion` para un usuario `rol = 'venta'`
con escala, que firma la venta (`asesor_firma_nombre`), con contrato activo/confirmado y `fecha_venta` en el mes.

**Límite que importa aquí:** esa regla cubre a quien es `venta` con escala. **No** describe a un interno `operaciones` (o de otro rol)
que además es aliado. Que el dueño haya confirmado que Javier «también actúa como interno» **no** trae consigo una regla de cuándo
una fila suya es comisión interna y cuándo es B2B: **esa regla no está codificada en ningún sitio** y es la decisión pendiente (§7).

## 4. Qué hace el portal hoy con los tres casos (código actual, sin cambios)

**Respuesta expresa: con el código actual, Javier SÍ ve MIN-00-0519 como *participación*.** La fila 137 es positiva ($139.000),
lleva su ficha (8) y la venta es de la ficha 37 (Yaqueline), así que entra por `contratosPorParticipacion`.

Lo que **alcanza a ver en pantalla** (probado en `pruebas/participacionEconomica65.react.ts`):

- En **Mis ventas** (pestaña Asistidas): el número de contrato, la agencia, el **destino**, la **fecha de salida**, el **estado** del
  contrato, el texto **«Participación por comisión»** y **su** comisión: el **saldo de su fila**. ⚠️ *Actualizado (precheck real,
  1-nov-2026):* el abono de la 137 es de **$139.000** (= su total), no de $39.000 → saldo **$0**, estado **«Pagada»**; la fila sigue visible
  aunque no deba nada. La fila de Yaqueline no se mezcla en su importe.
- En el **Inicio** (lista de contratos recientes): número, destino, estado y el texto **«Participación por comisión» / «Solo comisión»**
  (sin fecha de salida); cuenta en «Mis ventas · 1 más con tu comisión» y en «Comisión por cobrar».
- **No** ve: el nombre del **cliente**, la modalidad de compra, el precio de venta, **cartera**, **pagos**, **documentos**, el
  enlace a **cuenta de cobro**, ni los abonos del contrato (solo el abono de su propia fila de comisión, que descuenta del saldo).
- **Lo que el servidor sí carga** (y no pinta): la fila completa de `ventas` de ese contrato (incluye `cliente`, `precio_venta`,
  `share_token`). Hoy ninguna pantalla lo renderiza; es una superficie a vigilar si se cambia el diseño.

Los otros dos casos, con el mismo código:

- **MIN-00-0476** (filas 100 y 101, ambas ficha 8): una sola participación, y el portal **suma las dos filas** en su importe. Si una
  de ellas es un duplicado, Javier vería el doble. El script lo marca `REVISAR`.
- **MIN-00-0498** (fila 1 sin ficha, fila 121 con ficha 8): la participación entra por la **121**. La fila 1 **no** se suma por
  nombre; solo se sumaría si su documento coincidiera con el de la ficha 8 (`filasCobrables`). Si `ventas.aliado_id` del contrato es
  la ficha 8, Javier lo ve como **propio** (con cartera y documentos): ese dato no está en lo que se me entregó.

## 5. Pruebas

- Se **sustituyó** la prueba basada en una fila ficticia de cero: ahora `MIN-00-0519` reproduce la fila 137 con **$139.000 y un abono de $139.000**
  (dos descomposiciones equivalentes —solo recobro / solo comisión base— porque los componentes reales salen del script) y fija:
  Javier **sí** la ve como participación, con saldo $0 y «Pagada», sin cliente ni enlaces a esa venta; Yaqueline conserva su contrato propio
  pero **no ve su comisión** mientras su fila 135 tenga ficha NULL. *Real vs. sintético:* solo son reales los ids/contratos, los $139.000 de la 137,
  su abono, la ficha NULL de la 135 y que Javier es la ficha 8; el resto de importes y nombres son inventados (se rotula en la cabecera de la prueba).
- Los casos **0476** y **0498** están reproducidos; una fila **genuinamente en cero** se conserva como caso **sintético** aparte
  (`MIN-X-CERO`), sin pretender que sea ninguno de los reales.
- Lecturas fallidas (`aliados_b2b` y `ventas`, `error` y `sin_conteo`): sin participación y se avisa. Las tablas no se modifican.

**Estas pruebas fijan el comportamiento actual; no lo aprueban.** Si el dueño decide que alguna fila es comisión interna, el caso
correspondiente debe cambiar junto con la regla que la oculte.

## 6. Cambio mínimo de visibilidad (propuesto, **no aplicado**)

Solo después de clasificar las filas (§7). Mínimo y sin tocar importes:

1. Un dato por fila que diga la clase: `aliados_b2b.beneficiario_tipo` (`'aliado'` | `'asesor_interno'`), **nulo = aliado** (así nada
   cambia para lo ya cargado) y, para el interno, `beneficiario_usuario_id`. Migración nueva con el siguiente número libre
   (`ls supabase/migrations | sort | tail` en esta rama, ver `CLAUDE.md` §12.bis).
2. `contratosPorParticipacion` y `comisionesDelPortal` ignoran las filas `'asesor_interno'` (una sola condición en cada lectura).
3. Marcar **solo** las filas que el dueño clasifique como internas. Lo demás queda como está.

Alternativa sin migración (más frágil): una lista de `fila_id` excluidos en código. **No recomendada**: oculta por id, no por concepto.

## 7. Lo que hay que clasificar (lista exacta)

Hay que decidir, **fila por fila**, si es **comisión B2B (participación)** o **segunda comisión interna**:

| numero_contrato | fila_id | Beneficiario | Por qué no se puede decidir con los datos |
|---|---|---|---|
| MIN-00-0476 | 100 | ficha 8 (Javier) | Doble rol confirmado; ¿ambas filas son concepto distinto o duplicado? |
| MIN-00-0476 | 101 | ficha 8 (Javier) | ídem |
| MIN-00-0498 | 1 | «JAVIER VIEIRA» (sin ficha, = ficha 8) | Sin ficha; doble rol |
| MIN-00-0498 | 121 | ficha 8 (Javier) | Doble rol; misma persona que la fila 1 |
| MIN-00-0519 | 137 | ficha 8 (Javier) | Doble rol; $139.000 con un abono |

Las filas de **Yaqueline** (p. ej. 135 en 0519) no tienen indicio de doble rol en lo que se conoce, pero eso **no** es una prueba de
que sean B2B: deben figurar en la lista si el script las marca. **Las otras siete ventas:** el script emite en la fila `resumen` la
lista exacta `numero_contrato#fila_id` de todo lo que requiere clasificación; **hay que pegarla** (no la tengo).

**Dato que falta además de la clasificación:** el criterio del dueño para Javier —cuándo una fila suya es comisión interna y cuándo
B2B—. Sugerencias de qué mirar: si él es el firmante/asesor interno de esa venta, si es el aliado de la venta (`ventas.aliado_id`),
y si el importe proviene del **recobro** (concepto del aliado) o de una comisión sobre la venta. El script muestra los tres.

## 8. Cómo ejecutar el script

1. Pegarlo en el editor SQL (solo lectura). La fila `resumen` cuenta ventas y filas y lista lo que hay que clasificar.
2. Las filas `contrato` con `REVISAR` son las que tienen más filas que beneficiarios.
3. Las filas `fila` traen el **desglose del importe**, la relación con la venta, el abono y quién creó la fila (rastro de auditoría).
4. Las dos confirmaciones del dueño (ficha 8 = doble rol; fila 1 = ficha 8) están al inicio del script; **no agregar** otras sin confirmación.
5. Validado en una base local desechable con datos inventados que reproducen los tres patrones (no con datos reales).

---

## 9. Regla confirmada por el dueño (supera a §6 y §7 para estas diez ventas)

En **MIN-00-0422, 0432, 0433, 0439, 0462, 0463, 0476, 0484, 0498 y 0519** la línea de **comisión** y la de **recobro** pertenecen al
**mismo asesor de la comisión** (Paola, Katherine Colorado, Katherine Colorado, Juliana, Javier, Marcela, Javier, Sebastián, Javier, Yaqueline),
aunque hoy estén atribuidas a personas distintas. Por tanto el problema **no** es «segunda comisión interna vs. B2B» en esas filas: es
**atribución errónea** de una de las líneas. Filas señaladas: 79, 81, 82, 83, 85, 89, 107 y 137 (otra persona) y la fila 1 de 0498 (sin ficha).

No se deduce que una fila sea «recobro» por `recobro_total`: puede estar calculada con base y porcentaje y ser comercialmente el recobro.

### 9.1 Herramientas (nada ejecutado)

| Archivo | Qué es |
|---|---|
| `supabase/scripts/conciliacion_asesor_comision_65_solo_lectura.sql` | Una consulta `SELECT`: por fila, beneficiario actual, ficha, importe, componentes, abonos (con quién los registró según auditoría) y diagnóstico `COINCIDE_CON_EL_ASESOR` / `ATRIBUIDA_A_OTRA_PERSONA` / `SIN_FICHA`; contrasta con las filas que señaló el dueño. |
| `supabase/scripts/correccion_asesor_comision_65_plan.sql` | A) precheck, B) UPDATE acotado en transacción (termina en `ROLLBACK`), C) postcheck. Solo cambia `aliado_id/aliado/nit/tipo_aliado`; nunca importes, retención, abonos ni `ventas.aliado_id`. |
| Migración 267 (`20260601000267_recobro_beneficiario_explicito.sql`, rollback, preflight, postcheck y pruebas) | **PR de esquema SEPARADO** (rama `fix/267-recobro-beneficiario`), fuera de este PR. Sin correr. Trigger diferido: la línea de recobro de una conversión toma el aliado de la cotización (o el nombre de la venta si identifica UNA ficha del tipo) o la transacción falla con `RECOBRO_SIN_BENEFICIARIO`. Evita nuevas atribuciones erróneas; no corrige las históricas. |

### 9.2 Evidencia sobre el destinatario real del pago

`comision_b2b_pagos` guarda solo `fecha`, `valor`, `tenant`. **No** guarda beneficiario, forma de pago ni referencia. La evidencia disponible es
(a) la fila a la que está colgado el abono, (b) quién lo registró (auditoría, si hay rastro) y (c) cuándo. Con eso **no se puede probar a quién se le
consignó**: toda fila señalada que ya tiene abonos queda **`REVISION_CONTABLE`**, el UPDATE la excluye por guardia y solo entra si contabilidad la lista
en `revision_contable_aprobada` tras verificar el pago. Cambiar el beneficiario de una fila pagada no corrige el pago; solo deja el registro coherente.
**No confundir tres cosas** (las tres aparecen mezcladas en versiones anteriores de este documento):

| Concepto | Qué es | Quién lo decide / de dónde sale | Estado |
|---|---|---|---|
| **Asignación** | A qué ficha DEBE pertenecer la fila | El dueño (lista de §9.5); la 135→37 y la 137→37 las confirmó en esta conversación («ambos siempre al asesor… ambos son de ella») | Confirmada (8 filas + 137 + 135) |
| **Abono registrado** | Fecha y valor en `comision_b2b_pagos` | Un hecho del sistema (precheck) | Conocido |
| **Destinatario del pago** | A quién se le consignó | Contabilidad, al conciliar; la tabla no lo guarda | **Desconocido** en todas las filas con abono |

Un abono registrado no prueba quién lo recibió; por eso una fila con abonos queda `REVISION_CONTABLE` aunque su asignación esté confirmada.

**Precheck real (1-nov-2026), leído del archivo adjunto:** las OCHO filas objetivo (1, 79, 81, 82, 83, 85, 89, 107) salen `REVISION_CONTABLE` y el UPDATE no toca ninguna.
La 137 sale `EXCLUIDA` con **abono registrado de $139.000** (= total; el motivo del plan decía $39.000: corregido). La **135** (Yaqueline, ficha NULL) tiene abono registrado
de **$351.852,16** y se incorpora como asignación **confirmada** 135→37, `EXCLUIDA` por conciliación (solo lectura/documentación; no está en el UPDATE). Abonos registrados vs. total
calculado: 79 191.224/191.224 · 81 600.000/599.964 · 82 141.360/141.360 · 83 541.036/541.036 (2 abonos) · 85 140.180/140.180 (2 abonos) · 89 207.831/207.831 · 107 71.297/71.296,50 ·
137 139.000/139.000 · **1: 1.617.580 contra 1.260.903,68 (exceso de 356.676,32)**; el portal lo recorta a saldo 0 y no muestra el exceso.

### 9.3 Dónde se crean las dos líneas (causa raíz)

1. **Línea del recobro** — `convertir cotización` (migraciones 164/198, `insert into aliados_b2b`): el aliado se guarda como **texto** (`agencia_nombre` /
   `freelance_nombre`) y, **si vienen vacíos, cae a `ventas.asesor`** (el asesor interno); **sin `aliado_id`**. 222 solo la enlaza en la ruta sellada NETO.
2. **Línea de comisión** — `registrar_comision_b2b_manual` (205): para superadmin/gerencia/administración/operaciones **no comprueba si el contrato ya
   tiene filas** y acepta **cualquier** `p_aliado_id`. (`registrar_comision_b2b_reserva` y el rol `venta` sí rechazan duplicados.)
3. Una línea con el nombre de un interno y otra con la ficha elegida a mano conviven sin que nada las compare.

Corrección propuesta: migración **267** (sin correr; número 267: el primero libre tras la 266 de main; antes provisional 257). No reemplaza `convertir_cotizacion_a_contrato` (222 verifica su md5): un trigger de restricción diferido revisa, al final de la transacción, la línea con la forma del recobro de la 198 (sin ficha, recobro > 0, sin `base_explicita`, sin % ni valor fijo). Acredita el beneficiario contra la cotización de ORIGEN = `ventas.cotizacion_id` (única), nunca contra «la última cotización con ese número»: la cotización debe existir, llevar el número del contrato y estar convertida; su `aliado_id` debe ser del mismo tipo que la venta, no contradecir a `ventas.aliado_id` ni al nombre que se tecleó, y coincidir con la ficha si la 222 ya enlazó la fila (si no, `RECOBRO_ALIADO_DISCREPANTE`). Sin aliado en la cotización, solo vale el nombre tecleado si identifica UNA ficha del mismo tipo; `ventas.asesor` nunca acredita. Si nada lo acredita: `RECOBRO_SIN_BENEFICIARIO` y la conversión no se guarda. Hallazgo de la prueba con esquema completo: la 198 no guarda `tipo_asesor` ni los nombres en `ventas`, por eso el tipo y el nombre se leen del payload de la cotización. Se conservan los casos legítimos de varios beneficiarios (no hay regla «uno por contrato») y las comisiones internas. Límite: la comisión manual de la 205 no cambia; vigilar filas con `aliado_id is null`.

### 9.4 Portal tras la corrección

No requiere cambio de código: `contratosPorParticipacion` y `comisionesDelPortal` ya agrupan **por contrato** y por la ficha de la fila. Cuando las dos
líneas comparten ficha el asesor las ve como una sola participación (suma de ambas), y quien figuraba por error (Javier en 0519) deja de verla.
`pruebas/correccionAsesor65.react.ts` lo fija con los diez contratos (datos sintéticos): agrupación por asesor, antes/después de 0519, 0498 con la fila
sin ficha, y que lo interno (`liquidacion_comisiones`, `rentabilidad`) no se mezcla con el importe B2B.

### 9.5 Asignación confirmada y estado del plan

Fila → ficha destino confirmada por el dueño (la 137→37 y la 135→37 quedan EXCLUIDAS por conciliación, ver §10): **79→8, 81→33, 82→1, 83→1, 85→24, 89→28, 107→7, fila 1 de MIN-00-0498→8**; las filas 100 y 101 de MIN-00-0476 ya son de
Javier (8). El plan de lectura y el de corrección usan esa lista completa (`conciliacion_…_solo_lectura.sql`, `correccion_…_plan.sql`). **La corrección sigue bloqueada** (y hoy tendría efecto cero):
`contabilidad_concilio = false` en el bloque B y, además, las ocho filas listadas tienen abonos y ninguna está en `revision_contable_aprobada`; la 137 está excluida
(abono registrado de $139.000; la tabla de pagos no dice a quién se pagó). **La fila 135** (Yaqueline, 0519, ficha NULL, abono registrado de $351.852,16) figura ahora en el precheck
y en la conciliación como asignación **confirmada** 135→37 (dueño: «ambos siempre al asesor, es decir el de Yaqueline ambos son de ella») y `EXCLUIDA` por conciliación porque el destinatario de su abono de $351.852,16 no está conciliado; **no** está en el UPDATE ni en el postcheck, y la puerta contable
sigue cerrada. Mientras no se reincorpore, el postcheck dejaría 0519 en PENDIENTE (es lo esperado). Pasarla al UPDATE requiere conciliación contable y confirmación escrita del dueño.

### 9.6 Verificación de la 267 (esquema completo)

`supabase/scripts/test_267_recobro_beneficiario.sh <contenedor> [plantilla]` (plantilla = esquema 001-266 de `preparar_esquema_local.sh`). Gates que hacen fallar el script con `exit ≠ 0`:
G1 aplicar y reaplicar; G2 batería SQL con conversiones REALES de la 198 y las rutas PVP y NETO de la 222 (27 afirmaciones exactas, `ON_ERROR_STOP`, cero FALLO, `t216.res` coincide);
G3 COMMIT real (el trigger diferido falla al confirmar y no deja venta ni línea; con beneficiario acreditado confirma); G4 control negativo (sin la 267 el mismo gate rechaza);
G5 rollback y reaplicación. Cubre: nombre exacto y único, PVP sin aliado, nombre ambiguo, ficha de otro tipo, aliado explícito de la cotización, discrepancias de tipo/nombre/cotización
de origen, cotización señuelo posterior con otro aliado, comparativa PVP y NETO, y beneficiarios distintos cargados a propósito. Compara dinero, abonos, CxP y propietario de la venta con y sin la 267: idénticos.
La corrección histórica (`correccion_asesor_comision_65_plan.sql`) sigue **sin ejecutarse**: las nueve fichas destino están confirmadas, pero contabilidad debe conciliar antes los abonos.

---

## 10. Actualización (31-oct-2026): fila 137 fuera de toda corrección y cómo se ve MIN-00-0519 mientras tanto

- **Contabilidad confirmó que el abono de la fila 137 aún NO está conciliado**: el abono registrado es de **$139.000** (no $39.000) y el destinatario del pago sigue desconocido. La 137 salió del bloque B y del postcheck de `correccion_asesor_comision_65_plan.sql`
  (el UPDATE ya no la nombra, ni siquiera con la puerta abierta) y el precheck la devuelve como `EXCLUIDA`. Reincorporarla requiere conciliación contable + confirmación escrita del dueño.
  El precheck además lista (`REVISION_CONTABLE`) toda otra fila de los diez contratos que tenga abonos y no figure en la lista de correcciones.
- **Mientras la 137 siga atribuida a Javier (ficha 8), MIN-00-0519 se ve así** (comportamiento actual, probado en `pruebas/participacionEconomica65.react.ts`):
  - **Javier** la ve como **participación por comisión**, no como contrato propio: número, destino, fecha de salida (en Mis ventas), estado del contrato y **su** comisión = saldo de su fila,
    $139.000 − $139.000 = **$0**, estado «Pagada». **No** ve cliente, precio de venta, cartera, pagos, documentos ni enlace a cuenta de cobro.
  - **Yaqueline** conserva **MIN-00-0519 como contrato propio** (`ventas.aliado_id` = 37) pero su fila **135 tiene ficha NULL**: sin ficha y sin documento de la fila
    igual al de su ficha, el portal no se la atribuye, así que **no ve su comisión**, mientras Javier sí ve la participación. (Esta nota decía «con su fila 135, ficha 37»: falso.)
  - Nada cambia hasta que se ejecute la corrección de la 137, que sigue bloqueada.
- **La migración 267 y la corrección de datos son operaciones distintas.** La 267 (PR de esquema aparte) solo evita nuevas atribuciones erróneas al convertir cotizaciones; no toca las nueve filas históricas.
- La velocidad del portal (consultas en paralelo, esqueleto de carga, menú con estado pendiente) **no está en #415**: queda preservada aparte para su propio PR.

---

## 11. Exposición real si #415 se fusiona hoy (precheck real, 1-nov-2026) — **diagnóstico; nada aplicado**

**Qué hace #415 por sí solo:** nada sobre datos, y **no lleva exclusiones fijas por id en el código** (se verificó con `grep`). La corrección está bloqueada (§9.5) y las filas siguen con
la ficha equivocada. El portal, con el código ya presente, muestra «Participación por comisión» a **quien tenga la ficha equivocada** en una fila positiva y tenga cuenta vinculada a esa ficha.

**Exposición, por fila** (ficha actual leída de la columna `fila … ficha X` del precheck; el saldo mostrado es total − abonos registrados, recortado a ≥ 0):

| Fila | Contrato | Ficha actual → asignación | Abono registrado vs. total | Qué vería el portal |
|---|---|---|---|---|
| 81 | 0422 | 8 (Javier) → 33 (Paola) | 600.000 / 599.964 | Javier: participación, saldo $0, «Pagada» |
| 82 | 0432 | 8 → 1 (Katherine) | 141.360 / 141.360 | ídem |
| 83 | 0433 | 8 → 1 | 541.036 / 541.036 | ídem |
| 85 | 0439 | 8 → 24 (Juliana) | 140.180 / 140.180 | ídem |
| 89 | 0463 | 8 → 28 (Marcela) | 207.831 / 207.831 | ídem |
| 107 | 0484 | 8 → 7 (Sebastián) | 71.297 / 71.296,50 | ídem |
| 137 | 0519 | 8 → 37 (Yaqueline) | 139.000 / 139.000 | ídem (EXCLUIDA) |
| 79 | 0462 | 3 (Tatiana Velásquez) → 8 (Javier) | 191.224 / 191.224 | Ficha 3: participación en un contrato de Javier, saldo $0, «Pagada» |
| 1 | 0498 | NULL → 8 | **1.617.580 / 1.260.903,68** | No se expone a nadie (sin ficha); el exceso de 356.676,32 no se ve |
| 135 | 0519 | NULL → 37 (confirmada; EXCLUIDA por conciliación) | 351.852,16 / (total no incluido en el precheck) | No se expone; **Yaqueline no ve su propia comisión** (faltante, no fuga) |

Consecuencia: **Javier vería participación en siete contratos que no son suyos** (0422, 0432, 0433, 0439, 0463, 0484, 0519) y la ficha 3 en uno (0462), siempre que esas fichas tengan cuenta de portal
(no consta en el precheck). En todos, cliente, PVP, cartera, pagos del contrato, documentos y cuentas de cobro **no** se ven (probado); sí se ve contrato, agencia, destino, salida y estado.
El servidor además carga, sin pintarla, la fila completa de `ventas` (cliente, `precio_venta`, `share_token`).

**Lo que el portal afirma de más:** «Pagada» sale de los **abonos registrados**, no de un destinatario verificado. Como el destinatario del pago es desconocido, mostrarlo a quien figura hoy
afirma algo que Contabilidad aún no ha conciliado.

**Medidas posibles antes de fusionar (ninguna aplicada; #415 no incorpora ninguna):**
1. **Fusionar #415 después** de que Contabilidad concilie y se ejecute la corrección (la salida más limpia: cero cambios de visibilidad).
2. **Marca de revisión como dato** (columna en `aliados_b2b` que `contratosPorParticipacion` y `comisionesDelPortal` respeten): requiere migración con el siguiente número libre y su aprobación.
   Es la forma correcta de ocultar sin listas de ids en el código; se retira al cerrar la conciliación.
La lista fija de ids en el código se **descartó** por indicación expresa.
