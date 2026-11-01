// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/armadoOptimista.react.ts
//
// Checks del armado de paquetes (vuelos, hoteles, servicios; individual y «todos»), componente REAL (ArmadoClient) con acciones de servidor DIFERIDAS que la prueba
// resuelve a mano: el cambio y los contadores son inmediatos, cada fila muestra «Guardando», un fallo revierte y muestra el error, una respuesta antigua no revierte
// un clic más reciente, un guardado exitoso NO recarga el editor y «Generar tarifario» se bloquea con guardados pendientes o fallidos.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__pOpt";

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
  export async function generarTarifario() { ${G}.generaciones++; return { ok: true, id: 3 }; }
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

const pOpt = { refrescos: 0, generaciones: 0 };
(globalThis as unknown as { __pOpt: typeof pOpt }).__pOpt = pOpt;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ArmadoClient } = await import("../app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const h = React.createElement;
type Props = Parameters<typeof ArmadoClient>[0];

/** Acciones DIFERIDAS: cada llamada queda en espera hasta que la prueba la resuelve. */
type Llamada = { nombre: string; args: unknown[]; resolver: (r: unknown) => void };
const llamadas: Llamada[] = [];
const diferida = (nombre: string) => (...args: unknown[]) => new Promise<unknown>((resolver) => { llamadas.push({ nombre, args, resolver }); });
const acciones = {
  setVuelo: diferida("setVuelo"), setTodosVuelos: diferida("setTodosVuelos"), setHotel: diferida("setHotel"), setTodosHoteles: diferida("setTodosHoteles"),
  setServicio: diferida("setServicio"), setServicios: diferida("setServicios"), setEmpaquetado: diferida("setEmpaquetado"),
};
const resolver = async (nombre: string, r: unknown = { ok: true }) => {
  const i = llamadas.findIndex((l) => l.nombre === nombre);
  assert.ok(i >= 0, `no hay una llamada pendiente a ${nombre}`);
  await React.act(async () => { llamadas.splice(i, 1)[0].resolver(r); await new Promise((x) => setImmediate(x)); });
};

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; llamadas.length = 0; pOpt.refrescos = 0; pOpt.generaciones = 0; dom.window.history.replaceState(null, "", "/dashboard/paquetes/7"); });
after(() => dom.window.close());

