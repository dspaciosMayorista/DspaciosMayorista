// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/desdeDoble.react.ts
//
// TASKS #92/#114 — el listado de paquetes (componente REAL PaquetesListado) muestra «Desde» solo con la DOBLE publicable,
// con la moneda de la fila, y «Consultar» cuando no hay DOBLE. La selección en sí se prueba en desdeDoble.test.ts.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const ACCIONES = `data:text/javascript,${encodeURIComponent("export async function eliminarPaquete() { return { ok: true }; } export async function duplicarPaquete() { return { ok: true, id: 99, nombre: 'x', omitidas: 0 }; }")}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions" && ((context.parentURL ?? "").endsWith("/paquetes/EliminarPaqueteBtn.tsx") || (context.parentURL ?? "").endsWith("/paquetes/DuplicarPaqueteBtn.tsx"))) return { url: ACCIONES, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/paquetes" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { PaquetesListado } = await import("../app/(dashboard)/dashboard/paquetes/PaquetesListado.tsx");
const h = React.createElement;
type Item = Parameters<typeof PaquetesListado>[0]["paquetes"][number];
type Tipo = Parameters<typeof PaquetesListado>[0]["tabInicial"];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(() => dom.window.close());

const item = (o: Partial<Item>): Item =>
  ({ id: 1, nombre: "Paquete", activo: true, pctMk: 0.2, tipo: "bloqueo", destino: "CARTAGENA", fechaViajeInicio: null, fechaViajeFin: null, nTarifas: 3, desde: [],
    publicacion: { clave: "publicado", etiqueta: "Tarifas publicadas", detalle: "3 combinaciones publicadas.", tono: "ok", secundarias: [] }, compra: { fin: null, estado: "sin_fecha", dias: null }, ...o }) as Item;

async function montar(paquetes: Item[], tab: Tipo) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(PaquetesListado, { paquetes, tabInicial: tab }) as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c.textContent ?? "";
}

test("Bloqueo con DOBLE en COP: «Desde» con formato COP", async () => {
  const t = await montar([item({ desde: [{ moneda: "COP", valor: 2_500_000 }] })], "bloqueo");
  assert.match(t, /Desde\s*\$\s?2\.500\.000/);
  assert.doesNotMatch(t, /USD/);
});

test("Dinámico en USD: «Desde» con formato USD (no se formatea como pesos)", async () => {
  const t = await montar([item({ tipo: "dinamico", desde: [{ moneda: "USD", valor: 640 }] })], "dinamico");
  assert.match(t, /USD\s*\$?\s?640/);
});

test("Empaquetado/Dinámico con COP y USD: ambos importes, separados, sin convertir", async () => {
  const t = await montar([item({ tipo: "dinamico", desde: [{ moneda: "COP", valor: 1_200_000 }, { moneda: "USD", valor: 300 }] })], "dinamico");
  assert.match(t, /1\.200\.000/);
  assert.match(t, /USD\s*\$?\s?300/);
});

test("Paquete publicado sin DOBLE: «Consultar», sin importe inventado", async () => {
  const t = await montar([item({ tipo: "porcion_terrestre", desde: [], nTarifas: 4 })], "porcion_terrestre");
  assert.match(t, /Consultar/);
  assert.doesNotMatch(t, /Desde/);
});

test("Paquete sin publicar (#36): estado real «Pendiente de generar», sin «Consultar» ni importe inventado", async () => {
  const t = await montar([item({ nTarifas: 0, desde: [], publicacion: { clave: "pendiente", etiqueta: "Pendiente de generar", detalle: "Aún no se ha publicado el tarifario de este paquete.", tono: "aviso", secundarias: [] } })], "bloqueo");
  assert.match(t, /Pendiente de generar/);
  assert.doesNotMatch(t, /Sin publicar|Consultar|Desde/);
});

test("Receptivos: conserva su importe por persona (sin acomodación)", async () => {
  const t = await montar([item({ tipo: "servicios", desde: [{ moneda: "COP", valor: 90_000 }] })], "servicios");
  assert.match(t, /Desde\s*\$\s?90\.000/);
});

test("#61: cada paquete del listado ofrece «Duplicar» (con el nombre del paquete para lectores de pantalla) junto a «Eliminar»", async () => {
  await montar([item({ id: 1, nombre: "Paquete A" }), item({ id: 2, nombre: "Paquete B" })], "bloqueo");
  const botones = [...document.querySelectorAll('button[data-testid="duplicar-paquete"]')].map((b) => b.getAttribute("aria-label"));
  assert.deepEqual(botones, ["Duplicar el paquete Paquete A", "Duplicar el paquete Paquete B"]);
  assert.equal(document.querySelectorAll("button").length >= 4, true, "Duplicar y Eliminar por cada paquete");
});
