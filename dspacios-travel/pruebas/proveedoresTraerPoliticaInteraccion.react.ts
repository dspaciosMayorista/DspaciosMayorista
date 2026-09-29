// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `ProveedoresClient.tsx` tras reemplazar el
// <select> de "Traer política de otro proveedor" por `ComboProveedor`:
//   - El combo ofrece SOLO proveedores con política (nunca los vacíos).
//   - Elegir + "Traer" rellena la política y limpia la selección.
//   - Escribir DESPUÉS de seleccionar invalida el proveedor (Traer queda
//     deshabilitado; no se trae una política con un id fantasma).
//   - Si ya hay política escrita, se pregunta con confirm() antes de
//     reemplazar (mantiene la confirmación original).
// La Server Action real se sustituye por su configurable
// (proveedoresActionsStub.mjs vía reactLoader); aquí no se guarda.
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
const { ProveedoresClient } = await import("../app/(dashboard)/dashboard/producto/proveedores/ProveedoresClient.tsx");
const { __setImpls } = await import("./support/stubs/proveedoresActionsStub.mjs");
const { act, createElement: h } = React;

__setImpls({
  crearProveedor: async () => ({ ok: true } as const),
  actualizarProveedor: async () => ({ ok: true } as const),
  eliminarProveedor: async () => {},
});

function prov(id: number, nombre: string, politica: string | null) {
  return {
    id, tipo: null, nombre, razon_social: null, nit: null, ciudad: null, contacto: null,
    datos_pago: null, banco: null, tipo_cuenta: null, numero_cuenta: null,
    politica_reservas: politica, voucher_contacto: null,
    aplica_retencion: false, pct_retencion: 0, clasificacion: "costo",
  } as const;
}

const PROVEEDORES = [prov(1, "Alpha", "Política Alpha"), prov(2, "Beta", null), prov(3, "Gamma", "Política Gamma")];

const combo = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
const btnTraer = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Traer");

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render() {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(h(ProveedoresClient, { proveedores: PROVEEDORES, destinos: [] })));
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

async function elegirConRaton(nombre: string) {
  const opcion = [...container.querySelectorAll('[role="option"]')].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

async function clic(btn: HTMLElement | undefined, fallo = "botón no encontrado") {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
}

const confirmOriginal = globalThis.confirm as unknown;

afterEach(async () => {
  (globalThis as Record<string, unknown>).confirm = confirmOriginal;
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("el combo de política ofrece solo proveedores con política escrita", async () => {
  await render();
  await enfocar();
  const textos = [...container.querySelectorAll('[role="option"]')].map(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim()
  );
  assert.deepEqual(textos, ["Alpha", "Gamma"], "solo los proveedores con política (nunca Beta, sin política)");
});

test("elegir un proveedor y Traer rellena la política y limpia la selección", async () => {
  await render();
  await enfocar();
  await elegirConRaton("Gamma");
  assert.equal(combo().value, "Gamma", "el combo muestra el proveedor elegido");
  const btn = btnTraer();
  assert.ok(btn && !(btn as HTMLButtonElement).disabled, "Traer queda habilitado con un proveedor elegido");
  await clic(btn);
  assert.equal(textarea().value, "Política Gamma", "se copia la política del proveedor elegido");
  assert.equal(combo().value, "", "la selección del origen se limpia tras traer");
  assert.ok((btnTraer() as HTMLButtonElement).disabled, "Traer vuelve a quedar deshabilitado sin proveedor");
});

test("escribir DESPUÉS de seleccionar invalida el proveedor (Traer se deshabilita)", async () => {
  await render();
  await enfocar();
  await elegirConRaton("Alpha");
  assert.ok(!(btnTraer() as HTMLButtonElement).disabled, "Traer habilitado con Alpha elegido");
  await escribir("bet");               // cambia la búsqueda → invalida el proveedor elegido
  assert.ok((btnTraer() as HTMLButtonElement).disabled, "Traer se deshabilita al invalidar la selección");
  assert.equal(textarea().value, "", "nada se copió sin haber pulsado Traer");
});

test("la confirmación protege la política existente: rechazada no reemplaza, aceptada sí", async () => {
  await render();
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), "Mi política");
    textarea().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await enfocar();
  await elegirConRaton("Gamma");
  (globalThis as Record<string, unknown>).confirm = () => false;
  await clic(btnTraer());
  assert.equal(textarea().value, "Mi política", "confirm rechazada: no se reemplaza lo escrito");
  assert.equal(combo().value, "Gamma", "el origen elegido se conserva al no confirmar");
  (globalThis as Record<string, unknown>).confirm = () => true;
  await clic(btnTraer());
  assert.equal(textarea().value, "Política Gamma", "confirm aceptada: reemplaza la política");
  assert.equal(combo().value, "", "tras traer, la selección del origen se limpia");
});