// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 · Presentación de la etiqueta de la regla ganadora (EBB / Long Stay): se ve solo cuando hubo descuento y no cambia ningún total mostrado.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { EtiquetaDescuentoHotel } = await import("../components/cotizacion/EtiquetaDescuentoHotel.tsx");
const { ComposicionPrecio } = await import("../components/cotizacion/ComposicionPrecio.tsx");
const { leerComposicionCotizacion } = await import("../lib/cotizacion/composicionPrecio.ts");

const html = (d: unknown) => renderToStaticMarkup(createElement(EtiquetaDescuentoHotel as ComponentType<{ descuento?: unknown }>, { descuento: d }));

describe("EtiquetaDescuentoHotel", () => {
  test("con regla: muestra la etiqueta de la ganadora", () => {
    const h = html({ etiqueta: "EBB 3 · 90+ días · 28 %" });
    assert.match(h, /data-testid="etiqueta-descuento-hotel"/);
    assert.match(h, /EBB 3 · 90\+ días · 28 %/);
  });
  test("Long Stay con su porcentaje", () => assert.match(html({ etiqueta: "Long Stay · 25 %" }), /Long Stay · 25 %/));
  test("sin descuento (null, undefined o sin etiqueta) no muestra nada", () => {
    for (const d of [null, undefined, {}, { etiqueta: "" }, { etiqueta: "  " }]) assert.equal(html(d), "");
  });
});

describe("composición guardada de la cotización", () => {
  const composicion = (extra: Record<string, unknown> = {}) => ({
    version: 1, moneda: "COP", trm: null, markup: { tipo: "global", pct: 0.2 }, impuestoIncluido: 0, total: 2_367_000, cuadra: true,
    lineas: [{ clave: "doble", etiqueta: "1 hab Doble (2 pax)", pax: 2, pvpPorPersona: 1_183_500, total: 2_367_000, componentes: null }], adicionales: [], ...extra,
  });
  const guardada = (extra?: Record<string, unknown>) => leerComposicionCotizacion({ version: 1, hoteles: [{ ref: null, nombre: "Hotel", composicion: composicion(extra) }] });
  const render = (g: ReturnType<typeof guardada>) => renderToStaticMarkup(createElement(ComposicionPrecio as ComponentType<{ guardada: unknown; totalCotizacion: number | null }>, { guardada: g, totalCotizacion: 2_367_000 }));
  const sinEtiqueta = (h: string) => h.replace(/<span data-testid="etiqueta-descuento-hotel".*?<\/span>/, "");

  test("la etiqueta guardada sobrevive a la lectura y se muestra en la composición", () => {
    const h = render(guardada({ descuentoHotel: { etiqueta: "EBB 1 · 30+ días · 18 %", tipo: "ebb", umbral: 30, pct: 18 } }));
    assert.match(h, /EBB 1 · 30\+ días · 18 %/);
  });
  test("agregar la etiqueta no cambia ningún importe ni el cuadre mostrado", () => {
    const con = render(guardada({ descuentoHotel: { etiqueta: "Long Stay · 25 %", tipo: "long_stay", umbral: 4, pct: 25 } }));
    const sin = render(guardada());
    assert.equal(sinEtiqueta(con).replace(/<div class="border-b border-gray-100 px-4 py-2"><\/div>/, ""), sin.replace(/<div class="border-b border-gray-100 px-4 py-2"><\/div>/, ""));
    assert.doesNotMatch(con, /composicion-no-cuadra|composicion-difiere/);
  });
  test("cotización sin descuento (o anterior a #90): no hay etiqueta", () => {
    assert.doesNotMatch(render(guardada()), /etiqueta-descuento-hotel/);
  });
  test("una etiqueta mal formada no se muestra", () => {
    assert.doesNotMatch(render(guardada({ descuentoHotel: { etiqueta: "x", tipo: "otra", umbral: 1, pct: 1 } })), /etiqueta-descuento-hotel/);
  });
});

// Resumen de la cotización nueva (documento que ven venta y el cliente): la etiqueta sale del snapshot, solo con descuento, y el total no cambia.
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
describe("ContratoDocumento (resumen de la cotización)", () => {
  const venta = {
    numero_contrato: "", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
    asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
    pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
  };
  const hotel = (extra: Record<string, unknown>) => ({ id: 1, nombre: "Hotel Prueba", categoria: "Estándar", ciudad: "Cartagena", alimentacion: "PC", acomodacion: "Doble", detalle_acomodacion: "1 hab Doble (2 pax)", fecha_ingreso: "2030-10-15", fecha_salida: "2030-10-18", ...extra });
  const items = [{ id: 1, numero_contrato: "", descripcion: "1 hab Doble (2 pax)", adultos: 2, ninos: 0, tarifa_adulto: 1_183_500, tarifa_nino: 0, orden: 1, modo_precio: "por_persona", valor_total: null }];
  const html = (h: unknown) => renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, {
    venta, pasajeros: [], hoteles: [h], vuelos: [], items, totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null, paqueteSnapshot: null,
  }));
  test("con descuento: la etiqueta aparece en el hotel; el resto del documento (total incluido) es idéntico al de sin descuento", () => {
    const con = html(hotel({ descuento_hotel: { etiqueta: "EBB 2 · 60+ días · 23 %" } }));
    const sin = html(hotel({}));
    assert.match(con, /data-testid="etiqueta-descuento-hotel"/);
    assert.match(con, /EBB 2 · 60\+ días · 23 %/);
    assert.doesNotMatch(sin, /etiqueta-descuento-hotel/);
    assert.equal(con.replace(/<div class="mt-1"><span data-testid="etiqueta-descuento-hotel".*?<\/span><\/div>/, ""), sin);
  });
  test("sin descuento (o etiqueta vacía) no hay etiqueta", () => {
    assert.doesNotMatch(html(hotel({ descuento_hotel: { etiqueta: "" } })), /etiqueta-descuento-hotel/);
  });
});
