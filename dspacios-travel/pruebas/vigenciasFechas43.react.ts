// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/vigenciasFechas43.react.ts
//
// #43 — validación de fechas de vigencias EN EL FORMULARIO (componente real HotelDetalleClient, Server Actions sustituidas por dobles):
// el mismo caso del hotel 53 (ALTA id 140, `0206-12-24`) no llega al servidor, el histórico sigue editable si no se tocan sus fechas
// y la corrección legítima a 2026-12-24 sí se envía. El servidor las vuelve a validar siempre (ver vigenciasFechas43.servidor.test.ts).
import * as nodeModule from "node:module";
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__v43r";

const ACCIONES = datos(`
  const reg = (n, a) => ${G}.llamadas.push([n, a]);
  export async function crearTemporada(...a) { reg('crearTemporada', a); return { ok: true }; }
  export async function actualizarTemporada(...a) { reg('actualizarTemporada', a); return { ok: true }; }
  export async function eliminarTemporada(...a) { reg('eliminarTemporada', a); return { ok: true }; }
  export async function copiarTemporadasDesdeHotel(...a) { reg('copiarTemporadasDesdeHotel', a); return ${G}.copia; }
  export async function crearTarifa(...a) { reg('crearTarifa', a); return { ok: true }; }
  export async function actualizarTarifa(...a) { reg('actualizarTarifa', a); return { ok: true }; }
  export async function eliminarTarifa(...a) { reg('eliminarTarifa', a); return { ok: true }; }
`);
const NAVEGACION = datos(`export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "../actions" && padre.endsWith("/HotelDetalleClient.tsx")) return { url: ACCIONES, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/producto/hoteles/")) return { url: NAVEGACION, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/53" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView = () => {};
(dom.window as unknown as { scrollTo: () => void }).scrollTo = () => {};

const v43r = { llamadas: [] as [string, unknown[]][], copia: { ok: true, copiadas: 1 } as unknown }; // `copia`: respuesta simulada de copiar (el mensaje de omitidas en pantalla no se prueba por interacción)
(globalThis as unknown as { __v43r: typeof v43r }).__v43r = v43r;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { HotelDetalleClient } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx");
const h = React.createElement;
type Props = Parameters<typeof HotelDetalleClient>[0];

let desmontar: (() => Promise<void>) | undefined;
beforeEach(() => { mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T17:00:00Z") }); });
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  v43r.llamadas.length = 0; v43r.copia = { ok: true, copiadas: 1 };
  mock.timers.reset();
});
after(() => dom.window.close());

async function montar(props: Props) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(HotelDetalleClient, props) as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
async function escribir(input: HTMLInputElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const botonTexto = (r: Element, t: string) => [...r.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === t) as HTMLButtonElement | undefined;
const campoFecha = (r: Element, etiqueta: string) => r.querySelector<HTMLInputElement>(`input[aria-label='${etiqueta}']`)!;
const panelTemporadas = (r: Element) => r.querySelector<HTMLElement>("#panel-hotel-temporadas")!;

// Hotel 53, vigencia ALTA id 140: el dato histórico con el error de captura.
const ALTA_140 = {
  id: 140, nombre: "ALTA", fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03", prioridad: 2, compra_inicio: "2026-07-24", compra_fin: "2027-04-30",
  tipo: "tarifa", min_noches: 1, rangos: [{ fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03" }], blackouts: [],
};
const props = (over: Partial<Props> = {}): Props => ({
  hotelId: 53, categorias: ["ESTANDAR"], regimenes: ["PAM"], temporadas: [ALTA_140], tarifas: [], otrosHoteles: [{ id: 9, nombre: "Otro" }],
  adultsOnly: false, mostrarTarifaPersona: true, moneda: "COP", pestanaInicial: "temporadas",
  configuracion: h("div", null, "cfg"), calculadora: h("div", null, "calc"), tarifasExtra: h("div", null, "extra"), ...over,
} as Props);
const editar = async (r: Element) => pulsar([...panelTemporadas(r).querySelectorAll("li button")].find((b) => b.textContent === "Editar")!);

test("editar la vigencia histórica SIN tocar sus fechas se envía al servidor (conserva el dato antiguo)", async () => {
  const r = await montar(props());
  await editar(r);
  assert.match(panelTemporadas(r).textContent ?? "", /Editando: ALTA/);
  await pulsar(botonTexto(r, "Guardar cambios")!);
  assert.equal(v43r.llamadas.length, 1);
  assert.equal(v43r.llamadas[0][0], "actualizarTemporada");
  assert.equal((v43r.llamadas[0][1][1] as { inicio: string }).inicio, "0206-12-24");
});

test("cambiar solo el fin mientras el inicio sigue siendo 0206-12-24: el formulario lo rechaza y NO llama al servidor", async () => {
  const r = await montar(props());
  await editar(r);
  await escribir(campoFecha(r, "Viaje hasta"), "2027-01-05");
  await pulsar(botonTexto(r, "Guardar cambios")!);
  assert.match(panelTemporadas(r).textContent ?? "", /0206-12-24/);
  assert.match(panelTemporadas(r).textContent ?? "", /año anterior a 2026/);
  assert.equal(v43r.llamadas.length, 0);
});

test("la corrección legítima del inicio a 2026-12-24 se envía tal cual", async () => {
  const r = await montar(props());
  await editar(r);
  await escribir(campoFecha(r, "Viaje desde"), "2026-12-24");
  await pulsar(botonTexto(r, "Guardar cambios")!);
  assert.equal(v43r.llamadas.length, 1);
  assert.equal((v43r.llamadas[0][1][1] as { inicio: string }).inicio, "2026-12-24");
});

test("crear una vigencia con inicio 0206-12-24: el formulario muestra el error y no envía nada", async () => {
  const r = await montar(props({ temporadas: [] }));
  await escribir(r.querySelector<HTMLInputElement>("#panel-hotel-temporadas input[placeholder^='ALTA, BAJA']")!, "ALTA");
  await escribir(campoFecha(r, "Viaje desde"), "0206-12-24");
  await escribir(campoFecha(r, "Viaje hasta"), "2027-01-03");
  await pulsar(botonTexto(r, "Agregar temporada")!);
  assert.match(panelTemporadas(r).textContent ?? "", /0206-12-24/);
  assert.equal(v43r.llamadas.length, 0);
});

test("crear con fecha inexistente (2027-02-30) o con año anterior (2025-12-31) tampoco llega al servidor", async () => {
  const r = await montar(props({ temporadas: [] }));
  await escribir(r.querySelector<HTMLInputElement>("#panel-hotel-temporadas input[placeholder^='ALTA, BAJA']")!, "MEDIA");
  await escribir(campoFecha(r, "Viaje desde"), "2027-02-01");
  await escribir(campoFecha(r, "Viaje hasta"), "2027-02-30");
  await pulsar(botonTexto(r, "Agregar temporada")!);
  // El selector de fechas ya no retiene un día inexistente: el campo queda vacío y el formulario pide el rango completo.
  assert.match(panelTemporadas(r).textContent ?? "", /necesita fecha de inicio y de fin/);
  assert.equal(v43r.llamadas.length, 0);
  await escribir(campoFecha(r, "Viaje desde"), "2025-12-31");
  await escribir(campoFecha(r, "Viaje hasta"), "2026-01-05");
  await pulsar(botonTexto(r, "Agregar temporada")!);
  assert.match(panelTemporadas(r).textContent ?? "", /2025-12-31/);
  assert.equal(v43r.llamadas.length, 0);
});

test("una vigencia válida se crea como siempre", async () => {
  const r = await montar(props({ temporadas: [] }));
  await escribir(r.querySelector<HTMLInputElement>("#panel-hotel-temporadas input[placeholder^='ALTA, BAJA']")!, "ALTA");
  await escribir(campoFecha(r, "Viaje desde"), "2026-12-24");
  await escribir(campoFecha(r, "Viaje hasta"), "2027-01-03");
  await pulsar(botonTexto(r, "Agregar temporada")!);
  assert.equal(v43r.llamadas.length, 1);
  assert.equal(v43r.llamadas[0][0], "crearTemporada");
});
