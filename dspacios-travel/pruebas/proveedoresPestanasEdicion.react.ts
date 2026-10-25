// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `ProveedoresClient.tsx` rediseñado en pestañas:
//   - Dos pestañas: "Creación o configuración" (por defecto) y "Listado de proveedores".
//   - Cambiar de pestaña conserva el borrador del formulario y la búsqueda del listado.
//   - Editar abre un diálogo accesible con los datos actuales; Guardar cierra el
//     diálogo y la fila muestra el dato nuevo conservando la búsqueda; Cancelar y
//     Escape no guardan; un error de guardado deja el diálogo abierto con mensaje.
//   - Nombre vacío: mensaje de error asociado al campo y sin llamar a la acción.
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

type Llamada = { accion: string; id?: number; nombre?: string };
const llamadas: Llamada[] = [];
let resultadoActualizar: { ok: true } | { ok: false; error: string } = { ok: true };
__setImpls({
  crearProveedor: async (i: { nombre: string }) => { llamadas.push({ accion: "crear", nombre: i.nombre }); return { ok: true } as const; },
  actualizarProveedor: async (id: number, i: { nombre: string }) => { llamadas.push({ accion: "actualizar", id, nombre: i.nombre }); return resultadoActualizar; },
  eliminarProveedor: async () => {},
});

function prov(id: number, nombre: string) {
  return {
    id, tipo: "hotelero", nombre, razon_social: null, nit: null, ciudad: null, contacto: null,
    datos_pago: null, banco: null, tipo_cuenta: null, numero_cuenta: null,
    politica_reservas: null, voucher_contacto: null,
    aplica_retencion: false, pct_retencion: 0, clasificacion: "costo",
  } as const;
}
const LISTA = [prov(1, "Alpha"), prov(2, "Beta"), prov(3, "Alfa Norte")];

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const esperar = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(ProveedoresClient, { proveedores: LISTA, destinos: [] })));
}

