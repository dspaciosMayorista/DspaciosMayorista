// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de la columna "Política de reservas" de
// `ProveedoresClient.tsx`:
//   - La fila muestra un resumen recortado a 2 líneas (line-clamp-2) + "Ver más".
//   - Política vacía / null / solo espacios → "—" sin botón.
//   - "Ver más" abre un diálogo (components/ui/dialog.tsx) con la política
//     COMPLETA, saltos de línea preservados y scroll propio; el diálogo va en
//     un portal fuera de la tabla (la fila no crece mientras está abierto).
//   - Escape y "Cerrar" cierran el diálogo; el foco vuelve a "Ver más".
//   - Editar sigue cargando la política completa en el formulario.
//   - La paginación (10 por página) muestra el resumen correcto por página.
import { test, afterEach, after } from "node:test";
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
const { ProveedoresClient } = await import("../app/(dashboard)/dashboard/producto/proveedores/ProveedoresClient.tsx");
const { __setImpls } = await import("./support/stubs/proveedoresActionsStub.mjs");
const { act, createElement: h } = React;

const llamadas: string[] = [];
__setImpls({
  crearProveedor: async () => { llamadas.push("crear"); return { ok: true } as const; },
  actualizarProveedor: async () => { llamadas.push("actualizar"); return { ok: true } as const; },
  eliminarProveedor: async () => { llamadas.push("eliminar"); },
});

function prov(id: number, nombre: string, politica: string | null) {
  return {
    id, tipo: null, nombre, razon_social: null, nit: null, ciudad: null, contacto: null,
    datos_pago: null, banco: null, tipo_cuenta: null, numero_cuenta: null,
    politica_reservas: politica, voucher_contacto: null,
    aplica_retencion: false, pct_retencion: 0, clasificacion: "costo",
  } as const;
}

const LARGA = "Línea 1: pago 30 días antes\nLínea 2: sin reembolso\n\nLínea 4: cambios con penalidad\n" + "x".repeat(2000);

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(proveedores: ReturnType<typeof prov>[]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(ProveedoresClient, { proveedores, destinos: [] })));
}

const filas = () => [...container.querySelectorAll("tbody tr")];
const filaDe = (nombre: string) => filas().find((tr) => tr.children[1]?.textContent === nombre)!;
const celdaPolitica = (nombre: string) => filaDe(nombre).children[5] as HTMLElement;
const botonEn = (el: ParentNode, texto: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const esperar = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function clic(btn: HTMLElement | undefined, fallo = "botón no encontrado") {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await esperar();
}

async function escape() {
  const destino = (document.activeElement as HTMLElement | null) ?? document.body;
  await act(async () => {
    destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await esperar(50);
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
  llamadas.length = 0;
});
after(() => dom.window.close());

test("la fila muestra un resumen de 2 líneas con 'Ver más'; vacías muestran — sin botón", async () => {
  await render([prov(1, "Alpha", LARGA), prov(2, "Beta", null), prov(3, "Gamma", ""), prov(4, "Delta", "  \n ")]);
  const resumen = celdaPolitica("Alpha").querySelector<HTMLElement>("[data-politica-resumen]")!;
  assert.ok(resumen, "hay resumen para política no vacía");
  for (const c of ["line-clamp-2", "whitespace-pre-wrap", "break-words"]) assert.ok(resumen.classList.contains(c), `resumen con ${c}`);
  assert.ok(botonEn(celdaPolitica("Alpha"), "Ver más"), "Alpha tiene 'Ver más'");
  for (const n of ["Beta", "Gamma", "Delta"]) {
    assert.equal(celdaPolitica(n).textContent, "—", `${n}: muestra —`);
    assert.equal(celdaPolitica(n).querySelector("button"), null, `${n}: sin botón`);
  }
  assert.equal(dialogo(), null, "ningún diálogo abierto al cargar");
});

test("'Ver más' abre la política completa con saltos de línea y scroll propio, fuera de la tabla", async () => {
  await render([prov(1, "Alpha", LARGA)]);
  await clic(botonEn(celdaPolitica("Alpha"), "Ver más"));
  const d = dialogo();
  assert.ok(d, "se abre el diálogo");
  assert.ok(!container.contains(d), "el diálogo vive en un portal, no dentro de la tabla");
  assert.match(d!.textContent ?? "", /Política de reservas/);
  assert.match(d!.textContent ?? "", /Alpha/, "muestra de qué proveedor es");
  const completa = d!.querySelector<HTMLElement>("[data-politica-completa]")!;
  assert.equal(completa.textContent, LARGA, "texto completo, sin recortar y con \\n intactos");
  for (const c of ["whitespace-pre-wrap", "overflow-y-auto", "max-h-[60vh]"]) assert.ok(completa.classList.contains(c), `cuerpo con ${c}`);
  const resumenAhora = celdaPolitica("Alpha").querySelector<HTMLElement>("[data-politica-resumen]")!;
  assert.ok(resumenAhora.classList.contains("line-clamp-2"), "la celda sigue recortada con el diálogo abierto");
});

test("Escape cierra el diálogo y el foco vuelve a 'Ver más'", async () => {
  await render([prov(1, "Alpha", LARGA)]);
  const ver = botonEn(celdaPolitica("Alpha"), "Ver más")!;
  await act(async () => ver.focus());
  await clic(ver);
  assert.ok(dialogo(), "abierto");
  assert.ok(dialogo()!.contains(document.activeElement), "el foco entra al diálogo");
  await escape();
  assert.equal(dialogo(), null, "Escape lo cierra");
  assert.equal(document.activeElement, botonEn(celdaPolitica("Alpha"), "Ver más"), "foco devuelto al disparador");
});

test("el botón 'Cerrar' cierra el diálogo", async () => {
  await render([prov(1, "Alpha", LARGA)]);
  await clic(botonEn(celdaPolitica("Alpha"), "Ver más"));
  await clic(botonEn(dialogo()!, "Cerrar"), "falta 'Cerrar'");
  assert.equal(dialogo(), null);
});

test("Editar sigue cargando la política COMPLETA en el formulario (sin guardar nada)", async () => {
  await render([prov(1, "Alpha", LARGA)]);
  await clic(botonEn(filaDe("Alpha"), "Editar"));
  assert.equal(container.querySelector("textarea")!.value, LARGA);
  assert.deepEqual(llamadas, [], "abrir/editar no llama a ninguna acción de guardado");
});

test("paginación: cada página muestra el resumen de sus proveedores y el diálogo del correcto", async () => {
  const lista = Array.from({ length: 12 }, (_, i) => prov(i + 1, `P${String(i + 1).padStart(2, "0")}`, i === 10 ? "Política P11\nsegunda" : null));
  await render(lista);
  assert.equal(filas().length, 10);
  assert.equal(filaDe("P11"), undefined, "P11 está en la página 2");
  await clic(botonEn(container, "Siguiente →"));
  assert.equal(filas().length, 2);
  assert.equal(celdaPolitica("P12").textContent, "—");
  await clic(botonEn(celdaPolitica("P11"), "Ver más"));
  assert.equal(dialogo()!.querySelector("[data-politica-completa]")!.textContent, "Política P11\nsegunda");
  await escape();
  assert.equal(dialogo(), null);
  await clic(botonEn(container, "← Anterior"));
  assert.equal(filas().length, 10);
});
