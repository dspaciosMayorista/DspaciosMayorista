// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// Panel de servicio manual en el checkout (revisión #442): (1) rótulos según el tipo («Pasajeros en este vuelo» solo para vuelos; en otros servicios, «Pasajeros que cubre este servicio» y ayuda propia,
// y textos de fechas propios); (2) las fechas de un servicio que NO es vuelo se precargan desde el hotel al que se asigna, siguen editables y no se pisan; con varios hoteles de fechas distintas primero
// hay que elegir el hotel; nunca se usa «hoy».
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/tarifario/checkout", pretendToBeVisual: true });
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
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const porId = (raiz: ParentNode, id: string) => raiz.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null;
const porTest = (raiz: ParentNode, id: string) => raiz.querySelector(`[data-testid="${id}"]`);
const etiquetaDe = (raiz: ParentNode, id: string) => raiz.querySelector(`label[for="${id}"]`)?.textContent ?? "";

const hotel = (id: string, nombre: string, ida: string, regreso: string, pid: number) => ({
  id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: pid, hotelId: pid, bloqueoId: null, hotelNombre: nombre, destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno",
  fechaIda: ida, fechaRegreso: regreso, noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 600_000, moneda: "COP", edadesMenores: [], condicion: null,
});

async function montar(items: unknown[]) {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let carrito!: ReturnType<typeof useCart>;
  function Espia() { carrito = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CheckoutPage), h(Espia, null))); await espera(60); });
  return { container, carrito: () => carrito, desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
type M = Awaited<ReturnType<typeof montar>>;
async function escribir(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  await act(async () => {
    const esSelect = el instanceof window.HTMLSelectElement;
    Object.getOwnPropertyDescriptor(esSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new window.Event(esSelect ? "change" : "input", { bubbles: true }));
    await espera(5);
  });
}
async function escribirFecha(el: HTMLInputElement, ddmmaaaa: string) {
  await act(async () => { el.focus(); await espera(5); });
  await escribir(el, ddmmaaaa);
  await act(async () => { el.blur(); await espera(20); });
}
const abrirNuevo = async (m: M) => { await act(async () => { click(boton(/^\s*Agregar\s*$/, m.container)!); await espera(); }); };
const elegirClase = (m: M, clase: "vuelo" | "otro") => escribir(porId(m.container, "man-clase")!, clase);
const valorFecha = (m: M, id: "man-ida" | "man-regreso") => (porId(m.container, id) as HTMLInputElement).value;
const textoFecha = (m: M, id: "man-ida" | "man-regreso") => porId(m.container, id)!.textContent ?? "";

describe("Panel de servicio manual: rótulos según el tipo", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => stub.__setContextoAsistencia({ puede: false }));

  test("«Pasajeros en este vuelo» solo para vuelos; en otro servicio «Pasajeros que cubre este servicio», con ayuda y textos de fechas propios", async () => {
    const m = await montar([hotel("h1", "Hotel Almirante", "2030-10-15", "2030-10-18", 10)]);
    await abrirNuevo(m);
    // Por defecto el tipo es Vuelo.
    assert.equal(etiquetaDe(m.container, "man-pax"), "Pasajeros en este vuelo");
    assert.match(sinEspacios(m.container.textContent ?? ""), /Cámbialo si el grupo viaja en vuelos distintos/);
    assert.equal(etiquetaDe(m.container, "man-ida"), "Fecha del vuelo de ida (del plan)");
    await elegirClase(m, "otro");
    assert.equal(etiquetaDe(m.container, "man-pax"), "Pasajeros que cubre este servicio");
    const texto = sinEspacios(m.container.textContent ?? "");
    assert.doesNotMatch(texto, /Pasajeros en este vuelo|vuelos distintos/, "ningún texto de vuelo en un servicio que no lo es");
    assert.match(texto, /Si el servicio cubre a menos, cambia la cantidad y luego marca exactamente a cuáles en «Pasajeros que cubre cada servicio»/);
    assert.equal(etiquetaDe(m.container, "man-ida"), "Fecha de inicio del servicio (opcional)");
    assert.equal(etiquetaDe(m.container, "man-regreso"), "Fecha de fin del servicio (opcional)");
    assert.doesNotMatch(texto, /Fecha de ida \(opcional\)|Fecha de regreso \(opcional\)/);
    assert.match(String(porTest(m.container, "ayuda-fechas-servicio")?.textContent), /Se precargan con las fechas consultadas del hotel al que se asigna/);
    // volver a Vuelo restituye los rótulos de vuelo
    await elegirClase(m, "vuelo");
    assert.equal(etiquetaDe(m.container, "man-pax"), "Pasajeros en este vuelo");
    m.desmontar();
  });
});

