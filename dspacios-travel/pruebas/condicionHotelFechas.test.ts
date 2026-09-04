import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { condicionHotelFechas, type FilaTemporadaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

// ───────────────────────────────────────────────────────────────────────────
// Badges de condición de pago en Vista Booking / carrito — auditoría del
// dueño (caso real reportado: hotel ZUANA BEACH RESORT, 15/09/2026 →
// 17/09/2026, categoría Estándar, régimen PC). El catálogo YA tenía
// condiciones/restricciones cargadas (migración 164) pero nunca llegaban al
// resultado de búsqueda ni al carrito — `evaluarHotelPorFechas` (el motor de
// PRECIO) nunca las selecciona ni las necesita. `condicionHotelFechas` es la
// pieza nueva y separada que sí las resuelve, reutilizando el MISMO motor
// puro que ya congela la condición en el contrato (Rama B, PR #282:
// `condicionHotelEstadia`/`barridoRestriccionEstadia`) — nunca un criterio
// nuevo o distinto.
// ───────────────────────────────────────────────────────────────────────────

function vigenciaPagoTotal(overrides: Partial<FilaTemporadaHotelRaw> = {}): FilaTemporadaHotelRaw {
  return {
    id: 1, nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30",
    condicion_pago_tipo: "pago_total", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
    ...overrides,
  };
}
function vigenciaAnticipo(overrides: Partial<FilaTemporadaHotelRaw> = {}): FilaTemporadaHotelRaw {
  return {
    id: 2, nombre: "MEDIA", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31",
    condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.5, condicion_pago_dias_saldo: 45,
    ...overrides,
  };
}
function vigenciaSinCondicion(overrides: Partial<FilaTemporadaHotelRaw> = {}): FilaTemporadaHotelRaw {
  return {
    id: 3, nombre: "BAJA", fecha_inicio: "2026-11-01", fecha_fin: "2026-11-30",
    condicion_pago_tipo: "sin_condicion", condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
    ...overrides,
  };
}

describe("condicionHotelFechas — caso real: fecha DENTRO de una vigencia con condición", () => {
  test("ZUANA BEACH RESORT 15/09→17/09 dentro de 'ALTA' (pago_total) → condición + restricción", () => {
    const r = condicionHotelFechas([vigenciaPagoTotal()], { fechaIda: "2026-09-15", fechaRegreso: "2026-09-17" });
    assert.ok(r);
    assert.equal(r!.condicionPagoTipo, "pago_total");
    assert.equal(r!.restringido, true, "pago_total implica no_reembolsable_no_endosable (restriccionImplicitaHotel)");
  });

  test("estadía dentro de una vigencia anticipo_saldo → conserva pctInicial/diasSaldo exactos", () => {
    const r = condicionHotelFechas([vigenciaAnticipo()], { fechaIda: "2026-10-05", fechaRegreso: "2026-10-08" });
    assert.ok(r);
    assert.equal(r!.condicionPagoTipo, "anticipo_saldo");
    assert.equal(r!.pctInicial, 0.5);
    assert.equal(r!.diasSaldo, 45);
    assert.equal(r!.restringido, true);
  });

  test("estadía que cruza DOS vigencias con condición distinta → gana la más exigente (mismo motor que el congelado del contrato)", () => {
    // 1 noche en ALTA (pago_total) + 1 noche en MEDIA (anticipo 50%, lejos del
    // bump de cierre) — pago_total (100%) es más exigente que un anticipo del
    // 50%. `fechaPago` explícito ("hoy" fijo) para que la prueba nunca dependa
    // de la fecha real del sistema (mismo criterio que liquidacionHotel.test.ts).
    const r = condicionHotelFechas(
      [vigenciaPagoTotal({ fecha_inicio: "2026-09-29", fecha_fin: "2026-10-01" }), vigenciaAnticipo({ fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" })],
      { fechaIda: "2026-09-30", fechaRegreso: "2026-10-02" },
      "2026-01-01",
    );
    assert.ok(r);
    assert.equal(r!.condicionPagoTipo, "pago_total");
    assert.equal(r!.restringido, true);
  });
});

describe("condicionHotelFechas — fecha FUERA de vigencia no debe mostrar condición", () => {
  test("estadía en un hueco sin ninguna temporada cargada → neutra (sin_condicion, sin restricción)", () => {
    const r = condicionHotelFechas([vigenciaPagoTotal({ fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15" })], {
      fechaIda: "2026-12-01", fechaRegreso: "2026-12-03",
    });
    assert.ok(r, "hay vigencias con datos completos, así que resuelve (no null) — pero neutra");
    assert.equal(r!.condicionPagoTipo, "sin_condicion");
    assert.equal(r!.restringido, false);
  });

  test("vigencia real explícitamente sin_condicion cubriendo la estadía → sin badge (neutra, sin restricción)", () => {
    const r = condicionHotelFechas([vigenciaSinCondicion()], { fechaIda: "2026-11-10", fechaRegreso: "2026-11-12" });
    assert.ok(r);
    assert.equal(r!.condicionPagoTipo, "sin_condicion");
    assert.equal(r!.restringido, false);
  });

  test("hotel sin ninguna temporada con datos de condición completos (id/condicion_pago_tipo faltantes) → null, nunca una condición inventada", () => {
    const r1 = condicionHotelFechas([], { fechaIda: "2026-09-15", fechaRegreso: "2026-09-17" });
    assert.equal(r1, null);

    const incompleta: FilaTemporadaHotelRaw = { nombre: "SIN ID", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30" };
    const r2 = condicionHotelFechas([incompleta], { fechaIda: "2026-09-15", fechaRegreso: "2026-09-17" });
    assert.equal(r2, null, "sin id/condicion_pago_tipo no se puede resolver — nunca se asume neutra por defecto");
  });
});
