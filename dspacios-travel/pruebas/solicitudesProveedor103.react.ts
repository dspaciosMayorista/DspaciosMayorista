// #103 — rendered behavior of the supplier-requests panel on the contract page: disabled state, send with validation errors from the server, double click sends once, the four distinct facts
// (sent / delivered / replied / decided) shown separately, reply text shown, decision buttons only when it makes sense, retry only for failures. Server Actions are controllable fakes.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
type R = { ok: true; mensaje: string } | { ok: false; error: string };
const G = globalThis as unknown as { __sp103: { reintentar: (...a: unknown[]) => Promise<R>; previa: (...a: unknown[]) => Promise<unknown>; enviar: (...a: unknown[]) => Promise<R>; decidir: (...a: unknown[]) => Promise<R>; leidas: () => Promise<R>; llamadas: string[]; refrescos: number } };
type Previa = { ok: true; asunto: string; html: string; texto: string; candidatas: unknown[]; hotelId: number | null; hotelesSugeridos: { id: number; nombre: string }[]; exigeEleccion: boolean } | { ok: false; error: string; candidatas?: unknown[]; hotelesSugeridos?: { id: number; nombre: string }[]; exigeEleccion?: boolean };
const PREVIA_OK: Previa = { ok: true, asunto: "Solicitud de servicio · Reserva DTM-1031", html: "<p>vista</p>", texto: "vista en texto", candidatas: [], hotelId: null, hotelesSugeridos: [], exigeEleccion: false };
G.__sp103 = { reintentar: async () => ({ ok: true, mensaje: "Solicitud reenviada (el mensaje original)." }), previa: async () => PREVIA_OK, enviar: async () => ({ ok: true, mensaje: "Solicitud enviada." }), decidir: async () => ({ ok: true, mensaje: "Registrado." }), leidas: async () => ({ ok: true, mensaje: "Avisos marcados como leídos." }), llamadas: [], refrescos: 0 };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && (context.parentURL ?? "").includes("SolicitudesProveedorPanel")) return { url: datos("export function useRouter() { return { refresh() { globalThis.__sp103.refrescos++; } }; }"), shortCircuit: true };
    if (specifier === "./solicitud-proveedor-actions") {
      return { url: datos(`export async function previsualizarSolicitudProveedor(...a) { (globalThis.__sp103.notas ??= []).push(['previa', a[6]]); globalThis.__sp103.llamadas.push('previa:' + JSON.stringify([a[1], a[3], a[4]]) + (a[5] ? ':sel=' + JSON.stringify(a[5]) : '')); return globalThis.__sp103.previa(...a); }
export async function enviarSolicitudProveedor(...a) { (globalThis.__sp103.notas ??= []).push(['enviar', a[8]]); globalThis.__sp103.llamadas.push('enviar:' + JSON.stringify(a.slice(1, 3)) + ':' + JSON.stringify([a[4], a[5]]) + (a[6] ? ':reenviar' : '') + (a[7] ? ':sel=' + JSON.stringify(a[7]) : '')); return globalThis.__sp103.enviar(...a); }
export async function registrarDecisionProveedor(...a) { globalThis.__sp103.llamadas.push('decidir:' + a[1] + ':' + a[2]); return globalThis.__sp103.decidir(...a); }
export async function reintentarEnvioSolicitudProveedor(...a) { globalThis.__sp103.llamadas.push('reintentar:' + a[1]); return globalThis.__sp103.reintentar(...a); }
export async function marcarAvisosLeidos() { globalThis.__sp103.llamadas.push('leidas'); return globalThis.__sp103.leidas(); }`), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { confirm: () => boolean }).confirm = () => true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { SolicitudesProveedorPanel } = await import("../app/(dashboard)/dashboard/contratos/[numero]/SolicitudesProveedorPanel.tsx");

const V = [{ proveedor: "Hotel Prueba", clase: "hotel" as const }];
const base = { id: 1, proveedor: "Hotel Prueba", destinatarios: ["reservas@hotel.test"], error_envio: null, enviada_en: null, entregada_en: null, respondida_en: null, confirmada_en: null, created_at: "2026-11-22T10:00:00Z" };
let root: ReturnType<typeof createRoot> | undefined; let container: HTMLDivElement;
async function render(props: Partial<Parameters<typeof SolicitudesProveedorPanel>[0]> = {}) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(h(SolicitudesProveedorPanel, { numero: "DTM-1031", identidad: {}, proveedores: V, solicitudes: [], respuestas: [], sinLeer: 0, correoHabilitado: true, modoCaptura: false, ...props } as never)));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); G.__sp103.llamadas.length = 0; G.__sp103.refrescos = 0; G.__sp103.previa = async () => PREVIA_OK; G.__sp103.enviar = async () => ({ ok: true, mensaje: "Solicitud enviada." }); G.__sp103.decidir = async () => ({ ok: true, mensaje: "Registrado." }); });
after(() => dom.window.close());
const boton = (re: RegExp) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(b.textContent ?? ""));
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function escribir(sel: string, v: string) { const el = container.querySelector<HTMLInputElement>(sel)!; await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); }

