// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/gruposDias299.react.ts
// #43/#60 entrega 3c — panel de grupos con la venta: abrir = 1 lectura; revisar la aplicación = 1 lectura de alcance;
// confirmar = 1 escritura; habilitaciones una por una (nada marcado); bloqueos de la base impiden aplicar; volver a
// «todos los días» exige elegir cada combinación; obsoleta pide recargar sin reintento; StrictMode y reposo sin solicitudes.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const G = "globalThis.__g299r";
const GRUPOS = datos(["leerConfigGrupos", "guardarGruposVigencia", "guardarPropuestaGrupos", "borrarGrupoDias", "leerAlcanceGrupos",
  "aplicarGruposVenta", "descartarBorradorGrupos", "volverATodosLosDias"]
  .map((n) => `export async function ${n}(...a) { ${G}.llamadas.push(['${n}', a]); return ${G}.resp('${n}'); }`).join("\n"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./grupos-actions" && (context.parentURL ?? "").endsWith("/GruposDiasPanel.tsx")) return { url: GRUPOS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/producto/hoteles/5" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const S = "00000000-0000-4000-8000-0000000000a1", F = "00000000-0000-4000-8000-0000000000a2";
const NV = { neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null };
const EV = { nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null };
const prop = (id: number, g: string, netos: Record<string, number>) => ({ id, grupo_id: g, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NV, ...EV, ...netos, origen_tarifa_id: null });
const PREPARADO = {
  vigencia: { id: 10, nombre: "ALTA", hotel_id: 5, tipo: "tarifa", nombre_repetido: false }, hotel: { id: 5, modelo_tarifario: "persona" },
  categorias: ["Estándar"], regimenes: ["PAM"],
  grupos: [{ id: S, nombre: "Semana", dias: [1, 2, 3, 4], activo: false }, { id: F, nombre: "Finde", dias: [5, 6, 7], activo: false }],
  propuestas: [prop(1, S, { neto_doble: 95000, neto_triple: 80000 }), prop(2, F, { neto_doble: 130000 })],
  origen: [{ id: 77, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NV, ...EV, neto_doble: 100000, huella: "h" }],
  vigentes: [], promociones: [], huella: "H1", estado: "preparado", compra_cerrada: false,
};
const ACTIVO = {
  ...PREPARADO, estado: "activo", origen: [], huella: "H2",
  grupos: PREPARADO.grupos.map((g) => ({ ...g, activo: true })),
  vigentes: [{ ...prop(21, S, { neto_doble: 95000, neto_triple: 80000 }) }, { ...prop(22, F, { neto_doble: 130000 }) }],
};
const HAB = { grupo_id: S, grupo: "Semana", tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "triple", nuevo: 80000, hoy: null };
const alcance = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...c, habilitaciones: [], empates: [], edades_conflicto: [], obsoletas: [], dias_sin_grupo: [], pendientes: 1, otras_con_grupos: 0, ...extra,
});
const est = {
  llamadas: [] as [string, unknown[]][],
  respuestas: {} as Record<string, unknown>,
  resp: (n: string): unknown => est.respuestas[n] ?? { ok: true, config: PREPARADO },
};
(globalThis as unknown as { __g299r: typeof est }).__g299r = est;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { GruposDiasPanel } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/GruposDiasPanel.tsx");
const h = React.createElement;
let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; est.llamadas.length = 0; est.respuestas = {}; });
after(() => dom.window.close());
async function montar(el: unknown) {
  const c = document.createElement("div"); document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => { raiz.render(el as never); await new Promise((r) => setImmediate(r)); });
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
const boton = (r: Element, t: string | RegExp) => [...r.querySelectorAll("button")].find((b) => typeof t === "string" ? (b.textContent ?? "").trim() === t : t.test(b.textContent ?? "")) as HTMLButtonElement;
const nombres = () => est.llamadas.map((l) => l[0]);
const panel = () => h(GruposDiasPanel, { temporadaId: 10, nombreVigencia: "ALTA", onCerrar: () => {}, onGruposCambiados: () => {} });
const reposo = () => React.act(async () => { await new Promise((r) => setTimeout(r, 50)); });

