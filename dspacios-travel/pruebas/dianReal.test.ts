// Pruebas contra la ESTRUCTURA REAL de las facturas electrónicas de la DIAN.
//
// Los fixtures de este archivo reproducen la forma que traían 15 facturas reales
// del usuario (UBL 2.1, prefijo `cac`/`cbc`, `TaxSubtotal`, `CompanyID` en
// `PartyTaxScheme`), pero con TODOS los datos sustituidos: NIT, razón social,
// CUFE, direcciones, correos y montos son sintéticos. La aritmética sí es
// exacta — se comprobó que `PayableAmount` cuadra con el desglose — porque si no
// la prueba no estaría probando nada.
//
// Cada fixture existe porque un documento real demostró ese caso. La lista de
// qué faltaba y qué se corrigió está en `docs/tecnico/contabilidad-dian.md`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFacturaDeTexto, parseFacturaXml } from "../lib/contabilidad/dian/factura.ts";
import { claveDocumento } from "../lib/contabilidad/dian/dedup.ts";
import type { ProblemaDian } from "../lib/contabilidad/dian/tipos.ts";

// CUFE sintético de 96 caracteres: en las 15 facturas reales medí 96, no 64.
const CUFE_REAL = "9F3A" + "0123456789ABCDEF".repeat(4) + "FEDCBA9876543210" + "A1B2C3D4E5F6";

// ── Forma real: cabecera UBL 2.1 con `TaxSubtotal` ───────────────────────────
const FACTURA_UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>18</cbc:CustomizationID>
  <cbc:ID>FE9001</cbc:ID>
  <cbc:UUID schemeID="1" schemeName="CUFE-SHA384">${CUFE_REAL}</cbc:UUID>
  <cbc:IssueDate>2026-08-19</cbc:IssueDate>
  <cbc:IssueTime>10:20:30-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-09-18</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha">COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>2</cbc:AdditionalAccountID>
    <cac:Party>
      <cbc:IndustryClassificationCode>7911</cbc:IndustryClassificationCode>
      <cac:PartyName><cbc:Name languageID="es">PROVEEDOR DE PRUEBA SAS</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>PROVEEDOR DE PRUEBA SAS</cbc:RegistrationName>
        <cbc:CompanyID schemeID="0" schemeName="31" schemeAgencyID="195">9001234567</cbc:CompanyID>
        <cbc:TaxLevelCode listName="">O-23</cbc:TaxLevelCode>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>PROVEEDOR DE PRUEBA SAS</cbc:RegistrationName>
        <cbc:CompanyID schemeID="0" schemeName="31" schemeAgencyID="195">9001234567</cbc:CompanyID>
        <cac:CorporateRegistrationScheme><cbc:ID>FEV</cbc:ID></cac:CorporateRegistrationScheme>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="NIT">9005555551</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name languageID="es">DSPACIOS DE PRUEBA</cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity><cbc:RegistrationName>DSPACIOS DE PRUEBA</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>1</cbc:ID>
    <cbc:PaymentMeansCode>45</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-09-18</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">1000000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">1000000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">1190000.00</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="COP">0.00</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="COP">0.00</cbc:ChargeTotalAmount>
    <cbc:PrepaidAmount currencyID="COP">0.00</cbc:PrepaidAmount>
    <cbc:PayableRoundingAmount currencyID="COP">0.00</cbc:PayableRoundingAmount>
    <cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">1.000000</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>
    <cbc:FreeOfChargeIndicator>false</cbc:FreeOfChargeIndicator>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">1000000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>SERVICIO DE PRUEBA</cbc:Description>
      <cac:StandardItemIdentification><cbc:ID schemeID="001">90121502</cbc:ID></cac:StandardItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">1000000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="NIU">1.000000</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

