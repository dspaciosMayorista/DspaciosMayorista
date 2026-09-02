// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS del snapshot de condiciones (lib/cotizacion/snapshotCondiciones.ts).
// Sin Supabase, sin SQL. Se corren con `npm run test:unit`.
//
// Cubre el "cálculo y snapshot" (Commit 2):
//   · HOTEL cruzando vigencias por noches → la más exigente de las presentes;
//   · noches vacías (sin vigencia) → neutra;
//   · vigencias con huecos → neutra en el hueco;
//   · construirSnapshot: filas ordenadas + agregados (monto COP con TRM);
//   · restricción comercial pasa a la fila;
//   · redondeo del valor/monto a 2 decimales.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nochesEntre,
  vigenciaCubreFecha,
  condicionHotelEstadia,
  construirSnapshot,
} from "../lib/cotizacion/snapshotCondiciones.ts";

const sinC = { tipo: "sin_condicion" as const, pctInicial: null, diasSaldo: null };
const pagoTotal = { tipo: "pago_total" as const, pctInicial: null, diasSaldo: null };
const anticipo60 = { tipo: "anticipo_saldo" as const, pctInicial: 0.6, diasSaldo: 30 };
const F = "2026-08-01"; // fechaPago fija

function vg(cond: typeof sinC, inicio: string, fin: string, nombre = "T", id: number | null = null) {
  return { ...cond, hotelTemporadaId: id, nombre, fechaInicio: inicio, fechaFin: fin };
}

describe("nochesEntre / vigenciaCubreFecha", () => {
  test("enlista [desde,hasta) día a día", () => {
    assert.deepEqual(nochesEntre("2026-08-10", "2026-08-13"), ["2026-08-10", "2026-08-11", "2026-08-12"]);
  });
  test("una noche entra si fecha>=inicio y fecha<fin", () => {
    assert.equal(vigenciaCubreFecha({ fechaInicio: "2026-08-10", fechaFin: "2026-08-15" }, "2026-08-10"), true);
    assert.equal(vigenciaCubreFecha({ fechaInicio: "2026-08-10", fechaFin: "2026-08-15" }, "2026-08-14"), true);
    assert.equal(vigenciaCubreFecha({ fechaInicio: "2026-08-10", fechaFin: "2026-08-15" }, "2026-08-15"), false);
    assert.equal(vigenciaCubreFecha({ fechaInicio: "2026-08-10", fechaFin: "2026-08-15" }, "2026-08-09"), false);
  });
});

describe("condicionHotelEstadia — HOTEL que cruza vigencias (más exigente)", () => {
  test("una sola vigencia sin_condicion → % normal (0.30)", () => {
    const r = condicionHotelEstadia(
      { fechaIda: "2026-08-10", fechaRegreso: "2026-08-13" },
      [vg(sinC, "2026-01-01", "2027-01-01")],
      { fechaPago: F, pctBase: 0.3 },
    );
    assert.ok(Math.abs(r.pct - 0.3) < 1e-9);
  });

  test("estadía que cruza a una temporada pago_total → 100% (domina las neutras)", () => {
    // noches 10-11 neutras, noche 12 cae en la vigencia pago_total 12→13
    const r = condicionHotelEstadia(
      { fechaIda: "2026-08-10", fechaRegreso: "2026-08-13" },
      [vg(sinC, "2026-01-01", "2027-01-01"), vg(pagoTotal, "2026-08-12", "2026-08-13")],
      { fechaPago: F, pctBase: 0.3 },
    );
    assert.equal(r.pct, 1);
  });

  test("anticipo 50% vs anticipo 60% en noches distintas → gana 60%", () => {
    const antici50 = { tipo: "anticipo_saldo" as const, pctInicial: 0.5, diasSaldo: 20 };
    const r = condicionHotelEstadia(
      { fechaIda: "2026-09-01", fechaRegreso: "2026-09-04" },
      [vg(antici50, "2026-09-01", "2026-09-02"), vg(anticipo60, "2026-09-02", "2026-09-04")],
      { fechaPago: F, pctBase: 0.3 },
    );
    assert.ok(Math.abs(r.pct - 0.6) < 1e-9);
  });

  test("hueco sin vigencia en la estadía → neutra (no inventa exigencia)", () => {
    const r = condicionHotelEstadia(
      { fechaIda: "2026-08-10", fechaRegreso: "2026-08-13" },
      [vg(pagoTotal, "2026-08-20", "2026-08-30")], // vigencia fuera de la estadía
      { fechaPago: F, pctBase: 0.3 },
    );
    assert.ok(Math.abs(r.pct - 0.3) < 1e-9);
  });

  test("sin vigencias → neutra (0.30)", () => {
    const r = condicionHotelEstadia({ fechaIda: "2026-08-10", fechaRegreso: "2026-08-13" }, [], {
      fechaPago: F,
      pctBase: 0.3,
    });
    assert.ok(Math.abs(r.pct - 0.3) < 1e-9);
  });
});

