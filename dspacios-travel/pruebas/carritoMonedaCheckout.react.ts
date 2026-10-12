// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Prueba de INTERACCIÓN REACT de la moneda en el carrito y el checkout,
// montando `CheckoutPage` y `CartDrawer` reales con el `CartProvider` real
// (carrito sembrado en localStorage) y las Server Actions del checkout
// stubeadas (pruebas/support/stubs/checkoutActionsStub.mjs):
//   · COP y USD: cada importe y el total en su moneda; comisión B2B en esa moneda;
//   · carrito mixto: subtotales por moneda, sin total ni comisión únicos sobre
//     la mezcla, y aviso de qué entra y qué queda fuera antes de enviar;
//   · hotel en otra moneda con servicios vinculados: aviso de rechazo;
//   · ítem antiguo sin moneda: "por confirmar", nunca presentado como COP;
//   · el checkout NO envía la moneda al servidor (sigue siendo autoritativo).
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
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
const { CartDrawer } = await import("../app/tarifario/CartDrawer.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const B2B = { esB2B: true, pctComision: 0.1, agencia: { nombre: "Agencia Uno", nit: "900", email: "a@b.co", telefono: "300" } };

// ── Ítems del carrito tal como los guarda CartContext ─────────────────────
const persona = (id: string, nombre: string, precio: number, moneda?: string) => ({
  id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: Number(id.replace(/\D/g, "")) || 1, bloqueoId: null,
  hotelNombre: nombre, destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno",
  fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  pax: 2, precio, edadesMenores: [], ...(moneda ? { moneda } : {}),
});
const unidad = (id: string, nombre: string, precio: number, moneda: string) => ({
  id, tipo: "hotel", modeloTarifario: "unidad", paqueteId: 20, hotelId: 9, hotelNombre: nombre, destino: "DUBAI", fotoUrl: null,
  categoria: "Deluxe", alimentacion: "Desayuno", salida: { tipo: "sin_vuelo", fechaIda: "2030-11-01", fechaRegreso: "2030-11-05" },
  habitaciones: [{ acom: "doble", adultos: 2, menores: [] }], precio, moneda,
});
const tour = (id: string, nombre: string, precio: number, moneda: string, hotelItemId?: string) => ({
  id, tipo: "tour", paqueteId: 10, servicioId: 55, nombre, destino: "CARTAGENA", fotoUrl: null,
  fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, pax: 2, precio, moneda, ...(hotelItemId ? { hotelItemId } : {}),
});

async function montar(items: unknown[], ui: "checkout" | "drawer") {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let carrito!: ReturnType<typeof useCart>;
  function Espia() { carrito = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => {
    root.render(h(CartProvider, null, ui === "checkout" ? h(CheckoutPage) : h(CartDrawer, { checkoutHabilitado: true }), h(Espia, null)));
    await espera();
  });
  if (ui === "drawer") await act(async () => { carrito.openDrawer(); await espera(); });
  return {
    texto: () => container.textContent ?? "",
    container,
    carrito: () => carrito,
    desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); },
  };
}

const sinEspacios = (s: string) => s.replace(/\s+/g, " ");

