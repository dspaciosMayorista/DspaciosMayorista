// ─────────────────────────────────────────────────────────────────────────
// Prueba de INTEGRACIÓN PURA (sin Supabase): confirma el requisito #10 del
// modo corrección — "snapshotCondiciones recibe los valores persistidos
// desde cada fuente y no defaults permanentes" — al nivel disponible hoy en
// el código: ninguna cotización real todavía arma sus componentes desde
// catálogo (ver cabecera de condicionDesdeCatalogo.ts), así que esta prueba
// demuestra el PUENTE de punta a punta: fila REAL de hotel_temporadas/
// armado_paquetes/programas (tal como la guardan los Server Actions nuevos)
// → condicionDesdeCatalogo → construirSnapshot (snapshotCondiciones.ts, NO
// modificado) produce un monto exigido DISTINTO al que daría el default
// neutro — o sea, el snapshot está usando de verdad lo persistido, no un
// "normal"/null hardcodeado.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  condicionDeVigenciaHotel,
  componenteDeArmadoPaquete,
  componenteDePrograma,
} from "../lib/cotizacion/condicionDesdeCatalogo.ts";
import { construirSnapshot } from "../lib/cotizacion/snapshotCondiciones.ts";
import type { ComponenteSnapshot } from "../lib/cotizacion/snapshotCondiciones.ts";

describe("condicionDeVigenciaHotel — restricción SIEMPRE derivada, nunca leída de columna", () => {
  test("vigencia con anticipo_saldo → no_reembolsable_no_endosable", () => {
    const v = condicionDeVigenciaHotel({
      id: 501,
      nombre: "ALTA",
      fecha_inicio: "2026-12-01",
      fecha_fin: "2027-01-15",
      condicion_pago_tipo: "anticipo_saldo",
      condicion_pago_pct_inicial: 0.6,
      condicion_pago_dias_saldo: 45,
    });
    assert.equal(v.tipo, "anticipo_saldo");
    assert.equal(v.pctInicial, 0.6);
    assert.equal(v.diasSaldo, 45);
    assert.equal(v.restriccionComercial, "no_reembolsable_no_endosable");
    assert.equal(v.hotelTemporadaId, 501);
  });

  test("vigencia sin_condicion → normal (sin restricción)", () => {
    const v = condicionDeVigenciaHotel({
      id: 502,
      nombre: "BAJA",
      fecha_inicio: "2026-01-01",
      fecha_fin: "2026-06-01",
      condicion_pago_tipo: "sin_condicion",
      condicion_pago_pct_inicial: null,
      condicion_pago_dias_saldo: null,
    });
    assert.equal(v.restriccionComercial, "normal");
  });
});

describe("componenteDeArmadoPaquete / componenteDePrograma — mapean la fila real, no un default", () => {
  test("paquete con pago_total + restricción promocional", () => {
    const comp = componenteDeArmadoPaquete(
      {
        condicion_pago_tipo: "pago_total",
        condicion_pago_pct_inicial: null,
        condicion_pago_dias_saldo: null,
        restriccion_comercial: "promocional_no_reembolsable_no_endosable",
      },
      { id: "pq1", valor: 1_000_000, referencia: "Paquete Cartagena" },
    );
    assert.equal(comp.tipo, "paquete");
    assert.equal(comp.condicion?.tipo, "pago_total");
    assert.equal(comp.restriccionComercial, "promocional_no_reembolsable_no_endosable");
  });

  test("programa con anticipo_saldo 40% + 20 días, restricción normal", () => {
    const comp = componenteDePrograma(
      {
        condicion_pago_tipo: "anticipo_saldo",
        condicion_pago_pct_inicial: 0.4,
        condicion_pago_dias_saldo: 20,
        restriccion_comercial: "normal",
      },
      { id: "pr1", valor: 2_000_000 },
    );
    assert.equal(comp.tipo, "programa");
    assert.equal(comp.condicion?.pctInicial, 0.4);
    assert.equal(comp.condicion?.diasSaldo, 20);
    assert.equal(comp.restriccionComercial, "normal");
  });
});

describe("construirSnapshot con componentes de catálogo REALES vs defaults neutros", () => {
  const FECHA_PAGO = "2026-01-01"; // muy lejos de cualquier bump de cierre

  test("un paquete con anticipo_saldo 40% persistido exige 40% de su valor — NO el 30% normal por defecto", () => {
    const compReal: ComponenteSnapshot = componenteDeArmadoPaquete(
      {
        condicion_pago_tipo: "anticipo_saldo",
        condicion_pago_pct_inicial: 0.4,
        condicion_pago_dias_saldo: 20,
        restriccion_comercial: "normal",
      },
      { id: "pq1", valor: 1_000_000, fechaViaje: "2026-12-01" },
    );
    const snapReal = construirSnapshot([compReal], { fechaPago: FECHA_PAGO, precioTotalMoneda: 1_000_000 });
    assert.equal(snapReal.filas[0].condicion_pago_tipo, "anticipo_saldo");
    assert.equal(snapReal.resumen.monto_exigido_total, 400_000); // 40% de 1.000.000

    // Con el default neutro ("normal", sin condición) el motor exige su % base
    // configurable (30%) — un valor DISTINTO: prueba de que el snapshot de
    // arriba usó de verdad el 40% PERSISTIDO, no cayó en el default.
    const compDefault: ComponenteSnapshot = {
      id: "pq1",
      tipo: "paquete",
      valor: 1_000_000,
      condicion: null,
      fechaViaje: "2026-12-01",
      restriccionComercial: "normal",
    };
    const snapDefault = construirSnapshot([compDefault], { fechaPago: FECHA_PAGO, precioTotalMoneda: 1_000_000 });
    assert.equal(snapDefault.resumen.monto_exigido_total, 300_000); // 30% normal
    assert.notEqual(snapReal.resumen.monto_exigido_total, snapDefault.resumen.monto_exigido_total);
  });

  test("una vigencia de hotel con pago_total persistido exige el 100% de la estadía — no el 30% normal", () => {
    const vigenciaReal = condicionDeVigenciaHotel({
      id: 9,
      nombre: "ALTA",
      fecha_inicio: "2026-12-01",
      fecha_fin: "2027-01-15",
      condicion_pago_tipo: "pago_total",
      condicion_pago_pct_inicial: null,
      condicion_pago_dias_saldo: null,
    });
    // El llamador real (aún no construido — ver cabecera del módulo) reduciría
    // la estadía con condicionHotelEstadia; aquí se verifica el escalón previo:
    // la condición de la vigencia que llegaría a ese reductor es la real.
    assert.equal(vigenciaReal.tipo, "pago_total");
    assert.equal(vigenciaReal.restriccionComercial, "no_reembolsable_no_endosable");

    const compHotelReal: ComponenteSnapshot = {
      id: "h1",
      tipo: "hotel",
      valor: 900_000,
      condicion: { tipo: vigenciaReal.tipo, pctInicial: vigenciaReal.pctInicial, diasSaldo: vigenciaReal.diasSaldo },
      fechaViaje: "2026-12-10",
      restriccionComercial: vigenciaReal.restriccionComercial,
    };
    const snap = construirSnapshot([compHotelReal], { fechaPago: FECHA_PAGO, precioTotalMoneda: 900_000 });
    assert.equal(snap.resumen.monto_exigido_total, 900_000); // 100%, no 30%
    assert.equal(snap.filas[0].restriccion_comercial, "no_reembolsable_no_endosable");
  });
});
