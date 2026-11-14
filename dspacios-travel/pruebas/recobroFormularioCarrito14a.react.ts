// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #14-A — FORMULARIO REAL del carrito (CheckoutPage con su CartProvider; Server Actions stubeadas) para la captura del recobro:
//   · quién ve el campo: personal a cliente final, venta asistida (con distribución) y aliado directo bajo comisión (participación del sistema, solo lectura); NETO del aliado, aliado sin ficha,
//     visitante y comparativa NO lo ven;
//   · lo que viaja al servidor: SOLO cifras (el aliado directo nunca manda distribución; sin recobro no hay clave `recobro`); un recobro ilegible bloquea el envío con un mensaje;
//   · la vista previa de términos (una solicitud por pausa al escribir, no por tecla) muestra la liquidación y la del aliado directo no se pide sin recobro;
//   · errores del servidor visibles; doble clic = una sola solicitud.
// El servidor REAL (autorización, parámetro, persistencia) se prueba contra Postgres en cotizacionAsistidaB2B102.pg.ts (R1–R19) y su recorrido desde este mismo formulario en R20.
import { test, describe, beforeEach, after } from "node:test";
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
const { construirPlanB2B } = await import("../lib/cotizacion/asistidaB2B.ts");
const { participacionAliado } = await import("../lib/cotizacion/acuerdoComision.ts");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;

const ALIADOS = [{ id: 7, nombre: "Viajes Aurora", tipo: "agencia", pct: 0.1, pctOrigen: "aliado" }];
const persona = (id: string, nombre: string, precio: number) => ({
  id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10, hotelId: 1, bloqueoId: null,
  hotelNombre: nombre, destino: "CARTAGENA", fotoUrl: null, categoria: "Estandar", regimen: "Desayuno",
  fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  pax: 2, precio, edadesMenores: [], moneda: "COP",
});
async function montar(carrito: unknown[] = [persona("h1", "Hotel Almirante", 1_000_000)]) {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CheckoutPage))); await espera(50); });
  return { container, texto: () => sinEspacios(container.textContent ?? ""), desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
function escribirEn(el: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function escribir(container: HTMLElement, etiqueta: string, valor: string) {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!;
  escribirEn(label.parentElement!.querySelector("input") as HTMLInputElement, valor);
}
const porId = <T extends Element = HTMLInputElement>(c: HTMLElement, testid: string) => c.querySelector<T>(`[data-testid="${testid}"]`);
async function llenarCliente(container: HTMLElement) {
  await act(async () => {
    escribir(container, "Nombres *", "Ana"); escribir(container, "Apellidos *", "Pérez");
    escribir(container, [...container.querySelectorAll("label")].some((l) => l.textContent === "Número de documento *") ? "Número de documento *" : "Documento *", "123");
    escribir(container, "Teléfono / WhatsApp *", "300");
    await espera();
  });
}
async function escribirRecobro(c: HTMLElement, total: string, dist?: string, modo?: "valor" | "pct") {
  await act(async () => {
    escribirEn(porId(c, "recobro-total")!, total);
    if (dist !== undefined) escribirEn(porId(c, "recobro-dist")!, dist);
    if (modo) { const s = porId<HTMLSelectElement>(c, "recobro-dist-modo")!; s.value = modo; s.dispatchEvent(new window.Event("change", { bubbles: true })); }
    await espera();
  });
}
const pausa = (ms = 750) => act(async () => { await espera(ms); }); // supera el aplazamiento de 600 ms de la vista previa
async function elegirAliado(c: HTMLElement) {
  const i = c.querySelector<HTMLInputElement>("#asist-aliado")!;
  await act(async () => { escribirEn(i, "Viajes Aurora · Agencia"); await espera(); });
}
async function modoB2B(c: HTMLElement) { await act(async () => { click(boton("Aliado (B2B)", c)!); await espera(); }); }
const enviar = (c: HTMLElement) => boton(/Generar cotización y enviar solicitud/, c)!;

/** Términos que devolvería el servidor: el MISMO cálculo puro del plan (con recobro y su participación ya decidida). */
function previa(aliadoPct = 0.1, parametroPct = 0.5) {
  return async (entrada: { asistencia?: { aliadoId: number; modo: "comisionable" | "neta" }; modo?: "comisionable" | "neta"; recobro?: { total: number; participacion?: { modo: "valor"; valor: number } | { modo: "pct"; pct: number } } }) => {
    const directo = !entrada.asistencia;
    const modo = entrada.asistencia?.modo ?? entrada.modo ?? "comisionable";
    const total = entrada.recobro?.total ?? 0;
    const participacion = total > 0 ? (directo ? participacionAliado(total, { modo: "pct", pct: parametroPct }) : entrada.recobro?.participacion ? participacionAliado(total, entrada.recobro.participacion) : 0) : 0;
    const r = construirPlanB2B({
      aliado: { id: 7, nombre: "Viajes Aurora", tipo: "agencia", pctAliado: aliadoPct }, pct: aliadoPct, pctOrigen: "aliado", modo, moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 1_000_000, impuesto: 200_000, ...(total > 0 ? { recobro: total } : {}) }], actor: { id: "u-1", email: null, rol: directo ? "agencia" : "venta" }, congeladoEn: "2030-01-01T00:00:00.000Z",
      ...(directo ? { origen: "aliado_directo" as const } : {}),
      ...(total > 0 ? { recobro: { total, participacion, pct_participacion: participacion / total, origen_participacion: directo ? ("parametro" as const) : ("formulario" as const) } } : {}),
    });
    return r.ok ? { ok: true as const, terminos: r.plan } : { ok: false as const, error: r.error };
  };
}
const ultimaSolicitud = () => stub.__solicitudes[stub.__solicitudes.length - 1] as Record<string, unknown> & { recobro?: Record<string, unknown>; asistencia?: unknown; modo?: string };

