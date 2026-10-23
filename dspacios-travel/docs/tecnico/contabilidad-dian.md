# Contabilidad · Importación DIAN — hoja técnica (fase aislada)

> Índice: [`README.md`](./README.md) · Diseño del módulo completo:
> [`../futuro/modulo-contable-independiente.md`](../futuro/modulo-contable-independiente.md) ·
> Motor de asientos: [`contabilidad.md`](./contabilidad.md)

Estado: **fase AISLADA**. Solo hay parser, normalizadores y pruebas. **No hay
migraciones, ni staging, ni rutas, ni roles, ni cambios en el motor contable.**
Este módulo lee texto y devuelve objetos en memoria: no escribe en ninguna base
de datos y no genera ningún asiento.

**Estado de validación:** validado contra documentos reales del usuario —
**26 documentos XML** (facturas, un sobre y una respuesta de la DIAN) y **2
reportes de la DIAN** (503 filas en total). Ver §7, §8 y §9.

---

## 1. Qué hay y qué no hay

| Sí (implementado y probado) | No (fuera de esta fase, requiere decisión) |
|---|---|
| Lectura de XML UBL 2.1 sin dependencias | Tabla de staging |
| Lectura del **sobre `AttachedDocument` de la DIAN** (XML en CDATA) | Lectura/escritura contra Supabase |
| Apertura de `AttachmentBinaryData` (base64 / base64+gzip), sin verificar | Clasificación contra el PUC |
| Normalización de NIT/DV, cédula, CUFE/CUDE, fechas, montos, moneda | Route handler, Server Action o UI |
| Lectura del reporte de la DIAN con los encabezados reales | Idempotencia garantizada por índice único |
| Aritmética real de la DIAN, verificada factura por factura | Cualquier `postearAsiento` o `reemplazarAsiento` |
| Retenciones leídas de las **tres** estructuras que traen los documentos reales, e IVA de `TaxSubtotal` | Rol `contador` / `revisor_fiscal` |
| Huella para comparar documentos y detectar duplicados | Diagnóstico de integridad **ejecutado** (§9) |
| Especificación de la aritmética y sus pendientes | Cualquier regla tributaria (solo se copia lo declarado) |

## 2. Archivos

| Archivo | Qué hace | Dependencias |
|---|---|---|
| `lib/contabilidad/dian/tipos.ts` | Contrato de salida y códigos de problema | ninguna |
| `lib/contabilidad/dian/xml.ts` | Lector XML mínimo, agnóstico de namespace | ninguna |
| `lib/contabilidad/dian/normalizar.ts` | NIT/DV, CUFE, fecha, monto, moneda, encabezados | ninguna |
| `lib/contabilidad/dian/adjunto.ts` | Abre `<AttachmentBinaryData>` (base64 / gzip) | `node:zlib` |
| `lib/contabilidad/dian/factura.ts` | Documento DIAN → `DocumentoDian` | `xml`, `normalizar`, `adjunto` |
| `lib/contabilidad/dian/excel.ts` | Filas del reporte DIAN → `DocumentoDian[]` | `normalizar` |
| `lib/contabilidad/dian/dedup.ts` | Clave de comparación y relación entre documentos | `normalizar` |
| `pruebas/dianXml.test.ts` | 28 pruebas: lector, factura, notas, adjunto | — |
| `pruebas/dianNormalizar.test.ts` | 18 pruebas: normalizadores | — |
| `pruebas/dianExcel.test.ts` | 24 pruebas: TSV, CSV, HTML, reporte de ventas y de compras | — |
| `pruebas/dianReal.test.ts` | 19 pruebas contra la ESTRUCTURA real de la DIAN, incluidas las 3 formas de retención | — |
| `supabase/scripts/diagnostico_cxp_asientos_lectura.sql` | Integridad `cxp` ↔ asientos, **solo lectura** | — |

## 3. Contrato de salida

Todo entra como texto y sale con la misma forma, sea que venga de un XML o de
una fila del reporte.

