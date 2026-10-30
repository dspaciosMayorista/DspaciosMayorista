// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// #90 E5a (E2): "Pagar saldo exacto" en una cuenta USD NO guarda de inmediato: primero muestra
// "Se registrará USD <saldo> con TRM <COP/saldo> = COP <valor>" y pide confirmación. Sin rangos de TRM fijos.
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
const { PagosList } = await import("../app/(dashboard)/dashboard/pagos/PagosList.tsx");
const { __setImpls } = await import("./support/stubs/pagosActionsStub.mjs");
const { act, createElement: h } = React;

const llamadas: Array<[number, number]> = [];
__setImpls({
  pagarSaldoExacto: async (id: number, cop: number) => {
    llamadas.push([id, cop]);
    return { ok: true } as const;
  },
});

const ROW = {
  id: 7, numero_contrato: "C-777", proveedor: "Hotel Sol", tipo_proveedor: null, servicio: "Hotel",
  valor_total: 5919, moneda: "USD", fecha_obligacion: null, fecha_vencimiento: "2026-12-01",
  aplica_retencion: null, pct_retencion: null, clasificacion: "costo" as const, base_gravable: null,
  iva_proveedor: null, pagos: [], pagado: 816.03, retenido: 0, saldo: 5102.97,
};

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  llamadas.length = 0;
  await act(async () => root!.render(h(PagosList, { rows: [ROW], proveedores: [], catalogo: [], ivaPct: 0.19 })));
  const fila = [...container.querySelectorAll("tr")].find((t) => t.textContent?.includes("C-777"));
  assert.ok(fila, "no se encontró la fila de la cuenta");
  await act(async () => fila!.click());
}

const boton = (texto: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(texto)) as HTMLButtonElement | undefined;

async function escribirCop(valor: string) {
  // El primer input numérico de la página es otro (base gravable de la factura): se busca el de "Pagado (COP)".
  const etiqueta = [...container.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Pagado (COP)");
  assert.ok(etiqueta, "no se encontró la etiqueta Pagado (COP)");
  const input = etiqueta!.parentElement!.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function clic(btn: HTMLElement | undefined, fallo: string) {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("Pagar saldo exacto muestra el resumen y NO guarda hasta confirmar", async () => {
  await render();
  await escribirCop("17665398");
  await clic(boton("Pagar saldo exacto"), "faltó el botón Pagar saldo exacto");
  const texto = container.textContent ?? "";
  assert.match(texto, /Se registrará/);
  assert.match(texto, /USD/);
  assert.match(texto, /TRM/);
  assert.deepEqual(llamadas, [], "no se llamó a la acción antes de confirmar");
  await clic(boton("Confirmar pago"), "faltó Confirmar pago");
  assert.deepEqual(llamadas, [[7, 17665398]], "al confirmar se envía el COP real digitado");
  assert.doesNotMatch(container.textContent ?? "", /Se registrará/, "el resumen se cierra tras confirmar");
});

test("Cancelar cierra el resumen sin llamar a la acción", async () => {
  await render();
  await escribirCop("17665398");
  await clic(boton("Pagar saldo exacto"), "faltó el botón Pagar saldo exacto");
  await clic(boton("Cancelar"), "faltó Cancelar");
  assert.deepEqual(llamadas, []);
  assert.doesNotMatch(container.textContent ?? "", /Se registrará/);
});

test("sin COP digitado no hay resumen ni llamada", async () => {
  await render();
  await clic(boton("Pagar saldo exacto"), "faltó el botón Pagar saldo exacto");
  assert.deepEqual(llamadas, []);
  assert.doesNotMatch(container.textContent ?? "", /Se registrará/);
  assert.match(container.textContent ?? "", /Digita el valor realmente pagado/);
});
