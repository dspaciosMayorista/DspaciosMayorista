// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Prueba de INTERACCIÓN REACT de los servicios adicionales como SUBELECCIÓN
// del hotel, montando la tarjeta real `Resultado` (BuscadorBooking.tsx) con
// el `CartProvider` real y `buscarReceptivos` configurable (stub):
//   · el modal del servicio solo selecciona/deselecciona — nunca escribe en
//     el carrito;
//   · los servicios se cotizan con fechas/pax/precio del hotel, con el
//     precio exacto del paquete (no el de otro paquete del mismo destino);
//   · la tarjeta muestra hotel + servicios + total; cambiar el combo del
//     hotel invalida y recotiza; un servicio sin precio bloquea el conjunto;
//   · el botón del hotel agrega hotel + servicios juntos y vinculados; quitar
//     un servicio deja el hotel, quitar el hotel se lleva sus servicios;
//   · el vínculo persiste en localStorage y la hidratación descarta huérfanos.
import { test, describe, before, after } from "node:test";
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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { __setBuscarReceptivos, __setBuscarHoteles } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;

// Más que el debounce de la cotización de servicios (300 ms).
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const COTIZAR = 400;
const CLAVE_CARRITO = "dspacios_cart_v1";

// `moneda` = la que el motor resolvió para el hotel (`BusquedaResultado.moneda`).
function resultadoFixture(moneda = "COP", precios: [number, number] = [1_200_000, 1_600_000]) {
  const c = (regimen: string, total: number) => ({ categoria: "Estandar", regimen, total, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 } });
  return {
    hotelId: 1, hotelNombre: "Hotel Almirante", destino: "CARTAGENA",
    paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", paqueteNombre: "Paquete Caribe",
    total: precios[0], noches: 3, fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", moneda,
    habitaciones: { doble: 1 }, menores: { infantes: 0, nino: 0, nino2: 0 }, edadesMenores: [], pax: 2,
    combos: [c("Desayuno", precios[0]), c("Todo incluido", precios[1])], condicion: null,
  } as Parameters<typeof Resultado>[0]["r"];
}

