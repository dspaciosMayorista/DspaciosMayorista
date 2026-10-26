// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #102 — Interacción REACT de la cotización asistida B2B: checkout del Tarifario (CheckoutPage REAL con su CartProvider; Server Actions
// stubeadas), panel de términos congelados (TerminosB2BAsistido) y vista previa de la conversión (ConvertirCarritoBtn REAL).
//   · el personal autorizado elige B2C o B2B; el selector no aparece para visitantes, aliados logueados ni sin permiso;
//   · B2B exige aliado; lo que viaja al servidor es SOLO la elección (aliado + modalidad): nunca porcentaje, base, comisión ni total;
//   · el aliado muestra su porcentaje y de dónde sale; PVP con comisión / NETO muestran la comisión y el total exigible;
//   · el resultado muestra los términos congelados (PVP, impuesto, base, origen del %, %, comisión, total exigible);
//   · la conversión de una venta B2B avisa que el contrato nace B2B y previsualiza el EXIGIBLE de cada contrato.
import { test, describe, before, after, beforeEach } from "node:test";
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
const { CartProvider } = await import("../lib/cart/CartContext.tsx");
const { TerminosB2BAsistido } = await import("../components/cotizacion/TerminosB2BAsistido.tsx");
const { ConvertirCarritoBtn } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx");
const { construirPlanB2B } = await import("../lib/cotizacion/asistidaB2B.ts");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const { __setConvertirCotizacionCarrito } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;

const ALIADOS = [
  { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pct: 0.1, pctOrigen: "aliado" },
  { id: 9, nombre: "Lucía Gómez", tipo: "freelance", pct: 0.11, pctOrigen: "general" },
];
const persona = (id: string, nombre: string, precio: number) => ({
  id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null,
  hotelNombre: nombre, destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno",
  fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  pax: 2, precio, edadesMenores: [], moneda: "COP",
});

async function montarCheckout() {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify([persona("h1", "Hotel Almirante", 1_000_000)]));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CheckoutPage))); await espera(); });
  return { container, texto: () => container.textContent ?? "", desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
function escribir(container: HTMLElement, etiqueta: string, valor: string) {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!;
  const input = label.parentElement!.querySelector("input") as HTMLInputElement;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
async function llenarCliente(container: HTMLElement) {
  await act(async () => {
    escribir(container, "Nombres *", "Ana"); escribir(container, "Apellidos *", "Pérez");
    escribir(container, "Documento *", "123"); escribir(container, "Teléfono / WhatsApp *", "300");
    await espera();
  });
}
async function elegirAliado(container: HTMLElement, valor: string) {
  const s = container.querySelector<HTMLSelectElement>("#asist-aliado")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(s, valor);
    s.dispatchEvent(new window.Event("change", { bubbles: true }));
    await espera();
  });
}
const enviar = (container: HTMLElement) => boton(/Generar cotización y enviar solicitud/, container)!;

