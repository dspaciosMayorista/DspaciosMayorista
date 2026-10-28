// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #64 — Interacción REACT del servicio MANUAL (vuelo libre u otro) sobre un carrito existente:
//   · el panel solo aparece al personal autorizado (mismo contexto de la venta asistida) y no a visitantes;
//   · agregar, editar y quitar solo afectan al ítem manual: hotel y add-on quedan idénticos en el carrito y en localStorage;
//   · la moneda del manual es la del carrito (no se ofrece otra); el total suma por moneda;
//   · lo que viaja al servidor es lo declarado (sin costo ni proveedor);
//   · al convertir, costo neto y proveedor son obligatorios por cada manual y viajan en `costosManuales`.
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
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { ConvertirCarritoBtn } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const comparativaBooking = await import("../lib/cotizacion/comparativaBooking.tsx");
const { __setConvertirCotizacionCarrito } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const porId = (raiz: ParentNode, id: string) => raiz.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null;

const hotel = { id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null, hotelNombre: "Hotel Almirante", destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1_200_000, edadesMenores: [], moneda: "COP" };
const addon = { id: "t1", tipo: "tour", paqueteId: 10, servicioId: 55, nombre: "Islas del Rosario", destino: "CARTAGENA", fotoUrl: null, fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, pax: 2, precio: 180_000, moneda: "COP", hotelItemId: "h1" };

async function montar(items: unknown[]) {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let carrito!: ReturnType<typeof useCart>;
  function Espia() { carrito = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CheckoutPage), h(Espia, null))); await espera(); });
  return {
    container, carrito: () => carrito, texto: () => sinEspacios(container.textContent ?? ""),
    guardado: () => JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? "[]") as Record<string, unknown>[],
    desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); },
  };
}
async function escribir(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  await act(async () => {
    const esSelect = el instanceof window.HTMLSelectElement;
    Object.getOwnPropertyDescriptor(esSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new window.Event(esSelect ? "change" : "input", { bubbles: true }));
    await espera(5);
  });
}
async function llenar(m: Awaited<ReturnType<typeof montar>>, v: { clase?: string; nombre: string; pax: string; precio: string }) {
  const c = m.container;
  if (v.clase) await escribir(porId(c, "man-clase")!, v.clase);
  await escribir(porId(c, "man-nombre")!, v.nombre);
  await escribir(porId(c, "man-pax")!, v.pax);
  await escribir(porId(c, "man-precio")!, v.precio);
}

