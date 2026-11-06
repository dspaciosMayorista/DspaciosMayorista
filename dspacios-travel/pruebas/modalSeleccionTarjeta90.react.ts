// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 / #436 · Recorrido TARJETA → «Ver opciones» (modal) → carrito (la cotización posterior re-liquida con el mismo cómputo en el servidor):
//   · con salida o fechas elegidas en la tarjeta, el modal se abre en ESA selección y muestra los importes calculados con la regla vigente (los mismos de la tarjeta);
//   · sin selección, el modal conserva los precios publicados de referencia y NO afirma ningún descuento.
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

type G = { __detalleActionsFake?: unknown; __cotizarTarjetaFake?: unknown; __cotizarPorFechasFake?: unknown };
const g = globalThis as G;
let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
  delete g.__detalleActionsFake; delete g.__cotizarTarjetaFake; delete g.__cotizarPorFechasFake;
});
after(() => dom.window.close());

const fecha = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const HOY = fecha(0), IDA1 = fecha(30), REG1 = fecha(33), IDA2 = fecha(60), REG2 = fecha(64);
const EBB = { etiqueta: "EBB 2 · 60+ días · 23 %", tipo: "ebb", umbral: 60, pct: 23 } as const;

const base = {
  servicio_id: null, servicio_nombre: null, precio_sencilla: null, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null,
  precio_infante: null, descripcion: null, recargo_individual: null, tipo_tarifa: null, moneda: "COP", categoria: "Estándar", regimen: "PAE",
};
const din = (salida: number, ida: string, reg: string, noches: number, over: Record<string, unknown> = {}) => ({
  ...base, modulo: "dinamico", paquete_id: 54, paquete_nombre: "Nacional 54", bloqueo_id: null, bloqueo_label: "BOG-CTG", empaquetado_id: null, salida_id: salida,
  hotel_id: 2540, hotel_nombre: "Hotel Nacional 54", destino_id: 7, destino_nombre: "CARTAGENA", fecha_ida: ida, fecha_regreso: reg, noches,
  precio_sencilla: 700000, precio_doble: 900000, desde_adulto: 700000, desde_general: 700000, ...over,
});
const FILAS_DIN = [
  din(540, IDA1, REG1, 3),
  din(541, IDA2, REG2, 4, { precio_sencilla: 1000000, precio_doble: 1100000, desde_adulto: 1000000, desde_general: 1000000 }),
];
const detalleOk = () => ({
  obtenerDetalleSalida: async (a: { salidaId: number }) => {
    const f = FILAS_DIN.find((x) => x.salida_id === a.salidaId)!;
    return { ok: true, filas: [{ ...f, acomodacion: "doble", precio_pvp: f.precio_doble }, { ...f, acomodacion: "sencilla", precio_pvp: f.precio_sencilla }] };
  },
});
// Lo que devuelve la acción de la tarjeta para la salida 541 (precio de la doble ya con/sin regla de hoy).
const cotizacion = (doble: number, descuento: typeof EBB | null) => ({
  ok: true, precio: doble, moneda: "COP", categoria: "Estándar", regimen: "PAE", fechaIda: IDA2, fechaRegreso: REG2, noches: 4, fechaCalculo: HOY, descuentoHotel: descuento,
  combos: [{ categoria: "Estándar", regimen: "PAE", precios: { doble, sencilla: doble - 100_000 }, preciosMenor2: {}, infanteSinFijo: { mayor2: null, menor2: null }, descuento }],
});

