// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/alcance262Editores.react.ts
//
// Editores del tipo de receptivo/combo y de los precios propios por trayecto (262/263, provisionales). Componentes REALES con acciones de servidor dobles que
// registran lo que reciben: un combo debe declarar si lleva traslado y cómo se cobra; los precios de «un trayecto» y de «ida y regreso» se guardan como filas
// independientes (nunca se calcula uno del otro); GENERAL no admite precios; sin las migraciones los editores avisan y no escriben.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__a262";
const ACCIONES = datos(`
  export async function guardarClasificacionServicio(id, c) { ${G}.llamadas.push(['clasificacion', id, c]); return ${G}.respuesta; }
  export async function guardarPreciosAlcanceVigencia(id, f) { ${G}.llamadas.push(['precios', id, f]); return ${G}.respuesta; }
`);
const NAVEGACION = datos(`export function useRouter() { return { refresh() { ${G}.refrescos++; }, push() {}, replace() {} }; }`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./actions" && padre.endsWith("/servicios/Alcance262.tsx")) return { url: ACCIONES, shortCircuit: true };
    if (specifier === "next/navigation" && padre.endsWith("/servicios/Alcance262.tsx")) return { url: NAVEGACION, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/servicios" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const estado = { llamadas: [] as unknown[][], respuesta: { ok: true } as { ok: boolean; error?: string }, refrescos: 0 };
(globalThis as unknown as { __a262: typeof estado }).__a262 = estado;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { Alcance262Provider, ClasificacionServicioEditor, PreciosAlcanceEditor } = await import("../app/(dashboard)/dashboard/producto/servicios/Alcance262.tsx");
const h = React.createElement;
type Datos = Parameters<typeof Alcance262Provider>[0]["value"];

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; estado.llamadas.length = 0; estado.respuesta = { ok: true }; estado.refrescos = 0; });
after(() => dom.window.close());

async function montar(value: Datos, hijos: unknown) {
  const c = document.createElement("div"); document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(h(Alcance262Provider, { value, children: hijos } as never)));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const cambiar = async (el: Element, valor: string) => { await React.act(async () => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
}); };
const clic = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((x) => setImmediate(x)); }); };
const boton = (raiz: Element, re: RegExp) => [...raiz.querySelectorAll("button")].find((b) => re.test(b.textContent ?? "")) as HTMLButtonElement;
const selects = (raiz: Element) => [...raiz.querySelectorAll("select")] as HTMLSelectElement[];
const base = (over: Partial<Datos> = {}): Datos => ({ disponible: true, clasif: {}, precios: {}, ...over });

test("sin las migraciones (disponible=false) el editor de tipo avisa y no ofrece guardar", async () => {
  const raiz = await montar(base({ disponible: false }), h(ClasificacionServicioEditor, { servicioId: 1 }));
  assert.match(raiz.textContent ?? "", /falta aplicar las migraciones 262 y 263/);
  assert.equal(boton(raiz, /Guardar tipo/), undefined);
});

test("un combo debe declarar si incluye traslado: sin declararlo no llama a la acción", async () => {
  const raiz = await montar(base(), h(ClasificacionServicioEditor, { servicioId: 7 }));
  await cambiar(selects(raiz)[0], "combo");
  await clic(boton(raiz, /Guardar tipo/));
  assert.equal(estado.llamadas.length, 0);
  assert.match(raiz.textContent ?? "", /debe declarar si incluye traslado/);
});

test("combo con traslado: debe elegir cómo se cobra; completo guarda tipo, incluye y alcance", async () => {
  const raiz = await montar(base(), h(ClasificacionServicioEditor, { servicioId: 7 }));
  await cambiar(selects(raiz)[0], "combo");
  await cambiar(selects(raiz)[1], "si");
  await clic(boton(raiz, /Guardar tipo/));
  assert.equal(estado.llamadas.length, 0, "falta el alcance del traslado");
  await cambiar(selects(raiz)[2], "trayecto_salida");
  await clic(boton(raiz, /Guardar tipo/));
  assert.deepEqual(estado.llamadas, [["clasificacion", 7, { tipo_receptivo: "combo", combo_incluye_traslado: true, combo_traslado_alcance: "trayecto_salida" }]]);
  assert.equal(estado.refrescos, 1);
});

