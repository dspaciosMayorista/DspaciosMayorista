// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// #90 Entrega B / migración 231 — "Moneda de las tarifas" en los formularios de Bloqueos:
//   · NuevoBloqueoForm: la moneda se ELIGE (arranca en "— Elegir —", nunca se supone COP); sin moneda no se guarda; en COP un
//     importe positivo menor a 1.000 pregunta "¿Este valor está en USD?" y bloquea; "Sí, es USD" corrige; la moneda viaja a crearBloqueo;
//   · EditarBloqueoForm: un Bloqueo sin acreditar muestra "— Sin acreditar —" y se puede seguir editando sin elegirla (no manda
//     `moneda`); uno acreditado precarga su moneda, no admite dejarla en blanco y bloquea COP < 1.000; si la página no entrega
//     `moneda` (llamador anterior) el campo no aparece y el contrato de datos no cambia.
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
  FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { NuevoBloqueoForm } = await import("../app/(dashboard)/dashboard/vuelos/NuevoBloqueoForm.tsx");
const { EditarBloqueoForm } = await import("../app/(dashboard)/dashboard/vuelos/[id]/EditarBloqueoForm.tsx");
const { __setImpls } = await import("./support/stubs/vuelosActionsStub.mjs");
const { act, createElement: h } = React;

