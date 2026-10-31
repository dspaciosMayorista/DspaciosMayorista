// costoNetoServicio con ALCANCE (262): el neto sale de los precios PROPIOS del alcance vendido en la vigencia aplicable; un trayecto nunca sale de la mitad/doble de
// otro alcance ni de GENERAL. «Ida y regreso» sin precio propio usa la TARIFA que ya tiene la vigencia (persona o rango de grupo). El suplemento solo cuenta para los tramos vendidos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costoNetoServicio } from "../lib/calc/servicioTarifa.ts";
import type { FilaPrecioAlcance } from "../lib/calc/servicioAlcance.ts";
import type { FranjaSuplemento } from "../lib/calc/trasladoFranjas.ts";

const ALTA = { nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", precio_persona: 999999, recargo_individual: 50000 };
const GENERAL = { nombre: "GENERAL", fecha_inicio: null, fecha_fin: null, precio_persona: 777777 };
const fecha = new Date("2030-05-10T12:00:00");
const base = { grupos: [], franjasPorTemporada: new Map<string, FranjaSuplemento[]>(), modo: "persona" as const, pax: 2, fecha, liquidacion: "paquete", numNoches: 3, hoy: "2029-06-01" };
const precios = (filas: FilaPrecioAlcance[]) => new Map([["ALTA", filas]]);
const P = (alcance: FilaPrecioAlcance["alcance"], precio: number, d: number | null = null, h: number | null = null): FilaPrecioAlcance => ({ alcance, pax_desde: d, pax_hasta: h, precio });

test("por persona: cada alcance cobra SU precio (trayecto 100.000, ida y regreso 170.000 ≠ 2 × 100.000) y no toca precio_persona de la tarifa clásica", () => {
  const pa = precios([P("trayecto", 100000), P("ida_regreso", 170000)]);
  const t = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "llegada", preciosAlcancePorTemporada: pa });
  const ir = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "ida_regreso", preciosAlcancePorTemporada: pa });
  assert.equal(t.ok && t.costoNeto, 200000, "2 pax × 100.000, no 999.999");
  assert.equal(ir.ok && ir.costoNeto, 340000, "2 pax × 170.000");
});

test("ida y regreso SIN precio propio usa la TARIFA de la vigencia (nunca el trayecto); un trayecto sin precio propio sigue fallando", () => {
  const ir = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "ida_regreso", preciosAlcancePorTemporada: precios([P("trayecto", 100000)]) });
  assert.equal(ir.ok && ir.costoNeto, 999999 * 2, "la tarifa vigente por persona × 2 pax; no el trayecto ni su doble");
  assert.equal(ir.ok && ir.origenPrecio, "tarifa_vigente");
  const sinPropio = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "llegada", preciosAlcancePorTemporada: new Map() });
  assert.equal(!sinPropio.ok && sinPropio.motivo, "sin_precio_alcance", "un trayecto exige su precio propio aunque la vigencia tenga tarifa");
  const mitad = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "salida", preciosAlcancePorTemporada: precios([P("ida_regreso", 170000)]) });
  assert.equal(!mitad.ok && mitad.motivo, "sin_precio_alcance", "tampoco el trayecto sale como la mitad de ida y regreso");
});

test("ida y regreso sin precio propio NI tarifa en la vigencia (NULL o inválida) falla con sin_precio_alcance", () => {
  for (const precio_persona of [null, Number.NaN, -5]) {
    const r = costoNetoServicio({ ...base, temporadas: [{ ...ALTA, precio_persona }], alcance: "ida_regreso", preciosAlcancePorTemporada: new Map() });
    assert.equal(!r.ok && r.motivo, "sin_precio_alcance", `precio_persona ${precio_persona}`);
  }
});

