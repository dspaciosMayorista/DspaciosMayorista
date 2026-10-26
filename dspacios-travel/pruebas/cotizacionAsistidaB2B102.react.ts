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

async function montarCheckout(carrito: unknown[] = [persona("h1", "Hotel Almirante", 1_000_000)]) {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
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
    escribir(container, [...container.querySelectorAll("label")].some((l) => l.textContent === "Número de documento *") ? "Número de documento *" : "Documento *", "123"); escribir(container, "Teléfono / WhatsApp *", "300");
    await espera();
  });
}
const etiquetaDe = (a: { nombre: string; tipo: string }) => `${a.nombre} · ${a.tipo === "agencia" ? "Agencia" : "Freelance"}`;
/** Escribe en el buscador de aliados (como el usuario). `id` de un aliado del catálogo → su etiqueta; cualquier otro texto se escribe tal cual. */
async function escribirAliado(container: HTMLElement, texto: string) {
  const i = container.querySelector<HTMLInputElement>("#asist-aliado")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, texto);
    i.dispatchEvent(new window.Event("input", { bubbles: true }));
    await espera();
  });
}
async function elegirAliado(container: HTMLElement, id: string) {
  await escribirAliado(container, etiquetaDe(ALIADOS.find((a) => String(a.id) === id)!));
}
/** Desglose que devolvería el servidor: el MISMO cálculo puro del plan (impuesto no comisionable fuera de la base). */
function previaDe(pvp: number, impuesto: number, moneda = "COP") {
  return async (entrada: { asistencia?: { aliadoId: number; modo: "comisionable" | "neta" } }) => {
    const a = ALIADOS.find((x) => x.id === entrada.asistencia!.aliadoId)!;
    const r = construirPlanB2B({
      aliado: { id: a.id, nombre: a.nombre, tipo: a.tipo as "agencia" | "freelance", pctAliado: a.pct }, pct: a.pct, pctOrigen: a.pctOrigen as "aliado" | "general", modo: entrada.asistencia!.modo, moneda,
      lineas: [{ clave: "item-0", pvp, impuesto }], actor: { id: "u-1", email: null, rol: "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
    });
    return r.ok ? { ok: true as const, terminos: r.plan } : { ok: false as const, error: r.error };
  };
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
  stub.__previas.length = 0;
  stub.__setPrevisualizar(previaDe(1_000_000, 200_000));
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
    assert.match(v.texto(), /Elige un aliado de la lista \(agencia o freelance\) de la venta B2B\./);
    v.desmontar();
  });

  test("B2B: el aliado se busca escribiendo; la lista son los aliados activos; muestra su porcentaje y su origen", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    const campo = v.container.querySelector<HTMLInputElement>("#asist-aliado")!;
    assert.equal(campo.getAttribute("list"), "asist-aliados-lista", "buscador nativo con lista (teclado y filtrado del navegador)");
    assert.equal(v.container.querySelector('label[for="asist-aliado"]')?.textContent, "Aliado (agencia o freelance) *", "etiqueta accesible");
    const opciones = [...v.container.querySelectorAll<HTMLOptionElement>("#asist-aliados-lista option")].map((o) => o.value);
    assert.deepEqual(opciones, ["Viajes Aurora · Agencia", "Lucía Gómez · Freelance"]);
    await elegirAliado(v.container, "7");
    assert.match(sinEspacios(v.texto()), /Comisión 10 % · porcentaje propio del aliado/);
    await elegirAliado(v.container, "9");
    assert.match(sinEspacios(v.texto()), /Comisión 11 % · porcentaje general del sistema/);
    // mayúsculas/espacios sobrantes siguen siendo una opción válida
    await escribirAliado(v.container, "  viajes aurora · agencia ");
    assert.match(sinEspacios(v.texto()), /Comisión 10 %/);
    v.desmontar();
  });

  test("texto libre sin una opción válida NO elige aliado: se avisa, no hay desglose y no se puede enviar", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "no debería llamarse" }));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await llenarCliente(v.container);
    for (const texto of ["Aurora", "Viajes Aurora", "7", "Otro aliado inventado · Agencia"]) {
      await escribirAliado(v.container, texto);
      assert.equal(v.container.querySelector("#asist-aliado")!.getAttribute("aria-invalid"), "true", texto);
      assert.match(sinEspacios(v.texto()), /texto libre que no coincide con un aliado activo no se puede enviar/);
      assert.equal(v.container.querySelector('[data-testid="terminos-b2b-previa"]'), null);
      await act(async () => { click(enviar(v.container)); await espera(); });
      assert.match(sinEspacios(v.texto()), /Elige un aliado de la lista/);
    }
    assert.equal(stub.__solicitudes.length, 0, "ninguna solicitud salió");
    assert.equal(stub.__previas.length, 0, "ni siquiera se pidió una vista previa");
    v.desmontar();
  });

  test("antes de generar: el desglose sale del servidor (PVP, impuesto, base, origen y %, comisión, total NETO) — sin estimar un % del PVP", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");
    await act(async () => { click(boton("NETO", v.container)!); await espera(); });
    const dato = (id: string) => sinEspacios(v.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "");
    assert.ok(v.container.querySelector('[data-testid="terminos-b2b-previa"]'));
    assert.match(dato("b2b-pvp"), /\$\s?1\.000\.000/);
    assert.match(dato("b2b-impuesto"), /\$\s?200\.000/);
    assert.match(dato("b2b-base"), /\$\s?800\.000/);
    assert.equal(dato("b2b-pct"), "10 %");
    assert.match(dato("b2b-comision"), /^−\$\s?80\.000$/, "10 % de la BASE (800.000), no del PVP (que daría 100.000)");
    assert.match(dato("b2b-total-exigible"), /\$\s?920\.000/);
    const t = sinEspacios(v.texto());
    assert.match(t, /Porcentaje propio del aliado/);
    assert.match(t, /Total exigible \(NETO\)/);
    assert.match(t, /Vista previa calculada por el servidor/);
    assert.doesNotMatch(t, /Estimado sobre el PVP|\(estimado\)|Comisión \(10%\)/, "ya no se estima la comisión como % del PVP");
    // PVP con comisión: mismo desglose, total exigible = PVP
    await act(async () => { click(boton("PVP con comisión", v.container)!); await espera(); });
    assert.match(dato("b2b-total-exigible"), /\$\s?1\.000\.000/);
    assert.match(sinEspacios(v.texto()), /Total exigible \(PVP\)/);
    v.desmontar();
  });

  test("caso de la captura: PVP USD 1.930, impuesto USD 830, base USD 1.100, 11 % = USD 121 y NETO USD 1.809", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setPrevisualizar(previaDe(1_930, 830, "USD"));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "9");
    await act(async () => { click(boton("NETO", v.container)!); await espera(); });
    const dato = (id: string) => sinEspacios(v.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "");
    assert.match(dato("b2b-pvp"), /USD \$1,930$/);
    assert.match(dato("b2b-impuesto"), /830/);
    assert.match(dato("b2b-base"), /USD \$1,100$/);
    assert.equal(dato("b2b-pct"), "11 %");
    assert.match(dato("b2b-comision"), /^−USD \$121$/);
    assert.match(dato("b2b-total-exigible"), /USD \$1,809$/);
    assert.doesNotMatch(dato("b2b-comision"), /212|212,3/, "11 % del PVP (212,3) sería el error de la captura");
    v.desmontar();
  });

  test("cambia el aliado, la modalidad o los ítems ⇒ se vuelve a pedir el desglose; nunca se muestra el de otra combinación", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    assert.equal(stub.__previas.length, 0, "sin aliado no hay vista previa");
    await elegirAliado(v.container, "7");
    assert.deepEqual((stub.__previas.at(-1) as { asistencia: unknown }).asistencia, { canal: "b2b", aliadoId: 7, modo: "comisionable" });
    const n1 = stub.__previas.length;
    await act(async () => { click(boton("NETO", v.container)!); await espera(); });
    assert.equal(stub.__previas.length, n1 + 1);
    assert.deepEqual((stub.__previas.at(-1) as { asistencia: unknown }).asistencia, { canal: "b2b", aliadoId: 7, modo: "neta" });
    await elegirAliado(v.container, "9");
    assert.deepEqual((stub.__previas.at(-1) as { asistencia: unknown }).asistencia, { canal: "b2b", aliadoId: 9, modo: "neta" });
    assert.equal(sinEspacios(v.container.querySelector('[data-testid="b2b-pct"]')?.textContent ?? ""), "11 %");
    // Escribir los datos de la persona NO dispara otra vista previa.
    const n2 = stub.__previas.length;
    await llenarCliente(v.container);
    assert.equal(stub.__previas.length, n2);
    // Un ítem distinto en el carrito sí.
    v.desmontar();
    const v2 = await montarCheckout([persona("h1", "Hotel Almirante", 1_000_000), persona("h2", "Hotel Rodadero", 500_000)]);
    await act(async () => { click(boton("Aliado (B2B)", v2.container)!); await espera(); });
    await elegirAliado(v2.container, "9");
    assert.equal(((stub.__previas.at(-1) as { items: unknown[] }).items).length, 2, "la vista previa viaja con los ítems del carrito");
    v2.desmontar();
  });

  test("la vista previa que llega tarde de otra combinación no se muestra", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const pendientes: (() => void)[] = [];
    stub.__setPrevisualizar((entrada: { asistencia: { aliadoId: number; modo: "comisionable" | "neta" } }) => new Promise((resolver) => {
      pendientes.push(() => resolver(previaDe(1_000_000, 200_000)(entrada)));
    }));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");   // pedido 1 (queda colgado)
    await elegirAliado(v.container, "9");   // pedido 2
    await act(async () => { pendientes[0](); await espera(); });   // llega tarde el del aliado 7
    assert.ok(v.container.querySelector('[data-testid="previa-calculando"]'), "sigue calculando: la respuesta vieja se descartó");
    assert.equal(v.container.querySelector('[data-testid="terminos-b2b-previa"]'), null);
    assert.equal(enviar(v.container).disabled, true);
    await act(async () => { pendientes[1](); await espera(); });
    assert.equal(sinEspacios(v.container.querySelector('[data-testid="b2b-aliado"]')?.textContent ?? ""), "Lucía Gómez · Freelance");
    assert.equal(enviar(v.container).disabled, false);
    v.desmontar();
  });

  test("si la vista previa falla: se explica qué falta, no se muestran cifras y no se puede confirmar", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "no debería llamarse" }));
    stub.__setPrevisualizar(async () => ({ ok: false, error: "No se pudo generar la cotización (revisa disponibilidad)." }));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");
    await llenarCliente(v.container);
    const aviso = sinEspacios(v.container.querySelector('[data-testid="previa-error"]')?.textContent ?? "");
    assert.match(aviso, /Todavía no se puede liquidar la venta B2B: No se pudo generar la cotización \(revisa disponibilidad\)\./);
    assert.match(aviso, /no se muestran importes ni se puede generar/);
    assert.equal(v.container.querySelector('[data-testid="terminos-b2b-previa"]'), null);
    assert.doesNotMatch(sinEspacios(v.texto()), /Comisión \(|Total exigible/);
    assert.equal(enviar(v.container).disabled, true);
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 0);
    // Una excepción de red también se explica y bloquea
    stub.__setPrevisualizar(async () => { throw new Error("red"); });
    await elegirAliado(v.container, "9");
    assert.match(sinEspacios(v.container.querySelector('[data-testid="previa-error"]')?.textContent ?? ""), /No se pudo calcular el desglose/);
    assert.equal(enviar(v.container).disabled, true);
    v.desmontar();
  });

  test("aliados cuyo nombre solo difiere en mayúsculas o espacios: opciones únicas con su número; el texto ambiguo no elige; el exacto sí", async () => {
    const DUP = [
      { id: 21, nombre: "Viajes Aurora", tipo: "agencia", pct: 0.1, pctOrigen: "aliado" },
      { id: 22, nombre: "  viajes   AURORA ", tipo: "agencia", pct: 0.2, pctOrigen: "aliado" },
      { id: 23, nombre: "Viajes Aurora", tipo: "freelance", pct: 0.11, pctOrigen: "general" },
    ];
    stub.__setContextoAsistencia({ puede: true, aliados: DUP });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    const opciones = [...v.container.querySelectorAll<HTMLOptionElement>("#asist-aliados-lista option")].map((o) => o.value);
    assert.deepEqual(opciones, ["Viajes Aurora · Agencia (#21)", "viajes AURORA · Agencia (#22)", "Viajes Aurora · Freelance"]);
    assert.equal(new Set(opciones.map((o) => o.toLowerCase())).size, 3, "ninguna opción se confunde con otra");
    // Texto ambiguo (sin el número) y variantes de mayúsculas/espacios: no eligen a nadie.
    for (const ambiguo of ["Viajes Aurora · Agencia", "viajes aurora · agencia", "  VIAJES   AURORA · AGENCIA "]) {
      await escribirAliado(v.container, ambiguo);
      assert.equal(v.container.querySelector("#asist-aliado")!.getAttribute("aria-invalid"), "true", ambiguo);
      assert.equal(stub.__previas.length, 0, "no hay vista previa de un aliado que nadie eligió");
    }
    // Con el número cada uno elige EXACTAMENTE el suyo (aunque cambien mayúsculas o espacios).
    await escribirAliado(v.container, "  viajes aurora · agencia (#22) ");
    assert.equal((stub.__previas.at(-1) as { asistencia: { aliadoId: number } }).asistencia.aliadoId, 22);
    assert.match(sinEspacios(v.texto()), /Comisión 20 %/);
    await escribirAliado(v.container, "Viajes Aurora · Agencia (#21)");
    assert.equal((stub.__previas.at(-1) as { asistencia: { aliadoId: number } }).asistencia.aliadoId, 21);
    // El mismo nombre con otro tipo es una opción distinta y única.
    await escribirAliado(v.container, "viajes aurora · freelance");
    assert.equal((stub.__previas.at(-1) as { asistencia: { aliadoId: number } }).asistencia.aliadoId, 23);
    v.desmontar();
  });

  test("al generar viaja el desglose que se VIO; si el servidor responde que cambió: no se crea, se avisa y la vista previa se actualiza para confirmar de nuevo", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const nuevos = async () => {
      const r = await previaDe(1_000_000, 300_000)({ asistencia: { aliadoId: 7, modo: "neta" } });   // el impuesto cambió: 300.000
      return r.ok ? r.terminos : null;
    };
    let llamadas = 0;
    stub.__setCrearSolicitudReserva(async (entrada: { asistencia: { vistos?: unknown } }) => {
      llamadas++;
      if (llamadas === 1) return { ok: false, tipo: "terminos_cambiaron", error: "Los términos de la venta B2B cambiaron desde el desglose que viste. No se creó la cotización.", terminos: await nuevos() };
      return { ok: true, cotizacion: { id: 5, codigo: "COT-5", url: "https://x/cot/t" }, waUrl: null, mailtoUrl: null, mensaje: "m", b2bAsistido: PLAN("neta") };
    });
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");
    await act(async () => { click(boton("NETO", v.container)!); await espera(); });
    await llenarCliente(v.container);
    const dato = (id: string) => sinEspacios(v.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "");
    assert.match(dato("b2b-impuesto"), /\$\s?200\.000/);
    await act(async () => { click(enviar(v.container)); await espera(); });
    // 1) Viajó el desglose visto (200.000 de impuesto, comisión 80.000, NETO 920.000) junto a la elección.
    const primera = stub.__solicitudes.at(-1) as { asistencia: Record<string, unknown> };
    assert.deepEqual(primera.asistencia.vistos, { pvp: 1_000_000, impuesto: 200_000, base: 800_000, pct: 0.1, pct_origen: "aliado", comision: 80_000, total_exigible: 920_000, modo_compra: "neta", moneda: "COP" });
    assert.equal(primera.asistencia.aliadoId, 7);
    // 2) No se creó nada: sigue el formulario, con el aviso y el desglose ACTUALIZADO (impuesto 300.000, base 700.000, comisión 70.000, NETO 930.000).
    assert.equal(v.container.querySelector("[data-testid='exito'], .exito"), null);
    assert.match(sinEspacios(v.container.querySelector('[data-testid="terminos-cambiaron"]')?.textContent ?? ""), /cambiaron desde el desglose que viste.*ya está actualizado/);
    assert.match(dato("b2b-impuesto"), /\$\s?300\.000/);
    assert.match(dato("b2b-base"), /\$\s?700\.000/);
    assert.match(dato("b2b-comision"), /^−\$\s?70\.000$/);
    assert.match(dato("b2b-total-exigible"), /\$\s?930\.000/);
    assert.ok(enviar(v.container), "el botón sigue disponible para confirmar de nuevo");
    // 3) Al confirmar de nuevo viaja el desglose NUEVO y ahora sí se genera.
    await act(async () => { click(enviar(v.container)); await espera(); });
    const segunda = stub.__solicitudes.at(-1) as { asistencia: { vistos: Record<string, unknown> } };
    assert.equal(stub.__solicitudes.length, 2);
    assert.deepEqual([segunda.asistencia.vistos.impuesto, segunda.asistencia.vistos.comision, segunda.asistencia.vistos.total_exigible], [300_000, 70_000, 930_000]);
    assert.ok(v.container.querySelector('[data-testid="terminos-b2b-asistido"]'), "se generó: aparece el resultado congelado");
    assert.equal(v.container.querySelector('[data-testid="terminos-cambiaron"]'), null);
    v.desmontar();
  });

  test("sin cambios: genera a la primera, enviando el desglose visto", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({ ok: true, cotizacion: { id: 5, codigo: "COT-5", url: "https://x/cot/t" }, waUrl: null, mailtoUrl: null, mensaje: "m", b2bAsistido: PLAN("neta") }));
    const v = await montarCheckout();
    await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
    await elegirAliado(v.container, "7");
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 1);
    assert.equal((stub.__solicitudes[0] as { asistencia: { vistos: { total_exigible: number } } }).asistencia.vistos.total_exigible, 1_000_000);
    assert.equal(v.container.querySelector('[data-testid="terminos-cambiaron"]'), null);
    assert.ok(v.container.querySelector('[data-testid="terminos-b2b-asistido"]'));
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
    // La elección (aliado + modalidad) y, aparte, el desglose que el usuario VIO (solo para que el servidor compare; el servidor sigue calculando y congelando).
    const { vistos, ...eleccion } = enviada.asistencia as Record<string, unknown>;
    assert.deepEqual(eleccion, { canal: "b2b", aliadoId: 7, modo: "neta" });
    assert.deepEqual(Object.keys(vistos as object).sort(), ["base", "comision", "moneda", "modo_compra", "pct", "pct_origen", "pvp", "impuesto", "total_exigible"].sort());
    const { asistencia: _a, ...resto } = enviada;
    assert.doesNotMatch(JSON.stringify(resto), /"(pct|pctComision|porcentaje|comision|base|total|totalExigible|tipoAsesor|canal_venta)"/, "fuera de asistencia.vistos no viaja ninguna cifra");
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


