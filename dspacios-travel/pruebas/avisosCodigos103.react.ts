// #103 — rendered behavior of: the hotel promotion-code editor, the supplier payment-notice screen, and the regeneration-state banner. Server Actions are controllable fakes (their real behavior is proven against the
// database in solicitudProveedor103.pg.ts / latenciaCierres103.pg.ts); this file proves what the PERSON sees and can do.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
type R = { ok: true; mensaje?: string } | { ok: false; error: string };
const G = globalThis as unknown as { __ac103: { llamadas: string[]; refrescos: number; respuestas: Record<string, (...a: unknown[]) => Promise<unknown>> } };
G.__ac103 = { llamadas: [], refrescos: 0, respuestas: {} };
const stub = (nombres: string[]) => nombres.map((n) => `export async function ${n}(...a) { globalThis.__ac103.llamadas.push('${n}:' + JSON.stringify(a.map((x) => (typeof x === 'object' && x && !('entries' in x) ? x : (x && x.entries ? '[FormData]' : x))))); return globalThis.__ac103.respuestas['${n}'](...a); }`).join("\n");
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "next/navigation" && /CodigosPromocion|AvisosPagoClient|EstadoTarifarios/.test(padre)) return { url: datos("export function useRouter() { return { refresh() { globalThis.__ac103.refrescos++; } }; }"), shortCircuit: true };
    if (specifier === "./codigos-actions") return { url: datos(stub(["guardarCodigoPromocion", "quitarCodigoPromocion"])), shortCircuit: true };
    if (specifier === "./actions" && /AvisosPagoClient/.test(padre)) return { url: datos(stub(["pagosDelProveedor", "previsualizarAvisoPago", "enviarAvisoPago", "subirSoportePago", "reintentarAvisoPago"])), shortCircuit: true };
    if (specifier === "../../../paquetes/actions" && /EstadoTarifarios/.test(padre)) return { url: datos(stub(["reanudarTarifariosDeHotel", "estadoTarifariosDeHotel"])), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, File: dom.window.File, FormData: dom.window.FormData, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { CodigosPromocion } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CodigosPromocion.tsx");
const { EstadoTarifarios } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/EstadoTarifarios.tsx");
const { AvisosPagoClient } = await import("../app/(dashboard)/dashboard/pagos/avisos/AvisosPagoClient.tsx");

const R_ = G.__ac103.respuestas;
const SIN_DEUDA = { ok: true, porReanudar: 0, enCursoVivo: 0, fallidos: 0, texto: null, masAntiguaSeg: null, reanudarSolo: false };
const CON_DEUDA = (extra: object = {}) => ({ ok: true, porReanudar: 2, enCursoVivo: 0, fallidos: 0, texto: "Quedaron 2 paquetes sin actualizar. Las combinaciones afectadas permanecen ocultas hasta terminar; pulsa «Actualizar ahora» para completarlas.", masAntiguaSeg: 600, reanudarSolo: false, ...extra });
const VIVA = { ok: true, porReanudar: 0, enCursoVivo: 2, fallidos: 0, texto: "Actualizando los tarifarios de 2 paquetes. Las combinaciones afectadas ya no se muestran con el precio anterior.", masAntiguaSeg: 20, reanudarSolo: false };
const lecturasEstado = () => G.__ac103.llamadas.filter((x) => x.startsWith("estadoTarifariosDeHotel")).length;
let root: ReturnType<typeof createRoot> | undefined; let container: HTMLDivElement;
async function montar(el: unknown) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(async () => root!.render(el as never)); }
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); G.__ac103.llamadas.length = 0; G.__ac103.refrescos = 0; for (const k of Object.keys(R_)) delete R_[k]; });
after(() => dom.window.close());
const boton = (re: RegExp) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(b.textContent ?? ""));
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function escribir(sel: string, v: string) { const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!; const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }

