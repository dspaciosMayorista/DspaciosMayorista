// Se ejecuta con el loader TSX/esbuild + jsdom (reactLoader), no con test:unit:
//   node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/eliminarHotelDialog.react.ts
// Prueba de INTERACCIÓN REACT de `EliminarHotelDialog.tsx` (Producto → Hoteles).
//   - usa el ConfirmDialog de la app, nunca window.confirm();
//   - un rechazo del servidor se VE: el mensaje y, si está en paquetes, cada
//     paquete con su enlace y los pasos para liberarlo; el diálogo sigue
//     abierto y nada se da por hecho;
//   - sin referencias, confirmar elimina y cierra.
// El componente recibe la acción por props, así que no hace falta stub del
// servidor ni tocar el loader compartido.
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
dom.window.confirm = () => { throw new Error("se llamó a window.confirm()"); };

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { EliminarHotelDialog } = await import("../app/(dashboard)/dashboard/producto/hoteles/EliminarHotelDialog.tsx");
const { act, createElement: h } = React;

type Resultado = Awaited<ReturnType<Parameters<typeof EliminarHotelDialog>[0]["eliminar"]>>;
const llamadas: number[] = [];
let respuestas: Resultado[] = [];

const RECHAZO_PAQUETES: Resultado = {
  ok: false,
  error: 'No se puede eliminar "Hotel Caribe": está vinculado a 2 paquetes. Quítalo de cada paquete y regenera su tarifario; después vuelve a intentarlo. No se borró nada.',
  paquetes: [
    { id: 7, nombre: "San Andrés Octubre", enArmado: false, enTarifario: true },
    { id: 12, nombre: "Cartagena Puente", enArmado: true, enTarifario: true },
  ],
};

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(EliminarHotelDialog, {
    id: 99, nombre: "Hotel Caribe",
    eliminar: async (id: number) => { llamadas.push(id); return respuestas.shift() ?? { ok: true }; },
  })));
}
async function click(el: Element | undefined, fallo = "elemento no encontrado") {
  assert.ok(el, fallo);
  await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const dialogo = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const boton = (raiz: ParentNode | null, t: string) => [...(raiz?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === t);
const texto = () => dialogo()?.textContent ?? "";

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  llamadas.length = 0;
  respuestas = [];
});
after(() => dom.window.close());

test("Eliminar abre el diálogo de la app (no confirm()) y no llama a la acción antes de confirmar", async () => {
  await render();
  await click(boton(container, "Eliminar"));
  assert.ok(dialogo(), "abre un diálogo propio");
  assert.match(texto(), /¿Eliminar el hotel "Hotel Caribe"\?/);
  assert.match(texto(), /Los contratos ya generados conservan su información/);
  assert.deepEqual(llamadas, []);
});

test("rechazo por paquetes: muestra el mensaje, enlaza cada paquete con dónde aparece y los pasos; sigue abierto", async () => {
  respuestas = [RECHAZO_PAQUETES];
  await render();
  await click(boton(container, "Eliminar"));
  await click(boton(dialogo(), "Eliminar"));
  assert.deepEqual(llamadas, [99]);
  assert.ok(dialogo(), "el diálogo NO se cierra ante el rechazo");
  assert.match(texto(), /está vinculado a 2 paquetes\. Quítalo de cada paquete y regenera su tarifario/);
  assert.match(texto(), /Desmarca el hotel en "Adición de hoteles"/);
  assert.match(texto(), /Pulsa "Generar \/ actualizar tarifario"/);
  const items = [...dialogo()!.querySelectorAll('[role="listitem"]')].map((li) => li.textContent?.trim());
  assert.deepEqual(items, [
    "San Andrés Octubre · en el tarifario generado",
    "Cartagena Puente · en el armado y en el tarifario generado",
  ]);
  const enlaces = [...dialogo()!.querySelectorAll('[role="listitem"] a')].map((a) => a.getAttribute("href"));
  assert.deepEqual(enlaces, ["/dashboard/paquetes/7", "/dashboard/paquetes/12"]);
  assert.ok(boton(dialogo(), "Reintentar"), "el botón pasa a Reintentar");
});

test("rechazo sin paquetes (p. ej. 23503 de otra tabla o sin permiso): el mensaje se ve tal cual, sin guía de paquetes", async () => {
  respuestas = [{ ok: false, error: 'No se eliminó "Hotel Caribe": no tienes permiso para borrarlo o ya no existe.' }];
  await render();
  await click(boton(container, "Eliminar"));
  await click(boton(dialogo(), "Eliminar"));
  assert.ok(dialogo());
  assert.match(texto(), /no tienes permiso para borrarlo o ya no existe/);
  assert.equal(dialogo()!.querySelector("[data-guia-desvincular]"), null);
});

test("tras desvincular y regenerar, Reintentar elimina y cierra el diálogo", async () => {
  respuestas = [RECHAZO_PAQUETES, { ok: true }];
  await render();
  await click(boton(container, "Eliminar"));
  await click(boton(dialogo(), "Eliminar"));
  await click(boton(dialogo(), "Reintentar"));
  assert.deepEqual(llamadas, [99, 99]);
  assert.equal(dialogo(), null, "éxito real: el diálogo se cierra");
});

test("sin referencias: confirmar elimina y cierra; al reabrir no queda la guía anterior", async () => {
  respuestas = [RECHAZO_PAQUETES];
  await render();
  await click(boton(container, "Eliminar"));
  await click(boton(dialogo(), "Eliminar"));
  await click(boton(dialogo(), "Cancelar"));
  await click(boton(container, "Eliminar"));
  assert.equal(dialogo()!.querySelector("[data-guia-desvincular]"), null, "la guía se limpia al reabrir");
  await click(boton(dialogo(), "Eliminar"));
  assert.deepEqual(llamadas, [99, 99]);
  assert.equal(dialogo(), null);
});
