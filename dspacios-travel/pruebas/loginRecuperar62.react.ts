// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// #62 — el login (`LoginClient.tsx`, producción tal cual) ofrece «¿Olvidaste tu contraseña?» en AMBAS pestañas (B2B y Admin: la cuenta recupera igual),
// como enlace normal a /recuperar que no toca Auth, y muestra la confirmación solo cuando viene de haber cambiado la clave (?clave=1).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/login", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { LoginClient } = await import("../app/(auth)/login/LoginClient.tsx");
const { __pushes } = await import("./support/stubs/nextNavigationStub.mjs");
const { __llamadas: llamadasSupabase } = await import("./support/stubs/supabaseClientStub.mjs");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(extra: { claveActualizadaInicial?: boolean } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(LoginClient, { quickLoginEnabled: false, inactivoInicial: false, ...extra })));
}
const enlace = () => container.querySelector<HTMLAnchorElement>('[data-testid="olvide-contrasena"]');
const pestana = (n: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes(n))!;

afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; __pushes.length = 0; llamadasSupabase.length = 0; });
after(() => dom.window.close());

test("el enlace «¿Olvidaste tu contraseña?» existe en B2B y en Admin y apunta a /recuperar", async () => {
  await render();
  assert.equal(enlace()?.getAttribute("href"), "/recuperar");
  assert.match(enlace()?.textContent ?? "", /Olvidaste tu contraseña/);
  await act(async () => pestana("Admin").click());
  assert.equal(enlace()?.getAttribute("href"), "/recuperar");
});

test("seguir el enlace es navegación normal: no envía el login, no toca Auth ni router.push", async () => {
  await render();
  await act(async () => enlace()!.click());
  assert.deepEqual(__pushes, []);
  assert.deepEqual(llamadasSupabase.filter((c: string) => c !== "createClient"), []);
});

test("el aviso de contraseña actualizada solo aparece cuando se llega con ?clave=1", async () => {
  await render();
  assert.doesNotMatch(container.textContent ?? "", /Tu contraseña se actualizó/);
  act(() => root?.unmount()); container.remove();
  await render({ claveActualizadaInicial: true });
  assert.match(container.textContent ?? "", /Tu contraseña se actualizó\. Ingresa con la nueva contraseña\./);
});
