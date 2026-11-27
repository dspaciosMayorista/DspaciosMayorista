// #76 — pantallas REALES de «Referidos» (CRM), de los códigos por confirmar y de la tarjeta de aprobación B2B con el CANDIDATO de código, en jsdom, con las Server Actions simuladas.
// Se prueba lo que la persona vive: qué ve cada rol, que la tarifa SOLO se elige entre 1 % y 2 % (no hay campo libre), que cada acción lleva los ids/porcentaje correctos, los estados de elegibilidad
// con su texto, los totales SIN mezclar monedas, y que el código se envía al aprobar sin que el navegador mande identidad ni tarifa. Se ejecuta con npm run test:react:resto.
import { test, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "node:module";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/crm/referidos", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  HTMLSelectElement: dom.window.HTMLSelectElement, HTMLInputElement: dom.window.HTMLInputElement, MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, FormData: dom.window.FormData,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

// `next/navigation` no se resuelve en ESM plano: se sirve un módulo mínimo que lee un router falso de globalThis (mismo patrón que cuentaParcial62.react.ts; no se toca el cargador compartido).
(globalThis as unknown as { __routerFalso: unknown }).__routerFalso = { push() {}, replace() {}, refresh() {} };
register("data:text/javascript," + encodeURIComponent("export async function resolve(s, c, n) { if (s === 'next/navigation') return { url: 'data:text/javascript,' + encodeURIComponent('export function useRouter() { return globalThis.__routerFalso; }'), shortCircuit: true }; return n(s, c); }"));
type R = { ok: true; estado: string; aviso?: string } | { ok: false; error: string };
const llamadas: { fn: string; args: unknown[] }[] = [];
let respuesta: R = { ok: true, estado: "asignada" };
const reg = (fn: string) => async (...args: unknown[]) => { llamadas.push({ fn, args }); return respuesta; };
mock.module(new URL("../app/(crm)/crm/referidos/actions.ts", import.meta.url).href, {
  namedExports: { guardarReferidorAction: reg("guardarReferidor"), definirCodigoAction: reg("definirCodigo"), asignarReferidoAction: reg("asignar"), aplicarCodigoAction: reg("aplicarCodigo"), quitarReferidoAction: reg("quitar"), decidirCandidatoAction: reg("decidir") },
});
mock.module(new URL("../app/(dashboard)/dashboard/usuarios/b2b/actions.ts", import.meta.url).href, {
  namedExports: {
    aprobarSolicitudB2B: async (...args: unknown[]) => { llamadas.push({ fn: "aprobar", args }); return respuesta; },
    rechazarSolicitudB2B: async (...args: unknown[]) => { llamadas.push({ fn: "rechazar", args }); return { ok: true }; },
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ReferidosClient } = await import("../app/(crm)/crm/referidos/ReferidosClient.tsx");
const { SolicitudesClient } = await import("../app/(dashboard)/dashboard/usuarios/b2b/SolicitudesClient.tsx");
const { CandidatosReferido } = await import("../app/(crm)/crm/referidos/CandidatosReferido.tsx");
const { act, createElement: h } = React;

const referidores = [
  { id: 1, tenant: "mayorista", nombre: "Odair Referidor", tipo_documento: "CC", documento: "7001001", email: "odair@x.test", telefono: null, notas: null, activo: true, codigos: [{ codigo: "ODAIR-2", pct: 0.02, activo: true }], aliados_vigentes: 1 },
  { id: 2, tenant: "mayorista", nombre: "Inactivo Prueba", tipo_documento: null, documento: null, email: null, telefono: null, notas: null, activo: false, codigos: [], aliados_vigentes: 0 },
];
const asignaciones = [
  { id: 10, aliado_id: 9301, aliado_nombre: "Agencia Humo", referidor_id: 1, referidor_nombre: "Odair Referidor", tenant: "mayorista", pct: 0.02, origen: "manual", codigo: null, vigente_desde: "2026-11-20T15:00:00Z", vigente_hasta: null },
  { id: 9, aliado_id: 9301, aliado_nombre: "Agencia Humo", referidor_id: 2, referidor_nombre: "Inactivo Prueba", tenant: "mayorista", pct: 0.01, origen: "codigo", codigo: "VIEJO-1", vigente_desde: "2026-10-01T15:00:00Z", vigente_hasta: "2026-11-20T15:00:00Z" },
] as never[];
const contrato = (id: number, estado: string, moneda: string, comision: number | null, base: number | null = 1_000_000, neto = false) => ({
  id, numero_contrato: `DTM-${9000 + id}`, tenant: "mayorista", referidor_id: 1, referidor_nombre: "Odair Referidor", aliado_id: 9301, aliado_nombre: "Agencia Humo", pct: 0.02, origen: "manual", codigo: null,
  atribuido_en: "2026-11-21T10:00:00Z", moneda, base, comision, estado, hay_mas: false, neto, comision_aliado_id: base === null ? null : 700 + id,
});
const contratos = [contrato(1, "elegible", "COP", 20_000), contrato(2, "pendiente_pago", "COP", 30_000), contrato(3, "elegible", "USD", 500, 25_000), contrato(4, "pendiente_pago", "COP", 52_000, 2_600_000, true), contrato(5, "cancelado", "COP", 0), contrato(6, "sin_evidencia_base", "COP", null, null), contrato(7, "base_ambigua", "COP", null, null)] as never[];
const aliados = [{ id: 9301, nombre: "Agencia Humo", tipo: "agencia" }, { id: 9302, nombre: "Freelance Humo", tipo: "freelance" }];

let root: ReturnType<typeof createRoot> | undefined; let box: HTMLDivElement;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function montar(el: React.ReactElement) { box = document.createElement("div"); document.body.append(box); root = createRoot(box); await act(async () => { root!.render(el); await tick(); }); }
afterEach(async () => { if (root) await act(async () => root!.unmount()); box?.remove(); root = undefined; llamadas.length = 0; respuesta = { ok: true, estado: "asignada" }; });
after(() => dom.window.close());
const texto = () => (box.textContent ?? "").replace(/\s+/g, " ");
const poner = async (el: Element, v: string) => {
  const proto = el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); await tick(); });
};
const enviar = async (form: Element) => act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await tick(40); });
const etiqueta = (t: string) => [...box.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim().startsWith(t))?.querySelector("input,select,textarea") as HTMLInputElement | HTMLSelectElement | undefined;

