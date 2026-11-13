// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/gruposDias295.react.ts
// #43/#60 incremento 3 — editor de grupos de días (preparación inactiva), componentes REALES con las
// acciones sustituidas: una lectura al abrir, cero solicitudes al editar y revisar, una al confirmar;
// sugerencias solo con aceptación explícita; confirmación obsoleta pide recargar (sin reintento).
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__g295r";
const GRUPOS = datos(`
  const reg = (n, a) => { ${G}.llamadas.push([n, a]); return ${G}.resp(n); };
  export async function leerConfigGrupos(...a) { return reg('leerConfigGrupos', a); }
  export async function guardarGruposVigencia(...a) { return reg('guardarGruposVigencia', a); }
  export async function guardarPropuestaGrupos(...a) { return reg('guardarPropuestaGrupos', a); }
  export async function borrarGrupoDias(...a) { return reg('borrarGrupoDias', a); }
  export async function leerAlcanceGrupos(...a) { return reg('leerAlcanceGrupos', a); }
  export async function aplicarGruposVenta(...a) { return reg('aplicarGruposVenta', a); }
  export async function descartarBorradorGrupos(...a) { return reg('descartarBorradorGrupos', a); }
  export async function volverATodosLosDias(...a) { return reg('volverATodosLosDias', a); }
`);
const ACCIONES_HOTEL = datos(`
  export async function crearTemporada() { return { ok: true }; } export async function actualizarTemporada() { return { ok: true }; } export async function guardarCombinacionPromocion() { return { ok: true }; } export async function activarCambioPromocion() { return { ok: true }; }
  export async function eliminarTemporada() { return { ok: true }; } export async function copiarTemporadasDesdeHotel() { return { ok: true, copiadas: 0 }; }
  export async function crearTarifa() { return { ok: true }; } export async function actualizarTarifa() { return { ok: true }; }
  export async function eliminarTarifa() { return { ok: true }; }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./grupos-actions" && padre.endsWith("/GruposDiasPanel.tsx")) return { url: GRUPOS, shortCircuit: true };
    if (specifier === "../actions" && padre.endsWith("/HotelDetalleClient.tsx")) return { url: ACCIONES_HOTEL, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/producto/hoteles/")) return { url: datos("export function useRouter(){return{push(){},refresh(){},replace(){}}}"), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/5" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const G1 = "00000000-0000-4000-8000-0000000000a1";
const NV = { neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null };
const EV = { nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null };
const EXTRAS = { nota_infante: "Cuna", notas: "Vista al mar", edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 11 };
// Propuesta guardada con decimales, entero, cero y vacío, y con override completo de edades y notas.
const PROP = { id: 1, grupo_id: G1, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NV, ...EXTRAS,
  neto_doble: 123.45, neto_sencilla: 150000, neto_nino: 0, origen_tarifa_id: null };
const CFG = {
  vigencia: { id: 10, nombre: "ALTA", hotel_id: 5, tipo: "tarifa", nombre_repetido: false }, hotel: { id: 5, modelo_tarifario: "persona" },
  categorias: ["Estándar", "Superior"], regimenes: ["PAM"],
  grupos: [{ id: G1, nombre: "Semana", dias: [1, 2, 3, 4], activo: false }],
  propuestas: [PROP],
  origen: [
    { id: 77, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NV, ...EV, neto_doble: 120000, neto_sencilla: 150000, huella: "h" },
    { id: 78, tipo_habitacion: "Superior", alimentacion: "PAM", ...NV, neto_doble: 200000.5, neto_infante: 0, notas: "Origen", nota_infante: null, edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, huella: "h2" },
  ],
  promociones: [{ temporada: "PROMO-ALTA", filas: 1 }], huella: "H1",
};
const est = {
  llamadas: [] as [string, unknown[]][],
  respuestas: {} as Record<string, unknown>,
  resp: (n: string): unknown => est.respuestas[n] ?? { ok: true, config: CFG, nuevas: 1, actualizadas: 0, eliminadas: 0, altas: 0, cambios: 0, propuestasEliminadas: 0 },
};
(globalThis as unknown as { __g295r: typeof est }).__g295r = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { GruposDiasPanel } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/GruposDiasPanel.tsx");
const { HotelDetalleClient } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx");
const { payloadFilas } = await import("../lib/hoteles/alcanceGrupos.ts");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; est.llamadas.length = 0; est.respuestas = {}; });
after(() => dom.window.close());
async function montar(el: unknown) {
  const c = document.createElement("div"); document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => { raiz.render(el as never); await new Promise((r) => setImmediate(r)); });
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
const boton = (r: Element, t: string) => [...r.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === t) as HTMLButtonElement;
const botonesTexto = (r: Element, re: RegExp) => [...r.querySelectorAll("button")].filter((b) => re.test(b.textContent ?? ""));
const celda = (r: Element, etiqueta: string, cat = "Estándar") => r.querySelector<HTMLInputElement>(`input[aria-label="${cat} PAM ${etiqueta}"]`)!;
const nombres = () => est.llamadas.map((l) => l[0]);
const panel = () => h(GruposDiasPanel, { temporadaId: 10, nombreVigencia: "ALTA", onCerrar: () => {}, onGruposCambiados: () => {} });
const lineasRevision = (r: Element) => [...r.querySelectorAll('[data-revision="propuesta"] li[data-tipo]')].map((li) => li.textContent ?? "");
type Llamada = [number, string, string, string | null, { grupo_id: string; tipo_habitacion: string; netos: Record<string, number | null>; origen_tarifa_id: number | null; extras?: Record<string, unknown> }[]];
const ultimaPropuesta = () => est.llamadas.filter((l) => l[0] === "guardarPropuestaGrupos").at(-1)![1] as unknown as Llamada;

test("abrir muestra los importes guardados sin perder decimales: 123,45 · 150.000 · 0 · vacío", async () => {
  const r = await montar(panel());
  assert.deepEqual(nombres(), ["leerConfigGrupos"]);
  assert.equal(celda(r, "Doble").value, "123,45");
  assert.equal(celda(r, "Sencilla").value, "150.000");
  assert.equal(celda(r, "Niño 1").value, "0");
  assert.equal(celda(r, "Niño 2").value, "");
});

test("editar OTRA celda: la revisión lista solo esa celda y el payload conserva 123.45, el 0 y omite notas/edades", async () => {
  const r = await montar(panel());
  await escribir(celda(r, "Triple"), "99,9");
  await pulsar(boton(r, "Revisar propuesta"));
  assert.deepEqual(lineasRevision(r), ["Semana · Estándar / PAM · Triple: vacío → 99,9"]);
  assert.deepEqual(nombres(), ["leerConfigGrupos"], "editar y revisar no hacen solicitudes");
  await pulsar(boton(r, "Confirmar propuesta"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "guardarPropuestaGrupos"]);
  const [, huella, modo, , filas] = ultimaPropuesta();
  assert.equal(huella, "H1"); assert.equal(modo, "actualizar");
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].netos, { ...NV, neto_doble: 123.45, neto_sencilla: 150000, neto_triple: 99.9, neto_nino: 0 });
  assert.equal(filas[0].extras, undefined, "notas y edades omitidas: la base las conserva");
  assert.equal("notas" in payloadFilas(filas as never)[0], false);
});

test("un punto decimal ambiguo se rechaza en la revisión y no se envía nada", async () => {
  const r = await montar(panel());
  await escribir(celda(r, "Triple"), "123.45");
  await pulsar(boton(r, "Revisar propuesta"));
  assert.match(r.textContent ?? "", /usa coma para decimales/);
  assert.equal(boton(r, "Confirmar propuesta"), undefined);
  assert.deepEqual(nombres(), ["leerConfigGrupos"]);
});

test("aceptar una sugerencia con decimales y cero: el payload trae los importes exactos y el origen; sus notas/edades solo con aceptación aparte", async () => {
  const r = await montar(panel());
  const [, usarSuperior] = botonesTexto(r, /^Usar sugerencia$/);
  await pulsar(usarSuperior);
  assert.equal(celda(r, "Doble", "Superior").value, "200.000,5");
  assert.equal(celda(r, "Infante", "Superior").value, "0");
  await pulsar(boton(r, "Revisar propuesta"));
  assert.deepEqual(lineasRevision(r), [
    "Semana · Superior / PAM · Doble: sin propuesta → 200.000,5",
    "Semana · Superior / PAM · Infante: sin propuesta → 0 — Infante gratis (0).",
    "Semana · Superior / PAM: se marca como sugerencia aceptada de la tarifa actual",
  ]);
  await pulsar(boton(r, "Confirmar propuesta"));
  let filas = ultimaPropuesta()[4];
  assert.equal(filas[0].netos.neto_doble, 200000.5);
  assert.equal(filas[0].netos.neto_infante, 0);
  assert.equal(filas[0].origen_tarifa_id, 78);
  assert.equal(filas[0].extras, undefined, "las notas/edades de la tarifa actual NO se aceptaron");
  // Aceptación explícita de las notas y edades sugeridas: se ven en la revisión y se envían.
  const r2 = await montar(panel());
  await pulsar(botonesTexto(r2, /^Usar sugerencia$/)[1]);
  await pulsar(botonesTexto(r2, /^Notas y edades/)[1]);
  await pulsar(boton(r2, "Usar notas y edades de la tarifa actual"));
  await pulsar(boton(r2, "Revisar propuesta"));
  const t = lineasRevision(r2).join("\n");
  assert.match(t, /Superior \/ PAM · Notas: vacío → «Origen»/);
  assert.match(t, /Superior \/ PAM · Niño hasta \(edad\): vacío → 12/);
  await pulsar(boton(r2, "Confirmar propuesta"));
  filas = ultimaPropuesta()[4];
  assert.deepEqual(filas[0].extras, { nota_infante: null, notas: "Origen", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12 });
});

const edad = (r: Element, etiqueta: string) => r.querySelector<HTMLInputElement>(`input[aria-label="Estándar PAM ${etiqueta}"]`)!;
async function escribirEdades(r: Element, im: string, iM: string, nm: string, nM: string, partirDeVacio = false) {
  await pulsar(botonesTexto(r, /^Notas y edades/)[0]);
  // La propuesta de ejemplo ya guarda 0–1 / 2–11: para que el caso válido sea un cambio, se parte de vacío.
  if (partirDeVacio) await pulsar(boton(r, "Quitar notas y edades"));
  await escribir(edad(r, "Infante desde (edad)"), im);
  await escribir(edad(r, "Infante hasta (edad)"), iM);
  await escribir(edad(r, "Niño desde (edad)"), nm);
  await escribir(edad(r, "Niño hasta (edad)"), nM);
  await pulsar(boton(r, "Revisar propuesta"));
}

for (const [rango, esperado] of [
  [["2", "3", "4", "10"], "La edad de infante debe comenzar en 0."],
  [["0", "1", "3", "11"], "La edad inicial del niño debe ser 2, porque infante termina en 1."],
  [["0", "3", "4", "2"], "La edad final del niño (2) no puede ser menor que la inicial (4)."],
  [["0", "1", "", "11"], "Las cuatro edades (infante y niño, desde y hasta) van todas o ninguna."],
] as const) {
  test(`edades ${rango.join("/")}: mensaje concreto antes de enviar y cero llamadas de guardado`, async () => {
    const r = await montar(panel());
    await escribirEdades(r, rango[0], rango[1], rango[2], rango[3]);
    const t = r.textContent ?? "";
    assert.ok(t.includes(esperado), t);
    assert.doesNotMatch(t, /hotel_grupo_tarifa_propuesta|edades_rangos|constraint/);
    assert.equal(boton(r, "Confirmar propuesta"), undefined);
    assert.deepEqual(nombres(), ["leerConfigGrupos"]);
  });
}

test("edades 0–1 / 2–11 válidas: se revisan y se envían en un solo guardado", async () => {
  const r = await montar(panel());
  await escribirEdades(r, "0", "1", "2", "11", true);
  await pulsar(boton(r, "Confirmar propuesta"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "guardarPropuestaGrupos"]);
  const ex = ultimaPropuesta()[4][0].extras!;
  assert.deepEqual([ex.edad_infante_min, ex.edad_infante_max, ex.edad_nino_min, ex.edad_nino_max], [0, 1, 2, 11]);
});

test("rechazo de la base: se muestra el mensaje traducido, nunca el nombre técnico", async () => {
  est.respuestas.guardarPropuestaGrupos = { ok: false, error: "Las edades no son válidas: infante empieza en 0, …" };
  const r = await montar(panel());
  await escribirEdades(r, "0", "1", "2", "11", true);
  await pulsar(boton(r, "Confirmar propuesta"));
  assert.match(r.textContent ?? "", /Las edades no son válidas/);
  assert.equal(nombres().filter((n) => n === "guardarPropuestaGrupos").length, 1, "sin reintento");
});

test("borrado intencional de notas y edades: «(se borra)» en la revisión y null en el payload", async () => {
  const r = await montar(panel());
  await pulsar(botonesTexto(r, /^Notas y edades/)[0]);
  assert.equal(r.querySelector<HTMLInputElement>('input[aria-label="Estándar PAM Notas"]')!.value, "Vista al mar");
  await pulsar(boton(r, "Quitar notas y edades"));
  await pulsar(boton(r, "Revisar propuesta"));
  const t = lineasRevision(r).join("\n");
  assert.match(t, /Notas: «Vista al mar» → vacío \(se borra\)/);
  assert.match(t, /Infante desde \(edad\): 0 → vacío \(se borra\)/);
  assert.doesNotMatch(t, /Doble/, "los netos no cambian");
  await pulsar(boton(r, "Confirmar propuesta"));
  const f = ultimaPropuesta()[4][0];
  assert.deepEqual(f.extras, EV);
  assert.equal(f.netos.neto_doble, 123.45);
});

test("celdas a vacío o a cero: la revisión dice el efecto según habitación, niño o infante", async () => {
  const r = await montar(panel());
  await escribir(celda(r, "Doble"), "");
  await escribir(celda(r, "Sencilla"), "0");
  await escribir(celda(r, "Niño 1"), "");
  await escribir(celda(r, "Triple"), "1");
  await pulsar(boton(r, "Revisar propuesta"));
  const t = lineasRevision(r).join("\n");
  assert.match(t, /Doble: 123,45 → vacío — Sin precio: esta habitación no se venderá con este grupo\./);
  assert.match(t, /Sencilla: 150\.000 → 0 — 0 en habitación significa «no aplica»: no se venderá\./);
  assert.match(t, /Niño 1: 0 → vacío — Sin tarifa de niño: no se venderá con niños de esta edad\./);
});

test("reemplazar el grupo: detalla lo eliminado y reescribe la fila con sus notas/edades e importes intactos", async () => {
  const r = await montar(panel());
  await pulsar(botonesTexto(r, /^Usar sugerencia$/)[1]);
  await pulsar(r.querySelector<HTMLInputElement>('input[type=radio][name="modo-10"]:not(:checked)')!); // reemplazar_grupo
  await pulsar(boton(r, "Revisar propuesta"));
  assert.match(r.textContent ?? "", /1 se reescribe\(n\) sin cambios/);
  await pulsar(boton(r, "Confirmar propuesta"));
  const [, , modo, grupo, filas] = ultimaPropuesta();
  assert.equal(modo, "reemplazar_grupo"); assert.equal(grupo, G1);
  const est_ = filas.find((f) => f.tipo_habitacion === "Estándar")!;
  assert.deepEqual(est_.netos, { ...NV, neto_doble: 123.45, neto_sencilla: 150000, neto_nino: 0 });
  assert.deepEqual(est_.extras, EXTRAS, "un reemplazo reescribe la fila completa con lo guardado");
  // Lo que no se trae se detalla como eliminado.
  const r2 = await montar(panel());
  for (const a of ["Doble", "Sencilla", "Niño 1"]) await escribir(celda(r2, a), "");
  await pulsar(r2.querySelectorAll<HTMLInputElement>('input[type=radio][name="modo-10"]')[2]); // reemplazar_vigencia
  await pulsar(boton(r2, "Revisar propuesta"));
  assert.deepEqual(lineasRevision(r2), ["Se elimina la propuesta Semana · Estándar / PAM (antes: Sencilla 150.000, Doble 123,45, Niño 1 0) y sus notas/edades."]);
  await pulsar(boton(r2, "Confirmar propuesta"));
  assert.deepEqual(ultimaPropuesta()[4], [], "nada que insertar: el reemplazo elimina la fila");
});

test("mensajes por celda: habitación sin precio, niño nulo, niño en 0, infante sin tarifa", async () => {
  const r = await montar(panel());
  assert.match(celda(r, "Triple").title, /no se venderá/);
  assert.match(celda(r, "Niño 2").title, /no se venderá con niños/);
  assert.match(celda(r, "Niño 1").title, /gratis/);
  assert.match(celda(r, "Infante").title, /viaja gratis/);
});

test("confirmación obsoleta: aviso y Recargar, sin reintento automático", async () => {
  est.respuestas.guardarPropuestaGrupos = { ok: false, desactualizada: true, error: "La configuración cambió…" };
  const r = await montar(panel());
  await escribir(celda(r, "Triple"), "1");
  await pulsar(boton(r, "Revisar propuesta"));
  await pulsar(boton(r, "Confirmar propuesta"));
  assert.match(r.querySelector("[role=alert]")?.textContent ?? "", /Recarga y revisa/);
  assert.deepEqual(nombres(), ["leerConfigGrupos", "guardarPropuestaGrupos"], "no se reintenta solo");
  await pulsar([...r.querySelectorAll("button")].find((b) => /Recargar/.test(b.textContent ?? ""))!);
  assert.deepEqual(nombres(), ["leerConfigGrupos", "guardarPropuestaGrupos", "leerConfigGrupos"], "recargar es una acción explícita");
});

test("editar después de revisar cierra la revisión: no se confirma una vista previa vieja", async () => {
  const r = await montar(panel());
  await escribir(celda(r, "Triple"), "1");
  await pulsar(boton(r, "Revisar propuesta"));
  await escribir(celda(r, "Triple"), "2");
  assert.equal(boton(r, "Confirmar propuesta"), undefined);
});

test("borrar un grupo: vista previa concreta con sus propuestas y una sola llamada", async () => {
  const r = await montar(panel());
  await pulsar([...r.querySelectorAll("button")].find((b) => /Borrar grupo/.test(b.textContent ?? ""))!);
  assert.match(r.textContent ?? "", /Estándar \/ PAM: Sencilla 150\.000, Doble 123,45, Niño 1 0 \(con notas\/edades\)/);
  assert.match(r.textContent ?? "", /No se borran ni se modifican promociones, tarifas vigentes/);
  assert.deepEqual(nombres(), ["leerConfigGrupos"]);
  await pulsar(boton(r, "Confirmar borrado"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "borrarGrupoDias"]);
  assert.deepEqual(est.llamadas[1][1], [G1, "H1", []], "sin bases guardadas: lista vacía");
});

test("borrar un grupo con bases de calculadora: se ven en la vista previa y se envían sus versiones", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: { ...CFG, bases: [{ grupo_id: G1, tipo: "dubai", version: 3, categorias: 1 }] } };
  const r = await montar(panel());
  await pulsar([...r.querySelectorAll("button")].find((b) => /Borrar grupo/.test(b.textContent ?? ""))!);
  assert.match(r.textContent ?? "", /También se borran sus bases de calculadora .*Dubai \(1 base, versión 3\)/);
  await pulsar(boton(r, "Confirmar borrado"));
  assert.deepEqual(est.llamadas[1], ["borrarGrupoDias", [G1, "H1", [{ tipo: "dubai", version: 3 }]]]);
});

test("días ocupados por otro grupo quedan deshabilitados", async () => {
  const r = await montar(panel());
  await pulsar(boton(r, "Agregar grupo"));
  const nuevo = r.querySelectorAll('[role=group]')[1];
  const lunes = [...nuevo.querySelectorAll("button")].find((b) => b.textContent === "L")!;
  assert.equal(lunes.disabled, true);
});

// ── Integración en la ficha del hotel ──
const T = (over: Record<string, unknown>) => ({ fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", min_noches: 1, ...over });
const ficha = (over: Record<string, unknown> = {}) => h(HotelDetalleClient, {
  hotelId: 5, categorias: ["Estándar"], regimenes: ["PAM"], tarifas: [], otrosHoteles: [], pestanaInicial: "temporadas",
  temporadas: [T({ id: 1, nombre: "ALTA", hotel_temporada_grupos: [{ id: G1, nombre: "Semana", dias: [1, 2, 3, 4], activo: false }] }),
    T({ id: 2, nombre: "PROMO", tipo: "descuento_pct", descuento_valor: 10 }), T({ id: 3, nombre: "DUP" }), T({ id: 4, nombre: "DUP" })],
  configuracion: null, calculadora: null, tarifasExtra: null, ...over,
} as never);
const botonesGrupos = (r: Element) => [...r.querySelectorAll("button")].filter((b) => /Grupos de días/.test(b.textContent ?? ""));

test("ficha: botón solo en vigencias de tarifa, deshabilitado si el nombre se repite; etiqueta «preparado»; sin solicitudes al mostrar", async () => {
  const r = await montar(ficha());
  const bs = botonesGrupos(r);
  assert.equal(bs.length, 3, "ALTA y las dos DUP; la promoción no");
  assert.equal(bs.filter((b) => b.disabled).length, 2, "las dos vigencias DUP");
  assert.match(r.textContent ?? "", /Semana L M X J · preparado/);
  assert.equal(est.llamadas.length, 0, "mostrar la ficha no llama a la base");
  await pulsar(bs[0]);
  assert.deepEqual(nombres(), ["leerConfigGrupos"]);
});

test("ficha de hotel por unidad: sin controles de grupos", async () => {
  const r = await montar(ficha({ mostrarTarifaPersona: false }));
  assert.equal(botonesGrupos(r).length, 0);
});
