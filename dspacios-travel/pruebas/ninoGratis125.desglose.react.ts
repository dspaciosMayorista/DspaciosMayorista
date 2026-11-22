// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #125 × #102 — hallazgo I1 de la re-auditoría integrada. El MOTOR REAL (`evaluarComposicionHotel`) arma el desglose y los COMPONENTES REALES (tarjeta `DesgloseTarifas` y `TablaResultadosBusqueda`,
// estadía y noche adicional) lo pintan en jsdom: se afirman los IMPORTES POR PASAJERO, la explicación del niño gratis y que lo mostrado SUMA el total (no solo el total).
// Antes de la corrección: adultos 250.000 + niño 169.000 mostrados contra un total de 250.000, sin explicar el beneficio.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { AcomConfig } from "../lib/acomodaciones.ts";
import type { ComboCotizado } from "../lib/reservar/liquidacionHotel.ts";
import { evaluarComposicionHotel, type ComboEvaluado, type EntradaComposicion } from "../lib/reservar/composicionHotelBusqueda.ts";
import { desgloseNocheAdicional, sumaDesglose } from "../lib/reservar/ninoGratisDesglose.ts";
import { componerTarifa, marcar } from "../lib/calc/paquetes.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.getBoundingClientRect = function () { return { width: 900, height: 40, top: 0, left: 0, right: 900, bottom: 40, x: 0, y: 0, toJSON() {} }; };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { TablaResultadosBusqueda } = await import("../app/tarifario/TablaResultadosBusqueda.tsx");
const { DesgloseTarifas } = await import("../app/tarifario/desgloseTarifas.tsx");
const h = React.createElement;

// ── Datos sintéticos ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CFG = (chdMin = 0): AcomConfig[] => [
  { acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: chdMin, chd_max: 2, inf_min: 0, inf_max: 2 },
];
const noche = (indice: number, neto: number, promocion: string, edadMin: number | null = null, edadMax: number | null = null) => ({ indice, neto, promocion, edadMin, edadMax });
const BASE = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [] };
const num = (s: string) => Number(s.replace(/[^\d-]/g, ""));
const moneda = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n).replace(/\s/g, " ");

function combo(over: Partial<ComboCotizado>): ComboCotizado {
  return { categoria: "Estandar", regimen: "PAM", temporadasTarifaPorAcom: {}, precios: {}, netos: {}, ...over } as ComboCotizado;
}
function motor(c: ComboCotizado, o: { adultos?: number; edades: number[]; habitaciones?: number; base?: Record<string, unknown>; noches?: number; chdMin?: number }): ComboEvaluado {
  const e: EntradaComposicion = {
    res: { combos: [c], serviciosGrupoIncluidos: [], composicionBase: (o.base ?? BASE) as never, moneda: "COP" } as never,
    filasTarifa: [], pctMk: (o.base as { pctMk?: number } | undefined)?.pctMk ?? 0.2, numNoches: o.noches ?? 3, adultos: o.adultos ?? 2, edades: o.edades,
    reglasAcom: CFG(o.chdMin ?? 0), generalEdad: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 }, numHabitaciones: o.habitaciones ?? 1,
  };
  const r = evaluarComposicionHotel(e);
  assert.equal(r.combos.length, 1, `el motor debe ofrecer el combo (rechazos: ${r.rechazos.join(" | ")})`);
  return r.combos[0];
}
function resultadoDe(c: ComboEvaluado & { nocheAdicional?: unknown }, noches = 3, ocup = { numHabitaciones: 1, adultos: 2, edadesMenores: [8] as number[] }) {
  const r = {
    hotelId: 912503, hotelNombre: "Hotel PRE BF 125 ACTIVO", destino: "DEMO 125", paqueteId: 912503, paqueteNombre: "Paquete", categoria: c.categoria, regimen: c.regimen,
    total: c.total, noches, moneda: "COP", fechaIda: "2026-12-04", fechaRegreso: "2026-12-07", habitaciones: c.habitaciones, menores: c.menores, edadesMenores: c.edadesMenores,
    edadesComoAdulto: c.edadesComoAdulto, pax: c.pax, combos: [c], condicion: null,
  };
  return { estado: { destino: "DEMO 125", fechaIda: "2026-12-04", fechaRegreso: "2026-12-07", resultados: [r], diagnostico: null, sugerenciasFecha: [], unidad: [], avisoUnidad: null, enRevision: [], ocupacion: ocup }, r };
}

