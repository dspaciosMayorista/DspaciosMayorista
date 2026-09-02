// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS del motor de condiciones de pago por componente
// (lib/cotizacion/condicionPago.ts). Sin Supabase, sin SQL — determinista.
// Se corren con el runner del repo: `npm run test:unit`.
//
// Cubre los CASOS MÍNIMOS que tocan el motor puro:
//   1) sin condición (histórico exacto) → % normal configurable
//   2) hotel pago_total → 100%
//   3) hotel anticipo_saldo 50% + saldo a N días → 50% fuera del ventana,
//      y bump de cierre (C9) a 100% cuando hoy > fechaViaje − N días
//   4) estadía cruzando vigencias → la MÁS exigente de las condiciones
//      presentes (pago_total gana; a igual %, mayor diasSaldo)
//   5) ejemplo del dueño: hoteles/componentes con condiciones distintas SUMAN
//      su monto; el % global es informativo ($5.800.000 / 58%)
//   6) aéreo empaquetado → 100% de SU PROPIO valor, no del resto
//   7) vuelo de bloqueo normal → su % configurable (0.30)
//   8) programa restringido (pago_total) exige su total
//   9) componente sin condición propia → 0.30
//   10) sobrepago rechazado (permiteNuevoPago)
//   11) suficiencia COP vs COP
//   12) redondeo del monto exigido a 2 decimales
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pctAplicable,
  exigenciaHotel,
  masExigente,
  formulaPagoMinimo,
  suficienteParaConvertir,
  permiteNuevoPago,
  montoExigidoComponente,
  sumarDias,
  PCT_NORMAL_POR_TIPO,
} from "../lib/cotizacion/condicionPago.ts";

const FECHA_PAGO = "2026-08-01"; // "hoy" fijo para determinismo
const sinCond = { tipo: "sin_condicion", pctInicial: null, diasSaldo: null };

describe("pctAplicable — una condición aislada", () => {
  test("neutra (sin_condicion) → % normal configurable (0.30)", () => {
    const r = pctAplicable(sinCond, {
      fechaViaje: "2026-08-10",
      fechaPago: FECHA_PAGO,
      pctBase: PCT_NORMAL_POR_TIPO.hotel,
    });
    assert.ok(Math.abs(r.pct - 0.3) < 1e-9);
    assert.equal(r.tipo, "sin_condicion");
  });

  test("pago_total → 100% siempre", () => {
    const r = pctAplicable(
      { tipo: "pago_total", pctInicial: null, diasSaldo: null },
      { fechaViaje: "2026-08-10", fechaPago: FECHA_PAGO, pctBase: 0.3 },
    );
    assert.equal(r.pct, 1);
  });

  test("anticipo_saldo 50% + saldo 30 días antes → 50% si hoy está fuera", () => {
    const r = pctAplicable(
      { tipo: "anticipo_saldo", pctInicial: 0.5, diasSaldo: 30 },
      { fechaViaje: "2026-09-10", fechaPago: FECHA_PAGO, pctBase: 0.3 },
    );
    assert.equal(r.pct, 0.5);
  });

  test("bump de cierre (C9): dentro de la ventana de dias_saldo → 100%", () => {
    // viaje 2026-08-20, 30 días antes = 2026-07-21; hoy (08-01) > 07-21 → 100%
    const r = pctAplicable(
      { tipo: "anticipo_saldo", pctInicial: 0.5, diasSaldo: 30 },
      { fechaViaje: "2026-08-20", fechaPago: FECHA_PAGO, pctBase: 0.3 },
    );
    assert.equal(r.pct, 1);
  });

  test("bump justo en el límite (hoy == fechaViaje − dias) NO dispara (estricto)", () => {
    // viaje 2026-08-31, 30 días antes = 2026-08-01 = hoy → aún 50%
    const r = pctAplicable(
      { tipo: "anticipo_saldo", pctInicial: 0.5, diasSaldo: 30 },
      { fechaViaje: "2026-08-31", fechaPago: FECHA_PAGO, pctBase: 0.3 },
    );
    assert.equal(r.pct, 0.5);
  });
});

