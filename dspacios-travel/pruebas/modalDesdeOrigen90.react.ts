// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 · Recorrido SIN fechas ni salida elegidas: tarjeta («desde») → «Ver opciones». El modal debe abrir en la oferta/salida, categoría y régimen que ORIGINAN el «desde» anunciado,
// no en la primera fila publicada. Sin selección no se cotiza: los importes son los PUBLICADOS (sin promoción) y no hay etiqueta. Una elección explícita posterior se conserva.
import { JSDOM } from "jsdom";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true, FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { TarifarioPublic } = await import("../app/tarifario/TarifarioPublic.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");

type G = { __detalleActionsFake?: unknown; __cotizarTarjetaFake?: unknown };
const g = globalThis as G;
let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
  delete g.__detalleActionsFake; delete g.__cotizarTarjetaFake;
});
after(() => dom.window.close());

const fecha = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const IDA1 = fecha(30), REG1 = fecha(33), IDA2 = fecha(60), REG2 = fecha(63);
const TWIN = "Estándar Twin", KING = "Estándar King";
const base = {
  servicio_id: null, servicio_nombre: null, precio_sencilla: null, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null, precio_infante: null,
  descripcion: null, recargo_individual: null, tipo_tarifa: null, moneda: "COP", paquete_id: 54, paquete_nombre: "Nacional 54", hotel_id: 2540, hotel_nombre: "Hotel Nacional 54",
  destino_id: 7, destino_nombre: "CARTAGENA", empaquetado_id: null, desde_adulto: 700000, desde_general: 700000, regimen: "FULL",
};
const fila = (over: Record<string, unknown>) => ({ ...base, ...over });
const detalleDe = (resumen: Record<string, unknown>[]) => resumen.map((f) => ({ ...f, acomodacion: "doble", precio_pvp: f.precio_doble }));

const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const poner = (sel: HTMLSelectElement, v: string) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
  sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
const modal = () => (document.querySelector(".fixed.inset-0")?.textContent ?? "").replace(/\s+/g, " ");
const selects = () => [...document.querySelectorAll(".fixed.inset-0 select")] as HTMLSelectElement[];
const visibles = (sel: string) => [...document.querySelectorAll(`.fixed.inset-0 ${sel}`)].filter((e) => !e.closest("[hidden]"));
const textoVisible = () => visibles("div.rounded-lg.border").map((d) => d.textContent ?? "").join(" ").replace(/\s+/g, " ");
const etiquetas = () => document.querySelectorAll('.fixed.inset-0 [data-testid="etiqueta-descuento-hotel"]').length;

async function montar(resumen: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(TarifarioPublic, { filas: resumen, programas: [], puedeReservar: false, ...extra } as never))); });
  const dest = [...cont.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "CARTAGENA")) as HTMLSelectElement | undefined;
  if (dest) { await poner(dest, [...dest.options].find((o) => o.textContent === "CARTAGENA")!.value); await pausa(); }
  return cont;
}
const abrir = async (c: HTMLElement) => {
  await clic([...c.querySelectorAll("button")].find((b) => /Ver opciones/.test(b.getAttribute("aria-label") ?? "") || /Hotel Nacional 54/.test(b.textContent ?? ""))!);
  await pausa();
};