const addon = (servicioId: number, nombre: string, desde: number, moneda = "COP") => ({
  servicioId, paqueteId: 10, nombre, destino: "CARTAGENA", descripcion: "Tour", foto: null, desde, moneda,
});
const servicio = (paqueteId: number, servicioId: number, total: number, moneda = "COP") =>
  ({ servicioId, paqueteId, nombre: servicioId === 55 ? "Islas del Rosario" : "City tour", destino: "CARTAGENA", descripcion: null, total, pax: 2, noches: 3, moneda, categoria: "tour" });

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
function cambiarSelect(container: HTMLElement, etiqueta: string, valor: string) {
  const span = [...container.querySelectorAll("label > span")].find((s) => s.textContent?.trim() === etiqueta)!;
  const select = span.parentElement!.querySelector("select") as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(select, valor);
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

describe("Servicios adicionales como subelección del hotel (Resultado)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let carrito: ReturnType<typeof useCart>;
  const llamadas: { fechaIda: string; fechaRegreso: string; pax: number; paqueteId: number }[] = [];
  let respuesta: (input: { paqueteId: number }) => unknown = () => ({ ok: true, resultados: [] });

  async function abrirServicio(nombre: RegExp) {
    await act(async () => { click(boton(/Servicios adicionales \(2\)/, container)!); await espera(); });
    await act(async () => { click(boton(nombre)!); await espera(); });
  }
  async function cerrarModal() {
    await act(async () => { click(boton(/^Cerrar/, document.querySelector('[role="dialog"]')!)!); await espera(); });
  }
  const tarjeta = () => container.textContent ?? "";

  before(async () => {
    localStorage.clear();
    __setBuscarReceptivos(async (input: never) => { llamadas.push(input); return respuesta(input); });
    container = document.createElement("div");
    document.body.appendChild(container);
    function Espia() { carrito = useCart(); return null; }
    root = createRoot(container);
    await act(async () => {
      root.render(h(CartProvider, null,
        h(Resultado, {
          r: resultadoFixture(), foto: null, info: { estrellas: null, clasificacion: null }, descripcionPorPaquete: {},
          addonsPorPaquete: new Map([[10, [addon(55, "Islas del Rosario", 90_000), addon(56, "City tour", 40_000)]]]),
        }),
        h(Espia, null)));
      await espera();
    });
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
    __setBuscarReceptivos(null);
    __setBuscarHoteles(null);
  });

  test("hotel en COP: la tarjeta pinta el precio en pesos (moneda del resultado)", () => {
    assert.match(tarjeta(), /\$\s?1\.200\.000/);
    assert.doesNotMatch(tarjeta(), /USD/);
  });

  test("hotel solo: sin servicios se agrega normal y se quita normal", async () => {
    await act(async () => { click(boton(/^Agregar al carrito$/, container)!); await espera(); });
    assert.deepEqual(carrito.items.map((i) => i.tipo), ["hotel"]);
    await act(async () => { click(boton(/En el carrito · quitar$/, container)!); await espera(); });
    assert.equal(carrito.items.length, 0);
    assert.equal(llamadas.length, 0, "sin servicios no se consulta nada");
  });

  test("el modal SOLO selecciona: no escribe en el carrito ni muestra un botón de agregar", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(20, 55, 300_000), servicio(10, 55, 180_000), servicio(10, 56, 85_000)] });
    await abrirServicio(/Islas del Rosario/);
    const dialogo = document.querySelector('[role="dialog"]')!;
    assert.equal(boton(/Agregar/, dialogo), undefined, "el modal no agrega al carrito");
    const sel = boton(/Seleccionar para este hotel/, dialogo)!;
    assert.equal(sel.getAttribute("aria-pressed"), "false");
    await act(async () => { click(sel); await espera(); });
    assert.equal(boton(/Seleccionado · quitar/, dialogo)!.getAttribute("aria-pressed"), "true");
    assert.equal(carrito.items.length, 0, "seleccionar no agrega nada al carrito");
    await cerrarModal();
  });

  test("un servicio: cotiza con fechas/pax del hotel y el precio EXACTO del paquete; desglose y total", async () => {
    await act(async () => { await espera(COTIZAR); });
    assert.deepEqual(llamadas.at(-1), { fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", pax: 2, paqueteId: 10 });
    assert.match(tarjeta(), /Islas del Rosario/);
    assert.match(tarjeta(), /\$\s?180\.000/, "precio real del paquete 10, no el «desde» ni el del paquete 20");
    assert.doesNotMatch(tarjeta(), /\$\s?300\.000/);
    assert.match(tarjeta(), /Total hotel \+ servicios\s*\$\s?1\.380\.000/);
    assert.ok(boton(/Agregar hotel \+ 1 servicio$/, container), "el botón del hotel anuncia el conjunto");
  });

  test("varios servicios: suman sin volver a consultar (misma cotización del paquete)", async () => {
    const antes = llamadas.length;
    await abrirServicio(/City tour/);
    await act(async () => { click(boton(/Seleccionar para este hotel/)!); await espera(); });
    await cerrarModal();
    await act(async () => { await espera(COTIZAR); });
    assert.equal(llamadas.length, antes, "no hace falta otra consulta para el mismo estado del hotel");
    assert.match(tarjeta(), /Total hotel \+ servicios\s*\$\s?1\.465\.000/);
    assert.ok(boton(/Agregar hotel \+ 2 servicios$/, container));
  });

  test("cambiar la alimentación (precio del hotel) invalida: sin total y bloqueado hasta recotizar", async () => {
    let soltar!: () => void;
    const pendiente = new Promise<void>((r) => { soltar = r; });
    respuesta = async () => { await pendiente; return { ok: true, resultados: [servicio(10, 55, 180_000), servicio(10, 56, 85_000)] }; };
    await act(async () => { cambiarSelect(container, "Alimentación", "Todo incluido"); await espera(COTIZAR); });
    assert.doesNotMatch(tarjeta(), /Total hotel \+ servicios/, "nunca un total con la cotización vieja");
    assert.match(tarjeta(), /Cotizando/);
    assert.equal(boton(/Agregar hotel/, container)!.disabled, true);
    await act(async () => { soltar(); await espera(); });
    assert.match(tarjeta(), /Total hotel \+ servicios\s*\$\s?1\.865\.000/);
    assert.equal(boton(/Agregar hotel \+ 2 servicios$/, container)!.disabled, false);
  });

  test("precio no disponible: nombra el servicio y bloquea el conjunto; quitarlo lo desbloquea", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(10, 55, 180_000)] });
    await act(async () => { cambiarSelect(container, "Alimentación", "Desayuno"); await espera(COTIZAR); });
    assert.match(tarjeta(), /«City tour» no tiene un precio vigente en este paquete/);
    assert.match(tarjeta(), /No se puede agregar el conjunto: «City tour» sin precio válido/);
    assert.doesNotMatch(tarjeta(), /Total hotel \+ servicios/);
    assert.equal(boton(/Agregar hotel/, container)!.disabled, true);
    await act(async () => { click(container.querySelector('button[aria-label="Quitar City tour de la selección"]')!); await espera(); });
    assert.match(tarjeta(), /Total hotel \+ servicios\s*\$\s?1\.380\.000/);
    assert.equal(boton(/Agregar hotel \+ 1 servicio$/, container)!.disabled, false);
  });

  test("agregar: hotel + servicio en una sola actualización, vinculados y persistidos", async () => {
    await act(async () => { click(boton(/Agregar hotel \+ 1 servicio$/, container)!); await espera(); });
    assert.deepEqual(carrito.items.map((i) => i.tipo), ["hotel", "tour"]);
    const [hotel, tour] = carrito.items;
    assert.equal(hotel.precio, 1_200_000, "la tarifa del hotel no cambia");
    assert.ok(tour.tipo === "tour" && tour.hotelItemId === hotel.id && tour.paqueteId === 10 && tour.servicioId === 55 && tour.precio === 180_000);
    assert.ok(tour.tipo === "tour" && tour.fechaIda === "2030-10-15" && tour.fechaRegreso === "2030-10-18" && tour.pax === 2);
    const guardado = JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? "[]");
    assert.equal(guardado[1].hotelItemId, guardado[0].id, "el vínculo persiste en localStorage");
    assert.match(tarjeta(), /En el carrito con este hotel/);
  });

  // #54: con el hotel en el carrito los servicios se cambian como BORRADOR del
  // conjunto guardado; el carrito no se toca hasta «Confirmar actualización»
  // (que revalida hotel y servicios con los motores existentes) y «Descartar
  // cambios» vuelve a lo guardado. Las aserciones comparan textos, ids o
  // booleanos — nunca un elemento del DOM (al fallar, imprimirlo agota memoria).
  test("con el hotel en el carrito la selección es un BORRADOR: carrito intacto hasta confirmar; descartar conserva lo guardado; confirmar actualiza sin duplicar el hotel ni perder vínculos", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(10, 55, 180_000), servicio(10, 56, 85_000)] });
    __setBuscarHoteles(async () => ({ ok: true, resultados: [resultadoFixture()] }));
    const idsGuardados = carrito.items.map((i) => i.id);
    const [hotel, tour55] = carrito.items;
    const persistidoAntes = localStorage.getItem(CLAVE_CARRITO);
    async function cambiarEnModal(nombre: RegExp, accion: RegExp) {
      await abrirServicio(nombre);
      const dialogo = document.querySelector('[role="dialog"]')!;
      assert.equal(/Quítalo del carrito/.test(dialogo.textContent ?? ""), false, "la selección ya no se bloquea con el hotel en el carrito");
      const b = boton(accion, dialogo);
      assert.equal(b !== undefined, true, `el modal debe ofrecer ${accion}`);
      await act(async () => { click(b!); await espera(); });
      await cerrarModal();
      await act(async () => { await espera(COTIZAR); });
    }
    // La cotización en caché es la de la prueba anterior (City tour sin precio
    // para este estado del hotel): cambiar la alimentación y volver obliga a
    // cotizar de nuevo con la respuesta actual del paquete.
    await act(async () => { cambiarSelect(container, "Alimentación", "Todo incluido"); await espera(COTIZAR); });
    await act(async () => { cambiarSelect(container, "Alimentación", "Desayuno"); await espera(); });
    assert.match(tarjeta(), /En el carrito con este hotel/);
    assert.match(tarjeta(), /Servicios adicionales \(2\) · 1 elegido/, "la selección guardada se hidrata en la tarjeta");

    // 1) Borrador: agregar City tour con el hotel ya en el carrito.
    await cambiarEnModal(/City tour/, /Seleccionar para este hotel/);
    assert.deepEqual(carrito.items.map((i) => i.id), idsGuardados, "el borrador no toca el carrito");
    assert.equal(localStorage.getItem(CLAVE_CARRITO) === persistidoAntes, true, "ni lo persistido");
    assert.match(tarjeta(), /Cambios sin confirmar/);
    assert.match(tarjeta(), /Total hotel \+ servicios\s*\$\s?1\.465\.000/);

    // 2) Descartar: vuelve a lo guardado, sin tocar el carrito.
    await act(async () => { click(boton(/Descartar cambios/, container)!); await espera(); });
    assert.doesNotMatch(tarjeta(), /Cambios sin confirmar/);
    assert.match(tarjeta(), /Servicios adicionales \(2\) · 1 elegido/);
    assert.deepEqual(carrito.items.map((i) => i.id), idsGuardados);
    assert.equal(localStorage.getItem(CLAVE_CARRITO) === persistidoAntes, true);

    // 3) Confirmar: una sola actualización; mismo hotel, mismos vínculos.
    await cambiarEnModal(/City tour/, /Seleccionar para este hotel/);
    await act(async () => { click(boton(/Confirmar actualización/, container)!); await espera(); });
    const items = carrito.items;
    assert.equal(items.filter((i) => i.tipo === "hotel").length, 1, "un solo hotel");
    assert.equal(items[0].id, hotel.id, "el hotel conserva su id");
    assert.equal(items[1].id, tour55.id, "el servicio que se queda conserva su id");
    assert.deepEqual(items.slice(1).map((i) => (i.tipo === "tour" ? [i.servicioId, i.hotelItemId, i.precio] : null)),
      [[55, hotel.id, 180_000], [56, hotel.id, 85_000]]);
    const persistido = JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? "[]") as { id: string; hotelItemId?: string }[];
    assert.deepEqual(persistido.map((i) => i.id), items.map((i) => i.id), "persistido igual que el estado");
    assert.equal(persistido.slice(1).every((i) => i.hotelItemId === hotel.id), true, "los vínculos persisten");
    assert.doesNotMatch(tarjeta(), /Cambios sin confirmar/);

    // 4) Quitar City tour y confirmar: vuelve al conjunto inicial (hotel +
    // Islas, mismos ids), del que parte la prueba siguiente.
    await cambiarEnModal(/City tour/, /Seleccionado · quitar/);
    await act(async () => { click(boton(/Confirmar actualización/, container)!); await espera(); });
    assert.deepEqual(carrito.items.map((i) => i.id), idsGuardados);
  });

  test("quitar el servicio deja el hotel; quitar el hotel se lleva sus servicios", async () => {
    const tour = carrito.items.find((i) => i.tipo === "tour")!;
    await act(async () => { carrito.remove(tour.id); await espera(); });
    assert.deepEqual(carrito.items.map((i) => i.tipo), ["hotel"]);
    // Volver a armar el conjunto para probar la cascada desde el botón del hotel.
    await act(async () => { click(boton(/En el carrito · quitar$/, container)!); await espera(); });
    await act(async () => { click(boton(/Agregar hotel \+ 1 servicio$/, container)!); await espera(); });
    assert.equal(carrito.items.length, 2);
    await act(async () => { click(boton(/quitar hotel y servicios/, container)!); await espera(); });
    assert.equal(carrito.items.length, 0, "no quedan servicios sueltos");
  });
});

