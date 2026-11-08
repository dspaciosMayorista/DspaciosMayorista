// #25 — interacción real del formulario «Mi perfil» (jsdom). La Server Action se sustituye por un doble. FIXTURES LOCALES.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

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
let respuesta: unknown = { ok: true, cambios: ["nombre"] };
mock.module(new URL("../app/portal/b2b/perfil/actions.ts", import.meta.url).href, {
  namedExports: { guardarPerfil: async (e: Record<string, unknown>) => { llamadas.push(e); return respuesta; } },
});
const { PerfilEditor } = await import("../app/portal/b2b/perfil/PerfilEditor.tsx");

const ficha = { nombre: "Viajes Alfa SAS", contacto: "Ana", telefono: "3001112233", email: "ana@alfa.test", direccion: "Calle 1" };
const base = { tipo: "agencia" as const, nombreUsuario: "Ana Gómez", puedeNombreUsuario: true, motivoNombreUsuario: null, ficha, puedeFicha: true, motivoFicha: null, camposFicha: ["nombre", "contacto", "telefono", "email", "direccion"] };

async function montar(props: Record<string, unknown>) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(React.createElement(PerfilEditor, { ...base, ...props } as never)); });
  return { cont, root };
}
async function escribir(el: HTMLInputElement, v: string) {
  const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
}
const boton = (c: HTMLElement, t: string) => [...c.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
const campo = (c: HTMLElement, etiqueta: string) => [...c.querySelectorAll("label")].find((l) => l.textContent?.startsWith(etiqueta))?.querySelector("input") as HTMLInputElement;

test("titular: cambiar la razón social muestra el aviso de cuenta de cobro y la casilla de confirmación; el envío lleva solo campos permitidos", async () => {
  llamadas.length = 0;
  const { cont, root } = await montar({});
  assert.equal(cont.textContent?.includes("cuenta de cobro"), false);
  await escribir(campo(cont, "Razón social"), "Viajes Alfa Internacional SAS");
  assert.match(cont.textContent ?? "", /también cambiará en tu cuenta de cobro/);
  await act(async () => { boton(cont, "Guardar datos").click(); });
  assert.equal(llamadas[0].confirmaNombreFicha, false); // sin casilla: el servidor lo rechaza
  const casilla = cont.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => { casilla.click(); });
  await act(async () => { boton(cont, "Guardar datos").click(); });
  assert.equal(llamadas[1].confirmaNombreFicha, true);
  assert.deepEqual(Object.keys(llamadas[1]).sort(), ["confirmaNombreFicha", "contacto", "direccion", "email", "esperado", "nombre", "seccion", "telefono"]);
  assert.deepEqual(llamadas[1].esperado, ficha, "los originales con los que se abrió el formulario, no los editados");
  assert.equal(llamadas[1].seccion, "ficha");
  await act(async () => root.unmount());
});

test("sin cambiar el nombre de la ficha no aparece el aviso; el mensaje del servidor se muestra", async () => {
  respuesta = { ok: false, error: "El teléfono debe tener entre 7 y 15 dígitos." };
  const { cont, root } = await montar({});
  await escribir(campo(cont, "Teléfono"), "123");
  assert.equal(cont.querySelector('input[type="checkbox"]'), null);
  await act(async () => { boton(cont, "Guardar datos").click(); });
  assert.match(cont.querySelector('[role="alert"]')?.textContent ?? "", /7 y 15 dígitos/);
  await act(async () => root.unmount());
});

test("acceso heredado por nombre: sin campo de nombre de usuario y con el motivo; la ficha sigue editable", async () => {
  const { cont, root } = await montar({ puedeNombreUsuario: false, motivoNombreUsuario: "Tu nombre se usa para reconocer tus contratos anteriores; no se puede cambiar desde el portal. Contacta a tu asesor." });
  assert.equal(campo(cont, "Tu nombre"), undefined);
  assert.match(cont.textContent ?? "", /contratos anteriores/);
  assert.ok(boton(cont, "Guardar datos"));
  await act(async () => root.unmount());
});

test("agente: ficha bloqueada con su motivo y solo puede guardar su nombre", async () => {
  llamadas.length = 0; respuesta = { ok: true, cambios: ["nombre"] };
  const { cont, root } = await montar({ ficha: null, puedeFicha: false, motivoFicha: "La ficha de la agencia solo la edita su titular.", camposFicha: [] });
  assert.match(cont.textContent ?? "", /solo la edita su titular/);
  assert.equal(boton(cont, "Guardar datos"), undefined);
  await escribir(campo(cont, "Tu nombre"), "Ana María Gómez");
  await act(async () => { boton(cont, "Guardar nombre").click(); });
  assert.deepEqual(llamadas[0], { seccion: "usuario", nombre: "Ana María Gómez", esperado: { nombre: "Ana Gómez" } });
  await act(async () => root.unmount());
});

test("los originales conservan null (no se convierten en texto vacío) y siguen siendo los de apertura tras editar", async () => {
  llamadas.length = 0; respuesta = { ok: true, cambios: ["telefono"] };
  const orig = { nombre: "Fulano", contacto: null, telefono: null, email: "f@f.test", direccion: null };
  const { cont, root } = await montar({ tipo: "freelance", ficha: orig, camposFicha: ["nombre", "telefono", "email", "direccion"] });
  await escribir(campo(cont, "Teléfono"), "3001112233");
  await act(async () => { boton(cont, "Guardar datos").click(); });
  assert.deepEqual(llamadas[0].esperado, orig);
  assert.equal(llamadas[0].telefono, "3001112233");
  await act(async () => root.unmount());
});

test("freelance: no hay campo de persona de contacto", async () => {
  const { cont, root } = await montar({ tipo: "freelance", camposFicha: ["nombre", "telefono", "email", "direccion"] });
  assert.equal(campo(cont, "Persona de contacto"), undefined);
  assert.ok(campo(cont, "Nombre"));
  await act(async () => root.unmount());
});
