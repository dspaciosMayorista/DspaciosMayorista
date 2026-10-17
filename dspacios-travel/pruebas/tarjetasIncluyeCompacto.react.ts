import { test, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- React necesita los globales del DOM en esta prueba.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noInvocar = async () => { throw new Error("No debe llamar al servidor"); };
mock.module(new URL("../app/tarifario/cotizacionBernaloActions.ts", import.meta.url).href, {
  namedExports: { cotizarAlojamientoBernaloPublico: noInvocar },
});
mock.module(new URL("../app/tarifario/detalle-actions.ts", import.meta.url).href, {
  namedExports: { obtenerDetalleHotel: noInvocar, obtenerDetalleSalida: noInvocar },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { TarjetaUnidadBusqueda } = await import("../app/tarifario/VistaBooking.tsx");
const { SeccionesIncluye, UbicacionHotel } = await import("../app/tarifario/tarjetaHotelCompartida.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");
const h = React.createElement;

const descripcion = { incluye: "Desayuno\nPiscina", noIncluye: "Vuelos", tarifasEspeciales: "Niños gratis", condicionesComerciales: "Pago anticipado" };
const resultado = {
  hotelId: 1, hotelNombre: "Hotel Almirante", destino: "Cartagena", paqueteId: 10,
  categoria: "Estandar", regimen: "Desayuno", paqueteNombre: "Paquete Caribe",
  total: 400000, noches: 3, moneda: "COP", fechaIda: "2026-10-15", fechaRegreso: "2026-10-18",
  habitaciones: { doble: 1 }, menores: { infantes: 0, nino: 0, nino2: 0 }, edadesMenores: [], pax: 2,
  combos: [{ categoria: "Estandar", regimen: "Desayuno", total: 400000, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 } }],
  condicion: null,
} as Parameters<typeof Resultado>[0]["r"];
const opcion = {
  hotelId: 7, hotelNombre: "Hotel Unidad", paqueteId: 10, paqueteNombre: "Paquete Caribe", destinoNombre: "Cartagena",
  categoria: "Estandar", alimentacion: "Desayuno", moneda: "COP", precioVenta: 500000, paxTotal: 2,
  fechaIda: "2026-11-01", fechaRegreso: "2026-11-04",
  ocupacion: [{ id: "h1", acom: "doble", adultos: 2, edadesMenores: [] }],
} as unknown as Parameters<typeof TarjetaUnidadBusqueda>[0]["opciones"][number];

let contenedor: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
before(() => { contenedor = document.createElement("div"); document.body.appendChild(contenedor); });
beforeEach(() => { root = createRoot(contenedor); });
afterEach(() => { act(() => root.unmount()); });
after(() => contenedor.remove());

function montar(elemento: React.ReactNode) {
  act(() => root.render(h(CartProvider, null, elemento)));
}
function boton(titulo: string) {
  const etiqueta = [...contenedor.querySelectorAll("p")].find((p) => p.textContent === titulo);
  assert.ok(etiqueta, `Falta el titulo ${titulo}`);
  const b = etiqueta.parentElement?.querySelector("button") as HTMLButtonElement | null;
  assert.ok(b, `Falta Ver mas en ${titulo}`);
  return b;
}
function clic(b: HTMLButtonElement) {
  act(() => { b.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
function comprobarPlegados() {
  assert.equal(boton("Incluye/No incluye").textContent?.trim(), "Ver más");
  assert.equal(boton("Ubicación").textContent?.trim(), "Ver más");
  assert.equal(contenedor.querySelector("iframe"), null);
  assert.equal(contenedor.textContent?.includes("Desayuno"), true, "El detalle existe en la región oculta");
  const region = document.getElementById(boton("Incluye/No incluye").getAttribute("aria-controls")!);
  assert.equal(region?.hidden, true);
  clic(boton("Incluye/No incluye"));
  assert.equal(region?.hidden, false);
  assert.equal(boton("Incluye/No incluye").textContent?.trim(), "Ver menos");
  clic(boton("Ubicación"));
  assert.ok(contenedor.querySelector("iframe[title^='Mapa']"));
  clic(boton("Ubicación"));
  assert.equal(contenedor.querySelector("iframe"), null);
}

test("motor por persona: Incluye y Ubicación cerrados, expandibles de forma independiente", () => {
  montar(h(Resultado, { r: resultado, foto: null, info: { estrellas: null, clasificacion: null, ubicacion: "Cartagena, Colombia" },
    descripcionPorPaquete: { 10: descripcion }, addonsPorPaquete: new Map() } as never));
  comprobarPlegados();
});

test("motor por unidad: mismos dos controles, sin mapa al iniciar", () => {
  montar(h(TarjetaUnidadBusqueda, { hotel: { hotelId: 7, hotelNombre: "Hotel Unidad", destino: "Cartagena" },
    opciones: [opcion], foto: null, estrellas: null, clasificacion: null, adultsOnly: false, petFriendly: false,
    ubicacion: "Cartagena, Colombia", descripcionPorPaquete: { 10: descripcion }, addonsPorPaquete: new Map() } as never));
  comprobarPlegados();
});

test("ficha interna: la variante compacta también oculta el texto y mapa", () => {
  montar(h("div", null, h(SeccionesIncluye, { descripcion, compacto: true }),
    h(UbicacionHotel, { hotelNombre: "Hotel Almirante", ubicacion: "Cartagena, Colombia", compacto: true })));
  comprobarPlegados();
});

test("sin contenido no aparecen controles vacíos", () => {
  montar(h("div", null, h(SeccionesIncluye, { descripcion: null, compacto: true }),
    h(UbicacionHotel, { hotelNombre: "Hotel", ubicacion: " ", compacto: true })));
  assert.equal(contenedor.querySelector("button"), null);
});