```ts
type ResultadoDocumento =
  | { ok: true;  documento: DocumentoDian; problemas: ProblemaDian[] }
  | { ok: false; documento: DocumentoDian | null; problemas: ProblemaDian[] };
```

`ok` decide si el documento puede seguir al siguiente paso de la bandeja.
Cuando `ok` es `false`, `documento` puede seguir siendo `null` (el XML no se
pudo leer) o un objeto parcial (se leyó pero le falta algo indispensable).

### `DocumentoDian`

| Campo | Qué es | Vacío cuando… |
|---|---|---|
| `cufe` / `cude` | Identificador del documento (factura / nota) | no parece un CUFE (`< 40` caracteres) |
| `tipoDocumento` | `factura` \| `nota_credito` \| `nota_debito` | nunca: por defecto `factura` en el reporte |
| `numero` | Número del documento, con el prefijo si viene aparte | el documento no lo trae |
| `fecha` | `YYYY-MM-DD` | no se pudo leer (**error**) |
| `proveedor` | `nit`, `dv`, `identificacion`, `tipoIdentificacion`, `nombre`, `pais` | sin identificación legible (**error**) |
| `sujeto` | Misma forma, para a quién se le compró | el reporte no lo trae |
| `moneda` | ISO 4217 (`COP`, `USD`, …) | no se reconoce (**error**) |
| `divisa` | `cac:PaymentExchangeRate`: origen, destino, fecha, tasa | el documento no trae cambio |
| `aritmetica` | Ver abajo | nunca: siempre viene, con `diferencia` |
| `impuestos` / `retenciones` | Lo declarado, con base y tasa | el documento no lo trae |
| `formasPago` | `PaymentMeansCode`, fecha y monto | el documento no lo trae |
| `lineas` | Cantidad, precio, base, descuento, cuenta del emisor | no trae `InvoiceLine` |
| `software` / `xml` / `originales` | Trazabilidad de la fuente | siempre presentes |

**`proveedor.nit` y `proveedor.identificacion` son cosas distintas.** Un NIT
tiene 9 dígitos (o 10 = NIT + DV). Hay documentos de personas naturales cuyo
identificador es una cédula de 8: ahí `nit` queda en `null` y la información
vive en `identificacion` + `tipoIdentificacion`, **sin error**. El staging
tiene que decidir qué hacer con un proveedor sin NIT (decisión de negocio).

### `aritmetica`

```ts
{ subtotal,       // LineExtensionAmount: la suma de las líneas
  baseGravable,   // TaxExclusiveAmount, o null si el documento no lo declara
  descuentos, cargos, anticipos, redondeo,
  impuestos, retenciones,
  totalCalculado, // aplicando la fórmula real
  totalDeclarado, // PayableAmount
  diferencia }
```

**Fórmula real de la DIAN, verificada factura por factura en 17 documentos:**

```
PayableAmount = LineExtensionAmount − AllowanceTotalAmount + ChargeTotalAmount
              + Σ TaxSubtotal.TaxAmount − PrepaidAmount + PayableRoundingAmount
```

Dos cosas que los documentos reales desmintieron y que el código respeta:

1. **La base es `LineExtensionAmount`, NO `TaxExclusiveAmount`.** Hay facturas
   donde el primero es 1.181.120 y el segundo 31.000 (líneas exentas). Usar el
   segundo descuadra el documento.
2. **Hay varios `cac:TaxTotal` en la cabecera y todos suman.** En una factura
   real el segundo bloque era "INC" al 8 %, y el documento lo sumaba al payable.

### Códigos de problema

Estructurales: `XML_VACIO`, `XML_MAL_FORMADO`, `XML_RAIZ_NO_RECONOCIDA`,
`ADJUNTO_AUSENTE`, `ADJUNTO_VACIO`, `ADJUNTO_INVALIDO`, `ADJUNTO_NO_ES_XML`,
`FILA_SIN_COLUMNAS`, `ENCABEZADO_DESCONOCIDO`.

