// Block 2026-11-22 (B) — general closures list: a CONFIRMED delete removes the row at once (no manual refresh, no wait for the server list); a failed delete keeps the row and shows the error;
// a created closure appears at once; a double click never sends two deletes. The Server Actions are replaced by controllable fakes; router.refresh is counted (it is the NON-blocking path).
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
type R = { ok: true; aviso?: string; regeneracion?: string; id?: number } | { ok: false; error: string };
const G = globalThis as unknown as { __bo103: { eliminar: (id: number) => Promise<R>; crear: (i: unknown) => Promise<R>; refrescos: number; llamadas: string[] } };
G.__bo103 = { eliminar: async () => ({ ok: true }), crear: async () => ({ ok: true }), refrescos: 0, llamadas: [] };
const FRONTERAS: Record<string, () => string> = {
  "next/navigation": () => datos("export function useRouter() { return { refresh() { globalThis.__bo103.refrescos++; }, push() {}, replace() {} }; }"),
  "@/components/ui/DateInput": () => new URL("./support/stubs/dateInputStub.mjs", import.meta.url).href,
  "./blackouts-actions": () => datos(`export async function crearBlackout(i) { globalThis.__bo103.llamadas.push('crear'); return globalThis.__bo103.crear(i); }
export async function eliminarBlackout(id) { globalThis.__bo103.llamadas.push('eliminar:' + id); return globalThis.__bo103.eliminar(id); }`),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const f = FRONTERAS[specifier];
    if (f && (specifier !== "./blackouts-actions" || (context.parentURL ?? "").includes("HotelBlackouts"))) return { url: f(), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { HotelBlackouts } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelBlackouts.tsx");

const CIERRES = [
  { id: 1, fecha_inicio: "2026-12-29", fecha_fin: "2027-01-09", total: true, acomodaciones: null, categorias: null, motivo: "Fin de año" },
  { id: 2, fecha_inicio: "2027-03-01", fecha_fin: "2027-03-05", total: true, acomodaciones: null, categorias: null, motivo: "Mantenimiento" },
];
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(blackouts = CIERRES) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(h(HotelBlackouts, { hotelId: 9, blackouts, categorias: [] })));
  await act(async () => { [...container.querySelectorAll("button")].find((b) => /Black out general/.test(b.textContent ?? ""))!.click(); });
}
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; container?.remove();
  G.__bo103.llamadas.length = 0; G.__bo103.refrescos = 0; G.__bo103.eliminar = async () => ({ ok: true }); G.__bo103.crear = async () => ({ ok: true });
});
after(() => dom.window.close());
const filas = () => [...container.querySelectorAll("li")].map((l) => l.textContent ?? "");
const eliminarBtn = (i: number) => [...container.querySelectorAll<HTMLButtonElement>("li button")][i];
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test("B1 a confirmed delete removes the row at once, even though the server list prop still contains it (no manual refresh)", async () => {
  await render();
  assert.equal(filas().length, 2);
  await act(async () => { eliminarBtn(0).click(); });
  await tick();
  assert.deepEqual(G.__bo103.llamadas, ["eliminar:1"]);
  assert.equal(filas().length, 1);
  assert.match(filas()[0], /Mantenimiento/);
  assert.equal(G.__bo103.refrescos, 1, "the background refresh was requested but is not what removes the row");
  assert.match(container.textContent ?? "", /Black out general \(1\)/);
});

test("B1b the row stays (with feedback) while the server has not confirmed, and goes the moment it confirms", async () => {
  await render();
  let liberar!: (r: R) => void;
  G.__bo103.eliminar = () => new Promise<R>((res) => { liberar = res; });
  await act(async () => { eliminarBtn(1).click(); });
  assert.equal(filas().length, 2, "still listed while the server has not confirmed");
  assert.match(eliminarBtn(1).textContent ?? "", /Eliminando/, "feedback while pending");
  await act(async () => { liberar({ ok: true, regeneracion: "diferida" }); });
  await tick();
  assert.equal(filas().length, 1);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /segundo plano/);
});

test("B2 a failed delete keeps the row, shows the error and does not refresh", async () => {
  await render();
  G.__bo103.eliminar = async () => ({ ok: false, error: "No se pudo eliminar el cierre: ya no existe o no tienes permiso para borrarlo." });
  await act(async () => { eliminarBtn(0).click(); });
  await tick();
  assert.equal(filas().length, 2, "row stays");
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /No se pudo eliminar/);
  assert.equal(G.__bo103.refrescos, 0);
  assert.equal(eliminarBtn(0).disabled, false, "can retry");
});

test("B2b a rejected/throwing action keeps the row and shows a retry message", async () => {
  await render();
  G.__bo103.eliminar = async () => { throw new Error("network"); };
  await act(async () => { eliminarBtn(0).click(); });
  await tick();
  assert.equal(filas().length, 2);
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Intenta de nuevo/);
});

test("B2c a double click sends ONE delete", async () => {
  await render();
  let liberar!: (r: R) => void;
  G.__bo103.eliminar = () => new Promise<R>((res) => { liberar = res; });
  await act(async () => { eliminarBtn(0).click(); eliminarBtn(0).click(); });
  assert.equal(G.__bo103.llamadas.length, 1);
  await act(async () => { liberar({ ok: true }); });
  await tick();
});

test("B3 a created closure appears at once, sorted by start date, and the form resets", async () => {
  await render();
  G.__bo103.crear = async () => ({ ok: true, id: 77, regeneracion: "diferida" });
  const [ini, fin] = [...container.querySelectorAll<HTMLInputElement>("input")].filter((i) => /Desde|Hasta/.test(i.getAttribute("aria-label") ?? ""));
  assert.ok(ini && fin, "date inputs found");
  const poner = (el: HTMLInputElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await poner(ini, "2026-11-01"); await poner(fin, "2026-11-03");
  await act(async () => { [...container.querySelectorAll("button")].find((b) => /Agregar cierre/.test(b.textContent ?? ""))!.click(); });
  await tick();
  assert.deepEqual(G.__bo103.llamadas, ["crear"]);
  assert.equal(filas().length, 3);
  assert.match(filas()[0], /2026-11-01 → 2026-11-03/, "earliest first");
});

test("B3b a failed create adds nothing and shows the error", async () => {
  await render();
  G.__bo103.crear = async () => ({ ok: false, error: "Indica las fechas de cierre." });
  await act(async () => { [...container.querySelectorAll("button")].find((b) => /Agregar cierre/.test(b.textContent ?? ""))!.click(); });
  await tick();
  assert.equal(filas().length, 2);
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Indica las fechas/);
});
