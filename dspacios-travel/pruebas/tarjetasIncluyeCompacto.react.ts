// #52 — Incluye/No incluye COMPACTO en las tarjetas de hotel: prueba de
// INTERACCIÓN REACT (render real con jsdom, eventos DOM reales).
//
// Monta los componentes de PRODUCCIÓN tal cual están escritos:
//   · `Resultado` (BuscadorBooking.tsx) — tarjeta del motor de búsqueda
//     por persona; su paquete es fijo (`r.paqueteId`).
//   · `TarjetaUnidadBusqueda` (VistaBooking.tsx) — tarjeta del motor por
//     unidad; su paquete depende de la categoría/alimentación elegida.
//   · `SeccionesIncluye` suelto — lo que renderizan los modales
//     (HotelModal/HotelBernaloCotizarModal), SIN el envoltorio compacto.
//
// Sin JSX (este archivo lo transforma esbuild vía reactLoader, pero se
// mantiene `React.createElement` igual que las demás pruebas .react.ts).
// Ejecutar: node --experimental-test-module-mocks \
//   --experimental-loader ./pruebas/support/reactLoader.mjs \
//   --test pruebas/tarjetasIncluyeCompacto.react.ts

import { test, describe, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- globals de jsdom para que React/ReactDOM encuentren un DOM.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// ── Medición SIMULADA del recorte ──────────────────────────────────────────
// jsdom NO hace layout: `scrollHeight`/`clientHeight` valen siempre 0, así que
// aquí no se puede saber si un texto cabe en 2 líneas. Esta prueba NO valida
// layout real (eso se verificó aparte en Chromium a 320/375 px); valida la
// LÓGICA: que el componente lea la medición del DOM de cada ítem compacto
// (`[data-recorte]`), muestre "Ver más" cuando esa medición dice "recortado"
// aunque el texto sea corto, y vuelva a medir al cambiar el ancho
// (ResizeObserver) o la descripción.
//   · `textosRecortados`: los textos que la prueba declara "no caben en 2
//     líneas" (simula un ancho angosto). Solo afecta a `[data-recorte]`; el
//     resto de elementos sigue en 0/0 como en jsdom puro.
//   · `cambiarAncho(...)`: cambia ese conjunto y dispara los ResizeObserver
//     vivos, igual que haría el navegador al cambiar el ancho de la tarjeta.
let textosRecortados = new Set<string>();
const ALTO_DOS_LINEAS = 32;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get(this: HTMLElement) { return this.hasAttribute("data-recorte") ? ALTO_DOS_LINEAS : 0; },
});
Object.defineProperty(dom.window.HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get(this: HTMLElement) {
    if (!this.hasAttribute("data-recorte")) return 0;
    return textosRecortados.has(this.textContent ?? "") ? ALTO_DOS_LINEAS + 16 : ALTO_DOS_LINEAS;
  },
});
type Observador = { cb: ResizeObserverCallback; yo: unknown };
const observadores = new Set<Observador>();
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  private o: Observador;
  constructor(cb: ResizeObserverCallback) { this.o = { cb, yo: this }; }
  observe() { observadores.add(this.o); }
  unobserve() {}
  disconnect() { observadores.delete(this.o); }
};

// `VistaBooking.tsx` importa dos Server Actions reales ("use server") que
// terminan en `next/headers` (no resoluble fuera de un servidor Next) y que
// `TarjetaUnidadBusqueda` NO ejecuta al montar. Se sustituyen aquí por stubs
// que lanzan si se invocan de verdad, en vez de ampliar el loader compartido.
const noDebeInvocarse = (nombre: string) => async () => { throw new Error(`${nombre}: no debe invocarse en esta prueba`); };
mock.module(new URL("../app/tarifario/cotizacionBernaloActions.ts", import.meta.url).href, {
  namedExports: { cotizarAlojamientoBernaloPublico: noDebeInvocarse("cotizarAlojamientoBernaloPublico") },
});
mock.module(new URL("../app/tarifario/detalle-actions.ts", import.meta.url).href, {
  namedExports: { obtenerDetalleHotel: noDebeInvocarse("obtenerDetalleHotel"), obtenerDetalleSalida: noDebeInvocarse("obtenerDetalleSalida") },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { TarjetaUnidadBusqueda } = await import("../app/tarifario/VistaBooking.tsx");
const { SeccionesIncluye, IncluyeCompacto, resumirSecciones, RESUMEN_MAX_ITEMS } =
  await import("../app/tarifario/tarjetaHotelCompartida.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const h = React.createElement;

type Desc = { incluye: string | null; noIncluye: string | null; tarifasEspeciales: string | null; condicionesComerciales: string | null };
const desc = (p: Partial<Desc>): Desc => ({ incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null, ...p });
const lineas = (prefijo: string, n: number) => Array.from({ length: n }, (_, i) => `${prefijo} ${i + 1}`).join("\n");

// ── Fixtures ────────────────────────────────────────────────────────────────
function combo(categoria: string, regimen: string, total: number) {
  return { categoria, regimen, total, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 } };
}
function resultadoFixture(paqueteId = 10) {
  return {
    hotelId: 1, hotelNombre: "Hotel Almirante", destino: "Cartagena",
    paqueteId, categoria: "Estandar", regimen: "Desayuno",
    paqueteNombre: "Paquete Caribe", total: 400000, noches: 3, moneda: "COP",
    fechaIda: "2026-10-15", fechaRegreso: "2026-10-18",
    habitaciones: { doble: 1 },
    menores: { infantes: 0, nino: 0, nino2: 0 },
    edadesMenores: [], pax: 2,
    combos: [combo("Estandar", "Desayuno", 400000), combo("Superior", "Desayuno", 600000)],
    condicion: null,
  } as Parameters<typeof Resultado>[0]["r"];
}
function opcionUnidad(paqueteId: number, categoria: string, alimentacion: string, precioVenta: number) {
  return {
    hotelId: 7, hotelNombre: "Hotel Bernalo", paqueteId, paqueteNombre: `Paquete ${paqueteId}`, destinoNombre: "Bernalo",
    categoria, alimentacion, moneda: "COP", precioVenta, paxTotal: 2,
    fechaIda: "2026-11-01", fechaRegreso: "2026-11-04",
    ocupacion: [{ id: "h1", acom: "doble", adultos: 2, edadesMenores: [] }],
  } as unknown as Parameters<typeof TarjetaUnidadBusqueda>[0]["opciones"][number];
}

// ── Utilidades de montaje ──────────────────────────────────────────────────
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let itemsCarrito: unknown[] = [];

function CartSpy() {
  const { items } = useCart();
  // Se copia en un efecto (no durante el render): act() lo vacía antes de cada aserción.
  React.useEffect(() => { itemsCarrito = items; });
  return null;
}
function montar(...hijos: ReactNode[]) {
  act(() => {
    root.render(h(CartProvider, null, ...hijos, h(CartSpy)));
  });
}
function tarjetaResultado(descripcionPorPaquete: Record<number, Desc>, paqueteId = 10, key?: string) {
  return h(Resultado, {
    key, r: resultadoFixture(paqueteId), foto: null, descripcionPorPaquete, addonsPorPaquete: new Map(),
  } as never);
}
function tarjetaUnidad(descripcionPorPaquete: Record<number, Desc>) {
  return h(TarjetaUnidadBusqueda, {
    hotel: { hotelId: 7, hotelNombre: "Hotel Bernalo", destino: "Bernalo" },
    opciones: [
      opcionUnidad(1, "Estandar", "Desayuno", 500000),
      opcionUnidad(2, "Superior", "Desayuno", 700000),
    ],
    foto: null, estrellas: 4, clasificacion: null, adultsOnly: false, petFriendly: false,
    descripcionPorPaquete, addonsPorPaquete: new Map(),
  } as never);
}

const botonesVerMas = (raiz: ParentNode = container) =>
  [...raiz.querySelectorAll("button")].filter((b) => /^Ver (más|menos)$/.test(b.textContent?.trim() ?? "")) as HTMLButtonElement[];
const textoItems = (raiz: ParentNode = container) => [...raiz.querySelectorAll("li")].map((li) => li.textContent?.trim() ?? "");
const items = (raiz: ParentNode, prefijo: string) => textoItems(raiz).filter((t) => t.startsWith(prefijo));
const clic = (el: Element) => act(() => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); });
function elegir(select: HTMLSelectElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, valor);
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
function cambiarAncho(recortados: string[]) {
  textosRecortados = new Set(recortados);
  act(() => {
    for (const o of [...observadores]) o.cb([], o.yo as ResizeObserver);
  });
}
function selectPorEtiqueta(etiqueta: string): HTMLSelectElement {
  const span = [...container.querySelectorAll("label > span")].find((s) => s.textContent?.trim() === etiqueta);
  assert.ok(span, `no se encontró la etiqueta "${etiqueta}"`);
  return span!.parentElement!.querySelector("select") as HTMLSelectElement;
}

