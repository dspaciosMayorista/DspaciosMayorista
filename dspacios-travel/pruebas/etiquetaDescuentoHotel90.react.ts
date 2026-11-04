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