test("P1 mail not enabled: a clear note, no send form, history (if any) still visible", async () => {
  await render({ correoHabilitado: false, solicitudes: [{ ...base, estado: "enviada", enviada_en: "2026-11-22T10:01:00Z" }] });
  assert.match(container.textContent ?? "", /todavía no está habilitado/);
  assert.equal(container.querySelector("#sp-correos"), null);
  assert.match(container.textContent ?? "", /Hotel Prueba/);
});

test("P2 send: needs a PREVIEW first (the button is disabled before it), then calls the action with supplier + typed emails, shows the server's message, refreshes; a server validation error is shown and nothing refreshes", async () => {
  await render();
  await escribir("#sp-correos", "reservas@hotel.test");
  assert.equal(boton(/Enviar solicitud/)!.disabled, true, "no send without a preview");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.ok(container.querySelector('[data-testid="vista-previa-solicitud"] iframe'), "the preview is shown");
  assert.equal(container.querySelector("iframe")!.getAttribute("sandbox"), "", "the email HTML is rendered fully sandboxed");
  assert.match(container.textContent ?? "", /vista en texto/);
  assert.equal(boton(/Enviar solicitud/)!.disabled, false);
  await act(async () => { boton(/Enviar solicitud/)!.click(); }); await tick();
  assert.deepEqual(G.__sp103.llamadas.slice(1), ['enviar:["Hotel Prueba","reservas@hotel.test"]:[null,{"codigoId":null,"sinPromocion":false}]']);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Solicitud enviada/);
  assert.equal(G.__sp103.refrescos, 1);
  G.__sp103.enviar = async () => ({ ok: false, error: "El correo «x» no es válido." });
  await act(async () => { boton(/Enviar solicitud/)!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /no es válido/);
  assert.equal(G.__sp103.refrescos, 1, "no refresh after an error");
});

test("P3 double click sends ONE request", async () => {
  await render();
  await escribir("#sp-correos", "reservas@hotel.test");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  let liberar!: (r: R) => void;
  G.__sp103.enviar = () => new Promise<R>((res) => { liberar = res; });
  await act(async () => { boton(/Enviar solicitud/)!.click(); boton(/Enviar|Enviando/)!.click(); });
  assert.equal(G.__sp103.llamadas.filter((x) => x.startsWith("enviar")).length, 1);
  await act(async () => { liberar({ ok: true, mensaje: "ok" }); }); await tick();
});

test("P4 the four facts are shown separately and the reply text is visible; a reply is NOT shown as confirmed", async () => {
  await render({
    solicitudes: [{ ...base, estado: "respondida", enviada_en: "2026-11-22T10:01:00Z", entregada_en: "2026-11-22T10:02:00Z", respondida_en: "2026-11-22T11:00:00Z" }],
    respuestas: [{ solicitudId: 1, creada: "2026-11-22T11:00:00Z", de: "reservas@hotel.test", texto: "Confirmamos disponibilidad." }], sinLeer: 1,
  });
  const t = container.textContent ?? "";
  assert.match(t, /Respondió/); assert.doesNotMatch(t, /Confirmada por el proveedor/);
  assert.match(t, /Enviada: .*Entregada: .*Respondió: .*Decisión registrada: —/);
  assert.match(t, /Confirmamos disponibilidad\./);
  assert.match(t, /1 respuesta\(s\) nueva\(s\)/);
  assert.ok(boton(/Registrar: el proveedor confirmó/) && boton(/Registrar: el proveedor rechazó/));
  await act(async () => { boton(/Registrar: el proveedor confirmó/)!.click(); }); await tick();
  assert.deepEqual(G.__sp103.llamadas, ["decidir:1:confirmacion"]);
});

