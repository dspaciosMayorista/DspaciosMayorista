// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS de la frontera de validación de condición de pago para las
// tres fuentes de catálogo (lib/cotizacion/condicionPagoCatalogo.ts):
// vigencias de hotel, programas y paquetes (migración 164).
//
// Cubre exactamente lo pedido en "Pruebas obligatorias" del modo corrección:
//   1) crear cada tipo de condición (sin_condicion/normal, pago_total, anticipo_saldo)
//   2) cambiar a normal/sin_condicion/pago_total limpia pct/días (NULL)
//   3) 50 % se persiste como 0.5 y vuelve a mostrarse como 50
//   4) validaciones negativas de porcentaje (rango 1–99) y días (entero ≥ 0)
//   5) universo de tipos correcto por tabla (hotel: sin_condicion; producto: normal)
//   6) restricción comercial de catálogo: solo 2 valores válidos (CHECK real de
//      armado_paquetes/programas), rechaza 'no_reembolsable_no_endosable'
//   7) restricción IMPLÍCITA de hotel: deriva de condicion_pago_tipo, nunca
//      un tercer estado ni una columna propia
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validarCondicionPago,
  validarRestriccionComercialCatalogo,
  pctInicialParaFormulario,
  restriccionImplicitaHotel,
} from "../lib/cotizacion/condicionPagoCatalogo.ts";

describe("validarCondicionPago — universo hotel (sin_condicion|pago_total|anticipo_saldo)", () => {
  test("sin_condicion válido, pct/días quedan NULL", () => {
    const r = validarCondicionPago({ tipo: "sin_condicion", pctInicial: "50", diasSaldo: "30" }, "hotel");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.condicion_pago_tipo, "sin_condicion");
      assert.equal(r.value.condicion_pago_pct_inicial, null);
      assert.equal(r.value.condicion_pago_dias_saldo, null);
    }
  });

  test("pago_total válido, pct/días quedan NULL aunque se manden", () => {
    const r = validarCondicionPago({ tipo: "pago_total", pctInicial: "70", diasSaldo: "10" }, "hotel");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.condicion_pago_tipo, "pago_total");
      assert.equal(r.value.condicion_pago_pct_inicial, null);
      assert.equal(r.value.condicion_pago_dias_saldo, null);
    }
  });

  test("anticipo_saldo 50% → persiste como fracción 0.5", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "50", diasSaldo: "30" }, "hotel");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.condicion_pago_tipo, "anticipo_saldo");
      assert.equal(r.value.condicion_pago_pct_inicial, 0.5);
      assert.equal(r.value.condicion_pago_dias_saldo, 30);
    }
  });

  test("'normal' NO es válido en universo hotel", () => {
    const r = validarCondicionPago({ tipo: "normal", pctInicial: null, diasSaldo: null }, "hotel");
    assert.equal(r.ok, false);
  });

  test("tipo inválido/desconocido rechazado", () => {
    const r = validarCondicionPago({ tipo: "gratis", pctInicial: null, diasSaldo: null }, "hotel");
    assert.equal(r.ok, false);
  });

  test("tipo no-string (manipulado) rechazado, no lanza", () => {
    const r = validarCondicionPago({ tipo: 123, pctInicial: null, diasSaldo: null }, "hotel");
    assert.equal(r.ok, false);
  });
});

describe("validarCondicionPago — universo producto (normal|pago_total|anticipo_saldo)", () => {
  test("normal válido", () => {
    const r = validarCondicionPago({ tipo: "normal", pctInicial: null, diasSaldo: null }, "producto");
    assert.equal(r.ok, true);
  });

  test("'sin_condicion' NO es válido en universo producto", () => {
    const r = validarCondicionPago({ tipo: "sin_condicion", pctInicial: null, diasSaldo: null }, "producto");
    assert.equal(r.ok, false);
  });

  test("anticipo_saldo 35% + 15 días", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "35", diasSaldo: "15" }, "producto");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.condicion_pago_pct_inicial, 0.35);
      assert.equal(r.value.condicion_pago_dias_saldo, 15);
    }
  });
});