test("lo que ve un rol que solo consulta: contratos y asignaciones, SIN formularios ni botones de cambio", async () => {
  await montar(h(ReferidosClient, { gestiona: false, referidores: referidores as never, asignaciones, contratos, aliados, hayMas: false, error: null }));
  const t = texto();
  assert.match(t, /Contratos con participación de referido/);
  assert.match(t, /Solo superadmin y gerencia pueden asignarlos o cambiarlos/);
  assert.equal(box.querySelectorAll("form").length, 0, "sin formularios");
  assert.ok(![...box.querySelectorAll("button")].some((b) => /Terminar asignación|Guardar|Asignar|Aplicar/.test(b.textContent ?? "")), "sin botones de gestión");
});

test("estados de elegibilidad con su texto; los totales NO mezclan monedas; el pagable solo cuenta contratos elegibles", async () => {
  await montar(h(ReferidosClient, { gestiona: false, referidores: referidores as never, asignaciones, contratos, aliados, hayMas: false, error: null }));
  const t = texto();
  assert.match(t, /Pagable/); assert.match(t, /Pendiente de pago del contrato/); assert.match(t, /Contrato cancelado/);
  assert.match(t, /NETO · base original/, "el contrato NETO se identifica y dice que su base es la original");
  assert.ok(!/pendiente de decisión/.test(t), "ya no hay NETO «pendiente de decisión»");
  assert.match(t, /Falta la base de la comisión del aliado/); assert.match(t, /Base ambigua/);
  assert.match(t, /Sin evidencia/, "sin evidencia se dice, no se muestra un cero");
  const totales = [...box.querySelectorAll("dl > div")].map((d) => (d.textContent ?? "").replace(/\s+/g, " "));
  assert.equal(totales.length, 2, "un total por moneda (COP y USD)");
  const cop = totales.find((x) => x.startsWith("COP"))!; const usd = totales.find((x) => x.startsWith("USD"))!;
  assert.match(cop, /20\.000/); assert.match(cop, /82\.000/, "pendiente = 30.000 + 52.000 (el NETO usa su base original); los «sin evidencia» no suman"); assert.ok(!/NaN|null/.test(cop)); assert.ok(!/500/.test(cop), "el USD no se suma al COP");
  assert.match(usd, /500/); assert.ok(!/20\.000|30\.000/.test(usd));
});