before(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
beforeEach(() => {
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  itemsCarrito = [];
  textosRecortados = new Set();
});
after(() => container.remove());

// ═══ resumirSecciones (criterio del resumen) ═══════════════════════════════
describe("resumirSecciones — criterio ÚNICO del resumen compacto", () => {
  const sec = (titulo: string, items: string[]) => ({ titulo, items });

  test("constante del criterio: 2 ítems por sección", () => {
    assert.equal(RESUMEN_MAX_ITEMS, 2);
  });

  test("texto corto (≤2 ítems cortos en incluye/no incluye): se ve todo y no hay 'ver más'", () => {
    const r = resumirSecciones([sec("El programa incluye", ["Desayuno", "Wifi"]), sec("El programa no incluye", ["Propinas"])]);
    assert.equal(r.hayMas, false);
    assert.deepEqual(r.secciones.map((s) => s.items), [["Desayuno", "Wifi"], ["Propinas"]]);
  });

  test("más de 2 ítems: recorta a 2 y marca hayMas", () => {
    const r = resumirSecciones([sec("El programa incluye", ["a", "b", "c"])]);
    assert.deepEqual(r.secciones[0].items, ["a", "b"]);
    assert.equal(r.hayMas, true);
  });

  test("la LONGITUD del texto no decide nada en el criterio estructural (el recorte se mide en el DOM)", () => {
    assert.equal(resumirSecciones([sec("El programa incluye", ["x".repeat(10)])]).hayMas, false);
    assert.equal(resumirSecciones([sec("El programa incluye", ["x".repeat(500)])]).hayMas, false);
  });

  test("tarifas especiales y condiciones comerciales no entran al resumen pero marcan hayMas", () => {
    const r = resumirSecciones([sec("El programa incluye", ["a"]), sec("Tarifas especiales", ["t"]), sec("Condiciones comerciales", ["c"])]);
    assert.deepEqual(r.secciones.map((s) => s.titulo), ["El programa incluye"]);
    assert.equal(r.hayMas, true);
  });

  test("sin incluye/no incluye: muestra la primera sección existente (nunca queda solo un botón)", () => {
    const r = resumirSecciones([sec("Tarifas especiales", ["t"]), sec("Condiciones comerciales", ["c"])]);
    assert.deepEqual(r.secciones.map((s) => s.titulo), ["Tarifas especiales"]);
    assert.equal(r.hayMas, true);
  });

  test("sin secciones: resumen vacío y sin 'ver más'", () => {
    assert.deepEqual(resumirSecciones([]), { secciones: [], hayMas: false });
  });
});

// ═══ Resultado (motor de búsqueda por persona) ═════════════════════════════
describe("Resultado — Incluye/No incluye compacto", () => {
  const larga = desc({ incluye: lineas("Incluido", 5), noIncluye: lineas("Excluido", 3), tarifasEspeciales: "Niños gratis", condicionesComerciales: "Pago 100%" });

  test("texto LARGO: compacto muestra 2+2 ítems, oculta el resto y ofrece 'Ver más'", () => {
    montar(tarjetaResultado({ 10: larga }));
    assert.deepEqual(items(container, "Incluido"), ["Incluido 1", "Incluido 2"]);
    assert.deepEqual(items(container, "Excluido"), ["Excluido 1", "Excluido 2"]);
    assert.equal(container.textContent?.includes("Niños gratis"), false);
    const [b] = botonesVerMas();
    assert.equal(botonesVerMas().length, 1);
    assert.equal(b.getAttribute("aria-expanded"), "false");
    assert.equal(b.type, "button");
  });

  test("'Ver más' muestra TODO (las 4 secciones) y 'Ver menos' regresa al tamaño compacto", () => {
    montar(tarjetaResultado({ 10: larga }));
    clic(botonesVerMas()[0]);
    assert.equal(items(container, "Incluido").length, 5);
    assert.equal(items(container, "Excluido").length, 3);
    assert.ok(container.textContent?.includes("Niños gratis") && container.textContent.includes("Pago 100%"));
    const b = botonesVerMas()[0];
    assert.equal(b.textContent?.trim(), "Ver menos");
    assert.equal(b.getAttribute("aria-expanded"), "true");
    clic(b);
    assert.equal(items(container, "Incluido").length, 2);
    assert.equal(container.textContent?.includes("Niños gratis"), false);
    assert.equal(botonesVerMas()[0].textContent?.trim(), "Ver más");
  });

  test("texto CORTO: se ve completo y NO hay botón", () => {
    montar(tarjetaResultado({ 10: desc({ incluye: "Desayuno\nWifi", noIncluye: "Propinas" }) }));
    assert.deepEqual(items(container, "").filter((t) => ["Desayuno", "Wifi", "Propinas"].includes(t)), ["Desayuno", "Wifi", "Propinas"]);
    assert.equal(botonesVerMas().length, 0);
  });

  test("texto AUSENTE (sin paquete en el mapa, o 4 campos vacíos): no hay bloque ni botón", () => {
    montar(tarjetaResultado({}));
    assert.equal(botonesVerMas().length, 0);
    assert.equal(container.textContent?.includes("El programa incluye"), false);
    montar(tarjetaResultado({ 10: desc({ incluye: "  \n ", noIncluye: null }) }));
    assert.equal(botonesVerMas().length, 0);
    assert.equal(container.textContent?.includes("El programa"), false);
  });

  // ── Regresión P2 (auditoría Chat #4): texto de ≤60 caracteres que NO cabe
  // en 2 líneas. Antes el botón dependía de contar caracteres y este ítem
  // quedaba cortado sin forma de leerlo. (Medición simulada, ver arriba.)
  const corto60 = "Traslado privado aeropuerto - hotel con asistencia bilingüe";

  test("regresión P2: ítem de ≤60 caracteres RECORTADO por el ancho ofrece 'Ver más' y se lee completo", () => {
    assert.ok(corto60.length <= 60, `el fixture debe tener ≤60 caracteres (tiene ${corto60.length})`);
    textosRecortados = new Set([corto60]);
    montar(tarjetaResultado({ 10: desc({ incluye: corto60, noIncluye: "Propinas" }) }));
    const b = botonesVerMas();
    assert.equal(b.length, 1, "sin el botón, el ítem quedaría cortado e inaccesible");
    assert.equal(b[0].getAttribute("aria-expanded"), "false");
    assert.ok(container.querySelector("[data-recorte]"), "el resumen compacto marca sus ítems para medirlos");
    clic(b[0]);
    assert.equal(botonesVerMas()[0].getAttribute("aria-expanded"), "true");
    assert.ok(textoItems().includes(corto60));
    assert.equal(container.querySelector("[data-recorte]"), null, "expandido muestra la vista completa, sin recorte");
    clic(botonesVerMas()[0]);
    assert.ok(container.querySelector("[data-recorte]"), "'Ver menos' vuelve al resumen compacto");
    assert.equal(botonesVerMas()[0].textContent?.trim(), "Ver más", "al cerrar se vuelve a medir y el botón sigue disponible");
  });

  test("el MISMO texto de ≤60 caracteres que sí cabe no muestra botón (no se decide por contar caracteres)", () => {
    montar(tarjetaResultado({ 10: desc({ incluye: corto60, noIncluye: "Propinas" }) }));
    assert.equal(botonesVerMas().length, 0);
  });

  test("un texto muy largo solo muestra botón si de verdad se recorta", () => {
    const largo = "Traslado aeropuerto - hotel - aeropuerto en servicio privado con asistencia en español las 24 horas";
    montar(tarjetaResultado({ 10: desc({ incluye: largo }) }));
    assert.equal(botonesVerMas().length, 0, "en una tarjeta ancha cabe completo: sin botón");
    cambiarAncho([largo]);
    assert.equal(botonesVerMas().length, 1);
    clic(botonesVerMas()[0]);
    assert.ok(textoItems().includes(largo));
  });

  test("cambio de ANCHO: al angostar aparece 'Ver más'; al ensanchar desaparece (ResizeObserver)", () => {
    montar(tarjetaResultado({ 10: desc({ incluye: corto60, noIncluye: "Propinas" }) }));
    assert.equal(botonesVerMas().length, 0);
    assert.ok(observadores.size > 0, "el resumen observa su tamaño");
    cambiarAncho([corto60]);
    assert.equal(botonesVerMas().length, 1);
    cambiarAncho([]);
    assert.equal(botonesVerMas().length, 0);
  });

  test("cambio de CONTENIDO: una descripción nueva se mide desde cero (aparece o desaparece el botón)", () => {
    const otro = "Cena romántica frente al mar una noche de la estadía";
    textosRecortados = new Set([otro]);
    montar(tarjetaResultado({ 10: desc({ incluye: corto60 }) }));
    assert.equal(botonesVerMas().length, 0);
    montar(tarjetaResultado({ 10: desc({ incluye: otro }) }));
    assert.equal(botonesVerMas().length, 1, "el texto nuevo recortado tiene su botón");
    clic(botonesVerMas()[0]);
    assert.equal(botonesVerMas()[0].getAttribute("aria-expanded"), "true");
    montar(tarjetaResultado({ 10: desc({ incluye: corto60 }) }));
    assert.equal(botonesVerMas().length, 0, "texto nuevo que cabe: sin botón, sin arrastrar el estado anterior");
    assert.ok(container.querySelector("[data-recorte]"), "vuelve al resumen compacto");
  });

  test("P2 (estructura): expandida, cada texto va en su propio <span min-w-0 overflow-wrap:anywhere> sin recorte", () => {
    textosRecortados = new Set([corto60]);
    montar(tarjetaResultado({ 10: larga }));
    clic(botonesVerMas()[0]);
    const spans = [...container.querySelectorAll("li > span")];
    assert.equal(spans.length, 5 + 3 + 1 + 1, "las 4 secciones completas");
    for (const s of spans) {
      assert.match(s.className, /\bmin-w-0\b/);
      assert.match(s.className, /\[overflow-wrap:anywhere\]/);
      assert.doesNotMatch(s.className, /line-clamp/, "expandida no recorta");
      assert.equal(s.hasAttribute("data-recorte"), false);
    }
  });

  test("P3 (lógica): si al cerrar el control desaparece, el foco va a la región del bloque de ESA tarjeta (no a <body>)", () => {
    textosRecortados = new Set([corto60]);
    montar(tarjetaResultado({ 10: desc({ incluye: corto60 }) }));
    const b = botonesVerMas()[0];
    clic(b);
    act(() => b.focus());
    assert.equal(document.activeElement, b);
    textosRecortados = new Set(); // "se ensanchó la ventana": ahora cabe
    clic(b);
    assert.equal(botonesVerMas().length, 0, "el control desaparece (nada queda oculto)");
    const region = document.activeElement as HTMLElement;
    assert.notEqual(region, document.body);
    assert.equal(region.getAttribute("role"), "group");
    assert.equal(region.tabIndex, -1, "programable, pero no agrega una parada extra al Tab");
    assert.ok(container.contains(region));
    assert.ok(region.textContent?.includes(corto60));
  });

  test("P3 (lógica): sin foco en el botón, desaparecer el control NO mueve el foco", () => {
    textosRecortados = new Set([corto60]);
    montar(tarjetaResultado({ 10: desc({ incluye: corto60 }) }));
    assert.equal(botonesVerMas().length, 1);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    cambiarAncho([]);
    assert.equal(botonesVerMas().length, 0);
    assert.equal(document.activeElement, document.body);
  });

  test("recorte por tarjeta: solo la tarjeta cuyo ítem se recorta tiene botón, y se expande sola", () => {
    const otro = "Cena romántica frente al mar una noche de la estadía";
    textosRecortados = new Set([corto60]);
    montar(
      tarjetaResultado({ 10: desc({ incluye: corto60 }), 11: desc({ incluye: otro }) }, 10, "a"),
      tarjetaResultado({ 10: desc({ incluye: corto60 }), 11: desc({ incluye: otro }) }, 11, "b"),
    );
    assert.equal(botonesVerMas().length, 1);
    clic(botonesVerMas()[0]);
    assert.equal(container.querySelectorAll("[data-recorte]").length, 1, "la otra tarjeta sigue compacta");
  });

  test("solo Tarifas especiales/Condiciones (sin incluye/no incluye): muestra la primera sección y 'Ver más' trae la otra", () => {
    montar(tarjetaResultado({ 10: desc({ tarifasEspeciales: "Niños gratis", condicionesComerciales: "Pago 100%" }) }));
    assert.ok(container.textContent?.includes("Niños gratis"));
    assert.equal(container.textContent?.includes("Pago 100%"), false);
    clic(botonesVerMas()[0]);
    assert.ok(container.textContent?.includes("Pago 100%"));
  });

  test("accesibilidad: <button> nativo, aria-controls apunta a la región real, nombre accesible contiene el texto visible", () => {
    montar(tarjetaResultado({ 10: larga }));
    const b = botonesVerMas()[0];
    assert.equal(b.tagName, "BUTTON");
    const region = document.getElementById(b.getAttribute("aria-controls")!);
    assert.ok(region && container.contains(region), "aria-controls debe apuntar a un elemento de la tarjeta");
    assert.ok(region!.textContent?.includes("Incluido 1"));
    assert.ok(b.getAttribute("aria-label")!.includes(b.textContent!.trim()), "label-in-name: el nombre accesible incluye el texto visible");
    clic(b);
    assert.equal(document.getElementById(b.getAttribute("aria-controls")!)?.textContent?.includes("Incluido 5"), true);
    assert.ok(botonesVerMas()[0].getAttribute("aria-label")!.startsWith("Ver menos"));
  });

  test("foco/teclado: el botón conserva el foco al expandir y al colapsar (mismo nodo, no se remonta)", () => {
    montar(tarjetaResultado({ 10: larga }));
    const b = botonesVerMas()[0];
    act(() => b.focus());
    assert.equal(document.activeElement, b);
    clic(b);
    assert.equal(botonesVerMas()[0], b, "el botón es el MISMO nodo tras expandir");
    assert.equal(document.activeElement, b);
    clic(b);
    assert.equal(botonesVerMas()[0], b);
    assert.equal(document.activeElement, b);
    assert.equal(b.tabIndex >= 0, true, "alcanzable con Tab");
  });

  test("tacto/móvil: el botón no es menor de 36px de alto (min-h-9) y el texto del ítem rompe palabras larguísimas (overflow-wrap:anywhere)", () => {
    montar(tarjetaResultado({ 10: larga }));
    assert.match(botonesVerMas()[0].className, /\bmin-h-9\b/);
    const span = container.querySelector("li > span.line-clamp-2");
    assert.ok(span, "los ítems compactos se recortan a 2 líneas");
    assert.match(span!.className, /\[overflow-wrap:anywhere\]/);
    assert.match(span!.className, /\bmin-w-0\b/);
  });

  test("tarjetas INDEPENDIENTES: expandir una no expande la vecina", () => {
    montar(
      tarjetaResultado({ 10: larga, 11: larga }, 10, "a"),
      tarjetaResultado({ 10: larga, 11: larga }, 11, "b"),
    );
    assert.equal(botonesVerMas().length, 2);
    clic(botonesVerMas()[0]);
    const [a, b] = botonesVerMas();
    assert.equal(a.getAttribute("aria-expanded"), "true");
    assert.equal(b.getAttribute("aria-expanded"), "false");
    assert.equal(items(container, "Incluido").length, 5 + 2);
    clic(b);
    clic(botonesVerMas()[0]);
    const [a2, b2] = botonesVerMas();
    assert.equal(a2.getAttribute("aria-expanded"), "false");
    assert.equal(b2.getAttribute("aria-expanded"), "true");
  });

  test("expandir/colapsar NO altera precio mostrado ni carrito", () => {
    montar(tarjetaResultado({ 10: larga }));
    const antes = container.textContent!.replace(/Ver (más|menos)/g, "");
    const precioAntes = (container.textContent!.match(/\$\s?[\d.,]+/g) ?? []).join("|");
    clic(botonesVerMas()[0]);
    const precioExpandido = (container.textContent!.match(/\$\s?[\d.,]+/g) ?? []).join("|");
    assert.equal(precioExpandido, precioAntes);
    assert.ok(precioAntes.length > 0, "la tarjeta muestra un precio");
    assert.equal(itemsCarrito.length, 0);
    clic(botonesVerMas()[0]);
    assert.equal(itemsCarrito.length, 0);
    assert.ok(antes.includes("Hotel Almirante"));
  });

  test("el contenido sigue a la descripción recibida: si la oferta cambia, se muestra la NUEVA (y vuelve a compacto)", () => {
    montar(tarjetaResultado({ 10: larga }));
    clic(botonesVerMas()[0]);
    assert.equal(botonesVerMas()[0].getAttribute("aria-expanded"), "true");
    const otra = desc({ incluye: lineas("Otro", 4), noIncluye: "Nada" });
    montar(tarjetaResultado({ 10: otra }));
    assert.equal(items(container, "Incluido").length, 0, "no queda contenido de la oferta anterior");
    assert.deepEqual(items(container, "Otro"), ["Otro 1", "Otro 2"]);
    assert.equal(botonesVerMas()[0].getAttribute("aria-expanded"), "false");
  });
});

// ═══ TarjetaUnidadBusqueda (motor por unidad; el paquete depende de la oferta) ═══
describe("TarjetaUnidadBusqueda — Incluye/No incluye compacto y cambio de oferta/categoría", () => {
  const dA = desc({ incluye: lineas("A-incluye", 4), noIncluye: lineas("A-excluye", 3) });
  const dB = desc({ incluye: "B-incluye 1\nB-incluye 2", noIncluye: "B-excluye 1" });

  test("compacta la oferta seleccionada por defecto (la más barata)", () => {
    montar(tarjetaUnidad({ 1: dA, 2: dB }));
    assert.deepEqual(items(container, "A-incluye"), ["A-incluye 1", "A-incluye 2"]);
    assert.equal(items(container, "B-").length, 0);
    assert.equal(botonesVerMas().length, 1);
  });

  test("cambiar de categoría muestra SOLO la descripción del paquete de esa oferta (texto corto → sin botón)", () => {
    montar(tarjetaUnidad({ 1: dA, 2: dB }));
    elegir(selectPorEtiqueta("Categoría"), "Superior");
    assert.equal(items(container, "A-").length, 0, "nada de la oferta anterior");
    assert.deepEqual(items(container, "B-"), ["B-incluye 1", "B-incluye 2", "B-excluye 1"]);
    assert.equal(botonesVerMas().length, 0);
  });

  test("expandida + cambio de categoría: la descripción nueva sale compacta y de la oferta nueva; al volver, la anterior vuelve compacta", () => {
    const dBLarga = desc({ incluye: lineas("B-incluye", 5) });
    montar(tarjetaUnidad({ 1: dA, 2: dBLarga }));
    clic(botonesVerMas()[0]);
    assert.equal(items(container, "A-incluye").length, 4);
    elegir(selectPorEtiqueta("Categoría"), "Superior");
    assert.equal(items(container, "A-").length, 0);
    assert.deepEqual(items(container, "B-incluye"), ["B-incluye 1", "B-incluye 2"]);
    assert.equal(botonesVerMas()[0].getAttribute("aria-expanded"), "false");
    elegir(selectPorEtiqueta("Categoría"), "Estandar");
    assert.deepEqual(items(container, "A-incluye"), ["A-incluye 1", "A-incluye 2"]);
    assert.equal(items(container, "B-").length, 0);
  });

  test("regresión P2 en el motor externo: cambiar a una oferta cuyo ítem corto se recorta muestra 'Ver más'", () => {
    const corto = "Desayuno y cena tipo buffet en el restaurante principal";
    assert.ok(corto.length <= 60);
    textosRecortados = new Set([corto]);
    montar(tarjetaUnidad({ 1: desc({ incluye: "Wifi" }), 2: desc({ incluye: corto }) }));
    assert.equal(botonesVerMas().length, 0);
    elegir(selectPorEtiqueta("Categoría"), "Superior");
    assert.equal(botonesVerMas().length, 1);
    clic(botonesVerMas()[0]);
    assert.ok(textoItems().includes(corto));
    elegir(selectPorEtiqueta("Categoría"), "Estandar");
    assert.equal(botonesVerMas().length, 0, "la oferta anterior se mide de nuevo y cabe");
    assert.ok(textoItems().includes("Wifi"));
  });

  test("oferta SIN descripción: no hay bloque ni botón aunque la anterior sí tuviera", () => {
    montar(tarjetaUnidad({ 1: dA }));
    assert.equal(botonesVerMas().length, 1);
    elegir(selectPorEtiqueta("Categoría"), "Superior");
    assert.equal(botonesVerMas().length, 0);
    assert.equal(container.textContent?.includes("El programa incluye"), false);
  });

  test("expandir/colapsar no cambia el precio de la oferta ni toca el carrito", () => {
    montar(tarjetaUnidad({ 1: dA, 2: dB }));
    const precio = () => (container.textContent!.match(/\$\s?[\d.,]+/g) ?? []).join("|");
    const antes = precio();
    assert.ok(antes.length > 0);
    clic(botonesVerMas()[0]);
    assert.equal(precio(), antes);
    clic(botonesVerMas()[0]);
    assert.equal(precio(), antes);
    assert.equal(itemsCarrito.length, 0);
  });
});

// ═══ Modales (SeccionesIncluye sin el envoltorio) ═════════════════════════
describe("SeccionesIncluye fuera de las tarjetas (modales) — contenido COMPLETO", () => {
  const larga = desc({ incluye: lineas("Incluido", 5), noIncluye: lineas("Excluido", 3), tarifasEspeciales: "Niños gratis", condicionesComerciales: "Pago 100%" });

  test("sin <IncluyeCompacto> renderiza todo y sin botón (como HotelModal/HotelBernaloCotizarModal)", () => {
    textosRecortados = new Set(["Incluido 1", "Niños gratis"]);
    montar(h(SeccionesIncluye, { descripcion: larga }));
    assert.equal(container.querySelector("[data-recorte]"), null, "los modales no recortan ni miden");
    assert.equal(container.querySelector('[role="group"]'), null, "los modales no usan la región de la tarjeta");
    assert.equal(container.querySelectorAll("li > span").length, 0, "los modales conservan su markup de siempre (texto directo en el <li>)");
    assert.equal(items(container, "Incluido").length, 5);
    assert.equal(items(container, "Excluido").length, 3);
    assert.ok(container.textContent?.includes("Niños gratis") && container.textContent.includes("Pago 100%"));
    assert.equal(botonesVerMas().length, 0);
  });

  test("con <IncluyeCompacto> compacta; con compacto={false} explícito vuelve a ser completo", () => {
    montar(h(IncluyeCompacto, null, h(SeccionesIncluye, { descripcion: larga })));
    assert.equal(items(container, "Incluido").length, 2);
    montar(h(IncluyeCompacto, null, h(SeccionesIncluye, { descripcion: larga, compacto: false })));
    assert.equal(items(container, "Incluido").length, 5);
    assert.equal(botonesVerMas().length, 0);
  });

  test("compacto={true} explícito compacta aun sin envoltorio", () => {
    montar(h(SeccionesIncluye, { descripcion: larga, compacto: true }));
    assert.equal(items(container, "Incluido").length, 2);
    assert.equal(botonesVerMas().length, 1);
  });

  test("ausente: devuelve null (sin placeholder) en ambas variantes", () => {
    montar(h(SeccionesIncluye, { descripcion: undefined }), h(IncluyeCompacto, null, h(SeccionesIncluye, { descripcion: null })));
    assert.equal(container.innerHTML.replace(/<!--.*?-->/g, "").includes("El programa"), false);
    assert.equal(botonesVerMas().length, 0);
  });
});

// ═══ Layout REAL en Chromium (no jsdom) ═══════════════════════════════════
// jsdom no calcula geometría: no puede saber si un texto queda DENTRO de la
// tarjeta ni a dónde va el foco con Tab. Este bloque compila el
// `tarjetaHotelCompartida.tsx` real (esbuild + Tailwind 4, dependencias de
// desarrollo ya declaradas), lo monta en Chromium headless (@playwright/test)
// con la misma grilla/tarjeta que `Resultado` y mide con `getClientRects()`.
// Corre en un PROCESO HIJO para no mezclar los globals de jsdom de este archivo
// con Playwright, y no escribe archivos (todo va por stdin/setContent).
//
// Estilos: las clases del componente se leen del archivo REAL con Node (la
// misma lectura que ya hace esbuild para el bundle) y se pasan a Tailwind con
// `@source inline(...)`, con `source(none)`. NO se usa el escáner de archivos
// de Tailwind (`@source "<ruta>"`): en otra máquina Windows (PowerShell) ese
// escáner no extrajo ninguna clase del componente aunque esbuild sí lo leyó, y
// el resultado fue una tarjeta sin `line-clamp`/`min-w-0` en la que nada se
// recorta y el botón nunca aparece. Antes de medir se comprueban los ESTILOS
// COMPUTADOS en Chromium; si no están aplicados, falla con el diagnóstico.
// Nunca se omite (sin SKIP): sin Chromium o sin estilos, las pruebas FALLAN.
const SCRIPT_LAYOUT = String.raw`
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const RAIZ = process.env.RAIZ_APP;
const req = createRequire(join(RAIZ, "package.json"));
const esbuild = req("esbuild");
const reqTw = createRequire(req.resolve("@tailwindcss/postcss"));
const postcss = reqTw("postcss");
const tailwind = req("@tailwindcss/postcss");
const { chromium } = req("@playwright/test");
const COMPARTIDA = join(RAIZ, "app/tarifario/tarjetaHotelCompartida.tsx");

// Clases de la grilla/tarjeta del arnés (mismas que Resultado: VistaBooking.tsx:1930, BuscadorBooking.tsx:774).
const CLASES_ARNES = "flex flex-col flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white gap-3 gap-4 p-4 px-4 py-4 font-semibold text-gray-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
// Candidatos del componente real: todo token entre separadores (criterio
// amplio, como el extractor de Tailwind; lo que no es una utilidad válida no
// genera CSS). Se excluyen comillas, barra invertida, acento grave y llaves
// para que el token sea seguro dentro de inline("...") (las llaves activarían
// la expansión de Tailwind). Además, un token con paréntesis o corchetes MAL
// anidados (de comentarios/código: "(exploración:", "Categoria(", ").join(")
// hace que Tailwind descarte el RESTO de la lista inline sin avisar; solo se
// conservan tokens bien anidados (los valores arbitrarios reales, como
// "w-[min(20rem,calc(100vw-24px))]", lo están).
const bienAnidado = (t) => {
  const pila = [];
  for (const ch of t) {
    if (ch === "(" || ch === "[") pila.push(ch);
    else if (ch === ")" || ch === "]") { if (pila.pop() !== (ch === ")" ? "(" : "[")) return false; }
  }
  return pila.length === 0;
};
const fuenteComponente = readFileSync(COMPARTIDA, "utf8");
const candidatos = [...new Set(fuenteComponente.match(/[^\s"'\x60{}<>;\\]+/g) ?? [])].filter(bienAnidado);

const entrada = [
  'import React from "react";',
  'import { createRoot } from "react-dom/client";',
  "import { SeccionesIncluye, IncluyeCompacto } from " + JSON.stringify(COMPARTIDA) + ";",
  "const h = React.createElement;",
  'const d = (incluye) => ({ incluye, noIncluye: "Propinas", tarifasEspeciales: null, condicionesComerciales: null });',
  // Tarjeta 0: token SIN espacios de 60 "M" (el caso de la auditoría); tarjeta 1: texto normal corto.
  'const descs = [d("M".repeat(60)), d("Desayuno buffet\\nWifi")];',
  "function Tarjeta({ i, desc }) {",
  '  return h("div", { className: "flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white", "data-t": i },',
  '    h("div", { className: "flex flex-1 flex-col gap-3 p-4" },',
  '      h("p", { className: "font-semibold text-gray-800" }, "Tarjeta " + i),',
  "      h(IncluyeCompacto, null, h(SeccionesIncluye, { descripcion: desc })),",
  '      h("button", { type: "button", "data-agregar": "" }, "Agregar " + i)));',
  "}",
  'createRoot(document.getElementById("root")).render(',
  '  // "Inicio" va ANTES de la grilla para que el orden de Tab de la página sea realista. Ojo: Chrome guarda el punto de partida de la navegación secuencial en el botón eliminado, así que Tab llega a "Agregar 0" aun con el foco en <body>; lo que distingue el defecto P3 es la prueba de activeElement, no la de Tab.',
  '  h("div", { className: "px-4 py-4" }, h("button", { type: "button" }, "Inicio"), h("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" },',
  "    descs.map((desc, i) => h(Tarjeta, { key: i, i, desc })))));",
].join("\n");

const salida = { candidatos: candidatos.length };
let navegador;
try {
  const js = (await esbuild.build({
    stdin: { contents: entrada, resolveDir: RAIZ, loader: "js" }, bundle: true, write: false, format: "iife", platform: "browser",
    jsx: "automatic", alias: { "@": RAIZ, "next/image": join(RAIZ, "pruebas/support/stubs/nextImageStub.mjs") },
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  })).outputFiles[0].text;
  const fuenteCss = '@import "tailwindcss" source(none); @source inline(' + JSON.stringify(CLASES_ARNES + " " + candidatos.join(" ")) + ");" +
    " :root{--brand-primary:#1D7C9A;--brand-accent:#26BBD9;--brand-success:#66B596} body{margin:0;font-family:system-ui,sans-serif}";
  const css = (await postcss([tailwind()]).process(fuenteCss, { from: join(RAIZ, "styles/__layout_prueba.css") })).css;
  // El CSS debe traer las utilidades de las que depende la prueba ANTES de abrir el navegador.
  const requeridas = {
    ".line-clamp-2": ".line-clamp-2", ".min-w-0": ".min-w-0", ".overflow-hidden": ".overflow-hidden", ".p-4": ".p-4",
    "[overflow-wrap:anywhere]": "\\[overflow-wrap\\:anywhere\\]",
    // Valor arbitrario con paréntesis anidados, al FINAL del archivo: si un token roto cortara la lista inline, faltaría este.
    "max-h-[min(22rem,...)]": "max-h-\\[min\\(22rem",
  };
  salida.css = { bytes: css.length, faltan: Object.entries(requeridas).filter(([, v]) => !css.includes(v)).map(([k]) => k) };
  if (salida.css.faltan.length) throw new Error("Tailwind no generó utilidades requeridas: " + salida.css.faltan.join(", "));

  navegador = await chromium.launch();
  const p = await navegador.newPage({ viewport: { width: 320, height: 900 } });
  p.setDefaultTimeout(15_000);
  await p.setContent("<!doctype html><html><head><meta charset=utf-8><style>" + css + "</style></head><body><div id=root></div><script>" + js.replace(/<\/script/g, "<\\/script") + "</script></body></html>");
  await p.waitForSelector('[data-t="0"] [role="group"] li > span');
  const espera = () => p.waitForTimeout(150);

  // Estilos COMPUTADOS del primer ítem de la tarjeta 0 y de la tarjeta misma.
  const estilos = () => p.evaluate(() => {
    const card = document.querySelector('[data-t="0"]'); const s = card.querySelector('[role="group"] li > span');
    const cs = getComputedStyle(s), cc = getComputedStyle(card), ci = getComputedStyle(card.firstElementChild);
    return { webkitLineClamp: cs.webkitLineClamp, display: cs.display, minWidth: cs.minWidth, overflowWrap: cs.overflowWrap,
      cardOverflow: cc.overflow, cardPaddingInterno: ci.paddingLeft, cardWidth: Math.round(card.getBoundingClientRect().width),
      spanClientWidth: s.clientWidth, spanClientHeight: s.clientHeight, spanScrollHeight: s.scrollHeight, recorteMarcado: s.hasAttribute("data-recorte") };
  });
  const inicial = await estilos();
  salida.estilos = { inicial };
  const listo = inicial.webkitLineClamp === "2" && inicial.minWidth === "0px" && inicial.overflowWrap === "anywhere" &&
    inicial.cardOverflow === "hidden" && inicial.cardPaddingInterno === "16px";
  if (!listo) throw new Error("Estilos no aplicados en Chromium: " + JSON.stringify(inicial));
  await p.waitForSelector('[data-t="0"] button[aria-controls]');

  // Todo rectángulo de texto de la región debe caer DENTRO de la tarjeta, y
  // ningún elemento de la región puede tener contenido desbordado/oculto.
  const medir = () => p.evaluate(() => {
    const card = document.querySelector('[data-t="0"]'); const cr = card.getBoundingClientRect();
    const region = card.querySelector('[role="group"]');
    const w = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let fuera = 0, rects = 0, maxRight = 0, texto = "";
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue; texto += n.textContent;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) { rects++; maxRight = Math.max(maxRight, q.right);
        if (q.left < cr.left - 0.5 || q.right > cr.right + 0.5 || q.top < cr.top - 0.5 || q.bottom > cr.bottom + 0.5) fuera++; }
    }
    const desbordados = [region, ...region.querySelectorAll("*")].filter((el) => el.scrollWidth - el.clientWidth > 1 || el.scrollHeight - el.clientHeight > 1).length;
    return { cardRight: Math.round(cr.right), maxRight: Math.round(maxRight), rects, fuera, desbordados, tieneToken: texto.includes("M".repeat(60)),
      expandida: card.querySelector("button[aria-controls]")?.getAttribute("aria-expanded") };
  });
  salida.p2 = {};
  for (const ancho of [320, 375]) {
    await p.setViewportSize({ width: ancho, height: 900 }); await espera();
    const estilosCompacta = await estilos();
    const compacta = await medir();
    await p.locator('[data-t="0"] button[aria-controls]').focus(); await p.keyboard.press("Enter"); await espera();
    salida.p2[ancho] = { compacta, expandida: await medir(), estilosCompacta, estilosExpandida: await estilos() };
    await p.keyboard.press("Enter"); await espera();
  }
  // P3: expandir a 320 → ensanchar a 1280 (el token cabe) → Enter en "Ver menos" → Tab.
  await p.setViewportSize({ width: 320, height: 900 }); await espera();
  await p.locator('[data-t="0"] button[aria-controls]').focus(); await p.keyboard.press("Enter"); await espera();
  await p.setViewportSize({ width: 1280, height: 900 }); await espera();
  const antes = await p.evaluate(() => document.activeElement?.textContent ?? null);
  await p.keyboard.press("Enter"); await espera();
  const tras = await p.evaluate(() => { const a = document.activeElement; const c = document.querySelector('[data-t="0"]');
    return { tag: a?.tagName, role: a?.getAttribute("role"), enTarjeta: !!a && c.contains(a), botonPresente: !!c.querySelector("button[aria-controls]"),
      focusVisible: !!a && a.matches(":focus-visible") }; });
  await p.keyboard.press("Tab");
  const tab = await p.evaluate(() => { const a = document.activeElement;
    return { tag: a?.tagName, texto: a?.textContent, enTarjeta: !!a && document.querySelector('[data-t="0"]').contains(a) }; });
  salida.p3 = { antes, tras, tab };
} catch (e) {
  salida.error = String(e && e.stack || e);
} finally {
  // Chromium se cierra SIEMPRE, también si falló una espera o una comprobación.
  if (navegador) await navegador.close().catch(() => {});
}
process.stdout.write(JSON.stringify(salida));
`;

type EstilosLayout = {
  webkitLineClamp: string; display: string; minWidth: string; overflowWrap: string; cardOverflow: string; cardPaddingInterno: string;
  cardWidth: number; spanClientWidth: number; spanClientHeight: number; spanScrollHeight: number; recorteMarcado: boolean;
};
type MedidaLayout = { cardRight: number; maxRight: number; rects: number; fuera: number; desbordados: number; tieneToken: boolean; expandida: string | null };
type ResultadoLayout = {
  error?: string; candidatos?: number;
  css?: { bytes: number; faltan: string[] };
  estilos?: { inicial: EstilosLayout };
  p2?: Record<string, { compacta: MedidaLayout; expandida: MedidaLayout; estilosCompacta: EstilosLayout; estilosExpandida: EstilosLayout }>;
  p3?: { antes: string | null; tras: { tag: string; role: string | null; enTarjeta: boolean; botonPresente: boolean; focusVisible: boolean }; tab: { tag: string; texto: string; enTarjeta: boolean } };
};

describe("Layout REAL en Chromium — texto expandido dentro de la tarjeta (P2) y foco al colapsar (P3)", () => {
  let res: ResultadoLayout = {};
  before(async () => {
    const { spawnSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const raizApp = fileURLToPath(new URL("..", import.meta.url));
    const hijo = spawnSync(process.execPath, ["--input-type=module"], {
      input: SCRIPT_LAYOUT, cwd: raizApp, env: { ...process.env, RAIZ_APP: raizApp }, encoding: "utf8", timeout: 180_000,
    });
    if (!hijo.stdout) {
      res = { error: `proceso hijo sin salida (status ${hijo.status}, señal ${hijo.signal}${hijo.error ? `, ${hijo.error.message}` : ""}): ${hijo.stderr}` };
      return;
    }
    try { res = JSON.parse(hijo.stdout); } catch { res = { error: `salida no JSON: ${hijo.stdout}\n${hijo.stderr}` }; }
  });

  test("el entorno de layout real compila, monta el componente y aplica las utilidades CSS (sin error)", () => {
    assert.equal(res.error, undefined, res.error);
    assert.ok((res.candidatos ?? 0) > 0, "se leyeron clases del componente real");
    assert.deepEqual(res.css?.faltan, [], "Tailwind generó todas las utilidades requeridas");
  });

  test("estilos COMPUTADOS en Chromium antes de medir: ítem compacto con line-clamp 2, min-width 0 y overflow-wrap anywhere; tarjeta con overflow hidden", () => {
    assert.equal(res.error, undefined, res.error);
    for (const [ancho, e] of [["inicial", res.estilos!.inicial], ["320", res.p2!["320"].estilosCompacta], ["375", res.p2!["375"].estilosCompacta]] as const) {
      assert.equal(e.recorteMarcado, true, `${ancho}: el ítem medido es el del resumen`);
      assert.equal(e.webkitLineClamp, "2", `${ancho}: ${JSON.stringify(e)}`);
      assert.equal(e.minWidth, "0px", `${ancho}: ${JSON.stringify(e)}`);
      assert.equal(e.overflowWrap, "anywhere", `${ancho}: ${JSON.stringify(e)}`);
      assert.equal(e.cardOverflow, "hidden", `${ancho}: ${JSON.stringify(e)}`);
      assert.equal(e.cardPaddingInterno, "16px", `${ancho}: ${JSON.stringify(e)}`);
      assert.ok(e.spanClientWidth < e.cardWidth, `${ancho}: el ítem cabe en la tarjeta (${e.spanClientWidth} < ${e.cardWidth})`);
      assert.ok(e.spanScrollHeight > e.spanClientHeight, `${ancho}: el token de 60 "M" está recortado de verdad (${e.spanScrollHeight} > ${e.spanClientHeight})`);
    }
    for (const ancho of ["320", "375"]) {
      const e = res.p2![ancho].estilosExpandida;
      assert.equal(e.recorteMarcado, false, `${ancho}: expandida no marca recorte`);
      assert.equal(e.webkitLineClamp, "none", `${ancho}: expandida sin line-clamp`);
      assert.equal(e.minWidth, "0px");
      assert.equal(e.overflowWrap, "anywhere");
    }
  });

  for (const ancho of ["320", "375"]) {
    test(`P2 @${ancho}px: expandida, TODO el texto (token de 60 "M" sin espacios) queda dentro del área visible de la tarjeta`, () => {
      assert.equal(res.error, undefined, res.error);
      const e = res.p2![ancho].expandida;
      assert.equal(e.expandida, "true");
      assert.ok(e.tieneToken, "el token completo está en la vista expandida");
      assert.ok(e.rects > 0);
      assert.equal(e.fuera, 0, `rectángulos de texto fuera de la tarjeta (texto hasta x=${e.maxRight}, tarjeta termina en x=${e.cardRight})`);
      assert.ok(e.maxRight <= e.cardRight, `texto hasta x=${e.maxRight} > tarjeta x=${e.cardRight}`);
      assert.equal(e.desbordados, 0, "ningún elemento de la vista expandida oculta contenido desbordado");
    });

    test(`P2 @${ancho}px: compacta, el texto visible tampoco sale de la tarjeta (el recorte es a 2 líneas, con 'Ver más')`, () => {
      assert.equal(res.error, undefined, res.error);
      const c = res.p2![ancho].compacta;
      assert.equal(c.expandida, "false", "el token recortado ofrece 'Ver más'");
      assert.equal(c.fuera, 0);
    });
  }

  test("P3: expandir @320 → ensanchar @1280 → Enter en 'Ver menos': el foco queda en la región de ESA tarjeta, no en <body>", () => {
    assert.equal(res.error, undefined, res.error);
    const { antes, tras } = res.p3!;
    assert.equal(antes, "Ver menos", "la secuencia arranca con el foco en 'Ver menos'");
    assert.equal(tras.botonPresente, false, "a 1280px el texto cabe: el control desaparece (es la condición del defecto)");
    assert.notEqual(tras.tag, "BODY");
    assert.equal(tras.enTarjeta, true);
    assert.equal(tras.role, "group");
    assert.equal(tras.focusVisible, true, "el foco es visible (anillo :focus-visible)");
  });

  test("P3: el siguiente Tab continúa con el próximo control de la MISMA tarjeta", () => {
    assert.equal(res.error, undefined, res.error);
    assert.equal(res.p3!.tab.tag, "BUTTON");
    assert.equal(res.p3!.tab.texto, "Agregar 0");
    assert.equal(res.p3!.tab.enTarjeta, true);
  });

  // Evidencia legible en la salida de la prueba (diagnóstico para auditoría).
  test("diagnóstico: estilos computados y medidas por ancho", (t) => {
    t.diagnostic(JSON.stringify({ candidatos: res.candidatos, css: res.css, estilos: res.estilos, p2: res.p2, p3: res.p3 }));
    assert.equal(res.error, undefined, res.error);
  });
});
