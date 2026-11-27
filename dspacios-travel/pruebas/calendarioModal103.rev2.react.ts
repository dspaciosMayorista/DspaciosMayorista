// H103-03/04 (owner review correction batch, 2026-11-26): the visual calendar lives in a MODAL that edits a DRAFT of the validity's exclusions; the compact range list stays the primary display.
// Applying a saved set only COPIES nights into the validity being edited (it never calls the server and never creates a validity); «Empezar una vigencia nueva…» only hands the set to the form.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
type Rango = { fecha_inicio: string; fecha_fin: string };
type Conj = { id: number; nombre: string; anio: number; tipo: string; rangos: Rango[]; nota: string | null };
const G = globalThis as unknown as { __mod103: { llamadas: string[] } };
G.__mod103 = { llamadas: [] };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./conjuntos-actions" && (context.parentURL ?? "").includes("CalendarioExclusiones")) {
      return { url: datos(`const n = (x) => async (...a) => { globalThis.__mod103.llamadas.push(x); return { ok: false, error: 'no configurado' }; };
export const crearConjuntoFechas = n('crear'); export const actualizarConjuntoFechas = n('actualizar'); export const eliminarConjuntoFechas = n('eliminar');`), shortCircuit: true };
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
const { CalendarioExclusionesModal } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalendarioExclusionesModal.tsx");

const R = (a: string, b: string): Rango => ({ fecha_inicio: a, fecha_fin: b });
const SS27: Conj = { id: 1, nombre: "Semana Santa", anio: 2027, tipo: "semana_santa", rangos: [R("2027-03-25", "2027-03-28")], nota: null };
const VIG = [R("2027-01-01", "2027-12-31")];

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
let lista: Rango[] = [];
let cambios = 0;
let nuevaDesde: Conj[] = [];
async function render(opts: { value?: Rango[]; conjuntos?: Conj[]; nombre?: string; conNueva?: boolean } = {}) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const Envoltura = () => {
    const [v, setV] = useState<Rango[]>(opts.value ?? []);
    lista = v;
    return h("div", null,
      h("p", { "data-testid": "lista" }, JSON.stringify(v)),
      h(CalendarioExclusionesModal, {
        vigencia: VIG, value: v, onChange: (x: Rango[]) => { cambios++; setV(x); }, conjuntos: opts.conjuntos ?? [], conjuntosDisponibles: true,
        nombreVigencia: opts.nombre, onNuevaVigencia: opts.conNueva ? (c: Conj) => { nuevaDesde.push(c); } : undefined,
      }));
  };
  await act(async () => root!.render(h(Envoltura)));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); G.__mod103.llamadas.length = 0; lista = []; cambios = 0; nuevaDesde = []; });
after(() => dom.window.close());
const abrirBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="abrir-calendario-exclusiones"]')!;
const dialogo = () => container.querySelector('[role="dialog"]');
const boton = (re: RegExp) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(b.textContent ?? b.getAttribute("aria-label") ?? "") || re.test(b.getAttribute("aria-label") ?? ""))!;
const dia = (n: number) => [...container.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')].find((b) => b.textContent === String(n))!;
async function clic(el: Element, shift = false) { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, shiftKey: shift })); }); }
async function elegirMes(valor: number) { const sel = container.querySelector<HTMLSelectElement>('select[aria-label="Mes"]')!; await act(async () => { sel.value = String(valor); sel.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); }
async function elegirConjunto(id: number) { const sel = container.querySelector<HTMLSelectElement>("#conjunto-elegido")!; await act(async () => { sel.value = String(id); sel.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); }
const escape = () => act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });

