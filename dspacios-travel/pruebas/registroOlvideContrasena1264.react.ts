// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// O-4 — «Olvidé mi contraseña» desde «Continúa tu registro»: componentes de producción tal cual.
//   · el paso «Continúa tu registro» ofrece el enlace a /recuperar?desde=registro y guarda SOLO los datos del formulario (nunca contraseña, confirmación ni código);
//   · /recuperar rellena el correo del borrador y mantiene la respuesta genérica y el mismo envío (redirectTo al callback → /restablecer);
//   · tras cambiar la contraseña con un borrador vigente se vuelve a /portal/registro?retomar=1; sin borrador, al ingreso de siempre (/login?clave=1);
//   · retomar recupera el paso «Continúa tu registro» con la contraseña VACÍA (hay que escribir la nueva: no hay atajo) y el éxito borra el borrador.
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "node:module";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/portal/registro", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, FormData: dom.window.FormData, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type R = { ok: true } | { ok: false; error: string; continuar?: boolean };
const llamadas: { op: string; args: unknown }[] = [];
const destinos: string[] = [];
const pedidosAuth: { correo: string; opciones: { redirectTo?: string } }[] = [];
let rIniciar: R = { ok: false, continuar: true, error: "Tu correo ya está verificado, pero tu solicitud aún no se completó. Escribe la contraseña de tu registro para continuar." };
let rContinuar: R = { ok: true };
(globalThis as unknown as { __routerFalso: unknown }).__routerFalso = { replace: (d: string) => { destinos.push(d); }, push: (d: string) => { destinos.push(d); }, refresh() {} };
register("data:text/javascript," + encodeURIComponent("export async function resolve(s, c, n) { if (s === 'next/navigation') return { url: 'data:text/javascript,' + encodeURIComponent('export function useRouter() { return globalThis.__routerFalso; }'), shortCircuit: true }; return n(s, c); }"));
mock.module(new URL("../app/portal/registro/actions.ts", import.meta.url).href, {
  namedExports: {
    iniciarRegistroB2B: async (a: unknown) => { llamadas.push({ op: "iniciar", args: a }); return rIniciar; },
    confirmarCodigoYSolicitarB2B: async () => ({ ok: true }),
    reenviarCodigoB2B: async () => ({ ok: true }),
    continuarRegistroB2B: async (a: unknown) => { llamadas.push({ op: "continuar", args: a }); return rContinuar; },
  },
});
mock.module("@/lib/supabase/client", {
  namedExports: {
    createClient: () => ({ auth: { resetPasswordForEmail: async (correo: string, opciones: { redirectTo?: string }) => { pedidosAuth.push({ correo, opciones }); return { error: null }; }, signOut: async () => ({ error: null }) } }),
  },
});
let respRestablecer: { ok: true } = { ok: true };
mock.module("@/app/(auth)/contrasena-actions", {
  namedExports: {
    restablecerContrasena: async (n: string, c: string) => { llamadas.push({ op: "restablecer", args: [n, c] }); return respRestablecer; },
    cambiarContrasena: async () => ({ ok: true }),
    cerrarSesionesAbiertas: async () => ({ ok: true }),
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { RegistroForm } = await import("../app/portal/registro/RegistroForm.tsx");
const { RecuperarClient } = await import("../app/(auth)/recuperar/RecuperarClient.tsx");
const { RestablecerClient } = await import("../app/(auth)/restablecer/RestablecerClient.tsx");
const { CLAVE_BORRADOR_REGISTRO } = await import("../lib/auth/borradorRegistroB2B.ts");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(el: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}
const setValor = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
const botonCon = (re: RegExp) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const texto = () => container.textContent ?? "";
const borrador = () => dom.window.localStorage.getItem(CLAVE_BORRADOR_REGISTRO);

beforeEach(() => { llamadas.length = 0; destinos.length = 0; pedidosAuth.length = 0; dom.window.localStorage.clear(); rContinuar = { ok: true }; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
after(() => dom.window.close());

async function llegarAContinuar() {
  await render(h(RegistroForm));
  const ins = container.querySelectorAll<HTMLInputElement>("input");
  await act(async () => {
    setValor(ins[0], "Viajes Prueba SAS"); setValor(ins[1], "900123456"); setValor(ins[3], "Ana@Agencia.com");
    setValor(ins[6], "secreta123"); setValor(ins[7], "secreta123");
  });
  await act(async () => botonCon(/Continuar: enviar código/).click());
}

test("«Continúa tu registro» ofrece «Olvidé mi contraseña» hacia /recuperar y guarda solo los datos del formulario (nunca contraseña)", async () => {
  await llegarAContinuar();
  assert.match(texto(), /Continúa tu registro/);
  const enlace = container.querySelector<HTMLAnchorElement>('[data-testid="olvide-contrasena"]')!;
  assert.ok(enlace, "el enlace existe en el paso de continuación");
  assert.match(enlace.textContent ?? "", /Olvidé mi contraseña/);
  assert.equal(enlace.getAttribute("href"), "/recuperar?desde=registro");
  assert.equal(borrador(), null, "no se guarda nada hasta que la persona decide recuperar");
  await act(async () => { enlace.addEventListener("click", (e) => e.preventDefault()); enlace.click(); });
  const guardado = borrador()!;
  assert.ok(guardado, "al elegir recuperar se guarda el borrador");
  assert.doesNotMatch(guardado, /secreta123|password|codigo/i);
  const datos = (JSON.parse(guardado) as { datos: Record<string, unknown> }).datos;
  assert.equal(datos.email, "Ana@Agencia.com");
  assert.equal(datos.nombre, "Viajes Prueba SAS");
});

test("el paso 1 normal (sin «continuar») no muestra el enlace de recuperación", async () => {
  await render(h(RegistroForm));
  assert.equal(container.querySelector('[data-testid="olvide-contrasena"]'), null);
});

test("/recuperar?desde=registro rellena el correo del borrador, envía el mismo enlace de siempre y avisa que se vuelve al registro", async () => {
  dom.window.localStorage.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: Date.now(), datos: { email: "ana@agencia.com", nombre: "X" } }));
  await render(h(RecuperarClient, { enlaceVencido: false, desdeRegistro: true }));
  const campo = container.querySelector<HTMLInputElement>("#correo-recuperar")!;
  assert.equal(campo.value, "ana@agencia.com");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  assert.equal(pedidosAuth.length, 1);
  assert.equal(pedidosAuth[0].opciones.redirectTo, "http://localhost/auth/callback?next=/restablecer", "mismo flujo auditado: nada de destinos nuevos");
  assert.match(texto(), /Si el correo está registrado/, "respuesta genérica");
  assert.match(texto(), /Continúa tu registro/);
});

test("/recuperar normal (sin desde=registro) no toca el borrador ni cambia nada", async () => {
  dom.window.localStorage.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: Date.now(), datos: { email: "ana@agencia.com" } }));
  await render(h(RecuperarClient, { enlaceVencido: false }));
  assert.equal(container.querySelector<HTMLInputElement>("#correo-recuperar")!.value, "");
});