describe("construirSnapshot — filas + agregados", () => {
  test("2 hoteles + aéreo empaquetado: suma su monto, el aéreo el 100% propio; agregados COP", () => {
    const r = construirSnapshot(
      [
        { id: "hotA", tipo: "hotel", valor: 2_500_000, condicion: pagoTotal, referencia: "Hotel A" },
        { id: "hotB", tipo: "hotel", valor: 5_000_000, condicion: sinC, referencia: "Hotel B" },
        { id: "aero", tipo: "aereo_empaquetado", valor: 1_500_000, condicion: null, referencia: "Vuelo" },
      ],
      { fechaPago: F, precioTotalMoneda: 9_000_000, trm: 1 },
    );
    assert.equal(r.filas.length, 3);
    assert.equal(r.filas[0].monto_exigido, 2_500_000);
    assert.equal(r.filas[1].monto_exigido, 1_500_000);
    assert.equal(r.filas[2].monto_exigido, 1_500_000);
    assert.equal(r.resumen.monto_exigido_total, 5_500_000);
    assert.equal(r.resumen.monto_exigido_total_cop, 5_500_000);
    // filas ordenadas por `orden`
    assert.deepEqual(r.filas.map((f) => f.orden), [0, 1, 2]);
  });

  test("TRM congelada (USD→COP): el resumen COP multiplica; la fila queda en moneda", () => {
    const r = construirSnapshot(
      [{ id: "prog", tipo: "programa", valor: 1_000, condicion: pagoTotal, referencia: "Circuito" }],
      { fechaPago: F, precioTotalMoneda: 1_000, trm: 4_000 },
    );
    assert.equal(r.filas[0].monto_exigido, 1_000); // en moneda de la cotización
    assert.equal(r.resumen.monto_exigido_total, 1_000);
    assert.equal(r.resumen.monto_exigido_total_cop, 4_000_000);
  });

  test("restricción comercial viaja a la fila; default normal", () => {
    const r = construirSnapshot(
      [
        { id: "p1", tipo: "programa", valor: 100, condicion: pagoTotal, restriccionComercial: "promocional_no_reembolsable" },
        { id: "p2", tipo: "programa", valor: 100, condicion: null },
      ],
      { fechaPago: F, precioTotalMoneda: 200, trm: 1 },
    );
    assert.equal(r.filas[0].restriccion_comercial, "promocional_no_reembolsable");
    assert.equal(r.filas[1].restriccion_comercial, "normal");
  });

  test("redondeo: componente sin condición normal sobre 333.333 → monto 100", () => {
    const r = construirSnapshot(
      [{ id: "serv", tipo: "servicio", valor: 333.333, condicion: null }],
      { fechaPago: F, precioTotalMoneda: 333.333, trm: 1 },
    );
    assert.equal(r.filas[0].monto_exigido, 100);
  });
});