const vuelo = (id: number) => ({ id, record: `R${id}`, ruta: "BOG-CTG", aerolinea: "AV", fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13", tarifa_para_empaquetar: 100000, destino_id: 1 });
function props(over: Partial<Props> = {}): Props {
  return {
    paqueteId: 7, destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG" }],
    config: { nombre: "P", tipo: "bloqueo", destinoId: 1, noches: 3, activo: true, pctMk: 20 } as Props["config"], tieneDestino: true,
    vuelosDisp: [vuelo(11), vuelo(12), vuelo(13)], empaquetadosDisp: [],
    hotelesDisp: [31, 32, 33].map((id) => ({ id, nombre: `Hotel ${id}`, zona: null, destino_id: 1 })),
    serviciosDisp: [41, 42].map((id) => ({ id, nombre: `Tour ${id}`, precio_persona: 50000, destino_id: 1, servicio_tarifa_pax: [], servicio_temporadas: [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2099-12-31", precio_persona: 50000 }] })),
    selVuelos: [], selEmpaquetados: [], selHoteles: [], selServicios: [], resultado: [], salidas: [], moneda: "COP",
    acciones: acciones as never, ...over,
  } as Props;
}
async function montar(p: Props) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(ArmadoClient, p) as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const clic = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); }); };
const casilla = (raiz: Element, etiqueta: string) => raiz.querySelector(`input[aria-label="${etiqueta}"]`) as HTMLInputElement;
const texto = (raiz: Element) => raiz.textContent ?? "";
const todos = (raiz: Element, re: RegExp) => ([...raiz.querySelectorAll("label")].find((l) => re.test(l.textContent ?? "")) as HTMLElement).querySelector("input") as HTMLInputElement;
const pestana = (raiz: Element, nombre: RegExp) => [...raiz.querySelectorAll("[role=tab]")].find((b) => nombre.test(b.textContent ?? "")) as HTMLElement;
const guardando = (raiz: Element, id: string) => /Guardando/.test(raiz.querySelector(`[data-testid="guardado-${id}"]`)?.textContent ?? "");

test("vuelo: el check y el contador cambian ANTES de que responda el servidor; «Guardando» por fila; al confirmar no se recarga el editor", async () => {
  const raiz = await montar(props({ pestanaInicial: "vuelos" }));
  assert.match(texto(raiz), /Adición de vuelos \(0 de 3\)/);
  await clic(casilla(raiz, "Vincular el vuelo R11"));
  assert.equal(llamadas.length, 1, "la acción salió pero sigue sin respuesta");
  assert.equal(casilla(raiz, "Vincular el vuelo R11").checked, true);
  assert.match(texto(raiz), /Adición de vuelos \(1 de 3\)/);
  assert.equal(guardando(raiz, "vuelo-11"), true);
  assert.equal(guardando(raiz, "vuelo-12"), false, "solo la fila afectada");
  await resolver("setVuelo");
  assert.equal(guardando(raiz, "vuelo-11"), false);
  assert.equal(casilla(raiz, "Vincular el vuelo R11").checked, true);
  assert.equal(pOpt.refrescos, 0, "un guardado exitoso no hace router.refresh()");
});

test("vuelo con error: revierte al valor real, muestra el error, y «Generar tarifario» queda bloqueado hasta descartarlo", async () => {
  const raiz = await montar(props({ pestanaInicial: "vuelos" }));
  await clic(casilla(raiz, "Vincular el vuelo R12"));
  await resolver("setVuelo", { ok: false, error: "El destino aéreo no está permitido" });
  assert.equal(casilla(raiz, "Vincular el vuelo R12").checked, false);
  assert.match(texto(raiz), /Adición de vuelos \(0 de 3\)/);
  assert.match(raiz.querySelector('[data-testid="guardado-vuelo-12"]')?.textContent ?? "", /El destino aéreo no está permitido/);
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal((raiz.querySelector('[data-testid="generar-tarifario"]') as HTMLButtonElement).disabled, true);
  assert.match(texto(raiz), /no se guardaron/);
  await clic(pestana(raiz, /Vuelos/));
  await clic(raiz.querySelector('button[aria-label="Descartar el error"]')!);
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal((raiz.querySelector('[data-testid="generar-tarifario"]') as HTMLButtonElement).disabled, false);
});

test("clics rápidos: una respuesta antigua no revierte el clic más reciente; se envían en orden y de a uno", async () => {
  const raiz = await montar(props({ pestanaInicial: "vuelos" }));
  const c = casilla(raiz, "Vincular el vuelo R13");
  await clic(c); await clic(c); await clic(c);       // marcar, desmarcar, marcar
  assert.equal(casilla(raiz, "Vincular el vuelo R13").checked, true);
  assert.equal(llamadas.length, 1, "solo una en vuelo");
  assert.deepEqual(llamadas[0].args.slice(2, 3), [true]);
  await resolver("setVuelo");                         // llega la respuesta de la primera
  assert.equal(casilla(raiz, "Vincular el vuelo R13").checked, true, "no se revierte");
  assert.equal(llamadas.length, 1, "sale la última (el desmarcar intermedio se reemplazó)");
  assert.deepEqual(llamadas[0].args.slice(2, 3), [true]);
  await resolver("setVuelo");
  assert.equal(guardando(raiz, "vuelo-13"), false);
  assert.equal(casilla(raiz, "Vincular el vuelo R13").checked, true);
});

test("hoteles «Seleccionar todos»: las filas y el contador cambian al instante, UNA acción, y un fallo devuelve todas", async () => {
  const raiz = await montar(props({ pestanaInicial: "hoteles" }));
  await clic(todos(raiz, /Seleccionar todos/));
  assert.match(texto(raiz), /Adición de hoteles \(3 de 3\)/);
  assert.deepEqual([31, 32, 33].map((id) => casilla(raiz, `Agregar el hotel Hotel ${id}`).checked), [true, true, true]);
  assert.deepEqual([31, 32, 33].map((id) => guardando(raiz, `hotel-${id}`)), [true, true, true]);
  assert.equal(llamadas.filter((l) => l.nombre === "setTodosHoteles").length, 1);
  await resolver("setTodosHoteles", { ok: false, error: "Sin permiso para editar hoteles" });
  assert.match(texto(raiz), /Adición de hoteles \(0 de 3\)/);
  assert.match(raiz.querySelector('[data-testid="error-lote-hotel"]')?.textContent ?? "", /Sin permiso para editar hoteles/);
  assert.equal(pOpt.refrescos, 0);
});

test("servicios individual y «todos»: respuesta inmediata y «Guardando» por fila", async () => {
  const raiz = await montar(props({ pestanaInicial: "servicios" }));
  await clic(casilla(raiz, "Agregar el servicio Tour 41"));
  assert.match(texto(raiz), /Adición de servicios \(1 de 2\)/);
  assert.equal(guardando(raiz, "servicio-41"), true);
  await resolver("setServicio");
  await clic(todos(raiz, /Seleccionar todos/));
  assert.match(texto(raiz), /Adición de servicios \(2 de 2\)/);
  assert.equal(guardando(raiz, "servicio-42"), true);
  await resolver("setServicios", { ok: true, procesados: 1 });
  assert.equal(guardando(raiz, "servicio-42"), false);
  assert.equal(pOpt.refrescos, 0);
});

test("«Generar tarifario» se bloquea mientras haya un guardado pendiente y no genera nada", async () => {
  const raiz = await montar(props({ pestanaInicial: "vuelos" }));
  await clic(casilla(raiz, "Vincular el vuelo R11"));
  await clic(pestana(raiz, /Tarifario resultado/));
  const boton = raiz.querySelector('[data-testid="generar-tarifario"]') as HTMLButtonElement;
  assert.equal(boton.disabled, true);
  assert.match(boton.textContent ?? "", /Guardando cambios/);
  await clic(boton);
  assert.equal(pOpt.generaciones, 0, "ni con un clic forzado se genera");
  await resolver("setVuelo");
  assert.equal((raiz.querySelector('[data-testid="generar-tarifario"]') as HTMLButtonElement).disabled, false);
});

const generar = (raiz: Element) => raiz.querySelector('[data-testid="generar-tarifario"]') as HTMLButtonElement;

test("hotel individual: cambio visible inmediato, «Guardando», éxito sin recargar y «Generar tarifario» bloqueado mientras guarda", async () => {
  const raiz = await montar(props({ pestanaInicial: "hoteles" }));
  assert.match(texto(raiz), /Adición de hoteles \(0 de 3\)/);
  await clic(casilla(raiz, "Agregar el hotel Hotel 31"));
  assert.equal(llamadas.length, 1, "la acción salió y sigue sin respuesta");
  assert.deepEqual([llamadas[0].nombre, ...llamadas[0].args], ["setHotel", 7, 31, true]);
  assert.equal(casilla(raiz, "Agregar el hotel Hotel 31").checked, true, "visible antes de la respuesta");
  assert.match(texto(raiz), /Adición de hoteles \(1 de 3\)/);
  assert.equal(guardando(raiz, "hotel-31"), true);
  assert.equal(guardando(raiz, "hotel-32"), false, "solo la fila afectada");
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal(generar(raiz).disabled, true, "bloqueado mientras guarda");
  await clic(generar(raiz));
  assert.equal(pOpt.generaciones, 0);
  await clic(pestana(raiz, /Hoteles/));
  await resolver("setHotel");
  assert.equal(guardando(raiz, "hotel-31"), false);
  assert.equal(casilla(raiz, "Agregar el hotel Hotel 31").checked, true);
  assert.equal(pOpt.refrescos, 0, "un guardado exitoso no recarga el editor");
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal(generar(raiz).disabled, false, "se libera al terminar");
});

test("hotel individual con error: revierte la selección, muestra el error y «Generar tarifario» sigue bloqueado hasta descartarlo", async () => {
  const raiz = await montar(props({ pestanaInicial: "hoteles" }));
  await clic(casilla(raiz, "Agregar el hotel Hotel 32"));
  assert.equal(casilla(raiz, "Agregar el hotel Hotel 32").checked, true);
  await resolver("setHotel", { ok: false, error: "Sin permiso para editar hoteles" });
  assert.equal(casilla(raiz, "Agregar el hotel Hotel 32").checked, false, "vuelve al valor real");
  assert.match(texto(raiz), /Adición de hoteles \(0 de 3\)/);
  assert.match(raiz.querySelector('[data-testid="guardado-hotel-32"]')?.textContent ?? "", /Sin permiso para editar hoteles/);
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal(generar(raiz).disabled, true, "tras el fallo, sin descartar, sigue bloqueado");
  await clic(generar(raiz));
  assert.equal(pOpt.generaciones, 0);
  await clic(pestana(raiz, /Hoteles/));
  await clic(raiz.querySelector('[data-testid="guardado-hotel-32"] button[aria-label="Descartar el error"]')!);
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal(generar(raiz).disabled, false);
});

test("hotel desmarcado con error vuelve a quedar marcado (el servidor lo tenía seleccionado)", async () => {
  const raiz = await montar(props({ pestanaInicial: "hoteles", selHoteles: [{ hotel_id: 33, categorias: null, regimenes: null, prioridad: null }] }));
  assert.match(texto(raiz), /Adición de hoteles \(1 de 3\)/);
  await clic(casilla(raiz, "Agregar el hotel Hotel 33"));
  assert.equal(casilla(raiz, "Agregar el hotel Hotel 33").checked, false);
  assert.deepEqual([llamadas[0].nombre, ...llamadas[0].args], ["setHotel", 7, 33, false]);
  await resolver("setHotel", { ok: false, error: "No se pudo quitar" });
  assert.equal(casilla(raiz, "Agregar el hotel Hotel 33").checked, true);
  assert.match(texto(raiz), /Adición de hoteles \(1 de 3\)/);
});

// El check de «vuelo por Sistema» (empaquetado) NO es un control que el usuario pueda guardar: en Bloqueo y Dinámico solo se muestran los ya vinculados, en
// lectura (soloLectura, sin otro punto de uso de EmpaquetadoRow). Por eso no existe flujo «guardando / éxito / fallo» que probar: se comprueba que un clic no
// guarda nada, que no aparece «Guardando» y que «Generar tarifario» no queda bloqueado.
test("empaquetado vinculado: el check es de solo lectura; un clic no guarda, no marca «Guardando» ni bloquea «Generar tarifario»", async () => {
  const emp = { id: 5, record: "E5", ruta: "BOG-CTG", aerolinea: "AV", fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13", tarifa_para_empaquetar: 100000, destino_id: 1 };
  const raiz = await montar(props({ pestanaInicial: "vuelos", empaquetadosDisp: [emp], selEmpaquetados: [{ empaquetado_id: 5, aplica_mk: true, ta: 0 }] }));
  const c = casilla(raiz, "Vuelo por Sistema E5");
  assert.ok(c, "el vinculado se muestra");
  assert.equal(c.checked, true);
  assert.equal(c.disabled, true, "solo lectura");
  await clic(c);
  assert.equal(llamadas.length, 0, "no sale ninguna acción");
  assert.equal(c.checked, true);
  assert.equal(guardando(raiz, "empaquetado-5"), false);
  await clic(pestana(raiz, /Tarifario resultado/));
  assert.equal(generar(raiz).disabled, false);
});
