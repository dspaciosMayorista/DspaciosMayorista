// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #102 — INTERACCIÓN REACT real (jsdom, eventos DOM reales) de la nueva ocupación de la búsqueda general y de la Vista tabla:
//   · el buscador pide CUÁNTAS habitaciones (sin tipo por habitación) y envía `numHabitaciones`;
//   · la validación global ocurre ANTES de llamar al servidor y el reparto estándar es solo orientación;
//   · modo tabla: pide la noche adicional y TAMBIÉN busca alojamientos por unidad (una sola acción por clic, igual que Booking);
//   · respuestas tardías/obsoletas no se publican, un clic = una llamada y en reposo no hay llamadas;
//   · la tarjeta y la tabla pintan el MISMO desglose (adulto, cada menor, total) que devolvió el motor, sin recalcular;
//   · una edad que el hotel cobra como adulto se conserva en el carrito aparte de las edades de menores.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { EstadoBusquedaPorcion } from "../app/tarifario/BuscadorBooking.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.getBoundingClientRect = function () {
  return { width: 900, height: 40, top: 0, left: 0, right: 900, bottom: 40, x: 0, y: 0, toJSON() {} };
};
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { BuscadorBooking, Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { TablaResultadosBusqueda } = await import("../app/tarifario/TablaResultadosBusqueda.tsx");
const { DesgloseTarifas } = await import("../app/tarifario/desgloseTarifas.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const { __setBuscarHoteles } = await import("./support/stubs/reservarActionsStub.mjs");
const { __setBuscarAlojamientosUnidadPorFechas } = await import("./support/stubs/busquedaUnidadActionsStub.mjs");
const h = React.createElement;

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolve = r; });
  return { promesa, resolve };
}
const esperar = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function elegirDestino(container: HTMLElement, texto: string) {
  const trigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;
  assert.ok(trigger, "no se encontró el trigger de Destino");
  await act(async () => { trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await esperar(20); });
  const lista = document.getElementById(trigger.getAttribute("aria-controls")!)!;
  const item = [...lista.querySelectorAll('[role="option"]')].find((o) => o.textContent === texto)!;
  assert.ok(item, `no se encontró la opción "${texto}"`);
  await act(async () => {
    item.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    item.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    item.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await esperar(20);
  });
}
function inputDe(container: HTMLElement, etiqueta: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent?.trim() === etiqueta);
  assert.ok(label, `no se encontró la etiqueta "${etiqueta}"`);
  return label!.parentElement!.querySelector("input") as HTMLInputElement;
}
function cambiar(input: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}
const boton = (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => /Buscar hoteles|Buscando/.test(b.textContent ?? "")) as HTMLButtonElement;
const clic = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const destinos = [{ id: 1, nombre: "Cartagena" }];
type Llamada = Record<string, unknown>;