test("un tour guarda sin campos de combo", async () => {
  const raiz = await montar(base(), h(ClasificacionServicioEditor, { servicioId: 3 }));
  await cambiar(selects(raiz)[0], "tour");
  assert.equal(selects(raiz).length, 1, "no hay preguntas de combo");
  await clic(boton(raiz, /Guardar tipo/));
  assert.deepEqual(estado.llamadas, [["clasificacion", 3, { tipo_receptivo: "tour", combo_incluye_traslado: null, combo_traslado_alcance: null }]]);
});

test("precios: solo para servicios que llevan traslado; un tour o un servicio sin clasificar no los muestra", async () => {
  const tour = await montar(base({ clasif: { 1: { tipo_receptivo: "tour" } } }), h(PreciosAlcanceEditor, { servicioId: 1, temporadaId: 10, nombre: "ALTA" }));
  assert.equal(tour.querySelector('[data-testid="precios-alcance-10"]'), null);
  await desmontar?.(); desmontar = undefined;
  const sin = await montar(base({ clasif: { 1: { tipo_receptivo: null } } }), h(PreciosAlcanceEditor, { servicioId: 1, temporadaId: 10, nombre: "ALTA" }));
  assert.equal(sin.querySelector('[data-testid="precios-alcance-10"]'), null, "sin clasificar no se supone traslado");
});

test("GENERAL no admite precios por trayecto (histórico, no vendible)", async () => {
  const raiz = await montar(base({ clasif: { 1: { tipo_receptivo: "traslado" } } }), h(PreciosAlcanceEditor, { servicioId: 1, temporadaId: 10, nombre: "GENERAL" }));
  assert.equal(raiz.querySelector('[data-testid="precios-alcance-10"]'), null);
  assert.match(raiz.textContent ?? "", /GENERAL es la tarifa histórica y no se vende/);
});

test("precios: un trayecto e ida y regreso se guardan como filas INDEPENDIENTES con SU precio (80.000 ≠ 2 × 45.000)", async () => {
  const raiz = await montar(base({ clasif: { 1: { tipo_receptivo: "traslado" } } }), h(PreciosAlcanceEditor, { servicioId: 1, temporadaId: 10, nombre: "ALTA" }));
  assert.match(raiz.textContent ?? "", /sin precio propio no se podrá vender un solo trayecto/);
  await clic(boton(raiz, /Agregar precio/)); await clic(boton(raiz, /Agregar precio/));
  const precios = [...raiz.querySelectorAll('input[aria-label="Precio neto"]')];
  const alcances = [...raiz.querySelectorAll('select[aria-label="Alcance del precio"]')];
  await cambiar(precios[0], "45000"); await cambiar(alcances[1], "ida_regreso"); await cambiar(precios[1], "80000");
  await clic(boton(raiz, /Guardar precios/));
  assert.deepEqual(estado.llamadas, [["precios", 10, [
    { alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 45000 },
    { alcance: "ida_regreso", pax_desde: null, pax_hasta: null, precio: 80000 },
  ]]]);
});

test("precios: rangos de pasajeros cruzados se rechazan en pantalla sin llamar a la acción; el error de la acción se muestra", async () => {
  const previos = [{ alcance: "trayecto" as const, pax_desde: 1, pax_hasta: 4, precio: 1000 }, { alcance: "trayecto" as const, pax_desde: 4, pax_hasta: 8, precio: 2000 }];
  const raiz = await montar(base({ clasif: { 1: { tipo_receptivo: "traslado" } }, precios: { 10: previos } }), h(PreciosAlcanceEditor, { servicioId: 1, temporadaId: 10, nombre: "ALTA" }));
  await clic(boton(raiz, /Guardar precios/));
  assert.equal(estado.llamadas.length, 0);
  assert.match(raiz.textContent ?? "", /se cruzan/);
  const corregir = [...raiz.querySelectorAll('input[aria-label="Pasajeros desde"]')][1];
  await cambiar(corregir, "5");
  estado.respuesta = { ok: false, error: "No se pudieron guardar los precios por trayecto; se conservaron los anteriores." };
  await clic(boton(raiz, /Guardar precios/));
  assert.equal(estado.llamadas.length, 1);
  assert.match(raiz.textContent ?? "", /se conservaron los anteriores/);
  assert.equal(estado.refrescos, 0, "un fallo no recarga");
});

