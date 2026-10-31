// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs //        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/accionesMasivas107.react.ts
//
// #107 / #101b — acciones masivas del armado (una acción por lote), diálogo propio y ventana flotante del tarifario
// resultado, con el componente REAL (ArmadoClient / SalidasDinamicasEditor / DialogoConfirmar). Las acciones de
// servidor se sustituyen por dobles que cuentan llamadas; no se prueba ningún cálculo de precios.
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
  export async function eliminarPaquete(...a) { reg('eliminarPaquete', a); return ${G}.respEliminar(a); }
  export async function crearPaquete() { return { ok: true, id: 1 }; }
  export async function actualizarPaquete() { return { ok: true, id: 1 }; }
  export async function listarDestinosAereosCandidatos() { return { ok: true, candidatos: [], motivo: null }; }
  export async function setVuelo(...a) { reg('setVuelo', a); return { ok: true }; }
  export async function setTodosVuelos(...a) { reg('setTodosVuelos', a); return { ok: true }; }
  export async function setHotel(...a) { reg('setHotel', a); return { ok: true }; }
  export async function setTodosHoteles(...a) { reg('setTodosHoteles', a); return { ok: true }; }
  export async function setServicio(...a) { reg('setServicio', a); return ${G}.respServicio(a); }
  export async function setServicios(...a) { reg('setServicios', a); return ${G}.respLote(a); }
  export async function generarTarifario(...a) { reg('generarTarifario', a); return { ok: true, id: 3 }; }
  export async function getTarifasHotel() { return { ok: true, modelo: 'persona', categorias: [], regimenes: [], tarifas: [] }; }
  export async function setHotelFiltros() { return { ok: true }; }
  export async function setHotelPrioridad() { return { ok: true }; }
