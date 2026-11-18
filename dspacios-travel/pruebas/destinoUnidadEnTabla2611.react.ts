// Se ejecuta con npm run test:react (loader del arnés).
//
// Owner 2026-11-18, hallazgo de la verificación en el build final: en Vista tabla el selector de destino se armaba con `destinosPorcionPublica(filas, [])`, así que un destino que
// solo existe por hoteles de UNIDAD (CARTAGENA U1) NO se podía elegir y la sección «Alojamientos por unidad» era inalcanzable aunque el componente la pintara bien.
import { JSDOM } from "jsdom";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true, FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { TarifarioPublic } = await import("../app/tarifario/TarifarioPublic.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); cont?.remove(); root = null; cont = null; });
after(() => dom.window.close());

const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const unidad = (hotelId: number, hotelNombre: string, destinoNombre: string) => ({
  hotelId, hotelNombre, paqueteId: hotelId, paqueteNombre: `Porción ${hotelId}`, destinoNombre, tipo: "porcion_terrestre",
  categorias: ["Estandar"], regimenes: ["PAM"], destinoId: 10311, moneda: "COP", salidas: [],
});

const FILA = {
  servicio_id: null, servicio_nombre: null, precio_sencilla: 800000, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null, precio_infante: null, descripcion: null,
  recargo_individual: null, tipo_tarifa: null, moneda: "COP", categoria: "Estandar", regimen: "PAM", paquete_id: 102, paquete_nombre: "Porción 102", hotel_id: 1021, hotel_nombre: "Hotel persona 102",
  destino_id: 8, destino_nombre: "CARTAGENA 102", empaquetado_id: null, bloqueo_id: null, salida_id: null, bloqueo_label: null, precio_doble: 600000, desde_adulto: 600000, desde_general: 600000,
  modulo: "porcion_terrestre", fecha_ida: null, fecha_regreso: null, noches: 3, acomodacion: "doble", precio_pvp: 600000,
};
async function montar(props: Record<string, unknown>) {
  cont = document.createElement("div"); document.body.appendChild(cont); root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(TarifarioPublic, { programas: [], puedeReservar: true, ...props } as never))); });
  await clic([...cont.querySelectorAll("button")].find((b) => b.textContent === "Vista tabla")!);
  const porcion = [...cont.querySelectorAll("button")].find((b) => /^Porción terrestre$/.test((b.textContent ?? "").trim()));
  if (porcion) await clic(porcion);
  return cont;
}
const abrirDestinos = async (c: HTMLElement) => {
  const combo = [...c.querySelectorAll('[role="combobox"], button')].find((b) => /Selecciona un destino/.test(b.textContent ?? ""));
  assert.ok(combo, "el selector de destino de la tabla existe");
  await clic(combo!);
  return [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent ?? "").trim());
};

test("Vista tabla: un destino que SOLO existe por hoteles de unidad aparece en el selector de destino (antes: [] → inalcanzable)", async () => {
  const c = await montar({ filas: [FILA], hotelesBernalo: [unidad(10311, "U1 · Hotel por unidad con edades", "CARTAGENA U1")] });
  const opciones = await abrirDestinos(c);
  assert.ok(opciones.includes("CARTAGENA U1"), `opciones del selector: ${JSON.stringify(opciones)}`);
});

test("Vista tabla: sin hoteles de unidad el selector no inventa destinos (no hay regresión para destinos por persona)", async () => {
  const c = await montar({ filas: [FILA], hotelesBernalo: [] });
  const opciones = await abrirDestinos(c);
  assert.ok(!opciones.includes("CARTAGENA U1"));
});

test("Vista tabla: hoteles de unidad de otros módulos (bloqueo) no aparecen como destinos de porción terrestre", async () => {
  const bloqueo = { ...unidad(10312, "U Bloqueo", "DESTINO SOLO BLOQUEO"), tipo: "bloqueo" };
  const c = await montar({ filas: [FILA], hotelesBernalo: [bloqueo] });
  const opciones = await abrirDestinos(c);
  assert.ok(!opciones.includes("DESTINO SOLO BLOQUEO"));
});
