// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// #62 — pantalla de recuperación de contraseña (`app/(auth)/recuperar/RecuperarClient.tsx`, el componente de producción tal cual):
//   correo inválido no llama a Auth; el enlace pide volver a /auth/callback?next=/restablecer del MISMO origen; el mensaje de éxito es idéntico para
//   cualquier correo; el límite de frecuencia y los fallos reales NO se presentan como «enviado»; reenvío con espera de 60 s.
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/recuperar", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type Resp = { error: null | { status?: number; code?: string; message?: string } };
const pedidos: { correo: string; opciones: { redirectTo?: string } }[] = [];
let respuesta: Resp = { error: null };
mock.module("@/lib/supabase/client", {
  namedExports: {
    createClient: () => ({
      auth: { resetPasswordForEmail: async (correo: string, opciones: { redirectTo?: string }) => { pedidos.push({ correo, opciones }); return respuesta; } },
    }),
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { RecuperarClient } = await import("../app/(auth)/recuperar/RecuperarClient.tsx");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(enlaceVencido = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(RecuperarClient, { enlaceVencido })));
}
const campo = () => container.querySelector<HTMLInputElement>("#correo-recuperar")!;
const boton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
async function escribir(valor: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    set.call(campo(), valor);
    campo().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function enviar() {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
}
const textoVisible = () => container.textContent ?? "";

beforeEach(() => { pedidos.length = 0; respuesta = { error: null }; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; mock.timers.reset(); });
after(() => dom.window.close());

test("correo inválido: muestra el error y NO llama a Auth", async () => {
  await render();
  await escribir("no-es-correo");
  await enviar();
  assert.match(textoVisible(), /Escribe un correo válido/);
  assert.equal(pedidos.length, 0);
});

test("correo válido: una sola petición, en minúsculas, con retorno al callback del MISMO origen y destino /restablecer", async () => {
  await render();
  await escribir("  Ana@Agencia.CO ");
  await enviar();
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].correo, "ana@agencia.co");
  assert.equal(pedidos[0].opciones.redirectTo, "http://localhost/auth/callback?next=/restablecer");
});

test("el mensaje de éxito es IDÉNTICO para un correo registrado y uno que no existe (Auth responde igual) y no afirma que exista", async () => {
  await render();
  await escribir("registrado@agencia.co");
  await enviar();
  const a = textoVisible();
  act(() => root?.unmount()); container.remove();
  await render();
  await escribir("fantasma@nadie.co");
  await enviar();
  const b = textoVisible();
  assert.equal(a, b);
  assert.match(b, /Si el correo está registrado, te enviamos un enlace/);
});

test("tras enviar: el botón queda deshabilitado con cuenta regresiva de 60 s y se habilita para reenviar al terminar", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  await render();
  await escribir("ana@agencia.co");
  await enviar();
  assert.equal(boton().disabled, true);
  assert.match(boton().textContent ?? "", /Reenviar en 60 s/);
  for (let i = 0; i < 60; i++) await act(async () => mock.timers.tick(1000));
  assert.equal(boton().disabled, false);
  assert.match(boton().textContent ?? "", /Reenviar enlace/);
  assert.equal(pedidos.length, 1, "la cuenta regresiva no genera peticiones");
});

test("límite de frecuencia (429): avisa y NO dice «enviado»; el botón sigue disponible", async () => {
  respuesta = { error: { status: 429, code: "over_email_send_rate_limit" } };
  await render();
  await escribir("ana@agencia.co");
  await enviar();
  assert.match(textoVisible(), /Demasiados intentos/);
  assert.doesNotMatch(textoVisible(), /te enviamos un enlace/);
  assert.equal(boton().disabled, false);
});

test("fallo real (servidor/red): mensaje honesto, sin «enviado» ni espera", async () => {
  respuesta = { error: { status: 500, message: "boom" } };
  await render();
  await escribir("ana@agencia.co");
  await enviar();
  assert.match(textoVisible(), /No pudimos enviar el enlace/);
  assert.doesNotMatch(textoVisible(), /te enviamos un enlace|boom/);
  assert.equal(boton().disabled, false);
});

test("enlace vencido (viene de /auth/callback): muestra el aviso y el formulario para pedir otro", async () => {
  await render(true);
  assert.match(textoVisible(), /El enlace venció o ya se usó/);
  assert.ok(campo());
  assert.equal(container.querySelector('a[href="/login"]') !== null, true, "volver a ingresar");
});