// ── #40 E2 · orden del documento en el checkout ─────────────────────────────────────────────────────────────────────────────────────────────
// Venta asistida interna (B2C o NETO): el PRIMER campo de la sección es «Número de documento» con «Buscar» al lado; debajo, tipo, nombres, apellidos y
// contacto. En NETO la sección es la del TITULAR (el cliente comercial sigue siendo el aliado). El checkout público B2C y el del aliado B2B logueado no cambian.
const { __setBuscarTitularPorNumero } = await import("./support/stubs/buscarTitularStub.mjs");
const ancho = (px: number) => { Object.defineProperty(window, "innerWidth", { value: px, configurable: true }); window.dispatchEvent(new window.Event("resize")); };
const textoDe = (e: Element | null | undefined) => sinEspacios((e?.textContent ?? "").replace(/ /g, " ")).trim();
const etiquetasDeSeccion = (container: HTMLElement, titulo: RegExp) => {
  const cab = [...container.querySelectorAll("h2")].find((e) => titulo.test(textoDe(e)))!;
  assert.ok(cab, "no se encontró la sección " + titulo);
  return [...container.querySelectorAll("label")].filter((l) => cab.compareDocumentPosition(l) & window.Node.DOCUMENT_POSITION_FOLLOWING) as HTMLLabelElement[];
};
const campoDe = (ls: HTMLLabelElement[], prefijo: string, sel: string) =>
  ls.find((l) => textoDe(l).startsWith(prefijo))?.parentElement?.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
