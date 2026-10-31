// Se ejecuta con npm run test:react. Vista Booking > Receptivos con la 262: filtro por tipo (Tour, Traslado, Asistencia médica, Combo) y elección del alcance del
// traslado (llegada, salida, ida y regreso) ANTES de agregarlo al carrito. Componente real, eventos DOM reales y `buscarReceptivos` doble que registra lo que recibe:
// un traslado sin alcance o sin tarifa propia se muestra pero NO se puede agregar; con alcance se muestra SU precio y el carrito recibe el alcance elegido.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
for (const k of ["HTMLElement", "Element", "Node", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent"] as const) (global as never as Record<string, unknown>)[k] = (dom.window as never as Record<string, unknown>)[k];
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.getBoundingClientRect = function () { return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON() {} }; };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { BuscadorReceptivos } = await import("../app/tarifario/BuscadorReceptivos.tsx");
const { __setBuscarReceptivos } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;

type Res = Record<string, unknown>;
const base = (o: Res): Res => ({ paqueteId: 1, destino: "CARTAGENA", descripcion: null, pax: 2, noches: 3, moneda: "COP", categoria: "tour_traslado", ...o });
const TOUR = base({ servicioId: 1, nombre: "Tour islas", total: 300000, tipoReceptivo: "tour" });
const COMBO = base({ servicioId: 4, nombre: "Combo playa + traslado", total: 410000, tipoReceptivo: "combo" });
const ASIST = base({ servicioId: 5, nombre: "Asistencia médica", total: 90000, tipoReceptivo: "asistencia_medica", categoria: "asistencia" });
const TRASLADO_SIN_ALCANCE = base({ servicioId: 2, nombre: "Traslado aeropuerto", total: 0, tipoReceptivo: "traslado", requiereAlcance: true });
const TRASLADO_LLEGADA = base({ servicioId: 2, nombre: "Traslado aeropuerto", total: 250000, tipoReceptivo: "traslado", alcance: "llegada" });
const TRASLADO_IDA_REGRESO = base({ servicioId: 2, nombre: "Traslado aeropuerto", total: 425000, tipoReceptivo: "traslado", alcance: "ida_regreso" });
const TRASLADO_SIN_TARIFA = base({ servicioId: 2, nombre: "Traslado aeropuerto", total: 0, tipoReceptivo: "traslado", alcance: "salida", sinTarifaAlcance: "Sin tarifa" });

function dispararCambio(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
const inputDe = (c: HTMLElement, etiqueta: string) => [...c.querySelectorAll("label")].find((l) => l.textContent?.trim() === etiqueta)!.parentElement!.querySelector("input") as HTMLInputElement;
const select = (c: HTMLElement, aria: string) => c.querySelector(`select[aria-label="${aria}"]`) as HTMLSelectElement;
const botonBuscar = (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => /Buscar receptivos|Buscando/.test(b.textContent ?? "")) as HTMLButtonElement;
const botonAgregar = (c: HTMLElement) => [...c.querySelectorAll("button")].filter((b) => /Agregar al carrito/.test(b.textContent ?? "")) as HTMLButtonElement[];
const nombres = (c: HTMLElement) => [...c.querySelectorAll(".font-semibold.text-gray-800")].map((e) => e.textContent);

describe("BuscadorReceptivos — tipo de receptivo y alcance del traslado (262)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const agregados: Res[] = [];
  const consultas: Res[] = [];

  async function buscar(resultados: Res[]) {
    __setBuscarReceptivos(async (input: Res) => { consultas.push(input); return { ok: true, resultados }; });
    await act(async () => { botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); });
  }

  before(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(h(BuscadorReceptivos, { onVerDetalle: () => {}, onAgregar: (i: Res) => agregados.push(i) } as never)); });
    await act(async () => {
      dispararCambio(inputDe(container, "Ida"), "2030-01-01");
      dispararCambio(inputDe(container, "Regreso"), "2030-01-05");
    });
  });
  after(() => { act(() => root.unmount()); container.remove(); });

  test("ofrece los cuatro tipos y el alcance (llegada, salida, ida y regreso)", () => {
    const tipos = [...select(container, "Tipo de receptivo").options].map((o) => o.textContent);
    assert.deepEqual(tipos, ["Todos", "Tour", "Traslado", "Asistencia médica", "Combo"]);
    const alc = [...select(container, "Alcance del traslado").options].map((o) => o.textContent);
    assert.deepEqual(alc, ["Elegir alcance", "Un trayecto: llegada", "Un trayecto: salida", "Ida y regreso"]);
  });

  test("sin alcance elegido: el traslado se muestra pero NO se puede agregar (sin precio); los demás sí", async () => {
    await buscar([TOUR, TRASLADO_SIN_ALCANCE]);
    assert.equal(consultas.at(-1)!.alcance, undefined, "no se envía alcance si no se eligió");
    assert.ok(container.querySelector('[data-testid="requiere-alcance"]'));
    const botones = botonAgregar(container);
    assert.equal(botones.length, 2);
    assert.deepEqual(botones.map((b) => b.disabled), [false, true], "el tour se agrega; el traslado sin alcance no");
  });

  test("con alcance elegido: se envía a la búsqueda, se muestra SU precio y el carrito recibe el alcance", async () => {
    await act(async () => { dispararCambio(select(container, "Alcance del traslado"), "llegada"); });
    await buscar([TRASLADO_LLEGADA]);
    assert.equal(consultas.at(-1)!.alcance, "llegada");
    assert.match(container.textContent ?? "", /250\.000/);
    assert.match(container.textContent ?? "", /un trayecto: llegada/i);
    const [b] = botonAgregar(container);
    assert.equal(b.disabled, false);
    await act(async () => { b.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    assert.equal(agregados.length, 1);
    assert.equal(agregados[0].alcance, "llegada"); assert.equal(agregados[0].precio, 250000); assert.equal(agregados[0].servicioId, 2);
  });

  test("ida y regreso muestra su precio propio (no el doble del trayecto) y se agrega con ese alcance", async () => {
    await act(async () => { dispararCambio(select(container, "Alcance del traslado"), "ida_regreso"); });
    await buscar([TRASLADO_IDA_REGRESO]);
    assert.equal(consultas.at(-1)!.alcance, "ida_regreso");
    assert.match(container.textContent ?? "", /425\.000/);
    await act(async () => { botonAgregar(container)[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    assert.equal(agregados.at(-1)!.alcance, "ida_regreso"); assert.equal(agregados.at(-1)!.precio, 425000);
  });

  test("sin tarifa propia para ese alcance y rango de pasajeros: no se vende ni se muestra otro precio", async () => {
    await act(async () => { dispararCambio(select(container, "Alcance del traslado"), "salida"); });
    await buscar([TRASLADO_SIN_TARIFA]);
    assert.ok(container.querySelector('[data-testid="sin-tarifa-alcance"]'));
    assert.match(container.textContent ?? "", /Sin tarifa propia para un trayecto: salida con 2 pasajeros/);
    assert.equal(botonAgregar(container)[0].disabled, true);
    assert.doesNotMatch(container.textContent ?? "", /250\.000|425\.000/);
  });

  test("el filtro por tipo muestra solo Tour, Traslado, Asistencia médica o Combo", async () => {
    await buscar([TOUR, TRASLADO_LLEGADA, COMBO, ASIST]);
    const filtrar = async (v: string) => { await act(async () => { dispararCambio(select(container, "Tipo de receptivo"), v); }); return nombres(container); };
    assert.deepEqual(await filtrar(""), ["Tour islas", "Traslado aeropuerto", "Combo playa + traslado", "Asistencia médica"]);
    assert.deepEqual(await filtrar("tour"), ["Tour islas"]);
    assert.deepEqual(await filtrar("traslado"), ["Traslado aeropuerto"]);
    assert.deepEqual(await filtrar("asistencia_medica"), ["Asistencia médica"]);
    assert.deepEqual(await filtrar("combo"), ["Combo playa + traslado"]);
    assert.match(container.textContent ?? "", /1 receptivo\(s\) disponibles/);
  });
});
