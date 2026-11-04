// test:react (jsdom). Recorrido de /dashboard/usuarios con las Server Actions simuladas:
// rechazo de roles B2B en el formulario interno, búsqueda por documento, elección entre
// varias coincidencias y creación de ficha nueva.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { UsuariosClient } = await import("../app/(dashboard)/dashboard/usuarios/UsuariosClient.tsx");
const { __setImpls } = await import("./support/stubs/usuariosActionsStub.mjs");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;
async function montar() {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(h(UsuariosClient, { usuarios: [] })); });
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); });
after(() => dom.window.close());

const ph = (t: string) => host.querySelector(`input[placeholder="${t}"]`) as HTMLInputElement;
const boton = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
async function escribir(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const click = (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const FICHAS = [
  { id: 7, nombre: "Viajes Antiguos", nit: "900123", tipo_documento: "NIT", email: null },
  { id: 8, nombre: "Viajes Antiguos Sucursal", nit: "900123", tipo_documento: "NIT", email: "s@x.co" },
];

test("formulario interno: solo roles internos (sin agencia/freelance)", async () => {
  await montar();
  const opciones = [...host.querySelector("select")!.querySelectorAll("option")].map((o) => o.value);
  assert.ok(opciones.includes("venta"));
  assert.ok(!opciones.includes("agencia") && !opciones.includes("freelance") && !opciones.includes("cliente_final"));
  assert.ok(boton("Crear usuario interno") && boton("Crear aliado B2B"));
});

test("B2B: crear deshabilitado hasta buscar y elegir; varias coincidencias no se eligen solas", async () => {
  const crear: unknown[] = [];
  __setImpls({
    buscarFichasAliado: async () => ({ ok: true, fichas: FICHAS }),
    crearAliadoB2B: async (i: unknown) => { crear.push(i); return { ok: true }; },
  });
  await montar();
  assert.equal(boton("Crear aliado B2B").disabled, true, "sin búsqueda");
  await escribir(ph("Nombre / razón social"), "Viajes Nuevos");
  await escribir(ph("Número de documento"), "900123");
  await click(boton("Buscar ficha"));
  const radios = [...host.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  assert.equal(radios.length, 3, "2 fichas + crear nueva");
  assert.ok(radios.every((r) => !r.checked), "ninguna preseleccionada");
  assert.equal(boton("Crear aliado B2B").disabled, true, "falta confirmar");
  await click(radios[1]);
  await escribir(ph("Email (acceso al portal)"), "a@x.co");
  await escribir(ph("Contraseña (mín. 6)"), "secreta1");
  await click(boton("Crear aliado B2B"));
  assert.deepEqual((crear[0] as { enlace: unknown }).enlace, { modo: "ficha", aliadoId: 8 });
});

test("B2B: sin coincidencias → ficha nueva explícita; cambiar el documento reinicia la elección", async () => {
  const crear: unknown[] = [];
  __setImpls({
    buscarFichasAliado: async () => ({ ok: true, fichas: [] }),
    crearAliadoB2B: async (i: unknown) => { crear.push(i); return { ok: true }; },
  });
  await montar();
  await escribir(ph("Número de documento"), "555");
  await click(boton("Buscar ficha"));
  const radios = [...host.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  assert.equal(radios.length, 1);
  await click(radios[0]);
  assert.equal(boton("Crear aliado B2B").disabled, false);
  await escribir(ph("Número de documento"), "556");
  assert.equal(host.querySelectorAll('input[type="radio"]').length, 0, "búsqueda reiniciada");
  assert.equal(boton("Crear aliado B2B").disabled, true);
  await click(boton("Buscar ficha"));
  await click(host.querySelector('input[type="radio"]')!);
  await escribir(ph("Nombre / razón social"), "Nueva SAS");
  await escribir(ph("Email (acceso al portal)"), "n@x.co");
  await escribir(ph("Contraseña (mín. 6)"), "secreta1");
  await click(boton("Crear aliado B2B"));
  assert.deepEqual((crear[0] as { enlace: unknown; documento: string }).enlace, { modo: "nueva" });
  assert.equal((crear[0] as { documento: string }).documento, "556");
});
