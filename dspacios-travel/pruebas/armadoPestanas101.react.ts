// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/armadoPestanas101.react.ts
//
// #101 — pantalla de armado de paquetes en pestañas, componente REAL (ArmadoClient):
//   · navegación entre pestañas y pestaña inicial (?tab=) validada contra el tipo;
//   · visibilidad por tipo (bloqueo / porción / dinámico / servicios) y Empaquetados fuera de Bloqueo;
//   · listas plegables con contador; "Seleccionar todos" de servicios (#98);
//   · tarifario resultado: agrupado por hotel (plegado), precio DOBLE de referencia, estado y botón arriba, pestaña
//     conservada al regenerar.
// Las acciones de servidor se sustituyen por dobles; no se prueba ningún cálculo de precios.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__p101";

const ACCIONES_PAQUETES = datos(`
  const reg = (n, a) => ${G}.llamadas.push([n, a]);
  export async function crearPaquete() { return { ok: true, id: 1 }; }
  export async function actualizarPaquete() { return { ok: true, id: 1 }; }
  export async function listarDestinosAereosCandidatos() { return { ok: true, candidatos: [], motivo: null }; }
  export async function setVuelo(...a) { reg('setVuelo', a); return { ok: true }; }
  export async function setTodosVuelos(...a) { reg('setTodosVuelos', a); return { ok: true }; }
  export async function setHotel(...a) { reg('setHotel', a); return { ok: true }; }
  export async function setTodosHoteles(...a) { reg('setTodosHoteles', a); return { ok: true }; }
  export async function setServicio(...a) { reg('setServicio', a); return ${G}.respServicio(a); }
  export async function generarTarifario(...a) { reg('generarTarifario', a); return { ok: true, id: 3 }; }
  export async function getTarifasHotel() { return { ok: true, modelo: 'persona', categorias: [], regimenes: [], tarifas: [] }; }
  export async function setHotelFiltros() { return { ok: true }; }
  export async function setHotelPrioridad() { return { ok: true }; }
`);
const ACCIONES_SALIDAS = datos(`
  export async function crearSalidaDinamica() { return { ok: true }; }
  export async function actualizarSalidaDinamica() { return { ok: true }; }
  export async function eliminarSalidaDinamica() { return { ok: true }; }
  export async function listarEmpaquetadosParaSalidas63() { return { ok: true, candidatos: [], pendientes: 0 }; }
  export async function vincularSalidasEmpaquetados63() { return { ok: true }; }
  export async function actualizarSalidaDesdeFuente63() { return { ok: true }; }
`);
const ACCIONES_EMPAQUETADOS = datos(`
  export async function setEmpaquetado(...a) { ${G}.llamadas.push(['setEmpaquetado', a]); return { ok: true }; }
`);
const NAVEGACION = datos(`
  export function useRouter() { return { push() {}, refresh() { ${G}.refrescos++; }, replace() {} }; }
  export function notFound() { throw new Error('NEXT_NOT_FOUND'); }
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./actions" && padre.endsWith("/paquetes/ConfigForm.tsx")) return { url: ACCIONES_PAQUETES, shortCircuit: true };
    if (specifier === "../actions" && padre.endsWith("/ArmadoClient.tsx")) return { url: ACCIONES_PAQUETES, shortCircuit: true };
    if (specifier === "../actions" && padre.endsWith("/SalidasDinamicasEditor.tsx")) return { url: ACCIONES_SALIDAS, shortCircuit: true };
    if (specifier === "../../vuelos/empaquetados-actions" && padre.endsWith("/ArmadoClient.tsx")) return { url: ACCIONES_EMPAQUETADOS, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/dashboard/paquetes/")) return { url: NAVEGACION, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/paquetes/7" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const p101 = {
  llamadas: [] as [string, unknown[]][],
  refrescos: 0,
  respServicio: (a: unknown[]): unknown => { void a; return { ok: true }; },
};
(globalThis as unknown as { __p101: typeof p101 }).__p101 = p101;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const { formatCOP, formatMoneda } = await import("../lib/utils.ts");
const h = React.createElement;
type Props = Parameters<typeof ArmadoClient>[0];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  p101.llamadas.length = 0; p101.refrescos = 0;
  p101.respServicio = () => ({ ok: true });
  dom.window.history.replaceState(null, "", "/dashboard/paquetes/7");
});
after(() => dom.window.close());

async function montar(props: Props) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(ArmadoClient, props) as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
const pestanas = (raiz: Element) => [...raiz.querySelectorAll("[role=tab]")];
const nombresPestanas = (raiz: Element) => pestanas(raiz).map((b) => (b.textContent ?? "").trim());
const pestana = (raiz: Element, nombre: string) => {
  const b = pestanas(raiz).find((x) => (x.textContent ?? "").trim() === nombre);
  assert.ok(b, `debe existir la pestaña ${nombre}`);
  return b;
};
const activa = (raiz: Element) => (pestanas(raiz).find((b) => b.getAttribute("aria-selected") === "true")?.textContent ?? "").trim();
const cabecera = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button[aria-expanded]")].find((b) => texto.test(b.textContent ?? ""));
const texto = (raiz: Element) => raiz.textContent ?? "";

const CONFIG = (tipo: string) => ({ nombre: "Paquete 101", tipo, destinoId: 1, noches: 3, activo: true, pctMk: 20 }) as Props["config"];
const vuelo = (id: number, record: string) => ({ id, record, ruta: "BOG-CTG", aerolinea: "AV", fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13", tarifa_para_empaquetar: 100000, destino_id: 1 });
function props(tipo: string, over: Partial<Props> = {}): Props {
  return {
    paqueteId: 7,
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG" }],
    config: CONFIG(tipo),
    tieneDestino: true,
    vuelosDisp: [vuelo(11, "RAAA"), vuelo(12, "RBBB")],
    empaquetadosDisp: [{ ...vuelo(21, "REMP"), record: "REMP" }],
    hotelesDisp: [
      { id: 31, nombre: "Hotel Uno", zona: null, destino_id: 1 },
      { id: 32, nombre: "Hotel Dos", zona: null, destino_id: 1 },
    ],
    serviciosDisp: [
      { id: 41, nombre: "Tour persona", precio_persona: 50000, destino_id: 1, servicio_tarifa_pax: [] },
      { id: 42, nombre: "Tour grupo", precio_persona: null, destino_id: 1, servicio_tarifa_pax: [{ pax_desde: 2 }] },
      { id: 43, nombre: "Tour sin tarifa", precio_persona: null, destino_id: 1, servicio_tarifa_pax: [] },
    ],
    selVuelos: [], selEmpaquetados: [], selHoteles: [{ hotel_id: 31, categorias: null, regimenes: null, prioridad: null }], selServicios: [],
    resultado: [], salidas: [], moneda: "COP",
    ...over,
  };
}
const fila = (id: number, hotel: string, acom: string, pvp: number, extra: Record<string, unknown> = {}) => ({
  id, modulo: "bloqueo", bloqueo_label: "RAAA BOG-CTG", hotel_nombre: hotel, servicio_nombre: null, tipo_tarifa: null, pax_desde: null, pax_hasta: null,
  categoria: "ESTANDAR", regimen: "PC", acomodacion: acom, noches: 3, base_comisionable: pvp, impuesto: 0, precio_pvp: pvp,
  temporada_ganadora: null, es_promocion: null, precio_final_autoritativo: null, procedencia_temporadas: null, procedencia_mixta: false, ...extra,
});

// ═══ Navegación ═══════════════════════════════════════════════════════════
test("arranca en Configuración inicial y cada pestaña muestra SOLO su contenido", async () => {
  const raiz = await montar(props("bloqueo"));
  assert.deepEqual(nombresPestanas(raiz), ["Configuración inicial", "Vuelos", "Hoteles", "Servicios", "Tarifario resultado"]);
  assert.equal(activa(raiz), "Configuración inicial");
  assert.match(texto(raiz), /Guardar cambios/);
  assert.doesNotMatch(texto(raiz), /Adición de hoteles/);

  await pulsar(pestana(raiz, "Hoteles"));
  assert.equal(activa(raiz), "Hoteles");
  assert.match(texto(raiz), /Adición de hoteles/);
  assert.doesNotMatch(texto(raiz), /Guardar cambios/);
  assert.doesNotMatch(texto(raiz), /Adición de servicios/);

  await pulsar(pestana(raiz, "Servicios"));
  assert.match(texto(raiz), /Adición de servicios/);
  assert.doesNotMatch(texto(raiz), /Adición de hoteles/);

  await pulsar(pestana(raiz, "Tarifario resultado"));
  assert.match(texto(raiz), /Generar tarifario/);
});

test("la pestaña activa queda en ?tab= (sin navegar) y la pestaña inicial sale de ese valor", async () => {
  const raiz = await montar(props("bloqueo"));
  await pulsar(pestana(raiz, "Servicios"));
  assert.equal(new URL(window.location.href).searchParams.get("tab"), "servicios");
  assert.equal(p101.refrescos, 0, "cambiar de pestaña no recarga la página");
  await desmontar?.(); desmontar = undefined;

  const otra = await montar(props("bloqueo", { pestanaInicial: "tarifario" }));
  assert.equal(activa(otra), "Tarifario resultado");
});

test("una pestaña inicial inválida o que el tipo no muestra cae en Configuración inicial", async () => {
  for (const [tipo, tab] of [["bloqueo", "inexistente"], ["porcion_terrestre", "vuelos"], ["servicios", "hoteles"], ["bloqueo", ""]] as const) {
    const raiz = await montar(props(tipo, { pestanaInicial: tab }));
    assert.equal(activa(raiz), "Configuración inicial", `${tipo} con tab=${tab}`);
    await desmontar?.(); desmontar = undefined;
  }
});

test("las flechas del teclado mueven la pestaña activa", async () => {
  const raiz = await montar(props("bloqueo"));
  await React.act(async () => {
    pestana(raiz, "Configuración inicial").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  assert.equal(activa(raiz), "Vuelos");
  await React.act(async () => {
    pestana(raiz, "Vuelos").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  assert.equal(activa(raiz), "Configuración inicial");
});

// ═══ Visibilidad por tipo ═════════════════════════════════════════════════
test("pestañas por tipo: Vuelos solo en Bloqueo y Dinámico; Hoteles no existe en Servicios", async () => {
  const esperado: Record<string, string[]> = {
    bloqueo: ["Configuración inicial", "Vuelos", "Hoteles", "Servicios", "Tarifario resultado"],
    dinamico: ["Configuración inicial", "Vuelos", "Hoteles", "Servicios", "Tarifario resultado"],
    porcion_terrestre: ["Configuración inicial", "Hoteles", "Servicios", "Tarifario resultado"],
    servicios: ["Configuración inicial", "Servicios", "Tarifario resultado"],
  };
  for (const [tipo, nombres] of Object.entries(esperado)) {
    const raiz = await montar(props(tipo));
    assert.deepEqual(nombresPestanas(raiz), nombres, tipo);
    await desmontar?.(); desmontar = undefined;
  }
});

test("Bloqueo: vuelos negociados sí, Empaquetados NO, y sin salidas dinámicas", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "vuelos" }));
  assert.match(texto(raiz), /Adición de vuelos \(0 de 2\)/);
  assert.match(texto(raiz), /RAAA/);
  assert.doesNotMatch(texto(raiz), /Empaquetados|REMP|Vuelos por Sistema/, "el empaquetado disponible ya no se ofrece en Bloqueo");
  assert.doesNotMatch(texto(raiz), /Salidas dinámicas/);
});

test("Dinámico: solo Salidas dinámicas en la pestaña Vuelos", async () => {
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos" }));
  assert.match(texto(raiz), /Salidas dinámicas \(0\)/);
  assert.doesNotMatch(texto(raiz), /Adición de vuelos/);
  assert.doesNotMatch(texto(raiz), /REMP/, "el empaquetado disponible no se ofrece como lista en Dinámico");
});

test("Bloqueo con empaquetados AÚN vinculados: se muestran en solo lectura con el aviso, sin poder cambiarlos", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "vuelos", selEmpaquetados: [{ empaquetado_id: 21, aplica_mk: true, ta: 0 }, { empaquetado_id: 99, aplica_mk: false, ta: 5000 }] }));
  assert.match(texto(raiz), /vinculados a este paquete de Bloqueo/);
  assert.match(texto(raiz), /Vinculados en un paquete de Bloqueo: revisar \(2\)/);
  assert.match(texto(raiz), /REMP/);
  assert.match(texto(raiz), /Empaquetado #99/, "un vinculado fuera del rango/inactivo también se lista");
  const fila21 = [...raiz.querySelectorAll("li")].find((li) => /REMP/.test(li.textContent ?? ""))!;
  const entradas = [...fila21.querySelectorAll("input")];
  assert.ok(entradas.length >= 3 && entradas.every((i) => (i as HTMLInputElement).disabled), "casilla, mk/TA bloqueados");
  await pulsar(fila21.querySelector("input[type=checkbox]")!);
  assert.ok(!p101.llamadas.some(([n]) => n === "setEmpaquetado"), "no se llama a la acción de servidor");
  assert.equal([...raiz.querySelectorAll("label")].filter((l) => /Seleccionar todos/.test(l.textContent ?? "")).length, 1, "solo el de vuelos: no hay selección en bloque de empaquetados");
});

test("Dinámico con empaquetados AÚN vinculados: mismo aviso de solo lectura (con la moneda del empaquetado), junto a Salidas dinámicas", async () => {
  const emp = { ...vuelo(21, "REMP"), record: "REMP", moneda: "USD", tarifa_para_empaquetar: 250 };
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos", empaquetadosDisp: [emp], selEmpaquetados: [{ empaquetado_id: 21, aplica_mk: true, ta: 0 }] }));
  assert.match(texto(raiz), /Salidas dinámicas \(0\)/);
  assert.match(texto(raiz), /Vinculados en un paquete Dinámico: revisar \(1\)/);
  assert.match(texto(raiz), /vinculados a este paquete Dinámico/);
  assert.doesNotMatch(texto(raiz), /paquete de Bloqueo/);
  assert.match(texto(raiz), new RegExp(formatMoneda(250, "USD").replace(/[$.]/g, "\\$&")), "la tarifa se muestra en la moneda del empaquetado (#90/230)");
  const fila21 = [...raiz.querySelectorAll("li")].find((li) => /REMP/.test(li.textContent ?? ""))!;
  assert.ok([...fila21.querySelectorAll("input")].every((i) => (i as HTMLInputElement).disabled));
  await pulsar(fila21.querySelector("input[type=checkbox]")!);
  assert.ok(!p101.llamadas.some(([n]) => n === "setEmpaquetado"));
});

test("Dinámico SIN empaquetados vinculados: no aparece el aviso", async () => {
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos" }));
  assert.doesNotMatch(texto(raiz), /Vinculados en un paquete/);
});

test("Porción terrestre y Servicios no tienen pestaña de vuelos ni aviso de empaquetados", async () => {
  for (const tipo of ["porcion_terrestre", "servicios"]) {
    const raiz = await montar(props(tipo, { selEmpaquetados: [{ empaquetado_id: 21, aplica_mk: true, ta: 0 }] }));
    assert.ok(!nombresPestanas(raiz).includes("Vuelos"), tipo);
    for (const nombre of nombresPestanas(raiz)) { await pulsar(pestana(raiz, nombre)); assert.doesNotMatch(texto(raiz), /Vinculados en un paquete/, `${tipo}/${nombre}`); }
    await desmontar?.(); desmontar = undefined;
  }
});

// ═══ Plegado y contadores ═════════════════════════════════════════════════
test("las listas son plegables y la cabecera lleva el contador (seleccionados de disponibles)", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "hoteles" }));
  const cab = cabecera(raiz, /Adición de hoteles \(1 de 2\)/);
  assert.ok(cab, "contador en la cabecera");
  assert.equal(cab.getAttribute("aria-expanded"), "true");
  assert.match(texto(raiz), /Hotel Uno/);
  await pulsar(cab);
  assert.equal(cab.getAttribute("aria-expanded"), "false");
  assert.doesNotMatch(texto(raiz), /Hotel Uno/);
  assert.match(texto(raiz), /Adición de hoteles \(1 de 2\)/, "el contador sigue visible plegada");
  await pulsar(cab);
  assert.match(texto(raiz), /Hotel Uno/);
});

// ═══ Servicios: seleccionar todos (#98) ═══════════════════════════════════
test("Seleccionar todos marca solo los servicios con tarifa, uno a uno con la acción de siempre, y refresca una vez", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "servicios" }));
  assert.match(texto(raiz), /Adición de servicios \(0 de 3\)/);
  assert.match(texto(raiz), /Sin tarifa configurada/);
  const todos = [...raiz.querySelectorAll("label")].find((l) => /Seleccionar todos/.test(l.textContent ?? ""))!.querySelector("input")!;
  await pulsar(todos);
  const llamadas = p101.llamadas.filter(([n]) => n === "setServicio").map(([, a]) => a);
  assert.deepEqual(llamadas, [[7, 41, true, "persona", false], [7, 42, true, "grupo", false]], "el 43 (sin tarifa) no entra");
  assert.equal(p101.refrescos, 1, "se refresca una sola vez al final");
});

test("con todos los seleccionables marcados: casilla marcada, 'Deseleccionar todos' y desmarca lo marcado conservando nada más", async () => {
  const sel = [{ servicio_id: 41, modo: "persona", incluido: true }, { servicio_id: 42, modo: "grupo", incluido: false }];
  const raiz = await montar(props("bloqueo", { pestanaInicial: "servicios", selServicios: sel }));
  const etiqueta = [...raiz.querySelectorAll("label")].find((l) => /Deseleccionar todos/.test(l.textContent ?? ""))!;
  assert.ok(etiqueta, "ofrece Deseleccionar todos");
  const casilla = etiqueta.querySelector("input")!;
  assert.equal(casilla.checked, true);
  assert.equal(casilla.indeterminate, false);
  await pulsar(casilla);
  const llamadas = p101.llamadas.filter(([n]) => n === "setServicio").map(([, a]) => a);
  assert.deepEqual(llamadas, [[7, 41, false, "persona", true], [7, 42, false, "grupo", false]]);
});

test("selección parcial: casilla en estado indeterminado y marcar completa solo los que faltan sin tocar los ya marcados", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "servicios", selServicios: [{ servicio_id: 41, modo: "persona", incluido: true }] }));
  const casilla = [...raiz.querySelectorAll("label")].find((l) => /Seleccionar todos/.test(l.textContent ?? ""))!.querySelector("input")!;
  assert.equal(casilla.indeterminate, true);
  assert.equal(casilla.checked, false);
  await pulsar(casilla);
  const llamadas = p101.llamadas.filter(([n]) => n === "setServicio").map(([, a]) => a);
  assert.deepEqual(llamadas, [[7, 42, true, "grupo", false]], "el 41 ya estaba marcado (Incluido) y no se reescribe");
});

test("si el servidor rechaza un servicio, se muestra el error y se detiene el lote", async () => {
  p101.respServicio = (a) => ((a as unknown[])[1] === 41 ? { ok: false, error: "No se pudo guardar el servicio." } : { ok: true });
  const raiz = await montar(props("bloqueo", { pestanaInicial: "servicios" }));
  const casilla = [...raiz.querySelectorAll("label")].find((l) => /Seleccionar todos/.test(l.textContent ?? ""))!.querySelector("input")!;
  await pulsar(casilla);
  assert.match(texto(raiz), /No se pudo guardar el servicio\./);
  assert.equal(p101.llamadas.filter(([n]) => n === "setServicio").length, 1, "no sigue con el 42");
});

// ═══ Tarifario resultado ══════════════════════════════════════════════════
const RESULTADO = [
  fila(1, "Hotel Uno", "doble", 2_000_000),
  fila(2, "Hotel Uno", "doble", 1_800_000, { categoria: "SUPERIOR" }),
  fila(3, "Hotel Uno", "nino", 100_000),
  fila(4, "Hotel Uno", "infante", 50_000),
  fila(5, "Hotel Dos", "sencilla", 3_000_000),
  fila(6, "Hotel Dos", "infante", 10_000),
  fila(7, "Hotel Dos", "doble", 2_500_000),
  { ...fila(8, "", "", 120_000), modulo: "servicios", hotel_nombre: null, servicio_nombre: "Tour persona", tipo_tarifa: "persona" },
];

test("agrupado por hotel, plegado por defecto, con nº de filas y precio DOBLE de referencia (nunca niño ni infante)", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: RESULTADO as unknown as Props["resultado"] }));
  const uno = cabecera(raiz, /Hotel Uno/)!;
  const dos = cabecera(raiz, /Hotel Dos/)!;
  assert.ok(uno && dos);
  assert.equal(uno.getAttribute("aria-expanded"), "false");
  assert.equal(dos.getAttribute("aria-expanded"), "false");
  assert.equal(raiz.querySelectorAll("table").length, 0, "plegado: no se renderiza ninguna tabla de filas");
  assert.match(uno.textContent ?? "", /4 filas/);
  assert.match(uno.textContent ?? "", new RegExp(`Doble desde\\s*${formatCOP(1_800_000).replace(/[$.]/g, "\\$&")}`), "el menor DOBLE, no el niño de 100.000 ni el infante de 50.000");
  assert.match(dos.textContent ?? "", /3 filas/);
  assert.match(dos.textContent ?? "", new RegExp(`Doble desde\\s*${formatCOP(2_500_000).replace(/[$.]/g, "\\$&")}`), "ni la sencilla de 3.000.000 ni el infante de 10.000");

  await pulsar(uno);
  assert.equal(uno.getAttribute("aria-expanded"), "true");
  const tablas = raiz.querySelectorAll("table");
  assert.equal(tablas.length, 1, "solo el grupo abierto renderiza filas");
  assert.equal(tablas[0].querySelectorAll("tbody tr").length, 4);
  assert.match(texto(raiz), /Infante/);
});

test("un hotel sin fila doble lo dice en vez de inventar una referencia", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: [fila(1, "Hotel Solo Niño", "nino", 10_000)] as unknown as Props["resultado"] }));
  assert.match(cabecera(raiz, /Hotel Solo Niño/)!.textContent ?? "", /Sin tarifa doble/);
});

test("los servicios del resultado van aparte y plegados", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: RESULTADO as unknown as Props["resultado"] }));
  const cab = cabecera(raiz, /Servicios opcionales \(1\)/);
  assert.ok(cab);
  assert.equal(cab.getAttribute("aria-expanded"), "false");
});

test("estado del tarifario arriba con el botón Generar: publicado / desactualizado / fallido con su error", async () => {
  const casos: [Partial<Props>, string, RegExp][] = [
    [{ tarifarioEstado: "listo" }, "publicado", /Publicado/],
    [{ tarifarioEstado: "pendiente" }, "desactualizado", /Desactualizado/],
    [{ tarifarioEstado: "recalculando" }, "desactualizado", /generación en curso/],
    [{ tarifarioEstado: "fallido", tarifarioError: "No se pudo generar el tarifario por un error técnico." }, "fallido", /error técnico/],
  ];
  for (const [extra, clave, patron] of casos) {
    const raiz = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: RESULTADO as unknown as Props["resultado"], ...extra }));
    const caja = raiz.querySelector("[data-testid=estado-tarifario]")!;
    assert.equal(caja.getAttribute("data-estado"), clave);
    assert.match(caja.textContent ?? "", patron);
    const boton = [...raiz.querySelectorAll("button")].find((b) => /^Generar tarifario$/.test((b.textContent ?? "").trim()));
    assert.ok(boton, "botón Generar tarifario presente");
    // Arriba, sin scroll: el estado y el botón van ANTES de la primera lista de hoteles en el documento.
    assert.ok(caja.compareDocumentPosition(cabecera(raiz, /Hotel Uno/)!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(boton.compareDocumentPosition(cabecera(raiz, /Hotel Uno/)!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    await desmontar?.(); desmontar = undefined;
  }
});

test("sin estado explícito: con filas se asume publicado y sin filas desactualizado (nunca se afirma sin base)", async () => {
  const con = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: RESULTADO as unknown as Props["resultado"] }));
  assert.equal(con.querySelector("[data-testid=estado-tarifario]")!.getAttribute("data-estado"), "publicado");
  await desmontar?.(); desmontar = undefined;
  const sin = await montar(props("bloqueo", { pestanaInicial: "tarifario" }));
  assert.equal(sin.querySelector("[data-testid=estado-tarifario]")!.getAttribute("data-estado"), "desactualizado");
});

test("Generar tarifario llama a la acción de siempre y conserva la pestaña (estado y ?tab=) tras refrescar", async () => {
  const raiz = await montar(props("bloqueo", { resultado: RESULTADO as unknown as Props["resultado"] }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const boton = [...raiz.querySelectorAll("button")].find((b) => /^Generar tarifario$/.test((b.textContent ?? "").trim()))!;
  await pulsar(boton);
  await React.act(async () => { await new Promise((r) => setImmediate(r)); });
  assert.deepEqual(p101.llamadas.filter(([n]) => n === "generarTarifario").map(([, a]) => a), [[7]]);
  assert.ok(p101.refrescos >= 1, "refresca los datos del servidor");
  assert.equal(activa(raiz), "Tarifario resultado", "sigue en la misma pestaña");
  assert.equal(new URL(window.location.href).searchParams.get("tab"), "tarifario");
  assert.match(texto(raiz), /Tarifario generado: 3 tarifas publicadas\./);
});

test("sin destino: solo Configuración y el aviso (no hay pestañas)", async () => {
  const raiz = await montar(props("bloqueo", { tieneDestino: false }));
  assert.equal(pestanas(raiz).length, 0);
  assert.match(texto(raiz), /Asigna un destino/);
  assert.match(texto(raiz), /Guardar cambios/);
});