const VIG = [{ id: 11, nombre: "Semana Santa", fechas: "2027-03-20 a 2027-04-05" }, { id: 12, nombre: "Mitad de año", fechas: "2027-06-15 a 2027-07-15" }];

test("C1 code editor: only configured validities are listed; adding one shows empty fields and the «required but not typed» warning; save sends exactly that validity's data; remove asks the server", async () => {
  R_.guardarCodigoPromocion = async () => ({ ok: true }); R_.quitarCodigoPromocion = async () => ({ ok: true });
  await montar(h(CodigosPromocion, { hotelId: 7, vigencias: VIG, codigos: [{ vigenciaId: 11, requerido: true, codigo: "SS-2027", nota: "pedir por correo" }], puedeEditar: true }));
  assert.match(container.textContent ?? "", /Semana Santa/); assert.doesNotMatch(container.querySelector('[data-testid="codigo-12"]')?.textContent ?? "", /./, "the other validity is not listed yet");
  assert.equal(container.querySelector<HTMLInputElement>("#cod-11")!.value, "SS-2027");
  await escribir("#cod-nueva", "12");
  await act(async () => { boton(/^Agregar$/)!.click(); });
  assert.match(container.querySelector('[data-testid="codigo-12"]')!.textContent ?? "", /Exige código pero no se ha digitado/);
  await escribir("#cod-12", "MA-2027");
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="codigo-12"] button')!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.at(-1)!, /guardarCodigoPromocion:\[\{"hotelId":7,"vigenciaId":12,"requerido":true,"codigo":"MA-2027","nota":""\}\]/);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Código guardado/); assert.equal(G.__ac103.refrescos, 1);
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('[data-testid="codigo-11"] button')].find((b) => /Quitar/.test(b.textContent ?? ""))!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.at(-1)!, /quitarCodigoPromocion:\[11,7\]/);
});

test("C2 a failed save shows the server's message; a read-only role sees disabled controls and no buttons", async () => {
  R_.guardarCodigoPromocion = async () => ({ ok: false, error: "Esa vigencia no pertenece a este hotel." });
  await montar(h(CodigosPromocion, { hotelId: 7, vigencias: VIG, codigos: [{ vigenciaId: 11, requerido: true, codigo: "SS", nota: null }], puedeEditar: true }));
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('[data-testid="codigo-11"] button')].find((b) => /Guardar/.test(b.textContent ?? ""))!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /no pertenece a este hotel/); assert.equal(G.__ac103.refrescos, 0);
  await act(async () => root!.unmount());
  container.remove();
  await montar(h(CodigosPromocion, { hotelId: 7, vigencias: VIG, codigos: [{ vigenciaId: 11, requerido: true, codigo: "SS", nota: null }], puedeEditar: false }));
  assert.equal(container.querySelector<HTMLInputElement>("#cod-11")!.disabled, true); assert.equal(container.querySelectorAll("button").length, 0);
});

test("B1 regeneration banner: shows the persisted state; «Actualizar ahora» calls the resume once and refreshes; a failure is shown, never reported as done", async () => {
  R_.reanudarTarifariosDeHotel = async () => ({ ok: true, regenerados: 2, omitidosVivos: 0, fallidos: [] }); R_.estadoTarifariosDeHotel = async () => SIN_DEUDA;
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: "Quedaron 2 paquetes sin actualizar. Las combinaciones afectadas permanecen ocultas hasta terminar; pulsa «Actualizar ahora» para completarlas.", hayPorReanudar: true }));
  assert.match(container.textContent ?? "", /Quedaron 2 paquetes sin actualizar/);
  await act(async () => { boton(/Actualizar ahora/)!.click(); }); await tick();
  assert.equal(G.__ac103.llamadas.length, 2); assert.match(G.__ac103.llamadas[0], /^reanudarTarifariosDeHotel:\[7,\d+,\{"automatica":false\}\]$/); assert.match(G.__ac103.llamadas[1], /^estadoTarifariosDeHotel:\[7\]$/); assert.match(container.textContent ?? "", /Tarifarios actualizados/); assert.equal(G.__ac103.refrescos, 1, "the debt is gone: ONE full refresh");
  R_.reanudarTarifariosDeHotel = async () => ({ ok: true, regenerados: 0, omitidosVivos: 0, fallidos: [{ paqueteId: 3, error: "x" }] }); R_.estadoTarifariosDeHotel = async () => CON_DEUDA();
  await act(async () => { boton(/Actualizar ahora/)!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /No se pudo actualizar 1 paquete/);
});