describe("Checkout B2B: importes, total y comisión en la moneda real", () => {
  before(() => stub.__setContextoB2B(B2B));
  after(() => stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null }));

  test("solo COP: total único y comisión en pesos", async () => {
    const v = await montar([persona("h1", "Hotel Almirante", 1_200_000, "COP"), tour("t1", "Islas del Rosario", 180_000, "COP", "h1")], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /Total \(PVP\)\s?\$\s?1\.380\.000/);
    assert.match(t, /Comisión a liquidar \(10%\)\s?\$\s?138\.000/);
    assert.doesNotMatch(t, /USD|Subtotal en|por confirmar/);
    v.desmontar();
  });

  test("solo USD: cada importe, el total y la comisión en USD — nunca como pesos", async () => {
    const v = await montar([persona("h1", "Hotel Dubái", 1_200, "USD"), tour("t1", "Safari", 180, "USD", "h1")], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /USD \$1,200/);
    assert.match(t, /USD \$180/);
    assert.match(t, /Total \(PVP\)\s?USD \$1,380/);
    assert.match(t, /Comisión a liquidar \(10%\)\s?USD \$138/);
    assert.doesNotMatch(t, /\$\s?1\.380|\$\s?1\.200/, "nunca el monto en dólares con formato de pesos");
    assert.doesNotMatch(t, /Subtotal en/);
    v.desmontar();
  });

  test("solo USD en modo neto: comisión y neto a pagar en USD", async () => {
    const v = await montar([persona("h1", "Hotel Dubái", 1_200, "USD")], "checkout");
    await act(async () => {
      const b = [...v.container.querySelectorAll("button")].find((x) => x.textContent === "Contrato neto")!;
      b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await espera();
    });
    const t = sinEspacios(v.texto());
    assert.match(t, /Comisión \(10%\)\s?−USD \$120/);
    assert.match(t, /Total neto a pagar\s?USD \$1,080/);
    v.desmontar();
  });

  test("mixto COP + USD: subtotales por moneda, sin total único; aviso de qué queda fuera; comisión solo sobre lo que se cotiza", async () => {
    const v = await montar([
      persona("h1", "Hotel Almirante", 1_200_000, "COP"),
      unidad("u1", "Hotel Dubái", 900, "USD"),
      tour("t1", "Islas del Rosario", 180_000, "COP", "h1"),
    ], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /Subtotal en COP \(2 ítems\)\s?\$\s?1\.380\.000/);
    assert.match(t, /Subtotal en USD \(1 ítem\)\s?USD \$900/);
    assert.doesNotMatch(t, /Total \(PVP\)/, "nunca un total único sobre la mezcla");
    assert.doesNotMatch(t, /1\.380\.900|2\.280\.000/, "nunca la suma de pesos con dólares");
    assert.match(t, /Tu carrito tiene importes en COP y USD\. Cada cotización se genera en una sola moneda\./);
    assert.match(t, /Se cotizará en COP \(moneda del primer hotel del carrito\): \$\s?1\.380\.000 estimado\./);
    assert.match(t, /Quedarán fuera de esta cotización: Hotel Dubái \(USD\)/);
    assert.match(t, /Comisión a liquidar \(10%\) sobre lo cotizado en COP\s?\$\s?138\.000/);
    v.desmontar();
  });

  test("mixto con hotel en otra moneda y servicios vinculados: avisa el rechazo y no muestra una comisión", async () => {
    const v = await montar([
      persona("h1", "Hotel Almirante", 1_200_000, "COP"),
      persona("h2", "Hotel Dubái", 1_200, "USD"),
      tour("t1", "Safari", 180, "USD", "h2"),
    ], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /Hotel Dubái está en USD y tiene servicios adicionales del hotel: así la solicitud no se podrá generar\./);
    assert.match(t, /La comisión se calculará sobre la cotización que se genere \(una sola moneda\)\./);
    assert.doesNotMatch(t, /Comisión a liquidar/);
    v.desmontar();
  });

  test("solo servicios en COP y USD: subtotales, sin afirmar moneda, exclusiones ni comisión (el servidor decide)", async () => {
    // El primer servicio (USD) puede quedar no disponible al re-liquidar y
    // entonces el COP fijaría la moneda: el cliente no lo sabe.
    const v = await montar([tour("t1", "Safari", 180, "USD"), tour("t2", "Islas del Rosario", 180_000, "COP")], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /Subtotal en USD \(1 ítem\)\s?USD \$180/);
    assert.match(t, /Subtotal en COP \(1 ítem\)\s?\$\s?180\.000/);
    assert.match(t, /Sin hoteles, la moneda de la cotización la fija el primer servicio que siga disponible al cotizar: el servidor la confirmará/);
    assert.doesNotMatch(t, /Se cotizará en/, "no afirma una moneda");
    assert.doesNotMatch(t, /Quedarán fuera/, "no afirma qué se excluye");
    assert.doesNotMatch(t, /Comisión a liquidar|Total \(PVP\)/, "ni comisión ni total únicos");
    assert.match(t, /La comisión se calculará sobre la cotización que se genere \(una sola moneda\)\./);
    v.desmontar();
  });

  test("solo servicios en USD: moneda segura, total y comisión en USD", async () => {
    const v = await montar([tour("t1", "Safari", 180, "USD"), tour("t2", "Desierto", 120, "USD")], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /Total \(PVP\)\s?USD \$300/);
    assert.match(t, /Comisión a liquidar \(10%\)\s?USD \$30/);
    assert.doesNotMatch(t, /Sin hoteles/);
    v.desmontar();
  });

  test("ítem antiguo sin moneda: «por confirmar», nunca formateado como COP, sin comisión", async () => {
    const v = await montar([persona("h1", "Hotel Antiguo", 1_200_000)], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /1\.200\.000 · moneda por confirmar/);
    assert.doesNotMatch(t, /\$\s?1\.200\.000/);
    assert.match(t, /Moneda por confirmar\s?1 ítem/);
    assert.match(t, /1 ítem se agregó antes de registrar su moneda: se confirmará al generar la cotización\./);
    assert.match(t, /La comisión se calculará sobre la cotización que se genere/);
    v.desmontar();
  });
});

