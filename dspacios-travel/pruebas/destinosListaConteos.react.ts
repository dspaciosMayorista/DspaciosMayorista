// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Render REAL de `DestinosLista.tsx` (Producto → Destinos): la insignia de
// receptivos junto a la de hoteles.
//   - singular/plural y cero ("1 receptivo", "0 receptivos", "3 receptivos");
//   - un destino con receptivos pero sin hoteles muestra "0 hoteles" + su conteo;
//   - conteo desconocido (mapa null, o destino ausente del mapa) = sin insignia
//     de receptivos — nunca un "0 receptivos" no verificado.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { DestinosLista } = await import("../app/(dashboard)/dashboard/producto/destinos/DestinosLista.tsx");
const { act, createElement: h } = React;

const DESTINOS = [
  { id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", hoteles: [{ id: 10, nombre: "Hotel A" }, { id: 11, nombre: "Hotel B" }] },
  { id: 2, nombre: "SANTA MARTA", codigo_iata: "SMR", pais: "Colombia", hoteles: [{ id: 12, nombre: "Hotel C" }] },
  { id: 3, nombre: "GUATAPE", codigo_iata: null, pais: "Colombia", hoteles: [] },
  { id: 4, nombre: "LETICIA", codigo_iata: "LET", pais: "Colombia", hoteles: null },
];

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(receptivosPorDestino?: Record<number, number> | null) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(DestinosLista, { destinos: DESTINOS, receptivosPorDestino })));
}

// Insignias (pills) de la tarjeta de un destino, en orden.
function insignias(nombre: string): string[] {
  const tarjeta = [...container.querySelectorAll("h3")].find((el) => el.textContent?.startsWith(nombre))?.closest("[data-destino-tarjeta]");
  assert.ok(tarjeta, `no se encontró la tarjeta de ${nombre}`);
  // Botón (con elementos) o texto fijo (con 0): ambos llevan `data-insignia`.
  return [...tarjeta!.querySelectorAll("[data-insignia]")].map((s) => s.textContent?.trim() ?? "");
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("muestra receptivos junto a hoteles con singular/plural y cero", async () => {
  await render({ 1: 1, 2: 0, 3: 3, 4: 0 });
  assert.deepEqual(insignias("CARTAGENA"), ["2 hoteles", "1 receptivo"]);
  assert.deepEqual(insignias("SANTA MARTA"), ["1 hotel", "0 receptivos"]);
});

test("destino con receptivos pero sin hoteles (lista vacía o null)", async () => {
  await render({ 1: 1, 2: 0, 3: 3, 4: 2 });
  assert.deepEqual(insignias("GUATAPE"), ["0 hoteles", "3 receptivos"]);
  assert.deepEqual(insignias("LETICIA"), ["0 hoteles", "2 receptivos"]);
});

test("conteo desconocido: sin insignia de receptivos (mapa null, prop omitida o destino ausente del mapa)", async () => {
  await render(null);
  assert.deepEqual(insignias("CARTAGENA"), ["2 hoteles"]);
  await act(async () => root?.unmount());
  container.remove();

  await render(undefined);
  assert.deepEqual(insignias("GUATAPE"), ["0 hoteles"]);
  await act(async () => root?.unmount());
  container.remove();

  await render({ 1: 4 });
  assert.deepEqual(insignias("CARTAGENA"), ["2 hoteles", "4 receptivos"]);
  assert.deepEqual(insignias("SANTA MARTA"), ["1 hotel"], "ausente del mapa = no verificado, no 0");
});
