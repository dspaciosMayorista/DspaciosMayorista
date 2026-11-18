// Run with the React loader (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/calculadoraConflicto124.react.ts
// #124 — the REAL CalculadoraEditor with the server actions replaced. Covers the confirmed triggers of
// "La calculadora cambió desde que la abriste…": the same user renaming a vigencia on the same page (the page refreshes its
// props, the editor used to keep the old version AND the old season name), a genuine concurrent save, a refused write
// (version unchanged) and a write that merely comes back through the page refresh. No actor is ever named.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__c124";
const reg = (n: string) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return ${G}.resp('${n}', a); }`;
// guardarReglasPromocion: lo importa CruceBasesMixta (#125), que ahora vive dentro del editor real.
const HOTEL = datos(["guardarCalculadora", "generarTarifasCalculadora", "sustituirPromoManualMixta", "guardarReglasPromocion"].map(reg).join("\n"));
const GRUPOS = datos(["leerConfigGrupos", "guardarGruposVigencia", "guardarPropuestaGrupos", "borrarGrupoDias", "guardarCalculoGrupo"].map(reg).join("\n"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "./grupos-actions" && padre.endsWith("/CalculoGrupoPanel.tsx")) return { url: GRUPOS, shortCircuit: true };
    if (specifier === "../actions" && /\/(CalculadoraEditor|CruceBasesMixta)\.tsx$/.test(padre)) return { url: HOTEL, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/producto/hoteles/")) return { url: datos("export function useRouter(){return{push(){},refresh(){ globalThis.__c124.refrescos++; },replace(){}}}"), shortCircuit: true };
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

type Llamada = [string, unknown[]];
const est = {
  llamadas: [] as Llamada[], refrescos: 0,
  respuestas: {} as Record<string, unknown>,
  resp: (n: string, a: unknown[]): unknown => {
    const r = est.respuestas[n];
    if (typeof r === "function") return (r as (a: unknown[]) => unknown)(a);
    return r ?? (n === "guardarCalculadora" ? { ok: true, version: (a[3] as number) + 1 }
      : n === "generarTarifasCalculadora" ? { ok: true, generadas: 3, vencidasConservadas: [], conGruposConservadas: [], promosManualesIntactas: [] } : { ok: true });
  },
};
(globalThis as unknown as { __c124: typeof est }).__c124 = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalculadoraEditor } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx");
const h = React.createElement;

let raiz: ReturnType<typeof createRoot> | undefined; let cont: HTMLElement | undefined;
afterEach(async () => { if (raiz) await React.act(async () => raiz!.unmount()); cont?.remove(); raiz = undefined; cont = undefined; est.llamadas.length = 0; est.respuestas = {}; est.refrescos = 0; });
after(() => dom.window.close());
const tick = () => new Promise((r) => setImmediate(r));
async function pintar(el: unknown) {
  if (!raiz) { cont = document.createElement("div"); document.body.append(cont); raiz = createRoot(cont); }
  await React.act(async () => { raiz!.render(el as never); await tick(); });
  return cont!;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await tick(); }); };
async function escribir(input: HTMLInputElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const boton = (r: Element, t: string | RegExp) => [...r.querySelectorAll("button")].find((b) => (typeof t === "string" ? (b.textContent ?? "").trim() === t : t.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const nombres = () => est.llamadas.map((l) => l[0]);
const guardados = () => est.llamadas.filter((l) => l[0] === "guardarCalculadora").map((l) => ({ version: l[1][3] as number, params: l[1][2] as DubaiP }));
const avisoDom = (r: Element) => r.querySelector("[data-aviso-calculadora]");
const baseDe = (r: Element, temporada: string) => r.querySelector<HTMLInputElement>(`td[data-label="${temporada}"] input`);
const campo = (r: Element, etiqueta: string) =>
  [...r.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim() === etiqueta)!.parentElement!.querySelector("input")!;

type DubaiP = { modificadores: { sencilla_pct: number }; bases: { categoria: string; temporada: string; precio: number }[]; promos: { temporadaBase: string; temporadaPromo: string }[] };
const dubai = (temporada: string, extra: Record<string, unknown> = {}) => ({
  regimen_base: "PAM", modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
  suplementos: [{ regimen: "PC", monto: 45000 }], bases: [{ categoria: "Estándar", temporada, precio: 100000 }],
  promos: [], infante_nota: "", ...extra,
});
const editor = (over: Record<string, unknown> = {}) => h(CalculadoraEditor, {
  hotelId: 5, categorias: ["Estándar"], temporadas: ["ALTA", "BAJA"], regimenes: ["PAM", "PC"], tipoInicial: "dubai",
  dubaiInicial: dubai("ALTA"), mixtaInicial: null, corporativaInicial: null, vigencias: [], hoy: "2026-11-11", tarifasExistentes: [],
  versionInicial: 4, gruposCalc: [], ...over,
} as never);
// What the page sends after «ALTA» is renamed to «ALTA 2027»: new season names, the calculator the server rewrote, version +1.
const renombrada = (over: Record<string, unknown> = {}) => editor({ temporadas: ["ALTA 2027", "BAJA"], dubaiInicial: dubai("ALTA 2027"), versionInicial: 5, ...over });
async function abrir(over: Record<string, unknown> = {}) {
  const r = await pintar(editor(over));
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  return r;
}

test("sin cambios externos: abrir, editar y guardar dos veces encadena la versión y no muestra aviso", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "55");
  await pulsar(boton(r, "Guardar calculadora")!);
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.deepEqual(guardados().map((g) => g.version), [4, 5]);
  assert.equal(avisoDom(r), null);
});

test("guardar y luego generar: generar no usa ni cambia la versión; el guardado siguiente usa la última", async () => {
  const r = await abrir();
  await pulsar(boton(r, "Generar (agregar/actualizar)")!);
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.deepEqual(nombres(), ["guardarCalculadora", "generarTarifasCalculadora", "guardarCalculadora"]);
  assert.deepEqual(guardados().map((g) => g.version), [4, 5]);
});

test("misma persona renombra la vigencia y la página se refresca: sin cambios locales se adopta la copia nueva, sin pedir recarga", async () => {
  const r = await abrir();
  await pintar(renombrada());
  const aviso = avisoDom(r)!;
  assert.equal(aviso.getAttribute("data-aviso-calculadora"), "info");
  assert.match(aviso.textContent ?? "", /«ALTA» se renombró a «ALTA 2027»/);
  assert.match(aviso.textContent ?? "", /versión 4 → 5/);
  assert.match(aviso.textContent ?? "", /No tenías cambios sin guardar/);
  assert.doesNotMatch(aviso.textContent ?? "", /otra persona/i, "nunca se nombra a una persona");
  assert.equal(baseDe(r, "ALTA 2027")!.value, "100000", "la base sigue visible bajo el nombre nuevo");
  assert.deepEqual(nombres(), [], "adoptar no hace solicitudes");
  await pulsar(boton(r, "Guardar calculadora")!);
  const [g] = guardados();
  assert.equal(g.version, 5, "guarda con la versión actual");
  assert.deepEqual(g.params.bases.map((b) => [b.temporada, b.precio]), [["ALTA 2027", 100000]], "la base NO se pierde ni vuelve al nombre viejo");
});

test("misma persona renombra con cambios sin guardar: se conservan, se trasladan al nombre nuevo y NO se guardan solos", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  await escribir(baseDe(r, "ALTA")!, "120000");
  await pintar(renombrada());
  const aviso = avisoDom(r)!;
  assert.match(aviso.textContent ?? "", /Conservamos tus cambios sin guardar/);
  assert.match(aviso.textContent ?? "", /Todavía NO están guardados/);
  assert.equal(campo(r, "Sencilla").value, "65");
  assert.equal(baseDe(r, "ALTA 2027")!.value, "120000", "el valor tecleado pasó al nombre nuevo");
  assert.deepEqual(nombres(), [], "no se guardó nada");
  await pulsar(boton(r, "Guardar calculadora")!);
  const [g] = guardados();
  assert.equal(g.version, 5);
  assert.equal(g.params.modificadores.sencilla_pct, 65);
  assert.deepEqual(g.params.bases.map((b) => [b.temporada, b.precio]), [["ALTA 2027", 120000]]);
});

test("el renombre también arrastra las promociones de la calculadora Dubai", async () => {
  const promo = (n: string) => ({ promos: [{ temporadaBase: n, temporadaPromo: "BAJA", regimen: "PAM", descuentoPct: 10 }] });
  const r = await abrir({ dubaiInicial: dubai("ALTA", promo("ALTA")) });
  await escribir(campo(r, "Sencilla"), "60");
  await pintar(renombrada({ dubaiInicial: dubai("ALTA 2027", promo("ALTA 2027")) }));
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.equal(guardados()[0].params.promos[0].temporadaBase, "ALTA 2027");
});

test("un cambio de la página que NO es un renombre y hay cambios locales: aviso de alerta, nada se adopta ni se guarda", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  await pintar(editor({ versionInicial: 6, dubaiInicial: dubai("ALTA", { modificadores: { sencilla_pct: 40, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 } }) }));
  const aviso = avisoDom(r)!;
  assert.equal(aviso.getAttribute("data-aviso-calculadora"), "alerta");
  assert.match(aviso.textContent ?? "", /versión 4 → 6\); cambió: modificadores/);
  assert.match(aviso.textContent ?? "", /siguen en pantalla/);
  assert.equal(campo(r, "Sencilla").value, "65", "lo escrito sigue ahí");
  assert.deepEqual(nombres(), []);
  await pulsar(boton(r, /Cargar la versión guardada/)!);
  assert.equal(campo(r, "Sencilla").value, "40", "cargar la guardada es una acción explícita");
  assert.equal(avisoDom(r), null);
});

test("choque real al guardar (otra sesión guardó): el servidor devuelve la copia, el aviso explica qué cambió y no se genera nada", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  est.respuestas.guardarCalculadora = () => ({
    ok: false, desactualizada: true, motivo: "cambio", error: "x",
    actual: { version: 5, tipo: "dubai", params: dubai("ALTA", { modificadores: { sencilla_pct: 40, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 } }) },
  });
  await pulsar(boton(r, "Generar (agregar/actualizar)")!);
  assert.deepEqual(nombres(), ["guardarCalculadora"], "no se llega a generar");
  const aviso = avisoDom(r)!;
  assert.equal(aviso.getAttribute("data-aviso-calculadora"), "alerta");
  assert.match(aviso.textContent ?? "", /Tu clic no guardó nada/);
  assert.equal(campo(r, "Sencilla").value, "65");
  assert.doesNotMatch(aviso.textContent ?? "", /otra persona/i);
});

test("choque real al guardar sin cambios locales (otra sesión renombró): primero se actualiza la página UNA vez, luego se adopta la copia y se pide repetir la acción", async () => {
  const r = await abrir();
  est.respuestas.guardarCalculadora = () => ({ ok: false, desactualizada: true, motivo: "cambio", error: "x", actual: { version: 5, tipo: "dubai", params: dubai("ALTA 2027") } });
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.equal(nombres().length, 1, "un solo intento, sin reintento automático");
  assert.match(avisoDom(r)!.textContent ?? "", /usa vigencias que esta pantalla aún no tiene \(ALTA 2027\)[\s\S]*Tu clic no guardó nada/);
  assert.equal(est.refrescos, 1, "UNA sola actualización de la página, sin bucle");
  assert.equal(baseDe(r, "ALTA")!.value, "100000", "nada se adoptó todavía: las columnas siguen siendo las que la pantalla conoce");
  est.respuestas = {};
  await pintar(renombrada());                                  // llega la página actualizada
  assert.match(avisoDom(r)!.textContent ?? "", /«ALTA» se renombró a «ALTA 2027»[\s\S]*Tu clic no guardó nada[\s\S]*Repite la acción/);
  assert.equal(est.refrescos, 1);
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.equal(guardados()[1].version, 5, "el segundo clic, ya con la versión adoptada, guarda");
});

test("escritura rechazada con la versión intacta (sesión/permiso): el mensaje del servidor se muestra tal cual y no se adopta nada", async () => {
  const r = await abrir();
  est.respuestas.guardarCalculadora = () => ({ ok: false, motivo: "sin_permiso", error: "No se guardó nada. La calculadora NO cambió (sigue en la versión 4)." });
  await escribir(campo(r, "Sencilla"), "65");
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.equal(avisoDom(r), null, "no es un conflicto de versión: no hay aviso de cambio");
  assert.match(r.textContent ?? "", /La calculadora NO cambió \(sigue en la versión 4\)/);
  assert.equal(campo(r, "Sencilla").value, "65");
});

test("la escritura propia que vuelve con el refresco de la página no dispara ningún aviso", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  await pulsar(boton(r, "Guardar calculadora")!);
  const enviada = guardados()[0].params;
  await pintar(editor({ versionInicial: 5, dubaiInicial: JSON.parse(JSON.stringify(enviada)) }));
  assert.equal(avisoDom(r), null);
  assert.equal(campo(r, "Sencilla").value, "65");
});

test("sin el panel abierto no hay nada que proteger: la copia nueva se adopta sin aviso", async () => {
  const r = await pintar(editor());
  await pintar(renombrada());
  assert.equal(avisoDom(r), null);
  await pulsar(boton(r, /Tarifa por fórmula/)!);
  assert.equal(baseDe(r, "ALTA 2027")!.value, "100000");
});

test("escribir en el formulario no hace solicitudes ni vuelve a montar nada", async () => {
  const r = await abrir();
  for (const v of ["51", "52", "53"]) await escribir(campo(r, "Sencilla"), v);
  assert.deepEqual(nombres(), []);
});

// ── Ediciones mientras una acción está en vuelo ───────────────────────────────────────────────────────────────────────────
function enVuelo() {
  let resolver!: (v: unknown) => void;
  const promesa = new Promise((r) => { resolver = r; });
  est.respuestas.guardarCalculadora = () => promesa;
  return resolver;
}
test("en vuelo: lo escrito mientras el guardado está en curso NO se pierde y viaja en el siguiente guardado", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  const resolver = enVuelo();
  await pulsar(boton(r, "Guardar calculadora")!);
  assert.equal(boton(r, "Guardar calculadora")?.disabled ?? true, true, "los botones se bloquean mientras dura la acción");
  await escribir(campo(r, "Sencilla"), "72");                       // edición durante el vuelo
  await React.act(async () => { resolver({ ok: true, version: 5 }); await tick(); await tick(); });
  assert.equal(campo(r, "Sencilla").value, "72", "la edición hecha durante el vuelo sigue en pantalla");
  assert.equal(avisoDom(r), null);
  est.respuestas = {};
  await pulsar(boton(r, "Guardar calculadora")!);
  const g = guardados();
  assert.deepEqual(g.map((x) => [x.version, x.params.modificadores.sencilla_pct]), [[4, 65], [5, 72]], "el 1.º envió 65; el 2.º lleva lo escrito en vuelo con la versión nueva");
});

test("en vuelo + el servidor rechaza por un cambio: la edición hecha durante el vuelo se conserva y NO se adopta nada", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  const resolver = enVuelo();
  await pulsar(boton(r, "Guardar calculadora")!);
  await escribir(campo(r, "Sencilla"), "72");
  await React.act(async () => {
    resolver({ ok: false, desactualizada: true, motivo: "cambio", error: "x",
      actual: { version: 5, tipo: "dubai", params: dubai("ALTA", { modificadores: { sencilla_pct: 40, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 } }) } });
    await tick(); await tick();
  });
  assert.equal(avisoDom(r)!.getAttribute("data-aviso-calculadora"), "alerta");
  assert.equal(campo(r, "Sencilla").value, "72", "lo escrito en vuelo sigue ahí");
  assert.deepEqual(nombres(), ["guardarCalculadora"], "sin reintento");
});

test("en vuelo + el servidor informa un RENOMBRE: se trasladan al nombre nuevo también las ediciones hechas durante el vuelo", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  const resolver = enVuelo();
  await pulsar(boton(r, "Guardar calculadora")!);
  await escribir(campo(r, "Sencilla"), "72");
  await escribir(baseDe(r, "ALTA")!, "130000");
  await React.act(async () => { resolver({ ok: false, desactualizada: true, motivo: "cambio", error: "x", actual: { version: 5, tipo: "dubai", params: dubai("ALTA 2027") } }); await tick(); await tick(); });
  assert.equal(est.refrescos, 1); assert.equal(campo(r, "Sencilla").value, "72", "mientras llega la página, lo escrito sigue ahí");
  await pintar(renombrada());
  assert.match(avisoDom(r)!.textContent ?? "", /Conservamos tus cambios sin guardar/);
  assert.equal(campo(r, "Sencilla").value, "72");
  assert.equal(baseDe(r, "ALTA 2027")!.value, "130000", "la base escrita en vuelo pasó al nombre nuevo");
  est.respuestas = {};
  await pulsar(boton(r, "Guardar calculadora")!);
  const ultimo = guardados().at(-1)!;
  assert.equal(ultimo.version, 5);
  assert.deepEqual(ultimo.params.bases.map((b) => [b.temporada, b.precio]), [["ALTA 2027", 130000]]);
});

test("renombre detectado SOLO con evidencia: un renombre mezclado con otro cambio se trata como cambio real (no se traslada)", async () => {
  const r = await abrir();
  await escribir(campo(r, "Sencilla"), "65");
  await pintar(renombrada({ dubaiInicial: dubai("ALTA 2027", { modificadores: { sencilla_pct: 40, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 } }) }));
  const aviso = avisoDom(r)!;
  assert.equal(aviso.getAttribute("data-aviso-calculadora"), "alerta");
  assert.doesNotMatch(aviso.textContent ?? "", /Conservamos/);
  assert.equal(campo(r, "Sencilla").value, "65");
});

test("rechazos sin versión distinta: el texto del servidor se muestra tal cual, sin aviso de cambio ni adopción (permiso demostrado o sin diagnosticar)", async () => {
  for (const [motivo, texto] of [["sin_permiso", "La base confirma que tu rol no puede"], ["rechazo_sin_diagnostico", "NO se pudo demostrar un problema de permisos"]] as const) {
    const r = await abrir();
    est.respuestas.guardarCalculadora = () => ({ ok: false, motivo, error: `No se guardó nada. ${texto}.` });
    await escribir(campo(r, "Sencilla"), "65");
    await pulsar(boton(r, "Guardar calculadora")!);
    assert.equal(avisoDom(r), null, motivo);
    assert.match(r.textContent ?? "", new RegExp(texto), motivo);
    assert.equal(campo(r, "Sencilla").value, "65");
    est.llamadas.length = 0; est.respuestas = {};
    await React.act(async () => raiz!.unmount()); cont?.remove(); raiz = undefined; cont = undefined;
  }
});
