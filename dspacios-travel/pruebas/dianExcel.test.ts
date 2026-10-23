// Pruebas del lector del Excel de la DIAN. El diseño exige que la importación
// NO asuma que las columnas son siempre las mismas, así que aquí se prueban las
// tres formas de pegar (TSV de Excel, CSV y tabla HTML), el reconocimiento de
// encabezados por alias, y —lo más importante— que una fila que no se puede
// leer termine en `rechazadas` con su motivo y NO desaparezca.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseExcelDian } from "../lib/contabilidad/dian/excel.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CABECERA = "NIT\tDV\tFECHA\tTIPO DE DOCUMENTO\tNUMERO\tPROVEEDOR\tMONEDA\tSUBTOTAL\tIVA\tVALOR TOTAL";
const FILA_1 = "900123456\t7\t2026-03-02\tFactura\tFE-001\tHOTEL CARIBE LTDA\tCOP\t1000000\t190000\t1190000";
const FILA_2 = "800765432\t1\t2026-03-05\tFactura\tFE-002\tAGENCIA VIAJES SUR\tCOP\t500000\t95000\t595000";

const TSV_DIARIO = [CABECERA, FILA_1, FILA_2].join("\n");

const CSV_PUNTO_Y_COMA = [
  '"NIT","FECHA","TIPO DOCUMENTO","NUMERO","RAZON SOCIAL","MONEDA","VALOR TOTAL"',
  '"900123456-7","02/03/2026","Factura de venta","FE-001","HOTEL CARIBE LTDA","$","1.190.000,00"',
].join("\n");

const HTML_EXPORT = `<html><body><table>
<tr><td>NIT</td><td>FECHA</td><td>NUMERO</td><td>PROVEEDOR</td><td>VALOR TOTAL</td></tr>
<tr><td>900123456</td><td>2026-03-02</td><td>FE-001</td><td>HOTEL CARIBE<br/>LTDA</td><td>1.190.000</td></tr>
</table></body></html>`;

// ── Reconocimiento de encabezados ───────────────────────────────────────────

test("excel: TSV con encabezados conocidos produce un documento por fila", () => {
  const r = parseExcelDian(TSV_DIARIO);
  assert.equal(r.documentos.length, 2);
  assert.equal(r.rechazadas.length, 0);
  const d = r.documentos[0];
  assert.equal(d.proveedor.nit, "900123456");
  assert.equal(d.proveedor.dv, "7");
  assert.equal(d.fecha, "2026-03-02");
  assert.equal(d.tipoDocumento, "factura");
  assert.equal(d.numero, "FE-001");
  assert.equal(d.proveedor.nombre, "HOTEL CARIBE LTDA");
  assert.equal(d.aritmetica.totalDeclarado, 1190000);
  assert.equal(d.aritmetica.diferencia, 0, "1000000 + 190000 cuadra con 1190000");
});

test("excel: devuelve el mapa de columnas que usó, para poder mostrarlo", () => {
  const r = parseExcelDian(TSV_DIARIO);
  assert.ok(r.columnas);
  assert.equal(r.columnas.nit, 0);
  assert.equal(r.columnas.total, r.cabecerasOriginales.length - 1);
});

test("excel: encabezado desconocido NO se inventa, se reporta con lo que se leyó", () => {
  const r = parseExcelDian("COLUMNA A\tCOLUMNA B\tCOLUMNA C\n1\t2\t3");
  assert.equal(r.documentos.length, 0);
  assert.equal(r.rechazadas.length, 0, "sin encabezado no se rechaza fila por fila: no hay filas que leer");
  const p = r.problemas.find((x) => x.codigo === "ENCABEZADO_DESCONOCIDO");
  assert.ok(p, "debe avisar que no reconoció el encabezado");
  assert.deepEqual(r.cabecerasOriginales, ["COLUMNA A", "COLUMNA B", "COLUMNA C"]);
});

test("excel: el encabezado puede no estar en la primera fila (títulos del reporte)", () => {
  const conTitulos = ["REPORTE DE ADQUISICIONES DIAN", "Periodo: 2026-03", CABECERA, FILA_1].join("\n");
  const r = parseExcelDian(conTitulos);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].numero, "FE-001");
});

test("excel: encabezado sin acentos ni mayúsculas también se reconoce", () => {
  const raro = "nit\tfecha\tnúmero de documento\trazón social\tvalor total\n900123456\t2026-03-02\tFE-001\tHOTEL\t1190000";
  const r = parseExcelDian(raro);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].proveedor.nombre, "HOTEL");
});

// ── Separadores ──────────────────────────────────────────────────────────────