test("P5 failed send: shows the error and offers retry (same request); no decision buttons; delivered/replied requests offer «resend as new» instead", async () => {
  await render({ solicitudes: [{ ...base, id: 1, estado: "fallida", error_envio: "smtp 421" }, { ...base, id: 2, estado: "entregada", entregada_en: "2026-11-22T10:02:00Z" }] });
  assert.match(container.textContent ?? "", /smtp 421/);
  assert.equal(container.querySelectorAll("button").length > 0, true);
  assert.ok(boton(/Reintentar envío/)); assert.equal(container.querySelectorAll('[data-testid="solicitud-1"] button').length, 1, "failed: only retry");
  const dos = [...container.querySelectorAll('[data-testid="solicitud-2"] button')].map((b) => b.textContent);
  assert.ok(dos.some((x) => /Registrar: el proveedor confirmó/.test(x ?? "")) && dos.some((x) => /Reenviar como nueva/.test(x ?? "")));
  // a NEW version is an explicit, REVIEWED send of the current data: without a preview of this supplier it is refused with an explanation and nothing is sent
  await act(async () => { boton(/Reenviar como nueva/)!.click(); }); await tick();
  assert.equal(G.__sp103.llamadas.length, 0); assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /genera la vista previa del contenido actual/);
  await escribir("#sp-correos", "reservas@hotel.test"); await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  G.__sp103.llamadas.length = 0;
  await act(async () => { boton(/Reenviar como nueva/)!.click(); }); await tick();
  assert.match(G.__sp103.llamadas[0], /:reenviar$/);
  G.__sp103.llamadas.length = 0;
  await act(async () => { boton(/Reintentar envío/)!.click(); }); await tick();
  assert.equal(G.__sp103.llamadas[0], "reintentar:1", "the retry is addressed to THAT request by id: no form data, no rebuild");
});

test("P6 a request that is only 'enviando' offers retry (the server decides whether its lease expired) but no decision and no resend; capture mode is announced", async () => {
  await render({ modoCaptura: true, solicitudes: [{ ...base, estado: "enviando" }] });
  assert.deepEqual([...container.querySelectorAll('[data-testid="solicitud-1"] button')].map((b) => b.textContent), ["Reintentar envío"]);
  assert.match(container.textContent ?? "", /NO sale de esta máquina/);
});

test("P7 mark notices read calls the action", async () => {
  await render({ sinLeer: 2, solicitudes: [{ ...base, estado: "respondida" }] });
  await act(async () => { boton(/marcar leídas/)!.click(); }); await tick();
  assert.deepEqual(G.__sp103.llamadas, ["leidas"]);
});

test("P8 UNCERTAIN send: explained in the row, no retry button (an identical click is blocked server-side), only «Reenviar como nueva»; no decision buttons", async () => {
  await render({ solicitudes: [{ ...base, estado: "incierta", error_envio: "el envío anterior se interrumpió" }] });
  const t = container.querySelector('[data-testid="solicitud-1"]')!.textContent ?? "";
  assert.match(t, /Resultado del envío desconocido/); assert.match(t, /No se sabe si el correo salió/); assert.match(t, /el envío anterior se interrumpió/);
  assert.deepEqual([...container.querySelectorAll('[data-testid="solicitud-1"] button')].map((b) => b.textContent), ["Reenviar como nueva"]);
});

