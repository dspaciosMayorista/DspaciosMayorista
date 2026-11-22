// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// O-2 — lectura adulto/menores de un alojamiento por unidad, pintada con el componente REAL de la tabla y con el ejemplo del dueño:
// 2 adultos, niño de 8 años con cargo propio de 150.000 por 3 noches, infante de 2 años sin cargo; total 750.000 → base de la unidad 600.000,
// equivalente informativo ≈ 300.000 por adulto, y el total NO cambia. Habitaciones distintas / menor que paga como adulto: sin reparto. USD conservado.
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
const { TablaResultadosBusqueda } = await import("../app/tarifario/TablaResultadosBusqueda.tsx");
const { DesgloseUnidad } = await import("../app/tarifario/DesgloseUnidad.tsx");
const h = React.createElement;
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const nino = { habitacion: 1, edad: 8, clase: "nino" as const, cobro: "por_noche" as const, cargoVenta: 150_000, noches: 3 };
const infante = { habitacion: 1, edad: 2, clase: "infante" as const, cobro: "por_noche" as const, cargoVenta: 0, noches: 3 };
const opcion = (over: Record<string, unknown> = {}) => ({
  hotelId: 10311, hotelNombre: "Hotel por unidad", paqueteId: 10311, paqueteNombre: "Porción U1", destinoNombre: "CARTAGENA U1",
  categoria: "Estandar", alimentacion: "PAM", moneda: "COP", precioVenta: 750_000, paxTotal: 4, fechaIda: "2030-06-10", fechaRegreso: "2030-06-13",
  ocupacion: [{ id: "h1", acom: "doble" as const, adultos: 2, edadesMenores: [8, 2] }], menores: [nino, infante], ...over,
});
const estadoDe = (o: unknown) => ({
  destino: "CARTAGENA U1", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13", resultados: [], diagnostico: null, sugerenciasFecha: [],
  unidad: [{ hotelId: 10311, estado: "disponible", opciones: [o] }], avisoUnidad: null, enRevision: [],
  ocupacion: { numHabitaciones: 1, adultos: 2, edadesMenores: [8, 2] },
});
async function montar(el: unknown) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(el as never); });
  return { cont, cerrar: async () => { await act(async () => root.unmount()); cont.remove(); } };
}
const txt = (cont: HTMLElement, id: string) => norm(cont.querySelector(`[data-testid="${id}"]`)?.textContent);

describe("Tabla por unidad — desglose informativo (O-2)", () => {
  test("ejemplo del dueño: base 600.000 · ≈ 300.000 por adulto (marcado como informativo) · cargo propio del niño 150.000 · total 750.000 sin cambios", async () => {
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe(opcion()) as never }));
    assert.match(txt(m.cont, "desglose-base"), /Base de la unidad \(incluye 1 menor sin cargo propio\)\s*\$\s?600\.000/);
    assert.match(txt(m.cont, "desglose-equivalente"), /2 adultos · equivalente informativo ≈ \$\s?300\.000 c\/u \(base ÷ 2; el precio real es por unidad, no por persona\)/);
    assert.match(txt(m.cont, "desglose-cargos"), /Cargos propios de menores \(ya suman al total\)\s*\$\s?150\.000/);
    assert.match(txt(m.cont, "desglose-total"), /Total de la reserva\s*\$\s?750\.000/);
    const t = norm(m.cont.textContent);
    assert.match(t, /Niño de 8 años: cargo propio \$\s?150\.000 en total \(se cobra por noche, 3 noches; ya incluido en el total\)/, "las líneas por menor siguen intactas");
    assert.match(t, /Infante de 2 años: sin cargo propio/);
    assert.equal((t.match(/\$\s?750\.000/g) ?? []).length >= 2, true, "el total sigue en la columna de precio y en el desglose");
    await m.cerrar();
  });

  test("habitaciones con tarifas distintas: se muestra la base pero no se reparte entre adultos", async () => {
    const o = opcion({ precioVenta: 900_000, menores: [], ocupacion: [{ id: "a", acom: "doble" as const, adultos: 2, edadesMenores: [] }, { id: "b", acom: "sencilla" as const, adultos: 1, edadesMenores: [] }] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe(o) as never }));
    assert.match(txt(m.cont, "desglose-base"), /\$\s?900\.000/);
    assert.equal(m.cont.querySelector('[data-testid="desglose-equivalente"]'), null);
    assert.match(txt(m.cont, "desglose-sin-equivalente"), /habitaciones con tarifas distintas: no se reparte entre adultos/);
    await m.cerrar();
  });

  test("un menor que paga como adulto: sin equivalente (su tarifa no existe como número aparte)", async () => {
    const o = opcion({ precioVenta: 900_000, menores: [{ habitacion: 1, edad: 14, clase: "como_adulto", cobro: "como_adulto", cargoVenta: null, noches: 3 }] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe(o) as never }));
    assert.equal(m.cont.querySelector('[data-testid="desglose-equivalente"]'), null);
    assert.match(txt(m.cont, "desglose-sin-equivalente"), /pagan como adulto/);
    await m.cerrar();
  });

  test("USD: los importes se pintan en dólares (sin COP) y el cálculo es el mismo", async () => {
    const o = opcion({ moneda: "USD", precioVenta: 750, menores: [{ ...nino, cargoVenta: 150 }, infante] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe(o) as never }));
    const d = norm(m.cont.querySelector('[data-testid="desglose-unidad"]')?.textContent);
    assert.match(d, /USD\s?\$\s?600/); assert.match(d, /USD\s?\$\s?300/); assert.match(d, /USD\s?\$\s?150/); assert.match(d, /USD\s?\$\s?750/);
    assert.doesNotMatch(d, /COP|\$\s?600\.000/);
    await m.cerrar();
  });

  test("solo adultos: base = total y equivalente por adulto; sin línea de cargos", async () => {
    const o = opcion({ precioVenta: 600_000, menores: [], ocupacion: [{ id: "h1", acom: "doble" as const, adultos: 2, edadesMenores: [] }] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoDe(o) as never }));
    assert.match(txt(m.cont, "desglose-base"), /Base de la unidad\s*\$\s?600\.000/);
    assert.match(txt(m.cont, "desglose-equivalente"), /≈ \$\s?300\.000 c\/u/);
    assert.equal(m.cont.querySelector('[data-testid="desglose-cargos"]'), null);
    await m.cerrar();
  });

  test("el mismo componente de la tarjeta y del modal: sin datos coherentes no pinta nada (nunca números inventados)", async () => {
    const m = await montar(h(DesgloseUnidad, { precioVenta: 100_000, moneda: "COP", ocupacion: [{ acom: "doble", adultos: 2 }], menores: [nino] }));
    assert.equal(m.cont.querySelector('[data-testid="desglose-unidad"]'), null, "cargos mayores que el total: no se explica");
    await m.cerrar();
  });
});