const TARIFA_PERSONA = { persona: 85000, grupos: [] };
const TARIFA_RANGOS = { persona: null, grupos: [{ precio: 120000 }, { precio: 200000 }, { precio: 280000 }, { precio: 400000 }] };
const MENSAJE = "Ida y regreso: usa las tarifas de esta vigencia; puedes definir un precio propio para reemplazarlas.";
const traslado = (tarifaVigente: { persona: number | null; grupos: { precio: number }[] } | undefined, precios: Datos["precios"] = {}) =>
  montar(base({ clasif: { 1: { tipo_receptivo: "traslado" } }, precios }), h(PreciosAlcanceEditor, { servicioId: 1, temporadaId: 10, nombre: "ALTA", tarifaVigente }));

test("ida y regreso con la tarifa ya vigente (por persona o por rangos): el editor lo dice y NO muestra «sin tarifa»; un trayecto sigue pidiendo su precio", async () => {
  for (const tv of [TARIFA_PERSONA, TARIFA_RANGOS, { persona: 0, grupos: [] }, { persona: null, grupos: [{ precio: 0 }] }]) {
    const raiz = await traslado(tv);
    assert.ok((raiz.textContent ?? "").includes(MENSAJE), "mensaje exacto");
    assert.ok(raiz.querySelector('[data-testid="ida-regreso-tarifa-10"]'));
    assert.equal(raiz.querySelector('[data-testid="ida-regreso-sin-tarifa-10"]'), null, "con tarifa vigente no se dice que no la tiene");
    assert.doesNotMatch(raiz.textContent ?? "", /no tiene tarifa/);
    assert.match(raiz.textContent ?? "", /Un trayecto: sin precio propio no se podrá vender un solo trayecto/);
    await desmontar?.(); desmontar = undefined;
  }
});

test("ida y regreso SIN tarifa vigente (NULL, ausente o inválida; el 0 SÍ es tarifa) y sin precio propio: avisa que hay que definir uno; con un precio propio de ida y regreso ya no avisa", async () => {
  for (const tv of [{ persona: null, grupos: [] }, { persona: Number.NaN, grupos: [{ precio: Number.NaN }] }, undefined]) {
    const raiz = await traslado(tv);
    assert.ok(raiz.querySelector('[data-testid="ida-regreso-sin-tarifa-10"]'), "avisa");
    assert.match(raiz.textContent ?? "", /esta vigencia no tiene tarifa; define un precio propio/);
    assert.ok(!(raiz.textContent ?? "").includes(MENSAJE));
    await desmontar?.(); desmontar = undefined;
  }
  const conPropio = await traslado({ persona: null, grupos: [] }, { 10: [{ alcance: "ida_regreso", pax_desde: null, pax_hasta: null, precio: 150000 }] });
  assert.equal(conPropio.querySelector('[data-testid="ida-regreso-sin-tarifa-10"]'), null);
  assert.ok(conPropio.querySelector('[data-testid="trayecto-sin-precio-10"]'), "el trayecto sí sigue sin precio propio");
});

test("con precio propio de un trayecto no se avisa del trayecto; con tarifa vigente y precio propio de ida y regreso el mensaje de reemplazo se mantiene", async () => {
  const raiz = await traslado(TARIFA_RANGOS, { 10: [
    { alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: 70000 }, { alcance: "ida_regreso", pax_desde: 5, pax_hasta: 12, precio: 190000 },
  ] });
  assert.equal(raiz.querySelector('[data-testid="trayecto-sin-precio-10"]'), null);
  assert.ok((raiz.textContent ?? "").includes(MENSAJE));
});