// ── Montaje y lectura de lo RENDERIZADO ────────────────────────────────────────────────────────────────────────────────────────────────────
async function montar(el: unknown) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(el as never); });
  return { cont, cerrar: async () => { await act(async () => root.unmount()); cont.remove(); } };
}
type FilaTarjeta = { clase: string; etiqueta: string; cantidad: number; porPersona: number | null; subtotal: number | null; explicacion: string | null };
/** Lee la tarjeta renderizada: una fila por línea del desglose + el total mostrado. */
function leerTarjeta(cont: HTMLElement) {
  const raiz = cont.querySelector('[data-testid="desglose-tarifas"]') as HTMLElement;
  assert.ok(raiz, "la tarjeta de desglose se renderiza");
  const filas: FilaTarjeta[] = [...raiz.querySelectorAll("[data-clase]")].map((div) => {
    const dts = div.querySelectorAll("dt"), dds = div.querySelectorAll("dd:not([data-nino-gratis])");
    const txt = (dts[0]?.textContent ?? "").replace(/\s+/g, " ").trim();
    const m = /^(\d+)× (.*)$/.exec(txt);
    return {
      clase: div.getAttribute("data-clase") ?? "", etiqueta: m ? m[2] : txt, cantidad: m ? Number(m[1]) : 1,
      porPersona: dds[0]?.textContent ? num(dds[0].textContent) : null, subtotal: dds[1]?.textContent ? num(dds[1].textContent) : null,
      explicacion: (div.querySelector("[data-nino-gratis]")?.textContent ?? "").replace(/\s+/g, " ").trim() || null,
    };
  });
  const dts = [...raiz.querySelectorAll("dt")]; const total = dts.find((d) => /Total de la reserva/.test(d.textContent ?? ""))!;
  return { filas, total: num((total.nextElementSibling as HTMLElement).textContent ?? ""), texto: raiz.textContent ?? "" };
}
/** Suma de lo MOSTRADO (cantidad × importe por persona de cada línea, o el subtotal) = total mostrado. */
const sumaMostrada = (t: ReturnType<typeof leerTarjeta>) => t.filas.reduce((s, f) => s + (f.subtotal ?? 0), 0);