beforeEach(() => {
  stub.__solicitudes.length = 0; stub.__previas.length = 0;
  stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "no se envió a ningún servidor real" }));
  stub.__setContextoAsistencia({ puede: false });
  stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null });
  stub.__setContextoRecobro({ tipo: "ninguno" });
  stub.__setPrevisualizar(previa());
  window.history.pushState({}, "", "/tarifario/checkout");
});
after(() => { stub.__setContextoAsistencia({ puede: false }); stub.__setContextoRecobro({ tipo: "ninguno" }); stub.__setCrearSolicitudReserva(null); window.history.pushState({}, "", "/"); });

const ALIADO_DIRECTO = { esB2B: true, pctComision: 0.1, agencia: { nombre: "Viajes Aurora", nit: "9", email: "a@b.co", telefono: "3" } };

describe("Recobro del carrito — quién ve el campo", () => {
  test("visitante, personal sin permiso y aliado sin ficha vinculada: sin campo de recobro", async () => {
    const v = await montar();
    assert.equal(porId(v.container, "recobro-panel"), null);
    v.desmontar();
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "ninguno" });
    const w = await montar();
    assert.equal(porId(w.container, "recobro-panel"), null, "aliado sin ficha vinculada");
    w.desmontar();
  });

  test("personal a CLIENTE FINAL: solo el recobro (sin distribución: 100 % de la empresa)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    assert.ok(porId(v.container, "recobro-panel"));
    assert.ok(porId(v.container, "recobro-total"));
    assert.equal(porId(v.container, "recobro-dist"), null);
    assert.match(v.texto(), /100 % de la empresa/);
    v.desmontar();
  });

  test("VENTA ASISTIDA: aparece al elegir el aliado y trae recobro + distribución (valor o %)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await modoB2B(v.container);
    assert.equal(porId(v.container, "recobro-panel"), null, "sin aliado elegido todavía no se ofrece");
    await elegirAliado(v.container);
    assert.ok(porId(v.container, "recobro-dist"));
    assert.ok(porId(v.container, "recobro-dist-modo"));
    v.desmontar();
  });

  test("ALIADO DIRECTO bajo comisión: recobro y participación del sistema en SOLO LECTURA (sin campo de distribución); en NETO no se ofrece", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    const v = await montar();
    assert.ok(porId(v.container, "recobro-total"));
    assert.equal(porId(v.container, "recobro-dist"), null, "el aliado no puede escribir su participación");
    assert.match(porId(v.container, "recobro-participacion-sistema")!.textContent ?? "", /50 %.*no se puede cambiar/);
    await act(async () => { click(boton("Contrato neto", v.container)!); await espera(); });
    assert.equal(porId(v.container, "recobro-panel"), null, "NETO del aliado: no solicita recobro");
    v.desmontar();
  });

  test("si el sistema no puede leer la participación del aliado (parámetro ausente) NO se ofrece el recobro y se dice por qué", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "error", error: "La distribución del recobro con el aliado no está configurada correctamente (parámetro recobro_pct_aliado_b2b). Contacta a administración." });
    const v = await montar();
    assert.equal(porId(v.container, "recobro-panel"), null);
    assert.match(porId(v.container, "recobro-ctx-error")!.textContent ?? "", /recobro_pct_aliado_b2b/);
    v.desmontar();
  });

  test("en el modo comparativa no hay recobro (cada opción liquida sus términos)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa");
    const v = await montar([persona("h1", "Hotel Almirante", 1_000_000), persona("h2", "Hotel Boreal", 900_000)]);
    assert.equal(porId(v.container, "recobro-panel"), null);
    v.desmontar();
  });
});

