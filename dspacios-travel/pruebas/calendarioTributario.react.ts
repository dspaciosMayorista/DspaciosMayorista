// #43-1a — Calendario tributario: interacción del componente real.
// Uso directo (no está en package.json):
//   node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/calendarioTributario.react.ts
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

// `next` no publica mapa "exports": en ESM plano "next/navigation" no resuelve.
register("data:text/javascript," + encodeURIComponent(
  'export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {} }) } });

const llamadas: { fn: string; args: unknown[] }[] = [];
const accion = (fn: string) => async (...args: unknown[]) => { llamadas.push({ fn, args }); return { ok: true }; };
mock.module(new URL("../app/(dashboard)/dashboard/contabilidad/calendario-tributario/actions.ts", import.meta.url).href, {
  namedExports: Object.fromEntries(["guardarObligacion", "eliminarObligacion", "guardarFechas", "registrarCumplimiento"].map((n) => [n, accion(n)])),
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarioTributarioClient } = await import("../app/(dashboard)/dashboard/contabilidad/calendario-tributario/CalendarioTributarioClient.tsx");
const { fechaNegocio } = await import("../lib/fechaNegocio.ts");
const { act, createElement: h } = React;
type Props = Parameters<typeof CalendarioTributarioClient>[0];

let root: ReturnType<typeof createRoot> | undefined;
let contenedor: HTMLDivElement;
async function montar(p: Partial<Props>) {
  const base: Props = { hoy: "2026-10-17", anio: 2026, nit: "900123457", obligaciones: [], notas: {}, vencimientos: [], cumplimientos: [], items: [], sinResolver: [] };
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  root = createRoot(contenedor);
  await act(async () => root!.render(h(CalendarioTributarioClient, { ...base, ...p })));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; contenedor?.remove(); llamadas.length = 0; });
after(() => dom.window.close());

const boton = (texto: string | RegExp) => {
  const b = [...contenedor.querySelectorAll("button")].find((x) => {
    const t = (x.textContent ?? "").trim();
    return typeof texto === "string" ? t === texto : texto.test(t);
  });
  assert.ok(b, `falta el botón ${texto}`);
  return b as HTMLButtonElement;
};
async function clic(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); });
}
async function escribir(el: HTMLInputElement | HTMLSelectElement, valor: string, evento = "input") {
  await act(async () => {
    const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event(evento, { bubbles: true }));
  });
}
const campoFecha = (aria: string) => {
  const el = contenedor.querySelector<HTMLInputElement>(`input[aria-label="${aria}"]`);
  assert.ok(el, `falta el campo de fecha ${aria}`);
  return el;
};

const OB = { id: 1, nombre: "Retención en la fuente", periodicidad: "mensual" as const, reglaDigitos: 1 as const, diasAviso: 10, requierePago: true, activa: true };
const item = (periodo: number, fecha: string, estado: Props["items"][number]["estado"], dias: number, extra: Partial<Props["items"][number]> = {}) => ({
  obligacionId: 1, obligacion: "Retención en la fuente", requierePago: true, anio: 2026, periodo,
  etiqueta: `Periodo ${periodo}`, fecha, diasRestantes: dias, estado, presentadaEn: null, pagadaEn: null, ...extra,
});

describe("#43-1a obligaciones", () => {
  test("sin obligaciones abre en Obligaciones y crea una con los valores elegidos", async () => {
    await montar({});
    assert.equal(contenedor.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "Obligaciones");
    await escribir(contenedor.querySelector<HTMLInputElement>("#ob-nombre")!, "IVA (formulario 300)");
    await escribir(contenedor.querySelector<HTMLSelectElement>("#ob-periodicidad")!, "bimestral", "change");
    await escribir(contenedor.querySelector<HTMLInputElement>("#ob-aviso")!, "15");
    await clic([...contenedor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]); // requiere pago -> no
    await clic(boton(/Agregar obligación/));
    assert.deepEqual(llamadas, [{ fn: "guardarObligacion", args: [{
      nombre: "IVA (formulario 300)", periodicidad: "bimestral", reglaDigitos: 1, diasAviso: 15, requierePago: false, activa: true, notas: "",
    }] }]);
  });
});

