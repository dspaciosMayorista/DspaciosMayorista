// test:react (jsdom). Lista de usuarios: pestañas por rol real, inactivos visibles, diálogo de
// edición (efectos antes de guardar, Guardar aplica, Cancelar descarta, reapertura limpia).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent, FocusEvent: dom.window.FocusEvent,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { UsuariosClient } = await import("../app/(dashboard)/dashboard/usuarios/UsuariosClient.tsx");
const { __setImpls } = await import("./support/stubs/usuariosActionsStub.mjs");
const { act, createElement: h } = React;

const U = (o: Record<string, unknown>) => ({ acceso_legacy_nombre: false, activo: true, tenant: "mayorista", aliado_id: null, pct_comision: null, ...o });
const USUARIOS = [
  U({ id: "1", email: "agencia.con.un.correo.larguisimo.de.prueba@dominio-muy-largo-ejemplo.com.co", nombre: "Agencia Con Un Nombre Realmente Largo S.A.S.", rol: "agencia", aliado_id: 7, pct_comision: 0.12 }),
  U({ id: "2", email: "free@x.co", nombre: "Freelance Inactivo", rol: "freelance", activo: false }),
  U({ id: "3", email: "ana@x.co", nombre: "Ana", rol: "venta" }),
  U({ id: "4", email: "bob@x.co", nombre: "Bob Gerente", rol: "gerencia", activo: false }),
  // el nombre y el correo engañan: se clasifica por el ROL
  U({ id: "6", email: "leg@x.co", nombre: "Agencia Heredada", rol: "agencia", acceso_legacy_nombre: true }),
  U({ id: "5", email: "agencia@x.co", nombre: "Agencia Falsa", rol: "operaciones" }),
];
const FICHAS = { 7: { nombre: "Ficha Agencia", nit: "900123" } };

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;
async function montar(rolActor = "superadmin") {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(h(UsuariosClient, { usuarios: USUARIOS as never, fichas: FICHAS, rolActor })); });
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); });
after(() => dom.window.close());

const click = (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const pestana = (t: string) => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.startsWith(t))!;
const filas = () => [...host.querySelectorAll("tbody tr")].map((r) => r.textContent ?? "");
const dialogo = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const bt = (t: string) => [...dialogo()!.querySelectorAll("button")].find((b) => b.textContent === t) as HTMLButtonElement;
async function cambiar(el: Element, v: string, tipo: "input" | "change" = "change") {
  await act(async () => {
    const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new dom.window.Event(tipo, { bubbles: true }));
  });
}

test("pestañas por rol real, con inactivos visibles y estado", async () => {
  await montar();
  assert.match(pestana("B2B").textContent!, /\(3\)/); assert.match(pestana("Internos").textContent!, /\(3\)/);
  assert.equal(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent!.startsWith("B2B"), true);
  let f = filas();
  assert.equal(f.length, 3);
  assert.ok(f.some((x) => x.includes("Freelance Inactivo") && x.includes("Inactivo")));
  assert.ok(f.some((x) => x.includes("Ficha Agencia") && x.includes("12 %")));
  await click(pestana("Internos"));
  f = filas();
  assert.equal(f.length, 3);
  assert.ok(f.some((x) => x.includes("Agencia Falsa")), "clasifica por rol, no por nombre/correo");
  assert.ok(f.some((x) => x.includes("Bob Gerente") && x.includes("Inactivo")));
  assert.equal(host.querySelectorAll("tbody tr button").length, 3, "Editar accesible en cada fila");
  assert.equal(host.querySelectorAll('[role="tab"]').length, 2, "sin usuarios \"otros\" no hay tercera pestaña");
});

test("contenedor con scroll interno y celdas largas que cortan palabra (sin desbordar la página)", async () => {
  await montar();
  const cont = host.querySelector("table")!.parentElement!;
  assert.match(cont.className, /overflow-x-auto/);
  const td = [...host.querySelectorAll("td")].find((c) => c.textContent?.includes("correo.larguisimo"))!;
  assert.match(td.className, /break-all/);
});