test("B2 when a computation is alive the banner offers only «Ver estado» (no duplicate regeneration)", async () => {
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: "Actualizando los tarifarios de 2 paquetes. Las combinaciones afectadas ya no se muestran con el precio anterior.", hayPorReanudar: false }));
  assert.ok(boton(/Ver estado/)); assert.equal(boton(/Actualizar ahora/), undefined);
  R_.estadoTarifariosDeHotel = async () => VIVA;
  await act(async () => { boton(/Ver estado/)!.click(); }); await tick();
  assert.equal(lecturasEstado(), 1, "«Ver estado» = one NARROW read"); assert.equal(G.__ac103.llamadas.length, 1); assert.equal(G.__ac103.refrescos, 0, "no whole-page refresh while work is still pending");
  R_.estadoTarifariosDeHotel = async () => SIN_DEUDA;
  await act(async () => { boton(/Ver estado/)!.click(); }); await tick();
  assert.equal(G.__ac103.refrescos, 1, "the read that finds no debt refreshes the page once");
});

const PAGOS = [
  { pagoId: 1, numeroContrato: "DTM-0001", servicio: "Hotel Sol", fecha: "2027-01-15", valor: 1500000, moneda: "COP", trm: 1, soportes: [{ id: 5, nombre: "comprobante.pdf", bytes: 20480 }], yaAvisado: false },
  { pagoId: 2, numeroContrato: "DTM-0002", servicio: "Tour", fecha: "2027-01-20", valor: 50, moneda: "USD", trm: 4100, soportes: [], yaAvisado: true },
];
const VISTA = { ok: true, asunto: "Aviso de pago · Proveedor X · 15/01/2027", html: "<p>aviso</p>", texto: "AVISO DE PAGO texto plano", totales: [], yaAvisados: [2] };

test("D1 payment notice screen: choosing a supplier lists ITS payments (amount + currency, evidence, «ya avisado»); preview/send stay disabled until payments are ticked and a preview exists", async () => {
  R_.pagosDelProveedor = async () => ({ ok: true, pagos: PAGOS }); R_.previsualizarAvisoPago = async () => VISTA; R_.enviarAvisoPago = async () => ({ ok: true, mensaje: "Aviso enviado. El pago NO cambia." });
  await montar(h(AvisosPagoClient, { proveedores: ["Proveedor X", "Otro"], historial: [], correoHabilitado: true, modoCaptura: true }));
  assert.equal(container.querySelector('[data-testid="pagos-aviso"]'), null, "nothing listed before choosing a supplier");
  assert.match(container.textContent ?? "", /NO sale de esta máquina/);
  await escribir("#av-proveedor", "Proveedor X"); await tick();
  const t = container.querySelector('[data-testid="pagos-aviso"]')!.textContent ?? "";
  assert.match(t, /DTM-0001/); assert.match(t, /COP 1\.500\.000/); assert.match(t, /USD 50,00/); assert.match(t, /comprobante\.pdf/); assert.match(t, /sin soporte/); assert.match(t, /ya avisado/);
  assert.equal(boton(/Vista previa/)!.disabled, true); assert.equal(boton(/Enviar aviso/)!.disabled, true);
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label^="Incluir el pago 1"]')!.click(); });
  await act(async () => { [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => !c.getAttribute("aria-label"))!.click(); });   // the evidence file
  assert.equal(boton(/Vista previa/)!.disabled, false); assert.equal(boton(/Enviar aviso/)!.disabled, true, "no send without a preview");
  await escribir("#av-ref", "TRF-889"); await escribir("#av-correos", "pagos@proveedor.test");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.at(-1)!, /previsualizarAvisoPago:\[\{"proveedor":"Proveedor X","pagoIds":\[1\],"soporteIds":\[5\],"referencia":"TRF-889"\}\]/);
  assert.equal(container.querySelector("iframe")!.getAttribute("sandbox"), ""); assert.match(container.textContent ?? "", /AVISO DE PAGO texto plano/); assert.match(container.textContent ?? "", /1 pago\(s\) ya se avisaron antes/);
  await act(async () => { boton(/Enviar aviso/)!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.find((x) => x.startsWith("enviarAvisoPago"))!, /enviarAvisoPago:\[\{"proveedor":"Proveedor X","pagoIds":\[1\],"soporteIds":\[5\],"referencia":"TRF-889","destinatarios":"pagos@proveedor.test","reenviar":false\}\]/);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /El pago NO cambia/);
  assert.equal(G.__ac103.llamadas.at(-1), 'pagosDelProveedor:["Proveedor X"]', "the list is reloaded after sending (the payment now shows as already notified)");
});

