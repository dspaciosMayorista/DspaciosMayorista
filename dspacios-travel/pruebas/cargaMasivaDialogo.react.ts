// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// Prueba de INTERACCIÓN de `CargaMasivaCSV` en su variante "dialogo" (Proveedores):
//   - El botón abre un diálogo con plantilla, pegado de CSV, conteo, resultado y errores.
//   - Escape cierra y devuelve el foco al botón; el diálogo permite desplazamiento vertical.
//   - La variante por defecto (acordeón) conserva su aspecto y no usa diálogo.
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
const { CargaMasivaCSV } = await import("../components/CargaMasivaCSV.tsx");
const { act, createElement: h } = React;

const COLS = [{ key: "nombre", label: "Nombre", ejemplo: "GHL" }, { key: "nit", label: "NIT", ejemplo: "1" }];
const enviados: Record<string, string>[][] = [];
let respuesta = { ok: true, insertados: 2, errores: [] as string[] };
const onSubmit = async (rows: Record<string, string>[]) => { enviados.push(rows); return respuesta; };

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const esperar = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function render(variante?: "dialogo") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(CargaMasivaCSV, {
    titulo: "Carga masiva de proveedores (CSV)", descripcion: "Cada fila = un proveedor.", nota: "Cárgalos primero.",
    columnas: COLS, onSubmit, nombreArchivo: "plantilla", variante, textoBoton: "Carga masiva (CSV)",
  })));
}
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const boton = (ambito: ParentNode, texto: string) =>
  [...ambito.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(texto)) as HTMLButtonElement | undefined;
async function clic(el: HTMLElement | undefined) {
  assert.ok(el, "elemento no encontrado");
  await act(async () => el!.click());
  await esperar();
}
async function pegar(texto: string) {
  const ta = dialogo()!.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(ta, texto);
    ta.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
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
  enviados.length = 0;
  respuesta = { ok: true, insertados: 2, errores: [] };
});
after(() => dom.window.close());

test("variante diálogo: solo un botón hasta pulsarlo; abre con plantilla, pegado y mensajes", async () => {
  await render("dialogo");
  assert.equal(dialogo(), null);
  assert.equal(container.querySelector("section"), null, "sin acordeón");
  const btn = boton(container, "Carga masiva (CSV)")!;
  await clic(btn);
  const d = dialogo()!;
  assert.ok(d, "abre el diálogo");
  assert.match(d.textContent ?? "", /Carga masiva de proveedores \(CSV\)/);
  assert.match(d.textContent ?? "", /Cada fila = un proveedor/);
  assert.match(d.textContent ?? "", /Antes de cargar/);
  assert.ok(boton(d, "Descargar plantilla CSV"));
  assert.match(d.className, /overflow-y-auto/);
  assert.match(d.className, /max-h-\[90dvh\]/);
});

test("pegar CSV muestra filas listas, sube con la misma lógica y muestra el resultado", async () => {
  await render("dialogo");
  await clic(boton(container, "Carga masiva (CSV)"));
  await pegar("nombre;nit\nGHL;1\nDecameron;2");
  assert.match(dialogo()!.textContent ?? "", /2 fila\(s\) listas/);
  await clic(boton(dialogo()!, "Subir 2 fila(s)"));
  assert.deepEqual(enviados, [[{ nombre: "GHL", nit: "1" }, { nombre: "Decameron", nit: "2" }]]);
  assert.match(dialogo()!.textContent ?? "", /2\s*registro\(s\) cargado\(s\)/);
});

test("errores de parseo y de carga se muestran en el diálogo", async () => {
  await render("dialogo");
  await clic(boton(container, "Carga masiva (CSV)"));
  await pegar("solo encabezado");
  assert.match(dialogo()!.textContent ?? "", /necesita una fila de encabezados/);
  respuesta = { ok: false, insertados: 0, errores: ["Fila 2: tipo inválido"] };
  await pegar("nombre;nit\nX;1");
  await clic(boton(dialogo()!, "Subir 1 fila(s)"));
  assert.match(dialogo()!.textContent ?? "", /Fila 2: tipo inválido/);
});

test("Escape cierra el diálogo y devuelve el foco al botón", async () => {
  await render("dialogo");
  const btn = boton(container, "Carga masiva (CSV)")!;
  await act(async () => btn.focus());
  await clic(btn);
  assert.ok(dialogo());
  await escape();
  assert.equal(dialogo(), null);
  assert.equal(document.activeElement, btn);
});

test("variante por defecto: acordeón de siempre, sin diálogo", async () => {
  await render();
  assert.ok(container.querySelector("section"));
  await clic(boton(container, "Carga masiva de proveedores"));
  assert.equal(dialogo(), null);
  assert.ok(boton(container, "Descargar plantilla CSV"));
});
