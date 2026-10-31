// Se ejecuta con npm run test:react. Vista Booking > Receptivos con la 262: formulario tipo → modalidad del traslado → horas → buscar. Modalidad y horas solo existen con el
// tipo «Traslado» (ida y regreso por defecto; llegada = solo hora de llegada, salida = solo hora de salida, ida y regreso = ambas) y una hora oculta NUNCA se envía.
// Componente real, eventos DOM reales y `buscarReceptivos` doble que registra lo que recibe. Sin tarifa propia un traslado se muestra pero NO se puede agregar ni se
// sustituye por otro precio; «Tu búsqueda» resume los filtros usados.
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
const { ExploraReceptivos } = await import("../app/tarifario/ExploraReceptivos.tsx");
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

const dirigido = (c: HTMLElement, aria: string) => c.querySelector(`select[aria-label="${aria}"]`) as HTMLSelectElement | null;
const horaDe = (c: HTMLElement, etiqueta: string) => dirigido(c, `${etiqueta}: hora`);
async function ponerHora(c: HTMLElement, etiqueta: string, hhmm: string) {
  const [hh, mm] = hhmm.split(":");
  await act(async () => { dispararCambio(horaDe(c, etiqueta)!, hh); });
  await act(async () => { dispararCambio(dirigido(c, `${etiqueta}: minutos`)!, mm); });
}
const valorHora = (c: HTMLElement, etiqueta: string) => { const h = horaDe(c, etiqueta)?.value ?? ""; const m = dirigido(c, `${etiqueta}: minutos`)?.value ?? ""; return h ? `${h}:${m}` : ""; };
const ETQ_LLEGADA = "Hora de llegada del traslado", ETQ_SALIDA = "Hora de salida del traslado";
const hayHoras = (c: HTMLElement) => [!!horaDe(c, ETQ_LLEGADA), !!horaDe(c, ETQ_SALIDA)];
const despues = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);