test("bloqueo sin fechas: el «desde» de la tarjeta lo origina King; el modal (con Twin primero en el detalle) abre en King, con el importe PUBLICADO y sin cotizar", async () => {
  // Resumen (lo que ve la tarjeta): Twin primero a 3.074.000; King a 2.890.000 = «desde».
  const resumen = [
    fila({ modulo: "bloqueo", bloqueo_id: 11, bloqueo_label: "Rec A", fecha_ida: IDA1, fecha_regreso: REG1, noches: 3, categoria: TWIN, precio_doble: 3_074_000 }),
    fila({ modulo: "bloqueo", bloqueo_id: 11, bloqueo_label: "Rec A", fecha_ida: IDA1, fecha_regreso: REG1, noches: 3, categoria: KING, precio_doble: 2_890_000 }),
  ];
  const llamadas: unknown[] = [];
  g.__cotizarTarjetaFake = async (i: unknown) => { llamadas.push(i); throw new Error("sin selección no se cotiza"); };
  // Detalle bajo demanda: también Twin primero.
  g.__detalleActionsFake = { obtenerDetalleHotel: async () => ({ ok: true, filas: detalleDe(resumen) }) };
  const c = await montar(resumen, { cuposPorBloqueo: { 11: 5 } });
  assert.match(c.textContent ?? "", /2\.890\.000/, "la tarjeta anuncia el precio de King");
  assert.doesNotMatch(c.textContent ?? "", /3\.074\.000/);
  await abrir(c);
  assert.equal(selects()[0].value, KING, "abre en la categoría que origina el «desde», no en la primera publicada (Twin)");
  assert.equal(selects()[1].value, "FULL");
  assert.match(textoVisible(), /2\.890\.000/, "importe publicado de King = el «desde» de la tarjeta");
  assert.doesNotMatch(textoVisible(), /3\.074\.000/);
  assert.equal(etiquetas(), 0, "precio publicado: sin promoción ni etiqueta");
  assert.doesNotMatch(modal(), /Importes calculados/);
  assert.equal(llamadas.length, 0, "no se cotizó nada");
  // Elección explícita posterior: Twin, y se conserva.
  await poner(selects()[0], TWIN);
  assert.equal(selects()[0].value, TWIN);
  assert.match(textoVisible(), /3\.074\.000/);
  await pausa();
  assert.equal(selects()[0].value, TWIN, "la elección del usuario no se sobrescribe");
});

test("bloqueo sin fechas: si el «desde» lo origina el record más lejano, el modal abre en ESA salida (no en la más próxima) y en su categoría", async () => {
  const r = (b: number, ida: string, reg: string, cat: string, p: number) => fila({ modulo: "bloqueo", bloqueo_id: b, bloqueo_label: `Rec ${b}`, fecha_ida: ida, fecha_regreso: reg, noches: 3, categoria: cat, precio_doble: p });
  const resumen = [r(11, IDA1, REG1, TWIN, 3_074_000), r(11, IDA1, REG1, KING, 3_000_000), r(12, IDA2, REG2, TWIN, 3_100_000), r(12, IDA2, REG2, KING, 2_890_000)];
  g.__cotizarTarjetaFake = async () => { throw new Error("sin selección no se cotiza"); };
  g.__detalleActionsFake = { obtenerDetalleHotel: async () => ({ ok: true, filas: detalleDe(resumen) }) };
  const c = await montar(resumen, { cuposPorBloqueo: { 11: 5, 12: 10 } });
  assert.match(c.textContent ?? "", /2\.890\.000/);
  await abrir(c);
  const activo = [...document.querySelectorAll(".fixed.inset-0 button")].find((b) => /Rec 1[12]/.test(b.textContent ?? "") && (b as HTMLElement).style.borderColor.includes("--brand-accent"));
  assert.match(activo?.textContent ?? "", /Rec 12/, "la salida activa es la que origina el «desde»");
  assert.equal(selects()[0].value, KING);
  assert.match(textoVisible(), /2\.890\.000/);
});

test("dinámico sin fechas: el modal abre en la salida y en la categoría que originan el «desde»", async () => {
  const d = (s: number, ida: string, reg: string, cat: string, p: number) => fila({ modulo: "dinamico", salida_id: s, bloqueo_id: null, bloqueo_label: "BOG-CTG", fecha_ida: ida, fecha_regreso: reg, noches: 3, categoria: cat, precio_doble: p });
  const resumen = [d(540, IDA1, REG1, TWIN, 3_074_000), d(540, IDA1, REG1, KING, 3_000_000), d(541, IDA2, REG2, TWIN, 3_100_000), d(541, IDA2, REG2, KING, 2_890_000)];
  g.__cotizarTarjetaFake = async () => { throw new Error("sin selección no se cotiza"); };
  g.__detalleActionsFake = { obtenerDetalleSalida: async (a: { salidaId: number }) => ({ ok: true, filas: detalleDe(resumen.filter((f) => (f as { salida_id?: number }).salida_id === a.salidaId)) }) };
  const c = await montar(resumen);
  await abrir(c);
  const activa = [...document.querySelectorAll(".fixed.inset-0 button[aria-pressed='true']")].map((b) => b.textContent ?? "");
  assert.equal(activa.length, 1);
  assert.match(activa[0], new RegExp(`${IDA2.slice(8)}/${IDA2.slice(5, 7)}/${IDA2.slice(2, 4)}`));
  assert.equal(selects()[0].value, KING);
  assert.match(textoVisible(), /2\.890\.000/);
  assert.doesNotMatch(textoVisible(), /3\.100\.000|3\.074\.000/);
});
