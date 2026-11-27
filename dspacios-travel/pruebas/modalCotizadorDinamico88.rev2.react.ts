// Se ejecuta con `npm run test:react:rev2` (glob *.rev2.react.ts) o por comando directo:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/modalCotizadorDinamico88.rev2.react.ts
// H88-01 — el cotizador de la pestaña «Dinámicos» se abre en una VENTANA (modal) y ya no estira la tarjeta ni la grilla.
// Conserva: cálculo del servidor (`evaluar`), selección persistida (sessionStorage), «Continuar al checkout», Escape/foco/cierre y apertura por URL (`abierta`).
import { JSDOM } from "jsdom";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true, FormData: dom.window.FormData, KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { PorDinamicos } = await import("../app/tarifario/PorDinamicos.tsx");
const nav = await import("./support/stubs/nextNavigationStub.mjs") as { __pushes: string[] };

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
  window.sessionStorage.clear(); nav.__pushes.length = 0;
});
after(() => dom.window.close());

const montar = async (el: React.ReactElement) => {
  cont = document.createElement("div"); document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(el); });
};
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = async (el: Element | null | undefined) => { assert.ok(el, "elemento a presionar"); await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const escribir = async (el: HTMLInputElement, valor: string) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
  await act(async () => { el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
};
const esc = async () => { await act(async () => { document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); };
const dialogo = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const botonCotizar = (n: number) => [...cont!.querySelectorAll("article")][n].querySelector("button") as HTMLButtonElement;
const tarjetas = () => [...cont!.querySelectorAll("article")];

const hotelPub = (id: number, nombre: string) => ({ id, nombre, categoria: "Superior", regimen: "PAE", descripcion: "", foto: "/marca/hotel-predeterminado.svg", fotos: ["/marca/hotel-predeterminado.svg"], desde: 300000, reglas: null, categorias: [], regimenes: [], estrellas: null, clasificacion: "", ubicacion: "" });
const opcion = (hotelId: number) => ({ hotelId, vueloId: 7, desdePorPersona: 300000, calc: { esquema: "solo_pvp", pvpModo: "por_componente", moneda: "COP", pctMk: 0, usaVuelo: true, usaHotel: true, usaServicios: false, servicios: [], hotel: { nombre: "x", neto: {}, pvp: { doble: 300000 } } } });
const paquete = () => ({
  id: 5, nombre: "Paquete Mar", moneda: "COP", destino: "CARTAGENA", noches: 3, descripcion: "", incluye: [], noIncluye: [], compraFin: null, usaHotel: true, usaVuelo: true, usaServicios: false,
  vuelos: [{ id: 7, etiqueta: "AV · BOG-CTG", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", detalle: null }], servicios: [],
  hoteles: [hotelPub(11, "Hotel Uno"), hotelPub(12, "Hotel Dos"), hotelPub(13, "Hotel Tres")], opciones: [opcion(11), opcion(12), opcion(13)],
});
const llamadas: { hotelId: number | null }[] = [];
const evaluar = (async (i: { hotelId: number | null }) => { llamadas.push(i); return { ok: true, total: 900000, menores: { ninos: 0, ninos2: 0, infantes: 0, menoresDeDos: 0 }, vuelo: { sillas: 2, infantes: 0 } }; }) as never;

test("Cotizar abre el cotizador en una ventana (role=dialog, con título): la tarjeta y la grilla NO crecen", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete()] as never, evaluar }));
  const antes = tarjetas().map((t) => t.outerHTML);
  assert.equal(dialogo(), null, "cerrado al inicio");
  await click(botonCotizar(1));
  const d = dialogo();
  assert.ok(d, "ventana abierta");
  assert.match(d!.querySelector('[data-slot="dialog-title"]')!.textContent!, /Cotizar · Hotel Dos/);
  assert.ok(d!.querySelector('[data-testid="cotizador-dinamico"]'), "el cotizador está dentro de la ventana");
  assert.equal(cont!.querySelector('[data-testid="cotizador-dinamico"]'), null, "ninguna tarjeta contiene el cotizador");
  assert.deepEqual(tarjetas().map((t) => t.outerHTML), antes, "las 3 tarjetas quedan idénticas (sin desplazamiento de la grilla)");
  // Estructura responsiva de la ventana: altura acotada con desplazamiento propio y ancho que cabe en móvil (390 px) y se limita en escritorio.
  assert.match(d!.className, /max-h-\[90dvh\]/); assert.match(d!.className, /overflow-y-auto/); assert.match(d!.className, /overflow-x-hidden/);
  assert.match(d!.className, /max-w-\[calc\(100%-1rem\)\]/); assert.match(d!.className, /sm:max-w-2xl/);
});

test("el cálculo del servidor sigue igual: total estimado y «Continuar al checkout» con la misma URL de siempre", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete()] as never, evaluar }));
  llamadas.length = 0;
  await click(botonCotizar(0));
  await esperar(500); // espera de 350 ms del cotizador
  assert.equal(llamadas.length, 1, "una sola consulta al servidor tras abrir");
  assert.equal(llamadas[0].hotelId, 11);
  assert.match(dialogo()!.querySelector('[data-testid="total-dinamico"]')!.textContent!, /900\.000/);
  const continuar = [...dialogo()!.querySelectorAll("button")].find((b) => /Continuar al checkout/.test(b.textContent ?? "")) as HTMLButtonElement;
  assert.equal(continuar.disabled, false);
  await click(continuar);
  assert.equal(nav.__pushes.length, 1);
  assert.match(nav.__pushes[0], /^\/tarifario\/checkout\/dinamico\?/);
});

test("Escape y «Cerrar» cierran la ventana; el foco entra a la ventana al abrir", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete()] as never, evaluar }));
  await click(botonCotizar(0));
  await esperar(120);
  assert.ok(dialogo()!.contains(document.activeElement) || document.activeElement === dialogo(), "el foco queda dentro de la ventana");
  await esc(); await esperar(250);
  assert.equal(document.querySelector('[data-testid="cotizador-dinamico"]'), null, "Escape cierra");
  await click(botonCotizar(0)); await esperar(120);
  const cerrar = [...dialogo()!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cerrar") as HTMLButtonElement;
  await click(cerrar); await esperar(250);
  assert.equal(document.querySelector('[data-testid="cotizador-dinamico"]'), null, "«Cerrar» cierra");
});

test("la selección se conserva al cerrar y volver a abrir (sessionStorage, como antes) y es independiente por hotel", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete()] as never, evaluar }));
  await click(botonCotizar(0)); await esperar(60);
  const doble = () => dialogo()!.querySelector('input[aria-label="Habitaciones Doble"]') as HTMLInputElement;
  await escribir(doble(), "3");
  assert.equal(doble().value, "3");
  await esc(); await esperar(250);
  await click(botonCotizar(0)); await esperar(60);
  assert.equal(doble().value, "3", "reabrir restaura la selección de ese hotel");
  await esc(); await esperar(250);
  await click(botonCotizar(1)); await esperar(60);
  assert.equal(doble().value, "1", "otro hotel parte de su propia selección");
});

test("apertura por URL (`abierta`): la ventana del hotel indicado nace abierta y los otros no", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete()] as never, evaluar, abierta: "5:12" }));
  await esperar(60);
  assert.match(dialogo()!.querySelector('[data-slot="dialog-title"]')!.textContent!, /Hotel Dos/);
  assert.equal(document.querySelectorAll('[data-testid="cotizador-dinamico"]').length, 1);
});
