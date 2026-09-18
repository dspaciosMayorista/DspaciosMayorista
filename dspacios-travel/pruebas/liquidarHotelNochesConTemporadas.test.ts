import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  liquidarHotelNoches,
  liquidarHotelNochesConTemporadas,
  toTemporadaRango,
  type TemporadaRango,
} from "../lib/calc/paquetes.ts";

// ───────────────────────────────────────────────────────────────────────────
// `liquidarHotelNochesConTemporadas` (ronda Dubai — edades propias): mismo
// motor de `liquidarHotelNoches`, pero identificando TAMBIÉN el nombre de
// cada temporada 'tarifa' que aportó neto a alguna noche de la estadía — la
// identidad que consume `resolverReglaEdadEstadia` desde `computo.ts`, sin
// volver a consultar ni inferir nada desde el total agregado.
// ───────────────────────────────────────────────────────────────────────────

const HOY = "2026-01-01";

function temporada(overrides: Partial<Parameters<typeof toTemporadaRango>[0]>): TemporadaRango {
  return toTemporadaRango({
    nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    ...overrides,
  });
}

describe("1. Paridad histórica — mismo total que liquidarHotelNoches", () => {
  test("una sola temporada, 3 noches → total idéntico, temporadasTarifa = [ALTA]", () => {
    const temporadas = [temporada({})];
    const netoPorTemporada = { ALTA: 100_000 };
    const esperado = liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY });
    const r = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY });
    assert.ok(r);
    assert.equal(r!.total, esperado);
    assert.deepEqual(r!.temporadasTarifa, ["ALTA"]);
  });

  test("sin tarifa aplicable en alguna noche → null, igual que liquidarHotelNoches", () => {
    const temporadas = [temporada({ fecha_inicio: "2026-09-01", fecha_fin: "2026-09-02" })]; // no cubre 2026-09-05
    const netoPorTemporada = { ALTA: 100_000 };
    assert.equal(liquidarHotelNoches({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY }), null);
    assert.equal(liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY }), null);
  });
});

describe("2. Multitemporada — mezcla noche por noche", () => {
  test("estadía que cruza ALTA → MEDIA (sin solape) → temporadasTarifa trae ambas, sin duplicados", () => {
    const temporadas = [
      temporada({ nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-13" }),
      temporada({ nombre: "MEDIA", fecha_inicio: "2026-09-14", fecha_fin: "2026-09-20" }),
    ];
    const netoPorTemporada = { ALTA: 100_000, MEDIA: 120_000 };
    // Noches: 12 (ALTA), 13 (ALTA), 14 (MEDIA).
    const r = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-12", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY });
    assert.ok(r);
    assert.equal(r!.total, 100_000 + 100_000 + 120_000);
    assert.deepEqual([...r!.temporadasTarifa].sort(), ["ALTA", "MEDIA"]);
  });

  test("estadía completa dentro de UNA sola temporada de las dos → temporadasTarifa trae solo esa", () => {
    const temporadas = [
      temporada({ nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-13" }),
      temporada({ nombre: "MEDIA", fecha_inicio: "2026-09-14", fecha_fin: "2026-09-20" }),
    ];
    const netoPorTemporada = { ALTA: 100_000, MEDIA: 120_000 };
    const r = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-01", numNoches: 3, temporadas, netoPorTemporada, hoy: HOY });
    assert.deepEqual(r!.temporadasTarifa, ["ALTA"]);
  });
});

describe("3. Vigencia de descuento — regla definitiva: solo gana si tiene fila materializada en tarifa_hotel", () => {
  test("descuento_pct SIN fila materializada: se ignora por completo, la BASE gana con su propio neto SIN descontar", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const promo: TemporadaRango = toTemporadaRango({
      nombre: "PROMO_VERANO", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
      prioridad: 2, compra_inicio: null, compra_fin: null, tipo: "descuento_pct", descuento_valor: 10,
      rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    });
    const temporadas = [base, promo];
    // Sin entrada para "PROMO_VERANO" — nunca se materializó una fila de
    // tarifa_hotel para ese combo. Una vigencia NUNCA deriva un precio: se
    // ignora y la resolución sigue bajando por prioridad hasta la BASE.
    const netoPorTemporada = { ALTA: 100_000 };
    const r = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY });
    assert.ok(r);
    // 100000 × 2 noches = 200000 — SIN descuento (antes: 90000×2=180000, el
    // camino "legacy" retirado en esta ronda).
    assert.equal(r!.total, 200_000);
    assert.deepEqual(r!.temporadasTarifa, ["ALTA"]);
  });

  test("descuento_pct CON fila materializada: usa EXACTAMENTE esa fila, nunca recalcula desde la base", () => {
    const base = temporada({ nombre: "ALTA", prioridad: 1 });
    const promo: TemporadaRango = toTemporadaRango({
      nombre: "PROMO_VERANO", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
      prioridad: 2, compra_inicio: null, compra_fin: null, tipo: "descuento_pct", descuento_valor: 10,
      rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    });
    const temporadas = [base, promo];
    // Fila materializada para "PROMO_VERANO" (típicamente generada por la
    // calculadora) — el valor exacto que hay que usar, sin importar
    // `descuento_valor` de la vigencia.
    const netoPorTemporada = { ALTA: 100_000, PROMO_VERANO: 90_000 };
    const r = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada, hoy: HOY });
    assert.ok(r);
    assert.equal(r!.total, 180_000); // 90.000 × 2 — la fila materializada, tal cual
    assert.deepEqual(r!.temporadasTarifa, ["PROMO_VERANO"]);
  });
});

describe("4. La regla de edad NUNCA debe leerse de niño/niño2/infante — control por diseño", () => {
  test("dos llamadas independientes (una por columna neta) no se mezclan entre sí: cada una reporta solo SU propia temporada de origen", () => {
    // Simula lo que hace `evaluarHotelPorFechas`: una llamada por acomodación,
    // cada una con su propio `netoPorTemporada` (columna neta distinta). La
    // llamada de "doble" no debe verse afectada por que "nino" tenga tarifa
    // en una temporada donde "doble" no la tiene.
    const temporadas = [
      temporada({ nombre: "ALTA" }),
      temporada({ nombre: "SOLO_NINO", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30", prioridad: 2 }),
    ];
    const netoDoble = { ALTA: 100_000, SOLO_NINO: null }; // SOLO_NINO no aporta a "doble"
    const netoNino = { ALTA: null, SOLO_NINO: 40_000 };   // SOLO_NINO sí aporta a "nino"
    const rDoble = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada: netoDoble, hoy: HOY });
    const rNino = liquidarHotelNochesConTemporadas({ fechaIda: "2026-09-05", numNoches: 2, temporadas, netoPorTemporada: netoNino, hoy: HOY });
    assert.deepEqual(rDoble!.temporadasTarifa, ["ALTA"]);
    assert.deepEqual(rNino!.temporadasTarifa, ["SOLO_NINO"]);
  });
});