test("excel: CSV con coma y decimal colombiano", () => {
  const r = parseExcelDian(CSV_PUNTO_Y_COMA);
  assert.equal(r.documentos.length, 1);
  const d = r.documentos[0];
  assert.equal(d.proveedor.nit, "900123456");
  assert.equal(d.proveedor.dv, "7", "el DV pegado al NIT se separa");
  assert.equal(d.fecha, "2026-03-02", "dd/mm/aaaa con año de 4 cifras");
  assert.equal(d.moneda, "COP", '"$" se reconoce como COP');
  assert.equal(d.aritmetica.totalDeclarado, 1190000, '"1.190.000,00" es un millón ciento noventa mil');
});

test("excel: tabla HTML de un 'guardar como página web'", () => {
  const r = parseExcelDian(HTML_EXPORT);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].proveedor.nombre, "HOTEL CARIBE LTDA", "el <br/> se vuelve un espacio, no parte el nombre");
  assert.equal(r.documentos[0].aritmetica.totalDeclarado, 1190000);
});

test("excel: texto vacío", () => {
  const r = parseExcelDian("   ");
  assert.equal(r.documentos.length, 0);
  assert.equal(r.problemas[0]?.codigo, "FILA_SIN_COLUMNAS");
});

// ── Filas que no se pueden leer ──────────────────────────────────────────────

test("excel: una fila sin NIT va a `rechazadas`, con su motivo, no se pierde", () => {
  const conMala = [CABECERA, FILA_1, "SIN NIT\t\t2026-03-09\tFactura\tFE-009\tX\tCOP\t100\t19\t119"].join("\n");
  const r = parseExcelDian(conMala);
  assert.equal(r.documentos.length, 1, "la fila buena sí entra");
  assert.equal(r.rechazadas.length, 1);
  assert.equal(r.rechazadas[0].indice, 2, "la segunda fila de datos");
  assert.ok(r.rechazadas[0].problemas.some((p) => p.codigo === "NIT_INVALIDO"));
  assert.equal(r.rechazadas[0].celdas[4], "FE-009", "se conserva la fila original para poder revisarla");
});

test("excel: una fila sin total va a `rechazadas`", () => {
  const conMala = [CABECERA, "900123456\t7\t2026-03-02\tFactura\tFE-001\tX\tCOP\t100\t19\tN/A"].join("\n");
  const r = parseExcelDian(conMala);
  assert.equal(r.documentos.length, 0);
  assert.equal(r.rechazadas.length, 1);
  assert.ok(r.rechazadas[0].problemas.some((p) => p.codigo === "MONTO_INVALIDO"));
});

test("excel: una fila con total que no cuadra con el desglose entra, pero con aviso", () => {
  const fila = "900123456\t7\t2026-03-02\tFactura\tFE-001\tX\tCOP\t1000000\t190000\t999000";
  const r = parseExcelDian([CABECERA, fila].join("\n"));
  assert.equal(r.documentos.length, 1, "una diferencia de total no debe rechazar la fila");
  assert.equal(r.documentos[0].aritmetica.diferencia, 999000 - 1190000);
  assert.ok(r.problemas.some((p) => p.codigo === "TOTAL_NO_CUADRA" && p.severidad === "aviso"));
});

test("excel: fila de totales de Excel se salta sin quejarse", () => {
  const conTotales = [CABECERA, FILA_1, "TOTAL\t\t\t\t\t\t\t1000000\t190000\t1190000"].join("\n");
  const r = parseExcelDian(conTotales);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.rechazadas.length, 0);
});

// ── Notas crédito y prefijo/número ───────────────────────────────────────────

test("excel: nota crédito toma CUDE y no CUFE", () => {
  const cude = "CUDE" + "0123456789ABCDEF".repeat(3) + "GHIJK";
  const linea = `900123456\t7\t2026-03-10\tNota crédito\tNC-001\tHOTEL CARIBE\tCOP\t100000\t0\t100000\t${cude}`;
  const cab = "NIT\tDV\tFECHA\tTIPO DE DOCUMENTO\tNUMERO\tPROVEEDOR\tMONEDA\tSUBTOTAL\tIVA\tVALOR TOTAL\tCUFE";
  const r = parseExcelDian([cab, linea].join("\n"));
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].tipoDocumento, "nota_credito");
  assert.equal(r.documentos[0].cude, cude);
  assert.equal(r.documentos[0].cufe, null);
});

test("excel: prefijo y número en columnas separadas se unen", () => {
  const cab = "NIT\tFECHA\tPREFIJO\tNUMERO\tPROVEEDOR\tVALOR TOTAL";
  const linea = "900123456\t2026-03-02\tFE\t001\tHOTEL\t1190000";
  const r = parseExcelDian([cab, linea].join("\n"));
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].numero, "FE-001");
});

test("excel: sin columna CUFE el documento entra igual, con aviso", () => {
  const r = parseExcelDian(TSV_DIARIO);
  assert.equal(r.documentos.length, 2);
  assert.equal(r.documentos[0].cufe, null);
  assert.equal(r.documentos[0].numero, "FE-001", "el número sigue siendo la referencia");
});

