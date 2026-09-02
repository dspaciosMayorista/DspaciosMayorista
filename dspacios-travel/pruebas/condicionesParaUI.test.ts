// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS del mapeo a la forma de la UI
// (lib/cotizacion/condicionesParaUI.ts). Sin Supabase. `npm run test:unit`.
//
// Cubre (Commit 3):
//   · normaliza string libres (tipo/condición/restricción) a etiquetas;
//   · conserva referencia, valor y monto exigido; suma total;
//   · saltos de filas de monto 0 (no aportan al pago mínimo);
//   · restricción normal vs restringida → chip/título correcto.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { condicionesParaUI, type FilaCondicionRowUI } from "../lib/cotizacion/condicionesParaUI.ts";

function fila(over: Partial<FilaCondicionRowUI> = {}): FilaCondicionRowUI {
  return {
    orden: 0,
    tipo_componente: "hotel",
    referencia_externa: "Hotel A",
    valor_componente: 5_000_000,
    condicion_pago_tipo: "sin_condicion",
    condicion_pago_pct_aplicable: 0.3,
    condicion_pago_dias_saldo: null,
    monto_exigido: 1_500_000,
    restriccion_comercial: "normal",
    ...over,
  };
}

describe("condicionesParaUI — a la forma de la UI", () => {
  test("pago_total: mapea tipo/condición/restricción y conserva montos", () => {
    const r = condicionesParaUI([
      fila({
        tipo_componente: "hotel",
        condicion_pago_tipo: "pago_total",
        valor_componente: 2_500_000,
        monto_exigido: 2_500_000,
      }),
    ]);
    assert.equal(r.filas.length, 1);
    const l = r.filas[0];
    assert.equal(l.referencia, "Hotel A");
    assert.equal(l.nombreComponente, "Hotel");
    assert.equal(l.condicionTexto, "Pago total al reservar");
    assert.equal(l.esRestringida, false);
    assert.equal(l.exigido, 2_500_000);
    assert.equal(r.totalExigidoMoneda, 2_500_000);
  });

  test("anticipo_saldo 60 % → frase con % y detalle de días", () => {
    const r = condicionesParaUI([
      fila({ condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_aplicable: 0.6, condicion_pago_dias_saldo: 30, monto_exigido: 3_000_000 }),
    ]);
    assert.equal(r.filas[0].condicionTexto, "Anticipo del 60 %");
    assert.equal(r.filas[0].condicionDetalle, "Saldo 30 días antes del viaje");
  });

  test("restricción plena → esRestringida y título no-endosable", () => {
    const r = condicionesParaUI([
      fila({ restriccion_comercial: "no_reembolsable_no_endosable", monto_exigido: 100 }),
    ]);
    const l = r.filas[0];
    assert.equal(l.esRestringida, true);
    assert.match(l.restriccionTitulo, /no endosable/i);
  });

  test("restricción desconocida cae a 'normal' (sin chip)", () => {
    const r = condicionesParaUI([fila({ restriccion_comercial: "no-se", monto_exigido: 100 })]);
    assert.equal(r.filas[0].esRestringida, false);
    assert.equal(r.filas[0].restriccionTitulo, "Sin restricción");
  });

  test("varias filas: suma el total en moneda y ordena por clave", () => {
    const r = condicionesParaUI([
      fila({ orden: 1, tipo_componente: "servicio", referencia_externa: "Tour", valor_componente: 1_000_000, monto_exigido: 300_000 }),
      fila({ orden: 0, tipo_componente: "aereo_empaquetado", referencia_externa: "Vuelo", condicion_pago_tipo: "pago_total", valor_componente: 1_500_000, monto_exigido: 1_500_000 }),
    ]);
    assert.equal(r.filas.length, 2);
    assert.equal(r.filas[0].key, "0:aereo_empaquetado");
    assert.equal(r.totalExigidoMoneda, 1_800_000);
  });

  test("fila de monto 0 (neutra sin aporte) se omite; sin filas → total null", () => {
    const r = condicionesParaUI([fila({ monto_exigido: 0 })]);
    assert.equal(r.filas.length, 0);
    assert.equal(r.totalExigidoMoneda, null);
    assert.equal(condicionesParaUI([]).totalExigidoMoneda, null);
  });
});