const tipoSelect = (container: HTMLElement) => container.querySelector("#checkout-tipo-doc") as HTMLSelectElement;
async function escribirEn(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    await espera();
  });
}
async function elegirTipo(sel: HTMLSelectElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new window.Event("change", { bubbles: true }));
    await espera();
  });
}
const buscarCheckout = (container: HTMLElement) => container.querySelector('[data-testid="checkout-titular-interno"] button[title^="Buscar este documento"]') as HTMLButtonElement;
const candCk = (tipoDoc: string, nombres: string) => ({ tipoDoc, numero: "123456", divergencia: false, datos: { nombres, apellidos: "Pérez", telefono: "311" } });

for (const [vista, px] of [["escritorio", 1280], ["móvil", 390]] as const) {
  describe(`Checkout · orden del documento · ${vista} (${px}px)`, () => {
    beforeEach(() => ancho(px));
    after(() => ancho(1280));

    test("venta asistida B2C: Número de documento primero con «Buscar»; tipo sin presuponer; luego nombres, apellidos y contacto", async () => {
      stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
      const v = await montarCheckout();
      const ls = etiquetasDeSeccion(v.container, /^Tus datos$/);
      assert.match(textoDe(ls[0]), /^Número de documento \*/);
      assert.equal(textoDe(buscarCheckout(v.container)), "Buscar");
      assert.deepEqual(ls.map(textoDe).slice(0, 6), ["Número de documento *", "Tipo de documento", "Nombres *", "Apellidos *", "Teléfono / WhatsApp *", "Correo"]);
      assert.equal(tipoSelect(v.container).value, "", "no se presupone CC antes de buscar");
      v.desmontar();
    });

    test("NETO: la sección es la del TITULAR, con el mismo orden; el aviso nombra al aliado como cliente comercial", async () => {
      stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
      const v = await montarCheckout();
      await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
      await elegirAliado(v.container, "7");
      await act(async () => { click(boton("NETO", v.container)!); await espera(); });
      const ls = etiquetasDeSeccion(v.container, /^Titular de la reserva$/);
      assert.match(textoDe(ls[0]), /^Número de documento \*/);
      assert.equal(textoDe(buscarCheckout(v.container)), "Buscar");
      assert.match(textoDe(v.container.querySelector('[data-testid="neto-cliente-aviso"]')), /el cliente de la cotización y del contrato es Viajes Aurora/);
      v.desmontar();
    });

    test("sin coincidencias: se elige el tipo y se completan los demás datos", async () => {
      stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
      __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [] }));
      const v = await montarCheckout();
      const ls = etiquetasDeSeccion(v.container, /^Tus datos$/);
      await escribirEn(campoDe(ls, "Número de documento", "input") as HTMLInputElement, "999999");
      await act(async () => { click(buscarCheckout(v.container)); await espera(); });
      assert.match(v.texto(), /Sin coincidencias\. Elige el tipo de documento y completa los demás datos/);
      await elegirTipo(tipoSelect(v.container), "CE");
      assert.equal(tipoSelect(v.container).value, "CE");
      await escribirEn(campoDe(ls, "Nombres", "input") as HTMLInputElement, "Zoe");
      assert.equal((campoDe(ls, "Nombres", "input") as HTMLInputElement).value, "Zoe");
      v.desmontar();
    });

    test("una coincidencia: «Aplicar datos» llena el tipo y los datos", async () => {
      stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
      __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [candCk("CC", "Ana")] }));
      const v = await montarCheckout();
      const ls = etiquetasDeSeccion(v.container, /^Tus datos$/);
      await escribirEn(campoDe(ls, "Número de documento", "input") as HTMLInputElement, "123456");
      await act(async () => { click(buscarCheckout(v.container)); await espera(); });
      await act(async () => { click(boton("Aplicar datos", v.container)!); await espera(); });
      assert.equal(tipoSelect(v.container).value, "CC");
      assert.equal((campoDe(ls, "Nombres", "input") as HTMLInputElement).value, "Ana");
      v.desmontar();
    });

    test("el mismo número como CC y como CE: se elige la persona y se aplica su tipo (en NETO también)", async () => {
      stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
      __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [candCk("CC", "Ana"), candCk("CE", "Beto")] }));
      const v = await montarCheckout();
      await act(async () => { click(boton("Aliado (B2B)", v.container)!); await espera(); });
      await elegirAliado(v.container, "7");
      await act(async () => { click(boton("NETO", v.container)!); await espera(); });
      const ls = etiquetasDeSeccion(v.container, /^Titular de la reserva$/);
      await escribirEn(campoDe(ls, "Número de documento", "input") as HTMLInputElement, "123456");
      await act(async () => { click(buscarCheckout(v.container)); await espera(); });
      assert.match(v.texto(), /elige la persona/);
      assert.equal(boton("Aplicar datos", v.container), undefined, "no aplica sin elegir");
      await act(async () => { click([...v.container.querySelectorAll("button")].find((b) => textoDe(b).startsWith("CE 123456"))!); await espera(); });
      await act(async () => { click(boton("Aplicar datos", v.container)!); await espera(); });
      assert.equal(tipoSelect(v.container).value, "CE");
      assert.equal((campoDe(ls, "Nombres", "input") as HTMLInputElement).value, "Beto");
      v.desmontar();
    });

    test("checkout público B2C (sin permiso): el formulario de siempre — Nombres primero, «Documento *» sin Buscar", async () => {
      stub.__setContextoAsistencia({ puede: false });
      const v = await montarCheckout();
      const ls = etiquetasDeSeccion(v.container, /^Tus datos$/);
      assert.deepEqual(ls.map(textoDe).slice(0, 6), ["Nombres *", "Apellidos *", "Tipo", "Documento *", "Teléfono / WhatsApp *", "Correo"]);
      assert.equal(v.container.querySelector('[data-testid="checkout-titular-interno"]'), null);
      assert.equal([...v.container.querySelectorAll("button")].some((b) => textoDe(b) === "Buscar"), false);
      v.desmontar();
    });

    test("aliado B2B logueado: tampoco cambia (sin Buscar, formulario de siempre)", async () => {
      stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
      stub.__setContextoB2B({ esB2B: true, pctComision: 0.1, agencia: { nombre: "Agencia Uno", nit: "9", email: "a@b.co", telefono: "3" } });
      const v = await montarCheckout();
      const ls = etiquetasDeSeccion(v.container, /^Datos del titular del contrato$/);
      assert.deepEqual(ls.map(textoDe).slice(0, 4), ["Nombres *", "Apellidos *", "Tipo", "Documento *"]);
      assert.equal(v.container.querySelector('[data-testid="checkout-titular-interno"]'), null);
      v.desmontar();
    });
  });
}