describe("BuscadorBooking — ocupación por CANTIDAD de habitaciones (#102)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let estados: (EstadoBusquedaPorcion | null)[];
  const llamadasHoteles: Llamada[] = [];
  const llamadasUnidad: Llamada[] = [];
  let modo: "booking" | "tabla" = "booking";

  async function montar(m: "booking" | "tabla") {
    modo = m;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    estados = [];
    await act(async () => { root.render(h(BuscadorBooking, { destinos, modo: m, onBusqueda: (e: EstadoBusquedaPorcion | null) => { estados.push(e); } })); });
    await elegirDestino(container, "Cartagena");
    await act(async () => { cambiar(inputDe(container, "Regreso"), "2030-01-05"); });
    llamadasHoteles.length = 0; llamadasUnidad.length = 0;
    __setBuscarHoteles(async (x: Llamada) => { llamadasHoteles.push(x); return { ok: true, resultados: [], diagnostico: "sin hoteles", sugerenciasFecha: [] }; });
    __setBuscarAlojamientosUnidadPorFechas(async (x: Llamada) => { llamadasUnidad.push(x); return { ok: true, disponibilidad: [], incompleto: false, enRevision: [] }; });
  }
  async function desmontar() { await act(async () => root.unmount()); container.remove(); }
  const reparto = () => container.querySelector('[data-testid="reparto-estandar"]')?.textContent ?? "";

  describe("modo Booking", () => {
    before(async () => { await montar("booking"); });
    after(desmontar);

    test("no hay un selector de tipo por habitación; el campo Habitaciones es una cantidad", () => {
      assert.equal(container.querySelectorAll("select").length, 0, "ya no se elige el tipo de cada habitación");
      assert.equal(inputDe(container, "Habitaciones").type, "number");
      assert.ok([...container.querySelectorAll("label")].some((l) => l.textContent === "Adultos"), "la etiqueta ya no dice «(12+)»: la edad de adulto la decide cada hotel");
      assert.ok([...container.querySelectorAll("label")].some((l) => /Menores \(0–17 años\)/.test(l.textContent ?? "")));
    });
    test("el reparto estándar se muestra como orientación: 2→Doble, 3→Triple, 4→Múltiple; sin reparto no bloquea", async () => {
      assert.match(reparto(), /1 Doble/);
      await act(async () => { cambiar(inputDe(container, "Adultos"), "3"); });
      assert.match(reparto(), /1 Triple/);
      await act(async () => { cambiar(inputDe(container, "Adultos"), "4"); });
      assert.match(reparto(), /1 Múltiple/);
      await act(async () => { cambiar(inputDe(container, "Adultos"), "5"); });
      assert.match(reparto(), /No hay un reparto estándar/);
      assert.equal(boton(container).disabled, false, "el reparto estándar nunca bloquea: cada hotel puede tener otra ocupación válida");
      await act(async () => { cambiar(inputDe(container, "Adultos"), "2"); });
    });
    test("envía numHabitaciones (no habitaciones[]), los adultos y las edades reales tal cual", async () => {
      await act(async () => { cambiar(inputDe(container, "Menores (0–17 años)"), "1"); });
      await act(async () => { cambiar(inputDe(container, "Edad menor 1"), "15"); });
      await act(async () => { clic(boton(container)); await esperar(25); });
      assert.equal(llamadasHoteles.length, 1);
      const x = llamadasHoteles[0];
      assert.equal(x.numHabitaciones, 1);
      assert.equal("habitaciones" in x, false, "ya no se manda un tipo por habitación");
      assert.equal(x.adultos, 2);
      assert.deepEqual(x.edadesMenores, [15], "la edad real viaja intacta: no se reescribe al viajero");
      assert.equal("nocheAdicional" in x, false, "Vista Booking no pide la noche adicional");
      assert.equal(llamadasUnidad.length, 1, "la mitad por unidad se evalúa con el reparto estándar");
      assert.deepEqual((llamadasUnidad[0].habitaciones as { acom: string }[]).map((r) => r.acom), ["doble"]);
    });
    test("más habitaciones que viajeros se explica ANTES de buscar y no llama al servidor", async () => {
      await act(async () => { cambiar(inputDe(container, "Menores (0–17 años)"), "0"); });
      await act(async () => { cambiar(inputDe(container, "Habitaciones"), "3"); });
      llamadasHoteles.length = 0; llamadasUnidad.length = 0;
      await act(async () => { clic(boton(container)); await esperar(25); });
      assert.equal(llamadasHoteles.length, 0);
      assert.equal(llamadasUnidad.length, 0);
      assert.match(container.textContent ?? "", /cada habitación necesita al menos una persona/);
      await act(async () => { cambiar(inputDe(container, "Habitaciones"), "1"); });
    });
    test("un clic = una búsqueda; con la búsqueda en vuelo el botón no admite otra; en reposo no hay llamadas", async () => {
      const d = diferido<{ ok: true; resultados: []; diagnostico: undefined; sugerenciasFecha: [] }>();
      __setBuscarHoteles(async (x: Llamada) => { llamadasHoteles.push(x); return d.promesa; });
      llamadasHoteles.length = 0; llamadasUnidad.length = 0;
      await act(async () => { clic(boton(container)); await esperar(10); });
      assert.equal(boton(container).disabled, true, "mientras busca no se puede lanzar otra");
      await act(async () => { clic(boton(container)); clic(boton(container)); await esperar(10); });
      assert.equal(llamadasHoteles.length, 1, "doble clic = una sola llamada");
      await act(async () => { d.resolve({ ok: true, resultados: [], diagnostico: undefined, sugerenciasFecha: [] }); await esperar(20); });
      const total = llamadasHoteles.length + llamadasUnidad.length;
      await esperar(300);
      assert.equal(llamadasHoteles.length + llamadasUnidad.length, total, "en reposo no se hacen más llamadas");
    });
    test("una respuesta tardía de una búsqueda obsoleta NO se publica", async () => {
      const lenta = diferido<{ ok: true; resultados: []; diagnostico: string; sugerenciasFecha: [] }>();
      __setBuscarHoteles(async () => lenta.promesa);
      estados.length = 0;
      await act(async () => { clic(boton(container)); await esperar(10); });
      await act(async () => { cambiar(inputDe(container, "Adultos"), "3"); }); // cambia un criterio: invalida lo que esté en vuelo
      estados.length = 0;
      await act(async () => { lenta.resolve({ ok: true, resultados: [], diagnostico: "vieja", sugerenciasFecha: [] }); await esperar(25); });
      assert.deepEqual(estados.filter(Boolean), [], "la respuesta vieja no se publica");
      await act(async () => { cambiar(inputDe(container, "Adultos"), "2"); });
    });
  });

  describe("modo tabla", () => {
    before(async () => { await montar("tabla"); });
    after(desmontar);
    test("pide la noche adicional y busca alojamientos por unidad (una acción por clic, sin llamadas en reposo)", async () => {
      await act(async () => { clic(boton(container)); await esperar(25); });
      assert.equal(llamadasHoteles.length, 1);
      assert.equal(llamadasHoteles[0].nocheAdicional, true);
      assert.equal(llamadasHoteles[0].numHabitaciones, 1);
      assert.equal(llamadasUnidad.length, 1, "la Vista tabla evalúa los hoteles por unidad con el reparto estándar");
      assert.deepEqual((llamadasUnidad[0].habitaciones as { acom: string }[]).map((r) => r.acom), ["doble"]);
      assert.equal(llamadasUnidad[0].adultos, 2); assert.deepEqual(llamadasUnidad[0].edadesMenores, []);
      const publicado = estados.filter((e): e is EstadoBusquedaPorcion => !!e).at(-1)!;
      assert.equal(publicado.avisoUnidad, null, "sin aviso engañoso de «no soportado»");
      const total = llamadasHoteles.length + llamadasUnidad.length;
      await esperar(300);
      assert.equal(llamadasHoteles.length + llamadasUnidad.length, total, "en reposo no se hacen más llamadas");
      assert.deepEqual(publicado.ocupacion, { numHabitaciones: 1, adultos: 2, edadesMenores: [] });
    });
  });
});