describe("exigenciaHotel — estadía cruzando vigencias (más exigente)", () => {
  test("sin condiciones en ninguna noche → 0.30", () => {
    const r = exigenciaHotel([sinCond, sinCond, sinCond], {
      fechaViaje: "2026-08-10",
      fechaPago: FECHA_PAGO,
      pctBase: 0.3,
    });
    assert.ok(Math.abs(r.pct - 0.3) < 1e-9);
  });

  test("pago_total presente en UNA noche domina el resto → 100%", () => {
    const r = exigenciaHotel(
      [
        sinCond,
        { tipo: "pago_total", pctInicial: null, diasSaldo: null },
        sinCond,
      ],
      { fechaViaje: "2026-08-10", fechaPago: FECHA_PAGO, pctBase: 0.3 },
    );
    assert.equal(r.pct, 1);
  });

  test("anticipo 50% vs anticipo 60% → gana 60%", () => {
    const r = exigenciaHotel(
      [
        { tipo: "anticipo_saldo", pctInicial: 0.5, diasSaldo: 15 },
        { tipo: "anticipo_saldo", pctInicial: 0.6, diasSaldo: 15 },
      ],
      { fechaViaje: "2026-09-10", fechaPago: FECHA_PAGO, pctBase: 0.3 },
    );
    assert.equal(r.pct, 0.6);
  });

  test("a igual %, gana el de MAYOR diasSaldo (exige más temprano)", () => {
    const a = masExigente(
      { pct: 0.5, diasSaldo: 15, tipo: "anticipo_saldo", pctInicial: 0.5 },
      { pct: 0.5, diasSaldo: 45, tipo: "anticipo_saldo", pctInicial: 0.5 },
    );
    assert.equal(a.diasSaldo, 45);
  });

  test("una condición repetida en varias noches NO amplifica (max asociativo)", () => {
    const r = exigenciaHotel([sinCond, sinCond, sinCond, sinCond], {
      fechaViaje: "2026-08-10",
      fechaPago: FECHA_PAGO,
      pctBase: 0.3,
    });
    assert.ok(Math.abs(r.pct - 0.3) < 1e-9);
  });
});

