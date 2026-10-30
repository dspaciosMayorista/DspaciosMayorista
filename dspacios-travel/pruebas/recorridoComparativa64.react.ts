// Se ejecuta con npm run test:react.
// #64 (ronda 11) — RECORRIDO COMPLETO de la comparativa con el botón REAL del carrito (no se entra por URL): Vista Booking activa «Cotización comparativa» → tres hoteles del mismo destino
// y fechas → se abre el carrito → «Crear comparativa» (navega a /tarifario/checkout?modo=comparativa) → panel de vuelo (aplica a las tres opciones, 2 pasajeros, sin pedir hotel) →
// totales y términos B2B por opción (nunca globales) → volver al carrito / recargar sin perder el modo. Con el modo apagado el recorrido normal no cambia.
// Se montan los componentes reales (ModoComparativaBooking, CartDrawer, CheckoutPage) bajo UN CartProvider, como el layout de /tarifario; el router es el stub que navega de verdad.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/tarifario", pretendToBeVisual: true });
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
const { CartDrawer } = await import("../app/tarifario/CartDrawer.tsx");
const { ModoComparativaBooking } = await import("../lib/cotizacion/comparativaBooking.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const nav = await import("./support/stubs/nextNavigationStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent?.trim() === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const porId = (raiz: ParentNode, id: string) => raiz.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null;
const porTest = (raiz: ParentNode, id: string) => raiz.querySelector(`[data-testid="${id}"]`);
const todosTest = (raiz: ParentNode, id: string) => [...raiz.querySelectorAll(`[data-testid="${id}"]`)];

const hotel = (id: string, nombre: string) => ({ id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10 + id.charCodeAt(0), hotelId: id.charCodeAt(0), bloqueoId: null, hotelNombre: nombre, destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1_200_000, edadesMenores: [], moneda: "COP" });
const TRES = () => [hotel("a", "Hotel A"), hotel("b", "Hotel B"), hotel("c", "Hotel C")];

const T = (extra: Record<string, unknown>) => ({ aliado_nombre: "Agencia Sol", tipo_asesor: "agencia", modo_compra: "comisionable", moneda: "COP", pct: 0.1, pct_origen: "aliado", ...extra });
const termino = (pvp: number, impuesto: number) => T({ pvp, impuesto, base: pvp - impuesto, comision: Math.round((pvp - impuesto) * 0.1), total_exigible: pvp });

/** La «página» del layout: /tarifario (Vista Booking + carrito) o /tarifario/checkout, bajo el MISMO CartProvider, como en producción. */
function Escena({ ruta0 }: { ruta0: string }) {
  const [ruta, setRuta] = React.useState(ruta0);
  React.useEffect(() => nav.__escuchar((url: string) => setRuta(url)), []);
  const carrito = useCart();
  (globalThis as unknown as { __carrito: ReturnType<typeof useCart> }).__carrito = carrito;
  return ruta.startsWith("/tarifario/checkout")
    ? h(CheckoutPage)
    : h(React.Fragment, null, h(ModoComparativaBooking), h(CartDrawer, { checkoutHabilitado: true }));
}
const carrito = () => (globalThis as unknown as { __carrito: ReturnType<typeof useCart> }).__carrito;

async function montar(ruta0 = "/tarifario") {
  window.history.pushState({}, "", ruta0);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(Escena, { ruta0 }))); await espera(); });
  return { container, texto: () => sinEspacios(container.textContent ?? ""), desmontar: () => { act(() => root.unmount()); container.remove(); } };
}
async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    await espera(5);
  });
}
async function llenarCliente(c: HTMLElement) {
  await act(async () => {
    const set = (label: string, v: string) => {
      const l = [...c.querySelectorAll("label")].find((x) => x.textContent === label)!;
      const i = l.parentElement!.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, v);
      i.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    set("Nombres *", "Ana"); set("Apellidos *", "Pérez"); set("Teléfono / WhatsApp *", "300");
    await espera();
  });
}
const abrirCarrito = async () => { await act(async () => { carrito().openDrawer(); await espera(); }); };
const botonCarrito = () => [...document.querySelectorAll("button")].find((b) => /^(Crear comparativa|Finalizar compra)$/.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;

describe("Recorrido real: Vista Booking → carrito → checkout de la comparativa", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [{ id: 7, nombre: "Agencia Sol", tipo: "agencia", pct: 0.1, pctOrigen: "aliado" }] }));
  after(() => { stub.__setContextoAsistencia({ puede: false }); stub.__setPrevisualizarComparativa(null); stub.__setCrearComparativaCarrito(null); });
  beforeEach(() => { localStorage.clear(); nav.__pushes.length = 0; window.history.pushState({}, "", "/tarifario"); });

  test("con el modo activo el botón del carrito dice «Crear comparativa» y abre /tarifario/checkout?modo=comparativa; el checkout es la comparativa (por opción, sin total ni B2B globales)", async () => {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(TRES()));
    const m = await montar();
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    assert.equal(boton(/Cotización comparativa/, m.container)!.getAttribute("aria-pressed"), "true", "modo activo");
    await abrirCarrito();
    const b = botonCarrito()!;
    assert.ok(b, "hay botón de continuar en el carrito");
    assert.equal(b.textContent?.trim(), "Crear comparativa", "no «Finalizar compra»");
    assert.ok(porTest(document, "sin-total-comparativa"), "el carrito no muestra un total global");

    await act(async () => { click(b); await espera(60); });
    assert.deepEqual(nav.__pushes, ["/tarifario/checkout?modo=comparativa"], "navega a la comparativa, no a la compra normal");
    assert.equal(window.location.search, "?modo=comparativa");

    // Checkout: comparativa, no compra normal.
    const t = m.texto();
    assert.match(t, /Crear cotización comparativa/);
    assert.doesNotMatch(t, /Finalizar solicitud/);
    assert.equal(todosTest(m.container, "opcion-comparativa").length, 3, "una tarjeta por hotel");
    assert.deepEqual(todosTest(m.container, "pvp-opcion").map((x) => x.textContent?.replace(/\D/g, "")), ["1200000", "1200000", "1200000"], "cada opción con su PVP");
    assert.doesNotMatch(t, /Total estimado|Total \(PVP\)|Total del carrito|Comisión a liquidar \(/, "ningún total ni comisión global");
    m.desmontar();
  });

  test("panel de vuelo: se aplica solo a las tres opciones del mismo destino y fechas, propone 2 pasajeros (no 6) y no pide hotel", async () => {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(TRES()));
    const m = await montar();
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    await abrirCarrito();
    await act(async () => { click(botonCarrito()!); await espera(60); });

    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    assert.equal(porId(m.container, "man-pax")!.value, "2", "2 pasajeros, no 6");
    const hotelSel = porId(m.container, "man-hotel")!;
    assert.equal(hotelSel.tagName, "P", "no se pide elegir hotel");
    assert.match(sinEspacios(hotelSel.textContent ?? ""), /Todas las opciones · CTG/);
    await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Tiquete Avianca");
    await escribir(porId(m.container, "man-otra") as HTMLInputElement, "BOG");
    await escribir(porId(m.container, "man-precio") as HTMLInputElement, "1800000");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });

    // El vuelo entra UNA vez en cada opción (hotel 1.200.000 + vuelo 1.800.000), sin sumarse entre opciones.
    assert.deepEqual(todosTest(m.container, "pvp-opcion").map((x) => x.textContent?.replace(/\D/g, "")), ["3000000", "3000000", "3000000"]);
    assert.doesNotMatch(m.texto(), /Total estimado|Total \(PVP\)|9\.000\.000|Total del carrito/);
    m.desmontar();
  });

  test("B2B: aliado y modalidad por opción; cada una con su PVP, impuesto, base, %, comisión y exigible; y al generar viaja solo la elección", async () => {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(TRES()));
    stub.__setPrevisualizarComparativa(async () => ({ ok: true, opciones: ["A", "B", "C"].map((o, i) => ({ opcionRef: o, acomodacionRef: "doble", hotel: `Hotel ${o}`, terminos: termino(2_400_000 + i * 100_000, 200_000 + i * 50_000) })) }));
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar();
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    await abrirCarrito();
    await act(async () => { click(botonCarrito()!); await espera(60); });

    await act(async () => { click(boton("Aliado (B2B)", m.container)!); await espera(); });
    await escribir(porId(m.container, "asist-aliado") as HTMLInputElement, "Agencia Sol · Agencia");
    await act(async () => { click(boton("PVP con comisión", m.container)!); await espera(80); });
    const paneles = todosTest(m.container, "terminos-opcion");
    assert.equal(paneles.length, 3, "un desglose por opción");
    const num = (p: Element, id: string) => (p.querySelector(`[data-testid="${id}"]`)?.textContent ?? "").replace(/\D/g, "");
    assert.deepEqual(paneles.map((p) => num(p, "b2b-pvp")), ["2400000", "2500000", "2600000"]);
    assert.deepEqual(paneles.map((p) => num(p, "b2b-impuesto")), ["200000", "250000", "300000"]);
    assert.deepEqual(paneles.map((p) => num(p, "b2b-comision")), ["220000", "225000", "230000"]);
    assert.equal(todosTest(m.container, "terminos-b2b-previa").length, 3, "no existe un desglose global adicional");
    assert.doesNotMatch(m.texto(), /Total estimado|Total \(PVP\)|Comisión a liquidar \(/);

    await llenarCliente(m.container);
    const n0 = stub.__comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
    const enviado = stub.__comparativas[n0] as { asistencia?: unknown } & Record<string, unknown>;
    assert.deepEqual(enviado.asistencia, { canal: "b2b", aliadoId: 7, modo: "comisionable" });
    assert.doesNotMatch(JSON.stringify(enviado), /comision"|total_exigible/);
    m.desmontar();
  });

  test("el modo NO se pierde: volver del checkout al carrito, cambiar de página o recargar la pestaña lo conservan; y el checkout abierto sin el parámetro vuelve a la comparativa", async () => {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(TRES()));
    const m = await montar();
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    await abrirCarrito();
    await act(async () => { click(botonCarrito()!); await espera(60); });
    assert.equal(window.location.search, "?modo=comparativa");

    // «Volver al carrito»: otra página del mismo layout (el provider no se desmonta).
    await act(async () => { nav.useRouter().push("/tarifario"); await espera(60); });
    assert.equal(boton(/Cotización comparativa/, m.container)!.getAttribute("aria-pressed"), "true", "el toggle sigue activo");
    await abrirCarrito();
    assert.equal(botonCarrito()!.textContent?.trim(), "Crear comparativa");
    m.desmontar();

    // Recarga completa: nuevo CartProvider, mismo localStorage.
    const m2 = await montar("/tarifario");
    assert.equal(boton(/Cotización comparativa/, m2.container)!.getAttribute("aria-pressed"), "true", "tras recargar sigue activo");
    await abrirCarrito();
    assert.equal(botonCarrito()!.textContent?.trim(), "Crear comparativa");
    m2.desmontar();

    // Entrar al checkout SIN el parámetro con el modo activo: no cae en compra normal en silencio.
    const m3 = await montar("/tarifario/checkout");
    await act(async () => { await espera(60); });
    assert.equal(window.location.search, "?modo=comparativa", "se corrige a la comparativa");
    assert.match(m3.texto(), /Crear cotización comparativa/);
    m3.desmontar();
  });

  test("apagar el modo en el toggle se recuerda (no reaparece al recargar) y el recorrido normal queda igual: «Finalizar compra» → /tarifario/checkout, compra normal", async () => {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(TRES()));
    const m = await montar();
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    assert.equal(boton(/Cotización comparativa/, m.container)!.getAttribute("aria-pressed"), "false");
    m.desmontar();

    const m2 = await montar("/tarifario");
    assert.equal(boton(/Cotización comparativa/, m2.container)!.getAttribute("aria-pressed"), "false", "apagado sigue apagado tras recargar");
    await abrirCarrito();
    assert.equal(botonCarrito()!.textContent?.trim(), "Finalizar compra");
    assert.ok(!porTest(document, "sin-total-comparativa"));
    await act(async () => { click(botonCarrito()!); await espera(60); });
    assert.deepEqual(nav.__pushes, ["/tarifario/checkout"]);
    assert.equal(window.location.search, "");
    assert.match(m2.texto(), /Finalizar solicitud/);
    assert.doesNotMatch(m2.texto(), /Crear cotización comparativa/);
    assert.equal(todosTest(m2.container, "opcion-comparativa").length, 0, "sin tarjetas de opciones");
    m2.desmontar();
  });
});