test("una tarifa de 0 ES una tarifa válida (como en la tarifa de siempre): ida y regreso la usa y no cae a «sin precio»; el precio propio sigue ganando; un trayecto sigue exigiendo el suyo", () => {
  const persona = costoNetoServicio({ ...base, temporadas: [{ ...ALTA, precio_persona: 0 }], alcance: "ida_regreso", preciosAlcancePorTemporada: new Map() });
  assert.equal(persona.ok && persona.costoNeto, 0); assert.equal(persona.ok && persona.origenPrecio, "tarifa_vigente");
  const propio = costoNetoServicio({ ...base, temporadas: [{ ...ALTA, precio_persona: 0 }], alcance: "ida_regreso", preciosAlcancePorTemporada: precios([P("ida_regreso", 170000)]) });
  assert.equal(propio.ok && propio.costoNeto, 340000); assert.equal(propio.ok && propio.origenPrecio, "explicito");
  const rangos = [{ pax_desde: 1, pax_hasta: 4, precio: 0, temporada: "ALTA" }, { pax_desde: 5, pax_hasta: 12, precio: 200000, temporada: "ALTA" }];
  const g = (pax: number, alcance: "llegada" | "ida_regreso") => costoNetoServicio({ ...base, temporadas: [{ ...ALTA, precio_persona: null }], grupos: rangos, modo: "grupo", pax, alcance, preciosAlcancePorTemporada: new Map() });
  assert.equal(neto(g(3, "ida_regreso")), 0, "un rango en 0 es una tarifa");
  assert.equal(neto(g(8, "ida_regreso")), 200000);
  assert.equal(neto(g(13, "ida_regreso")), "sin_precio_alcance", "fuera de todo rango sigue sin vender");
  assert.equal(neto(g(3, "llegada")), "sin_precio_alcance", "un trayecto no sale de la tarifa, ni siquiera de una en 0");
  const nan = costoNetoServicio({ ...base, temporadas: [{ ...ALTA, precio_persona: null }], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: Number.NaN, temporada: "ALTA" }], modo: "grupo", pax: 3, alcance: "ida_regreso", preciosAlcancePorTemporada: new Map() });
  assert.equal(neto(nan), "sin_precio_alcance", "un rango inválido (NaN) no es tarifa");
});

test("GENERAL es histórico: una vigencia GENERAL (con precios de alcance o sin ellos) no vende", () => {
  const r = costoNetoServicio({ ...base, temporadas: [GENERAL], alcance: "llegada", preciosAlcancePorTemporada: new Map([["GENERAL", [P("trayecto", 1)]]]) });
  assert.equal(r.ok, false); assert.equal(!r.ok && r.motivo, "sin_vigencia");
});

test("sin vigencia que cubra la fecha falla; la vigencia sin precios de alcance falla con sin_precio_alcance", () => {
  assert.equal((costoNetoServicio({ ...base, temporadas: [ALTA], fecha: new Date("2031-02-01T12:00:00"), alcance: "llegada", preciosAlcancePorTemporada: precios([P("trayecto", 1)]) }) as { motivo?: string }).motivo, "sin_vigencia");
  assert.equal((costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "llegada", preciosAlcancePorTemporada: new Map() }) as { motivo?: string }).motivo, "sin_precio_alcance");
});

test("modo grupo: el rango de la vigencia que cubre el grupo, por alcance; fuera de todo rango falla (no usa el más cercano)", () => {
  const pa = precios([P("trayecto", 45000, 1, 4), P("trayecto", 80000, 5, 12), P("ida_regreso", 150000, 1, 12)]);
  const g = (pax: number, alcance: "llegada" | "ida_regreso") => costoNetoServicio({ ...base, temporadas: [ALTA], modo: "grupo", pax, alcance, preciosAlcancePorTemporada: pa });
  assert.equal((g(3, "llegada") as { costoNeto?: number }).costoNeto, 45000);
  assert.equal((g(8, "llegada") as { costoNeto?: number }).costoNeto, 80000);
  assert.equal((g(8, "ida_regreso") as { costoNeto?: number }).costoNeto, 150000);
  assert.equal((g(20, "llegada") as { motivo?: string }).motivo, "sin_precio_alcance");
});

test("1 pasajero por persona: el recargo individual de la tarifa clásica NO se suma al precio del alcance", () => {
  const r = costoNetoServicio({ ...base, temporadas: [ALTA], pax: 1, alcance: "llegada", preciosAlcancePorTemporada: precios([P("trayecto", 100000)]) });
  assert.equal(r.ok && r.costoNeto, 100000); assert.equal(r.ok && r.recargoIndividual, 0);
});

const NOCHE: FranjaSuplemento = { hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 30000, cobro: "grupo" };
const franjas = new Map([["ALTA", [NOCHE]]]);

test("el suplemento solo cuenta para los tramos vendidos: trayecto de llegada cobra la llegada y NO pide la hora de salida; ida y regreso cobra ambos", () => {
  const pa = precios([P("trayecto", 100000), P("ida_regreso", 170000)]);
  const llegada = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: franjas, horas: { llegada: "22:00" }, alcance: "llegada", preciosAlcancePorTemporada: pa });
  assert.equal(llegada.ok && llegada.costoNeto, 230000, "200.000 + 30.000 de la llegada");
  const sinHora = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: franjas, alcance: "llegada", preciosAlcancePorTemporada: pa });
  assert.equal(!sinHora.ok && sinHora.motivo, "hora_requerida");
  assert.deepEqual(!sinHora.ok && sinHora.pendientes, ["llegada"], "la salida no se pide");
  const ambos = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: franjas, horas: { llegada: "22:00", salida: "05:00" }, alcance: "ida_regreso", preciosAlcancePorTemporada: pa });
  assert.equal(ambos.ok && ambos.costoNeto, 340000 + 60000, "un suplemento por tramo");
});