describe("Panel de servicio manual en el checkout", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => stub.__setContextoAsistencia({ puede: false }));

  test("agregar: suma al total, conserva hotel y add-on idénticos, sin elegir moneda (usa la del carrito) y persiste", async () => {
    const m = await montar([hotel, addon]);
    const antes = JSON.stringify(m.carrito().items);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    assert.equal(porId(m.container, "man-moneda"), null, "con el carrito en COP no se ofrece otra moneda");
    assert.match(sinEspacios(m.container.textContent ?? ""), /Precio de venta total \(COP\)/);
    await llenar(m, { clase: "otro", nombre: "Traslado privado", pax: "2", precio: "90000" });
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    const items = m.carrito().items;
    assert.equal(items.length, 3);
    assert.equal(JSON.stringify(items.slice(0, 2)), antes, "hotel y add-on no cambian ni un bit");
    const man = items[2] as unknown as Record<string, unknown>;
    assert.deepEqual([man.tipo, man.clase, man.nombre, man.pax, man.precio, man.moneda], ["manual", "otro", "Traslado privado", 2, 90000, "COP"]);
    assert.match(m.texto(), /Total estimado\s?\$\s?1\.470\.000/);
    assert.equal(m.guardado().length, 3, "persiste en localStorage");
    m.desmontar();
  });

  test("editar: cambia solo el manual (mismo id), hotel y add-on intactos; el total se recalcula", async () => {
    const manual = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, tramo: null, hotelRef: null, hotelEtiqueta: null, pax: 2, precio: 90_000, moneda: "COP", fotoUrl: null, noches: null };
    const m = await montar([hotel, addon, manual]);
    const antes = JSON.stringify(m.carrito().items.slice(0, 2));
    await act(async () => { click(m.container.querySelector('button[aria-label="Editar Traslado privado"]')!); await espera(); });
    assert.equal((porId(m.container, "man-nombre") as HTMLInputElement).value, "Traslado privado", "el formulario se precarga");
    await escribir(porId(m.container, "man-precio")!, "150000");
    await act(async () => { click(boton("Guardar cambios", m.container)!); await espera(); });
    const items = m.carrito().items as unknown as Record<string, unknown>[];
    assert.equal(items.length, 3);
    assert.equal(JSON.stringify(items.slice(0, 2)), antes);
    assert.deepEqual([items[2].id, items[2].precio], ["m1", 150000]);
    assert.match(m.texto(), /Total estimado\s?\$\s?1\.530\.000/);
    m.desmontar();
  });

  test("quitar: el carrito vuelve exactamente a hotel + add-on", async () => {
    const manual = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, tramo: null, hotelRef: null, hotelEtiqueta: null, pax: 2, precio: 90_000, moneda: "COP", fotoUrl: null, noches: null };
    const m = await montar([hotel, addon, manual]);
    const dosPrimeros = JSON.stringify(m.carrito().items.slice(0, 2));
    await act(async () => { click(m.container.querySelector('button[aria-label="Quitar Traslado privado"]')!); await espera(); });
    assert.equal(JSON.stringify(m.carrito().items), dosPrimeros);
    assert.equal(m.guardado().length, 2);
    assert.match(m.texto(), /Total estimado\s?\$\s?1\.380\.000/);
    m.desmontar();
  });

  test("un vuelo sin destino ni fecha de ida no se agrega y explica qué falta; el carrito no cambia", async () => {
    const m = await montar([hotel]);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    await llenar(m, { nombre: "Tiquete aéreo", pax: "2", precio: "1800000" });
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? "", /Un vuelo necesita origen y destino/);
    assert.equal(m.carrito().items.length, 1);
    m.desmontar();
  });

  test("impuesto no comisionable: se captura (0 por defecto), no puede superar el precio y queda en el ítem del carrito", async () => {
    const m = await montar([hotel]);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    assert.equal(porId(m.container, "man-imp")!.value, "0");
    await llenar(m, { clase: "otro", nombre: "Traslado privado", pax: "2", precio: "90000" });
    await escribir(porId(m.container, "man-imp")!, "90001");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? "", /impuesto no comisionable no puede superar el precio/);
    assert.equal(m.carrito().items.length, 1);
    await escribir(porId(m.container, "man-imp")!, "9000");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    const items = m.carrito().items as unknown as Record<string, unknown>[];
    assert.deepEqual([items.length, items[1].impuestoNoComisionable], [2, 9000]);
    m.desmontar();
  });

  test("precio 0 o pasajeros 0 se rechazan antes de entrar al carrito", async () => {
    const m = await montar([hotel]);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    await llenar(m, { clase: "otro", nombre: "Traslado privado", pax: "2", precio: "0" });
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? "", /precio de venta debe ser mayor que cero/);
    await escribir(porId(m.container, "man-precio")!, "90000");
    await escribir(porId(m.container, "man-pax")!, "0");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? "", /pasajeros/);
    assert.equal(m.carrito().items.length, 1);
    m.desmontar();
  });

  test("el carrito en USD fija la moneda del manual a USD", async () => {
    const m = await montar([{ ...hotel, precio: 1_200, moneda: "USD" }]);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    assert.match(sinEspacios(m.container.textContent ?? ""), /Precio de venta total \(USD\)/);
    await llenar(m, { clase: "otro", nombre: "Seguro de viaje", pax: "2", precio: "80" });
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
    const man = m.carrito().items[1] as unknown as Record<string, unknown>;
    assert.deepEqual([man.moneda, man.precio], ["USD", 80]);
    assert.match(m.texto(), /Total estimado\s?USD \$1,280/);
    m.desmontar();
  });

  test("al generar la cotización viaja solo lo declarado: sin costo, proveedor ni id", async () => {
    const manual = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, tramo: null, hotelRef: null, hotelEtiqueta: null, pax: 2, precio: 90_000, impuestoNoComisionable: 25_000, moneda: "COP", fotoUrl: null, noches: null };
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hotel, manual]);
    const n0 = stub.__solicitudes.length;
    await act(async () => {
      const set = (label: string, v: string) => {
        const l = [...m.container.querySelectorAll("label")].find((x) => x.textContent === label)!;
        const i = l.parentElement!.querySelector("input") as HTMLInputElement;
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, v);
        i.dispatchEvent(new window.Event("input", { bubbles: true }));
      };
      set("Nombres *", "Ana"); set("Apellidos *", "Pérez"); set("Teléfono / WhatsApp *", "300");
      const doc = [...m.container.querySelectorAll("label")].find((l) => /documento/i.test(l.textContent ?? "") && l.parentElement!.querySelector("input"));
      if (doc) { const i = doc.parentElement!.querySelector("input") as HTMLInputElement; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, "123"); i.dispatchEvent(new window.Event("input", { bubbles: true })); }
      await espera();
    });
    await act(async () => { click(boton(/Generar cotización y enviar solicitud/, m.container)!); await espera(80); });
    const enviado = stub.__solicitudes[n0] as { manuales?: Record<string, unknown>[] } | undefined;
    assert.ok(enviado, "se envió la solicitud");
    assert.deepEqual(Object.keys(enviado!.manuales![0]).sort(), ["clase", "destino", "fechaIda", "fechaRegreso", "horaIda", "horaRegreso", "hotelRef", "impuestoNoComisionable", "moneda", "nombre", "origen", "pax", "precio", "tramo"]);
    assert.equal(enviado!.manuales![0].precio, 90_000);
    assert.equal(enviado!.manuales![0].impuestoNoComisionable, 25_000, "el impuesto no comisionable viaja para congelarse en la cotización");
    stub.__setCrearSolicitudReserva(null);
    m.desmontar();
  });
});

describe("Checkout sin permiso interno", () => {
  test("un visitante no ve el panel de servicio manual", async () => {
    stub.__setContextoAsistencia({ puede: false });
    const m = await montar([hotel]);
    assert.doesNotMatch(m.texto(), /Servicio manual \(vuelo u otro\)/);
    m.desmontar();
  });
});

