// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/destinosAereosEditor67.react.ts
//
// #67 — editor de paquetes con destinos aéreos alternativos, componentes REALES:
//   · page.tsx del paquete (server component): qué vuelos y empaquetados ofrece
//     según el check (OFF = destino comercial exacto; ON = comercial + alternativas
//     del mismo país), sin tocar hoteles/servicios, sin "todos los vuelos" de
//     respaldo y con error de lectura distinto de "no hay vuelos".
//   · ConfigForm: check + selección múltiple de candidatos que entrega el servidor;
//     envía los IDs al guardar; solo en Bloqueo; muestra el rechazo del servidor.
//   · ArmadoClient: etiqueta del destino aéreo (nombre + IATA, sin traslado),
//     rechazos de vinculación visibles (simple y "Seleccionar todos").
// Los límites del servidor (acciones y Supabase) se sustituyen por dobles; las
// reglas de negocio de los servidores se prueban en destinosAereosFlujos67.test.ts.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { crearBd, tablasBase, JOINS_ARMADO, D, PAQUETE_ID, type Fila, type Tablas } from "./destinosAereos67Soporte.ts";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__d67";

const ACCIONES_PAQUETES = datos(`
  const reg = (n, a) => ${G}.llamadas.push([n, a]);
  export async function crearPaquete(...a) { reg('crearPaquete', a); return ${G}.respGuardar(a); }
  export async function actualizarPaquete(...a) { reg('actualizarPaquete', a); return ${G}.respGuardar(a); }
  export async function listarDestinosAereosCandidatos(...a) { reg('candidatos', a); return ${G}.respCandidatos(a); }
  export async function setVuelo(...a) { reg('setVuelo', a); return ${G}.respVinculo(a); }
  export async function setTodosVuelos(...a) { reg('setTodosVuelos', a); return ${G}.respVinculo(a); }
  export async function setHotel() { return { ok: true }; }
  export async function setTodosHoteles() { return { ok: true }; }
  export async function setServicio() { return { ok: true }; }
  export async function setServicios() { return { ok: true, procesados: 0 }; }
  export async function generarTarifario() { return { ok: true, id: 0 }; }
  export async function continuarPublicacionTarifario() { return { ok: true }; }
  export async function estadoPublicacionTarifario() { return { ok: true }; }
  export async function getTarifasHotel() { return { ok: true, tarifas: [], unidades: [] }; }
  export async function setHotelFiltros() { return { ok: true }; }
  export async function setHotelPrioridad() { return { ok: true }; }
`);
const ACCIONES_SALIDAS = datos(`
  export async function crearSalidaDinamica() { return { ok: true }; }
  export async function actualizarSalidaDinamica() { return { ok: true }; }
  export async function eliminarSalidaDinamica() { return { ok: true }; }
  // #63 (227): el editor de salidas importa también las acciones de las salidas vinculadas. Solo la FORMA del doble.
  export async function listarEmpaquetadosParaSalidas63() { return { ok: true, candidatos: [], pendientes: 0 }; }
  export async function vincularSalidasEmpaquetados63() { return { ok: true }; }
  export async function actualizarSalidaDesdeFuente63() { return { ok: true }; }
  export async function desvincularSalidasEmpaquetados63() { return { ok: true, procesados: 0 }; }
`);
const ACCIONES_EMPAQUETADOS = datos(`
  export async function setEmpaquetado(...a) { ${G}.llamadas.push(['setEmpaquetado', a]); return ${G}.respVinculo(a); }
  export async function setTodosEmpaquetados(...a) { ${G}.llamadas.push(['setTodosEmpaquetados', a]); return ${G}.respVinculo(a); }
`);
const NAVEGACION = datos(`
  export function useRouter() { return { push(u) { ${G}.navegaciones.push(u); }, refresh() { ${G}.refrescos++; }, replace() {} }; }
  export function notFound() { throw new Error('NEXT_NOT_FOUND'); }
`);
const SUPABASE_SERVER = datos(`export async function createClient() { return ${G}.sb; }`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./actions" && padre.endsWith("/paquetes/ConfigForm.tsx")) return { url: ACCIONES_PAQUETES, shortCircuit: true };
    if (specifier === "../actions" && padre.endsWith("/ArmadoClient.tsx")) return { url: ACCIONES_PAQUETES, shortCircuit: true };
    if (specifier === "../actions" && padre.endsWith("/SalidasDinamicasEditor.tsx")) return { url: ACCIONES_SALIDAS, shortCircuit: true };
    if (specifier === "../../vuelos/empaquetados-actions" && padre.endsWith("/ArmadoClient.tsx")) return { url: ACCIONES_EMPAQUETADOS, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/dashboard/paquetes/")) {
      return { url: NAVEGACION, shortCircuit: true };
    }
    // Ningún módulo de esta prueba debe cargar el cliente real (next/headers): todos reciben el doble.
    if (specifier === "@/lib/supabase/server") return { url: SUPABASE_SERVER, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/paquetes/1" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const d67 = {
  sb: null as unknown,
  llamadas: [] as [string, unknown[]][],
  navegaciones: [] as string[],
  refrescos: 0,
  respGuardar: (a: unknown[]): unknown => { void a; return { ok: true, id: PAQUETE_ID }; },
  respVinculo: (a: unknown[]): unknown => { void a; return { ok: true }; },
  respCandidatos: (a: unknown[]): unknown => { void a; return CANDIDATOS_RD; },
};
(globalThis as unknown as { __d67: typeof d67 }).__d67 = d67;
const CANDIDATOS_RD = {
  ok: true, motivo: null,
  candidatos: [
    { id: D.PUNTA_CANA, nombre: "PUNTA CANA", codigo_iata: "PUJ" },
    { id: D.SAMANA, nombre: "SAMANA", codigo_iata: "AZS" },
    { id: D.SANTO_DOMINGO, nombre: "SANTO DOMINGO", codigo_iata: "SDQ" },
  ],
};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigForm } = await import("../app/(dashboard)/dashboard/paquetes/ConfigForm.tsx");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const PaginaPaquete = (await import("../app/(dashboard)/dashboard/paquetes/[id]/page.tsx")).default;
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  d67.llamadas.length = 0; d67.navegaciones.length = 0; d67.refrescos = 0; d67.sb = null;
  d67.respGuardar = () => ({ ok: true, id: PAQUETE_ID });
  d67.respVinculo = () => ({ ok: true });
  d67.respCandidatos = () => CANDIDATOS_RD;
});
after(() => dom.window.close());

