// Se ejecuta por comando directo (no está en package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/dinamicoEnPaquetes.react.ts
//
// Los paquetes DINÁMICOS viven dentro de "Paquetes" de Vista Booking (antes solo existían en Vista tabla):
//   · el destino por el que se filtra es el del PAQUETE (el del hotel), no el del vuelo;
//   · no tienen cupos: la tarjeta dice cuántas fechas de salida tiene;
//   · entran a Recomendados como cualquier otra oferta (prioridad del hotel en el paquete);
//   · el modal tiene visual propia (fechas de salida + precios) y "Cotizar" lleva a la ruta de reserva dinámica;
//   · el "desde" (tarjeta y cada salida) toma como referencia la acomodación DOBLE, aunque haya una sencilla más barata;
//   · los ve TODO el mundo y todos (con o sin sesión, sin permiso especial) cotizan la salida por el carrito público (mismo flujo
//     de Bloqueo: carrito → /tarifario/checkout); el permiso de reservar solo agrega "Cotizar esta salida" (reservar/nuevo).
//     La interfaz no recibe la sesión: una cuenta sin permiso se ve exactamente como el visitante (puedeReservar = false);
//   · con un origen elegido, el Dinámico se ve solo si alguna de SUS salidas sale de ese origen (origen real de la salida);
//     con un vuelo (record) de Bloqueo elegido, no aplica.
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
// El carrito (CartContext) persiste en el `localStorage` global: el de JSDOM, para poder leer lo que agregó el visitante.
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
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
  // La SENCILLA es más barata que la DOBLE: el "desde" no debe tomarla (referencia = doble).
  precio_sencilla: 700000, precio_doble: 900000, desde_adulto: 700000, desde_general: 700000, ...over,
});
const FILAS_DIN = [
  din(540, IDA1, REG1, 3),
  din(541, IDA2, REG2, 4, { precio_sencilla: 1000000, precio_doble: 1100000, desde_adulto: 1000000, desde_general: 1000000 }),
];
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

test("VISIBILIDAD PÚBLICA: sin puedeReservar el Dinámico aparece en Paquetes y por destino, igual que el Bloqueo de control", async () => {
  const c = await montar(FILAS_DIN, {}, false);
  assert.deepEqual([...new Set(opcionesDestino(c))], ["CARTAGENA"], "el visitante también ve el destino del Dinámico");
  const c2 = await montar([BLOQUEO, ...FILAS_DIN], {}, false);
  await elegir(c2, "CARTAGENA");
  assert.equal(listado(c2), "Hotelesdisponibles(2)");
  assert.match(texto(c2), /Hotel Control/);
  assert.match(texto(c2), /Hotel Nacional 54/);
});

async function abrirDinamico(c: HTMLElement) {
  await elegir(c, "CARTAGENA");
  await clic([...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""))!);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
}
const detalleOk = () => ({
  obtenerDetalleSalida: async (a: { salidaId: number }) => {
    const f = FILAS_DIN.find((x) => x.salida_id === a.salidaId)!;
    return { ok: true, filas: [{ ...f, acomodacion: "doble", precio_pvp: f.precio_doble }, { ...f, acomodacion: "sencilla", precio_pvp: f.precio_sencilla }] };
  },
});
const enlacesReserva = (c: HTMLElement) => [...c.querySelectorAll("a")].filter((a) => (a.getAttribute("href") ?? "").includes("/dashboard/reservar/nuevo"));

