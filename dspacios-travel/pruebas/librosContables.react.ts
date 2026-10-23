// #43-1b — Libro diario legible y balance de prueba: interacción de los componentes reales.
// Uso directo (no está en package.json):
//   node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/librosContables.react.ts
import { test, describe, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
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
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { confirm: () => boolean }).confirm = () => true;

register("data:text/javascript," + encodeURIComponent(
  'export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const navegaciones: string[] = [];
mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push(u: string) { navegaciones.push(u); } }) } });
const llamadas: { fn: string; args: unknown[] }[] = [];
mock.module(new URL("../app/(dashboard)/dashboard/contabilidad/libro-diario/actions.ts", import.meta.url).href, {
  namedExports: {
    crearAsiento: async (...args: unknown[]) => { llamadas.push({ fn: "crearAsiento", args }); return { ok: true }; },
    eliminarAsiento: async (...args: unknown[]) => { llamadas.push({ fn: "eliminarAsiento", args }); return { ok: true }; },
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { LibroDiarioClient } = await import("../app/(dashboard)/dashboard/contabilidad/libro-diario/LibroDiarioClient.tsx");
const { BalancePruebaClient } = await import("../app/(dashboard)/dashboard/contabilidad/balance-prueba/BalancePruebaClient.tsx");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let c: HTMLDivElement;
async function montar(el: React.ReactElement) {
  c = document.createElement("div");
  document.body.append(c);
  root = createRoot(c);
  await act(async () => root!.render(el));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; c?.remove(); llamadas.length = 0; navegaciones.length = 0; });
after(() => dom.window.close());
async function escribir(el: HTMLInputElement | HTMLSelectElement, v: string, evento = "input") {
  await act(async () => {
    const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new dom.window.Event(evento, { bubbles: true }));
  });
}
async function clic(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); });
}
const boton = (t: string) => {
  const b = [...c.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === t);
  assert.ok(b, `falta el botón ${t}`);
  return b!;
};

const ln = (id: number, cuenta_codigo: string, cuenta_nombre: string, debe: number, haber: number, extra = {}) =>
  ({ id, cuenta_id: id, cuenta_codigo, cuenta_nombre, tercero: null, descripcion: null, debe, haber, ...extra });
const asientos = [
  { id: 1, numero: 12, fecha: "2026-10-09", descripcion: "Factura del contrato", origen: "facturacion", referencia: "00-0451",
    lineas: [ln(1, "130505", "Clientes", 1190000, 0), ln(2, "413505", "Ingresos propios", 0, 1000000)] },
  { id: 2, numero: 11, fecha: "2026-10-05", descripcion: "Arriendo oficina", origen: "manual", referencia: null,
    lineas: [ln(3, "512010", "Arrendamientos", 2000000, 0, { tercero: "Inmobiliaria Ñandú" }), ln(4, "111005", "Bancos COP", 0, 2000000)] },
];
const props = { asientosIniciales: asientos, errorCarga: null, cuentas: [], desde: "2026-10-01", hasta: "2026-10-31", hoy: "2026-10-17" };
const articulos = () => [...c.querySelectorAll("article")].map((a) => a.getAttribute("aria-label"));