describe("Recobro del carrito — lo que viaja al servidor", () => {
  test("sin recobro no hay clave `recobro` (el envío es el de siempre)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 1);
    assert.equal("recobro" in ultimaSolicitud(), false);
    v.desmontar();
  });

  test("cliente final: {total} sin distribución; formatos «100.000» y «100.000,50»", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await llenarCliente(v.container);
    await escribirRecobro(v.container, "100.000,50");
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.deepEqual(ultimaSolicitud().recobro, { total: 100000.5 });
    v.desmontar();
  });

  test("venta asistida: distribución por VALOR, por % y vacía", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await modoB2B(v.container); await elegirAliado(v.container); await llenarCliente(v.container);
    await escribirRecobro(v.container, "100.000", "50.000", "valor"); await pausa();
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.deepEqual(ultimaSolicitud().recobro, { total: 100000, participacion: { modo: "valor", valor: 50000 } });
    assert.deepEqual((ultimaSolicitud().asistencia as { aliadoId: number }).aliadoId, 7);
    await escribirRecobro(v.container, "100.000", "40", "pct"); await pausa();
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.deepEqual(ultimaSolicitud().recobro, { total: 100000, participacion: { modo: "pct", pct: 0.4 } });
    await escribirRecobro(v.container, "100.000", ""); await pausa();
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.deepEqual(ultimaSolicitud().recobro, { total: 100000 }, "sin distribución el recobro queda en la base");
    v.desmontar();
  });

  test("aliado directo: manda el recobro y NUNCA una distribución; en NETO no manda recobro aunque se haya escrito antes", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    const v = await montar();
    await llenarCliente(v.container);
    await escribirRecobro(v.container, "100000"); await pausa();
    await act(async () => { click(enviar(v.container)); await espera(); });
    const s = ultimaSolicitud();
    assert.deepEqual(s.recobro, { total: 100000 });
    assert.equal(s.modo, "comisionable");
    assert.equal("asistencia" in s, false);
    await act(async () => { click(boton("Contrato neto", v.container)!); await espera(); });
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 2);
    assert.equal("recobro" in ultimaSolicitud(), false, "NETO del aliado: no viaja recobro");
    assert.equal(ultimaSolicitud().modo, "neta");
    v.desmontar();
  });

  test("un recobro ilegible, negativo o con más de 2 decimales BLOQUEA el envío con un mensaje (nunca se toma como 0)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await llenarCliente(v.container);
    for (const malo of ["abc", "-5", "1,234", "1..2"]) {
      await escribirRecobro(v.container, malo);
      assert.ok(porId(v.container, "recobro-error"), `«${malo}» muestra el error`);
      await act(async () => { click(enviar(v.container)); await espera(); });
      assert.equal(stub.__solicitudes.length, 0, `«${malo}» no llega al servidor`);
      assert.match(porId(v.container, "error-checkout")?.textContent ?? "", /recobro/i);
    }
    v.desmontar();
  });

  test("un error del servidor (p. ej. NETO del aliado o sin permiso) se muestra y no deja el botón bloqueado", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setCrearSolicitudReserva(async () => ({ ok: false, error: "El recobro solo lo puede capturar el personal autorizado o un aliado con su ficha vinculada." }));
    const v = await montar();
    await llenarCliente(v.container);
    await escribirRecobro(v.container, "5000");
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.match(porId(v.container, "error-checkout")!.textContent ?? "", /personal autorizado o un aliado con su ficha vinculada/);
    assert.equal(enviar(v.container).disabled, false);
    v.desmontar();
  });

  test("doble clic en «Generar»: UNA sola solicitud (el botón se bloquea mientras se genera)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    let resolver: (r: unknown) => void = () => {};
    stub.__setCrearSolicitudReserva(() => new Promise((ok) => { resolver = ok; }));
    const v = await montar();
    await llenarCliente(v.container);
    await escribirRecobro(v.container, "5000");
    await act(async () => { click(enviar(v.container)); click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 1, "el segundo clic no llega al servidor");
    assert.equal(boton(/Generando/, v.container)?.disabled, true);
    await act(async () => { resolver({ ok: false, error: "fin" }); await espera(); });
    v.desmontar();
  });
});