De campo: `CAMPO_AUSENTE`, `CAMPO_VACIO`, `CAMPO_AMBIGUO`, `NIT_INVALIDO`,
`CUFE_INVALIDO`, `NUMERO_INVALIDO`, `FECHA_INVALIDA`, `FECHA_FUTURA`,
`MONEDA_INVALIDA`, `MONTO_INVALIDO`, `TOTAL_NO_CUADRA`.

Severidad `error` = no sigue. `aviso` = sigue, pero alguien tiene que mirarlo.

### Resultado del reporte

```ts
type ResultadoLote = {
  columnas: Record<string, number> | null;  // el mapa que se usó
  cabecerasOriginales: string[];
  documentos: DocumentoDian[];
  rechazadas: FilaRechazada[];                // índice, celdas y motivos
  problemas: ProblemaDian[];
};
```

**Nada se descarta en silencio.** Una fila que no se puede leer aparece en
`rechazadas` con su número y sus celdas originales.

## 4. Decisiones que el código toma (y por qué)

1. **El lector de XML ignora el namespace.** La DIAN y cada software contable
   prefijan distinto (`cbc:`, `cac:`, `ext:`, `sts:`, `ipt:`, `xades:`).
2. **Los datos de cabecera se leen de los HIJOS DIRECTOS de la raíz**, no de
   todo el árbol. Una factura en moneda extranjera mete
   `ext:UBLExtensions/…/ForeignCurrency` con sus propios `ID` ("0"), `TaxTotal`
   y `LegalMonetaryTotal`, y como el bloque va primero, una búsqueda global
   devuelve los montos de la OTRA divisa. Esto se midió en 2 facturas reales.
3. **`normalizarMonto` devuelve `null`, nunca `0`, cuando no puede leer.** Un
   total ilegible tratado como cero hace cuadrar una compra que no cuadra.
4. **`soloDigitos` no conserva letras.** Una columna de NIT con `"SIN NIT"`
   queda vacía, no se convierte en un NIT de seis letras.
5. **Un año de 2 dígitos NO se completa.** `"2/3/26"` → `null`: el siglo es una
   decisión de negocio (periodo de corte).
6. **La identificación no se busca como "el primer `ID`".** Dentro de la misma
   `Party` hay un `cac:TaxScheme/cbc:ID` con el código del impuesto ("01" = IVA)
   que se colaba como NIT. Se lee `PartyIdentification/ID`,
   `PartyTaxScheme/CompanyID` y `PartyLegalEntity/CompanyID`, en ese orden.
7. **El `schemeID` solo descarta, nunca confirma.** Los valores que traen los
   documentos reales no son consistentes entre emisores ("0", "5", "6" para NIT;
   "4" para cédula), así que no se puede mapear valor → "es NIT". Solo se
   respeta cuando dice claramente que NO lo es (`CC`, `CE`, `PAS`…).
8. **La cuenta contable de la línea es la del EMISOR**, no el PUC de D'spacios.
9. **El reporte no declara a quién se compró**: `sujeto` queda vacío.
10. **Si el encabezado no se reconoce, no se inventa un mapeo**: se devuelve
    `ENCABEZADO_DESCONOCIDO` con las cabeceras que sí se leyeron. Así se comportó con el reporte real: 0 documentos en vez de 399 inventados.

## 4.b Tratamiento de las retenciones

Se leen **tres** estructuras distintas, todas confirmadas en archivos reales:

| # | Estructura | Dónde | Confirmado |
|---|---|---|---|
| 1 | UBL | `Retain` dentro de `TaxTotal`; `LegalTotal` / `WithholdingTaxTotal` con `TotalRetain` / `TotalTaxRetained` | Sí (lectura) |
| 2 | Bloque DIAN heredado | `ReteFueCop`, `ReteIvaCop`, `ReteIcaCop` dentro de `TotalesCop`, como **elementos con texto** | Sí, **siempre en 0 o vacío** |
| 3 | Bloque de software | `<CustomField Name="…" Value="…"/>`: `BaseRetencion`, `Retencion`, `ReteFuenteAmount`, `ReteIvaAmount`, `TotalRetenciones`, `TotalReteFuente`, `TotalReteIva`, `TotalReteIca` | Sí; **el nombre y el valor van en ATRIBUTOS**, no en texto de elemento |