async function montar(elemento: unknown) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(elemento as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
const esperar = async () => { await React.act(async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); }); };
const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? ""));
// #101: el editor ahora tiene pestañas; los vuelos viven en la pestaña "Vuelos".
const abrirPestana = async (raiz: Element, nombre: string) => {
  const pestana = [...raiz.querySelectorAll("[role=tab]")].find((b) => (b.textContent ?? "").trim() === nombre);
  assert.ok(pestana, `debe existir la pestaña ${nombre}`);
  await pulsar(pestana);
};
const casillaAerea = (raiz: Element) => raiz.querySelector<HTMLInputElement>('[aria-label="Permitir vuelos a otros destinos del mismo país"]');
const casillasCandidatos = (raiz: Element) => [...(raiz.querySelector('[data-testid="destinos-aereos"]')?.querySelectorAll<HTMLInputElement>("li input[type=checkbox]") ?? [])];
const etiquetas = (raiz: Element) => [...(raiz.querySelector('[data-testid="destinos-aereos"]')?.querySelectorAll("li label") ?? [])].map((l) => (l.textContent ?? "").trim());

// ═══ page.tsx: qué vuelos se ofrecen ══════════════════════════════════════
function tablasPagina(o: Parameters<typeof tablasBase>[0] = {}, extra: Tablas = {}): Tablas {
  const t = tablasBase(o);
  t.bloqueos_vuelo = [
    ...t.bloqueos_vuelo,
    { id: 204, destino_id: D.SANTO_DOMINGO, record: "R204", ruta: "BOG-SDQ", aerolinea: "AV", fecha_ida: "2027-03-01", fecha_regreso: "2027-03-05", tarifa_para_empaquetar: 1 }, // fuera del rango de viaje
  ];
  t.empaquetados = [
    ...t.empaquetados,
    { id: 1203, destino_id: D.SANTO_DOMINGO, record: "R1203", ruta: "BOG-SDQ", aerolinea: "AV", fecha_ida: "2026-12-12", fecha_regreso: "2026-12-16", tarifa_para_empaquetar: 1, activo: false }, // apagado
  ];
  return {
    ...t,
    hoteles: [
      { id: 217, nombre: "Hotel Juan Dolio", zona: null, destino_id: D.JUAN_DOLIO, moneda: "COP", activo: true },
      { id: 218, nombre: "Hotel Santo Domingo", zona: null, destino_id: D.SANTO_DOMINGO, moneda: "COP", activo: true },
    ],
    servicios_adicionales: [], armado_hoteles: [], armado_servicios: [], tarifario_resultado: [], salidas_dinamicas: [],
    ...extra,
  };
}
type PropsArmado = Parameters<typeof ArmadoClient>[0];
function elementosHijos(nodo: unknown, acumulado: unknown[] = []): unknown[] {
  if (Array.isArray(nodo)) { for (const n of nodo) elementosHijos(n, acumulado); return acumulado; }
  if (nodo && typeof nodo === "object" && "props" in nodo) {
    acumulado.push(nodo);
    elementosHijos((nodo as { props: { children?: unknown } }).props.children, acumulado);
  }
  return acumulado;
}
async function propsDePagina(tablas: Tablas, o: Parameters<typeof crearBd>[1] = {}): Promise<PropsArmado> {
  const bd = crearBd(tablas, { joins: JOINS_ARMADO, ...o });
  d67.sb = bd.cliente;
  const arbol = await PaginaPaquete({ params: Promise.resolve({ id: String(PAQUETE_ID) }) });
  const el = elementosHijos(arbol).find((n) => (n as { type: unknown }).type === ArmadoClient) as { props: PropsArmado } | undefined;
  assert.ok(el, "la página debe renderizar ArmadoClient");
  return el.props;
}
const ids = (xs: { id: number }[]) => xs.map((x) => x.id).sort((a, b) => a - b);

