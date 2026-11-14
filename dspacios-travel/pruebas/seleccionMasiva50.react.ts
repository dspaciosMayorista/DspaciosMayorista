// #50 — «Seleccionar/Deseleccionar todos» en tres listas: lado Sistema de Conciliaciones, servicios del
// contrato pendiente y categorías/acomodaciones de blackouts. La casilla maestra SOLO cambia la selección:
// actúa sobre las filas visibles y habilitadas, conserva lo seleccionado fuera del filtro y nunca llama una
// Server Action (cruzar, guardar ni crear). Las acciones se sustituyen por espías que fallan la prueba si
// alguien las invoca.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const espia = (nombres: string[]) => datos(nombres.map((n) => `export async function ${n}(...a) { globalThis.__llamadas50.push(${JSON.stringify(n)}); return { ok: true }; }`).join("\n"));
const FRONTERAS: Record<string, (parent: string) => string | null> = {
  "next/navigation": () => datos("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; }"),
  "@/components/ui/DateInput": () => new URL("./support/stubs/dateInputStub.mjs", import.meta.url).href,
  "./actions": (p) => p.includes("conciliaciones") ? espia(["importarExtracto", "cruzar", "deshacerCruce", "eliminarLineaExtracto", "eliminarLineasExtracto", "eliminarPeriodoExtracto", "registrarMovimientoDirecto"]) : null,
  "../libro-diario/actions": () => espia(["listarCuentasMovimiento"]),
  "../actions": (p) => p.includes("contratos") ? espia(["actualizarServiciosContrato"]) : null,
  "./blackouts-actions": () => espia(["crearBlackout", "eliminarBlackout"]),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = FRONTERAS[specifier]?.(decodeURIComponent(context.parentURL ?? ""));
    if (url) return { url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const llamadas: string[] = [];
(globalThis as unknown as { __llamadas50: string[] }).__llamadas50 = llamadas;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { ConciliacionesClient } = await import("../app/(dashboard)/dashboard/contabilidad/conciliaciones/ConciliacionesClient.tsx");
const { ServiciosContratoEditor } = await import("../app/(dashboard)/dashboard/contratos/[numero]/ServiciosContratoEditor.tsx");
const { HotelBlackouts } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelBlackouts.tsx");
const { alternarVisibles, estadoVisibles } = await import("../lib/paquetes/seleccionMasiva.ts");

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(el: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  llamadas.length = 0;
});
after(() => dom.window.close());

const porTexto = (sel: string, texto: RegExp) => [...container.querySelectorAll<HTMLElement>(sel)].filter((e) => texto.test(e.textContent ?? ""));
async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); }
async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const maestra = (texto: RegExp) => porTexto("label", texto)[0]?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;

// ─── Helpers puros ───────────────────────────────────────────────────────────
test("helpers: solo visibles, conserva ocultas, cero y muchas filas", () => {
  assert.deepEqual([...alternarVisibles(new Set(["oculta"]), ["a", "b"])].sort(), ["a", "b", "oculta"]);
  assert.deepEqual([...alternarVisibles(new Set(["a", "b", "oculta"]), ["a", "b"])], ["oculta"]);
  assert.deepEqual([...alternarVisibles(new Set(["a"]), ["a", "b"])].sort(), ["a", "b"]); // parcial → completa
  assert.deepEqual([...alternarVisibles(new Set<string>(), [])], []);                     // cero filas: no-op
  const muchas = Array.from({ length: 5000 }, (_, i) => i);
  assert.equal(alternarVisibles(new Set<number>(), muchas).size, 5000);
  const e = estadoVisibles(new Set(["a", "x"]), ["a", "b"]);
  assert.deepEqual([e.checked, e.indeterminate, e.ocultas, e.etiqueta], [false, true, 1, "Seleccionar todos"]);
  assert.equal(estadoVisibles(new Set<string>(), []).checked, false);
});

// ─── Conciliaciones, lado Sistema ────────────────────────────────────────────
const vacia = { numeroContrato: null, contratoId: null } as const;
const item = (ref: string, valor: number, fecha = "2026-10-05") =>
  ({ ref, tipo: "Abono", descripcion: `Abono ${ref}`, fecha, valor, numeroContrato: `00-${ref}`, identidad: vacia as never, categoria: "cartera" as const });

test("Conciliaciones: la maestra respeta el filtro, conserva lo oculto y no cruza nada", async () => {
  await render(h(ConciliacionesClient, { extracto: [], cruces: [], sistema: [item("1", 100), item("2", 200), item("3", 5000)] }));
  const filas = () => [...container.querySelectorAll<HTMLElement>("div.cursor-pointer")].filter((d) => /Abono \d/.test(d.textContent ?? ""));
  assert.equal(filas().length, 3);
  await click(filas().find((f) => f.textContent!.includes("Abono 3"))!); // seleccionada antes de filtrar
  await escribir(container.querySelectorAll<HTMLInputElement>('input[placeholder="Valor máx"]')[1], "1000");
  assert.equal(filas().length, 2);
  assert.ok(porTexto("span", /^1 seleccionado fuera del filtro$/).length, "se avisa la selección oculta");

  const m = maestra(/Seleccionar todos \(visibles\)/)!;
  assert.equal(m.checked, false);
  await click(m);
  assert.ok(filas().every((f) => f.querySelector<HTMLInputElement>("input")!.checked));
  assert.ok(maestra(/Deseleccionar todos \(visibles\)/)!.checked);

  await click(filas()[0]); // selección parcial → indeterminada
  assert.equal(maestra(/Seleccionar todos \(visibles\)/)!.indeterminate, true);
  await click(maestra(/Seleccionar todos \(visibles\)/)!);
  await click(maestra(/Deseleccionar todos \(visibles\)/)!);
  assert.ok(filas().every((f) => !f.querySelector<HTMLInputElement>("input")!.checked));
  assert.ok(porTexto("span", /^1 seleccionado fuera del filtro$/).length, "deseleccionar visibles no toca la oculta");

  await escribir(container.querySelectorAll<HTMLInputElement>('input[placeholder="Valor máx"]')[1], "");
  assert.ok(filas().find((f) => f.textContent!.includes("Abono 3"))!.querySelector<HTMLInputElement>("input")!.checked);
  assert.deepEqual(llamadas, [], "la selección masiva no ejecuta ninguna acción");
});