async function montar() {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(TarifarioPublic, { filas: FILAS_DIN, programas: [], puedeReservar: false } as never))); });
  return cont;
}
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const modal = () => (document.querySelector(".fixed.inset-0")?.textContent ?? "").replace(/\s+/g, " ");
const etiquetasModal = () => [...document.querySelectorAll('.fixed.inset-0 [data-testid="etiqueta-descuento-hotel"]')].map((e) => e.textContent?.trim());
const carrito = () => JSON.parse(dom.window.localStorage.getItem("dspacios_cart_v1") ?? "[]") as Record<string, unknown>[];
async function elegirDestino(c: HTMLElement) {
  const sel = [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "CARTAGENA")) as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, [...sel.options].find((o) => o.textContent === "CARTAGENA")!.value);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await pausa();
}
async function salidaEnTarjeta(c: HTMLElement) {
  const sel = c.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
  assert.ok(sel, "la tarjeta ofrece elegir salida");
  const opcion = [...sel.options].find((o) => o.value.includes("|541|")); // la segunda salida (541)
  assert.ok(opcion);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, opcion!.value);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await pausa();
}
const abrirModal = async (c: HTMLElement) => {
  await clic([...c.querySelectorAll("button")].find((b) => /Ver opciones/.test(b.getAttribute("aria-label") ?? "") || /Hotel Nacional 54/.test(b.textContent ?? ""))!);
  await pausa();
};
async function unaDoble() {
  const caja = [...document.querySelectorAll(".fixed.inset-0 div.rounded-lg.border")].find((d) => d.firstElementChild?.textContent === "Doble");
  const input = caja?.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "1");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

for (const [nombre, descuento, doble] of [["con promoción", EBB, 1_000_000], ["sin promoción", null, 1_100_000]] as const) {
  test(`tarjeta → modal → carrito ${nombre}: el modal abre en la salida elegida con los importes de la tarjeta`, async () => {
    dom.window.localStorage.clear();
    g.__detalleActionsFake = detalleOk();
    g.__cotizarTarjetaFake = async () => cotizacion(doble, descuento);
    const c = await montar();
    await elegirDestino(c);
    await salidaEnTarjeta(c);
    const tarjeta = c.querySelector('[data-testid="precio-fechas"]');
    assert.ok(tarjeta, "la tarjeta ya muestra el precio de la salida");
    await abrirModal(c);
    // El modal abre en la salida 541 (no en la primera) y no la pierde.
    const activa = [...document.querySelectorAll(".fixed.inset-0 button[aria-pressed='true']")].map((b) => b.textContent ?? "");
    assert.equal(activa.length, 1);
    assert.match(activa[0], new RegExp(`${IDA2.slice(8)}/${IDA2.slice(5, 7)}/${IDA2.slice(2, 4)}`));
    assert.match(modal(), /Importes calculados para la salida que elegiste/);
    // Los «desde» de las salidas: la elegida muestra SU importe calculado; la otra, rotulada como referencia publicada (nunca como precio de la selección).
    const chips = [...document.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].map((b) => (b.textContent ?? "").replace(/\s+/g, " "));
    const elegida = chips.find((x) => x.includes(`${IDA2.slice(8)}/`))!, otra = chips.find((x) => x.includes(`${IDA1.slice(8)}/`))!;
    assert.ok(elegida.includes("tu precio desde") && elegida.endsWith(`${(doble / 1000).toLocaleString("es-CO")}.000 en doble`), elegida);
    assert.ok(!elegida.includes("referencia") && (doble === 1_100_000 || !elegida.includes("1.100.000")), "la salida elegida no muestra el publicado");
    assert.ok(otra.includes("referencia publicada (sin cotizar): desde") && otra.includes("900.000 en doble"), otra);
    assert.deepEqual(etiquetasModal(), descuento ? [descuento.etiqueta] : [], "etiqueta solo si la cotización realmente la trae");
    await unaDoble();
    await clic([...document.querySelectorAll(".fixed.inset-0 button")].find((b) => /Agregar al carrito/.test(b.textContent ?? ""))!);
    await pausa();
    const [it] = carrito();
    assert.ok(it);
    assert.equal(it.salidaId, 541);
    assert.equal(it.precio, 2 * doble, "al carrito (y de ahí a la cotización) va el importe calculado, no el publicado");
  });
}

