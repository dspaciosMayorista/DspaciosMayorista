// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #50 (U1) — Interfaz de la modalidad PVP/NETO al elegir una opción B2B (SelectorOpciones) y al confirmar una
// solicitud (PanelSolicitudes):
//   · el selector solo aparece cuando el servidor dice que la comparativa lo pide (B2B con aliado);
//   · PVP: envía la modalidad; NETO: exige decidir el recobro, muestra la cuenta (base, ordinaria, participación,
//     descuento, NETO, margen) y bloquea con el MISMO orden de decisiones que la base;
//   · la casilla de autorizar margen solo la ofrece quien puede autorizarlo; `venta` no puede fijar NETO;
//   · sin contexto (no B2B / error) todo queda como antes: ninguna modalidad en la llamada.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos(`
    export async function elegirOpcionComparativa(x) { globalThis.__neto.llamadas.push(['elegir', x]); return globalThis.__neto.respElegir(x); }
    export async function solicitarOpcionComparativa(x) { globalThis.__neto.llamadas.push(['solicitar', x]); return { ok: true, actualizada: false }; }
    export async function resumenOpcionComparativa() { return { ok: false, error: 'x' }; }
  `),
  "@/app/(dashboard)/dashboard/cotizaciones/manual-actions": datos(`
    export async function resolverSolicitudComparativa(...a) { globalThis.__neto.llamadas.push(['resolver', a]); return globalThis.__neto.respResolver(a); }
  `),
  "@/app/(dashboard)/dashboard/cotizaciones/pagos-actions": datos(`
    export async function contextoModalidadNeto(x) { globalThis.__neto.llamadas.push(['ctx', x]); return globalThis.__neto.respCtx(x); }
  `),
  "next/navigation": datos("export function useRouter() { return { refresh() { globalThis.__neto.refrescos++; }, push() {}, replace() {} }; }"),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/cot/x" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type Llamada = [string, unknown];
const vista = (over: Record<string, unknown> = {}) => ({
  reconoce: true, hayDescuento: true, pvp: 600_000, neto: 530_000, descuento: 70_000, base: 500_000, ordinaria: 60_000,
  participacion: 10_000, costos: 450_000, margen: 0.1509, pisoPct: 6, soloTiquetes: false, cumple: true, bajoCosto: false,
  costoCero: false, ...over,
});
const claves = ["A/doble", "A/sencilla", "B/doble"];
const ctxBase = (over: Record<string, unknown> = {}, v: Record<string, unknown> = {}) => ({
  permite: true, puedeNeto: true, puedeAutorizar6: true, puedeAutorizar2: false,
  vista: Object.fromEntries(claves.map((k) => [k, { moneda: "COP", conReconoce: vista(v), sinReconoce: vista({ reconoce: false, participacion: 0, descuento: 60_000, neto: 540_000, ...v }) }])),
  ...over,
});
const neto = {
  llamadas: [] as Llamada[], refrescos: 0,
  respCtx: (): unknown => ({ permite: false }),
  respElegir: (): unknown => ({ ok: true, hijaId: 9, codigo: "C-0009", url: "" }),
  respResolver: (): unknown => ({ ok: true, hijaId: 9 }),
};
(globalThis as unknown as { __neto: typeof neto }).__neto = neto;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { SelectorOpciones, PanelSolicitudes } = await import("../lib/cotizacion/comparativaAcciones.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  neto.llamadas.length = 0; neto.refrescos = 0;
  neto.respCtx = () => ({ permite: false });
  neto.respElegir = () => ({ ok: true, hijaId: 9, codigo: "C-0009", url: "" });
  neto.respResolver = () => ({ ok: true, hijaId: 9 });
});
after(() => dom.window.close());

const esperar = async () => { for (let i = 0; i < 4; i++) await React.act(async () => { await new Promise((r) => setTimeout(r, 15)); }); };
async function montar(elemento: unknown) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(elemento as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  await esperar(); // el contexto llega por un import perezoso
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
const radio = (raiz: Element, texto: RegExp) => {
  const l = [...raiz.querySelectorAll("label")].find((x) => texto.test(x.textContent ?? ""));
  return l?.querySelector("input") as HTMLInputElement | null | undefined;
};
const marcar = async (el: HTMLInputElement) => { await React.act(async () => { el.click(); await new Promise((r) => setImmediate(r)); }); };

const GRUPOS = [
  { opcionRef: "A", etiqueta: "Hotel Almirante", moneda: "COP", acomodaciones: [
    { opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel Almirante", moneda: "COP", tarifaPersona: 300_000, total: 600_000, orden: 0 },
  ] },
  { opcionRef: "B", etiqueta: "Hotel Caribe", moneda: "COP", acomodaciones: [
    { opcionRef: "B", acomodacionRef: "doble", etiqueta: "Hotel Caribe", moneda: "COP", tarifaPersona: 250_000, total: 500_000, orden: 1 },
  ] },
];
const TOKEN = "11111111-2222-3333-4444-555555555555";
const base = { version: 1, token: TOKEN, grupos: GRUPOS, resumenes: {}, deshabilitada: false, elegida: null, modo: "interno" as const };
const enviarElegir = (raiz: Element) => boton(raiz, /Elegir esta opción/);
const elegirLlamadas = () => neto.llamadas.filter((l) => l[0] === "elegir").map((l) => l[1] as Record<string, unknown>);

test("el selector de modalidad aparece solo cuando el servidor lo pide (B2B con aliado)", async () => {
  const raiz = await montar(h(SelectorOpciones, base));
  assert.equal(raiz.querySelector("fieldset"), null, "sin contexto: nada nuevo");
  assert.ok(neto.llamadas.some((l) => l[0] === "ctx" && (l[1] as { token: string }).token === TOKEN), "pidió el contexto con el token del enlace");
  assert.equal(enviarElegir(raiz)?.disabled, false);
  await desmontar!(); desmontar = undefined;
  neto.respCtx = () => ctxBase();
  const raiz2 = await montar(h(SelectorOpciones, base));
  assert.ok(raiz2.querySelector("fieldset"), "con contexto B2B: aparece");
  assert.ok(radio(raiz2, /PVP/) && radio(raiz2, /NETO/));
  assert.equal(enviarElegir(raiz2)?.disabled, true, "hay que elegir antes de enviar");
  assert.match(raiz2.textContent ?? "", /Precio de la venta B2B/);
});

test("fuera del modo interno no se pide el contexto ni aparece el selector", async () => {
  neto.respCtx = () => ctxBase();
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "solicitud" as const }));
  assert.equal(neto.llamadas.filter((l) => l[0] === "ctx").length, 0);
  assert.equal(raiz.querySelector("fieldset"), null);
});

test("sin contexto (no es B2B o falló): elegir manda lo de siempre, sin modalidad", async () => {
  const raiz = await montar(h(SelectorOpciones, base));
  await pulsar(enviarElegir(raiz)!);
  const [e] = elegirLlamadas();
  assert.ok(e, "elige");
  assert.ok(!("modalidad" in e) && !("reconoceRecobro" in e) && !("autorizarMargen" in e), JSON.stringify(e));
});

test("elegir con modalidad PVP envía la modalidad, sin recobro ni autorización", async () => {
  neto.respCtx = () => ctxBase();
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /PVP/)!);
  assert.equal(enviarElegir(raiz)?.disabled, false);
  await pulsar(enviarElegir(raiz)!);
  const [e] = elegirLlamadas();
  assert.equal(e.modalidad, "pvp"); assert.equal(e.reconoceRecobro, null); assert.equal(e.autorizarMargen, false);
  assert.equal(e.opcionRef, "A"); assert.equal(e.token, TOKEN); assert.equal(typeof e.clave, "string");
  assert.equal(neto.refrescos, 1);
});

test("elegir con modalidad NETO: exige decidir el recobro, muestra la cuenta y envía la respuesta", async () => {
  neto.respCtx = () => ctxBase();
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /NETO/)!);
  assert.equal(enviarElegir(raiz)?.disabled, true, "falta decidir el recobro");
  assert.match(raiz.textContent ?? "", /¿Se reconoce la participación del aliado en el recobro\?/);
  await marcar(radio(raiz, /Sí: el recobro/)!);
  const t = raiz.textContent ?? "";
  assert.match(t, /Comisión ordinaria/); assert.match(t, /Participación en el recobro/); assert.match(t, /Descuento total/);
  assert.match(t, /Total NETO/); assert.ok(t.includes(new Intl.NumberFormat("es-CO").format(530_000)), "NETO de la opción");
  assert.match(t, /15,09 %/);
  assert.equal(enviarElegir(raiz)?.disabled, false);
  await pulsar(enviarElegir(raiz)!);
  const [e] = elegirLlamadas();
  assert.equal(e.modalidad, "neto"); assert.equal(e.reconoceRecobro, true); assert.equal(e.autorizarMargen, false);
});

test("NETO sin reconocer la participación usa la vista «sin reconocer»", async () => {
  neto.respCtx = () => ctxBase();
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /NETO/)!);
  await marcar(radio(raiz, /No: el recobro entra/)!);
  assert.ok((raiz.textContent ?? "").includes(new Intl.NumberFormat("es-CO").format(540_000)), "NETO sin reconocer");
  await pulsar(enviarElegir(raiz)!);
  assert.equal(elegirLlamadas()[0].reconoceRecobro, false);
});

test("el selector bloquea con el mismo orden que la base: descuento 0, costo 0, bajo el costo", async () => {
  for (const [v, texto] of [
    [{ hayDescuento: false, descuento: 0 }, /Con descuento 0 no hay precio NETO/],
    [{ costoCero: true, cumple: false }, /costo total es 0/],
    [{ bajoCosto: true, cumple: false }, /por debajo del costo total/],
  ] as const) {
    neto.respCtx = () => ctxBase({}, v);
    const raiz = await montar(h(SelectorOpciones, base));
    await marcar(radio(raiz, /NETO/)!);
    await marcar(radio(raiz, /Sí: el recobro/)!);
    assert.equal(enviarElegir(raiz)?.disabled, true, String(texto));
    assert.match(raiz.textContent ?? "", texto);
    assert.equal(neto.llamadas.filter((l) => l[0] === "elegir").length, 0);
    await desmontar!(); desmontar = undefined; neto.llamadas.length = 0;
  }
});

test("margen bajo: pide autorización a quien puede darla; con la casilla marcada se envía", async () => {
  neto.respCtx = () => ctxBase({}, { cumple: false, margen: 0.0565 });
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /NETO/)!);
  await marcar(radio(raiz, /Sí: el recobro/)!);
  assert.equal(enviarElegir(raiz)?.disabled, true);
  assert.match(raiz.textContent ?? "", /marca la autorización para continuar/);
  assert.match(raiz.textContent ?? "", /5,65 %/);
  await marcar(radio(raiz, /Autorizo un margen/)!);
  assert.equal(enviarElegir(raiz)?.disabled, false);
  await pulsar(enviarElegir(raiz)!);
  assert.equal(elegirLlamadas()[0].autorizarMargen, true);
});

test("margen bajo: un rol que no puede autorizar no ve la casilla y queda bloqueado con el nombre de quien sí", async () => {
  neto.respCtx = () => ctxBase({ puedeAutorizar6: false }, { cumple: false, margen: 0.0565 });
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /NETO/)!);
  await marcar(radio(raiz, /Sí: el recobro/)!);
  assert.equal(radio(raiz, /Autorizo un margen/), undefined, "sin casilla");
  assert.equal(enviarElegir(raiz)?.disabled, true);
  assert.match(raiz.textContent ?? "", /lo autoriza superadmin o administración/);
});

test("solo tiquetes: el 2 % lo autoriza solo superadmin", async () => {
  neto.respCtx = () => ctxBase({ puedeAutorizar6: true, puedeAutorizar2: false }, { cumple: false, soloTiquetes: true, pisoPct: 2, margen: 0.0199 });
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /NETO/)!);
  await marcar(radio(raiz, /Sí: el recobro/)!);
  assert.equal(enviarElegir(raiz)?.disabled, true);
  assert.match(raiz.textContent ?? "", /mínimo del 2 %; lo autoriza superadmin\./);
});

test("venta no puede fijar NETO: el botón NETO está deshabilitado y PVP sí se envía", async () => {
  neto.respCtx = () => ctxBase({ puedeNeto: false, puedeAutorizar6: false });
  const raiz = await montar(h(SelectorOpciones, base));
  assert.equal(radio(raiz, /NETO/)?.disabled, true);
  assert.match(raiz.textContent ?? "", /lo fija gerencia, administración, operaciones o superadmin/);
  await marcar(radio(raiz, /PVP/)!);
  await pulsar(enviarElegir(raiz)!);
  assert.equal(elegirLlamadas()[0].modalidad, "pvp");
});

test("un rechazo de la base se muestra y no refresca; cambiar la modalidad renueva la clave", async () => {
  neto.respCtx = () => ctxBase();
  neto.respElegir = () => ({ ok: false, error: "El total NETO no cubre el margen mínimo.", reintentable: false });
  const raiz = await montar(h(SelectorOpciones, base));
  await marcar(radio(raiz, /PVP/)!);
  await pulsar(enviarElegir(raiz)!);
  const k1 = elegirLlamadas()[0].clave;
  assert.match(raiz.textContent ?? "", /no cubre el margen mínimo/);
  assert.equal(neto.refrescos, 0);
  await marcar(radio(raiz, /NETO/)!);
  await marcar(radio(raiz, /Sí: el recobro/)!);
  await pulsar(enviarElegir(raiz)!);
  assert.notEqual(elegirLlamadas()[1].clave, k1, "otra modalidad = otra intención = otra clave");
});

const SOLICITUDES = [{ id: 7, estado: "pendiente", opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel Almirante", nombre: "Ana",
  telefono: "3101112233", email: null, nota: null, creada: "hoy", vencida: false }];

test("el panel de solicitudes: confirmar con NETO manda la modalidad como 5.º argumento; rechazar no", async () => {
  neto.respCtx = () => ctxBase();
  const raiz = await montar(h(PanelSolicitudes, { solicitudes: SOLICITUDES, puedeResolver: true, hayElegida: false }));
  assert.ok(neto.llamadas.some((l) => l[0] === "ctx" && (l[1] as { solicitudId: number }).solicitudId === 7), "el contexto sale de la solicitud");
  assert.equal(boton(raiz, /Confirmar y crear la cotización/)?.disabled, true, "hay que elegir la modalidad");
  await marcar(radio(raiz, /NETO/)!);
  await marcar(radio(raiz, /Sí: el recobro/)!);
  assert.match(raiz.textContent ?? "", /Total NETO/);
  await pulsar(boton(raiz, /Confirmar y crear la cotización/)!);
  const [r] = neto.llamadas.filter((l) => l[0] === "resolver").map((l) => l[1] as unknown[]);
  assert.equal(r[0], 7); assert.equal(r[1], "confirmar");
  assert.deepEqual(r[4], { modalidad: "neto", reconoceRecobro: true, autorizarMargen: false });
  neto.llamadas.length = 0;
  await pulsar(boton(raiz, /Rechazar/)!);
  const [x] = neto.llamadas.filter((l) => l[0] === "resolver").map((l) => l[1] as unknown[]);
  assert.equal(x[1], "rechazar"); assert.equal(x[4], undefined, "rechazar no lleva modalidad");
});

test("el panel de solicitudes sin contexto B2B confirma como siempre (sin quinto argumento)", async () => {
  const raiz = await montar(h(PanelSolicitudes, { solicitudes: SOLICITUDES, puedeResolver: true, hayElegida: false }));
  await pulsar(boton(raiz, /Confirmar y crear la cotización/)!);
  const [r] = neto.llamadas.filter((l) => l[0] === "resolver").map((l) => l[1] as unknown[]);
  assert.equal(r[4], undefined);
});