test("P9 PROMOTION CODE: a hotel with a code-requiring promotion over the stay → the sender must choose (radio) or declare «no promotion»; choosing re-previews with that choice and the code is visible; a missing code is shown as unfilled", async () => {
  const candidatas = [{ codigoId: 9, nombre: "Promo Semana Santa", codigoCargado: true, codigo: "SS-2027-X" }, { codigoId: 10, nombre: "Promo sin digitar", codigoCargado: false, codigo: null }];
  G.__sp103.previa = async (...a) => {
    const [, , , hotelId, eleccion] = a as [unknown, unknown, unknown, number | null, { codigoId: number | null; sinPromocion: boolean }];
    if (hotelId == null) return { ok: false, error: "selecciona el hotel del catálogo", hotelesSugeridos: [{ id: 5, nombre: "Hotel Prueba" }], candidatas: [], exigeEleccion: false };
    if (!eleccion.codigoId && !eleccion.sinPromocion) return { ok: false, error: "Estas fechas caen en la promoción «Promo Semana Santa» que exige código del hotel: elige el código a usar o indica que esta reserva no usa la promoción.", candidatas, hotelesSugeridos: [{ id: 5, nombre: "Hotel Prueba" }], exigeEleccion: true };
    return { ok: true, asunto: "S", html: eleccion.codigoId ? "<p>CODIGO SS-2027-X</p>" : "<p>sin promo</p>", texto: eleccion.codigoId ? "CÓDIGO DE PROMOCIÓN: SS-2027-X" : "sin promo", candidatas, hotelId: 5, hotelesSugeridos: [{ id: 5, nombre: "Hotel Prueba" }], exigeEleccion: true };
  };
  await render();
  await escribir("#sp-correos", "reservas@hotel.test");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick(); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /elige el código a usar/, "the rule is explained, not hidden");
  const fs = container.querySelector('[data-testid="codigo-promocion"]')!;
  assert.match(fs.textContent ?? "", /Promo Semana Santa/); assert.match(fs.textContent ?? "", /SS-2027-X/); assert.match(fs.textContent ?? "", /Promo sin digitar[\s\S]*código sin digitar/);
  assert.equal(boton(/Enviar solicitud/)!.disabled, true, "cannot send until a valid choice is previewed");
  const radios = fs.querySelectorAll<HTMLInputElement>('input[type="radio"]'); assert.equal(radios.length, 3, "two promotions + «no usa la promoción»");
  await act(async () => { radios[0].click(); }); await tick(); await tick();
  assert.match(container.textContent ?? "", /SS-2027-X/); assert.equal(boton(/Enviar solicitud/)!.disabled, false);
  await act(async () => { boton(/Enviar solicitud/)!.click(); }); await tick();
  assert.match(G.__sp103.llamadas.filter((x) => x.startsWith("enviar")).at(-1)!, /\[5,\{"codigoId":9,"sinPromocion":false\}\]/, "the chosen hotel and promotion travel with the send");
  await act(async () => { radios[2].click(); }); await tick(); await tick();
  assert.match(container.textContent ?? "", /sin promo/); assert.doesNotMatch(container.querySelector("iframe")!.getAttribute("srcdoc") ?? "", /SS-2027-X/);
});

test("P10 a send blocked by the server for a code problem shows that exact message and does not refresh", async () => {
  await render(); await escribir("#sp-correos", "reservas@hotel.test");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  G.__sp103.enviar = async () => ({ ok: false, error: "El código de promoción no corresponde a la configuración actual del hotel. Recarga y vuelve a elegirlo." });
  await act(async () => { boton(/Enviar solicitud/)!.click(); }); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /no corresponde a la configuración actual/); assert.equal(G.__sp103.refrescos, 0);
});

const V2 = [{ proveedor: "Hotel Prueba", clase: "hotel" as const, servicios: 1, estancias: [{ id: 11, nombre: "Hotel A", ingreso: "2027-03-26", salida: "2027-03-30" }, { id: 12, nombre: "Hotel B", ingreso: "2027-03-30", salida: "2027-04-02" }] }];
const marcar = async (etiqueta: RegExp, valor: boolean) => { const l = [...container.querySelectorAll("label")].find((x) => etiqueta.test(x.textContent ?? ""))!; const i = l.querySelector("input")!; if (i.checked !== valor) await act(async () => { i.click(); }); };