test("página: check OFF ofrece solo los vuelos del destino comercial; el hotel y el rango de viaje no cambian", async () => {
  const p = await propsDePagina(tablasPagina({ check: false }));
  assert.deepEqual(ids(p.vuelosDisp), [101, 102]);
  assert.deepEqual(ids(p.empaquetadosDisp), [1101, 1102]);
  assert.deepEqual(ids(p.hotelesDisp), [217], "los hoteles siguen siendo del destino comercial");
  assert.equal(p.config?.destinosAereosAlternativos, false);
  assert.equal(p.destinosAereosError ?? null, null);
});

test("página: check ON con SDQ y PUJ ofrece comercial + alternativas, varios vuelos por destino; hotel y servicios intactos; fuera de rango y apagados no", async () => {
  const p = await propsDePagina(tablasPagina({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
  assert.deepEqual(ids(p.vuelosDisp), [101, 102, 201, 202, 203, 301, 302], "204 queda fuera del rango de viaje");
  assert.deepEqual(ids(p.empaquetadosDisp), [1101, 1102, 1201, 1202, 1301, 1302], "1203 está apagado");
  assert.deepEqual(ids(p.hotelesDisp), [217], "el hotel de Santo Domingo NO entra: el alcance del hotel no cambia");
  assert.equal(p.config?.destinosAereosAlternativos, true);
  assert.deepEqual([...(p.config?.destinosAereosIds ?? [])].sort(), [D.SANTO_DOMINGO, D.PUNTA_CANA].sort());
});

test("página: una alternativa cuyo país cambió después deja de ofrecerse", async () => {
  const t = tablasPagina({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] });
  (t.destinos.find((d) => d.id === D.SANTO_DOMINGO) as Fila).pais = "Colombia";
  const p = await propsDePagina(t);
  assert.deepEqual(ids(p.vuelosDisp), [101, 102, 301, 302]);
});

test("página: sin destino comercial no se ofrece NINGÚN vuelo (nunca 'todos' de respaldo)", async () => {
  const p = await propsDePagina(tablasPagina({ check: true, alternativas: [D.SANTO_DOMINGO], paquete: { destino_id: null } }));
  assert.deepEqual(ids(p.vuelosDisp), []);
  assert.deepEqual(ids(p.empaquetadosDisp), []);
});

test("página: error de lectura de la configuración aérea = error visible, no 'no hay vuelos'", async () => {
  const p = await propsDePagina(tablasPagina({ check: true, alternativas: [D.SANTO_DOMINGO] }), { errorLectura: { armado_paquete_destinos_aereos: "boom" } });
  assert.deepEqual(ids(p.vuelosDisp), []);
  assert.match(p.destinosAereosError ?? "", /No se pudo/i);
  assert.doesNotMatch(p.destinosAereosError ?? "", /boom/);
});

// ═══ ConfigForm ═══════════════════════════════════════════════════════════
const DESTINOS_OPT = [
  { id: D.JUAN_DOLIO, nombre: "JUAN DOLIO", codigo_iata: null },
  { id: D.SANTO_DOMINGO, nombre: "SANTO DOMINGO", codigo_iata: "SDQ" },
  { id: D.PUNTA_CANA, nombre: "PUNTA CANA", codigo_iata: "PUJ" },
];
const INICIAL_BLOQUEO = { nombre: "Juan Dolio", tipo: "bloqueo" as const, destinoId: D.JUAN_DOLIO, noches: 3, activo: true, pctMk: 20, monedaPublicacion: "COP" }; // #90 D: la moneda de publicación se elige

test("ConfigForm: Bloqueo muestra el check apagado por defecto y NO pide candidatos hasta encenderlo visualmente (la lista aparece al encender)", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS_OPT, id: PAQUETE_ID, initial: INICIAL_BLOQUEO }));
  await esperar();
  const check = casillaAerea(raiz);
  assert.ok(check, "debe existir el check en Bloqueo");
  assert.equal(check.checked, false);
  assert.equal(casillasCandidatos(raiz).length, 0, "con el check apagado no hay selector");
  await pulsar(check);
  assert.deepEqual(etiquetas(raiz), ["PUNTA CANA (PUJ)", "SAMANA (AZS)", "SANTO DOMINGO (SDQ)"]);
  assert.match(raiz.textContent ?? "", /no se agregan traslados/i);
});