test("la lista muestra cada contrato dos veces (tabla de escritorio y fichas del celular) y el origen de la atribución", async () => {
  await montar(h(ReferidosClient, { gestiona: false, referidores: referidores as never, asignaciones, contratos: [{ ...contrato(1, "elegible", "COP", 20_000), origen: "codigo", codigo: "ODAIR-2" }] as never[], aliados, hayMas: true, error: null }));
  assert.equal(box.querySelectorAll("table tbody tr").length, 1); assert.equal(box.querySelectorAll("ul.md\\:hidden > li, ul[class*='md:hidden'] > li").length, 1);
  assert.match(texto(), /por código ODAIR-2/); assert.match(texto(), /hay más/);
});

test("quien gestiona: la tarifa SOLO se elige entre 1 % y 2 % (no hay campo numérico libre) y cada acción envía los ids y el porcentaje elegidos", async () => {
  await montar(h(ReferidosClient, { gestiona: true, referidores: referidores as never, asignaciones, contratos: [], aliados, hayMas: false, error: null }));
  const selPct = [...box.querySelectorAll("select[aria-label='Porcentaje']")] as HTMLSelectElement[];
  assert.ok(selPct.length >= 2, "los formularios de código y asignación llevan selector de porcentaje");
  for (const s of selPct) assert.deepEqual([...s.options].map((o) => o.textContent?.trim()), ["1 %", "2 %"], "solo 1 % y 2 %");
  assert.equal(box.querySelectorAll("input[type=number], input[name*=pct i], input[name*=porcentaje i]").length, 0, "ningún campo libre de porcentaje");
  const formAsignar = etiqueta("Agencia o freelance referido")!.closest("form")!;
  await poner(formAsignar.querySelectorAll("select")[0], "9302"); await poner(formAsignar.querySelectorAll("select")[1], "1"); await poner(formAsignar.querySelector("select[aria-label='Porcentaje']")!, "0.02");
  await enviar(formAsignar);
  const a = llamadas.find((c) => c.fn === "asignar")!;
  assert.deepEqual(a.args[0], { aliadoId: 9302, referidorId: 1, pct: "0.02", motivo: "" });
  assert.match(texto(), /Asignación creada/);
});

test("aplicar por código envía SOLO aliado y código (la identidad y la tarifa no viajan); un error de la base se muestra sin ocultarlo", async () => {
  await montar(h(ReferidosClient, { gestiona: true, referidores: referidores as never, asignaciones, contratos: [], aliados, hayMas: false, error: null }));
  const form = [...box.querySelectorAll("form")].find((f) => /Aplicar código/.test(f.textContent ?? ""))!;
  await poner(form.querySelector("select")!, "9301"); await poner(form.querySelector("input")!, "odair-2");
  respuesta = { ok: false, error: "El código de referido no es válido." };
  await enviar(form);
  const c = llamadas.find((x) => x.fn === "aplicarCodigo")!;
  assert.deepEqual(c.args[0], { aliadoId: 9301, codigo: "odair-2" }); assert.deepEqual(Object.keys(c.args[0] as object).sort(), ["aliadoId", "codigo"]);
  assert.match(texto(), /El código de referido no es válido/);
  assert.equal(box.querySelector("[role=status]")?.className.includes("red"), true);
});

test("terminar una asignación envía aliado y agencia; el historial se conserva a la vista", async () => {
  await montar(h(ReferidosClient, { gestiona: true, referidores: referidores as never, asignaciones, contratos: [], aliados, hayMas: false, error: null }));
  const btn = [...box.querySelectorAll("button")].find((b) => /Terminar asignación/.test(b.textContent ?? ""))!;
  await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(40); });
  assert.deepEqual(llamadas.find((c) => c.fn === "quitar")!.args[0], { aliadoId: 9301, tenant: "mayorista" });
  assert.match(texto(), /Historial de asignaciones \(1\)/);
});

