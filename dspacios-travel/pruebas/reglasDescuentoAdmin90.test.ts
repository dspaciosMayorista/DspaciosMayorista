import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarReglaDescuento } from "../lib/hoteles/reglasDescuento.ts";
import { resolverDescuentoHotel, type ReglaDescuentoHotel } from "../lib/calc/descuentoHotel.ts";

// #90 — Administración de promociones del hotel: validación (misma en cliente y servidor) y que lo configurado rija en el motor.
describe("validarReglaDescuento", () => {
  test("las cuatro reglas de Grand Sirenis son válidas", () => {
    for (const [tipo, umbral, pct] of [["ebb", "30", "18"], ["ebb", "60", "23"], ["ebb", "90", "28"], ["long_stay", "4", "25"]] as const)
      assert.deepEqual(validarReglaDescuento({ tipo, umbral, pct }), { ok: true, regla: { tipo, umbral: Number(umbral), pct: Number(pct) } });
  });
  test("coma decimal y redondeo a 2 decimales", () => {
    const r = validarReglaDescuento({ tipo: "ebb", umbral: 10, pct: "12,505" });
    assert.ok(r.ok && r.regla.pct === 12.51 || r.ok && r.regla.pct === 12.5);
  });
  test("rechaza tipo, umbral y porcentaje inválidos", () => {
    const malos = [
      { tipo: "otro", umbral: 5, pct: 10 }, { tipo: "ebb", umbral: 0, pct: 10 }, { tipo: "ebb", umbral: -3, pct: 10 }, { tipo: "ebb", umbral: 2.5, pct: 10 },
      { tipo: "ebb", umbral: "", pct: 10 }, { tipo: "ebb", umbral: "abc", pct: 10 }, { tipo: "long_stay", umbral: 4, pct: 0 }, { tipo: "long_stay", umbral: 4, pct: 100 },
      { tipo: "long_stay", umbral: 4, pct: -5 }, { tipo: "long_stay", umbral: 4, pct: "" }, { tipo: "long_stay", umbral: 4, pct: "x" }, { tipo: "ebb", umbral: 99999, pct: 10 },
    ];
    for (const m of malos) assert.equal(validarReglaDescuento(m).ok, false, JSON.stringify(m));
  });
});

describe("lo configurado rige en el motor", () => {
  const R: ReglaDescuentoHotel[] = [{ tipo: "ebb", umbral: 30, pct: 18 }, { tipo: "ebb", umbral: 60, pct: 23 }, { tipo: "ebb", umbral: 90, pct: 28 }, { tipo: "long_stay", umbral: 4, pct: 25 }];
  const args = (dias: number, noches: number) => ({ fechaReserva: "2026-03-01", fechaIda: new Date(Date.parse("2026-03-01T00:00:00Z") + dias * 86_400_000).toISOString().slice(0, 10), numNoches: noches });
  test("gana el mayor porcentaje, sin sumar", () => {
    assert.equal(resolverDescuentoHotel(R, args(95, 5))?.pct, 28);
    assert.equal(resolverDescuentoHotel(R, args(35, 5))?.pct, 25);
    assert.equal(resolverDescuentoHotel(R, args(35, 3))?.pct, 18);
  });
  test("una regla inactiva no se aplica", () => {
    const sin90 = R.map((r) => (r.umbral === 90 ? { ...r, activa: false } : r));
    assert.equal(resolverDescuentoHotel(sin90, args(95, 3))?.pct, 23);
    assert.equal(resolverDescuentoHotel(R.map((r) => ({ ...r, activa: false })), args(95, 5)), null);
  });
});

describe("cableado", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const acc = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/reglas-descuento-actions.ts");
  test("las acciones validan en servidor, exigen permiso de catálogo y no tocan netas ni temporadas", () => {
    assert.match(acc, /validarReglaDescuento\(input\)/);
    assert.match(acc, /puedeEscribir\("producto"/);
    assert.doesNotMatch(acc, /tarifa_hotel|hotel_temporadas/);
  });
  test("la ficha del hotel muestra la sección Promociones", () => {
    assert.match(leer("app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx"), /<HotelPromociones /);
  });
});