describe("Recobro del carrito — revisión de términos B2B", () => {
  test("venta asistida: tras una pausa se pide UNA vista previa con el recobro y se muestra su liquidación (recobro, participación, empresa, ordinaria, total)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await modoB2B(v.container); await elegirAliado(v.container);
    await pausa();
    const antes = stub.__previas.length;
    for (const t of ["1", "10", "100", "100000"]) await act(async () => { escribirEn(porId(v.container, "recobro-total")!, t); await espera(20); });
    await act(async () => { escribirEn(porId(v.container, "recobro-dist")!, "50000"); await espera(20); });
    assert.equal(enviar(v.container).disabled, true, "mientras el texto no se aplica no se puede generar con una liquidación vieja");
    await pausa();
    assert.equal(stub.__previas.length - antes, 1, "una sola solicitud por pausa, no una por tecla");
    const p = stub.__previas[stub.__previas.length - 1] as { recobro?: unknown };
    assert.deepEqual(p.recobro, { total: 100000, participacion: { modo: "valor", valor: 50000 } });
    const t = v.texto();
    // PVP 1.000.000 + recobro 100.000; base 800.000 (el recobro sale de la base) ⇒ ordinaria 80.000 + participación 50.000 = 130.000.
    assert.match(t, /Recobro incluido\s*\$\s*100\.000/);
    assert.match(t, /Participación del aliado en el recobro \(50 % · indicada por el personal\)\s*\$\s*50\.000/);
    assert.match(t, /Del recobro, para la empresa\s*\$\s*50\.000/);
    assert.match(t, /Comisión ordinaria\s*\$\s*80\.000/);
    assert.match(t, /Total exigible \(PVP\)\s*\$\s*1\.100\.000/);
    assert.equal(enviar(v.container).disabled, false);
    v.desmontar();
  });

  test("aliado directo: sin recobro NO se pide vista previa; con recobro se pide SIN `asistencia` y se muestra la participación del sistema", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    const v = await montar();
    await pausa();
    assert.equal(stub.__previas.length, 0, "sin recobro, ninguna solicitud extra");
    await escribirRecobro(v.container, "100000"); await pausa();
    assert.equal(stub.__previas.length, 1);
    const p = stub.__previas[0] as Record<string, unknown>;
    assert.equal("asistencia" in p, false);
    assert.deepEqual(p.recobro, { total: 100000 });
    const t = v.texto();
    assert.match(t, /Venta B2B del aliado/);
    assert.match(t, /Participación del aliado en el recobro \(50 % · definida por el sistema\)\s*\$\s*50\.000/);
    assert.match(t, /Comisión ordinaria\s*\$\s*80\.000/);
    v.desmontar();
  });

  test("si el servidor no puede liquidar con el recobro, se dice y no se puede generar (no se muestran cifras inventadas)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    stub.__setPrevisualizar(async () => ({ ok: false as const, error: "No se pudo liquidar la venta B2B." }));
    const v = await montar();
    await modoB2B(v.container); await elegirAliado(v.container);
    await escribirRecobro(v.container, "100000", "50000"); await pausa();
    assert.ok(porId(v.container, "previa-error"));
    assert.equal(enviar(v.container).disabled, true);
    v.desmontar();
  });

  test("el recobro nunca aparece en la presentación del cliente: ni la selección ni el resumen del carrito lo nombran", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await escribirRecobro(v.container, "100000");
    const seleccion = [...v.container.querySelectorAll("section")].find((s) => /Tu selección/.test(s.textContent ?? ""))!;
    assert.doesNotMatch(seleccion.textContent ?? "", /recobro/i);
    v.desmontar();
  });
});