describe("I1 — tarjeta de Vista Booking: lo mostrado por pasajero suma el total y el niño gratis se explica", () => {
  // Datos del reporte de Codex: doble 125.000 por adulto, niño 169.000 (neto 135.000, 3 noches promocionales), markup 20 %, sin otros servicios.
  const c1 = () => combo({
    precios: { doble: 125_000, nino: 169_000, nino2: 140_000 }, netos: { doble: 100_000, nino: 135_000, nino2: 112_000 },
    ninoGratisNoches: { nino: [noche(0, 45_000, "PRE BF"), noche(1, 45_000, "PRE BF"), noche(2, 45_000, "PRE BF")] },
  } as never);

  test("reproducción de Codex: adultos 250.000 + niño GRATIS = total 250.000; el niño sale a $0 con su explicación (antes: 250.000 + 169.000 contra 250.000)", async () => {
    const c = motor(c1(), { edades: [8] });
    assert.equal(c.total, 250_000);
    const m = await montar(h(DesgloseTarifas, { combo: c as never, moneda: "COP", noches: 3 }));
    const t = leerTarjeta(m.cont);
    const adultos = t.filas.find((f) => f.clase === "adulto")!, nino = t.filas.find((f) => f.clase === "nino")!;
    assert.deepEqual([adultos.cantidad, adultos.porPersona, adultos.subtotal], [2, 125_000, 250_000]);
    assert.deepEqual([nino.cantidad, nino.porPersona, nino.subtotal], [1, 0, 0], "el niño paga $0, no 169.000");
    assert.match(nino.etiqueta, /Niño 1 · 8 años/);
    assert.equal(nino.explicacion, `Niño 1 · 8 años: tarifa regular ${moneda(169_000)} · a pagar ${moneda(0)} c/u · Niño gratis · PRE BF`);
    assert.doesNotMatch(nino.explicacion ?? "", /[−-]\s?\$/, "sin resta aritmética");
    assert.equal(t.total, 250_000);
    assert.equal(sumaMostrada(t), t.total, "lo mostrado por pasajero SUMA el total");
    await m.cerrar();
  });

  test("UN niño gratis entre varios en la habitación: el Niño 1 es gratis, el Niño 2 conserva su tarifa completa y SIN explicación", async () => {
    const c = combo({
      precios: { doble: 125_000, nino: 169_000, nino2: 140_000 }, netos: { doble: 100_000, nino: 135_000, nino2: 112_000 },
      ninoGratisNoches: { nino: [noche(0, 45_000, "PRE BF"), noche(1, 45_000, "PRE BF"), noche(2, 45_000, "PRE BF")], nino2: [noche(0, 37_000, "PRE BF"), noche(1, 37_000, "PRE BF"), noche(2, 38_000, "PRE BF")] },
    } as never);
    const ev = motor(c, { edades: [8, 5] });
    assert.equal(ev.total, 250_000 + 140_000);
    const m = await montar(h(DesgloseTarifas, { combo: ev as never, moneda: "COP", noches: 3 }));
    const t = leerTarjeta(m.cont);
    const n1 = t.filas.find((f) => f.clase === "nino")!, n2 = t.filas.find((f) => f.clase === "nino2")!;
    assert.deepEqual([n1.porPersona, n1.subtotal], [0, 0]); assert.match(n1.etiqueta, /8 años/); assert.ok(n1.explicacion);
    assert.deepEqual([n2.porPersona, n2.subtotal], [140_000, 140_000], "el otro niño paga su tarifa real"); assert.match(n2.etiqueta, /5 años/); assert.equal(n2.explicacion, null);
    assert.equal(t.filas.filter((f) => f.explicacion).length, 1, "exactamente UN niño gratis por habitación");
    assert.equal(sumaMostrada(t), t.total); assert.equal(t.total, 390_000);
    await m.cerrar();
  });

  test("dos habitaciones con dos niños de la MISMA clase y solo uno elegible (promoción de 3 a 6 años): líneas separadas, sin promediar", async () => {
    const lim = (n: number) => noche(n, 45_000, "PRE BF", 3, 6);
    const c = combo({ precios: { doble: 125_000, nino: 169_000 }, netos: { doble: 100_000, nino: 135_000 }, ninoGratisNoches: { nino: [lim(0), lim(1), lim(2)] } } as never);
    const ev = motor(c, { adultos: 4, habitaciones: 2, edades: [9, 5], chdMin: 1 });
    assert.equal(ev.total, 4 * 125_000 + 169_000, "el de 9 años paga; el de 5 años es gratis");
    const m = await montar(h(DesgloseTarifas, { combo: ev as never, moneda: "COP", noches: 3 }));
    const t = leerTarjeta(m.cont);
    const ninos = t.filas.filter((f) => f.clase === "nino");
    assert.equal(ninos.length, 2, "dos líneas: no se promedia 169.000 y 0");
    const paga = ninos.find((f) => f.subtotal === 169_000)!, gratis = ninos.find((f) => f.subtotal === 0)!;
    assert.match(paga.etiqueta, /9 años/); assert.equal(paga.explicacion, null);
    assert.match(gratis.etiqueta, /5 años/); assert.match(gratis.explicacion ?? "", /Niño gratis · PRE BF/);
    assert.equal(sumaMostrada(t), t.total);
    await m.cerrar();
  });

  test("R1 (promociones sucesivas para el MISMO niño): una sola línea con ambas promociones, niño a $0 y total = adultos; sin el residuo de 1.000", async () => {
    // Markup 0, 2 noches: neto del niño 100.800 (50.400 de PROMO UNO + 50.400 de PROMO DOS), PVP 101.000; adultos 2 × 180.000.
    const base0 = { ...BASE, pctMk: 0 };
    const c = combo({
      precios: { doble: 180_000, nino: 101_000 }, netos: { doble: 180_000, nino: 100_800 },
      ninoGratisNoches: { nino: [noche(0, 50_400, "PROMO UNO"), noche(1, 50_400, "PROMO DOS")] },
    } as never);
    const ev = motor(c, { edades: [8], base: base0, noches: 2 });
    assert.equal(ev.total, 360_000);
    const m = await montar(h(DesgloseTarifas, { combo: ev as never, moneda: "COP", noches: 2 }));
    const t = leerTarjeta(m.cont);
    const nino = t.filas.filter((f) => f.clase === "nino");
    assert.equal(nino.length, 1, "un niño real = una línea (R1/R2)");
    assert.deepEqual([nino[0].porPersona, nino[0].subtotal], [0, 0]);
    assert.equal(nino[0].explicacion, `Niño 1 · 8 años: tarifa regular ${moneda(101_000)} · a pagar ${moneda(0)} c/u · Niño gratis · PROMO UNO, PROMO DOS`);
    assert.equal(sumaMostrada(t), 360_000); assert.equal(t.total, 360_000);
    await m.cerrar();
  });

  test("servicios y vuelo RETENIDOS: el niño gratis solo condona las noches promocionales; lo que paga (noche restante + traslado + vuelo) se muestra y suma el total", async () => {
    // 3 noches: las dos primeras gratis por promoción, la tercera a tarifa de base (56.000 de neto); traslado 24.000 neto y vuelo 400.000 por persona.
    const base = { pctMk: 0.2, impuesto: 0, vuelo: 400_000, vueloNeto: null, feeInfante: 0, servicios: [{ nombre: "Traslado", neto: 24_000, netoMenor: 24_000 }] };
    const pvpCobrado = componerTarifa({ aporteHotel: marcar(156_800, 0.2), aporteServicios: marcar(24_000, 0.2), aporteVuelo: 400_000, impuesto: 0, moneda: "COP" }).pvp;
    const sinNochesGratis = componerTarifa({ aporteHotel: marcar(56_000, 0.2), aporteServicios: marcar(24_000, 0.2), aporteVuelo: 400_000, impuesto: 0, moneda: "COP" }).pvp;
    const c = combo({
      precios: { doble: 600_000, nino: pvpCobrado }, netos: { doble: 400_000, nino: 156_800 },
      ninoGratisNoches: { nino: [noche(0, 50_400, "PROMO UNO"), noche(1, 50_400, "PROMO DOS")] },
    } as never);
    const ev = motor(c, { edades: [8], base });
    const m = await montar(h(DesgloseTarifas, { combo: ev as never, moneda: "COP", noches: 3 }));
    const t = leerTarjeta(m.cont);
    const nino = t.filas.find((f) => f.clase === "nino")!;
    assert.equal(nino.subtotal, sinNochesGratis, "el niño paga lo que NO es alojamiento promocionado");
    assert.ok((nino.subtotal ?? 0) > 400_000, "el vuelo sigue cobrándose");
    assert.equal(nino.explicacion, `Niño 1 · 8 años: tarifa regular ${moneda(pvpCobrado)} · a pagar ${moneda(sinNochesGratis)} c/u · El alojamiento de este niño es gratis solo en las noches de la promoción · PROMO UNO, PROMO DOS; las demás noches y los servicios o cargos retenidos se pagan`);
    assert.doesNotMatch(nino.explicacion ?? "", /Niño gratis/, "paga la noche restante, el traslado y el vuelo: no es «Niño gratis»");
    assert.equal(m.cont.querySelector("[data-tarifa-regular]")?.tagName, "S", "la tarifa regular va tachada");
    assert.equal(sumaMostrada(t), t.total); assert.equal(t.total, 2 * 600_000 + sinNochesGratis);
    await m.cerrar();
  });

  test("sin niño gratis (o con un menor que no lo recibe) el desglose es el de siempre: sin explicación y con la tarifa completa", async () => {
    const c = combo({ precios: { doble: 125_000, nino: 169_000 }, netos: { doble: 100_000, nino: 135_000 } } as never);
    const ev = motor(c, { edades: [8] });
    const m = await montar(h(DesgloseTarifas, { combo: ev as never, moneda: "COP", noches: 3 }));
    const t = leerTarjeta(m.cont);
    assert.equal(t.filas.filter((f) => f.explicacion).length, 0);
    assert.equal(t.filas.find((f) => f.clase === "nino")!.subtotal, 169_000);
    assert.equal(sumaMostrada(t), t.total); assert.equal(t.total, 250_000 + 169_000);
    await m.cerrar();
  });
});