// Hotel en USD (paquete en dólares): la tarjeta y el conjunto usan la moneda
// que resolvió el motor — nunca COP fijo. Un servicio en USD se suma; uno en
// COP bloquea con un mensaje que nombra la moneda REAL del hotel.
describe("Moneda del hotel en la tarjeta: hotel en USD (Resultado)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let carrito: ReturnType<typeof useCart>;
  let respuesta: () => unknown = () => ({ ok: true, resultados: [] });
  const tarjeta = () => container.textContent ?? "";

  async function seleccionar(nombre: RegExp) {
    await act(async () => { click(boton(/Servicios adicionales \(2\)/, container)!); await espera(); });
    await act(async () => { click(boton(nombre)!); await espera(); });
    const dialogo = document.querySelector('[role="dialog"]')!;
    await act(async () => { click(boton(/Seleccionar para este hotel|Seleccionado · quitar/, dialogo)!); await espera(); });
    await act(async () => { click(boton(/^Cerrar/, dialogo)!); await espera(COTIZAR); });
  }

  before(async () => {
    localStorage.clear();
    __setBuscarReceptivos(async () => respuesta());
    container = document.createElement("div");
    document.body.appendChild(container);
    function Espia() { carrito = useCart(); return null; }
    root = createRoot(container);
    await act(async () => {
      root.render(h(CartProvider, null,
        h(Resultado, {
          r: resultadoFixture("USD", [1_200, 1_600]), foto: null, info: { estrellas: null, clasificacion: null }, descripcionPorPaquete: {},
          addonsPorPaquete: new Map([[10, [addon(55, "Islas del Rosario", 90, "USD"), addon(56, "City tour", 40_000)]]]),
        }),
        h(Espia, null)));
      await espera();
    });
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
    __setBuscarReceptivos(null);
  });

  test("el precio del hotel se pinta en USD, no como pesos", () => {
    assert.match(tarjeta(), /USD \$1,200/);
    assert.doesNotMatch(tarjeta(), /\$\s?1\.200(?!,)/, "nunca el monto en dólares con formato de pesos");
  });

  test("servicio en USD: desglose y total del conjunto en USD; agrega hotel + servicio", async () => {
    respuesta = () => ({ ok: true, resultados: [servicio(10, 55, 180, "USD"), servicio(10, 56, 85_000, "COP")] });
    await seleccionar(/Islas del Rosario/);
    assert.match(tarjeta(), /USD \$180/);
    assert.match(tarjeta(), /Total hotel \+ servicios\s*USD \$1,380/);
    assert.doesNotMatch(tarjeta(), /está en USD y el hotel en COP/);
    const agregar = boton(/Agregar hotel \+ 1 servicio$/, container)!;
    assert.equal(agregar.disabled, false);
    await act(async () => { click(agregar); await espera(); });
    const [hotel, tour] = carrito.items;
    assert.equal(hotel.precio, 1_200, "la tarifa del hotel no cambia");
    assert.ok(tour.tipo === "tour" && tour.hotelItemId === hotel.id && tour.moneda === "USD" && tour.precio === 180);
    await act(async () => { carrito.remove(hotel.id); await espera(); });
    assert.equal(carrito.items.length, 0);
  });

  test("servicio en COP con hotel en USD: bloquea y nombra la moneda real del hotel", async () => {
    await seleccionar(/City tour/);
    assert.match(tarjeta(), /«City tour» está en COP y el hotel en USD/);
    assert.doesNotMatch(tarjeta(), /Total hotel \+ servicios/);
    assert.equal(boton(/Agregar hotel \+ 2 servicios$/, container)!.disabled, true);
  });
});

