// Se ejecuta con npm run test:react (loader del arnés).
// Desglose interno de la ficha: estados normal, manual, valorada bajo solicitud (con ajuste), opción de comparativa, sin detalle e incompleto. No toca el documento público.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { readFileSync } from "node:fs";

const { renderToStaticMarkup } = await import("react-dom/server");
const { DesgloseInterno } = await import("../components/cotizacion/DesgloseInterno.tsx");

const plano = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
const ver = (cot: { precio_venta: number | null; detalle: unknown }, moneda = "COP") =>
  plano(renderToStaticMarkup(createElement(DesgloseInterno as ComponentType<Record<string, unknown>>, { cot, moneda })));
const it = (descripcion: string, adultos: number, ninos: number, ta: number, tn: number) => ({ descripcion, adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn });

describe("desglose interno de la ficha", () => {
  test("cotización normal: líneas, cantidades y total; sin avisos si cuadra", () => {
    const h = ver({ precio_venta: 1_300_000, detalle: { items: [it("H · 1 hab Doble (2 pax) · A / B", 2, 0, 500_000, 0), it("Servicio · Tour", 1, 0, 300_000, 0)] } });
    assert.match(h, /Hotel y habitaciones|1 hab Doble/);
    assert.match(h, /Tour/);
    assert.match(h, /Total guardado\s+\$\s?1\.300\.000/);
    assert.doesNotMatch(h, /incompleto|difiere/);
  });
  test("manual (cantidad/tarifa_unit/valor)", () => {
    const h = ver({ precio_venta: 1_250_000, detalle: { items: [{ descripcion: "PAQUETE TURÍSTICO A CTG DEL 01/02/2027 AL 04/02/2027", cantidad: 2, tarifa_unit: 500_000, valor: 1_000_000, orden: 0 }, { descripcion: "Tarifa por niño", cantidad: 1, tarifa_unit: 250_000, valor: 250_000, orden: 1 }] } });
    assert.match(h, /PAQUETE TURÍSTICO/);
    assert.doesNotMatch(h, /incompleto|difiere/);
  });
  test("hotel valorado bajo solicitud: conserva el ajuste de redondeo y cuadra", () => {
    const h = ver({ precio_venta: 2_001_000, detalle: { items: [it("H · 1 hab Doble (2 pax) · A / B", 2, 0, 1_000_000, 0), it("Ajuste de redondeo del reparto del hotel", 1, 0, 1_000, 0)] } });
    assert.match(h, /Ajuste de redondeo/);
    assert.doesNotMatch(h, /incompleto|difiere/);
  });
  test("opción de comparativa en USD", () => {
    const h = ver({ precio_venta: 900, detalle: { items: [it("H · 1 hab Doble (2 pax) · A / B", 2, 0, 450, 0)] } }, "USD");
    assert.match(h, /USD/);
    assert.doesNotMatch(h, /incompleto|difiere/);
  });
  test("renglón desconocido: «Otro concepto», no «Hotel»", () => {
    const h = ver({ precio_venta: 70_000, detalle: { items: [it("Cargo raro", 1, 0, 70_000, 0)] } });
    assert.match(h, /Otro concepto/);
    assert.doesNotMatch(h, /Hotel y habitaciones/);
  });
  test("importe inválido: «Importe no disponible» y detalle incompleto, no $0", () => {
    const h = ver({ precio_venta: 500_000, detalle: { items: [it("H · 1 hab Doble (2 pax) · A / B", 2, 0, 500_000, 0), { descripcion: "Servicio · Tour", adultos: 1, ninos: 0, tarifa_adulto: "x", tarifa_nino: 0 }] } });
    assert.match(h, /Importe no disponible/);
    assert.match(h, /Detalle incompleto/);
  });
  test("sin renglones: solo total guardado", () => {
    assert.match(ver({ precio_venta: 10, detalle: null }), /solo se guardó el total/);
  });
  test("el documento público y el de cliente no importan el desglose interno", () => {
    for (const f of ["app/cotizacion/[id]/page.tsx", "components/contrato/ContratoDocumento.tsx", "components/contrato/CotizacionManualDocumento.tsx"])
      assert.doesNotMatch(readFileSync(f, "utf8"), /DesgloseInterno|desgloseInterno/, f);
  });
  test("la ficha de solicitud pendiente dice «Pendiente de valoración»", () => {
    assert.match(readFileSync("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx", "utf8"), /Pendiente de valoración/);
  });
});
