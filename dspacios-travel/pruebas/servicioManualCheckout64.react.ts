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
    const manual = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, precio: 90_000, moneda: "COP", fotoUrl: null, noches: null };
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
    const manual = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, precio: 90_000, moneda: "COP", fotoUrl: null, noches: null };
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
    assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? "", /Un vuelo necesita origen, destino y fecha de ida/);
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
    const manual = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, precio: 90_000, impuestoNoComisionable: 25_000, moneda: "COP", fotoUrl: null, noches: null };
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
    assert.deepEqual(Object.keys(enviado!.manuales![0]).sort(), ["clase", "destino", "fechaIda", "fechaRegreso", "impuestoNoComisionable", "moneda", "nombre", "origen", "pax", "precio"]);
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