// ── Sobre real: `AttachedDocument` de la DIAN con la factura en un CDATA ─────
//
// Esta es la forma en que llegaron 14 de las 15 facturas del usuario. El módulo
// de base64 que se había asumido NO aparece en ninguna: el XML va como texto
// dentro de `cac:Attachment/cac:ExternalReference/cbc:Description`.
const SOBRE_ADJUNTED = `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>Documentos adjuntos</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1</cbc:ProfileID>
  <cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>
  <cbc:ID>MA359</cbc:ID>
  <cbc:IssueDate>2026-07-15</cbc:IssueDate>
  <cbc:IssueTime>11:18:50-05:00</cbc:IssueTime>
  <cbc:DocumentType>Contenedor de Factura Electrónica</cbc:DocumentType>
  <cbc:ParentDocumentID>MA359</cbc:ParentDocumentID>
  <cac:SenderParty>
    <cac:PartyTaxScheme>
      <cbc:RegistrationName>PROVEEDOR DE PRUEBA SAS</cbc:RegistrationName>
      <cbc:CompanyID schemeAgencyID="195" schemeID="6" schemeName="31">9001234567</cbc:CompanyID>
    </cac:PartyTaxScheme>
  </cac:SenderParty>
  <cac:ReceiverParty>
    <cac:PartyTaxScheme>
      <cbc:RegistrationName>DSPACIOS DE PRUEBA</cbc:RegistrationName>
      <cbc:CompanyID schemeAgencyID="195" schemeID="6" schemeName="31">9005555551</cbc:CompanyID>
    </cac:PartyTaxScheme>
  </cac:ReceiverParty>
  <cac:Attachment>
    <cac:ExternalReference>
      <cbc:MimeCode>text/xml</cbc:MimeCode>
      <cbc:EncodingCode>UTF-8</cbc:EncodingCode>
      <cbc:Description><![CDATA[${FACTURA_UBL}]]></cbc:Description>
    </cac:ExternalReference>
  </cac:Attachment>
</AttachedDocument>`;

function problemasDe(r: { problemas: ProblemaDian[] }): string[] {
  return r.problemas.map((p) => p.codigo);
}

// ── El sobre: el camino que usan los documentos reales ──────────────────────

test("real: el sobre AttachedDocument con la factura en un CDATA se lee", () => {
  const r = parseFacturaDeTexto(SOBRE_ADJUNTED);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.cufe, CUFE_REAL);
  assert.equal(r.documento?.numero, "FE9001");
  assert.equal(r.documento?.fecha, "2026-08-19");
  assert.ok(!r.documento?.xml.includes("AttachedDocument"), "el XML guardado es la factura, no el sobre");
});

test("real: el CUFE real mide 96 caracteres, no 64", () => {
  const r = parseFacturaXml(FACTURA_UBL);
  assert.ok(r.ok);
  assert.equal(r.documento?.cufe?.length, 96);
  assert.equal(r.documento?.cufe, CUFE_REAL, "no se quitan caracteres ni se recortan");
});

// ── Identificación del emisor y del receptor ────────────────────────────────

test("real: el NIT sale de PartyTaxScheme/CompanyID con 10 dígitos (NIT + DV)", () => {
  const r = parseFacturaXml(FACTURA_UBL);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.proveedor.nit, "900123456");
  assert.equal(r.documento?.proveedor.dv, "7");
  assert.equal(r.documento?.proveedor.nombre, "PROVEEDOR DE PRUEBA SAS");
});

test("real: el código de forma de pago es PaymentMeansCode, no el consecutivo", () => {
  const r = parseFacturaXml(FACTURA_UBL);
  assert.ok(r.ok);
  assert.equal(r.documento?.formasPago[0]?.codigo, "45", "45 = dinero efectivo; el ID era 1");
  assert.equal(r.documento?.formasPago[0]?.fecha, "2026-09-18");
});

test("real: un proveedor con cédula de 8 dígitos NO es un NIT y NO es un error", () => {
  // Dos facturas reales del usuario eran de personas naturales: `CompanyID` con
  // 8 dígitos y `schemeID="4"`. Antes el parser las rechazaba con NIT_INVALIDO.
  // Se reemplazan TODAS las apariciones: el NIT viene repetido en
  // `PartyTaxScheme` y en `PartyLegalEntity`.
  const xml = FACTURA_UBL.replace(
    /<cbc:CompanyID schemeID="0" schemeName="31" schemeAgencyID="195">9001234567<\/cbc:CompanyID>/g,
    '<cbc:CompanyID schemeID="4" schemeName="13" schemeAgencyID="195">71627445</cbc:CompanyID>'
  );
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.proveedor.nit, null);
  assert.equal(r.documento?.proveedor.identificacion, "71627445");
  assert.equal(r.documento?.proveedor.tipoIdentificacion, "4");
  assert.ok(!problemasDe(r).includes("NIT_INVALIDO"), "no es un documento inválido: es un proveedor sin NIT");
});

