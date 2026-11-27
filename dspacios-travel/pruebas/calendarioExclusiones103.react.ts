// Block 2026-11-22 (D) — rendered behavior of the exclusions calendar + named sets: pick nights/ranges visually, year boundary navigation, outside-validity nights disabled, applying a set COPIES
// (and reports what falls outside), saving/updating/deleting sets with real failure handling, and the «migration not applied» state. Server Actions are controllable fakes.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
type Rango = { fecha_inicio: string; fecha_fin: string };
type Conj = { id: number; nombre: string; anio: number; tipo: string; rangos: Rango[]; nota: string | null };
type Res = { ok: true; conjunto: Conj } | { ok: false; error: string };
const G = globalThis as unknown as { __cal103: { crear: (i: unknown) => Promise<Res>; actualizar: (id: number, i: unknown) => Promise<Res>; eliminar: (id: number) => Promise<{ ok: true } | { ok: false; error: string }>; llamadas: string[] } };
G.__cal103 = { crear: async () => ({ ok: false, error: "no configurado" }), actualizar: async () => ({ ok: false, error: "no configurado" }), eliminar: async () => ({ ok: true }), llamadas: [] };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./conjuntos-actions" && (context.parentURL ?? "").includes("CalendarioExclusiones")) {
      return { url: datos(`export async function crearConjuntoFechas(i) { globalThis.__cal103.llamadas.push('crear'); return globalThis.__cal103.crear(i); }
export async function actualizarConjuntoFechas(id, i) { globalThis.__cal103.llamadas.push('actualizar:' + id); return globalThis.__cal103.actualizar(id, i); }
export async function eliminarConjuntoFechas(id) { globalThis.__cal103.llamadas.push('eliminar:' + id); return globalThis.__cal103.eliminar(id); }`), shortCircuit: true };
    }
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
const { act, createElement: h, useState } = React;
const { CalendarioExclusiones } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalendarioExclusiones.tsx");

const R = (a: string, b: string): Rango => ({ fecha_inicio: a, fecha_fin: b });
const SS27: Conj = { id: 1, nombre: "Semana Santa", anio: 2027, tipo: "semana_santa", rangos: [R("2027-03-25", "2027-03-28")], nota: null };
const RECESO: Conj = { id: 2, nombre: "Receso escolar", anio: 2027, tipo: "receso_escolar", rangos: [R("2026-12-15", "2027-01-12")], nota: null };

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
let ultimo: Rango[] = [];
/** Controlled wrapper that behaves like the season form: it owns the exclusions state. */
async function render(opts: { vigencia: Rango[]; value?: Rango[]; conjuntos?: Conj[]; disponibles?: boolean }) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const Envoltura = () => {
    const [v, setV] = useState<Rango[]>(opts.value ?? []);
    ultimo = v;
    return h(CalendarioExclusiones, { vigencia: opts.vigencia, value: v, onChange: setV, conjuntos: opts.conjuntos ?? [], conjuntosDisponibles: opts.disponibles ?? true });
  };
  await act(async () => root!.render(h(Envoltura)));
}
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; container?.remove();
  G.__cal103.llamadas.length = 0; ultimo = [];
});
after(() => dom.window.close());
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const dia = (n: number) => [...container.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')].find((b) => b.textContent === String(n))!;
const texto = () => container.textContent ?? "";
const boton = (re: RegExp) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(b.textContent ?? ""))!;
async function clic(el: Element, shift = false) { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, shiftKey: shift })); }); }
async function elegirMes(valor: number) { const sel = container.querySelector<HTMLSelectElement>('select[aria-label="Mes"]')!; await act(async () => { sel.value = String(valor); sel.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); }
async function elegirConjunto(id: number) { const sel = container.querySelector<HTMLSelectElement>("#conjunto-elegido")!; await act(async () => { sel.value = String(id); sel.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); }

test("D1 full-year validity: 12 months to browse; clicking nights excludes/includes them and the result is compact ranges", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")] });
  assert.equal(container.querySelectorAll('select[aria-label="Mes"] option').length, 12);
  await elegirMes(2);                                           // March 2027
  await clic(dia(25)); await clic(dia(26)); await clic(dia(27));
  assert.deepEqual(ultimo, [R("2027-03-25", "2027-03-27")]);
  assert.equal(dia(26).getAttribute("aria-pressed"), "true");
  assert.match(texto(), /3 noches/);
  await clic(dia(26));                                          // include again → two ranges
  assert.deepEqual(ultimo, [R("2027-03-25", "2027-03-25"), R("2027-03-27", "2027-03-27")]);
});

test("D1b shift-click selects the range from the last touched night (either direction) and a second shift-click on selected nights removes them", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")] });
  await elegirMes(2);
  await clic(dia(10));
  await clic(dia(14), true);
  assert.deepEqual(ultimo, [R("2027-03-10", "2027-03-14")]);
  await clic(dia(12), true);                                    // 12 is selected → range 14..12 is REMOVED
  assert.deepEqual(ultimo, [R("2027-03-10", "2027-03-11")]);
});

