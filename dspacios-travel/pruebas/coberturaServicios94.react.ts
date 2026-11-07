// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #94/#52 — Cobertura de los servicios en la cotización NORMAL, desde la interfaz real: la página `checkout/page.tsx`, el `CartProvider` real y el panel
// `CoberturaServicios`. Los pasajeros los calcula un stub que replica lo que liquida el servidor (clave `adulto:<acomodación>`); lo que se verifica es lo que la
// persona puede capturar y lo que la página envía: servicio para todos, parcial, dos servicios superpuestos, cambio de habitaciones y cupo seleccionado eliminado.
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

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
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

mock.module(new URL("../app/tarifario/cotizacionBernaloActions.ts", import.meta.url).href, {
  namedExports: { cotizarAlojamientoBernaloPublico: async () => ({ ok: false, error: "no se usa" }) },
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { firmaConjunto } = await import("../lib/cart/vinculoServicios.ts");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const FECHAS = { fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" };
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp, raiz: ParentNode = document) => [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

const hotel = (habitaciones: Record<string, number>) => {
  const pax = (habitaciones.doble ?? 0) * 2 + (habitaciones.sencilla ?? 0);
  return {
    id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "Hotel Almirante", destino: "CARTAGENA", fotoUrl: null,
    categoria: "Estandar", regimen: "Desayuno", ...FECHAS, noches: 3, habitaciones, ninos: 0, ninos2: 0, infantes: 0, pax, precio: pax * 300_000, moneda: "COP", edadesMenores: [], condicion: null,
  };
};
// Servicio independiente (Receptivos): sin `hotelItemId`.
const servicio = (id: string, servicioId: number, nombre: string, pax: number) => ({
  id, tipo: "tour", paqueteId: 10, servicioId, nombre, destino: "CARTAGENA", fotoUrl: null, ...FECHAS, noches: 3, pax, precio: pax * 50_000, moneda: "COP",
});

// Lo que devolvería el servidor: un pasajero por plaza de cada habitación.
function cuposDe(input: { items: { habitaciones: Record<string, number> }[] }) {
  const hab = input.items[0].habitaciones;
  const cupos = [
    ...(hab.doble ? [{ clave: "adulto:doble", tipo: "adulto", etiqueta: "Adulto · Doble", cantidad: hab.doble * 2 }] : []),
    ...(hab.sencilla ? [{ clave: "adulto:sencilla", tipo: "adulto", etiqueta: "Adulto · Sencilla", cantidad: hab.sencilla }] : []),
  ];
  return { ok: true, hoteles: [{ posicion: 0, hotel: "Hotel Almirante", paxTotal: cupos.reduce((s, c) => s + c.cantidad, 0), cupos }] };
}

async function montar(items: unknown[] | null) {
  // `null` = reabrir la página con lo que ya hay en el navegador (recarga).
  if (items) {
    localStorage.clear();
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  let api!: ReturnType<typeof useCart>;
  function Espia() { api = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => {
    root.render(h(React.StrictMode, null, h(CartProvider, null, h(CheckoutPage), h(Espia, null))));
    await espera(60);
  });
  return { container, carrito: () => api, cerrar: () => { act(() => root.unmount()); container.remove(); }, desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
async function llenarCliente(raiz: HTMLElement) {
  const escribir = (etiqueta: string, valor: string) => {
    const label = [...raiz.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!;
    const input = label.parentElement!.querySelector("input") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  await act(async () => { escribir("Nombres *", "Ana"); escribir("Apellidos *", "Pérez"); escribir("Documento *", "123"); escribir("Teléfono / WhatsApp *", "300"); await espera(); });
}
const generar = async (raiz: HTMLElement) => { await act(async () => { click(boton(/Generar cotización y enviar solicitud/, raiz)!); await espera(60); }); };
const casilla = (raiz: HTMLElement, servicioNombre: string, pasajero: RegExp) =>
  [...raiz.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => (i.getAttribute("aria-label") ?? "").startsWith(`${servicioNombre}:`) && pasajero.test(i.getAttribute("aria-label") ?? ""))!;
const marcar = async (el: HTMLInputElement) => { await act(async () => { click(el); await espera(); }); };
type Enviada = { cobertura?: { cupos: Record<string, Record<string, number[]>>; tours: Record<string, { hotel: number; cubre?: string[] }> } };
const ultima = () => stub.__solicitudes.at(-1) as Enviada;
const texto = (raiz: HTMLElement) => raiz.textContent ?? "";

describe("#94 cotización normal: pasajeros que cubre cada servicio (interfaz real)", () => {
  before(() => {
    stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
    stub.__setCuposDeCarrito(async (i: Parameters<typeof cuposDe>[0]) => cuposDe(i));
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
  });
  after(() => { stub.__setCuposDeCarrito(null); stub.__setCrearSolicitudReserva(null); });

  test("servicio para TODOS: cobertura total por defecto, sin casillas, y se envía con el hotel único como contexto", async () => {
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tA", 55, "Islas del Rosario", 3)]);
    const panel = m.container.querySelector('[data-testid="cobertura-servicios"]') as HTMLElement;
    assert.ok(panel, "el panel aparece");
    assert.match(texto(panel), /Cubre a todos \(3\)/);
    assert.equal(panel.querySelectorAll('input[type="checkbox"]').length, 0, "no pide marcar nada");
    assert.ok(!/asign/i.test(texto(panel)), "no pide asignar el servicio a otra cosa");
    await llenarCliente(m.container);
    const antes = stub.__solicitudes.length;
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes + 1);
    assert.deepEqual(ultima().cobertura, { cupos: { 0: { "adulto:doble": [1, 2], "adulto:sencilla": [1] } }, tours: { 0: { hotel: 0 } }, manuales: {} });
    m.desmontar();
  });

  test("servicio PARCIAL: exige marcar exactamente a quienes cubre antes de emitir", async () => {
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tB", 56, "City tour", 2)]);
    await llenarCliente(m.container);
    const antes = stub.__solicitudes.length;
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes, "no se envía sin elegir pasajeros");
    assert.match(texto(m.container), /«City tour» cubre 2 de los 3 pasajeros: marca 2 \(marcados: 0\)/);
    await marcar(casilla(m.container, "City tour", /Doble · pasajero 1/));
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes, "con uno de dos marcados tampoco");
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes + 1);
    assert.deepEqual(ultima().cobertura!.tours, { 0: { hotel: 0, cubre: ["adulto:doble#1", "adulto:sencilla#1"] } });
    m.desmontar();
  });

  test("dos servicios con coberturas SUPERPUESTAS: cada uno envía sus propios pasajeros", async () => {
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tA", 55, "Islas", 2), servicio("tB", 56, "City tour", 2)]);
    await llenarCliente(m.container);
    for (const [s, p] of [["Islas", /Doble · pasajero 1/], ["Islas", /Doble · pasajero 2/], ["City tour", /Doble · pasajero 2/], ["City tour", /Sencilla · pasajero 1/]] as const) {
      await marcar(casilla(m.container, s, p));
    }
    const antes = stub.__solicitudes.length;
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes + 1);
    assert.deepEqual(ultima().cobertura!.tours, {
      0: { hotel: 0, cubre: ["adulto:doble#1", "adulto:doble#2"] },
      1: { hotel: 0, cubre: ["adulto:doble#2", "adulto:sencilla#1"] },
    });
    m.desmontar();
  });

  test("cambio de habitaciones: los ids se conservan; si desaparece un pasajero marcado se exige revisar y NO se emite", async () => {
    const m = await montar([hotel({ doble: 1, sencilla: 2 }), servicio("tB", 56, "City tour", 2)]);
    await llenarCliente(m.container);
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 2/));
    // Edición real del conjunto: el hotel conserva su id.
    const editar = async (habitaciones: Record<string, number>) => {
      const api = m.carrito();
      const h0 = api.items.find((i) => i.id === "h1")!;
      await act(async () => {
        const r = api.actualizarConjunto({ hotelItemId: "h1", firmaEsperada: firmaConjunto(api.items, "h1")!, hotel: { ...h0, habitaciones, pax: (habitaciones.doble ?? 0) * 2 + (habitaciones.sencilla ?? 0) } as never, servicios: [] });
        assert.equal(r.ok, true);
        await espera(80);
      });
    };
    await editar({ doble: 2, sencilla: 2 });
    let antes = stub.__solicitudes.length;
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes + 1, "agregar una habitación no invalida lo marcado");
    assert.deepEqual(ultima().cobertura!.tours[0].cubre, ["adulto:sencilla#1", "adulto:sencilla#2"], "mismos ids");
    assert.deepEqual(ultima().cobertura!.cupos[0], { "adulto:doble": [1, 2, 3, 4], "adulto:sencilla": [1, 2] }, "los nuevos pasajeros tienen ordinales nuevos");
    // Se retira una sencilla: el pasajero 2 marcado ya no existe.
    await editar({ doble: 2, sencilla: 1 });
    antes = stub.__solicitudes.length;
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes, "no se emite con una cobertura por revisar");
    assert.ok(m.container.querySelector('[data-testid="cobertura-revisar"]'), "se pide revisar la cobertura");
    assert.match(texto(m.container), /Revisa la cobertura de «City tour»/);
    // Al corregir se descarta el pasajero inexistente: se quita el que sigue vivo y se elige otro.
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    await marcar(casilla(m.container, "City tour", /Doble · pasajero 1/));
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes + 1);
    assert.deepEqual(ultima().cobertura!.tours[0].cubre, ["adulto:sencilla#1", "adulto:doble#1"]);
    m.desmontar();
  });
});

