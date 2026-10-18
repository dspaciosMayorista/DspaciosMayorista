// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #54 — Lo que sale del carrito DESPUÉS de editar los servicios de un hotel ya
// agregado, con las piezas reales (`Resultado`, `TarjetaUnidadBusqueda`,
// checkout `page.tsx`, `ModoComparativaBooking`) y el `CartProvider` real:
//   · checkout simple: el hotel viaja con su `itemId` de siempre y cada
//     servicio con `hotelItemId` = ese id; ni huérfanos ni duplicados;
//   · comparativa (#35) con dos hoteles admitidos y servicios distintos: cada
//     opción lleva SOLO sus servicios, vinculados a su propio hotel;
//   · editar una tarjeta por unidad no habilita Bernalo en comparativas.
// Sin escrituras reales: las Server Actions son stubs que capturan la entrada.
import * as nodeModule from "node:module";
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
// El checkout carga `crearComparativaCarrito` con import dinámico por alias:
// se redirige a un módulo que solo registra la entrada (mismo patrón que
// cotizacionComparativa35Ui.react.ts).
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos(`
    export async function crearComparativaCarrito(x) { globalThis.__cmp54.push(x); return { ok: false, error: "rechazo de prueba comparativa" }; }
  `),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const comparativas: { items: Record<string, unknown>[]; tours: Record<string, unknown>[] }[] = [];