`);
const ACCIONES_SALIDAS = datos(`
  const reg = (n, a) => ${G}.llamadas.push([n, a]);
  export async function crearSalidaDinamica() { return { ok: true }; }
  export async function actualizarSalidaDinamica() { return { ok: true }; }
  export async function eliminarSalidaDinamica(...a) { reg('eliminarSalidaDinamica', a); return { ok: true }; }
  export async function listarEmpaquetadosParaSalidas63() { return { ok: true, candidatos: ${G}.candidatos, pendientes: ${G}.candidatos.filter((c) => !c.vinculado).length }; }
  export async function vincularSalidasEmpaquetados63(...a) { reg('vincularSalidasEmpaquetados63', a); return { ok: true, id: a[1].length }; }
  export async function actualizarSalidaDesdeFuente63() { return { ok: true }; }
  export async function desvincularSalidasEmpaquetados63(...a) { reg('desvincularSalidasEmpaquetados63', a); return ${G}.respDesvincular(a); }
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
    if (specifier === "./actions" && padre.endsWith("/paquetes/EliminarPaqueteBtn.tsx")) return { url: ACCIONES_PAQUETES, shortCircuit: true };
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
Object.assign(globalThis, {
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const p101 = {
  llamadas: [] as [string, unknown[]][],
  refrescos: 0,
  respServicio: (a: unknown[]): unknown => { void a; return { ok: true }; },
  candidatos: [] as unknown[],
  respEliminar: (a: unknown[]): unknown => { void a; return { ok: true }; },
  respDesvincular: (a: unknown[]): unknown => ({ ok: true, procesados: (a[1] as unknown[]).length }),
  respLote: (a: unknown[]): unknown => ({ ok: true, procesados: (a[1] as unknown[]).length }),
};
(globalThis as unknown as { __p101: typeof p101 }).__p101 = p101;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const { formatCOP } = await import("../lib/utils.ts");
const { EliminarPaqueteBtn } = await import("../app/(dashboard)/dashboard/paquetes/EliminarPaqueteBtn.tsx");
const h = React.createElement;
type Props = Parameters<typeof ArmadoClient>[0];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  p101.llamadas.length = 0; p101.refrescos = 0;
  p101.respServicio = () => ({ ok: true });
  p101.candidatos = [];
  p101.respEliminar = () => ({ ok: true });
  p101.respDesvincular = (a) => ({ ok: true, procesados: (a[1] as unknown[]).length });
  p101.respLote = (a) => ({ ok: true, procesados: (a[1] as unknown[]).length });
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
      { id: 41, nombre: "Tour persona", precio_persona: 50000, destino_id: 1, servicio_tarifa_pax: [], servicio_temporadas: [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2099-12-31", precio_persona: 50000 }] },
      { id: 42, nombre: "Tour grupo", precio_persona: null, destino_id: 1, servicio_tarifa_pax: [{ pax_desde: 2, temporada: "V1" }], servicio_temporadas: [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2099-12-31", precio_persona: null }] },
      { id: 43, nombre: "Tour sin tarifa", precio_persona: null, destino_id: 1, servicio_tarifa_pax: [] },
    ],
    selVuelos: [], selEmpaquetados: [], selHoteles: [{ hotel_id: 31, categorias: null, regimenes: null, prioridad: null }], selServicios: [],
    resultado: [], salidas: [], moneda: "COP",
    ...over,
  };
}


const esperar = async () => { await React.act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const dialogo = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const botonDe = (raiz: ParentNode | null, t: RegExp) => [...(raiz?.querySelectorAll("button") ?? [])].find((b) => t.test((b.textContent ?? "").trim())) as HTMLElement | undefined;
const escape = async () => React.act(async () => {
  (document.activeElement ?? document.body).dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
});

async function montarBoton() {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(EliminarPaqueteBtn, { id: 5, nombre: "Paquete Cinco" }) as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const casilla = (raiz: Element) => [...raiz.querySelectorAll("label")].find((l) => /Seleccionar todos|Deseleccionar todos/.test(l.textContent ?? ""))!.querySelector("input")!;

// ═══ Diálogo propio ═══════════════════════════════════════════════════════
test("Eliminar paquete: diálogo propio (no confirm()), foco inicial en Cancelar, Escape cierra sin eliminar y devuelve el foco", async () => {
  dom.window.confirm = () => { throw new Error("se llamó a window.confirm()"); };
  const c = await montarBoton();
  const disparador = botonDe(c, /^Eliminar$/)!;
  disparador.focus();
  await pulsar(disparador);
  await esperar();
  const d = dialogo();
  assert.ok(d, "abre el diálogo");
  assert.match(d.textContent ?? "", /¿Eliminar el paquete "Paquete Cinco"\?/);
  assert.equal(document.activeElement, botonDe(d, /^Cancelar$/), "el foco inicial es la opción segura");
  assert.ok(botonDe(d, /Eliminar$/) && d.querySelector("svg"), "botones claros con iconos lucide");
  assert.equal(p101.llamadas.filter(([n]) => n === "eliminarPaquete").length, 0);
  await escape();
  assert.equal(dialogo(), null, "Escape cierra");
  assert.equal(p101.llamadas.filter(([n]) => n === "eliminarPaquete").length, 0, "cerrar no elimina");
  assert.equal(document.activeElement, disparador, "el foco vuelve al botón que abrió el diálogo");
});

test("Eliminar paquete: un rechazo del servidor deja el diálogo abierto con el error; confirmar bien lo cierra", async () => {
  const c = await montarBoton();
  p101.respEliminar = () => ({ ok: false, error: "No se puede eliminar: tiene reservas." });
  await pulsar(botonDe(c, /^Eliminar$/)!);
  await esperar();
  await pulsar(botonDe(dialogo(), /Eliminar$/)!);
  await esperar();
  assert.ok(dialogo(), "sigue abierto");
  assert.match(dialogo()!.querySelector("[role=alert]")?.textContent ?? "", /tiene reservas/);
  p101.respEliminar = () => ({ ok: true });
  await pulsar(botonDe(dialogo(), /Eliminar$/)!);
  await esperar();
  assert.equal(dialogo(), null);
  assert.equal(p101.llamadas.filter(([n]) => n === "eliminarPaquete").length, 2);
});

// ═══ Hoteles ══════════════════════════════════════════════════════════════
test("Hoteles: Seleccionar todos va en UNA acción y un refresh; quitar todos pide confirmar y también es UNA acción", async () => {
  const raiz = await montar(props("bloqueo", { pestanaInicial: "hoteles", selHoteles: [] }));
  await pulsar(casilla(raiz));
  assert.deepEqual(p101.llamadas.map(([n]) => n), ["setTodosHoteles"]);
  assert.deepEqual(p101.llamadas[0][1], [7, [31, 32], true]);
  assert.equal(p101.refrescos, 1);
  await desmontar?.(); desmontar = undefined; p101.llamadas.length = 0; p101.refrescos = 0;

  const todos = [{ hotel_id: 31, categorias: null, regimenes: null, prioridad: 1 }, { hotel_id: 32, categorias: null, regimenes: null, prioridad: null }];
  const r2 = await montar(props("bloqueo", { pestanaInicial: "hoteles", selHoteles: todos }));
  assert.match(texto(r2), /Deseleccionar todos/);
  await pulsar(casilla(r2));
  await esperar();
  assert.equal(p101.llamadas.length, 0, "nada se borra antes de confirmar");
  assert.match(dialogo()?.textContent ?? "", /¿Quitar todos los hoteles del paquete\?/);
  await pulsar(botonDe(dialogo(), /^Quitar todos$/)!);
  await esperar();
  assert.deepEqual(p101.llamadas.map(([n]) => n), ["setTodosHoteles"]);
  assert.deepEqual(p101.llamadas[0][1], [7, [31, 32], false]);
  assert.equal(p101.refrescos, 1);
  assert.equal(dialogo(), null);
});

// ═══ Salidas dinámicas vinculadas ═════════════════════════════════════════
const cand = (id: number, vinculado = false) => ({
  id, ruta: "MDE-CTG-MDE", aerolinea: "AV", fechaIda: "2030-04-1" + id, fechaRegreso: "2030-04-2" + id, compraInicio: null, compraFin: null,
  tarifaParaEmpaquetar: 500000, feeInfante: 0, moneda: "COP", salidaId: vinculado ? 900 + id : null, vinculado, desactualizado: false,
});
const salida = (id: number, empaquetadoId: number) => ({
  id, aerolinea: "AV", ruta: "MDE-CTG-MDE", origen: "MDE", fecha_ida: "2030-04-1" + empaquetadoId, fecha_regreso: "2030-04-2" + empaquetadoId,
  hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null, valor_tiquete: 500000, aplica_mk: true, ta: 0, fee_infante: 0,
  compra_inicio: null, compra_fin: null, notas: null, empaquetado_id: empaquetadoId, moneda: "COP",
});
const cfg63 = () => ({ ...CONFIG("dinamico"), modoOferta: "cop_trm_63", trmOferta: 4000 }) as Props["config"];

test("Salidas vinculadas: Seleccionar todos + Vincular seleccionados = UNA acción con todos los ids", async () => {
  p101.candidatos = [cand(1), cand(2), cand(3)];
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos", config: cfg63() }));
  await esperar();
  assert.match(texto(raiz), /3 pendientes/);
  await pulsar(casilla(raiz));
  assert.match(texto(raiz), /Vincular seleccionados \(3\)/);
  assert.match(texto(raiz), /Deseleccionar todos/);
  await pulsar(botonDe(raiz, /^Vincular seleccionados/)!);
  await esperar();
  const v = p101.llamadas.filter(([n]) => n === "vincularSalidasEmpaquetados63");
  assert.equal(v.length, 1);
  assert.deepEqual(v[0][1], [7, [1, 2, 3]]);
  assert.match(texto(raiz), /Se vinculó 3 salidas\./);
});

test("Salidas vinculadas: Desvincular todos pide confirmar y es UNA acción (no una por salida)", async () => {
  p101.candidatos = [cand(1, true), cand(2, true), cand(3, true)];
  const sal = [salida(901, 1), salida(902, 2), salida(903, 3)];
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos", config: cfg63(), salidas: sal as never }));
  await esperar();
  await pulsar(botonDe(raiz, /^Desvincular todos \(3\)$/)!);
  await esperar();
  assert.equal(p101.llamadas.length, 0, "nada antes de confirmar");
  assert.match(dialogo()?.textContent ?? "", /¿Desvincular las 3 salidas\?/);
  await pulsar(botonDe(dialogo(), /^Desvincular todas$/)!);
  await esperar();
  assert.deepEqual(p101.llamadas.map(([n]) => n), ["desvincularSalidasEmpaquetados63"]);
  assert.deepEqual(p101.llamadas[0][1], [7, [901, 902, 903]]);
  assert.equal(p101.llamadas.filter(([n]) => n === "eliminarSalidaDinamica").length, 0);
  assert.match(texto(raiz), /Se desvinculó 3 salidas\./);
  assert.equal(dialogo(), null);
});

test("Salidas vinculadas: un fallo deja el diálogo con el error; un resultado parcial se explica (omitidos + aviso)", async () => {
  p101.candidatos = [cand(1, true), cand(2, true)];
  const sal = [salida(901, 1), salida(902, 2)];
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos", config: cfg63(), salidas: sal as never }));
  await esperar();
  p101.respDesvincular = () => ({ ok: false, error: "No se pudo desvincular." });
  await pulsar(botonDe(raiz, /^Desvincular todos/)!);
  await esperar();
  await pulsar(botonDe(dialogo(), /^Desvincular todas$/)!);
  await esperar();
  assert.match(dialogo()?.querySelector("[role=alert]")?.textContent ?? "", /No se pudo desvincular\./);
  p101.respDesvincular = () => ({ ok: true, procesados: 1, omitidos: [{ id: 902, motivo: "La salida #902 ya no estaba vinculada." }], aviso: "El tarifario no se pudo regenerar." });
  await pulsar(botonDe(dialogo(), /^Desvincular todas$/)!);
  await esperar();
  assert.equal(dialogo(), null);
  const estado = [...raiz.querySelectorAll("[role=status]")].map((e) => e.textContent).join(" ");
  assert.match(estado, /Se desvinculó 1 salida\./);
  assert.match(estado, /No se aplicó a 1 elemento: La salida #902 ya no estaba vinculada\./);
  assert.match(estado, /El tarifario no se pudo regenerar\./);
});

test("Desvincular una sola salida y eliminar una manual también usan el diálogo propio (nunca confirm())", async () => {
  dom.window.confirm = () => { throw new Error("se llamó a window.confirm()"); };
  p101.candidatos = [cand(1, true)];
  const manual = { ...salida(950, 0), empaquetado_id: null };
  const raiz = await montar(props("dinamico", { pestanaInicial: "vuelos", config: cfg63(), salidas: [salida(901, 1), manual] as never }));
  await esperar();
  await pulsar(botonDe(raiz, /^Desvincular$/)!);
  await esperar();
  assert.match(dialogo()?.textContent ?? "", /¿Desvincular esta salida\?/);
  await pulsar(botonDe(dialogo(), /^Desvincular$/)!);
  await esperar();
  assert.deepEqual(p101.llamadas.at(-1), ["desvincularSalidasEmpaquetados63", [7, [901]]]);
  await pulsar(botonDe(raiz, /^Eliminar$/)!);
  await esperar();
  assert.match(dialogo()?.textContent ?? "", /¿Eliminar esta salida\?/);
  await pulsar(botonDe(dialogo(), /^Eliminar$/)!);
  await esperar();
  assert.deepEqual(p101.llamadas.at(-1), ["eliminarSalidaDinamica", [950]]);
});

// ═══ #101b — tarifario por categoría × vigencia × régimen con ventana flotante ═══
const filaT = (id: number, acom: string, pvp: number, extra: Record<string, unknown> = {}) => ({
  id, modulo: "bloqueo", bloqueo_label: "MDE - CTG - MDE", hotel_nombre: "Hotel Uno", servicio_nombre: null, tipo_tarifa: null, pax_desde: null, pax_hasta: null,
  categoria: "ESTANDAR", regimen: "PC", acomodacion: acom, noches: 5, base_comisionable: pvp - 100, impuesto: 100, precio_pvp: pvp,
  temporada_ganadora: "Alta", es_promocion: false, precio_final_autoritativo: null, procedencia_temporadas: null, procedencia_mixta: false,
  fecha_ida: "2030-04-15", fecha_regreso: "2030-04-20", bloqueo_id: 1, salida_id: null, empaquetado_id: null, moneda: "COP", ...extra,
});

test("#101b: una línea por categoría × vigencia × régimen; la ventana muestra ruta + fechas si el precio cambia por salida, y Escape devuelve el foco", async () => {
  const resultado = [
    filaT(1, "doble", 2_000_000), filaT(2, "sencilla", 3_000_000),
    filaT(3, "doble", 2_400_000, { bloqueo_id: 2, fecha_ida: "2030-05-10", fecha_regreso: "2030-05-15" }),
    filaT(4, "sencilla", 3_400_000, { bloqueo_id: 2, fecha_ida: "2030-05-10", fecha_regreso: "2030-05-15" }),
  ];
  const raiz = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: resultado as unknown as Props["resultado"] }));
  await pulsar(cabecera(raiz, /Hotel Uno/)!);
  const lineas = raiz.querySelectorAll("[data-testid=grupos-tarifa] > li");
  assert.equal(lineas.length, 1, "dos salidas, una sola categoría × vigencia × régimen");
  const boton = lineas[0].querySelector("button")!;
  assert.match(boton.textContent ?? "", /ESTANDAR/);
  assert.match(boton.textContent ?? "", /Alta/);
  assert.match(boton.textContent ?? "", /PC/);
  assert.match(boton.textContent ?? "", /Varía por salida/);
  assert.ok((boton.textContent ?? "").includes(formatCOP(2_000_000)), "Doble desde el menor");
  assert.equal(dialogo(), null);

  boton.focus();
  await pulsar(boton);
  await esperar();
  const d = dialogo()!;
  assert.ok(d, "abre la ventana flotante encima del contenido");
  assert.match(d.className, /max-w-3xl/, "ancho amplio para la tabla");
  const salidas = [...d.querySelectorAll("[data-testid=salidas-del-bloque]")].map((e) => e.textContent);
  assert.deepEqual(salidas, ["MDE–CTG–MDE · 15 al 20 abr", "MDE–CTG–MDE · 10 al 15 may"], "ruta + fechas, nunca solo la ruta");
  assert.equal(d.querySelectorAll("table").length, 2);
  const cabeceras = [...d.querySelectorAll("th")].map((t) => t.textContent);
  for (const c of ["Acomodación", "Base com.", "Impuesto", "PVP /pax"]) assert.ok(cabeceras.includes(c), c);
  assert.ok((d.textContent ?? "").includes(formatCOP(2_400_000)));
  assert.ok(d.contains(document.activeElement), "el foco queda dentro de la ventana");

  await escape();
  assert.equal(dialogo(), null, "Escape cierra");
  assert.equal(document.activeElement, boton, "el foco vuelve a la línea del grupo");
});

test("#101b: si el precio es igual en todas las salidas, un solo bloque sin rotular salida por salida", async () => {
  const resultado = [filaT(1, "doble", 2_000_000), filaT(2, "doble", 2_000_000, { bloqueo_id: 2, fecha_ida: "2030-05-10", fecha_regreso: "2030-05-15" })];
  const raiz = await montar(props("bloqueo", { pestanaInicial: "tarifario", resultado: resultado as unknown as Props["resultado"] }));
  await pulsar(cabecera(raiz, /Hotel Uno/)!);
  await pulsar(raiz.querySelector("[data-testid=grupos-tarifa] button")!);
  await esperar();
  const d = dialogo()!;
  assert.equal(d.querySelectorAll("table").length, 1);
  assert.match(d.textContent ?? "", /Mismo precio en las 2 salidas\./);
  assert.equal(d.querySelectorAll("[data-testid=salidas-del-bloque]").length, 0);
});