describe("Recobro del carrito — consumo, respuestas fuera de orden, errores y generación", () => {
  const llamadas = () => stub.__previas.length + stub.__solicitudes.length;
  const terminosDe = async (total: number, dist: number) => { const r = await planConRecobro(total, dist); if (!r.ok) throw new Error(r.error); return r.terminos; };
  const planConRecobro = (total: number, dist: number, pct = 0.1) => previa(pct)({ asistencia: { aliadoId: 7, modo: "comisionable" }, recobro: { total, participacion: { modo: "valor", valor: dist } } });

  test("ESCRIBIR: una ráfaga de teclas = 1 solicitud; dos pausas distintas = 2 (una por pausa); en reposo, ninguna; el contexto del aliado se pide UNA vez", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    stub.__llamadasContextoRecobro.n = 0;
    const v = await montar();
    await pausa();
    assert.equal(stub.__llamadasContextoRecobro.n, 1, "el contexto del recobro se pide una sola vez al abrir (y solo si es aliado)");
    assert.equal(llamadas(), 0, "sin recobro no hay vista previa");
    for (const t of ["1", "10", "100", "1000", "10000"]) await act(async () => { escribirEn(porId(v.container, "recobro-total")!, t); await espera(15); });
    await pausa();
    assert.equal(stub.__previas.length, 1, "5 teclas, 1 solicitud");
    await escribirRecobro(v.container, "20000"); await pausa();
    assert.equal(stub.__previas.length, 2, "otra pausa con otro valor, otra solicitud");
    const quieto = llamadas();
    await pausa(2000);
    assert.equal(llamadas(), quieto, "en reposo no se hace ninguna solicitud (sin sondeo)");
    assert.equal(stub.__llamadasContextoRecobro.n, 1);
    v.desmontar();
  });

  test("CAMBIAR MODALIDAD: asistida PVP↔NETO = 1 solicitud por cambio; aliado directo en NETO = 0 y al volver a comisión = 1", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v = await montar();
    await modoB2B(v.container); await elegirAliado(v.container);
    await escribirRecobro(v.container, "100000", "50000"); await pausa();
    const base = stub.__previas.length;
    await act(async () => { click(boton("NETO", v.container)!); await espera(); }); await pausa();
    assert.equal(stub.__previas.length - base, 1, "PVP→NETO: una solicitud");
    await act(async () => { click(boton("PVP con comisión", v.container)!); await espera(); }); await pausa();
    assert.equal(stub.__previas.length - base, 2, "NETO→PVP: una más");
    v.desmontar();
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    stub.__previas.length = 0;
    const w = await montar();
    await escribirRecobro(w.container, "100000"); await pausa();
    assert.equal(stub.__previas.length, 1);
    await act(async () => { click(boton("Contrato neto", w.container)!); await espera(); }); await pausa();
    assert.equal(stub.__previas.length, 1, "NETO del aliado: ninguna solicitud nueva");
    await act(async () => { click(boton("Contrato comisionable", w.container)!); await espera(); }); await pausa();
    assert.equal(stub.__previas.length, 2, "de vuelta a comisión con recobro escrito: una solicitud");
    w.desmontar();
  });

  test("RESPUESTAS FUERA DE ORDEN: la respuesta atrasada de un valor anterior NO pisa la liquidación del valor actual", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const pendientes: { total: number; resolver: (r: unknown) => void }[] = [];
    stub.__setPrevisualizar((entrada: { recobro?: { total: number } }) => new Promise((ok) => { pendientes.push({ total: entrada.recobro?.total ?? 0, resolver: ok }); }));
    const v = await montar();
    await modoB2B(v.container); await elegirAliado(v.container);
    await pausa();
    pendientes.splice(0).forEach((p) => p.resolver({ ok: false, error: "inicial" })); // la vista previa sin recobro del aliado recién elegido
    await escribirRecobro(v.container, "100000", "50000"); await pausa();
    await escribirRecobro(v.container, "200000", "50000"); await pausa();
    const vieja = pendientes.find((p) => p.total === 100000)!, nueva = pendientes.find((p) => p.total === 200000)!;
    assert.ok(vieja && nueva, "dos solicitudes en vuelo");
    await act(async () => { nueva.resolver({ ok: true, terminos: await terminosDe(200000, 50000) }); await espera(); });
    await act(async () => { vieja.resolver({ ok: true, terminos: await terminosDe(100000, 50000) }); await espera(); }); // llega DESPUÉS y es de un valor anterior
    const t = v.texto();
    assert.match(t, /Recobro incluido\s*\$\s*200\.000/, "se muestra la del valor actual");
    assert.doesNotMatch(t, /Recobro incluido\s*\$\s*100\.000/, "la atrasada se descarta");
    v.desmontar();
  });

  test("ERRORES: una vista previa fallida se muestra, NO se reintenta sola y se recupera al corregir el dato", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    let falla = true;
    stub.__setPrevisualizar(async (e: Parameters<ReturnType<typeof previa>>[0]) => (falla ? { ok: false as const, error: "No se pudo calcular el desglose." } : previa()(e)));
    const v = await montar();
    await modoB2B(v.container); await elegirAliado(v.container);
    await escribirRecobro(v.container, "100000", "50000"); await pausa();
    assert.ok(porId(v.container, "previa-error"));
    const n = stub.__previas.length;
    await pausa(2000);
    assert.equal(stub.__previas.length, n, "sin reintentos automáticos");
    falla = false;
    await escribirRecobro(v.container, "100000", "40000"); await pausa();
    assert.equal(porId(v.container, "previa-error"), null);
    assert.ok(porId(v.container, "terminos-b2b-previa"), "se recupera");
    v.desmontar();
  });

  test("GENERAR: una solicitud, ninguna vista previa nueva; tras un error se puede reintentar a propósito; el aliado directo manda lo que VIO", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    const v = await montar();
    await llenarCliente(v.container);
    await escribirRecobro(v.container, "100000"); await pausa();
    const previas = stub.__previas.length;
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 1);
    assert.equal(stub.__previas.length, previas, "generar no dispara vistas previas");
    const vistos = (ultimaSolicitud() as { vistos?: Record<string, unknown> }).vistos!;
    assert.deepEqual({ pvp: vistos.pvp, comision: vistos.comision, total: vistos.total_exigible, modo: vistos.modo_compra }, { pvp: 1_100_000, comision: 130_000, total: 1_100_000, modo: "comisionable" });
    await act(async () => { click(enviar(v.container)); await espera(); }); // el primer intento falló (stub): el cerrojo se liberó
    assert.equal(stub.__solicitudes.length, 2, "un reintento deliberado SÍ se envía");
    v.desmontar();
  });

  test("ACUERDO VIGENTE: si al generar el servidor liquida otra cosa que lo visto, no crea nada, muestra el aviso con la liquidación nueva y el siguiente envío lleva lo nuevo (venta asistida y aliado directo)", async () => {
    for (const caso of ["asistida", "directo"] as const) {
      stub.__solicitudes.length = 0; stub.__previas.length = 0;
      if (caso === "asistida") { stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS }); stub.__setContextoB2B({ esB2B: false, pctComision: 0, agencia: null }); stub.__setContextoRecobro({ tipo: "ninguno" }); }
      else { stub.__setContextoAsistencia({ puede: false }); stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 }); }
      const nuevos = async () => (await previa(0.15)(caso === "asistida" ? { asistencia: { aliadoId: 7, modo: "comisionable" }, recobro: { total: 100000, participacion: { modo: "valor", valor: 50000 } } } : { modo: "comisionable", recobro: { total: 100000 } })).terminos;
      let n = 0;
      stub.__setCrearSolicitudReserva(async () => (++n === 1 ? { ok: false, tipo: "terminos_cambiaron", error: "Los términos de la venta B2B cambiaron desde el desglose que viste. No se creó la cotización.", terminos: await nuevos() } : { ok: false, error: "fin" }));
      const v = await montar();
      if (caso === "asistida") { await modoB2B(v.container); await elegirAliado(v.container); }
      await llenarCliente(v.container);
      await escribirRecobro(v.container, "100000", caso === "asistida" ? "50000" : undefined); await pausa();
      const vistosDe = (i: number) => ((stub.__solicitudes[i] as { vistos?: { comision: number } } & { asistencia?: { vistos?: { comision: number } } }).vistos ?? (stub.__solicitudes[i] as { asistencia?: { vistos?: { comision: number } } }).asistencia?.vistos)!;
      await act(async () => { click(enviar(v.container)); await espera(); });
      assert.equal(vistosDe(0).comision, 130_000, `${caso}: manda lo que vio`);
      assert.ok(porId(v.container, "terminos-cambiaron"), `${caso}: aviso de términos cambiados`);
      assert.match(v.texto(), /Comisión ordinaria\s*\$\s*(120\.000|105\.000)/, `${caso}: la liquidación mostrada ya es la nueva (15 %)`);
      await act(async () => { click(enviar(v.container)); await espera(); });
      assert.equal(vistosDe(1).comision, (await nuevos())!.comision, `${caso}: el siguiente envío lleva los términos nuevos`);
      v.desmontar();
    }
  });

  test("la pantalla del ALIADO muestra su liquidación y su participación, y NO la parte que conserva la empresa; el personal sí la ve", async () => {
    const plan = await terminosDe(100000, 50000);
    const { TerminosB2BAsistido } = await import("../components/cotizacion/TerminosB2BAsistido.tsx");
    const render = (p: unknown) => { const c = document.createElement("div"); document.body.appendChild(c); const r = createRoot(c); act(() => { r.render(h(TerminosB2BAsistido, { plan: p as never, previa: true })); }); return { texto: sinEspacios(c.textContent ?? ""), fin: () => { act(() => r.unmount()); c.remove(); } }; };
    const aliado = render({ ...plan, origen: "aliado_directo" });
    assert.match(aliado.texto, /Participación del aliado en el recobro/);
    assert.match(aliado.texto, /Comisión ordinaria/);
    assert.doesNotMatch(aliado.texto, /para la empresa/);
    aliado.fin();
    const personal = render({ ...plan });
    assert.match(personal.texto, /Del recobro, para la empresa\s*\$\s*50\.000/);
    personal.fin();
  });
});