// Lo guardado en el navegador es solo una comodidad: se aísla por ítem y por reserva, no se hereda de otra operación y se purga.
describe("#94 almacenamiento local de la cobertura", () => {
  before(() => {
    stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
    stub.__setCuposDeCarrito(async (i: Parameters<typeof cuposDe>[0]) => cuposDe(i));
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
  });
  after(() => { stub.__setCuposDeCarrito(null); stub.__setCrearSolicitudReserva(null); });
  const marcados = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((i) => i.checked).length;
  const tabla = () => JSON.parse(localStorage.getItem("cobertura94") ?? "{}") as Record<string, { huella?: string; ts?: number; seleccion: Record<string, string[]> }>;
  const HUELLA = "10|1|2030-10-15|2030-10-18|Estandar|Desayuno";

  test("la selección sobrevive a recargar la página (misma reserva) y queda guardada con su huella", async () => {
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tB", 56, "City tour", 2)]);
    await marcar(casilla(m.container, "City tour", /Doble · pasajero 1/));
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    assert.equal(tabla().h1.huella, HUELLA);
    m.cerrar();
    const m2 = await montar(null);
    assert.equal(marcados(m2.container), 2, "se conserva tras recargar");
    m2.desmontar();
  });

  test("una entrada de OTRA reserva con el mismo id de ítem (huella distinta) no se hereda", async () => {
    localStorage.clear();
    localStorage.setItem("cobertura94", JSON.stringify({ h1: { huella: "99|9|2031-01-01|2031-01-04|Otra|PC", ts: Date.now(), estado: { siguiente: { "adulto:doble": 2, "adulto:sencilla": 1 }, activos: { "adulto:doble": [1, 2], "adulto:sencilla": [1] } }, seleccion: { tB: ["adulto:doble#1", "adulto:sencilla#1"] } } }));
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tB", 56, "City tour", 2)]);
    assert.equal(marcados(m.container), 0, "no hereda la cobertura de otra operación");
    m.desmontar();
  });

  test("una entrada vencida no se hereda", async () => {
    localStorage.clear();
    localStorage.setItem("cobertura94", JSON.stringify({ h1: { huella: HUELLA, ts: Date.now() - 15 * 24 * 3600 * 1000, estado: null, seleccion: { tB: ["adulto:doble#1", "adulto:sencilla#1"] } } }));
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tB", 56, "City tour", 2)]);
    assert.equal(marcados(m.container), 0);
    m.desmontar();
  });

  test("se purgan las entradas de hoteles que ya no están en el carrito, sin tocar las del carrito actual", async () => {
    localStorage.clear();
    localStorage.setItem("cobertura94", JSON.stringify({ hViejo: { huella: HUELLA, ts: Date.now(), estado: null, seleccion: {} } }));
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tB", 56, "City tour", 2)]);
    await marcar(casilla(m.container, "City tour", /Doble · pasajero 1/));
    assert.deepEqual(Object.keys(tabla()).sort(), ["h1"], "el hotel anterior se purgó y el actual se conserva");
    m.desmontar();
  });

  test("tras vaciar el carrito y armar otra operación (hotel nuevo) no queda cobertura previa", async () => {
    const m = await montar([hotel({ doble: 1, sencilla: 1 }), servicio("tB", 56, "City tour", 2)]);
    await marcar(casilla(m.container, "City tour", /Doble · pasajero 1/));
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    await act(async () => { m.carrito().clear(); await espera(60); });
    // Nueva operación: otro hotel (id distinto) y otro servicio.
    await act(async () => {
      m.carrito().add({ ...(hotel({ doble: 1, sencilla: 1 }) as object), id: undefined } as never);
      await espera(60);
    });
    const nuevo = m.carrito().items.find((i) => i.tipo === "hotel")!;
    assert.notEqual(nuevo.id, "h1");
    await act(async () => { m.carrito().add({ ...(servicio("x", 56, "City tour", 2) as object), id: undefined } as never); await espera(120); });
    assert.equal(marcados(m.container), 0, "la selección anterior no se hereda");
    assert.ok(!(nuevo.id in tabla()) || Object.keys(tabla()[nuevo.id].seleccion).length === 0);
    assert.ok(!("h1" in tabla()), "la entrada de la operación anterior se purgó");
    m.desmontar();
  });
});