describe("Persistencia del carrito: la hidratación descarta servicios huérfanos", () => {
  test("un servicio vinculado a un hotel que ya no existe no se restaura; el resto sí", async () => {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify([
      { id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "H", destino: "X", fotoUrl: null,
        categoria: "E", regimen: "D", fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 100, edadesMenores: [] },
      { id: "t1", tipo: "tour", paqueteId: 10, servicioId: 55, nombre: "A", destino: null, fotoUrl: null, fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, pax: 2, precio: 10, hotelItemId: "h1" },
      { id: "t2", tipo: "tour", paqueteId: 10, servicioId: 56, nombre: "B", destino: null, fotoUrl: null, fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, pax: 2, precio: 10, hotelItemId: "fantasma" },
      { id: "t3", tipo: "tour", paqueteId: 11, servicioId: 57, nombre: "C", destino: null, fotoUrl: null, fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, pax: 2, precio: 10 },
    ]));
    let ids: string[] = [];
    function Espia() { ids = useCart().items.map((i) => i.id); return null; }
    const c = document.createElement("div");
    const r = createRoot(c);
    await act(async () => { r.render(h(CartProvider, null, h(Espia, null))); await espera(); });
    assert.deepEqual(ids, ["h1", "t1", "t3"]);
    act(() => r.unmount());
  });
});