async function cambiarClave() {
  await render(h(RestablecerClient));
  for (const n of ["nueva", "confirmacion"]) {
    const c = container.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
    await act(async () => setValor(c, "ClaveNueva2"));
  }
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
}

test("tras cambiar la contraseña con un borrador vigente se vuelve a /portal/registro?retomar=1", async () => {
  dom.window.localStorage.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: Date.now(), datos: { email: "ana@agencia.com" } }));
  await cambiarClave();
  assert.deepEqual(destinos, ["/portal/registro?retomar=1"]);
});

test("sin borrador, o con uno vencido, el destino sigue siendo /login?clave=1", async () => {
  await cambiarClave();
  assert.deepEqual(destinos, ["/login?clave=1"]);
  destinos.length = 0;
  dom.window.localStorage.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: Date.now() - 2 * 60 * 60 * 1000, datos: { email: "ana@agencia.com" } }));
  await act(async () => root!.unmount()); container.remove();
  await cambiarClave();
  assert.deepEqual(destinos, ["/login?clave=1"]);
  assert.equal(borrador(), null, "el borrador vencido se descarta");
});

test("retomar: vuelve el paso «Continúa tu registro» con el correo y SIN contraseña; continuar exige la nueva y el éxito borra el borrador", async () => {
  dom.window.localStorage.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: Date.now(), datos: { email: "ana@agencia.com", nombre: "Viajes Prueba SAS", nit: "900123456", tipo: "agencia", tipoDocumento: "NIT" } }));
  await render(h(RegistroForm, { retomar: true }));
  assert.match(texto(), /Continúa tu registro/);
  assert.match(texto(), /ana@agencia\.com/);
  assert.match(texto(), /Contraseña actualizada/);
  const campo = container.querySelector<HTMLInputElement>("#continuar-password")!;
  assert.equal(campo.value, "", "ninguna contraseña se precarga");
  const boton = botonCon(/Continuar y enviar solicitud/) as HTMLButtonElement;
  assert.equal(boton.disabled, true, "sin escribir la contraseña nueva no se puede continuar");
  await act(async () => setValor(campo, "ClaveNueva2"));
  await act(async () => boton.click());
  const enviado = llamadas.find((l) => l.op === "continuar")!.args as Record<string, unknown>;
  assert.equal(enviado.email, "ana@agencia.com");
  assert.equal(enviado.password, "ClaveNueva2");
  assert.equal(enviado.nombre, "Viajes Prueba SAS", "los datos del formulario no hay que volver a escribirlos");
  assert.match(texto(), /Solicitud enviada/);
  assert.equal(borrador(), null);
});

test("retomar sin borrador vigente muestra el formulario normal (no inventa un paso de continuación)", async () => {
  await render(h(RegistroForm, { retomar: true }));
  assert.equal(container.querySelector("#continuar-password"), null);
  assert.match(texto(), /Tipo de aliado/);
});

test("una contraseña equivocada tras retomar muestra el error del servidor y no completa nada", async () => {
  dom.window.localStorage.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: Date.now(), datos: { email: "ana@agencia.com" } }));
  rContinuar = { ok: false, error: "No pudimos confirmar tu identidad. Revisa el correo y la contraseña de tu registro (el correo debe estar verificado)." };
  await render(h(RegistroForm, { retomar: true }));
  await act(async () => setValor(container.querySelector<HTMLInputElement>("#continuar-password")!, "vieja-clave"));
  await act(async () => (botonCon(/Continuar y enviar solicitud/) as HTMLButtonElement).click());
  assert.match(texto(), /No pudimos confirmar tu identidad/);
  assert.doesNotMatch(texto(), /Solicitud enviada/);
  assert.ok(borrador(), "el borrador se conserva para reintentar");
});
