// Pruebas del parser XML DIAN. Fixtures SINTÉTICOS y mínimos: no hay ningún
// documento real aquí a propósito (falta un XML real del usuario para
// contrastar prefijos de namespace, versiones y nombres de emisor).
//
// Lo que se verifica:
//   · el lector XML ignora prefijos, comentarios, CDATA y declaraciones;
//   · detecta desbalance de etiquetas en vez de devolver un árbol a medias;
//   · el mapeo de una factura (montos, IVA, NIT/DV, CUFE, proveedor);
//   · las notas crédito/débito toman CUDE, no CUFE;
//   · AttachedDocument: texto plano, base64 y base64+gzip;
//   · los errores de formato se reportan con código, no se tragan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import { buscar, parseXml, primero, textoDe, textoPlano } from "../lib/contabilidad/dian/xml.ts";
import { abrirAdjunto } from "../lib/contabilidad/dian/adjunto.ts";
import { parseFacturaDeTexto, parseFacturaXml } from "../lib/contabilidad/dian/factura.ts";
import { claveDocumento, relacionar } from "../lib/contabilidad/dian/dedup.ts";
import type { ProblemaDian } from "../lib/contabilidad/dian/tipos.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Un CUFE real son 64 caracteres alfanuméricos en mayúsculas, sin guiones ni
// signos: el normalizador quita todo lo que no sea alfanumérico, así que el
// fixture tampoco lleva "_" (si los llevara, la prueba compararía otra cosa).
const CUFE_REALISTA = `CUFE${"0123456789ABCDEF".repeat(3)}GHIJK`;

const XML_FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Factura de prueba sintetica -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>18</cbc:CustomizationID>
  <cbc:ID>FE-001</cbc:ID>
  <cbc:IssueDate>2026-03-02</cbc:IssueDate>
  <cbc:UUID>${CUFE_REALISTA}</cbc:UUID>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="NIT">900123456-7</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>HOTEL CARIBE LTDA</cbc:RegistrationName>
        <cac:CompanyID>900123456</cac:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="NIT">900555555-1</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>DSPACIOS MAYORISTA</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>30</cbc:ID>
    <cbc:PaymentDueDate>2026-04-01</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:ID>01</cbc:ID>
    <cbc:Name>IVA</cbc:Name>
    <cbc:TaxAmount currencyID="COP">1000000.00</cbc:TaxAmount>
    <cbc:PercentAmount>19.00</cbc:PercentAmount>
    <cbc:TotalTaxAmount currencyID="COP">190000.00</cbc:TotalTaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">1190000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity>2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>
    <cac:AccountingAccount><cbc:ID>511020</cbc:ID></cac:AccountingAccount>
    <cac:Item><cbc:Description>Alojamiento 2 noches</cbc:Description></cac:Item>
  </cac:InvoiceLine>
