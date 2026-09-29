// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `DifusionClient.tsx` → MaterialForm, tras
// reemplazar el <select> de "Desde el tarifario" por `ComboHotel`:
//   - Elegir un hotel rellena hotelProducto y destino (como antes) y guarda con
//     hotelId numérico.
//   - Escribir DESPUÉS de elegir vuelve al modo manual (hotelId null) SIN
//     borrar los textos hotelProducto/destino ya rellenados.
//   - El botón ✕ (Limpiar) del combo hace lo mismo.
// Se sustituyen (vía reactLoader) la Server Actions real, `DateInput`
// (react-day-picker no está en el entorno) y `next/navigation`.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { DifusionClient } = await import("../app/(crm)/crm/difusion/DifusionClient.tsx");
const { __setImpls } = await import("./support/stubs/difusionActionsStub.mjs");
const { act, createElement: h } = React;

const guardados: Record<string, unknown>[] = [];
__setImpls({
  crearMaterial: async (input: unknown) => { guardados.push(input as Record<string, unknown>); return { ok: true } as const; },
  actualizarMaterial: async () => ({ ok: true } as const),
});

const HOTELES = [
  { id: 10, nombre: "Hotel Sol", destino: "CARTAGENA" },
  { id: 11, nombre: "Hotel Mar", destino: "SAN ANDRES" },
];

function Harness() {
  return h(DifusionClient, {
    hoy: "2026-09-24", materiales: [], envios: [], plan: [], hoteles: HOTELES, destinos: [],
  });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render() {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  guardados.length = 0;
  await act(async () => root!.render(h(Harness)));
}

const porTexto = (texto: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

const combo = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const hotelProducto = () => container.querySelector<HTMLInputElement>('input[placeholder="Nombre del hotel o producto"]')!;
const destino = () => container.querySelector<HTMLInputElement>('input[list="dif-destinos"]')!;

async function abrirInventario() {
  await act(async () => porTexto("Inventario")!.click());
  await act(async () => porTexto("+ Agregar material")!.click());
}

async function enfocar() {
  await act(async () => combo().focus());
}

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(combo(), valor);
    combo().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function tecla(key: string) {
  const ev = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => combo().dispatchEvent(ev));
}

async function elegirConRaton(nombre: string) {
  const opcion = [...container.querySelectorAll('[role="option"]')].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

async function clicGuardar() {
  const btn = porTexto("Guardar");
  assert.ok(btn, "faltó el botón Guardar");
  await act(async () => btn!.click());
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("elegir un hotel del tarifario rellena hotelProducto y destino", async () => {
  await render();
  await abrirInventario();
  await enfocar();
  await elegirConRaton("Hotel Sol");
  assert.equal(combo().value, "Hotel Sol (CARTAGENA)", "el combo muestra el hotel elegido con su destino");
  assert.equal(hotelProducto().value, "Hotel Sol", "rellena el campo Hotel / Producto");
  assert.equal(destino().value, "CARTAGENA", "rellena el campo Destino");
});

test("guardar envía hotelId (numero) junto con los textos rellenados desde el tarifario", async () => {
  await render();
  await abrirInventario();
  await enfocar();
  await elegirConRaton("Hotel Sol");
  await clicGuardar();
  assert.equal(guardados.length, 1, "se llamó crearMaterial");
  assert.equal(guardados[0]!.hotelId, 10, "hotelId numérico del hotel elegido");
  assert.equal(guardados[0]!.hotelProducto, "Hotel Sol");
  assert.equal(guardados[0]!.destino, "CARTAGENA");
});

test("escribir DESPUÉS de elegir vuelve a modo manual sin borrar los textos rellenados", async () => {
  await render();
  await abrirInventario();
  await enfocar();
  await elegirConRaton("Hotel Mar");
  assert.equal(hotelProducto().value, "Hotel Mar", "el hotel rellenó el producto");
  await escribir("cart");                // nueva búsqueda → invalida hotelId
  await tecla("Escape");
  assert.equal(combo().value, "", "el combo queda vacío (modo manual, sin hotel vinculado)");
  assert.equal(hotelProducto().value, "Hotel Mar", "el texto del producto NO se borra al invalidar");
  assert.equal(destino().value, "SAN ANDRES", "el destino rellenado NO se borra al invalidar");
  await clicGuardar();
  assert.equal(guardados[0]!.hotelId, null, "se guarda sin hotel vinculado (manual)");
  assert.equal(guardados[0]!.hotelProducto, "Hotel Mar", "y conserva los textos ya escritos");
});

test("el botón Limpiar del combo vuelve a modo manual sin borrar los textos rellenados", async () => {
  await render();
  await abrirInventario();
  await enfocar();
  await elegirConRaton("Hotel Sol");
  assert.equal(hotelProducto().value, "Hotel Sol");
  const btnLimpiar = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Limpiar");
  assert.ok(btnLimpiar, "el botón Limpiar aparece con un hotel elegido y la lista cerrada");
  await act(async () => btnLimpiar!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
  assert.equal(combo().value, "", "Limpiar deja la selección vacía (manual)");
  assert.equal(hotelProducto().value, "Hotel Sol", "los textos rellenados no se borran al limpiar");
  assert.equal(destino().value, "CARTAGENA", "el destino rellenado no se borra al limpiar");
});