describe("Checkout B2B: facturación a la agencia en contrato neto", () => {
  after(() => stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null }));
  async function abrirNeto(agencia: { nombre: string; nit: string; email: string; telefono: string }) {
    stub.__setContextoB2B({ esB2B: true, pctComision: 0.11, agencia });
    const v = await montar([persona("h1", "OZ HOTEL CARTAGENA", 621_000, "COP")], "checkout");
    await act(async () => {
      const b = [...v.container.querySelectorAll("button")].find((x) => x.textContent === "Contrato neto")!;
      b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await espera();
    });
    const campo = (etiqueta: string) => {
      const label = [...v.container.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!;
      return label.parentElement!.querySelector("input") as HTMLInputElement;
    };
    return { v, campo };
  }

  test("con NIT y teléfono registrados: se muestran, sin edición, junto a la comisión y el neto", async () => {
    const { v, campo } = await abrirNeto({ nombre: "Agencia Uno SAS", nit: "900123456", email: "facturas@uno.test", telefono: "3001112233" });
    assert.equal(campo("NIT").value, "900123456");
    assert.equal(campo("Teléfono").value, "3001112233");
    assert.equal(campo("NIT").disabled, true);
    const t = sinEspacios(v.texto());
    assert.match(t, /Comisión \(11%\)\s?−\$\s?68\.310/);
    assert.match(t, /Total neto a pagar\s?\$\s?552\.690/);
    assert.doesNotMatch(t, /Tu registro no tiene/);
    v.desmontar();
  });

  test("sin NIT ni teléfono en el registro: «No registrado» y aviso de quién lo completa; ningún valor inventado", async () => {
    const { v, campo } = await abrirNeto({ nombre: "Agencia Uno SAS", nit: "", email: "agencia@uno.test", telefono: "" });
    assert.equal(campo("NIT").value, "");
    assert.equal(campo("NIT").placeholder, "No registrado");
    assert.equal(campo("Teléfono").value, "");
    assert.equal(campo("Teléfono").placeholder, "No registrado");
    assert.match(sinEspacios(v.texto()), /Tu registro no tiene NIT ni teléfono\. Puedes enviar la solicitud; D'spacios Travel lo completará antes de facturar\./);
    v.desmontar();
  });
});

