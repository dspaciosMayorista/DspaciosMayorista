# Contabilidad · Staging de importación DIAN — diseño técnico

> Índice: [`README.md`](./README.md) · Parser y campos confirmados:
> [`contabilidad-dian.md`](./contabilidad-dian.md) · Motor contable:
> [`contabilidad.md`](./contabilidad.md) · Diseño del módulo completo:
> [`../futuro/modulo-contable-independiente.md`](../futuro/modulo-contable-independiente.md)

Estado (2026-10-17): **migración 204 escrita y probada solo en local; NO
aplicada en ningún ambiente.** Vive en el worktree aislado de #43
(`codex/43-contable-staging-dian`, sobre `main` 8987932e) junto con su preflight,
postcheck, rollback y pruebas. Sin UI. El resto de este documento especifica el
diseño; la sección siguiente resume la auditoría y las decisiones vigentes.

### Auditoría y decisiones del dueño (2026-10-17)

Probado en Postgres local con el esquema real de `main` (001-213, incluida la
211) más la 204: aplica, es idempotente, postcheck sin fallas, dedupe 44/0,
RLS 71/0 y el rollback deja 0 tablas, 0 funciones y 0 policies propias.

Hallazgos corregidos en el paquete:

- **Lectura abierta de más (bloqueante).** `dian_staging_puede_ver` delegaba en
  `puede_ver_tenant`: cualquier rol con fila en `usuarios` (incluidos `venta`,
  `operaciones`, `control_vuelo` y los externos `agencia`/`freelance`/
  `cliente_final`) leía por la API facturas de proveedores con NIT, razón
  social y totales. Ahora solo el área contable y la administración (§6.2).
- **Rollback incompleto.** El `drop function` de `dian_registrar_documento`
  tenía 21 argumentos y la función 25: quedaba viva tras el rollback.
- **Scripts desfasados frente a `main`.** Preflight y pruebas asumían
  `proveedores.nit`/`proveedores.tenant` (movidos a `proveedores_datos_sensibles`
  en 189/191) y que el alta de prueba en `usuarios` no chocaba con el
  aprovisionamiento automático de `handle_new_user` (193). La migración no
  dependía de eso; los scripts sí.

Decisiones del dueño:

1. **Roles:** se confirman `contador`, `revisor_fiscal` y `admin_contable`
   (irreversibles en el enum).
2. **Ver el staging:** área contable y `administracion` de su agencia;
   `superadmin` y `gerencia`, las dos agencias.
3. **Importar:** los tres roles contables y `administracion` de su agencia, más
   `superadmin`.
4. **Catálogos para preparar:** los tres roles contables leen `proveedores`,
   `proveedores_datos_sensibles` **completa (datos bancarios incluidos: riesgo
   aceptado)** y `puc_cuentas`, de su agencia, solo lectura (§16 de la
   migración). La alternativa recomendada, una búsqueda por NIT sin datos
   bancarios, se descartó.

Sigue abierto: D3a (hoy el `contador` no aprueba), la numeración (la 204 queda
fuera de orden respecto de 205-213: aplicación manual, nunca `db push`), el
lado de la app de los roles (`propuesta-roles-contables.md`, superficies
compartidas sin reserva) y la conciliación histórica del preflight 208.

