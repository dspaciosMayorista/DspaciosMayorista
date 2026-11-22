// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// #62 — pantalla de registro B2B con verificación por CÓDIGO (`app/portal/registro/RegistroForm.tsx`, el componente de producción tal cual):
//   el paso 1 NO muestra «solicitud enviada», pide el código; el paso 2 no reenvía la contraseña; el código solo acepta dígitos; un código malo muestra el error del servidor
//   y deja reintentar; el reenvío espera 60 s con contador LOCAL (sin peticiones) y luego llama UNA vez; el éxito solo aparece cuando el servidor lo confirma.
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/portal/registro", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type R = { ok: true } | { ok: false; error: string; continuar?: boolean };
const llamadas: { op: string; args: unknown }[] = [];
let rIniciar: R = { ok: true };
let rConfirmar: R = { ok: true };
let rReenviar: R = { ok: true };
let rContinuar: R = { ok: true };
mock.module(new URL("../app/portal/registro/actions.ts", import.meta.url).href, {
  namedExports: {
    iniciarRegistroB2B: async (a: unknown) => { llamadas.push({ op: "iniciar", args: a }); return rIniciar; },
    confirmarCodigoYSolicitarB2B: async (a: unknown) => { llamadas.push({ op: "confirmar", args: a }); return rConfirmar; },
    reenviarCodigoB2B: async (a: unknown) => { llamadas.push({ op: "reenviar", args: a }); return rReenviar; },
    continuarRegistroB2B: async (a: unknown) => { llamadas.push({ op: "continuar", args: a }); return rContinuar; },
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { RegistroForm } = await import("../app/portal/registro/RegistroForm.tsx");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const setValor = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
const botonCon = (re: RegExp) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const texto = () => container.textContent ?? "";

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(RegistroForm)));
}
// Orden de los <input>: nombre, número de documento, contacto, correo, teléfono, ciudad, contraseña, repetir contraseña, casilla de notificaciones.
async function llenarYContinuar() {
  const ins = container.querySelectorAll<HTMLInputElement>("input");
  await act(async () => {
    setValor(ins[0], "Viajes Prueba SAS"); setValor(ins[1], "900123456"); setValor(ins[3], "Ana@Agencia.com");
    setValor(ins[6], "secreta123"); setValor(ins[7], "secreta123");
  });
  await act(async () => botonCon(/Continuar: enviar código/).click());
}
const campoCodigo = () => container.querySelector<HTMLInputElement>("#codigo-correo")!;

beforeEach(() => { llamadas.length = 0; rIniciar = { ok: true }; rConfirmar = { ok: true }; rReenviar = { ok: true }; rContinuar = { ok: true }; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; mock.timers.reset(); });
after(() => dom.window.close());

test("paso 1 correcto: pide el código; todavía NO dice «solicitud enviada»", async () => {
  await render();
  await llenarYContinuar();
  assert.equal(llamadas.filter((l) => l.op === "iniciar").length, 1);
  assert.ok(campoCodigo(), "aparece el campo del código");
  assert.match(texto(), /ana@agencia\.com/);
  assert.doesNotMatch(texto(), /Solicitud enviada/);
});

test("paso 1 rechazado: se queda en el formulario con el error del servidor", async () => {
  rIniciar = { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." };
  await render();
  await llenarYContinuar();
  assert.equal(campoCodigo(), null);
  assert.match(texto(), /Ya existe una cuenta con ese correo/);
});

test("código: solo dígitos, el botón exige 6; código malo muestra el error y deja reintentar; el paso 2 NO envía la contraseña", async () => {
  rConfirmar = { ok: false, error: "El código no es válido o ya venció. Revisa el correo o pide uno nuevo." };
  await render();
  await llenarYContinuar();
  const verificar = () => botonCon(/Verificar y enviar solicitud/) as HTMLButtonElement;
  await act(async () => setValor(campoCodigo(), "12a3b"));
  assert.equal(campoCodigo().value, "123", "las letras se descartan");
  assert.equal(verificar().disabled, true);
  await act(async () => setValor(campoCodigo(), "000000"));
  assert.equal(verificar().disabled, false);
  await act(async () => verificar().click());
  assert.match(texto(), /El código no es válido o ya venció/);
  assert.doesNotMatch(texto(), /Solicitud enviada/);
  const enviado = llamadas.find((l) => l.op === "confirmar")!.args as Record<string, unknown>;
  assert.equal(enviado.codigo, "000000");
  assert.equal("password" in enviado || "passwordConfirm" in enviado, false, "la contraseña no vuelve a viajar");
  assert.equal(verificar().disabled, false, "puede reintentar");
});

test("código correcto: recién entonces aparece «Solicitud enviada»", async () => {
  await render();
  await llenarYContinuar();
  await act(async () => setValor(campoCodigo(), "123456"));
  await act(async () => botonCon(/Verificar y enviar solicitud/).click());
  assert.match(texto(), /Solicitud enviada/);
  assert.equal(campoCodigo(), null);
});

test("reenvío: espera local de 60 s sin peticiones; luego UNA llamada que reinicia la espera", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  await render();
  await llenarYContinuar();
  const reenviar = () => botonCon(/Reenviar código/) as HTMLButtonElement;
  assert.equal(reenviar().disabled, true);
  assert.match(reenviar().textContent ?? "", /en 60 s/);
  for (let i = 0; i < 60; i++) await act(async () => mock.timers.tick(1000));
  assert.equal(llamadas.filter((l) => l.op === "reenviar").length, 0, "el contador no hace peticiones");
  assert.equal(reenviar().disabled, false);
  await act(async () => reenviar().click());
  assert.equal(llamadas.filter((l) => l.op === "reenviar").length, 1);
  assert.equal(reenviar().disabled, true, "la espera se reinicia");
  assert.match(texto(), /te enviamos un código nuevo/);
});