test("editar: muestra el efecto antes de guardar; Guardar aplica solo lo cambiado; correo bloqueado", async () => {
  const llamadas: unknown[][] = [];
  __setImpls({ actualizarUsuario: async (...a: unknown[]) => { llamadas.push(a); return { ok: true }; } });
  await montar();
  await click(host.querySelector('button[aria-label^="Editar Freelance"]')!);
  const correo = dialogo()!.querySelector('input[aria-label="Correo"]') as HTMLInputElement;
  assert.equal(correo.disabled, true);
  assert.equal(dialogo()!.querySelector('input[type="password"]'), null);
  assert.equal(bt("Guardar").disabled, true, "sin cambios no se guarda");
  await click(dialogo()!.querySelector('input[aria-label="Activo"]')!);
  assert.match(dialogo()!.querySelector('[role="status"]')!.textContent!, /Se activa: recupera el acceso/);
  await cambiar(dialogo()!.querySelector('select[aria-label="Rol"]')!, "venta");
  assert.match(dialogo()!.querySelector('[role="status"]')!.textContent!, /deja el portal B2B/);
  await click(bt("Guardar"));
  assert.equal(dialogo(), null, "cierra tras guardar");
  assert.deepEqual(llamadas[0], ["2", { rol: "venta", activo: true }]);
});

test("Cancelar descarta y la reapertura vuelve a los datos originales; el error del servidor se muestra", async () => {
  const llamadas: unknown[] = [];
  __setImpls({ actualizarUsuario: async (...a: unknown[]) => { llamadas.push(a); return { ok: false, error: "Solo superadmin puede editar a un superadmin." }; } });
  await montar("administracion");
  const abrir = () => click(host.querySelector('button[aria-label^="Editar Agencia Con"]')!);
  await abrir();
  assert.equal((dialogo()!.querySelector('select[aria-label="Agencia"]') as HTMLSelectElement).disabled, true, "tenant solo superadmin");
  await cambiar(dialogo()!.querySelector('input[aria-label="Nombre"]')!, "Otro Nombre", "input");
  await click(bt("Cancelar"));
  assert.equal(dialogo(), null); assert.equal(llamadas.length, 0);
  await abrir();
  assert.equal((dialogo()!.querySelector('input[aria-label="Nombre"]') as HTMLInputElement).value, "Agencia Con Un Nombre Realmente Largo S.A.S.");
  await cambiar(dialogo()!.querySelector('input[aria-label="Nombre"]')!, "Otro Nombre", "input");
  await click(bt("Guardar"));
  assert.ok(dialogo(), "no cierra si falla");
  assert.match(dialogo()!.querySelector('[role="alert"]')!.textContent!, /Solo superadmin/);
});

test("ficha: quitar o cambiar muestra el efecto y no reasigna nada por sí solo", async () => {
  await montar();
  await click(host.querySelector('button[aria-label^="Editar Agencia Con"]')!);
  await click([...dialogo()!.querySelectorAll("button")].find((b) => b.textContent === "Quitar")!);
  assert.match(dialogo()!.querySelector('[role="status"]')!.textContent!, /Ficha Agencia \(900123\) → sin ficha.*no se reasignan/);
});

test("accesible: Escape cierra, el foco vuelve al botón Editar y el diálogo tiene título", async () => {
  await montar();
  const btn = host.querySelector('button[aria-label^="Editar Freelance"]') as HTMLButtonElement;
  btn.focus();
  await click(btn);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); // el foco inicial se mueve en el siguiente frame
  assert.ok(dialogo()!.getAttribute("aria-labelledby"), "nombrado por su título");
  assert.ok(dialogo()!.contains(document.activeElement), "foco dentro del diálogo");
  await act(async () => { document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  assert.equal(dialogo(), null, "Escape cierra");
  assert.equal(document.activeElement, btn, "el foco vuelve a Editar");
});

test("cuenta con acceso heredado: cambiar el nombre bloquea Guardar y lo explica", async () => {
  await montar();
  await click(host.querySelector('button[aria-label^="Editar Agencia Heredada"]')!);
  await cambiar(dialogo()!.querySelector('input[aria-label="Nombre"]')!, "Otro", "input");
  assert.match(dialogo()!.querySelector('[role="status"]')!.textContent!, /Bloqueado.*Concilia primero/);
  assert.equal(bt("Guardar").disabled, true);
});