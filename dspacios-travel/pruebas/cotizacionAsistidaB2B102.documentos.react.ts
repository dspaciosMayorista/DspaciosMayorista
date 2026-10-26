// Se ejecuta con npm run test:react (loader del arnés).
// #102 — Lo que ve el COMPRADOR de una venta B2B asistida y el catálogo donde se desactiva a un aliado.
//   · Documento de la cotización (ContratoDocumento REAL renderizado a HTML, el mismo componente del imprimible y del enlace público):
//     en NETO muestra el total exigible y los valores por ítem prorrateados, sin el PVP original ni la comisión; en PVP con comisión es el de
//     siempre; sin plan B2B no cambia.
//   · Catálogo de aliados (AliadosClient REAL): el interruptor «Activo» escribe `{ activo }` por la acción del servidor.
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const G = "globalThis.__aliados102";
const ACCIONES_ALIADOS = `data:text/javascript,${encodeURIComponent(`
  export async function crearAliado(...a) { ${G}.llamadas.push(['crear', a]); return { ok: true }; }
  export async function actualizarAliado(...a) { ${G}.llamadas.push(['actualizar', a]); return { ok: true }; }
  export async function eliminarAliado(...a) { ${G}.llamadas.push(['eliminar', a]); return { ok: true }; }
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions" && (context.parentURL ?? "").endsWith("/AliadosClient.tsx")) return { url: ACCIONES_ALIADOS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const estadoAliados = { llamadas: [] as [string, unknown[]][] };
(globalThis as unknown as { __aliados102: typeof estadoAliados }).__aliados102 = estadoAliados;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { AliadosClient } = await import("../app/(dashboard)/dashboard/aliados/AliadosClient.tsx");
const { formatMoneda } = await import("../lib/utils.ts");
const { netoTotalExigibleDeDetalle } = await import("../lib/cotizacion/asistidaB2B.ts");
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// ── Documento de la cotización ────────────────────────────────────────────
// Cotización de carrito: hotel (2 adultos × 500.000) + servicio (300.000) = PVP 1.300.000; impuesto 200.000 → base 1.100.000; 10 % = 110.000;
// NETO exigible = 1.190.000. Los ítems de la cotización guardan PVP (igual que los de un contrato).
const PVP = 1_300_000;
const COMISION = 110_000;
const NETO = 1_190_000;
const venta = {
  numero_contrato: "", cliente: "Ana Pérez", cliente_documento: "123", cliente_direccion: null, cliente_telefono: "300", estado: "pendiente",
  fecha_emision: "2030-02-01", fecha_salida: "2030-03-01", fecha_regreso: "2030-03-04", pax: 2, plan_nombre: "Estandar · Desayuno", tours_traslados: null,
  asistencia_medica: null, moneda: "COP", destino: "CARTAGENA",
};
const items = [
  { id: 1, numero_contrato: "", descripcion: "Hotel Aurora — CARTAGENA · 1 hab Doble (2 pax) · Estandar / Desayuno", adultos: 2, ninos: 0, tarifa_adulto: 500_000, tarifa_nino: 0, orden: 0, modo_precio: "por_persona", valor_total: null },
  { id: 2, numero_contrato: "", descripcion: "Servicio · Islas del Rosario — CARTAGENA", adultos: 1, ninos: 0, tarifa_adulto: 300_000, tarifa_nino: 0, orden: 1, modo_precio: "por_persona", valor_total: null },
];
function documento(netoTotalExigible: number | null) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: 0, esCotizacion: true, codigo: "COT-102", vigenciaHasta: "2030-02-20", netoTotalExigible } as never;
  return renderToStaticMarkup(createElement(ContratoDocumento, props)).replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ");
}
const $ = (n: number) => formatMoneda(n, "COP").replace(/\u00a0/g, " ");

describe("documento de la cotización B2B asistida (lo que ve el comprador)", () => {
  test("NETO: total exigible y valores prorrateados; jamás el PVP original ni la comisión", () => {
    const texto = documento(NETO);
    assert.match(texto, /COTIZACIÓN/);
    assert.ok(texto.includes(`Total del contrato ${$(NETO)}`), "el total es el exigible");
    for (const v of [PVP, COMISION, 500_000, 1_000_000, 300_000]) assert.ok(!texto.includes($(v)), `no aparece ${$(v)}`);
    assert.doesNotMatch(texto, /comisi[oó]n/i);
    assert.match(texto, /Tarifa Adulto NETO/);
    assert.match(texto, /Hotel Aurora/);
    assert.match(texto, /Islas del Rosario/);
  });

  test("PVP con comisión: el documento es el de siempre (PVP) y tampoco menciona la comisión", () => {
    const texto = documento(null);
    assert.ok(texto.includes(`Total del contrato ${$(PVP)}`));
    assert.ok(!texto.includes($(COMISION)));
    assert.doesNotMatch(texto, /comisi[oó]n|NETO/i);
  });

  test("el dato que llega al documento es SOLO el total exigible leído de `detalle.b2bExterno`", () => {
    assert.equal(netoTotalExigibleDeDetalle({ netoTotalExigible: NETO }), NETO);
    for (const malo of [undefined, null, {}, { netoTotalExigible: 0 }, { netoTotalExigible: -5 }, { netoTotalExigible: "1190000" }, { netoTotalExigible: Number.NaN }, "x", []]) {
      assert.equal(netoTotalExigibleDeDetalle(malo), null, JSON.stringify(malo));
    }
  });
});

// ── Catálogo de aliados: desactivar ───────────────────────────────────────
const aliado = (id: number, nombre: string, activo: boolean) => ({
  id, nombre, tipo: "agencia", nit: null, tipo_documento: "NIT", direccion: null, contacto: null, email: null, telefono: null, pct_comision: 0.1,
  aplica_retencion: false, pct_retencion: 0, banco: null, tipo_cuenta: null, numero_cuenta: null, activo,
});

describe("catálogo de aliados: interruptor «Activo»", () => {
  beforeEach(() => { estadoAliados.llamadas.length = 0; });

  async function montar() {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => {
      root.render(createElement(AliadosClient, { aliados: [aliado(1, "Viajes Aurora", true), aliado(2, "Agencia Dormida", false)], defAgencia: 0.12, defFreelance: 0.11 } as never));
      await espera();
    });
    return { c, desmontar: () => { act(() => root.unmount()); c.remove(); } };
  }
  const casilla = (c: HTMLElement, nombre: string) => c.querySelector<HTMLInputElement>(`input[aria-label="${nombre} activo"]`)!;

  test("refleja el estado de cada aliado y avisa para qué sirve", async () => {
    const { c, desmontar } = await montar();
    assert.equal(casilla(c, "Viajes Aurora").checked, true);
    assert.equal(casilla(c, "Agencia Dormida").checked, false);
    assert.match(casilla(c, "Viajes Aurora").title, /no se puede elegir en ventas B2B asistidas/);
    assert.match(c.textContent ?? "", /Activo/);
    desmontar();
  });

  test("desactivar y reactivar escribe solo `{ activo }` con el id del aliado", async () => {
    const { c, desmontar } = await montar();
    await act(async () => { casilla(c, "Viajes Aurora").dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await espera(); });
    await act(async () => { casilla(c, "Agencia Dormida").dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await espera(); });
    assert.deepEqual(estadoAliados.llamadas, [["actualizar", [1, { activo: false }]], ["actualizar", [2, { activo: true }]]]);
    desmontar();
  });
});
