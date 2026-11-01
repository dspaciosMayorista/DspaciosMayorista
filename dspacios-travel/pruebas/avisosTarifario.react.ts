// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/avisosTarifario.react.ts
//
// Pestaña «Tarifario resultado» con un diagnóstico LARGO (como el de producción, con 1.881 tarifas publicadas), componente REAL:
//   · encabezado compacto («Publicado con avisos», conteo, «Ver avisos») sin el texto crudo ni marcadores ##/**;
//   · el aviso aparece UNA sola vez (panel) también justo después de generar;
//   · las tarifas quedan inmediatamente después del encabezado;
//   · fallo de lectura → estado de error claro (no «Aún no hay tarifas»); lectura truncada → advertencia.
// El desborde y la altura a 390 y 1280 px no se miden aquí (jsdom no hace layout): se midieron en Chromium real con el mismo componente.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__pav";

const ACCIONES_PAQUETES = datos(`
  export async function crearPaquete() { return { ok: true, id: 1 }; }
  export async function actualizarPaquete() { return { ok: true, id: 1 }; }
  export async function listarDestinosAereosCandidatos() { return { ok: true, candidatos: [], motivo: null }; }
  export async function setVuelo() { return { ok: true }; }
  export async function setTodosVuelos() { return { ok: true }; }
  export async function setHotel() { return { ok: true }; }
  export async function setTodosHoteles() { return { ok: true }; }
  export async function setServicio() { return { ok: true }; }
  export async function setServicios() { return { ok: true, procesados: 0 }; }
  export async function generarTarifario() { return ${G}.respGenerar(); }
  export async function continuarPublicacionTarifario() { return { ok: true }; }
  export async function estadoPublicacionTarifario() { return { ok: true }; }
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
  export async function desvincularSalidasEmpaquetados63() { return { ok: true, procesados: 0 }; }
`);
const ACCIONES_EMPAQUETADOS = datos(`export async function setEmpaquetado() { return { ok: true }; }`);
const NAVEGACION = datos(`
  export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
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
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const pav = { respGenerar: (): unknown => ({ ok: true, id: 1881, aviso: "" }) };
(globalThis as unknown as { __pav: typeof pav }).__pav = pav;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const h = React.createElement;
type Props = Parameters<typeof ArmadoClient>[0];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  pav.respGenerar = () => ({ ok: true, id: 1881, aviso: "" });
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
const panel = () => document.querySelector('[role="dialog"]');

// Diagnóstico largo como el de producción: salidas omitidas, incluidos omitidos, «Incluye» libre con ##/**, opcionales, infante.
const DIAGNOSTICO_LARGO = [
  "12 de 48 salida(s) no se publican porque un servicio incluido no tiene vigencia confirmada: «Traslado aeropuerto» (7 salida(s), desde 01/11/2026 hasta 28/02/2027; sin tarifa vigente); «Tour Isla Rosario» (5 salida(s), desde 05/12/2026 hasta 09/01/2027; vencida).",
  "Servicios incluidos omitidos por falta de tarifa vigente (esas salidas se ofrecen SIN el servicio): «Cena de gala» (9 salida(s), desde 20/12/2026 hasta 02/01/2027; sin vigencia); «Show folclórico» (3 salida(s), desde 20/12/2026).",
  "El texto «Incluye» del paquete se conserva, pero en las salidas sin el servicio se retira: «Cena de gala».",
  "ATENCIÓN operador: en las salidas con servicios omitidos el texto «Incluye» (libre) no se presenta como inclusión cierta —puede nombrar un servicio con otras palabras— y se muestran solo los servicios efectivos. Líneas afectadas: «## **Alimentación** todo incluido»; «**Traslados** ## aeropuerto - hotel - aeropuerto»; «Seguro hotelero». Estructura el texto o edítalo.",
  "Opcionales no ofrecidos: «Buceo» (sin vigencia).",
  "Atención: los servicios Tour Isla Rosario, Cena de gala no tienen precio de infante: los menores de 2 años pagarán como adulto en ellos. Configúralo en Producto → Servicios.",
].join(" ");

const fila = (id: number, hotel: string, acom: string, pvp: number) => ({
  id, modulo: "bloqueo", bloqueo_label: "RAAA BOG-CTG", hotel_nombre: hotel, servicio_nombre: null, tipo_tarifa: null, pax_desde: null, pax_hasta: null,
  categoria: "ESTANDAR", regimen: "PC", acomodacion: acom, noches: 3, base_comisionable: pvp, impuesto: 0, precio_pvp: pvp,
  temporada_ganadora: null, es_promocion: null, precio_final_autoritativo: null, procedencia_temporadas: null, procedencia_mixta: false,
});
const RESULTADO = [fila(1, "Hotel Uno", "doble", 900000), fila(2, "Hotel Uno", "sencilla", 1200000), fila(3, "Hotel Dos", "doble", 800000)];
function props(over: Partial<Props> = {}): Props {
  return {
    paqueteId: 7,
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG" }],
    config: { nombre: "Paquete", tipo: "bloqueo", destinoId: 1, noches: 3, activo: true, pctMk: 20 } as Props["config"],
    tieneDestino: true, vuelosDisp: [], empaquetadosDisp: [], hotelesDisp: [], serviciosDisp: [],
    selVuelos: [], selEmpaquetados: [], selHoteles: [], selServicios: [],
    resultado: RESULTADO as unknown as Props["resultado"], salidas: [], moneda: "COP", pestanaInicial: "tarifario",
    tarifarioEstado: "listo", tarifarioPublicable: true, tarifarioDiagnostico: DIAGNOSTICO_LARGO, totalResultado: 1881,
    ...over,
  };
}
const caja = (raiz: Element) => raiz.querySelector("[data-testid=estado-tarifario]")!;
const boton = (raiz: Element, t: RegExp) => [...raiz.querySelectorAll("button")].find((b) => t.test((b.textContent ?? "").trim()));

test("diagnóstico largo: encabezado compacto, sin texto crudo ni marcadores, con conteo y «Ver avisos»", async () => {
  const raiz = await montar(props());
  const c = caja(raiz).textContent ?? "";
  assert.match(c, /Publicado con avisos/);
  assert.match(c, /1\.881 tarifas/);
  assert.ok(boton(raiz, /^Ver avisos$/), "botón Ver avisos");
  assert.ok(c.length < 200, `encabezado de ${c.length} caracteres`);
  const todo = raiz.textContent ?? "";
  assert.doesNotMatch(todo, /##|\*\*/);
  assert.doesNotMatch(todo, /Traslado aeropuerto|Líneas afectadas|no tienen precio de infante/, "el diagnóstico no está en la página, solo en el panel");
  assert.equal(panel(), null);
});

test("«Ver avisos» abre el panel con secciones legibles y se cierra", async () => {
  const raiz = await montar(props());
  await pulsar(boton(raiz, /^Ver avisos$/)!);
  const p = panel();
  assert.ok(p, "panel abierto");
  const t = p.textContent ?? "";
  for (const titulo of ["Servicios y salidas omitidos", "Precio de infante por configurar", "Texto «Incluye» por revisar"]) assert.ok(t.includes(titulo), titulo);
  assert.match(t, /Traslado aeropuerto/);
  assert.match(t, /Alimentación todo incluido/, "marcadores retirados, texto conservado");
  assert.doesNotMatch(t, /##|\*\*/);
  assert.equal(p.querySelectorAll('[data-testid="avisos-infante"]').length, 1);
  await pulsar(p.querySelector("[data-slot=dialog-close]")!);
  await React.act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  assert.equal(panel(), null, "panel cerrado");
});

test("las tarifas quedan inmediatamente después del encabezado y el botón Generar", async () => {
  const raiz = await montar(props());
  const gen = boton(raiz, /^Generar tarifario$/)!;
  const hotel = [...raiz.querySelectorAll("button[aria-expanded]")].find((b) => /Hotel Uno/.test(b.textContent ?? ""))!;
  assert.ok(hotel, "lista de hoteles visible");
  assert.ok(gen.compareDocumentPosition(hotel) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  const entre = (raiz.textContent ?? "").split("Generar tarifario")[1]!.split("Hotel Uno")[0]!;
  assert.ok(entre.length < 600, `${entre.length} caracteres entre Generar y la primera tarifa`);
});

test("tras generar, el aviso nuevo aparece UNA sola vez (en el panel), no también en el encabezado", async () => {
  pav.respGenerar = () => ({ ok: true, id: 1881, aviso: "1881 tarifas persona publicadas en el tarifario. " + DIAGNOSTICO_LARGO });
  const raiz = await montar(props({ tarifarioDiagnostico: null, tarifarioEstado: "pendiente" }));
  await pulsar(boton(raiz, /^Generar tarifario$/)!);
  assert.match(raiz.textContent ?? "", /Tarifario generado: 1881 tarifas publicadas\./);
  assert.equal((raiz.textContent ?? "").split("Traslado aeropuerto").length - 1, 0, "texto del aviso fuera de la página");
  assert.ok(boton(raiz, /^Ver avisos$/));
  await pulsar(boton(raiz, /^Ver avisos$/)!);
  assert.equal((panel()!.textContent ?? "").split("Traslado aeropuerto").length - 1, 1, "una sola vez en el panel");
});

test("fallo de lectura: estado de error claro, nunca «Aún no hay tarifas»", async () => {
  const raiz = await montar(props({ resultado: [], resultadoError: "canceling statement due to statement timeout", totalResultado: null }));
  const e = raiz.querySelector("[data-testid=resultado-error]");
  assert.ok(e);
  assert.match(e.textContent ?? "", /No se pudieron leer las tarifas publicadas: canceling statement/);
  assert.doesNotMatch(raiz.textContent ?? "", /Aún no hay tarifas/);
});

test("lectura truncada (menos filas que el total en base): advertencia visible", async () => {
  const raiz = await montar(props());
  const w = raiz.querySelector("[data-testid=resultado-truncado]");
  assert.ok(w);
  assert.match(w.textContent ?? "", /Se muestran 3 de 1\.881 tarifas/);
  await desmontar?.(); desmontar = undefined;
  const ok = await montar(props({ totalResultado: 3 }));
  assert.equal(ok.querySelector("[data-testid=resultado-truncado]"), null);
});
