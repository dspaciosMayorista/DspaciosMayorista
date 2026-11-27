// Block 2026-11-22 (D) — exclusions as nights and reusable named date sets: lossless range⇄night conversion, year/leap boundaries, copy-not-link semantics, outside-validity reporting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nochesDeRangos, rangosDeNoches, normalizarRangos, nochesEntre, aplicarConjunto, exclusionesFueraDeVigencia, validarConjunto, msDeIso, sumarDias } from "../lib/hoteles/conjuntosFechas.ts";

const R = (a: string, b: string) => ({ fecha_inicio: a, fecha_fin: b });

test("dates: only REAL calendar dates parse (no 31 Feb, no 29 Feb in a common year), leap day works", () => {
  assert.equal(msDeIso("2027-02-31"), null);
  assert.equal(msDeIso("2027-02-29"), null);
  assert.notEqual(msDeIso("2028-02-29"), null);
  assert.equal(msDeIso("27-02-01"), null);
  assert.equal(sumarDias("2027-12-31", 1), "2028-01-01");
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29");
  assert.equal(sumarDias("2027-02-28", 1), "2027-03-01");
});

test("ranges → nights → ranges is lossless, merges adjacent/overlapping, keeps gaps", () => {
  const entrada = [R("2027-03-25", "2027-03-28"), R("2027-03-27", "2027-03-30"), R("2027-04-02", "2027-04-02"), R("2027-03-31", "2027-04-01")];
  assert.deepEqual(normalizarRangos(entrada), [R("2027-03-25", "2027-04-02")], "everything touches → one range");
  assert.deepEqual(normalizarRangos([R("2027-03-25", "2027-03-26"), R("2027-03-28", "2027-03-28")]), [R("2027-03-25", "2027-03-26"), R("2027-03-28", "2027-03-28")], "a one-night gap stays a gap");
  const noches = nochesDeRangos([R("2026-12-30", "2027-01-02")]);
  assert.deepEqual(noches, ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], "year boundary");
  assert.deepEqual(rangosDeNoches(noches), [R("2026-12-30", "2027-01-02")]);
});

test("invalid / reversed ranges are skipped, never throw", () => {
  assert.deepEqual(nochesDeRangos([R("2027-03-05", "2027-03-01"), R("2027-02-31", "2027-03-02"), R("x", "y")]), []);
  assert.deepEqual(rangosDeNoches(["2027-03-01", "nope", "2027-03-01"]), [R("2027-03-01", "2027-03-01")]);
});

test("the cap bounds a runaway range", () => {
  assert.equal(nochesDeRangos([R("2000-01-01", "2100-12-31")]).length, 3660);
});