test("D2 changing the selection invalidates the preview (you cannot send what you did not preview); a server error is shown; mail disabled keeps send off", async () => {
  R_.pagosDelProveedor = async () => ({ ok: true, pagos: PAGOS }); R_.previsualizarAvisoPago = async () => VISTA; R_.enviarAvisoPago = async () => ({ ok: false, error: "Todos los pagos deben ser del mismo proveedor y de esta agencia." });
  await montar(h(AvisosPagoClient, { proveedores: ["Proveedor X"], historial: [], correoHabilitado: true, modoCaptura: false }));
  await escribir("#av-proveedor", "Proveedor X"); await tick();
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label^="Incluir el pago 1"]')!.click(); });
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.equal(boton(/Enviar aviso/)!.disabled, false);
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label^="Incluir el pago 2"]')!.click(); });
  assert.equal(boton(/Enviar aviso/)!.disabled, true, "the preview no longer matches the selection"); assert.equal(container.querySelector("iframe"), null);
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  await act(async () => { boton(/Enviar aviso/)!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /mismo proveedor/);
  await act(async () => root!.unmount()); container.remove();
  await montar(h(AvisosPagoClient, { proveedores: ["Proveedor X"], historial: [], correoHabilitado: false, modoCaptura: false }));
  assert.match(container.textContent ?? "", /todavía no está habilitado/);
});

test("D4 payment history: a failed/in-progress notice offers «Reintentar envío» BY ID (re-sends the original, no form data involved); an uncertain one explains the new-version path; the new-version checkbox travels with the send", async () => {
  R_.pagosDelProveedor = async () => ({ ok: true, pagos: PAGOS }); R_.previsualizarAvisoPago = async () => VISTA; R_.enviarAvisoPago = async () => ({ ok: true, mensaje: "ok" }); R_.reintentarAvisoPago = async () => ({ ok: true, mensaje: "Aviso reenviado (el mensaje original). El pago NO cambia." });
  const base = { proveedor: "Proveedor X", destinatarios: ["p@x.test"], asunto: "Aviso", referencia: null, error_envio: "400", enviada_en: null, entregada_en: null, respondida_en: null, created_at: "2026-11-22T10:00:00Z" };
  await montar(h(AvisosPagoClient, { proveedores: ["Proveedor X"], historial: [{ ...base, id: 7, estado: "fallida" as const }, { ...base, id: 8, estado: "incierta" as const }], correoHabilitado: true, modoCaptura: false }));
  const botonesHistorial = [...container.querySelectorAll("li button")].map((b) => b.textContent);
  assert.deepEqual(botonesHistorial, ["Reintentar envío"], "only the failed notice is retried; the uncertain one has no retry button");
  assert.match(container.textContent ?? "", /No se sabe si salió[\s\S]*versión nueva/);
  await act(async () => { boton(/Reintentar envío/)!.click(); }); await tick();
  assert.deepEqual(G.__ac103.llamadas.filter((x) => x.startsWith("reintentarAvisoPago")), ["reintentarAvisoPago:[7]"]);
  await escribir("#av-proveedor", "Proveedor X"); await tick();
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label^="Incluir el pago 1"]')!.click(); });
  await escribir("#av-correos", "pagos@proveedor.test"); await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  await act(async () => { [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => /Enviar como versión nueva/.test(c.parentElement?.textContent ?? ""))!.click(); });
  await act(async () => { boton(/Enviar aviso/)!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.find((x) => x.startsWith("enviarAvisoPago"))!, /"reenviar":true/);
});