El parser que alimenta este diseño está validado contra 26 documentos XML reales
y 2 reportes de la DIAN (503 filas). Ver
[`contabilidad-dian.md`](./contabilidad-dian.md#7-campos-confirmados-contra-documentos-reales).

---

## 1. Alcance: qué es y qué no es

| Es | No es |
|---|---|
| Un **escritorio de trabajo**: documentos importados, normalizados y pendientes de que alguien los mire | Una fuente de verdad contable |
| Un **registro de auditoría** de qué se importó, de dónde y quién lo tocó | Un libro contable |
| El lugar donde se resuelve proveedor, cuenta y periodo **antes** de contabilizar | El lugar donde se contabiliza |
| Un idempotente por diseño (el que se carga dos veces no se duplica) | El reemplazo del motor de asientos |

**El staging no toca `asientos_contables`.** Ninguna escritura de esta fase crea,
modifica ni borra un asiento. Concretamente:

- **No llama `postearAsiento`, `reemplazarAsiento` ni `reversarYRegistrar`.**
  Son funciones de `lib/contabilidad/asientos.ts`, que este diseño no toca.
- **No hace backfill.** Reconstruir lo histórico es otra herramienta, con otros
  requisitos (§9.5).
- **No inventa el asiento "equivalente"** que ya existe para una compra
  registrada en `cuentas_por_pagar` (migración 172: el asiento es una
  *proyección* de la CxP, y su ausencia es detectable comparando
  `cuentas_por_pagar` contra `asientos_contables` con `origen='cxp'`).
  El staging es una **fuente adicional**, no un sustituto.

## 2. Principios de diseño

1. **Nada se descarta en silencio.** Un documento que no se puede leer queda en
   la tabla con su motivo, o en la lista de rechazados del lote. Nunca se pierde
   una fila.
2. **El staging guarda lo declarado, no lo interpretado.** El documento es la
   fuente; el PUC, el tipo de gasto y el periodo asignado son **decisiones
   humanas** y viven en columnas separadas de las del emisor.
3. **El deduplicado lo hace la base de datos**, no solo el código: el parser
   propone una clave (§4) y un índice único es el que impide el duplicado.
4. **Un documento importado no es un documento aprobado.** El estado por defecto
   es `pendiente_revision`, nunca `aprobado`.
5. **Nada se borra.** Un documento rechazado se queda con su estado y su motivo.
6. **Preparar, aprobar, devolver y cerrar son actos distintos** (§5.1). Cada uno
   deja quién lo hizo, con qué rol y en qué momento. Que la misma persona
   pueda preparar y aprobar es una *política* del tenant, no un hecho del código,
   y por eso queda registrado en la bitácora (§8.1).
7. **No se guardan datos personales que no hacen falta** (§9.6). Por defecto se
   conserva el hash del XML y los campos normalizados, no el XML crudo.

## 3. Tablas propuestas

Siete tablas. Una es la de identidad del documento (que es la que hace posible
el deduplicado), cinco son de datos importados y una es la bitácora de revisión.

```
lote_importacion_dian            1 ──── * documento_dian_staging
                                        │        ├── 1 documento_dian_identidad   (clave única por tenant)
                                        │        ├── * documento_dian_linea_staging
                                        │        ├── * documento_dian_impuesto_staging
                                        │        ├── * documento_dian_retencion_staging
                                        │        ├── * documento_dian_forma_pago_staging   (opcional)
                                        │        └── * documento_dian_resolucion
                                        └────────────── * ocurre en n documentos distintos
```

### 3.1 `lote_importacion_dian` — una fila por importación

Una importación = un archivo XML suelto, un sobre `AttachedDocument`, un `.xlsx`
de ventas o un `.xlsx` de compras. Si se suben 13 facturas en una carpeta, son 13
lotes; si se pega un Excel, un lote.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `tenant` | text not null | `check in ('mayorista','minorista')`, convención del repo |
| `fuente` | text not null | `check in ('xml_directo','attached_document','excel_ventas','excel_compras')` |
| `nombre_archivo` | text | tal como lo llama el usuario; null si fue pegado |
| `hash_contenido` | text not null | sha256 del texto recibido, para detectar la misma carga |
| `periodo_desde` | text not null | `YYYY-MM`; el **corte histórico que elige el usuario** al abrir el proceso: el mes más antiguo que se importa. No se fija por defecto (§8.1, D8) |
| `periodo_hasta` | text not null | `YYYY-MM`; hasta qué mes llega el corte, con `periodo_desde <= periodo_hasta` |
| `motivo` | text not null | por qué se abre este proceso: "migración histórica 2026", "cierre de enero", "carga mensual" |
| `total_filas` | integer not null | filas leídas |
| `documentos_ok` | integer not null | documentos aceptados |
| `documentos_rechazados` | integer not null | filas que no se pudieron leer |
| `problemas` | jsonb not null | códigos de problema del lote, tal como los devuelve el parser |
| `cabeceras_originales` | jsonb | los encabezados leídos (solo Excel): evidencia de cómo se mapeó |
| `columnas_detectadas` | jsonb | el mapa `campo → índice` que el parser resolvió (solo Excel) |
| `estado` | text not null | `check in ('en_proceso','procesado','con_error','descartado')` |
| `mensaje_error` | text | |
| `importado_por` | uuid | `references usuarios(id) on delete set null` |
| `creado_en` / `actualizado_en` | timestamptz | |

**Por qué el hash del contenido y no solo el nombre del archivo:** el usuario
puede volver a subir el mismo archivo con otro nombre; con el hash, el segundo
lote es detectable como el mismo. El `unique` del hash ya está **decidido**
(§4.8): el mismo contenido en el mismo `(tenant, fuente, periodo)` no crea
documentos nuevos.

**El periodo es del usuario, no del sistema.** Enero de 2026 no se quema por
inercia: cada proceso se abre con un rango que alguien elige a propósito
(§8.1, D8). El `periodo` del *documento* (§7.6) sigue derivándose de su
fecha — son dos cosas distintas.

### 3.2 `documento_dian_identidad` — una fila por documento lógico

Es la tabla que hace que el deduplicado sea determinista cuando hay dos
importaciones simultáneas; el razonamiento completo está en §4.3. Se describe
aquí porque sin ella el catálogo de §3 queda incompleto.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `tenant` | text not null | `check in ('mayorista','minorista')` |
| `clave` | text not null | la clave que propone el parser (§4.1) |
| `clave_base` | text not null | `cufecude` \| `proveedor_tipo_numero_fecha` |
| `total_referencia` | numeric(15,2) not null | el **primer** total declarado que se vio. Es contra este valor, y no contra el último, contra el que se decide si un reenvío es `duplicado` o `discrepante` |
| `ocurrencias` | integer not null | cuántos documentos se han deserializado con esta clave, incluidos los duplicados |
| `primera_vez_en` | timestamptz not null | cuándo apareció por primera vez |
| `creado_en` / `actualizado_en` | timestamptz | |

`unique (tenant, clave)` — es el índice que serializa a los importadores
concurrentes (§4.6). `documento_dian_staging` la referencia con
`documento_dian_identidad_id` como índice no único a propósito: un índice único
por identidad haría imposible registrar el `discrepante` (§4.6).

### 3.3 `documento_dian_staging` — una fila por documento

Es la tabla central. Las columnas se agrupan por quién las llena: el parser, la
persona o el futuro proceso de contabilización.

**Identidad (la llena el parser)**

| Columna | Tipo | Origen en el parser |
|---|---|---|
| `id` | bigserial PK | |
| `lote_id` | bigint not null → `lote_importacion_dian` | |
| `tenant` | text not null | del contexto de la importación |
| `periodo` | text not null | derivado de `fecha` (`YYYY-MM`); §7.6 |
| `fuente` | text not null | del lote |
| `clave` | text not null | `claveDocumento().clave` — el dedupe (§4) |
| `clave_base` | text not null | `cufecude` \| `proveedor_tipo_numero_fecha` |
| `cufe` | text | `cufe` |
| `cude` | text | `cude` |
| `tipo_documento` | text not null | `factura` \| `nota_credito` \| `nota_debito` \| `otro`; el `check` admite `'otro'` para documentos sin clasificar (§8.2, D12) |
| `tipo_documento_original` | text | el texto crudo de la columna "tipo" del archivo, leído en la carga. Es lo único que permite distinguir una factura de un documento soporte, porque el parser los iguala a `factura` (§8.2, D12) |
| `numero` | text | `numero` (con prefijo si el Excel los trae separados) |
| `fecha` | date not null | `fecha` |
| `proveedor_nit` | text | `proveedor.nit` — null si es cédula |
| `proveedor_dv` | text | `proveedor.dv` |
| `proveedor_identificacion` | text | `proveedor.identificacion` (NIT o cédula) |
| `proveedor_tipo_ident` | text | `proveedor.tipoIdentificacion` |
| `proveedor_nombre` | text | `proveedor.nombre` |
| `sujeto_nit` / `sujeto_identificacion` / `sujeto_nombre` | text | `sujeto.*`; null en la vía Excel |
| `moneda` | text not null | `moneda` |
| `trm` | numeric | `trm` |
| `divisa_origen` / `divisa_destino` / `divisa_fecha` / `divisa_tasa` | text/date/numeric | `divisa.*` |

**Importes (los llena el parser)**

| Columna | Tipo | Origen |
|---|---|---|
| `subtotal` | numeric(15,2) not null | `aritmetica.subtotal` = `LineExtensionAmount` |
| `base_gravable` | numeric(15,2) | `aritmetica.baseGravable` = `TaxExclusiveAmount` |
| `descuentos` | numeric(15,2) not null | `AllowanceTotalAmount` |
| `cargos` | numeric(15,2) not null | `ChargeTotalAmount` |
| `anticipos` | numeric(15,2) not null | `PrepaidAmount` |
| `redondeo` | numeric(15,2) not null | `PayableRoundingAmount` |
| `impuestos_total` | numeric(15,2) not null | suma de `TaxSubtotal.TaxAmount` |
| `retenciones_total` | numeric(15,2) not null | suma de las retenciones declaradas (hoy siempre 0 en los documentos reales). Se guarda plana para filtrar y ordenar; el detalle vive en `documento_dian_retencion_staging`. El staging **no** la resta de ningún total (§8.2, D2) |
| `total_declarado` | numeric(15,2) not null | `PayableAmount` |
| `total_calculado` | numeric(15,2) not null | fórmula de la DIAN, **sin retenciones** (ver §7.4) |
| `diferencia` | numeric(15,2) not null | `total_declarado − total_calculado`; > 0.01 ⇒ aviso |
| `diferencia_tolerada` | boolean not null | si `abs(diferencia) <= 0.01` |

**Fuente (la llena el parser)**

| Columna | Tipo | Notas |
|---|---|---|
| `xml_hash` | text | sha256 del XML; detecta el mismo documento subido dos veces. **Es lo que reemplaza al XML crudo** |
| `xml_original` | — | **NO se crea.** D10 (§8.1, §9.6) decidió no guardar el XML completo por defecto. Queda reservada, sin columna, hasta que exista D10a |
| `fila_origen` | integer | nº de fila en el Excel (null en XML) |
| `celdas_origen` | jsonb | las celdas crudas de esa fila, para poder auditarla sin el archivo |
| `originales` | jsonb | `originales` del parser: `id`, `uuid`, `referenciaInterna`, otros identificadores |
| `software_emisor` | text | `software` |

**Revisión (la llenan las personas)**

| Columna | Tipo | Notas |
|---|---|---|
| `estado` | text not null | ver §5.2 |
| `proveedor_id` | bigint → `proveedores(id)` | la resolución humana del emisor |
| `proveedor_cruce_estado` | text | `check in ('coincide','sin_nit','nit_no_cruzable','varios_candidatos','no_resuelto')`. El staging **nunca** inserta en `proveedores` (§8.2, D4 y D5) |
| `cuenta_puc` | bigint → `puc_cuentas(id)` | **la clasificación**, no el PUC del sistema |
| `cuenta_puc_origen` | text | `global` \| `excepcion_tenant` (§7.3) |
| `tipo_gasto` | text | certificación / deducible / no deducible — decisión humana |
| `periodo_asignado` | text | si se difiere del `periodo` natural (p. ej. periodo de cierre) |
| `documento_relacionado_id` | bigint → `documento_dian_staging(id)` | para notas crédito/débito y sus facturas |
| `duplicado_de` | bigint → `documento_dian_staging(id)` | a quién apunta cuando `estado = 'duplicado'` |
| `discrepante_de` | bigint → `documento_dian_staging(id)` | a quién apunta cuando `estado = 'discrepante'` (§4.4) |
| `cuenta_pagadora_id` | bigint → `cuentas_por_pagar(id)` | **futuro**: el vínculo con la CxP cuando exista |

**Autoría y tiempos — los cuatro actos**

Cada uno de los cuatro actos de §5.1 deja **tres** columnas: quién, con qué rol
y cuándo. El rol se guarda siempre, también cuando el usuario tiene uno solo,
porque es lo que después demuestra que la excepción de política se aplicó.

| Acto | Usuario | Rol | Tiempo |
|---|---|---|---|
| Preparar | `preparado_por` | `preparado_rol` | `preparado_en` |
| Aprobar | `aprobado_por` | `aprobado_rol` | `aprobado_en` |
| Devolver | `devuelto_por` | `devuelto_rol` | `devuelto_en` |
| Cerrar | `cerrado_por` | `cerrado_rol` | `cerrado_en` |

Todos `uuid` + `text` + `timestamptz`, convención del repo, y `null` mientras el
acto no ocurra. Más `creado_por`, `creado_en` y `actualizado_en`. Un documento
puede volver a `preparado` varias veces: cada intento anterior queda en
`documento_dian_resolucion`, no en estas columnas, que guardan el último acto.

**Futuro, hoy siempre null**

`asiento_id bigint → asientos_contables(id)` y `contabilizado_por`,
`contabilizado_en`. Se dejan columnas preparadas para que la transición sea
explícita, pero **no se crean todavía** (§9).

### 3.4 `documento_dian_linea_staging` — solo desde XML

El Excel de la DIAN no trae líneas: no se inventa el detalle.

| Columna | Tipo |
|---|---|
| `id` bigserial PK, `documento_id` bigint → staging | |
| `numero` integer | `numero` (o el índice si el emisor no lo manda) |
| `descripcion` text | |
| `cantidad` / `precio_unitario` / `base` / `descuento` | numeric |
| `cuenta_contable_emisor` | text — la cuenta del **proveedor**, no el PUC de D'spacios |
| `impuestos` | jsonb — el array de la línea, tal cual |

### 3.5 `documento_dian_impuesto_staging`

| Columna | Tipo | Nota |
|---|---|---|
| `documento_id` | bigint | |
| `codigo` | text | `TaxScheme/ID`: "01" IVA, "03" IC, "04" INC… |
| `nombre` | text | |
| `tasa` | numeric(7,4) | porcentaje tal como lo declara (19.00) |
| `base` / `valor` | numeric(15,2) | |
| `origen` | text | `tax_subtotal` \| `tax_total_plano` — las dos formas que existen |

`origen` importa: en los documentos reales **todos** los impuestos vienen como
`TaxSubtotal`, y un segundo bloque con código "04" (INC) también suma al total.
Guardar de qué forma se leyó permite revisar después sin volver al XML.

### 3.6 `documento_dian_retencion_staging`

| Columna | Tipo | Nota |
|---|---|---|
| `documento_id` | bigint | |
| `codigo` | text | `ReteFuente`, `ReteIva`, `ReteIca`, `TotalRetenciones`, `ReteFueCop`… |
| `nombre` / `campo_origen` | text | la etiqueta exacta de la que salió |
| `estructura` | text | `ubl` \| `totales_cop` \| `custom_field` |
| `base` / `valor` | numeric(15,2) | |

Las tres estructuras están confirmadas en archivos reales, pero **ningún
documento real trae importe distinto de cero** (§7.4). La tabla se crea igual:
así el día que llegue una factura con retención real, el dato ya tiene dónde
caer.

### 3.7 `documento_dian_forma_pago_staging` — opcional

`documento_id`, `codigo`, `fecha`, `monto`. Existe porque en el reporte de
compras la columna "Medios De Pago" decide el beneficio del 1 % de las compras,
que es un dato de retención, no de factura. Si no se va a usar, puede quedar como
`jsonb` en la tabla central.

### 3.8 `documento_dian_resolucion` — bitácora de revisión

Append-only: **no** se actualiza ni se borra nunca.

| Columna | Tipo |
|---|---|
| `id` bigserial PK, `documento_id` bigint | |
| `estado_anterior` / `estado_nuevo` | text |
| `actor_id` uuid, `actor_email` | quién |
| `campo` | text — qué cambió: `estado`, `proveedor_id`, `cuenta_puc`, `periodo_asignado`… |
| `valor_anterior` / `valor_nuevo` | jsonb (acepta texto, número o null) |
| `motivo` | text — obligatorio en `rechazado` y en `discrepante` |
| `creado_en` | timestamptz |

Sin esta tabla, la pregunta "quién aprobó esto y por qué" no tiene respuesta, y
eso es justamente lo que el módulo promete.

## 4. Clave, deduplicado, idempotencia y flujo transaccional

> Todo lo de esta sección es **especificación en prosa**: no hay SQL. Cuando se
> apruebe una migración, esto es lo que la función de registro debe cumplir.
> El repo ya tiene el patrón equivalente en `registrar_pago_previo`
> (migración 164), que es la referencia a seguir.

### 4.1 La clave que propone el parser (ya implementada y probada)

| Base | Formato | Cuándo |
|---|---|---|
| `cufecude` | `CUFE:<id en mayúsculas, sin nada más>` | Cuando el documento trae CUFE/CUDE de ≥ 40 caracteres (los reales miden **96**) |
| `proveedor_tipo_numero_fecha` | `REF:<nit o identificación>:<tipo>:<número sin guiones>:<YYYY-MM-DD>` | Cuando no hay CUFE: es el caso normal del Excel que no trae esa columna |

La clave y el `total_declarado` los calcula **el parser, en la aplicación**, y la
función de registro los recibe como parámetros. La función **no los recalcula**:
si las dos sides calcularan la clave, bastaría un cambio de normalización para
que el deduplicado dejara de funcionar en silencio.

### 4.2 La regla de decisión

Un documento pertenece a una **identidad** (`tenant` + `clave`). Contra esa
identidad hay exactamente tres desenlaces:

| Entrada | Identidad | Total | Resultado |
|---|---|---|---|
| Documento que no se había visto | nueva | — | se guarda, `estado='importado'` → `pendiente_revision` |
| Ya existe y el total **coincide** (±0.01) | existente | igual | `estado='duplicado'`, con `duplicado_de` |
| Ya existe y el total **difiere** | existente | distinto | `estado='discrepante'`, con `discrepante_de` |

La tolerancia de ±0.01 es la misma que usa `dedup.ts` y que ya cuadra en los 26
documentos reales.

### 4.3 Por qué hay que separar la identidad de las ocurrencias

Un detalle que cambia la semántica y que conviene no pasar por alto:

**Si la deduplicación dependiera solo de un índice único sobre
`(tenant, clave, total_declarado)`, la detección de `discrepante` sería
frágil bajo concurrencia.** Ese índice permite que existan a la vez dos filas con
la misma `clave` y distinto `total` — que es justo lo que se quiere conservar —
pero nada impide que **ambas** se inserten como si fueran nuevas. Para saber que
hay una discrepancia hay que *mirar* las otras filas de la misma clave, y ese
"mirar y luego insertar" tiene una ventana: dos importaciones simultáneas del
mismo CUFE con totales distintos pueden no verse entre sí y las dos quedar como
`importado`.

La propuesta que cierra esa ventana es **una tabla de identidad aparte**:

- `documento_dian_identidad`: una fila por `(tenant, clave)`, con el primer
  `total_declarado` que se vio, cuántas ocurrencias lleva y la fecha de la
  primera.
- `documento_dian_staging`: una fila **por documento importado**, cada una
  apuntando a su identidad.

Entonces:

| Entrada | Qué hace la función |
|---|---|
| Documento con clave nueva | Inserta la identidad y el documento. El índice único de la identidad **serializa** a los concurrentes |
| Mismo CUFE, mismo total | La identidad ya existe y su total coincide → `duplicado` |
| Mismo CUFE, otro total | La identidad ya existe y su total **no** coincide → `discrepante` |

Solo una gana la carrera por la identidad, y esa ganadora es la que decide el
total de referencia. Consecuencia: la clasificación es **determinista** aunque
haya dos importaciones simultáneas, no "la primera que llegó".

### 4.4 Flujo transaccional, caso por caso

**Caso 1 — documento normal.** Todo dentro de una única transacción:

1. Se verifica que el lote existe y está en `en_proceso`.
2. Se intenta registrar la identidad `(tenant, clave)`.
3. Si se pudo (identidad nueva): se inserta el documento con
   `estado='importado'` y se insertan sus hijos (líneas, impuestos, retenciones,
   formas de pago). Todos o ninguno.
4. Se devuelve el identificador del documento y `resultado = 'nuevo'`.

**Caso 2 — conflicto exacto (misma clave, mismo total).** El documento ya está:

1. Se lee la identidad; existe.
2. Se compara su `total_declarado` con el de esta importación.
3. Si coincide (±0.01): se insera **una fila de evidencia** con
   `estado='duplicado'`, `duplicado_de` → el primer documento, su propio
   `lote_id`, su `xml_hash` / `fila_origen` / `celdas_origen`, y se escribe una
   entrada en `documento_dian_resolucion` (`estado_anterior='nuevo'`,
   `estado_nuevo='duplicado'`, `campo='estado'`).
4. **No** se insertan los hijos (§4.7).
5. `resultado = 'duplicado'` con el identificador del original.

El original **no se toca**: ni su estado, ni sus hijos, ni su `preparado_por` ni su
`aprobado_por`. Un duplicado nunca modifica lo que ya estaba.

**Caso 3 — mismo CUFE, total distinto.** La identidad existe y no coincide:

1. Se inserta la fila con `estado='discrepante'` y `discrepante_de` → el
   documento original. Se conservan **los hijos**: aquí el detalle importa,
   porque lo que hay que mirar es *en qué se diferencian* los dos documentos.
2. Se escribe la entrada en `documento_dian_resolucion` con `motivo` explicando
   la diferencia de importe.
3. `resultado = 'discrepante'`.

**Ninguno de los tres resultados es un error.** La función devuelve un resultado,
no una excepción: un reenvío es un hecho esperado, no una falla.

**Caso 4 — documento en `rechazado` o `contabilizado`.** Si la identidad ya
existe y su documento está en cualquiera de esos dos estados, el resultado es
`duplicado` igual que en el caso 2. La diferencia es de política, no de
mecánica: el documento sigue conciliado o sigue descartado.

**Caso 5 — dos lotes simultáneos con el mismo documento.** Los dos invocan la
misma función. El índice único de la identidad hace que **uno** gane; el otro
recibe la violación, lee la identidad ya creada y cae al caso 2 o al 3 según el
total. Es el motivo por el que la clasificación tiene que vivir **dentro** de la
función y no en el código llamador (§4.5).

**Detalle de PostgreSQL que condiciona el diseño.** Una violación de unicidad
aborta la transacción en curso. Si el "intentar insertar, y si falla registrar
el duplicado" se hiciera con dos sentencias sueltas en la misma transacción, la
transacción quedaría abortada y **no se podría continuar**. Por eso la función
debe envolver su cuerpo en un bloque PL/pgSQL con manejador de excepción: ese
bloque abre una subtransacción, la sentencia fallida se deshace sola y la
función sigue. Es exactamente lo que hace `registrar_pago_previo` con
`exception when unique_violation`, salvo que allí la violación se traduce en un error
al llamador y aquí se traduce en una fila de duplicado.

### 4.5 Qué debe hacer la futura función de registro

Contrato, en prosa. Un solo punto de entrada por documento (no un insert por
lote), porque el manejador de excepción necesita su propio ámbito:

1. **Derivar el `tenant` del servidor**, no del parámetro. Si el tenant viaja
   como argumento, un llamador podría escribir en el tenant de otra agencia. La
   función debe leerlo del contexto de la petición, igual que el resto del
   motor contable.
2. Comprobar que el lote existe, es del mismo tenant y está en `en_proceso`.
3. Intentar registrar la identidad `(tenant, clave)` con el `total_declarado`
   recibido.
4. Según se haya podido o no:
   - **no se pudo** → leer la identidad y comparar el total con el recibido:
     si coincide, insertar `duplicado` más su bitácora; si no, insertar
     `discrepante` más su bitácora con el motivo de la diferencia;
   - **se pudo** → insertar el documento en `importado` y sus hijos.
5. Incrementar el contador de ocurrencias de la identidad.
6. **Devolver** un resultado con el desenlace (`nuevo` | `duplicado` |
   `discrepante`), el identificador del documento insertado y el identificador
   del documento original cuando aplique. La UI necesita los tres.
7. Nunca borrar, nunca modificar un documento que ya existía, y nunca lanzar
   una excepción por un reenvío.

Una función por documento tiene un coste: un archivo con 400 filas son 400
llamadas. A cambio, un fallo a mitad de un archivo no tira el trabajo ya hecho
y cada documento queda con su resultado. Es el mismo criterio que ya usa el
resto del sistema (ver `registrar_pago_previo` y los commentarios de la
migración 172 sobre por qué el posteo es *best-effort* y reintentable).

### 4.6 Índices únicos y parciales que exige esa semántica

| Índice | Tipo | Para qué |
|---|---|---|
| `(tenant, clave)` en `documento_dian_identidad` | **único**, no parcial | Serializa a importadores concurrentes y hace determinista la clasificación (§4.3) |
| `(tenant, clave, total_declarado)` en `documento_dian_staging`, filtrando `estado <> 'duplicado'` | **único parcial** | Evita que un documento con el mismo CUFE y el mismo total quede registrado dos veces como vigente |
| `documento_dian_staging.documento_dian_identidad_id` | btree | Une cada ocurrencia con su identidad |
| `(tenant, fuente, periodo_desde, hash_contenido)` en `lote_importacion_dian` | **único** | Detecta la reimportación del mismo archivo en el mismo corte (§4.8). El periodo entra a propósito: el mismo archivo cargado para un corte nuevo **sí** se puede volver a subir |

**Dos detalles de implementación que parecen detalles y no lo son.**

1. El índice de dedupe se crea con `create unique index`, **no** como
   `constraint unique` dentro de `create table`. Un índice parcial necesita
   `where`, y Postgres rechaza un `where` dentro de la definición de un
   constraint. Esto se confirmó ejecutando: la migración fallaba en la línea del
   constraint.
2. Los helpers de §6.2 devuelven `coalesce(..., false)`, no el predicado crudo.
   `mi_rol()` devuelve `NULL` cuando no hay usuario activo, y `NULL in (...)` es
   `NULL`. Con un predicado `NULL`, el guard `if not dian_staging_puede_importar(...)`
   **no se dispara**, porque `not NULL` tampoco es verdadero: un llamador sin
   sesión pasaba el control de permisos. En las policies un `NULL` ya deniega,
   pero en plpgsql un `NULL` se abre. También confirmado ejecutando.

**Un índice que deliberadamente NO existe.** No hay ningún índice único sobre
`documento_dian_identidad_id` en `documento_dian_staging`. Un
`unique (identidad_id) where estado <> 'duplicado'` parecería sensato —"una
ocurrencia vigente por identidad"— pero haría **imposible guardar el
discrepante**: el original ya ocupa esa fila del índice, así que una segunda
fila con `estado <> 'duplicado'` no entraría. El dedupe lo hace la clave, no la
identidad: `unique (tenant, clave, total_declarado) where estado <> 'duplicado'`
ya cubre los tres casos por sí solo, porque el duplicado queda excluido del
índice, el discrepante es otra entrada por tener otro total, y dos
importaciones simultáneas de un documento nuevo chocan en la entrada original.

Sobre el filtro `estado <> 'duplicado'` en el segundo y el cuarto: el duplicado es
la única clase que **debe** poder repetirse, porque su propósito es dejar
constancia. Si se pusiera el filtro en `estado IN ('aprobado','contabilizado')`
en vez de "distinto de duplicado", un documento `rechazado` podría duplicarse sin
aviso; y si el filtro fuera `estado = 'importado'`, dos importaciones simultáneas
de un documento nuevo pasarían las dos.

**Un caso límite que hay que decidir con nombre:** el reporte real de compras
tiene **una fila con `total_declarado = 0`**. `total_declarado` es parte de la
clave de unicidad, así que dos documentos con total 0 y distinta clave no chocan
(la clave también distingue el CUFE), pero dos documentos con total 0, la misma
clave base `REF:` y el mismo CUFE ausente **sí** se tratarían como duplicado. Es
el comportamiento correcto, pero conviene que la UI muestre los documentos con
total 0 como "revisar" y no como "conciliado".

### 4.7 Qué no se guarda en un reenvío, y por qué

En el caso `duplicado` **no** se insertan líneas, impuestos ni retenciones. La
razón: la fila del duplicado es la **evidencia del reenvío**, y la evidencia es
"este documento volvió a llegar, con este hash, en este lote". Copiar el detalle
dentro del documento original lo duplicaría sin agregar información: el
contenido es idéntico por definición (misma clave, mismo total) y sigue
disponible en el documento original.

La excepción es `discrepante`: ahí **sí** se guardan los hijos, porque lo que hay
que mirar es precisamente en qué se diferencian.

### 4.8 Reimportación del mismo archivo (D6 resuelta: opción A)

**Decidido.** Si el `hash_contenido` ya existe para el mismo
`(tenant, fuente, periodo)`, la importación **no crea documentos**.

Qué hace la función de carga del lote:

1. Se calcula el hash del contenido recibido.
2. Se busca un lote del mismo `(tenant, fuente, periodo)` con ese hash.
3. Si existe: **no** se inserta ningún documento y se devuelve una
   advertencia con el `lote_anterior_id`, su estado y su fecha. La UI la
   muestra como "este archivo ya se importó el &lt;fecha&gt; (lote #N)".

| | |
|---|---|
| Qué **no** hace | No crea documentos, no crea un lote con documentos, no reescribe el lote previo, no borra nada |
| Qué **sí** hace | Devuelve `lote_anterior_id`; deja el lote previo y sus documentos intactos, con su estado y su bitácora |
| **Si el negocio quiere rastro en la lista de lotes** | La alternativa aceptada es crear un lote `descartado`, vacío de documentos, con `lote_anterior_id` apuntando al previo. Se prefiere la advertencia: un lote que no importó nada no es un lote |

**El deduplicado documento-a-documento (§4.4) sigue existiendo y sigue siendo
necesario, pero para otra causa.** Ya no cubre "el usuario subió el mismo
archivo dos veces" — eso lo detiene el lote — sino **"este documento llegó en un
archivo distinto"**: otro mes de corte, otro formato, otra fuente, o el mismo
CUFE dentro de un Excel diferente. Ahí sí aplican `duplicado` y
`discrepante`, y ahí se deja constancia con `duplicado_de`. Borrar el
deduplicado por documento porque el de lote ya existe sería un error: los dos
protegen de cosas distintas.

### 4.9 Índices de consulta

- `(tenant, periodo, estado)` — la vista principal de la bandeja.
- `(tenant, estado)` — conteos por estado.
- `(tenant, proveedor_nit)` — cruce con `proveedores` y con `cuentas_por_pagar`.
- `(proveedor_id)` — una vez resuelto el proveedor.
- `(cuenta_puc)` — para el cruce con el PUC.
- `(estado, discrepante_de)` — la cola de discrepancias por resolver.
- `xml_hash` — para saber si un XML exacto ya se importó.

### 4.10 Hijos del documento: opción A, atómica

**Decidido: opción A.** La RPC `dian_registrar_documento` recibe el documento
**y sus hijos** en la misma llamada: `p_lineas`, `p_impuestos`,
`p_retenciones` y `p_formas_pago`, cada uno un array de objetos `jsonb`.

La opción B —cabecera primero, hijos después— se descartó por una razón
concreta: si el detalle falla a la mitad, queda un documento sin líneas que
nadie sabe que está incompleto. El staging no tiene ninguna marca de "cargado a
medias", así que esa fila se convierte en un documento que nadie revisará nunca.
La opción B necesita un estado intermedio y una bandera de "hijos faltantes"
justo para eso; la opción A no necesita ninguna de las dos.

| | Opción A (elegida) | Opción B (descartada) |
|---|---|---|
| Transacción | Una: cabecera e hijos, todos o ninguno | Varias: cabecera sola, luego cada hijo |
| Si un hijo falla | No queda nada | Queda una cabecera huérfana |
| Cómo se detecta una cabecera sin detalle | Imposible | Hace falta estado o bandera nueva |
| Coste | La llamada es más grande | La llamada es chica y reintentable |

El "todo o nada" no es una disciplina del código: es el comportamiento por
defecto de la transacción. `_dian_staging_insertar_hijos` vive dentro de la
misma transacción de la RPC, así que la excepción de un hijo aborta la cabecera
con ella. El test **D21** lo comprueba con un impuesto con `tasa` como texto.

Dos reglas sobre los hijos:

- **Un `duplicado` no guarda hijos** ($4.7): la evidencia del reenvío es la fila
  misma, con su lote, su hash y su posición. Copiar el detalle lo duplicaría sin
  agregar nada, porque es idéntico por definición.
- **Un `discrepante` sí los guarda**: es justamente el detalle lo que hay que
  comparar entre los dos documentos.

Antes de castear, `_dian_staging_validar_hijos` comprueba que cada array sea un
array de objetos. Sin esa validación, un campo que llega como texto donde va un
número produce un `22P02 "invalid input syntax for type numeric"` que no dice
qué campo ni qué documento; con ella, el error dice qué array va mal y en qué
posición ($4.10.1).

#### 4.10.1 El error tiene que ser legible

```
HIJOS_INVALIDOS: p_lineas debe ser un array jsonb, no object
HIJOS_INVALIDOS: p_lineas tiene al menos un elemento que no es un objeto jsonb (posicion 2)
```

Un cliente puede corregir eso sin leer el servidor. Un `22P02` pelado no.

## 5. Estados, actos y máquina de estados

### 5.1 Los cuatro actos

El flujo contable separa cuatro actos. No son cuatro estados: son cuatro
**acciones** de personas distintas (o de la misma persona, si la política lo
permite), y cada una deja su firma.

| Acto | Qué hace | Quién lo puede hacer | Qué registra |
|---|---|---|---|
| **Preparar** | Resolver `proveedor_id`, `cuenta_puc`, `periodo_asignado` y `diferencia`; dejar el documento listo para que alguien lo apruebe | **Solo `contador`** | `preparado_por`, `preparado_rol`, `preparado_en` |
| **Aprobar** | Dar el visto bueno: el documento entra al proceso contable | **`revisor_fiscal`**. `contador` **solo si la política del tenant/lote lo permite** (D3a) | `aprobado_por`, `aprobado_rol`, `aprobado_en` |
| **Devolver** | Rechazar la preparación y devolver el documento a revisión, con motivo obligatorio | **`revisor_fiscal`** | `devuelto_por`, `devuelto_rol`, `devuelto_en`, `motivo` |
| **Cerrar** | Cerrar el documento (o el lote) para que ya no admita cambios | **`admin_contable`** | `cerrado_por`, `cerrado_rol`, `cerrado_en` |

Cada rol tiene **un oficio**. `admin_contable` queda fuera de los actos de
documento: su trabajo son las reglas (PUC común, excepciones, permisos), y
`revisor_fiscal` no administra reglas.

Los roles administrativos del resto de la app —`superadmin`, `gerencia`,
`administracion`, que son `ADMIN_ROLES` en `lib/roles.ts`— conservan todos los
actos, para que nobody pierda acceso administrativo por agregar el módulo.

> **Por qué el revisor fiscal NO prepara.** Una versión anterior de esta tabla
> decía "preparar: `contador` y `revisor_fiscal`". El test R15 lo destapó
> ("el revisor pudo preparar y clasificar") y era una contradicción real: quien
> prepara es quien propone la clasificación, así que si el mismo prepara y
> revisa, la revisión no es de segunda persona y la segregación de funciones es
> decorativa. Corregido, y ahora hay un test (R15b) que lo fija.

Las tres parejas (`*_por`, `*_rol`, `*_en`) se registran **siempre juntas**, y el
`*_rol` lo estampa el servidor: si el cliente pudiera escribirlo, la bitácora no
probaría nada (§6.3.1).

### 5.2 Estados

| Estado | Significado | Quién lo pone |
|---|---|---|
| `importado` | Recién leído, sin clasificar | Sistema, al insertar |
| `pendiente_revision` | Espera que alguien lo prepare | Sistema, al insertar |
| `preparado` | Alguien lo dejó listo; espera aprobación | `contador` o `revisor_fiscal` |
| `devuelto` | El revisor lo devolvió con motivo; vuelve a revisión | `revisor_fiscal` o `admin_contable` |
| `coincidente` | Se asoció a un registro existente (`cuentas_por_pagar`) | `contador` |
| `aprobado` | Revisado y listo para contabilizar | `revisor_fiscal`, `admin_contable` o `contador` con política |
| `cerrado` | **Terminal.** El proceso se dio por terminado para ese documento | `admin_contable` |
| `duplicado` | Ya existía con la misma clave y el mismo total | Sistema (§4.4) |
| `discrepante` | Misma clave con total distinto, o `diferencia` fuera de tolerancia | Sistema (marca) / persona (resuelve) |
| `rechazado` | No se va a usar (con motivo obligatorio) | `revisor_fiscal` o `admin_contable` |
| `contabilizado` | **Futuro.** Tiene asiento | Sistema, fase posterior |

### 5.3 Transiciones permitidas

```
importado ──► pendiente_revision ──► preparado ──► aprobado ──► contabilizado (futuro)
                  ▲                      │  ▲                    │
                  │                      │  │                    ▼
                  └──── devuelto ────────┘  │                 cerrado
                                             │
       pendiente_revision ──► discrepante ───┘  (se resuelve y vuelve a prepared)
                  │
                  ├──► duplicado   (terminal)
                  └──► rechazado   (terminal)
```

### 5.4 Reglas que la base no puede imponer

Van en la app, y varias dependen de la política del tenant:

- A `preparado` solo se llega desde `pendiente_revision` y dejando `preparado_por`.
- A `aprobado` se exigen `aprobado_por` **y** `aprobado_en`, y el documento debe
  tener `proveedor_id` **y** `cuenta_puc` **y** estar en `preparado`.
- A `devuelto` se exige `motivo`, y el documento vuelve a `pendiente_revision`
  conservando la última preparación como histórico en la bitácora.
- A `cerrado` y `contabilizado` solo desde `aprobado`, y solo una vez. Cerrados.
- `duplicado` y `contabilizado` y `cerrado` son terminales.
- **Preparar y aprobar por la misma persona:** permitido cuando la política del
  tenant/lote lo permite, y en ese caso el mismo `usuario_id` queda en
  `preparado_por` y en `aprobado_por` — que es precisamente lo que hace la
  bitácora auditable. Prohibido cuando la política no lo permite, y entonces
  `aprobado_por <> preparado_por` es condición de entrada.
- Un `contador` que aprueba deja `aprobado_rol = 'contador'`, que es la prueba de
  que la excepción de política se aplicó. Por eso el rol se guarda siempre.

## 6. RLS propuesta (descripción, NO implementación)

**No se implementa nada aquí.** No hay migración, no hay policy, no hay helper.
Esto es lo que debería crearse cuando se apruebe el modelo de roles.

### 6.1 Un helper dedicado, nunca `puede_ver_tenant`

`puede_ver_tenant(t)` está definido (migración 107) como
`mi_rol() in ('superadmin','gerencia') or mi_tenant() = t`, y lo comparten
`ventas`, `abonos`, `cuentas_por_pagar`, `aliados_b2b`, `facturacion`,
`liquidacion_comisiones`, `pe_empleados`, `pe_costos`, `contabilidad_movimientos`,
`conciliacion` y `conciliacion_extracto`. **Ampliarlo para un contador le abriría
tablas operativas que no le corresponden.** No se toca.

El patrón a seguir es el de la migración 202 del CRM
(`crm_lead_puede_ver` / `…insertar` / `…actualizar`): funciones
`security definer`, `stable`, `set search_path = public`, con `revoke all` a
`public`/`anon` y `grant execute` a `authenticated`, y una policy por operación.

### 6.2 Funciones a crear (futuro)

**D1 y D3 están resueltas** (§8.1), así que esta tabla ya no
es una propuesta: es el contrato que habría que implementar. Los tres roles
son `contador`, `revisor_fiscal` y `admin_contable` (`administracion_contable` se
descartó como nombre para no confundirse con el rol `administracion` que ya
existe).

| Función | Regla decidida |
|---|---|
| `dian_staging_puede_ver(p_tenant text)` | **Lista explícita** (decisión 2026-10-17): `superadmin` y `gerencia` ambas agencias; `administracion` y los tres roles contables, su agencia. Ningún otro rol. Ver §6.2.1 |
| `dian_staging_puede_importar(p_tenant text)` | Los tres roles contables y `administracion`, acotados a su tenant, más `superadmin` (decisión 2026-10-17). Cargar no es un acto de revisión |
| `dian_staging_puede_preparar(p_tenant text)` | **Solo `contador`**, más `superadmin`/`gerencia`/`administracion` |
| `dian_staging_puede_aprobar(p_tenant text)` | **`revisor_fiscal`**, más `superadmin`/`gerencia`/`administracion`. `contador` **solo si la política del tenant/lote lo permite** (D3a); hoy no |
| `dian_staging_puede_devolver(p_tenant text)` | Los mismos que aprobar: quien devuelve es quien puede rechazar |
| `dian_staging_puede_cerrar(p_tenant text)` | **`admin_contable`**, más `superadmin`/`gerencia`/`administracion` |
| `dian_staging_puede_administrar()` | Solo rol, sin tenant: `admin_contable` y `ADMIN_ROLES` (`superadmin`, `gerencia`, `administracion`) |

**`admin_contable` está acotado a su tenant, no es cross-tenant.** Es tentador
ponerlo junto a `superadmin` porque administra, pero §6.2 lo acota a su
tenant: solo `superadmin` y `gerencia` ven las dos agencias. Un
`admin_contable` con lectura cross-tenant leería los documentos
de la otra agencia. La primera versión de la migración lo tenía como
`superadmin` y el test R08 lo detectó; corregido.

Todos devuelven `coalesce(..., false)`: ver §4.6, por qué un `NULL` aquí abre
la puerta en vez de cerrarla.

### 6.2.1 Por qué `ver` no delega en `puede_ver_tenant`

`puede_ver_tenant(t)` es `mi_rol() in ('superadmin','gerencia') or mi_tenant() = t`,
y `mi_tenant()` hace `coalesce(..., 'mayorista')`. La primera versión de la 204
delegaba en él con un filtro `mi_rol() is not null`, y eso tapaba solo el caso
del usuario sin fila. La sonda por rol del 2026-10-17 mostró el problema real:
**cualquier rol de la agencia** leía el staging. Por eso `ver` es una lista
explícita de roles:

| Quién llama | `puede_ver_tenant` | `dian_staging_puede_ver` (vigente) |
|---|---|---|
| Rol contable o `administracion`, su tenant | sí | sí |
| `gerencia` o `superadmin`, otro tenant | sí | sí |
| `venta`, `operaciones`, `control_vuelo`, su tenant | **sí** | **no** |
| `agencia`, `freelance`, `cliente_final` | **sí** | **no** |
| Usuario **con sesión pero sin fila en `usuarios`** | **sí** (cae en `mayorista`) | **no** |
| Sin sesión | no | no |

El staging tiene NIT, razón social y totales de facturas de proveedores, es
decir costos: los mismos que las migraciones 144/146 le cerraron a `venta`.
R16 comprueba las celdas de sesión y R17 las de rol; el postcheck §17 falla si
la función vuelve a delegar en `puede_ver_tenant` o nombra un rol de fuera.

Dos precisiones que hacen la diferencia entre esto y un módulo real de
contabilidad:

- `revisor_fiscal` **no** tiene `dian_staging_puede_administrar`. Aprueba, revisa
  y devuelve, pero no cambia las reglas del juego. Esa separación es lo que
  hace que un cambio de política contable no dependa de quien revisa.
- `admin_contable` administra las **reglas**: PUC común por tenant, excepciones,
  y los permisos contables. Es el único que puede ampliar quién aprueba.

### 6.3 Policies

| Tabla | select | insert | update | delete |
|---|---|---|---|---|
| `lote_importacion_dian` | ver | importar | importar (propio) | nadie |
| `documento_dian_staging` | ver | importar | **una sola policy** + trigger de transición (§6.3.1) | **nadie** (append-only) |
| `documento_dian_linea_staging` | ver | importar | — | — |
| `documento_dian_impuesto_staging` | ver | importar | — | — |
| `documento_dian_retencion_staging` | ver | importar | — | — |
| `documento_dian_resolucion` | ver | revisar | — | — |

`documento_dian_identidad` solo tiene policy de `select`: su escritura es
exclusiva de `dian_registrar_documento`, que es `security definer`.

`revoke all` a `anon` en las ocho, `grant select, insert` a `authenticated`, y
**nunca** `delete` ni `truncate` para nadie salvo el dueño (mismo criterio que
aplicó la migración 200 a `historial_vuelos_immutable`).

### 6.3.1 Por qué la separación de actos NO puede ser una policy por acto

PostgreSQL combina con **OR** las policies permisivas del mismo comando. Con una
policy `UPDATE` "puede revisar" y otra "puede aprobar", un rol que solo cumple
"revisar" **también puede aprobar**: la segunda policy no lo protege, la primera
ya le deja pasar la fila. Cuatro policies de UPDATE —preparar, aprobar, devolver,
cerrar— habrían dado exactamente eso.

Comprobado ejecutando: un `contador` puso `estado = 'aprobado'`, se blinked
`aprobado_por` y **falsificó** `aprobado_rol = 'admin_contable'`. La RLS lo dejó
pasar porque la policy de "revisar" le daba acceso a la fila.

La solución es de dos piezas:

- **Una sola policy de `UPDATE`**, que solo marca qué roles pueden *llegar* a la
  fila: quien puede revisar, aprobar, devolver o cerrar.
- **Un trigger `BEFORE UPDATE`**, que sí ve el antes y el después y decide el
  acto: si el estado nuevo es `preparado` exige poder preparar; si es `aprobado`
  exige poder aprobar y que `aprobado_por` no sea nulo; si es `devuelto` o
  `rechazado` exige poder devolver; si es `cerrado` exige poder cerrar; y
  cualquier otro estado se rechaza porque lo determina el sistema al importar.

El trigger además **estampa los `*_rol` desde el servidor**. Si el cliente
pudiera escribirlos, la bitácora no probaría nada (§5.4): el `*_rol` es la
prueba de con qué permisos actuó, y eso solo lo sabe el servidor.

### 6.3.2 Columnas del parser congeladas tras el insert

El mismo gate de UPDATE (§6.3.1) hace una segunda cosa, y es la que sostiene el
deduplicado: **las columnas que escribió el parser son inmutables después del
insert**.

| Congeladas | Editables |
|---|---|
| `tenant`, `lote_id`, `documento_dian_identidad_id`, `periodo`, `fuente` | `estado`, `motivo_pendiente` |
| `clave`, `clave_base`, `cufe`, `cude` | `proveedor_id`, `proveedor_cruce_estado` |
| `tipo_documento`, `tipo_documento_original`, `numero`, `fecha` | `cuenta_puc`, `cuenta_puc_origen`, `tipo_gasto`, `periodo_asignado` |
| `proveedor_nit/_dv/_identificacion/_tipo_ident/_nombre`, `sujeto_*` | `documento_relacionado_id`, `trm` |
| `moneda`, `divisa_*` | los 12 campos de los cuatro actos (`*_por`, `*_rol`, `*_en`) |
| `subtotal`, `base_gravable`, `descuentos`, `cargos`, `anticipos`, `redondeo`, `impuestos_total`, `retenciones_total` | |
| `total_declarado`, `total_calculado`, `diferencia`, `diferencia_tolerada` | |
| `xml_hash`, `fila_origen`, `celdas_origen`, `originales`, `software_emisor` | |
| `fuera_de_corte`, `duplicado_de`, `discrepante_de`, `creado_por`, `creado_en` | |

`total_declarado` es la congelada más importante: es la columna que el índice de
dedupe usa. Si alguien la cambiara después de importar, la fila dejaría de
coincidir con su identidad y el deduplicado dejaría de ser reproducible — sin
ningún error visible, solo documentos que nunca más se cruzarían.

Dos detalles:

- La comparación es `is distinct from`, así que **reescribir una columna
  congelada con el mismo valor sí pasa**. Lo que se prohíbe es cambiarla, no
  volver a escribirla: si no, cualquier `update` inocuo sobre la fila fallaría.
- `trm` **no** está congelada a propósito: se ajusta cuando se autoriza un
  documento en{divisa> y por eso tiene su propia entrada en la bitácora.

El gate también sella `actualizado_en`, para que la fecha de actualización no se
pueda escribir a mano.

La lista vive en `dian_staging_columnas_congeladas()`, que el postcheck consulta
para comprobar que las 19 columnas críticas están dentro y que las 21 de
revisión están fuera. Si mañana se agrega una columna al `create table`, hay que
decidir en el mismo momento en cuál de las dos columnas va: el postcheck no
puede saberlo solo.

### 6.3.3 `usage` sobre las secuencias

Un `insert` concedido sobre una tabla con `bigserial` **no funciona** sin
permiso de secuencia: Postgres exige `usage` para escribir en la columna serial.
Por eso hay un bloque que lo concede sobre las siete secuencias del staging, y
otro que las revoca a `public` y `anon`.

La excepción deliberada es `documento_dian_identidad_id_seq`: no se concede, porque
esa tabla es de la RPC (§6.3). Verificado ejecutando — sin ese bloque, un
`insert` en la bitácora desde `authenticated` fallaba con `permission denied for
sequence documento_dian_resolucion_id_seq`.

### 6.4 Lo que además falta y no es RLS

- **Los roles nuevos** (`contador`, `revisor_fiscal`, `admin_contable`)
  tienen que existir en `usuarios.rol`, en `lib/constants.ts` (`ROLES`),
  `LECTURA_MODULO`, `ESCRITURA` y en las policies de `usuarios`.
- **La ruta importa.** Si la bandeja cuelga de `/dashboard/contabilidad/...`
  entra en el gate de `proxy.ts`; si vive fuera de `/dashboard`, **no** entra
  (los tres guards de `proxy.ts` comparan `pathname.startsWith("/dashboard")`).
  Decidir el prefijo ANTES de escribir la primera página.

## 7. Decisiones ya tomadas por la evidencia (no son bloqueantes)

### 7.1 La clave de deduplicado ya está probada

`dedup.ts` está implementado y con pruebas. No hay que decidir nada aquí: lo que
hay que decidir es **qué hacer cuando la clave se repite**, y eso es §4.2.

### 7.2 La aritmética ya está verificada

La fórmula de la DIAN cuadra en los 25 documentos reales:
`LineExtensionAmount − AllowanceTotalAmount + ChargeTotalAmount +
suma de TaxSubtotal.TaxAmount − PrepaidAmount + PayableRoundingAmount`. El staging la
copia; no la recalcula ni la corrige.

### 7.3 Cuenta contable del emisor ≠ PUC de D'spacios

`lineas[].cuenta_contable_emisor` y `cuenta_puc` son columnas distintas y con
significado distinto. El PUC es una decisión humana, y por ahora vive **por
tenant** (`puc_cuentas` tiene `unique (tenant, codigo)`), no global. La
propuesta de catálogo global del diseño del módulo sigue **pendiente**: no la
resuelve el staging, solo deja el campo `cuenta_puc_origen` listo para
distinguir `global` de `excepcion_tenant` cuando exista.

### 7.4 Las retenciones no entran en el cuadro

Los 26 documentos reales traen retenciones en cero y el único bloque "de
retención" con valor (INC al 8 %) **sumaba** al payable. Por eso
`total_calculado` **no** resta retenciones. Consecuencia asumida y documentada:
una retención real **no dispararía** `TOTAL_NO_CUADRA`. Se cierra con D2.

### 7.5 Los documentos sin NIT no son documentos inválidos

Hay facturas de personas naturales cuya identificación es una cédula de 8
dígitos. En el staging, `proveedor_nit` queda null y `proveedor_identificacion`
trae la cédula. **Cruzar por NIT no es posible para ellos**: es la causa
esperada de "sin coincidencia" y hay que resolverla a mano (D4).

### 7.6 El periodo se deriva de la fecha, y aun así es una decisión

`periodo = fecha.slice(0,7)`. Pero el periodo contable que se use para agrupar
puede ser distinto (mes de cierre, mes de la operación). De ahí las dos columnas:
`periodo` (naturaleza, la llena el sistema) y `periodo_asignado` (decisión
humana, inicialmente igual a `periodo`).

### 7.7 El "total a comparar" no está resuelto

En el reporte de compras hay tres columnas de total y en el archivo real todas
valían cero, así que no hay evidencia de cómo se combinan: `Valor Facturado`,
`Valor Notas Crédito` + `Valor Notas Débito`, y `Valor Factura / Afectada con
Notas Débito - Crédito`. El diseño usa `Valor Facturado` como `total_declarado`
y deja las otras **sin usar**, documentado. Requiere D7.

## 8. Decisiones de negocio

### 8.1 Resueltas

Cinco decisiones quedaron cerradas. Esta sección es el registro de qué se
decidió y por qué, para que no se reabra por memoria.

| # | Decisión | Qué se decidió | Dónde se aplica |
|---|---|---|---|
| **D1** | **Roles** | Se crean tres roles nuevos: `contador`, `revisor_fiscal` y `admin_contable`. No se mapean sobre `administracion`/`gerencia`, porque un contador no debe heredar los permisos de gerencia ni al revés. `administracion_contable` se descartó como nombre para no confundirse con el `administracion` que ya existe | §6.2, §5.1 |
| **D3** | **Separación de funciones** | El flujo distingue **preparar**, **aprobar**, **devolver** y **cerrar**. Cada acto deja `*_por`, `*_rol` y `*_en`. `contador` puede preparar y aprobar **si la política del tenant/lote lo permite**; `revisor_fiscal` aprueba, revisa y devuelve pero **no** administra reglas globales; `admin_contable` administra reglas, PUC común/excepciones y permisos contables | §5.1, §5.4, §6.2 |
| **D6** | **Reimportación del mismo archivo** | **Opción A.** Si el `hash_contenido` del lote ya existe para el mismo `(tenant, fuente, periodo)`, no se crean documentos. Se devuelve advertencia con `lote_anterior_id`. El deduplicado documento-a-documento sigue existiendo para documentos que llegan en archivos distintos | §4.8, §3.1 |
| **D8** | **Corte histórico** | **No se quema enero de 2026.** El rango `periodo_desde`/`periodo_hasta` y el `motivo` los elige el usuario al abrir cada proceso. Nada tiene periodo por defecto | §3.1, §4.6 |
| **D10** | **XML y datos personales** | **Por defecto no se guarda el XML completo.** Se guardan el hash del XML/contenido, los campos ya normalizados y los metadatos de fuente. Una bandera futura `conservar_xml_original` queda reservada, no creada (§9.6) | §9.6 |

Lo que D3 resuelve no es solo quién puede hacer qué: es que el staging **deja
rastro de los cuatro actos**. Un sistema donde "alguien revisó esto" no se puede
reconstruir después no sirve como soporte contable, por más permisos que tenga.

Lo que D10 resuelve no es solo privacidad: es que el staging **no necesita el
XML para cumplir su función**. Las tres cosas que el XML aporta —hash, fecha,
importe— ya están en las columnas normalizadas. El XML crudo solo suma datos
personales y tamaño.

### 8.2 Decisiones abiertas: expediente por decisión

**Respuesta corta: ninguna de las siete bloquea la migración de staging.** Las
siete se pueden implementar como columnas más una bandera que deja el documento
en `pendiente_revision` con un motivo explícito. Lo que sí cambian es el número
de columnas y qué se le muestra a la persona.

| # | Veredicto | Qué hay que añadir |
|---|---|---|
| **D2** | No bloquea | 1 columna informativa y una regla de aviso |
| **D4** | No bloquea | 1 columna de estado de cruce |
| **D5** | No bloquea | La misma columna que D4 |
| **D7** | No bloquea, y se disuelve sola | Ninguna columna nueva |
| **D9** | No bloquea, y no puede ocurrir por construcción | Ninguna |
| **D11** | Acotada y medible | Ninguna; un conteo en el preflight |
| **D12** | No bloquea, pero exige capturar el texto original del tipo | 1 columna |

---

#### D2 — Signo y tratamiento de las retenciones

**Problema.** `total_declarado` es el número que manda (`PayableAmount`). La
pregunta es si ese número ya viene neto de retenciones, y si `total_calculado`
debe restarlas. Hoy hay **dos comportamientos distintos dentro del mismo
parser**:

| Vía | Qué hace con las retenciones | Dónde |
|---|---|---|
| XML | Las **informa** y **no** las resta de `total_calculado`, de forma deliberada y documentada | `factura.ts`, fórmula sin retenciones |
| Excel | **Sí las resta**: `subtotal - descuentos + cargos + impuesto - retencion` | `excel.ts:263` |

Ninguna de las 25 facturas XML reales trae una retención distinta de cero, así
que la pregunta "¿ya viene neta o no?" **no se puede responder con la evidencia
disponible**. Y `proveedores` ya tiene `aplica_retencion` y `pct_retencion`, o
sea que el catálogo sí espera retenciones: el modelo de negocio las contempla
aunque hoy ningún documento las traiga.

**Opciones.**
1. Decidir el signo ahora y meterlo en la fórmula del staging.
2. No decidir nada, mostrar los tres números y que la persona juzgue.
3. Asumir que `PayableAmount` es neto y ajustarlo en silencio.

**Recomendación: la 2.** La 1 y la 3 exigen un dato que no existe: un solo
documento real con retención, para ver si `total_declarado` coincide con el
desglose o con el desglose menos la retención. Firmar el signo sin ese documento
es escribir una regla que el primer caso real va a contradecir. Y como la vía
Excel y la vía XML **no pueden coincidir** hoy, cualquier fórmula del staging
daría números distintos según por dónde entró el documento.

Lo que sí se hace, sin tocar el parser:

- Se guardan `total_declarado`, `total_calculado` y `retenciones` por separado,
  tal como el parser los entrega, **sin recalcular nada**.
- Cuando `retenciones > 0` y `diferencia` es igual a la suma de las retenciones
  dentro de la tolerancia, se levanta el aviso `RETENCION_NO_APLICADA`: "la
  diferencia entre el total declarado y el desglose parece ser exactamente la
  retención; confirme si el total declarado viene neto". El documento sigue a
  revisión normal, con su `pendiente_revision` de siempre.
- Cuando `retenciones > 0` pero la diferencia **no** coincide con la retención,
  el aviso es el genérico de descuadre, que ya existe.

**Impacto en tablas.** La columna ya existe: `retenciones_total` está en §3.3.
No hace falta ninguna columna nueva. Lo que sí hace falta es el aviso
`RETENCION_NO_APLICADA` en el cálculo de problemas, para que el caso llegue a la
bandeja con su motivo.

**Impacto en UI.** La celda de total deja de ser una y pasa a ser
`declarado / calculado / retenciones`, visible siempre que `retenciones > 0`. En
la ficha, una línea que explique el aviso.

**Impacto en RLS/permisos.** Ninguno. Es una columna más y un aviso.

**¿Bloquea la migración?** **No.** Se implementa entera y el caso queda en
`pendiente_revision` con motivo.

---

#### D4 — Proveedor sin NIT o con identificación no cruzable

**Problema.** `proveedores` identifica por `nit`, y `nit` es **nullable y sin
índice único** (migración 1). El parser entrega `nit`, `dv`, `identificacion` y
`tipoIdentificacion`, así que hay documentos cuya identificación es una cédula
(`CC`/`CE`) y no un NIT, y documentos sin identificación ninguna. Sin NIT no hay
contra qué cruzar.

**Opciones.**
1. El staging crea el tercero automáticamente.
2. El staging crea un "fuera de catálogo" sin NIT.
3. El staging no cruza y deja el documento a revisión con el emisor a la vista.

**Recomendación: la 3.** Crear terceros desde una importación es una decisión de
catálogo tomada en masa y sin revisión: si el archivo trae un NIT mal leído, se
crea un proveedor equivocado que después hay que depurar — y como `proveedores`
no tiene unicidad, nada avisa que está mal. La opción 2 es peor: crea un registro
indistinguible de uno real. La 3 es la única que no escribe nada fuera del
staging.

Regla que queda escrita: **el staging nunca inserta en `proveedores`,
`cuentas_por_pagar` ni en ningún catálogo.** Solo propone; la persona confirma.

**Impacto en tablas.** `proveedor_id` queda `null` y se agrega
`proveedor_cruce_estado text` con
`check in ('coincide','sin_nit','nit_no_cruzable','varios_candidatos','no_resuelto')`.
Es la misma columna que usa D5. `proveedor_nit` y `proveedor_nombre` —copias de
lo que dice el documento— siguen siendo la evidencia de a quién se le atribuyó.

**Impacto en UI.** La bandeja agrupa por `proveedor_cruce_estado`, y "sin NIT" y
"varios candidatos" son filtros de un clic. En la ficha, el emisor se muestra por
nombre aunque no tenga NIT, que es como lo lee la persona.

**Impacto en RLS/permisos.** Ninguno nuevo para el staging. Se hace explícito,
eso sí, que escribir en `proveedores` es una operación distinta, con su propia
policy ya existente (migración 191), que este módulo no toca.

**¿Bloquea la migración?** **No.** Queda en `pendiente_revision` con
`proveedor_cruce_estado = 'sin_nit'`.

---

#### D5 — NIT duplicado en el catálogo

**Problema.** `proveedores.nit` no tiene índice único ni constraint. Dos filas
con el mismo NIT son legales hoy, y el staging no puede distinguirlas por el NIT
solo.

**Opciones.**
1. El staging elige la primera y sigue.
2. El staging exige que una persona elija.
3. La migración agrega unicidad al NIT.

**Recomendación: la 2**, y explícitamente **no** la 3. Agregar unicidad al NIT es
una migración sobre `proveedores` que puede fallar si hoy ya hay duplicados, y
eso es otro problema, en otro módulo, con otro riesgo: este diseño no la hace y no
la debe hacer.

La 1 es la tentadora y es la incorrecta. Con dos candidatos, elegir el primero
produce una clasificación contable silenciosamente equivocada, que es peor que no
clasificar.

**Impacto en tablas.** La misma columna de D4, con el valor
`'varios_candidatos'`. Ninguna columna nueva.

**Impacto en UI.** Un selector con los candidatos y su nombre, **sin
preselección**: la lista completa, la persona elige, y la elección queda en la
bitácora. Si no elige, el documento se queda como está. Nunca se preselecciona el
primero "porque casi siempre es el correcto".

**Impacto en RLS/permisos.** Leer `proveedores` lo puede hacer cualquiera con
acceso al tenant; no hace falta permiso especial para ver candidatos.

**¿Bloquea la migración?** **No.** Y conviene notar dónde se resuelve esto: **no
en la base**, sino como regla de la app, porque "elegir el primero" es una
decisión de negocio escrita en código de aplicación.

---

#### D7 — El total "verdadero" en compras, con notas crédito/débito

**Problema.** El reporte de compras trae tres columnas de total: `Valor
Facturado`, `Valor Notas Crédito` + `Valor Notas Débito`, y `Valor Factura /
Afectada con Notas Débito - Crédito`. El parser mapea **una**: `total`, con alias
`VALOR FACTURADO` (`excel.ts:58`). Las otras dos se **descartan**, y no hay forma
de recuperarlas sin tocar el parser.

**Opciones.**
1. Cambiar el total a la columna de notas aplicadas.
2. Guardar las tres y que la persona elija.
3. Dejar `Valor Facturado` y documentar el límite.

**Recomendación: la 3, y la pregunta se disuelve sola.** La razón es que el
deduplicado no compara facturas con sus notas: compara **filas del archivo**, y
cada fila del reporte es un documento con su CUFE y su propio total. Las notas
crédito y débito **son filas propias**, con CUFE propio, y por tanto ya entran
como documentos independientes. No hay ningún momento del diseño en el que haya
que "restar" las notas de una factura: si una factura viene sola y sus notas
vienen aparte, hay tres documentos, y cada uno se concilia contra su propio
registro en `cuentas_por_pagar`.

Donde sí aparecería el riesgo es el inverso: una fila que ya trae el total
afectado por notas y además viene la nota por separado. Eso no se pierde ni se
duplica: cae en `duplicado` (mismo CUFE, mismo total) o en `discrepante` (mismo
CUFE, otro total), que es exactamente para lo que existen esos dos estados
(§4.4). El riesgo no se previene: se **detecta y se muestra**, que es el objetivo
del staging.

**Impacto en tablas.** Ninguna columna nueva. Se documenta en la ficha que
`Valor Facturado` es la base del total y que las columnas de notas del reporte no
se conservan.

**Impacto en UI.** La ficha dice de dónde salió el total (el alias de columna que
el parser reconoció) y que las notas llegan como documentos aparte. Nada más.

**Impacto en RLS/permisos.** Ninguno.

**¿Bloquea la migración?** **No**, y no queda pendiente de resolver. Si más
adelante se quisiera conservar las otras dos columnas, eso es una decisión de
parser, no de staging.

---

#### D9 — Un lote con documentos de más de un tenant

**Problema.** El lote tiene `tenant` y el documento también. ¿Puede un archivo
traer documentos de dos agencias?

**Opciones.**
1. Permitir el lote multi-tenant y deducir el tenant de cada fila.
2. Prohibirlo, porque el tenant no viene del archivo.

**Recomendación: la 2, y queda resuelto por construcción.** El archivo de la DIAN
**no tiene** un campo de agencia: es un reporte de la DIAN, y la agencia que lo
importa es la que está autenticada. El parser tampoco produce `tenant` —no
aparece en `DocumentoDian`—, así que un lote no puede traer dos tenants porque el
tenant no se lee del archivo sino que lo pone la sesión (§4.5, punto 1).

Lo que sí es real, y es un error de carga, es que el usuario suba el archivo de
la otra agencia. Eso no lo resuelve el diseño de datos sino una **comparación
explícita en la UI**: el nombre de la agencia desconectada, visible junto al
selector de archivo. Es una advertencia, no un error, porque el archivo es válido.

**Impacto en tablas.** Ninguna. El `check in ('mayorista','minorista')` del lote
sigue valiendo y ahora se justifica con `tenant` derivado de la sesión.

**Impacto en UI.** El nombre del tenant a la vista en el formulario de carga.
Sin validación adicional.

**Impacto en RLS/permisos.** El helper de importar ya exige `mi_tenant() =
p_tenant`; al derivar el tenant del servidor, el usuario no puede escribir en
otro tenant por accidente (§4.5, punto 1).

**¿Bloquea la migración?** **No**, y no queda pendiente: no es una decisión
abierta, es una propiedad del diseño.

---

#### D11 — Notas crédito/débito en Excel sin XML

**Problema.** Hoy **no hay ni un XML de nota crédito o débito real** (§10), así
que la regla del CUDE no se ha podido verificar contra un documento real. El
parser sí separa los campos: una nota lleva `cude` y no `cufe`
(`excel.ts:283`), y la clave de deduplicado usa `cufecude` para ambos (§4.1).

**Opciones.**
1. No admitir notas hasta tener un XML real.
2. Admitirlas y confiar en la clave.
3. Admitirlas y medir cuántas se deduplican por CUDE.

**Recomendación: la 3.** La 1 es demasiado estricta: si el archivo del mes trae
notas, omitirlas sería peor que admitirlas. La 2 sin medición es fe: si la regla
del CUDE resultara distinta de la del CUFE, el dedupe de notas fallaría **en
silencio**, y lo que aparecería en pantalla son dos filas por la misma nota sin
nada que lo explique.

Por eso el requisito no es bloqueante sino **medible**: el preflight (§11) tiene
que contar, sobre el archivo real, cuántas filas se deduplican por `cufecude` y
cuántas caen a `REF:`, desglosadas por tipo de documento. Si todas las notas caen
a `REF:`, el CUDE no está llegando y hay que mirarlo antes de confiar en el dedupe
de notas.

**Impacto en tablas.** Ninguna. `tipo_documento` ya distingue `nota_credito` de
`nota_debito`, y `clave_base` deja registrado por qué base se deduplicó cada
fila, que es lo que hace falta para diagnosticar.

**Impacto en UI.** Un contador en la cabecera del lote: "N filas se deduplicaron
por CUFE, M por identificación". Y en la ficha de una nota, el `clave_base`
visible, para que un humano pueda detectar que dos notas iguales no se cruzaron.

**Impacto en RLS/permisos.** Ninguno.

**¿Bloquea la migración?** **No.** Queda como `pendiente_revision` el documento
que no cuadre, y el riesgo de la regla del CUDE queda **acotado y medible**, no
resuelto.

---

#### D12 — Documentos soporte y "documento equivalente"

**Problema.** El reporte de exógena los menciona, y `TipoDocumento = "factura" |
"nota_credito" | "nota_debito"` no los tiene. Peor: `excel.ts:228` hace
`tipoDesdeTexto(tipoTexto) ?? "factura"`, así que una fila cuyo tipo diga
"DOCUMENTO SOPORTE" **no genera ningún error**: llega como `factura`, y el texto
original no se conserva en ninguna parte (`ValoresOriginales` no incluye el tipo y
la vía Excel no lo llena).

Esto choca de frente con el principio 1 (§2): un documento que no se pudo clasificar
entraría como factura, en silencio.

**Opciones.**
1. Aceptar que un documento soporte se importe como factura.
2. Ampliar `TipoDocumento` en el parser.
3. Capturar el texto original del tipo en la carga, sin tocar el parser.

**Recomendación: la 3.** La 2 es correcta en el fondo, pero es un cambio de
parser, y el parser está validado contra 25 documentos reales: tocarlo ahora
enreda dos cosas que sí funcionan. La 1 viola el principio 1.

La 3 es posible sin tocar el parser porque **la carga ya tiene el archivo**:
`ResultadoLote.columnas` es el mapa `campo → índice` que el parser ya devuelve, y
el tipo es una columna mapeada (`excel.ts:50`). La acción de importación, que ya
leyó las filas, puede releer esa celda y guardarla como `tipo_documento_original`.

Y desde ahí el staging sí puede ser estricto sin inventar reglas de
clasificación:

| `tipo_documento_original` | `tipo_documento` | Qué hace |
|---|---|---|
| Vacío o null | `factura` | Normal: el archivo no trae columna de tipo, y en un reporte de la DIAN lo mayoritario es una factura |
| Texto que el parser reconoció | lo que el parser dijo | Normal |
| Cualquier otro texto | `otro` | Documento sin clasificar: entra igual, con el original a la vista y `estado = pendiente_revision` |

**Impacto en tablas.** Una columna `tipo_documento_original text`. Y el `check`
de `tipo_documento` pasa a admitir `'otro'`, que antes no existía en el tipo del
parser. Esa columna es, de hecho, la única forma de que el staging cumpla su
propio principio de "nada se descarta en silencio" en este caso.

**Impacto en UI.** La fila muestra el tipo original cuando no coincide con el
clasificado, y hay un filtro "sin clasificar". La lista de tipos incluye
"soporte" y "equivalente" como etiquetas **de la interfaz**, no del modelo: se
reconoce el texto y se guarda, sin ampliar el parser.

**Impacto en RLS/permisos.** Ninguno.

**¿Bloquea la migración?** **No.** Todos los documentos entran; los no
clasificados quedan en `pendiente_revision` con el motivo a la vista.

### 8.3 Lo que sigue abierto después de los expedientes

Los expedientes de §8.2 acotaron las siete decisiones, pero no cerraron del todo
el diseño. Queda esto:

| # | Pregunta | De dónde sale | Recomendación | Bloquea |
|---|---|---|---|---|
| **D3a** | Dónde vive la política que permite al `contador` aprobar | D3 dice "si la política lo permite", pero nadie dijo dónde se guarda | Tabla de política por tenant/lote: es lo único que permite auditar **por qué** se aprobó | No la migración; sí la UI de aprobación |
| **D6a** | Advertencia o lote `descartado` vacío | D6 aceptaba las dos | Advertencia (§4.8). Un lote que no importó nada no es un lote | No |
| **D8a** | Qué hacer con documentos anteriores a `periodo_desde` | Si el corte es elegido, el archivo puede traer de antes | Importarlos marcados `fuera_de_corte` y que el filtro sea de la UI: nada se descarta (§2, principio 1) | No; sí una columna más |
| **D10a** | Si `conservar_xml_original` llega a activarse | D10 la reservó sin crearla | No crear la columna hasta que la pidan. Si la piden: retención y borrado, cifrado en reposo, decisión registrada (§9.6) | No |
| **D2a** | Qué hacer cuando aparezca el primer XML con retención real | D2 quedó acotada, no resuelta: no hay evidencia | Revisar el signo en ese momento, con el documento a la vista. La regla de aviso `RETENCION_NO_APLICADA` ya deja el caso a la vista | No |
| **D12a** | Lista definitiva de textos que se consideran "soporte" | D12 recomienda no ampliar el parser, así que los textos se reconocen en la UI | Empezar por lo que aparezca en el archivo real. No adivinar una lista de antemano: el reporte de exógena los menciona pero no se ha visto ninguno | No |

**Conclusión para la migración.** Con esto, la futura migración de staging
**puede diseñarse**: el modelo de datos está completo (§3), el flujo transaccional
del deduplicado está cerrado (§4), los cuatro actos y los roles están decididos
(§5, §6), y las siete decisiones que quedaban tienen respuesta, columna o
bandera. Lo que falta no es diseño de datos, sino número de migración libre,
D3a y la UI.

## 9. Riesgos

### 9.1 Notas crédito/débito sin XML real

No existe ni un solo XML de nota en los archivos del usuario. La regla actual
(`cude` desde el `cbc:ID` de la raíz, `numero` desde `ReferenceID`) está basada
en práctica y **sin verificar**. Una nota cuya estructura difiera se importaría
con `cude = null` y caería en el `unique` de la clave de respaldo — lo que hace
que dos notas distintas del mismo proveedor puedan chocar. **Mitigación:** hasta
tener un XML real, exigir `cude` para aprobar una nota (D11).

### 9.2 Retenciones sin valor efectivo

Las tres estructuras existen y se leen, pero ningún documento real trae importe.
No se sabe si suma, resta, o si es del emisor o del comprador. **Mitigación:**
`retenciones_total` se guarda y se muestra, pero no participa del cuadro (§7.4).

### 9.3 PUC global pendiente

`puc_cuentas` es **por tenant** (`unique (tenant, codigo)`) y el motor resuelve
`codigo → id` filtrando por tenant (`asientos.ts`: `.eq("tenant", tenant)`).
Un catálogo global exige cambiar ese resolver y migrar dos catálogos; el staging
no lo hace ni lo desbloquea. Mientras tanto, `cuenta_puc` apunta a la cuenta del
tenant, y `cuenta_puc_origen` queda en `excepcion_tenant` o `null`.

### 9.4 Numeración e idempotencia de asientos pendientes

El motor tiene dos debilidades conocidas, ya auditadas y **no tocadas** aquí:

- `asientos_contables` **no** tiene índice único sobre `(tenant, origen,
  referencia)`: `reemplazarAsiento` es `DELETE` + `INSERT` sin transacción.
- La numeración se calcula leyendo el máximo y sumando uno
  (`siguienteNumero`), con `unique (tenant, numero)`: un posting por lotes
  puede colisionar y perder asientos en silencio.

Consecuencia para este diseño: **el staging no contabiliza todavía**, porque
postear un lote de staging es justo el caso que expone ambos defectos. La
llave futura sería `origen = 'dian_import'`, `referencia = 'dian:<staging_id>'`
— y esa referencia **no es única** hasta que se agregue el índice que falta.

### 9.5 Periodos cerrados que no existen

Hoy no hay ningún concepto de periodo cerrado en contabilidad (búsqueda de
`cerrad|periodo|bloquea` en `app/(dashboard)/dashboard/contabilidad/**` no
devuelve nada; `periodo` solo existe como etiqueta `YYYY-MM` en
`conciliacion_extracto`). Mientras no exista, importar un documento de un
periodo ya cerrado no tiene consequence alguna — **y por eso el staging no la
tiene**. Cuando se creen los periodos, habrá que añadir una regla que impida
aprobar documentos de periodos cerrados, y ese campo **no está en este diseño**
a propósito (§10).

### 9.6 El XML contiene datos personales

**D10 resuelto: por defecto no se guarda el XML completo** (§8.1).

El `xml_original` de una factura electrónica incluye razón social, dirección,
correos y teléfono del emisor **y** del cliente, además de la firma digital. Son
datos personales de terceros que la agencia no necesita para conciliar.

Lo que sí se guarda, siempre:

| Qué | Dónde | Para qué |
|---|---|---|
| Hash del contenido recibido | `lote_importacion_dian.hash_contenido` | Detectar la reimportación del mismo archivo (§4.8) |
| Hash del XML de cada documento | `documento_dian_staging.xml_hash` | Saber si un XML **exacto** ya se importó, aunque llegue por otro archivo |
| Campos normalizados | columnas de `documento_dian_staging` y sus tablas hijas | Toda la función contable: fecha, importes, impuestos, retenciones, NIT |
| Metadatos de fuente | `fuente`, `nombre_archivo`, `fila_origen`, `celdas_origen` | Auditar de dónde salió cada documento |

Con eso se cumple el propósito completo del XML para efectos contables: las tres
cosas que el archivo crudo aportaba —**hash**, **fecha** e **importe**— ya están
en columnas propias, y son las únicas que un soporte necesita para ser
contable. Lo que se descarta es lo que no tiene uso contable y sí tiene costo de
cumplimiento.

**La bandera futura `conservar_xml_original`.** Queda **reservada, no creada**
(§8.3, D10a). Si el negocio llega a exigir el XML completo como evidencia,
la columna nace con tres requisitos que no son opcionales:

1. **Retención y borrado.** Un XML firmado no se conserva para siempre: tiene
   que tener una fecha de expiración y un borrado verificable. Sin eso, "no
   guardamos datos personales" deja de ser cierto.
2. **Cifrado en reposo**, y acceso más restringido que el resto del staging,
   porque el XML tiene datos de terceros y no de la agencia.
3. **Decisión explícita y registrada** de quién pidió conservarlo y por qué.

**`conservar_xml_original` no es un `default false` que se pueda poner hoy y
olvidar. Es la puerta de entrada a un manejo de datos personales que hoy el
proyecto no tiene, y por eso el diseño no la abre.*

### 9.7 El mismo concepto existe en el reporte de compras y en el XML

Un documento puede llegar por las dos vías. La identidad de §4.3 lo evita porque
el CUFE es la misma clave; pero si el Excel **no trae CUFE** (columna vacía), la
clave es `REF:<nit>:<tipo>:<numero>:<fecha>` y el choque depende de que número y
fecha coincidan exactamente. Probado: en el reporte real de compras, **las 104
filas traían CUFE**, así que la vía Excel usa la clave fuerte.

## 10. Lo que este diseño NO incluye (a propósito)

- **Ninguna escritura en `asientos_contables`, `asiento_lineas`,
  `cuentas_por_pagar`, `abonos`, `cxp_pagos` ni `retenciones_cxp`.**
- **Ninguna llamada al motor de asientos.**
- **Ningún backfill** histórico.
- **Ninguna definición de periodo cerrado** (§9.5).
- **Ninguna regla tributaria.** No se decide qué retención es deducible ni qué
  cuenta lleva un gasto: eso es decisión humana en la revisión.
- **Ninguna política de RLS implementada** (§6).
- **Ninguna ruta ni UI.**
- **Ninguna modificación del PUC ni de la numeración de asientos** (§9.3, §9.4).

## 11. Preflight / postcheck / prueba futuros

Cuando se apruebe una migración de staging, el repo ya tiene el precedente de
acompañarla con scripts own. Nombres propuestos (no se crean archivos):

**Antes de aplicar (solo lectura)**
- `preflight_staging_dian_lectura.sql` — que no exista ninguna de las 7 tablas;
  que el número de migración esté libre en `main` **y** en las ramas activas;
  cuántas filas hay hoy en `proveedores` sin NIT y con NIT duplicado (alimenta
  D4 y D5); si existe alguna tabla de staging de otro intento.
- `preflight_dedupe_por_base_lectura.sql` — **D11**: sobre el archivo real, contar
  cuántas filas se deduplicarían por `cufecude` y cuántas por
  `proveedor_tipo_numero_fecha`, desglosadas por `tipo_documento`. Si las notas
  caen todas a `REF:`, el CUDE no está llegando y el dedupe de notas no es
  confiable todavía. **Es el único chequeo que puede opcionalmente frenar** la
  migración, y solo si el número de notas es alto.
- `preflight_numeracion_migracion_lectura.sql` — listar los últimos números de
  migración en `supabase/migrations/` y en las ramas con trabajo abierto
  (Vuelos 199/200/201, CRM 202, Tarifas 203).

**Después de aplicar (solo lectura)**
- `postcheck_staging_dian_lectura.sql` — las 7 tablas existen; RLS activa en
  las 7; `anon` sin privilegios; `delete`/`truncate` revocados; el índice
  único parcial de deduplicado existe y está `WHERE estado <> 'duplicado'`, y el
  único de identidad está sobre `(tenant, clave)` (§4.6); el `check` de `tenant` y
  el de `estado` funcionan (probando INSERT que debe fallar dentro de una
  transacción rollback); el trigger de auditoría `trg_auditoria` quedó en las 7
  tablas **y** que no se haya recreado en ninguna otra (§11.1).
- `postcheck_rls_dian_lectura.sql` — con un usuario de cada rol, comprobar que
  ve su tenant y no el otro, y que un `contador` no puede aprobar.

**Pruebas de comportamiento**

Las cinco que importan para el deduplicado. Cada una es un archivo `.sql` de solo lectura que se
ejecuta sobre una base de staging y **revierte al final**:

| Prueba | Qué monta | Qué debe comprobar |
|---|---|---|
| `test_staging_dian_reimportacion_exacta.sql` | El mismo documento dos veces, en dos lotes distintos del mismo tenant | Quedan **dos** filas en `documento_dian_staging`; la primera en `importado`, la segunda en `duplicado` con `duplicado_de` apuntando a la primera; el `documento_dian_identidad` tiene una sola fila con `ocurrencias = 2`; la fila original quedó **intacta** (mismo estado, mismos hijos, misma `actualizado_en`); en `documento_dian_resolucion` hay una entrada con `campo = 'estado'`, `estado_nuevo = 'duplicado'`; el duplicado **no** tiene filas hijas |
| `test_staging_dian_misma_clave_distinto_total.sql` | El mismo CUFE dos veces, la segunda con un total distinto | Quedan **dos** filas y una sola identidad; la primera en `importado`, la segunda en `discrepante` con `discrepante_de`; la segunda **sí** trae líneas e impuestos (se necesitan para comparar, §4.7); la identidad conserva el **primer** total como referencia |
| `test_staging_dian_dos_lotes_simultaneos.sql` | Dos sesiones concurrentes invocando la función de registro con el mismo documento (mismo CUFE, mismo total) en dos lotes distintos | Exactamente **una** fila queda en `importado` y **una** en `duplicado`; la identidad tiene una sola fila; ninguna de las dos sesiones recibe error; el resultado que devuelve cada sesión es coherente con el estado final de su fila. Repetir con totales distintos: una queda `importado` y la otra `discrepante`, y **el `importado` es el que ganó** la carrera, no el que llegó primero |
| `test_staging_dian_append_only.sql` | `delete`, `truncate`, `update` sobre documentos ya insertados, y sobre `documento_dian_resolucion` | Todos fallan por permisos o por trigger; una fila `duplicado` ya escrita no se puede editar ni borrar en ningún caso, y `documento_dian_resolucion` no admite ni `update` ni `delete` |
| `test_staging_dian_tenant.sql` | El mismo documento importado en `mayorista` y en `minorista` | El tenant B **no ve** nada del tenant A: ni el documento, ni su duplicado, ni su bitácora; la identidad de cada tenant es independiente aunque la `clave` sea idéntica; un `contador` de un tenant no lee ni escribe en el otro; `session_tenant` falsificado no cambia el tenant con el que se escribe (§4.5) |

Además, las ya previstas:

- `test_staging_dian_dedupe.sql` — documentos distintos no se chocan.
- `test_staging_dian_formulas.sql` — `total_declarado` = `total_calculado` en las filas leídas
  del archivo real, con la tolerancia de ±0.01.
- `test_staging_dian_lote_reimportado.sql` — **D6 opción A**: el mismo archivo en el
  mismo `(tenant, fuente, periodo)` devuelve advertencia con `lote_anterior_id` y
  **no** crea documentos; el lote previo y sus documentos quedan intactos; el
  mismo archivo en **otro** periodo sí crea un lote nuevo.
- `test_staging_dian_flujo_aprobacion.sql` — **D3**: un documento va de
  `pendiente_revision` a `preparado` a `aprobado`, y cada paso deja su
  `*_por`/`*_rol`/`*_en`. `devuelto` exige motivo y devuelve a
  `pendiente_revision` conservando el histórico en la bitácora. Un documento sin
  `proveedor_id` + `cuenta_puc` **no** llega a `aprobado`. Un `contador` no
  aprueba si la política lo prohíbe, y sí lo hace cuando la política lo permite
  dejando `aprobado_rol = 'contador'`.

**Rollback**
- `rollback_staging_dian.sql` — eliminar las 7 tablas en orden inverso de
  dependencia. Solo es aceptable si no hay nada que conservar: el staging es
  append-only y **no** tiene dependents fuera de sí mismo.

### 11.1 Orden respecto de la migración 202 del CRM

La 202 de CRM (rama `crm-leads-mvp`, sin integrar) **recrea `trg_auditoria` en
todas las tablas de `public`**. Consecuencias para staging:

- Si staging se aplica **después** de que la 202 corra en un ambiente, sus 7
  tablas **no** tengan trigger de auditoría salvo que la 202 lo haga explícitamente.
- Si staging se aplica **antes**, la 202 se lo añadirá.
- El orden entre ramas no está resuelto. Por eso el postcheck debe **verificar**
  el estado del trigger en las 7 tablas en vez de suponerlo.

## 12. Propuesta de migración futura (especificación, sin archivo `.sql`)

> **No se crea ningún archivo `.sql` en esta fase.** Lo que sigue es lo que
> debería contener la migración cuando se aprueben D1–D4 y haya número libre.

**Orden interno previsto**

1. `lote_importacion_dian` (sin dependencias)
2. `documento_dian_identidad` (sin dependencias)
3. `documento_dian_staging` (→ lote, → identidad)
4. `documento_dian_linea_staging` (→ documento, `on delete cascade`)
5. `documento_dian_impuesto_staging` (→ documento, cascade)
6. `documento_dian_retencion_staging` (→ documento, cascade)
7. `documento_dian_forma_pago_staging` (→ documento, cascade)
8. `documento_dian_resolucion` (→ documento, cascade; **append-only**)
9. Funciones helper + policies de las 8
10. Índices, incluido el **único de identidad** y el **parcial de
    deduplicado** (§4.6)
11. Función de registro por documento, con su manejador de excepción (§4.5)
12. Comentarios y `notify pgrst, 'reload schema'`

**Estructura de una migración, por precedente del repo** (`20260601000126_*`):
todo dentro de `begin; … commit;`, `create table if not exists`, `unique (...)`
en la definición, `alter table … enable row level security`, `drop policy if
exists` + `create policy` (idempotente), y `comment on table` en todas.

**Numeración: 204, verificada con red el 2026-10-03**

Verificado con `git fetch origin --prune` y revisando las 10 ramas remotas y los
10 worktrees:

| Ref | n | Última migración |
|---|---|---|
| `origin/main` | 197 | `…00198_fecha_negocio_bogota` |
| `origin/vuelos-fase-c-cierre-199` | 198 | `…00199_cierre_escritura_directa_vuelos` |
| `origin/vuelos-fase-e-historial-200` | 198 | **`…00200_historial_vuelos_inmutable`** |
| otros 7 refs remotos | — | ≤ `…00198` |
| 9 worktrees locales | — | ≤ `…00198` |

**201, 202 y 203 no existen** en ningún ref ni en ningún worktree. La rama del
202 (CRM) ya no existe: la suposición anterior de que estaba reservada estaba
caducada.

El número que corresponde por convención sería **201**, porque el máximo real es
200. Se usa **204** por decisión del usuario, y el hueco 201-203 queda reservado
a propósito para que staging no compita con las fases de Vuelos abiertas. Es una
desviación consciente, no un error de cálculo: si más adelante aparece un 201, el
cambio es renombrar seis archivos.

- Si al revisar aparece otro número ocupado, se renumeran también el rollback,
  el preflight, el postcheck y las dos pruebas, como se hizo con la 198.

**Qué NO debe hacer la migración**

- No crear ni alterar nada en `asientos_contables`, `asiento_lineas`,
  `cuentas_por_pagar`, `puc_cuentas`, `proveedores` ni `abonos`.
- No tocar `puede_ver_tenant` ni ninguna policy de `ventas`, `abonos`,
  `cuentas_por_pagar`, `conciliacion*` o `contabilidad_movimientos`.
- No tocar `usuarios.rol` (los roles nuevos son otra decisión, otra rama y otro
  número).
- No crear vistas ni funciones de contabilización.
- No abrir permisos a `anon` ni cerrar `authenticated` más de lo necesario.

## 13. Referencias

- Campos y formas confirmadas: [`contabilidad-dian.md`](./contabilidad-dian.md)
- Contrato del parser y códigos de problema:
  `lib/contabilidad/dian/tipos.ts`
- Clave de deduplicado y regla de relación: `lib/contabilidad/dian/dedup.ts`
- Fórmula real de la DIAN y su verificación:
  `lib/contabilidad/dian/factura.ts`
- Motor de asientos (intocable en esta fase): [`contabilidad.md`](./contabilidad.md)
- Patrón de RLS por dominio (a seguir, no a ampliar):
  migración `20260601000202_crm_leads.sql` (rama `crm-leads-mvp`, sin integrar)
- Precedente de idempotencia con clave única y manejador de violación:
  migración `20260601000164_condiciones_pago_componente.sql`
  (`registrar_pago_previo`), y el criterio de posteo *best-effort* reintentable
  de la migración `20260601000172_*`
- Precedente de scripts de verificación: `supabase/scripts/diagnostico_*_lectura.sql`

**Aviso de alcance:** este documento describe diseño. Lo que no hace es declarar
cumplimiento de la Ley 1581 de 2012 ni de ninguna otra norma de protección de
datos: la decisión D10 (§9.6) describe una postura técnica —no guardar el XML
completo por defecto—, pero si el negocio llegara a activar
`conservar_xml_original`, la revisión de cumplimiento corresponde a quien
asuma esa responsabilidad, no a este diseño.