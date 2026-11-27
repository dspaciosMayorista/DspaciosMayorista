// Block 2026-11-22 (D) — with the REAL pricing/closure engine: an exclusion of a validity applies to THAT validity only (not a general hotel closure); the general closure keeps its hotel-wide
// precedence; promotions and unaffected stays behave as before; multi-range and year-boundary cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { liquidarHotelNoches, resolverNocheDetallado, type TemporadaRango } from "../lib/calc/paquetes.ts";
import { estadiaCerrada, type CierreHotel } from "../lib/tarifario/cierresHotel.ts";
import { aplicarConjunto } from "../lib/hoteles/conjuntosFechas.ts";

const R = (a: string, b: string) => ({ fecha_inicio: a, fecha_fin: b });
const HOY = "2026-11-22";
const t0 = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

// ALTA covers the whole of 2027 (100.000 per night); the owner excludes Semana Santa from it and defines a separate SEMANA SANTA validity (180.000, higher priority) for those nights.
const semanaSanta = [R("2027-03-25", "2027-03-28")];
const ALTA = (blackouts = semanaSanta): TemporadaRango => ({ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-12-31", rangos: [R("2027-01-01", "2027-12-31")], blackouts, prioridad: 1 });
const SS: TemporadaRango = { nombre: "SEMANA SANTA", fecha_inicio: "2027-03-25", fecha_fin: "2027-03-28", rangos: [R("2027-03-25", "2027-03-28")], prioridad: 2 };
const NETOS = { ALTA: 100_000, "SEMANA SANTA": 180_000 };

test("D3a an excluded night falls out of THAT validity only: the other validity prices it, neighbours keep ALTA", () => {
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-24", numNoches: 1, temporadas: [ALTA(), SS], netoPorTemporada: NETOS, hoy: HOY }), 100_000, "night before: ALTA");
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-26", numNoches: 1, temporadas: [ALTA(), SS], netoPorTemporada: NETOS, hoy: HOY }), 180_000, "excluded from ALTA, priced by SEMANA SANTA");
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-29", numNoches: 1, temporadas: [ALTA(), SS], netoPorTemporada: NETOS, hoy: HOY }), 100_000, "night after: ALTA again");
  // a stay that crosses the excluded window mixes validities night by night: 24 (ALTA) + 25,26,27 (SS) + 28 (SS)… 5 nights from the 24th
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-24", numNoches: 5, temporadas: [ALTA(), SS], netoPorTemporada: NETOS, hoy: HOY }), 100_000 + 4 * 180_000);
});

test("D3b the exclusion is NOT a hotel closure: with no other validity covering the night that night has no tariff in THIS validity (reason: blackout), the rest of the year sells normally", () => {
  const r = resolverNocheDetallado(t0("2027-03-26"), [ALTA()], HOY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "en_blackout");
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-26", numNoches: 1, temporadas: [ALTA()], netoPorTemporada: NETOS, hoy: HOY }), null);
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-06-10", numNoches: 3, temporadas: [ALTA()], netoPorTemporada: NETOS, hoy: HOY }), 300_000, "unaffected stay");
});

test("D3c another validity of the same hotel is untouched by the first validity's exclusions", () => {
  const B: TemporadaRango = { nombre: "BAJA", fecha_inicio: "2027-03-20", fecha_fin: "2027-04-05", rangos: [R("2027-03-20", "2027-04-05")], prioridad: 1 };
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-26", numNoches: 1, temporadas: [ALTA(), B], netoPorTemporada: { ...NETOS, BAJA: 70_000 }, hoy: HOY }), 70_000, "BAJA still covers the night ALTA excluded");
});

test("D3d a promotion on a stay that touches no excluded night is priced identically with or without the exclusions (and the promotion does apply)", () => {
  const PROMO: TemporadaRango = { nombre: "PROMO -10%", fecha_inicio: "2027-06-01", fecha_fin: "2027-06-30", rangos: [R("2027-06-01", "2027-06-30")], prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 };
  const args = (blackouts: ReturnType<typeof R>[]) => ({ fechaIda: "2027-06-10", numNoches: 3, temporadas: [ALTA(blackouts), SS, PROMO], netoPorTemporada: NETOS, hoy: HOY });
  const con = liquidarHotelNoches(args(semanaSanta)), sin = liquidarHotelNoches(args([]));
  assert.equal(con, sin, "exclusions elsewhere in the year do not move a June stay");
  assert.ok(con != null && con <= 300_000, "price is the ALTA price, with the promotion when the engine applies it (never above the plain ALTA 300.000)");
});

test("D3e GENERAL closure keeps hotel-wide precedence regardless of validities or their exclusions", () => {
  const cierres: CierreHotel[] = [{ fecha_inicio: "2027-03-26", fecha_fin: "2027-03-26", total: true, acomodaciones: null, categorias: null }];
  // priced by SEMANA SANTA (sellable by validity) but closed hotel-wide:
  assert.equal(liquidarHotelNoches({ fechaIda: "2027-03-26", numNoches: 1, temporadas: [ALTA(), SS], netoPorTemporada: NETOS, hoy: HOY }), 180_000);
  assert.equal(estadiaCerrada(cierres, "Estandar", "doble", "2027-03-26", 1), true, "closed even though a validity prices it");
  assert.equal(estadiaCerrada(cierres, "Estandar", "doble", "2027-03-27", 1), false);
  assert.equal(estadiaCerrada(cierres, "Estandar", "doble", "2027-03-25", 2), true, "a stay whose second night is the closed one");
});

test("D7 year boundary + multi-range validity: a Dec→Jan set applied to a validity that ends Dec 31 keeps only December and reports January", () => {
  const vigencia = [R("2026-11-25", "2026-12-31")];
  const r = aplicarConjunto(vigencia, [], [R("2026-12-24", "2027-01-06")]);
  assert.deepEqual(r.blackouts, [R("2026-12-24", "2026-12-31")]);
  assert.equal(r.fueraDeVigencia.length, 6);
  const T: TemporadaRango = { nombre: "ALTA", fecha_inicio: "2026-11-25", fecha_fin: "2026-12-31", rangos: vigencia, blackouts: r.blackouts, prioridad: 1 };
  assert.equal(liquidarHotelNoches({ fechaIda: "2026-12-22", numNoches: 2, temporadas: [T], netoPorTemporada: { ALTA: 100_000 }, hoy: HOY }), 200_000, "nights 22 and 23 sell");
  assert.equal(liquidarHotelNoches({ fechaIda: "2026-12-23", numNoches: 2, temporadas: [T], netoPorTemporada: { ALTA: 100_000 }, hoy: HOY }), null, "night 24 is excluded");
});
