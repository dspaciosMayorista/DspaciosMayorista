// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #54 — Editar los servicios de un hotel que YA está en el carrito, montando
// las tarjetas REALES (`Resultado` por persona y `TarjetaUnidadBusqueda` por
// unidad) con el `CartProvider` real en modo estricto:
//   · la selección se hidrata desde lo guardado (localStorage), sin consultar;
//   · el modal deja seleccionar/quitar aunque el hotel ya esté en el carrito;
//   · los cambios son un BORRADOR con su total; el carrito no cambia hasta
//     confirmar, y descartar vuelve a lo guardado;
//   · confirmar revalida con los motores existentes y actualiza hotel +
//     servicios en una sola operación: mismo id de hotel, mismos vínculos,
//     sin duplicados ni huérfanos, sin tocar otra reserva del mismo hotel;
//   · error, precio distinto, doble clic, respuesta tardía, cambio de oferta
//     y hotel eliminado durante la revalidación dejan el conjunto anterior.
import { test, describe, before, after, afterEach, mock } from "node:test";
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
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.getBoundingClientRect = function () {
  return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON() {} };
};
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Server Action pública de cotización por unidad: configurable por prueba.
type CotizacionUnidad = { ok: true; pvp: number; moneda: string; composicionHabitaciones: unknown[]; paxTotal: number } | { ok: false; mensaje: string };
const bernalo = {
  llamadas: [] as unknown[],
  respuesta: async (): Promise<CotizacionUnidad> => ({ ok: true, pvp: 500_000, moneda: "COP", composicionHabitaciones: COMPOSICION, paxTotal: 2 }),
};
const COMPOSICION = [{ habitacionId: "h1", adultos: 2, ninos: 0, infantes: 0 }];
mock.module(new URL("../app/tarifario/cotizacionBernaloActions.ts", import.meta.url).href, {
  namedExports: { cotizarAlojamientoBernaloPublico: async (x: unknown) => { bernalo.llamadas.push(x); return bernalo.respuesta(); } },
});
const noInvocar = async () => { throw new Error("No debe llamar al servidor"); };
mock.module(new URL("../app/tarifario/detalle-actions.ts", import.meta.url).href, {
  namedExports: { obtenerDetalleHotel: noInvocar, obtenerDetalleSalida: noInvocar },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { TarjetaUnidadBusqueda } = await import("../app/tarifario/VistaBooking.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { firmaConjunto } = await import("../lib/cart/vinculoServicios.ts");
const { __setBuscarReceptivos, __setBuscarHoteles } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const COTIZAR = 400; // más que el debounce de la cotización de servicios (300 ms)
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
function cambiarSelect(container: HTMLElement, etiqueta: string, valor: string) {
  const span = [...container.querySelectorAll("label > span")].find((s) => s.textContent?.trim() === etiqueta)!;
  const select = span.parentElement!.querySelector("select") as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(select, valor);
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}
function diferido<T>() {
  let soltar!: (v: T) => void;
  const promesa = new Promise<T>((r) => { soltar = r; });
  return { promesa, soltar };
}

// ── Fixtures ────────────────────────────────────────────────────────────
const FECHAS = { fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" };
function resultadoFixture(over: {
  habitaciones?: Record<string, number>; pax?: number; edadesMenores?: number[]; menores?: { infantes: number; nino: number; nino2: number };
  precios?: [number, number];
} = {}) {
  const pax = over.pax ?? 2;
  const menores = over.menores ?? { infantes: 0, nino: 0, nino2: 0 };
  const [desayuno, todo] = over.precios ?? [1_200_000, 1_600_000];
  const c = (regimen: string, total: number) => ({ categoria: "Estandar", regimen, total, pax, menores });
  return {
    hotelId: 1, hotelNombre: "Hotel Almirante", destino: "CARTAGENA",
    paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", paqueteNombre: "Paquete Caribe",
    total: desayuno, noches: 3, ...FECHAS, moneda: "COP",
    habitaciones: over.habitaciones ?? { doble: 1 }, menores, edadesMenores: over.edadesMenores ?? [], pax,
    combos: [c("Desayuno", desayuno), c("Todo incluido", todo)], condicion: null,
  } as Parameters<typeof Resultado>[0]["r"];
}
const resultado2Hab = (precios: [number, number] = [2_400_000, 3_200_000]) => resultadoFixture({ habitaciones: { doble: 2 }, pax: 4, precios });

// `buscarHoteles` (revalidación del hotel por persona al confirmar): por
// defecto devuelve la MISMA oferta de la tarjeta según la ocupación pedida
// (precio estable). Cada prueba puede cambiar la respuesta.
type EntradaBusqueda = { fechaIda: string; fechaRegreso: string; habitaciones: { acom: string }[]; adultos: number; cantidadMenores: number; edadesMenores: number[]; destino?: string };
const ofertaPara = (input: EntradaBusqueda) => (input.habitaciones.length === 2 ? resultado2Hab() : resultadoFixture());
const hoteles = {
  llamadas: [] as EntradaBusqueda[],
  respuesta: (input: EntradaBusqueda): unknown => ({ ok: true, resultados: [ofertaPara(input)] }),
};
const RESPUESTA_HOTELES = hoteles.respuesta;
__setBuscarHoteles(async (input: EntradaBusqueda) => { hoteles.llamadas.push(input); return hoteles.respuesta(input); });
const addon = (servicioId: number, nombre: string, desde: number) => ({
  servicioId, paqueteId: 10, nombre, destino: "CARTAGENA", descripcion: "Tour", foto: null, desde, moneda: "COP",
});
const ADDONS = new Map([[10, [addon(55, "Islas del Rosario", 90_000), addon(56, "City tour", 40_000)]]]);
const servicio = (servicioId: number, total: number, pax = 2) => ({
  servicioId, paqueteId: 10, nombre: servicioId === 55 ? "Islas del Rosario" : servicioId === 56 ? "City tour" : `S${servicioId}`,
  destino: "CARTAGENA", descripcion: null, total, pax, noches: 3, moneda: "COP", categoria: "tour",
});
const hotelPersona = (id: string, over: Record<string, unknown> = {}) => ({
  id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "Hotel Almirante",
  destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno", ...FECHAS, noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1_200_000, moneda: "COP", edadesMenores: [], condicion: null, ...over,
});
const tourGuardado = (id: string, hotelItemId: string, servicioId: number, precio: number, over: Record<string, unknown> = {}) => ({
  id, tipo: "tour", paqueteId: 10, servicioId, nombre: servicioId === 55 ? "Islas del Rosario" : servicioId === 56 ? "City tour" : `Tour retirado ${servicioId}`,
  destino: "CARTAGENA", fotoUrl: null, ...FECHAS, noches: 3, pax: 2, precio, moneda: "COP", hotelItemId, ...over,
});

const propsResultado = (r = resultadoFixture()) => ({
  r, foto: null, info: { estrellas: null, clasificacion: null }, descripcionPorPaquete: {}, addonsPorPaquete: ADDONS,
});

// ── Montaje con el carrito real ─────────────────────────────────────────
// <StrictMode> en la RAÍZ, como lo monta Next en desarrollo: render, efectos
// y actualizadores dobles (en React 19.2 un StrictMode ANIDADO no duplica
// efectos). El carrito se precarga en localStorage ANTES de montar y el
// `CartProvider` lo hidrata (hallazgo 3 de la auditoría: antes lo perdía).
type Carrito = ReturnType<typeof useCart>;
async function montar(elemento: React.ReactNode, items: unknown[] | null) {
  localStorage.clear();
  if (items) localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let api!: Carrito;
  function Espia() { api = useCart(); return null; }
  const root = createRoot(container);
  const arbol = (el: React.ReactNode) => h(React.StrictMode, null, h(CartProvider, null, el, h(Espia, null)));
  await act(async () => { root.render(arbol(elemento)); await espera(); });
  return {
    container,
    texto: () => container.textContent ?? "",
    carrito: () => api,
    render: async (el: React.ReactNode) => { await act(async () => { root.render(arbol(el)); await espera(); }); },
    desmontar: () => { act(() => root.unmount()); container.remove(); },
  };
}
type Montaje = Awaited<ReturnType<typeof montar>>;

/** Abre el servicio desde «Servicios adicionales» y lo marca/desmarca en el modal. */
async function alternarServicio(m: Montaje, nombre: RegExp, esperar = COTIZAR) {
  await act(async () => { click(boton(/^Servicios adicionales \(/, m.container)!); await espera(); });
  await act(async () => { click(boton(nombre)!); await espera(); });
  const dialogo = document.querySelector('[role="dialog"]')!;
  const b = boton(/Seleccionar para este hotel|Seleccionado · quitar/, dialogo);
  assert.ok(b, `el modal debe permitir cambiar la selección (texto: ${dialogo.textContent})`);
  await act(async () => { click(b); await espera(); });
  await act(async () => { click(boton(/^Cerrar/, dialogo)!); await espera(esperar); });
}
/** Igual que `alternarServicio`, pero en la tarjeta `raiz` (cuando hay varias). */
async function alternarEn(raiz: HTMLElement, nombre: string, esperar = COTIZAR) {
  await act(async () => { click(boton(/^Servicios adicionales \(/, raiz)!); await espera(); });
  await act(async () => { click(boton(new RegExp(`${nombre}.*desde`))!); await espera(); });
  const dialogo = document.querySelector('[role="dialog"]')!;
  await act(async () => { click(boton(/Seleccionar para este hotel|Seleccionado · quitar/, dialogo)!); await espera(); });
  await act(async () => { click(boton(/^Cerrar/, dialogo)!); await espera(esperar); });
}
const confirmar = (m: Montaje) => boton(/Confirmar actualización/, m.container);
/** Ítem sin `id` ni `hotelItemId` (lo que recibe `addConjunto`). */
const sinId = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "id" && k !== "hotelItemId"));
const guardado = () => JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? "[]") as { id: string; tipo: string; hotelItemId?: string; servicioId?: number; precio: number }[];
const resumen = (c: Carrito) => c.items.map((i) => (i.tipo === "tour" ? `${i.id}:${i.servicioId}:${i.precio}>${i.hotelItemId}` : `${i.id}:hotel:${i.precio}`));

// ═══════════════════════════════════════════════════════════════════════
describe("#54 tarjeta por persona (Resultado): editar servicios con el hotel ya en el carrito", () => {
  const llamadas: { fechaIda: string; fechaRegreso: string; pax: number; paqueteId: number }[] = [];
  let respuesta: (input: { paqueteId: number; pax: number }) => unknown = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
  before(() => { __setBuscarReceptivos(async (input: never) => { llamadas.push(input); return respuesta(input); }); });
  after(() => __setBuscarReceptivos(null));
  afterEach(() => { hoteles.respuesta = RESPUESTA_HOTELES; });

  test("hidrata la selección guardada desde localStorage, sin consultar ni bloquear el modal", async () => {
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    const antes = llamadas.length;
    assert.match(m.texto(), /En el carrito con este hotel/);
    assert.match(m.texto(), /Islas del Rosario/);
    assert.match(m.texto(), /Servicios adicionales \(2\) · 1 elegido/, "la selección guardada se ve en la lista");
    assert.match(m.texto(), /ábrelos en «Servicios adicionales»: el carrito se actualiza cuando confirmes/);
    assert.equal(llamadas.length, antes, "sin cambios no se cotiza nada");
    assert.doesNotMatch(m.texto(), /Cambios sin confirmar/);
    await act(async () => { click(boton(/^Servicios adicionales \(/, m.container)!); await espera(); });
    await act(async () => { click(boton(/City tour/)!); await espera(); });
    const dialogo = document.querySelector('[role="dialog"]')!;
    assert.doesNotMatch(dialogo.textContent ?? "", /Quítalo del carrito/);
    assert.ok(boton(/Seleccionar para este hotel/, dialogo), "se puede seleccionar con el hotel en el carrito");
    await act(async () => { click(boton(/^Cerrar/, dialogo)!); await espera(); });
    m.desmontar();
  });

  test("agregar un servicio: borrador con total; el carrito NO cambia hasta confirmar; confirmar = una sola actualización con mismos ids", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"], "el borrador no toca el carrito");
    assert.match(m.texto(), /Cambios sin confirmar/);
    assert.match(m.texto(), /Total hotel \+ servicios\s*\$\s?1\.465\.000/);
    const b = confirmar(m)!;
    assert.match(b.textContent ?? "", /Confirmar actualización · \$\s?1\.465\.000/);
    assert.equal(b.disabled, false);
    const antes = llamadas.length, antesH = hoteles.llamadas.length;
    await act(async () => { click(b); await espera(); });
    assert.equal(llamadas.length, antes + 1, "confirmar revalida los servicios con buscarReceptivos");
    assert.deepEqual(llamadas.at(-1), { ...FECHAS, pax: 2, paqueteId: 10 });
    assert.equal(hoteles.llamadas.length, antesH + 1, "y el hotel con buscarHoteles");
    assert.deepEqual(hoteles.llamadas.at(-1), {
      ...FECHAS, habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: 0, edadesMenores: [], destino: "CARTAGENA",
    }, "la ocupación exacta de la reserva");
    const items = m.carrito().items;
    assert.equal(items.filter((i) => i.tipo === "hotel").length, 1, "un solo hotel");
    assert.equal(items[0].id, "h1", "el hotel conserva su id");
    assert.deepEqual(items.slice(1).map((i) => i.tipo === "tour" && [i.servicioId, i.hotelItemId, i.precio]), [[55, "h1", 180_000], [56, "h1", 85_000]]);
    assert.equal(items[1].id, "t55", "el servicio que se queda conserva su id");
    assert.deepEqual(guardado().map((i) => i.id), items.map((i) => i.id), "persistido igual que el estado");
    assert.doesNotMatch(m.texto(), /Cambios sin confirmar/);
    assert.match(m.texto(), /Servicios adicionales \(2\) · 2 elegidos/);
    m.desmontar();
  });

  test("descartar: vuelve a lo guardado sin tocar el carrito", async () => {
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000), tourGuardado("t56", "h1", 56, 85_000)]);
    await alternarServicio(m, /Islas del Rosario/, 30);
    assert.match(m.texto(), /Cambios sin confirmar/);
    assert.match(m.texto(), /· 1 elegido/);
    await act(async () => { click(boton(/Descartar cambios/, m.container)!); await espera(); });
    assert.doesNotMatch(m.texto(), /Cambios sin confirmar/);
    assert.match(m.texto(), /· 2 elegidos/);
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1", "t56:56:85000>h1"]);
    m.desmontar();
  });

  test("retirar todos: confirma sin consultar; el hotel queda solo y con su id", async () => {
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000), tourGuardado("t56", "h1", 56, 85_000)]);
    await alternarServicio(m, /Islas del Rosario/, 30);
    await alternarServicio(m, /City tour/, 30);
    assert.match(m.texto(), /Se quitarán todos los servicios de este hotel/);
    assert.match(m.texto(), /Total del hotel\s*\$\s?1\.200\.000/);
    const antes = llamadas.length, antesH = hoteles.llamadas.length;
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.equal(llamadas.length, antes, "retirar no necesita cotización");
    assert.equal(hoteles.llamadas.length, antesH, "ni revalidar el hotel: queda el guardado");
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000"]);
    assert.ok(boton(/En el carrito · quitar$/, m.container), "el hotel sigue en el carrito, ya sin servicios");
    m.desmontar();
  });

  test("precio distinto al revalidar: no aplica, muestra el precio nuevo; reconfirmar sí aplica", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    respuesta = () => ({ ok: true, resultados: [servicio(55, 190_000), servicio(56, 85_000)] });
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"], "conjunto anterior intacto");
    assert.match(m.texto(), /Los precios de los servicios cambiaron/);
    assert.match(m.texto(), /Total hotel \+ servicios\s*\$\s?1\.475\.000/, "se muestra la cotización fresca");
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.deepEqual(resumen(m.carrito()).map((s) => s.replace(/^\d+-\w+/, "nuevo")), ["h1:hotel:1200000", "t55:55:190000>h1", "nuevo:56:85000>h1"]);
    m.desmontar();
  });

  test("hallazgo 1 — precio del HOTEL cambiado con servicios estables: no aplica, muestra la tarifa fresca; reconfirmar aplica", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    hoteles.respuesta = () => ({ ok: true, resultados: [resultadoFixture({ precios: [1_250_000, 1_600_000] })] });
    const antesS = llamadas.length;
    await act(async () => { click(confirmar(m)!); await espera(); });
    await act(async () => { await espera(COTIZAR); }); // los servicios se recotizan con la tarifa fresca
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"], "el conjunto anterior queda intacto");
    assert.match(m.texto(), /La tarifa del hotel cambió/);
    assert.match(m.texto(), /\$\s?1\.250\.000\s*\$\s?1\.200\.000/, "tarifa fresca y, tachada, la de la búsqueda");
    assert.ok(m.container.querySelector('s[aria-label="Precio de la búsqueda"]'));
    assert.match(m.texto(), /Total hotel \+ servicios\s*\$\s?1\.515\.000/, "mismos servicios sobre la tarifa fresca");
    assert.match(m.texto(), /La tarifa actual del hotel \(\$\s?1\.250\.000\) es distinta a la del carrito \(\$\s?1\.200\.000\)/);
    assert.equal(llamadas.length, antesS + 2, "servicios revalidados al confirmar y recotizados por la tarifa nueva");
    await act(async () => { click(confirmar(m)!); await espera(); });
    const items = m.carrito().items;
    assert.ok(items[0].tipo === "hotel" && items[0].id === "h1" && items[0].precio === 1_250_000, "aplica con la tarifa revalidada, mismo id");
    assert.deepEqual(items.slice(1).map((i) => i.tipo === "tour" && [i.servicioId, i.hotelItemId, i.precio]), [[55, "h1", 180_000], [56, "h1", 85_000]]);
    assert.doesNotMatch(m.texto(), /Cambios sin confirmar/);
    m.desmontar();
  });

  test("hallazgo 1 — hotel no disponible (sin oferta, sin el combo, otra ocupación, rechazo o error): el conjunto anterior queda intacto", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    const casos: [string, () => unknown, RegExp][] = [
      ["sin la oferta", () => ({ ok: true, resultados: [] }), /Este hotel ya no está disponible con esta categoría y alimentación/],
      ["sin el combo", () => ({ ok: true, resultados: [{ ...resultadoFixture(), combos: [resultadoFixture().combos[1]] }] }), /ya no está disponible/],
      ["otra ocupación", () => ({ ok: true, resultados: [resultadoFixture({ pax: 3 })] }), /ya no está disponible/],
      ["otro paquete", () => ({ ok: true, resultados: [{ ...resultadoFixture(), paqueteId: 11 }] }), /ya no está disponible/],
      ["rechazo del motor", () => ({ ok: false, error: "No hay disponibilidad para esas fechas." }), /No hay disponibilidad para esas fechas\. No se aplicó ningún cambio/],
      ["error de red", () => { throw new Error("red caída"); }, /No pudimos confirmar la tarifa del hotel/],
    ];
    for (const [nombre, resp, mensaje] of casos) {
      hoteles.respuesta = resp;
      await act(async () => { click(confirmar(m)!); await espera(); });
      assert.match(m.texto(), mensaje, nombre);
      assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"], `${nombre}: conjunto intacto`);
      assert.match(m.texto(), /Cambios sin confirmar/, `${nombre}: el borrador se conserva`);
    }
    m.desmontar();
  });

  test("hallazgo 1 — respuesta tardía del HOTEL después de quitarlo del carrito: no se recrea", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    const d = diferido<unknown>();
    hoteles.respuesta = () => d.promesa;
    await act(async () => { click(confirmar(m)!); await espera(); });
    await act(async () => { m.carrito().remove("h1"); await espera(); });
    await act(async () => { d.soltar({ ok: true, resultados: [resultadoFixture()] }); await espera(); });
    assert.deepEqual(m.carrito().items, []);
    assert.match(m.texto(), /Este hotel ya no está en el carrito/);
    m.desmontar();
  });

  test("hallazgo 2 — quitar el hotel y confirmar en el MISMO lote: la tarjeta informa el rechazo (no un éxito)", async () => {
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /Islas del Rosario/, 30); // retirar todos: confirmación síncrona
    await act(async () => { m.carrito().remove("h1"); click(confirmar(m)!); await espera(); });
    assert.deepEqual(m.carrito().items, []);
    assert.match(m.texto(), /Este hotel ya no está en el carrito\. No se aplicó ningún cambio/);
    m.desmontar();
  });

  test("hallazgo 2 — dos tarjetas de la MISMA reserva confirman en el mismo lote: una aplica, la otra informa el rechazo", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h("div", null,
      h("section", { id: "a" }, h(Resultado, propsResultado())),
      h("section", { id: "b" }, h(Resultado, propsResultado()))), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000), tourGuardado("t56", "h1", 56, 85_000)]);
    const a = m.container.querySelector("#a") as HTMLElement, b = m.container.querySelector("#b") as HTMLElement;
    // Dos borradores distintos sobre el MISMO conjunto guardado: A deja solo
    // City tour; B deja solo Islas. Ambos necesitan revalidación.
    await alternarEn(a, "Islas del Rosario", 30);
    await alternarEn(b, "City tour");
    assert.ok(boton(/Confirmar actualización/, a) && boton(/Confirmar actualización/, b));
    await act(async () => { click(boton(/Confirmar actualización/, a)!); click(boton(/Confirmar actualización/, b)!); await espera(60); });
    const tours = m.carrito().items.filter((i) => i.tipo === "tour");
    assert.equal(m.carrito().items.filter((i) => i.tipo === "hotel").length, 1);
    assert.equal(tours.length, 1, "solo una de las dos ediciones quedó aplicada");
    const rechazos = [a, b].filter((x) => /cambiaron en el carrito mientras confirmabas/.test(x.textContent ?? ""));
    assert.equal(rechazos.length, 1, "la otra tarjeta informa el rechazo");
    m.desmontar();
  });

  test("error de red al revalidar y servicio sin precio: el conjunto anterior queda intacto", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    respuesta = () => { throw new Error("red caída"); };
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.match(m.texto(), /No pudimos cotizar los servicios en este momento/);
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"]);
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000)] });
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.match(m.texto(), /«City tour» no tiene un precio vigente/);
    assert.equal(confirmar(m)!.disabled, true, "con un servicio sin precio no se puede confirmar");
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"]);
    m.desmontar();
  });

  test("servicio guardado que el paquete ya no ofrece: se nombra y bloquea hasta quitarlo a conciencia", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000), tourGuardado("t99", "h1", 99, 50_000)]);
    assert.match(m.texto(), /Tour retirado 99/, "lo guardado se sigue mostrando");
    await alternarServicio(m, /City tour/);
    assert.match(m.texto(), /«Tour retirado 99» ya no se ofrece en este paquete/);
    assert.equal(confirmar(m)!.disabled, true);
    await act(async () => { click(m.container.querySelector('button[aria-label="Quitar Tour retirado 99 del conjunto"]')!); await espera(); });
    assert.equal(confirmar(m)!.disabled, false);
    await act(async () => { click(confirmar(m)!); await espera(); });
    const items = m.carrito().items;
    assert.deepEqual(items.map((i) => (i.tipo === "tour" ? i.servicioId : i.id)), ["h1", 55, 56]);
    m.desmontar();
  });

  test("doble clic: una sola revalidación y un solo conjunto", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    const d = diferido<unknown>();
    respuesta = () => d.promesa;
    const antes = llamadas.length;
    const b = confirmar(m)!;
    await act(async () => { click(b); click(b); await espera(); });
    assert.match(m.texto(), /Actualizando el carrito/);
    await act(async () => { d.soltar({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] }); await espera(); });
    assert.equal(llamadas.length, antes + 1);
    assert.equal(m.carrito().items.length, 3);
    assert.equal(m.carrito().items.filter((i) => i.tipo === "hotel").length, 1);
    m.desmontar();
  });

  test("hotel eliminado durante la revalidación: no se recrea y se avisa", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000), { ...tourGuardado("suelto", "", 57, 10), hotelItemId: undefined }]);
    await alternarServicio(m, /City tour/);
    const d = diferido<unknown>();
    respuesta = () => d.promesa;
    await act(async () => { click(confirmar(m)!); await espera(); });
    await act(async () => { m.carrito().remove("h1"); await espera(); });
    await act(async () => { d.soltar({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] }); await espera(); });
    assert.deepEqual(m.carrito().items.map((i) => i.id), ["suelto"], "ni hotel recreado ni servicios huérfanos");
    assert.match(m.texto(), /Este hotel ya no está en el carrito\. No se aplicó ningún cambio/);
    m.desmontar();
  });

  test("respuesta tardía tras cambiar la oferta (alimentación): se ignora y el conjunto queda igual", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    const d = diferido<unknown>();
    respuesta = () => d.promesa;
    await act(async () => { click(confirmar(m)!); await espera(); });
    await act(async () => { cambiarSelect(m.container, "Alimentación", "Todo incluido"); await espera(); });
    await act(async () => { d.soltar({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] }); await espera(); });
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"]);
    m.desmontar();
  });

  test("dos reservas del mismo hotel con otra ocupación: cada tarjeta edita SOLO la suya", async () => {
    respuesta = (input) => ({ ok: true, resultados: input.pax === 4
      ? [servicio(55, 360_000, 4), servicio(56, 170_000, 4)]
      : [servicio(55, 180_000), servicio(56, 85_000)] });
    const items = [
      hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000),
      hotelPersona("h2", { habitaciones: { doble: 2 }, pax: 4, precio: 2_400_000 }), tourGuardado("t56b", "h2", 56, 170_000, { pax: 4 }),
    ];
    const r4 = resultado2Hab();
    const m = await montar(h("div", null,
      h("section", { id: "a" }, h(Resultado, propsResultado())),
      h("section", { id: "b" }, h(Resultado, propsResultado(r4)))), items);
    const a = m.container.querySelector("#a") as HTMLElement, b = m.container.querySelector("#b") as HTMLElement;
    assert.match(a.textContent ?? "", /Islas del Rosario/);
    assert.doesNotMatch(a.textContent ?? "", /City tour\s*\$/);
    assert.match(b.textContent ?? "", /City tour/);
    // Editar la reserva de 2 habitaciones (sección b): agregar Islas para 4 pax.
    await act(async () => { click(boton(/^Servicios adicionales \(/, b)!); await espera(); });
    await act(async () => { click(boton(/Islas del Rosario/)!); await espera(); });
    const dialogo = document.querySelector('[role="dialog"]')!;
    await act(async () => { click(boton(/Seleccionar para este hotel/, dialogo)!); await espera(); });
    await act(async () => { click(boton(/^Cerrar/, dialogo)!); await espera(COTIZAR); });
    assert.doesNotMatch(a.textContent ?? "", /Cambios sin confirmar/, "la otra reserva no entra en edición");
    await act(async () => { click(boton(/Confirmar actualización/, b)!); await espera(); });
    const r = resumen(m.carrito());
    assert.deepEqual(r.slice(0, 2), ["h1:hotel:1200000", "t55:55:180000>h1"], "la reserva de 1 habitación queda idéntica");
    assert.deepEqual(r.slice(2).map((s) => s.replace(/^\d+-\w+/, "nuevo")), ["h2:hotel:2400000", "t56b:56:170000>h2", "nuevo:55:360000>h2"]);
    m.desmontar();
  });

  test("todo el árbol en modo estricto (actualizador del carrito ejecutado dos veces): un hotel, sin duplicados, mismos ids", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, propsResultado()), null);
    let hotelId = "";
    await act(async () => {
      hotelId = m.carrito().addConjunto(sinId(hotelPersona("x")) as never, [sinId(tourGuardado("x", "x", 55, 180_000)) as never]);
      await espera();
    });
    const idTour = m.carrito().items[1].id;
    assert.match(m.texto(), /· 1 elegido/);
    await alternarServicio(m, /City tour/);
    await act(async () => { click(confirmar(m)!); await espera(); });
    const items = m.carrito().items;
    assert.deepEqual(items.map((i) => i.tipo), ["hotel", "tour", "tour"], "nada duplicado aunque el actualizador corra dos veces");
    assert.equal(items[0].id, hotelId);
    assert.equal(items[1].id, idTour);
    assert.ok(items.slice(1).every((i) => i.tipo === "tour" && i.hotelItemId === hotelId));
    assert.equal(new Set(items.map((i) => i.id)).size, 3);
    assert.deepEqual(guardado().map((i) => i.id), items.map((i) => i.id));
    m.desmontar();
  });

  test("otras edades de los menores = otra reserva: no se marca como agregada ni se edita", async () => {
    const r = resultadoFixture({ menores: { infantes: 0, nino: 1, nino2: 0 }, edadesMenores: [8] });
    const m = await montar(h(Resultado, propsResultado(r)), [
      hotelPersona("h1", { ninos: 1, edadesMenores: [5] }), tourGuardado("t55", "h1", 55, 180_000),
    ]);
    assert.doesNotMatch(m.texto(), /En el carrito/);
    assert.match(m.texto(), /Agregar al carrito/);
    m.desmontar();
  });

  test("remontaje y recarga: el borrador no sobrevive (se descarta) y el carrito confirmado sí", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
    const m = await montar(h(Resultado, { ...propsResultado(), key: "uno" }), [hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    assert.match(m.texto(), /Cambios sin confirmar/);
    await m.render(h(Resultado, { ...propsResultado(), key: "dos" }));
    assert.doesNotMatch(m.texto(), /Cambios sin confirmar/, "una tarjeta nueva arranca de lo guardado");
    assert.match(m.texto(), /· 1 elegido/);
    assert.deepEqual(resumen(m.carrito()), ["h1:hotel:1200000", "t55:55:180000>h1"]);
    m.desmontar();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("#54 tarjeta por unidad (TarjetaUnidadBusqueda): editar servicios con el hotel ya en el carrito", () => {
  const llamadas: { pax: number; paqueteId: number }[] = [];
  const respuesta = () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] });
  before(() => { __setBuscarReceptivos(async (input: never) => { llamadas.push(input); return respuesta(); }); });
  after(() => __setBuscarReceptivos(null));

  const FECHAS_U = { fechaIda: "2030-11-01", fechaRegreso: "2030-11-04" };
  const opcion = {
    hotelId: 7, hotelNombre: "Hotel Unidad", paqueteId: 10, paqueteNombre: "Paquete Caribe", destinoNombre: "Cartagena",
    categoria: "Estandar", alimentacion: "Desayuno", moneda: "COP", precioVenta: 500_000, paxTotal: 2, ...FECHAS_U,
    ocupacion: [{ id: "h1", acom: "doble", adultos: 2, edadesMenores: [] }],
  } as unknown as Parameters<typeof TarjetaUnidadBusqueda>[0]["opciones"][number];
  const props = {
    hotel: { hotelId: 7, hotelNombre: "Hotel Unidad", destino: "Cartagena" }, opciones: [opcion], foto: null, estrellas: null,
    clasificacion: null, adultsOnly: false, petFriendly: false, descripcionPorPaquete: {}, addonsPorPaquete: ADDONS,
  } as never;
  const hotelUnidad = (id: string, over: Record<string, unknown> = {}) => ({
    id, tipo: "hotel", modeloTarifario: "unidad", paqueteId: 10, hotelId: 7, hotelNombre: "Hotel Unidad", destino: "Cartagena", fotoUrl: null,
    categoria: "Estandar", alimentacion: "Desayuno", salida: { tipo: "sin_vuelo", ...FECHAS_U },
    habitaciones: [{ id: "h1", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] }],
    precio: 500_000, moneda: "COP", composicionHabitaciones: COMPOSICION, ...over,
  });
  const tourU = (id: string, servicioId: number, precio: number) => ({ ...tourGuardado(id, "u1", servicioId, precio), ...FECHAS_U });
  const okUnidad = (pvp: number) => async (): Promise<CotizacionUnidad> => ({ ok: true, pvp, moneda: "COP", composicionHabitaciones: COMPOSICION, paxTotal: 2 });

  test("hidrata lo guardado; agregar un servicio revalida hotel y servicios y actualiza en una sola operación", async () => {
    bernalo.respuesta = okUnidad(500_000);
    const m = await montar(h(TarjetaUnidadBusqueda, props), [hotelUnidad("u1"), tourU("t55", 55, 180_000)]);
    assert.match(m.texto(), /En el carrito con este hotel/);
    assert.match(m.texto(), /· 1 elegido/);
    await alternarServicio(m, /City tour/);
    assert.equal(m.carrito().items.length, 2, "el borrador no toca el carrito");
    assert.match(m.texto(), /Total hotel \+ servicios\s*\$\s?765\.000/);
    const antesB = bernalo.llamadas.length, antesS = llamadas.length;
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.equal(bernalo.llamadas.length, antesB + 1, "el hotel se revalida en servidor");
    assert.equal(llamadas.length, antesS + 1, "los servicios se recotizan");
    const items = m.carrito().items;
    assert.equal(items[0].id, "u1");
    assert.ok(items[0].tipo === "hotel" && items[0].modeloTarifario === "unidad" && items[0].precio === 500_000);
    assert.deepEqual(items.slice(1).map((i) => i.tipo === "tour" && [i.servicioId, i.hotelItemId]), [[55, "u1"], [56, "u1"]]);
    assert.equal(items[1].id, "t55");
    m.desmontar();
  });

  test("la tarifa del hotel cambió al confirmar: no aplica; reconfirmar con el precio nuevo sí (sin bucle)", async () => {
    bernalo.respuesta = okUnidad(520_000);
    const m = await montar(h(TarjetaUnidadBusqueda, props), [hotelUnidad("u1"), tourU("t55", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    await act(async () => { click(confirmar(m)!); await espera(); });
    await act(async () => { await espera(COTIZAR); }); // recotización con la tarifa nueva
    assert.match(m.texto(), /La tarifa del hotel cambió/);
    assert.deepEqual(resumen(m.carrito()), ["u1:hotel:500000", "t55:55:180000>u1"]);
    assert.match(m.texto(), /\$\s?520\.000/);
    assert.match(m.texto(), /es distinta a la del carrito/);
    await act(async () => { click(confirmar(m)!); await espera(); });
    const items = m.carrito().items;
    assert.ok(items[0].tipo === "hotel" && items[0].id === "u1" && items[0].precio === 520_000, "aplica con el precio revalidado");
    assert.equal(items.length, 3);
    m.desmontar();
  });

  test("rechazo del servidor (hotel ya no disponible): el conjunto anterior queda intacto", async () => {
    bernalo.respuesta = async () => ({ ok: false, mensaje: "La tarifa ya no está disponible para estas fechas." });
    const m = await montar(h(TarjetaUnidadBusqueda, props), [hotelUnidad("u1"), tourU("t55", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.match(m.texto(), /La tarifa ya no está disponible para estas fechas/);
    assert.deepEqual(resumen(m.carrito()), ["u1:hotel:500000", "t55:55:180000>u1"]);
    m.desmontar();
  });

  test("StrictMode en la raíz (efectos dobles): confirmar llega al carrito y la tarjeta no queda en «Actualizando…»", async () => {
    bernalo.respuesta = okUnidad(500_000);
    const m = await montar(h(TarjetaUnidadBusqueda, props), null);
    let hotelId = "";
    await act(async () => {
      hotelId = m.carrito().addConjunto(sinId(hotelUnidad("x")) as never, [sinId(tourU("x", 55, 180_000)) as never]);
      await espera();
    });
    await alternarServicio(m, /City tour/);
    await act(async () => { click(confirmar(m)!); await espera(); });
    const items = m.carrito().items;
    assert.deepEqual(items.map((i) => i.tipo), ["hotel", "tour", "tour"]);
    assert.equal(items[0].id, hotelId);
    assert.ok(items.slice(1).every((i) => i.tipo === "tour" && i.hotelItemId === hotelId));
    assert.doesNotMatch(m.texto(), /Actualizando el carrito/);
    m.desmontar();
  });

  test("retirar todos: sin consultas al servidor; el hotel sigue con su id y su precio", async () => {
    const m = await montar(h(TarjetaUnidadBusqueda, props), [hotelUnidad("u1"), tourU("t55", 55, 180_000)]);
    await alternarServicio(m, /Islas del Rosario/, 30);
    const antesB = bernalo.llamadas.length, antesS = llamadas.length;
    await act(async () => { click(confirmar(m)!); await espera(); });
    assert.equal(bernalo.llamadas.length, antesB);
    assert.equal(llamadas.length, antesS);
    assert.deepEqual(resumen(m.carrito()), ["u1:hotel:500000"]);
    m.desmontar();
  });

  test("hotel eliminado durante la revalidación: no se recrea", async () => {
    const d = diferido<CotizacionUnidad>();
    bernalo.respuesta = () => d.promesa;
    const m = await montar(h(TarjetaUnidadBusqueda, props), [hotelUnidad("u1"), tourU("t55", 55, 180_000)]);
    await alternarServicio(m, /City tour/);
    await act(async () => { click(confirmar(m)!); await espera(); });
    await act(async () => { m.carrito().remove("u1"); await espera(); });
    await act(async () => { d.soltar({ ok: true, pvp: 500_000, moneda: "COP", composicionHabitaciones: COMPOSICION, paxTotal: 2 }); await espera(); });
    assert.deepEqual(m.carrito().items, []);
    assert.match(m.texto(), /Este hotel ya no está en el carrito/);
    m.desmontar();
  });

  test("agregar (sin estar en el carrito) cuando la tarifa cambió: el segundo clic agrega — ya no vuelve a contar como cambio", async () => {
    bernalo.respuesta = okUnidad(520_000);
    const m = await montar(h(TarjetaUnidadBusqueda, props), []);
    await alternarServicio(m, /Islas del Rosario/);
    await act(async () => { click(boton(/Agregar hotel \+ 1 servicio$/, m.container)!); await espera(); });
    // Los servicios se recotizan con la tarifa nueva (efecto de la
    // actualización asíncrona: corre al cerrar el act anterior).
    await act(async () => { await espera(COTIZAR); });
    assert.match(m.texto(), /La tarifa del hotel cambió/);
    assert.equal(m.carrito().items.length, 0);
    assert.equal(bernalo.llamadas.length > 0, true);
    await act(async () => { click(boton(/Agregar hotel \+ 1 servicio$/, m.container)!); await espera(); });
    const items = m.carrito().items;
    assert.deepEqual(items.map((i) => i.tipo), ["hotel", "tour"], "el conjunto entra con el precio revalidado");
    assert.ok(items[0].tipo === "hotel" && items[0].precio === 520_000);
    m.desmontar();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Hallazgo 2 de la auditoría: `actualizarConjunto` debe responder lo que
// REALMENTE se aplica, también cuando en el mismo lote de React hubo otro
// cambio del carrito (antes respondía `ok:true` con el carrito ya vacío).
describe("#54 actualizarConjunto: la respuesta es el cambio realmente aplicado (mismo lote de React)", () => {
  const sembrado = () => [
    hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000),
    hotelPersona("h2", { hotelId: 2, hotelNombre: "Hotel Caribe" }),
  ];
  const cambioCon = (c: Carrito, servicios: unknown[]) => ({
    hotelItemId: "h1", firmaEsperada: firmaConjunto(c.items, "h1")!, hotel: sinId(hotelPersona("h1")) as never, servicios: servicios as never,
  });
  const t = (servicioId: number, precio: number) => sinId(tourGuardado("x", "x", servicioId, precio));
  const ids = (c: Carrito) => c.items.map((i) => (i.tipo === "tour" ? `${i.servicioId}>${i.hotelItemId}` : i.id));

  test("remove(hotel) y luego actualizarConjunto con la firma previa: rechazo hotel_no_encontrado; nada recreado ni huérfano", async () => {
    const m = await montar(h("div"), sembrado());
    const cambio = cambioCon(m.carrito(), [t(56, 85_000)]);
    let res: unknown;
    await act(async () => { m.carrito().remove("h1"); res = m.carrito().actualizarConjunto(cambio); await espera(); });
    assert.deepEqual(res, { ok: false, motivo: "hotel_no_encontrado" });
    assert.deepEqual(ids(m.carrito()), ["h2"]);
    assert.deepEqual(guardado().map((i) => i.id), ["h2"]);
    m.desmontar();
  });

  test("dos ediciones competidoras con la misma firma: la primera aplica, la segunda conjunto_cambio; queda la primera", async () => {
    const m = await montar(h("div"), sembrado());
    const primera = cambioCon(m.carrito(), [t(56, 85_000)]);
    const segunda = cambioCon(m.carrito(), [t(55, 180_000), t(57, 10_000)]);
    let r1: unknown, r2: unknown;
    await act(async () => { r1 = m.carrito().actualizarConjunto(primera); r2 = m.carrito().actualizarConjunto(segunda); await espera(); });
    assert.deepEqual(r1, { ok: true });
    assert.deepEqual(r2, { ok: false, motivo: "conjunto_cambio" });
    assert.deepEqual(ids(m.carrito()), ["h1", "56>h1", "h2"]);
    m.desmontar();
  });

  test("editar y luego quitar en el mismo lote: la edición sí se aplicó (respuesta cierta) y después sale el hotel entero", async () => {
    const m = await montar(h("div"), sembrado());
    const cambio = cambioCon(m.carrito(), [t(56, 85_000)]);
    let res: unknown;
    await act(async () => { res = m.carrito().actualizarConjunto(cambio); m.carrito().remove("h1"); await espera(); });
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(ids(m.carrito()), ["h2"], "ni el hotel ni sus servicios quedan");
    m.desmontar();
  });

  test("un add() de otro ítem en el mismo lote no invalida la edición (la firma es solo del conjunto)", async () => {
    const m = await montar(h("div"), sembrado());
    const cambio = cambioCon(m.carrito(), [t(56, 85_000)]);
    let res: unknown;
    await act(async () => {
      m.carrito().add(sinId({ ...tourGuardado("x", "x", 70, 9_000), paqueteId: 11 }) as never);
      res = m.carrito().actualizarConjunto(cambio);
      await espera();
    });
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(ids(m.carrito()), ["h1", "56>h1", "h2", "70>undefined"]);
    m.desmontar();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Hallazgo 3 de la auditoría: con <StrictMode> en la raíz (efectos dobles,
// como Next en desarrollo) la hidratación perdía el carrito: items=0 y
// localStorage reescrito con [].
describe("#54 hidratación: localStorage precargado ANTES de montar con <StrictMode> en la raíz", () => {
  test("conserva hotel, servicios, ids, contenido y almacenamiento; una edición posterior persiste y se relee", async () => {
    const items = [
      hotelPersona("h1"), tourGuardado("t55", "h1", 55, 180_000), tourGuardado("t56", "h1", 56, 85_000),
      hotelPersona("h2", { hotelId: 2, hotelNombre: "Hotel Caribe" }),
    ];
    const crudo = JSON.stringify(items);
    const m = await montar(h("div"), items);
    assert.deepEqual(m.carrito().items.map((i) => i.id), ["h1", "t55", "t56", "h2"]);
    assert.deepEqual(m.carrito().items, JSON.parse(crudo), "mismo contenido, campo por campo");
    assert.equal(localStorage.getItem(CLAVE_CARRITO), crudo, "el almacenamiento no se reescribe con []");
    // Una edición confirmada después de hidratar persiste…
    let res: unknown;
    await act(async () => {
      res = m.carrito().actualizarConjunto({
        hotelItemId: "h1", firmaEsperada: firmaConjunto(m.carrito().items, "h1")!, hotel: sinId(hotelPersona("h1")) as never,
        servicios: [sinId(tourGuardado("x", "x", 56, 85_000))] as never,
      });
      await espera();
    });
    assert.deepEqual(res, { ok: true });
    m.desmontar();
    assert.deepEqual(guardado().map((i) => i.id), ["h1", "t56", "h2"]);
    // …y un remontaje (recarga) en modo estricto la relee igual.
    const antes = localStorage.getItem(CLAVE_CARRITO);
    const c2 = document.createElement("div");
    let api!: Carrito;
    function Espia() { api = useCart(); return null; }
    const r2 = createRoot(c2);
    await act(async () => { r2.render(h(React.StrictMode, null, h(CartProvider, null, h(Espia, null)))); await espera(); });
    assert.deepEqual(api.items.map((i) => i.id), ["h1", "t56", "h2"]);
    assert.equal(localStorage.getItem(CLAVE_CARRITO), antes);
    act(() => r2.unmount());
  });
});