describe("ConvertirCarritoBtn con servicios manuales", () => {
  const base = {
    id: 1, pax: 2, items: [{ hotelNombre: "Hotel Almirante", destino: "CARTAGENA", pax: 2, fechaIda: "2030-10-15", precio: 1_200_000 }], tours: [], destinos: ["CARTAGENA"],
    cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "1" }, esSuperadmin: true, asesores: [], miNombre: "", miRolVenta: false,
    manuales: [{ nombre: "Tiquete aéreo", pax: 2, precio: 1_800_000, moneda: "COP" }],
  };
  const llamadas: { id: number; opts: Record<string, unknown> }[] = [];
  before(() => { __setConvertirCotizacionCarrito(async (id: number, opts: never) => { llamadas.push({ id, opts }); return { ok: true, numeros: ["DTM-1"] }; }); });
  after(() => { __setConvertirCotizacionCarrito(null); });

  async function abrir(extra: Record<string, unknown> = {}) {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => { r.render(h(ConvertirCarritoBtn, { ...base, ...extra } as never)); await espera(); });
    await act(async () => { click(boton(/Confirmar → generar contrato/, c)!); await espera(); });
    return { c, desmontar: () => { act(() => r.unmount()); c.remove(); } };
  }
  async function elegirMonedaCobro(c: HTMLElement) {
    const s = c.querySelector('select[aria-label="Moneda de cobro"]') as HTMLSelectElement;
    await escribir(s, "COP");
  }
  async function llenarPasajero(c: HTMLElement) {
    // Todas las filas de pasajeros: nombres y apellidos obligatorios.
    for (const l of [...c.querySelectorAll("label")].filter((x) => x.textContent === "Nombres" || x.textContent === "Apellidos")) {
      const i = l.parentElement!.querySelector("input") as HTMLInputElement | null;
      if (i && !i.value) await escribir(i, l.textContent === "Nombres" ? "Luis" : "Gómez");
    }
  }

  test("pide costo neto y proveedor por cada manual y muestra la venta declarada", async () => {
    const m = await abrir();
    const panel = sinEspacios(m.c.querySelector('[data-testid="costos-manuales-carrito"]')!.textContent ?? "");
    assert.match(panel, /Tiquete aéreo · 2 pax · venta \$\s?1\.800\.000/);
    assert.match(panel, /Sin costo y proveedor no se genera el contrato/);
    m.desmontar();
  });

  test("sin costo/proveedor NO llama al servidor; con ellos envía costosManuales", async () => {
    const m = await abrir();
    await elegirMonedaCobro(m.c);
    await llenarPasajero(m.c);
    const n0 = llamadas.length;
    await act(async () => { click(boton(/Generar contrato\(s\)/, m.c)!); await espera(); });
    assert.equal(llamadas.length, n0, "no se envió nada");
    assert.match(m.c.textContent ?? "", /Tiquete aéreo: captura el costo neto y el proveedor/);
    await escribir(porId(m.c, "man-costo-0")!, "1500000");
    await act(async () => { click(boton(/Generar contrato\(s\)/, m.c)!); await espera(); });
    assert.equal(llamadas.length, n0, "con costo pero sin proveedor tampoco");
    await escribir(porId(m.c, "man-prov-0")!, "Proveedor Vuelos");
    await act(async () => { click(boton(/Generar contrato\(s\)/, m.c)!); await espera(60); });
    assert.equal(llamadas.length, n0 + 1);
    assert.deepEqual(llamadas[n0].opts.costosManuales, [{ costo: 1_500_000, proveedor: "Proveedor Vuelos" }]);
    m.desmontar();
  });

  test("la vista previa del cobro suma el manual al primer contrato", async () => {
    const m = await abrir();
    await elegirMonedaCobro(m.c);
    const t = sinEspacios(m.c.querySelector('[data-testid="totales-cobro-carrito"]')!.textContent ?? "");
    assert.match(t, /\$\s?3\.000\.000/, "1.200.000 del hotel + 1.800.000 del vuelo manual");
    m.desmontar();
  });

  describe("reintento parcial: el primer destino (el que lleva los manuales) ya tiene contrato", () => {
    const dos = {
      items: [
        { hotelNombre: "Hotel Almirante", destino: "CARTAGENA", pax: 2, fechaIda: "2030-10-15", precio: 1_200_000 },
        { hotelNombre: "Hotel Rodadero", destino: "SANTA MARTA", pax: 2, fechaIda: "2030-10-18", precio: 900_000 },
      ],
      destinos: ["CARTAGENA", "SANTA MARTA"],
    };
    async function porDestino(extra: Record<string, unknown>) {
      const m = await abrir({ ...dos, ...extra });
      await act(async () => { click(boton(/1 contrato por destino/, m.c)!); await espera(); });
      return m;
    }
    test("primer destino YA convertido: no se piden ni se envían costos manuales y el reintento sigue su camino", async () => {
      const m = await porDestino({ contratosPorGrupo: { CARTAGENA: "DTM-1" } });
      assert.equal(m.c.querySelector('[data-testid="costos-manuales-carrito"]'), null);
      await elegirMonedaCobro(m.c);
      await llenarPasajero(m.c);
      const n0 = llamadas.length;
      await act(async () => { click(boton(/Generar contrato\(s\)/, m.c)!); await espera(60); });
      assert.equal(llamadas.length, n0 + 1, m.c.textContent ?? "");
      assert.equal("costosManuales" in llamadas[n0].opts, false, "no viaja costosManuales");
      m.desmontar();
    });
    test("primer destino AÚN pendiente (solo el segundo está convertido): se siguen exigiendo", async () => {
      const m = await porDestino({ contratosPorGrupo: { "SANTA MARTA": "DTM-2" } });
      assert.ok(m.c.querySelector('[data-testid="costos-manuales-carrito"]'));
      await elegirMonedaCobro(m.c);
      await llenarPasajero(m.c);
      const n0 = llamadas.length;
      await act(async () => { click(boton(/Generar contrato\(s\)/, m.c)!); await espera(); });
      assert.equal(llamadas.length, n0, "sin costos no se envía");
      assert.match(m.c.textContent ?? "", /Tiquete aéreo: captura el costo neto y el proveedor/);
      m.desmontar();
    });
  });

  test("sin manuales no aparece el panel de costos ni se envía costosManuales", async () => {
    const m = await abrir({ manuales: [] });
    assert.equal(m.c.querySelector('[data-testid="costos-manuales-carrito"]'), null);
    m.desmontar();
  });
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 5: vuelo por tramos con códigos IATA del catálogo, fechas del PLAN del hotel y grupos de alternativas.
describe("Panel de vuelo manual: tramos, IATA, fechas del plan y hotel del carrito", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => stub.__setContextoAsistencia({ puede: false }));
  const hotel2 = { ...hotel, id: "h2", hotelNombre: "Hotel Rodadero", destino: "SANTA MARTA", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24", pax: 3, precio: 900_000 };
  type M = Awaited<ReturnType<typeof montar>>;
  const textoAlerta = (m: M) => m.container.querySelector('[role="alert"]')?.textContent ?? "";
  async function abrirPanel(m: M) { await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); }); }
  async function datosVuelo(m: M, v: { tramo?: string; otra?: string; pax?: string; precio?: string }) {
    const c = m.container;
    if (v.tramo) await escribir(porId(c, "man-tramo")!, v.tramo);
    await escribir(porId(c, "man-nombre")!, "Tiquete Avianca");
    if (v.otra !== undefined) await escribir(porId(c, "man-otra")!, v.otra);
    if (v.pax) await escribir(porId(c, "man-pax")!, v.pax);
    await escribir(porId(c, "man-precio")!, v.precio ?? "1800000");
  }
  const guardar = async (m: M) => { await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); }); };
  const ultimo = (m: M) => m.carrito().items.at(-1) as unknown as Record<string, unknown>;

  test("un solo hotel: se asocia a él sin elegir; llegada = CTG (código del catálogo); pasajeros = total de la cotización", async () => {
    const m = await montar([hotel]);
    await abrirPanel(m);
    assert.equal(porId(m.container, "man-hotel")!.tagName, "P");
    assert.match(sinEspacios(porId(m.container, "man-hotel")!.textContent ?? ""), /Hotel Almirante/);
    assert.equal(porId(m.container, "man-hotel-ciudad")!.textContent, "CTG", "Cartagena se ve como CTG");
    assert.equal(porId(m.container, "man-pax")!.value, "2");
    assert.deepEqual([...porId(m.container, "man-tramo")!.querySelectorAll("option")].map((o) => o.textContent), ["Solo ida", "Solo regreso", "Ida y regreso"]);
    m.desmontar();
  });

  test("ida y regreso: toma AMBAS fechas del plan del hotel (no se escriben) y muestra los dos tramos con códigos IATA", async () => {
    const m = await montar([hotel]);
    await abrirPanel(m);
    await datosVuelo(m, { otra: "bog" });
    assert.equal(porId(m.container, "man-ida")!.textContent, "2030-10-15");
    assert.equal(porId(m.container, "man-regreso")!.textContent, "2030-10-18");
    assert.equal(porId(m.container, "man-ida")!.tagName, "P", "no hay campo de fecha que escribir");
    const resumen = sinEspacios(m.container.querySelector('[data-testid="resumen-tramos-vuelo"]')!.textContent ?? "");
    assert.match(resumen, /Ida: BOG → CTG/);
    assert.match(resumen, /Regreso: CTG → BOG/);
    await guardar(m);
    const x = ultimo(m);
    assert.deepEqual([x.tramo, x.origen, x.destino, x.fechaIda, x.fechaRegreso, x.hotelRef, x.pax], ["ida_regreso", "BOG", "CTG", "2030-10-15", "2030-10-18", "h1", 2]);
    m.desmontar();
  });

  test("solo ida: únicamente la fecha de ida del plan; el regreso no aplica", async () => {
    const m = await montar([hotel]);
    await abrirPanel(m);
    await datosVuelo(m, { tramo: "ida", otra: "BOG" });
    assert.equal(porId(m.container, "man-ida")!.textContent, "2030-10-15");
    assert.equal(porId(m.container, "man-regreso")!.textContent, "No aplica");
    await guardar(m);
    const x = ultimo(m);
    assert.deepEqual([x.tramo, x.origen, x.destino, x.fechaIda, x.fechaRegreso], ["ida", "BOG", "CTG", "2030-10-15", null]);
    m.desmontar();
  });

  test("solo regreso: únicamente la fecha de regreso del plan; origen = CTG", async () => {
    const m = await montar([hotel]);
    await abrirPanel(m);
    await datosVuelo(m, { tramo: "regreso", otra: "MDE" });
    assert.equal(porId(m.container, "man-ida")!.textContent, "No aplica");
    assert.equal(porId(m.container, "man-regreso")!.textContent, "2030-10-18");
    await guardar(m);
    const x = ultimo(m);
    assert.deepEqual([x.tramo, x.origen, x.destino, x.fechaIda, x.fechaRegreso], ["regreso", "CTG", "MDE", null, "2030-10-18"]);
    m.desmontar();
  });

  test("la otra ciudad va como código IATA de 3 letras: uno incompleto se rechaza explicando qué falta", async () => {
    const m = await montar([hotel]);
    await abrirPanel(m);
    await datosVuelo(m, { tramo: "ida", otra: "BO" });
    await guardar(m);
    assert.match(textoAlerta(m), /código IATA de 3 letras/);
    assert.equal(m.carrito().items.length, 1);
    m.desmontar();
  });

  test("si el plan del hotel cambió, el vuelo guardado se actualiza solo a las nuevas fechas", async () => {
    const viejo = { id: "m1", tipo: "manual", clase: "vuelo", nombre: "Tiquete Avianca", origen: "BOG", destino: "CTG", fechaIda: "2030-10-14", fechaRegreso: "2030-10-17", tramo: "ida_regreso", hotelRef: "h1", hotelEtiqueta: null, pax: 2, precio: 1_800_000, impuestoNoComisionable: 0, moneda: "COP", fotoUrl: null, noches: null };
    const m = await montar([hotel, viejo]);
    await act(async () => { await espera(60); });
    const x = m.carrito().items.at(-1) as unknown as Record<string, unknown>;
    assert.deepEqual([x.fechaIda, x.fechaRegreso], ["2030-10-15", "2030-10-18"], "las fechas del vuelo siguen al plan del hotel");
    m.desmontar();
  });

  test("pasajeros editables: un vuelo con menos pasajeros que la cotización conserva su número", async () => {
    const m = await montar([hotel]);
    await abrirPanel(m);
    await datosVuelo(m, { tramo: "ida", otra: "BOG", pax: "1" });
    await guardar(m);
    assert.equal(ultimo(m).pax, 1);
    m.desmontar();
  });

  test("varios destinos: hay que ELEGIR el hotel (no se asigna al primero) y la llegada y las fechas son las de ese hotel", async () => {
    const m = await montar([hotel, hotel2]);
    await abrirPanel(m);
    assert.equal(porId(m.container, "man-hotel")!.tagName, "SELECT");
    await datosVuelo(m, { tramo: "ida", otra: "BOG" });
    await guardar(m);
    assert.match(textoAlerta(m), /Elige el hotel o destino del carrito/);
    assert.equal(m.carrito().items.length, 2, "sin hotel elegido no entra");
    await escribir(porId(m.container, "man-hotel")!, "h2");
    assert.equal(porId(m.container, "man-hotel-ciudad")!.textContent, "SMR");
    assert.equal(porId(m.container, "man-ida")!.textContent, "2030-10-20");
    await guardar(m);
    const x = ultimo(m);
    assert.deepEqual([x.hotelRef, x.destino, x.fechaIda], ["h2", "SMR", "2030-10-20"]);
    m.desmontar();
  });

  test("un destino sin código IATA confiable en el catálogo: se avisa que hay que corregirlo y no se agrega el vuelo (no se infiere del nombre)", async () => {
    const raro = { ...hotel, destino: "NARNIA" };
    const m = await montar([raro]);
    assert.match(m.container.querySelector('[data-testid="aviso-iata"]')?.textContent ?? "", /NARNIA.*código IATA confiable.*Producto → Destinos/);
    await abrirPanel(m);
    await datosVuelo(m, { tramo: "ida", otra: "BOG" });
    await guardar(m);
    assert.match(textoAlerta(m), /código IATA confiable/);
    assert.equal(m.carrito().items.length, 1);
    m.desmontar();
  });

  test("al generar la cotización viajan tramo, hotel (id del carrito) y las fechas del plan", async () => {
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hotel]);
    await abrirPanel(m);
    await datosVuelo(m, { otra: "BOG" });
    await guardar(m);
    const n0 = stub.__solicitudes.length;
    await llenarClienteCheckout(m);
    await act(async () => { click(boton(/Generar cotización y enviar solicitud/, m.container)!); await espera(80); });
    const enviado = stub.__solicitudes[n0] as { manuales?: Record<string, unknown>[]; items: { itemId: string }[] } | undefined;
    assert.ok(enviado);
    const v = enviado!.manuales![0];
    assert.deepEqual([v.tramo, v.hotelRef, v.origen, v.destino, v.fechaIda, v.fechaRegreso, enviado!.items[0].itemId], ["ida_regreso", "h1", "BOG", "CTG", "2030-10-15", "2030-10-18", "h1"]);
    stub.__setCrearSolicitudReserva(null);
    m.desmontar();
  });
});