// ── Fixture: resultado REAL del motor para 2 adultos + un menor de 15 años (valores de la prueba pg 102) ──────────────────────────────────
function resultadoA() {
  const combo = {
    categoria: "Estandar", regimen: "Desayuno", total: 1080000, pax: 3, menores: { infantes: 0, nino: 0, nino2: 0 },
    habitaciones: { triple: 1 }, edadesMenores: [] as number[], edadesComoAdulto: [15], resumenHabitaciones: "1 Triple",
    asignacion: [{ indice: 0, acom: "triple", adultos: 3, nino: 0, nino2: 0, infantes: 0 }],
    desglose: [{ clase: "adulto", cantidad: 3, tarifa: 360000, subtotal: 1080000, acomodaciones: ["triple"] }],
    nocheAdicional: { estado: "ok", fecha: "2030-06-13", total: 375000, desglose: [{ clase: "adulto", cantidad: 3, tarifa: 125000, subtotal: 375000, acomodaciones: ["triple"] }] },
  };
  return {
    hotelId: 10201, hotelNombre: "Hotel A (niño hasta 12)", destino: "CARTAGENA 102", paqueteId: 10201, paqueteNombre: "Porción 102",
    categoria: "Estandar", regimen: "Desayuno", total: 1080000, noches: 3, moneda: "COP", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13",
    habitaciones: { triple: 1 }, menores: { infantes: 0, nino: 0, nino2: 0 }, edadesMenores: [] as number[], edadesComoAdulto: [15], pax: 3, combos: [combo], condicion: null,
  };
}
function resultadoB() {
  const combo = {
    categoria: "Estandar", regimen: "Desayuno", total: 900000, pax: 3, menores: { infantes: 0, nino: 1, nino2: 0 },
    habitaciones: { doble: 1 }, edadesMenores: [15], edadesComoAdulto: [] as number[], resumenHabitaciones: "1 Doble",
    asignacion: [{ indice: 0, acom: "doble", adultos: 2, nino: 1, nino2: 0, infantes: 0 }],
    desglose: [
      { clase: "adulto", cantidad: 2, tarifa: 375000, subtotal: 750000, acomodaciones: ["doble"] },
      { clase: "nino", cantidad: 1, tarifa: 150000, subtotal: 150000, menorDeDos: false, edades: [15] },
    ],
    nocheAdicional: { estado: "no_disponible", fecha: "2030-06-13", motivo: "Esa noche no tiene tarifa vigente o no admite esta composición para esta categoría y alimentación." },
  };
  return {
    hotelId: 10202, hotelNombre: "Hotel B (niño hasta 17)", destino: "CARTAGENA 102", paqueteId: 10201, paqueteNombre: "Porción 102",
    categoria: "Estandar", regimen: "Desayuno", total: 900000, noches: 3, moneda: "COP", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13",
    habitaciones: { doble: 1 }, menores: { infantes: 0, nino: 1, nino2: 0 }, edadesMenores: [15], edadesComoAdulto: [] as number[], pax: 3, combos: [combo], condicion: null,
  };
}
const moneda = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