const PLAN = (modo: "comisionable" | "neta") => {
  const r = construirPlanB2B({
    aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo, moneda: "COP",
    lineas: [{ clave: "item-0", pvp: 1_000_000, impuesto: 200_000 }],
    actor: { id: "u-1", email: "ana@dspacios.test", rol: "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
  });
  assert.ok(r.ok);
  return r.ok ? r.plan : (null as never);
};

beforeEach(() => {
  stub.__solicitudes.length = 0;
  stub.__setCrearSolicitudReserva(null);
  stub.__setContextoAsistencia({ puede: false });
  stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
});
after(() => { stub.__setContextoAsistencia({ puede: false }); stub.__setCrearSolicitudReserva(null); });

describe("Checkout: Tipo de venta para el personal que asiste", () => {
  test("sin permiso (visitante, control_vuelo…) no aparece la sección: el checkout es el de siempre", async () => {
    stub.__setContextoAsistencia({ puede: false });
    const v = await montarCheckout();
    assert.equal(v.container.querySelector('[data-testid="venta-asistida"]'), null);
    assert.doesNotMatch(v.texto(), /Aliado \(B2B\)|Tipo de venta/);
    v.desmontar();
  });

  test("un aliado B2B logueado conserva SU modalidad y no ve la venta asistida (aunque el servidor dijera que puede)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setContextoB2B({ esB2B: true, pctComision: 0.1, agencia: { nombre: "Agencia Uno", nit: "9", email: "a@b.co", telefono: "3" } });
    const v = await montarCheckout();
    assert.equal(v.container.querySelector('[data-testid="venta-asistida"]'), null);
    assert.match(v.texto(), /Modalidad del contrato/);
    v.desmontar();
  });

  test("el personal autorizado ve B2C (por defecto) y B2B; en B2C no viaja ninguna asistencia", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
    const v = await montarCheckout();
    assert.ok(v.container.querySelector('[data-testid="venta-asistida"]'));
    assert.equal(boton("Cliente final (B2C)", v.container)!.getAttribute("aria-pressed"), "true");
    assert.equal(v.container.querySelector("#asist-aliado"), null, "en B2C no se pide aliado");
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    const enviada = stub.__solicitudes.at(-1) as Record<string, unknown>;
    assert.ok(enviada, "se envió la solicitud");
    assert.equal("asistencia" in enviada, false);
    v.desmontar();
  });

  test("B2B sin aliado elegido no llama al servidor y lo pide", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 0);
    assert.match(v.texto(), /Elige el aliado \(agencia o freelance\) de la venta B2B\./);
    v.desmontar();
  });

  test("B2B: el aliado muestra su porcentaje y su origen; NETO muestra la comisión y el neto estimados", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    const opciones = [...v.container.querySelectorAll<HTMLOptionElement>("#asist-aliado option")].map((o) => o.textContent);
    assert.deepEqual(opciones, ["— Elegir aliado —", "Viajes Aurora · Agencia", "Lucía Gómez · Freelance"]);
    await elegirAliado(v.container, "7");
    assert.match(sinEspacios(v.texto()), /Comisión 10 % · porcentaje propio del aliado/);
    await act(async () => { click(boton("NETO", v.container)!); await espera(); });
    let t = sinEspacios(v.texto());
    assert.match(t, /Comisión \(10%\)\s?−\$\s?100\.000/);
    assert.match(t, /Total neto a pagar \(estimado\)\s?\$\s?900\.000/);
    await elegirAliado(v.container, "9");
    assert.match(sinEspacios(v.texto()), /Comisión 11 % · porcentaje general del sistema/);
    await act(async () => { click(boton("PVP con comisión", v.container)!); await espera(); });
    t = sinEspacios(v.texto());
    assert.match(t, /Comisión a liquidar \(11%\)\s?\$\s?110\.000/);
    assert.match(t, /Estimado sobre el PVP/);
    v.desmontar();
  });

  test("al enviar viaja SOLO la elección (aliado + modalidad): ni porcentaje, ni base, ni comisión, ni total, ni canal del navegador", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "rechazo de prueba" }));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");
    await act(async () => { click(boton("NETO", v.container)!); await espera(); });
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    const enviada = stub.__solicitudes.at(-1) as Record<string, unknown>;
    assert.deepEqual(enviada.asistencia, { canal: "b2b", aliadoId: 7, modo: "neta" });
    const json = JSON.stringify(enviada);
    assert.doesNotMatch(json, /"(pct|pctComision|porcentaje|comision|base|total|totalExigible|tipoAsesor|canal_venta)"/);
    assert.equal("modo" in enviada, false, "el `modo` del aliado logueado no se mezcla con la asistencia");
    v.desmontar();
  });

  test("el resultado muestra los términos congelados por el servidor", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({
      ok: true, cotizacion: { id: 5, codigo: "COT-5", url: "https://x/cot/t" }, waUrl: null, mailtoUrl: null, mensaje: "m", b2bAsistido: PLAN("neta"),
    }));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    const panel = v.container.querySelector('[data-testid="terminos-b2b-asistido"]');
    assert.ok(panel, "aparece el panel de términos");
    const t = sinEspacios(panel!.textContent ?? "");
    assert.match(t, /Viajes Aurora · Agencia/);
    assert.match(t, /NETO/);
    v.desmontar();
  });
});

