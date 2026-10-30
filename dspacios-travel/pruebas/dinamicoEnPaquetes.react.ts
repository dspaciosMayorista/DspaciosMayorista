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
    // El selector de Origen muestra la ciudad (etiqueta) y guarda su clave canónica en `value`.
    const valor = [...sel!.options].find((o) => o.textContent === etiqueta)!.value;
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
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
  assert.ok(opcionesDe(c, "Estándar").includes("Estándar"), "el cotizador ofrece la categoría de la salida");
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
  assert.match(modal(c), /\$\s?700\.000\/pers/, "la sencilla sí aparece, como precio por persona en el cotizador");
});

test("ORIGEN sin dato real de la salida: el Dinámico no se atribuye ese origen y se oculta; el Bloqueo permanece", async () => {
  const c = await montar([BLOQUEO, ...FILAS_DIN]);
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Nacional 54/);
  await elegir(c, "BOGOTÁ"); // cambiar el origen reinicia el destino (comportamiento de Bloqueo)
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
test("ORIGEN unificado: MDE (salida dinámica) y MEDELLÍN (bloqueo) son UNA sola opción «Medellín»; elegirla conserva ambas fuentes y un origen sin catálogo sigue separado", async () => {
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2547 }))], { origenPorBloqueo: { 111: "MEDELLÍN" }, origenPorSalida: { 540: "MDE", 541: "TUMACO" } });
  const sel = [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "MEDELLÍN"))!;
  const etiquetas = [...sel.options].map((o) => o.textContent);
  assert.deepEqual(etiquetas, ["Todos", "MEDELLÍN", "TUMACO"], "sin MDE ni MEDELLÍN duplicados; TUMACO (fuera del catálogo) no se mezcla");
  assert.equal([...sel.options].find((o) => o.textContent === "MEDELLÍN")!.value, "MDE");
  await elegir(c, "MEDELLÍN");
  assert.ok(opcionesDe(c, "CARTAGENA").includes("CARTAGENA"), "el destino de ambas fuentes sigue disponible");
});
test("ORIGEN → DESTINO → TARJETA 54: con el origen REAL de la salida, el destino sigue en el selector y la tarjeta muestra solo la salida de ese origen (desde DOBLE)", async () => {
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2547 }))], ORIGEN_REAL);
  assert.ok(opcionesDe(c, "BOGOTÁ").includes("MEDELLÍN"), "el origen real de la salida 541 (sin bloqueo propio) también se ofrece");
  await elegir(c, "BOGOTÁ");
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
  await elegir(c, "MEDELLÍN");
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
  await elegir(c, "BOGOTÁ");
  await elegir(c, "CARTAGENA");
  assert.match(texto(c), /Hotel Nacional 54/);
  await elegirSalida(c, "b:111");
  assert.match(texto(c), /Hotel Control/);
  assert.doesNotMatch(texto(c), /Hotel Nacional 54/);
});

// ── «Salida (vuelo)» con salidas dinámicas reales (hallazgo de la prueba humana: solo ofrecía «Todas las salidas») ──────────
// El valor lleva el TIPO: `b:<bloqueo_id>` / `d:<salida_id>`, así un Bloqueo y un Dinámico con el mismo número no colisionan.
const selectorSalida = (c: HTMLElement) =>
  [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "Todas las salidas")) as HTMLSelectElement;
