import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolverCapacidadTarifaUnidad } from "../lib/tarifario/capacidadTarifaUnidad.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) de la resolución de capacidad/reglas de
// edad de la tarifa unidad PUBLICADA — reutiliza `resolverTemporadaEstadia`
// y `seleccionarTarifaAlojamientoPublicada` (Fase 3B/3C), las MISMAS
// funciones que usa `computarReservaBernalo` internamente. Ver la cabecera
// de `lib/tarifario/capacidadTarifaUnidad.ts`.
// ─────────────────────────────────────────────────────────────────────────

const HOY = "2026-01-01";

const TEMPORADA_GENERAL = {
  nombre: "GENERAL",
  fecha_inicio: "2026-01-01",
  fecha_fin: "2026-12-31",
};

function filaTarifa(over: Partial<{ categoria: string; alimentacion: string; temporada: string; maxPax: number | null; minPax: number; hotel_id: number; estado: string }> = {}) {
  const { categoria = "Estandar", alimentacion = "PC", temporada = "GENERAL", maxPax = 3, minPax = 1, hotel_id = 216, estado = "publicada" } = over;
  return {
    id: 1,
    hotel_id,
    tarifa_id: "t-1",
    version_tarifario: "v1",
    temporada,
    categoria,
    alimentacion,
    estado,
    fuente_documento: null,
    fuente_pagina: null,
    comision_pct: 20,
    payload: {
      id: "t-1",
      versionTarifario: "v1",
      unidadCobro: "habitacion",
      comisionPct: 20,
      valores: { adulto: 700_000 },
      capacidad: { minPax, maxPax, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: {
        reglas: [
          { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 2 },
          { categoria: "nino", edadMinAnios: 3, edadMaxAnios: 10 },
        ],
      },
      temporada,
      categoria,
      alimentacion,
      fuente: null,
    },
  };
}

describe("resolverCapacidadTarifaUnidad — resolución exitosa", () => {
  test("resuelve capacidad y reglaMenores de la única tarifa publicada que coincide con hotel/temporada/categoría/alimentación", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa({ maxPax: 3, minPax: 1 })],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.capacidad, { minPax: 1, maxPax: 3, paxIncluidos: 2 });
    assert.equal(r.reglaMenores.reglas.length, 2);
  });

  test("regla 3-10 clasifica edad 8 como CHD (nino)", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa()],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const regla = r.reglaMenores.reglas.find((x) => 8 >= x.edadMinAnios && 8 <= x.edadMaxAnios);
    assert.ok(regla, "debe existir una regla que cubra la edad 8");
    assert.equal(regla!.categoria, "nino");
  });

  test("regla 0-2 clasifica edad 1 como INF (infante)", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa()],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const regla = r.reglaMenores.reglas.find((x) => 1 >= x.edadMinAnios && 1 <= x.edadMaxAnios);
    assert.ok(regla, "debe existir una regla que cubra la edad 1");
    assert.equal(regla!.categoria, "infante");
  });

  test("capacidades diferentes por combinación (categoría distinta) se resuelven por separado, sin mezclarse", () => {
    const filas = [
      filaTarifa({ categoria: "Chica", maxPax: 2 }),
      filaTarifa({ categoria: "Grande", maxPax: 5 }),
    ];
    const rChica = resolverCapacidadTarifaUnidad({ hotelId: 216, temporadasRaw: [TEMPORADA_GENERAL], filasTarifas: filas, categoria: "Chica", alimentacion: "PC", fechaIda: "2026-06-01", fechaRegreso: "2026-06-04", hoy: HOY });
    const rGrande = resolverCapacidadTarifaUnidad({ hotelId: 216, temporadasRaw: [TEMPORADA_GENERAL], filasTarifas: filas, categoria: "Grande", alimentacion: "PC", fechaIda: "2026-06-01", fechaRegreso: "2026-06-04", hoy: HOY });
    assert.equal(rChica.ok, true);
    assert.equal(rGrande.ok, true);
    if (!rChica.ok || !rGrande.ok) return;
    assert.equal(rChica.capacidad.maxPax, 2);
    assert.equal(rGrande.capacidad.maxPax, 5);
  });
});

describe("resolverCapacidadTarifaUnidad — falla cerrado, nunca inventa capacidad", () => {
  test("sin temporadas configuradas → ok:false, motivo temporada_*", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [],
      filasTarifas: [filaTarifa()],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.motivo, /^temporada_/);
  });

  test("sin tarifa publicada para la categoría/alimentación pedida → ok:false, motivo tarifa_tarifa_no_encontrada", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa({ categoria: "Estandar" })],
      categoria: "Superior", // no coincide con ninguna fila
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "tarifa_tarifa_no_encontrada");
  });

  test("tarifa de OTRO hotel no se resuelve para este hotelId (nunca cruza hoteles)", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa({ hotel_id: 999 })],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "tarifa_tarifa_no_encontrada");
  });

  test("dos filas publicadas ambiguas para la misma clasificación → ok:false, motivo tarifa_tarifa_ambigua", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa({ maxPax: 2 }), filaTarifa({ maxPax: 4 })],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "tarifa_tarifa_ambigua");
  });

  test("fila con estado distinto de publicada no participa (no encontrada)", () => {
    const r = resolverCapacidadTarifaUnidad({
      hotelId: 216,
      temporadasRaw: [TEMPORADA_GENERAL],
      filasTarifas: [filaTarifa({ estado: "borrador" })],
      categoria: "Estandar",
      alimentacion: "PC",
      fechaIda: "2026-06-01",
      fechaRegreso: "2026-06-04",
      hoy: HOY,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "tarifa_tarifa_no_encontrada");
  });
});
