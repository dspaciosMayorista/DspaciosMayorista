// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/calculadoraGrupos297.react.ts
// #43/#60 entrega 3b — calculadora por grupo de días con el CalculadoraEditor REAL y las acciones sustituidas:
// elegir el grupo y editar = 0 solicitudes; revisar = 1; confirmar = 1; nada preseleccionado; generales de solo
// lectura; promociones fuera; hotel sin grupos igual que siempre; confirmación obsoleta sin reintento.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__c297r";
const reg = (n: string) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return ${G}.resp('${n}', a); }`;
const GRUPOS = datos(["leerConfigGrupos", "guardarGruposVigencia", "guardarPropuestaGrupos", "borrarGrupoDias", "guardarCalculoGrupo"].map(reg).join("\n"));
const HOTEL = datos(["guardarCalculadora", "generarTarifasCalculadora", "sustituirPromoManualMixta"].map(reg).join("\n"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./grupos-actions" && padre.endsWith("/CalculoGrupoPanel.tsx")) return { url: GRUPOS, shortCircuit: true };
    if (specifier === "../actions" && padre.endsWith("/CalculadoraEditor.tsx")) return { url: HOTEL, shortCircuit: true };
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
const DUBAI = {
  regimen_base: "PAM", modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
  suplementos: [{ regimen: "PC", monto: 45000 }], bases: [{ categoria: "Estándar", temporada: "ALTA", precio: 100000 }],
  promos: [{ temporadaBase: "ALTA", temporadaPromo: "BAJA", regimen: "PAM", descuentoPct: 10 }], infante_nota: "",
};
// Bases del grupo guardadas: Estándar con edades y condición propias.
const BASES = [{ categoria: "Estándar", precio: 120000, usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 1, ninoMin: 2, ninoMax: 11 }, condicionesPropias: "Fin de semana" }];
const CFG = {
  vigencia: { id: 10, nombre: "ALTA", hotel_id: 5, tipo: "tarifa", nombre_repetido: false }, hotel: { id: 5, modelo_tarifario: "persona" },
  categorias: ["Estándar"], regimenes: ["PAM", "PC"],
  grupos: [{ id: G1, nombre: "Fin de semana", dias: [5, 6, 7], activo: false }],
  // Propuesta guardada de Estándar/PAM: triple y niño SIN venta; notas y edades propias.
  propuestas: [{ id: 1, grupo_id: G1, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NV, neto_sencilla: 150000, neto_doble: 100000, neto_multiple: 90000, neto_infante: 0,
    nota_infante: null, notas: "Vista al mar", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, origen_tarifa_id: null }],
  origen: [], promociones: [], huella: "H1",
};
const est = {
  llamadas: [] as [string, unknown[]][],
  respuestas: {} as Record<string, unknown>,
  resp: (n: string): unknown => est.respuestas[n] ?? (n === "leerConfigGrupos" ? { ok: true, config: CFG }
    : n === "guardarCalculoGrupo" ? { ok: true, config: CFG, nuevas: 0, actualizadas: 1, basesVersion: 4 }
    : n === "guardarCalculadora" ? { ok: true, version: 8 } : { ok: true }),
};
(globalThis as unknown as { __c297r: typeof est }).__c297r = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalculadoraEditor } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx");
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
async function elegir(sel: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const boton = (r: Element, t: string | RegExp) => [...r.querySelectorAll("button")].find((b) => (typeof t === "string" ? (b.textContent ?? "").trim() === t : t.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const botones = (r: Element, re: RegExp) => [...r.querySelectorAll("button")].filter((b) => re.test(b.textContent ?? ""));
const nombres = () => est.llamadas.map((l) => l[0]);
const editor = (over: Record<string, unknown> = {}) => h(CalculadoraEditor, {
  hotelId: 5, categorias: ["Estándar"], temporadas: ["ALTA", "BAJA"], regimenes: ["PAM", "PC"], tipoInicial: "dubai",
  dubaiInicial: DUBAI, mixtaInicial: null, corporativaInicial: null, vigencias: [], hoy: "2026-11-11", tarifasExistentes: [],
  versionInicial: 7, gruposCalc: [{ temporadaId: 10, vigencia: "ALTA", grupos: [{ id: G1, nombre: "Fin de semana", dias: [5, 6, 7], bases: [{ tipo: "dubai", bases: BASES, version: 3 }] }] }],
  ...over,
} as never);
async function abrirGrupo(over: Record<string, unknown> = {}) {
  const r = await montar(editor(over));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await elegir(r.querySelector<HTMLSelectElement>("#calc-destino-5")!, `10|${G1}`);
  return r;
}
const panel = (r: Element) => r.querySelector('section[aria-label^="Cálculo del grupo"]')!;
// El fieldset de los parámetros generales de la fórmula (no el de la elección «hotel / propios»).
const generales = (r: Element) => [...r.querySelectorAll("fieldset")].find((f) => f.getAttribute("aria-label") !== "Parámetros de la fórmula del grupo")!;
const baseGrupo = (r: Element) => panel(r).parentElement!.querySelector<HTMLInputElement>('td[data-label="ALTA"] input')!;

test("hotel sin grupos: la calculadora se ve y funciona como siempre (sin selector de grupo, cero solicitudes)", async () => {
  const r = await montar(editor({ gruposCalc: [] }));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  assert.equal(r.querySelector("#calc-destino-5"), null);
  assert.ok(boton(r, "Generar (agregar/actualizar)") && boton(r, "+ Agregar promoción"));
  assert.deepEqual(nombres(), []);
});

test("guardar la calculadora envía la versión leída y adopta la nueva (sin reintento)", async () => {
  const r = await montar(editor({ gruposCalc: [] }));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await pulsar(boton(r, "Guardar calculadora")!);
  await pulsar(boton(r, "Guardar calculadora")!);
  const g = est.llamadas.filter((l) => l[0] === "guardarCalculadora");
  assert.deepEqual(g.map((l) => l[1][3]), [7, 8], "la segunda usa la versión que devolvió la primera");
});

test("elegir el grupo: 0 solicitudes; generales de solo lectura; bases del grupo cargadas; sin promociones ni «Generar»", async () => {
  const r = await abrirGrupo();
  assert.deepEqual(nombres(), []);
  const fieldset = generales(r);
  assert.equal(fieldset.disabled, true, "modificadores, suplementos y régimen base: solo lectura");
  assert.equal(baseGrupo(r).disabled, false);
  assert.equal(baseGrupo(r).value, "120000", "la base guardada del grupo, no la de «todos los días»");
  assert.equal(r.querySelector<HTMLSelectElement>("select")!.disabled, true, "el tipo de calculadora no cambia en modo grupo");
  assert.equal(boton(panel(r).parentElement!, "+ Agregar promoción"), undefined);
  assert.equal(boton(panel(r).parentElement!, "Generar (agregar/actualizar)"), undefined);
  assert.match(panel(r).textContent ?? "", /promociones por grupo llegan en una entrega posterior/);
  assert.match(panel(r).textContent ?? "", /Estándar \/ PAM/, "vista previa del cálculo en memoria");
});

test("editar las bases: 0 solicitudes; la vista previa usa las mismas fórmulas", async () => {
  const r = await abrirGrupo();
  await escribir(baseGrupo(r), "130000");
  assert.deepEqual(nombres(), []);
  assert.match(panel(r).textContent ?? "", /195\.000/, "sencilla = base × 1,5 con la base nueva");
});

test("revisar = 1 lectura; edades, condición y habilitaciones pendientes, NADA preseleccionado: no se puede confirmar", async () => {
  const r = await abrirGrupo();
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  assert.deepEqual(nombres(), ["leerConfigGrupos"]);
  assert.deepEqual(est.llamadas[0][1], [10]);
  const t = panel(r).textContent ?? "";
  assert.match(t, /Edades: infante 0–2 · niño 3–12 → infante 0–1 · niño 2–11/);
  assert.match(t, /Condición \(notas\): Vista al mar → Fin de semana/);
  assert.match(t, /Triple: hoy sin precio \(no se vende\)/);
  const opciones = botones(panel(r), /Mantener sin venta|Habilitar a/);
  assert.ok(opciones.length >= 4 && opciones.every((b) => b.getAttribute("aria-pressed") === "false"), "ninguna opción preseleccionada");
  assert.equal(boton(panel(r), "Confirmar propuesta y bases del grupo")!.disabled, true);
});

test("resolver explícitamente y confirmar = 1 RPC con SOLO el grupo, lo revisado y las versiones leídas", async () => {
  const r = await abrirGrupo();
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  await pulsar(boton(panel(r), "Mantener todas sin venta")!);
  for (const b of botones(panel(r), /Aplicar edades del cálculo|Aplicar condición del cálculo/)) await pulsar(b);
  const conf = boton(panel(r), "Confirmar propuesta y bases del grupo")!;
  assert.equal(conf.disabled, false, panel(r).textContent ?? "");
  await pulsar(conf);
  assert.deepEqual(nombres(), ["leerConfigGrupos", "guardarCalculoGrupo"]);
  const [temporada, huella, grupo, tipo, calcVersion, basesVersion, bases, generalesEnviados, filas] = est.llamadas[1][1] as [number, string, string, string, number, number, unknown, unknown, { grupo_id: string; alimentacion: string; netos: Record<string, number | null>; extras?: Record<string, unknown>; origen_tarifa_id: null }[]];
  assert.deepEqual([temporada, huella, grupo, tipo, calcVersion, basesVersion], [10, "H1", G1, "dubai", 7, 3]);
  assert.equal(generalesEnviados, null, "con «usar los generales del hotel» viajan como null");
  assert.deepEqual(bases, BASES);
  assert.deepEqual(filas.map((f) => f.alimentacion), ["PAM"], "PC no tiene ninguna habitación a la venta (todas sin venta): no se envía");
  const f = filas[0];
  assert.ok(filas.every((x) => x.grupo_id === G1 && x.origen_tarifa_id === null));
  assert.equal(f.netos.neto_triple, null, "mantener sin venta");
  assert.equal(f.netos.neto_nino, null);
  assert.equal(f.netos.neto_doble, 120000);
  assert.deepEqual([f.extras?.notas, f.extras?.edad_infante_max, f.extras?.edad_nino_max], ["Fin de semana", 1, 11]);
  assert.deepEqual(payloadFilas(filas as never)[0].neto_triple, null);
  assert.match(panel(r).textContent ?? "", /Propuesta del grupo, sus bases y sus parámetros guardados/);
});

test("editar después de revisar cierra la revisión (no se confirma una vista vieja)", async () => {
  const r = await abrirGrupo();
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  await escribir(baseGrupo(r), "125000");
  assert.equal(boton(panel(r), "Confirmar propuesta y bases del grupo"), undefined);
  assert.match(panel(r).textContent ?? "", /vuelve a revisar/);
});

test("confirmación obsoleta: mensaje de qué cambió, «Recargar» explícito y SIN reintento", async () => {
  est.respuestas.guardarCalculoGrupo = { ok: false, desactualizada: true, error: "la calculadora del hotel cambió desde que la abriste. Recarga y revisa de nuevo." };
  const r = await abrirGrupo();
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  await pulsar(boton(panel(r), "Mantener todas sin venta")!);
  for (const b of botones(panel(r), /Aplicar edades del cálculo|Aplicar condición del cálculo/)) await pulsar(b);
  await pulsar(boton(panel(r), "Confirmar propuesta y bases del grupo")!);
  assert.match(panel(r).textContent ?? "", /la calculadora del hotel cambió/);
  assert.ok(boton(panel(r), "Recargar"));
  assert.equal(nombres().filter((n) => n === "guardarCalculoGrupo").length, 1);
});

test("sin calculadora guardada o en otro tipo: no se puede calcular por grupo", async () => {
  const r = await montar(editor({ tipoInicial: null, dubaiInicial: null, versionInicial: null }));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  assert.equal(r.querySelector<HTMLSelectElement>("#calc-destino-5")!.disabled, true);
  assert.match(r.textContent ?? "", /Guarda primero la calculadora/);
  const r2 = await montar(editor());
  await pulsar(boton(r2, /Tarifa por fórmula/)!);
  await elegir(r2.querySelector<HTMLSelectElement>("select")!, "mixta");
  assert.equal(r2.querySelector<HTMLSelectElement>("#calc-destino-5")!.disabled, true);
  assert.match(r2.textContent ?? "", /bases guardadas con otra calculadora: se conservan/);
  assert.deepEqual(nombres(), []);
});

test("StrictMode, renders repetidos, reposo y desmontaje: las solicitudes cesan (solo las de los clics)", async () => {
  const r = await montar(h(React.StrictMode, null, editor()));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await elegir(r.querySelector<HTMLSelectElement>("#calc-destino-5")!, `10|${G1}`);
  for (const v of ["121000", "122000", "123000"]) await escribir(baseGrupo(r), v);
  assert.deepEqual(nombres(), [], "montar (doble en StrictMode), elegir y editar: 0");
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  await React.act(async () => { await new Promise((res) => setTimeout(res, 300)); });
  assert.deepEqual(nombres(), ["leerConfigGrupos"], "una lectura por clic; nada en reposo");
  await desmontar?.(); desmontar = undefined;
  await new Promise((res) => setTimeout(res, 300));
  assert.deepEqual(nombres(), ["leerConfigGrupos"], "tras desmontar, ninguna solicitud");
});

test("compra cerrada (regla de «Generar»): el grupo no se puede elegir y, aun forzado, ni se calcula ni se guarda", async () => {
  const vigencias = [{ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1, compra_inicio: "2020-01-01", compra_fin: "2020-12-31", tipo: "tarifa" }];
  const r = await montar(editor({ vigencias }));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  const sel = r.querySelector<HTMLSelectElement>("#calc-destino-5")!;
  const op = [...sel.options].find((o) => o.value === `10|${G1}`)!;
  assert.equal(op.disabled, true);
  assert.match(op.textContent ?? "", /compra cerrada: no se calcula/);
  await elegir(sel, `10|${G1}`);   // forzado (p. ej. la compra cerró con la pantalla abierta)
  const t = panel(r).textContent ?? "";
  assert.match(t, /tiene la compra cerrada: no se calcula ni se guarda por grupo/);
  assert.equal(boton(panel(r), "Revisar propuesta del grupo"), undefined);
  assert.equal(boton(panel(r), "Confirmar propuesta y bases del grupo"), undefined);
  assert.doesNotMatch(t, /Estándar \/ PAM/, "sin vista previa del cálculo");
  assert.deepEqual(nombres(), []);
});

// ── Parámetros de la fórmula por grupo (298): Semana y Finde ─────────────────────────────
const G2 = "00000000-0000-4000-8000-0000000000a2";
const DUBAI_FULL = { ...DUBAI, suplementos: [{ regimen: "PC", monto: 45000 }, { regimen: "FULL", monto: 100000 }] };
const FINDE_GEN = { regimen_base: "PAM", modificadores: { sencilla_pct: 40, pax3_pct: -10, pax4_pct: -10, nino_pct: -30, infante_pct: -100 },
  suplementos: [{ regimen: "PC", monto: 50000 }, { regimen: "FULL", monto: 120000 }], infante_nota: "" };
const BASE_SIMPLE = [{ categoria: "Estándar", precio: 100000 }];
const editorFull = () => editor({
  regimenes: ["PAM", "PC", "FULL"], dubaiInicial: DUBAI_FULL,
  gruposCalc: [{ temporadaId: 10, vigencia: "ALTA", grupos: [
    { id: G1, nombre: "Semana", dias: [1, 2, 3, 4], bases: [{ tipo: "dubai", bases: BASE_SIMPLE, version: 1, generales: null }] },   // guardada con la 297
    { id: G2, nombre: "Finde", dias: [5, 6, 7], bases: [{ tipo: "dubai", bases: BASE_SIMPLE, version: 2, generales: FINDE_GEN }] },
  ] }],
});
const bloque = (r: Element) => panel(r).parentElement!.parentElement!;
const campo = (r: Element, etiqueta: string) =>
  [...bloque(r).querySelectorAll("label")].find((l) => (l.textContent ?? "").trim() === etiqueta)!.parentElement!.querySelector("input")!;
const opcion = (r: Element, re: RegExp) => [...bloque(r).querySelectorAll("label")].find((l) => re.test(l.textContent ?? ""))!.querySelector("input")!;
async function abrir(r: Element, g: string) { await elegir(r.querySelector<HTMLSelectElement>("#calc-destino-5")!, `10|${g}`); }

test("Semana (bases de la 297, sin parámetros propios): usa los del hotel, bloqueados y visibles como referencia", async () => {
  const r = await montar(editorFull());
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await abrir(r, G1);
  assert.equal(opcion(r, /Usar los generales del hotel/).checked, true);
  assert.equal(generales(r).disabled, true);
  assert.equal(campo(r, "Sencilla").value, "50");
  assert.match(bloque(r).querySelector('[data-referencia="generales"]')!.textContent ?? "", /Suplemento FULL: 100\.000/);
  assert.deepEqual(nombres(), []);
});

test("Semana con valores propios: se habilitan, conservan las bases escritas, se calculan y viajan explícitos al confirmar", async () => {
  const r = await montar(editorFull());
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await abrir(r, G1);
  await escribir(baseGrupo(r), "110000");
  await pulsar(opcion(r, /Valores propios de este grupo/));
  assert.equal(generales(r).disabled, false);
  assert.equal(baseGrupo(r).value, "110000", "cambiar de opción no pierde la base escrita");
  assert.equal(campo(r, "Sencilla").value, "50", "arranca con una copia de los del hotel");
  await escribir(campo(r, "Sencilla"), "60");
  await escribir(campo(r, "Suplemento FULL (por pax)"), "80000");
  assert.deepEqual(nombres(), [], "editar: 0 solicitudes");
  assert.match(panel(r).textContent ?? "", /Estándar \/ FULL[\s\S]*190\.000/, "FULL doble = 110.000 + 80.000 (suplemento propio)");
  est.respuestas.leerConfigGrupos = { ok: true, config: { ...CFG, regimenes: ["FULL", "PAM", "PC"], propuestas: [] } };
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  const lineas = [...panel(r).querySelectorAll('[data-revision="generales"] li')].map((li) => li.textContent);
  assert.ok(lineas.includes("Sencilla %: 50 → 60") && lineas.includes("Suplemento FULL: 100.000 → 80.000"), lineas.join(" | "));
  assert.ok(lineas.some((l) => /los generales del hotel → propios del grupo/.test(l ?? "")));
  await pulsar(boton(panel(r), "Habilitar todas")!);
  for (const b of botones(panel(r), /Aplicar edades del cálculo|Aplicar condición del cálculo/)) await pulsar(b);
  await pulsar(boton(panel(r), "Confirmar propuesta y bases del grupo")!);
  assert.deepEqual(nombres(), ["leerConfigGrupos", "guardarCalculoGrupo"]);
  const enviados = est.llamadas[1][1][7] as { modificadores: { sencilla_pct: number }; suplementos: { regimen: string; monto: number }[] };
  assert.equal(enviados.modificadores.sencilla_pct, 60);
  assert.deepEqual(enviados.suplementos.find((s) => s.regimen === "FULL"), { regimen: "FULL", monto: 80000 });
  assert.equal("promos" in enviados, false, "nunca viaja una promoción");
  assert.equal(est.llamadas[1][1][2], G1, "solo Semana");
});

test("Finde reabre con SUS parámetros guardados; lo editado en Semana no se filtra a Finde", async () => {
  const r = await montar(editorFull());
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await abrir(r, G1);
  await pulsar(opcion(r, /Valores propios de este grupo/));
  await escribir(campo(r, "Sencilla"), "65");
  await abrir(r, G2);
  assert.equal(opcion(r, /Valores propios de este grupo/).checked, true, "Finde guardó parámetros propios");
  assert.equal(campo(r, "Sencilla").value, "40");
  assert.equal(campo(r, "Suplemento FULL (por pax)").value, "120000");
  assert.match(panel(r).textContent ?? "", /Estándar \/ FULL[\s\S]*220\.000/, "FULL doble = 100.000 + 120.000");
  await abrir(r, G1);
  // Lo no guardado se descarta al cambiar de grupo (como las bases): Semana vuelve con SU elección (propios) y
  // su copia de los del hotel, nunca con los valores de Finde.
  assert.equal(opcion(r, /Valores propios de este grupo/).checked, true);
  assert.equal(campo(r, "Sencilla").value, "50", "ni los 40 de Finde ni un valor ajeno");
  assert.deepEqual(nombres(), []);
});

test("volver a «usar los generales del hotel»: vuelven los del hotel (bloqueados) y viajan como null", async () => {
  const r = await montar(editorFull());
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  await abrir(r, G2);
  await pulsar(opcion(r, /Usar los generales del hotel/));
  assert.equal(generales(r).disabled, true);
  assert.equal(campo(r, "Sencilla").value, "50");
  est.respuestas.leerConfigGrupos = { ok: true, config: { ...CFG, regimenes: ["FULL", "PAM", "PC"], propuestas: [] } };
  await pulsar(boton(panel(r), "Revisar propuesta del grupo")!);
  assert.ok([...panel(r).querySelectorAll('[data-revision="generales"] li')].some((li) => /propios → los generales del hotel/.test(li.textContent ?? "")));
  await pulsar(boton(panel(r), "Habilitar todas")!);
  for (const b of botones(panel(r), /Aplicar edades del cálculo|Aplicar condición del cálculo/)) await pulsar(b);
  await pulsar(boton(panel(r), "Confirmar propuesta y bases del grupo")!);
  assert.equal(est.llamadas.at(-1)![1][7], null);
});