describe("#43-1a vencimientos", () => {
  const items = [
    item(8, "2026-09-10", "vencida", -37),
    item(9, "2026-10-13", "falta_pago", -4, { presentadaEn: "2026-10-12" }),
    item(10, "2026-10-20", "proxima", 3),
    item(7, "2026-08-12", "cumplida", -66, { presentadaEn: "2026-08-10", pagadaEn: "2026-08-10" }),
    item(12, "2027-01-20", "futura", 95),
  ];
  test("por defecto muestra lo pendiente y lo próximo; los avisos de configuración quedan a la vista", async () => {
    await montar({ obligaciones: [OB], items, sinResolver: [{ obligacionId: 2, obligacion: "ICA", motivo: "No hay fechas de vencimiento cargadas." }] });
    const filas = () => [...contenedor.querySelectorAll("tbody tr")].map((t) => t.querySelector('[data-label="Periodo"]')?.textContent);
    assert.deepEqual(filas(), ["Periodo 8", "Periodo 9", "Periodo 10"]);
    assert.match(contenedor.textContent ?? "", /ICA:\s*No hay fechas de vencimiento cargadas/);
    assert.match(contenedor.textContent ?? "", /Vencidas: 1.*Falta pago: 1.*Próximas: 1/);
    await clic(contenedor.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    assert.deepEqual(filas(), ["Periodo 8", "Periodo 9", "Periodo 10", "Periodo 7", "Periodo 12"]);
  });

  test("Registrar guarda presentación (con el botón Hoy) y pago", async () => {
    await montar({ obligaciones: [OB], items });
    await clic(contenedor.querySelector<HTMLButtonElement>('button[aria-label^="Registrar presentación o pago: Retención en la fuente, Periodo 10"]')!);
    await clic(boton("Hoy"));
    await escribir(campoFecha("Fecha de pago"), "20/10/2026");
    await clic(boton("Guardar"));
    assert.deepEqual(llamadas, [{ fn: "registrarCumplimiento", args: [{
      obligacionId: 1, anio: 2026, periodo: 10, presentadaEn: fechaNegocio(), pagadaEn: "2026-10-20", nota: "",
    }] }]);
  });

  test("una obligación sin pago no pide fecha de pago", async () => {
    await montar({ obligaciones: [{ ...OB, requierePago: false }], items: [item(10, "2026-10-20", "proxima", 3, { requierePago: false })] });
    await clic(boton(/Registrar/));
    assert.ok(campoFecha("Fecha de presentación"));
    assert.equal(contenedor.querySelector('input[aria-label="Fecha de pago"]'), null);
  });
});

describe("#43-1a fechas por año", () => {
  async function abrirFechas(p: Partial<Props>) {
    await montar({ obligaciones: [OB], ...p });
    await clic(boton("Fechas por año"));
  }

  test("una mensual por último dígito: 12 periodos × 10 dígitos y el del NIT resaltado", async () => {
    await abrirFechas({});
    assert.equal(contenedor.querySelectorAll("fieldset").length, 12);
    assert.equal(contenedor.querySelector("fieldset")!.querySelectorAll('input[type="text"]').length, 10);
    assert.match(contenedor.querySelector("fieldset")!.textContent ?? "", /Dígito 7 · su NIT/);
  });

  test("Guardar envía solo las celdas cambiadas; vaciar una celda la borra", async () => {
    await abrirFechas({ vencimientos: [{ obligacionId: 1, anio: 2026, periodo: 1, digitos: "7", fecha: "2026-02-10" }] });
    assert.equal(campoFecha("Enero 2026, dígito 7").value, "10/02/2026");
    await escribir(campoFecha("Enero 2026, dígito 7"), "");
    await escribir(campoFecha("Febrero 2026, dígito 3"), "17/03/2026");
    await clic(boton(/Guardar fechas \(2\)/));
    assert.equal(llamadas.length, 1);
    const [obId, anio, filas] = llamadas[0].args as [number, number, { periodo: number; digitos: string; fecha: string | null }[]];
    assert.deepEqual([obId, anio], [1, 2026]);
    assert.deepEqual([...filas].sort((a, b) => a.periodo - b.periodo), [
      { periodo: 1, digitos: "7", fecha: null }, { periodo: 2, digitos: "3", fecha: "2026-03-17" },
    ]);
  });

  test("anual con fecha común: un solo campo 'Todos'; con dos dígitos se agregan a mano", async () => {
    await abrirFechas({ obligaciones: [{ ...OB, id: 3, periodicidad: "anual", reglaDigitos: 0 }] });
    assert.equal(contenedor.querySelectorAll("fieldset").length, 1);
    assert.ok(campoFecha("Año 2026, todos"));
    await act(async () => root!.unmount()); contenedor.remove();
    await abrirFechas({ obligaciones: [{ ...OB, id: 4, periodicidad: "anual", reglaDigitos: 2 }] });
    assert.equal(contenedor.querySelector("fieldset")!.querySelectorAll('input[aria-label^="Año 2026, dígito"]').length, 0);
    await escribir(contenedor.querySelector<HTMLInputElement>("#f-1-nuevo")!, "57");
    await clic(boton(/^Agregar$/));
    assert.ok(campoFecha("Año 2026, dígito 57"));
    assert.match(contenedor.textContent ?? "", /Dígitos 57 · su NIT/);
  });
});