async function llenarClienteCheckout(m: Awaited<ReturnType<typeof montar>>) {
  await act(async () => {
    const set = (label: string, v: string) => {
      const l = [...m.container.querySelectorAll("label")].find((x) => x.textContent === label)!;
      const i = l.parentElement!.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, v);
      i.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    set("Nombres *", "Ana"); set("Apellidos *", "Pérez"); set("Teléfono / WhatsApp *", "300");
    const doc = [...m.container.querySelectorAll("label")].find((l) => /documento/i.test(l.textContent ?? "") && l.parentElement!.querySelector("input"));
    if (doc) { const i = doc.parentElement!.querySelector("input") as HTMLInputElement; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, "123"); i.dispatchEvent(new window.Event("input", { bubbles: true })); }
    await espera();
  });
}

describe("Comparativa del carrito: grupos de alternativas y vuelos por grupo", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => { stub.__setContextoAsistencia({ puede: false }); window.history.pushState({}, "", "/"); });
  const hot = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({ ...hotel, id, hotelNombre: nombre, paqueteId: 10 + id.length, hotelId: id.charCodeAt(0), ...extra });
  const tres = () => [hot("a", "Hotel A"), hot("b", "Hotel B"), hot("c", "Hotel C")];
  type M = Awaited<ReturnType<typeof montar>>;
  const enComparativa = () => window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
  async function agregarVuelo(m: M, v: { otra?: string; tramo?: string; seleccion?: string } = {}) {
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    if (v.tramo) await escribir(porId(m.container, "man-tramo")!, v.tramo);
    if (v.seleccion) await escribir(porId(m.container, "man-hotel")!, v.seleccion);
    await escribir(porId(m.container, "man-nombre")!, "Tiquete Avianca");
    await escribir(porId(m.container, "man-otra")!, v.otra ?? "BOG");
    await escribir(porId(m.container, "man-precio")!, "1800000");
    await act(async () => { click(boton("Agregar al carrito", m.container)!); await espera(); });
  }
  const enviar = async (m: M) => {
    await llenarClienteCheckout(m);
    const n0 = stub.__comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
    return stub.__comparativas[n0] as { manuales?: Record<string, unknown>[] } | undefined;
  };

  test("tres hoteles dobles del mismo destino y fechas: un solo grupo, el vuelo propone 2 pasajeros (no 6) y se aplica solo a todas las opciones", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar(tres());
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    assert.equal(porId(m.container, "man-pax")!.value, "2", "las alternativas no se suman: 2, no 6");
    assert.match(sinEspacios(porId(m.container, "man-hotel")!.textContent ?? ""), /Todas las opciones · CTG/);
    assert.equal(porId(m.container, "man-hotel")!.tagName, "P", "sin selector: un único destino y una sola pareja de fechas");
    await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
    await agregarVuelo(m);
    const enviado = await enviar(m);
    assert.ok(enviado);
    assert.deepEqual([enviado!.manuales![0].hotelRef, enviado!.manuales![0].fechaIda, enviado!.manuales![0].fechaRegreso, enviado!.manuales![0].pax], ["grupo:CTG|2030-10-15|2030-10-18", "2030-10-15", "2030-10-18", 2]);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("dos destinos: se elige el hotel para asociar el tiquete y viaja la clave de SU grupo", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hot("a", "Hotel A"), hot("s", "Hotel Rodadero", { destino: "SANTA MARTA", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24" })]);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    assert.equal(porId(m.container, "man-hotel")!.tagName, "SELECT", "con más de un destino se conserva el selector de hotel");
    await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
    await agregarVuelo(m, { seleccion: "s", otra: "BOG" });
    const enviado = await enviar(m);
    assert.deepEqual([enviado!.manuales![0].hotelRef, enviado!.manuales![0].destino, enviado!.manuales![0].fechaIda], ["grupo:SMR|2030-10-20|2030-10-24", "SMR", "2030-10-20"]);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("un destino con dos fechas: se identifica el GRUPO DE FECHAS sin escoger un hotel individual", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hot("a", "Hotel A"), hot("b", "Hotel B", { fechaIda: "2030-11-01", fechaRegreso: "2030-11-04" })]);
    await act(async () => { click(boton(/Agregar/, m.container)!); await espera(); });
    const opciones = [...porId(m.container, "man-hotel")!.querySelectorAll("option")].map((o) => o.textContent ?? "");
    assert.ok(opciones.some((t) => /CTG · 10\/15 → 10\/18/.test(t)) && opciones.some((t) => /CTG · 11\/01 → 11\/04/.test(t)), opciones.join(" | "));
    await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
    await agregarVuelo(m, { seleccion: "grupo:CTG|2030-11-01|2030-11-04" });
    const enviado = await enviar(m);
    assert.deepEqual([enviado!.manuales![0].hotelRef, enviado!.manuales![0].fechaIda, enviado!.manuales![0].fechaRegreso], ["grupo:CTG|2030-11-01|2030-11-04", "2030-11-01", "2030-11-04"]);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("multidestino con habitaciones de más de un tipo y vuelos: se rechaza ANTES de crear, con un mensaje visible y claro", async () => {
    enComparativa();
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hot("a", "Hotel A", { habitaciones: { doble: 1, sencilla: 1 } }), hot("s", "Hotel Rodadero", { destino: "SANTA MARTA", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24" })]);
    await agregarVuelo(m, { seleccion: "a" });
    await llenarClienteCheckout(m);
    const n0 = stub.__comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
    assert.equal(stub.__comparativas.length, n0, "no se llamó al servidor");
    assert.match([...m.container.querySelectorAll('[role="alert"]')].map((x) => x.textContent).join(" | "), /misma acomodación.*Hotel A/);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("cada opción se muestra por separado con su PVP (hotel + servicios + vuelos del grupo); no hay «Total (PVP)» ni total del carrito", async () => {
    enComparativa();
    const addonA = { ...addon, id: "t1", hotelItemId: "a", precio: 180_000 };
    const m = await montar(tres());
    await act(async () => { m.carrito().add(addonA as never); await espera(); });
    await agregarVuelo(m);
    const opciones = [...m.container.querySelectorAll('[data-testid="opcion-comparativa"]')];
    assert.equal(opciones.length, 3);
    const pvps = opciones.map((o) => sinEspacios(o.querySelector('[data-testid="pvp-opcion"]')!.textContent ?? ""));
    assert.match(pvps[0], /\$\s?3\.180\.000/, "A: 1.200.000 + servicio 180.000 + vuelo 1.800.000");
    assert.match(pvps[1], /\$\s?3\.000\.000/);
    assert.match(pvps[2], /\$\s?3\.000\.000/);
    assert.doesNotMatch(m.texto(), /Total \(PVP\)|Total estimado/);
    assert.doesNotMatch(m.texto(), /\$\s?5\.400\.000|\$\s?9\.[0-9]{3}\.000/, "ninguna suma de alternativas");
    assert.equal(opciones.every((o) => /grid|flex/.test(o.className)), true);
    m.desmontar();
  });

  test("render móvil y escritorio: la rejilla pasa de 1 columna (móvil) a 2 y 3 (escritorio) y los textos largos no desbordan", async () => {
    enComparativa();
    const m = await montar(tres());
    const rejilla = m.container.querySelector('[data-testid="grupo-comparativa"] > div')!;
    assert.match(rejilla.className, /\bgrid-cols-1\b/, "móvil: una columna");
    assert.match(rejilla.className, /\bmd:grid-cols-2\b/);
    assert.match(rejilla.className, /\bxl:grid-cols-3\b/, "escritorio ancho: tres columnas");
    const tarjeta = m.container.querySelector('[data-testid="opcion-comparativa"]')!;
    assert.match(tarjeta.className, /\bmin-w-0\b/, "la tarjeta puede encogerse en móvil");
    assert.ok(tarjeta.querySelector("h3.break-words"), "los nombres largos parten línea");
    assert.doesNotMatch(m.container.innerHTML, /style="[^"]*width:\s*\d{3,}px/, "sin anchos fijos que desborden en móvil");
    m.desmontar();
  });
});

describe("Modo comparativa en el carrito: el cuarto hotel no entra desde donde se pulsa «Agregar»", () => {
  const { ModoComparativaBooking } = comparativaBooking;
  function Pulsador({ n }: { n: number }) {
    const { add, addConjunto } = useCart();
    return h("div", null,
      h("button", { type: "button", "data-testid": "agregar-hotel", onClick: () => add({ ...hotel, id: undefined, hotelNombre: `Hotel extra ${n}` } as never) }, "Agregar hotel"),
      h("button", { type: "button", "data-testid": "agregar-conjunto", onClick: () => addConjunto({ ...hotel, hotelNombre: `Conjunto extra ${n}` } as never, []) }, "Agregar conjunto"));
  }
  async function montarCarrito(items: unknown[]) {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
    const container = document.createElement("div");
    document.body.appendChild(container);
    let carrito!: ReturnType<typeof useCart>;
    function Espia() { carrito = useCart(); return null; }
    const root = createRoot(container);
    await act(async () => { root.render(h(CartProvider, null, h(ModoComparativaBooking), h(Pulsador, { n: 4 }), h(Espia, null))); await espera(); });
    return { container, carrito: () => carrito, desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
  }
  const tresH = () => ["a", "b", "c"].map((id) => ({ ...hotel, id, hotelNombre: `Hotel ${id.toUpperCase()}` }));

  test("con la comparativa activa y 3 hoteles, «Agregar» no agrega un cuarto y muestra el aviso en el mismo lugar", async () => {
    const m = await montarCarrito(tresH());
    await act(async () => { click(boton(/Cotización comparativa/, m.container)!); await espera(); });
    assert.equal(m.carrito().modoComparativa, true);
    await act(async () => { click(m.container.querySelector('[data-testid="agregar-hotel"]')!); await espera(); });
    assert.equal(m.carrito().items.length, 3, "el cuarto hotel no entró");
    const aviso = m.container.querySelector('[data-testid="aviso-comparativa-maximo"]');
    assert.ok(aviso, "aviso visible");
    assert.equal(aviso!.getAttribute("role"), "alert");
    assert.match(aviso!.textContent ?? "", /hasta 3 hoteles/);
    await act(async () => { click(m.container.querySelector('[data-testid="agregar-conjunto"]')!); await espera(); });
    assert.equal(m.carrito().items.length, 3, "tampoco por «hotel con sus servicios»");
    m.desmontar();
  });

  test("el carrito lateral NO muestra un total global en modo comparativa (sí en el carrito normal)", async () => {
    const { CartDrawer } = await import("../app/tarifario/CartDrawer.tsx");
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(tresH()));
    const container = document.createElement("div");
    document.body.appendChild(container);
    let carrito!: ReturnType<typeof useCart>;
    function Espia() { carrito = useCart(); return null; }
    const root = createRoot(container);
    await act(async () => { root.render(h(CartProvider, null, h(CartDrawer, { checkoutHabilitado: true }), h(Espia, null))); await espera(); });
    await act(async () => { carrito.openDrawer(); await espera(); });
    assert.match(sinEspacios(container.textContent ?? ""), /Total estimado/, "carrito normal: total estimado");
    await act(async () => { carrito.setModoComparativa(true); await espera(); });
    const t = sinEspacios(container.textContent ?? "");
    assert.doesNotMatch(t, /Total estimado/, "modo comparativa: sin total global");
    assert.ok(container.querySelector('[data-testid="sin-total-comparativa"]'));
    assert.doesNotMatch(t, /\$\s?3\.600\.000/, "no se suman los hoteles alternativos");
    act(() => root.unmount()); container.remove(); localStorage.clear();
  });

  test("con la comparativa apagada el carrito normal sigue admitiendo más de 3 hoteles; con 2 hoteles activa sí deja agregar el tercero", async () => {
    const libre = await montarCarrito(tresH());
    await act(async () => { click(libre.container.querySelector('[data-testid="agregar-hotel"]')!); await espera(); });
    assert.equal(libre.carrito().items.length, 4);
    assert.equal(libre.container.querySelector('[data-testid="aviso-comparativa-maximo"]'), null);
    libre.desmontar();
    const dos = await montarCarrito(tresH().slice(0, 2));
    await act(async () => { click(boton(/Cotización comparativa/, dos.container)!); await espera(); });
    await act(async () => { click(dos.container.querySelector('[data-testid="agregar-hotel"]')!); await espera(); });
    assert.equal(dos.carrito().items.length, 3);
    dos.desmontar();
  });
});

describe("ConvertirCarritoBtn: cada vuelo viaja y pide costos según el contrato de SU hotel", () => {
  const dos = {
    id: 1, pax: 2, destinos: ["CARTAGENA", "SANTA MARTA"], cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "1" }, esSuperadmin: true, asesores: [], miNombre: "", miRolVenta: false,
    items: [
      { hotelNombre: "Hotel Almirante", destino: "CARTAGENA", pax: 2, fechaIda: "2030-10-15", precio: 1_200_000 },
      { hotelNombre: "Hotel Rodadero", destino: "SANTA MARTA", pax: 2, fechaIda: "2030-10-20", precio: 900_000 },
    ],
    tours: [],
    manuales: [{ nombre: "Vuelo a Santa Marta", pax: 2, precio: 1_800_000, moneda: "COP", hotelIndice: 1 }],
  };
  const llamadas: { id: number; opts: Record<string, unknown> }[] = [];
  before(() => { __setConvertirCotizacionCarrito(async (id: number, opts: never) => { llamadas.push({ id, opts }); return { ok: true, numeros: ["DTM-1"] }; }); });
  after(() => { __setConvertirCotizacionCarrito(null); });
  async function abrir(extra: Record<string, unknown>) {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => { r.render(h(ConvertirCarritoBtn, { ...dos, ...extra } as never)); await espera(); });
    await act(async () => { click(boton(/Confirmar → generar contrato/, c)!); await espera(); });
    await act(async () => { click(boton(/1 contrato por destino/, c)!); await espera(); });
    return { c, desmontar: () => { act(() => r.unmount()); c.remove(); } };
  }

  test("el vuelo de Santa Marta se suma al contrato de Santa Marta, no al primero", async () => {
    const m = await abrir({});
    await escribir(m.c.querySelector('select[aria-label="Moneda de cobro"]') as HTMLSelectElement, "COP");
    const t = sinEspacios(m.c.querySelector('[data-testid="totales-cobro-carrito"]')!.textContent ?? "");
    assert.match(t, /\$\s?1\.200\.000/, "el primer contrato queda solo con su hotel");
    assert.match(t, /\$\s?2\.700\.000/, "el segundo: 900.000 del hotel + 1.800.000 del vuelo");
    m.desmontar();
  });

  test("primer destino convertido pero el vuelo vive en el segundo (pendiente): SE PIDE costo y proveedor", async () => {
    const m = await abrir({ contratosPorGrupo: { CARTAGENA: "DTM-1" } });
    assert.ok(m.c.querySelector('[data-testid="costos-manuales-carrito"]'));
    m.desmontar();
  });

  test("el destino del vuelo ya convertido (aunque el otro siga pendiente): NO se piden ni se envían costos", async () => {
    const m = await abrir({ contratosPorGrupo: { "SANTA MARTA": "DTM-2" } });
    assert.equal(m.c.querySelector('[data-testid="costos-manuales-carrito"]'), null);
    m.desmontar();
  });
});

describe("Comparativa: el interno decide si el cliente puede elegir desde el enlace", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => { stub.__setContextoAsistencia({ puede: false }); window.history.pushState({}, "", "/"); });
  const hotelB = { ...hotel, id: "h2", hotelNombre: "Hotel Rodadero", paqueteId: 11, hotelId: 2 };
  async function enviarComparativa(m: Awaited<ReturnType<typeof montar>>) {
    await act(async () => {
      const set = (label: string, v: string) => {
        const l = [...m.container.querySelectorAll("label")].find((x) => x.textContent === label)!;
        const i = l.parentElement!.querySelector("input") as HTMLInputElement;
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, v);
        i.dispatchEvent(new window.Event("input", { bubbles: true }));
      };
      set("Nombres *", "Ana"); set("Apellidos *", "Pérez"); set("Teléfono / WhatsApp *", "300");
      await espera();
    });
    const n0 = stub.__comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
    return stub.__comparativas[n0] as Record<string, unknown> | undefined;
  }

  test("el casillero NO viene marcado: sin marcarlo no viaja la clave (la comparativa queda solo para el equipo)", async () => {
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hotel, hotelB]);
    const caja = m.container.querySelector('[data-testid="compartir-comparativa"]') as HTMLInputElement;
    assert.ok(caja, "el interno ve el casillero");
    assert.equal(caja.checked, false);
    assert.match(m.texto(), /Permitir que el cliente elija desde el enlace/);
    const enviado = await enviarComparativa(m);
    assert.ok(enviado);
    assert.equal("compartirPublico" in enviado!, false);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("marcado: viaja compartirPublico = true (el servidor lo vuelve a exigir al personal interno)", async () => {
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hotel, hotelB]);
    await act(async () => { click(m.container.querySelector('[data-testid="compartir-comparativa"]')!); await espera(); });
    const enviado = await enviarComparativa(m);
    assert.ok(enviado);
    assert.equal(enviado!.compartirPublico, true);
    stub.__setCrearComparativaCarrito(null);
    m.desmontar();
  });

  test("un visitante no ve el casillero ni puede marcarlo", async () => {
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    stub.__setContextoAsistencia({ puede: false });
    const m = await montar([hotel, hotelB]);
    assert.equal(m.container.querySelector('[data-testid="compartir-comparativa"]'), null);
    stub.__setContextoAsistencia({ puede: true, aliados: [] });
    m.desmontar();
  });
});

