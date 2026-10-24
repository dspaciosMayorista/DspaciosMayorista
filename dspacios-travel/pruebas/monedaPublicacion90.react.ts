// Se ejecuta con npm run test:react (loader React + jsdom).
// #90 Entrega D / #93 — componentes REALES (ConfigForm y el panel «Unidades del montaje» de ArmadoClient):
//   · la moneda de publicación (COP/USD) se ELIGE expresamente: sin elegirla no se guarda; el modo COP con TRM es COP y no deja elegir otra;
//   · la TRM es OPCIONAL con todo en COP ("No requiere conversión") y se valida si se escribe (positiva, nunca 1);
//   · el panel nombra el componente que bloquea la publicación y dice cuándo la TRM es obligatoria (entra USD) o no.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__m90";

const ACCIONES_PAQUETES = datos(`
  export async function crearPaquete(...a) { ${G}.llamadas.push(['crearPaquete', a]); return { ok: true, id: 1 }; }
  export async function actualizarPaquete(...a) { ${G}.llamadas.push(['actualizarPaquete', a]); return { ok: true, id: 1 }; }
  export async function listarDestinosAereosCandidatos() { return { ok: true, candidatos: [], motivo: null }; }
  export async function setVuelo() { return { ok: true }; }
  export async function setTodosVuelos() { return { ok: true }; }
  export async function setHotel() { return { ok: true }; }
  export async function setTodosHoteles() { return { ok: true }; }
  export async function setServicio() { return { ok: true }; }
  export async function setServicios() { return { ok: true, procesados: 0 }; }
  export async function generarTarifario() { return { ok: true, id: 3 }; }
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
  export function useRouter() { return { push(u) { ${G}.navegaciones.push(u); }, refresh() {}, replace() {} }; }
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

const m90 = { llamadas: [] as [string, unknown[]][], navegaciones: [] as string[] };
(globalThis as unknown as { __m90: typeof m90 }).__m90 = m90;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigForm } = await import("../app/(dashboard)/dashboard/paquetes/ConfigForm.tsx");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const h = React.createElement;
type PropsArmado = Parameters<typeof ArmadoClient>[0];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  m90.llamadas.length = 0; m90.navegaciones.length = 0;
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
const texto = (raiz: Element) => raiz.textContent ?? "";
/** Cambia el valor de un <select>/<input> como lo haría el usuario (React escucha change/input burbujeando). */
async function escribir(el: Element, valor: string) {
  const esSelect = el instanceof dom.window.HTMLSelectElement;
  const proto = esSelect ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event(esSelect ? "change" : "input", { bubbles: true }));
  });
}
const selMoneda = (raiz: Element) => raiz.querySelector<HTMLSelectElement>('[aria-label="Moneda de publicación"]')!;
const inputTrm = (raiz: Element) => raiz.querySelector<HTMLInputElement>('[aria-label="TRM del paquete"]');
const DESTINOS = [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG" }];
const llamadaGuardar = () => m90.llamadas.find(([n]) => n === "crearPaquete" || n === "actualizarPaquete");
const cfgGuardada = () => llamadaGuardar()![1].at(-1) as { monedaPublicacion: string; modoOferta: string; trmOferta: number | null };

// ═══ ConfigForm: la moneda de publicación se ELIGE ═══════════════════════════
test("ConfigForm: sin elegir la moneda no se guarda y se pide elegirla (no se deduce de los hoteles)", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS, initial: { nombre: "Paquete", tipo: "porcion_terrestre", destinoId: 1, noches: 3, activo: true, pctMk: 20 } }));
  await esperar();
  assert.equal(selMoneda(raiz).value, "", "arranca sin moneda elegida");
  await pulsar(boton(raiz, /Crear y continuar/)!);
  assert.match(texto(raiz), /Elige la moneda de publicación del paquete \(COP o USD\)/);
  assert.equal(llamadaGuardar(), undefined, "no llama al servidor");
});

test("ConfigForm: elegir USD y guardar envía la moneda elegida, modo de siempre y sin TRM", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS, initial: { nombre: "Paquete", tipo: "porcion_terrestre", destinoId: 1, noches: 3, activo: true, pctMk: 20 } }));
  await esperar();
  await escribir(selMoneda(raiz), "USD");
  await pulsar(boton(raiz, /Crear y continuar/)!);
  const cfg = cfgGuardada();
  assert.equal(cfg.monedaPublicacion, "USD");
  assert.equal(cfg.modoOferta, "legacy");
  assert.equal(cfg.trmOferta, null);
});

test("ConfigForm: elegir COP y guardar envía COP", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS, id: 7, initial: { nombre: "Paquete", tipo: "bloqueo", destinoId: 1, noches: 3, activo: true, pctMk: 20, monedaPublicacion: "USD" } }));
  await esperar();
  assert.equal(selMoneda(raiz).value, "USD", "muestra la moneda ya elegida, sin cambiarla en silencio");
  await escribir(selMoneda(raiz), "COP");
  await pulsar(boton(raiz, /Guardar cambios/)!);
  assert.equal(cfgGuardada().monedaPublicacion, "COP");
});

// ═══ ConfigForm: TRM opcional con todo COP, validada si se escribe ═══════════
const INICIAL_63 = { nombre: "Dinámico", tipo: "dinamico" as const, destinoId: 1, noches: 3, activo: true, pctMk: 20, modoOferta: "cop_trm_63", trmOferta: null };

test("ConfigForm modo COP con TRM: publica en COP (selector fijo) y la TRM vacía se guarda como null (no requiere conversión)", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS, id: 7, initial: INICIAL_63 }));
  await esperar();
  assert.equal(selMoneda(raiz).value, "COP");
  assert.equal(selMoneda(raiz).disabled, true, "el modo COP con TRM no deja elegir otra moneda");
  assert.match(texto(raiz), /El modo COP con TRM publica siempre en COP/);
  assert.match(texto(raiz), /Solo es obligatoria si algún componente está en USD/);
  assert.doesNotMatch(texto(raiz), /TRM del paquete \(COP por USD\) \*/, "ya no es un campo obligatorio");
  await pulsar(boton(raiz, /Guardar cambios/)!);
  const cfg = cfgGuardada();
  assert.equal(cfg.modoOferta, "cop_trm_63");
  assert.equal(cfg.trmOferta, null);
  assert.equal(cfg.monedaPublicacion, "COP");
});

test("ConfigForm modo COP con TRM: una TRM positiva se envía como número; una TRM 0 o negativa se rechaza antes de llamar al servidor", async () => {
  const raiz = await montar(h(ConfigForm, { destinos: DESTINOS, id: 7, initial: INICIAL_63 }));
  await esperar();
  await escribir(inputTrm(raiz)!, "3987.65");
  await pulsar(boton(raiz, /Guardar cambios/)!);
  assert.equal(cfgGuardada().trmOferta, 3987.65);

  m90.llamadas.length = 0;
  await escribir(inputTrm(raiz)!, "0");
  await pulsar(boton(raiz, /Guardar cambios/)!);
  assert.match(texto(raiz), /La TRM debe ser un número positivo/);
  assert.equal(llamadaGuardar(), undefined);
  await escribir(inputTrm(raiz)!, "-5");
  await pulsar(boton(raiz, /Guardar cambios/)!);
  assert.equal(llamadaGuardar(), undefined);
});

// ═══ Panel «Unidades del montaje»: mensaje del componente que bloquea y estado de la TRM ═══
const CONFIG_63 = { nombre: "Dinámico 63", tipo: "dinamico", destinoId: 1, noches: 3, activo: true, pctMk: 20, modoOferta: "cop_trm_63", trmOferta: null, monedaPublicacion: "COP" } as PropsArmado["config"];
function propsArmado(over: Partial<PropsArmado>): PropsArmado {
  return {
    paqueteId: 7, destinos: DESTINOS, config: CONFIG_63, tieneDestino: true, vuelosDisp: [], empaquetadosDisp: [],
    hotelesDisp: [{ id: 31, nombre: "Decameron", zona: null, destino_id: 1, moneda: "USD" }] as PropsArmado["hotelesDisp"],
    serviciosDisp: [], selVuelos: [], selEmpaquetados: [], selHoteles: [{ hotel_id: 31, categorias: null, regimenes: null, prioridad: null }],
    selServicios: [], resultado: [], salidas: [], moneda: "COP", ...over,
  };
}
async function panel(over: Partial<PropsArmado>) {
  const raiz = await montar(h(ArmadoClient, propsArmado(over)));
  const pestana = [...raiz.querySelectorAll("[role=tab]")].find((b) => (b.textContent ?? "").trim() === "Tarifario resultado");
  assert.ok(pestana);
  await pulsar(pestana);
  const p = raiz.querySelector("[data-testid=unidades-montaje]");
  assert.ok(p, "el panel aparece");
  return p.textContent ?? "";
}

test("panel: entra un hotel USD sin TRM → nombra el componente que bloquea y dice que la TRM es obligatoria", async () => {
  const motivo = "Falta la TRM: hay componentes en USD que se convierten a COP (Hotel Decameron). Configúrala en el paquete antes de publicar o cotizar.";
  const t = await panel({ publicacionMontaje: { estado: "rechazado", motivo }, textoTrmMontaje: "Falta la TRM: hay componentes en USD" });
  assert.match(t, /sin moneda publicable con esta selección/);
  assert.match(t, /El generador rechazaría esta selección: Falta la TRM/);
  assert.match(t, /Hotel Decameron/, "el componente que bloquea");
});

test("panel: todo COP → 'No requiere conversión' y nada bloquea", async () => {
  const t = await panel({
    publicacionMontaje: { estado: "publicable", moneda: "COP" }, textoTrmMontaje: "No requiere conversión",
    hotelesDisp: [{ id: 31, nombre: "Hotel COP", zona: null, destino_id: 1, moneda: "COP" }] as PropsArmado["hotelesDisp"],
  });
  assert.match(t, /se publica en COP · modo COP con TRM · No requiere conversión/);
  assert.doesNotMatch(t, /El generador rechazaría/);
});

test("panel: con USD y TRM configurada → muestra la TRM y publica", async () => {
  const t = await panel({ publicacionMontaje: { estado: "publicable", moneda: "COP" }, textoTrmMontaje: "TRM 3987.65 (COP por USD)", config: { ...CONFIG_63, trmOferta: 3987.65 } as PropsArmado["config"] });
  assert.match(t, /modo COP con TRM · TRM 3987\.65/);
  assert.match(t, /requiere TRM explícita/, "el hotel USD se convierte con la TRM explícita");
  assert.doesNotMatch(t, /El generador rechazaría/);
});

test("panel: mezcla fuera del modo 63 → el motivo nombra los componentes y no ofrece conversión", async () => {
  const motivo = "El paquete se publica en COP pero hay componentes en USD: Vuelo L93FYZ. Mezclar monedas solo existe en el modo COP con TRM (Entrega E aún no disponible).";
  const t = await panel({ config: { ...CONFIG_63, tipo: "bloqueo", modoOferta: "legacy", trmOferta: null } as PropsArmado["config"], publicacionMontaje: { estado: "rechazado", motivo } });
  assert.match(t, /Vuelo L93FYZ/);
  assert.match(t, /Entrega E aún no disponible/);
});