Tres decisiones deliberadas:

1. **No se decide si un bloque es retención o impuesto.** Que el emisor lo llame
   "INC", "8 %" o "Total Retencion" es cosa suya; aquí se copia lo declarado con
   su nombre (`codigo` + `nombre`) y el contador decide.
2. **Una retención declarada en 0 SÍ aparece en la lista**, con su base. Que el
   documento declare la línea, aunque valga cero, es información. Lo que se
   descarta son las líneas **vacías**.
3. **Las retenciones NO se restan de `totalCalculado`.** En los 26 documentos
   reales todas vinieron en 0, así que el signo no está verificado; y el único
   bloque "de retención" con valor (INC al 8 %) lo **sumaba** al payable.
   Restarlas sin evidencia produciría un `TOTAL_NO_CUADRA` falso.

> ⚠️ **Riesgo abierto:** por (3), una retención real queda **invisible** en la
> conciliación: `totalCalculado` no la incluye y por tanto **no dispara
> `TOTAL_NO_CUADRA`**. Solo se ve en `aritmetica.retenciones`. Se cierra con un
> documento real que traiga retención en valor, decidiendo si suma o resta.

## 5. Duplicados: qué hay y qué NO hay

`dedup.ts` produce una clave estable:

- Con CUFE/CUDE reconocible → `CUFE:<id>`.
- Sin él → `REF:<nit>:<tipo>:<numero>:<fecha>`.

Y clasifica un documento contra otro ya visto como `nuevo`, `duplicado` (misma
clave y mismo total) o `discrepante` (misma clave y **total distinto**).

> **Esto NO es idempotencia.** Hoy no existe ninguna restricción en base de
> datos que la aplique, y este módulo no crea ninguna. Además el motor actual
> tiene dos debilidades ya detectadas en la auditoría y que esta fase **no**
> toca (ver `docs/futuro/modulo-contable-independiente.md`):
> `asientos_contables` no tiene índice único sobre `(tenant, origen, referencia)`
> y su numeración se calcula leyendo el máximo y sumando uno. Antes del primer
> lote DIAN ambos deben resolverse.

## 6. Límites conocidos

- **Una hoja `.xlsx` real no se abre.** Es un ZIP con XML dentro y haría falta
  una dependencia. Para validar el lector sobre el reporte real se exportó a
  TSV con una herramienta externa; el módulo solo acepta **texto** (TSV, CSV o
  la tabla HTML de "guardar como página web").
- **Un ZIP dentro de `AttachmentBinaryData` no se abre**: se reporta con el
  motivo y se pide el XML ya descomprimido.
- **El camino `AttachmentBinaryData` (base64) NO apareció en ninguna factura
  real.** El módulo lo soporta porque la respuesta de la DIAN
  (`ApplicationResponse`) lo usa, pero no está verificado contra un caso real de
  factura. Ver §8.
- **Los `ID` que empiezan por `<` dentro de `Description` no se abren**: si un
  emisor metiera el XML sin CDATA, el lector lo trataría como marcado.
- **No se valida contra el esquema XSD de la DIAN.**
- **No se valida ninguna regla tributaria.** IVA, retenciones e exenciones se
  copian tal como el emisor las declara.