test("D3 evidence upload needs ticked payments and a file; it sends a FormData with the ticked payments and refreshes the list; history shows the four facts and the uncertain/failed errors", async () => {
  let fd: FormData | undefined;
  R_.pagosDelProveedor = async () => ({ ok: true, pagos: PAGOS }); R_.subirSoportePago = async (...a) => { fd = a[0] as FormData; return { ok: true, mensaje: "Soporte guardado. Aún no se ha enviado nada al proveedor." }; };
  const historial = [{ id: 1, proveedor: "Proveedor X", estado: "incierta" as const, destinatarios: ["p@x.test"], asunto: "Aviso de pago · X", referencia: null, error_envio: "el envío anterior se interrumpió", enviada_en: null, entregada_en: null, respondida_en: null, created_at: "2026-11-22T10:00:00Z" }];
  await montar(h(AvisosPagoClient, { proveedores: ["Proveedor X"], historial, correoHabilitado: true, modoCaptura: false }));
  assert.match(container.textContent ?? "", /Resultado del envío desconocido/); assert.match(container.textContent ?? "", /el envío anterior se interrumpió/);
  await escribir("#av-proveedor", "Proveedor X"); await tick();
  await act(async () => { boton(/Guardar soporte/)!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Elige un archivo/);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const archivo = new dom.window.File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "nuevo.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [archivo], configurable: true });
  await act(async () => { boton(/Guardar soporte/)!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Marca primero los pagos/);
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label^="Incluir el pago 1"]')!.click(); });
  await act(async () => { boton(/Guardar soporte/)!.click(); }); await tick();
  assert.ok(fd, "the upload action was called"); assert.equal(fd!.get("pagoIds"), "[1]"); assert.equal((fd!.get("archivo") as File).name, "nuevo.pdf");
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Aún no se ha enviado nada/);
});

// ── R2-5 · bounded AUTOMATIC recovery of the regeneration debt ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { mock } from "node:test";
const TXT_DEUDA = "Quedaron 2 paquetes sin actualizar. Las combinaciones afectadas permanecen ocultas hasta terminar; pulsa «Actualizar ahora» para completarlas.";

test("B3 a debt that is old, with nothing alive, resumes BY ITSELF on opening (no button): the automatic path is requested, the person is told, the banner follows the refreshed state", async () => {
  R_.reanudarTarifariosDeHotel = async () => ({ ok: true, regenerados: 2, omitidosVivos: 0, fallidos: [] }); R_.estadoTarifariosDeHotel = async () => SIN_DEUDA;
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: TXT_DEUDA, hayPorReanudar: true, reanudarSolo: true }));
  await tick();
  assert.equal(G.__ac103.llamadas.filter((x) => x.startsWith("reanudar")).length, 1, "exactly one automatic resume");
  assert.match(G.__ac103.llamadas[0], /^reanudarTarifariosDeHotel:\[7,\d+,\{"automatica":true\}\]$/, "the AUTOMATIC path (fallido packages are left to a person)");
  assert.match(container.textContent ?? "", /Tarifarios completados automáticamente/); assert.equal(G.__ac103.refrescos, 1);
});