test("shift-click range selection works in either direction and across the year boundary", () => {
  assert.deepEqual(nochesEntre("2027-01-02", "2026-12-30"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(nochesEntre("2027-03-01", "2027-03-01"), ["2027-03-01"]);
  assert.deepEqual(nochesEntre("bad", "2027-03-01"), []);
});

test("applying a set COPIES nights: union with existing exclusions, counts new vs already excluded", () => {
  const vigencia = [R("2027-01-01", "2027-12-31")];
  const semanaSanta = [R("2027-03-25", "2027-03-28")];
  const r1 = aplicarConjunto(vigencia, [], semanaSanta);
  assert.deepEqual(r1.blackouts, [R("2027-03-25", "2027-03-28")]);
  assert.equal(r1.agregadas, 4); assert.equal(r1.yaExcluidas, 0); assert.deepEqual(r1.fueraDeVigencia, []);
  const r2 = aplicarConjunto(vigencia, [R("2027-03-27", "2027-03-30")], semanaSanta);
  assert.deepEqual(r2.blackouts, [R("2027-03-25", "2027-03-30")]);
  assert.equal(r2.agregadas, 2); assert.equal(r2.yaExcluidas, 2);
  const r3 = aplicarConjunto(vigencia, r2.blackouts, semanaSanta);
  assert.equal(r3.agregadas, 0, "idempotent: applying twice changes nothing");
  assert.deepEqual(r3.blackouts, r2.blackouts);
});

test("a set partly outside the validity: the inside part is applied, the outside part is REPORTED (not silently dropped)", () => {
  const vigencia = [R("2027-01-10", "2027-06-30")];                       // does not cover Jan 1–9
  const receso = [R("2026-12-15", "2027-01-12")];                          // school recess crossing the new year
  const r = aplicarConjunto(vigencia, [], receso);
  assert.deepEqual(r.blackouts, [R("2027-01-10", "2027-01-12")]);
  assert.equal(r.agregadas, 3);
  assert.equal(r.fueraDeVigencia.length, 26);                              // Dec 15–31 (17) + Jan 1–9 (9)
  assert.equal(r.fueraDeVigencia[0], "2026-12-15"); assert.equal(r.fueraDeVigencia.at(-1), "2027-01-09");
});

test("validity with several ranges: a set night in the gap between two ranges is outside", () => {
  const vigencia = [R("2027-01-01", "2027-03-31"), R("2027-06-01", "2027-08-31")];
  const r = aplicarConjunto(vigencia, [], [R("2027-03-30", "2027-04-02"), R("2027-06-15", "2027-06-16")]);
  assert.deepEqual(r.blackouts, [R("2027-03-30", "2027-03-31"), R("2027-06-15", "2027-06-16")]);
  assert.deepEqual(r.fueraDeVigencia, ["2027-04-01", "2027-04-02"]);
});

test("exclusionesFueraDeVigencia warns when the validity is shortened after choosing exclusions", () => {
  assert.deepEqual(exclusionesFueraDeVigencia([R("2027-01-01", "2027-02-28")], [R("2027-02-27", "2027-03-02")]), ["2027-03-01", "2027-03-02"]);
  assert.deepEqual(exclusionesFueraDeVigencia([R("2027-01-01", "2027-12-31")], [R("2027-02-27", "2027-03-02")]), []);
});

test("an exclusion never touches another validity: the copy lives in the caller's own blackouts array (inputs are not mutated)", () => {
  const vigA = [R("2027-01-01", "2027-06-30")], vigB = [R("2027-07-01", "2027-12-31")];
  const bA: ReturnType<typeof R>[] = [], bB: ReturnType<typeof R>[] = [];
  const copia = JSON.stringify([vigA, vigB, bA, bB]);
  aplicarConjunto(vigA, bA, [R("2027-03-25", "2027-03-28")]);
  assert.equal(JSON.stringify([vigA, vigB, bA, bB]), copia, "inputs untouched");
  assert.deepEqual(aplicarConjunto(vigB, bB, [R("2027-03-25", "2027-03-28")]).blackouts, [], "the same set applied to validity B (which does not cover it) adds nothing to B");
});

test("validarConjunto: required name/year/type, real dates, at least one night, normalises, trims", () => {
  const ok = validarConjunto({ nombre: "  Semana Santa  ", anio: 2027, tipo: "semana_santa", rangos: [R("2027-03-27", "2027-03-28"), R("2027-03-25", "2027-03-26")], nota: " " });
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.nombre, "Semana Santa"); assert.deepEqual(ok.rangos, [R("2027-03-25", "2027-03-28")]); assert.equal(ok.nota, null); }
  for (const [mal, esperado] of [
    [{ nombre: "", anio: 2027, tipo: "festivos", rangos: [R("2027-01-01", "2027-01-01")] }, /nombre/],
    [{ nombre: "x", anio: 1999, tipo: "festivos", rangos: [R("2027-01-01", "2027-01-01")] }, /año/],
    [{ nombre: "x", anio: 2027, tipo: "otro", rangos: [R("2027-01-01", "2027-01-01")] }, /Tipo/],
    [{ nombre: "x", anio: 2027, tipo: "festivos", rangos: [] }, /al menos una noche/],
    [{ nombre: "x", anio: 2027, tipo: "festivos", rangos: [R("2027-02-31", "2027-03-01")] }, /no válida/],
    [{ nombre: "x", anio: 2027, tipo: "festivos", rangos: [R("2027-03-05", "2027-03-01")] }, /anterior/],
  ] as const) {
    const r = validarConjunto(mal as never);
    assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, esperado);
  }
});
