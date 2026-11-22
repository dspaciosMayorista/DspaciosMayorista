// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Owner 2026-11-18 (#102): la Vista tabla debe mostrar también los alojamientos POR UNIDAD (antes solo la Vista Booking los buscaba).
// Se pintan con el componente REAL de la tabla: precio por habitación (no por persona), habitaciones/viajeros confirmados por el servidor, filtros generales,
// estado vacío solo-unidad, y nunca una tarifa por persona inventada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.getBoundingClientRect = function () { return { width: 900, height: 40, top: 0, left: 0, right: 900, bottom: 40, x: 0, y: 0, toJSON() {} }; };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { TablaResultadosBusqueda, textoOcupacionUnidad, nochesEntreISO } = await import("../app/tarifario/TablaResultadosBusqueda.tsx");
const h = React.createElement;

const opcion = (over: Record<string, unknown> = {}) => ({
  hotelId: 10311, hotelNombre: "U1 · Hotel por unidad con edades", paqueteId: 10311, paqueteNombre: "Porción U1 (unidad)", destinoNombre: "CARTAGENA U1",
  categoria: "Estandar", alimentacion: "PAM", moneda: "COP", precioVenta: 600_000, paxTotal: 2, fechaIda: "2030-06-10", fechaRegreso: "2030-06-13",
  ocupacion: [{ id: "h1", acom: "doble" as const, adultos: 2, edadesMenores: [] as number[] }], ...over,
});
const estadoDe = (unidad: unknown[], resultados: unknown[] = []) => ({
  destino: "CARTAGENA U1", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13", resultados, diagnostico: "No hay hoteles con tarifa para esas fechas.", sugerenciasFecha: [],
  unidad: unidad.map((o) => ({ hotelId: (o as { hotelId: number }).hotelId, estado: "disponible", opciones: [o] })), avisoUnidad: null, enRevision: [],
  ocupacion: { numHabitaciones: 1, adultos: 2, edadesMenores: [] as number[] },
});
async function montar(el: unknown) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(el as never); });
  return { cont, cerrar: async () => { await act(async () => root.unmount()); cont.remove(); } };
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("Vista tabla — alojamientos por unidad", () => {
  test("funciones puras: noches entre fechas y texto de habitaciones/viajeros confirmados", () => {
    assert.equal(nochesEntreISO("2030-06-10", "2030-06-13"), 3);
    assert.equal(textoOcupacionUnidad(opcion()), "1 hab Doble · 2 adultos");
    assert.equal(textoOcupacionUnidad(opcion({ ocupacion: [{ id: "a", acom: "doble" as const, adultos: 2, edadesMenores: [8] }, { id: "b", acom: "sencilla" as const, adultos: 1, edadesMenores: [] }] })), "1 hab Doble + 1 hab Sencilla · 3 adultos + 1 menor (8 años)");
  });

  test("solo unidad (sin filas por persona): NO muestra el estado vacío; pinta el total por habitación y no inventa tarifa por persona", async () => {
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe([opcion()]) as never }));
    assert.equal(m.cont.querySelector('[data-testid="tabla-sin-resultados"]'), null);
    const sec = m.cont.querySelector('[data-testid="tabla-unidad"]') as HTMLElement;
    assert.ok(sec, "sección de alojamientos por unidad");
    const t = norm(sec.textContent);
    assert.match(t, /Alojamientos por unidad · estadía de 3 noches/);
    assert.match(t, /Precio por habitación, no por persona/);
    assert.match(t, /U1 · Hotel por unidad con edades/); assert.match(t, /1 hab Doble · 2 adultos/); assert.match(t, /\$\s?600\.000/); assert.match(t, /2 pax · por unidad/);
    // O-2: ya no se oculta la lectura por adulto, pero SOLO como «equivalente informativo» de la base de la unidad; nunca una tarifa de adulto vendible.
    assert.doesNotMatch(t, /Tarifa de adulto/, "no hay tarifa por persona para un hotel por unidad");
    assert.match(t, /equivalente informativo ≈ \$\s?300\.000 c\/u \(base ÷ 2; el precio real es por unidad, no por persona\)/);
    assert.equal(m.cont.querySelector('section[aria-labelledby="sec-estadia"]'), null, "sin filas por persona no hay sección de estadía por persona");
    assert.equal(m.cont.querySelector('section[aria-labelledby="sec-noche"]'), null, "ni noche adicional (no se calcula para unidad)");
    assert.match(t, /No se calcula una noche adicional/);
    await m.cerrar();
  });

  test("filtros generales: hotel, categoría y alimentación se aplican también a las filas por unidad", async () => {
    const e = estadoDe([opcion(), opcion({ hotelId: 10312, hotelNombre: "U1 · Otro hotel", alimentacion: "PA", precioVenta: 900_000 })]);
    let m = await montar(h(TablaResultadosBusqueda, { estado: e as never, q: "otro" }));
    assert.match(norm(m.cont.textContent), /U1 · Otro hotel/); assert.doesNotMatch(norm(m.cont.textContent), /Hotel por unidad con edades/); await m.cerrar();
    m = await montar(h(TablaResultadosBusqueda, { estado: e as never, fReg: "PAM" }));
    assert.match(norm(m.cont.textContent), /Hotel por unidad con edades/); assert.doesNotMatch(norm(m.cont.textContent), /Otro hotel/); await m.cerrar();
    m = await montar(h(TablaResultadosBusqueda, { estado: e as never, fCat: "Premium" }));
    assert.match(norm(m.cont.textContent), /Ningún resultado coincide con los filtros/); await m.cerrar();
  });

  test("más de dos opciones del mismo hotel: se ven dos y «Ver N opciones más» las despliega (acotado)", async () => {
    const ops = ["PAM", "PA", "AI"].map((a, i) => opcion({ alimentacion: a, precioVenta: 600_000 + i * 10_000 }));
    const e = { ...estadoDe([]), unidad: [{ hotelId: 10311, estado: "disponible", opciones: ops }] };
    const m = await montar(h(TablaResultadosBusqueda, { estado: e as never }));
    const filas = () => m.cont.querySelectorAll('[data-testid="tabla-unidad"] tbody tr td[data-label="Alimentación"]').length;
    assert.equal(filas(), 2);
    const boton = [...m.cont.querySelectorAll("button")].find((b) => /Ver 1 opción más/.test(b.textContent ?? ""))!;
    assert.ok(boton);
    await act(async () => { boton.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    assert.equal(filas(), 3);
    await m.cerrar();
  });

  test("sin unidad y sin personas: el estado vacío de siempre; con personas y unidad: ambas secciones", async () => {
    let m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe([]) as never }));
    assert.ok(m.cont.querySelector('[data-testid="tabla-sin-resultados"]')); await m.cerrar();
    const persona = { hotelId: 1, hotelNombre: "Hotel persona", destino: "X", paqueteId: 1, paqueteNombre: "P", categoria: "Estandar", regimen: "PAM", moneda: "COP", noches: 3, combos: [{ categoria: "Estandar", regimen: "PAM", total: 500_000, pax: 2, desglose: [{ clase: "adulto", cantidad: 2, tarifa: 250_000, subtotal: 500_000 }], nocheAdicional: { estado: "ok", fecha: "2030-06-13", total: 100_000, desglose: [{ clase: "adulto", cantidad: 2, tarifa: 50_000, subtotal: 100_000 }] } }] };
    m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe([opcion()], [persona]) as never }));
    assert.ok(m.cont.querySelector('section[aria-labelledby="sec-estadia"]')); assert.ok(m.cont.querySelector('[data-testid="tabla-unidad"]')); assert.ok(m.cont.querySelector('section[aria-labelledby="sec-noche"]'));
    await m.cerrar();
  });

  // G2 (2026-11-18): hotel por unidad en USD — la moneda de la opción se conserva en la tabla; nunca se imprime en COP ni se convierte (valores a mano: 2 adultos × 3 noches × USD 100 = USD 600).
  test("hotel por unidad en USD: el total se pinta en USD ($600 → «USD $600»), sin importes COP", async () => {
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe([opcion({ moneda: "USD", precioVenta: 600, destinoNombre: "CARTAGENA U2 USD" })]) as never }));
    const sec = m.cont.querySelector('[data-testid="tabla-unidad"]') as HTMLElement;
    assert.ok(sec, "sección por unidad");
    const t = norm(sec.textContent);
    assert.match(t, /USD\s?\$\s?600(?![.,\d])|USD\s?\$\s?600(?=\d pax)/, "USD $600 sin separador de miles ni decimales (la celda siguiente empieza por los pax)");
    assert.doesNotMatch(t, /COP|\$\s?600\.000/);
    await m.cerrar();
  });
});
