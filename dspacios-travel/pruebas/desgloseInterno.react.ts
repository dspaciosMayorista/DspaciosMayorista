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

const { ComposicionPrecio } = await import("../components/cotizacion/ComposicionPrecio.tsx");
const { construirComposicion } = await import("../lib/cotizacion/composicionPrecio.ts");

describe("composición del precio en la ficha", () => {
  const base = { pctMk: 0.2, impuesto: 0, vuelo: 400_000, vueloNeto: null, feeInfante: 0, servicios: [{ nombre: "Traslados", neto: 80_000, netoMenor: 80_000 }], netos: { doble: 1_000_000, sencilla: 1_100_000 } };
  const pDoble = Math.ceil((1_000_000 / 0.8 + 100_000 + 400_000) / 1000) * 1000;
  const pSen = Math.ceil((1_100_000 / 0.8 + 100_000 + 400_000) / 1000) * 1000;
  const comp = construirComposicion({
    base, moneda: "COP", trm: null,
    lineasHab: [{ acom: "doble", habitaciones: 2, pax: 4, pvp: pDoble }, { acom: "sencilla", habitaciones: 1, pax: 1, pvp: pSen }], lineasMenores: [], adicionales: [], total: 4 * pDoble + pSen,
  });
  const ver = (guardada: unknown, total: number | null) =>
    plano(renderToStaticMarkup(createElement(ComposicionPrecio as ComponentType<Record<string, unknown>>, { guardada, totalCotizacion: total })));

  test("muestra las filas de habitación y debajo hotel, vuelo, servicio, markup global y redondeo; cuadra con el total", () => {
    const h = ver({ version: 1, hoteles: [{ ref: null, nombre: null, composicion: comp }] }, comp.total);
    for (const t of ["2 hab Doble (4 pax)", "1 hab Sencilla (1 pax)", "Hotel", "Vuelo", "Traslados", "Neto p/p", "Venta p/p", "markup global del paquete (20 %)"]) assert.ok(h.includes(t), t);
    assert.doesNotMatch(h, /difiere|no suman/);
  });
  test("sin composición guardada: lo dice, no inventa importes", () => {
    const h = ver(null, 5_000_000);
    assert.match(h, /no fue conservado/);
    assert.doesNotMatch(h, /Hotel \(neto\)/);
  });
  test("total de la cotización distinto del de la composición: se avisa", () => {
    assert.match(ver({ version: 1, hoteles: [{ ref: null, nombre: null, composicion: comp }] }, comp.total + 1_000), /difiere del precio de la cotización/);
  });
});

describe("composición con conversión de moneda y líneas sin composición", () => {
  const baseUsd = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, trm: 4000, servicios: [{ nombre: "Tour", neto: 80_000, netoMenor: 80_000, origen: { monto: 20, montoMenor: 20, moneda: "USD" } }], netos: { doble: 400_000, infante: 0 }, netosOrigen: { doble: { monto: 100, moneda: "USD" } }, fijo: { mayor2: true, menor2: false } };
  const pvp = Math.ceil((400_000 / 0.8 + 100_000) / 1000) * 1000;
  const comp = construirComposicion({ base: baseUsd, moneda: "COP", trm: 4000, lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp }], lineasMenores: [{ clase: "infante", cantidad: 1, tarifa: 49_000, menorDeDos: false }], adicionales: [], total: 2 * pvp + 49_000 });
  const ver = () => plano(renderToStaticMarkup(createElement(ComposicionPrecio as ComponentType<Record<string, unknown>>, { guardada: { version: 1, hoteles: [{ ref: null, nombre: null, composicion: comp }] }, totalCotizacion: comp.total })));

  test("muestra el importe de origen en USD y la TRM usada, con moneda COP", () => {
    const h = ver();
    assert.ok(h.includes("USD 100") || h.includes("US$") || /USD\s*\$?\s*100/.test(h), h.slice(0, 400));
    assert.ok(h.includes("TRM 4000"));
    assert.ok(h.includes("Moneda COP"));
  });
  test("PVP fijo del infante: línea explícita con su precio y el aviso, sin componentes inventados", () => {
    const h = ver();
    assert.ok(h.includes("Infante (1)"));
    assert.ok(h.includes("PVP fijo"), "aviso explícito");
  });
});
