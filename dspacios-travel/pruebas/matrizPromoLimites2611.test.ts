// Owner correction batch 2026-11-18 · gap G6 — boundaries of the DERIVED promotional matrix that matrizPromoDerivada125.test.ts does not cover:
//   · a base sold by WEEKDAY GROUPS (the 293 migration forces groups inactive in production; the matrix must say so, never invent a number for that base);
//   · per-base regimen supplements (Dubai «suplementos propios»): the effective supplement of EACH base enters its own tariff, the promotion discounts the complete tariff, the infant keeps its base rate;
//   · hotel currency: the matrix values are the stored rows' values (a USD hotel stays USD, no conversion, no rounding to pesos);
//   · missing-rate honesty with Dubai-generated rows and a regimen without any base row.
// All expected numbers are hand-calculated in the comments (not read from the production helper being tested).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toTemporadaRango } from "../lib/calc/paquetes.ts";
import { promocionesSigueBase, type FilaTarifaFicha } from "../lib/hoteles/promocionesDinamicas.ts";
import { generarTarifasDubai, type DubaiParams } from "../lib/calc/calculadoras.ts";
import type { FilaTemporadaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

const raw = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const RA = raw({ id: 1, nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const RB = raw({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const PRE = raw({
  id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
  promo_sigue_base: true, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }],
} as Partial<FilaTemporadaHotelRaw> & { nombre: string });
const GRUPO_ACTIVO = [{ id: "g-lun-jue", dias: [1, 2, 3, 4], activo: true }, { id: "g-vie-dom", dias: [5, 6, 7], activo: true }];
const conGrupos = (r: FilaTemporadaHotelRaw) => ({ ...r, hotel_temporada_grupos: GRUPO_ACTIVO }) as FilaTemporadaHotelRaw;

const PARAMS: DubaiParams = {
  regimen_base: "PAM",
  modificadores: { sencilla_pct: 20, pax3_pct: -15, pax4_pct: -25, nino_pct: -50, nino2_pct: -60, infante_pct: -80 },
  suplementos: [{ regimen: "FULL", monto: 30_000 }],
  bases: [{ categoria: "Estandar", temporada: "BASE A", precio: 100_000 }, { categoria: "Estandar", temporada: "BASE B", precio: 150_000 }],
};
const filas = (p: DubaiParams) => generarTarifasDubai(p) as unknown as FilaTarifaFicha[];
const matriz = (vigs: FilaTemporadaHotelRaw[], tarifas: FilaTarifaFicha[]) => promocionesSigueBase(vigs.map(toTemporadaRango), tarifas);
const celda = (p: ReturnType<typeof matriz>[number], base: string, regimen: string, acom: string) => p.lineas.find((l) => l.base === base && l.regimen === regimen && l.acomodacion === acom)?.netoResultante;

describe("G6 · base vendida por GRUPOS de días: modo explícito, nunca una cifra inventada", () => {
  test("BASE B con grupos activos: la matriz muestra BASE A normal y para BASE B solo una nota (ninguna línea ni valor de BASE B)", () => {
    const [p] = matriz([RA, conGrupos(RB), PRE], filas(PARAMS));
    assert.ok(p.lineas.length > 0, "BASE A sí tiene matriz");
    assert.equal(p.lineas.filter((l) => l.base === "BASE B").length, 0, "ninguna tarifa inventada para la base por grupos");
    assert.ok(p.lineas.every((l) => l.base === "BASE A"));
    assert.ok((p.notas ?? []).some((n) => /BASE B se vende por grupos de días/.test(n)), "la nota lo dice con el nombre de la base");
    // a mano: BASE A PAM doble 100.000 − 10 % = 90.000 (4–5 dic); la celda de BASE B (150.000 − 10 % = 135.000) NO existe (otras celdas de A pueden valer 135.000: FULL Sencilla (120.000+30.000)×0,9)
    assert.equal(celda(p, "BASE A", "PAM", "Doble"), 90_000);
    assert.equal(celda(p, "BASE B", "PAM", "Doble"), undefined, "no se calcula la celda de una base por grupos");
  });

  test("las dos bases por grupos: no hay nada que mostrar y el estado es «no vende» con el motivo explícito (no una matriz vacía silenciosa)", () => {
    const [p] = matriz([conGrupos(RA), conGrupos(RB), PRE], filas(PARAMS));
    assert.equal(p.lineas.length, 0);
    assert.equal(p.estado, "no_vende");
    assert.match(p.motivo ?? "", /se vende por grupos de días/);
  });

  test("un grupo INACTIVO no cuenta (la 293 los obliga inactivos): la base se muestra como siempre", () => {
    const inactivos = [{ id: "g1", dias: [1, 2, 3], activo: false }];
    const [p] = matriz([RA, ({ ...RB, hotel_temporada_grupos: inactivos }) as FilaTemporadaHotelRaw, PRE], filas(PARAMS));
    assert.equal(celda(p, "BASE B", "PAM", "Doble"), 135_000, "150.000 − 10 %");
    assert.equal(p.notas?.some((n) => /se vende por grupos/.test(n)) ?? false, false);
  });
});

describe("G6 · suplementos de régimen EFECTIVOS por base (Dubai «suplementos propios»)", () => {
  // BASE A usa el suplemento general FULL +30.000; BASE B reemplaza con FULL +50.000. Promoción −10 % sobre la tarifa COMPLETA; el infante conserva la tarifa de su base.
  const params: DubaiParams = { ...PARAMS, bases: [PARAMS.bases[0], { ...PARAMS.bases[1], usarSuplementosPropios: true, suplementosPropios: [{ regimen: "FULL", monto: 50_000 }] }] };
  const generadas = filas(params);
  const [p] = matriz([RA, RB, PRE], generadas);

  test("las filas guardadas ya traen el suplemento efectivo de cada base (a mano: A 100.000+30.000 = 130.000; B 150.000+50.000 = 200.000)", () => {
    const f = (t: string) => generadas.find((x) => x.temporada === t && x.alimentacion === "FULL") as unknown as Record<string, number>;
    assert.equal(f("BASE A").neto_doble, 130_000);
    assert.equal(f("BASE B").neto_doble, 200_000);
  });

  test("matriz FULL por base: A Doble 130.000×0,9 = 117.000; B Doble 200.000×0,9 = 180.000 (cada base con SU suplemento, nunca el de la otra)", () => {
    assert.equal(celda(p, "BASE A", "FULL", "Doble"), 117_000);
    assert.equal(celda(p, "BASE B", "FULL", "Doble"), 180_000);
    // Sencilla: A (120.000 + 30.000) = 150.000 ×0,9 = 135.000 ; B (180.000 + 50.000) = 230.000 ×0,9 = 207.000
    assert.equal(celda(p, "BASE A", "FULL", "Sencilla"), 135_000);
    assert.equal(celda(p, "BASE B", "FULL", "Sencilla"), 207_000);
  });

  test("infante FULL: conserva la tarifa de SU base con SU suplemento (A 20.000+30.000 = 50.000; B 30.000+50.000 = 80.000), sin descuento", () => {
    assert.equal(celda(p, "BASE A", "FULL", "Infante"), 50_000);
    assert.equal(celda(p, "BASE B", "FULL", "Infante"), 80_000);
  });

  test("PAM (régimen base) no suma suplemento en ninguna base: A Doble 90.000, B Doble 135.000", () => {
    assert.equal(celda(p, "BASE A", "PAM", "Doble"), 90_000);
    assert.equal(celda(p, "BASE B", "PAM", "Doble"), 135_000);
  });
});

describe("G6 · moneda del hotel y tarifas ausentes", () => {
  test("hotel en USD: los importes de la matriz son los de las filas guardadas en USD (Doble USD 100 → USD 90; Triple 95 → 85,5), sin conversión ni redondeo a pesos", () => {
    const usd: DubaiParams = { ...PARAMS, bases: [{ categoria: "Estandar", temporada: "BASE A", precio: 100 }, { categoria: "Estandar", temporada: "BASE B", precio: 150 }], suplementos: [{ regimen: "FULL", monto: 30 }] };
    const [p] = matriz([RA, RB, PRE], filas(usd));
    assert.equal(celda(p, "BASE A", "PAM", "Doble"), 90);
    assert.equal(celda(p, "BASE A", "PAM", "Triple"), 85.5, "95 × 0,9 con decimales, no 86 ni 85");
    assert.equal(celda(p, "BASE B", "FULL", "Doble"), 162, "(150 + 30) × 0,9");
  });

  test("régimen sin NINGUNA fila de base (p. ej. FULL sin tarifas guardadas): no hay matriz FULL inventada, solo la del régimen que sí tiene filas", () => {
    const soloPam = filas(PARAMS).filter((f) => f.alimentacion === "PAM");
    const [p] = matriz([RA, RB, PRE], soloPam);
    assert.deepEqual([...new Set(p.lineas.map((l) => l.regimen))], ["PAM"]);
  });

  test("tarifa de habitación en 0 = sin tarifa (nunca «gratis»); en un niño 0 es gratis y se publica como 0", () => {
    const base = filas(PARAMS).map((f) => (f.temporada === "BASE B" && f.alimentacion === "PAM" ? ({ ...f, neto_triple: 0, neto_nino: 0 }) : f));
    const [p] = matriz([RA, RB, PRE], base);
    assert.equal(celda(p, "BASE B", "PAM", "Triple"), null, "0 en una acomodación de habitación = sin tarifa");
    assert.equal(celda(p, "BASE B", "PAM", "Niño 1"), 0, "0 en un niño es una tarifa gratis publicada");
  });
});