- **El reporte parte las retenciones en varias columnas** ("Rete IVA", "Rete
  Renta", "Rete ICA") y el mapa toma **solo la primera**. Sumarlas está
  pendiente (§8).
- **El runner de pruebas tiene una peculiaridad**: con Node 24 +
  `--experimental-strip-types`, un binding de módulo no es visible desde otro
  binding del mismo archivo si ambos se usan dentro de un `test()`, y una cadena
  que empieza en el valor devuelto por un módulo importado (`modulo().prop`)
  falla con `ReferenceError`. Los ayudantes de prueba se declaran y usan en un
  solo bloque. Le avisamos al usuario para que otro agente no se tropiece.

## 7. Campos CONFIRMADOS contra documentos reales

Verificados en 26 documentos XML (facturas, un sobre y una respuesta de la DIAN) y en los dos reportes de la DIAN.

| Campo | Dónde está en el documento real | Nota |
|---|---|---|
| CUFE | `cbc:UUID` hijo directo de la raíz, `schemeName="CUFE-SHA384"` | **96 caracteres**, no 64 |
| Número de documento | `cbc:ID` hijo directo de la raíz | con el prefijo en `sts:AuthorizedInvoices/sts:Prefix` |
| Fecha de emisión | `cbc:IssueDate` + `cbc:IssueTime` separados | se recorta al día |
| Fecha de vencimiento | `cbc:DueDate` / `PaymentMeans/cbc:PaymentDueDate` | — |
| Moneda | `cbc:DocumentCurrencyCode` | `COP` en las 15 |
| Cambio de divisa | `cac:PaymentExchangeRate` | `SourceCurrencyCode`, `TargetCurrencyCode`, `CalculationRate`, `Date` |
| NIT + DV | `cac:PartyTaxScheme/cbc:CompanyID` (y `PartyLegalEntity`) | 9 o 10 dígitos |
| Cédula / CE | mismo campo con `schemeID="4"` y 8 dígitos | **sin NIT y sin error** |
| Razón social | `cac:PartyName/cbc:Name`, o `PartyTaxScheme/RegistrationName` | — |
| IVA | `cac:TaxTotal/cac:TaxSubtotal` → `TaxableAmount`, `TaxAmount`, `TaxCategory/Percent`, `TaxCategory/TaxScheme/ID` | `Percent` ya es porcentaje (19.00) |
| Otros impuestos | **segundo** `cac:TaxTotal` de cabecera | ej. `TaxScheme/ID="04"` "INC" al 8 % |
| Base gravable | `cbc:TaxExclusiveAmount` | **distinta** de la suma de líneas |
| Suma de líneas | `cbc:LineExtensionAmount` | es la base de la fórmula |
| Total | `cbc:PayableAmount` | manda sobre `TaxInclusiveAmount` |
| Descuento / cargo | `AllowanceTotalAmount` / `ChargeTotalAmount` | presentes en 8 de 15 |
| Anticipos / redondeo | `PrepaidAmount` / `PayableRoundingAmount` | siempre 0 en las reales |
| Forma de pago | `cac:PaymentMeans/cbc:PaymentMeansCode` | 45, 31, 48, 50, 10, 1 — el `ID` es un consecutivo |
| Línea | `InvoicedQuantity`, `LineExtensionAmount`, `Price/PriceAmount`, `Item/Description` | `AccountingAccount` no viene en estas facturas |
| Código de ítem | `cac:Item/cac:StandardItemIdentification/cbc:ID` | UNSPSC, no implementado |
| **Sobre** | `AttachedDocument` + `cac:Attachment/cac:ExternalReference/cbc:Description` con **CDATA** | **14 de 15 facturas** llegan así |
| **Reporte de ventas** | `Tipo de documento`, `CUFE/CUDE`, `Folio`, `Prefijo`, `Divisa`, `Forma de Pago`, `Fecha Emisión`, `NIT Emisor`, `Nombre Emisor`, `IVA`, `Rete IVA`, `Total` | 399 filas leídas |
| **Reporte de COMPRAS** | `Identificación Emisor Factura`, `Nombre Emisor Factura`, `Fecha Emisión`, `Valor Facturado`, `Valor Notas Crédito`, `Valor Notas Débito`, `Valor Factura / Afectada con Notas Débito - Crédito`, `Valor Susceptible Beneficio`, `Medios De Pago`, `Num_factura_venta`, `CUFE (Codigo único De Factura Electrónica)` | 104 filas leídas |
| **Preámbulo del reporte** | hasta 13 filas de metadatos y advertencias **antes** de la tabla | por eso el encabezado se busca en todo el texto, no solo en las primeras filas |
| **Pie del reporte** | una sola celda de texto ("104 Facturas procesadas…") | se salta: una fila con menos de 2 celdas con contenido no puede ser un documento |
| **Base de retención** | `CustomField Name="BaseRetencion"` | **sí trae valor** en documentos reales (p. ej. 1.831.932,78) |

## 8. Campos y casos TODAVÍA inciertos

| Pendiente | Por qué sigue pendiente |
|---|---|
| **Nota crédito y nota débito** | **No hay ni un solo XML de nota en todo `Downloads`.** Las 26 facturas son `Invoice`. La regla actual (`cude` desde el `cbc:ID` de la raíz, `numero` desde `ReferenceID`) sigue basada en práctica, **no verificada**. El reporte de ventas trae 6 filas "Nota crédito", pero sin XML que contrastar |
| **Retenciones con valor** | Las **tres** estructuras están confirmadas, pero **ningún documento real trae un importe distinto de cero**. Falta un caso real para decidir si la retención suma o resta del total (§4.b) |
| **`Rete Renta` / `Rete ICA` del reporte** | El mapa de columnas toma una sola columna por campo; sumar las tres está pendiente |
| **`ApplicationResponse` (respuesta de la DIAN)** | Se rechaza con `XML_RAIZ_NO_RECONOCIDA` y un mensaje claro. Falta decidir si la bandeja debe ofrecerla como **constancia de aceptación** de una factura |
| **CUFE de 24 caracteres** | Una factura real trae un `cbc:UUID` de 24 caracteres, que no es un CUFE. El parser lo rechaza con aviso (correcto), pero **no sabemos dónde está su CUFE real** |
| **`cac:AccountingAccount` de la línea** | No aparece en ninguna de las 15. El parser lo soporta si existe, sin verificar |
| **Moneda extranjera propiamente dicha** | Las 26 facturas están en COP. Lo que hay es un bloque `ForeignCurrency` con totales en otra divisa; los montos de la factura siguen en COP y el `CalculationRate` se registra en `divisa` |
| **`InvoiceTypeCode` y notas** | Se leen pero no se usan: qué códigos significan qué es una decisión de negocio |
| **Columnas de notas del reporte de compras** | `Valor Notas Crédito`, `Valor Notas Débito` y `Valor Factura / Afectada con Notas…` no se usan: el total es `Valor Facturado`. En el archivo real todas valían 0, así que no hay evidencia de cómo se combinan con el total |
| **Identificador en `PartyIdentification/ID`** | Un documento real lo trae con `schemeID="NIT"` y otro con `schemeID="CC"`; funciona, pero los `schemeID` no son consistentes entre emisores |
| **La respuesta de la DIAN como fuente de verdad** | El XML de la factura y el del sobre son el mismo documento; falta decidir cuál se guarda como fuente en el staging |

## 9. Cómo se ejecuta el diagnóstico de integridad

```bash
# NO se ejecuta automáticamente: es SOLO LECTURA y el usuario lo corre.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/diagnostico_cxp_asientos_lectura.sql
```

**El script NO se ha ejecutado.** No hay `psql` ni Postgres local en la máquina
donde se escribió. Antes de correrlo: las filas 3, 4 y 12 son las que deciden si
una reconstrucción histórica es viable.

## 10. Estado de verificación

| Comprobación | Resultado |
|---|---|
| `npm run test:unit` | **5180/5180**, 0 fallos (88 pruebas del módulo DIAN) |
| `npx tsc --noEmit` | 0 errores |
| `npx eslint` sobre los archivos del módulo | 0 errores, 0 advertencias |
| 26 documentos XML reales de la DIAN | 25 facturas + 1 sobre leídos; las 25 cuadran con `diferencia = 0`, 0 con error |
| Respuesta de la DIAN (`ApplicationResponse`) | rechazada con mensaje (no es una factura) |
| Reporte real de VENTAS (399 filas) | 399 documentos, 0 rechazados, con CUFE, NIT, fecha y total |
| Reporte real de COMPRAS (104 filas) | 104 documentos, 0 rechazados, con CUFE, NIT, fecha y total |
| Retenciones | las 3 estructuras se leen; **ningún documento real trae importe distinto de cero** |
| Build / `test:react` | No ejecutados: nada de esto toca React ni rutas |