test("ConfigForm: elegir SDQ y PUJ y guardar envía check + IDs de las alternativas al servidor", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS_OPT, id: PAQUETE_ID, initial: INICIAL_BLOQUEO }));
  await esperar();
  await pulsar(casillaAerea(raiz)!);
  const [puj, , sdq] = casillasCandidatos(raiz);
  await pulsar(puj); await pulsar(sdq);
  await pulsar(boton(raiz, /Guardar cambios/)!);
  const llamada = d67.llamadas.find(([n]) => n === "actualizarPaquete");
  assert.ok(llamada, "debe llamar a actualizarPaquete");
  const [id, cfg] = llamada[1] as [number, { destinosAereosAlternativos: boolean; destinosAereosIds: number[]; destinoId: number }];
  assert.equal(id, PAQUETE_ID);
  assert.equal(cfg.destinoId, D.JUAN_DOLIO);
  assert.equal(cfg.destinosAereosAlternativos, true);
  assert.deepEqual([...cfg.destinosAereosIds].sort(), [D.SANTO_DOMINGO, D.PUNTA_CANA].sort());
  assert.deepEqual(d67.navegaciones, [`/dashboard/paquetes/${PAQUETE_ID}`]);
});

test("ConfigForm: apagar el check con una selección guardada envía check=false conservando la selección; si el servidor rechaza, se muestra el motivo y no se navega", async () => {
  d67.respGuardar = () => ({ ok: false, error: "Hay 1 vuelo(s) vinculado(s) que dejarían de cumplir los destinos aéreos del paquete: vuelo R201 (#201). Desvincúlalos explícitamente." });
  const raiz = await montar(h(ConfigForm, {
    destinos: DESTINOS_OPT, id: PAQUETE_ID,
    initial: { ...INICIAL_BLOQUEO, destinosAereosAlternativos: true, destinosAereosIds: [D.SANTO_DOMINGO, D.PUNTA_CANA] },
  }));
  await esperar();
  assert.equal(casillaAerea(raiz)!.checked, true);
  await pulsar(casillaAerea(raiz)!); // apagar
  await pulsar(boton(raiz, /Guardar cambios/)!);
  const cfg = (d67.llamadas.find(([n]) => n === "actualizarPaquete")![1] as [number, { destinosAereosAlternativos: boolean; destinosAereosIds: number[] }])[1];
  assert.equal(cfg.destinosAereosAlternativos, false);
  assert.deepEqual([...cfg.destinosAereosIds].sort(), [D.SANTO_DOMINGO, D.PUNTA_CANA].sort(), "la selección se conserva aunque el check esté apagado");
  assert.match(raiz.textContent ?? "", /Desvinc[uú]lalos expl[ií]citamente/);
  assert.deepEqual(d67.navegaciones, [], "no se navega cuando el servidor rechaza");
});