test("preparado: revisar = 1 lectura de alcance; nada marcado; aplicar solo tras confirmar cada habilitación; 1 escritura", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: PREPARADO };
  est.respuestas.leerAlcanceGrupos = { ok: true, alcance: alcance(PREPARADO, { habilitaciones: [HAB], pendientes: 3 }) };
  est.respuestas.aplicarGruposVenta = { ok: true, config: ACTIVO, resumen: {}, regeneracion: { paquetes: 3, actualizados: 3, enCurso: 0, fallidos: [] } };
  const r = await montar(panel());
  assert.match(r.querySelector("[data-estado]")!.textContent ?? "", /Preparado — no se vende todavía/);
  await pulsar(boton(r, "Revisar aplicación a la venta"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "leerAlcanceGrupos"]);
  const rev = r.querySelector('[data-revision="venta"]')!;
  assert.match(rev.textContent ?? "", /Se pondrá a la venta ALTA por grupos de días/);
  assert.match(rev.textContent ?? "", /Semana \(L M X J\) · Estándar \/ PAM · Doble: 100\.000 → 95\.000/);
  assert.match(rev.textContent ?? "", /«Desde» publicado.*deja de mostrarse/);
  const casillas = [...rev.querySelectorAll<HTMLInputElement>('fieldset[aria-label="Acomodaciones que pasan a venderse"] input[type=checkbox]')];
  assert.equal(casillas.length, 1);
  assert.equal(casillas[0].checked, false, "nada viene marcado");
  const aplicar = boton(r, "Aplicar a la venta");
  assert.equal(aplicar.disabled, true);
  await pulsar(casillas[0]);
  assert.equal(boton(r, "Aplicar a la venta").disabled, false);
  assert.deepEqual(nombres(), ["leerConfigGrupos", "leerAlcanceGrupos"], "revisar y marcar no hacen solicitudes");
  await pulsar(boton(r, "Aplicar a la venta"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "leerAlcanceGrupos", "aplicarGruposVenta"]);
  assert.deepEqual(est.llamadas[2][1], [10, "H1", [{ grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "triple" }]]);
  assert.match(r.querySelector("[data-estado]")!.textContent ?? "", /Se vende por grupos de días/);
  assert.match(r.textContent ?? "", /Aplicado a la venta.*3 tarifario\(s\) regenerado\(s\)/);
  assert.equal(r.querySelector('[role="alert"]'), null, "sin fallos de regeneración no hay alerta");
});

test("aplicar con un paquete que no se regeneró: lo dice como error, nunca «todo actualizado»", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: PREPARADO };
  est.respuestas.leerAlcanceGrupos = { ok: true, alcance: alcance(PREPARADO, { paquetes_porcion: 2 }) };
  est.respuestas.aplicarGruposVenta = { ok: true, config: ACTIVO, resumen: {}, regeneracion: { paquetes: 3, actualizados: 1, enCurso: 0, fallidos: [{ paqueteId: 7, error: "x" }, { paqueteId: 9, error: "y" }] } };
  const r = await montar(panel());
  await pulsar(boton(r, "Revisar aplicación a la venta"));
  assert.match(r.querySelector('[data-revision="venta"]')!.textContent ?? "", /2 paquete\(s\) de porción terrestre.*DEJARÁN DE MOSTRARSE/);
  await pulsar(boton(r, "Aplicar a la venta"));
  const alerta = r.querySelector('[role="alert"]')!;
  assert.match(alerta.textContent ?? "", /2 NO se pudieron regenerar \(paquete #7, #9\)/);
  assert.doesNotMatch(r.textContent ?? "", /todo.*actualizado/i);
});

test("cancelar la revisión no escribe nada", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: PREPARADO };
  est.respuestas.leerAlcanceGrupos = { ok: true, alcance: alcance(PREPARADO) };
  const r = await montar(panel());
  await pulsar(boton(r, "Revisar aplicación a la venta"));
  await pulsar(boton(r, "Cancelar (no cambia nada)"));
  assert.equal(r.querySelector('[data-revision="venta"]'), null);
  assert.deepEqual(nombres(), ["leerConfigGrupos", "leerAlcanceGrupos"]);
});

