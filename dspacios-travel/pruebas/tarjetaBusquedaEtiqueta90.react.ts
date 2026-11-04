// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 · Tarjeta pública de la búsqueda por fechas (`Resultado`): la etiqueta de la regla ganadora va en la zona de etiquetas del hotel (junto a Pet friendly / Adults Only),
// solo si el resultado trae `descuentoHotel`, y el precio de la tarjeta es el `total` del MISMO resultado. Que ese total corresponda a esa promoción lo prueba
// pruebas/tarjetaBusquedaPromo90.test.ts con buscarHoteles real (aquí se verifica la presentación).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { JSDOM } = await import("jsdom");
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");
const { formatMoneda } = await import("../lib/utils.ts");

type R = Parameters<typeof Resultado>[0]["r"];
const base = (total: number, extra: Record<string, unknown> = {}) => ({
  hotelId: 72, hotelNombre: "Grand Sirenis San Andrés", destino: "San Andrés", paqueteId: 61, categoria: "Estándar King", regimen: "FULL", paqueteNombre: "Porción San Andrés",
  total, noches: 3, moneda: "COP", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", habitaciones: { doble: 1 }, menores: { infantes: 0, nino: 0, nino2: 0 }, edadesMenores: [], pax: 2,
  combos: [{ categoria: "Estándar King", regimen: "FULL", total, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 } }], condicion: null, ...extra,
}) as unknown as R;

const html = (r: R) => renderToStaticMarkup(createElement(CartProvider as ComponentType<{ children: unknown }>, null, createElement(Resultado as ComponentType<Record<string, unknown>>, {
  r, foto: null, info: { estrellas: 4, clasificacion: null, descripcion: null, ubicacion: null, adultsOnly: false, petFriendly: true }, descripcionPorPaquete: {}, addonsPorPaquete: new Map(),
})));
const doc = (h: string) => new JSDOM(`<body>${h}</body>`).window.document;

const CASOS: [string, number, { etiqueta: string; tipo: "ebb" | "long_stay"; umbral: number; pct: number } | null][] = [
  ["EBB 1", 1_050_000, { etiqueta: "EBB 1 · 30+ días · 18 %", tipo: "ebb", umbral: 30, pct: 18 }],
  ["EBB 2", 980_000, { etiqueta: "EBB 2 · 60+ días · 23 %", tipo: "ebb", umbral: 60, pct: 23 }],
  ["EBB 3", 900_000, { etiqueta: "EBB 3 · 90+ días · 28 %", tipo: "ebb", umbral: 90, pct: 28 }],
  ["Long Stay ganador", 1_120_000, { etiqueta: "Long Stay · 25 %", tipo: "long_stay", umbral: 4, pct: 25 }],
  ["sin descuento", 1_280_000, null],
];

describe("tarjeta de búsqueda por fechas", () => {
  for (const [nombre, total, descuento] of CASOS) {
    test(nombre, () => {
      const d = doc(html(base(total, descuento ? { descuentoHotel: descuento } : {})));
      const etiquetas = d.querySelectorAll('[data-testid="etiqueta-descuento-hotel"]');
      if (!descuento) { assert.equal(etiquetas.length, 0, "sin descuento no hay etiqueta"); }
      else {
        assert.equal(etiquetas.length, 1, "una sola etiqueta: la ganadora, nunca dos ni sumadas");
        assert.equal(etiquetas[0].textContent?.trim(), descuento.etiqueta);
        // Misma zona que el nombre del hotel y sus demás etiquetas (Pet friendly), no en un bloque aparte.
        const zona = etiquetas[0].parentElement!;
        assert.match(zona.textContent ?? "", /Grand Sirenis San Andrés/);
        assert.match(zona.textContent ?? "", /Pet friendly/i);
      }
      // El precio de la tarjeta es el total del mismo resultado.
      assert.ok((d.body.textContent ?? "").includes(formatMoneda(total, "COP")), "se muestra el total del resultado");
    });
  }
  test("la tarjeta no inventa descuento: sin descuentoHotel nunca aparece «EBB» ni «Long Stay»", () => {
    assert.doesNotMatch(doc(html(base(1_280_000))).body.textContent ?? "", /EBB|Long Stay/);
  });
});

// Revalidar antes del carrito: el precio nuevo y la regla llegan JUNTOS desde la misma búsqueda; si el día cambió y el escalón baja, la etiqueta cambia con el precio.
const { revalidarHotelPersona } = await import("../app/tarifario/BuscadorBooking.tsx");
describe("revalidación de la tarjeta de búsqueda: precio y etiqueta del mismo cálculo", () => {
  const item = { tipo: "hotel", modeloTarifario: "persona", paqueteId: 61, hotelId: 72, destino: "San Andrés", categoria: "Estándar King", regimen: "FULL", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", habitaciones: { doble: 1 }, edadesMenores: [], pax: 2, ninos: 0, ninos2: 0, infantes: 0, moneda: "COP", precio: 1_050_000, condicion: null } as never;
  const buscar = (total: number, descuentoHotel: unknown) => async () => ({ ok: true, resultados: [base(total, { descuentoHotel })] }) as never;
  test("precio igual: se confirma con su etiqueta", async () => {
    const r = await revalidarHotelPersona(buscar(1_050_000, { etiqueta: "EBB 1 · 30+ días · 18 %" }), item, 1_050_000);
    assert.equal(r.estado, "ok");
    if (r.estado === "ok") { assert.equal(r.precioCambio, false); assert.equal(r.descuentoHotel?.etiqueta, "EBB 1 · 30+ días · 18 %"); }
  });
  test("pasó un día y el escalón bajó: el precio sube y la etiqueta cambia con él (no queda la de ayer)", async () => {
    const r = await revalidarHotelPersona(buscar(1_120_000, { etiqueta: "EBB 1 · 30+ días · 18 %" }), item, 980_000); // ayer: EBB 2 a 980.000
    assert.equal(r.estado, "ok");
    if (r.estado === "ok") { assert.equal(r.precioCambio, true); assert.equal(r.precio, 1_120_000); assert.equal(r.descuentoHotel?.etiqueta, "EBB 1 · 30+ días · 18 %"); }
  });
  test("ya sin descuento: precio base y sin etiqueta", async () => {
    const r = await revalidarHotelPersona(buscar(1_280_000, null), item, 1_050_000);
    assert.equal(r.estado, "ok");
    if (r.estado === "ok") { assert.equal(r.precioCambio, true); assert.equal(r.descuentoHotel, null); }
  });
});
