// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// #90 / migración 230 — formularios de Empaquetados con "Moneda de las tarifas":
//   · NuevoEmpaquetadoForm: COP con un valor positivo menor a 1.000 muestra "¿Este valor está en USD?", bloquea el guardado y
//     el botón "Sí, es USD" corrige la moneda; con USD o con un valor >= 1.000 no hay aviso y se guarda con la moneda elegida;
//   · EditarEmpaquetadoForm: precarga la moneda del vuelo y la envía al guardar.
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
  // React 19 arma un FormData al enviar un <form>: debe ser el de jsdom (el de Node no acepta formularios de jsdom).
  FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { NuevoEmpaquetadoForm } = await import("../app/(dashboard)/dashboard/vuelos/empaquetados/NuevoEmpaquetadoForm.tsx");
const { EditarEmpaquetadoForm } = await import("../app/(dashboard)/dashboard/vuelos/empaquetados/[id]/EditarEmpaquetadoForm.tsx");
const { __setImpls } = await import("./support/stubs/empaquetadosActionsStub.mjs");
const { act, createElement: h } = React;

type Llamada = Record<string, unknown>;
const creaciones: Llamada[] = [];
const ediciones: Llamada[] = [];
__setImpls({
  crearEmpaquetado: async (input: Llamada) => { creaciones.push(input); return { ok: true, id: 1 } as const; },
  actualizarEmpaquetado: async (_id: number, input: Llamada) => { ediciones.push(input); return { ok: true, id: 1 } as const; },
  eliminarEmpaquetado: async () => ({ ok: true } as const),
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
const selectMoneda = () => container.querySelector<HTMLSelectElement>('select[aria-label="Moneda de las tarifas"]')!;
async function elegirMoneda(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(selectMoneda(), valor);
    selectMoneda().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const aviso = () => container.querySelector('[data-testid="valor-sospechoso-usd"]');
const boton = (texto: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(texto)) as HTMLButtonElement | undefined;
async function enviar() {
  const form = container.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
}
async function llenarObligatorios() {
  // La fecha de ida usa el stub de DateInput (un <input> de texto).
  const fecha = container.querySelector<HTMLInputElement>('input[aria-label="Fecha ida"]')!;
  await escribir(fecha, "2027-02-10");
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("Nuevo: moneda COP por defecto y un valor menor a 1.000 pregunta '¿Este valor está en USD?' y bloquea el guardado", async () => {
  await montar(h(NuevoEmpaquetadoForm, { proveedores: [], destinos: [] }));
  assert.equal(selectMoneda().value, "COP");
  assert.equal(aviso(), null, "sin valores no hay aviso");
  await escribir(inputDe("Tarifa para empaquetar"), "415");
  assert.ok(aviso(), "415 en COP es sospechoso");
  assert.match(container.textContent ?? "", /¿Este valor está en USD\?/);
  await llenarObligatorios();
  await enviar();
  assert.deepEqual(creaciones, [], "no se llamó a crearEmpaquetado");
  assert.match(container.textContent ?? "", /¿Este valor está en USD\?/);
});

test("Nuevo: el botón 'Sí, es USD' cambia la moneda, quita el aviso y permite guardar con moneda USD", async () => {
  await montar(h(NuevoEmpaquetadoForm, { proveedores: [], destinos: [] }));
  await escribir(inputDe("Tarifa proveedor"), "380");
  await escribir(inputDe("Tarifa para empaquetar"), "415");
  await escribir(inputDe("Fee infante"), "45");
  await act(async () => boton("Sí, es USD")!.click());
  assert.equal(selectMoneda().value, "USD");
  assert.equal(aviso(), null);
  await llenarObligatorios();
  await enviar();
  assert.equal(creaciones.length, 1);
  assert.equal(creaciones[0].moneda, "USD");
  assert.equal(creaciones[0].tarifaParaEmpaquetar, 415);
  assert.equal(creaciones[0].feeInfante, 45);
});

test("Nuevo: elegir USD a mano también evita el aviso; COP con valores >= 1.000 se guarda como COP", async () => {
  await montar(h(NuevoEmpaquetadoForm, { proveedores: [], destinos: [] }));
  await escribir(inputDe("Tarifa para empaquetar"), "415");
  await elegirMoneda("USD");
  assert.equal(aviso(), null);
  await elegirMoneda("COP");
  assert.ok(aviso());
  await escribir(inputDe("Tarifa para empaquetar"), "242022");
  await escribir(inputDe("Tarifa proveedor"), "200000");
  assert.equal(aviso(), null, "242.022 y 200.000 en COP son tarifas reales en pesos");
  await llenarObligatorios();
  await enviar();
  assert.equal(creaciones.length, 1);
  assert.equal(creaciones[0].moneda, "COP");
});

test("Nuevo: el fee de infante en 0 (valor por omisión) NO dispara el aviso", async () => {
  await montar(h(NuevoEmpaquetadoForm, { proveedores: [], destinos: [] }));
  await escribir(inputDe("Tarifa para empaquetar"), "242022");
  assert.equal(aviso(), null);
});

const inicial = (over: Record<string, unknown> = {}) => ({
  aerolinea: "JetSMART", proveedorId: null, destinoId: null, ruta: "MDE - SDQ - MDE", origen: "MDE",
  vueloIda: "", fechaIda: "2027-02-10", horaSalidaIda: "", horaLlegadaIda: "", vueloRegreso: "", fechaRegreso: "2027-02-14", horaSalidaReg: "", horaLlegadaReg: "",
  tarifaProveedor: 380, tarifaParaEmpaquetar: 415, feeInfante: 45, compraInicio: "", compraFin: "", notas: "", activo: true, moneda: "COP" as "COP" | "USD",
  ...over,
});

test("Editar: un vuelo guardado como COP con 415 muestra el aviso; pasarlo a USD lo guarda con moneda USD", async () => {
  await montar(h(EditarEmpaquetadoForm, { empaquetadoId: 3, proveedores: [], destinos: [], inicial: inicial() }));
  assert.ok(aviso(), "el dato mal guardado se señala al abrir");
  await enviar();
  assert.deepEqual(ediciones, [], "no se puede guardar mientras siga en COP con 415");
  await act(async () => boton("Sí, es USD")!.click());
  await enviar();
  assert.equal(ediciones.length, 1);
  assert.equal((ediciones as Llamada[])[0].moneda, "USD");
});

test("Editar: un vuelo en USD precarga la moneda y no muestra aviso", async () => {
  await montar(h(EditarEmpaquetadoForm, { empaquetadoId: 4, proveedores: [], destinos: [], inicial: inicial({ moneda: "USD" }) }));
  assert.equal(selectMoneda().value, "USD");
  assert.equal(aviso(), null);
  await enviar();
  assert.equal(ediciones.length, 1);
  assert.equal((ediciones as Llamada[])[0].moneda, "USD");
});