test("B4 a young debt, or one with a live computation (reanudarSolo=false), is NOT resumed automatically; the manual button still works and is not the automatic path", async () => {
  R_.reanudarTarifariosDeHotel = async () => ({ ok: true, regenerados: 2, omitidosVivos: 0, fallidos: [] }); R_.estadoTarifariosDeHotel = async () => SIN_DEUDA;
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: TXT_DEUDA, hayPorReanudar: true, reanudarSolo: false }));
  await tick(); assert.equal(G.__ac103.llamadas.length, 0);
  await act(async () => { boton(/Actualizar ahora/)!.click(); }); await tick();
  assert.match(G.__ac103.llamadas[0], /\{"automatica":false\}/);
});

test("B5 an automatic resume that FAILS says so truthfully (the banner is not cleared by the client) and is attempted at most twice per page view", async () => {
  R_.reanudarTarifariosDeHotel = async () => ({ ok: true, regenerados: 0, omitidosVivos: 0, fallidos: [{ paqueteId: 3, error: "x" }] }); R_.estadoTarifariosDeHotel = async () => CON_DEUDA({ reanudarSolo: true });
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: TXT_DEUDA, hayPorReanudar: true, reanudarSolo: true }));
  await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /No se pudo actualizar 1 paquete/); assert.match(container.textContent ?? "", /Quedaron 2 paquetes sin actualizar/);
  for (const v of [false, true, false, true]) await act(async () => root!.render(h(EstadoTarifarios, { hotelId: 7, texto: TXT_DEUDA, hayPorReanudar: true, reanudarSolo: v }) as never)); await tick();
  assert.equal(G.__ac103.llamadas.filter((x) => x.startsWith("reanudar")).length, 2, "bounded: one on mount + one more from a LATER server render; the failed attempt is not followed by an immediate second one (B12), and nothing beyond 2 per page view");
  assert.equal(G.__ac103.refrescos, 0, "still owed: no whole-page refresh");
});

// ── R3-3 · the follow-up uses the NARROW state read, never a periodic whole-page refresh; bounded, never overlapping, paused when hidden ─────────────────────────────────────────────────────────────────────
let visibilidad: "visible" | "hidden" = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad });
const cambiarVisibilidad = async (v: "visible" | "hidden") => { visibilidad = v; await act(async () => { document.dispatchEvent(new dom.window.Event("visibilitychange")); }); };
const vaciar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });   // flush promises WITHOUT the mocked setTimeout
const avanzar = async (ms: number) => { await act(async () => { mock.timers.tick(ms); }); await vaciar(); };
async function conTiempo<T>(f: () => Promise<T>): Promise<T> { mock.timers.enable({ apis: ["setTimeout", "Date"] }); visibilidad = "visible"; try { return await f(); } finally { mock.timers.reset(); visibilidad = "visible"; } }

test("B6 pending work: exactly ONE narrow read per 15 s, never a whole-page refresh, at most 20 reads (~5 min), then it stops and says so; unmount stops it", async () => conTiempo(async () => {
  R_.estadoTarifariosDeHotel = async () => VIVA;
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: VIVA.texto!, hayPorReanudar: false, reanudarSolo: false }));
  await avanzar(14_999); assert.equal(lecturasEstado(), 0, "nothing before the interval");
  await avanzar(1); assert.equal(lecturasEstado(), 1);
  for (let i = 0; i < 40; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 20, "bounded at 20 reads"); assert.equal(G.__ac103.refrescos, 0, "a pending banner NEVER refreshes the whole page");
  assert.equal(G.__ac103.llamadas.filter((x) => !x.startsWith("estado")).length, 0, "no resume, nothing else");
  assert.match(container.textContent ?? "", /seguimiento automático se detuvo/);
  await act(async () => root!.unmount()); root = undefined;
  await avanzar(120_000); assert.equal(lecturasEstado(), 20, "unmounted: no more reads");
}));