const opcionesSalida = (c: HTMLElement) => [...selectorSalida(c).options].map((o) => ({ value: o.value, texto: (o.textContent ?? "").replace(/\s+/g, " ") }));
async function elegirSalida(c: HTMLElement, valor: string) {
  const sel = selectorSalida(c);
  assert.ok(sel, "selector «Salida (vuelo)»");
  assert.ok([...sel.options].some((o) => o.value === valor), `no hay opción ${valor}: ${JSON.stringify(opcionesSalida(c))}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}
const tarjetaDe = (c: HTMLElement, hotel: RegExp) => [...c.querySelectorAll("button")].find((b) => hotel.test(b.textContent ?? ""));

test("SALIDA — Origen → Destino → Salida del 54: la salida dinámica real aparece (fecha y origen, sin cupos) junto al Bloqueo; elegirla deja su tarjeta y el modal cotiza ESA salidaId al precio DOBLE", async () => {
  dom.window.localStorage.clear();
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2560 }))], ORIGEN_REAL, false);
  await elegir(c, "BOGOTÁ");
  await elegir(c, "CARTAGENA");
  const ops = opcionesSalida(c);
  assert.deepEqual(ops.map((o) => o.value), ["", "b:111", "d:540"], "Todas + el Bloqueo de BOG + la salida dinámica de BOG (la 541 sale de MDE)");
  const dyn = ops.find((o) => o.value === "d:540")!.texto;
  assert.ok(dyn.startsWith("BOG → CARTAGENA · "), dyn);
  assert.match(dyn, /\(3N\)$/, "fecha y noches; nada de cupos ni datos de vuelo inventados");
  assert.doesNotMatch(dyn, /cupo/i);
  assert.match(ops.find((o) => o.value === "b:111")!.texto, /5 cupos/, "el Bloqueo conserva su opción tal cual");

  await elegirSalida(c, "d:540");
  assert.equal(listado(c), "Hotelesdisponibles(1)");
  assert.doesNotMatch(texto(c), /Hotel Control/, "con una salida dinámica elegida, el Bloqueo no aplica");
  const tarjeta = tarjetaDe(c, /Hotel Nacional 54/)!;
  assert.match(tarjeta.textContent ?? "", /1 fecha de salida/);
  assert.match(tarjeta.textContent ?? "", /900\.000/, "desde = DOBLE de la 540");
  assert.doesNotMatch(tarjeta.textContent ?? "", /700\.000/);

  await clic(tarjeta);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  const chips = [...c.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].map((b) => (b.textContent ?? "").replace(/\s+/g, " "));
  assert.equal(chips.length, 1, "el modal conserva SOLO la salida elegida");
  assert.match(chips[0], /desde \$\s?900\.000 en doble/);
  await ponerHabitaciones(c, "Doble", 1);
  await clic([...c.querySelectorAll(".fixed.inset-0 button")].find((b) => /Agregar al carrito/.test(b.textContent ?? ""))!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const [it] = carrito();
  assert.equal(it.modulo, "dinamico");
  assert.equal(it.salidaId, 540, "cotiza la MISMA salida elegida en el selector");
  assert.equal(it.bloqueoId, null);
  assert.equal(it.fechaIda, IDA1);
  assert.deepEqual(it.habitaciones, { doble: 1 });
  assert.equal(it.precio, 2 * 900_000);
});

test("SALIDA — cambio entre salidas dinámicas y vuelta a «Todas las salidas» (vista conjunta)", async () => {
  dom.window.localStorage.clear();
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleOk();
  const c = await montar([BLOQUEO, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2561 }))], ORIGEN_REAL, false);
  await elegir(c, "CARTAGENA");
  assert.deepEqual(opcionesSalida(c).map((o) => o.value), ["", "b:111", "d:540", "d:541"], "sin origen: las dos salidas dinámicas, en orden de fecha");
  assert.match(opcionesSalida(c).find((o) => o.value === "d:541")!.texto, /^MDE → CARTAGENA · .*\(4N\)$/);

  await elegirSalida(c, "d:541");
  let tarjeta = tarjetaDe(c, /Hotel Nacional 54/)!;
  assert.match(tarjeta.textContent ?? "", /1 fecha de salida/);
  assert.match(tarjeta.textContent ?? "", /1\.100\.000/, "desde = DOBLE de la 541");
  assert.doesNotMatch(texto(c), /Hotel Control/);

  await elegirSalida(c, "d:540");
  tarjeta = tarjetaDe(c, /Hotel Nacional 54/)!;
  assert.match(tarjeta.textContent ?? "", /900\.000/);
  assert.doesNotMatch(tarjeta.textContent ?? "", /1\.100\.000/);

  await elegirSalida(c, "");
  assert.equal(listado(c), "Hotelesdisponibles(2)", "Todas: Bloqueo y Dinámico juntos");
  assert.match(texto(c), /Hotel Control/);
  tarjeta = tarjetaDe(c, /Hotel Nacional 54/)!;
  assert.match(tarjeta.textContent ?? "", /2 fechas de salida/);
  assert.match(tarjeta.textContent ?? "", /900\.000/, "desde DOBLE = la menor de sus salidas");

  // Desde «Todas», el modal ofrece las dos fechas y cotiza la que se elija dentro.
  await clic(tarjeta);
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  assert.equal(c.querySelectorAll(".fixed.inset-0 button[aria-pressed]").length, 2);
  await clic([...c.querySelectorAll(".fixed.inset-0 button[aria-pressed]")].find((b) => b.getAttribute("aria-pressed") === "false")!);
  await ponerHabitaciones(c, "Doble", 1);
  await clic([...c.querySelectorAll(".fixed.inset-0 button")].find((b) => /Agregar al carrito/.test(b.textContent ?? ""))!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  assert.equal(carrito()[0].salidaId, 541);
  assert.equal(carrito()[0].precio, 2 * 1_100_000);
});

test("SALIDA — un Bloqueo con el MISMO número (bloqueo_id 540) que la salida dinámica 540: dos opciones distintas, cada una filtra lo suyo", async () => {
  const bloqueo540 = { ...BLOQUEO, bloqueo_id: 540, hotel_id: 2112, hotel_nombre: "Hotel Bloqueo 540" };
  const c = await montar([bloqueo540, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2562 }))], { ...ORIGEN_REAL, cuposPorBloqueo: { 540: 5 }, origenPorBloqueo: { 540: "BOG" } }, false);
  await elegir(c, "CARTAGENA");
  const valores = opcionesSalida(c).map((o) => o.value);
  assert.ok(valores.includes("b:540") && valores.includes("d:540"), JSON.stringify(valores));

  await elegirSalida(c, "b:540");
  assert.match(texto(c), /Hotel Bloqueo 540/);
  assert.doesNotMatch(texto(c), /Hotel Nacional 54/, "elegir el bloqueo 540 no trae la salida dinámica 540");

  await elegirSalida(c, "d:540");
  assert.match(texto(c), /Hotel Nacional 54/);
  assert.doesNotMatch(texto(c), /Hotel Bloqueo 540/, "elegir la salida dinámica 540 no trae el bloqueo 540");
  assert.match(tarjetaDe(c, /Hotel Nacional 54/)!.textContent ?? "", /1 fecha de salida/);
});

// ── Modal simplificado: sin la matriz de precios entre las fechas y el cotizador ─────────────────────────────────────────────
// Cada salida con DOS combos de precio distinto (Estándar · PAE y Suite · PC), para ver que el cotizador se actualiza.
const detalleDosCombos = () => ({
  obtenerDetalleSalida: async (a: { salidaId: number }) => {
    const f = FILAS_DIN.find((x) => x.salida_id === a.salidaId)!;
    const fila = (categoria: string, regimen: string, acomodacion: string, precio: number) => ({ ...f, categoria, regimen, acomodacion, precio_pvp: precio, precio_pvp_menor2: null });
    return { ok: true, filas: [
      fila("Estándar", "PAE", "doble", f.precio_doble), fila("Estándar", "PAE", "sencilla", f.precio_sencilla),
      fila("Suite", "PC", "doble", f.precio_doble + 50_000), fila("Suite", "PC", "sencilla", f.precio_sencilla + 50_000),
    ] };
  },
});
const totalEstimado = (c: HTMLElement) => (modal(c).match(/Total estimado · \d+ pax\s*\$\s?[\d.]+/) ?? [""])[0].replace(/\s+/g, " ");

test("MODAL SIMPLIFICADO — sin matriz de precios; fechas con 'desde' DOBLE y el cotizador se actualiza al cambiar categoría/alimentación y salida, conservando la salidaId", async () => {
  dom.window.localStorage.clear();
  (globalThis as { __detalleActionsFake?: unknown }).__detalleActionsFake = detalleDosCombos();
  const c = await montar(FILAS_DIN.map((f) => ({ ...f, hotel_id: 2570 })), {}, false);
  await abrirDinamico(c);
  const m = c.querySelector(".fixed.inset-0")!;
  assert.equal(m.querySelectorAll("table").length, 0, "la matriz de precios ya no está");
  assert.doesNotMatch(modal(c), /Categoría · alimentación/, "ni su encabezado");
  assert.doesNotMatch(modal(c), /Valores por persona\. Sujetos a disponibilidad/, "ni su nota");
  assert.doesNotMatch(modal(c), /Estándar · PAE|Suite · PC/, "ni sus filas");

  // Fechas con su 'desde' DOBLE (la menor doble entre categorías: Estándar).
  const chips = () => [...c.querySelectorAll(".fixed.inset-0 button[aria-pressed]")] as HTMLButtonElement[];
  assert.equal(chips().length, 2);
  assert.match(chips()[0].textContent ?? "", /desde \$\s?900\.000 en doble/);
  assert.match(chips()[1].textContent ?? "", /desde \$\s?1\.100\.000 en doble/);

  // Cotizador de la 1.ª salida: categoría/alimentación, precio por acomodación, total.
  assert.ok(opcionesDe(c, "Suite").includes("Estándar"), "selector de categoría con las dos");
  assert.match(modal(c), /\$\s?900\.000\/pers/, "doble de Estándar · PAE");
  assert.match(modal(c), /\$\s?700\.000\/pers/, "sencilla de Estándar · PAE");
  await ponerHabitaciones(c, "Doble", 1);
  assert.match(totalEstimado(c), /2 pax ?\$ ?1\.800\.000$/);

  await elegir(c, "Suite"); // la alimentación cae a la de Suite (PC)
  assert.ok(opcionesDe(c, "PC").includes("PC"));
  assert.match(modal(c), /\$\s?950\.000\/pers/, "el precio doble cambia con la categoría");
  assert.match(totalEstimado(c), /2 pax ?\$ ?1\.900\.000$/, "y el total también");

  // Otra salida: el cotizador se rehace con los precios de ESA salida.
  await clic(chips()[1]);
  assert.equal(chips()[1].getAttribute("aria-pressed"), "true");
  assert.match(modal(c), /\$\s?1\.100\.000\/pers/, "doble de Estándar en la 541");
  await elegir(c, "Suite");
  assert.match(modal(c), /\$\s?1\.150\.000\/pers/, "doble de Suite en la 541");
  await ponerHabitaciones(c, "Doble", 1);
  assert.match(totalEstimado(c), /2 pax ?\$ ?2\.300\.000$/);

  await clic([...m.querySelectorAll("button")].find((b) => /Agregar al carrito/.test(b.textContent ?? ""))!);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const [it] = carrito();
  assert.equal(it.salidaId, 541, "conserva la salida elegida");
  assert.equal(it.fechaIda, IDA2);
  assert.equal(it.categoria, "Suite");
  assert.equal(it.regimen, "PC");
  assert.deepEqual(it.habitaciones, { doble: 1 });
  assert.equal(it.precio, 2 * 1_150_000);
});

// Hoteles por UNIDAD (Bernalo) en el mismo destino: no tienen salidas dinámicas (solo records de Bloqueo/empaquetados en `salidas`).
const unidad = (hotelId: number, hotelNombre: string, salidas: unknown[]) => ({
  hotelId, hotelNombre, paqueteId: 70 + hotelId % 10, paqueteNombre: `Unidad ${hotelId}`, destinoNombre: "CARTAGENA", tipo: "bloqueo",
  categorias: ["Estándar"], regimenes: ["PAE"], destinoId: 7, moneda: "COP", salidas,
});
test("SALIDA — hoteles por UNIDAD del mismo destino: d:540 deja solo la oferta dinámica 540; b:540 solo lo relacionado con ese record; «Todas» restaura todo", async () => {
  const bloqueo540 = { ...BLOQUEO, bloqueo_id: 540, hotel_id: 2113, hotel_nombre: "Hotel Bloqueo 540" };
  const conRecord540 = unidad(3001, "Hotel Unidad Con 540", [{ tipo: "bloqueo", id: 540, fechaIda: IDA1, fechaRegreso: REG1, etiqueta: "BOG-CTG" }]);
  const sinRelacion = unidad(3002, "Hotel Unidad Sin Relacion", [{ tipo: "bloqueo", id: 999, fechaIda: IDA2, fechaRegreso: REG2, etiqueta: "BOG-CTG" }]);
  const c = await montar([bloqueo540, ...FILAS_DIN.map((f) => ({ ...f, hotel_id: 2563 }))], {
    ...ORIGEN_REAL, cuposPorBloqueo: { 540: 5 }, origenPorBloqueo: { 540: "BOG" }, hotelesBernalo: [conRecord540, sinRelacion],
  }, false);
  await elegir(c, "CARTAGENA");
  const todos = /Hotel Bloqueo 540|Hotel Nacional 54|Hotel Unidad Con 540|Hotel Unidad Sin Relacion/g;
  const visibles = () => [...new Set(texto(c).match(todos) ?? [])].sort();
  const TODOS = ["Hotel Bloqueo 540", "Hotel Nacional 54", "Hotel Unidad Con 540", "Hotel Unidad Sin Relacion"];
  assert.deepEqual(visibles(), TODOS, "Todas las salidas: Bloqueo, Dinámico y los dos por unidad");
  assert.equal(listado(c), "Hotelesdisponibles(4)");

  await elegirSalida(c, "d:540");
  assert.deepEqual(visibles(), ["Hotel Nacional 54"], "una salida dinámica: ningún hotel por unidad pertenece a ella");
  assert.equal(listado(c), "Hotelesdisponibles(1)");

  await elegirSalida(c, "");
  assert.deepEqual(visibles(), TODOS, "«Todas» los restaura");
  assert.equal(listado(c), "Hotelesdisponibles(4)");

  await elegirSalida(c, "b:540");
  assert.deepEqual(visibles(), ["Hotel Bloqueo 540", "Hotel Unidad Con 540"], "el record 540: su Bloqueo y el hotel por unidad que lo tiene entre sus salidas; nada sin relación");
  assert.equal(listado(c), "Hotelesdisponibles(2)");
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

test("MODAL: visual propia — fechas de salida, cotizador con precios por acomodación y menores, y 'Cotizar' hacia la reserva dinámica", async () => {
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
  assert.equal(c.querySelectorAll(".fixed.inset-0 table").length, 0, "sin matriz de precios: los precios están en el cotizador");
  assert.ok(opcionesDe(c, "Estándar").includes("Estándar"));
  assert.match(t, /\$\s?900\.000\/pers/);
  assert.doesNotMatch(t, /cupo/i, "un Dinámico no tiene cupos");
  // Menores en el cotizador: uno de 1 año liquida como infante al precio del menor de 2 años (150.000).
  await ponerHabitaciones(c, "Doble", 1);
  const campo = async (etiqueta: RegExp, valor: string) => {
    const label = [...c.querySelectorAll(".fixed.inset-0 label")].find((l) => etiqueta.test(l.textContent ?? ""));
    assert.ok(label, `campo ${etiqueta}`);
    const input = document.getElementById(label!.getAttribute("for")!) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  await campo(/Cantidad de menores/, "1");
  await campo(/Edad menor 1/, "1");
  assert.match(modal(c), /1 infante\(s\)/);
  assert.match(totalEstimado(c), /\$ ?1\.950\.000$/, "2 × 900.000 + infante 150.000");
  // Tarifa visible bajo «Edad menor 1»: sale de la misma liquidación que el total (150.000, menor de 2 años).
  assert.match(modal(c), /Edad menor 1\s*Tarifa menor 1\s*\$ ?150\.000\s*menor de 2 años/, "tarifa del menor dentro del mismo bloque, bajo su edad");
  const campoEdad = document.getElementById([...c.querySelectorAll(".fixed.inset-0 label")].find((l) => /Edad menor 1/.test(l.textContent ?? ""))!.getAttribute("for")!)!;
  assert.match(campoEdad.getAttribute("aria-describedby") ?? "", /-tarifa-0$/, "el campo de edad queda asociado a su tarifa");
  assert.equal(campoEdad.parentElement, document.getElementById(campoEdad.getAttribute("aria-describedby")!)!.parentElement, "edad y tarifa comparten el mismo bloque");
  await campo(/Edad menor 1/, "");
  assert.doesNotMatch(modal(c), /menor de 2 años/, "sin edad no se inventa tarifa");
  await campo(/Edad menor 1/, "1");
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
