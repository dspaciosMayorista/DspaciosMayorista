// Registrada en `npm run test:react`. Comando equivalente para correrla sola:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs
//     --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/programaDestinoFijo.filtro.react.ts
// #23 — filtro público de Programas: ofrece y compara SOLO destinos fijos asignados,
// nunca las ciudades del circuito.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
  FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { TarifarioPublic } = await import("../app/tarifario/TarifarioPublic.tsx");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
});
after(() => dom.window.close());

const BRASIL = { id: 1, nombre: "Brasil" };
const EUROPA = { id: 2, nombre: "Europa" };
const prog = (id: number, nombre: string, ciudades: string[], destino: { id: number; nombre: string } | null) => ({
  id, nombre, subtitulo: null, dias: 7, noches: 6, moneda: "USD", desde_pvp: 1000, tipo_transporte: "ninguno" as const, portada_url: null, ciudades, destino,
});
const PROGRAMAS = [
  prog(1, "Brasil Clásico", ["Río de Janeiro", "Manaus"], BRASIL),
  prog(2, "Brasil Costa", ["Salvador"], BRASIL),
  prog(3, "Europa Multicity", ["París", "Río de Janeiro", "Roma"], EUROPA),
  prog(4, "Sin destino interno", ["Lima"], null),
];

async function abrirProgramas(programas = PROGRAMAS) {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(TarifarioPublic, { filas: [], programas } as never)); });
  const tab = [...document.querySelectorAll("button")].find((b) => b.textContent === "Programas");
  assert.ok(tab, "pestaña Programas");
  await act(async () => { tab!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
const selDestino = () => document.querySelector("select") as HTMLSelectElement;
const tarjetas = () => [...document.querySelectorAll("div")].map((d) => d.textContent ?? "").join(" ");

test("el filtro ofrece SOLO los destinos fijos asignados (sin repetir) y nunca las ciudades del circuito", async () => {
  await abrirProgramas();
  const opciones = [...selDestino().options].map((o) => o.textContent);
  assert.deepEqual(opciones, ["Todos los destinos", "Brasil", "Europa"]);
  for (const ciudad of ["Río de Janeiro", "Manaus", "París", "Roma", "Salvador", "Lima"]) assert.ok(!opciones.includes(ciudad), ciudad);
});

test("elegir un destino fijo muestra todos sus programas (varios con el mismo destino) y no otros", async () => {
  await abrirProgramas();
  const sel = selDestino();
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
    set.call(sel, "1");
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const t = tarjetas();
  assert.match(t, /Brasil Clásico/);
  assert.match(t, /Brasil Costa/);
  assert.doesNotMatch(t, /Europa Multicity/, "el circuito europeo pasa por Río de Janeiro pero su destino es Europa");
  assert.doesNotMatch(t, /Sin destino interno/);
  assert.match(document.body.textContent!, /2 programa\(s\)/);
});

test("sin ningún programa con destino el filtro queda solo con 'Todos los destinos'", async () => {
  await abrirProgramas([prog(4, "Sin destino interno", ["Lima"], null)]);
  assert.deepEqual([...selDestino().options].map((o) => o.textContent), ["Todos los destinos"]);
});

test("el provisional NO se ofrece en el filtro, pero sus programas siguen visibles en 'Todos los destinos'", async () => {
  const PROV = { id: 9, nombre: "Por clasificar", es_provisional: true };
  await abrirProgramas([
    prog(1, "Brasil Clásico", ["Río de Janeiro"], BRASIL),
    prog(5, "Circuito provisional", ["Lima"], PROV),
  ]);
  assert.deepEqual([...selDestino().options].map((o) => o.textContent), ["Todos los destinos", "Brasil"]);
  assert.match(tarjetas(), /Circuito provisional/);
  assert.match(tarjetas(), /Brasil Clásico/);
  assert.match(document.body.textContent!, /2 programa\(s\)/);
});

test("un destino REAL llamado «Por clasificar» (sin marca) sí se ofrece como cualquier destino", async () => {
  const REAL = { id: 10, nombre: "Por clasificar", es_provisional: false };
  await abrirProgramas([prog(7, "Programa X", ["Lima"], REAL)]);
  assert.deepEqual([...selDestino().options].map((o) => o.textContent), ["Todos los destinos", "Por clasificar"]);
});