describe("validarCondicionPago — validaciones negativas de anticipo_saldo", () => {
  test("porcentaje 0 rechazado (fuera de 1–99)", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "0", diasSaldo: "10" }, "hotel");
    assert.equal(r.ok, false);
  });
  test("porcentaje 100 rechazado (fuera de 1–99)", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "100", diasSaldo: "10" }, "hotel");
    assert.equal(r.ok, false);
  });
  test("porcentaje negativo rechazado", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "-5", diasSaldo: "10" }, "hotel");
    assert.equal(r.ok, false);
  });
  test("porcentaje vacío/NaN rechazado", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "", diasSaldo: "10" }, "hotel");
    assert.equal(r.ok, false);
  });
  test("días negativos rechazados", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "50", diasSaldo: "-1" }, "hotel");
    assert.equal(r.ok, false);
  });
  test("días no enteros rechazados", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "50", diasSaldo: "2.5" }, "hotel");
    assert.equal(r.ok, false);
  });
  test("días = 0 SÍ es válido (entero no negativo)", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "50", diasSaldo: "0" }, "hotel");
    assert.equal(r.ok, true);
  });
  test("días vacío/NaN rechazado", () => {
    const r = validarCondicionPago({ tipo: "anticipo_saldo", pctInicial: "50", diasSaldo: "" }, "hotel");
    assert.equal(r.ok, false);
  });
});

describe("pctInicialParaFormulario — round-trip 0–1 ↔ 1–99", () => {
  test("0.5 → '50'", () => {
    assert.equal(pctInicialParaFormulario(0.5), "50");
  });
  test("0.3 → '30'", () => {
    assert.equal(pctInicialParaFormulario(0.3), "30");
  });
  test("null → ''", () => {
    assert.equal(pctInicialParaFormulario(null), "");
  });
  test("undefined → ''", () => {
    assert.equal(pctInicialParaFormulario(undefined), "");
  });
});

describe("restriccionImplicitaHotel — SIEMPRE derivada, nunca un selector propio", () => {
  test("sin_condicion → normal (sin restricción)", () => {
    assert.equal(restriccionImplicitaHotel("sin_condicion"), "normal");
  });
  test("pago_total → no_reembolsable_no_endosable", () => {
    assert.equal(restriccionImplicitaHotel("pago_total"), "no_reembolsable_no_endosable");
  });
  test("anticipo_saldo → no_reembolsable_no_endosable", () => {
    assert.equal(restriccionImplicitaHotel("anticipo_saldo"), "no_reembolsable_no_endosable");
  });
});

describe("validarRestriccionComercialCatalogo — espejo del CHECK real de armado_paquetes/programas", () => {
  test("'normal' válido", () => {
    const r = validarRestriccionComercialCatalogo("normal");
    assert.equal(r.ok, true);
  });
  test("'promocional_no_reembolsable_no_endosable' válido", () => {
    const r = validarRestriccionComercialCatalogo("promocional_no_reembolsable_no_endosable");
    assert.equal(r.ok, true);
  });
  test("'no_reembolsable_no_endosable' RECHAZADO — el CHECK de estas 2 tablas no lo admite", () => {
    const r = validarRestriccionComercialCatalogo("no_reembolsable_no_endosable");
    assert.equal(r.ok, false);
  });
  test("valor arbitrario rechazado", () => {
    const r = validarRestriccionComercialCatalogo("cualquier-cosa");
    assert.equal(r.ok, false);
  });
  test("valor no-string (manipulado) rechazado, no lanza", () => {
    const r = validarRestriccionComercialCatalogo(42);
    assert.equal(r.ok, false);
  });
  test("undefined rechazado", () => {
    const r = validarRestriccionComercialCatalogo(undefined);
    assert.equal(r.ok, false);
  });
});
