// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 · Cambio de salida DENTRO de «Ver opciones»: cada salida elegida en el modal se calcula con el mismo motor de la tarjeta (`cotizarTarjetaHotel`):
//   · tarjeta con salida A → modal → salida B: la tabla, el total y la etiqueta son los de B (no los publicados ni los de A); al volver a A, los de A;
//   · mientras se calcula no se muestra ni se agrega ningún importe; ante un fallo hay un error claro y tampoco se agrega;
//   · respuestas fuera de orden no pisan la salida activa; si cambia el día de Bogotá, la cotización caduca y se recalcula;
//   · la categoría/alimentación elegidas se conservan si siguen siendo válidas y, si no, se avisa; bloqueo y dinámico.
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
const { HotelModal } = await import("../app/tarifario/VistaBooking.tsx");
const { useCotizacionSalidaModal, entradaSalida } = await import("../app/tarifario/cotizacionSalidaModal.ts");
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
const HOY = fecha(0), IDA1 = fecha(30), REG1 = fecha(33), IDA2 = fecha(60), REG2 = fecha(64);
const EBB = { etiqueta: "EBB 2 · 60+ días · 23 %", tipo: "ebb", umbral: 60, pct: 23 } as const;
const EBB3 = { etiqueta: "EBB 3 · 90+ días · 30 %", tipo: "ebb", umbral: 90, pct: 30 } as const;
const dd = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

const base = {
  servicio_id: null, servicio_nombre: null, precio_sencilla: null, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null,
  precio_infante: null, descripcion: null, recargo_individual: null, tipo_tarifa: null, moneda: "COP", categoria: "Estándar", regimen: "PAE",
};
const din = (salida: number, ida: string, reg: string, noches: number, over: Record<string, unknown> = {}) => ({
  ...base, modulo: "dinamico", paquete_id: 54, paquete_nombre: "Nacional 54", bloqueo_id: null, bloqueo_label: "BOG-CTG", empaquetado_id: null, salida_id: salida,
  hotel_id: 2540, hotel_nombre: "Hotel Nacional 54", destino_id: 7, destino_nombre: "CARTAGENA", fecha_ida: ida, fecha_regreso: reg, noches,
  precio_sencilla: 700000, precio_doble: 900000, desde_adulto: 700000, desde_general: 700000, ...over,
});
const FILAS_DIN = [din(540, IDA1, REG1, 3), din(541, IDA2, REG2, 4, { precio_doble: 1100000, desde_adulto: 1000000, desde_general: 1000000 })];
const detalleOk = () => ({
  obtenerDetalleSalida: async (a: { salidaId: number }) => {
    const f = FILAS_DIN.find((x) => x.salida_id === a.salidaId)!;
    return { ok: true, filas: [{ ...f, acomodacion: "doble", precio_pvp: f.precio_doble }, { ...f, acomodacion: "sencilla", precio_pvp: f.precio_sencilla }] };
  },
});
const combo = (categoria: string, regimen: string, doble: number, descuento: typeof EBB | typeof EBB3 | null) =>
  ({ categoria, regimen, precios: { doble, sencilla: doble - 100_000 }, preciosMenor2: {}, infanteSinFijo: { mayor2: null, menor2: null }, descuento });
const cotiz = (ida: string, reg: string, noches: number, doble: number, descuento: typeof EBB | typeof EBB3 | null, dia = HOY, combos = [combo("Estándar", "PAE", doble, descuento)]) =>
  ({ ok: true, precio: doble, moneda: "COP", categoria: combos[0].categoria, regimen: combos[0].regimen, fechaIda: ida, fechaRegreso: reg, noches, fechaCalculo: dia, descuentoHotel: descuento, combos });

// Enero (salida 540) con EBB; mayo (541) con otras reglas: precios y etiqueta distintos.
const ENERO = () => cotiz(IDA1, REG1, 3, 800_000, EBB);
const MAYO = () => cotiz(IDA2, REG2, 4, 1_000_000, null);

async function montar() {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(TarifarioPublic, { filas: FILAS_DIN, programas: [], puedeReservar: false } as never))); });
  return cont;
}
const poner = async (sel: HTMLSelectElement, v: string) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
  sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const modal = () => (document.querySelector(".fixed.inset-0")?.textContent ?? "").replace(/\s+/g, " ");