test("sin alcance el comportamiento anterior no cambia (tarifa clásica de la vigencia)", () => {
  const r = costoNetoServicio({ ...base, temporadas: [ALTA] });
  assert.equal(r.ok && r.costoNeto, 999999 * 2);
});

// ── Ida y regreso con la tarifa que la vigencia YA tiene (#423): sin copiar datos ni recargar nada ────────────────────────────────────────────────
type Costo = ReturnType<typeof costoNetoServicio>;
const neto = (r: Costo) => (r.ok ? r.costoNeto : r.motivo);
const RANGOS_CAPTURA = [
  { pax_desde: 1, pax_hasta: 4, precio: 120000, temporada: "ALTA" }, { pax_desde: 5, pax_hasta: 12, precio: 200000, temporada: "ALTA" },
  { pax_desde: 13, pax_hasta: 19, precio: 280000, temporada: "ALTA" }, { pax_desde: 20, pax_hasta: 40, precio: 400000, temporada: "ALTA" },
];
const grupo = (pax: number, alcance: "llegada" | "ida_regreso", pa: Map<string, FilaPrecioAlcance[]> = new Map(), extra: Record<string, unknown> = {}) =>
  costoNetoServicio({ ...base, temporadas: [{ ...ALTA, precio_persona: null }], grupos: RANGOS_CAPTURA, modo: "grupo", pax, alcance, preciosAlcancePorTemporada: pa, ...extra });

test("rangos de la captura 1–4 / 5–12 / 13–19 / 20–40: ida y regreso cobra el rango de la tarifa vigente en cada borde; fuera de todo rango falla (no usa el más cercano)", () => {
  const esperado: Array<[number, number]> = [[1, 120000], [4, 120000], [5, 200000], [12, 200000], [13, 280000], [19, 280000], [20, 400000], [40, 400000]];
  for (const [pax, valor] of esperado) assert.equal(neto(grupo(pax, "ida_regreso")), valor, `${pax} pax`);
  assert.equal(neto(grupo(41, "ida_regreso")), "sin_precio_alcance"); assert.equal(neto(grupo(0, "ida_regreso")), "sin_precio_alcance");
});

test("rangos de la captura: un trayecto NO sale de esos rangos aunque la vigencia los tenga; solo con precio propio del trayecto", () => {
  for (const pax of [1, 5, 13, 20]) assert.equal(neto(grupo(pax, "llegada")), "sin_precio_alcance", `${pax} pax`);
  assert.equal(neto(grupo(8, "llegada", precios([P("trayecto", 70000, 5, 12)]))), 70000);
  assert.equal(neto(grupo(3, "llegada", precios([P("trayecto", 70000, 5, 12)]))), "sin_precio_alcance", "el rango propio del trayecto no cubre 3 pax");
});

test("precio explícito de ida y regreso: manda en el rango que cubre; los demás rangos siguen con la tarifa vigente; un trayecto propio no interfiere", () => {
  const pa = precios([P("ida_regreso", 190000, 5, 12), P("trayecto", 70000, 1, 4)]);
  assert.equal(neto(grupo(8, "ida_regreso", pa)), 190000, "explícito 5–12 reemplaza el 200.000 de la tarifa");
  assert.equal(grupo(8, "ida_regreso", pa).ok && (grupo(8, "ida_regreso", pa) as { origenPrecio?: string }).origenPrecio, "explicito");
  assert.equal(neto(grupo(3, "ida_regreso", pa)), 120000, "sin precio propio en 1–4: tarifa vigente, no el trayecto de 70.000");
  assert.equal(neto(grupo(15, "ida_regreso", pa)), 280000);
  assert.equal(neto(grupo(3, "llegada", pa)), 70000);
});