test("excel: el sujeto queda vacío (el Excel de compras no dice a quién se compró)", () => {
  const r = parseExcelDian(TSV_DIARIO);
  assert.equal(r.documentos[0].sujeto.nombre, null);
  assert.equal(r.documentos[0].sujeto.nit, null);
});

// ── Encabezados del reporte real de la DIAN ─────────────────────────────────
//
// Estos nombres NO son inventados: son los del reporte de documentos
// electrónicos que descarga el usuario del portal de la DIAN. Con la lista de
// alias anterior solo se reconocían 6 de las 12 columnas necesarias y el parser
// se negaba a adivinar (ENCABEZADO_DESCONOCIDO, 0 documentos), que es lo
// correcto, pero inútil.

const CABECERA_DIAN = [
  "Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Divisa", "Forma de Pago", "Medio de Pago",
  "Fecha Emisión", "Fecha Recepción", "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor",
  "IVA", "ICA", "IC", "INC", "Timbre", "INC Bolsas", "IN Carbono", "IN Combustibles", "IC Datos", "ICL",
  "INPP", "IBUA", "ICUI", "Rete IVA", "Rete Renta", "Rete ICA", "Total", "Estado", "Grupo",
].join("\t");

const CUFE_DIAN = "1962A761E802468EBF9E3298BF0A850970D3EAF9DC491A09D66F4E8133DA3011783FBAD519748FBBEC97E37C5B42EAC2";

const FILA_DIAN = [
  "Factura electrónica", CUFE_DIAN, "117", "FE", "COP", "1", "42",
  "31-12-2025", "2025-12-31T13:55:18", "901654224", "PROVEEDOR DE PRUEBA SA", "41908420", "CLIENTE DE PRUEBA",
  "1900000", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0",
  "10660000", "Aprobado con notificación", "Emitido",
].join("\t");

test("excel: los encabezados reales de la DIAN se reconocen", () => {
  const r = parseExcelDian([CABECERA_DIAN, FILA_DIAN].join("\n"));
  assert.ok(r.columnas, "el encabezado debe reconocerse con los nombres reales");
  assert.equal(r.documentos.length, 1, JSON.stringify(r.problemas.map((p) => p.codigo)));
  assert.equal(r.rechazadas.length, 0);

  const d = r.documentos[0];
  assert.equal(d.cufe, CUFE_DIAN, "CUFE/CUDE con barra se reconoce como cufe");
  assert.equal(d.numero, "FE-117", "Prefijo + Folio se unen");
  assert.equal(d.fecha, "2025-12-31", "dd-mm-aaaa se lee");
  assert.equal(d.proveedor.nit, "901654224");
  assert.equal(d.proveedor.nombre, "PROVEEDOR DE PRUEBA SA");
  assert.equal(d.moneda, "COP");
  assert.equal(d.aritmetica.totalDeclarado, 10660000);
});

test("excel: sin columna de base, el total se usa como subtotal y la base queda en null", () => {
  const r = parseExcelDian([CABECERA_DIAN, FILA_DIAN].join("\n"));
  const d = r.documentos[0];
  assert.equal(d.aritmetica.subtotal, 10660000, "el reporte no trae base: se usa el total");
  assert.equal(d.aritmetica.baseGravable, null, "no se inventa una base gravable que el reporte no declara");
  assert.equal(d.aritmetica.diferencia, 0);
  assert.ok(!r.problemas.some((p) => p.codigo === "TOTAL_NO_CUADRA"), "sin desglose no hay descuadre que avisar");
});

test("excel: una nota crédito del reporte real se marca como tal", () => {
  const fila = FILA_DIAN.replace("Factura electrónica", "Nota crédito").replace(/^([^\t]*)\t/, "$1\t");
  const r = parseExcelDian([CABECERA_DIAN, fila].join("\n"));
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].tipoDocumento, "nota_credito");
  assert.equal(r.documentos[0].cude, CUFE_DIAN);
  assert.equal(r.documentos[0].cufe, null, "en una nota el identificador es CUDE, no CUFE");
});

test("excel: el reporte parte las retenciones en varias columnas y solo se toma la primera", () => {
  // LIMITACIÓN CONOCIDA: el reporte trae "Rete IVA", "Rete Renta" y "Rete ICA"
  // por separado. El mapa de columnas toma la primera que encuentra, así que
  // "Rete Renta" y "Rete ICA" NO se suman todavía. Queda anotado en la hoja
  // técnica como pendiente, no se disimula.
  const r = parseExcelDian([CABECERA_DIAN, FILA_DIAN].join("\n"));
  assert.equal(r.columnas?.retencion, 26, "columna 'Rete IVA'");
  assert.equal(r.cabecerasOriginales[27], "Rete Renta");
  assert.equal(r.cabecerasOriginales[28], "Rete ICA");
  assert.equal(r.documentos[0].aritmetica.retenciones, 0, "las tres están en cero en este ejemplo");
});