describe("fórmulaPagoMinimo — desglose por componente y ejemplo del dueño", () => {
  test("ejemplo del dueño: condiciones distintas SUMAN su monto; el % global es informativo (58%)", () => {
    // Contrato de $10.000.000 repartido así:
    //   · hotel A  pago_total             $2.500.000 → 100% = $2.500.000
    //   · hotel B  sin_condicion (30%)    $5.000.000 → 30%  = $1.500.000
    //   · servicio normal (30%)           $1.000.000 → 30%  =   $300.000
    //   · aéreo empaquetado (100% propio) $1.500.000 → 100% = $1.500.000
    // Σ exigido = $5.800.000 sobre $10.000.000 → 58% INFORMATIVO.
    // Lo que manda la conversión es el MONTO ($5.800.000), no el 58%.
    const r = formulaPagoMinimo(
      [
        { id: "hotA", tipo: "hotel", valor: 2_500_000, condicion: { tipo: "pago_total", pctInicial: null, diasSaldo: null } },
        { id: "hotB", tipo: "hotel", valor: 5_000_000, condicion: sinCond },
        { id: "serv", tipo: "servicio", valor: 1_000_000, condicion: null },
        { id: "aereoEmp", tipo: "aereo_empaquetado", valor: 1_500_000, condicion: null },
      ],
      { fechaPago: FECHA_PAGO, precioTotalMoneda: 10_000_000, trm: 1 },
    );
    assert.equal(r.desglose.length, 4);
    const a = r.desglose.find((l) => l.id === "hotA");
    const b = r.desglose.find((l) => l.id === "hotB");
    const aereo = r.desglose.find((l) => l.id === "aereoEmp");
    assert.equal(a.montoExigidoMoneda, 2_500_000);
    assert.equal(b.montoExigidoMoneda, 1_500_000);
    assert.equal(aereo.montoExigidoMoneda, 1_500_000);
    assert.equal(r.montoExigidoTotalMoneda, 5_800_000);
    assert.ok(Math.abs(r.pctEfectivoInformativo - 58) < 0.1);
    assert.equal(r.montoExigidoTotalCop, 5_800_000);
  });

  test("aéreo empaquetado exige 100% de SU valor, sin tocar las demás", () => {
    const r = formulaPagoMinimo(
      [
        { id: "aereo", tipo: "aereo_empaquetado", valor: 500_000, condicion: null },
        { id: "hot", tipo: "hotel", valor: 2_000_000, condicion: sinCond },
      ],
      { fechaPago: FECHA_PAGO, precioTotalMoneda: 2_500_000, trm: 1 },
    );
    const aereo = r.desglose.find((l) => l.id === "aereo");
    const hot = r.desglose.find((l) => l.id === "hot");
    assert.equal(aereo.pct, 1);
    assert.equal(aereo.montoExigidoMoneda, 500_000);
    assert.ok(Math.abs(hot.pct - 0.3) < 1e-9); // el hotel normal NO se obliga por el aéreo
    assert.equal(hot.montoExigidoMoneda, 600_000);
    assert.equal(r.montoExigidoTotalMoneda, 1_100_000);
  });

  test("vuelo de bloqueo normal usa su % configurable (0.30)", () => {
    const r = formulaPagoMinimo(
      [{ id: "vb", tipo: "vuelo_bloqueo", valor: 1_000_000, condicion: null }],
      { fechaPago: FECHA_PAGO, precioTotalMoneda: 1_000_000, trm: 1 },
    );
    assert.ok(Math.abs(r.desglose[0].pct - 0.3) < 1e-9);
    assert.equal(r.desglose[0].montoExigidoMoneda, 300_000);
  });

  test("programa restringido (pago_total) exige su total", () => {
    const r = formulaPagoMinimo(
      [{ id: "prog", tipo: "programa", valor: 4_000_000, condicion: { tipo: "pago_total", pctInicial: null, diasSaldo: null } }],
      { fechaPago: FECHA_PAGO, precioTotalMoneda: 4_000_000, trm: 1 },
    );
    assert.equal(r.desglose[0].montoExigidoMoneda, 4_000_000);
  });

  test("US$ con TRM congelada → monto exigido COP = total_en_moneda × trm", () => {
    const r = formulaPagoMinimo(
      [{ id: "prog", tipo: "programa", valor: 1_000, condicion: { tipo: "pago_total", pctInicial: null, diasSaldo: null } }],
      { fechaPago: FECHA_PAGO, precioTotalMoneda: 1_000, trm: 4_000 },
    );
    assert.equal(r.montoExigidoTotalMoneda, 1_000);
    assert.equal(r.montoExigidoTotalCop, 4_000_000);
  });
});

describe("redondeo / suficiencia / sobrepago", () => {
  test("monto exigido se redondea a 2 decimales", () => {
    // 333.333 × 0.3 = 99.9999 → redondea a 100.00
    assert.equal(montoExigidoComponente(333.333, 0.3), 100);
    // 1000 × 0.3 = 300 exacto
    assert.equal(montoExigidoComponente(1_000, 0.3), 300);
    // 1/3 de 100 = 33.3333... → 33.33
    assert.equal(montoExigidoComponente(100, 1 / 3), 33.33);
  });

  test("suficiencia COP vs COP: exacto y ruido sub-cent sí; un centavo por debajo NO", () => {
    assert.equal(suficienteParaConvertir(5_100_000, 5_100_000), true);
    // ruido de redondeo sub-cent (por debajo de la tolerancia) → convierte
    assert.equal(suficienteParaConvertir(5_100_000 - 0.001, 5_100_000), true);
    // "un centavo por debajo" (0.01) → NO convierte (caso negativo exigido)
    assert.equal(suficienteParaConvertir(5_100_000 - 0.01, 5_100_000), false);
    assert.equal(suficienteParaConvertir(5_000_000, 5_100_000), false);
  });

  test("sobrepago rechazado: suma + nuevo nunca supera el precio total en COP", () => {
    assert.equal(permiteNuevoPago(4_000_000, 10_000_000, 6_000_000), true); // == total
    assert.equal(permiteNuevoPago(4_000_000, 10_000_000, 6_100_000), false); // > total
    assert.equal(permiteNuevoPago(0, 500_000, 500_000), true);
  });

  test("sumarDias es correcto y cruza meses/años", () => {
    assert.equal(sumarDias("2026-08-01", 30), "2026-08-31");
    assert.equal(sumarDias("2026-12-15", 45), "2027-01-29");
  });
});