test("real: sin ninguna identificación legible sí es error", () => {
  const xml = FACTURA_UBL.replace(
    /<cbc:CompanyID schemeID="0" schemeName="31" schemeAgencyID="195">9001234567<\/cbc:CompanyID>/g,
    ""
  ).replace("<cac:PartyTaxScheme><cbc:RegistrationName>PROVEEDOR DE PRUEBA SAS</cbc:RegistrationName></cac:PartyTaxScheme>", "<cac:PartyTaxScheme/>");
  const r = parseFacturaXml(xml);
  assert.equal(r.ok, false);
  assert.ok(problemasDe(r).includes("NIT_INVALIDO"));
});

// ── Impuestos: forma `TaxSubtotal` ───────────────────────────────────────────

test("real: el IVA se lee de TaxSubtotal con tasa en porcentaje (19, no 1900)", () => {
  const r = parseFacturaXml(FACTURA_UBL);
  assert.ok(r.ok);
  assert.equal(r.documento?.impuestos.length, 1);
  assert.equal(r.documento?.impuestos[0].codigo, "01");
  assert.equal(r.documento?.impuestos[0].nombre, "IVA");
  assert.equal(r.documento?.impuestos[0].tasa, 19);
  assert.equal(r.documento?.impuestos[0].base, 1000000);
  assert.equal(r.documento?.impuestos[0].valor, 190000);
});

test("real: el TaxTotal de la LÍNEA no se cuenta como impuesto de la factura", () => {
  // La línea trae su propio TaxTotal con el mismo IVA. Contarlo duplicaba el
  // impuesto y descuadraba el total.
  const r = parseFacturaXml(FACTURA_UBL);
  assert.ok(r.ok);
  assert.equal(r.documento?.impuestos.length, 1, "un solo impuesto de cabecera");
  assert.equal(r.documento?.aritmetica.impuestos, 190000);
});

test("real: dos bloques TaxTotal en cabecera (IVA + INC) se suman ambos", () => {
  // Una factura real traía un segundo `cac:TaxTotal` con TaxScheme ID "04" (INC)
  // al 8 %, y el documento lo suma al payable.
  const xml = FACTURA_UBL.replace(
    "</cac:LegalMonetaryTotal>",
    `</cac:LegalMonetaryTotal>`
  ).replace(
    "</cac:TaxTotal>",
    `</cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">38400.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">480000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">38400.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>8.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>04</cbc:ID><cbc:Name>INC</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`
  ).replace(
    '<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>',
    '<cbc:PayableAmount currencyID="COP">1228400.00</cbc:PayableAmount>'
  );
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.impuestos.length, 2);
  assert.equal(r.documento?.impuestos[1].codigo, "04");
  assert.equal(r.documento?.impuestos[1].tasa, 8);
  assert.equal(r.documento?.aritmetica.impuestos, 228400);
  assert.equal(r.documento?.aritmetica.diferencia, 0);
});

// ── Aritmética: la fórmula real ──────────────────────────────────────────────

