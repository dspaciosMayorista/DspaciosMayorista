// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 · Vista tabla con salida de fechas concretas (bloqueo, empaquetado, salida dinámica): la tabla muestra los PVP calculados con la promoción vigente y la etiqueta ganadora
// (mismo motor que Vista Booking: `cotizarTarjetaHotel`). Mientras carga o falla no hay tarifas base; solo se calcula la salida elegida y con concurrencia limitada.
// Porción terrestre: los importes publicados se rotulan como referencia (sin fechas no hay promoción que afirmar).
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
const HOY = fecha(0), IDA1 = fecha(30), REG1 = fecha(33), IDA2 = fecha(60), REG2 = fecha(64);
const EBB2 = { etiqueta: "EBB 2 · 60+ días · 23 %", tipo: "ebb", umbral: 60, pct: 23 } as const;
const EBB3 = { etiqueta: "EBB 3 · 90+ días · 30 %", tipo: "ebb", umbral: 90, pct: 30 } as const;
type Desc = typeof EBB2 | typeof EBB3 | null;
const dd = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

const base = {
  servicio_id: null, servicio_nombre: null, precio_sencilla: null, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null,
  precio_infante: null, descripcion: null, recargo_individual: null, tipo_tarifa: null, moneda: "COP", categoria: "Estándar", regimen: "PAE",
  paquete_id: 54, paquete_nombre: "Nacional 54", hotel_id: 2540, hotel_nombre: "Hotel Nacional 54", destino_id: 7, destino_nombre: "CARTAGENA", empaquetado_id: null,
  bloqueo_id: null, salida_id: null, bloqueo_label: "BOG-CTG", precio_doble: 900000, desde_adulto: 700000, desde_general: 700000,
};
const din = (salida: number, ida: string, reg: string, noches: number, over: Record<string, unknown> = {}) =>
  ({ ...base, modulo: "dinamico", salida_id: salida, fecha_ida: ida, fecha_regreso: reg, noches, ...over });
const FILAS_DIN = [din(540, IDA1, REG1, 3), din(541, IDA2, REG2, 4, { precio_doble: 1100000 })];
const conAcom = (f: Record<string, unknown>, doble = f.precio_doble as number) => [{ ...f, acomodacion: "doble", precio_pvp: doble }, { ...f, acomodacion: "sencilla", precio_pvp: 700000 }];
const combo = (categoria: string, regimen: string, doble: number, descuento: Desc) =>
  ({ categoria, regimen, precios: { doble, sencilla: doble - 100_000 }, preciosMenor2: {}, infanteSinFijo: { mayor2: null, menor2: null }, descuento });
const cotiz = (ida: string, reg: string, noches: number, doble: number, descuento: Desc, categoria = "Estándar", regimen = "PAE") =>
  ({ ok: true, precio: doble, moneda: "COP", categoria, regimen, fechaIda: ida, fechaRegreso: reg, noches, fechaCalculo: HOY, descuentoHotel: descuento, combos: [combo(categoria, regimen, doble, descuento)] });

async function montar(filas: unknown[]) {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(CartProvider, null, h(TarifarioPublic, { filas, programas: [], puedeReservar: true } as never))); });
  const tabla = [...cont.querySelectorAll("button")].find((b) => b.textContent === "Vista tabla")!;
  await clic(tabla);
  return cont;
}
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const botonTexto = (re: RegExp) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const chip = (ida: string) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(dd(ida)) && b.className.includes("shrink-0"))!;
const tablaTexto = () => (document.querySelector("table")?.closest("div")?.textContent ?? document.body.textContent ?? "").replace(/\s+/g, " ");
const etiquetas = () => [...document.querySelectorAll('[data-testid="etiqueta-descuento-hotel"]')].map((e) => e.textContent?.trim());
const hrefReservar = () => document.querySelector('a[href^="/dashboard/reservar/nuevo"]')?.getAttribute("href") ?? null;
const fakeDetalleDin = () => ({
  obtenerDetalleSalida: async (a: { salidaId: number }) => ({ ok: true, filas: conAcom(FILAS_DIN.find((x) => x.salida_id === a.salidaId)!) }),
});
const tabDinamico = (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => b.textContent === "Salidas dinámicas")!;

