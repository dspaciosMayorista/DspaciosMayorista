// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/precedencia43.react.ts
// #43/#60 entrega 5 — combinación de una promoción con EBB / Long Stay: sin valores por defecto, orden explícito solo cuando
// algo no acumula (o coinciden las dos reglas), 1 acción al guardar; reglas retenidas y promociones pendientes visibles.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__e5";
const COMB = datos(["guardarCombinacionPromocion", "activarCambioPromocion", "descartarCambioPromocion"]
  .map((n) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return { ok: true }; }`).join("\n"));
const REGLAS = datos(["guardarReglaDescuento", "alternarReglaDescuento", "eliminarReglaDescuento", "aplicarReglaRetenida", "descartarReglaRetenida"]
  .map((n) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return { ok: true }; }`).join("\n"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const padre = context.parentURL ?? "";
    if (specifier === "../actions" && padre.endsWith("/HotelPromociones.tsx")) return { url: COMB, shortCircuit: true };
    if (specifier === "./reglas-descuento-actions" && padre.endsWith("/HotelPromociones.tsx")) return { url: REGLAS, shortCircuit: true };
    if (specifier === "next/navigation" && padre.includes("/producto/hoteles/")) return { url: datos("export function useRouter(){return{push(){},refresh(){},replace(){}}}"), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/5" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const est = { llamadas: [] as [string, unknown[]][] };
(globalThis as unknown as { __e5: typeof est }).__e5 = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { HotelPromociones } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelPromociones.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; est.llamadas.length = 0; });
after(() => dom.window.close());
async function montar(el: unknown) {
  const c = document.createElement("div"); document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => { raiz.render(el as never); await new Promise((r) => setImmediate(r)); });
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const act = (fn: () => void) => React.act(async () => { fn(); await new Promise((r) => setImmediate(r)); });
const boton = (c: HTMLElement, t: string) => [...c.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
const radio = (c: HTMLElement, nombre: string, i: 0 | 1) => c.querySelectorAll<HTMLInputElement>(`input[name="${nombre}"]`)[i];

const PEND = { promocion_id: 10, nombre: "VERANO", requeridas: ["ebb", "long_stay"], requeridas_con_retenidas: ["ebb", "long_stay"], combinacion: { estado: "pendiente", alternativas: ["ebb", "long_stay"], acumulable_ebb: null, acumulable_long_stay: null, orden: null } };
const props = (over = {}) => ({ hotelId: 5, reglas: [{ id: 1, tipo: "ebb", umbral: 30, pct: 12, activa: true, autorizada: true }, { id: 2, tipo: "long_stay", umbral: 7, pct: 15, activa: true, autorizada: false }], combinaciones: [PEND], ...over });

test("estado visible: regla retenida y promoción pendiente, con sus acciones; 0 solicitudes al abrir", async () => {
  const c = await montar(h(HotelPromociones as never, props() as never));
  assert.match(c.textContent!, /Retenida: no se vende hasta configurar/);
  assert.match(c.textContent!, /VERANO.*Pendiente: no se vende hasta configurar con compra anticipada \(EBB\) y larga estadía \(Long Stay\)/);
  assert.ok(boton(c, "Aplicar") && boton(c, "Descartar cambio"));
  assert.equal(est.llamadas.length, 0);
});

test("configurar: nada viene elegido; con las dos reglas siempre se ordena; guardar = 1 acción con el orden del proveedor", async () => {
  const c = await montar(h(HotelPromociones as never, props() as never));
  await act(() => boton(c, "Configurar")!.click());
  assert.equal(radio(c, "acum-ebb", 0).checked || radio(c, "acum-ebb", 1).checked, false, "sin valor por defecto");
  await act(() => boton(c, "Guardar combinación")!.click());
  assert.match(c.textContent!, /Responde, según el proveedor, si la promoción acumula/);
  assert.equal(est.llamadas.length, 0);
  await act(() => radio(c, "acum-ebb", 0).click());      // EBB: sí acumula
  await act(() => radio(c, "acum-long_stay", 1).click()); // Long Stay: no acumula
  assert.match(c.textContent!, /Orden según el proveedor/);
  await act(() => boton(c, "Guardar combinación")!.click());
  assert.match(c.textContent!, /Ordena, según el proveedor/);
  for (const t of ["Compra anticipada (EBB)", "Larga estadía (Long Stay)", "La promoción"]) await act(() => boton(c, t)!.click());
  await act(() => boton(c, "Guardar combinación")!.click());
  assert.deepEqual(est.llamadas, [["guardarCombinacionPromocion", [10, { acumulable: { ebb: true, long_stay: false }, orden: ["ebb", "long_stay", "promocion"] }]]]);
});

test("una sola regla que acumula: no pide orden y guarda sin él", async () => {
  const una = { ...PEND, requeridas: ["ebb"], requeridas_con_retenidas: ["ebb"], combinacion: { ...PEND.combinacion, alternativas: ["ebb"] } };
  const c = await montar(h(HotelPromociones as never, props({ combinaciones: [una] }) as never));
  await act(() => boton(c, "Configurar")!.click());
  await act(() => radio(c, "acum-ebb", 0).click());
  assert.doesNotMatch(c.textContent!, /Orden según el proveedor/);
  await act(() => boton(c, "Guardar combinación")!.click());
  assert.deepEqual(est.llamadas, [["guardarCombinacionPromocion", [10, { acumulable: { ebb: true }, orden: null }]]]);
});

test("aplicar una regla retenida = 1 acción con su id", async () => {
  const c = await montar(h(HotelPromociones as never, props() as never));
  await act(() => boton(c, "Aplicar")!.click());
  assert.deepEqual(est.llamadas, [["aplicarReglaRetenida", [2, 5]]]);
});

// P3: el cambio pendiente de una promoción que se vende llega de la base (persistente): al abrir la ficha se ve, se activa con su
// combinación (1 acción) o se descarta; si la promoción cambió después, no se ofrece activarlo.
const CONF = { promocion_id: 11, nombre: "OTOÑO", requeridas: ["ebb"], requeridas_con_retenidas: ["ebb"],
  combinacion: { estado: "configurada", alternativas: ["ebb"], acumulable_ebb: true, acumulable_long_stay: null, orden: null },
  cambio_pendiente: { cambios: { nombre: "OTOÑO", fecha_inicio: "2027-06-01", fecha_fin: "2027-06-30", compra_inicio: "2026-01-01", compra_fin: "2027-05-31", descuento_valor: 7 },
    faltan: ["long_stay"], propuesto_en: "2026-11-12T20:00:00Z", desactualizado: false } };

test("P3: el cambio pendiente se ve al abrir la ficha, con lo que cambia y qué falta; 0 solicitudes", async () => {
  const c = await montar(h(HotelPromociones as never, props({ combinaciones: [CONF] }) as never));
  const caja = c.querySelector("[data-testid=cambio-pendiente-11]")!;
  assert.ok(caja, "sin caja del pendiente");
  assert.match(caja.textContent!, /Cambio pendiente de activar/);
  assert.match(caja.textContent!, /compra 2026-01-01 a 2027-05-31/);
  assert.match(caja.textContent!, /Falta configurar con larga estadía \(Long Stay\)\. Se sigue vendiendo la versión autorizada/);
  assert.equal(est.llamadas.length, 0);
});

test("P3: configurar y activar = 1 acción con la combinación de TODAS las reglas que coinciden", async () => {
  const c = await montar(h(HotelPromociones as never, props({ combinaciones: [CONF] }) as never));
  await act(() => boton(c, "Configurar y activar")!.click());
  await act(() => radio(c, "acum-long_stay", 0).click());
  assert.match(c.textContent!, /Orden según el proveedor/, "dos reglas: siempre se ordena");
  for (const t of ["La promoción", "Compra anticipada (EBB)", "Larga estadía (Long Stay)"]) await act(() => boton(c, t)!.click());
  await act(() => boton(c, "Guardar combinación")!.click());
  assert.deepEqual(est.llamadas, [["activarCambioPromocion", [11, { acumulable: { ebb: true, long_stay: true }, orden: ["promocion", "ebb", "long_stay"] }]]]);
});

test("P3: descartar = 1 acción; desactualizado no ofrece activar", async () => {
  const c = await montar(h(HotelPromociones as never, props({ combinaciones: [{ ...CONF, cambio_pendiente: { ...CONF.cambio_pendiente, desactualizado: true } }] }) as never));
  assert.equal(boton(c, "Configurar y activar"), undefined);
  assert.match(c.textContent!, /cambió después de dejar este cambio pendiente/);
  const caja = c.querySelector("[data-testid=cambio-pendiente-11]") as HTMLElement;
  await act(() => boton(caja, "Descartar cambio")!.click());
  assert.deepEqual(est.llamadas, [["descartarCambioPromocion", [11]]]);
});
