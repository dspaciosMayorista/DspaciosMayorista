// Se ejecuta por comando directo (no está en package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/dinamicoEnPaquetes.react.ts
//
// Los paquetes DINÁMICOS viven dentro de "Paquetes" de Vista Booking (antes solo existían en Vista tabla):
//   · el destino por el que se filtra es el del PAQUETE (el del hotel), no el del vuelo;
//   · no tienen cupos: la tarjeta dice cuántas fechas de salida tiene;
//   · entran a Recomendados como cualquier otra oferta (prioridad del hotel en el paquete);
//   · el modal tiene visual propia (fechas de salida + precios) y "Cotizar" lleva a la ruta de reserva dinámica;
//   · SOLO se ofrecen a quien puede reservar: el carrito público no soporta salidas dinámicas;
//   · con un origen/vuelo elegido en el buscador de Bloqueo, un Dinámico no aplica y se oculta.
// Cada caso se compara contra un Bloqueo de control con el MISMO destino.
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
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { TarifarioPublic } = await import("../app/tarifario/TarifarioPublic.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");
const { claveOferta } = await import("../lib/tarifario/recomendados.ts");

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
  delete (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake;
});
after(() => dom.window.close());

const fecha = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const IDA1 = fecha(30), REG1 = fecha(33), IDA2 = fecha(60), REG2 = fecha(64);

const base = {
  servicio_id: null, servicio_nombre: null, precio_sencilla: null, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null,
  precio_infante: null, descripcion: null, recargo_individual: null, tipo_tarifa: null, moneda: "COP", categoria: "Estándar", regimen: "PAE",
};
// Dinámico NACIONAL (ID 54) con DOS fechas de salida; destino = el del paquete (CARTAGENA).
const din = (salida: number, ida: string, reg: string, noches: number, over: Record<string, unknown> = {}) => ({
  ...base, modulo: "dinamico", paquete_id: 54, paquete_nombre: "Nacional 54", bloqueo_id: null, bloqueo_label: "BOG-CTG", empaquetado_id: null, salida_id: salida,
  hotel_id: 2540, hotel_nombre: "Hotel Nacional 54", destino_id: 7, destino_nombre: "CARTAGENA", fecha_ida: ida, fecha_regreso: reg, noches,
  precio_doble: 900000, desde_adulto: 900000, desde_general: 900000, ...over,
});
const FILAS_DIN = [din(540, IDA1, REG1, 3), din(541, IDA2, REG2, 4, { precio_doble: 1100000, desde_adulto: 1100000, desde_general: 1100000 })];
const BLOQUEO = {
  ...base, modulo: "bloqueo", paquete_id: 11, paquete_nombre: "Bloqueo control", bloqueo_id: 111, bloqueo_label: "BOG-CTG", empaquetado_id: null, salida_id: null,
  hotel_id: 2111, hotel_nombre: "Hotel Control", destino_id: 7, destino_nombre: "CARTAGENA", fecha_ida: IDA1, fecha_regreso: REG1, noches: 3,
  precio_doble: 800000, desde_adulto: 800000, desde_general: 800000,
};