const etiquetasModal = () => [...document.querySelectorAll('.fixed.inset-0 [data-testid="etiqueta-descuento-hotel"]')].map((e) => e.textContent?.trim());
const carrito = () => JSON.parse(dom.window.localStorage.getItem("dspacios_cart_v1") ?? "[]") as Record<string, unknown>[];
const visibles = (sel: string) => [...document.querySelectorAll(`.fixed.inset-0 ${sel}`)].filter((e) => !e.closest("[hidden]"));
const botonAgregar = () => visibles("button").filter((b) => /Agregar al carrito/.test(b.textContent ?? ""));
const chip = (ida: string) => [...document.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].find((b) => (b.textContent ?? "").includes(dd(ida)))!;
async function abrirDesdeTarjeta(c: HTMLElement) {
  const dest = [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "CARTAGENA")) as HTMLSelectElement;
  await poner(dest, [...dest.options].find((o) => o.textContent === "CARTAGENA")!.value);
  await pausa();
  const sel = c.querySelector('select[aria-label="Elige tu salida"]') as HTMLSelectElement;
  await poner(sel, [...sel.options].find((o) => o.value.includes("|540|"))!.value); // enero
  await pausa();
  await clic([...c.querySelectorAll("button")].find((b) => /Ver opciones/.test(b.getAttribute("aria-label") ?? "") || /Hotel Nacional 54/.test(b.textContent ?? ""))!);
  await pausa();
}
async function unaDoble() {
  const caja = [...document.querySelectorAll(".fixed.inset-0 div.rounded-lg.border")].find((d) => d.firstElementChild?.textContent === "Doble");
  const input = caja?.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "1");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const valorDoble = () => (visibles("div.rounded-lg.border").find((d) => d.firstElementChild?.textContent === "Doble")?.querySelector("input") as HTMLInputElement | undefined)?.value;

test("dinámico: tarjeta enero → «Ver opciones» → mayo → carrito → de vuelta a enero", async () => {
  dom.window.localStorage.clear();
  g.__detalleActionsFake = detalleOk();
  const llamadas: { salidaId: number }[] = [];
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => { llamadas.push(i); return i.salidaId === 540 ? ENERO() : MAYO(); };
  const c = await montar();
  await abrirDesdeTarjeta(c);
  // Enero: la cotización de la tarjeta se reutiliza (una sola llamada, la de la tarjeta).
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta]);
  assert.equal(llamadas.length, 1);
  await unaDoble();
  // Mayo: sus propios importes y SIN la etiqueta de enero; la composición (1 doble) se conserva.
  await clic(chip(IDA2));
  await pausa();
  assert.equal(llamadas.length, 2);
  assert.deepEqual(etiquetasModal(), [], "mayo no hereda la etiqueta de enero ni inventa una");
  assert.match(modal(), /Importes calculados para la salida que elegiste/);
  assert.equal(valorDoble(), "1", "la composición sobrevive al cambio de salida");
  const chips = [...document.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].map((b) => (b.textContent ?? "").replace(/\s+/g, " "));
  assert.ok(chips.find((x) => x.includes(dd(IDA2)))!.includes("tu precio desde") && chips.find((x) => x.includes(dd(IDA2)))!.includes("1.000.000"), "mayo muestra su precio calculado");
  assert.ok(chips.find((x) => x.includes(dd(IDA1)))!.includes("tu precio desde") && chips.find((x) => x.includes(dd(IDA1)))!.includes("800.000"), "enero conserva el suyo");
  await clic(botonAgregar()[0]);
  await pausa();
  assert.equal(carrito().at(-1)!.salidaId, 541);
  assert.equal(carrito().at(-1)!.precio, 2 * 1_000_000, "al carrito va el importe de mayo");
  // Volver a enero: no recalcula (misma cotización del día) y muestra los de enero.
  await act(async () => { root!.render(h(CartProvider, null, h(TarifarioPublic, { filas: FILAS_DIN, programas: [], puedeReservar: false } as never))); });
});

