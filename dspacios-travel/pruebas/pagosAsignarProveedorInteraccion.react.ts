// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `PagosList.tsx` → AsignarProveedor, tras
// reemplazar el input+datalist de texto libre por `ComboNombre` (el contrato
// persistido es el NOMBRE, no un id):
//   - Elegir un proveedor del catálogo y "Asignar" envía EXACTAMENTE ese
//     nombre (sin texto arbitrario).
//   - Escribir DESPUÉS de elegir invalida la selección: "Asignar" queda
//     deshabilitado y nunca se manda un nombre fantasma.
// Se sustituyen (vía reactLoader) la Server Actions real, `DateInput`
// (react-day-picker no está en el entorno) y `next/link` (stub ya existente).
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
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { PagosList } = await import("../app/(dashboard)/dashboard/pagos/PagosList.tsx");
const { __setImpls } = await import("./support/stubs/pagosActionsStub.mjs");
const { act, createElement: h } = React;

const asignaciones: Array<[number, string]> = [];
__setImpls({
  asignarProveedorCuentaPorPagar: async (id: number, nombre: string) => {
    asignaciones.push([id, nombre]);
    return { ok: true } as const;
  },
  registrarPagoProveedor: async () => ({ ok: true } as const),
  deshacerUltimoPago: async () => ({ ok: true } as const),
  configurarFacturaProveedor: async () => ({ ok: true } as const),
});

const ROW = {
  id: 5, numero_contrato: "C-001", proveedor: null, tipo_proveedor: null, servicio: "Hotel Sol",
  valor_total: 1_000_000, moneda: "COP", fecha_obligacion: null, fecha_vencimiento: "2026-10-01",
  aplica_retencion: null, pct_retencion: null, clasificacion: "costo" as const, base_gravable: null,
  iva_proveedor: null, pagos: [], pagado: 0, retenido: 0, saldo: 1_000_000,
};

const CATALOGO = ["Hotel Alpha", "Hotel Beta", "Agencia Gamma", "Vuelos Delta"];

function Harness() {
  return h(PagosList, { rows: [ROW], proveedores: [], catalogo: CATALOGO, ivaPct: 0.19 });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render() {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  asignaciones.length = 0;
  await act(async () => root!.render(h(Harness)));
}

async function abrirDetalle() {
  const fila = [...container.querySelectorAll("tr")].find((t) => t.textContent?.includes("C-001"));
  assert.ok(fila, "no se encontró la fila de la cuenta");
  await act(async () => fila!.click());
}

const combo = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const btnAsignar = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Asignar");

async function enfocar() {
  await act(async () => combo().focus());
}

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(combo(), valor);
    combo().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function elegirConRaton(nombre: string) {
  const opcion = [...container.querySelectorAll('[role="option"]')].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

async function clic(btn: HTMLElement | undefined, fallo = "botón no encontrado") {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("elegir un proveedor del catálogo y Asignar envía exactamente su nombre", async () => {
  await render();
  await abrirDetalle();
  await enfocar();
  await elegirConRaton("Hotel Beta");
  assert.equal(combo().value, "Hotel Beta", "el combo muestra el proveedor elegido");
  await clic(btnAsignar(), "faltó el botón Asignar");
  assert.deepEqual(asignaciones, [[5, "Hotel Beta"]], "la action recibe el nombre exacto (no un id ni texto libre)");
});

test("escribir DESPUÉS de elegir invalida la selección: Asignar se deshabilita (sin nombre fantasma)", async () => {
  await render();
  await abrirDetalle();
  await enfocar();
  await elegirConRaton("Hotel Beta");
  const antes = btnAsignar() as HTMLButtonElement;
  assert.ok(!antes.disabled, "Asignar habilitado con un proveedor elegido");
  await escribir("Alfa");                // cambia la búsqueda → invalida el nombre elegido
  assert.ok((btnAsignar() as HTMLButtonElement).disabled, "Asignar se deshabilita al invalidar la selección");
  assert.deepEqual(asignaciones, [], "no se asignó nada con el nombre anterior ni con texto escrito");
});

test("el combo solo ofrece proveedores del catálogo (sin texto arbitrario persistente)", async () => {
  await render();
  await abrirDetalle();
  await enfocar();
  const textos = [...container.querySelectorAll('[role="option"]')].map(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim()
  );
  assert.deepEqual(textos, ["Hotel Alpha", "Hotel Beta", "Agencia Gamma", "Vuelos Delta"], "opciones = catálogo");
});