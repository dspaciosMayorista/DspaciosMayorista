// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `EditarBloqueoForm.tsx` (detalle de un bloqueo).
//   - Panel colapsable con íconos lucide (ChevronRight cerrado / ChevronDown
//     abierto) y aria-expanded.
//   - Mismas secciones y orden que NuevoBloqueoForm: Datos del bloqueo →
//     Vuelo de ida → Vuelo de regreso (con fecha límite de emisión y notas);
//     sin cupos ni modalidad (tienen sus propios flujos).
//   - El guardado llama a `actualizarBloqueo` con el MISMO contrato de datos.
//   - Sin cambiar origen ni destino se envían el origen y la ruta guardados,
//     aunque el origen esté fuera del catálogo o el destino sea nulo (antes se
//     enviaban vacíos o recalculados y se guardaban en null).
//   - Cambiar el destino con el origen fuera del catálogo (o vaciar el
//     destino) bloquea el guardado con un mensaje junto al campo, sin llamar
//     a la acción; al elegir valores válidos la ruta se recalcula.
// La Server Action real ("../actions") se sustituye por un configurable
// (vuelosActionsStub.mjs vía reactLoader) que registra las llamadas.
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

const DESTINOS = [
  { id: 1, nombre: "BOGOTA", codigo_iata: "BOG" },
  { id: 2, nombre: "CARTAGENA", codigo_iata: "CTG" },
  { id: 3, nombre: "SAN ANDRES", codigo_iata: "ADZ" },
];
const PROVEEDORES = [{ id: 7, nombre: "AEROLINEA SA" }];
const RANGOS = [{ id: 1, denominacion: "Infante", edad_min: 0, edad_max: 1 }];

type Inicial = Parameters<typeof EditarBloqueoForm>[0]["inicial"];
const BASE: Inicial = {
  record: "L93FYZ", aerolinea: "JETSMART", proveedorId: 7, destinoId: 2, ruta: "BOG-CTG-BOG", origen: "Bogotá",
  vueloIda: "5410", fechaIda: "2026-12-01", horaSalidaIda: "06:00", horaLlegadaIda: "07:30",
  vueloRegreso: "5414", fechaRegreso: "2026-12-05", horaSalidaReg: "18:00", horaLlegadaReg: "19:30",
  tarifaNeta: 200000, tarifaParaEmpaquetar: 242022, fechaDevolucion: "2026-11-01", fechaEmision: "2026-11-15",
  notas: "nota", rangosEdad: [1],
};