test("ConfigForm: destino comercial sin país → el servidor no da candidatos y el formulario muestra el motivo (nada que elegir)", async () => {
  d67.respCandidatos = () => ({ ok: true, candidatos: [], motivo: "El destino comercial no tiene país registrado: sin país comparable no se pueden habilitar alternativas." });
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS_OPT, id: PAQUETE_ID, initial: { ...INICIAL_BLOQUEO, destinoId: D.SANTO_DOMINGO } }));
  await esperar();
  await pulsar(casillaAerea(raiz)!);
  assert.equal(casillasCandidatos(raiz).length, 0);
  assert.match(raiz.textContent ?? "", /no tiene país registrado/i);
});

test("ConfigForm: error técnico al pedir los candidatos se muestra como error, no como 'sin candidatos'", async () => {
  d67.respCandidatos = () => ({ ok: false, error: "No se pudo verificar el destino aéreo de los vuelos. Intenta nuevamente." });
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS_OPT, id: PAQUETE_ID, initial: INICIAL_BLOQUEO }));
  await esperar();
  await pulsar(casillaAerea(raiz)!);
  assert.match(raiz.textContent ?? "", /No se pudo verificar/i);
});

test("ConfigForm: fuera de Bloqueo no hay selector ni se envían campos aéreos (no se toca lo guardado)", async () => {
  for (const tipo of ["porcion_terrestre", "dinamico", "servicios"] as const) {
    const raiz = await montar(h(ConfigForm, { destinos: DESTINOS_OPT, id: PAQUETE_ID, initial: { ...INICIAL_BLOQUEO, tipo } }));
    await esperar();
    assert.equal(casillaAerea(raiz), null, `${tipo}: sin check`);
    d67.llamadas.length = 0;
    await pulsar(boton(raiz, /Guardar cambios/)!);
    const cfg = (d67.llamadas.find(([n]) => n === "actualizarPaquete")![1] as [number, Record<string, unknown>])[1];
    assert.equal("destinosAereosAlternativos" in cfg, false, `${tipo}: no envía destinosAereosAlternativos`);
    assert.equal("destinosAereosIds" in cfg, false, `${tipo}: no envía destinosAereosIds`);
    await desmontar?.(); desmontar = undefined;
  }
  assert.ok(!d67.llamadas.some(([n]) => n === "candidatos"), "ni siquiera se piden candidatos fuera de Bloqueo");
});

test("ConfigForm: crear un paquete nuevo (sin id) también envía la configuración aérea", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS_OPT, initial: { ...INICIAL_BLOQUEO } }));
  await esperar();
  await pulsar(casillaAerea(raiz)!);
  await pulsar(casillasCandidatos(raiz)[2]); // SDQ
  await pulsar(boton(raiz, /Crear y continuar/)!);
  const cfg = (d67.llamadas.find(([n]) => n === "crearPaquete")![1] as [{ destinosAereosAlternativos: boolean; destinosAereosIds: number[] }])[0];
  assert.equal(cfg.destinosAereosAlternativos, true);
  assert.deepEqual(cfg.destinosAereosIds, [D.SANTO_DOMINGO]);
});