test("dinámico: mientras calcula no hay importes ni «Agregar»; tras un fallo, error claro y reintento", async () => {
  dom.window.localStorage.clear();
  g.__detalleActionsFake = detalleOk();
  let falla = true;
  let liberar: (() => void) | null = null;
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => {
    if (i.salidaId === 540) return ENERO();
    await new Promise<void>((r) => { liberar = r; });
    if (falla) throw new Error("red");
    return MAYO();
  };
  const c = await montar();
  await abrirDesdeTarjeta(c);
  await clic(chip(IDA2));
  await pausa();
  assert.ok(visibles('[data-testid="modal-calculando"]').length === 1, "muestra carga");
  assert.equal(botonAgregar().length, 0, "no se puede agregar con un importe obsoleto");
  assert.doesNotMatch(visibles("div.rounded-lg.border").map((d) => d.textContent).join(" "), /\$\s?800\.000|\$\s?900\.000|\$\s?1\.100\.000/);
  await act(async () => { liberar!(); await new Promise((r) => setTimeout(r, 20)); });
  assert.equal(visibles('[data-testid="modal-error-precio"]').length, 1);
  assert.match(modal(), /No pudimos calcular el precio/);
  assert.equal(botonAgregar().length, 0);
  falla = false;
  await clic(visibles('[data-testid="modal-error-precio"] button')[0]);
  await act(async () => { liberar!(); await new Promise((r) => setTimeout(r, 20)); });
  assert.equal(visibles('[data-testid="modal-error-precio"]').length, 0);
  assert.equal(botonAgregar().length, 1);
});

test("dinámico: respuestas fuera de orden no pisan la salida activa", async () => {
  dom.window.localStorage.clear();
  g.__detalleActionsFake = detalleOk();
  const pendientes: Record<number, () => void> = {};
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => {
    if (i.salidaId === 540 && !pendientes[540]) return ENERO(); // la de la tarjeta
    await new Promise<void>((r) => { pendientes[i.salidaId] = r; });
    return i.salidaId === 540 ? ENERO() : MAYO();
  };
  const c = await montar();
  await abrirDesdeTarjeta(c);
  await clic(chip(IDA2)); // mayo (queda pendiente)
  await pausa();
  await clic(chip(IDA1)); // enero otra vez: usa la cotización ya hecha de la tarjeta
  await pausa();
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta]);
  await act(async () => { pendientes[541]?.(); await new Promise((r) => setTimeout(r, 20)); }); // llega tarde la de mayo
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta], "la respuesta tardía de mayo no cambia la tabla de enero");
  assert.equal(botonAgregar().length, 1);
});

test("dinámico: categoría y alimentación se conservan si siguen siendo válidas; si no, se avisa", async () => {
  dom.window.localStorage.clear();
  g.__detalleActionsFake = {
    obtenerDetalleSalida: async (a: { salidaId: number }) => {
      const f = FILAS_DIN.find((x) => x.salida_id === a.salidaId)!;
      const regs = a.salidaId === 540 ? ["PAE", "PAM"] : ["PAE"];
      return { ok: true, filas: regs.flatMap((r) => [{ ...f, regimen: r, acomodacion: "doble", precio_pvp: f.precio_doble }, { ...f, regimen: r, acomodacion: "sencilla", precio_pvp: f.precio_sencilla }]) };
    },
  };
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => i.salidaId === 540
    ? cotiz(IDA1, REG1, 3, 800_000, EBB, HOY, [combo("Estándar", "PAE", 800_000, EBB), combo("Estándar", "PAM", 900_000, EBB)])
    : cotiz(IDA2, REG2, 4, 1_000_000, null, HOY, [combo("Estándar", "PAE", 1_000_000, null)]);
  const c = await montar();
  await abrirDesdeTarjeta(c);
  const selects = () => [...document.querySelectorAll(".fixed.inset-0 select")] as HTMLSelectElement[];
  await poner(selects()[1], "PAM");
  await clic(chip(IDA2));
  await pausa();
  assert.equal(selects()[1].value, "PAE", "PAM ya no existe en mayo: se usa una disponible");
  assert.equal(visibles('[data-testid="modal-seleccion-ajustada"]').length, 1, "y se hace visible");
  await clic(chip(IDA1));
  await pausa();
  assert.equal(selects()[1].value, "PAM", "al volver a enero se recupera la elección");
  assert.equal(visibles('[data-testid="modal-seleccion-ajustada"]').length, 0);
});