type Llamada = Record<string, unknown>;
const creaciones: Llamada[] = [];
const ediciones: Llamada[] = [];
__setImpls({
  crearBloqueo: async (input: Llamada) => { creaciones.push(input); return { ok: true, id: 1 } as const; },
  actualizarBloqueo: async (_id: number, input: Llamada) => { ediciones.push(input); return { ok: true, id: 1 } as const; },
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function montar(el: React.ReactElement) {
  creaciones.length = 0;
  ediciones.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}

function inputDe(etiqueta: string): HTMLInputElement {
  const l = [...container.querySelectorAll("label")].find((x) => x.textContent?.trim().startsWith(etiqueta));
  assert.ok(l, `no se encontró la etiqueta "${etiqueta}"`);
  return l!.parentElement!.querySelector<HTMLInputElement>("input")!;
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function elegirEnSelect(select: HTMLSelectElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(select, valor);
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const selectMoneda = () => container.querySelector<HTMLSelectElement>('select[aria-label="Moneda de las tarifas"]');
const opcionesMoneda = () => [...(selectMoneda()?.options ?? [])].map((o) => o.value);
const aviso = () => container.querySelector('[data-testid="valor-sospechoso-usd"]');
const boton = (texto: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(texto)) as HTMLButtonElement | undefined;
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
async function enviar() {
  const form = container.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
}
const textoPagina = () => container.textContent ?? "";

/** Datos mínimos válidos del formulario de creación: record y modalidad (la moneda y las tarifas las pone cada prueba). */
async function llenarObligatorios() {
  await escribir(inputDe("Record (PNR)"), "L93FYZ");
  const modalidad = [...container.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Modalidad de emisión"))!
    .parentElement!.querySelector("select")!;
  await elegirEnSelect(modalidad, "serie");
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

// ── Nuevo ───────────────────────────────────────────────────────────────────
test("Nuevo: la moneda arranca sin elegir (nunca COP implícito) y sin ella no se guarda", async () => {
  await montar(h(NuevoBloqueoForm, { proveedores: [], destinos: [], rangos: [] }));
  assert.equal(selectMoneda()!.value, "", "arranca en '— Elegir —'");
  assert.deepEqual(opcionesMoneda(), ["", "COP", "USD"]);
  await llenarObligatorios();
  await escribir(inputDe("Tarifa neta"), "200000");
  await enviar();
  assert.equal(creaciones.length, 0, "no se llamó a crearBloqueo");
  assert.match(textoPagina(), /Elige la moneda de las tarifas del Bloqueo/);
});

test("Nuevo: en COP un importe menor a 1.000 pregunta '¿Este valor está en USD?' y bloquea; 'Sí, es USD' corrige y guarda en USD", async () => {
  await montar(h(NuevoBloqueoForm, { proveedores: [], destinos: [], rangos: [] }));
  await elegirEnSelect(selectMoneda()!, "COP");
  await escribir(inputDe("Tarifa neta"), "380");
  await escribir(inputDe("Tarifa empaquetar"), "415");
  assert.ok(aviso(), "380 y 415 en COP son sospechosos");
  assert.match(textoPagina(), /¿Este valor está en USD\?/);
  await llenarObligatorios();
  await enviar();
  assert.equal(creaciones.length, 0, "bloqueado en el cliente");
  assert.match(textoPagina(), /¿Este valor está en USD\?/);
  await act(async () => boton("Sí, es USD")!.click());
  assert.equal(selectMoneda()!.value, "USD");
  assert.equal(aviso(), null);
  await enviar();
  assert.equal(creaciones.length, 1);
  assert.equal(creaciones[0].moneda, "USD");
  assert.equal(creaciones[0].tarifaNeta, 380);
  assert.equal(creaciones[0].tarifaParaEmpaquetar, 415);
});

test("Nuevo: COP con tarifas reales en pesos (y fee 0) se guarda como COP", async () => {
  await montar(h(NuevoBloqueoForm, { proveedores: [], destinos: [], rangos: [] }));
  await elegirEnSelect(selectMoneda()!, "COP");
  await escribir(inputDe("Tarifa neta"), "200000");
  await escribir(inputDe("Tarifa empaquetar"), "242022");
  assert.equal(aviso(), null, "el fee de infante en 0 por omisión no dispara el aviso");
  await llenarObligatorios();
  await enviar();
  assert.equal(creaciones.length, 1);
  assert.equal(creaciones[0].moneda, "COP");
  assert.equal(creaciones[0].feeInfante, 0);
});

// ── Editar ──────────────────────────────────────────────────────────────────
type Inicial = Parameters<typeof EditarBloqueoForm>[0]["inicial"];
const BASE: Inicial = {
  record: "L93FYZ", aerolinea: "JETSMART", proveedorId: null, destinoId: null, ruta: "", origen: "",
  vueloIda: "", fechaIda: "", horaSalidaIda: "", horaLlegadaIda: "",
  vueloRegreso: "", fechaRegreso: "", horaSalidaReg: "", horaLlegadaReg: "",
  tarifaNeta: 200000, tarifaParaEmpaquetar: 242022, feeInfante: 0, fechaDevolucion: "", fechaEmision: "", notas: "", rangosEdad: [],
};
async function montarEdicion(inicial: Inicial) {
  await montar(h(EditarBloqueoForm, { bloqueoId: 42, inicial, proveedores: [], destinos: [], rangos: [] }));
  await click(container.querySelector("button[aria-controls='editar-bloqueo-panel']")!);
}
async function guardarEdicion() {
  await click(boton("Guardar cambios")!);
  await act(async () => { await Promise.resolve(); });
}

test("Editar: un Bloqueo sin acreditar muestra '— Sin acreditar —' y se guarda SIN mandar moneda mientras no se elija", async () => {
  await montarEdicion({ ...BASE, moneda: null });
  assert.equal(selectMoneda()!.value, "");
  assert.deepEqual(opcionesMoneda(), ["", "COP", "USD"]);
  assert.match(textoPagina(), /aún no tiene la moneda de sus tarifas acreditada/);
  await guardarEdicion();
  assert.equal(ediciones.length, 1);
  assert.equal("moneda" in ediciones[0], false, "no se toca la moneda");
});

test("Editar: al elegir USD en un Bloqueo sin acreditar, la moneda viaja a actualizarBloqueo", async () => {
  await montarEdicion({ ...BASE, moneda: null, tarifaNeta: 380, tarifaParaEmpaquetar: 415, feeInfante: 45 });
  await elegirEnSelect(selectMoneda()!, "USD");
  await guardarEdicion();
  assert.equal(ediciones.length, 1);
  assert.equal(ediciones[0].moneda, "USD");
});

test("Editar: un Bloqueo acreditado precarga su moneda, no ofrece 'sin acreditar' y bloquea COP con un importe menor a 1.000", async () => {
  await montarEdicion({ ...BASE, moneda: "COP" });
  assert.equal(selectMoneda()!.value, "COP");
  assert.deepEqual(opcionesMoneda(), ["COP", "USD"], "una moneda acreditada no vuelve a blanco");
  assert.match(textoPagina(), /Cambiar la moneda invalida el tarifario/);
  await escribir(inputDe("Fee de infante"), "45");
  assert.ok(aviso());
  await guardarEdicion();
  assert.equal(ediciones.length, 0, "bloqueado en el cliente");
  assert.match(textoPagina(), /¿Este valor está en USD\?/);
  await act(async () => boton("Sí, es USD")!.click());
  await guardarEdicion();
  assert.equal(ediciones.length, 1);
  assert.equal(ediciones[0].moneda, "USD");
});

test("Editar: si la página no entrega `moneda` (llamador anterior) el campo no aparece y no se manda moneda", async () => {
  await montarEdicion({ ...BASE });
  assert.equal(selectMoneda(), null);
  await guardarEdicion();
  assert.equal(ediciones.length, 1);
  assert.equal("moneda" in ediciones[0], false);
});