test("límite de frecuencia en el reenvío: se muestra la espera, no un falso «enviado»", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  rReenviar = { ok: false, error: "Espera un momento antes de pedir otro código." };
  await render();
  await llenarYContinuar();
  for (let i = 0; i < 60; i++) await act(async () => mock.timers.tick(1000));
  await act(async () => (botonCon(/Reenviar código/) as HTMLButtonElement).click());
  assert.match(texto(), /Espera un momento/);
  assert.doesNotMatch(texto(), /código nuevo/);
});

// B6 — continuación segura cuando el correo ya quedó verificado pero la solicitud no se completó.
const MSG_CONT = "Tu correo quedó verificado, pero no pudimos terminar de registrar tu solicitud. Escribe la contraseña de tu registro para continuar.";
const campoPassword = () => container.querySelector<HTMLInputElement>("#continuar-password")!;

test("B6: si tras el código el servidor pide continuar, aparece el panel con contraseña (no «solicitud enviada» ni «código inválido»)", async () => {
  rConfirmar = { ok: false, continuar: true, error: MSG_CONT };
  await render();
  await llenarYContinuar();
  await act(async () => setValor(campoCodigo(), "123456"));
  await act(async () => botonCon(/Verificar y enviar solicitud/).click());
  assert.ok(campoPassword(), "aparece el campo de contraseña de la continuación");
  assert.match(texto(), /Continúa tu registro/);
  assert.match(texto(), /ya está verificado/);
  assert.match(texto(), /no pudimos terminar de registrar tu solicitud/);
  assert.doesNotMatch(texto(), /Solicitud enviada/);
  assert.equal(campoCodigo(), null, "ya no se pide el código");
});

test("B6: continuar envía correo + contraseña (y los datos del formulario), nunca la confirmación; el éxito muestra «Solicitud enviada»", async () => {
  rConfirmar = { ok: false, continuar: true, error: MSG_CONT };
  await render();
  await llenarYContinuar();
  await act(async () => setValor(campoCodigo(), "123456"));
  await act(async () => botonCon(/Verificar y enviar solicitud/).click());
  const boton = () => botonCon(/Continuar y enviar solicitud/) as HTMLButtonElement;
  await act(async () => setValor(campoPassword(), "secreta123"));
  await act(async () => boton().click());
  const enviado = llamadas.find((l) => l.op === "continuar")!.args as Record<string, unknown>;
  assert.equal(enviado.email, "Ana@Agencia.com");
  assert.equal(enviado.password, "secreta123");
  assert.equal("passwordConfirm" in enviado, false);
  assert.match(texto(), /Solicitud enviada/);
});

test("B6: contraseña equivocada → se muestra el error del servidor y se puede reintentar; el botón exige una contraseña", async () => {
  rIniciar = { ok: false, continuar: true, error: "Tu correo ya está verificado, pero tu solicitud aún no se completó. Escribe la contraseña de tu registro para continuar." };
  rContinuar = { ok: false, error: "No pudimos confirmar tu identidad. Revisa el correo y la contraseña de tu registro (el correo debe estar verificado)." };
  await render();
  await llenarYContinuar();   // el paso 1 mismo responde «continuar» (correo verificado sin solicitud)
  assert.ok(campoPassword());
  const boton = () => botonCon(/Continuar y enviar solicitud/) as HTMLButtonElement;
  await act(async () => setValor(campoPassword(), ""));
  assert.equal(boton().disabled, true);
  await act(async () => setValor(campoPassword(), "equivocada"));
  assert.equal(boton().disabled, false);
  await act(async () => boton().click());
  assert.match(texto(), /No pudimos confirmar tu identidad/);
  assert.doesNotMatch(texto(), /Solicitud enviada/);
  assert.equal(boton().disabled, false, "puede reintentar");
});
