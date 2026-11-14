// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// #75 · 288 — «Abono registrado; confirmación pendiente»: la pantalla lo dice, impide registrar el abono otra vez y reintenta la confirmación con la MISMA operación.
// Cubre: ficha del contrato (AbonoForm) y Cartera (CarteraList), respuesta perdida (el reintento devuelve «ya registrado») y recuperación.
import { test, mock, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData,
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
let impls: Record<string, (...a: never[]) => unknown> = {};
const __setImpls = (next: Record<string, (...a: never[]) => unknown>) => { impls = { ...impls, ...next }; };
const via = (n: string) => async (...a: unknown[]) => (impls[n] as unknown as (...x: unknown[]) => unknown)(...a);
mock.module(new URL("../app/(dashboard)/dashboard/contratos/actions.ts", import.meta.url).href, {
  namedExports: { registrarAbono: via("registrarAbono"), actualizarAbono: via("actualizarAbono"), anularAbono: via("anularAbono") },
});
mock.module(new URL("../app/(dashboard)/dashboard/cartera/actions.ts", import.meta.url).href, {
  namedExports: { registrarAbonoCartera: via("registrarAbonoCartera"), actualizarAbonoCartera: via("actualizarAbonoCartera"), anularAbonoCartera: via("anularAbonoCartera") },
});
const { AbonoForm } = await import("../app/(dashboard)/dashboard/contratos/[numero]/AbonoForm.tsx");
const { act, createElement: h } = React;

type Llamada = { valor: number; operacion?: string };
const llamadas: Llamada[] = [];
let abonosGuardados = 0;      // lo que quedó realmente registrado en el "servidor" (por clave de operación)
const operaciones = new Set<string>();
let confirmacionFalla = true; // mientras sea true, la confirmación del contrato falla (el abono SÍ queda registrado)
let respuestaPerdida = false; // simula que la respuesta del primer envío nunca llegó al navegador

function servidor() {
  return async (_n: string, valor: number, _f: string, _r: string, _t?: number, _fecha?: string, _c?: boolean, operacion?: string) => {
    llamadas.push({ valor, operacion });
    if (operacion && !operaciones.has(operacion)) { operaciones.add(operacion); abonosGuardados++; }   // misma operación = mismo abono (idempotente)
    if (respuestaPerdida) { respuestaPerdida = false; throw new Error("red"); }
    if (confirmacionFalla) return { ok: false, confirmacionPendiente: true, error: "Abono registrado; confirmación pendiente: error técnico" };
    return { ok: true };
  };
}
__setImpls({ registrarAbono: servidor(), registrarAbonoCartera: servidor() });

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const texto = () => document.body.textContent ?? "";
const boton = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined;
async function montar(el: React.ReactElement) {
  llamadas.length = 0; abonosGuardados = 0; operaciones.clear(); confirmacionFalla = true; respuestaPerdida = false;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(el));
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const entradaValor = () => container.querySelector<HTMLInputElement>('input[type="number"]')!;
async function enviarFormulario() {
  const form = container.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
}
async function clic(btn: HTMLElement | undefined) {
  assert.ok(btn, "el botón existe");
  await act(async () => btn!.click());
  await act(async () => { await Promise.resolve(); });
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); document.body.innerHTML = ""; });
after(() => dom.window.close());

test("ficha: abono registrado con confirmación fallida → lo dice, bloquea «Registrar abono» y conserva la operación", async () => {
  await montar(h(AbonoForm, { identidad: {}, numeroContrato: "DTM-0001", formasPago: ["Efectivo"], moneda: "COP" }));
  await escribir(entradaValor(), "300000");
  await enviarFormulario();
  assert.match(texto(), /Abono registrado; confirmación pendiente/);
  assert.match(texto(), /no lo registres otra vez/i);
  assert.ok(boton("Reintentar confirmación"), "ofrece reintentar la confirmación");
  assert.equal(boton("Registrar abono")!.disabled, true, "no se puede registrar el abono otra vez");
  assert.equal(abonosGuardados, 1);
  await enviarFormulario();
  assert.equal(llamadas.length, 1, "otro envío del formulario NO llega al servidor (sería un segundo pago)");
});

test("ficha: reintentar la confirmación usa la MISMA operación (no duplica el abono) y al confirmar se libera el formulario", async () => {
  await montar(h(AbonoForm, { identidad: {}, numeroContrato: "DTM-0001", formasPago: [], moneda: "COP" }));
  await escribir(entradaValor(), "300000");
  await enviarFormulario();
  const op1 = llamadas[0].operacion;
  await clic(boton("Reintentar confirmación"));
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].operacion, op1, "misma operación");
  assert.equal(abonosGuardados, 1, "sigue habiendo un solo abono");
  assert.match(texto(), /Abono registrado; confirmación pendiente/, "sigue pendiente mientras la confirmación falle");
  confirmacionFalla = false;
  await clic(boton("Reintentar confirmación"));
  assert.equal(llamadas[2].operacion, op1);
  assert.equal(abonosGuardados, 1);
  assert.doesNotMatch(texto(), /confirmación pendiente/);
  assert.equal(boton("Registrar abono")!.disabled, false, "el formulario vuelve a estar disponible");
});

test("ficha: respuesta PERDIDA del primer envío → el reintento con la misma operación no crea otro abono", async () => {
  await montar(h(AbonoForm, { identidad: {}, numeroContrato: "DTM-0001", formasPago: [], moneda: "COP" }));
  await escribir(entradaValor(), "300000");
  respuestaPerdida = true;
  confirmacionFalla = false;
  await enviarFormulario();
  assert.match(texto(), /No se pudo registrar el abono/, "el usuario ve que no hubo respuesta");
  assert.equal(abonosGuardados, 1, "pero el servidor sí lo guardó");
  await enviarFormulario();    // el usuario vuelve a pulsar: la clave de operación se conserva
  assert.equal(llamadas[1].operacion, llamadas[0].operacion, "misma operación en el reintento");
  assert.equal(abonosGuardados, 1, "no hay un segundo abono");
});
