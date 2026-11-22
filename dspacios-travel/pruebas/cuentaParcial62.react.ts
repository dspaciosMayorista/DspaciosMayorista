// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// #62 (B2) — pantallas de restablecer y cambiar contraseña (componentes de producción tal cual) ante los resultados de la acción:
//   éxito, errores, y PARCIAL (la contraseña cambió pero el cierre de sesiones no se confirmó): panel explícito, nunca éxito completo; el reintento llama SOLO
//   a cerrarSesionesAbiertas y la acción de contraseña NO se vuelve a invocar.
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "node:module";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/restablecer", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, FormData: dom.window.FormData, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type R = { ok: true } | { ok: false; error: string; enlaceVencido?: boolean; usarCambio?: boolean; incierto?: boolean } | { ok: "parcial"; alcance: "global" | "others"; mensaje: string };
const MENSAJE = "Tu contraseña SÍ se actualizó, pero no pudimos confirmar el cierre de tus otras sesiones. No hace falta repetir el cambio: reintenta el cierre de sesiones. Un dispositivo con la sesión abierta puede seguir activo hasta que venza su acceso actual (normalmente, hasta una hora).";
const llamadas: string[] = [];
const destinos: string[] = [];
let respRestablecer: R = { ok: true };
let respCambiar: R = { ok: true };
let respCierre: { ok: true } | { ok: false; error: string } = { ok: true };
let cierreSalir = 0;