describe("#43-1b libro diario", () => {
  test("cada asiento muestra número, origen legible, enlace al contrato y descuadre", async () => {
    await montar(h(LibroDiarioClient, props));
    assert.deepEqual(articulos(), ["Asiento 12", "Asiento 11"]);
    const primero = c.querySelector('article[aria-label="Asiento 12"]')!;
    assert.match(primero.textContent ?? "", /Facturación/);
    assert.match(primero.textContent ?? "", /Descuadrado/);
    assert.equal(primero.querySelector("a")?.getAttribute("href"), "/dashboard/contratos/00-0451");
    assert.match(c.textContent ?? "", /1 descuadrado/);
  });

  test("Eliminar solo en los manuales", async () => {
    await montar(h(LibroDiarioClient, props));
    assert.equal(c.querySelector('button[aria-label="Eliminar asiento 12"]'), null, "el automático no ofrece eliminar");
    await clic(c.querySelector('button[aria-label="Eliminar asiento 11"]')!);
    assert.deepEqual(llamadas, [{ fn: "eliminarAsiento", args: [2] }]);
  });

  test("filtros en vivo: tercero sin tildes, origen y solo descuadrados; quitar filtros", async () => {
    await montar(h(LibroDiarioClient, props));
    await escribir(c.querySelector<HTMLInputElement>("#ld-tercero")!, "nandu");
    assert.deepEqual(articulos(), ["Asiento 11"]);
    await clic(boton("Quitar filtros"));
    await escribir(c.querySelector<HTMLSelectElement>("#ld-origen")!, "facturacion", "change");
    assert.deepEqual(articulos(), ["Asiento 12"]);
    await clic(boton("Quitar filtros"));
    await clic(c.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    assert.deepEqual(articulos(), ["Asiento 12"]);
  });

  test("los atajos de periodo navegan con el rango en la URL", async () => {
    await montar(h(LibroDiarioClient, props));
    await clic(boton("Mes anterior"));
    await clic(boton("Año a la fecha"));
    assert.deepEqual(navegaciones, ["?desde=2026-09-01&hasta=2026-09-30", "?desde=2026-01-01&hasta=2026-10-17"]);
  });

  test("sin asientos en el periodo lo dice; un error de carga se muestra", async () => {
    await montar(h(LibroDiarioClient, { ...props, asientosIniciales: [], errorCarga: "timeout" }));
    assert.match(c.textContent ?? "", /No hay asientos en este periodo/);
    assert.match(c.textContent ?? "", /No se pudo cargar el libro completo: timeout/);
  });
});

describe("#43-1b balance de prueba", () => {
  const fila = (id: number, codigo: string, nombre: string, nivel: number, saldoFinal: number, tieneMovimiento = true) =>
    ({ id, codigo, nombre, nivel, naturaleza: "debito", saldoInicial: 0, debitos: tieneMovimiento ? 10 : 0, creditos: 0, saldoFinal, tieneMovimiento });
  const filas = [fila(1, "1", "Activo", 1, 100), fila(2, "11", "Disponible", 2, 100), fila(3, "1110", "Bancos", 3, 100),
    fila(4, "111005", "Bancos COP", 4, 100), fila(5, "2", "Pasivo", 1, 0, false), fila(6, "111010", "Bancos USD", 4, -5)];
  const base = { filas, totales: { debitos: 10, creditos: 10, cuadra: true }, lineasSinCuenta: 0, errorCarga: null, desde: "2026-10-01", hasta: "2026-10-31", hoy: "2026-10-17" };
  const codigos = () => [...c.querySelectorAll("tbody tr")].map((r) => r.querySelector("td .font-mono")?.textContent);

  test("por defecto solo cuentas con movimiento; el nivel y la búsqueda filtran", async () => {
    await montar(h(BalancePruebaClient, base));
    assert.deepEqual(codigos(), ["1", "11", "1110", "111005", "111010"]);
    await escribir(c.querySelector<HTMLSelectElement>("#bp-nivel")!, "2", "change");
    assert.deepEqual(codigos(), ["1", "11"]);
    await escribir(c.querySelector<HTMLSelectElement>("#bp-nivel")!, "0", "change");
    await escribir(c.querySelector<HTMLInputElement>("#bp-buscar")!, "usd");
    assert.deepEqual(codigos(), ["111010"]);
    assert.match(c.querySelector("tbody tr td:last-child")!.className, /text-amber-700/, "saldo contrario resaltado");
  });

  test("indica si cuadra o el valor del descuadre, y avisa líneas sin cuenta", async () => {
    await montar(h(BalancePruebaClient, base));
    assert.match(c.textContent ?? "", /Cuadra/);
    await act(async () => root!.unmount()); c.remove();
    await montar(h(BalancePruebaClient, { ...base, totales: { debitos: 10, creditos: 7, cuadra: false }, lineasSinCuenta: 2 }));
    assert.match(c.textContent ?? "", /Descuadre de \$\s?3/);
    assert.match(c.textContent ?? "", /2 línea\(s\) apuntan a una cuenta que no está en el PUC/);
  });
});