describe("I1 — Vista tabla: importes por pasajero de la estadía y de la noche adicional (referencia)", () => {
  const nocheC = (cantidadNoches: number, netoNino: number, pvpNino: number, adultoPvp: number) => combo({
    precios: { doble: adultoPvp, nino: pvpNino }, netos: { doble: 100_000, nino: netoNino },
    ninoGratisNoches: { nino: Array.from({ length: cantidadNoches }, (_, i) => noche(i, 45_000, "PRE BF")) },
  } as never);
  const celda = (cont: HTMLElement, seccion: string, etiqueta: string) => ((cont.querySelector(`section[aria-labelledby="${seccion}"] tbody tr td[data-label="${etiqueta}"]`) as HTMLElement)?.textContent ?? "").replace(/\s+/g, " ").trim();
  let c0: ComboEvaluado;

  before(() => { c0 = motor(nocheC(3, 135_000, 169_000, 125_000), { edades: [8] }); });

  test("estadía: columna Adulto $125.000, Menores $0 con la explicación y Total $250.000", async () => {
    const { estado } = resultadoDe(c0);
    const m = await montar(h(TablaResultadosBusqueda, { estado: estado as never }));
    assert.match(celda(m.cont, "sec-estadia", "Adulto"), /125\.000/);
    const menores = celda(m.cont, "sec-estadia", "Menores");
    assert.match(menores, /Niño 1 · 8 años/); assert.match(menores, /\$\s?0/);
    assert.match(menores, /tarifa regular \$\s?169\.000 · a pagar \$\s?0 c\/u · Niño gratis · PRE BF/);
    assert.doesNotMatch(menores, /\$\s?169\.000\s*\$\s?169\.000\s*$/, "no queda 169.000 como importe a pagar");
    assert.match(celda(m.cont, "sec-estadia", "Total de la reserva"), /250\.000/);
    await m.cerrar();
  });

  test("tabla con DOS niños de la misma clase y solo uno gratis: ambas líneas visibles, 169.000 y $0 con explicación (sin promedio)", async () => {
    const lim = (n: number) => noche(n, 45_000, "PRE BF", 3, 6);
    const c = combo({ precios: { doble: 125_000, nino: 169_000 }, netos: { doble: 100_000, nino: 135_000 }, ninoGratisNoches: { nino: [lim(0), lim(1), lim(2)] } } as never);
    const ev = motor(c, { adultos: 4, habitaciones: 2, edades: [9, 5], chdMin: 1 });
    const { estado } = resultadoDe(ev, 3, { numHabitaciones: 2, adultos: 4, edadesMenores: [9, 5] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estado as never }));
    const menores = celda(m.cont, "sec-estadia", "Menores");
    assert.match(menores, /9 años/); assert.match(menores, /5 años/);
    assert.match(menores, /169\.000/); assert.equal((menores.match(/Niño gratis/g) ?? []).length, 1);
    assert.doesNotMatch(menores, /84\.500/, "no se promedia");
    await m.cerrar();
  });

  test("noche adicional con el niño TAMBIÉN gratis esa noche: adultos +35.000 c/u, niño $0 con la explicación de ESA noche; la suma de lo mostrado = total de la noche 70.000", async () => {
    const c1 = motor(nocheC(4, 180_000, 225_000, 160_000), { edades: [8], noches: 4 });
    const desglose = desgloseNocheAdicional(c0.desglose, c1.desglose)!;
    assert.ok(desglose, "misma estructura: hay desglose por pasajero");
    const total = c1.total - c0.total;
    assert.equal(sumaDesglose(desglose), total, "las diferencias por pasajero suman exactamente total(N+1) − total(N)");
    const conNoche = { ...c0, nocheAdicional: { estado: "ok", fecha: "2026-12-07", total, desglose } };
    const { estado } = resultadoDe(conNoche as never);
    const m = await montar(h(TablaResultadosBusqueda, { estado: estado as never }));
    assert.match(celda(m.cont, "sec-noche", "Adulto"), /35\.000/);
    const menores = celda(m.cont, "sec-noche", "Menores");
    assert.match(menores, /\$\s?0/);
    assert.match(menores, /tarifa regular \$\s?56\.000 · a pagar \$\s?0 c\/u · Niño gratis · PRE BF/, "lo condonado SOLO esa noche (225.000 − 169.000)");
    assert.match(celda(m.cont, "sec-noche", "Total de la noche"), /70\.000/);
    await m.cerrar();
  });

  test("noche adicional que NO cae en la promoción: el niño paga la noche completa (sin explicación) y la suma sigue siendo el total de la noche", async () => {
    // 4 noches pero la promoción solo cubre las 3 primeras: el niño con 4 noches cuesta 225.000 y condona los mismos 169.000 → paga la 4.ª noche (56.000).
    const c1 = motor(combo({
      precios: { doble: 160_000, nino: 225_000 }, netos: { doble: 100_000, nino: 180_000 },
      ninoGratisNoches: { nino: [noche(0, 45_000, "PRE BF"), noche(1, 45_000, "PRE BF"), noche(2, 45_000, "PRE BF")] },
    } as never), { edades: [8], noches: 4 });
    const desglose = desgloseNocheAdicional(c0.desglose, c1.desglose)!;
    const total = c1.total - c0.total;
    assert.equal(sumaDesglose(desglose), total);
    const nino = desglose.find((l) => l.clase === "nino")!;
    assert.equal(nino.subtotal, 57_000, "la 4.ª noche (neto 45.000 → 56.250) se recompone UNA vez y redondea al millar; se condona 168.000, no 169.000");
    assert.equal(nino.gratis, undefined, "esa noche no tiene niño gratis que explicar");
    const { estado } = resultadoDe({ ...c0, nocheAdicional: { estado: "ok", fecha: "2026-12-07", total, desglose } } as never);
    const m = await montar(h(TablaResultadosBusqueda, { estado: estado as never }));
    const menores = celda(m.cont, "sec-noche", "Menores");
    assert.match(menores, /57\.000/); assert.doesNotMatch(menores, /Niño gratis/);
    assert.match(celda(m.cont, "sec-noche", "Total de la noche"), /127\.000/, "adultos +70.000 y el niño +57.000");
    await m.cerrar();
  });

  test("si al alargar la estadía cambia la estructura (aparece o desaparece un niño gratis) no se inventa un desglose: solo el total", () => {
    const sinBeneficio = motor(combo({ precios: { doble: 160_000, nino: 225_000 }, netos: { doble: 100_000, nino: 180_000 } } as never), { edades: [8], noches: 4 });
    assert.equal(desgloseNocheAdicional(c0.desglose, sinBeneficio.desglose), undefined);
  });
});