test("por persona: el precio propio de ida y regreso gana a la tarifa vigente; sin él, la tarifa (con su recargo individual de 1 pax); con el propio no hay recargo", () => {
  const propio = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "ida_regreso", preciosAlcancePorTemporada: precios([P("ida_regreso", 170000)]) });
  assert.equal(neto(propio), 340000); assert.equal(propio.ok && propio.origenPrecio, "explicito");
  const uno = costoNetoServicio({ ...base, temporadas: [ALTA], pax: 1, alcance: "ida_regreso", preciosAlcancePorTemporada: new Map() });
  assert.equal(neto(uno), 999999 + 50000, "tarifa de la vigencia + recargo individual de la misma vigencia");
  assert.equal(uno.ok && uno.recargoIndividual, 50000);
  const unoPropio = costoNetoServicio({ ...base, temporadas: [ALTA], pax: 1, alcance: "ida_regreso", preciosAlcancePorTemporada: precios([P("ida_regreso", 170000)]) });
  assert.equal(neto(unoPropio), 170000); assert.equal(unoPropio.ok && unoPropio.recargoIndividual, 0);
});

test("cambio de vigencia: cada fecha usa SU vigencia (la propia o la tarifa de esa vigencia), con fechas y prioridad; sin vigencia que cubra falla", () => {
  const A = { nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-05-31", precio_persona: 100000, prioridad: 1 };
  const B = { nombre: "BAJA", fecha_inicio: "2030-06-01", fecha_fin: "2030-12-31", precio_persona: 150000, prioridad: 1 };
  const pa = new Map([["BAJA", [P("ida_regreso", 180000)]]]);
  const en = (f: string) => costoNetoServicio({ ...base, temporadas: [A, B], fecha: new Date(`${f}T12:00:00`), alcance: "ida_regreso", preciosAlcancePorTemporada: pa });
  assert.equal(neto(en("2030-03-10")), 100000 * 2, "ALTA: sin precio propio → su tarifa");
  assert.equal(neto(en("2030-08-10")), 180000 * 2, "BAJA: precio propio");
  assert.equal(neto(en("2031-01-10")), "sin_vigencia");
  // prioridad: dos vigencias que cubren la misma fecha → gana la de mayor prioridad (como en toda la venta)
  const C = { ...B, nombre: "PROMO", fecha_inicio: "2030-08-01", fecha_fin: "2030-08-31", precio_persona: 90000, prioridad: 5 };
  assert.equal(neto(costoNetoServicio({ ...base, temporadas: [A, B, C], fecha: new Date("2030-08-10T12:00:00"), alcance: "ida_regreso", preciosAlcancePorTemporada: pa })), 90000 * 2, "PROMO (prioridad 5) con su tarifa; el propio de BAJA no se mezcla");
});

test("suplementos por horario sobre la tarifa vigente: cada tramo vendido con su hora; porcentual sobre la tarifa; un trayecto propio solo cobra el suyo", () => {
  const NOCHE_MONTO: FranjaSuplemento = { hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 30000, cobro: "grupo" };
  const f = new Map([["ALTA", [NOCHE_MONTO]]]);
  const conHoras = (horas: { llegada?: string; salida?: string }, extra: Record<string, unknown> = {}) =>
    costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: f, horas, alcance: "ida_regreso", preciosAlcancePorTemporada: new Map(), ...extra });
  assert.equal(neto(conHoras({ llegada: "22:00", salida: "05:00" })), 999999 * 2 + 60000, "tarifa vigente + un suplemento por cada tramo");
  assert.equal(neto(conHoras({ llegada: "10:00", salida: "11:00" })), 999999 * 2, "de día: sin suplemento");
  const sinHora = conHoras({ llegada: "22:00" });
  assert.equal(!sinHora.ok && sinHora.motivo, "hora_requerida"); assert.deepEqual(!sinHora.ok && sinHora.pendientes, ["salida"]);
  const PCT: FranjaSuplemento = { ...NOCHE_MONTO, tipo: "porcentaje", valor: 10 };
  const pct = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: new Map([["ALTA", [PCT]]]), horas: { llegada: "22:00", salida: "05:00" }, alcance: "ida_regreso", preciosAlcancePorTemporada: new Map() });
  assert.ok(Math.abs((neto(pct) as number) - 999999 * 2 * 1.2) < 1e-6, "10 % por cada uno de los dos tramos sobre la tarifa vigente");
  const trayecto = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: f, horas: { llegada: "22:00" }, alcance: "llegada", preciosAlcancePorTemporada: precios([P("trayecto", 100000)]) });
  assert.equal(neto(trayecto), 230000, "el trayecto cobra solo su tramo");
  // grupo: la tarifa por rango + suplemento por tramo
  assert.equal(neto(grupo(8, "ida_regreso", new Map(), { franjasPorTemporada: f, horas: { llegada: "22:00", salida: "05:00" } })), 200000 + 60000);
});