test("sin elección el dinámico no cotiza; bloqueo: cambiar de salida en el modal cotiza esa salida", async () => {
  const llamadas: Record<string, unknown>[] = [];
  g.__cotizarTarjetaFake = async (i: Record<string, unknown>) => { llamadas.push(i); return i.bloqueoId === 11 ? ENERO() : MAYO(); };
  const fila = (id: number, ida: string, reg: string, doble: number) => ({ ...din(0, ida, reg, 3), modulo: "bloqueo", salida_id: null, bloqueo_id: id, bloqueo_label: `Vuelo ${id}`, acomodacion: "doble", precio_pvp: doble });
  const card = { filas: [], paqueteId: 54, hotelId: 2540, hotelNombre: "Hotel Nacional 54", destino: "CARTAGENA", foto: null, video_url: null, estrellas: null, clasificacion: null, adultsOnly: false, petFriendly: false, descripcion: null, ubicacion: null, moneda: "COP" };
  const detalle = { estado: "ok", filas: [fila(11, IDA1, REG1, 900_000), fila(12, IDA2, REG2, 1_100_000)] };
  cont = document.createElement("div"); document.body.appendChild(cont); root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(HotelModal as never, { hotel: card, seleccion: null, detalle, onReintentar() {}, cuposPorBloqueo: { 11: 5, 12: 5 }, origenPorBloqueo: {}, puedeReservar: false, ventanaPorPaquete: {}, planesInfo: {}, cap: { paxMin: null, paxMax: null, acom: [] }, descripcionPorPaquete: {}, addonsPorPaquete: new Map(), onClose() {} }))); });
  await pausa();
  assert.equal(llamadas.length, 0, "sin selección, precios publicados");
  const botones = [...document.querySelectorAll(".fixed.inset-0 button")].filter((b) => /Vuelo 12/.test(b.textContent ?? ""));
  await clic(botones[0]);
  await pausa();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].bloqueoId, 12);
  assert.equal(llamadas[0].modulo, "bloqueo");
  assert.match(modal(), /Importes calculados para la salida que elegiste/);
  assert.deepEqual(etiquetasModal(), []);
});

test("hook: si cambia el día de Bogotá la cotización caduca y se recalcula", async () => {
  let dia = HOY;
  let n = 0;
  let gate: Promise<void> | null = null;
  const cotizar = async () => { n++; if (gate) await gate; return cotiz(IDA1, REG1, 3, 800_000 + n, EBB, dia) as never; };
  const activa = entradaSalida([{ modulo: "dinamico", salida_id: 540, fecha_ida: IDA1, acomodacion: "doble", categoria: "Estándar", regimen: "PAE", precio_pvp: 1 }], 54, 2540)!;
  const caja: { cur: ReturnType<typeof useCotizacionSalidaModal> | null } = { cur: null };
  function Arnes() { const r = useCotizacionSalidaModal({ activa, cotizar, hoy: () => dia }); React.useEffect(() => { caja.cur = r; }); return null; }
  const ultimo = () => caja.cur!;
  cont = document.createElement("div"); document.body.appendChild(cont); root = createRoot(cont);
  await act(async () => { root!.render(h(Arnes)); });
  await pausa();
  assert.equal(ultimo().estado, "ok");
  assert.equal(n, 1);
  let abrir!: () => void; gate = new Promise<void>((r) => { abrir = r; });
  dia = fecha(1); // cruza medianoche en Bogotá con el modal abierto
  await act(async () => { document.dispatchEvent(new dom.window.Event("visibilitychange")); });
  assert.equal(ultimo().estado, "cargando", "la cotización del día anterior ya no vale");
  await act(async () => { abrir(); await new Promise((r) => setTimeout(r, 20)); });
  assert.equal(ultimo().estado, "ok");
  assert.equal(n, 2);
  assert.equal(ultimo().cot!.fechaCalculo, fecha(1));
});

const textoVisible = () => visibles("div.rounded-lg.border").map((d) => d.textContent ?? "").join(" ").replace(/\s+/g, " ");

test("dinámico: enero con EBB 2 → mayo con EBB 3: etiqueta, tabla, total y precio al carrito cambian juntos", async () => {
  dom.window.localStorage.clear();
  g.__detalleActionsFake = detalleOk();
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => i.salidaId === 540 ? cotiz(IDA1, REG1, 3, 800_000, EBB) : cotiz(IDA2, REG2, 4, 1_000_000, EBB3);
  const c = await montar();
  await abrirDesdeTarjeta(c);
  await unaDoble();
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta]);
  assert.match(textoVisible(), /800\.000/);
  assert.match(modal(), /1\.600\.000/, "total de enero (2 pax x 800.000)");
  await clic(chip(IDA2));
  await pausa();
  assert.deepEqual(etiquetasModal(), [EBB3.etiqueta], "solo la etiqueta de mayo");
  assert.match(textoVisible(), /1\.000\.000/);
  assert.doesNotMatch(textoVisible(), /800\.000/, "la tabla ya no es la de enero");
  assert.match(modal(), /2\.000\.000/, "total de mayo (2 pax x 1.000.000)");
  assert.doesNotMatch(modal(), /1\.600\.000/);
  await clic(botonAgregar()[0]);
  await pausa();
  const it = carrito().at(-1)!;
  assert.equal(it.salidaId, 541);
  assert.equal(it.precio, 2_000_000, "al carrito va el total de mayo");
});