describe("Clave de envío — dos pestañas", () => {
  const claveDe = (i: number) => (stub.__solicitudes[i] as { claveEnvio?: string }).claveEnvio;
  test("cada envío lleva una clave UUID; la MISMA intención (dos pestañas, mismo almacenamiento) comparte clave; otro recobro u otro titular = otra clave", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const v1 = await montar(); const v2 = await montar(); // dos pestañas: mismo navegador (localStorage), mismo carrito
    for (const v of [v1, v2]) { await llenarCliente(v.container); await escribirRecobro(v.container, "5000"); }
    await act(async () => { click(enviar(v1.container)); await espera(); });
    await act(async () => { click(enviar(v2.container)); await espera(); });
    assert.match(claveDe(0) ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(claveDe(0), claveDe(1), "dos pestañas con la misma intención = la misma clave");
    await escribirRecobro(v2.container, "6000");
    await act(async () => { click(enviar(v2.container)); await espera(); });
    assert.notEqual(claveDe(2), claveDe(0), "otro recobro = otra intención = otra clave");
    v1.desmontar();
    v2.desmontar();
  });

  test("si el servidor dice «ya generada» se muestra la existente con su enlace y la clave se conserva; tras generar con éxito la clave NO se borra (una pestaña antigua reconoce la intención cumplida)", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    let paso = 0;
    stub.__setCrearSolicitudReserva(async () => (++paso === 1
      ? { ok: false, tipo: "envio_duplicado", error: "Esta solicitud ya se generó: la cotización C-0042 ya existe. No se creó otra.", cotizacion: { codigo: "C-0042", url: "http://localhost/cot/abc" } }
      : { ok: true, cotizacion: { id: 9, codigo: "C-0043", url: "http://localhost/cot/def" }, waUrl: null, mailtoUrl: null, mensaje: "x" }));
    const v = await montar();
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    const aviso = porId(v.container, "envio-duplicado")!;
    assert.match(aviso.textContent ?? "", /C-0042 ya existe/);
    assert.equal(aviso.querySelector("a")?.getAttribute("href"), "http://localhost/cot/abc");
    assert.equal(porId(v.container, "error-checkout"), null, "no es un error: la cotización existe");
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(claveDe(0), claveDe(1), "el reintento de la misma intención lleva la misma clave");
    assert.match(v.texto(), /¡Cotización generada!/);
    assert.ok(window.localStorage.getItem("dspacios_envio_v3"), "cumplida la intención, su identidad se conserva: otra pestaña usa la misma clave y el servidor la reconoce");
    v.desmontar();
  });

  test("«Es otra compra»: tras «ya generada» el botón declara una compra nueva igual a la anterior; el siguiente envío lleva OTRA clave y se genera", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    let paso = 0;
    stub.__setCrearSolicitudReserva(async () => (++paso === 1
      ? { ok: false, tipo: "envio_duplicado", error: "Esta solicitud ya se generó: la cotización C-0042 ya existe. No se creó otra.", cotizacion: { codigo: "C-0042", url: "http://localhost/cot/abc" } }
      : { ok: true, cotizacion: { id: 9, codigo: "C-0043", url: "http://localhost/cot/def" }, waUrl: null, mailtoUrl: null, mensaje: "x" }));
    const v = await montar();
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.ok(porId(v.container, "envio-duplicado"));
    await act(async () => { click(porId(v.container, "otra-compra")!); await espera(); });
    assert.equal(porId(v.container, "envio-duplicado"), null, "el aviso desaparece al declarar la compra nueva");
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.notEqual(claveDe(0), claveDe(1), "la compra declarada nueva lleva otra clave");
    assert.match(v.texto(), /¡Cotización generada!/);
    v.desmontar();
  });

  test("REPRODUCCIÓN A (formularios reales del mismo navegador): «Es otra compra» en una pestaña NO convierte en compra nueva a la pestaña abierta antes; la abierta después usa la nueva intención", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const usadas = new Set<string>();
    stub.__setCrearSolicitudReserva(async (input: { claveEnvio?: string }) => {
      const k = String(input.claveEnvio);
      if (usadas.has(k)) return { ok: false, tipo: "envio_duplicado", error: "Esta solicitud ya se generó: la cotización C-0042 ya existe. No se creó otra.", cotizacion: { codigo: "C-0042", url: "http://localhost/cot/abc" } };
      usadas.add(k);
      return { ok: true, cotizacion: { id: usadas.size, codigo: `C-${usadas.size}`, url: "http://localhost/cot/x" }, waUrl: null, mailtoUrl: null, mensaje: "x" };
    });
    const v1 = await montar(), v2 = await montar(), v4 = await montar(); // tres pestañas abiertas ANTES
    for (const v of [v1, v2, v4]) await llenarCliente(v.container);
    await act(async () => { click(enviar(v1.container)); await espera(); });
    assert.match(v1.texto(), /¡Cotización generada!/);
    assert.equal(usadas.size, 1);
    await act(async () => { click(enviar(v2.container)); await espera(); });
    assert.ok(porId(v2.container, "envio-duplicado"), "la segunda pestaña reconoce la intención cumplida");
    await espera(20);
    await act(async () => { click(porId(v2.container, "otra-compra")!); await espera(); });
    await act(async () => { click(enviar(v2.container)); await espera(); });
    assert.equal(usadas.size, 2, "la compra declarada nueva en la pestaña 2 es la segunda cotización");
    // La pestaña 4 se abrió ANTES de la compra nueva: sigue siendo la intención original (ya generada), no una compra nueva.
    await act(async () => { click(enviar(v4.container)); await espera(); });
    assert.ok(porId(v4.container, "envio-duplicado"), "la pestaña antigua no se vuelve una compra nueva");
    assert.equal(usadas.size, 2);
    // Una pestaña abierta DESPUÉS usa la intención nueva (la de la pestaña 2): ya generada, no una tercera.
    const v3 = await montar(); await llenarCliente(v3.container);
    await act(async () => { click(enviar(v3.container)); await espera(); });
    assert.ok(porId(v3.container, "envio-duplicado"), "abierta después = misma intención nueva de la pestaña 2");
    assert.equal(usadas.size, 2);
    for (const v of [v1, v2, v3, v4]) v.desmontar();
  });

  test("salida CONTROLADA: sin Web Locks (o con localStorage que falla) el formulario avisa que no puede coordinar pestañas y sigue permitiendo enviar; con Web Locks y almacén sano no muestra el aviso", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    const nav = window.navigator as unknown as { locks?: unknown };
    const antes = nav.locks;
    try {
      delete nav.locks; // jsdom no trae Web Locks
      const sin = await montar();
      assert.ok(porId(sin.container, "sin-proteccion-pestanas"), "sin Web Locks: aviso visible");
      assert.match(sin.texto(), /no permite coordinar varias pestañas/);
      await llenarCliente(sin.container);
      assert.equal(enviar(sin.container).disabled, false, "el envío sigue disponible");
      sin.desmontar();
      Object.defineProperty(nav, "locks", { value: { request: async (_n: string, cb: () => unknown) => cb() }, configurable: true });
      const con = await montar();
      assert.equal(porId(con.container, "sin-proteccion-pestanas"), null, "con Web Locks y almacén sano no se muestra");
      con.desmontar();
      // localStorage que falla al escribir: también se avisa.
      const orig = window.Storage.prototype.setItem;
      let fallar = false;
      window.Storage.prototype.setItem = function (k: string, v: string) { if (fallar && k.includes("sonda")) throw new Error("QuotaExceeded"); return orig.call(this, k, v); };
      fallar = true;
      const roto = await montar();
      assert.ok(porId(roto.container, "sin-proteccion-pestanas"), "localStorage que falla: aviso visible");
      roto.desmontar();
      window.Storage.prototype.setItem = orig;
    } finally { if (antes === undefined) delete nav.locks; else Object.defineProperty(nav, "locks", { value: antes, configurable: true }); }
  });

  test("clave ya usada por OTRO usuario u otro contenido («clave_en_uso»): el formulario pasa a una generación nueva y reintenta, sin mostrar error", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: ALIADOS });
    let paso = 0;
    stub.__setCrearSolicitudReserva(async () => (++paso === 1
      ? { ok: false, tipo: "clave_en_uso", error: "Esta clave de envío ya se usó en otra solicitud. Recarga la página para generar una nueva e inténtalo de nuevo." }
      : { ok: true, cotizacion: { id: 9, codigo: "C-0044", url: "http://localhost/cot/ghi" }, waUrl: null, mailtoUrl: null, mensaje: "x" }));
    const v = await montar();
    await llenarCliente(v.container);
    await act(async () => { click(enviar(v.container)); await espera(); });
    assert.equal(stub.__solicitudes.length, 2, "un reintento automático al primer rechazo");
    assert.notEqual(claveDe(0), claveDe(1));
    assert.equal(porId(v.container, "error-checkout"), null);
    assert.match(v.texto(), /¡Cotización generada!/);
    v.desmontar();
  });
});