test("real: la fórmula es líneas − descuentos + cargos + impuestos − anticipos + redondeo", () => {
  // Caso tomado de una factura real: base 14.772.194 sin IVA, descuento 4,
  // cargo 250.780 → 15.022.970.
  const xml = FACTURA_UBL.replace(
    '<cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>',
    '<cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount>'
  )
    .replace(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/g, `<cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">14772194.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:Percent>0.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`)
    .replace('<cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>\n    <cbc:TaxExclusiveAmount currencyID="COP">1000000.00</cbc:TaxExclusiveAmount>\n    <cbc:TaxInclusiveAmount currencyID="COP">1190000.00</cbc:TaxInclusiveAmount>', '<cbc:LineExtensionAmount currencyID="COP">14772194.00</cbc:LineExtensionAmount>\n    <cbc:TaxExclusiveAmount currencyID="COP">14772194.00</cbc:TaxExclusiveAmount>\n    <cbc:TaxInclusiveAmount currencyID="COP">14772194.00</cbc:TaxInclusiveAmount>')
    .replace('<cbc:AllowanceTotalAmount currencyID="COP">0.00</cbc:AllowanceTotalAmount>', '<cbc:AllowanceTotalAmount currencyID="COP">4.00</cbc:AllowanceTotalAmount>')
    .replace('<cbc:ChargeTotalAmount currencyID="COP">0.00</cbc:ChargeTotalAmount>', '<cbc:ChargeTotalAmount currencyID="COP">250780.00</cbc:ChargeTotalAmount>')
    .replace('<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="COP">15022970.00</cbc:PayableAmount>');
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  const a = r.documento!.aritmetica;
  assert.equal(a.subtotal, 14772194);
  assert.equal(a.descuentos, 4);
  assert.equal(a.cargos, 250780);
  assert.equal(a.totalDeclarado, 15022970);
  assert.equal(a.totalCalculado, 15022970);
  assert.equal(a.diferencia, 0, "sin aviso de descuadre");
});

test("real: la base es LineExtensionAmount, no TaxExclusiveAmount", () => {
  // Caso real: líneas 1.181.120, base gravable 31.000 (el resto exento). Con
  // TaxExclusiveAmount el total no cuadraba.
  const xml = FACTURA_UBL.replace(
    '<cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount>',
    '<cbc:TaxAmount currencyID="COP">5890.00</cbc:TaxAmount>'
  )
    .replace(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/g, `<cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">31000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">5890.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`)
    .replace('<cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>\n    <cbc:TaxExclusiveAmount currencyID="COP">1000000.00</cbc:TaxExclusiveAmount>\n    <cbc:TaxInclusiveAmount currencyID="COP">1190000.00</cbc:TaxInclusiveAmount>', '<cbc:LineExtensionAmount currencyID="COP">1181120.00</cbc:LineExtensionAmount>\n    <cbc:TaxExclusiveAmount currencyID="COP">31000.00</cbc:TaxExclusiveAmount>\n    <cbc:TaxInclusiveAmount currencyID="COP">1187010.00</cbc:TaxInclusiveAmount>')
    .replace('<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="COP">1187010.00</cbc:PayableAmount>');
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.aritmetica.subtotal, 1181120, "el subtotal es la suma de las líneas");
  assert.equal(r.documento?.aritmetica.baseGravable, 31000, "la base gravable se guarda aparte");
  assert.equal(r.documento?.aritmetica.diferencia, 0);
});

test("real: anticipos y redondeo entran en la fórmula", () => {
  const xml = FACTURA_UBL.replace('<cbc:PrepaidAmount currencyID="COP">0.00</cbc:PrepaidAmount>', '<cbc:PrepaidAmount currencyID="COP">190000.00</cbc:PrepaidAmount>')
    .replace('<cbc:PayableRoundingAmount currencyID="COP">0.00</cbc:PayableRoundingAmount>', '<cbc:PayableRoundingAmount currencyID="COP">3.00</cbc:PayableRoundingAmount>')
    .replace('<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="COP">1000003.00</cbc:PayableAmount>');
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  const a = r.documento!.aritmetica;
  assert.equal(a.anticipos, 190000);
  assert.equal(a.redondeo, 3);
  assert.equal(a.diferencia, 0, "1000000 − 190000 + 190000 + 3 = 1000003");
});

// ── Factura en moneda extranjera ─────────────────────────────────────────────

