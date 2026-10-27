// Se ejecuta con npm run test:react.
// #64 (ronda 6) — Pantalla de la comparativa: (1) aliado y PVP/NETO por OPCIÓN (sin total ni comisión global); (2) misma acomodación en toda la comparativa multidestino con vuelos,
// con el MISMO mensaje que el servidor.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const { mensajeAcomodacionComparativa } = await import("../lib/cotizacion/comparativa.ts");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;

const hotel = { id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "Hotel Almirante", destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1_200_000, edadesMenores: [], moneda: "COP" };
const hot = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({ ...hotel, id, hotelNombre: nombre, paqueteId: 10 + id.length, hotelId: id.charCodeAt(0), ...extra });
const vuelo = (id: string, hotelRef: string, destino: string, ida: string, regreso: string) => ({ id, tipo: "manual", clase: "vuelo", nombre: `Vuelo ${destino}`, origen: "BOG", destino, fechaIda: ida, fechaRegreso: regreso, tramo: "ida_regreso", hotelRef, hotelEtiqueta: null, pax: 2, precio: 800_000, impuestoNoComisionable: 100_000, moneda: "COP", fotoUrl: null, noches: null });
const CTG = hot("a", "Hotel Cartagena");
const SMR = (hab: Record<string, number>) => hot("s", "Hotel Rodadero", { destino: "SANTA MARTA", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24", habitaciones: hab });
const VUELOS = [vuelo("m1", "grupo:CTG|2030-10-15|2030-10-18", "CTG", "2030-10-15", "2030-10-18"), vuelo("m2", "grupo:SMR|2030-10-20|2030-10-24", "SMR", "2030-10-20", "2030-10-24")];

async function montar(items: unknown[]) {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CheckoutPage))); await espera(); });
  return { container, texto: () => sinEspacios(container.textContent ?? ""), desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
type M = Awaited<ReturnType<typeof montar>>;
async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    await espera(5);
  });
}
async function llenarCliente(m: M) {
  await act(async () => {
    const set = (label: string, v: string) => {
      const l = [...m.container.querySelectorAll("label")].find((x) => x.textContent === label)!;
      const i = l.parentElement!.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, v);
      i.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    set("Nombres *", "Ana"); set("Apellidos *", "Pérez"); set("Teléfono / WhatsApp *", "300");
    const doc = [...m.container.querySelectorAll("label")].find((l) => /documento/i.test(l.textContent ?? "") && l.parentElement!.querySelector("input"));
    if (doc) { const i = doc.parentElement!.querySelector("input") as HTMLInputElement; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, "123"); i.dispatchEvent(new window.Event("input", { bubbles: true })); }
    await espera();
  });
}
const generar = async (m: M) => {
  await llenarCliente(m);
  const n0 = stub.__comparativas.length;
  await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
  return { enviado: stub.__comparativas.length > n0 ? (stub.__comparativas[n0] as Record<string, unknown>) : null, texto: m.texto() };
};
const ALERTA_ACOM = /misma acomodación/;

describe("comparativa: la misma acomodación en toda la comparativa multidestino con vuelos (UI = servidor)", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => { stub.__setContextoAsistencia({ puede: false }); window.history.pushState({}, "", "/"); });
  const enComparativa = () => window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");

  test("dos destinos doble/doble: se permite y llega al servidor", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([CTG, SMR({ doble: 1 }), ...VUELOS]);
    const r = await generar(m);
    assert.ok(r.enviado, "se envió al servidor");
    assert.doesNotMatch(r.texto, ALERTA_ACOM);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("dos destinos doble/triple: se rechaza en pantalla, con el texto exacto del servidor, y no se envía nada", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([CTG, SMR({ triple: 1 }), ...VUELOS]);
    const r = await generar(m);
    assert.equal(r.enviado, null);
    const alerta = sinEspacios(m.container.querySelector('[data-testid="error-checkout"]')?.textContent ?? "");
    assert.equal(alerta, sinEspacios(mensajeAcomodacionComparativa({ tipo: "distintas", hotel: "Hotel Rodadero" })));
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("un solo destino con dos fechas y acomodaciones distintas: se permite", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const b = hot("b", "Hotel Bocagrande", { fechaIda: "2030-10-20", fechaRegreso: "2030-10-24", habitaciones: { triple: 1 } });
    const m = await montar([CTG, b, vuelo("m1", "grupo:CTG|2030-10-15|2030-10-18", "CTG", "2030-10-15", "2030-10-18"), vuelo("m2", "grupo:CTG|2030-10-20|2030-10-24", "CTG", "2030-10-20", "2030-10-24")]);
    const r = await generar(m);
    assert.ok(r.enviado);
    assert.doesNotMatch(r.texto, ALERTA_ACOM);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });
});