describe("BuscadorReceptivos — tipo, modalidad del traslado y horas (262)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const agregados: Res[] = [];
  const consultas: Res[] = [];
  const cambiarTipo = (v: string) => act(async () => { dispararCambio(select(container, "Tipo de receptivo"), v); });
  const cambiarModalidad = (v: string) => act(async () => { dispararCambio(select(container, "Modalidad del traslado"), v); });

  async function buscar(resultados: Res[] | { ok: false; error: string }) {
    __setBuscarReceptivos(async (input: Res) => { consultas.push(input); return Array.isArray(resultados) ? { ok: true, resultados } : resultados; });
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

  test("sin elegir tipo no hay modalidad ni horas; se explica que los traslados van como ida y regreso", () => {
    const tipos = [...select(container, "Tipo de receptivo").options].map((o) => o.textContent);
    assert.deepEqual(tipos, ["Todos", "Tour", "Traslado", "Asistencia médica", "Combo"]);
    assert.equal(dirigido(container, "Modalidad del traslado"), null);
    assert.deepEqual(hayHoras(container), [false, false]);
    assert.match(container.querySelector('[data-testid="nota-traslados-por-defecto"]')?.textContent ?? "", /traslados se muestran con precio de ida y regreso/i);
  });

  test("al elegir Traslado: modalidad Ida y regreso por defecto (visible en pantalla), ambas horas y orden tipo → modalidad → horas → Buscar", async () => {
    await cambiarTipo("traslado");
    const mod = select(container, "Modalidad del traslado");
    assert.deepEqual([...mod.options].map((o) => o.textContent), ["Un trayecto: llegada", "Un trayecto: salida", "Ida y regreso"]);
    assert.equal(mod.value, "ida_regreso"); assert.equal(mod.selectedOptions[0].textContent, "Ida y regreso");
    assert.deepEqual(hayHoras(container), [true, true]);
    assert.equal(container.querySelector('[data-testid="nota-traslados-por-defecto"]'), null);
    assert.ok(container.querySelector('[data-testid="ayuda-traslado"]'));
    const tipo = select(container, "Tipo de receptivo"), hl = container.querySelector('[data-testid="hora-llegada"]')!, hs = container.querySelector('[data-testid="hora-salida"]')!;
    assert.ok(despues(tipo, mod), "tipo antes que modalidad"); assert.ok(despues(mod, hl), "modalidad antes que las horas");
    assert.ok(despues(hl, hs)); assert.ok(despues(hs, botonBuscar(container)), "las horas antes de Buscar");
  });

  test("las horas son el componente HoraInput24 (listas de 24 h con etiqueta): ningún <input type=time> nativo en el formulario", () => {
    assert.equal(container.querySelectorAll('input[type="time"]').length, 0);
    for (const e of [ETQ_LLEGADA, ETQ_SALIDA]) {
      const grupo = container.querySelector(`[role="group"][aria-label="${e}"]`);
      assert.ok(grupo, `grupo accesible ${e}`);
      assert.deepEqual([...horaDe(container, e)!.options].map((o) => o.value).slice(0, 3), ["", "00", "01"]);
      assert.equal(horaDe(container, e)!.options.length, 25, "--, 00 … 23: formato de 24 horas, sin AM/PM");
    }
  });

  test("llegada → solo hora de llegada; salida → solo hora de salida; ida y regreso → ambas", async () => {
    await cambiarModalidad("llegada"); assert.deepEqual(hayHoras(container), [true, false]);
    await cambiarModalidad("salida"); assert.deepEqual(hayHoras(container), [false, true]);
    await cambiarModalidad("ida_regreso"); assert.deepEqual(hayHoras(container), [true, true]);
  });

  test("una hora de un tramo que se oculta se descarta y no se envía: llegada (con salida tecleada antes) manda solo la llegada", async () => {
    await ponerHora(container, ETQ_LLEGADA, "22:00"); await ponerHora(container, ETQ_SALIDA, "05:30");
    assert.equal(valorHora(container, ETQ_LLEGADA), "22:00"); assert.equal(valorHora(container, ETQ_SALIDA), "05:30");
    await cambiarModalidad("llegada");
    await buscar([TRASLADO_LLEGADA]);
    assert.deepEqual(consultas.at(-1)!.horas, { llegada: "22:00", salida: "" }, "la hora de salida oculta no viaja");
    assert.equal(consultas.at(-1)!.alcance, "llegada");
    await cambiarModalidad("ida_regreso");
    assert.equal(valorHora(container, ETQ_SALIDA), "", "al volver a mostrarse, la salida descartada no reaparece");
    assert.equal(valorHora(container, ETQ_LLEGADA), "22:00", "la llegada, que nunca se ocultó, se conserva");
  });

  test("cambiar a otro tipo no envía horas ocultas ni modalidad: el servidor cotiza los traslados como ida y regreso", async () => {
    await ponerHora(container, ETQ_SALIDA, "05:00");
    await cambiarTipo("tour");
    assert.equal(dirigido(container, "Modalidad del traslado"), null); assert.deepEqual(hayHoras(container), [false, false]);
    await buscar([TOUR]);
    assert.deepEqual(consultas.at(-1)!.horas, { llegada: "", salida: "" }, "sin el tipo Traslado no viaja ninguna hora");
    assert.equal(consultas.at(-1)!.alcance, undefined, "ni modalidad");
    // volver a Traslado: modalidad por defecto de nuevo y horas vacías (no se conservan las ocultas)
    await cambiarTipo("traslado");
    assert.equal(select(container, "Modalidad del traslado").value, "ida_regreso");
    assert.equal(valorHora(container, ETQ_LLEGADA), ""); assert.equal(valorHora(container, ETQ_SALIDA), "");
  });

  test("búsqueda SIN modalidad (tipo Todos): no se envía alcance, los traslados llegan como ida y regreso y se dice en pantalla", async () => {
    await cambiarTipo("");
    await buscar([TOUR, TRASLADO_IDA_REGRESO]);
    assert.equal(consultas.at(-1)!.alcance, undefined, "el cliente no inventa una modalidad; el servidor aplica la de por defecto");
    assert.match(container.textContent ?? "", /un precio de ida y regreso|total · ida y regreso/i);
    const chips = [...container.querySelectorAll('[data-testid="filtros-aplicados"] li')].map((l) => l.textContent);
    assert.ok(chips.includes("Todos los tipos")); assert.ok(chips.includes("Traslados: Ida y regreso"));
  });

  test("Traslado + ida y regreso: se envía la modalidad, se muestra SU precio y el carrito recibe el alcance", async () => {
    await cambiarTipo("traslado");
    await buscar([TRASLADO_IDA_REGRESO]);
    assert.equal(consultas.at(-1)!.alcance, "ida_regreso");
    assert.match(container.textContent ?? "", /425\.000/);
    await act(async () => { botonAgregar(container)[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    assert.equal(agregados.at(-1)!.alcance, "ida_regreso"); assert.equal(agregados.at(-1)!.precio, 425000);
  });

  test("un trayecto elegido: se envía llegada, se muestra SU precio y el carrito recibe el alcance", async () => {
    await cambiarModalidad("llegada");
    await buscar([TRASLADO_LLEGADA]);
    assert.equal(consultas.at(-1)!.alcance, "llegada");
    assert.match(container.textContent ?? "", /250\.000/); assert.match(container.textContent ?? "", /un trayecto: llegada/i);
    await act(async () => { botonAgregar(container)[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    assert.equal(agregados.at(-1)!.alcance, "llegada"); assert.equal(agregados.at(-1)!.precio, 250000);
  });

  test("sin tarifa propia de la modalidad elegida: no se vende ni se muestra el precio de otra modalidad", async () => {
    await cambiarModalidad("ida_regreso");
    await buscar([{ ...TRASLADO_SIN_TARIFA, alcance: "ida_regreso" }]);
    assert.ok(container.querySelector('[data-testid="sin-tarifa-alcance"]'));
    assert.match(container.textContent ?? "", /Sin tarifa propia para ida y regreso con 2 pasajeros/);
    assert.equal(botonAgregar(container)[0].disabled, true);
    assert.doesNotMatch(container.textContent ?? "", /250\.000|425\.000/);
  });

  test("respuesta antigua con requiereAlcance: se muestra, indica qué elegir y NO se puede agregar", async () => {
    await cambiarTipo("");
    await buscar([TOUR, TRASLADO_SIN_ALCANCE]);
    assert.ok(container.querySelector('[data-testid="requiere-alcance"]'));
    assert.deepEqual(botonAgregar(container).map((b) => b.disabled), [false, true]);
  });

  test("estados de resultados: «Tu búsqueda» con sus filtros, vacío con mensaje, error sin sección, y los chips reflejan la búsqueda hecha (no el formulario)", async () => {
    await cambiarTipo("traslado"); await cambiarModalidad("salida"); await ponerHora(container, ETQ_SALIDA, "06:15");
    await buscar([TRASLADO_LLEGADA]);
    const sec = container.querySelector('[data-testid="tu-busqueda"]')!;
    assert.ok(sec, "con resultados: sección Tu búsqueda"); assert.equal(sec.querySelector("h2")?.textContent, "Tu búsqueda");
    const chips = () => [...container.querySelectorAll('[data-testid="filtros-aplicados"] li')].map((l) => l.textContent);
    assert.deepEqual(chips(), ["Todos los destinos", "01/01/2030 → 05/01/2030", "2 pax", "Traslado", "Modalidad: Un trayecto: salida", "Salida 06:15"]);
    await cambiarTipo("tour"); // cambiar el formulario DESPUÉS de buscar no cambia el resumen de la búsqueda vigente
    assert.deepEqual(chips(), ["Todos los destinos", "01/01/2030 → 05/01/2030", "2 pax", "Traslado", "Modalidad: Un trayecto: salida", "Salida 06:15"]);
    await buscar([]);
    assert.ok(container.querySelector('[data-testid="sin-resultados"]'), "vacío: mensaje"); assert.ok(container.querySelector('[data-testid="tu-busqueda"]'), "el vacío también lleva su encabezado");
    await buscar({ ok: false, error: "No se pudo buscar" });
    assert.equal(container.querySelector('[data-testid="tu-busqueda"]'), null, "error: sin sección de resultados");
    assert.match(container.textContent ?? "", /No se pudo buscar/);
  });

  test("el filtro por tipo muestra solo Tour, Traslado, Asistencia médica o Combo", async () => {
    await buscar([TOUR, TRASLADO_LLEGADA, COMBO, ASIST]);
    const filtrar = async (v: string) => { await cambiarTipo(v); return nombres(container); };
    assert.deepEqual(await filtrar(""), ["Tour islas", "Traslado aeropuerto", "Combo playa + traslado", "Asistencia médica"]);
    assert.deepEqual(await filtrar("tour"), ["Tour islas"]);
    assert.deepEqual(await filtrar("traslado"), ["Traslado aeropuerto"]);
    assert.deepEqual(await filtrar("asistencia_medica"), ["Asistencia médica"]);
    assert.deepEqual(await filtrar("combo"), ["Combo playa + traslado"]);
    assert.match(container.textContent ?? "", /1 receptivo\(s\) para estos filtros/);
  });
});

describe("«Tu búsqueda» y «Explora todos los receptivos»: dos bloques distintos", () => {
  const ITEM = { servicioId: 9, paqueteId: 1, nombre: "Tour manglares", destino: "CARTAGENA", descripcion: "Día completo", foto: null, desde: 120000, moneda: "COP" };
  async function montar(onVer: (i: Res) => void) {
    const c = document.createElement("div"); document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => { r.render(h(ExploraReceptivos, { porDestino: [["CARTAGENA", [ITEM]], ["Otros / todo destino", [{ ...ITEM, servicioId: 10, nombre: "Asistencia" }]]], onVer } as never)); });
    return { c, desmontar: () => { act(() => r.unmount()); c.remove(); } };
  }

  test("el catálogo lleva su encabezado, una nota de que NO aplica los filtros buscados y un tratamiento visual propio (borde discontinuo y fondo)", async () => {
    const vistos: Res[] = []; const { c, desmontar } = await montar((i) => vistos.push(i));
    const sec = c.querySelector('[data-testid="explora-receptivos"]')!;
    assert.equal(sec.querySelector("h2")?.textContent, "Explora todos los receptivos");
    assert.match(c.querySelector('[data-testid="explora-nota"]')?.textContent ?? "", /no aplican los filtros de tu búsqueda \(fechas, pasajeros, tipo ni modalidad\)/);
    assert.match(c.querySelector('[data-testid="explora-nota"]')?.textContent ?? "", /«desde», por persona/);
    assert.match(sec.className, /border-dashed/); assert.match(sec.className, /bg-slate-50/); assert.match(sec.className, /mt-12/, "separado de los resultados");
    assert.deepEqual([...sec.querySelectorAll(".font-semibold.text-gray-800")].map((e) => e.textContent), ["Tour manglares", "Asistencia"]);
    assert.match(sec.textContent ?? "", /CARTAGENA \(1\)/);
    await act(async () => { (sec.querySelector("button") as HTMLButtonElement).click(); });
    assert.equal(vistos.length, 1); assert.equal(vistos[0].notaPrecio, "desde · por persona"); assert.equal(vistos[0].precio, 120000);
    desmontar();
  });

  test("«Tu búsqueda» se distingue del catálogo: borde sólido de acento y fondo blanco, no el discontinuo gris; ninguno usa el encabezado del otro", async () => {
    const c = document.createElement("div"); document.body.appendChild(c); const r = createRoot(c);
    await act(async () => { r.render(h(BuscadorReceptivos, { onVerDetalle: () => {} } as never)); });
    await act(async () => { dispararCambio(inputDe(c, "Ida"), "2030-01-01"); dispararCambio(inputDe(c, "Regreso"), "2030-01-05"); });
    __setBuscarReceptivos(async () => ({ ok: true, resultados: [TOUR] }));
    await act(async () => { botonBuscar(c).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await new Promise((x) => setTimeout(x, 10)); });
    const sec = c.querySelector('[data-testid="tu-busqueda"]')!;
    assert.equal(sec.querySelector("h2")?.textContent, "Tu búsqueda");
    assert.match(sec.className, /border-2/); assert.doesNotMatch(sec.className, /border-dashed|bg-slate-50/);
    assert.doesNotMatch(c.textContent ?? "", /Explora todos los receptivos/, "el catálogo no lo pinta el buscador: lo pinta el padre, aparte");
    act(() => r.unmount()); c.remove();
  });

  test("VistaBooking usa el catálogo como bloque aparte (y ya no el rótulo suelto «O explora todos los receptivos»)", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync(new URL("../app/tarifario/VistaBooking.tsx", import.meta.url), "utf8");
    assert.match(fuente, /<ExploraReceptivos porDestino=\{receptivosPorDestino\} onVer=\{setReceptivoAbierto\} \/>/);
    assert.doesNotMatch(fuente, /O explora todos los receptivos/);
  });
});