test("un empate (o cualquier bloqueo de la base) se muestra y no deja aplicar", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: PREPARADO };
  est.respuestas.leerAlcanceGrupos = { ok: true, alcance: alcance(PREPARADO, { empates: [{
    a: { id: 10, nombre: "ALTA", con_grupos: true }, b: { id: 11, nombre: "PUENTE", con_grupos: false }, prioridad: 1,
    tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "doble", desde: "2027-01-10", hasta: "2027-01-12", noches: 3 }] }) };
  const r = await montar(panel());
  await pulsar(boton(r, "Revisar aplicación a la venta"));
  const alerta = r.querySelector('[data-revision="venta"] [role="alert"]')!;
  assert.match(alerta.textContent ?? "", /Empate de prioridad entre ALTA y PUENTE \(las dos con prioridad 1\).*del 10\/01\/2027 al 12\/01\/2027/);
  assert.equal(boton(r, "Aplicar a la venta").disabled, true);
});

test("confirmación obsoleta: aviso con «Recargar», sin reintento", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: PREPARADO };
  est.respuestas.leerAlcanceGrupos = { ok: true, alcance: alcance(PREPARADO) };
  est.respuestas.aplicarGruposVenta = { ok: false, desactualizada: true, error: "la configuración de esta vigencia cambió desde que la abriste." };
  const r = await montar(panel());
  await pulsar(boton(r, "Revisar aplicación a la venta"));
  await pulsar(boton(r, "Aplicar a la venta"));
  await reposo();
  assert.ok(boton(r, /Recargar/));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "leerAlcanceGrupos", "aplicarGruposVenta"], "una sola escritura, sin reintento");
});

test("activo: días bloqueados, «Se vende hoy», descartar (1 escritura) y volver con elección explícita", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: ACTIVO };
  est.respuestas.descartarBorradorGrupos = { ok: true, config: ACTIVO };
  est.respuestas.volverATodosLosDias = { ok: true, config: { ...PREPARADO, huella: "H3" }, nuevas: 1, quitadas: 2 };
  const r = await montar(panel());
  assert.match(r.querySelector("[data-estado]")!.textContent ?? "", /Se vende por grupos de días/);
  const dias = [...r.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label^="Días del grupo"] button')];
  assert.ok(dias.length >= 7 && dias.every((b) => b.disabled), "los días de grupos que se venden no se cambian");
  assert.match(r.querySelector("[data-vigente]")!.textContent ?? "", /Doble 95\.000 · Triple 80\.000/);
  await pulsar(boton(r, "Descartar borrador"));
  await pulsar(boton(r, "Confirmar descarte"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "descartarBorradorGrupos"]);
  await pulsar(boton(r, /Volver a todos los días/));
  const radios = [...r.querySelectorAll<HTMLInputElement>('[data-revision="volver"] input[type=radio]')];
  assert.equal(radios.length, 3, "dos grupos + «No conservar»");
  assert.equal(radios.some((x) => x.checked), false, "nada viene elegido");
  assert.equal(boton(r, "Confirmar volver a todos los días").disabled, true);
  await pulsar(radios[1]);  // la del Finde
  await pulsar(boton(r, "Confirmar volver a todos los días"));
  assert.deepEqual(nombres(), ["leerConfigGrupos", "descartarBorradorGrupos", "volverATodosLosDias"]);
  assert.deepEqual(est.llamadas[2][1], [10, "H2", [{ tipo_habitacion: "Estándar", alimentacion: "PAM", grupo_id: F }]]);
});

test("activo: borrar el único grupo que se vende no se puede confirmar", async () => {
  const uno = { ...ACTIVO, grupos: [ACTIVO.grupos[0], { ...ACTIVO.grupos[1], activo: false }] };
  est.respuestas.leerConfigGrupos = { ok: true, config: uno };
  const r = await montar(panel());
  await pulsar([...r.querySelectorAll("button")].filter((b) => /Borrar grupo/.test(b.textContent ?? ""))[0]);
  assert.match(r.textContent ?? "", /único grupo que se vende/);
  assert.equal(boton(r, "Confirmar borrado").disabled, true);
});

test("StrictMode y reposo: una sola lectura al abrir y ninguna solicitud después", async () => {
  est.respuestas.leerConfigGrupos = { ok: true, config: ACTIVO };
  await montar(h(React.StrictMode, null, panel()));
  await reposo(); await reposo();
  assert.deepEqual(nombres(), ["leerConfigGrupos"]);
});