test("P11 several stays of one supplier: the person chooses WHICH stays the request carries; the selection travels to the preview and the send, changing it discards the old preview, and the untouched default sends no selection at all", async () => {
  await render({ proveedores: V2 });
  const caja = container.querySelector('[data-testid="estancias-solicitud"]'); assert.ok(caja, "the selector appears when there is more than one thing to choose");
  assert.equal(container.querySelectorAll('[data-testid="estancias-solicitud"] input[type="checkbox"]').length, 3, "two stays + the services");
  await escribir("#sp-correos", "reservas@hotel.test");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.ok(G.__sp103.llamadas[0].startsWith("previa:") && !G.__sp103.llamadas[0].includes(":sel="), "default: everything, no selection sent");
  assert.equal(boton(/Enviar solicitud/)!.disabled, false);
  await marcar(/Hotel B/, false); await marcar(/Servicios/, false);
  assert.equal(container.querySelector('[data-testid="vista-previa-solicitud"]'), null, "changing the selection discards the previous preview");
  assert.equal(boton(/Enviar solicitud/)!.disabled, true, "a new preview is required");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.match(G.__sp103.llamadas.at(-1)!, /:sel=\{"estanciaIds":\[11\],"servicios":false\}$/);
  await act(async () => { boton(/Enviar solicitud/)!.click(); }); await tick();
  assert.match(G.__sp103.llamadas.at(-1)!, /^enviar:.*:sel=\{"estanciaIds":\[11\],"servicios":false\}$/);
  await marcar(/Hotel B/, true); await marcar(/Hotel A/, false);
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.match(G.__sp103.llamadas.at(-1)!, /:sel=\{"estanciaIds":\[12\],"servicios":false\}$/);
});

test("P12 a supplier with a single stay and no services shows no selector (nothing to choose)", async () => {
  await render({ proveedores: [{ proveedor: "Hotel Prueba", clase: "hotel" as const, servicios: 0, estancias: [{ id: 11, nombre: "Hotel A", ingreso: null, salida: null }] }] });
  assert.equal(container.querySelector('[data-testid="estancias-solicitud"]'), null);
});

// H103-13 — the optional note: typed in the panel, sent with the preview and with the send, and a change after the preview makes that preview STALE (send stays off until it is regenerated).
async function escribirTexto(sel: string, v: string) { const el = container.querySelector<HTMLTextAreaElement>(sel)!; await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); }
const notas = () => ((globalThis as unknown as { __sp103: { notas?: [string, unknown][] } }).__sp103.notas ??= []);

test("P13 optional note: empty by default (sent as empty), travels with the preview and the send, a change after the preview disables send until a new preview, and the structured form keeps working", async () => {
  notas().length = 0;
  await render();
  await escribir("#sp-correos", "reservas@hotel.test");
  const ta = container.querySelector<HTMLTextAreaElement>("#sp-mensaje")!;
  assert.ok(ta, "the field is there"); assert.equal(ta.value, "");
  assert.match(container.textContent ?? "", /no las reemplaza/, "says the note does not replace the tables");
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.equal(boton(/Enviar solicitud/)!.disabled, false);
  await escribirTexto("#sp-mensaje", "Llegamos tarde");
  assert.equal(boton(/Enviar solicitud/)!.disabled, true, "the preview no longer reflects the note → send is off");
  assert.match(container.querySelector('[role="note"]')?.textContent ?? "", /genera de nuevo la vista previa/);
  await act(async () => { boton(/Vista previa/)!.click(); }); await tick();
  assert.equal(boton(/Enviar solicitud/)!.disabled, false);
  assert.equal(container.querySelector('[data-testid="vista-previa-solicitud"]') != null, true, "the preview (hotel select, code radios) is not thrown away by typing");
  await act(async () => { boton(/Enviar solicitud/)!.click(); }); await tick();
  assert.deepEqual(notas(), [["previa", ""], ["previa", "Llegamos tarde"], ["enviar", "Llegamos tarde"]]);
});
