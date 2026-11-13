// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/promocionesGrupo43.react.ts
// #43/#60 entrega 4 — panel «Reglas por grupo»: abrir y editar = 0 solicitudes; nada viene elegido (grupos sin
// regla, días sin elegir); los días ofrecidos son solo los del grupo; guardar = 1 acción con la foto; desvincular;
// StrictMode y reposo sin solicitudes.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const ACCIONES = datos("export async function guardarReglasPromocion(...a) { globalThis.__g300r.llamadas.push(a); return globalThis.__g300r.resp; }");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../actions" && (context.parentURL ?? "").endsWith("/PromocionReglas.tsx")) return { url: ACCIONES, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/5" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const est = { llamadas: [] as unknown[][], resp: { ok: true } as unknown };
(globalThis as unknown as { __g300r: typeof est }).__g300r = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ReglasPromoPanel } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/PromocionReglas.tsx");
const h = React.createElement;
const S = "g-sem", F = "g-fs";
const BASES = [
  { id: 1, nombre: "ALTA", prioridad: 1, grupos: [{ id: S, nombre: "Semana", dias: [1, 2, 3, 4], activo: true }, { id: F, nombre: "Finde", dias: [5, 6, 7], activo: true }] },
  { id: 2, nombre: "PUENTE", prioridad: 3, grupos: [] }, // prioridad ≥ la de la promoción: no se ofrece
];
const promo = (over = {}) => ({ id: 10, nombre: "PROMO", tipo: "descuento_pct", prioridad: 2, descuento_valor: 10, descuento_unidad: null, promo_base_id: null, reglas: [], ...over });

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; est.llamadas.length = 0; est.resp = { ok: true }; });
after(() => dom.window.close());
async function montar(el: unknown) {
  const c = document.createElement("div"); document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => { raiz.render(el as never); await new Promise((r) => setImmediate(r)); });
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const act = (fn: () => void) => React.act(async () => { fn(); await new Promise((r) => setImmediate(r)); });
const boton = (c: HTMLElement, t: string) => [...c.querySelectorAll("button")].find((b) => b.textContent?.trim() === t)!;
const cambiar = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
  el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

test("abrir y editar: 0 solicitudes; nada elegido; solo bases de menor prioridad; días del grupo", async () => {
  let cerrado = 0;
  const c = await montar(h(React.StrictMode, null, h(ReglasPromoPanel, { hotelId: 5, promo: promo(), bases: BASES, onCerrar: () => { cerrado++; } })));
  const sel = c.querySelector("select")!;
  assert.deepEqual([...sel.options].map((o) => o.textContent), ["Elige la vigencia base…", "ALTA (P1) · 2 grupo(s)"]);
  await act(() => cambiar(sel, "1"));
  const casillas = [...c.querySelectorAll<HTMLInputElement>("[data-regla-grupo] > label input[type=checkbox]")];
  assert.equal(casillas.length, 2);
  assert.ok(casillas.every((x) => !x.checked), "ningún grupo viene con regla");
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /activa al menos una regla/);
  await act(() => casillas[0].click());
  await act(() => cambiar(c.querySelector<HTMLInputElement>("[data-regla-grupo='g-sem'] input[inputmode=decimal]")!, "10"));
  const radios = [...c.querySelectorAll<HTMLInputElement>("[data-regla-grupo='g-sem'] input[type=radio]")];
  assert.ok(radios.every((r) => !r.checked), "los días no vienen elegidos");
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /elige «Todos los días del grupo» o «Elegir días»/);
  await act(() => radios[1].click());
  const dias = [...c.querySelectorAll<HTMLInputElement>("[data-regla-grupo='g-sem'] fieldset input[type=checkbox]")];
  assert.deepEqual(dias.map((d) => d.parentElement?.textContent?.trim()), ["L", "M", "X", "J"], "solo los días del grupo");
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /marca al menos un día/);
  assert.equal(est.llamadas.length, 0, "editar y validar no hace solicitudes");
  await act(() => dias[0].click());
  await act(() => dias[2].click());
  await act(() => boton(c, "Guardar reglas").click());
  assert.deepEqual(est.llamadas, [[{ hotelId: 5, promocionId: 10, baseId: 1, reglas: [{ grupo_id: S, valor: 10, dias: [1, 3] }], previas: { base: null, reglas: [] } }]]);
  assert.equal(cerrado, 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(est.llamadas.length, 1, "reposo: sin solicitudes nuevas");
});

test("promoción vinculada: carga sus reglas; porcentaje inválido no se envía; desvincular = 1 acción", async () => {
  const p = promo({ promo_base_id: 1, reglas: [{ grupo_id: F, valor: 5, dias: null }] });
  const c = await montar(h(ReglasPromoPanel, { hotelId: 5, promo: p, bases: BASES, onCerrar: () => {} }));
  const fin = c.querySelector<HTMLInputElement>("[data-regla-grupo='g-fs'] input[inputmode=decimal]")!;
  assert.equal(fin.value, "5");
  assert.equal(c.querySelector<HTMLInputElement>("[data-regla-grupo='g-fs'] input[type=radio]")!.checked, true, "«todos los días del grupo» guardado");
  await act(() => cambiar(fin, "100"));
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /menor que 100/);
  assert.equal(est.llamadas.length, 0);
  await act(() => boton(c, "Quitar reglas y desvincular").click());
  assert.deepEqual(est.llamadas, [[{ hotelId: 5, promocionId: 10, baseId: null, reglas: [], previas: { base: 1, reglas: p.reglas } }]]);
});

test("error del servidor (foto obsoleta): se muestra y no se reintenta", async () => {
  est.resp = { ok: false, error: "La promoción cambió mientras la editabas; recarga la página y vuelve a revisarla." };
  const c = await montar(h(ReglasPromoPanel, { hotelId: 5, promo: promo({ promo_base_id: 1, reglas: [{ grupo_id: S, valor: 10, dias: null }] }), bases: BASES, onCerrar: () => {} }));
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /recarga la página/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(est.llamadas.length, 1);
});