describe("Checkout: fallo de configuración al cargar la facturación B2B", () => {
  after(() => stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null }));
  test("se muestra el error, no hay datos de facturación inventados y el envío queda deshabilitado", async () => {
    stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null, error: "No pudimos cargar los datos de facturación de tu agencia por un problema de configuración del servidor. Intenta más tarde o contacta a D'spacios Travel." });
    const v = await montar([persona("h1", "OZ HOTEL CARTAGENA", 621_000, "COP")], "checkout");
    const t = sinEspacios(v.texto());
    assert.match(t, /problema de configuración del servidor/);
    assert.doesNotMatch(t, /Facturar a \(agencia\)|Modalidad del contrato/);
    const enviar = [...v.container.querySelectorAll("button")].find((x) => /Generar cotización y enviar solicitud/.test(x.textContent ?? ""))!;
    assert.equal(enviar.disabled, true);
    v.desmontar();
  });
});

describe("Checkout: la moneda es solo presentación — la solicitud al servidor no cambia", () => {
  before(() => {
    stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
  });
  after(() => stub.__setCrearSolicitudReserva(null));

  test("no envía `moneda` del hotel por persona ni totales; el mensaje del servidor se muestra", async () => {
    const v = await montar([persona("h1", "Hotel Dubái", 1_200, "USD"), tour("t1", "Safari", 180, "USD", "h1")], "checkout");
    const escribir = (etiqueta: string, valor: string) => {
      const label = [...v.container.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!;
      const input = label.parentElement!.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    await act(async () => {
      escribir("Nombres *", "Ana"); escribir("Apellidos *", "Pérez"); escribir("Documento *", "123"); escribir("Teléfono / WhatsApp *", "300");
      await espera();
    });
    await act(async () => {
      const b = [...v.container.querySelectorAll("button")].find((x) => /Generar cotización y enviar solicitud/.test(x.textContent ?? ""))!;
      b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await espera(60);
    });
    const enviada = stub.__solicitudes.at(-1) as { items: Record<string, unknown>[]; tours: Record<string, unknown>[] };
    assert.ok(enviada, "se envió la solicitud");
    assert.equal(enviada.items.length, 1);
    assert.ok(!("moneda" in enviada.items[0]), "el hotel por persona no manda moneda: el servidor la resuelve");
    assert.ok(!("total" in enviada) && !("totales" in enviada));
    assert.equal(enviada.tours[0].hotelItemId, "h1");
    assert.match(v.texto(), /rechazo de prueba/);
    v.desmontar();
  });
});

describe("CartDrawer: importes y totales por moneda", () => {
  test("solo USD: importe y total en USD", async () => {
    const v = await montar([persona("h1", "Hotel Dubái", 1_200, "USD"), tour("t1", "Safari", 180, "USD", "h1")], "drawer");
    const t = sinEspacios(v.texto());
    assert.match(t, /USD \$1,200/);
    assert.match(t, /Hotel \+ servicios\s?USD \$1,380/);
    assert.match(t, /Total estimado\s?USD \$1,380/);
    assert.doesNotMatch(t, /\$\s?1\.380/);
    v.desmontar();
  });

  test("mixto: subtotal por moneda, sin total único y con aviso", async () => {
    const v = await montar([persona("h1", "Hotel Almirante", 1_200_000, "COP"), unidad("u1", "Hotel Dubái", 900, "USD")], "drawer");
    const t = sinEspacios(v.texto());
    assert.match(t, /Subtotal en COP \(1 ítem\)\s?\$\s?1\.200\.000/);
    assert.match(t, /Subtotal en USD \(1 ítem\)\s?USD \$900/);
    assert.doesNotMatch(t, /Total estimado/);
    assert.match(t, /Quedarán fuera de esta cotización: Hotel Dubái \(USD\)/);
    v.desmontar();
  });

  test("hotel antiguo sin moneda con servicio: sin subtotal hotel + servicios (podría mezclar divisas)", async () => {
    const v = await montar([persona("h1", "Hotel Antiguo", 1_200_000), tour("t1", "Islas", 180_000, "COP", "h1")], "drawer");
    const t = sinEspacios(v.texto());
    assert.match(t, /1\.200\.000 · moneda por confirmar/);
    assert.doesNotMatch(t, /Hotel \+ servicios/);
    v.desmontar();
  });
});