describe("I1 — invariantes del motor", () => {
  test("el motor RECHAZA el combo (no lo ofrece contradictorio) si el desglose con el niño gratis no cuadra con el total", () => {
    // Un beneficio mayor que la tarifa del niño no se puede mostrar sin contradecir el total: el combo se descarta con su motivo.
    const c = combo({
      precios: { doble: 125_000, nino: 100_000 }, netos: { doble: 100_000, nino: 135_000 },
      ninoGratisNoches: { nino: [noche(0, 45_000, "PRE BF"), noche(1, 45_000, "PRE BF"), noche(2, 45_000, "PRE BF")] },
    } as never);
    const r = evaluarComposicionHotel({
      res: { combos: [c], serviciosGrupoIncluidos: [], composicionBase: BASE as never, moneda: "COP" } as never, filasTarifa: [], pctMk: 0.2, numNoches: 3, adultos: 2, edades: [8],
      reglasAcom: CFG(), generalEdad: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 }, numHabitaciones: 1,
    });
    // O se descarta (rechazo explicado) o, si el compositor lo acota, el desglose suma el total: nunca queda un desglose que contradiga el total.
    if (r.combos.length) assert.equal(sumaDesglose(r.combos[0].desglose), r.combos[0].total);
    else assert.ok(r.rechazos.length > 0);
  });
});

