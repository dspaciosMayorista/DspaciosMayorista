// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// 226 — INTERACCIÓN REACT del fee de infante en el editor de un bloqueo (`EditarBloqueoForm.tsx`):
//   - Con `inicial.feeInfante` el formulario muestra "Fee de infante (0 a 1,99 años)" con su valor, lo deja editar y lo
//     envía a `actualizarBloqueo` como `feeInfante` (número).
//   - Sin `inicial.feeInfante` (llamador anterior a la 226) el campo no aparece y el contrato de datos NO cambia.
// La Server Action real ("../actions") se sustituye por un configurable (vuelosActionsStub.mjs vía reactLoader).
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
const { EditarBloqueoForm } = await import("../app/(dashboard)/dashboard/vuelos/[id]/EditarBloqueoForm.tsx");
const { __setImpls } = await import("./support/stubs/vuelosActionsStub.mjs");
const { act, createElement: h } = React;

const DESTINOS = [{ id: 1, nombre: "BOGOTA", codigo_iata: "BOG" }, { id: 2, nombre: "CARTAGENA", codigo_iata: "CTG" }];
const PROVEEDORES = [{ id: 7, nombre: "AEROLINEA SA" }];
const RANGOS = [{ id: 1, denominacion: "Infante", edad_min: 0, edad_max: 1 }];

type Inicial = Parameters<typeof EditarBloqueoForm>[0]["inicial"];
const BASE: Inicial = {
  record: "L93FYZ", aerolinea: "JETSMART", proveedorId: 7, destinoId: 2, ruta: "BOG-CTG-BOG", origen: "BOG",
  vueloIda: "5410", fechaIda: "2026-12-01", horaSalidaIda: "06:00", horaLlegadaIda: "07:30",
  vueloRegreso: "5414", fechaRegreso: "2026-12-05", horaSalidaReg: "18:00", horaLlegadaReg: "19:30",
  tarifaNeta: 200000, tarifaParaEmpaquetar: 242022, fechaDevolucion: "2026-11-01", fechaEmision: "2026-11-15",
  notas: "nota", rangosEdad: [1],
};

const llamadas: Array<[number, Record<string, unknown>]> = [];
__setImpls({
  actualizarBloqueo: async (id: number, input: Record<string, unknown>) => { llamadas.push([id, input]); return { ok: true, id }; },
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(inicial: Inicial) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  llamadas.length = 0;
  await act(async () => root!.render(h(EditarBloqueoForm, { bloqueoId: 42, inicial, proveedores: PROVEEDORES, destinos: DESTINOS, rangos: RANGOS })));
}
const botonTexto = (t: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
const etiqueta = (t: string) => [...container.querySelectorAll("label")].find((l) => l.textContent === t);
async function click(el: Element) { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); }
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function abrirYGuardar() {
  await click(container.querySelector<HTMLButtonElement>("button[aria-controls='editar-bloqueo-panel']")!);
  return async () => {
    await click(botonTexto("Guardar cambios")!);
    assert.equal(llamadas.length, 1, "Guardar debe llamar una vez a actualizarBloqueo");
    return llamadas[0]![1];
  };
}

afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); });
after(() => dom.window.close());

test("con feeInfante el formulario lo muestra, lo deja editar y lo envía como número", async () => {
  await render({ ...BASE, feeInfante: 80000 });
  const guardar = await abrirYGuardar();
  const label = etiqueta("Fee de infante (0 a 1,99 años)");
  assert.ok(label, "falta el campo Fee de infante");
  const input = label!.parentElement!.querySelector("input")!;
  assert.equal(input.value, "80000");
  await escribir(input, "95000");
  const enviado = await guardar();
  assert.equal(enviado.feeInfante, 95000);
  assert.equal(typeof enviado.feeInfante, "number");
});

test("fee 0 (gratis) se conserva como 0 y se envía", async () => {
  await render({ ...BASE, feeInfante: 0 });
  const guardar = await abrirYGuardar();
  assert.equal(etiqueta("Fee de infante (0 a 1,99 años)")!.parentElement!.querySelector("input")!.value, "0");
  const enviado = await guardar();
  assert.equal(enviado.feeInfante, 0);
});

test("sin feeInfante (llamador anterior a la 226) el campo no aparece y la clave no viaja", async () => {
  await render(BASE);
  const guardar = await abrirYGuardar();
  assert.equal(etiqueta("Fee de infante (0 a 1,99 años)"), undefined);
  const enviado = await guardar();
  assert.ok(!("feeInfante" in enviado), "el contrato de datos de siempre no cambia");
});