test("B7 completion: the read that finds no debt triggers ONE full refresh and polling ends (no read after it)", async () => conTiempo(async () => {
  let n = 0; R_.estadoTarifariosDeHotel = async () => (++n < 3 ? VIVA : SIN_DEUDA);
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: VIVA.texto!, hayPorReanudar: false, reanudarSolo: false }));
  await avanzar(15_000); await avanzar(15_000); assert.equal(G.__ac103.refrescos, 0);
  await avanzar(15_000); assert.equal(G.__ac103.refrescos, 1, "one refresh on completion");
  for (let i = 0; i < 10; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 3, "polling ended at completion"); assert.equal(G.__ac103.refrescos, 1);
}));

test("B8 overlapping reads: a slow read is never joined by a second one (the next is scheduled when the previous ENDS), even across many intervals", async () => conTiempo(async () => {
  let concurrentes = 0, maximo = 0, liberar: (() => void) | null = null;
  R_.estadoTarifariosDeHotel = () => { concurrentes++; maximo = Math.max(maximo, concurrentes); return new Promise((res) => { liberar = () => { concurrentes--; res(VIVA); }; }); };
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: VIVA.texto!, hayPorReanudar: false, reanudarSolo: false }));
  await avanzar(15_000); assert.equal(lecturasEstado(), 1);
  for (let i = 0; i < 6; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 1, "the slow read is still in flight: no second read was started"); assert.equal(maximo, 1);
  await act(async () => { liberar!(); }); await vaciar(); await avanzar(15_000); assert.equal(lecturasEstado(), 2, "the next one starts one interval AFTER the previous finished"); assert.equal(maximo, 1);
}));

test("B9 hidden tab: no reads and no budget spent while hidden; on becoming visible it reads at once if the interval has passed; a hidden-then-visible flicker does not double-read", async () => conTiempo(async () => {
  R_.estadoTarifariosDeHotel = async () => VIVA;
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: VIVA.texto!, hayPorReanudar: false, reanudarSolo: false }));
  await cambiarVisibilidad("hidden");
  for (let i = 0; i < 40; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 0, "10 minutes hidden: zero reads");
  await cambiarVisibilidad("visible"); await vaciar(); assert.equal(lecturasEstado(), 1, "visible again: one immediate read (the interval had passed)");
  await cambiarVisibilidad("hidden"); await cambiarVisibilidad("visible"); await vaciar(); assert.equal(lecturasEstado(), 1, "a quick flicker inside the interval reads nothing extra");
  await avanzar(15_000); assert.equal(lecturasEstado(), 2, "then the normal rhythm continues");
  // the budget was not consumed by the hidden time: 19 more reads remain
  for (let i = 0; i < 40; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 20);
}));

test("B10 persistent errors: after 3 consecutive failed reads the follow-up STOPS (no 20 retries), says so, and a person's «Ver estado» restarts it; one success in between resets the count", async () => conTiempo(async () => {
  let falla = true; R_.estadoTarifariosDeHotel = async () => (falla ? { ok: false, error: "x" } : VIVA);
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: VIVA.texto!, hayPorReanudar: false, reanudarSolo: false }));
  for (let i = 0; i < 10; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 3, "three failures, then it stops"); assert.equal(G.__ac103.refrescos, 0); assert.match(container.textContent ?? "", /seguimiento automático se detuvo/);
  falla = false; await act(async () => { boton(/Ver estado/)!.click(); }); await vaciar(); assert.equal(lecturasEstado(), 4);
  await avanzar(15_000); assert.equal(lecturasEstado(), 5, "the person's read restarted the follow-up");
}));