describe("Owner 2026-11-18 (#125 búsqueda): «Tarifa regular» tachada junto a lo que se paga, sin aritmética ni «Niño gratis» falso", () => {
  const ad = { clase: "adulto", cantidad: 2, tarifa: 125_000, subtotal: 250_000 };
  const nino = (tarifa: number, condonado: number | null, promociones = ["PRE BF"]) => ({
    clase: "nino", cantidad: 1, tarifa, subtotal: tarifa, menorDeDos: false, edades: [8], ...(condonado == null ? {} : { gratis: { promociones, condonado } }),
  });
  const pintar = async (l: unknown) => {
    const lineas = [ad, l] as { subtotal: number }[];
    const m = await montar(h(DesgloseTarifas, { combo: { desglose: lineas, total: lineas.reduce((s, x) => s + x.subtotal, 0) } as never, moneda: "COP", noches: 3 }));
    return { m, t: leerTarjeta(m.cont) };
  };

  test("niño que aún paga 168.000 (regular 269.000): tarifa regular tachada, importe a pagar 168.000 y NUNCA «Niño gratis» ni resta", async () => {
    const { m, t } = await pintar(nino(168_000, 101_000));
    const n = t.filas.find((f) => f.clase === "nino")!;
    assert.deepEqual([n.porPersona, n.subtotal], [168_000, 168_000]);
    assert.equal(m.cont.querySelector("[data-tarifa-regular]")?.tagName, "S");
    assert.equal(num(m.cont.querySelector("[data-tarifa-regular]")!.textContent ?? ""), 269_000);
    assert.doesNotMatch(n.explicacion ?? "", /Niño gratis/);
    assert.doesNotMatch(n.explicacion ?? "", /101\.000/, "no se muestra la resta");
    assert.match(n.explicacion ?? "", /El alojamiento de este niño es gratis solo en las noches de la promoción · PRE BF; las demás noches y los servicios o cargos retenidos se pagan/);
    assert.equal(sumaMostrada(t), t.total);
    await m.cerrar();
  });

  test("niño totalmente gratis: $0 y «Niño gratis»; la tarifa regular tachada es la que no se cobra", async () => {
    const { m, t } = await pintar(nino(0, 169_000));
    const n = t.filas.find((f) => f.clase === "nino")!;
    assert.deepEqual([n.porPersona, n.subtotal], [0, 0]);
    assert.equal(n.explicacion, `Niño 1 · 8 años: tarifa regular ${moneda(169_000)} · a pagar ${moneda(0)} c/u · Niño gratis · PRE BF`);
    await m.cerrar();
  });

  test("beneficio sin importe condonado (promoción que no aplica a esa estadía o noche): no se anuncia nada", async () => {
    const { m, t } = await pintar(nino(169_000, 0));
    assert.equal(t.filas.find((f) => f.clase === "nino")!.explicacion, null);
    assert.equal(m.cont.querySelector("[data-tarifa-regular]"), null);
    await m.cerrar();
  });

  test("promoción sin nombre: no queda «· » vacío en la explicación", async () => {
    const { m, t } = await pintar(nino(0, 169_000, [""]));
    assert.equal(t.filas.find((f) => f.clase === "nino")!.explicacion, `Niño 1 · 8 años: tarifa regular ${moneda(169_000)} · a pagar ${moneda(0)} c/u · Niño gratis`);
    await m.cerrar();
  });
});