describe("Panel de servicio manual: fechas desde el hotel al que se asigna", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => stub.__setContextoAsistencia({ puede: false }));

  test("un solo hotel: ida y regreso se precargan con las fechas consultadas, siguen editables y NO se pisan al cambiar otros campos", async () => {
    const m = await montar([hotel("h1", "Hotel Almirante", "2030-10-15", "2030-10-18", 10)]);
    await abrirNuevo(m); await elegirClase(m, "otro");
    assert.equal(valorFecha(m, "man-ida"), "15/10/2030");
    assert.equal(valorFecha(m, "man-regreso"), "18/10/2030");
    await escribirFecha(porId(m.container, "man-regreso") as HTMLInputElement, "17/10/2030");
    assert.equal(valorFecha(m, "man-regreso"), "17/10/2030", "lo editado se respeta");
    await escribir(porId(m.container, "man-nombre")!, "Traslado privado");
    await escribir(porId(m.container, "man-pax")!, "2");
    assert.equal(valorFecha(m, "man-regreso"), "17/10/2030", "cambiar otros campos no sobrescribe la fecha editada");
    assert.equal(valorFecha(m, "man-ida"), "15/10/2030");
    // guardar: el servicio queda con las fechas mostradas y SIN hotel (en el carrito normal el servidor tampoco lo liga)
    await escribir(porId(m.container, "man-precio")!, "90000");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    const man = m.carrito().items.find((i) => i.tipo === "manual") as unknown as Record<string, unknown>;
    assert.deepEqual([man.fechaIda, man.fechaRegreso, man.hotelRef], ["2030-10-15", "2030-10-17", null]);
    m.desmontar();
  });

  test("dos hoteles con fechas DISTINTAS: primero se elige el hotel; mientras tanto las fechas quedan vacías (no «hoy») y se explica por qué; al elegir se precargan y al cambiar de hotel se actualizan", async () => {
    const m = await montar([hotel("hA", "Hotel Almirante", "2030-10-15", "2030-10-18", 10), hotel("hB", "Hotel Bahía", "2030-11-02", "2030-11-06", 11)]);
    await abrirNuevo(m); await elegirClase(m, "otro");
    assert.equal(etiquetaDe(m.container, "man-hotel"), "Hotel al que se asigna el servicio");
    assert.equal(valorFecha(m, "man-ida"), "", "sin asociación no se inventa ninguna fecha");
    assert.equal(valorFecha(m, "man-regreso"), "");
    assert.ok(porTest(m.container, "fechas-sin-hotel"), "se pide elegir el hotel para precargar");
    await escribir(porId(m.container, "man-hotel")!, "hB");
    assert.equal(valorFecha(m, "man-ida"), "02/11/2030");
    assert.equal(valorFecha(m, "man-regreso"), "06/11/2030");
    assert.equal(porTest(m.container, "fechas-sin-hotel"), null);
    await escribir(porId(m.container, "man-hotel")!, "hA");
    assert.equal(valorFecha(m, "man-ida"), "15/10/2030", "cambiar de hotel (sin haber editado fechas) actualiza la precarga");
    assert.equal(valorFecha(m, "man-regreso"), "18/10/2030");
    // una vez editada una fecha, cambiar de hotel ya NO la sobrescribe
    await escribirFecha(porId(m.container, "man-ida") as HTMLInputElement, "16/10/2030");
    await escribir(porId(m.container, "man-hotel")!, "hB");
    assert.equal(valorFecha(m, "man-ida"), "16/10/2030");
    assert.equal(valorFecha(m, "man-regreso"), "18/10/2030");
    m.desmontar();
  });

  test("dos hoteles con las MISMAS fechas: no hay ambigüedad, se precargan sin elegir hotel", async () => {
    const m = await montar([hotel("hA", "Hotel Almirante", "2030-10-15", "2030-10-18", 10), hotel("hB", "Hotel Bahía", "2030-10-15", "2030-10-18", 11)]);
    await abrirNuevo(m); await elegirClase(m, "otro");
    assert.equal(valorFecha(m, "man-ida"), "15/10/2030");
    assert.equal(valorFecha(m, "man-regreso"), "18/10/2030");
    assert.equal(porTest(m.container, "fechas-sin-hotel"), null);
    m.desmontar();
  });

  test("editar un servicio ya guardado respeta SUS fechas (no se vuelven a precargar) y el vuelo sigue tomando las del plan", async () => {
    const m = await montar([hotel("h1", "Hotel Almirante", "2030-10-15", "2030-10-18", 10)]);
    await abrirNuevo(m); await elegirClase(m, "otro");
    await escribirFecha(porId(m.container, "man-ida") as HTMLInputElement, "16/10/2030");
    await escribir(porId(m.container, "man-nombre")!, "Cena show");
    await escribir(porId(m.container, "man-precio")!, "50000");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    await act(async () => { click(m.container.querySelector('button[aria-label="Editar Cena show"]')!); await espera(); });
    assert.equal(valorFecha(m, "man-ida"), "16/10/2030");
    assert.equal(valorFecha(m, "man-regreso"), "18/10/2030");
    await elegirClase(m, "vuelo");
    assert.equal(textoFecha(m, "man-ida"), "2030-10-15", "el vuelo toma la fecha del plan, no la del servicio");
    m.desmontar();
  });
});