// `next/navigation` no se resuelve en ESM plano ni con mock.module: se sirve un módulo mínimo que lee un router falso de globalThis (mismo patrón que next/cache en otras pruebas).
(globalThis as unknown as { __routerFalso: unknown }).__routerFalso = { replace: (d: string) => { destinos.push(d); }, push: (d: string) => { destinos.push(d); }, refresh() {} };
register("data:text/javascript," + encodeURIComponent("export async function resolve(s, c, n) { if (s === 'next/navigation') return { url: 'data:text/javascript,' + encodeURIComponent('export function useRouter() { return globalThis.__routerFalso; }'), shortCircuit: true }; return n(s, c); }"));
mock.module("@/lib/supabase/client", { namedExports: { createClient: () => ({ auth: { signOut: async () => { cierreSalir++; return { error: null }; } } }) } });
mock.module("@/app/(auth)/contrasena-actions", {
  namedExports: {
    restablecerContrasena: async (n: string, c: string) => { llamadas.push(`restablecer:${n}:${c}`); return respRestablecer; },
    cambiarContrasena: async (a: string, n: string, c: string) => { llamadas.push(`cambiar:${a}:${n}:${c}`); return respCambiar; },
    cerrarSesionesAbiertas: async (alcance: string) => { llamadas.push(`cierre:${alcance}`); return respCierre; },
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { RestablecerClient } = await import("../app/(auth)/restablecer/RestablecerClient.tsx");
const { CambiarContrasenaClient } = await import("../app/cuenta/contrasena/CambiarContrasenaClient.tsx");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(el: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}
async function escribir(nombre: string, valor: string) {
  await act(async () => {
    const campo = container.querySelector<HTMLInputElement>(`input[name="${nombre}"]`)!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function enviar() { await act(async () => { container.querySelector("form")!.requestSubmit(); }); }
const boton = (texto: RegExp) => [...container.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? ""))!;
const texto = () => container.textContent ?? "";
const panel = () => container.querySelector('[data-testid="resultado-parcial"]');

beforeEach(() => { llamadas.length = 0; destinos.length = 0; respRestablecer = { ok: true }; respCambiar = { ok: true }; respCierre = { ok: true }; cierreSalir = 0; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
after(() => dom.window.close());

async function restablecer() {
  await render(h(RestablecerClient));
  await escribir("nueva", "ClaveNueva2"); await escribir("confirmacion", "ClaveNueva2");
  await enviar();
}
async function cambiar() {
  await render(h(CambiarContrasenaClient, { volver: "/dashboard" }));
  await escribir("actual", "ClaveActual1"); await escribir("nueva", "ClaveNueva2"); await escribir("confirmacion", "ClaveNueva2");
  await enviar();
}

test("restablecer · éxito completo: va a /login?clave=1 y no muestra el panel parcial", async () => {
  await restablecer();
  assert.deepEqual(destinos, ["/login?clave=1"]);
  assert.equal(panel(), null);
  assert.deepEqual(llamadas, ["restablecer:ClaveNueva2:ClaveNueva2"]);
});

test("restablecer · PARCIAL: no redirige como éxito, dice que la contraseña SÍ cambió, borra los campos y ofrece reintentar SOLO el cierre", async () => {
  respRestablecer = { ok: "parcial", alcance: "global", mensaje: MENSAJE };
  await restablecer();
  assert.deepEqual(destinos, [], "no se redirige como si todo hubiera salido bien");
  assert.ok(panel(), "panel explícito de resultado parcial");
  assert.match(texto(), /SÍ se actualizó/);
  assert.match(texto(), /hasta que venza su acceso actual/);
  assert.equal(container.querySelector('input[name="nueva"]'), null, "el formulario de contraseña ya no se ofrece (no se repite el cambio)");
  assert.ok(boton(/Reintentar el cierre de sesiones/));
  assert.ok(boton(/Salir de esta sesión/));
});

test("restablecer · PARCIAL → reintentar: llama SOLO a cerrarSesionesAbiertas('global'); si falla muestra el error y sigue parcial; si sale bien va a /login?clave=1", async () => {
  respRestablecer = { ok: "parcial", alcance: "global", mensaje: MENSAJE };
  await restablecer();
  respCierre = { ok: false, error: "Todavía no pudimos cerrar las demás sesiones." };
  await act(async () => boton(/Reintentar el cierre/).click());
  assert.match(texto(), /Todavía no pudimos cerrar/);
  assert.ok(panel());
  assert.deepEqual(destinos, []);
  respCierre = { ok: true };
  await act(async () => boton(/Reintentar el cierre/).click());
  assert.deepEqual(destinos, ["/login?clave=1"]);
  assert.deepEqual(llamadas, ["restablecer:ClaveNueva2:ClaveNueva2", "cierre:global", "cierre:global"], "la contraseña se envió UNA sola vez");
});

test("restablecer · PARCIAL → «Salir de esta sesión»: cierra la sesión local y va a /login sin tocar la contraseña", async () => {
  respRestablecer = { ok: "parcial", alcance: "global", mensaje: MENSAJE };
  await restablecer();
  await act(async () => boton(/Salir de esta sesión/).click());
  assert.equal(cierreSalir, 1);
  assert.deepEqual(destinos, ["/login?clave=1"]);
  assert.deepEqual(llamadas, ["restablecer:ClaveNueva2:ClaveNueva2"]);
});

test("restablecer · página recargada con la recuperación YA consumida y la sesión viva (yaActualizada): entra directo al estado parcial; reintentar cierra y va a /login?clave=1; no hay formulario", async () => {
  await render(h(RestablecerClient, { yaActualizada: true }));
  assert.ok(panel());
  assert.match(texto(), /SÍ se actualizó/);
  assert.equal(container.querySelector('input[name="nueva"]'), null);
  await act(async () => boton(/Reintentar el cierre/).click());
  assert.deepEqual(destinos, ["/login?clave=1"]);
  assert.deepEqual(llamadas, ["cierre:global"], "no se envía ninguna contraseña");
});

test("restablecer · resultado INCIERTO (B4): panel sin formulario ni reenvío de contraseña; ofrece ingresar o pedir un enlace nuevo", async () => {
  respRestablecer = { ok: false, incierto: true, error: "No pudimos confirmar si tu contraseña cambió. Intenta ingresar con la contraseña nueva; si no entra, usa la anterior o solicita un enlace nuevo (este enlace ya no se puede reutilizar)." };
  await restablecer();
  assert.deepEqual(destinos, [], "no redirige como éxito");
  assert.ok(container.querySelector('[data-testid="resultado-incierto"]'));
  assert.match(texto(), /No pudimos confirmar si tu contraseña cambió/);
  assert.equal(container.querySelector('input[name="nueva"]'), null, "no vuelve a pedir la contraseña con el mismo enlace");
  assert.equal(panel(), null, "no se presenta como parcial (no se sabe si cambió)");
  const enlaces = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(enlaces, ["/login", "/recuperar"]);
  assert.deepEqual(llamadas, ["restablecer:ClaveNueva2:ClaveNueva2"], "una sola llamada a la acción");
});

test("restablecer · página recargada con evento reclamado pero NO confirmado (incierto): mismo panel, sin formulario", async () => {
  await render(h(RestablecerClient, { incierto: true }));
  assert.ok(container.querySelector('[data-testid="resultado-incierto"]'));
  assert.equal(container.querySelector('input[name="nueva"]'), null);
  assert.deepEqual(llamadas, []);
});

test("restablecer · sesión ordinaria (usarCambio) → /cuenta/contrasena; enlace vencido → /recuperar?error=enlace; otro error se muestra", async () => {
  respRestablecer = { ok: false, usarCambio: true, error: "x" };
  await restablecer();
  assert.deepEqual(destinos, ["/cuenta/contrasena"]);
  act(() => root?.unmount()); container.remove(); destinos.length = 0;
  respRestablecer = { ok: false, enlaceVencido: true, error: "x" };
  await restablecer();
  assert.deepEqual(destinos, ["/recuperar?error=enlace"]);
  act(() => root?.unmount()); container.remove(); destinos.length = 0;
  respRestablecer = { ok: false, error: "La contraseña es demasiado débil." };
  await restablecer();
  assert.deepEqual(destinos, []);
  assert.match(texto(), /demasiado débil/);
});

test("cambiar · éxito: mensaje con la salvedad del acceso vigente; sin panel parcial; los campos se vacían", async () => {
  await cambiar();
  assert.match(texto(), /se cerraron tus otras sesiones/);
  assert.match(texto(), /hasta que venza su acceso actual/, "no promete cierre inmediato de un token de acceso ya emitido");
  assert.equal(panel(), null);
  assert.equal(container.querySelector<HTMLInputElement>('input[name="nueva"]')!.value, "");
});

test("cambiar · PARCIAL: panel explícito, sin éxito completo; reintento llama SOLO a cerrarSesionesAbiertas('others') y entonces sí confirma", async () => {
  respCambiar = { ok: "parcial", alcance: "others", mensaje: MENSAJE };
  await cambiar();
  assert.ok(panel());
  assert.doesNotMatch(texto(), /se cerraron tus otras sesiones\./, "no afirma el cierre");
  assert.match(texto(), /SÍ se actualizó/);
  assert.equal(container.querySelector('input[name="actual"]'), null);
  respCierre = { ok: false, error: "Todavía no pudimos cerrar las demás sesiones." };
  await act(async () => boton(/Reintentar el cierre de las otras sesiones/).click());
  assert.match(texto(), /Todavía no pudimos/);
  assert.ok(panel());
  respCierre = { ok: true };
  await act(async () => boton(/Reintentar el cierre de las otras sesiones/).click());
  assert.equal(panel(), null);
  assert.match(texto(), /se cerraron tus otras sesiones/);
  assert.deepEqual(llamadas, ["cambiar:ClaveActual1:ClaveNueva2:ClaveNueva2", "cierre:others", "cierre:others"], "la contraseña se envió UNA sola vez");
});

test("cambiar · clave actual incorrecta: error y formulario intacto; sesión vencida → /login", async () => {
  respCambiar = { ok: false, error: "La contraseña actual no es correcta." };
  await cambiar();
  assert.match(texto(), /La contraseña actual no es correcta\./);
  assert.ok(container.querySelector('input[name="actual"]'));
  act(() => root?.unmount()); container.remove();
  respCambiar = { ok: false, enlaceVencido: true, error: "x" };
  await cambiar();
  assert.deepEqual(destinos, ["/login"]);
});