test("D2 existing saved exclusions load pre-selected and 'Quitar todas' clears them (compatibility with the range data)", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], value: [R("2027-01-02", "2027-01-03"), R("2027-01-10", "2027-01-10")] });
  assert.equal(dia(2).getAttribute("aria-pressed"), "true");
  assert.equal(dia(3).getAttribute("aria-pressed"), "true");
  assert.equal(dia(10).getAttribute("aria-pressed"), "true");
  assert.equal(dia(4).getAttribute("aria-pressed"), "false");
  await clic(boton(/Quitar todas \(3\)/));
  assert.deepEqual(ultimo, []);
});

test("D7 year boundary: validity Dec→Jan lists both months; nights outside the validity are disabled; selection across the boundary merges", async () => {
  await render({ vigencia: [R("2026-12-20", "2027-01-10")] });
  assert.equal(container.querySelectorAll('select[aria-label="Mes"] option').length, 2);
  assert.equal(dia(19).disabled, true, "Dec 19 is before the validity");
  assert.equal(dia(31).disabled, false);
  await clic(dia(30)); await clic(dia(31));
  await clic(container.querySelector('button[aria-label="Mes siguiente"]')!);
  assert.equal(dia(11).disabled, true, "Jan 11 is after the validity");
  await clic(dia(1)); await clic(dia(3), true);
  assert.deepEqual(ultimo, [R("2026-12-30", "2027-01-03")]);
});

test("D7b multi-range validity: the gap between two ranges is not selectable", async () => {
  await render({ vigencia: [R("2027-03-01", "2027-03-10"), R("2027-03-20", "2027-03-31")] });
  assert.equal(dia(15).disabled, true);
  assert.equal(dia(5).disabled, false);
  assert.equal(dia(25).disabled, false);
});

test("D1c no validity dates yet → the calendar asks for them instead of showing an empty grid", async () => {
  await render({ vigencia: [R("", "")] });
  assert.match(texto(), /Define primero las fechas de la vigencia/);
  assert.equal(container.querySelectorAll('[role="gridcell"]').length, 0);
});

test("D3 exclusions that fall outside the validity (validity shortened afterwards) are flagged as not savable", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-02-28")], value: [R("2027-02-27", "2027-03-02")] });
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /2 noche\(s\) excluida\(s\) quedan fuera de la vigencia/);
});

test("D4/D5 applying a set COPIES its nights (button label says so) and reports nothing-linked; applying again is idempotent", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], conjuntos: [SS27, RECESO] });
  assert.match(texto(), /COPIA sus noches/);
  await elegirConjunto(1);
  await clic(boton(/Copiar fechas a esta vigencia/));
  assert.deepEqual(ultimo, [R("2027-03-25", "2027-03-28")]);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Se agregaron 4 noche\(s\)/);
  await clic(boton(/Copiar fechas a esta vigencia/));
  assert.deepEqual(ultimo, [R("2027-03-25", "2027-03-28")]);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Se agregaron 0 noche\(s\).*4 ya estaban excluidas/);
  assert.equal(G.__cal103.llamadas.length, 0, "applying never calls the server: it is a pure copy into the form");
});

test("D7c a set partly outside the validity: the inside part is copied and the outside part is REPORTED", async () => {
  await render({ vigencia: [R("2027-01-10", "2027-06-30")], conjuntos: [RECESO] });
  await elegirConjunto(2);
  await clic(boton(/Copiar fechas a esta vigencia/));
  assert.deepEqual(ultimo, [R("2027-01-10", "2027-01-12")]);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Se agregaron 3 noche\(s\).*26 noche\(s\) del conjunto caen fuera de esta vigencia y NO se copiaron/);
});

