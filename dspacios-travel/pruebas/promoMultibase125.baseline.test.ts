import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { analizarMixta, type MixtaParams, type MixtaBase } from "../lib/calc/calculadoras.ts";
import { resolverBasePromo } from "../lib/calc/promoCalculadora.ts";
import { liquidarHotelNoches, toTemporadaRango, type TemporadaRango } from "../lib/calc/paquetes.ts";
import type { FilaTemporadaHotelRaw, FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { basesPromoDeFilas, filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";

// #125 — CHARACTERIZATION of today's behavior across a season boundary (executor probe, English).
// These tests pin what the code does NOW so the multi-base change can prove (a) single-base promotions are
// untouched and (b) exactly which behaviors change. Nothing here asserts the desired multi-base rule except
// the `todo` at the end.
//
// Calendar (2026-12): season BASE A = Dec 1–5 (double 100.000), BASE B = Dec 6–12 (double 150.000), both priority 1.
// Promotion PRE BF = Dec 4–8, priority 5, −10 %, purchase window open. A 5-night stay from Dec 4 sleeps
// Dec 4, 5 (A) and Dec 6, 7, 8 (B).
const HOY = "2026-11-17";
const vig = (v: Partial<TemporadaRango> & { nombre: string }): TemporadaRango =>
  ({ fecha_inicio: null, fecha_fin: null, prioridad: 1, tipo: "tarifa", compra_inicio: null, compra_fin: null, regimen_restringido: null, ...v });
const A = vig({ nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const B = vig({ nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const PROMO = vig({ nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });

const mb = (temporada: string, v: Partial<MixtaBase> = {}): MixtaBase =>
  ({ categoria: "Estandar", temporada, sencilla: 0, doble: 0, triple: 0, multiple: 0, nino: 0, nino2: null, infante: null, ...v });
const params = (): MixtaParams => ({
  regimen: "PAM", iva_pct: 19,
  acom: { sencilla: { modo: "pax", iva: false }, doble: { modo: "pax", iva: false }, triple: { modo: "pax", iva: false }, multiple: { modo: "pax", iva: false } },
  nino: { iva: false }, pax: { sencilla: 1, doble: 2, triple: 3, multiple: 4 },
  bases: [
    mb("BASE A", { doble: 100_000, sencilla: 120_000, nino: 50_000, infante: 20_000 }),
    mb("BASE B", { doble: 150_000, sencilla: 180_000, nino: 75_000, infante: 30_000 }),
    mb("PRE BF"),
  ],
});

describe("#125 baseline — Mixta calculator (stored-row path)", () => {
  test("a promotion crossing two bases is refused with varias_bases and writes NO promo row", () => {
    const r = resolverBasePromo("PRE BF", [A, B, PROMO], "PAM");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "varias_bases");
    assert.match(!r.ok ? r.mensaje : "", /BASE A, BASE B/);
    const { filas, promos } = analizarMixta(params(), { vigencias: [A, B, PROMO], hoy: HOY });
    assert.equal(filas.some((f) => f.temporada === "PRE BF"), false);
    assert.equal(promos.find((p) => p.temporada === "PRE BF")?.estado, "varias_bases");
  });

  test("single-base promotion (Dec 1–3, all inside BASE A) still resolves and materializes −10 % (compatibility)", () => {
    const p1 = vig({ nombre: "PRE BF", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-03", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
    const r = resolverBasePromo("PRE BF", [A, B, p1], "PAM");
    assert.deepEqual(r, { ok: true, base: "BASE A", pct: 10 });
    const { filas } = analizarMixta(params(), { vigencias: [A, B, p1], hoy: HOY });
    const f = filas.find((x) => x.temporada === "PRE BF")!;
    assert.equal(f.neto_doble, 90_000);
    assert.equal(f.neto_infante, 20_000); // infant is NOT discounted in the stored-row path (owner rule #15)
    assert.equal(f.precio_final_autoritativo, true);
    assert.equal(f.temporada_base, "BASE A");
  });

  test("tie between two bases on the same night is a genuine conflict (base_empatada); missing base is sin_base", () => {
    const B2 = vig({ nombre: "BASE B2", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-05" });
    const e = resolverBasePromo("PRE BF", [A, B2, PROMO], "PAM");
    assert.equal(!e.ok && e.motivo, "base_empatada");
    const sinB = resolverBasePromo("PRE BF", [A, PROMO], "PAM"); // Dec 6–8 has no base
    assert.equal(!sinB.ok && sinB.motivo, "sin_base");
  });
});

// Stored-row / dynamic engine fixtures --------------------------------------------------------
const raw = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw =>
  ({ tipo_habitacion: "Estandar", alimentacion: "PAM", temporada, neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o });
const COL: Record<string, string> = { doble: "neto_doble", infante: "neto_infante" };
function liquidar(vigs: FilaTemporadaHotelRaw[], tarifas: FilaTarifaHotelRaw[], acom: "doble" | "infante", ida = "2026-12-04", n = 5) {
  const porClave = filasPorClave(tarifas);
  return liquidarHotelNoches({
    fechaIda: ida, numNoches: n, temporadas: vigs.map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, COL[acom]),
    hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: acom, ocupantes: acom === "doble" ? 2 : undefined,
  });
}
const RA = raw({ id: 1, nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const RB = raw({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const TAR = [
  tar("BASE A", { neto_doble: 100_000, neto_infante: 20_000 }),
  tar("BASE B", { neto_doble: 150_000, neto_infante: 30_000 }),
];

describe("#125 baseline — engine across the A/B boundary", () => {
  test("no promo row exists (varias_bases): the 5 nights are sold at base price, no discount, no error — 650.000", () => {
    const promoSinFila = raw({ id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
    assert.equal(liquidar([RA, RB, promoSinFila], TAR, "doble"), 2 * 100_000 + 3 * 150_000);
  });

  test("'Reglas por grupo / Base vinculada' bound to BASE A discounts ONLY the A nights (Dec 4–5): 630.000 ≠ owner rule 585.000", () => {
    const p = raw({ id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
      promo_base_id: 1, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }] });
    assert.equal(liquidar([RA, RB, p], TAR, "doble"), 2 * 90_000 + 3 * 150_000);
  });

  test("bound to BASE B instead: only Dec 6–8 are discounted — 2×100.000 + 3×135.000 = 605.000", () => {
    const p = raw({ id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
      promo_base_id: 2, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }] });
    assert.equal(liquidar([RA, RB, p], TAR, "doble"), 2 * 100_000 + 3 * 135_000);
  });

  test("DISAGREEMENT between paths: the dynamic rule discounts the INFANT, the stored-row (Mixta) path does not", () => {
    const p = raw({ id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-03", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
      promo_base_id: 1, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }] });
    assert.equal(liquidar([RA, RB, p], TAR, "infante", "2026-12-01", 3), 3 * 18_000); // dynamic: 20.000 × 0.9
    // stored-row path keeps 20.000 (see the single-base compatibility test above): 3 × 20.000 = 60.000
  });
});

describe("#125 baseline — why one stored row per base would be unsafe (rejected design)", () => {
  test("two stored rows with the same promotion name collapse silently: last row wins, no error, no trace of the other base", () => {
    const filas = [
      tar("PRE BF", { neto_doble: 90_000, temporada_base: "BASE A", precio_final_autoritativo: true } as Partial<FilaTarifaHotelRaw>),
      tar("PRE BF", { neto_doble: 135_000, temporada_base: "BASE B", precio_final_autoritativo: true } as Partial<FilaTarifaHotelRaw>),
    ];
    const porClave = filasPorClave(filas);
    assert.equal(porClave.size, 1);
    assert.deepEqual(netosDeColumna(porClave, "neto_doble"), { "PRE BF": 135_000 });
    assert.deepEqual(basesPromoDeFilas(porClave), { "PRE BF": "BASE B" });
  });

  test("a linked promotion IGNORES a leftover stored row of the same name (50.000 marker): rule result 3×90.000, no double discount, no tie", () => {
    const p = raw({ id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-03", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
      promo_base_id: 1, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }] });
    const tarConFila = [...TAR, tar("PRE BF", { neto_doble: 50_000, temporada_base: "BASE A", precio_final_autoritativo: true } as Partial<FilaTarifaHotelRaw>)];
    assert.equal(liquidar([RA, RB, p], tarConFila, "doble", "2026-12-01", 3), 3 * 90_000);
  });
});
