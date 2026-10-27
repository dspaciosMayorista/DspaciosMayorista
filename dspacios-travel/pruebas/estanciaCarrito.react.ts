// Se ejecuta con npm run test:react.
// «Tu selección» del carrito: cada hotel muestra fecha de entrada, fecha de salida y noches con los datos GUARDADOS del ítem; siguen visibles al cerrar y reabrir el carrito y tras
// recargar la página (el carrito vive en localStorage); si falta un dato no se inventa. Cubre los tipos de hotel del carrito: por persona (bloqueo, porción terrestre, dinámico)
// y por unidad (salida sin vuelo con fechas; bloqueo o empaquetado sin fechas guardadas).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/tarifario", pretendToBeVisual: true });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { CartDrawer } = await import("../app/tarifario/CartDrawer.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { estanciaDeHotel, lineaEstancia, fechaCorta } = await import("../lib/cart/estanciaCarrito.ts");
const h = React.createElement;

const CLAVE = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ").trim();
const base = { tipo: "hotel", paqueteId: 10, hotelId: 1, bloqueoId: null, destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1_200_000, edadesMenores: [], moneda: "COP" };
const persona = (id: string, nombre: string, extra: Record<string, unknown>) => ({ ...base, id, hotelNombre: nombre, modulo: "porcion_terrestre", ...extra });
const unidad = (id: string, nombre: string, salida: unknown) => ({
  id, tipo: "hotel", modeloTarifario: "unidad", paqueteId: 20, hotelId: 9, hotelNombre: nombre, destino: "DUBAI", fotoUrl: null, categoria: "Deluxe", alimentacion: "Desayuno",
  salida, habitaciones: [{ acom: "doble", adultos: 2, menores: [] }], precio: 3_000, moneda: "USD",
});
const CARRITO = [
  persona("p1", "Hotel Porción", { fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3 }),
  persona("p2", "Hotel Bloqueo", { modulo: "bloqueo", bloqueoId: 7, fechaIda: "2030-12-01", fechaRegreso: "2030-12-02", noches: 1 }),
  persona("p3", "Hotel Dinámico", { modulo: "dinamico", salidaId: 5, fechaIda: "2031-01-09", fechaRegreso: "2031-01-16", noches: 7 }),
  persona("p4", "Hotel Sin Salida", { fechaIda: "2030-10-15", fechaRegreso: null, noches: null }),
  persona("p5", "Hotel Sin Fechas", { fechaIda: null, fechaRegreso: null, noches: null }),
  unidad("u1", "Hotel Unidad Sin Vuelo", { tipo: "sin_vuelo", fechaIda: "2030-11-01", fechaRegreso: "2030-11-05" }),
  unidad("u2", "Hotel Unidad Bloqueo", { tipo: "bloqueo", id: 3 }),
];

async function montar() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let carrito!: ReturnType<typeof useCart>;
  function Espia() { carrito = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CartDrawer, { checkoutHabilitado: true }), h(Espia, null))); await espera(); });
  return { container, carrito: () => carrito, desmontar: () => { act(() => root.unmount()); container.remove(); } };
}
const estancias = (c: HTMLElement) => Object.fromEntries([...c.querySelectorAll("li")].flatMap((li) => {
  const nombre = li.querySelector(".font-medium")?.textContent?.trim();
  const est = li.querySelector('[data-testid="estancia-hotel"]');
  return nombre && est ? [[nombre, sinEspacios(est.textContent ?? "")]] : [];
}));
const abrir = async (m: Awaited<ReturnType<typeof montar>>) => { await act(async () => { m.carrito().openDrawer(); await espera(); }); };
const cerrar = async (m: Awaited<ReturnType<typeof montar>>) => { await act(async () => { m.carrito().closeDrawer(); await espera(); }); };

const ESPERADO = {
  "Hotel Porción": "Entrada 15 oct 2030 · Salida 18 oct 2030 · 3 noches",
  "Hotel Bloqueo": "Entrada 1 dic 2030 · Salida 2 dic 2030 · 1 noche",
  "Hotel Dinámico": "Entrada 9 ene 2031 · Salida 16 ene 2031 · 7 noches",
  "Hotel Sin Salida": "Entrada 15 oct 2030 · Salida por confirmar",
  "Hotel Sin Fechas": "Entrada por confirmar · Salida por confirmar",
  "Hotel Unidad Sin Vuelo": "Entrada 1 nov 2030 · Salida 5 nov 2030 · 4 noches",
  "Hotel Unidad Bloqueo": "Entrada por confirmar · Salida por confirmar",
};

describe("«Tu selección»: estancia de cada hotel", () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem(CLAVE, JSON.stringify(CARRITO)); });

  test("cada tipo de hotel muestra entrada, salida y noches guardadas; lo que falta dice «por confirmar» y no se inventa", async () => {
    const m = await montar();
    await abrir(m);
    assert.deepEqual(estancias(m.container), ESPERADO);
    m.desmontar();
  });

  test("siguen visibles al cerrar y reabrir el carrito y tras recargar la página (nuevo provider, mismo localStorage)", async () => {
    const m = await montar();
    await abrir(m);
    await cerrar(m);
    assert.equal(m.container.querySelector('[data-testid="estancia-hotel"]'), null, "cerrado: no se pinta");
    await abrir(m);
    assert.deepEqual(estancias(m.container), ESPERADO);
    m.desmontar();
    const recargado = await montar();
    await abrir(recargado);
    assert.deepEqual(estancias(recargado.container), ESPERADO);
    recargado.desmontar();
  });

  test("los importes y los datos del ítem no cambian: es solo presentación", async () => {
    const m = await montar();
    const antes = JSON.stringify(m.carrito().items);
    await abrir(m);
    assert.equal(JSON.stringify(m.carrito().items), antes);
    assert.equal(localStorage.getItem(CLAVE), JSON.stringify(CARRITO));
    m.desmontar();
  });
});

describe("estanciaDeHotel (puro)", () => {
  test("fecha inexistente o con otro formato = null (no se corrige ni se inventa); noches solo del ítem o de las DOS fechas válidas", () => {
    assert.deepEqual(estanciaDeHotel({ fechaIda: "2030-02-30", fechaRegreso: "2030-03-02", noches: null }), { entrada: null, salida: "2030-03-02", noches: null });
    assert.deepEqual(estanciaDeHotel({ fechaIda: "15/10/2030", fechaRegreso: "", noches: null }), { entrada: null, salida: null, noches: null });
    assert.deepEqual(estanciaDeHotel({ fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: null }), { entrada: "2030-10-15", salida: "2030-10-18", noches: 3 });
    assert.deepEqual(estanciaDeHotel({ fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 5 }), { entrada: "2030-10-15", salida: "2030-10-18", noches: 5 }, "manda lo guardado");
    assert.deepEqual(estanciaDeHotel({ fechaIda: "2030-10-18", fechaRegreso: "2030-10-15", noches: null }).noches, null, "salida anterior a la entrada: sin noches");
    assert.deepEqual(estanciaDeHotel({ modeloTarifario: "unidad", salida: { tipo: "empaquetado", fechaIda: "2030-10-15" } }), { entrada: null, salida: null, noches: null });
  });
  test("formato", () => {
    assert.equal(fechaCorta("2030-01-05"), "5 ene 2030");
    assert.equal(lineaEstancia({ entrada: "2030-10-15", salida: null, noches: null }), "Entrada 15 oct 2030 · Salida por confirmar");
  });
});
