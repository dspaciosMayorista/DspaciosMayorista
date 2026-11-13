// #89 — BuscadorReceptivos con respuestas lentas: la portada mostrada siempre es la del servicio de la búsqueda
// vigente (una respuesta vieja que llega tarde se ignora), sobrevive a una recarga de props (router.refresh) y no
// hay reintentos: una búsqueda = una llamada. Complementa pruebas/receptivosPortada89.test.ts (cargador real).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON() {} });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { BuscadorReceptivos } = await import("../app/tarifario/BuscadorReceptivos.tsx");
const { __setBuscarReceptivos } = await import("./support/stubs/reservarActionsStub.mjs");
after(() => dom.window.close());

const resultado = (servicioId: number) => ({
  servicioId, nombre: `Tour ${servicioId}`, destino: "CARTAGENA", descripcion: null, paqueteId: 70 + servicioId,
  total: 100000 * servicioId, pax: 2, noches: 3, moneda: "COP", categoria: "tour",
});
const FOTOS = { 1: "https://img.test/tour-1.jpg", 2: "https://img.test/tour-2.jpg" };

function escribir(input: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
const campo = (c: HTMLElement, etiqueta: string) =>
  [...c.querySelectorAll("label")].find((l) => l.textContent?.trim() === etiqueta)!.parentElement!.querySelector("input") as HTMLInputElement;
const buscar = (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => /Buscar receptivos|Buscando/.test(b.textContent ?? ""))!;
const portadas = (c: HTMLElement) => [...c.querySelectorAll("img")].map((i) => `${i.getAttribute("alt")}=${i.getAttribute("src")}`);

test("respuesta lenta que llega tras limpiar y cambiar el filtro se ignora; la portada es la del servicio vigente", async () => {
  const pendientes: ((v: unknown) => void)[] = [];
  const llamadas: unknown[] = [];
  __setBuscarReceptivos((input: unknown) => { llamadas.push(input); return new Promise((r) => pendientes.push(r)); });
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  // `initial.paqueteId` deja visible «Limpiar resultados» durante la primera búsqueda (fechas null: no busca sola).
  const props = (fotos: Record<number, string>) => h(BuscadorReceptivos, { onVerDetalle: () => {}, fotosPorServicio: fotos, initial: { paqueteId: 5, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, nonce: 1 } });
  await act(async () => root.render(props(FOTOS)));
  await act(async () => { escribir(campo(c, "Ida"), "2030-01-01"); escribir(campo(c, "Regreso"), "2030-01-05"); });

  await act(async () => { buscar(c).click(); });                 // búsqueda 1 (2 pax), lenta
  assert.equal(buscar(c).disabled, true, "mientras busca no se lanza otra búsqueda");
  await act(async () => { [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("Limpiar resultados"))!.click(); });
  await act(async () => { escribir(campo(c, "Ida"), "2030-01-01"); escribir(campo(c, "Regreso"), "2030-01-05"); escribir(campo(c, "Pax"), "3"); });
  await act(async () => { buscar(c).click(); });                 // búsqueda 2 (3 pax)
  assert.equal(llamadas.length, 2);
  await act(async () => { pendientes[1]({ ok: true, resultados: [resultado(2)] }); });
  assert.deepEqual(portadas(c), [`Tour 2=${FOTOS[2]}`]);
  await act(async () => { pendientes[0]({ ok: true, resultados: [resultado(1)] }); await new Promise((r) => setTimeout(r, 20)); });
  assert.deepEqual(portadas(c), [`Tour 2=${FOTOS[2]}`], "la respuesta vieja (Tour 1) no reemplaza ni presta su portada");

  // Recarga de props (router.refresh): el mapa llega nuevo pero equivalente → misma portada, sin buscar otra vez.
  await act(async () => root.render(props({ ...FOTOS })));
  assert.deepEqual(portadas(c), [`Tour 2=${FOTOS[2]}`]);
  // Sin portada en el mapa → «Sin foto», nunca la de otro servicio.
  await act(async () => root.render(props({ 1: FOTOS[1] })));
  assert.deepEqual(portadas(c), []);
  assert.ok(c.textContent?.includes("Sin foto"));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(llamadas.length, 2, "sin reintentos ni sondeos");
  await act(async () => root.unmount());
  c.remove();
});