const llamadas: Array<[number, Record<string, unknown>]> = [];
__setImpls({
  actualizarBloqueo: async (id: number, input: Record<string, unknown>) => {
    llamadas.push([id, input]);
    return { ok: true, id };
  },
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(inicial: Inicial = BASE) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  llamadas.length = 0;
  await act(async () =>
    root!.render(h(EditarBloqueoForm, { bloqueoId: 42, inicial, proveedores: PROVEEDORES, destinos: DESTINOS, rangos: RANGOS }))
  );
}

const botonPanel = () => container.querySelector<HTMLButtonElement>("button[aria-controls='editar-bloqueo-panel']")!;
const botonTexto = (t: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
const secciones = () => [...container.querySelectorAll("#editar-bloqueo-panel > section")];
const tituloSeccion = (s: Element) => s.querySelector("p")?.textContent ?? "";
const etiquetas = (s: Element) => [...s.querySelectorAll("label")].map((l) => l.textContent ?? "");
/** Input que acompaña a la etiqueta `texto` (mismo contenedor). */
function inputDe(texto: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent === texto);
  assert.ok(label, `no hay etiqueta "${texto}"`);
  const input = label!.parentElement!.querySelector("input");
  assert.ok(input, `no hay input para "${texto}"`);
  return input!;
}

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function enter(input: HTMLInputElement) {
  await act(async () => { input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
}
/** Elige un destino en un ComboDestino escribiendo su IATA y pulsando Enter. */
async function elegirEnCombo(etiqueta: string, iata: string) {
  const input = inputDe(etiqueta);
  await act(async () => input.focus());
  await escribir(input, iata);
  await enter(input);
}
const alertas = () => [...container.querySelectorAll("[role='alert']")];
/** El Button de base-ui puede marcar el deshabilitado como atributo nativo o como aria-disabled. */
function guardarDeshabilitado(): boolean {
  const b = botonTexto("Guardar cambios");
  assert.ok(b, "falta el botón Guardar cambios");
  return b!.disabled || b!.getAttribute("aria-disabled") === "true";
}
async function abrirYGuardar() {
  const guardar = botonTexto("Guardar cambios");
  assert.ok(guardar, "falta el botón Guardar cambios");
  await click(guardar!);
  assert.equal(llamadas.length, 1, "Guardar debe llamar una vez a actualizarBloqueo");
  return llamadas[0]!;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("panel colapsable con íconos lucide: cerrado muestra ChevronRight, abierto ChevronDown", async () => {
  await render();
  const btn = botonPanel();
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.ok(btn.querySelector("svg.lucide-chevron-right"), "cerrado usa ChevronRight de lucide");
  assert.equal(secciones().length, 0, "cerrado no muestra el formulario");
  assert.ok(!/[▾▸]/.test(btn.textContent ?? ""), "sin glifos de texto");
  await click(btn);
  assert.equal(botonPanel().getAttribute("aria-expanded"), "true");
  assert.ok(botonPanel().querySelector("svg.lucide-chevron-down"), "abierto usa ChevronDown de lucide");
  await click(botonPanel());
  assert.equal(secciones().length, 0, "se vuelve a cerrar");
});

test("mismas secciones y orden que Nuevo bloqueo, con los mismos campos editables de siempre", async () => {
  await render();
  await click(botonPanel());
  const [datos, ida, regreso] = secciones();
  assert.deepEqual(secciones().map(tituloSeccion), ["Datos del bloqueo", "Vuelo de ida", "Vuelo de regreso"]);
  assert.deepEqual(etiquetas(datos!).slice(0, 9), [
    "Record (PNR)", "Aerolínea", "Proveedor aéreo", "Origen", "Destino", "Ruta (automática)",
    "Tarifa neta (pago aerolínea)", "Tarifa empaquetar (reventa)", "Fecha devolución",
  ]);
  assert.deepEqual(etiquetas(ida!), ["# Vuelo", "Fecha ida", "Hora salida", "Hora llegada"]);
  assert.deepEqual(etiquetas(regreso!), ["# Vuelo", "Fecha regreso", "Hora salida", "Hora llegada", "Fecha límite de emisión", "Notas"]);
  const todas = secciones().flatMap(etiquetas).join(" | ");
  assert.ok(!/Cupos|Modalidad/.test(todas), "cupos y modalidad no se editan aquí");
  assert.ok(botonTexto("Guardar cambios"), "conserva el botón de guardado");
});

test("origen fuera del catálogo y sin tocar origen/destino: guarda el origen y la ruta originales", async () => {
  await render();
  await click(botonPanel());
  assert.equal(inputDe("Ruta (automática)").value, "BOG-CTG-BOG", "muestra la ruta que se va a conservar");
  assert.ok(container.textContent?.includes("Origen guardado «Bogotá» no está en el catálogo"), "avisa que se conserva");
  await escribir(inputDe("Notas"), "nota nueva");
  const [id, input] = await abrirYGuardar();
  assert.equal(id, 42);
  assert.equal(input.origen, "Bogotá");
  assert.equal(input.ruta, "BOG-CTG-BOG");
  assert.equal(input.destinoId, 2);
  assert.equal(input.notas, "nota nueva");
});

test("origen fuera del catálogo y el usuario elige otro origen y destino: recalcula la ruta", async () => {
  await render();
  await click(botonPanel());
  await elegirEnCombo("Origen", "BOG");
  await elegirEnCombo("Destino", "ADZ");
  assert.equal(inputDe("Ruta (automática)").value, "BOG - ADZ - BOG");
  assert.ok(!container.textContent?.includes("no está en el catálogo"), "el aviso desaparece al elegir");
  const [, input] = await abrirYGuardar();
  assert.equal(input.origen, "BOG");
  assert.equal(input.ruta, "BOG - ADZ - BOG");
  assert.equal(input.destinoId, 3);
});

test("contrato de actualizarBloqueo sin cambios: mismas claves y valores; origen reconocido conserva la ruta guardada", async () => {
  // La ruta guardada tiene otro formato que la automática: sin tocar origen
  // ni destino se envía TAL CUAL, no se reescribe.
  await render({ ...BASE, origen: "BOG", ruta: "BOG-CTG-BOG" });
  await click(botonPanel());
  assert.ok(!container.textContent?.includes("no está en el catálogo"));
  assert.equal(inputDe("Ruta (automática)").value, "BOG-CTG-BOG");
  const [id, input] = await abrirYGuardar();
  assert.equal(id, 42);
  assert.deepEqual(input, {
    record: "L93FYZ", aerolinea: "JETSMART", proveedorId: 7, destinoId: 2, ruta: "BOG-CTG-BOG", origen: "BOG",
    vueloIda: "5410", fechaIda: "2026-12-01", horaSalidaIda: "06:00", horaLlegadaIda: "07:30",
    vueloRegreso: "5414", fechaRegreso: "2026-12-05", horaSalidaReg: "18:00", horaLlegadaReg: "19:30",
    tarifaNeta: 200000, tarifaParaEmpaquetar: 242022, fechaDevolucion: "2026-11-01", fechaEmision: "2026-11-15",
    notas: "nota", rangosEdad: [1],
  });
});

test("destino original nulo y sin tocar origen/destino: conserva origen y ruta guardados", async () => {
  await render({ ...BASE, origen: "BOG", destinoId: null, ruta: "BOG - CTG - BOG" });
  await click(botonPanel());
  assert.equal(inputDe("Ruta (automática)").value, "BOG - CTG - BOG");
  assert.equal(alertas().length, 0, "sin cambios no hay bloqueo");
  const [, input] = await abrirYGuardar();
  assert.equal(input.origen, "BOG");
  assert.equal(input.ruta, "BOG - CTG - BOG");
  assert.equal(input.destinoId, null);
});

test("cambiar el destino con el origen fuera del catálogo bloquea el guardado hasta elegir un origen válido", async () => {
  await render();
  await click(botonPanel());
  await elegirEnCombo("Destino", "ADZ");
  const [alerta] = alertas();
  assert.ok(alerta, "muestra un mensaje de bloqueo");
  assert.match(alerta!.textContent ?? "", /Elige un origen del catálogo/);
  assert.ok(alerta!.closest("div")!.querySelector("label")?.textContent === "Origen", "el mensaje va junto al campo Origen");
  assert.equal(inputDe("Ruta (automática)").value, "", "no muestra una ruta que no se puede armar");
  assert.ok(guardarDeshabilitado(), "el botón Guardar queda deshabilitado");
  await click(botonTexto("Guardar cambios")!);
  assert.equal(llamadas.length, 0, "no se llama a actualizarBloqueo mientras está bloqueado");

  await elegirEnCombo("Origen", "BOG");
  assert.equal(alertas().length, 0, "el bloqueo desaparece con un origen válido");
  assert.ok(!guardarDeshabilitado());
  assert.equal(inputDe("Ruta (automática)").value, "BOG - ADZ - BOG");
  const [, input] = await abrirYGuardar();
  assert.equal(input.origen, "BOG");
  assert.equal(input.ruta, "BOG - ADZ - BOG");
  assert.equal(input.destinoId, 3);
});

test("vaciar el destino bloquea el guardado con un mensaje junto a Destino (nunca envía ruta vacía)", async () => {
  await render({ ...BASE, origen: "BOG", ruta: "BOG - CTG - BOG" });
  await click(botonPanel());
  await escribir(inputDe("Destino"), "zzz"); // escribir invalida el destino elegido
  const [alerta] = alertas();
  assert.ok(alerta, "muestra un mensaje de bloqueo");
  assert.match(alerta!.textContent ?? "", /Elige un destino del catálogo/);
  assert.ok(alerta!.closest("div")!.querySelector("label")?.textContent === "Destino");
  assert.ok(guardarDeshabilitado());
  await click(botonTexto("Guardar cambios")!);
  assert.equal(llamadas.length, 0);
});
