// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #35 — Interfaz REAL de una comparativa (`SelectorOpciones`, `PanelSolicitudes`):
//   · importes POR OPCIÓN y por acomodación; el selector de acomodación cambia el total y la tarifa por persona;
//   · jamás un total global ni un «$0» ficticio;
//   · cada modo hace SOLO lo suyo: checkout enlaza (no escribe), solicitud registra una solicitud,
//     interno elige con clave de idempotencia; el token no aparece en ninguna escritura;
//   · deshabilitada / ya elegida: no hay acciones;
//   · el panel de solicitudes no ofrece confirmar si ya hay opción elegida o la solicitud venció.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos(`
    export async function elegirOpcionComparativa(x) { globalThis.__cmp.llamadas.push(['elegir', x]); return globalThis.__cmp.respElegir(x); }
    export async function solicitarOpcionComparativa(x) { globalThis.__cmp.llamadas.push(['solicitar', x]); return globalThis.__cmp.respSolicitar(x); }
    export async function resumenOpcionComparativa(...a) { globalThis.__cmp.llamadas.push(['resumen', a]); return globalThis.__cmp.respResumen(a); }
  `),
  "@/app/(dashboard)/dashboard/cotizaciones/manual-actions": datos(`
    export async function resolverSolicitudComparativa(...a) { globalThis.__cmp.llamadas.push(['resolver', a]); return globalThis.__cmp.respResolver(a); }
  `),
  "next/navigation": datos("export function useRouter() { return { refresh() { globalThis.__cmp.refrescos++; }, push() {}, replace() {} }; }"),
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
const initialResumen = (): unknown => ({ ok: true, datos: { version: 1, tipo: "comparativa_carrito", opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel Almirante", total: 685000, moneda: "COP", tarifaPersona: 300000, destino: "CARTAGENA", fechaSalida: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, vigenciaHasta: "2099-01-01", vencida: false } });
const cmp = {
  llamadas: [] as Llamada[], refrescos: 0,
  respElegir: (): unknown => ({ ok: true, hijaId: 9, codigo: "C-0009", url: "" }),
  respSolicitar: (): unknown => ({ ok: true, actualizada: false }),
  respResolver: (): unknown => ({ ok: true, hijaId: 9 }),
  respResumen: initialResumen,
};
(globalThis as unknown as { __cmp: typeof cmp }).__cmp = cmp;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { SelectorOpciones, PanelSolicitudes } = await import("../lib/cotizacion/comparativaAcciones.tsx");
const { ContinuarComparativa } = await import("../lib/cotizacion/comparativaCheckout.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  cmp.llamadas.length = 0; cmp.refrescos = 0;
  cmp.respElegir = () => ({ ok: true, hijaId: 9, codigo: "C-0009", url: "" });
  cmp.respSolicitar = () => ({ ok: true, actualizada: false });
  cmp.respResolver = () => ({ ok: true, hijaId: 9 });
  cmp.respResumen = initialResumen;
});
after(() => dom.window.close());

async function montar(elemento: unknown) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(elemento as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
async function escribir(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, valor: string) {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  await React.act(async () => { el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

const GRUPOS = [
  { opcionRef: "A", etiqueta: "Hotel Almirante", moneda: "COP", acomodaciones: [
    { opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel Almirante", moneda: "COP", tarifaPersona: 300_000, total: 600_000, orden: 0 },
    { opcionRef: "A", acomodacionRef: "sencilla", etiqueta: "Hotel Almirante", moneda: "COP", tarifaPersona: 450_000, total: 900_000, orden: 1 },
  ] },
  { opcionRef: "B", etiqueta: "Hotel Caribe", moneda: "COP", acomodaciones: [
    { opcionRef: "B", acomodacionRef: "doble", etiqueta: "Hotel Caribe", moneda: "COP", tarifaPersona: 250_000, total: 500_000, orden: 2 },
  ] },
];
const RES = { "A/doble": { plan: "Estándar · PAM", servicios: [{ nombre: "City tour" }] }, "B/doble": { plan: "Estándar · PAM" } };
const TOKEN = "11111111-2222-3333-4444-555555555555";
const base = { version: 1, token: TOKEN, grupos: GRUPOS, resumenes: RES, deshabilitada: false, elegida: null };
const numero = (n: number) => new Intl.NumberFormat("es-CO").format(n);

test("muestra el total de CADA hotel y el de su acomodación; no hay total global ni $0", async () => {
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "solo_lectura" }));
  const t = raiz.textContent ?? "";
  assert.ok(t.includes(numero(600_000)) && t.includes(numero(500_000)), "totales por hotel");
  assert.ok(!t.includes(numero(1_100_000)) && !t.includes(numero(1_500_000)) && !t.includes(numero(2_000_000)), "ninguna suma de hoteles");
  assert.doesNotMatch(t, /total (global|general|de la cotización)|suma de/i);
  assert.doesNotMatch(t, /\$\s?0(?![.,\d])/, "jamás un $0 ficticio");
  assert.match(t, /Opción A/); assert.match(t, /Opción B/);
  assert.equal(raiz.querySelectorAll("button").length, 0, "solo lectura: no hay botones de acción");
});

test("el selector de acomodación cambia la tarifa por persona y el total de ESE hotel", async () => {
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "solo_lectura" }));
  const sel = raiz.querySelector<HTMLSelectElement>("#acom-A")!;
  assert.deepEqual([...sel.options].map((o) => o.value), ["doble", "sencilla"]);
  assert.ok((raiz.textContent ?? "").includes(numero(300_000)));
  await escribir(sel, "sencilla");
  const t = raiz.textContent ?? "";
  assert.ok(t.includes(numero(450_000)) && t.includes(numero(900_000)), "tarifa por persona y total de la sencilla");
  assert.equal(raiz.querySelector("#acom-B"), null, "un hotel con una sola acomodación no muestra selector");
});

test("modo checkout: ENLAZA al checkout con el token como localizador y no ejecuta ninguna escritura", async () => {
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "checkout" }));
  const enlaces = [...raiz.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.equal(enlaces.length, 2);
  assert.ok(enlaces.includes("/tarifario/checkout?comparativa=11111111-2222-3333-4444-555555555555&op=A&ac=doble"));
  assert.equal(raiz.querySelectorAll("button").length, 0);
  assert.deepEqual(cmp.llamadas, []);
  const sel = raiz.querySelector<HTMLSelectElement>("#acom-A")!;
  await escribir(sel, "sencilla");
  assert.ok([...raiz.querySelectorAll("a")].some((a) => a.getAttribute("href")?.endsWith("&op=A&ac=sencilla")), "el enlace sigue a la acomodación elegida");
  assert.deepEqual(cmp.llamadas, [], "elegir una acomodación en pantalla no escribe nada");
});

test("modo solicitud: abre el formulario, registra UNA solicitud ligada al enlace y sin usuario", async () => {
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "solicitud" }));
  await pulsar(boton(raiz, /Solicitar esta opción/)!);
  await escribir(raiz.querySelector<HTMLInputElement>('input[aria-label="Tu nombre"]')!, "Beto Ruiz");
  await escribir(raiz.querySelector<HTMLInputElement>('input[aria-label="Teléfono"]')!, "3109998877");
  await pulsar(boton(raiz, /Enviar solicitud/)!);
  assert.equal(cmp.llamadas.length, 1);
  const [nombre, arg] = cmp.llamadas[0] as [string, Record<string, unknown>];
  assert.equal(nombre, "solicitar");
  assert.equal(arg.token, TOKEN); assert.ok(!("madreId" in arg), "no viaja ningún id numérico"); assert.equal(arg.opcionRef, "A"); assert.equal(arg.acomodacionRef, "doble"); assert.equal(arg.version, 1);
  assert.deepEqual(arg.contacto, { nombre: "Beto Ruiz", telefono: "3109998877", email: "", nota: "" });
  assert.ok(typeof arg.clave === "string" && (arg.clave as string).length >= 8, "lleva clave de idempotencia");
  assert.ok(!JSON.stringify(arg).includes("userId") && !("canal" in arg), "ni usuario ni canal viajan desde la pantalla");
  assert.match(raiz.querySelector('[role="status"]')?.textContent ?? "", /Recibimos tu solicitud/);
});

test("modo solicitud: un error de la base se muestra neutro y la clave se renueva para reintentar", async () => {
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "solicitud" }));
  cmp.respSolicitar = () => ({ ok: false, error: "No pudimos registrar tu solicitud ahora. Inténtalo más tarde o contacta a tu asesor." });
  await pulsar(boton(raiz, /Solicitar esta opción/)!);
  await escribir(raiz.querySelector<HTMLInputElement>('input[aria-label="Tu nombre"]')!, "Beto Ruiz");
  await escribir(raiz.querySelector<HTMLInputElement>('input[aria-label="Teléfono"]')!, "3109998877");
  await pulsar(boton(raiz, /Enviar solicitud/)!);
  assert.match(raiz.querySelector('[role="alert"]')?.textContent ?? "", /más tarde/);
  await pulsar(boton(raiz, /Enviar solicitud/)!);
  const claves = cmp.llamadas.map((l) => (l[1] as { clave: string }).clave);
  assert.equal(claves.length, 2); assert.notEqual(claves[0], claves[1]);
});

test("modo interno: elige con clave de idempotencia, sin datos del cliente, y refresca", async () => {
  const raiz = await montar(h(SelectorOpciones, { ...base, modo: "interno" }));
  await escribir(raiz.querySelector<HTMLSelectElement>("#acom-A")!, "sencilla");
  await pulsar([...raiz.querySelectorAll("button")].filter((b) => /Elegir esta opción/.test(b.textContent ?? ""))[0]);
  assert.equal(cmp.llamadas.length, 1);
  const [n, arg] = cmp.llamadas[0] as [string, Record<string, unknown>];
  assert.equal(n, "elegir");
  assert.deepEqual({ ...arg, clave: "x" }, { token: TOKEN, opcionRef: "A", acomodacionRef: "sencilla", version: 1, clave: "x", cliente: null });
  assert.equal(cmp.refrescos, 1);
});

test("deshabilitada o ya elegida: no hay ninguna acción y se explica por qué", async () => {
  const r1 = await montar(h(SelectorOpciones, { ...base, modo: "interno", deshabilitada: true, motivoDeshabilitada: "Esta comparativa venció." }));
  assert.equal(r1.querySelectorAll("button").length, 0);
  assert.match(r1.textContent ?? "", /venció/);
  await desmontar!(); desmontar = undefined;
  const r2 = await montar(h(SelectorOpciones, { ...base, modo: "checkout", deshabilitada: true, elegida: { codigo: "C-0009", opcionRef: "B", acomodacionRef: "doble" } }));
  assert.equal(r2.querySelectorAll("a").length, 0);
  assert.match(r2.textContent ?? "", /Ya hay una opción elegida \(B/);
  assert.match(r2.textContent ?? "", /C-0009/);
});

const SOL = (o: Record<string, unknown>) => ({ id: 1, estado: "pendiente", opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel Almirante", nombre: "Beto Ruiz", telefono: "3109998877", email: null, nota: null, creada: "15 de octubre de 2026", vencida: false, ...o });

test("panel de solicitudes: confirmar usa clave estable y refresca; no ofrece confirmar si ya hay opción elegida o venció", async () => {
  const raiz = await montar(h(PanelSolicitudes, { solicitudes: [SOL({}), SOL({ id: 2, nombre: "Vieja", vencida: true })], puedeResolver: true, hayElegida: false }));
  const confirmar = [...raiz.querySelectorAll("button")].filter((b) => /Confirmar y crear la cotización/.test(b.textContent ?? ""));
  assert.equal(confirmar.length, 1, "la solicitud vencida no se puede confirmar");
  await pulsar(confirmar[0]);
  assert.equal(cmp.llamadas.length, 1);
  const [n, args] = cmp.llamadas[0] as [string, unknown[]];
  assert.equal(n, "resolver"); assert.equal(args[0], 1); assert.equal(args[1], "confirmar");
  assert.ok(typeof args[3] === "string" && (args[3] as string).length >= 8);
  assert.equal(cmp.refrescos, 1);
  await desmontar!(); desmontar = undefined;
  const r2 = await montar(h(PanelSolicitudes, { solicitudes: [SOL({})], puedeResolver: true, hayElegida: true }));
  assert.equal([...r2.querySelectorAll("button")].filter((b) => /Confirmar/.test(b.textContent ?? "")).length, 0);
  assert.ok([...r2.querySelectorAll("button")].some((b) => /Rechazar/.test(b.textContent ?? "")), "rechazar sigue disponible");
});

test("panel de solicitudes: varias personas coexisten y se listan todas; sin permiso no hay botones", async () => {
  const raiz = await montar(h(PanelSolicitudes, { solicitudes: [SOL({ id: 1 }), SOL({ id: 2, nombre: "Ana Dos", opcionRef: "B", etiqueta: "Hotel Caribe" }), SOL({ id: 3, estado: "superada", nombre: "Tres" })], puedeResolver: false, hayElegida: false }));
  const t = raiz.textContent ?? "";
  assert.ok(t.includes("Beto Ruiz") && t.includes("Ana Dos") && t.includes("Tres"));
  assert.match(t, /2 pendientes/);
  assert.equal(raiz.querySelectorAll("button").length, 0);
});

test("panel de solicitudes: rechazar manda el motivo; un error de la base se muestra y la clave se descarta", async () => {
  const raiz = await montar(h(PanelSolicitudes, { solicitudes: [SOL({})], puedeResolver: true, hayElegida: false }));
  await escribir(raiz.querySelector<HTMLInputElement>('input[aria-label="Motivo del rechazo"]')!, "spam");
  cmp.respResolver = () => ({ ok: false, error: "Esta comparativa ya no está disponible." });
  await pulsar(boton(raiz, /Rechazar/)!);
  const [, args] = cmp.llamadas[0] as [string, unknown[]];
  assert.equal(args[1], "rechazar"); assert.equal(args[2], "spam");
  assert.match(raiz.querySelector('[role="alert"]')?.textContent ?? "", /ya no está disponible/);
});

const esperar = async () => { for (let i = 0; i < 5; i++) await React.act(async () => { await new Promise((r) => setImmediate(r)); }); };

test("checkout «continuar»: lee el resumen por el token del enlace y elige con ese mismo token", async () => {
  const raiz = await montar(h(ContinuarComparativa, { token: TOKEN, opcionRef: "A", acomodacionRef: "doble" }));
  await esperar();
  assert.deepEqual(cmp.llamadas[0], ["resumen", [TOKEN, "A", "doble"]]);
  await escribir(raiz.querySelector<HTMLInputElement>("#cmp-nombres")!, "Ana");
  await escribir(raiz.querySelector<HTMLInputElement>("#cmp-doc")!, "123456");
  await escribir(raiz.querySelector<HTMLInputElement>("#cmp-tel")!, "3001112233");
  await pulsar(boton(raiz, /Continuar con esta opción/)!);
  const [n, arg] = cmp.llamadas[1] as [string, Record<string, unknown>];
  assert.equal(n, "elegir");
  assert.equal(arg.token, TOKEN); assert.ok(!("madreId" in arg));
  assert.equal(arg.version, 1);
  assert.match(raiz.textContent ?? "", /Elegiste esta opción/);
});

test("checkout «continuar»: si el precio cambió NO hay botón de confirmar; solo «Generar una comparativa nueva»", async () => {
  const raiz = await montar(h(ContinuarComparativa, { token: TOKEN, opcionRef: "A", acomodacionRef: "doble" }));
  await esperar();
  cmp.respElegir = () => ({ ok: false, tipo: "precio_actualizado", pvp: 700000, moneda: "COP", reintentable: false,
    error: "El precio de esta opción cambió (ahora $ 700.000). Esta comparativa no se modifica: genera una comparativa nueva desde el tarifario." });
  await pulsar(boton(raiz, /Continuar con esta opción/)!);
  assert.equal(cmp.llamadas.filter((l) => l[0] === "elegir").length, 1);
  assert.match(raiz.querySelector('[role="alert"]')?.textContent ?? "", /comparativa nueva/);
  assert.equal(boton(raiz, /Continuar con esta opción|Confirmar/), undefined, "no hay una confirmación imposible");
  const enlace = [...raiz.querySelectorAll("a")].find((a) => /Generar una comparativa nueva/.test(a.textContent ?? ""));
  assert.ok(enlace, "se ofrece generar una comparativa nueva");
  assert.equal(enlace!.getAttribute("href"), "/tarifario");
});
