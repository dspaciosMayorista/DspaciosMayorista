// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `LiberarRetencion.tsx` (migración 201,
// decisión del dueño: las retenciones en plazo sin contrato se liberan SOLO a
// mano). Confirmación propia de la app; la acción recibe la versión de la
// silla que mostró la pantalla; si la base rechaza (la silla cambió o ya no
// está vencida), el error se ve en el mismo diálogo y nada se da por hecho.
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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { LiberarRetencion } = await import("../app/(dashboard)/dashboard/vuelos/[id]/LiberarRetencion.tsx");
const { __setImpls } = await import("./support/stubs/vuelosActionsStub.mjs");
const { act, createElement: h } = React;

const llamadas: Array<[number, number, string]> = [];
let respuesta: { ok: boolean; error?: string } = { ok: true };
__setImpls({
  liberarRetencionVencida: async (sillaId: number, bloqueoId: number, version: string) => {
    llamadas.push([sillaId, bloqueoId, version]);
    return respuesta;
  },
});

const VERSION = "2026-10-03T15:04:05.123456+00:00";
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(h(LiberarRetencion, {
      sillaId: 41, bloqueoId: 3, version: VERSION, numeroVisible: 2, numeroHistorico: 5, pasajero: "ANA PEREZ", plazo: "2026-10-02",
    }))
  );
}
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
const dialogo = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const botonDe = (raiz: ParentNode, t: string) => [...raiz.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  llamadas.length = 0;
  respuesta = { ok: true };
});
after(() => dom.window.close());

test("Liberar abre la confirmación de la app con la silla visible, la histórica y el plazo; no llama antes de confirmar", async () => {
  await render();
  await click(botonDe(container, "Liberar")!);
  const d = dialogo();
  assert.ok(d, "abre un diálogo propio (no confirm() del navegador)");
  assert.match(d!.textContent ?? "", /¿Liberar la silla 2\?/);
  assert.match(d!.textContent ?? "", /ANA PEREZ/);
  assert.match(d!.textContent ?? "", /plazo 2026-10-02/);
  assert.match(d!.textContent ?? "", /silla histórica #5/);
  assert.match(d!.textContent ?? "", /No se crea, cancela ni modifica ninguna venta/);
  assert.deepEqual(llamadas, []);
});

test("confirmar llama a la acción con la versión que mostró la pantalla", async () => {
  await render();
  await click(botonDe(container, "Liberar")!);
  await click(botonDe(dialogo()!, "Liberar silla")!);
  assert.deepEqual(llamadas, [[41, 3, VERSION]]);
});

test("si la silla cambió, el error se muestra en el diálogo y no se cierra", async () => {
  respuesta = { ok: false, error: "La silla 5 cambió desde que la viste (otro usuario la editó). Recarga la página; no se liberó nada." };
  await render();
  await click(botonDe(container, "Liberar")!);
  await click(botonDe(dialogo()!, "Liberar silla")!);
  assert.ok(dialogo(), "el diálogo sigue abierto");
  assert.match(dialogo()!.textContent ?? "", /cambió desde que la viste/);
});

test("cancelar no llama a la acción", async () => {
  await render();
  await click(botonDe(container, "Liberar")!);
  await click(botonDe(dialogo()!, "Cancelar")!);
  assert.deepEqual(llamadas, []);
});