test("Conciliaciones: sin filas visibles no hay casilla maestra", async () => {
  await render(h(ConciliacionesClient, { extracto: [], cruces: [], sistema: [item("1", 100)] }));
  await escribir(container.querySelectorAll<HTMLInputElement>('input[placeholder="Valor mín"]')[1], "999");
  assert.equal(maestra(/todos \(visibles\)/), null);
});

// ─── Servicios del contrato pendiente ────────────────────────────────────────
const svc = (servicioId: number, nombre: string, personaPvp: number | null, modo: "persona" | "grupo" = "persona") =>
  ({ servicioId, nombre, modo, personaPvp, grupos: modo === "grupo" ? [{ pax_desde: 10, pax_hasta: 20, precio: 900 }] : [] });

test("Servicios: no marca filas sin precio, sí las desmarca, y no guarda solo", async () => {
  const servicios = [svc(1, "Tour A", 100), svc(2, "Tour B", 200), svc(3, "Grupo sin rango", null, "grupo")];
  await render(h(ServiciosContratoEditor, { numero: "00-1", pax: 2, serviciosDisp: servicios, seleccionInicial: [], identidad: {} as never }));
  const caja = (n: string) => porTexto("li label", new RegExp(n))[0].querySelector<HTMLInputElement>("input")!;
  assert.equal(caja("Grupo sin rango").disabled, true);
  await click(maestra(/^Seleccionar todos$/)!);
  assert.deepEqual([caja("Tour A").checked, caja("Tour B").checked, caja("Grupo sin rango").checked], [true, true, false]);
  await click(maestra(/^Deseleccionar todos$/)!);
  assert.deepEqual([caja("Tour A").checked, caja("Tour B").checked], [false, false]);
  assert.deepEqual(llamadas, []);
});

test("Servicios: una fila sin precio ya marcada entra en «Deseleccionar todos»", async () => {
  const servicios = [svc(1, "Tour A", 100), svc(3, "Grupo sin rango", null, "grupo")];
  await render(h(ServiciosContratoEditor, { numero: "00-1", pax: 2, serviciosDisp: servicios, seleccionInicial: [3], identidad: {} as never }));
  assert.equal(maestra(/^Seleccionar todos$/)!.indeterminate, true);
  await click(maestra(/^Seleccionar todos$/)!);
  await click(maestra(/^Deseleccionar todos$/)!);
  const sinRango = porTexto("li label", /Grupo sin rango/)[0].querySelector<HTMLInputElement>("input")!;
  assert.equal(sinRango.checked, false);
  assert.ok(porTexto("button", /Guardar servicios/)[0] && !(porTexto("button", /Guardar servicios/)[0] as HTMLButtonElement).disabled);
  assert.deepEqual(llamadas, []);
});

test("Servicios: con una sola fila habilitada no se ofrece la maestra", async () => {
  await render(h(ServiciosContratoEditor, { numero: "00-1", pax: 2, serviciosDisp: [svc(1, "Tour A", 100), svc(3, "Sin rango", null, "grupo")], seleccionInicial: [], identidad: {} as never }));
  assert.equal(maestra(/todos/), null);
});

// ─── Blackouts: categorías y acomodaciones ───────────────────────────────────
test("Blackouts: maestras de categorías y acomodaciones solo cambian el formulario", async () => {
  await render(h(HotelBlackouts, { hotelId: 9, blackouts: [], categorias: ["Estándar", "Superior", "Suite"] }));
  await click(porTexto("button", /Black out general/)[0]);
  await click(porTexto("label", /Cierre total/)[0].querySelector("input")!);
  const [mCats, mAcoms] = porTexto("label", /^Seleccionar todos$/).map((l) => l.querySelector<HTMLInputElement>("input")!);
  const casilla = (t: string) => porTexto("label", new RegExp(`^\\s*${t}$`))[0].querySelector<HTMLInputElement>("input")!;
  await click(casilla("Superior"));
  assert.equal(mCats.indeterminate, true);
  await click(mCats);
  assert.ok(["Estándar", "Superior", "Suite"].every((c) => casilla(c).checked));
  assert.ok(porTexto("p", /Cierra Estándar, Superior, Suite por completo/).length, "orden del catálogo preservado");
  await click(mAcoms);
  assert.ok(porTexto("p", /solo en Estándar, Superior, Suite/).length);
  await click(porTexto("label", /^Deseleccionar todos$/)[0].querySelector("input")!);
  assert.ok(["Estándar", "Superior", "Suite"].every((c) => !casilla(c).checked));
  assert.deepEqual(llamadas, [], "no crea el blackout");
});

test("Blackouts: con una sola categoría no se ofrece maestra de categorías", async () => {
  await render(h(HotelBlackouts, { hotelId: 9, blackouts: [], categorias: ["Única"] }));
  await click(porTexto("button", /Black out general/)[0]);
  await click(porTexto("label", /Cierre total/)[0].querySelector("input")!);
  assert.equal(porTexto("label", /^Seleccionar todos$/).length, 1, "solo la de acomodaciones");
});