test("B11 one failing read in the middle (thrown, not just ok:false) does not stop the follow-up", async () => conTiempo(async () => {
  let n = 0; R_.estadoTarifariosDeHotel = async () => { n++; if (n === 2 || n === 4) throw new Error("red"); return VIVA; };
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: VIVA.texto!, hayPorReanudar: false, reanudarSolo: false }));
  for (let i = 0; i < 8; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 8, "isolated failures reset on the next success: still polling");
}));

test("B12 a resume in flight blocks the poll (no overlap) and an automatic second attempt only follows a LATER read that still says it is owed, at most twice per page view", async () => conTiempo(async () => {
  let liberar: (() => void) | null = null;
  R_.reanudarTarifariosDeHotel = () => new Promise((res) => { liberar = () => res({ ok: true, regenerados: 0, omitidosVivos: 0, fallidos: [{ paqueteId: 3, error: "x" }] }); });
  R_.estadoTarifariosDeHotel = async () => CON_DEUDA({ reanudarSolo: true });
  await montar(h(EstadoTarifarios, { hotelId: 7, texto: TXT_DEUDA, hayPorReanudar: true, reanudarSolo: true }));
  for (let i = 0; i < 4; i++) await avanzar(15_000);
  assert.equal(lecturasEstado(), 0, "no poll read while the resume is running"); assert.equal(G.__ac103.llamadas.filter((x) => x.startsWith("reanudar")).length, 1);
  await act(async () => { liberar!(); }); await vaciar(); assert.equal(lecturasEstado(), 1, "the post-resume read");
  assert.equal(G.__ac103.llamadas.filter((x) => x.startsWith("reanudar")).length, 1, "no immediate second attempt");
  R_.reanudarTarifariosDeHotel = async () => ({ ok: true, regenerados: 0, omitidosVivos: 0, fallidos: [{ paqueteId: 3, error: "x" }] });
  for (let i = 0; i < 20; i++) await avanzar(15_000);
  assert.equal(G.__ac103.llamadas.filter((x) => x.startsWith("reanudar")).length, 2, "exactly one more attempt, from a later read; never beyond 2 per page view");
}));

// H103-13 — the payment notice has the same optional note: it travels with the preview and the send ONLY when written, typing invalidates the preview, and without it the call is exactly the old one.
test("D4 optional note on the payment notice: absent → the call is unchanged; written → it travels with preview and send, and typing after a preview switches send off until a new preview", async () => {
  R_.pagosDelProveedor = async () => ({ ok: true, pagos: PAGOS }); R_.previsualizarAvisoPago = async () => VISTA; R_.enviarAvisoPago = async () => ({ ok: true, mensaje: "Aviso enviado. El pago NO cambia." });
  await montar(h(AvisosPagoClient, { proveedores: ["Proveedor X"], historial: [], correoHabilitado: true, modoCaptura: true }));
  await escribir("#av-proveedor", "Proveedor X"); await tick();
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label^="Incluir el pago 1"]')!.click(); });
  await escribir("#av-correos", "pagos@proveedor.test");
  const ta = container.querySelector<HTMLTextAreaElement>("#av-mensaje")!;
  assert.ok(ta, "the note field is there"); assert.equal(ta.value, ""); assert.match(container.textContent ?? "", /arriba de las tablas.*no las reemplaza|no las reemplaza/);
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.doesNotMatch(G.__ac103.llamadas.at(-1)!, /mensaje/, "no note → the preview call has no `mensaje` key (unchanged)");
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(ta, "Adjuntamos soporte del banco"); ta.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  assert.equal(boton(/Enviar aviso/)!.disabled, true, "typing a note invalidates the preview");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.at(-1)!, /"mensaje":"Adjuntamos soporte del banco"/);
  await act(async () => { boton(/Enviar aviso/)!.click(); }); await tick();
  assert.match(G.__ac103.llamadas.find((x) => x.startsWith("enviarAvisoPago"))!, /"mensaje":"Adjuntamos soporte del banco"/);
});
