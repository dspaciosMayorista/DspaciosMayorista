// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/promoMultibase125.react.ts
// #125 — panel «Reglas por grupo» con «Seguir la base ganadora cada noche» y «Un niño gratis por habitación», vista previa fechada,
// y la calculadora Mixta (promoción que cruza bases → plan por noche → botón explícito). Componentes REALES, acciones sustituidas.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__p125";
const reg = (n: string) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return ${G}.resp('${n}', a); }`;
const ACCIONES = datos(["guardarReglasPromocion", "guardarCalculadora", "generarTarifasCalculadora", "sustituirPromoManualMixta"].map(reg).join("\n"));
const GRUPOS = datos(["leerConfigGrupos", "guardarGruposVigencia", "guardarPropuestaGrupos", "borrarGrupoDias", "guardarCalculoGrupo"].map(reg).join("\n"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "../actions" && /\/(PromocionReglas|CruceBasesMixta|CalculadoraEditor)\.tsx$/.test(padre)) return { url: ACCIONES, shortCircuit: true };
    if (specifier === "./grupos-actions" && padre.endsWith("/CalculoGrupoPanel.tsx")) return { url: GRUPOS, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/producto/hoteles/")) return { url: datos(`export function useRouter(){return{push(){},replace(){},refresh(){ ${G}.refrescos++ }}}`), shortCircuit: true };
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
const est = { llamadas: [] as [string, unknown[]][], refrescos: 0, resp: (_n: string, _a: unknown[]): unknown => ({ ok: true, version: 8 }) };
(globalThis as unknown as { __p125: typeof est }).__p125 = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ReglasPromoPanel } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/PromocionReglas.tsx");
const { CalculadoraEditor } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; est.llamadas.length = 0; est.refrescos = 0; est.resp = () => ({ ok: true, version: 8 }); });
after(() => dom.window.close());
async function montar(el: unknown) {
  const c = document.createElement("div"); document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => { raiz.render(el as never); await new Promise((r) => setImmediate(r)); });
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const act = (fn: () => void) => React.act(async () => { fn(); await new Promise((r) => setImmediate(r)); });
const boton = (c: HTMLElement, t: string) => [...c.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;
const cambiar = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
  el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

// ── Datos sintéticos: BASE A 1–5 dic (doble 100.000, niño 50.000), BASE B 6–12 dic (150.000 / 75.000); promoción PRE BF 4–8 dic, P5, −10 %.
const vig = (o: Record<string, unknown>) => ({ fecha_inicio: null, fecha_fin: null, prioridad: 1, tipo: "tarifa", compra_inicio: null, compra_fin: null, regimen_restringido: null, ...o });
const A = vig({ id: 1, nombre: "BASE A", fecha_inicio: "2027-12-01", fecha_fin: "2027-12-05" });
const B = vig({ id: 2, nombre: "BASE B", fecha_inicio: "2027-12-06", fecha_fin: "2027-12-12" });
const PROMO_V = vig({ id: 10, nombre: "PRE BF", fecha_inicio: "2027-12-04", fecha_fin: "2027-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
const TARIFAS = [
  { tipo_habitacion: "Estándar", alimentacion: "PAM", temporada: "BASE A", neto_doble: 100000, neto_nino: 50000, grupo_id: null },
  { tipo_habitacion: "Estándar", alimentacion: "PAM", temporada: "BASE B", neto_doble: 150000, neto_nino: 75000, grupo_id: null },
];
const BASES = [{ id: 1, nombre: "BASE A", prioridad: 1, grupos: [] }, { id: 2, nombre: "BASE B", prioridad: 1, grupos: [] }];
const promo = (o = {}) => ({ id: 10, nombre: "PRE BF", tipo: "descuento_pct", prioridad: 5, descuento_valor: 10, descuento_unidad: null, promo_base_id: null, reglas: [], ...o });
const panel = (p: unknown, extra: Record<string, unknown> = {}) =>
  h(ReglasPromoPanel, { hotelId: 5, promo: p, bases: BASES, onCerrar: () => {}, vigencias: [A, B, PROMO_V], tarifas: TARIFAS, regimenes: ["PAM"], moneda: "COP", ...extra } as never);
const SIN = { activo: false, edadMin: null, edadMax: null };
const tramos = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-tramo-plan]")];

test("«Base vinculada»: la opción de seguir la base ganadora va primero (tras el vacío) y muestra UNA regla sin valor de días por defecto", async () => {
  const c = await montar(panel(promo()));
  const sel = c.querySelector("select")!;
  assert.deepEqual([...sel.options].map((o) => o.textContent), ["Elige la vigencia base…", "Seguir la base ganadora cada noche (varias temporadas)", "BASE A (P1)", "BASE B (P1)"]);
  await act(() => cambiar(sel, "sigue"));
  assert.ok(c.querySelector("[data-modo-sigue]"), "se muestra el modo");
  assert.equal(c.querySelectorAll("[data-regla-grupo]").length, 0, "sin filas por grupo");
  assert.match(c.textContent ?? "", /infante conserva su tarifa base/);
  const valor = c.querySelector<HTMLInputElement>("[data-modo-sigue] input[inputmode=decimal]")!;
  assert.equal(valor.value, "10", "sugiere el % de la vigencia (editable)");
  assert.ok([...c.querySelectorAll<HTMLInputElement>("[data-modo-sigue] input[type=radio]")].every((r) => !r.checked), "los días no vienen elegidos");
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /Elige «Todos los días» o «Elegir días»/);
  assert.equal(est.llamadas.length, 0, "validar no hace solicitudes");
  await act(() => c.querySelectorAll<HTMLInputElement>("[data-modo-sigue] input[type=radio]")[0].click());
  await act(() => boton(c, "Guardar reglas").click());
  assert.deepEqual(est.llamadas, [["guardarReglasPromocion", [{
    hotelId: 5, promocionId: 10, baseId: null, reglas: [{ grupo_id: null, valor: 10, dias: null }],
    previas: { base: null, reglas: [], sigueBase: false, ninoGratis: { activo: false, edadMin: null, edadMax: null } },
    sigueBase: true, ninoGratis: SIN,
  }]]]);
});

test("niño gratis: aparece con base o modo elegidos, edad propia opcional (ambas o ninguna) y viaja en la acción", async () => {
  const c = await montar(panel(promo()));
  assert.equal(c.querySelector("[data-nino-gratis]"), null, "sin base ni modo elegido no se ofrece");
  await act(() => cambiar(c.querySelector("select")!, "sigue"));
  await act(() => c.querySelectorAll<HTMLInputElement>("[data-modo-sigue] input[type=radio]")[0].click());
  const casilla = c.querySelector<HTMLInputElement>("[data-nino-gratis] input[type=checkbox]")!;
  assert.equal(c.querySelector("[data-nino-edad]"), null, "la edad solo aparece con el niño gratis activo");
  await act(() => casilla.click());
  assert.match(c.textContent ?? "", /al menos 2 adultos/);
  assert.match(c.textContent ?? "", /no toca vuelos, asistencia, traslados, tours/);
  const [min, max] = [...c.querySelectorAll<HTMLInputElement>("[data-nino-edad] input")];
  await act(() => cambiar(min, "3"));
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /mínima y la máxima/);
  assert.equal(est.llamadas.length, 0);
  await act(() => cambiar(min, "12")); await act(() => cambiar(max, "3"));
  await act(() => boton(c, "Guardar reglas").click());
  assert.match(c.textContent ?? "", /mínima del niño gratis no puede ser mayor/);
  await act(() => cambiar(min, "3")); await act(() => cambiar(max, "12"));
  await act(() => boton(c, "Guardar reglas").click());
  const a = est.llamadas[0][1][0] as Record<string, unknown>;
  assert.deepEqual(a.ninoGratis, { activo: true, edadMin: 3, edadMax: 12 });
  assert.equal(a.sigueBase, true);
});

test("niño gratis sin edad propia: viaja activo con edades nulas (rige la regla del hotel)", async () => {
  const c = await montar(panel(promo()));
  await act(() => cambiar(c.querySelector("select")!, "1"));
  await act(() => c.querySelector<HTMLInputElement>("[data-regla-grupo] > label input[type=checkbox]")!.click());
  await act(() => c.querySelector<HTMLInputElement>("[data-regla-grupo] input[type=radio]")!.click());
  await act(() => cambiar(c.querySelector<HTMLInputElement>("[data-regla-grupo] input[inputmode=decimal]")!, "10"));
  await act(() => c.querySelector<HTMLInputElement>("[data-nino-gratis] input[type=checkbox]")!.click());
  await act(() => boton(c, "Guardar reglas").click());
  const a = est.llamadas[0][1][0] as Record<string, unknown>;
  assert.deepEqual(a.ninoGratis, { activo: true, edadMin: null, edadMax: null });
  assert.equal(a.sigueBase, false);
  assert.equal(a.baseId, 1);
});

test("promoción de monto: no se ofrece el niño gratis", async () => {
  const c = await montar(panel(promo({ tipo: "descuento_monto", descuento_unidad: "persona_noche", descuento_valor: null })));
  await act(() => cambiar(c.querySelector("select")!, "sigue"));
  assert.equal(c.querySelector("[data-nino-gratis]"), null);
});

test("promoción que ya sigue la base: carga su regla y su niño gratis; «Quitar reglas y desvincular» = 1 acción con la foto previa", async () => {
  const p = promo({ promo_sigue_base: true, nino_gratis: true, nino_gratis_edad_min: 3, nino_gratis_edad_max: 12, reglas: [{ grupo_id: null, valor: 10, dias: [1, 2] }] });
  const c = await montar(panel(p));
  assert.equal(c.querySelector("select")!.value, "sigue");
  assert.equal(c.querySelector<HTMLInputElement>("[data-modo-sigue] input[inputmode=decimal]")!.value, "10");
  assert.equal(c.querySelector<HTMLInputElement>("[data-nino-gratis] input[type=checkbox]")!.checked, true);
  assert.deepEqual([...c.querySelectorAll<HTMLInputElement>("[data-nino-edad] input")].map((i) => i.value), ["3", "12"]);
  await act(() => boton(c, "Quitar reglas y desvincular").click());
  assert.deepEqual(est.llamadas, [["guardarReglasPromocion", [{
    hotelId: 5, promocionId: 10, baseId: null, reglas: [],
    previas: { base: null, reglas: p.reglas, sigueBase: true, ninoGratis: { activo: true, edadMin: 3, edadMax: 12 } },
    sigueBase: false, ninoGratis: SIN,
  }]]]);
});

test("vista previa fechada: base ganadora por tramo, %, tarifa con promoción y niño (cruce A→B = 585.000 por persona doble en 5 noches)", async () => {
  const c = await montar(panel(promo()));
  assert.equal(c.querySelector("[data-plan-seccion]"), null, "sin modo ni base no hay vista previa");
  await act(() => cambiar(c.querySelector("select")!, "sigue"));
  await act(() => c.querySelector<HTMLInputElement>("[data-nino-gratis] input[type=checkbox]")!.click());
  const t = tramos(c);
  assert.equal(t.length, 2, "dos tramos: base A y base B");
  assert.match(t[0].textContent ?? "", /Base BASE A/); assert.match(t[0].textContent ?? "", /−10%/);
  assert.match(t[0].textContent ?? "", /100\.000.*90\.000/);
  assert.match(t[1].textContent ?? "", /Base BASE B/); assert.match(t[1].textContent ?? "", /150\.000.*135\.000/);
  assert.match(t[1].textContent ?? "", /1 niño gratis por habitación/);
  assert.match(t[1].textContent ?? "", /75\.000.*67\.500/, "niño adicional con promoción");
  assert.equal(c.querySelector("[data-plan-promo]")!.getAttribute("data-plan-promo"), "ok");
});

test("vista previa: empate de prioridad, noche sin base y prioridad insuficiente se explican; nada se «arregla»", async () => {
  const B2 = vig({ id: 3, nombre: "BASE B2", fecha_inicio: "2027-12-04", fecha_fin: "2027-12-05" });
  const c = await montar(panel(promo(), { vigencias: [A, B, B2, PROMO_V], bases: [...BASES, { id: 3, nombre: "BASE B2", prioridad: 1, grupos: [] }] }));
  await act(() => cambiar(c.querySelector("select")!, "sigue"));
  assert.ok(tramos(c).some((x) => x.getAttribute("data-tramo-plan") === "base_empatada"));
  assert.match(c.textContent ?? "", /Empate de prioridad entre bases/);
  await act(async () => { await desmontar?.(); desmontar = undefined; });
  const c2 = await montar(panel(promo(), { vigencias: [A, PROMO_V] }));
  await act(() => cambiar(c2.querySelector("select")!, "sigue"));
  assert.ok(tramos(c2).some((x) => x.getAttribute("data-tramo-plan") === "sin_base"));
  assert.match(c2.textContent ?? "", /Sin temporada base/);
  await act(async () => { await desmontar?.(); desmontar = undefined; });
  const c3 = await montar(panel(promo({ prioridad: 1 }), { vigencias: [A, B, { ...PROMO_V, prioridad: 1 }] }));
  await act(() => cambiar(c3.querySelector("select")!, "sigue"));
  assert.ok(tramos(c3).some((x) => x.getAttribute("data-tramo-plan") === "prioridad_insuficiente"));
});

test("base vinculada a UNA base: las noches de la otra base se muestran sin promoción", async () => {
  const c = await montar(panel(promo()));
  await act(() => cambiar(c.querySelector("select")!, "1"));
  const t = tramos(c);
  assert.equal(t.length, 2);
  assert.equal(t[0].getAttribute("data-ajena"), null);
  assert.equal(t[1].getAttribute("data-ajena"), "true");
  assert.match(t[1].textContent ?? "", /solo actúa sobre su base vinculada/);
});

test("móvil (390 px): lista apilada, sin tablas ni anchos fijos; el diálogo se desplaza dentro de la pantalla", async () => {
  const c = await montar(panel(promo()));
  await act(() => cambiar(c.querySelector("select")!, "sigue"));
  assert.equal(c.querySelectorAll("table").length, 0);
  const dialogo = c.querySelector('[role="dialog"]')!;
  assert.match(dialogo.className, /overflow-y-auto/);
  assert.match(dialogo.firstElementChild!.className, /w-full max-w-2xl/);
  assert.match(c.querySelector("[data-plan-seccion] ul")!.className, /divide-y/);
  assert.doesNotMatch(c.innerHTML, /style="[^"]*width:\s*\d+px/);
});

test("sin vigencias ni tarifas el panel es el de siempre (sin vista previa)", async () => {
  const c = await montar(h(ReglasPromoPanel, { hotelId: 5, promo: promo(), bases: BASES, onCerrar: () => {} } as never));
  await act(() => cambiar(c.querySelector("select")!, "sigue"));
  assert.equal(c.querySelector("[data-plan-seccion]"), null);
});

// ── Calculadora Mixta ──────────────────────────────────────────────────────────────────
const MIXTA = {
  regimen: "PAM", iva_pct: 19,
  acom: { sencilla: { modo: "pax", iva: false }, doble: { modo: "pax", iva: false }, triple: { modo: "pax", iva: false }, multiple: { modo: "pax", iva: false } },
  nino: { iva: false }, pax: { sencilla: 1, doble: 2, triple: 3, multiple: 4 },
  bases: [
    { categoria: "Estándar", temporada: "BASE A", sencilla: 0, doble: 100000, triple: 0, multiple: 0, nino: 50000, nino2: null, infante: null },
    { categoria: "Estándar", temporada: "BASE B", sencilla: 0, doble: 150000, triple: 0, multiple: 0, nino: 75000, nino2: null, infante: null },
    { categoria: "Estándar", temporada: "PRE BF", sencilla: 0, doble: 0, triple: 0, multiple: 0, nino: 0, nino2: null, infante: null },
  ],
};
const editor = (vigencias: unknown[]) => h(CalculadoraEditor, {
  hotelId: 5, categorias: ["Estándar"], temporadas: ["BASE A", "BASE B", "PRE BF"], regimenes: ["PAM"], tipoInicial: "mixta",
  dubaiInicial: null, mixtaInicial: MIXTA, corporativaInicial: null, vigencias, hoy: "2026-11-17", tarifasExistentes: [], versionInicial: 7, gruposCalc: [],
} as never);
async function abrirCalculadora(vigencias: unknown[]) {
  const c = await montar(editor(vigencias));
  await act(() => [...c.querySelectorAll("button")].find((b) => /Tarifa por fórmula/.test(b.textContent ?? ""))!.click());
  return c;
}

test("calculadora Mixta: la promoción que cruza bases muestra su plan por noche y el botón explícito (no escribe filas)", async () => {
  const c = await abrirCalculadora([A, B, PROMO_V]);
  const bloque = c.querySelector<HTMLElement>('[data-cruce-promo="PRE BF"]')!;
  assert.ok(bloque, "bloque de la promoción");
  assert.match(c.textContent ?? "", /cruza varias temporadas base/);
  const t = [...bloque.querySelectorAll<HTMLElement>("[data-tramo-plan]")];
  assert.equal(t.length, 2);
  assert.match(t[0].textContent ?? "", /BASE A/); assert.match(t[0].textContent ?? "", /100\.000.*90\.000/);
  assert.match(t[1].textContent ?? "", /BASE B/); assert.match(t[1].textContent ?? "", /150\.000.*135\.000/);
  assert.equal(est.llamadas.length, 0, "ver la vista previa no hace solicitudes");
  await act(() => boton(bloque, "Calcular por noche sobre la base ganadora").click());
  assert.deepEqual(est.llamadas, [["guardarReglasPromocion", [{
    hotelId: 5, promocionId: 10, baseId: null, reglas: [{ grupo_id: null, valor: 10, dias: null }],
    previas: { base: null, reglas: [], sigueBase: false, ninoGratis: SIN }, sigueBase: true, ninoGratis: SIN,
  }]]], "una sola acción; ninguna escritura de tarifas");
  assert.ok(est.llamadas.every(([n]) => n === "guardarReglasPromocion"));
  assert.match(bloque.textContent ?? "", /ahora se calcula por noche sobre la base ganadora/);
  assert.equal(est.refrescos, 0, "la Server Action ya revalida la página: ningún router.refresh() extra (medido en el app compilado)");
});

test("calculadora Mixta: el servidor rechaza (p. ej. quedan filas guardadas) ⇒ se muestra el motivo, sin reintento ni refresco", async () => {
  est.resp = () => ({ ok: false, error: "La promoción todavía tiene tarifas guardadas." });
  const c = await abrirCalculadora([A, B, PROMO_V]);
  const bloque = c.querySelector<HTMLElement>('[data-cruce-promo="PRE BF"]')!;
  await act(() => boton(bloque, "Calcular por noche sobre la base ganadora").click());
  assert.match(bloque.textContent ?? "", /todavía tiene tarifas guardadas/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(est.llamadas.length, 1);
  assert.equal(est.refrescos, 0);
});

test("calculadora Mixta: sin confirmación no se guarda nada", async () => {
  const antes = globalThis.confirm;
  (globalThis as unknown as { confirm: () => boolean }).confirm = () => false;
  try {
    const c = await abrirCalculadora([A, B, PROMO_V]);
    await act(() => boton(c.querySelector<HTMLElement>('[data-cruce-promo="PRE BF"]')!, "Calcular por noche sobre la base ganadora").click());
    assert.equal(est.llamadas.length, 0);
  } finally { (globalThis as unknown as { confirm: unknown }).confirm = antes; }
});

test("calculadora Mixta: la promoción que ya sigue la base lo dice y no se rechaza ni se ofrece el botón; sus valores tecleados no se derivan", async () => {
  const c = await abrirCalculadora([A, B, { ...PROMO_V, promo_sigue_base: true }]);
  const bloque = c.querySelector<HTMLElement>('[data-cruce-promo="PRE BF"]')!;
  assert.equal(bloque.getAttribute("data-activa"), "true");
  assert.match(bloque.textContent ?? "", /Se calcula por noche sobre la base ganadora/);
  assert.equal(boton(bloque, "Calcular por noche sobre la base ganadora"), undefined);
  assert.doesNotMatch(c.textContent ?? "", /cruza varias temporadas base \(/, "ya no hay aviso de rechazo");
});

test("calculadora Mixta: una promoción de una sola base sigue derivándose como siempre (sin bloque de cruce)", async () => {
  const una = { ...PROMO_V, fecha_inicio: "2027-12-01", fecha_fin: "2027-12-03" };
  const c = await abrirCalculadora([A, B, una]);
  assert.equal(c.querySelector("[data-cruce-promo]"), null);
  assert.match(c.textContent ?? "", /−10% sobre BASE A/);
});