</Invoice>`;

function codigos(problemas: ProblemaDian[]): string[] {
  return problemas.map((p) => p.codigo);
}

// Envoltorio de `<AttachedDocument>` y lectura del adjunto, en UNA sola
// función y en dos pasos a propósito (`parseXml` y luego `abrirAdjunto`, sin
// encadenar): con el stripper de tipos de este runner (Node 24 +
// `--experimental-strip-types`) una cadena de llamadas que empieza en el valor
// devuelto por un módulo importado falla con ReferenceError dentro de un
// `test()`. Separado, funciona y además el fallo queda más legible.
function adjuntoEn(contenido: string) {
  const sobre =
    '<AttachedDocument xmlns:cac="x" xmlns:cbc="y">' +
    "<cac:Attachment><cac:ExternalReference>" +
    `<cac:AttachmentBinaryData>${contenido}</cac:AttachmentBinaryData>` +
    "<cac:MimeCode>application/xml</cac:MimeCode>" +
    "</cac:ExternalReference></cac:Attachment>" +
    "</AttachedDocument>";
  const leido = parseXml(sobre);
  assert.ok(leido.ok, "el sobre de prueba debe ser XML válido");
  return abrirAdjunto(leido.raiz);
}

// ── Lector XML ───────────────────────────────────────────────────────────────

test("lector XML: ignora declaración, comentarios y CDATA", () => {
  const r = parseXml(`<?xml version="1.0"?><!-- c --><a><b><![CDATA[hola]]></b></a>`);
  assert.ok(r.ok);
  assert.equal(r.raiz.tag, "a");
  assert.equal(textoDe(r.raiz, "b"), "hola");
});

test("lector XML: quita el prefijo de namespace y conserva los atributos", () => {
  const r = parseXml(`<cbc:Raiz xmlns:cbc="x"><cbc:ID schemeID="NIT">1</cbc:ID></cbc:Raiz>`);
  assert.ok(r.ok);
  assert.equal(r.raiz.tag, "Raiz");
  const id = primero(r.raiz, "ID");
  assert.ok(id);
  assert.equal(id.attrs.IDSchemeID ?? id.attrs.schemeID, "NIT", "el atributo con prefijo debe quedar local");
});

test("lector XML: una etiqueta auto-cerrada no deja nada abierto", () => {
  const r = parseXml(`<a><b/></a>`);
  assert.ok(r.ok);
  assert.equal(buscar(r.raiz, "b").length, 1);
});

test("lector XML: etiqueta sin cerrar se reporta, no se devuelve un árbol a medias", () => {
  const r = parseXml(`<a><b>texto</a>`);
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && codigos(r.problemas).includes("XML_MAL_FORMADO"));
});

test("lector XML: entrada vacía o sin etiquetas", () => {
  for (const vacio of ["", "   ", "no soy xml"]) {
    const r = parseXml(vacio);
    assert.equal(r.ok, false, vacio);
  }
});

test("lector XML: textoPlano concatena descendientes", () => {
  const r = parseXml(`<a><b>un</b><c>dos</c></a>`);
  assert.ok(r.ok);
  assert.equal(textoPlano(r.raiz), "un dos");
});

// ── Factura: mapeo completo ──────────────────────────────────────────────────

test("factura: mapea CUFE, tipo, número, fecha, proveedor y aritmética", () => {
  const r = parseFacturaXml(XML_FACTURA);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.problemas));
  const d = r.documento;

  assert.equal(d.cufe, CUFE_REALISTA);
  assert.equal(d.cude, null);
  assert.equal(d.tipoDocumento, "factura");
  assert.equal(d.numero, "FE-001");
  assert.equal(d.fecha, "2026-03-02");
  assert.equal(d.moneda, "COP");

  assert.equal(d.proveedor.nit, "900123456");
  assert.equal(d.proveedor.dv, "7");
  assert.equal(d.proveedor.nombre, "HOTEL CARIBE LTDA");

  assert.equal(d.aritmetica.subtotal, 1000000);
  assert.equal(d.aritmetica.impuestos, 190000);
  assert.equal(d.aritmetica.totalDeclarado, 1190000);
  assert.equal(d.aritmetica.totalCalculado, 1190000);
  assert.equal(d.aritmetica.diferencia, 0);

  assert.equal(d.impuestos.length, 1);
  assert.equal(d.impuestos[0].tasa, 19);
  assert.equal(d.impuestos[0].valor, 190000);

  assert.equal(d.lineas.length, 1);
  assert.equal(d.lineas[0].descripcion, "Alojamiento 2 noches");
  assert.equal(d.lineas[0].cantidad, 2);
  assert.equal(d.lineas[0].cuentaContable, "511020");

  assert.equal(d.formasPago[0].codigo, "30");
  assert.equal(d.formasPago[0].fecha, "2026-04-01");
});

test("factura: el XML original queda guardado en el documento", () => {
  const r = parseFacturaXml(XML_FACTURA);
  assert.ok(r.ok);
  assert.equal(r.documento.xml, XML_FACTURA, "el staging necesita la fuente tal cual");
});

// ── Factura: aritmética y validaciones ───────────────────────────────────────

test("factura: un total que no cuadra es aviso, no rechazo", () => {
  const xml = XML_FACTURA.replace("<cbc:PayableAmount currencyID=\"COP\">1190000.00</cbc:PayableAmount>", "<cbc:PayableAmount currencyID=\"COP\">999000.00</cbc:PayableAmount>");
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, "una diferencia de total no debe rechazar el documento");
  assert.ok(codigos(r.problemas).includes("TOTAL_NO_CUADRA"));
  assert.equal(r.problemas.find((p) => p.codigo === "TOTAL_NO_CUADRA")?.severidad, "aviso");
  assert.equal(r.documento?.aritmetica.diferencia, 999000 - 1190000);
});

test("factura: fecha futura es aviso y usa el `hoy` inyectado", () => {
  const r = parseFacturaXml(XML_FACTURA, { hoy: "2026-01-01" });
  assert.ok(r.ok);
  assert.ok(codigos(r.problemas).includes("FECHA_FUTURA"));
});

test("factura: sin CUFE recognizable es aviso, y los candidatos quedan en `originales`", () => {
  const xml = XML_FACTURA.replace(`<cbc:UUID>${CUFE_REALISTA}</cbc:UUID>`, "<cbc:UUID>123</cbc:UUID>");
  const r = parseFacturaXml(xml);
  assert.ok(r.ok);
  assert.equal(r.documento?.cufe, null, "un UUID corto no se guarda como CUFE");
  assert.ok(codigos(r.problemas).includes("CUFE_INVALIDO"));
  assert.equal(r.documento?.originales.uuid, "123", "el valor original no se pierde");
});

test("factura: NIT ilegible es error y se reporta el campo", () => {
  // Se quitan AMBAS fuentes del NIT (el `ID` con esquema y el `CompanyID`): si
  // el `CompanyID` se queda, el NIT se lee igual y no hay nada que reportar.
  const xml = XML_FACTURA.replace(`<cbc:ID schemeID="NIT">900123456-7</cbc:ID>`, `<cbc:ID schemeID="NIT">SIN NIT</cbc:ID>`).replace(
    `<cac:CompanyID>900123456</cac:CompanyID>`,
    `<cac:CompanyID>0</cac:CompanyID>`
  );
  const r = parseFacturaXml(xml);
  assert.equal(r.ok, false);
  const p = r.problemas.find((x) => x.codigo === "NIT_INVALIDO");
  assert.ok(p);
  assert.equal(p.campo, "AccountingSupplierParty.Party.ID");
});

test("factura: fecha ilegible es error", () => {
  const xml = XML_FACTURA.replace("<cbc:IssueDate>2026-03-02</cbc:IssueDate>", "<cbc:IssueDate>no hay fecha</cbc:IssueDate>");
  const r = parseFacturaXml(xml);
  assert.equal(r.ok, false);
  assert.ok(codigos(r.problemas).includes("FECHA_INVALIDA"));
});

test("factura: raíz que no es de la DIAN", () => {
  const r = parseFacturaXml(`<Factura><detalle>x</detalle></Factura>`);
  assert.equal(r.ok, false);
  assert.ok(codigos(r.problemas).includes("XML_RAIZ_NO_RECONOCIDA"));
});

test("factura: XML mal formado no produce documento", () => {
  const r = parseFacturaXml(XML_FACTURA.replace("</Invoice>", ""));
  assert.equal(r.ok, false);
  assert.equal(r.documento, null);
  assert.ok(codigos(r.problemas).includes("XML_MAL_FORMADO"));
});

test("factura: el cliente con CC no se interpreta como NIT", () => {
  const xml = XML_FACTURA.replace(
    `<cbc:ID schemeID="NIT">900555555-1</cbc:ID>`,
    `<cbc:ID schemeID="CC">1010101010</cbc:ID>`
  );
  const r = parseFacturaXml(xml);
  assert.ok(r.ok);
  assert.equal(r.documento?.sujeto.identificacion, "1010101010", "una cédula se conserva como identificación");
  assert.equal(r.documento?.sujeto.tipoIdentificacion, "CC");
  assert.equal(r.documento?.sujeto.nit ?? null, null, "una cédula no es un NIT");
});

const XML_NOTA_CREDITO = `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${CUFE_REALISTA}</cbc:ID>
  <cbc:ReferenceID>FE-001</cbc:ReferenceID>
  <cbc:IssueDate>2026-03-10T09:00:00-05:00</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty xmlns:cac="x">
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="NIT">900123456-7</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>HOTEL CARIBE LTDA</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cbc:ID>01</cbc:ID><cbc:TaxAmount>500000.00</cbc:TaxAmount>
    <cbc:PercentAmount>19.00</cbc:PercentAmount>
    <cbc:TotalTaxAmount>95000.00</cbc:TotalTaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount>500000.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount>595000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</CreditNote>`;

test("nota crédito: toma CUDE, tipo nota_credito y número desde ReferenceID", () => {
  const r = parseFacturaXml(XML_NOTA_CREDITO);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.problemas));
  assert.equal(r.documento?.tipoDocumento, "nota_credito");
  assert.equal(r.documento?.cude, CUFE_REALISTA);
  assert.equal(r.documento?.cufe, null, "la nota no trae CUFE propio");
  assert.equal(r.documento?.numero, "FE-001");
  assert.equal(r.documento?.fecha, "2026-03-10", "la hora y la zona se recortan al día");
  assert.equal(r.documento?.aritmetica.totalDeclarado, 595000);
});

test("nota crédito sin CUDE reconocible se reporta como aviso, no se inventa", () => {
  const xml = XML_NOTA_CREDITO.replace(`<cbc:ID>${CUFE_REALISTA}</cbc:ID>`, "<cbc:ID>NC-005</cbc:ID>");
  const r = parseFacturaXml(xml);
  assert.ok(r.ok);
  assert.equal(r.documento?.cude, null);
  assert.ok(codigos(r.problemas).includes("CAMPO_AUSENTE"));
});

test("retenciones: se leen y se INFORMAN, pero no se restan del total calculado", () => {
  // Por qué no se restan: en los 17 documentos reales del usuario todas las
  // retenciones vinieron en 0, así que el signo no está verificado. Peor: el
  // único bloque con valor (INC al 8 %) lo SUMABA al payable. Restarlas sin
  // evidencia produciría un TOTAL_NO_CUADRA falso en el primer documento con
  // retención real. El número queda a la vista en `aritmetica.retenciones`.
  const xml = XML_FACTURA.replace(
    `</cac:TaxTotal>`,
    `</cac:TaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">1000000.00</cbc:TaxAmount>
    <cbc:TotalTaxRetained currencyID="COP">40000.00</cbc:TotalTaxRetained>
  </cac:WithholdingTaxTotal>`
  ).replace(
    `<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>`,
    `<cbc:PayableAmount currencyID="COP">1150000.00</cbc:PayableAmount>`
  );
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.problemas));
  assert.equal(r.documento?.retenciones.length, 1);
  assert.equal(r.documento?.retenciones[0].valor, 40000);
  assert.equal(r.documento?.aritmetica.retenciones, 40000, "la retención se informa");
  assert.equal(r.documento?.aritmetica.totalDeclarado, 1150000, "lo que declara el documento manda");
  assert.equal(
    r.documento?.aritmetica.totalCalculado,
    1190000,
    "el cálculo NO resta la retención porque su signo no está verificado"
  );
});

// ── AttachedDocument ─────────────────────────────────────────────────────────

test("adjunto: base64 de XML plano", () => {
  const b64 = Buffer.from(XML_FACTURA, "utf8").toString("base64");
  const r = adjuntoEn(b64);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.problemas));
  assert.equal(r.forma, "base64");
  assert.ok(r.xml.includes("PayableAmount"));
});

test("adjunto: XML en crudo dentro de la etiqueta se rechaza con el motivo", () => {
  const r = adjuntoEn(XML_FACTURA);
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && codigos(r.problemas).includes("ADJUNTO_INVALIDO"));
});

test("adjunto: base64 partido en varias líneas (firma) se concatena", () => {
  const b64 = Buffer.from(XML_FACTURA, "utf8").toString("base64");
  const partido = `${b64.slice(0, 20)}\n${b64.slice(20)}`;
  const r = adjuntoEn(partido);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.problemas));
});

test("adjunto: base64 de XML comprimido con gzip", () => {
  const b64 = gzipSync(Buffer.from(XML_FACTURA, "utf8")).toString("base64");
  const r = adjuntoEn(b64);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.problemas));
  assert.equal(r.forma, "base64_gzip");
});

test("adjunto: base64 que no es base64, o vacío, o no-XML: cada caso con su motivo", () => {
  const vacio = adjuntoEn("   ");
  assert.equal(vacio.ok, false);
  assert.ok(vacio.ok === false && codigos(vacio.problemas).includes("ADJUNTO_VACIO"));

  const roto = adjuntoEn("esto no es base64!!!");
  assert.equal(roto.ok, false);
  assert.ok(roto.ok === false && codigos(roto.problemas).includes("ADJUNTO_INVALIDO"));

  const noXml = adjuntoEn(Buffer.from("hola mundo", "utf8").toString("base64"));
  assert.equal(noXml.ok, false);
  assert.ok(noXml.ok === false && codigos(noXml.problemas).includes("ADJUNTO_NO_ES_XML"));

  const ausente = abrirAdjunto(null);
  assert.equal(ausente.ok, false);
  assert.ok(ausente.ok === false && codigos(ausente.problemas).includes("ADJUNTO_AUSENTE"));
});

test("sobre completo: parseFacturaDeTexto abre el adjunto y devuelve el XML interno", () => {
  const b64 = gzipSync(Buffer.from(XML_FACTURA, "utf8")).toString("base64");
  const sobre =
    '<Envelope xmlns="urn:oasis:names:specification:ubl:schema:xsd:Envelope-2"><AttachedDocument><cac:Attachment xmlns:cac="x"><cac:ExternalReference>' +
    `<cac:AttachmentBinaryData>${b64}</cac:AttachmentBinaryData>` +
    "</cac:ExternalReference></cac:Attachment></AttachedDocument></Envelope>";
  const r = parseFacturaDeTexto(sobre);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.problemas));
  assert.equal(r.documento?.cufe, CUFE_REALISTA);
  assert.ok(!r.documento?.xml.includes("Envelope"), "el XML guardado es el interno, no el sobre");
});

test("sobre completo: si no hay adjunto ni es factura, lo dice", () => {
  const r = parseFacturaDeTexto(`<Envelope><Body><nada/></Body></Envelope>`);
  assert.equal(r.ok, false);
  assert.ok(codigos(r.problemas).includes("XML_RAIZ_NO_RECONOCIDA"));
});

// ── Duplicados ───────────────────────────────────────────────────────────────

test("huella: con CUFE manda el CUFE; sin CUFE, proveedor+tipo+número+fecha", () => {
  const conCufe = parseFacturaXml(XML_FACTURA);
  assert.ok(conCufe.ok);
  assert.equal(claveDocumento(conCufe.documento).base, "cufecude");
  assert.equal(claveDocumento(conCufe.documento).clave, `CUFE:${CUFE_REALISTA}`);

  const sinCufe = parseFacturaXml(XML_FACTURA.replace(`<cbc:UUID>${CUFE_REALISTA}</cbc:UUID>`, ""));
  assert.ok(sinCufe.ok);
  assert.equal(claveDocumento(sinCufe.documento).base, "proveedor_tipo_numero_fecha");
  assert.equal(claveDocumento(sinCufe.documento).clave, "REF:900123456:factura:FE001:2026-03-02");});

test("huella: misma clave y mismo total = duplicado; misma clave y otro total = discrepante", () => {
  const r = parseFacturaXml(XML_FACTURA);
  assert.ok(r.ok);
  const d = r.documento;
  const previo = { clave: claveDocumento(d).clave, total: 1190000 };

  assert.equal(relacionar(d, previo), "duplicado");
  assert.equal(relacionar(d, { ...previo, total: 999 }), "discrepante", "un total distinto NO se descarta solo");
  assert.equal(relacionar(d, { clave: "OTRA", total: 1190000 }), "nuevo");
});