describe("TerminosB2BAsistido: lo que se congela", () => {
  async function renderPlan(modo: "comisionable" | "neta") {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(h(TerminosB2BAsistido, { plan: PLAN(modo) })); await espera(); });
    const dato = (id: string) => sinEspacios(c.querySelector(`[data-testid="${id}"]`)?.textContent ?? "");
    return { c, dato, desmontar: () => { act(() => root.unmount()); c.remove(); } };
  }

  test("PVP con comisión: PVP, impuesto, base, % y su origen, comisión pendiente y total exigible = PVP", async () => {
    const r = await renderPlan("comisionable");
    assert.match(r.dato("b2b-aliado"), /Viajes Aurora · Agencia/);
    assert.equal(r.dato("b2b-modalidad"), "PVP con comisión");
    assert.match(r.dato("b2b-pvp"), /\$\s?1\.000\.000/);
    assert.match(r.dato("b2b-impuesto"), /\$\s?200\.000/);
    assert.match(r.dato("b2b-base"), /\$\s?800\.000/);
    assert.equal(r.dato("b2b-pct"), "10 %");
    assert.match(r.dato("b2b-comision"), /^\$\s?80\.000$/);
    assert.match(r.dato("b2b-total-exigible"), /\$\s?1\.000\.000/);
    const t = sinEspacios(r.c.textContent ?? "");
    assert.match(t, /Porcentaje propio del aliado/);
    assert.match(t, /Comisión \(pendiente de liquidar\)/);
    assert.match(t, /Total exigible \(PVP\)/);
    r.desmontar();
  });

  test("NETO: la comisión se muestra descontada y el total exigible es PVP − comisión", async () => {
    const r = await renderPlan("neta");
    assert.equal(r.dato("b2b-modalidad"), "NETO");
    assert.match(r.dato("b2b-comision"), /^−\$\s?80\.000$/);
    assert.match(r.dato("b2b-total-exigible"), /\$\s?920\.000/);
    const t = sinEspacios(r.c.textContent ?? "");
    assert.match(t, /Comisión \(descontada del precio\)/);
    assert.match(t, /Total exigible \(NETO\)/);
    assert.match(t, /Solo uso interno: el documento del comprador no muestra la comisión\./);
    assert.match(t, /Asistida por ana@dspacios\.test \(Venta\); el beneficiario es el aliado\./);
    r.desmontar();
  });
});