// Emitir desde la página mientras la consulta de la entrada NUEVA no ha llegado: no se envía con cupos de la entrada anterior.
describe("#94 página: editar habitaciones y emitir antes de que llegue la consulta nueva", () => {
  before(() => {
    stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
  });
  after(() => { stub.__setCuposDeCarrito(null); stub.__setCrearSolicitudReserva(null); });

  test("con la consulta pendiente no se envía; al llegar, se envía con los pasajeros nuevos y la selección conservada", async () => {
    stub.__setCuposDeCarrito(async (i: Parameters<typeof cuposDe>[0]) => cuposDe(i));
    const m = await montar([hotel({ doble: 1, sencilla: 2 }), servicio("tB", 56, "City tour", 2)]);
    await llenarCliente(m.container);
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 1/));
    await marcar(casilla(m.container, "City tour", /Sencilla · pasajero 2/));

    // La consulta de la entrada nueva queda DEMORADA.
    let liberar!: () => void;
    stub.__setCuposDeCarrito((i: Parameters<typeof cuposDe>[0]) => new Promise((res) => { liberar = () => res(cuposDe(i)); }));
    const api = m.carrito();
    const h0 = api.items.find((i) => i.id === "h1")!;
    await act(async () => {
      const r = api.actualizarConjunto({ hotelItemId: "h1", firmaEsperada: firmaConjunto(api.items, "h1")!, hotel: { ...h0, habitaciones: { doble: 2, sencilla: 2 }, pax: 6 } as never, servicios: [] });
      assert.equal(r.ok, true);
      await espera(80);
    });
    const antes = stub.__solicitudes.length;
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes, "no se emite con la consulta pendiente");
    assert.match(texto(m.container), /Calculando los pasajeros de la cotización/);
    assert.equal(m.container.querySelectorAll('input[type="checkbox"]').length, 0, "no se ofrecen pasajeros de la entrada anterior");

    await act(async () => { liberar(); await espera(80); });
    await generar(m.container);
    assert.equal(stub.__solicitudes.length, antes + 1);
    assert.deepEqual(ultima().cobertura!.cupos[0], { "adulto:doble": [1, 2, 3, 4], "adulto:sencilla": [1, 2] });
    assert.deepEqual(ultima().cobertura!.tours[0].cubre, ["adulto:sencilla#1", "adulto:sencilla#2"]);
    m.desmontar();
  });
});