describe("comparativa asistida B2B: términos por opción en la pantalla", () => {
  const T = (extra: Record<string, unknown>) => ({ aliado_nombre: "Agencia Sol", tipo_asesor: "agencia", modo_compra: "comisionable", moneda: "COP", pct: 0.1, pct_origen: "aliado", ...extra });
  const A = T({ pvp: 2_400_000, impuesto: 200_000, base: 2_200_000, comision: 220_000, total_exigible: 2_400_000 });
  const B = T({ pvp: 2_600_000, impuesto: 300_000, base: 2_300_000, comision: 230_000, total_exigible: 2_600_000 });
  before(() => {
    stub.__setContextoAsistencia({ puede: true, aliados: [{ id: 7, nombre: "Agencia Sol", tipo: "agencia", pct: 0.1, pctOrigen: "aliado" }] });
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
  });
  after(() => { stub.__setContextoAsistencia({ puede: false }); stub.__setPrevisualizarComparativa(null); window.history.pushState({}, "", "/"); });

  async function elegirAliado(m: M, modo: "PVP con comisión" | "NETO") {
    await act(async () => { click(boton("Aliado (B2B)", m.container)!); await espera(); });
    await escribir(m.container.querySelector("#asist-aliado") as HTMLInputElement, "Agencia Sol · Agencia");
    await act(async () => { click(boton(modo, m.container)!); await espera(80); });
  }
  const dosOpciones = async () => ({ ok: true, opciones: [
    { opcionRef: "A", acomodacionRef: "doble", hotel: "Hotel Cartagena", terminos: A },
    { opcionRef: "B", acomodacionRef: "doble", hotel: "Hotel Rodadero", terminos: B },
  ] });

  test("se ofrece aliado y modalidad, y cada opción muestra SU PVP, impuesto, base, %, comisión y exigible; no hay total ni comisión global", async () => {
    stub.__setPrevisualizarComparativa(dosOpciones);
    const m = await montar([CTG, hot("s", "Hotel Rodadero")]);
    assert.ok(m.container.querySelector('[data-testid="venta-asistida"]'), "el selector de venta asistida aparece en la comparativa");
    await elegirAliado(m, "PVP con comisión");
    const paneles = [...m.container.querySelectorAll('[data-testid="terminos-opcion"]')];
    assert.equal(paneles.length, 2);
    const num = (p: Element, id: string) => (p.querySelector(`[data-testid="${id}"]`)?.textContent ?? "").replace(/[^0-9]/g, "");
    const ids = ["b2b-pvp", "b2b-impuesto", "b2b-base", "b2b-comision", "b2b-total-exigible"];
    assert.deepEqual(ids.map((id) => num(paneles[0], id)), ["2400000", "200000", "2200000", "220000", "2400000"]);
    assert.deepEqual(ids.map((id) => num(paneles[1], id)), ["2600000", "300000", "2300000", "230000", "2600000"]);
    assert.equal(num(paneles[0], "b2b-pct"), "10");
    assert.doesNotMatch(m.texto(), /Total estimado|Total \(PVP\)|Comisión a liquidar \(/, "ningún total ni comisión global del carrito");
    m.desmontar();
  });

  test("al generar viaja SOLO la elección (aliado + modalidad); no viajan importes ni comisión", async () => {
    stub.__setPrevisualizarComparativa(dosOpciones);
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([CTG, hot("s", "Hotel Rodadero")]);
    await elegirAliado(m, "NETO");
    const { enviado } = await generar(m);
    assert.deepEqual(enviado!.asistencia, { canal: "b2b", aliadoId: 7, modo: "neta" });
    assert.doesNotMatch(JSON.stringify(enviado), /comision|total_exigible|"pvp"/i);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("sin desglose del servidor no se genera: un error de la vista previa bloquea el botón y no se muestran importes", async () => {
    stub.__setPrevisualizarComparativa(async () => ({ ok: false, error: "El precio de un hotel cambió." }));
    const m = await montar([CTG, hot("s", "Hotel Rodadero")]);
    await elegirAliado(m, "PVP con comisión");
    assert.ok(m.container.querySelector('[data-testid="previa-error"]'));
    assert.equal((boton(/Generar cotización comparativa/, m.container) as HTMLButtonElement).disabled, true);
    assert.equal(m.container.querySelectorAll('[data-testid="terminos-opcion"]').length, 0);
    m.desmontar();
  });
});