// ── Reporte de COMPRAS: "Informe de Facturas electrónicas adquiridas por año" ─
//
// Este reporte trae 13 filas de metadatos y de advertencia ANTES de la tabla
// (año gravable, tipo de documento del adquirente, tres párrafos, un link). Con
// el código anterior, que solo miraba las primeras 6 filas, devolvía
// ENCABEZADO_DESCONOCIDO y 0 documentos.

const CABECERA_COMPRAS = [
  "Identificación Emisor Factura", "Nombre Emisor Factura", "Fecha Emisión",
  "Valor Facturado", "Valor Notas Crédito", "Valor Notas Débito",
  "Valor Factura / Afectada con Notas Débito - Crédito", "Valor Susceptible Beneficio",
  "Medios De Pago", "Num_factura_venta", "CUFE (Codigo único De Factura Electrónica)",
].join("\t");

const PREAMBULO_COMPRAS = [
  "Nombre\tInforme de Facturas electrónicas adquiridas por año",
  "Corte\tEsta información se generó con fecha de corte 31 de enero de 2025",
  "Año Gravable\t2024",
  "Tipo Documento Adquiriente\t13 Cédula de Ciudadanía",
  "Doc Identificacion Adq.\t800000001",
  "NIT\t900000000",
  "Nombre o razón social\tCONTRIBUYENTE DE PRUEBA",
  "Aviso: esta información corresponde a la fecha de corte del proceso.",
  "Es importante tener presente que la información reportada es orientativa.",
  "Definiciones de los medios de pago: 1. Efectivo 2. Electrónico.",
  "Link micrositio:",
  "https://micrositios.dian.gov.co/ejemplo/",
].join("\n");

const FILA_COMPRAS = [
  "811045607", "PROVEEDOR DE PRUEBA SA", "2024-08-17", "62996", "0", "0",
  "62996", "62996", "Electrónicos", "10LB56950",
  "E5D1D26A" + "B".repeat(88),
].join("\t");

test("excel: el reporte de COMPRAS con 13 filas de preámbulo sí se lee", () => {
  const texto = [PREAMBULO_COMPRAS, CABECERA_COMPRAS, FILA_COMPRAS].join("\n");
  const r = parseExcelDian(texto);
  assert.ok(r.columnas, JSON.stringify(r.problemas.map((p) => p.codigo)));
  assert.equal(r.cabecerasOriginales[0], "Identificación Emisor Factura");
  assert.equal(r.documentos.length, 1);
  assert.equal(r.rechazadas.length, 0);

  const d = r.documentos[0];
  assert.equal(d.proveedor.nit, "811045607", "el emisor es el proveedor en un reporte de compras");
  assert.equal(d.proveedor.nombre, "PROVEEDOR DE PRUEBA SA");
  assert.equal(d.fecha, "2024-08-17");
  assert.equal(d.aritmetica.totalDeclarado, 62996, "Valor Facturado es el total");
  assert.equal(d.formasPago[0]?.codigo, "Electrónicos", "Medios De Pago es la forma de pago");
  assert.equal(d.numero, "10LB56950", "Num_factura_venta es el número");
  assert.equal(d.cufe?.length, 96, "el CUFE entre paréntesis y con acentos se reconoce");
});

test("excel: el pie del reporte no se cuenta como documento rechazado", () => {
  // Última fila real: "104 Facturas procesadas disponibles tomadas desde el
  // Sistema de Facturación DIAN". Tiene una sola celda con texto.
  const texto = [PREAMBULO_COMPRAS, CABECERA_COMPRAS, FILA_COMPRAS, "104 Facturas procesadas disponibles tomadas desde el Sistema de Facturación DIAN"].join("\n");
  const r = parseExcelDian(texto);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.rechazadas.length, 0, "un pie con una sola celda no es un documento");
});

test("excel: las columnas de notas crédito/débito NO se usan como total", () => {
  // El reporte trae "Valor Notas Crédito" y "Valor Notas Débito". Si una fila
  // los tuviera, el total sigue siendo "Valor Facturado": el modelo actual no
  // tiene un concepto de "factura + notas" y preferimos no inventarlo.
  const fila = FILA_COMPRAS.replace("\t62996\t0\t0\t", "\t62996\t10000\t5000\t");
  const r = parseExcelDian([PREAMBULO_COMPRAS, CABECERA_COMPRAS, fila].join("\n"));
  assert.equal(r.documentos[0].aritmetica.totalDeclarado, 62996);
  assert.equal(r.columnas?.total, 3, "la columna total es 'Valor Facturado'");
});
