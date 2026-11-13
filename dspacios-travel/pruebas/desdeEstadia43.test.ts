import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toTemporadaRango, liquidarHotelMasBarato, liquidarHotelNochesConTemporadas } from "../lib/calc/paquetes.ts";
import { filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";
import { desdeEstadiaReal, LIMITES_DESDE, crearPresupuestoDesde, hotelConGrupos, LIMITES_DESDE_GENERACION } from "../lib/calc/desdeEstadia.ts";
import type { FilaTemporadaHotelRaw, FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 entrega 6 — «Desde» de porción por estadía real (historial U.1, U.2, U.7). El 4 de enero de 2027 es lunes.
// Ejemplo aprobado: ventana 4–10 ene, 5 noches; lunes–jueves 100.000 y viernes–domingo 150.000 por persona y noche.
// ─────────────────────────────────────────────────────────────────────────
const HOY = "2026-11-12";
const SEMANA = { id: "g-sem", dias: [1, 2, 3, 4], activo: true };
const FS = { id: "g-fs", dias: [5, 6, 7], activo: true };
const vig = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: "2027-01-01", fecha_fin: "2027-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
});
const tar = (temporada: string, over: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...over,
});
const ALTA = (over: Partial<FilaTemporadaHotelRaw> = {}) => vig({ nombre: "ALTA", hotel_temporada_grupos: [SEMANA, FS], ...over } as FilaTemporadaHotelRaw);
const TARIFAS = [tar("ALTA", { grupo_id: "g-sem", neto_doble: 100_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 150_000 })];

function calcular(vigs: FilaTemporadaHotelRaw[], desde: string, hasta: string, n: number, tarifas = TARIFAS, opciones = {}) {
  return desdeEstadiaReal({ desde, hasta, numNoches: n, temporadas: vigs.map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(tarifas), "neto_doble"), hoy: HOY, regimen: "PAM" }, opciones);
}

describe("U.2 — ejemplo aprobado", () => {
  test("ventana 4–10 ene, 5 noches ⇒ 550.000 · entrada 04/01/2027 · salida 09/01 (nunca 500.000)", () => {
    const r = calcular([ALTA()], "2027-01-04", "2027-01-10", 5);
    assert.equal(r.desde?.total, 550_000);
    assert.deepEqual(r.desde?.justificacion, { entrada: "2027-01-04", salida: "2027-01-09", noches: 5 });
    assert.deepEqual({ candidatas: r.medicion.candidatas, evaluadas: r.medicion.evaluadas, resultado: r.medicion.resultado }, { candidatas: 2, evaluadas: 2, resultado: "precio" });
  });
  test("la entrada 05/01 vale 600.000 (y la 06/01 no cabe: su salida queda fuera de la ventana)", () => {
    const r = liquidarHotelNochesConTemporadas({ fechaIda: "2027-01-05", numNoches: 5, temporadas: [ALTA()].map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(TARIFAS), "neto_doble"), hoy: HOY, regimen: "PAM" });
    assert.equal(r?.total, 600_000);
  });
  test("reproducible: la estadía de la justificación, liquidada como una reserva, da el mismo total", () => {
    const r = calcular([ALTA()], "2027-01-04", "2027-01-10", 5);
    const j = r.desde!.justificacion;
    const real = liquidarHotelNochesConTemporadas({ fechaIda: j.entrada, numNoches: j.noches, temporadas: [ALTA()].map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(TARIFAS), "neto_doble"), hoy: HOY, regimen: "PAM" });
    assert.equal(real?.total, r.desde!.total);
  });
});

describe("U.7 — reglas", () => {
  test("empate: gana la entrada más temprana", () => {
    const plano = [tar("ALTA", { grupo_id: "g-sem", neto_doble: 100_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 100_000 })];
    assert.equal(calcular([ALTA()], "2027-01-04", "2027-01-12", 3, plano).desde?.justificacion.entrada, "2027-01-04");
  });
  test("una candidata con una noche no vendible (blackout) se descarta: gana la siguiente vendible aunque sea más cara", () => {
    const r = calcular([ALTA({ blackouts: [{ fecha_inicio: "2027-01-04", fecha_fin: "2027-01-04" }] } as never)], "2027-01-04", "2027-01-10", 5);
    assert.equal(r.desde?.total, 600_000);
    assert.equal(r.desde?.justificacion.entrada, "2027-01-05");
  });
  test("sin estadía completa vendible: sin «desde» (nunca un precio parcial)", () => {
    const r = calcular([ALTA({ blackouts: [{ fecha_inicio: "2027-01-06", fecha_fin: "2027-01-06" }] } as never)], "2027-01-04", "2027-01-10", 5);
    assert.equal(r.desde, null);
    assert.equal(r.medicion.resultado, "sin_estadia");
  });
  test("ventana igual a N (una candidata) y menor que N (ninguna ⇒ sin «desde»)", () => {
    assert.equal(calcular([ALTA()], "2027-01-04", "2027-01-09", 5).medicion.candidatas, 1);
    const corta = calcular([ALTA()], "2027-01-04", "2027-01-08", 5);
    assert.equal(corta.desde, null);
    assert.equal(corta.medicion.candidatas, 0);
  });
  test("una entrada anterior a hoy no se vende", () => {
    const r = desdeEstadiaReal({ desde: "2027-01-04", hasta: "2027-01-10", numNoches: 5, temporadas: [ALTA()].map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(TARIFAS), "neto_doble"), hoy: "2027-01-05", regimen: "PAM" });
    assert.equal(r.desde?.justificacion.entrada, "2027-01-05");
  });
  test("noches mínimas de la vigencia mayores que N: sin «desde»", () => {
    assert.equal(calcular([ALTA({ min_noches: 7 })], "2027-01-04", "2027-01-20", 5).desde, null);
  });
  test("régimen restringido distinto al de la fila: sin «desde»", () => {
    assert.equal(calcular([ALTA({ regimen_restringido: "TI" })], "2027-01-04", "2027-01-10", 5).desde, null);
  });
});

