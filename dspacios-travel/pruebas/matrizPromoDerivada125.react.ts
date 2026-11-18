// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/matrizPromoDerivada125.react.ts
// #125 — matriz DERIVADA de promociones por noche en «Tarifas generadas» y en la vista previa de las calculadoras Mixta y DUBAI (Dubai se verifica por sí mismo),
// ruta de descubrimiento (#cruce-bases) y flujo de una sola promoción para dos bases. Componentes REALES, acciones sustituidas. Importes calculados a mano.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__m125";
const reg = (n: string) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return { ok: true, version: 8 }; }`;
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
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/5", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};
const est = { llamadas: [] as [string, unknown[]][], refrescos: 0 };
(globalThis as unknown as { __m125: typeof est }).__m125 = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { PromocionesDinamicasBox } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/PromocionesDinamicasBox.tsx");
const { CalculadoraEditor } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx");
const { promocionesDinamicasHotel } = await import("../lib/hoteles/promocionesDinamicas.ts");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; est.llamadas.length = 0; est.refrescos = 0; });
const limpiar = async () => { await desmontar?.(); desmontar = undefined; };
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
const norm = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const cambiar = (el: HTMLSelectElement, v: string) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
};
const esperar = (ms = 30) => React.act(async () => { await new Promise((r) => setTimeout(r, ms)); });

// ── Datos sintéticos (fechas 2027 para coincidir con las capturas del dueño): BASE A 1–5 dic, BASE B 6–12 dic, PRE BF 4–8 dic (P5, −10 %).
const vig = (o: Record<string, unknown>) => ({ fecha_inicio: null, fecha_fin: null, prioridad: 1, tipo: "tarifa", compra_inicio: null, compra_fin: null, regimen_restringido: null, ...o });
const A = vig({ id: 1, nombre: "BASE A", fecha_inicio: "2027-12-01", fecha_fin: "2027-12-05" });
const B = vig({ id: 2, nombre: "BASE B", fecha_inicio: "2027-12-06", fecha_fin: "2027-12-12" });
const PRE_SIN = vig({ id: 10, nombre: "PRE BF", fecha_inicio: "2027-12-04", fecha_fin: "2027-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
const PRE_SIGUE = { ...PRE_SIN, promo_sigue_base: true, reglas: [{ grupo_id: null, valor: 10, dias: null }] };
const DUBAI = {
  regimen_base: "PAM",
  modificadores: { sencilla_pct: 20, pax3_pct: -15, pax4_pct: -25, nino_pct: -50, nino2_pct: -60, infante_pct: -80 },
  suplementos: [{ regimen: "FULL", monto: 30_000 }],
  bases: [{ categoria: "Estandar", temporada: "BASE A", precio: 100_000 }, { categoria: "Estandar", temporada: "BASE B", precio: 150_000 }], promos: [],
};
const MIXTA = {
  regimen: "PAM", iva_pct: 19,
  acom: { sencilla: { modo: "pax", iva: false }, doble: { modo: "pax", iva: false }, triple: { modo: "pax", iva: false }, multiple: { modo: "pax", iva: false } },
  nino: { iva: false }, pax: { sencilla: 1, doble: 2, triple: 3, multiple: 4 },
  bases: [
    { categoria: "Estandar", temporada: "BASE A", sencilla: 120000, doble: 100000, triple: 95000, multiple: 90000, nino: 50000, nino2: 40000, infante: 20000 },
    { categoria: "Estandar", temporada: "BASE B", sencilla: 180000, doble: 150000, triple: 140000, multiple: 135000, nino: 75000, nino2: 60000, infante: 30000 },
    // Fila tecleada de la promoción por noche: en la pantalla NO debe aparecer como casillas editables en cero.
    { categoria: "Estandar", temporada: "PRE BF", sencilla: 0, doble: 0, triple: 0, multiple: 0, nino: 0, nino2: null, infante: null },
  ],
};
const editor = (tipo: "dubai" | "mixta", vigencias: unknown[]) => h(CalculadoraEditor, {
  hotelId: 5, categorias: ["Estandar"], temporadas: ["BASE A", "BASE B", "PRE BF"], regimenes: tipo === "dubai" ? ["PAM", "FULL"] : ["PAM"], tipoInicial: tipo,
  dubaiInicial: tipo === "dubai" ? DUBAI : null, mixtaInicial: tipo === "mixta" ? MIXTA : null, corporativaInicial: null,
  vigencias, hoy: "2026-11-17", tarifasExistentes: [], versionInicial: 7, gruposCalc: [],
} as never);
async function abrir(tipo: "dubai" | "mixta", vigencias: unknown[]) {
  const c = await montar(editor(tipo, vigencias));
  await act(() => [...c.querySelectorAll("button")].find((b) => /Tarifa por fórmula/.test(b.textContent ?? ""))!.click());
  return c;
}
const tarjetas = (c: ParentNode) => [...c.querySelectorAll("[data-bloque-promo]")].map((b) => ({
  bloque: b.getAttribute("data-bloque-promo"), tarjetas: [...b.querySelectorAll("[data-categoria-promo]")].map((t) => [...t.querySelectorAll("p, button")].map((x) => norm(x.textContent)).join(" ")),
}));

test("Tarifas generadas: una promoción, dos bloques (BASE A 4–5 dic y BASE B 6–8 dic), cada uno con categoría, regímenes y sus 7 tarifas; el detalle trae las SIETE acomodaciones con los importes a mano", async () => {
  const filas = [
    { temporada: "BASE A", grupo_id: null, tipo_habitacion: "Estandar", alimentacion: "PAM", neto_sencilla: 120000, neto_doble: 100000, neto_triple: 95000, neto_multiple: 90000, neto_nino: 50000, neto_nino2: 40000, neto_infante: 20000 },
    { temporada: "BASE B", grupo_id: null, tipo_habitacion: "Estandar", alimentacion: "PAM", neto_sencilla: 180000, neto_doble: 150000, neto_triple: 140000, neto_multiple: 135000, neto_nino: 75000, neto_nino2: 60000, neto_infante: 30000 },
  ];
  const fichas = [A, B, PRE_SIN].map((v) => ({ ...v, hotel_promocion_reglas: v === PRE_SIN ? [{ grupo_id: null, valor: 10, dias: null }] : null, promo_sigue_base: v === PRE_SIN, hotel_promocion_combinacion: null }));
  const c = await montar(h(PromocionesDinamicasBox as never, { promos: promocionesDinamicasHotel(fichas as never, filas as never, [], "COP"), moneda: "COP" }));
  const t = norm(c.textContent);
  assert.match(t, /PRE BF · prioridad 5 · descuento %/);
  assert.match(t, /Por noche, sobre la base ganadora · −10%/);
  assert.match(t, /tarifas de alojamiento del hotel por persona y noche/);
  assert.match(t, /no vuelve cero la tarifa genérica de niño/);
  const bloques = tarjetas(c);
  assert.equal(bloques.length, 2);
  assert.match(bloques[0].bloque!, /^BASE A · 4 de diciembre de 2027 → 5 de diciembre de 2027 · todos los días$/);
  assert.match(bloques[1].bloque!, /^BASE B · 6 de diciembre de 2027 → 8 de diciembre de 2027 · todos los días$/);
  assert.deepEqual(bloques[0].tarjetas, ["Estandar PAM · 7 tarifas desde $ 81.000 por persona Ver tarifas"]);
  assert.deepEqual(bloques[1].tarjetas, ["Estandar PAM · 7 tarifas desde $ 121.500 por persona Ver tarifas"]);
  assert.equal(c.querySelectorAll("input").length, 0, "solo lectura: ninguna casilla editable");
  // Detalle de BASE B (modal compartido).
  await act(() => c.querySelector<HTMLButtonElement>('[data-bloque-promo^="BASE B"] [data-categoria-promo] button')!.click());
  await esperar();
  const d = document.querySelector<HTMLElement>('[role="dialog"]')!;
  assert.deepEqual([...d.querySelectorAll("[data-linea-promo]")].map((e) => norm(e.textContent)), [
    "Sencilla: $ 180.000 − 10 % = $ 162.000",
    "Doble: $ 150.000 − 10 % = $ 135.000",
    "Triple: $ 140.000 − 10 % = $ 126.000",
    "Múltiple: $ 135.000 − 10 % = $ 121.500",
    "Niño 1: $ 75.000 − 10 % = $ 67.500",
    "Niño 2: $ 60.000 − 10 % = $ 54.000",
    "Infante: $ 30.000 (conserva su tarifa base; la promoción no la descuenta)",
  ]);
});

test("Tarifas generadas: sin permiso de netos no hay ningún importe (la matriz derivada tampoco se filtra)", async () => {
  const c = await montar(h(PromocionesDinamicasBox as never, { promos: null, moneda: "COP" }));
  assert.equal(c.querySelector("[data-promos-dinamicas]")?.getAttribute("data-promos-dinamicas"), "sin-permiso");
  assert.doesNotMatch(c.textContent ?? "", /\d{2,3}\.\d{3}/);
});

test("Mixta: la fila de la promoción por noche NO es editable ni muestra ceros; la matriz derivada va aparte, de solo lectura, con el mismo agrupamiento", async () => {
  const c = await abrir("mixta", [A, B, PRE_SIGUE]);
  const fila = c.querySelector<HTMLElement>('[data-promo-dinamica-fila="PRE BF"]')!;
  assert.ok(fila, "fila dinámica");
  assert.equal(fila.querySelectorAll("input").length, 0, "sin casillas en cero");
  assert.match(norm(fila.textContent), /Promo dinámica/);
  assert.match(norm(fila.textContent), /Se calcula por noche sobre la base ganadora: no se teclean ni se guardan valores aquí/);
  const caja = c.querySelector<HTMLElement>('[data-promos-dinamicas="vista-previa"]')!;
  assert.ok(caja, "matriz derivada en la vista previa");
  assert.match(norm(caja.textContent), /Tarifas resultantes de promociones por noche/);
  assert.match(norm(caja.textContent), /Calculadas · solo lectura/);
  assert.deepEqual(tarjetas(caja).map((b) => b.bloque), [
    "BASE A · 4 de diciembre de 2027 → 5 de diciembre de 2027 · todos los días",
    "BASE B · 6 de diciembre de 2027 → 8 de diciembre de 2027 · todos los días",
  ]);
  assert.deepEqual(tarjetas(caja).map((b) => b.tarjetas[0]), [
    "Estandar PAM · 7 tarifas desde $ 81.000 por persona Ver tarifas",
    "Estandar PAM · 7 tarifas desde $ 121.500 por persona Ver tarifas",
  ]);
  assert.equal(caja.querySelectorAll("input").length, 0);
  assert.equal(est.llamadas.length, 0, "abrir y mostrar la matriz no hace ninguna solicitud");
  assert.equal(est.refrescos, 0);
});

test("Dubai (propio): una promoción cruza BASE A → BASE B: la sección #cruce-bases la lista UNA vez con su vista previa fechada (PAM y, tras elegir FULL, con el suplemento dentro)", async () => {
  const c = await abrir("dubai", [A, B, PRE_SIN]);
  const sec = c.querySelector<HTMLElement>("#cruce-bases")!;
  assert.ok(sec, "la sección existe y está anclada");
  assert.equal(sec.getAttribute("data-seccion-cruce-bases"), "dubai");
  assert.match(norm(sec.textContent), /Una promoción sobre varias bases sucesivas/);
  assert.match(norm(sec.textContent), /no hace falta una promoción por base/);
  assert.match(norm(sec.textContent), /tarifa completa del régimen de cada base/);
  assert.equal(sec.querySelectorAll("[data-cruce-promo]").length, 1, "una sola promoción");
  const t = () => [...sec.querySelectorAll<HTMLElement>("[data-tramo-plan]")].map((x) => norm(x.textContent));
  assert.equal(t().length, 2);
  assert.match(t()[0], /Base BASE A/); assert.match(t()[0], /100\.000.*90\.000/);
  assert.match(t()[1], /Base BASE B/); assert.match(t()[1], /150\.000.*135\.000/);
  await act(() => cambiar(c.querySelector<HTMLSelectElement>("#cruce-bases")!.parentElement!.querySelector("select")!, "FULL"));
  assert.match(t()[0], /130\.000.*117\.000/, "FULL BASE A: (100.000 + 30.000) × 0,9");
  assert.match(t()[1], /180\.000.*162\.000/, "FULL BASE B: (150.000 + 30.000) × 0,9");
  assert.equal(est.llamadas.length, 0, "ver la vista previa y cambiar de régimen no hace solicitudes");
});

test("Dubai (propio): el botón explícito guarda UNA acción con la regla del % (sin crear un par por base) y no escribe tarifas", async () => {
  const c = await abrir("dubai", [A, B, PRE_SIN]);
  await act(() => boton(c.querySelector<HTMLElement>('[data-cruce-promo="PRE BF"]')!, "Calcular por noche sobre la base ganadora").click());
  assert.deepEqual(est.llamadas.map(([n]) => n), ["guardarReglasPromocion"]);
  assert.deepEqual((est.llamadas[0][1][0] as Record<string, unknown>).reglas, [{ grupo_id: null, valor: 10, dias: null }]);
  assert.equal((est.llamadas[0][1][0] as Record<string, unknown>).sigueBase, true);
  assert.equal(est.refrescos, 0);
});

test("Dubai (propio): promoción ya configurada → matriz derivada completa en la vista previa (14 tarifas por tramo: PAM y FULL × 7) y mensaje de estado", async () => {
  const c = await abrir("dubai", [A, B, PRE_SIGUE]);
  assert.equal(c.querySelector('[data-cruce-promo="PRE BF"]')!.getAttribute("data-activa"), "true");
  const caja = c.querySelector<HTMLElement>('[data-promos-dinamicas="vista-previa"]')!;
  assert.deepEqual(tarjetas(caja).map((b) => b.tarjetas[0]), [
    "Estandar FULL · PAM · 14 tarifas desde $ 81.000 por persona Ver tarifas",
    "Estandar FULL · PAM · 14 tarifas desde $ 121.500 por persona Ver tarifas",
  ]);
  await act(() => caja.querySelector<HTMLButtonElement>('[data-bloque-promo^="BASE B"] [data-categoria-promo] button')!.click());
  await esperar();
  const d = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const lineas = (r: string) => [...d.querySelectorAll(`[data-regimen-promo="${r}"] [data-linea-promo]`)].map((e) => norm(e.textContent));
  assert.deepEqual(lineas("FULL"), [
    "Sencilla: $ 210.000 − 10 % = $ 189.000", "Doble: $ 180.000 − 10 % = $ 162.000", "Triple: $ 172.500 − 10 % = $ 155.250", "Múltiple: $ 165.000 − 10 % = $ 148.500",
    "Niño 1: $ 105.000 − 10 % = $ 94.500", "Niño 2: $ 90.000 − 10 % = $ 81.000", "Infante: $ 60.000 (conserva su tarifa base; la promoción no la descuenta)",
  ]);
  assert.deepEqual(lineas("PAM"), [
    "Sencilla: $ 180.000 − 10 % = $ 162.000", "Doble: $ 150.000 − 10 % = $ 135.000", "Triple: $ 142.500 − 10 % = $ 128.250", "Múltiple: $ 135.000 − 10 % = $ 121.500",
    "Niño 1: $ 75.000 − 10 % = $ 67.500", "Niño 2: $ 60.000 − 10 % = $ 54.000", "Infante: $ 30.000 (conserva su tarifa base; la promoción no la descuenta)",
  ]);
});

test("Dubai (propio): el par «base → promo» existente se conserva, avisa cuando esa vigencia cruza varias bases; sin vigencias cruzadas no cambia nada", async () => {
  const conPar = { ...DUBAI, promos: [{ temporadaBase: "BASE A", temporadaPromo: "PRE BF", regimen: "PAM", descuentoPct: 10 }] };
  const c = await montar(h(CalculadoraEditor, {
    hotelId: 5, categorias: ["Estandar"], temporadas: ["BASE A", "BASE B", "PRE BF"], regimenes: ["PAM", "FULL"], tipoInicial: "dubai", dubaiInicial: conPar, mixtaInicial: null, corporativaInicial: null,
    vigencias: [A, B, PRE_SIN], hoy: "2026-11-17", tarifasExistentes: [], versionInicial: 7, gruposCalc: [],
  } as never));
  await act(() => [...c.querySelectorAll("button")].find((b) => /Tarifa por fórmula/.test(b.textContent ?? ""))!.click());
  // El par de siempre se conserva (sigue generando su vista previa) y avisa que esa vigencia cruza varias bases; la sección la ofrece UNA vez.
  assert.match(norm(c.textContent), /Vista previa — promociones/);
  assert.match(norm(c.querySelector("[data-aviso-cruza]")?.textContent), /cubre noches de varias bases: no necesitas una promoción por base/);
  assert.equal(c.querySelectorAll('[data-cruce-promo="PRE BF"]').length, 1);
  assert.equal(est.llamadas.length, 0, "el aviso no cambia ni guarda nada");
  const una = await abrir("dubai", [A, B, { ...PRE_SIN, fecha_inicio: "2027-12-01", fecha_fin: "2027-12-03" }]);
  assert.equal(una.querySelectorAll("[data-cruce-promo]").length, 0, "una promoción de una sola base no entra al flujo de varias bases");
  assert.ok(una.querySelector("[data-cruce-vacio]"), "la sección sigue visible con los pasos para crear una");
});

test("descubrimiento: Mixta y Dubai muestran SIEMPRE la sección anclada #cruce-bases, con los 3 pasos cuando aún no hay promoción cruzada", async () => {
  for (const tipo of ["mixta", "dubai"] as const) {
    const c = await abrir(tipo, [A, B]);
    const sec = c.querySelector<HTMLElement>("#cruce-bases")!;
    assert.ok(sec, `${tipo}: sección visible`);
    assert.equal(sec.querySelectorAll("[data-cruce-vacio] li").length, 3);
    await limpiar();
  }
});

// VERIF-2 (2026-11-18): el enlace directo `…?tab=temporadas#cruce-bases` NO llegaba a ningún lado: la sección vive dentro del editor, que nace cerrado, y el ancla no existía al cargar.
test("enlace directo #cruce-bases: el editor se abre solo (sin clic) y la sección existe; sin el hash sigue cerrado (Mixta y Dubai)", async () => {
  for (const tipo of ["mixta", "dubai"] as const) {
    dom.reconfigure({ url: "http://localhost/dashboard/producto/hoteles/5?tab=temporadas#cruce-bases" });
    const abierto = await montar(editor(tipo, [A, B, PRE_SIGUE]));
    await esperar();
    assert.ok(abierto.querySelector("#cruce-bases"), `${tipo}: con el hash la sección existe sin pulsar «Tarifa por fórmula»`);
    await limpiar();
    dom.reconfigure({ url: "http://localhost/dashboard/producto/hoteles/5?tab=temporadas" });
    const cerrado = await montar(editor(tipo, [A, B, PRE_SIGUE]));
    await esperar();
    assert.equal(cerrado.querySelector("#cruce-bases"), null, `${tipo}: sin el hash el editor sigue cerrado`);
    await limpiar();
  }
  assert.equal(est.llamadas.length, 0, "abrir por enlace no dispara ninguna acción de servidor");
});
