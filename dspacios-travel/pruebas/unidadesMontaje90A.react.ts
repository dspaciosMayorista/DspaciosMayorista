// Se ejecuta con npm run test:react (loader React + jsdom).
// #90 Entrega A — unidades monetarias en el armado de paquetes, componente REAL (ArmadoClient):
//   · Bloqueo: la neta se rotula como costo/CxP y la de reventa como precio al cliente, ambas con la moneda de la fuente; un Bloqueo sin
//     moneda acreditada NO se muestra como COP;
//   · hotel/servicio USD conservan su unidad (nada de formatCOP fijo) en listas, modal y tarifario resultado;
//   · el panel «Unidades del montaje» informa cuándo un componente exigiría TRM explícita y no convierte ni muestra importes convertidos.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__p90a";

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
  export async function setServicios(...a) { reg('setServicios', a); return ${G}.respLote(a); }
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
  export async function desvincularSalidasEmpaquetados63() { return { ok: true, procesados: 0 }; }
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

const p90a = {
  llamadas: [] as [string, unknown[]][],
  refrescos: 0,
  respServicio: (a: unknown[]): unknown => { void a; return { ok: true }; },
  respLote: (a: unknown[]): unknown => ({ ok: true, procesados: (a[1] as unknown[]).length }),
};
(globalThis as unknown as { __p90a: typeof p90a }).__p90a = p90a;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const { formatCOP, formatMoneda } = await import("../lib/utils.ts");
const h = React.createElement;
type Props = Parameters<typeof ArmadoClient>[0];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  p90a.llamadas.length = 0; p90a.refrescos = 0;
  p90a.respServicio = () => ({ ok: true });
  p90a.respLote = (a) => ({ ok: true, procesados: (a[1] as unknown[]).length });
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
const pestana = (raiz: Element, nombre: string) => {
  const b = pestanas(raiz).find((x) => (x.textContent ?? "").trim() === nombre);
  assert.ok(b, `debe existir la pestaña ${nombre}`);
  return b;
};
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

test("Bloqueo: neta = costo/CxP, reventa = precio al cliente, con la moneda de la fuente", async () => {
  const raiz = await montar(props("bloqueo", {
    vuelosDisp: [{ ...vuelo(11, "RAAA"), tarifa_neta: 500000, moneda: "COP" }, { ...vuelo(12, "RUSD"), tarifa_neta: 250, tarifa_para_empaquetar: 300, moneda: "USD" }] as Props["vuelosDisp"],
  }));
  await pulsar(pestana(raiz, "Vuelos"));
  const t = texto(raiz);
  assert.ok(t.includes(`Neta (costo y CxP) ${formatMoneda(500000, "COP")}`), "neta en COP");
  assert.match(t, /Reventa \(precio al cliente\)/);
  assert.ok(t.includes(formatMoneda(250, "USD")) && t.includes(formatMoneda(300, "USD")), "el Bloqueo USD conserva sus importes en USD");
});

test("Bloqueo sin moneda acreditada se rotula así y no se formatea como COP", async () => {
  const raiz = await montar(props("bloqueo", {
    vuelosDisp: [{ ...vuelo(11, "RAAA"), tarifa_neta: 500000, moneda: null }] as Props["vuelosDisp"],
  }));
  await pulsar(pestana(raiz, "Vuelos"));
  const li = raiz.querySelector("[data-testid=vuelo-unidades]")!;
  assert.match(li.textContent ?? "", /Moneda sin acreditar/);
  assert.ok(!(li.textContent ?? "").includes("$"), "sin moneda acreditada no hay símbolo de moneda");
});

test("servicio y hotel USD no se muestran como COP", async () => {
  const raiz = await montar(props("bloqueo", {
    serviciosDisp: [{ id: 41, nombre: "Tour USD", precio_persona: 80, destino_id: 1, moneda: "USD", servicio_tarifa_pax: [] }] as Props["serviciosDisp"],
  }));
  await pulsar(pestana(raiz, "Servicios"));
  assert.ok(texto(raiz).includes(`Persona: ${formatMoneda(80, "USD")}`));
  assert.ok(!texto(raiz).includes(`Persona: ${formatCOP(80)}`));
});