describe("Estimación del aliado directo", () => {
  test("sin recobro la comisión es una ESTIMACIÓN rotulada; con recobro se muestra la liquidación del servidor y el rótulo de estimación desaparece", async () => {
    stub.__setContextoB2B(ALIADO_DIRECTO); stub.__setContextoRecobro({ tipo: "aliado_directo", pctParticipacion: 0.5 });
    const v = await montar();
    await pausa(200);
    assert.match(porId(v.container, "estimacion-aliado")?.textContent ?? "", /Estimación.*sin descontar el impuesto no comisionable.*liquidación exacta/);
    await escribirRecobro(v.container, "100000"); await pausa();
    assert.equal(porId(v.container, "estimacion-aliado"), null, "con recobro manda la liquidación del servidor");
    assert.ok(porId(v.container, "terminos-b2b-previa"));
    v.desmontar();
  });
});

describe("Total con recobro a cliente final, antes de generar", () => {
  const manual = (precio: number, moneda = "COP") => ({
    id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, tramo: null, hotelRef: null, hotelEtiqueta: null,
    pax: 2, precio, impuestoNoComisionable: 0, moneda, fotoUrl: null, noches: null,
  });
  const totalTxt = (c: HTMLElement) => (porId(c, "total-recobro-valor")?.textContent ?? "").replace(/\s+/g, "");
  test("hotel $1.840.000 + servicio $400.000 + recobro $400.000 = $2.640.000: el total actualizado se ve ANTES de generar y se distingue de un cálculo pendiente o con error", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: [] });
    const v = await montar([persona("h1", "Hotel Almirante", 1_840_000), manual(400_000)]);
    await pausa(200);
    assert.equal(porId(v.container, "total-recobro-confirmado"), null, "sin recobro no hay bloque de total con recobro");
    await escribirRecobro(v.container, "400000"); await pausa(100);
    const caja = porId(v.container, "total-recobro-confirmado")!;
    assert.ok(caja, "total confirmado");
    assert.match(caja.textContent!.replace(/\s+/g, " "), /Hotel \$ ?1\.840\.000 \+ Servicio \$ ?400\.000 \+ Recobro \$ ?400\.000/);
    assert.equal(totalTxt(v.container), "$2.640.000");
    // recobro ilegible: ERROR, y NO queda ninguna cifra de total confirmado
    await escribirRecobro(v.container, "40a0"); await pausa(100);
    assert.ok(porId(v.container, "total-recobro-error"), "error visible");
    assert.equal(porId(v.container, "total-recobro-confirmado"), null, "ni rastro de un total confirmado");
    assert.equal(porId(v.container, "total-recobro-valor"), null);
    // corregido: vuelve el total
    await escribirRecobro(v.container, "250.000"); await pausa(100);
    assert.equal(totalTxt(v.container), "$2.490.000");
    v.desmontar();
  });
  test("carrito con monedas mezcladas: el total con recobro queda PENDIENTE (sin cifra), no un total inventado", async () => {
    stub.__setContextoAsistencia({ puede: true, aliados: [] });
    const v = await montar([persona("h1", "Hotel Almirante", 1_840_000), manual(100, "USD")]);
    await pausa(200);
    await escribirRecobro(v.container, "400000"); await pausa(100);
    assert.ok(porId(v.container, "total-recobro-pendiente"), "pendiente visible");
    assert.equal(porId(v.container, "total-recobro-valor"), null);
    v.desmontar();
  });
});
