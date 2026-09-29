// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `EliminarDestinoBtn.tsx` tras reemplazar el
// <select> de "destino de llegada" por `ComboDestino`:
//   - El combo ofrece SOLO los otros destinos (nunca el que se elimina).
//   - Con hoteles, elegir un destino mueve y elimina (llama a eliminarDestino
//     con el id elegido, no con texto).
//   - Escribir DESPUÉS de seleccionar invalida el destino: el botón queda
//     bloqueado con el aviso y NUNCA se elimina usando el id anterior.
//   - Sin hoteles se elimina directo sin pedir destino (id + undefined).
// La Server Action real ("./actions") se sustituye por un configurable
// (eliminarDestinoActionsStub.mjs vía reactLoader) que registra las llamadas.
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
const { EliminarDestinoBtn } = await import("../app/(dashboard)/dashboard/tarifario/EliminarDestinoBtn.tsx");
const { __setImpls } = await import("./support/stubs/eliminarDestinoActionsStub.mjs");
const { act, createElement: h } = React;

const DESTINOS = [
  { id: 1, nombre: "CARTAGENA" },
  { id: 2, nombre: "SAN ANDRES" },
  { id: 3, nombre: "MEDELLIN" },
];

const llamadas: Array<[number, number | undefined]> = [];
__setImpls({
  eliminarDestino: async (id: number, reasignarA?: number) => {
    llamadas.push([id, reasignarA]);
    return { ok: true } as const;
  },
});

function Harness({ hoteles = 2 }: { hoteles?: number }) {
  return h(EliminarDestinoBtn, { id: 1, nombre: "CARTAGENA", hoteles, destinos: DESTINOS });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(hoteles = 2) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  llamadas.length = 0;
  await act(async () => root!.render(h(Harness, { hoteles })));
}

const porTexto = (texto: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

const comboInput = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;

async function abrirModal() {
  const abrir = container.querySelector<HTMLButtonElement>('button[title="Eliminar destino"]');
  assert.ok(abrir, "no se encontró el botón de eliminar destino");
  await act(async () => abrir!.click());
}

async function esperarFlush() {
  await act(async () => { await Promise.resolve(); });
}

async function clic(btn: HTMLElement | undefined, fallo = "botón no encontrado") {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await esperarFlush();
}

async function enfocar() {
  const inp = comboInput();
  await act(async () => inp.focus());
}

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(comboInput(), valor);
    comboInput().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function elegirConRaton(nombre: string) {
  const opcion = [...container.querySelectorAll('[role="option"]')].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("el combo de llegada ofrece solo los OTROS destinos (nunca el que se elimina)", async () => {
  await render(2);
  await abrirModal();
  await enfocar();
  const textos = [...container.querySelectorAll('[role="option"]')].map(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim()
  );
  assert.deepEqual(textos, ["SAN ANDRES", "MEDELLIN"], "solo los destinos distintos al que se elimina");
});

test("con hoteles, elegir un destino mueve y elimina con ese id (funciona el mousedown)", async () => {
  await render(2);
  await abrirModal();
  await enfocar();
  await elegirConRaton("MEDELLIN");
  assert.equal(comboInput().value, "MEDELLIN", "el combo muestra el destino elegido");
  await clic(porTexto("Mover y eliminar"), "faltó el botón Mover y eliminar");
  assert.deepEqual(llamadas, [[1, 3]], "eliminarDestino se llama con (id=1, reasignarA=3)");
  assert.equal(container.querySelector('[role="listbox"]'), null, "el modal se cierra tras eliminar ok");
});

test("escribir DESPUÉS de seleccionar invalida el destino: no se elimina con el id anterior", async () => {
  await render(2);
  await abrirModal();
  await enfocar();
  await elegirConRaton("SAN ANDRES");      // elige id 2…
  await escribir("med");                   // …pero escribe otra búsqueda: invalida
  const evEscape = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => comboInput().dispatchEvent(evEscape));
  assert.equal(comboInput().value, "", "con la selección invalidada el combo queda vacío");
  await clic(porTexto("Mover y eliminar"), "faltó el botón Mover y eliminar");
  assert.ok(
    [...container.querySelectorAll("p")].some((el) => el.textContent?.includes("elige a qué destino moverlos")),
    "se bloquea con el aviso de elegir a qué destino moverlos"
  );
  assert.deepEqual(llamadas, [], "NUNCA se elimina usando el id anterior tras escribir otro texto");
});

test("sin hoteles se elimina directo, sin pedir destino (undefined)", async () => {
  await render(0);
  await abrirModal();
  assert.equal(container.querySelector('[role="combobox"]'), null, "sin hoteles no hay combo de llegada");
  assert.ok(
    [...container.querySelectorAll("p")].some((el) => el.textContent?.includes("se eliminará directamente")),
    "sin hoteles se avisa de borrado directo"
  );
  await clic(porTexto("Eliminar"), "faltó el botón Eliminar");
  assert.deepEqual(llamadas, [[1, undefined]], "eliminarDestino se llama con (id=1, sin reasignar)");
});