test("sin salida elegida: el modal conserva los precios publicados y no afirma ningún descuento", async () => {
  dom.window.localStorage.clear();
  g.__detalleActionsFake = detalleOk();
  g.__cotizarTarjetaFake = async () => { throw new Error("no debe cotizar sin selección"); };
  const c = await montar();
  await elegirDestino(c);
  await abrirModal(c);
  assert.doesNotMatch(modal(), /Importes calculados|EBB|Long Stay|descuento|promoci|referencia|tu precio/i);
  assert.match(modal(), /desde .*900.000 en doble/);
  assert.match(modal(), /desde .*1.100.000 en doble/);
  assert.equal(etiquetasModal().length, 0);
  await unaDoble();
  await clic([...document.querySelectorAll(".fixed.inset-0 button")].find((b) => /Agregar al carrito/.test(b.textContent ?? ""))!);
  await pausa();
  const [it] = carrito();
  assert.equal(it.precio, 2 * 900_000, "precio publicado de la primera salida");
});

test("porción terrestre: las fechas de la tarjeta llegan al modal, que cotiza solo con la regla vigente", async () => {
  // La tarjeta de porción terrestre solo se ve junto a una búsqueda; se prueba el par tarjeta → modal directamente.
  const { TarjetaHotelConFechas, HotelModal } = await import("../app/tarifario/VistaBooking.tsx");
  const llamadas: unknown[] = [];
  g.__cotizarPorFechasFake = async (i: unknown) => {
    llamadas.push(i);
    return { ok: true, noches: 3, condicion: null, serviciosGrupoPendientes: [], descuentoHotel: EBB, combos: [{ categoria: "Estándar", regimen: "PAE", precios: { doble: 1_000_000 }, preciosMenor2: {} }] };
  };
  const fila = { ...din(0, "", "", 0), modulo: "porcion_terrestre", salida_id: null, bloqueo_label: null, fecha_ida: null, fecha_regreso: null, noches: null };
  const card = { filas: [fila], paqueteId: 54, hotelId: 2540, hotelNombre: "Hotel Nacional 54", destino: "CARTAGENA", foto: null, video_url: null, estrellas: null, clasificacion: null, adultsOnly: false, petFriendly: false, descripcion: null, ubicacion: null, moneda: "COP" };
  const detalle = { estado: "ok", filas: [{ ...fila, acomodacion: "doble", precio_pvp: 900000 }] };
  function Arnes() {
    const [sel, setSel] = React.useState<unknown>(undefined);
    return h(CartProvider, null,
      h(TarjetaHotelConFechas as never, { card, ventana: { min: null, max: null }, onClick: (s: unknown) => setSel(s ?? null), foto: null, hotelNombre: "Hotel Nacional 54", destino: "CARTAGENA", desde: 900000, moneda: "COP" }),
      sel !== undefined ? h(HotelModal as never, { hotel: card, seleccion: sel, detalle, onReintentar() {}, cuposPorBloqueo: {}, origenPorBloqueo: {}, puedeReservar: false, ventanaPorPaquete: {}, planesInfo: {}, cap: { paxMin: null, paxMax: null, acom: [] }, descripcionPorPaquete: {}, addonsPorPaquete: new Map(), onClose() {} }) : null);
  }
  cont = document.createElement("div"); document.body.appendChild(cont); root = createRoot(cont);
  await act(async () => { root!.render(h(Arnes)); });
  const c = cont;
  const poner = async (label: string, v: string) => {
    const el = c.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    assert.ok(el, `falta ${label}`);
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  await poner("Ida", IDA1); await poner("Regreso", REG1);
  await clic(c.querySelector("button.absolute, button[aria-label^=\"Ver opciones\"]")!);
  await pausa();
  assert.equal(llamadas.length, 1, "el modal cotizó solo, sin pedir de nuevo las fechas");
  assert.deepEqual(llamadas[0], { paqueteId: 54, hotelId: 2540, fechaIda: IDA1, fechaRegreso: REG1 });
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta]);
  assert.match(modal(), /Estándar/);
});