test("dinámico en Vista tabla: enero (EBB 2) → mayo (EBB 3) → enero; carga sin tarifas base y Reservar/flyer de la selección", async () => {
  g.__detalleActionsFake = fakeDetalleDin();
  const llamadas: { salidaId: number; paqueteId: number; hotelId: number }[] = [];
  let liberarMayo: (() => void) | null = null;
  g.__cotizarTarjetaFake = async (i: { salidaId: number; paqueteId: number; hotelId: number }) => {
    llamadas.push(i);
    if (i.salidaId === 541) { await new Promise<void>((r) => { liberarMayo = r; }); return cotiz(IDA2, REG2, 4, 1_000_000, EBB3); }
    return cotiz(IDA1, REG1, 3, 800_000, EBB2);
  };
  const c = await montar(FILAS_DIN);
  await clic(tabDinamico(c)); await pausa();
  assert.deepEqual(etiquetas(), [EBB2.etiqueta]);
  assert.match(tablaTexto(), /800\.000/);
  assert.doesNotMatch(tablaTexto(), /900\.000/, "nunca la tarifa base publicada");
  await clic(chip(IDA2)); await pausa();
  assert.match(tablaTexto(), /Calculando el precio de esta salida/);
  assert.doesNotMatch(tablaTexto(), /\$\s?(800|900)\.000|1\.100\.000/, "mientras carga no hay tarifas, ni base ni de enero");
  assert.equal(hrefReservar(), null, "sin precio vigente no hay «Reservar»");
  await act(async () => { liberarMayo!(); await new Promise((r) => setTimeout(r, 20)); });
  assert.deepEqual(etiquetas(), [EBB3.etiqueta], "solo la etiqueta de mayo");
  assert.match(tablaTexto(), /1\.000\.000/);
  assert.doesNotMatch(tablaTexto(), /800\.000|1\.100\.000/);
  // «Reservar» apunta a la salida mostrada (el servidor la liquida con el mismo cómputo).
  const href = new URLSearchParams(hrefReservar()!.split("?")[1]);
  assert.deepEqual([href.get("paquete"), href.get("hotel"), href.get("salida"), href.get("modulo")], ["54", "2540", "541", "dinamico"]);
  assert.deepEqual(llamadas.at(-1), { ...llamadas.at(-1)!, salidaId: 541, paqueteId: 54, hotelId: 2540 });
  await clic(chip(IDA1)); await pausa();
  assert.deepEqual(etiquetas(), [EBB2.etiqueta]);
  assert.match(tablaTexto(), /800\.000/);
  assert.equal(llamadas.length, 2, "enero se reutiliza: una cotización por salida, no por clic");
});

test("el flyer recibe los precios de la selección calculada (no los publicados)", async () => {
  g.__detalleActionsFake = fakeDetalleDin();
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => i.salidaId === 541 ? cotiz(IDA2, REG2, 4, 1_000_000, EBB3) : cotiz(IDA1, REG1, 3, 800_000, EBB2);
  const c = await montar(FILAS_DIN);
  await clic(tabDinamico(c)); await pausa();
  await clic(chip(IDA2)); await pausa();
  await clic(botonTexto(/Brief|flyer/i));
  const brief = (document.querySelector("textarea, pre")?.textContent ?? document.body.textContent ?? "");
  assert.match(brief, /1\.000\.000/);
  assert.doesNotMatch(brief, /1\.100\.000|800\.000/);
});

test("salida sin promoción: precio calculado y ninguna etiqueta", async () => {
  g.__detalleActionsFake = fakeDetalleDin();
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => i.salidaId === 541 ? cotiz(IDA2, REG2, 4, 1_100_000, null) : cotiz(IDA1, REG1, 3, 800_000, EBB2);
  const c = await montar(FILAS_DIN);
  await clic(tabDinamico(c)); await pausa();
  await clic(chip(IDA2)); await pausa();
  assert.deepEqual(etiquetas(), []);
  assert.match(tablaTexto(), /1\.100\.000/);
});