const tab = (texto: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes(texto))!;
const buscador = () => container.querySelector<HTMLInputElement>('input[type="search"]')!;
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const filas = () => [...container.querySelectorAll("tbody tr")];
const nombresVisibles = () => filas().map((tr) => tr.children[1]?.textContent);
const botonEn = (el: ParentNode, texto: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;

async function clic(el: HTMLElement | undefined, fallo = "elemento no encontrado") {
  assert.ok(el, fallo);
  await act(async () => el!.click());
  await esperar();
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function escape() {
  const destino = (document.activeElement as HTMLElement | null) ?? document.body;
  await act(async () => {
    destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await esperar(50);
}
const campoNombreDialogo = () => dialogo()!.querySelector<HTMLInputElement>('input[aria-required="true"]')!;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
  llamadas.length = 0;
  resultadoActualizar = { ok: true };
});
after(() => dom.window.close());

test("hay dos pestañas, la de creación abierta por defecto, y se navega entre ellas", async () => {
  await render();
  const tabs = [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
  assert.equal(tabs.length, 2);
  assert.match(tabs[0] ?? "", /Creación o configuración/);
  assert.match(tabs[1] ?? "", /Listado de proveedores/);
  assert.equal(tab("Creación").getAttribute("aria-selected"), "true");
  await clic(tab("Listado"));
  assert.equal(tab("Listado").getAttribute("aria-selected"), "true");
  assert.deepEqual(nombresVisibles(), ["Alpha", "Beta", "Alfa Norte"]);
});

test("cambiar de pestaña conserva el borrador del formulario y la búsqueda", async () => {
  await render();
  const nombre = container.querySelector<HTMLInputElement>('input[aria-required="true"]')!;
  await escribir(nombre, "Borrador sin guardar");
  await clic(tab("Listado"));
  await escribir(buscador(), "alf");
  assert.deepEqual(nombresVisibles(), ["Alfa Norte"]);
  await clic(tab("Creación"));
  assert.equal(container.querySelector<HTMLInputElement>('input[aria-required="true"]')!.value, "Borrador sin guardar");
  await clic(tab("Listado"));
  assert.equal(buscador().value, "alf", "la búsqueda sigue ahí");
  assert.deepEqual(nombresVisibles(), ["Alfa Norte"]);
});

test("nombre vacío: muestra el error asociado al campo y no llama a la acción", async () => {
  await render();
  await clic(botonEn(container, "Agregar proveedor"));
  const campo = container.querySelector<HTMLInputElement>('input[aria-required="true"]')!;
  const alerta = container.querySelector<HTMLElement>('[role="alert"]')!;
  assert.match(alerta.textContent ?? "", /nombre es obligatorio/i);
  assert.equal(campo.getAttribute("aria-invalid"), "true");
  assert.equal(campo.getAttribute("aria-describedby"), alerta.id);
  assert.equal(document.activeElement, campo, "el foco vuelve al campo con error");
  assert.deepEqual(llamadas, []);
});

test("Editar abre un diálogo con los datos actuales; Guardar lo cierra y la fila se actualiza conservando la búsqueda", async () => {
  await render();
  await clic(tab("Listado"));
  await escribir(buscador(), "alf");
  const editar = botonEn(filas()[0], "Editar")!;
  await act(async () => editar.focus());
  await clic(editar);
  const d = dialogo();
  assert.ok(d, "se abre el diálogo");
  assert.ok(!container.contains(d), "vive en un portal sobre la pantalla");
  assert.match(d!.textContent ?? "", /Editar proveedor/);
  assert.equal(campoNombreDialogo().value, "Alfa Norte", "muestra la información actual");
  assert.ok(d!.contains(document.activeElement), "el foco entra al diálogo");
  const etiqueta = d!.querySelector(`label[for="${campoNombreDialogo().id}"]`);
  assert.ok(etiqueta, "el campo tiene etiqueta asociada");
  await escribir(campoNombreDialogo(), "Alfa Sur");
  await clic(botonEn(d!, "Guardar cambios"));
  assert.deepEqual(llamadas, [{ accion: "actualizar", id: 3, nombre: "Alfa Sur" }]);
  assert.equal(dialogo(), null, "el diálogo se cierra al guardar");
  assert.equal(buscador().value, "alf", "la búsqueda se conserva");
  assert.deepEqual(nombresVisibles(), ["Alfa Sur"], "la fila ya muestra el dato nuevo");
  assert.equal(tab("Listado").getAttribute("aria-selected"), "true", "sigue en el listado");
});

test("Cancelar y Escape cierran sin guardar y devuelven el foco al botón Editar", async () => {
  await render();
  await clic(tab("Listado"));
  const editar = botonEn(filaDeAlpha(), "Editar")!;
  await act(async () => editar.focus());
  await clic(editar);
  await escribir(campoNombreDialogo(), "Cambio descartado");
  await clic(botonEn(dialogo()!, "Cancelar"));
  assert.equal(dialogo(), null);
  assert.deepEqual(llamadas, [], "cancelar no guarda");
  assert.deepEqual(nombresVisibles(), ["Alpha", "Beta", "Alfa Norte"], "la fila no cambió");

  await clic(botonEn(filaDeAlpha(), "Editar"));
  assert.equal(campoNombreDialogo().value, "Alpha", "reabrir muestra el dato original, no el borrador");
  await escape();
  assert.equal(dialogo(), null, "Escape cierra");
  assert.deepEqual(llamadas, []);
  assert.equal(document.activeElement, botonEn(filaDeAlpha(), "Editar"), "foco devuelto a Editar");
});

test("un error de guardado deja el diálogo abierto con el mensaje y sin cambiar la fila", async () => {
  resultadoActualizar = { ok: false, error: "No tienes permiso para editar proveedores." };
  await render();
  await clic(tab("Listado"));
  await clic(botonEn(filaDeAlpha(), "Editar"));
  await escribir(campoNombreDialogo(), "Nuevo nombre");
  await clic(botonEn(dialogo()!, "Guardar cambios"));
  const d = dialogo();
  assert.ok(d, "el diálogo sigue abierto");
  assert.match(d!.querySelector('[role="alert"]')?.textContent ?? "", /No tienes permiso/);
  assert.deepEqual(nombresVisibles(), ["Alpha", "Beta", "Alfa Norte"], "la fila no se actualiza si falló");
  assert.equal(campoNombreDialogo().value, "Nuevo nombre", "el borrador del usuario se conserva para reintentar");
});

test("el campo Ciudad tiene nombre accesible 'Ciudad' en la creación y en el diálogo de edición", async () => {
  await render();
  const enCreacion = container.querySelector<HTMLInputElement>('input[placeholder="Ciudad…"]')!;
  const lbl = container.querySelector<HTMLLabelElement>(`label[for="${enCreacion.id}"]`);
  assert.ok(enCreacion.id, "el input tiene id");
  assert.equal(lbl?.textContent, "Ciudad", "el rótulo apunta al input");
  assert.equal(enCreacion.labels?.[0]?.textContent, "Ciudad", "nombre accesible por <label>");
  await clic(tab("Listado"));
  await clic(botonEn(filaDeAlpha(), "Editar"));
  const enDialogo = dialogo()!.querySelector<HTMLInputElement>('input[placeholder="Ciudad…"]')!;
  assert.equal(enDialogo.labels?.[0]?.textContent, "Ciudad");
  assert.notEqual(enDialogo.id, enCreacion.id, "ids distintos entre formularios");
});

function filaDeAlpha() {
  return filas().find((tr) => tr.children[1]?.textContent === "Alpha")!;
}
