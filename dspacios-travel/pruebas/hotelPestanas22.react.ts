// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/hotelPestanas22.react.ts
//
// #22 — detalle de hotel en pestañas, componente REAL (HotelDetalleClient):
//   · pestañas (inicial por ?tab=, teclado, `?tab=` reflejado) y paneles SIEMPRE montados (borradores sobreviven);
//   · tabla de tarifas agrupada por vigencia × alimentación, con muchas tarifas, todas las columnas y acciones;
//   · importes: moneda del hotel (COP/USD), ceros visibles, sin dato "—", Adults Only sin columnas de niño;
//   · creación y edición de tarifas y temporadas (payload exacto a las acciones), errores y estados vacíos.
// Las Server Actions se sustituyen por dobles; no se prueba ningún cálculo de precios.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__h22";

const ACCIONES = datos(`
  const reg = (n, a) => ${G}.llamadas.push([n, a]);
  export async function crearTemporada(...a) { reg('crearTemporada', a); return ${G}.resp('crearTemporada'); }
  export async function actualizarTemporada(...a) { reg('actualizarTemporada', a); return ${G}.resp('actualizarTemporada'); }
  export async function eliminarTemporada(...a) { reg('eliminarTemporada', a); return { ok: true }; }
  export async function copiarTemporadasDesdeHotel(...a) { reg('copiarTemporadasDesdeHotel', a); return { ok: true, copiadas: 0 }; }
  export async function crearTarifa(...a) { reg('crearTarifa', a); return ${G}.resp('crearTarifa'); }
  export async function actualizarTarifa(...a) { reg('actualizarTarifa', a); return ${G}.resp('actualizarTarifa'); }
  export async function eliminarTarifa(...a) { reg('eliminarTarifa', a); return { ok: true }; }
`);
const NAVEGACION = datos(`
  export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "../actions" && padre.endsWith("/HotelDetalleClient.tsx")) return { url: ACCIONES, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/producto/hoteles/")) return { url: NAVEGACION, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/5" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  confirm: () => true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView = () => {};

const h22 = {
  llamadas: [] as [string, unknown[]][],
  respuestas: {} as Record<string, unknown>,
  resp: (n: string): unknown => h22.respuestas[n] ?? { ok: true },
};
(globalThis as unknown as { __h22: typeof h22 }).__h22 = h22;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { HotelDetalleClient } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx");
const { formatNetoTarifa } = await import("../lib/hoteles/tarifasVista.ts");
const { formatCOP } = await import("../lib/utils.ts");
const h = React.createElement;
type Props = Parameters<typeof HotelDetalleClient>[0];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  h22.llamadas.length = 0; h22.respuestas = {};
  dom.window.history.replaceState(null, "", "/dashboard/producto/hoteles/5");
});
after(() => dom.window.close());

async function montar(props: Props) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(HotelDetalleClient, props) as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
async function escribir(input: HTMLInputElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function elegir(select: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(select, valor);
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const tabs = (r: Element) => [...r.querySelectorAll<HTMLElement>("[role=tab]")];
const panel = (r: Element, id: string) => r.querySelector<HTMLElement>(`#panel-hotel-${id}`)!;
const activa = (r: Element) => tabs(r).find((b) => b.getAttribute("aria-selected") === "true")?.id;
const botonTexto = (r: Element, t: string) => [...r.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === t) as HTMLButtonElement | undefined;
const etiquetaCampo = (r: Element, t: string) => [...r.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim().startsWith(t))?.parentElement?.querySelector("input,select") as HTMLInputElement & HTMLSelectElement;

const T_ALTA = { id: 1, nombre: "ALTA", fecha_inicio: "2030-12-15", fecha_fin: "2031-01-10", prioridad: 1, compra_inicio: null, compra_fin: "2099-01-01", tipo: "tarifa", min_noches: 1 };
const T_BAJA = { id: 2, nombre: "BAJA", fecha_inicio: "2030-02-01", fecha_fin: "2030-06-30", prioridad: 1, compra_inicio: null, compra_fin: "2099-01-01", tipo: "tarifa", min_noches: 1 };
const T_PROMO = { id: 3, nombre: "PROMO ABRIL", fecha_inicio: "2030-04-01", fecha_fin: "2030-04-30", prioridad: 5, compra_inicio: null, compra_fin: "2099-01-01", tipo: "descuento_pct", descuento_valor: 10, min_noches: 1 };
const T_VENCIDA = { id: 4, nombre: "ANTIGUA", fecha_inicio: "2020-01-01", fecha_fin: "2020-02-01", prioridad: 1, compra_inicio: null, compra_fin: "2020-01-01", tipo: "tarifa", min_noches: 1 };

type Tarifa = Props["tarifas"][number];
let nextId = 100;
const tarifa = (over: Partial<Tarifa>): Tarifa => ({
  id: nextId++, tipo_habitacion: "ESTANDAR", alimentacion: "PAM", temporada: "ALTA",
  neto_sencilla: 300000, neto_doble: 200000, neto_triple: 180000, neto_multiple: 160000,
  neto_nino: 90000, neto_nino2: 90000, neto_infante: 0, nota_infante: null, ...over,
});

const CATEGORIAS = ["ESTANDAR", "SUPERIOR", "SUITE"];
const REGIMENES = ["PAM", "PC"];
function props(over: Partial<Props> = {}): Props {
  return {
    hotelId: 5, categorias: CATEGORIAS, regimenes: REGIMENES,
    temporadas: [T_ALTA, T_BAJA, T_PROMO, T_VENCIDA], tarifas: [], otrosHoteles: [{ id: 9, nombre: "Otro" }],
    adultsOnly: false, mostrarTarifaPersona: true, moneda: "COP",
    configuracion: h("div", { "data-slot": "config" }, "SLOT-CONFIG"),
    calculadora: h("div", { "data-slot": "calc" }, "SLOT-CALC"),
    tarifasExtra: h("div", { "data-slot": "extra" }, "SLOT-EXTRA"),
    ...over,
  } as Props;
}
const filasTabla = (r: Element) => [...r.querySelectorAll("#panel-hotel-tarifas tbody tr")];
const celdaDe = (fila: Element, etiqueta: string) => fila.querySelector(`td[data-label="${etiqueta}"]`)?.textContent?.trim();

test("pestañas: ?tab= inicial, Configuración por defecto, un solo panel visible y ?tab= reflejado al cambiar", async () => {
  let r = await montar(props());
  assert.deepEqual(tabs(r).map((b) => b.getAttribute("aria-label")), ["Configuración", "Temporadas, promociones y calculadora", "Tarifas generadas"]);
  assert.equal(activa(r), "tab-hotel-configuracion");
  assert.deepEqual(["configuracion", "temporadas", "tarifas"].map((id) => panel(r, id).hidden), [false, true, true]);
  assert.match(panel(r, "configuracion").textContent ?? "", /SLOT-CONFIG/);
  assert.match(panel(r, "temporadas").textContent ?? "", /SLOT-CALC/);
  assert.match(panel(r, "tarifas").textContent ?? "", /SLOT-EXTRA/);
  await desmontar!(); desmontar = undefined;

  r = await montar(props({ pestanaInicial: "tarifas" }));
  assert.equal(activa(r), "tab-hotel-tarifas");
  await desmontar!(); desmontar = undefined;
  r = await montar(props({ pestanaInicial: "no-existe" }));
  assert.equal(activa(r), "tab-hotel-configuracion");

  await pulsar(tabs(r)[1]);
  assert.equal(activa(r), "tab-hotel-temporadas");
  assert.equal(new URL(dom.window.location.href).searchParams.get("tab"), "temporadas");
  assert.deepEqual(["configuracion", "temporadas", "tarifas"].map((id) => panel(r, id).hidden), [true, false, true]);
  // Teclado: flecha derecha avanza y la última vuelve a la primera.
  await React.act(async () => { tabs(r)[1].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  assert.equal(activa(r), "tab-hotel-tarifas");
  await React.act(async () => { tabs(r)[2].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  assert.equal(activa(r), "tab-hotel-configuracion");
});

test("cambiar de pestaña NO pierde borradores: formulario de temporada, formulario de tarifa y nodos siguen siendo los mismos", async () => {
  const r = await montar(props({ pestanaInicial: "temporadas", tarifas: [tarifa({})] }));
  const nombre = r.querySelector<HTMLInputElement>("#panel-hotel-temporadas input[placeholder^='ALTA, BAJA']")!;
  await escribir(nombre, "BORRADOR NAVIDAD");
  await pulsar(tabs(r)[2]);
  const selCat = r.querySelector<HTMLSelectElement>("#panel-hotel-tarifas select")!;
  await elegir(selCat, "SUITE");
  const doble = etiquetaCampo(panel(r, "tarifas"), "Doble");
  await escribir(doble, "777000");
  await pulsar(tabs(r)[0]);
  await pulsar(tabs(r)[1]);
  assert.equal(r.querySelector("#panel-hotel-temporadas input[placeholder^='ALTA, BAJA']"), nombre, "mismo nodo (no se remontó)");
  assert.equal(nombre.value, "BORRADOR NAVIDAD");
  await pulsar(tabs(r)[2]);
  assert.equal(selCat.value, "SUITE");
  assert.equal(doble.value, "777000");
});

test("tabla con muchas tarifas: agrupada por vigencia × alimentación, ninguna se pierde y todas conservan columnas y acciones", async () => {
  const muchas: Tarifa[] = [];
  for (const temporada of ["ALTA", "BAJA", "PROMO ABRIL"]) for (const regimen of REGIMENES) for (let i = 1; i <= 8; i++) {
    muchas.push(tarifa({ temporada, alimentacion: regimen, tipo_habitacion: `CATEGORIA ${i}`, neto_doble: 100000 * i + (temporada === "ALTA" ? 5 : 0) }));
  }
  muchas.push(tarifa({ temporada: "ANTIGUA", alimentacion: "PC", tipo_habitacion: "HISTORICA" }));
  const r = await montar(props({ pestanaInicial: "tarifas", tarifas: muchas }));

  const grupos = [...r.querySelectorAll("#panel-hotel-tarifas [data-grupo-tarifas]")];
  // 3 vigencias × 2 regímenes activos = 6 tarjetas; la vigencia vencida va en el histórico plegable (1 tarjeta más).
  assert.equal(grupos.length, 7);
  const activos = grupos.filter((g) => !g.closest("details"));
  assert.equal(activos.length, 6);
  assert.equal(activos.reduce((s, g) => s + g.querySelectorAll("tbody tr").length, 0), 48);
  assert.deepEqual(
    activos.map((g) => [g.querySelector("h3")!.textContent, g.querySelector("span.rounded-full")!.textContent]),
    [["BAJA", "PAM"], ["BAJA", "PC"], ["PROMO ABRIL", "PAM"], ["PROMO ABRIL", "PC"], ["ALTA", "PAM"], ["ALTA", "PC"]],
    "orden por inicio de vigencia, luego régimen",
  );
  assert.match(activos[0].textContent ?? "", /8 tarifas/);
  assert.equal(panel(r, "tarifas").querySelector("details")!.querySelectorAll("tbody tr").length, 1, "la vencida queda en el histórico");

  // Cada tarifa: todas las columnas + sus dos acciones, con nombre accesible.
  for (const fila of filasTabla(r)) {
    for (const etiqueta of ["Categoría", "Sencilla", "Doble", "Triple", "Múltiple", "Niño 1", "Niño 2", "Infante", "Acciones"]) {
      assert.ok(fila.querySelector(`td[data-label="${etiqueta}"]`), `falta la celda ${etiqueta}`);
    }
    assert.ok(fila.querySelector("button[aria-label^='Editar tarifa']"));
    assert.ok(fila.querySelector("button[aria-label^='Eliminar tarifa']"));
  }
  // Los importes se muestran tal cual (COP idéntico al formato de siempre).
  const alta1 = filasTabla(r).find((f) => celdaDe(f, "Categoría")?.startsWith("CATEGORIA 1") && f.closest("[data-grupo-tarifas]")!.querySelector("h3")!.textContent === "ALTA")!;
  assert.equal(celdaDe(alta1, "Doble"), formatCOP(100005));
});

test("importes: USD en su moneda (con centavos), COP intacto, cero visible y sin dato como guion", async () => {
  const filas = [tarifa({ neto_sencilla: 85.5, neto_doble: 60, neto_triple: 0, neto_multiple: null, neto_nino: 0, neto_nino2: null, neto_infante: 0 })];
  let r = await montar(props({ pestanaInicial: "tarifas", tarifas: filas, moneda: "USD" }));
  let f = filasTabla(r)[0];
  assert.equal(celdaDe(f, "Sencilla"), "USD $85.50");
  assert.equal(celdaDe(f, "Doble"), "USD $60");
  assert.equal(celdaDe(f, "Triple"), "USD $0", "un 0 cargado es gratis, no 'sin dato'");
  assert.equal(celdaDe(f, "Múltiple"), "—");
  assert.equal(celdaDe(f, "Niño 1"), "USD $0");
  assert.equal(celdaDe(f, "Niño 2"), "—");
  assert.equal(celdaDe(f, "Infante"), "USD $0");
  await desmontar!(); desmontar = undefined;

  r = await montar(props({ pestanaInicial: "tarifas", tarifas: filas, moneda: "COP" }));
  f = filasTabla(r)[0];
  assert.equal(celdaDe(f, "Triple"), formatCOP(0));
  assert.equal(celdaDe(f, "Múltiple"), "—");
  assert.equal(celdaDe(f, "Doble"), formatNetoTarifa(60, "COP"));
});

test("Base/Promo, condición de la tarifa y nota de infante siguen visibles", async () => {
  const filas = [
    tarifa({ temporada: "PROMO ABRIL", notas: "No reembolsable.", neto_infante: 19000, nota_infante: "Solo seguro hotelero" }),
    tarifa({ temporada: "ALTA", tipo_habitacion: "SUPERIOR" }),
  ];
  const r = await montar(props({ pestanaInicial: "tarifas", tarifas: filas }));
  const texto = r.querySelector("#panel-hotel-tarifas")!.textContent ?? "";
  assert.match(texto, /Promo/);
  assert.match(texto, /Base/);
  assert.match(texto, /No reembolsable\./);
  assert.match(texto, /\* Infante: Solo seguro hotelero/);
  assert.match(texto, /Sin vigencia registrada|2030/);
});

test("Adults Only: sin columnas de niño/infante", async () => {
  const r = await montar(props({ pestanaInicial: "tarifas", tarifas: [tarifa({})], adultsOnly: true }));
  const ths = [...r.querySelectorAll("#panel-hotel-tarifas thead th")].map((t) => (t.textContent ?? "").trim());
  assert.deepEqual(ths, ["Categoría", "Sencilla", "Doble", "Triple", "Múltiple", "Acciones"]);
  assert.equal(celdaDe(filasTabla(r)[0], "Niño 1"), undefined);
});

test("estados vacíos: sin tarifas; sin configuración previa; modelo por unidad oculta tarifas por persona pero conserva el bloque extra", async () => {
  let r = await montar(props({ pestanaInicial: "tarifas" }));
  assert.match(panel(r, "tarifas").textContent ?? "", /aún no tiene tarifas cargadas/);
  assert.equal(filasTabla(r).length, 0);
  await desmontar!(); desmontar = undefined;

  r = await montar(props({ pestanaInicial: "tarifas", categorias: [], regimenes: [], temporadas: [] }));
  assert.match(panel(r, "tarifas").textContent ?? "", /pestaña Temporadas/);
  assert.match(panel(r, "temporadas").textContent ?? "", /Sin vigencias activas/);
  await desmontar!(); desmontar = undefined;

  r = await montar(props({ pestanaInicial: "tarifas", mostrarTarifaPersona: false }));
  assert.equal(botonTexto(r, "Agregar tarifa"), undefined);
  assert.match(panel(r, "tarifas").textContent ?? "", /SLOT-EXTRA/);
  assert.match(panel(r, "temporadas").textContent ?? "", /Temporadas y promociones/, "temporadas se muestran siempre");
});

test("crear tarifa: valida, envía el payload exacto (0 se conserva, vacío = null) y muestra el error del servidor", async () => {
  const r = await montar(props({ pestanaInicial: "tarifas" }));
  await pulsar(botonTexto(r, "Agregar tarifa")!);
  assert.match(panel(r, "tarifas").textContent ?? "", /Elige categoría, régimen y temporada\./);
  assert.equal(h22.llamadas.length, 0);

  const [cat, reg, temp] = [...panel(r, "tarifas").querySelectorAll("select")];
  await elegir(cat, "SUITE"); await elegir(reg, "PC"); await elegir(temp, "BAJA");
  await escribir(etiquetaCampo(panel(r, "tarifas"), "Sencilla"), "0");
  await escribir(etiquetaCampo(panel(r, "tarifas"), "Doble"), "250000");
  h22.respuestas.crearTarifa = { ok: false, error: "Ya existe esa tarifa" };
  await pulsar(botonTexto(r, "Agregar tarifa")!);
  assert.deepEqual(h22.llamadas, [["crearTarifa", [{
    hotelId: 5, tipoHabitacion: "SUITE", alimentacion: "PC", temporada: "BAJA",
    netoSencilla: 0, netoDoble: 250000, netoTriple: null, netoMultiple: null,
    netoNino: null, netoNino2: null, netoInfante: null, notaInfante: null,
  }]]]);
  assert.match(panel(r, "tarifas").textContent ?? "", /Ya existe esa tarifa/);
  assert.equal(etiquetaCampo(panel(r, "tarifas"), "Doble").value, "250000", "con error el borrador sigue en el formulario");

  h22.respuestas.crearTarifa = { ok: true };
  await pulsar(botonTexto(r, "Agregar tarifa")!);
  assert.equal(etiquetaCampo(panel(r, "tarifas"), "Doble").value, "", "al guardar bien el formulario se limpia");
});

test("editar tarifa: precarga el formulario (incluido el 0), pasa a 'Guardar cambios' y cancela sin enviar", async () => {
  const t = tarifa({ id: 555, tipo_habitacion: "SUPERIOR", alimentacion: "PC", temporada: "BAJA", neto_sencilla: 0, neto_doble: 410000, neto_infante: 0, nota_infante: "Comparte cama" });
  const r = await montar(props({ pestanaInicial: "tarifas", tarifas: [t] }));
  await pulsar(r.querySelector("button[aria-label^='Editar tarifa']")!);
  const pt = panel(r, "tarifas");
  const [cat, reg, temp] = [...pt.querySelectorAll("select")];
  assert.deepEqual([cat.value, reg.value, temp.value], ["SUPERIOR", "PC", "BAJA"]);
  assert.equal(etiquetaCampo(pt, "Sencilla").value, "0");
  assert.equal(etiquetaCampo(pt, "Doble").value, "410000");
  assert.equal(etiquetaCampo(pt, "Infante").value, "0");
  assert.ok(botonTexto(r, "Cancelar"));

  await escribir(etiquetaCampo(pt, "Doble"), "420000");
  await pulsar(botonTexto(r, "Guardar cambios")!);
  assert.equal(h22.llamadas.length, 1);
  const [nombre, args] = h22.llamadas[0] as [string, unknown[]];
  assert.equal(nombre, "actualizarTarifa");
  assert.equal(args[0], 555); assert.equal(args[1], 5);
  assert.deepEqual(args[2], {
    tipoHabitacion: "SUPERIOR", alimentacion: "PC", temporada: "BAJA",
    netoSencilla: 0, netoDoble: 420000, netoTriple: 180000, netoMultiple: 160000,
    netoNino: 90000, netoNino2: 90000, netoInfante: 0, notaInfante: "Comparte cama",
  });

  await pulsar(r.querySelector("button[aria-label^='Editar tarifa']")!);
  await pulsar(botonTexto(r, "Cancelar")!);
  assert.equal(h22.llamadas.length, 1, "cancelar no envía nada");
  assert.ok(botonTexto(r, "Agregar tarifa"));
});

test("eliminar tarifa pide confirmación y llama a la acción con el id y el hotel", async () => {
  const r = await montar(props({ pestanaInicial: "tarifas", tarifas: [tarifa({ id: 321 })] }));
  await pulsar(r.querySelector("button[aria-label^='Eliminar tarifa']")!);
  assert.deepEqual(h22.llamadas, [["eliminarTarifa", [321, 5]]]);
});

test("temporadas: crear, editar y cancelar conservan el flujo de siempre (USD rotula el descuento por pax)", async () => {
  const promoUsd = { ...T_PROMO, id: 8, nombre: "PROMO USD", tipo: "descuento_monto", descuento_valor: 25 };
  const r = await montar(props({ pestanaInicial: "temporadas", moneda: "USD", temporadas: [T_ALTA, promoUsd] }));
  const pt = panel(r, "temporadas");
  assert.match(pt.textContent ?? "", /−USD \$25\/pax/);

  await pulsar(botonTexto(r, "Agregar temporada")!);
  assert.match(pt.textContent ?? "", /Ponle un nombre\./);
  assert.equal(h22.llamadas.length, 0);

  await pulsar([...pt.querySelectorAll("li button")].find((b) => b.textContent === "Editar")!);
  assert.match(pt.textContent ?? "", /Editando: ALTA/);
  await pulsar(botonTexto(r, "Guardar cambios")!);
  assert.equal(h22.llamadas[0][0], "actualizarTemporada");
  assert.equal(h22.llamadas[0][1][0], 1);
  assert.equal((h22.llamadas[0][1][1] as { hotelId: number }).hotelId, 5);
  assert.equal((h22.llamadas[0][1][1] as { nombre: string }).nombre, "ALTA");
});