test("si el cálculo falla: error con Reintentar, sin tarifas base ni «Reservar»; al reintentar se calcula", async () => {
  g.__detalleActionsFake = fakeDetalleDin();
  let falla = true;
  g.__cotizarTarjetaFake = async () => { if (falla) throw new Error("red"); return cotiz(IDA1, REG1, 3, 800_000, EBB2); };
  const c = await montar(FILAS_DIN);
  await clic(tabDinamico(c)); await pausa();
  assert.match(tablaTexto(), /No pudimos calcular el precio/);
  assert.doesNotMatch(tablaTexto(), /900\.000/);
  assert.equal(hrefReservar(), null);
  falla = false;
  await clic(botonTexto(/^Reintentar$/)); await pausa();
  assert.deepEqual(etiquetas(), [EBB2.etiqueta]);
  assert.match(hrefReservar() ?? "", /salida=540/);
});

test("empaquetados con las mismas fechas y distinto empaquetado_id: ofertas separadas, cada una con su cotización", async () => {
  const emp = (id: number) => ({ ...base, modulo: "bloqueo", bloqueo_id: 11, empaquetado_id: id, bloqueo_label: `Empaquetado ${id}`, fecha_ida: IDA1, fecha_regreso: REG1, noches: 3 });
  const filas = [emp(21), emp(22)];
  g.__detalleActionsFake = { obtenerDetalleSalida: async () => ({ ok: true, filas: filas.flatMap((f) => conAcom(f)) }) };
  const llamadas: { empaquetadoId: number }[] = [];
  g.__cotizarTarjetaFake = async (i: { empaquetadoId: number }) => { llamadas.push(i); return i.empaquetadoId === 21 ? cotiz(IDA1, REG1, 3, 800_000, EBB2) : cotiz(IDA1, REG1, 3, 950_000, EBB3); };
  await montar(filas); await pausa();
  const boton = (n: number) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(`Empaquetado ${n}`))!;
  assert.ok(boton(21) && boton(22));
  assert.deepEqual(etiquetas(), [EBB2.etiqueta]);
  assert.match(tablaTexto(), /800\.000/);
  await clic(boton(22)); await pausa();
  assert.deepEqual(llamadas.map((l) => l.empaquetadoId), [21, 22]);
  assert.deepEqual(etiquetas(), [EBB3.etiqueta]);
  assert.match(tablaTexto(), /950\.000/);
  assert.doesNotMatch(tablaTexto(), /800\.000/);
  assert.match(hrefReservar() ?? "", /empaquetado=22/);
});

test("solo se calcula la salida elegida y con concurrencia limitada (3)", async () => {
  const hoteles = [1, 2, 3, 4, 5].map((n) => ({ ...din(540, IDA1, REG1, 3), hotel_id: 3000 + n, hotel_nombre: `Hotel ${n}` }));
  const filas = [...hoteles, din(541, IDA2, REG2, 4, { hotel_id: 3001, hotel_nombre: "Hotel 1" })];
  g.__detalleActionsFake = { obtenerDetalleSalida: async (a: { salidaId: number }) => ({ ok: true, filas: filas.filter((f) => f.salida_id === a.salidaId).flatMap((f) => conAcom(f)) }) };
  let activos = 0, maximo = 0;
  const salidas = new Set<number>();
  const liberar: (() => void)[] = [];
  g.__cotizarTarjetaFake = async (i: { salidaId: number }) => {
    salidas.add(i.salidaId); activos++; maximo = Math.max(maximo, activos);
    await new Promise<void>((r) => liberar.push(r));
    activos--;
    return cotiz(IDA1, REG1, 3, 800_000, null);
  };
  const c = await montar(filas);
  await clic(tabDinamico(c)); await pausa();
  assert.equal(activos, 3, "arrancan 3, no los 5 hoteles");
  while (liberar.length) { await act(async () => { liberar.shift()!(); await new Promise((r) => setTimeout(r, 10)); }); }
  await pausa();
  assert.equal(maximo, 3);
  assert.deepEqual([...salidas], [540], "la otra salida (541) no se calcula");
});