describe("U.7.13 — límites, medición y equivalencia", () => {
  test("ventana con más candidatas que el máximo: falla cerrado con su registro", () => {
    const r = calcular([ALTA()], "2027-01-04", "2027-12-31", 5, TARIFAS, { limites: { maxCandidatas: 10, presupuestoMs: 1_000 } });
    assert.equal(r.desde, null);
    assert.equal(r.medicion.resultado, "excede_ventana");
    assert.ok(r.medicion.candidatas > 10);
  });
  test("presupuesto de tiempo excedido: falla cerrado (sin «desde» aproximado)", () => {
    let t = 0;
    const r = calcular([ALTA()], "2027-01-04", "2027-01-31", 5, TARIFAS, { limites: { maxCandidatas: 400, presupuestoMs: 3 }, reloj: () => (t += 1) });
    assert.equal(r.desde, null);
    assert.equal(r.medicion.resultado, "excede_presupuesto");
  });
  test("equivale a evaluar candidata por candidata con el motor de la reserva", () => {
    const temporadas = [ALTA()].map(toTemporadaRango), neto = netosDeColumna(filasPorClave(TARIFAS), "neto_doble");
    let min: { total: number; e: string } | null = null;
    for (let d = 4; d <= 26; d++) {
      const e = `2027-01-${String(d).padStart(2, "0")}`;
      const r = liquidarHotelNochesConTemporadas({ fechaIda: e, numNoches: 4, temporadas, netoPorTemporada: neto, hoy: HOY, regimen: "PAM" });
      if (r && (min == null || r.total < min.total)) min = { total: r.total, e };
    }
    const r = calcular([ALTA()], "2027-01-04", "2027-01-30", 4);
    assert.deepEqual([r.desde?.total, r.desde?.justificacion.entrada], [min!.total, min!.e]);
    assert.equal(r.medicion.evaluadas, 23);
  });
  test("con precio plano (sin variación por día) coincide con el «desde» de siempre (noche más barata × noches)", () => {
    const base = [vig({ nombre: "BAJA" })];
    const viejo = liquidarHotelMasBarato({ desde: "2027-01-04", hasta: "2027-01-10", numNoches: 5, temporadas: base.map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave([tar("BAJA")]), "neto_doble"), hoy: HOY, regimen: "PAM" });
    assert.equal(calcular(base, "2027-01-04", "2027-01-10", 5, [tar("BAJA")]).desde?.total, viejo);
  });
  test("límites por defecto definidos en un solo lugar", () => {
    assert.deepEqual(LIMITES_DESDE, { maxCandidatas: 400, presupuestoMs: 250 });
  });
  test("medición de coste: ventana de 90 días, 5 noches (85 candidatas) cabe holgada en el presupuesto", () => {
    const r = calcular([ALTA()], "2027-01-04", "2027-04-03", 5);
    assert.equal(r.medicion.candidatas, 85);
    assert.equal(r.medicion.resultado, "precio");
    assert.ok(r.medicion.ms < LIMITES_DESDE.presupuestoMs, `${r.medicion.ms} ms`);
    console.log(`medición «Desde»: ${r.medicion.candidatas} candidatas, ${r.medicion.evaluadas} evaluadas, ${r.medicion.ms} ms`);
  });
});

describe("presupuesto de TODA la generación (el límite por combinación no acota el total)", () => {
  const args = () => ({ desde: "2027-01-04", hasta: "2027-04-03", numNoches: 5, temporadas: [ALTA()].map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(TARIFAS), "neto_doble"), hoy: HOY, regimen: "PAM" });
  test("agotadas las candidatas del lote, las combinaciones restantes quedan sin «desde» y se cuentan", () => {
    const p = crearPresupuestoDesde({ maxEvaluadas: 200, maxMs: 10_000 });
    const r = [p.calcular(args()), p.calcular(args()), p.calcular(args())]; // 85 + 85 = 170; la tercera tiene 30 restantes < 85 ⇒ excede
    assert.deepEqual(r.map((x) => x.medicion.resultado), ["precio", "precio", "excede_ventana"]);
    assert.equal(r[2].desde, null);
    const s = p.resumen();
    assert.deepEqual({ combinaciones: s.combinaciones, conPrecio: s.conPrecio, excedidas: s.excedidas, evaluadas: s.evaluadas }, { combinaciones: 3, conPrecio: 2, excedidas: 1, evaluadas: 170 });
  });
  test("agotado el tiempo del lote: falla cerrado para lo que falta", () => {
    let t = 0;
    const p = crearPresupuestoDesde({ maxEvaluadas: 20_000, maxMs: 5 }, () => (t += 1));
    p.calcular(args());
    const r = p.calcular(args());
    assert.equal(r.desde, null);
    assert.equal(r.medicion.resultado, "excede_presupuesto");
    assert.ok(p.resumen().excedidas >= 1);
  });
  test("hotelConGrupos: solo vigencias «tarifa» con grupos", () => {
    assert.equal(hotelConGrupos([ALTA()].map(toTemporadaRango)), true);
    assert.equal(hotelConGrupos([vig({ nombre: "BAJA" })].map(toTemporadaRango)), false);
    assert.deepEqual(LIMITES_DESDE_GENERACION, { maxEvaluadas: 200_000, maxMs: 4_000 });
  });
});