test("D4b save the current selection as a named set: sends the nights as ranges + name/year/type, then it is selectable; a server error keeps the form and shows it", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], value: [R("2027-03-25", "2027-03-28")], conjuntos: [] });
  await clic(boton(/Guardar la selección actual como conjunto/));
  const nombre = container.querySelector<HTMLInputElement>("#conjunto-nombre")!;
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(nombre, "Semana Santa"); nombre.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  assert.equal(container.querySelector<HTMLInputElement>("#conjunto-anio")!.value, "2027", "year defaults to the year of the selection");
  let enviado: unknown;
  G.__cal103.crear = async (i) => { enviado = i; return { ok: false, error: "Ya existe un conjunto con ese nombre en ese año. Cambia el nombre o el año." }; };
  await clic(boton(/Guardar conjunto/)); await tick();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Ya existe un conjunto/);
  assert.ok(container.querySelector("#conjunto-nombre"), "form stays open to fix it");
  assert.deepEqual(enviado, { nombre: "Semana Santa", anio: 2027, tipo: "personalizado", rangos: [R("2027-03-25", "2027-03-28")], nota: "" });
  G.__cal103.crear = async () => ({ ok: true, conjunto: { ...SS27, id: 9 } });
  await clic(boton(/Guardar conjunto/)); await tick();
  assert.equal(container.querySelector("#conjunto-nombre"), null, "form closes on success");
  assert.equal(container.querySelector<HTMLSelectElement>("#conjunto-elegido")!.value, "9", "the new set is selected");
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Es una copia: cambiarlo después no modifica las vigencias/);
});

test("D5b deleting a set needs a confirming second click; a failed delete keeps the set listed; a successful one removes it and says validities keep their dates", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], conjuntos: [SS27, RECESO] });
  await elegirConjunto(1);
  await clic(boton(/^Eliminar$/));
  assert.equal(G.__cal103.llamadas.length, 0, "first click only asks for confirmation");
  G.__cal103.eliminar = async () => ({ ok: false, error: "No se pudo eliminar el conjunto: ya no existe o no tienes permiso para borrarlo." });
  await clic(boton(/Confirmar eliminar/)); await tick();
  assert.deepEqual(G.__cal103.llamadas, ["eliminar:1"]);
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /No se pudo eliminar/);
  assert.equal(container.querySelectorAll("#conjunto-elegido option").length, 3, "placeholder + 2 sets: still listed");
  G.__cal103.eliminar = async () => ({ ok: true });
  await clic(boton(/^Eliminar$|Confirmar eliminar/)); await clic(boton(/Confirmar eliminar/)); await tick();
  assert.equal(container.querySelectorAll("#conjunto-elegido option").length, 2, "removed");
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /conservan sus propias fechas/);
});

test("D4c replacing a set's dates with the current selection calls update with the nights as ranges", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], value: [R("2027-03-24", "2027-03-29")], conjuntos: [SS27] });
  await elegirConjunto(1);
  let enviado: unknown;
  G.__cal103.actualizar = async (_id, i) => { enviado = i; return { ok: true, conjunto: { ...SS27, rangos: [R("2027-03-24", "2027-03-29")] } }; };
  await clic(boton(/Reemplazar sus fechas con la selección/)); await tick();
  assert.deepEqual(G.__cal103.llamadas, ["actualizar:1"]);
  assert.deepEqual((enviado as { rangos: Rango[] }).rangos, [R("2027-03-24", "2027-03-29")]);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Las vigencias que ya lo usaron conservan sus propias fechas/);
});

test("D6 nothing is invented: with no sets the panel says so, offers none, and migration-not-applied disables the feature with a clear note", async () => {
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], conjuntos: [] });
  assert.match(container.querySelector("#conjunto-elegido")?.textContent ?? "", /Aún no hay conjuntos/);
  await act(async () => root!.unmount());
  container.remove();
  await render({ vigencia: [R("2027-01-01", "2027-12-31")], disponibles: false });
  assert.match(texto(), /disponibles cuando se aplique la migración 327/);
  assert.equal(container.querySelector("#conjunto-elegido"), null);
  assert.ok(container.querySelectorAll('[role="gridcell"]').length > 0, "the calendar itself still works without sets");
});