test("porción terrestre: el importe publicado se identifica como referencia y no se afirma ninguna promoción", async () => {
  const por = { ...base, modulo: "porcion_terrestre", fecha_ida: null, fecha_regreso: null, noches: 3, bloqueo_label: null };
  g.__detalleActionsFake = { obtenerDetallePaquete: async () => ({ ok: true, filas: conAcom(por) }) };
  g.__cotizarTarjetaFake = async () => { throw new Error("sin fechas no se cotiza"); };
  await montar([por]); await pausa();
  assert.ok(document.querySelector('[data-testid="tabla-referencia"]'));
  assert.match(document.body.textContent ?? "", /Importes publicados de referencia, sin fechas/);
  assert.deepEqual(etiquetas(), []);
});

test("empaquetados SIN bloqueo_id: tabla → flyer → «Reservar» corresponden al empaquetado elegido", async () => {
  const emp = (id: number) => ({ ...base, modulo: "bloqueo", bloqueo_id: null, empaquetado_id: id, bloqueo_label: `Empaquetado ${id}`, fecha_ida: IDA1, fecha_regreso: REG1, noches: 3 });
  const filas = [emp(21), emp(22)];
  const pedidos: Record<string, unknown>[] = [];
  // Como el servidor: sin bloqueo_id, la salida se abre SOLO por su empaquetado_id y devuelve únicamente sus filas.
  g.__detalleActionsFake = {
    obtenerDetalleSalida: async (a: Record<string, unknown>) => {
      pedidos.push(a);
      assert.equal(a.bloqueoId, undefined, "no se pide por un bloqueo_id inexistente");
      return { ok: true, filas: filas.filter((f) => f.empaquetado_id === a.empaquetadoId).flatMap((f) => conAcom(f)) };
    },
  };
  const cotizados: Record<string, unknown>[] = [];
  g.__cotizarTarjetaFake = async (i: Record<string, unknown>) => { cotizados.push(i); return i.empaquetadoId === 21 ? cotiz(IDA1, REG1, 3, 800_000, EBB2) : cotiz(IDA1, REG1, 3, 950_000, EBB3); };
  await montar(filas); await pausa();
  const boton = (n: number) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(`Empaquetado ${n}`))!;
  assert.ok(boton(21) && boton(22), "dos ofertas separadas con las mismas fechas");
  assert.deepEqual(etiquetas(), [EBB2.etiqueta]);
  await clic(boton(22)); await pausa();
  assert.deepEqual(pedidos.map((p) => p.empaquetadoId), [21, 22]);
  assert.deepEqual(cotizados.map((p) => [p.empaquetadoId, p.bloqueoId]), [[21, null], [22, null]]);
  // Tabla: precio y etiqueta del 22.
  assert.deepEqual(etiquetas(), [EBB3.etiqueta]);
  assert.match(tablaTexto(), /950\.000/);
  assert.doesNotMatch(tablaTexto(), /800\.000/);
  // Flyer: precios del 22.
  await clic(botonTexto(/Brief|flyer/i));
  const brief = document.querySelector("textarea, pre")?.textContent ?? "";
  assert.match(brief, /950\.000/);
  assert.doesNotMatch(brief, /800\.000/);
  // Reservar: empaquetado 22, sin bloqueo.
  const href = new URLSearchParams(hrefReservar()!.split("?")[1]);
  assert.deepEqual([href.get("empaquetado"), href.get("bloqueo"), href.get("modulo")], ["22", null, "bloqueo"]);
  // De vuelta al 21: su propia cotización, sin mezclar.
  await clic(boton(21)); await pausa();
  assert.deepEqual(etiquetas(), [EBB2.etiqueta]);
  assert.match(tablaTexto(), /800\.000/);
  assert.equal(new URLSearchParams(hrefReservar()!.split("?")[1]).get("empaquetado"), "21");
  assert.equal(cotizados.length, 2);
});