describe("#75 Comparativa: tras intentar Preparar no se genera con la propuesta automática", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => { stub.__setContextoAsistencia({ puede: false }); window.history.pushState({}, "", "/"); stub.__setPrevisualizarPresentacion(null); stub.__setCrearComparativaCarrito(null); });
  const hotelB = { ...hotel, id: "h2", hotelNombre: "Hotel Rodadero", paqueteId: 11, hotelId: 2 };
  const OPCIONES = [
    { clave: "A/doble", opcionRef: "A", acomodacionRef: "doble", hotel: "Hotel A", lineas: [], incluye: "Desayuno", noIncluye: "" },
    { clave: "B/doble", opcionRef: "B", acomodacionRef: "doble", hotel: "Hotel B", lineas: [], incluye: "Desayuno", noIncluye: "" },
  ];
  async function preparar() {
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" }));
    const m = await montar([hotel, hotelB]);
    await llenarClienteCheckout(m);
    return m;
  }
  const generar = async (m: Awaited<ReturnType<typeof montar>>) => {
    const n0 = stub.__comparativas.length;
    await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
    return stub.__comparativas.length - n0;
  };
  const alerta = (m: Awaited<ReturnType<typeof montar>>) => [...m.container.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" | ");

  test("la vista previa falló: Generar no envía nada y explica el motivo; al corregirla (Preparar ok) sí envía", async () => {
    stub.__setPrevisualizarPresentacion(async () => ({ ok: false, error: "No se pudo liquidar la opción B." }));
    const m = await preparar();
    await act(async () => { click(boton(/^Preparar$/, m.container)!); await espera(80); });
    assert.match(alerta(m), /No se pudo liquidar la opción B/);
    assert.equal(await generar(m), 0, "no se envía la propuesta automática detrás del error");
    assert.match(alerta(m), /la preparación del Incluye \/ No incluye falló/);
    stub.__setPrevisualizarPresentacion(async () => ({ ok: true, opciones: OPCIONES }));
    await act(async () => { click(boton(/^Preparar$/, m.container)!); await espera(80); });
    assert.equal(await generar(m), 1, "ya preparada, se genera");
    m.desmontar();
  });

  test("la vista previa sigue en curso: Generar espera y no envía", async () => {
    let terminar!: (v: unknown) => void;
    stub.__setPrevisualizarPresentacion(() => new Promise((r) => { terminar = r; }));
    const m = await preparar();
    await act(async () => { click(boton(/^Preparar$/, m.container)!); await espera(20); });
    assert.equal(await generar(m), 0);
    assert.match(alerta(m), /se está preparando/);
    await act(async () => { terminar({ ok: true, opciones: OPCIONES }); await espera(40); });
    m.desmontar();
  });

  test("sin haber intentado Preparar, se genera con la propuesta del sistema como siempre", async () => {
    const m = await preparar();
    assert.equal(await generar(m), 1);
    m.desmontar();
  });
});