test("M1 closed by default: only the opener button is shown (with the night count); the calendar is not in the page until it is opened", async () => {
  await render();
  assert.equal(dialogo(), null);
  assert.equal(container.querySelectorAll('[role="gridcell"]').length, 0);
  assert.match(abrirBtn().textContent ?? "", /Elegir fechas en el calendario/);
  assert.doesNotMatch(abrirBtn().textContent ?? "", /\(/, "no count when nothing is excluded");
  await act(async () => root!.unmount()); container.remove();
  await render({ value: [R("2027-03-25", "2027-03-27")] });
  assert.match(abrirBtn().textContent ?? "", /\(3 noches\)/);
});

test("M2 the modal edits a DRAFT: toggling nights and a shift-range change nothing in the list until «Aplicar a la lista»; applying commits once and closes", async () => {
  await render();
  await clic(abrirBtn());
  const d = dialogo()!;
  assert.equal(d.getAttribute("aria-modal"), "true");
  assert.ok(d.getAttribute("aria-label"));
  await elegirMes(2);
  await clic(dia(25)); await clic(dia(28), true);
  assert.equal(cambios, 0, "nothing is committed while the modal draft changes");
  assert.deepEqual(lista, []);
  await clic(boton(/^Aplicar a la lista$/));
  assert.equal(cambios, 1);
  assert.deepEqual(lista, [R("2027-03-25", "2027-03-28")]);
  assert.equal(dialogo(), null, "closes on apply");
  assert.match(abrirBtn().textContent ?? "", /\(4 noches\)/);
});

test("M3 Cancel, the X and Escape discard the draft; reopening shows the list as it was", async () => {
  await render({ value: [R("2027-01-02", "2027-01-03")] });
  for (const cerrar of [() => clic(boton(/^Cancelar$/)), () => clic(boton(/Cerrar sin aplicar/)), () => escape()]) {
    await clic(abrirBtn());
    await clic(dia(10));                                       // draft now has Jan 10 too
    await cerrar();
    assert.equal(dialogo(), null);
    assert.equal(cambios, 0);
    assert.deepEqual(lista, [R("2027-01-02", "2027-01-03")]);
    await clic(abrirBtn());
    assert.equal(dia(10).getAttribute("aria-pressed"), "false", "the discarded night is not there when reopened");
    await escape();
  }
});

test("M4 focus: moves into the dialog on open, Tab wraps last→first and Shift+Tab first→last, and returns to the opener on close", async () => {
  await render();
  const op = abrirBtn(); op.focus();
  await clic(op);
  const items = [...dialogo()!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
  assert.ok(dialogo()!.contains(document.activeElement), "focus is inside the dialog");
  const primero = items[0], ultimo = items[items.length - 1];
  ultimo.focus();
  await act(async () => { dialogo()!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
  assert.equal(document.activeElement, primero);
  await act(async () => { dialogo()!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
  assert.equal(document.activeElement, ultimo);
  await clic(boton(/^Cancelar$/));
  assert.equal(document.activeElement, abrirBtn(), "focus goes back to the button that opened it");
});

test("H103-04 a saved set COPIES nights into the validity being edited: the modal names that validity, says a set is not a validity, never calls the server, and nothing persists without «Aplicar a la lista» + the validity's own save", async () => {
  await render({ conjuntos: [SS27], nombre: "Alta 2027" });
  await clic(abrirBtn());
  assert.match(container.querySelector('[data-testid="conjunto-destino"]')?.textContent ?? "", /Vigencia en edición: Alta 2027/);
  assert.match(container.querySelector('[data-testid="conjunto-aclaracion"]')?.textContent ?? "", /no es una vigencia.*no crea una vigencia nueva ni cambia otra ya guardada/);
  assert.equal(container.querySelector('button[title*="no guarda nada"]'), null, "no «new validity» button unless the form offers it");
  await elegirConjunto(1);
  await clic(boton(/Copiar fechas a esta vigencia/));
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Se agregaron 4 noche\(s\) de «Semana Santa 2027» a las exclusiones de esta vigencia \(aún sin guardar\)/);
  assert.deepEqual(lista, [], "the list is untouched until the modal is applied");
  await clic(boton(/^Aplicar a la lista$/));
  assert.deepEqual(lista, [R("2027-03-25", "2027-03-28")]);
  assert.deepEqual(G.__mod103.llamadas, [], "no server call at any point");
});

test("H103-04 a new, unsaved validity is announced as such; «Empezar una vigencia nueva con este conjunto» only hands the set to the form (no server call, list untouched) and closes", async () => {
  await render({ conjuntos: [SS27], nombre: "", conNueva: true });
  await clic(abrirBtn());
  assert.match(container.querySelector('[data-testid="conjunto-destino"]')?.textContent ?? "", /nueva \(sin guardar\)/);
  const nueva = () => boton(/Empezar una vigencia nueva con este conjunto/);
  assert.equal(nueva().disabled, true, "needs a chosen set");
  await elegirConjunto(1);
  await clic(nueva());
  assert.deepEqual(nuevaDesde, [SS27]);
  assert.equal(dialogo(), null);
  assert.equal(cambios, 0);
  assert.deepEqual(G.__mod103.llamadas, []);
});

test("H103-03 wiring: the season form shows the COMPACT range list as the primary exclusions control and opens the calendar only from the modal; no inline calendar, no hidden «details» for the list", () => {
  const f = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx", import.meta.url), "utf8");
  assert.match(f, /<ListaRangos titulo="Black-outs \(fechas a excluir\)"[\s\S]{0,400}accion=\{<CalendarioExclusionesModal/);
  assert.doesNotMatch(f, /<CalendarioExclusiones\s/, "the inline calendar is gone");
  assert.doesNotMatch(f, /Ver o editar las exclusiones como rangos de fechas/, "the list is no longer tucked away");
  assert.match(f, /onNuevaVigencia=\{editando \? undefined/, "«new validity from set» is offered only when not editing a saved validity");
});