const carrito = () => JSON.parse(dom.window.localStorage.getItem("dspacios_cart_v1") ?? "[]") as Record<string, unknown>[];
async function ponerHabitaciones(c: HTMLElement, acom: string, n: number) {
  const caja = [...c.querySelectorAll(".fixed.inset-0 div.rounded-lg.border")].find((d) => d.firstElementChild?.textContent === acom);
  const input = caja?.querySelector("input") as HTMLInputElement | undefined;
  assert.ok(input, `no hay campo de habitaciones ${acom}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, String(n));
    input!.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("COTIZACIÓN B2C sin sesión: el visitante cotiza la salida por el carrito público, sin /login ni rutas con sesión, conservando paquete/hotel/salida/precio/acomodación", async () => {
  dom.window.localStorage.clear();
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar(FILAS_DIN.map((f) => ({ ...f, hotel_id: 2545 })), {}, false);
  await abrirDinamico(c);
  const m = modal(c);
  assert.match(m, /Elige tu fecha de salida/);
  assert.match(m, /Estándar · PAE/);
  assert.doesNotMatch(m, /Ingresar al portal/, "ya no se le pide entrar al portal");
  assert.ok(![...c.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/login"));
  assert.deepEqual(enlacesReserva(c), [], "ninguna ruta que exija sesión");
  // Segunda fecha de salida (541): doble a 1.100.000/pers.
  await clic([...c.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "false" && /→/.test(b.textContent ?? ""))!);
  await ponerHabitaciones(c, "Doble", 1);
  const agregar = [...c.querySelectorAll(".fixed.inset-0 button")].find((b) => /Agregar al carrito/.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
  assert.ok(agregar, "el visitante tiene el botón del carrito público");
  assert.equal(agregar!.disabled, false);
  await clic(agregar!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const [it] = carrito();
  assert.ok(it, "la salida quedó en el carrito público (de ahí sigue a /tarifario/checkout, que no exige sesión)");
  assert.equal(modal(c), "", "el modal se cierra al agregar, como en Bloqueo");
  assert.equal(it.tipo, "hotel");
  assert.equal(it.modulo, "dinamico");
  assert.equal(it.paqueteId, 54);
  assert.equal(it.hotelId, 2545);
  assert.equal(it.salidaId, 541, "la fecha de salida elegida");
  assert.equal(it.bloqueoId, null);
  assert.equal(it.fechaIda, IDA2);
  assert.equal(it.fechaRegreso, REG2);
  assert.equal(it.categoria, "Estándar");
  assert.equal(it.regimen, "PAE");
  assert.deepEqual(it.habitaciones, { doble: 1 });
  assert.equal(it.precio, 2 * 1_100_000, "precio de la doble de ESA salida × 2 pax");
});

test("COTIZACIÓN con permiso de reservar: conserva 'Cotizar esta salida' y también puede usar el carrito", async () => {
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar(FILAS_DIN.map((f) => ({ ...f, hotel_id: 2546 })));
  await abrirDinamico(c);
  assert.equal(enlacesReserva(c).length, 1);
  assert.ok([...c.querySelectorAll(".fixed.inset-0 button")].some((b) => /Agregar al carrito/.test(b.textContent ?? "")));
});

test("COTIZACIÓN B2C con sesión pero SIN permiso de reservar: usa el carrito público igual que el visitante (el permiso solo abre reservar/nuevo)", async () => {
  dom.window.localStorage.clear();
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  // Cuenta autenticada sin permiso: la página le pasa puedeReservar = false (la sesión no es entrada de la interfaz). Su lado
  // servidor (checkout con sesión cliente_final) está en pruebas/dinamicoCheckout.test.ts.
  const c = await montar(FILAS_DIN.map((f) => ({ ...f, hotel_id: 2542, hotel_nombre: "Hotel Nacional 54" })), {}, false);
  await abrirDinamico(c);
  assert.doesNotMatch(modal(c), /no tiene permiso/i, "ya no se le bloquea la cotización pública");
  assert.deepEqual(enlacesReserva(c), [], "sin permiso de reservar no recibe la ruta interna");
  assert.ok(![...c.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/login"));
  await ponerHabitaciones(c, "Doble", 1);
  await clic([...c.querySelectorAll(".fixed.inset-0 button")].find((b) => /Agregar al carrito/.test(b.textContent ?? ""))!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const [it] = carrito();
  assert.ok(it, "la salida llegó al carrito público");
  assert.equal(it.modulo, "dinamico");
  assert.equal(it.salidaId, 540);
  assert.equal(it.hotelId, 2542);
  assert.deepEqual(it.habitaciones, { doble: 1 });
  assert.equal(it.precio, 2 * 900_000);
});

test("DESDE = DOBLE: la tarjeta y cada salida del modal toman la doble aunque exista una sencilla más barata", async () => {
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar(FILAS_DIN.map((f) => ({ ...f, hotel_id: 2543, hotel_nombre: "Hotel Nacional 54" })));
  await elegir(c, "CARTAGENA");
  const tarjeta = [...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""))!;
  assert.match(tarjeta.textContent ?? "", /900\.000/, "la tarjeta muestra el menor valor DOBLE de sus salidas");
  assert.doesNotMatch(tarjeta.textContent ?? "", /700\.000/, "no toma la sencilla (700.000), aunque sea más barata");
  await clic(tarjeta);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  const chips = [...c.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].map((b) => (b.textContent ?? "").replace(/\s+/g, " "));
  assert.equal(chips.length, 2);
  assert.match(chips[0], /desde \$\s?900\.000 en doble/);
  assert.match(chips[1], /desde \$\s?1\.100\.000 en doble/);
  assert.ok(chips.every((x) => !/700\.000|1\.000\.000/.test(x)), "ningún chip toma la sencilla");
  assert.match(modal(c), /\$\s?700\.000/, "la sencilla sí aparece en la tabla de precios");
});

test("ORIGEN sin dato real de la salida: el Dinámico no se atribuye ese origen y se oculta; el Bloqueo permanece", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN]);
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Nacional 54/);
  await elegir(c, "BOG"); // cambiar el origen reinicia el destino (comportamiento de Bloqueo)
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Control/);
  assert.doesNotMatch(texto(c), /Hotel Nacional 54/);
});

// Hallazgo de la prueba humana (ID 54): el destino aparecía al inicio pero desaparecía al elegir Origen.
const ORIGEN_REAL = { origenPorSalida: { 540: "BOG", 541: "MDE" } };
const opcionesDe = (c: HTMLElement, etiqueta: string) => {
  const sel = [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === etiqueta));
  return sel ? [...sel.options].map((o) => o.textContent ?? "") : [];
};
test("ORIGEN → DESTINO → TARJETA 54: con el origen REAL de la salida, el destino sigue en el selector y la tarjeta muestra solo la salida de ese origen (desde DOBLE)", async () => {
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2547 }))], ORIGEN_REAL);
  assert.ok(opcionesDe(c, "BOG").includes("MDE"), "el origen real de la salida 541 (sin bloqueo propio) también se ofrece");
  await elegir(c, "BOG");
  assert.ok(opcionesDe(c, "CARTAGENA").includes("CARTAGENA"), "el destino del 54 sigue en el selector tras elegir Origen");
  await elegir(c, "CARTAGENA");
  assert.equal(listado(c), "Hotelesdisponibles(2)");
  const tarjeta = [...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""));
  assert.ok(tarjeta, "la tarjeta del 54 aparece con Origen BOG");
  assert.match(tarjeta!.textContent ?? "", /1 fecha de salida/, "solo la salida que sale de BOG");
  assert.match(tarjeta!.textContent ?? "", /900\.000/, "desde = DOBLE de la salida de BOG");
  assert.doesNotMatch(tarjeta!.textContent ?? "", /700\.000/, "nunca la sencilla");
  await clic(tarjeta!);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  const chips = [...c.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].map((b) => (b.textContent ?? "").replace(/\s+/g, " "));
  assert.equal(chips.length, 1, "el modal no ofrece la salida de otro origen");
  assert.match(chips[0], /desde \$\s?900\.000 en doble/);
});

test("ORIGEN de solo-Dinámico (MDE): su destino y su tarjeta aparecen con la salida de MDE; el Bloqueo (BOG) no", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2548 }))], ORIGEN_REAL);
  await elegir(c, "MDE");
  assert.ok(opcionesDe(c, "CARTAGENA").includes("CARTAGENA"));
  await elegir(c, "CARTAGENA");
  assert.equal(listado(c), "Hotelesdisponibles(1)");
  assert.doesNotMatch(texto(c), /Hotel Control/);
  const tarjeta = [...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""))!;
  assert.match(tarjeta.textContent ?? "", /1 fecha de salida/);
  assert.match(tarjeta.textContent ?? "", /1\.100\.000/, "desde = DOBLE de la salida de MDE");
});

test("VUELO (record) de Bloqueo elegido: el Dinámico no aplica aunque su salida salga del mismo origen", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2549 }))], ORIGEN_REAL);
  await elegir(c, "BOG");
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Nacional 54/);
  const selVuelo = [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "111"));
  assert.ok(selVuelo, "selector de vuelo de Bloqueo");
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(selVuelo, "111");
    selVuelo!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
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
      return { ok: true, filas: [fila("doble", f.precio_doble), fila("sencilla", f.precio_sencilla), fila("nino", 500000), fila("infante", 0, 150000)] };
    },
  };
  // Hotel propio: el detalle ya resuelto se cachea durante la visita (conCacheDetalle) y otros casos abren el 2540.
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2544 }))]);
  await elegir(c, "CARTAGENA");
  const tarjeta = [...c.querySelectorAll("button")].find((b) => /Hotel Nacional 54/.test(b.textContent ?? ""))!;
  await clic(tarjeta);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  assert.equal(pedidos.length, 2, "una consulta acotada por cada fecha de salida de la oferta");
  assert.ok((pedidos as Array<{ combos: Array<{ hotel_id: number }> }>).every((p) => p.combos.every((x) => x.hotel_id === 2544)), "acotadas al hotel de la tarjeta");
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
  assert.deepEqual([...href(cotizar!).searchParams.entries()].sort(), [["hotel", "2544"], ["modulo", "dinamico"], ["paquete", "54"], ["salida", "540"]]);
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