describe("Vista tabla — resultados con dos secciones, desglose y noche adicional", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  before(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const estado = {
      destino: "CARTAGENA 102", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13", resultados: [resultadoA(), resultadoB()], diagnostico: null,
      sugerenciasFecha: [], unidad: [], avisoUnidad: null, enRevision: [], ocupacion: { numHabitaciones: 1, adultos: 2, edadesMenores: [15] },
    } as unknown as EstadoBusquedaPorcion;
    await act(async () => { root.render(h(TablaResultadosBusqueda, { estado })); });
  });
  after(async () => { await act(async () => root.unmount()); container.remove(); });
  const texto = () => container.textContent ?? "";
  const sec = (id: string) => container.querySelector(`section[aria-labelledby="${id}"]`) as HTMLElement;

  test("dos secciones separadas, con noches y base de precio rotuladas", () => {
    assert.match(sec("sec-estadia").textContent ?? "", /Estadía de 3 noches/);
    assert.match(sec("sec-estadia").textContent ?? "", /10\/06\/30 → 13\/06\/30/);
    assert.match(sec("sec-estadia").textContent ?? "", /Tarifa por persona para toda la estadía/);
    assert.match(sec("sec-noche").textContent ?? "", /Una noche adicional/);
    assert.match(sec("sec-noche").textContent ?? "", /noche del 13\/06\/30 \(estadía de 4 noches\)/);
    assert.match(sec("sec-noche").textContent ?? "", /Valor de ESA noche, por persona/);
  });
  test("la ocupación evaluada se declara, con la edad real del menor", () => {
    assert.match(texto(), /1 habitación, 2 adultos y 1 menor \(15 años\)/);
  });
  test("cada hotel muestra su clasificación: A cobra al de 15 años como adulto en Triple; B lo cobra como Niño 1 en Doble", () => {
    const filaA = [...sec("sec-estadia").querySelectorAll("tbody tr")].find((t) => t.textContent?.includes("Hotel A"))!;
    const filaB = [...sec("sec-estadia").querySelectorAll("tbody tr")].find((t) => t.textContent?.includes("Hotel B"))!;
    assert.match(filaA.textContent ?? "", new RegExp(moneda(1080000).replace(/[$.]/g, "\\$&")));
    assert.match(filaA.textContent ?? "", /1 Triple/);
    assert.match(filaA.textContent ?? "", /15 años: tarifa de adulto en este hotel/);
    assert.match(filaB.textContent ?? "", /1 Doble/);
    assert.match(filaB.textContent ?? "", /Niño 1 · 15 años/);
    assert.ok(filaB.textContent?.includes(moneda(150000).replace(/\s/g, " ")) || /150\.000/.test(filaB.textContent ?? ""), "tarifa del menor visible sin abrir el hotel");
  });
  test("la noche adicional muestra su valor exacto, o el motivo cuando no se puede afirmar", () => {
    const filas = [...sec("sec-noche").querySelectorAll("tbody tr")];
    assert.match(filas.find((t) => t.textContent?.includes("Hotel A"))!.textContent ?? "", /375\.000/);
    assert.match(filas.find((t) => t.textContent?.includes("Hotel B"))!.textContent ?? "", /no tiene tarifa vigente/);
  });
  test("las celdas llevan data-label para apilarse en tarjetas en móvil (sin recortar columnas)", () => {
    const celdas = [...sec("sec-estadia").querySelectorAll("tbody tr:first-child td")];
    assert.ok(celdas.length >= 5);
    assert.ok(celdas.slice(1).every((c) => c.getAttribute("data-label")), "toda celda de datos tiene su rótulo");
    assert.ok(sec("sec-estadia").querySelector("table.table-fixed"), "anchos de columna fijos");
  });
  test("el total de la tabla es EXACTAMENTE el de la tarjeta (mismo resultado del motor, sin recalcular)", async () => {
    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    for (const r of [resultadoA(), resultadoB()]) {
      await act(async () => { r2.render(h(DesgloseTarifas, { combo: r.combos[0] as never, moneda: "COP", noches: r.noches })); });
      const tarjeta = c2.textContent ?? "";
      assert.ok(tarjeta.includes(moneda(r.total)), `tarjeta: total ${r.total}`);
      assert.ok(texto().includes(moneda(r.total)), `tabla: total ${r.total}`);
      assert.equal((r.combos[0].desglose as { subtotal: number }[]).reduce((s, l) => s + l.subtotal, 0), r.total, "el desglose suma el total");
      assert.match(tarjeta, /Tarifa por persona · estadía de 3 noches/);
    }
    await act(async () => r2.unmount());
    c2.remove();
  });
  test("sin resultados, la tabla explica el motivo real que dio el motor", async () => {
    const c3 = document.createElement("div");
    document.body.appendChild(c3);
    const r3 = createRoot(c3);
    const vacio = { destino: "X", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13", resultados: [], diagnostico: "5 adulto(s) no se pueden repartir en 1 habitación(es): este hotel admite entre 1 y 4 adulto(s) por habitación.", sugerenciasFecha: [], unidad: [], avisoUnidad: null, enRevision: [], ocupacion: { numHabitaciones: 1, adultos: 5, edadesMenores: [] } };
    await act(async () => { r3.render(h(TablaResultadosBusqueda, { estado: vacio as never })); });
    assert.match(c3.textContent ?? "", /no se pueden repartir en 1 habitación/);
    await act(async () => r3.unmount());
    c3.remove();
  });
});

