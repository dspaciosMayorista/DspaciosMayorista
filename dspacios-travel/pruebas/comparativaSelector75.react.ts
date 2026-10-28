// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #75 — El selector interactivo (público e interno) muestra Incluye / No incluye y la tarifa real de los menores POR OPCIÓN, con los datos ya cargados en `ResumenHotelUI`:
//   · cada hotel conserva su total independiente y sus controles (checkout / solicitud / elegir);
//   · Incluye/No incluye común → una vez tras las tarjetas; distinto → dentro de cada opción; ausente → nada;
//   · tarifa de menores real (nunca la de adulto); opción NETO con líneas a PVP → se explica el límite, sin tarifa.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos("export async function elegirOpcionComparativa() { return { ok: true, hijaId: 1, codigo: 'C', url: '' }; } export async function solicitarOpcionComparativa() { return { ok: true, actualizada: false }; } export async function resumenOpcionComparativa() { return { ok: false, error: 'x' }; }"),
  "@/app/(dashboard)/dashboard/cotizaciones/manual-actions": datos("export async function resolverSolicitudComparativa() { return { ok: true, hijaId: 1 }; }"),
  "next/navigation": datos("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; }"),
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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { SelectorOpciones } = await import("../lib/cotizacion/comparativaAcciones.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(() => dom.window.close());
async function montar(elemento: unknown) {
  await desmontar?.(); desmontar = undefined;
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(elemento as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const txt = (c: Element) => (c.textContent ?? "").replace(/\s+/g, " ");
const veces = (t: string, s: string) => t.split(s).length - 1;

const op = (ref: string, total: number) => ({ opcionRef: ref, acomodacionRef: "doble", etiqueta: `Hotel ${ref}`, moneda: "COP", tarifaPersona: 300_000, total, orden: ref.charCodeAt(0) });
const GRUPOS = [
  { opcionRef: "A", etiqueta: "Hotel A", moneda: "COP", acomodaciones: [op("A", 685_000)] },
  { opcionRef: "B", etiqueta: "Hotel B", moneda: "COP", acomodaciones: [op("B", 910_000)] },
];
const INC = "Desayuno\nTraslados";
const NOINC = "Propinas";
const MENOR = { descripcion: "Niño 1 · Estándar / PC", cantidad: 1, tarifa: 123_000 };
const resumen = (sobre: object = {}) => ({ incluye: INC, noIncluye: NOINC, menores: [MENOR], ...sobre });
const resumenes = (a: object = {}, b: object = {}) => ({ "A/doble": resumen(a), A: resumen(a), "B/doble": resumen(b), B: resumen(b) });
const props = (sobre: Record<string, unknown> = {}) => ({ version: 1, token: "t".repeat(36), grupos: GRUPOS, resumenes: resumenes(), modo: "checkout", deshabilitada: false, elegida: null, ...sobre });

test("común a todas: Incluye/No incluye UNA vez tras las tarjetas; tarifa de menores y total de CADA hotel por separado; controles intactos", async () => {
  const c = await montar(h(SelectorOpciones as never, props({ modo: "checkout" })));
  const t = txt(c);
  assert.equal(veces(t, "Incluye / No incluye (todas las opciones)"), 1);
  assert.equal(c.querySelectorAll('[data-testid="incluye-no-incluye"]').length, 1);
  assert.match(t, /Desayuno/); assert.match(t, /Propinas/);
  assert.equal(c.querySelectorAll('[data-testid="menor-opcion"]').length, 2, "una fila por opción");
  assert.match(t, /1 × Niño 1 · Estándar \/ PC/); assert.match(t, /123\.000/);
  assert.match(t, /Tarifa por adulto/);
  assert.equal(veces(t, "Total de este hotel"), 2);
  assert.match(t, /685\.000/); assert.match(t, /910\.000/);
  assert.ok(!t.includes("1.595.000"), "nunca la suma de las opciones");
  const enlaces = [...c.querySelectorAll("a")].filter((a) => /Continuar con esta opción/.test(a.textContent ?? ""));
  assert.equal(enlaces.length, 2);
});

test("distinto por opción: cada tarjeta lleva el suyo (rotulado) y no hay bloque común; una opción sin texto no muestra el de otra", async () => {
  const c = await montar(h(SelectorOpciones as never, props({ resumenes: resumenes({}, { incluye: "Cena", noIncluye: "Spa" }) })));
  const t = txt(c);
  assert.ok(!t.includes("todas las opciones"));
  assert.equal(c.querySelectorAll('[data-testid="incluye-no-incluye"]').length, 2);
  assert.match(t, /Incluye · Opción A/); assert.match(t, /No incluye · Opción B/);
  const c2 = await montar(h(SelectorOpciones as never, props({ resumenes: resumenes({}, { incluye: null, noIncluye: null }) })));
  assert.equal(c2.querySelectorAll('[data-testid="incluye-no-incluye"]').length, 1, "solo la A tiene texto");
  assert.ok(!txt(c2).includes("Cena"));
});

test("sin Incluye/No incluye ni menores: no aparece nada de eso y el rótulo sigue siendo «Tarifa por persona»", async () => {
  const vacio = { "A/doble": {}, A: {}, "B/doble": {}, B: {} };
  const c = await montar(h(SelectorOpciones as never, props({ resumenes: vacio })));
  assert.equal(c.querySelectorAll('[data-testid="incluye-no-incluye"], [data-testid="menor-opcion"], [data-testid="menores-no-desglosables"]').length, 0);
  assert.match(txt(c), /Tarifa por persona/); assert.ok(!txt(c).includes("Tarifa por adulto"));
});

test("opción NETO con líneas de menores a PVP: sin tarifa y con la explicación del límite; la otra opción conserva su tarifa", async () => {
  const c = await montar(h(SelectorOpciones as never, props({ resumenes: resumenes({ menores: undefined, menoresNoDesglosables: true }) })));
  const t = txt(c);
  assert.equal(c.querySelectorAll('[data-testid="menores-no-desglosables"]').length, 1);
  assert.match(t, /no se desglosa con seguridad/);
  assert.equal(c.querySelectorAll('[data-testid="menor-opcion"]').length, 1, "solo la opción B muestra su tarifa");
  assert.ok(!/neto/i.test(t), "no se menciona NETO al público");
});

test("modo solicitud (público) e interno conservan sus controles y muestran lo mismo", async () => {
  const cs = await montar(h(SelectorOpciones as never, props({ modo: "solicitud" })));
  assert.equal([...cs.querySelectorAll("button")].filter((b) => /Solicitar esta opción/.test(b.textContent ?? "")).length, 2);
  assert.equal(cs.querySelectorAll('[data-testid="menor-opcion"]').length, 2);
  const ci = await montar(h(SelectorOpciones as never, props({ modo: "interno" })));
  assert.equal([...ci.querySelectorAll("button")].filter((b) => /Elegir esta opción/.test(b.textContent ?? "")).length, 2);
  assert.equal(ci.querySelectorAll('[data-testid="menor-opcion"]').length, 2);
  assert.equal(veces(txt(ci), "Incluye / No incluye (todas las opciones)"), 1);
});
