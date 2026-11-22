// #76/#77 — interacción real de «Mis clientes» (jsdom). La Server Action se sustituye por un doble; FIXTURES LOCALES.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import nodeModule from "node:module";

// next/navigation no existe fuera de Next: solo para ClientesAliado se resuelve a un router falso (el loader compartido no se toca).
type Hook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
(nodeModule as unknown as { registerHooks: (h: { resolve: Hook }) => void }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && (context.parentURL ?? "").endsWith("/clientes/ClientesAliado.tsx")) return { url: `data:text/javascript,${encodeURIComponent("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; }")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const llamadas: Record<string, unknown>[] = [];
let respuesta: unknown = { ok: true, id: 5 };
mock.module(new URL("../app/portal/b2b/clientes/actions.ts", import.meta.url).href, {
  namedExports: { guardarCliente: async (e: Record<string, unknown>) => { llamadas.push(e); return respuesta; } },
});
const { ClientesAliado } = await import("../app/portal/b2b/clientes/ClientesAliado.tsx");

const items = [
  {
    clave: "maria perez", nombre: "María Pérez",
    guardado: { id: 1, tipo_documento: "CC", documento: "1010", email: "m@cliente.test", telefono: "3001112222", notas: "Prefiere WhatsApp", actualizado_en: "2026-11-02T10:00:00.000Z" },
    contratos: [{ numero_contrato: "00-0001", destino: "CARTAGENA", fecha_salida: "2026-12-10", estado: "confirmado" }, { numero_contrato: "00-0002", destino: "SANTA MARTA", fecha_salida: "2027-01-05", estado: "pendiente" }],
    cotizaciones: [],
  },
  { clave: "ana rios", nombre: "Ana Ríos", guardado: null, contratos: [], cotizaciones: [{ id: 1, codigo: "COT-1", destino: "CARTAGENA", fecha_salida: "2026-12-15", estado: "enviada" }] },
];

async function montar(props: Record<string, unknown> = {}) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(React.createElement(ClientesAliado, { items, puedeEditar: true, ...props } as never)); });
  return { cont, root };
}
async function escribir(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => { set.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
}
const boton = (c: HTMLElement, t: string) => [...c.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
const porEtiqueta = (c: HTMLElement, t: string) => { const l = [...c.querySelectorAll("label")].find((x) => x.textContent?.startsWith(t)); return c.querySelector(`#${l?.getAttribute("for")}`) as HTMLInputElement; };
const enviar = async (c: HTMLElement) => act(async () => { c.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });

test("lista cada cliente con sus conteos, el contacto guardado y sus contratos/cotizaciones; sin datos se avisa", async () => {
  const { cont, root } = await montar();
  const texto = cont.textContent ?? "";
  assert.match(texto, /María Pérez/);
  assert.match(texto, /2 contratos · 0 cotizaciones/);
  assert.match(texto, /Ana Ríos/);
  assert.match(texto, /0 contratos · 1 cotización · sin datos de contacto/);
  assert.match(texto, /CC 1010/); assert.match(texto, /m@cliente\.test/); assert.match(texto, /00-0002 · SANTA MARTA/);
  assert.match(texto, /COT-1 · CARTAGENA/);
  assert.match(texto, /no se comparten con otros aliados ni se usan en campañas/, "aviso corto de uso de datos");
  assert.equal(cont.querySelectorAll("li details").length, 2);
  await act(async () => root.unmount());
});

test("solo lectura (agente): no hay «Agregar cliente» ni edición", async () => {
  const { cont, root } = await montar({ puedeEditar: false });
  assert.equal(boton(cont, "Agregar cliente"), undefined);
  assert.equal(boton(cont, "Editar datos"), undefined);
  assert.equal(boton(cont, "Agregar datos de contacto"), undefined);
  await act(async () => root.unmount());
});

test("cliente nuevo: el envío lleva los campos escritos y la casilla; sin id; el error del servidor se muestra y el formulario sigue", async () => {
  llamadas.length = 0; respuesta = { ok: false, error: "Confirma que el cliente autorizó que guardes sus datos de contacto." };
  const { cont, root } = await montar();
  await act(async () => { boton(cont, "Agregar cliente").click(); });
  await escribir(porEtiqueta(cont, "Nombre del cliente"), "Laura Gil");
  await escribir(porEtiqueta(cont, "Teléfono"), "3001234567");
  await enviar(cont);
  assert.deepEqual(llamadas[0], { nombre: "Laura Gil", tipoDocumento: "", documento: "", email: "", telefono: "3001234567", notas: "", autorizacion: false, id: undefined, esperado: undefined });
  assert.match(cont.querySelector('[role="alert"]')?.textContent ?? "", /autorizó/);
  respuesta = { ok: true, id: 9 };
  await act(async () => { (cont.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
  await enviar(cont);
  assert.equal(llamadas[1].autorizacion, true);
  assert.equal(cont.querySelector("form"), null, "al guardar, el formulario se cierra");
  await act(async () => root.unmount());
});

test("editar un cliente guardado lleva su id y la versión que se vio; «agregar datos» a uno solo derivado crea (sin id)", async () => {
  llamadas.length = 0; respuesta = { ok: true, id: 1 };
  const { cont, root } = await montar();
  await act(async () => { boton(cont, "Editar datos").click(); });
  const f = cont.querySelector("form")!;
  assert.equal((porEtiqueta(cont, "Nombre del cliente")).value, "María Pérez");
  assert.equal((f.querySelector('input[type="checkbox"]') as HTMLInputElement).checked, true, "ya autorizado al guardarlo");
  await escribir(porEtiqueta(cont, "Teléfono"), "3009998888");
  await enviar(cont);
  assert.equal(llamadas[0].id, 1); assert.equal(llamadas[0].esperado, "2026-11-02T10:00:00.000Z"); assert.equal(llamadas[0].telefono, "3009998888");

  await act(async () => { boton(cont, "Agregar datos de contacto").click(); });
  assert.equal(porEtiqueta(cont, "Nombre del cliente").value, "Ana Ríos");
  await act(async () => { (cont.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
  await enviar(cont);
  assert.equal(llamadas[1].id, undefined);
  assert.equal(llamadas[1].nombre, "Ana Ríos");
  await act(async () => root.unmount());
});

test("sin clientes: mensaje de vacío que explica de dónde saldrán", async () => {
  const { cont, root } = await montar({ items: [] });
  assert.match(cont.textContent ?? "", /Aún no hay clientes/);
  await act(async () => root.unmount());
});