describe("Resultado — el carrito conserva la edad real de quien el hotel cobra como adulto", () => {
  test("agregar al carrito: habitaciones del combo, edadesMenores SIN el de 15 años y edadesComoAdulto aparte", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let items: { habitaciones?: Record<string, number>; edadesMenores?: number[]; edadesComoAdulto?: number[]; pax?: number; precio?: number }[] = [];
    function Espia() { items = useCart().items as never; return null; }
    await act(async () => {
      root.render(h(CartProvider, null, h(Resultado, { r: resultadoA() as never, foto: null, descripcionPorPaquete: {}, addonsPorPaquete: new Map() }), h(Espia)));
    });
    const agregar = [...container.querySelectorAll("button")].find((b) => /Agregar/.test(b.textContent ?? ""))!;
    assert.ok(agregar, "no se encontró el botón de agregar");
    await act(async () => { clic(agregar); await esperar(30); });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].habitaciones, { triple: 1 });
    assert.deepEqual(items[0].edadesMenores, []);
    assert.deepEqual(items[0].edadesComoAdulto, [15]);
    assert.equal(items[0].pax, 3);
    assert.equal(items[0].precio, 1080000);
    assert.match(container.textContent ?? "", /Habitaciones evaluadas: 1 Triple/);
    assert.match(container.textContent ?? "", /Este hotel cobra como adulto a quien tiene 15 años/);
    await act(async () => root.unmount());
    container.remove();
  });
});
