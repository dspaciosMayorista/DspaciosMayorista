// Se ejecuta con npm run test:react (loader del arnés). #43/#60 entrega 6 — la tarjeta de porción de un hotel con grupos anuncia el «desde»
// con sus noches y su entrada («Desde 550.000 · por persona · 5 noches · Entrada 04/01/2027»); un hotel sin grupos se ve como siempre.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- globals de jsdom para React/ReactDOM
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { TarjetaHotelCard } = await import("../app/tarifario/VistaBooking.tsx");
const { estadiaDesdeDoble } = await import("../lib/tarifario/desdeDoble.ts");
const h = React.createElement;

let root: ReturnType<typeof createRoot> | null = null;
const contenedor = document.createElement("div"); document.body.appendChild(contenedor);
after(() => { if (root) act(() => root!.unmount()); root = null; dom.window.close(); });
function montar(props: Record<string, unknown>) {
  if (root) act(() => root!.unmount());
  root = createRoot(contenedor);
  act(() => root!.render(h(TarjetaHotelCard as never, { onClick: () => {}, foto: null, hotelNombre: "Hotel Grupos", destino: "Cartagena", moneda: "COP", ...props })));
  return contenedor;
}

test("con grupos: precio, noches y entrada de la estadía que lo produce", () => {
  const filas = [{ precio_doble: 600_000, moneda: "COP", noches: 5, desde_entrada_doble: "2027-01-05" }, { precio_doble: 550_000, moneda: "COP", noches: 5, desde_entrada_doble: "2027-01-04" }];
  const est = estadiaDesdeDoble(filas, "COP");
  assert.deepEqual(est, { entrada: "2027-01-04", salida: "2027-01-09", noches: 5 }, "la del MENOR «desde», con su salida (la que precarga el cotizador)");
  const c = montar({ desde: 550_000, desdeEstadia: est });
  assert.match(c.querySelector("[data-testid=precio-desde]")!.textContent!, /550\.000/);
  assert.equal(c.querySelector("[data-testid=estadia-desde]")!.textContent, "por persona · 5 noches · Entrada 04/01/2027");
});

test("sin grupos (sin justificación): la tarjeta de siempre, sin texto de estadía", () => {
  assert.equal(estadiaDesdeDoble([{ precio_doble: 500_000, moneda: "COP", noches: 5 }], "COP"), null);
  const c = montar({ desde: 500_000 });
  assert.ok(c.querySelector("[data-testid=precio-desde]"));
  assert.equal(c.querySelector("[data-testid=estadia-desde]"), null);
});

test("1 noche en singular", () => {
  const c = montar({ desde: 100_000, desdeEstadia: { entrada: "2027-03-01", noches: 1 } });
  assert.equal(c.querySelector("[data-testid=estadia-desde]")!.textContent, "por persona · 1 noche · Entrada 01/03/2027");
});
