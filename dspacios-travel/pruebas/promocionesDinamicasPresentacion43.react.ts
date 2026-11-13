// Se ejecuta con npm run test:react (loader del arnés). Presentación de «Promociones dinámicas por grupo» en «Tarifas generadas»:
// resumen por categoría (patrón del tarifario) con promoción, vigencia y grupo visibles; «Ver tarifas» abre el modal compartido con el
// detalle por alimentación y acomodación (unidades coherentes, reparto exacto); cierra con X y Escape devolviendo el foco; sin permiso,
// ningún importe. Varias categorías y alimentaciones.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { PromocionesDinamicasBox } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/PromocionesDinamicasBox.tsx");
const { promocionesDinamicasHotel } = await import("../lib/hoteles/promocionesDinamicas.ts");
const { textoCuentaPromo } = await import("../lib/hoteles/tarifasVista.ts");

const cont = document.createElement("div"); document.body.appendChild(cont);
let root: ReturnType<typeof createRoot> | null = null;
after(() => { if (root) act(() => root!.unmount()); dom.window.close(); });
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function montar(props: Record<string, unknown>) {
  if (root) await act(async () => root!.unmount());
  root = createRoot(cont);
  await act(async () => root!.render(h(PromocionesDinamicasBox as never, props)));
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tarjetas = () => [...cont.querySelectorAll("[data-categoria-promo]")].map((e) => [...e.querySelectorAll("p, button")].map((x) => norm(x.textContent)).join(" "));

const SEMANA = "g-semana";
const ALTA = { id: 1, nombre: "ALTA", tipo: "tarifa", prioridad: 1, descuento_valor: null, regimen_restringido: null, hotel_temporada_grupos: [{ id: SEMANA, nombre: "Semana", dias: [1, 2, 3, 4] }] };
const promo = (o: Record<string, unknown>) => ({ id: 2, nombre: "Promo", tipo: "descuento_pct", prioridad: 2, descuento_valor: 10, regimen_restringido: null, promo_base_id: 1,
  hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 10, dias: null }], hotel_promocion_combinacion: null, ...o });
const fila = (cat: string, reg: string, doble: number, triple: number | null = null, nino: number | null = null) =>
  ({ temporada: "ALTA", grupo_id: SEMANA, tipo_habitacion: cat, alimentacion: reg, neto_doble: doble, neto_triple: triple, neto_nino: nino });
const TARIFAS = [fila("Estándar", "PAM", 100_000, 90_000, 30_000), fila("Estándar", "PC", 120_000), fila("Superior", "PAM", 150_000), fila("Superior", "PC", 170_000, 160_000)];
const HAB = promo({ tipo: "descuento_monto", descuento_unidad: "habitacion_noche", hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 20_000, dias: null }] });

async function abrir(categoria: string) {
  const b = cont.querySelector<HTMLButtonElement>(`[data-categoria-promo="${categoria}"] button`);
  assert.ok(b, `falta «Ver tarifas» de ${categoria}`);
  await act(async () => { b!.focus(); b!.click(); });
  await esperar();
  assert.ok(dialogo(), "el modal se abrió");
  return b!;
}

test("resumen: una tarjeta por categoría con sus alimentaciones, cuántas tarifas y el «desde» de adulto; promoción, vigencia y grupo a la vista", async () => {
  await montar({ promos: promocionesDinamicasHotel([ALTA, promo({})] as never, TARIFAS as never, []), moneda: "COP" });
  assert.match(norm(cont.textContent), /Promo · prioridad 2 · descuento %/);
  assert.match(norm(cont.textContent), /Vigencia base y grupo: ALTA · Semana/);
  assert.deepEqual(tarjetas(), [
    "Estándar PAM · PC · 4 tarifas desde $ 81.000 por persona Ver tarifas",
    "Superior PAM · PC · 3 tarifas desde $ 135.000 por persona Ver tarifas",
  ], "el niño (27.000) no cuenta para el «desde»");
  assert.equal(cont.querySelectorAll("[data-linea-promo]").length, 0, "el detalle no se pinta hasta abrirlo");
});

test("«Ver tarifas» abre el modal compartido con el detalle por alimentación y acomodación; Escape cierra y devuelve el foco", async () => {
  await montar({ promos: promocionesDinamicasHotel([ALTA, promo({})] as never, TARIFAS as never, []), moneda: "COP" });
  const boton = await abrir("Superior");
  const d = dialogo()!;
  assert.match(norm(d.textContent), /Promo · Superior/);
  assert.match(norm(d.textContent), /ALTA · Semana · descuento %/);
  assert.deepEqual([...d.querySelectorAll("[data-regimen-promo]")].map((s) => s.getAttribute("data-regimen-promo")), ["PAM", "PC"]);
  const pc = [...d.querySelectorAll('[data-regimen-promo="PC"] [data-linea-promo]')].map((e) => norm(e.textContent));
  assert.deepEqual(pc, ["Doble: $ 170.000 − 10 % = $ 153.000", "Triple: $ 160.000 − 10 % = $ 144.000"]);
  assert.ok(d.contains(document.activeElement), "el foco entra al modal");
  await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  await esperar();
  assert.equal(dialogo(), null, "Escape lo cierra");
  assert.equal(document.activeElement, boton, "el foco vuelve a «Ver tarifas»");
});

test("monto por habitación en el modal: base × ocupantes − descuento = por habitación, y por persona con reparto exacto; la X cierra", async () => {
  await montar({ promos: promocionesDinamicasHotel([ALTA, HAB] as never, TARIFAS as never, []), moneda: "COP" });
  assert.match(norm(cont.textContent), /descuento por habitación y noche/i);
  await abrir("Estándar");
  const pam = [...dialogo()!.querySelectorAll('[data-regimen-promo="PAM"] [data-linea-promo]')].map((e) => norm(e.textContent));
  assert.deepEqual(pam, [
    "Doble: $ 100.000 × 2 − $ 20.000 = $ 180.000 por habitación, $ 90.000 por persona",
    "Triple: $ 90.000 × 3 − $ 20.000 = $ 250.000 por habitación, $ 83.334 + $ 83.333 + $ 83.333 por persona",
    "Niño 1: $ 30.000 − $ 20.000 por habitación = no es habitación: conserva la base",
  ]);
  const x = [...dialogo()!.querySelectorAll("button")].find((b) => /Close/.test(b.textContent ?? ""));
  assert.ok(x, "el modal trae su X");
  await act(async () => x!.click());
  await esperar();
  assert.equal(dialogo(), null, "la X lo cierra");
});

test("sin permiso de netos: aviso sin ningún importe", async () => {
  await montar({ promos: null, moneda: "COP" });
  assert.equal(cont.querySelector("[data-promos-dinamicas]")?.getAttribute("data-promos-dinamicas"), "sin-permiso");
  assert.doesNotMatch(cont.textContent ?? "", /\$|\d{2,}\.\d{3}/);
});

test("texto: niño con monto por habitación conserva la base (no se le inventa habitación)", () => {
  const t = textoCuentaPromo({ netoBase: 40_000, valor: 20_000, netoResultante: null, motivoNoAplica: "no es habitación: conserva la base" }, "descuento_monto", "habitacion_noche", (n) => `$ ${n.toLocaleString("es-CO")}`);
  assert.equal(t, "$ 40.000 − $ 20.000 por habitación = no es habitación: conserva la base");
});