describe("Owner 2026-11-21 (corrección 4): el importe regular tachado pertenece al niño, no a la tarjeta", () => {
  // Caso del dueño: 2 adultos × 480.000, infante de 1 año 100.000, niño de 8 años que paga 168.000 (regular 269.000) = 1.228.000.
  const lineas = [
    { clase: "adulto", cantidad: 2, tarifa: 480_000, subtotal: 960_000 },
    { clase: "infante", cantidad: 1, tarifa: 100_000, subtotal: 100_000, menorDeDos: true, edades: [1] },
    { clase: "nino", cantidad: 1, tarifa: 168_000, subtotal: 168_000, menorDeDos: false, edades: [8], gratis: { promociones: ["PRE BF"], condonado: 101_000 } },
  ];
  const pintar = () => montar(h(DesgloseTarifas, { combo: { desglose: lineas, total: 1_228_000 } as never, moneda: "COP", noches: 3 }));

  test("la nota vive DENTRO del bloque del niño, nombra «Niño 1 · 8 años» y junta tarifa regular tachada con lo que paga; adultos e infante no llevan nota", async () => {
    const m = await pintar();
    const bloque = m.cont.querySelector('[data-clase="nino"]') as HTMLElement;
    assert.ok(bloque.hasAttribute("data-con-beneficio"), "el bloque del niño se distingue como un grupo");
    const nota = bloque.querySelector("[data-nino-gratis]") as HTMLElement;
    assert.ok(nota, "la nota está dentro de la fila del niño (no suelta debajo de la tarjeta)");
    assert.equal((nota.querySelector("[data-nino-gratis-pasajero]")!.textContent ?? "").trim(), "Niño 1 · 8 años");
    assert.equal(nota.querySelector("[data-tarifa-regular]")!.tagName, "S");
    assert.equal(num(nota.querySelector("[data-tarifa-regular]")!.textContent ?? ""), 269_000);
    assert.equal(num(nota.querySelector("[data-tarifa-a-pagar]")!.textContent ?? ""), 168_000);
    for (const clase of ["adulto", "infante"]) assert.equal(m.cont.querySelector(`[data-clase="${clase}"] [data-nino-gratis]`), null, `${clase}: sin nota de beneficio`);
    assert.equal(m.cont.querySelectorAll("[data-tarifa-regular]").length, 1, "una sola tarifa regular tachada en toda la tarjeta");
    await m.cerrar();
  });

  test("el texto no sugiere que toda la estadía del niño ni el infante sean gratis, y el total mostrado es el de siempre", async () => {
    const m = await pintar();
    const t = leerTarjeta(m.cont);
    const nino = t.filas.find((f) => f.clase === "nino")!;
    assert.match(nino.explicacion ?? "", /El alojamiento de este niño es gratis solo en las noches de la promoción/);
    assert.doesNotMatch(nino.explicacion ?? "", /Niño gratis/);
    assert.equal(t.filas.find((f) => f.clase === "infante")!.explicacion, null);
    assert.deepEqual(t.filas.map((f) => f.subtotal), [960_000, 100_000, 168_000]);
    assert.equal(t.total, 1_228_000); assert.equal(sumaMostrada(t), t.total);
    await m.cerrar();
  });
});