// ═══ ArmadoClient: etiqueta del destino aéreo y rechazos visibles ═════════
function propsArmado(over: Partial<PropsArmado> = {}): PropsArmado {
  const vuelo = (id: number, destino: number, record: string) => ({ id, record, ruta: "BOG-X", aerolinea: "AV", fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", tarifa_para_empaquetar: 1130000, destino_id: destino });
  return {
    paqueteId: PAQUETE_ID,
    destinos: [
      { id: D.JUAN_DOLIO, nombre: "JUAN DOLIO", codigo_iata: null },
      { id: D.SANTO_DOMINGO, nombre: "SANTO DOMINGO", codigo_iata: "SDQ" },
      { id: D.PUNTA_CANA, nombre: "PUNTA CANA", codigo_iata: "PUJ" },
      { id: D.SAMANA, nombre: "SAMANA", codigo_iata: null },
    ],
    config: { nombre: "Juan Dolio", tipo: "bloqueo", destinoId: D.JUAN_DOLIO, noches: 3, activo: true, pctMk: 20, destinosAereosAlternativos: true, destinosAereosIds: [D.SANTO_DOMINGO, D.PUNTA_CANA] },
    tieneDestino: true,
    vuelosDisp: [vuelo(101, D.JUAN_DOLIO, "RJD"), vuelo(201, D.SANTO_DOMINGO, "RSD"), vuelo(301, D.PUNTA_CANA, "RPC")],
    empaquetadosDisp: [{ ...vuelo(1301, D.PUNTA_CANA, "REP"), record: null }],
    hotelesDisp: [], serviciosDisp: [], selVuelos: [], selEmpaquetados: [], selHoteles: [], selServicios: [], resultado: [],
    ...over,
  };
}

test("ArmadoClient: etiqueta el destino aéreo solo cuando difiere del comercial, con IATA si existe, y aclara que no hay traslado", async () => {
  const raiz = await montar(h(ArmadoClient, propsArmado()));
  await abrirPestana(raiz, "Vuelos");
  const texto = raiz.textContent ?? "";
  assert.match(texto, /Destino aéreo: SANTO DOMINGO \(SDQ\)/);
  assert.match(texto, /Destino aéreo: PUNTA CANA \(PUJ\)/);
  assert.equal((texto.match(/Destino aéreo:/g) ?? []).length, 2, "dos vuelos negociados (SDQ, PUJ); el del destino comercial no lleva etiqueta y el empaquetado de PUJ ya no se ofrece en Bloqueo (#101)");
  assert.match(texto, /sin traslado incluido/i);
});

test("ArmadoClient: un vuelo rechazado por el servidor muestra el motivo (vinculación simple y 'Seleccionar todos')", async () => {
  d67.respVinculo = () => ({ ok: false, error: "El vuelo no corresponde a los destinos aéreos permitidos del paquete." });
  const raiz = await montar(h(ArmadoClient, propsArmado()));
  await abrirPestana(raiz, "Vuelos");
  const filas = [...raiz.querySelectorAll("li")].filter((li) => /RSD/.test(li.textContent ?? ""));
  await pulsar(filas[0].querySelector("input[type=checkbox]")!);
  assert.ok(d67.llamadas.some(([n, a]) => n === "setVuelo" && (a as unknown[])[1] === 201));
  assert.match(raiz.textContent ?? "", /no corresponde a los destinos a[eé]reos permitidos/i);

  d67.llamadas.length = 0;
  const todos = [...raiz.querySelectorAll("label")].find((l) => /Seleccionar todos/.test(l.textContent ?? ""))!.querySelector("input")!;
  await pulsar(todos);
  assert.ok(d67.llamadas.some(([n]) => n === "setTodosVuelos"));
  assert.match(raiz.textContent ?? "", /no corresponde a los destinos a[eé]reos permitidos/i);
});

test("ArmadoClient: un vínculo aceptado limpia el error; error de lectura de destinos aéreos se muestra y no dice 'no hay vuelos'", async () => {
  const raiz = await montar(h(ArmadoClient, propsArmado()));
  await abrirPestana(raiz, "Vuelos");
  d67.respVinculo = () => ({ ok: false, error: "Error de prueba" });
  const fila = [...raiz.querySelectorAll("li")].find((li) => /RJD/.test(li.textContent ?? ""))!;
  await pulsar(fila.querySelector("input[type=checkbox]")!);
  assert.match(raiz.textContent ?? "", /Error de prueba/);
  d67.respVinculo = () => ({ ok: true });
  await pulsar(fila.querySelector("input[type=checkbox]")!);
  assert.doesNotMatch(raiz.textContent ?? "", /Error de prueba/);
  await desmontar?.(); desmontar = undefined;

  const conError = await montar(h(ArmadoClient, propsArmado({ vuelosDisp: [], empaquetadosDisp: [], destinosAereosError: "No se pudo verificar el destino aéreo de los vuelos. Intenta nuevamente." })));
  await abrirPestana(conError, "Vuelos");
  const t = conError.textContent ?? "";
  assert.match(t, /No se pudo verificar el destino aéreo/i);
  assert.match(t, /No se pudieron cargar los vuelos/i);
  assert.doesNotMatch(t, /No hay ciclos aéreos/i);
});

test("ArmadoClient: con lista vacía sin error, el mensaje habla de los destinos permitidos (no solo del comercial)", async () => {
  const raiz = await montar(h(ArmadoClient, propsArmado({ vuelosDisp: [], empaquetadosDisp: [] })));
  await abrirPestana(raiz, "Vuelos");
  assert.match(raiz.textContent ?? "", /destinos permitidos/i);
});