const solPendiente = { id: 77, tipo: "agencia", nombre: "Agencia Nueva", nit: "9001", tipo_documento: "NIT", aliado_sugerido_id: null, contacto: null, email: "n@x.test", telefono: null, ciudad: null, notas: null, acepta_notificaciones: true, estado: "pendiente", revisado_por: null, created_at: "2026-11-24T10:00:00Z" };
const cand = (extra: Record<string, unknown> = {}) => ({
  solicitud_id: 77, nombre: "Agencia Nueva", tipo: "agencia", estado_solicitud: "pendiente", tenant: "mayorista", aliado_id: null, aliado_nombre: null, codigo: "ODAIR-2", referido_estado: "candidato", decidido_en: null,
  referidor_id: 1, referidor_nombre: "Odair Referidor", pct: 0.02, vigente_referidor: null, vigente_pct: null, ...extra,
});
const opciones = [{ id: 1, nombre: "Odair Referidor" }, { id: 3, nombre: "Otra Persona" }];
const clic = async (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(40); });
const boton = (t: string | RegExp) => [...box.querySelectorAll("button")].find((b) => (typeof t === "string" ? b.textContent === t : t.test(b.textContent ?? "")))!;

test("aprobación B2B: la tarjeta YA NO tiene campo de texto para el código; muestra el candidato resuelto y gerencia confirma lo que VIO (referidor + %), no una tarifa escrita", async () => {
  await montar(h(SolicitudesClient, { solicitudes: [solPendiente as never], aliados: [], candidatos: { 77: cand() as never }, referidores: opciones, gestionaReferidos: true }));
  assert.equal(box.querySelector("#cod-ref-77"), null, "ya no hay campo libre de código al aprobar");
  assert.equal(box.querySelectorAll("input[type=number]").length, 0);
  const t = texto();
  assert.match(t, /Código de referido escrito en el registro/); assert.match(t, /ODAIR-2/); assert.match(t, /Odair Referidor/); assert.match(t, /2 %/);
  assert.match(t, /Es un candidato: no se asigna hasta que superadmin o gerencia lo confirmen/);
  const radios = [...box.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
  assert.equal(radios.length, 4, "confirmar, otro, no asignar, decidir después");
  assert.equal(radios.find((r) => r.checked)?.parentElement?.textContent, "Confirmar: Odair Referidor · 2 %", "por defecto lo resuelto de la regla guardada");
  respuesta = { ok: true, estado: "x", aviso: "Registro aprobado y referido asignado para las compras futuras del aliado." };
  await clic(boton("Aprobar"));
  assert.deepEqual(llamadas.find((c) => c.fn === "aprobar")!.args, [77, "nueva", { decision: "confirmar_codigo", referidorId: 1, pct: 0.02 }]);
  assert.match(texto(), /Registro aprobado y referido asignado para las compras futuras del aliado/);
});

test("aprobación B2B: «asignar otro» solo ofrece 1 % y 2 %; «decidir después» y administración NO envían decisión", async () => {
  await montar(h(SolicitudesClient, { solicitudes: [solPendiente as never], aliados: [], candidatos: { 77: cand() as never }, referidores: opciones, gestionaReferidos: true }));
  const radios = () => [...box.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
  await clic(radios()[1]);   // otro
  const sels = [...box.querySelectorAll("fieldset select")] as HTMLSelectElement[];
  assert.deepEqual([...sels[1].options].map((o) => o.textContent), ["1 %", "2 %"]);
  await poner(sels[0], "3"); await poner(sels[1], "0.02");
  await clic(boton("Aprobar"));
  assert.deepEqual(llamadas.find((c) => c.fn === "aprobar")!.args[2], { decision: "asignar_otro", referidorId: 3, pct: 0.02 });
  llamadas.length = 0;
  await clic(radios()[3]);   // decidir después
  await clic(boton("Aprobar"));
  assert.equal(llamadas.find((c) => c.fn === "aprobar")!.args[2], undefined, "decidir después: nada que confirmar");
  llamadas.length = 0;
  // Administración: ve el candidato, SIN controles, y aprueba sin decisión.
  await act(async () => root!.unmount());
  await montar(h(SolicitudesClient, { solicitudes: [solPendiente as never], aliados: [], candidatos: { 77: cand() as never }, referidores: [], gestionaReferidos: false }));
  assert.equal(box.querySelectorAll("input[type=radio]").length, 0); assert.match(texto(), /Solo superadmin o gerencia confirman el referido y el porcentaje/);
  await clic(boton("Aprobar"));
  assert.equal(llamadas.find((c) => c.fn === "aprobar")!.args[2], undefined, "administración nunca manda una decisión");
});

test("un código que NO corresponde a ningún referidor: se dice, no se ofrece confirmar y no se inventa nada", async () => {
  await montar(h(SolicitudesClient, { solicitudes: [solPendiente as never], aliados: [], candidatos: { 77: cand({ referidor_id: null, referidor_nombre: null, pct: null }) as never }, referidores: opciones, gestionaReferidos: true }));
  assert.match(texto(), /no corresponde hoy a un referidor activo de esta agencia/);
  const radios = [...box.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
  assert.equal(radios.length, 3, "sin la opción de confirmar");
  assert.equal(radios.find((r) => r.checked)?.parentElement?.textContent, "Decidir después (queda por confirmar en CRM → Referidos)");
  await clic(boton("Aprobar"));
  assert.equal(llamadas.find((c) => c.fn === "aprobar")!.args[2], undefined);
});

test("registro YA aprobado con código por confirmar: «Aplicar decisión» usa la acción del CRM; sin ficha enlazada no se puede", async () => {
  const aprobada = { ...solPendiente, estado: "aprobada" };
  await montar(h(SolicitudesClient, { solicitudes: [aprobada as never], aliados: [], candidatos: { 77: cand({ estado_solicitud: "aprobada", aliado_id: 9301 }) as never }, referidores: opciones, gestionaReferidos: true }));
  respuesta = { ok: true, estado: "asignada" };
  await clic(boton("Aplicar decisión"));
  const c = llamadas.find((x) => x.fn === "decidir")!;
  assert.deepEqual(c.args[0], { solicitudId: 77, decision: { decision: "confirmar_codigo", referidorId: 1, pct: 0.02 } });
  await act(async () => root!.unmount());
  await montar(h(SolicitudesClient, { solicitudes: [aprobada as never], aliados: [], candidatos: { 77: cand({ estado_solicitud: "aprobada", aliado_id: null }) as never }, referidores: opciones, gestionaReferidos: true }));
  assert.match(texto(), /se aprobó sin enlazar una ficha de aliado/);
  assert.equal((boton("Aplicar decisión") as HTMLButtonElement).disabled, true);
});

test("CRM → Referidos: los códigos por confirmar los ve administración SIN controles; gerencia decide solo si el registro está aprobado y enlazado", async () => {
  const lista = [cand({ estado_solicitud: "aprobada", aliado_id: 9301, aliado_nombre: "Agencia Humo" }), cand({ solicitud_id: 78, nombre: "Otra Pendiente", estado_solicitud: "pendiente", codigo: "ZZZZ-1", referidor_id: null, referidor_nombre: null, pct: null })];
  await montar(h(CandidatosReferido, { candidatos: lista as never, referidores: opciones, gestiona: false }));
  assert.match(texto(), /Administración puede ver esta información, pero no asignar ni cambiar referidores ni porcentajes/);
  assert.equal(box.querySelectorAll("input[type=radio]").length, 0); assert.equal([...box.querySelectorAll("button")].filter((b) => /Aplicar decisión/.test(b.textContent ?? "")).length, 0);
  await act(async () => root!.unmount());
  await montar(h(CandidatosReferido, { candidatos: lista as never, referidores: opciones, gestiona: true }));
  assert.equal([...box.querySelectorAll("button")].filter((b) => /Aplicar decisión/.test(b.textContent ?? "")).length, 1, "solo el aprobado y enlazado se puede decidir");
  assert.match(texto(), /Decide al aprobar el registro/);
  respuesta = { ok: true, estado: "asignada" };
  await clic(boton("Aplicar decisión"));
  assert.deepEqual(llamadas.find((x) => x.fn === "decidir")!.args[0], { solicitudId: 77, decision: { decision: "confirmar_codigo", referidorId: 1, pct: 0.02 } });
  assert.match(texto(), /Decisión aplicada\. Rige solo para las compras futuras del aliado/);
});