describe("addConjunto en StrictMode (React ejecuta el actualizador más de una vez)", () => {
  test("mismos ids y vínculos: un hotel, sus servicios una sola vez, vinculados al id devuelto; luego quitar y recargar", async () => {
    localStorage.clear();
    let api!: ReturnType<typeof useCart>;
    function Espia() { api = useCart(); return null; }
    const c = document.createElement("div");
    const r = createRoot(c);
    await act(async () => { r.render(h(React.StrictMode, null, h(CartProvider, null, h(Espia, null)))); await espera(); });
    let hotelId = "";
    await act(async () => {
      hotelId = api.addConjunto(
        { tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "H", destino: "X", fotoUrl: null,
          categoria: "E", regimen: "D", fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 100, edadesMenores: [] },
        [
          { tipo: "tour", paqueteId: 10, servicioId: 55, nombre: "A", destino: null, fotoUrl: null, fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, pax: 2, precio: 10, moneda: "COP" },
          { tipo: "tour", paqueteId: 10, servicioId: 56, nombre: "B", destino: null, fotoUrl: null, fechaIda: "2030-01-01", fechaRegreso: "2030-01-04", noches: 3, pax: 2, precio: 20, moneda: "COP" },
        ],
      );
      await espera();
    });
    const items = api.items;
    assert.deepEqual(items.map((i) => i.tipo), ["hotel", "tour", "tour"], "nada duplicado aunque el actualizador corra dos veces");
    assert.equal(items[0].id, hotelId, "el id devuelto es el del hotel en el estado");
    assert.ok(items.slice(1).every((i) => i.tipo === "tour" && i.hotelItemId === hotelId));
    assert.equal(new Set(items.map((i) => i.id)).size, 3, "ids únicos");
    const guardado = JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? "[]");
    assert.deepEqual(guardado.map((i: { id: string }) => i.id), items.map((i) => i.id), "lo persistido coincide con el estado");

    // Quitar un servicio deja el hotel; recargar (provider nuevo, sin modo
    // estricto, como en producción) restaura exactamente lo que quedó.
    await act(async () => { api.remove(items[1].id); await espera(); });
    act(() => r.unmount());
    let recargado: string[] = [];
    function Espia2() { recargado = useCart().items.map((i) => i.id); return null; }
    const c2 = document.createElement("div");
    const r2 = createRoot(c2);
    await act(async () => { r2.render(h(CartProvider, null, h(Espia2, null))); await espera(); });
    assert.deepEqual(recargado, [items[0].id, items[2].id]);
    act(() => r2.unmount());
  });
});