(globalThis as unknown as { __cmp54: typeof comparativas }).__cmp54 = comparativas;

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
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.getBoundingClientRect = function () {
  return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON() {} };
};
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPOSICION = [{ habitacionId: "h1", adultos: 2, ninos: 0, infantes: 0 }];
mock.module(new URL("../app/tarifario/cotizacionBernaloActions.ts", import.meta.url).href, {
  namedExports: { cotizarAlojamientoBernaloPublico: async () => ({ ok: true, pvp: 500_000, moneda: "COP", composicionHabitaciones: COMPOSICION, paxTotal: 2 }) },
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
const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
const { ModoComparativaBooking } = await import("../lib/cotizacion/comparativaBooking.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { __setBuscarReceptivos, __setBuscarHoteles } = await import("./support/stubs/reservarActionsStub.mjs");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const COTIZAR = 400;
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

const FECHAS = { fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" };
const servicio = (servicioId: number, total: number) => ({
  servicioId, paqueteId: 10, nombre: servicioId === 55 ? "Islas del Rosario" : "City tour", destino: "CARTAGENA",
  descripcion: null, total, pax: 2, noches: 3, moneda: "COP", categoria: "tour",
});
const addon = (servicioId: number, nombre: string, desde: number) => ({
  servicioId, paqueteId: 10, nombre, destino: "CARTAGENA", descripcion: "Tour", foto: null, desde, moneda: "COP",
});
const ADDONS = new Map([[10, [addon(55, "Islas del Rosario", 90_000), addon(56, "City tour", 40_000)]]]);
function resultado(hotelId: number, hotelNombre: string, total: number) {
  const c = (regimen: string, t: number) => ({ categoria: "Estandar", regimen, total: t, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 } });
  return {
    hotelId, hotelNombre, destino: "CARTAGENA", paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", paqueteNombre: "Paquete Caribe",
    total, noches: 3, ...FECHAS, moneda: "COP", habitaciones: { doble: 1 }, menores: { infantes: 0, nino: 0, nino2: 0 }, edadesMenores: [], pax: 2,
    combos: [c("Desayuno", total)], condicion: null,
  } as Parameters<typeof Resultado>[0]["r"];
}
const tarjeta = (hotelId: number, nombre: string, total: number) =>
  h(Resultado, { r: resultado(hotelId, nombre, total), foto: null, info: { estrellas: null, clasificacion: null }, descripcionPorPaquete: {}, addonsPorPaquete: ADDONS });
const hotelPersona = (id: string, hotelId: number, hotelNombre: string, precio: number) => ({
  id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId, bloqueoId: null, hotelNombre, destino: "CARTAGENA", fotoUrl: null,
  categoria: "Estandar", regimen: "Desayuno", ...FECHAS, noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2,
  precio, moneda: "COP", edadesMenores: [], condicion: null,
});
const tourGuardado = (id: string, hotelItemId: string, servicioId: number, precio: number) => ({
  id, tipo: "tour", paqueteId: 10, servicioId, nombre: servicioId === 55 ? "Islas del Rosario" : "City tour", destino: "CARTAGENA",
  fotoUrl: null, ...FECHAS, noches: 3, pax: 2, precio, moneda: "COP", hotelItemId,
});

async function montar(secciones: Record<string, React.ReactNode>, items: unknown[]) {
  localStorage.clear();
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let api!: ReturnType<typeof useCart>;
  function Espia() { api = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => {
    // <StrictMode> en la raíz, como Next en desarrollo (efectos dobles).
    root.render(h(React.StrictMode, null, h(CartProvider, null,
      ...Object.entries(secciones).map(([id, el]) => h("section", { id, key: id }, el)),
      h(Espia, null))));
    await espera();
  });
  const seccion = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
  return { container, seccion, carrito: () => api, desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}

/** Marca/desmarca un servicio en la tarjeta `raiz` (lista → modal → cerrar). */
async function alternarServicio(raiz: HTMLElement, nombre: string) {
  await act(async () => { click(boton(/^Servicios adicionales \(/, raiz)!); await espera(); });
  // El ítem de la lista (popover, en un portal) lleva el «desde».
  await act(async () => { click(boton(new RegExp(`${nombre}.*desde`))!); await espera(); });
  const dialogo = document.querySelector('[role="dialog"]')!;
  await act(async () => { click(boton(/Seleccionar para este hotel|Seleccionado · quitar/, dialogo)!); await espera(); });
  await act(async () => { click(boton(/^Cerrar/, dialogo)!); await espera(COTIZAR); });
}
async function confirmarEn(raiz: HTMLElement) {
  const b = boton(/Confirmar actualización/, raiz);
  assert.ok(b && !b.disabled, `confirmar disponible en ${raiz.id}`);
  await act(async () => { click(b!); await espera(); });
}
async function llenarCliente(raiz: HTMLElement) {
  const escribir = (etiqueta: string, valor: string) => {
    const label = [...raiz.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!;
    const input = label.parentElement!.querySelector("input") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  await act(async () => {
    escribir("Nombres *", "Ana"); escribir("Apellidos *", "Pérez"); escribir("Documento *", "123"); escribir("Teléfono / WhatsApp *", "300");
    await espera();
  });
}

describe("#54 → checkout: el payload refleja la edición confirmada", () => {
  before(() => {
    __setBuscarReceptivos(async () => ({ ok: true, resultados: [servicio(55, 180_000), servicio(56, 85_000)] }));
    // Revalidación del hotel por persona: la misma oferta de cada tarjeta.
    __setBuscarHoteles(async () => ({ ok: true, resultados: [resultado(1, "Hotel Almirante", 1_200_000), resultado(2, "Hotel Caribe", 1_000_000)] }));
    stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
  });
  after(() => {
    __setBuscarReceptivos(null);
    __setBuscarHoteles(null);
    stub.__setCrearSolicitudReserva(null);
    window.history.pushState({}, "", "/tarifario/checkout");
  });

  test("checkout simple: hotel con su itemId de siempre y cada servicio vinculado a él", async () => {
    window.history.pushState({}, "", "/tarifario/checkout");
    const m = await montar({ tarjeta: tarjeta(1, "Hotel Almirante", 1_200_000), checkout: h(CheckoutPage) },
      [hotelPersona("h1", 1, "Hotel Almirante", 1_200_000), tourGuardado("t55", "h1", 55, 180_000)]);
    await alternarServicio(m.seccion("tarjeta"), "City tour");
    await confirmarEn(m.seccion("tarjeta"));
    assert.match(m.seccion("checkout").textContent ?? "", /City tour/, "el checkout ve el conjunto actualizado");
    await llenarCliente(m.seccion("checkout"));
    const antes = stub.__solicitudes.length;
    await act(async () => { click(boton(/Generar cotización y enviar solicitud/, m.seccion("checkout"))!); await espera(60); });
    assert.equal(stub.__solicitudes.length, antes + 1);
    const enviada = stub.__solicitudes.at(-1) as { items: Record<string, unknown>[]; tours: Record<string, unknown>[] };
    assert.equal(enviada.items.length, 1, "un solo hotel");
    assert.equal(enviada.items[0].itemId, "h1", "el hotel conserva su id");
    assert.deepEqual(enviada.tours.map((t) => [t.servicioId, t.hotelItemId, t.paqueteId, t.pax, t.fechaIda, t.fechaRegreso]),
      [[55, "h1", 10, 2, FECHAS.fechaIda, FECHAS.fechaRegreso], [56, "h1", 10, 2, FECHAS.fechaIda, FECHAS.fechaRegreso]]);
    m.desmontar();
  });

  test("comparativa con dos hoteles y servicios distintos tras editar ambos: cada opción con SOLO los suyos", async () => {
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    const m = await montar({
      a: tarjeta(1, "Hotel Almirante", 1_200_000), b: tarjeta(2, "Hotel Caribe", 1_000_000),
      modo: h(ModoComparativaBooking), checkout: h(CheckoutPage),
    }, [
      hotelPersona("h1", 1, "Hotel Almirante", 1_200_000), tourGuardado("t55", "h1", 55, 180_000), tourGuardado("t56", "h1", 56, 85_000),
      hotelPersona("h2", 2, "Hotel Caribe", 1_000_000),
    ]);
    // A: quita City tour (queda Islas). B: agrega City tour.
    await alternarServicio(m.seccion("a"), "City tour");
    await confirmarEn(m.seccion("a"));
    await alternarServicio(m.seccion("b"), "City tour");
    await confirmarEn(m.seccion("b"));
    const items = m.carrito().items;
    assert.deepEqual(items.map((i) => (i.tipo === "tour" ? `${i.servicioId}>${i.hotelItemId}` : i.id)), ["h1", "55>h1", "h2", "56>h2"]);

    // #35 sigue admitiendo esta comparativa (sin avisos).
    await act(async () => { click(boton(/Cotización comparativa/, m.seccion("modo"))!); await espera(); });
    assert.match(m.seccion("modo").textContent ?? "", /Hoteles en el carrito: 2 de 3/);
    assert.equal(m.seccion("modo").querySelectorAll('[role="alert"]').length, 0);
    assert.ok(m.seccion("modo").querySelector('a[href="/tarifario/checkout?modo=comparativa"]'));

    await llenarCliente(m.seccion("checkout"));
    const antes = comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.seccion("checkout"))!); await espera(60); });
    assert.equal(comparativas.length, antes + 1, "se envió la comparativa");
    const enviada = comparativas.at(-1)!;
    assert.deepEqual(enviada.items.map((i) => [i.itemId, i.hotelId]), [["h1", 1], ["h2", 2]]);
    assert.deepEqual(enviada.tours.map((t) => [t.servicioId, t.hotelItemId]), [[55, "h1"], [56, "h2"]], "cada servicio con su propia opción");
    assert.ok(!("total" in enviada), "nada se suma entre hoteles");
    assert.match(m.seccion("checkout").textContent ?? "", /rechazo de prueba comparativa/);
    m.desmontar();
  });

  test("tarjeta por unidad: se edita, pero Bernalo sigue sin poder compararse", async () => {
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    const FECHAS_U = { fechaIda: "2030-11-01", fechaRegreso: "2030-11-04" };
    const opcion = {
      hotelId: 7, hotelNombre: "Hotel Unidad", paqueteId: 10, paqueteNombre: "Paquete Caribe", destinoNombre: "Cartagena",
      categoria: "Estandar", alimentacion: "Desayuno", moneda: "COP", precioVenta: 500_000, paxTotal: 2, ...FECHAS_U,
      ocupacion: [{ id: "h1", acom: "doble", adultos: 2, edadesMenores: [] }],
    };
    const unidad = (id: string, hotelId: number) => ({
      id, tipo: "hotel", modeloTarifario: "unidad", paqueteId: 10, hotelId, hotelNombre: `Hotel ${hotelId}`, destino: "Cartagena", fotoUrl: null,
      categoria: "Estandar", alimentacion: "Desayuno", salida: { tipo: "sin_vuelo", ...FECHAS_U },
      habitaciones: [{ id: "h1", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] }], precio: 500_000, moneda: "COP", composicionHabitaciones: COMPOSICION,
    });
    const m = await montar({
      u: h(TarjetaUnidadBusqueda, {
        hotel: { hotelId: 7, hotelNombre: "Hotel Unidad", destino: "Cartagena" }, opciones: [opcion], foto: null, estrellas: null, clasificacion: null,
        adultsOnly: false, petFriendly: false, descripcionPorPaquete: {}, addonsPorPaquete: ADDONS,
      } as never),
      modo: h(ModoComparativaBooking), checkout: h(CheckoutPage),
    }, [unidad("u1", 7), unidad("u2", 8)]);
    await alternarServicio(m.seccion("u"), "City tour");
    await confirmarEn(m.seccion("u"));
    assert.deepEqual(m.carrito().items.map((i) => (i.tipo === "tour" ? `${i.servicioId}>${i.hotelItemId}` : i.id)), ["u1", "56>u1", "u2"]);
    await act(async () => { click(boton(/Cotización comparativa/, m.seccion("modo"))!); await espera(); });
    assert.match(m.seccion("modo").textContent ?? "", /Los hoteles por unidad \(Bernalo\) todavía no se pueden comparar/);
    assert.equal(m.seccion("modo").querySelector('a[href="/tarifario/checkout?modo=comparativa"]'), null);
    await llenarCliente(m.seccion("checkout"));
    const antes = comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.seccion("checkout"))!); await espera(60); });
    assert.equal(comparativas.length, antes, "no se envía nada");
    assert.match(m.seccion("checkout").textContent ?? "", /Los hoteles por unidad todavía no se pueden comparar/);
    m.desmontar();
  });
});