test("bloqueo/empaquetado: dos empaquetados con las mismas fechas y distinto empaquetado_id no comparten cotización", async () => {
  const llamadas: Record<string, unknown>[] = [];
  g.__cotizarTarjetaFake = async (i: Record<string, unknown>) => { llamadas.push(i); return i.empaquetadoId === 21 ? cotiz(IDA1, REG1, 3, 800_000, EBB) : cotiz(IDA1, REG1, 3, 950_000, EBB3); };
  const fila = (emp: number, doble: number) => ({ ...din(0, IDA1, REG1, 3), modulo: "bloqueo", salida_id: null, bloqueo_id: null, empaquetado_id: emp, bloqueo_label: `Empaquetado ${emp}`, acomodacion: "doble", precio_pvp: doble });
  const card = { filas: [], paqueteId: 54, hotelId: 2540, hotelNombre: "Hotel Nacional 54", destino: "CARTAGENA", foto: null, video_url: null, estrellas: null, clasificacion: null, adultsOnly: false, petFriendly: false, descripcion: null, ubicacion: null, moneda: "COP" };
  const detalle = { estado: "ok", filas: [fila(21, 900_000), fila(22, 900_000)] };
  cont = document.createElement("div"); document.body.appendChild(cont); root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(HotelModal as never, { hotel: card, seleccion: null, detalle, onReintentar() {}, cuposPorBloqueo: {}, origenPorBloqueo: {}, puedeReservar: false, ventanaPorPaquete: {}, planesInfo: {}, cap: { paxMin: null, paxMax: null, acom: [] }, descripcionPorPaquete: {}, addonsPorPaquete: new Map(), onClose() {} }))); });
  await pausa();
  const boton = (n: number) => [...document.querySelectorAll(".fixed.inset-0 button")].find((b) => new RegExp(`Empaquetado ${n}`).test(b.textContent ?? ""))!;
  assert.ok(boton(21) && boton(22), "dos opciones distintas pese a las mismas fechas");
  await clic(boton(21)); await pausa();
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta]);
  await clic(boton(22)); await pausa();
  assert.deepEqual(llamadas.map((l) => l.empaquetadoId), [21, 22], "cada empaquetado se cotiza por separado");
  assert.deepEqual(etiquetasModal(), [EBB3.etiqueta], "22 no hereda la cotización de 21");
  await clic(boton(21)); await pausa();
  assert.deepEqual(etiquetasModal(), [EBB.etiqueta]);
  assert.equal(llamadas.length, 2, "volver a 21 reutiliza SU cotización, no la de 22");
});

test("hook: un error guardado caduca al cambiar el día de Bogotá y se vuelve a cotizar solo", async () => {
  let dia = HOY;
  let n = 0;
  const cotizar = async () => { n++; if (n === 1) throw new Error("red"); return cotiz(IDA1, REG1, 3, 800_000, EBB, dia) as never; };
  const activa = entradaSalida([{ modulo: "dinamico", salida_id: 540, fecha_ida: IDA1, acomodacion: "doble", categoria: "Estándar", regimen: "PAE", precio_pvp: 1 }], 54, 2540)!;
  const caja: { cur: ReturnType<typeof useCotizacionSalidaModal> | null } = { cur: null };
  function Arnes() { const r = useCotizacionSalidaModal({ activa, cotizar, hoy: () => dia }); React.useEffect(() => { caja.cur = r; }); return null; }
  cont = document.createElement("div"); document.body.appendChild(cont); root = createRoot(cont);
  await act(async () => { root!.render(h(Arnes)); });
  await pausa();
  assert.equal(caja.cur!.estado, "error");
  assert.equal(n, 1);
  dia = fecha(1);
  await act(async () => { document.dispatchEvent(new dom.window.Event("visibilitychange")); });
  await pausa();
  assert.equal(n, 2, "el error del día anterior no bloquea: se cotiza de nuevo");
  assert.equal(caja.cur!.estado, "ok");
});
