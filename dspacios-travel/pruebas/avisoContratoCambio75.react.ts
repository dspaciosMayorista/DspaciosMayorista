// Se ejecuta con npm run test:react. #75 · recorrido local del AVISO de contrato eliminado/reemplazado (cortesía; la protección real es la identidad en la base).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/contratos/DTM-0001", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { AvisoContratoCambio } = await import("../app/(dashboard)/dashboard/contratos/[numero]/AvisoContratoCambio.tsx");
const { __setImpls } = await import("./support/stubs/vigenciaActionsStub.mjs");
const nav = await import("./support/stubs/nextNavigationStub.mjs");
const { act, createElement: h } = React;

const UID = "11111111-1111-4111-8111-111111111111";
let root: ReturnType<typeof createRoot> | undefined; let container: HTMLDivElement;
const consultas: Array<[string, string]> = [];
async function montar(uid: string | null) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(h(AvisoContratoCambio, { numero: "DTM-0001", uid })));
}
const enfocar = () => act(async () => { window.dispatchEvent(new dom.window.Event("focus")); await new Promise((r) => setTimeout(r, 20)); });
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); nav.__pushes.length = 0; consultas.length = 0; });

test("contrato vigente: no muestra nada ni redirige", async () => {
  __setImpls({ contratoSigueVigente: async (n: string, u: string) => { consultas.push([n, u]); return true; } });
  await montar(UID); await enfocar();
  assert.deepEqual(consultas, [["DTM-0001", UID]], "consulta con el uid que la pantalla ya tenía");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(nav.__pushes, []);
});

test("no se pudo saber (null) o sin uid: ante la duda NO avisa", async () => {
  __setImpls({ contratoSigueVigente: async () => null });
  await montar(UID); await enfocar();
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  await act(async () => root!.unmount()); container.remove();
  consultas.length = 0; __setImpls({ contratoSigueVigente: async (n: string, u: string) => { consultas.push([n, u]); return false; } });
  await montar(null); await enfocar();
  assert.deepEqual(consultas, [], "sin uid ni siquiera consulta");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("contrato eliminado/reemplazado: aviso visible y 'Ir al panel ahora' redirige a /dashboard", async () => {
  __setImpls({ contratoSigueVigente: async () => false });
  await montar(UID); await enfocar();
  const aviso = document.querySelector('[role="alertdialog"]') as HTMLElement;
  assert.ok(aviso, "aparece el aviso");
  assert.match(aviso.textContent ?? "", /DTM-0001 fue eliminado o reemplazado/);
  assert.match(aviso.textContent ?? "", /no se guardará ningún cambio/);
  const boton = [...aviso.querySelectorAll("button")].find((b) => /Ir al panel ahora/.test(b.textContent ?? ""))!;
  await act(async () => { boton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(nav.__pushes, ["/dashboard"]);
});

test("contrato reemplazado: sin tocar nada, la redirección al /dashboard ocurre sola a los 8 s", { timeout: 20000 }, async () => {
  __setImpls({ contratoSigueVigente: async () => false });
  await montar(UID); await enfocar();
  assert.ok(document.querySelector('[role="alertdialog"]'));
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });   // act por segundo: dentro de un solo act React no vacía el contador
  assert.deepEqual(nav.__pushes, ["/dashboard"]);
});