describe("ConvertirCarritoBtn con una venta B2B asistida", () => {
  const items = [
    { hotelNombre: "Hotel Almirante", destino: "CARTAGENA", pax: 2, fechaIda: "2030-03-01", precio: 600_000 },
    { hotelNombre: "Hotel Rodadero", destino: "SANTA MARTA", pax: 2, fechaIda: "2030-03-04", precio: 400_000 },
  ];
  const base = {
    id: 1, pax: 2, items, tours: [], destinos: ["CARTAGENA", "SANTA MARTA"], cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "1" },
    esSuperadmin: true, asesores: [], miNombre: "", miRolVenta: false,
  };
  const planDos = (modo: "comisionable" | "neta") => {
    const r = construirPlanB2B({
      aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo, moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 600_000, impuesto: 100_000 }, { clave: "item-1", pvp: 400_000, impuesto: 100_000 }],
      actor: { id: "u-1", email: "ana@dspacios.test", rol: "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(r.ok);
    return r.ok ? r.plan : (null as never);
  };
  const llamadas: { id: number; opts: Record<string, unknown> }[] = [];
  before(() => { __setConvertirCotizacionCarrito(async (id: number, opts: never) => { llamadas.push({ id, opts }); return { ok: true, numeros: ["DTM-1"] }; }); });
  after(() => { __setConvertirCotizacionCarrito(null); });

  async function montar(extra: Record<string, unknown>) {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => { r.render(h(ConvertirCarritoBtn, { ...base, ...extra } as never)); await espera(); });
    return { c, desmontar: () => { act(() => r.unmount()); c.remove(); } };
  }
  async function elegirMoneda(c: HTMLElement, valor: string) {
    const s = c.querySelector('select[aria-label="Moneda de cobro"]') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(s, valor);
      s.dispatchEvent(new window.Event("change", { bubbles: true }));
      await espera();
    });
  }
  async function abrir(c: HTMLElement) { await act(async () => { click(boton(/Confirmar → generar contrato/, c)!); await espera(); }); }

  test("sin plan B2B no hay aviso ni cambia nada", async () => {
    const m = await montar({});
    assert.equal(m.c.querySelector('[data-testid="convertir-b2b-aviso"]'), null);
    m.desmontar();
  });

  test("avisa que los contratos nacen B2B del aliado con su modalidad y previsualiza el EXIGIBLE de cada contrato (NETO)", async () => {
    const m = await montar({ b2b: { plan: planDos("neta"), clavesUnidades: ["item-0", "item-1"] } });
    const aviso = sinEspacios(m.c.querySelector('[data-testid="convertir-b2b-aviso"]')!.textContent ?? "");
    assert.match(aviso, /contratos se generan como B2B para Viajes Aurora \(agencia\), modalidad NETO/);
    assert.match(aviso, /Se cobra el PVP menos la comisión, que queda descontada\./);
    await abrir(m.c);
    await elegirMoneda(m.c, "COP");
    // Un contrato por destino: cada uno cobra su PVP − su comisión (600.000 − 50.000 y 400.000 − 30.000).
    await act(async () => { click(boton(/1 contrato por destino/, m.c)!); await espera(); });
    const t = sinEspacios(m.c.querySelector('[data-testid="totales-cobro-carrito"]')!.textContent ?? "");
    assert.match(t, /Contrato 1 \(CARTAGENA\): total exigible NETO \$\s?550\.000 → se cobrará \$\s?550\.000/);
    assert.match(t, /Contrato 2 \(SANTA MARTA\): total exigible NETO \$\s?370\.000 → se cobrará \$\s?370\.000/);
    m.desmontar();
  });

  test("PVP con comisión: el exigible previsualizado es el PVP del contrato", async () => {
    const m = await montar({ b2b: { plan: planDos("comisionable"), clavesUnidades: ["item-0", "item-1"] } });
    assert.match(sinEspacios(m.c.querySelector('[data-testid="convertir-b2b-aviso"]')!.textContent ?? ""), /modalidad PVP con comisión\. Se cobra el PVP y la comisión queda pendiente de liquidar\./);
    await abrir(m.c);
    await elegirMoneda(m.c, "COP");
    const t = sinEspacios(m.c.querySelector('[data-testid="totales-cobro-carrito"]')!.textContent ?? "");
    assert.match(t, /total exigible \(PVP\) \$\s?1\.000\.000/);
    m.desmontar();
  });

  test("términos B2B ilegibles: aviso y botón bloqueado (la conversión se rechazaría en el servidor)", async () => {
    const m = await montar({ b2bError: "Los términos B2B guardados en esta cotización están incompletos o no son consistentes; no se puede convertir." });
    assert.match(m.c.textContent ?? "", /términos B2B guardados en esta cotización están incompletos/);
    assert.equal(boton(/Confirmar → generar contrato/, m.c)!.disabled, true);
    m.desmontar();
  });
});