test("panel de unidades: paquete USD con hotel USD + Bloqueo COP pide TRM explícita y conserva los importes", async () => {
  const raiz = await montar(props("bloqueo", {
    moneda: "USD",
    vuelosDisp: [{ ...vuelo(11, "RAAA"), tarifa_neta: 500000, tarifa_para_empaquetar: 650000, moneda: "COP" }] as Props["vuelosDisp"],
    hotelesDisp: [{ id: 31, nombre: "Hotel Uno", zona: null, destino_id: 1, moneda: "USD" }] as Props["hotelesDisp"],
    selVuelos: [{ bloqueo_id: 11, aplica_mk: true, ta: 0 }],
  }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const panel = raiz.querySelector("[data-testid=unidades-montaje]");
  assert.ok(panel, "el panel aparece con componentes elegidos");
  const t = panel!.textContent ?? "";
  assert.match(t, /se publica en USD/);
  assert.match(t, /requiere TRM explícita/);
  assert.ok(t.includes(formatMoneda(500000, "COP")) && t.includes(formatMoneda(650000, "COP")), "importes del Bloqueo en su unidad original");
  assert.doesNotMatch(t, /USD \$\s?\d+[.,]\d+ \(convertido\)/);
});

test("panel de unidades: todo coincide con la publicación = sin aviso de conversión", async () => {
  const raiz = await montar(props("porcion_terrestre", { moneda: "COP" }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const t = raiz.querySelector("[data-testid=unidades-montaje]")?.textContent ?? "";
  assert.match(t, /se publica en COP/);
  assert.doesNotMatch(t, /TRM/);
});

test("tarifario resultado USD: 'Doble desde' y servicios opcionales usan la moneda de la fila", async () => {
  const f = (id: number, modulo: string, over: Record<string, unknown>) => ({
    id, modulo, bloqueo_label: null, hotel_nombre: "Hotel Uno", servicio_nombre: null, tipo_tarifa: null, pax_desde: null, pax_hasta: null,
    categoria: "ESTANDAR", regimen: "PC", acomodacion: "doble", noches: 3, base_comisionable: 200, impuesto: 0, precio_pvp: 200,
    temporada_ganadora: null, es_promocion: null, precio_final_autoritativo: null, procedencia_temporadas: null, procedencia_mixta: false, moneda: "USD", ...over,
  });
  const raiz = await montar(props("bloqueo", {
    moneda: "USD",
    resultado: [f(1, "bloqueo", {}), f(2, "servicios", { hotel_nombre: null, servicio_nombre: "Tour", acomodacion: null, tipo_tarifa: "persona", precio_pvp: 90 })] as Props["resultado"],
  }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const t = texto(raiz);
  assert.ok(t.includes(`Doble desde ${formatMoneda(200, "USD")}`), "el titular conserva USD");
  await pulsar(cabecera(raiz, /Servicios opcionales/)!);
  assert.ok(texto(raiz).includes(formatMoneda(90, "USD")));
});

test("selección que el generador rechaza: el panel no promete moneda publicable y muestra el motivo, sin TRM ni conversión", async () => {
  const motivo = "El Bloqueo RAAA tiene moneda COP y este paquete se publica en USD.";
  const raiz = await montar(props("bloqueo", {
    moneda: "USD",
    publicacionMontaje: { estado: "rechazado", motivo },
    vuelosDisp: [{ ...vuelo(11, "RAAA"), tarifa_neta: 500000, tarifa_para_empaquetar: 650000, moneda: "COP" }] as Props["vuelosDisp"],
    hotelesDisp: [{ id: 31, nombre: "Hotel Uno", zona: null, destino_id: 1, moneda: "USD" }] as Props["hotelesDisp"],
    selVuelos: [{ bloqueo_id: 11, aplica_mk: true, ta: 0 }],
  }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const t = raiz.querySelector("[data-testid=unidades-montaje]")?.textContent ?? "";
  const encabezado = t.split("El generador rechazaría")[0];
  assert.doesNotMatch(encabezado.replace("sin moneda publicable con esta selección", ""), /se publica en/, "el encabezado y las filas no prometen moneda");
  assert.match(t, /sin moneda publicable con esta selección/);
  assert.match(raiz.querySelector("[data-testid=unidades-rechazo]")?.textContent ?? "", /rechazaría esta selección/);
  assert.ok(t.includes(motivo));
  assert.doesNotMatch(t, /requiere TRM explícita/);
  assert.ok(t.includes(formatMoneda(500000, "COP")), "los importes siguen en su unidad original");
});

test("publicación publicable explícita (hotel COP elegido aunque la prop heredada diga USD): el panel usa la de la selección", async () => {
  const raiz = await montar(props("porcion_terrestre", {
    moneda: "USD",
    publicacionMontaje: { estado: "publicable", moneda: "COP" },
    hotelesDisp: [
      { id: 31, nombre: "Hotel Uno", zona: null, destino_id: 1, moneda: "COP" },
      { id: 32, nombre: "Hotel Dos", zona: null, destino_id: 1, moneda: "USD" },
    ] as Props["hotelesDisp"],
  }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const t = raiz.querySelector("[data-testid=unidades-montaje]")?.textContent ?? "";
  assert.match(t, /se publica en COP/);
  assert.doesNotMatch(t, /se publica en USD/);
});

test("rechazo por un vínculo que el editor no lista (Bloqueo fuera del rango): el panel lo muestra aunque no haya componentes visibles", async () => {
  const motivo = "El Bloqueo RFUERA no tiene la moneda acreditada y este paquete se publica en USD.";
  const raiz = await montar(props("bloqueo", {
    publicacionMontaje: { estado: "rechazado", motivo },
    hotelesDisp: [], vuelosDisp: [], empaquetadosDisp: [], serviciosDisp: [],
    selHoteles: [], selVuelos: [], selEmpaquetados: [], selServicios: [],
  }));
  await pulsar(pestana(raiz, "Tarifario resultado"));
  const panel = raiz.querySelector("[data-testid=unidades-montaje]");
  assert.ok(panel, "el panel aparece solo por el rechazo");
  assert.match(raiz.querySelector("[data-testid=unidades-rechazo]")?.textContent ?? "", /RFUERA/);
  assert.match(panel.textContent ?? "", /sin moneda publicable con esta selección/);
});