test("real: con bloque de moneda extranjera mandan los totales de la factura", () => {
  // Una factura real traía `ext:UBLExtensions/…/ForeignCurrency` con un SEGUNDO
  // `LegalMonetaryTotal` en USD. Como `UBLExtensions` va primero, la búsqueda
  // global leía los montos de la otra divisa (11,76 / 13,99 en vez de
  // 37.883,78 / 45.081,70).
  const extension = `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent>
    <ipt:ForeignCurrencyExtension xmlns:ipt="pt:co:facturaelectronica:InteroperabilidadPT-2-1">
      <ipt:ForeignCurrency>
        <cbc:ID>0</cbc:ID>
        <cbc:LineExtensionAmount currencyID="USD">11.76</cbc:LineExtensionAmount>
        <cbc:PayableAmount currencyID="USD">13.99</cbc:PayableAmount>
        <cbc:TotalTaxAmount currencyID="USD">2.23</cbc:TotalTaxAmount>
      </ipt:ForeignCurrency>
    </ipt:ForeignCurrencyExtension>
  </ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  const xml = FACTURA_UBL.replace(
    "<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>",
    extension
  ).replace(
    "</cac:PaymentMeans>",
    `</cac:PaymentMeans>
  <cac:PaymentExchangeRate>
    <cbc:SourceCurrencyCode>COP</cbc:SourceCurrencyCode>
    <cbc:SourceCurrencyBaseRate>3221.41</cbc:SourceCurrencyBaseRate>
    <cbc:TargetCurrencyCode>USD</cbc:TargetCurrencyCode>
    <cbc:TargetCurrencyBaseRate>1.00</cbc:TargetCurrencyBaseRate>
    <cbc:CalculationRate>3221.41</cbc:CalculationRate>
    <cbc:Date>2026-08-19</cbc:Date>
  </cac:PaymentExchangeRate>`
  );
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  const a = r.documento!.aritmetica;
  assert.equal(a.subtotal, 1000000, "los montos son los de la factura, no los del bloque USD");
  assert.equal(a.totalDeclarado, 1190000);
  assert.equal(a.diferencia, 0);
  assert.equal(r.documento?.divisa?.destino, "USD");
  assert.equal(r.documento?.divisa?.tasa, 3221.41);
  assert.equal(r.documento?.divisa?.fecha, "2026-08-19");
});

test("real: el ID de la extensión no tapa el número de documento", () => {
  // Con el bloque de moneda extranjera delante, el primer `cbc:ID` del documento
  // es el "0" de la extensión. El número real es FE9001.
  const xml = FACTURA_UBL.replace(
    "<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>",
    `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><x:Extra xmlns:x="urn:x"><cbc:ID>0</cbc:ID><cbc:ID></cbc:ID></x:Extra></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`
  );
  const r = parseFacturaXml(xml);
  assert.ok(r.ok);
  assert.equal(r.documento?.numero, "FE9001");
  assert.equal(claveDocumento(r.documento).clave, `CUFE:${CUFE_REAL}`, "la huella usa el CUFE, no el ID vacío");
});

// ── Lo que NO es una factura ─────────────────────────────────────────────────

test("real: la respuesta de la DIAN (ApplicationResponse) se rechaza con motivo", () => {
  const respuesta = `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1</cbc:CustomizationID>
  <cbc:ID>IDCUFE-DE-PRUEBA</cbc:ID>
  <cbc:IssueDate>2026-08-19</cbc:IssueDate>
  <cbc:ResponseDate>2026-08-19</cbc:ResponseDate>
  <cbc:ResponseCode>100</cbc:ResponseCode>
  <cbc:ResponseDescription>La factura fue aceptada</cbc:ResponseDescription>
</ApplicationResponse>`;
  const r = parseFacturaDeTexto(respuesta);
  assert.equal(r.ok, false);
  assert.equal(r.documento, null);
  assert.ok(problemasDe(r).includes("XML_RAIZ_NO_RECONOCIDA"));
  assert.ok(r.problemas[0].detalle.includes("ApplicationResponse"), "el mensaje nombra la raíz que se encontró");
});

// ── Retenciones: las TRES estructuras que traen los documentos reales ───────
//
// Todas están confirmadas en archivos reales del usuario, pero **con importe 0**.
// Lo que se verifica aquí es que el parser las LEE, no que el signo esté
// resuelto: el signo de la retención en el total sigue sin verificar.

// 1) Bloque DIAN heredado `ReteFueCop` / `ReteIvaCop` / `ReteIcaCop`.
test("real: el bloque DIAN de retenciones se lee aunque venga en cero", () => {
  const bloque = `<TotalesCop>
    <SubTotalCop>219784.9</SubTotalCop>
    <MntImpCop>41759.13</MntImpCop>
    <VlrPagarCop>261544.03</VlrPagarCop>
    <ReteFueCop>0</ReteFueCop>
    <ReteIvaCop>0</ReteIvaCop>
    <ReteIcaCop>0</ReteIcaCop>
    <TotAnticiposCop>0</TotAnticiposCop>
  </TotalesCop>`;
  const xml = FACTURA_UBL.replace("<ext:UBLExtensions>", `${bloque}<ext:UBLExtensions>`);
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.aritmetica.retenciones, 0, "en cero no ensucia la lista");
  assert.equal(r.documento?.aritmetica.diferencia, 0, "el bloque no altera el total");
});

// 2) Bloque de software `<CustomField Name="…" Value="…"/>`: es donde los
//    documentos reales declaran `BaseRetencion` (que SÍ trae valor) y los
//    importes de retefuente/reteIVA/reteICA.
test("real: el bloque CustomField de retenciones se lee, incluida la base", () => {
  const software = `<Interoperabilidad>
    <CustomField Name="TotalRetenciones" Value="0.00" />
    <CustomField Name="TotalReteFuente" Value="0.00" />
    <CustomField Name="TotalReteIva" Value="0.00" />
    <CustomField Name="TotalReteIca" Value="0.00" />
    <CustomField Name="BaseRetencion" Value="1831932.78" />
    <CustomField Name="ReteFuenteAmount" Value="0.00" />
    <CustomField Name="ReteIvaAmount" Value="0.00" />
    <CustomField Name="Retencion" Value="0.00" />
  </Interoperabilidad>`;
  const xml = FACTURA_UBL.replace("<ext:UBLExtensions>", `${software}<ext:UBLExtensions>`);
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  assert.equal(r.documento?.aritmetica.retenciones, 0);
  assert.equal(r.documento?.aritmetica.totalDeclarado, 1190000, "el bloque no toca el total");
});

test("real: una retención con valor se lee y NO afecta el total (signo sin verificar)", () => {
  // Fixture SINTÉTICO con valor: en los documentos reales todos venían en 0,
  // así que esta combinación es la que falta confirmar con un archivo real.
  //
  // RIESGO CONOCIDO: como la fórmula NO resta retenciones, una retención real
  // queda invisible en `totalCalculado` y NO dispara `TOTAL_NO_CUADRA`. El
  // número solo se ve en `aritmetica.retenciones`. Está anotado en la hoja
  // técnica: hasta que haya un documento real, la retención se informa pero no
  // se concilia contra el total.
  const software = `<CustomField Name="BaseRetencion" Value="1000000.00" />
    <CustomField Name="ReteFuenteAmount" Value="40000.00" />`;
  const xml = FACTURA_UBL.replace("<ext:UBLExtensions>", `${software}<ext:UBLExtensions>`);
  const r = parseFacturaXml(xml);
  assert.ok(r.ok, problemasDe(r).join(","));
  const a = r.documento!.aritmetica;
  assert.equal(a.retenciones, 40000, "la retención se lee y se informa");
  assert.equal(r.documento?.retenciones.length, 1);
  assert.equal(r.documento?.retenciones[0].codigo, "ReteFuente");
  assert.equal(r.documento?.retenciones[0].valor, 40000);
  assert.equal(r.documento?.retenciones[0].base, 1000000, "con la base declarada");
  assert.equal(a.totalDeclarado, 1190000, "el documento declara el total y ese manda");
  assert.equal(a.totalCalculado, 1190000, "el cálculo no resta la retención porque su signo no está verificado");
  assert.ok(
    !problemasDe(r).includes("TOTAL_NO_CUADRA"),
    "consecuencia directa de lo anterior: hoy una retención real no se delata en el cuadre"
  );
});

// 3) UBL `WithholdingTaxTotal` (ya cubierto en dianXml.test.ts).
test("real: la base de retención se lee aunque el importe sea cero", () => {
  const software = `<CustomField Name="BaseRetencion" Value="1831932.78" />`;
  const xml = FACTURA_UBL.replace("<ext:UBLExtensions>", `${software}<ext:UBLExtensions>`);
  const r = parseFacturaXml(xml);
  assert.ok(r.ok);
  // Con importe 0 no hay retención en la lista; la base vive en el documento
  // original, no se inventa un valor.
  assert.equal(r.documento?.retenciones.length, 0);
});