async function montar(filas: unknown[], extra: Record<string, unknown> = {}, puedeReservar = true) {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => {
    root!.render(h(CartProvider, null, h(TarifarioPublic, { filas, programas: [], puedeReservar, cuposPorBloqueo: { 111: 5 }, origenPorBloqueo: { 111: "BOG" }, ...extra } as never)));
  });
  return cont;
}
const texto = (c: HTMLElement) => (c.textContent ?? "").replace(/\s+/g, " ");
const opcionesDestino = (c: HTMLElement) => [...c.querySelectorAll("select")].flatMap((s) => [...s.options].map((o) => o.textContent ?? "")).filter((x) => x === "CARTAGENA" || x === "SAN ANDRES");
async function elegir(c: HTMLElement, etiqueta: string) {
  const sel = [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === etiqueta)) as HTMLSelectElement | undefined;
  assert.ok(sel, `no hay un selector con la opción ${etiqueta}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, etiqueta);
    sel!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}
const listado = (c: HTMLElement) => (texto(c).match(/Hoteles disponibles\s*\(\d+\)/) ?? [""])[0].replace(/\s+/g, "");
const modal = (c: HTMLElement) => (c.querySelector(".fixed.inset-0")?.textContent ?? "").replace(/\s+/g, " ");
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };

test("DESTINO: el selector ofrece el destino del paquete Dinámico y al elegirlo aparece su hotel (igual que el control)", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN]);
  assert.deepEqual([...new Set(opcionesDestino(c))], ["CARTAGENA"]);
  await elegir(c, "CARTAGENA");
  assert.equal(listado(c), "Hotelesdisponibles(2)", "el hotel del Bloqueo y el del Dinámico");
  assert.match(texto(c), /Hotel Control/);
  assert.match(texto(c), /Hotel Nacional 54/);
});

test("DESTINO: un Dinámico solo (sin ningún Bloqueo) también aparece por su destino", async () => {
  const c = await montar(FILAS_DIN);
  assert.deepEqual([...new Set(opcionesDestino(c))], ["CARTAGENA"], "antes de esta tarea el selector quedaba vacío");
  await elegir(c, "CARTAGENA");
  assert.equal(listado(c), "Hotelesdisponibles(1)");
});

test("DESTINO: se filtra por el destino del PAQUETE (hotel), no por dónde aterriza el vuelo", async () => {
  const sanAndres = FILAS_DIN.map((f) => ({ ...f, paquete_id: 55, paquete_nombre: "Otro", hotel_id: 2550, hotel_nombre: "Hotel San Andrés", destino_nombre: "SAN ANDRES", bloqueo_label: "BOG-CTG" }));
  const c = await montar([...FILAS_DIN, ...sanAndres]);
  await elegir(c, "SAN ANDRES");
  assert.match(texto(c), /Hotel San Andrés/);
  assert.doesNotMatch(texto(c), /Hotel Nacional 54/, "el vuelo de ambos es BOG-CTG, pero el destino es el del hotel");
});

test("TARJETA: sin cupos; dice cuántas fechas de salida tiene", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN]);
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /2 fechas de salida/);
  assert.match(texto(c), /5 cupos/, "el Bloqueo de control conserva su insignia de cupos");
  const tarjetaDin = [...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""));
  assert.ok(tarjetaDin);
  assert.doesNotMatch(tarjetaDin!.textContent ?? "", /cupo/i);
});

test("PERMISOS: quien no puede reservar NO ve Dinámicos (el carrito público no los soporta): ni destino ni tarjeta", async () => {
  const c = await montar(FILAS_DIN, {}, false);
  assert.deepEqual(opcionesDestino(c), []);
  const c2 = await montar([BLOQUEO, ...FILAS_DIN], {}, false);
  await elegir(c2, "CARTAGENA");
  assert.match(texto(c2), /Hotel Control/);
  assert.doesNotMatch(texto(c2), /Hotel Nacional 54/);
});

test("ORIGEN/SALIDA de Bloqueo elegidos: el Dinámico no aplica y se oculta; el Bloqueo permanece", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN]);
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Nacional 54/);
  await elegir(c, "BOG"); // cambiar el origen reinicia el destino (comportamiento de Bloqueo)
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Control/);
  assert.doesNotMatch(texto(c), /Hotel Nacional 54/);
});

test("RECOMENDADOS: con prioridad en el paquete, el Dinámico es recomendado como cualquier otra oferta (sin elegir destino)", async () => {
  const sinPrioridad = await montar([BLOQUEO, ...FILAS_DIN], { prioridadesRecomendados: {} });
  assert.doesNotMatch(texto(sinPrioridad), /Hotel Nacional 54/, "sin prioridad no hay recomendados en el estado global");
  await act(async () => { root!.unmount(); }); cont!.remove(); root = null;
  const c = await montar([BLOQUEO, ...FILAS_DIN], { prioridadesRecomendados: { [claveOferta(2540, 54)]: 1, [claveOferta(2111, 11)]: 1 } });
  assert.match(texto(c), /Hotel Control/);
  assert.match(texto(c), /Hotel Nacional 54/, "el Dinámico aparece entre los recomendados igual que el Bloqueo");
  assert.match(texto(c), /Recomendado\s*·?\s*Nacional 54/i);
});

test("MODAL: visual propia — fechas de salida, precios por categoría/acomodación y 'Cotizar' hacia la reserva dinámica", async () => {
  const pedidos: unknown[] = [];
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = {
    obtenerDetalleSalida: async (a: { salidaId: number; combos: Array<Record<string, unknown>> }) => {
      pedidos.push(a);
      const f = FILAS_DIN.find((x) => x.salida_id === a.salidaId)!;
      const fila = (acomodacion: string, precio: number, menor2: number | null = null) => ({ ...f, acomodacion, precio_pvp: precio, precio_pvp_menor2: menor2 });
      return { ok: true, filas: [fila("doble", f.precio_doble), fila("sencilla", f.precio_doble + 300000), fila("nino", 500000), fila("infante", 0, 150000)] };
    },
  };
  const c = await montar([BLOQUEO, ...FILAS_DIN]);
  await elegir(c, "CARTAGENA");
  const tarjeta = [...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""))!;
  await clic(tarjeta);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  assert.equal(pedidos.length, 2, "una consulta acotada por cada fecha de salida de la oferta");
  assert.ok((pedidos as Array<{ combos: Array<{ hotel_id: number }> }>).every((p) => p.combos.every((x) => x.hotel_id === 2540)), "acotadas al hotel de la tarjeta");
  const t = modal(c);
  assert.match(t, /Elige tu fecha de salida/);
  assert.match(t, /Estándar · PAE/);
  assert.match(t, /Infante \(menor de 2 años\)/);
  assert.match(t, /\$\s?150\.000/, "el infante muestra el precio del menor de 2 años");
  assert.doesNotMatch(t, /cupo/i, "un Dinámico no tiene cupos");
  const cotizar = [...c.querySelectorAll("a")].find((a) => /Cotizar esta salida/.test(a.textContent ?? "")) as HTMLAnchorElement | undefined;
  assert.ok(cotizar, "botón Cotizar");
  const href = (a: HTMLAnchorElement) => new URL(a.getAttribute("href")!, "http://x");
  assert.equal(href(cotizar!).pathname, "/dashboard/reservar/nuevo");
  assert.deepEqual([...href(cotizar!).searchParams.entries()].sort(), [["hotel", "2540"], ["modulo", "dinamico"], ["paquete", "54"], ["salida", "540"]]);
  // otra fecha → otra salida
  const segunda = [...c.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "false" && /→/.test(b.textContent ?? ""))!;
  await clic(segunda);
  const cotizar2 = [...c.querySelectorAll("a")].find((a) => /Cotizar esta salida/.test(a.textContent ?? "")) as HTMLAnchorElement;
  assert.equal(href(cotizar2).searchParams.get("salida"), "541");
});

test("MODAL: si el detalle de una salida falla, error con Reintentar (nunca un detalle parcial presentado como completo)", async () => {
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = {
    obtenerDetalleSalida: async (a: { salidaId: number }) => (a.salidaId === 541 ? { ok: false, error: "No fue posible cargar el detalle en este momento." } : { ok: true, filas: [] }),
  };
  // Otro hotel: el detalle ya resuelto se cachea durante la visita (conCacheDetalle) y el caso anterior usa el 2540.
  const falla = FILAS_DIN.map((f) => ({ ...f, hotel_id: 2541, hotel_nombre: "Hotel Falla" }));
  const c = await montar(falla);
  await elegir(c, "CARTAGENA");
  await clic([...c.querySelectorAll("button")].find((b) => /Hotel Falla/.test(b.textContent ?? ""))!);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  assert.match(modal(c), /No fue posible cargar el detalle/, modal(c));
  assert.match(modal(c), /Reintentar/);
  assert.doesNotMatch(modal(c), /Cotizar esta salida/);
});
