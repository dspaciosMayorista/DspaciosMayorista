// Redondeo (regla del dueño): las tarifas por persona conservan su precisión de cálculo y el total es el exacto; NADA se reparte entre pasajeros, no hay múltiplo de redondeo nuevo ni línea de «ajuste».
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tarifaPaquete } from "../lib/cotizacion/tarifaPaquete.ts";

const ok = (r: ReturnType<typeof tarifaPaquete>) => { assert.ok(r.ok, r.ok ? "" : r.motivo); return r as Extract<typeof r, { ok: true }>; };
const cerca = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe("tarifa del paquete: precisión de cálculo y total exacto", () => {
  test("sin residuo: tarifas exactas", () => {
    const r = ok(tarifaPaquete({ adultos: 2, ninos: 1, baseAdultoCentavos: 2_000_000, baseNinoCentavos: 500_000, adicionales: [] }));
    assert.deepEqual([r.tarifaAdulto, r.tarifaNino, r.ajusteCentavos, r.totalCentavos], [10_000, 5_000, 0, 2_500_000]);
  });
  test("residuo: la tarifa del adulto y la del niño conservan su precisión (no se reparte un centavo a unos pasajeros y a otros no)", () => {
    // 3 adultos y 1 niño comparten un servicio de 10,02 (1.002 centavos): 250,5 centavos por persona
    const r = ok(tarifaPaquete({ adultos: 3, ninos: 1, baseAdultoCentavos: 0, baseNinoCentavos: 0, adicionales: [{ nombre: "X", centavos: 1_002, pax: 4 }] }));
    assert.ok(cerca(r.tarifaAdulto, 2.505) && cerca(r.tarifaNino, 2.505), "250,5 centavos = 2,505 por persona");
    assert.equal(r.ajusteCentavos, 0);
    assert.equal(r.totalCentavos, 1_002, "el total es el exacto");
    assert.ok(cerca(3 * r.tarifaAdulto * 100 + r.tarifaNino * 100, r.totalCentavos), "tarifa × cantidad = total exacto con la precisión de cálculo");
  });
  test("con bases distintas por clase: cada clase su base ÷ personas + su parte exacta del adicional", () => {
    const r = ok(tarifaPaquete({ adultos: 2, ninos: 1, baseAdultoCentavos: 160_000_000, baseNinoCentavos: 40_000_000, adicionales: [{ nombre: "Traslado", centavos: 40_000_000, pax: 3 }] }));
    assert.ok(cerca(r.tarifaAdulto, 800_000 + 400_000 / 3) && cerca(r.tarifaNino, 400_000 + 400_000 / 3));
    assert.equal(r.totalCentavos, 240_000_000);
    assert.ok(cerca(2 * r.tarifaAdulto * 100 + r.tarifaNino * 100, 240_000_000));
  });
  test("para cualquier mezcla la suma de tarifa × cantidad es el total exacto y nunca hay ajuste", () => {
    for (let adultos = 1; adultos <= 4; adultos++) for (let ninos = 0; ninos <= 3; ninos++) for (let extra = 0; extra < 12; extra++) {
      const n = adultos + ninos;
      const r = ok(tarifaPaquete({ adultos, ninos, baseAdultoCentavos: adultos * 1_000, baseNinoCentavos: ninos * 400, adicionales: [{ nombre: "S", centavos: 100 * n + extra, pax: n }] }));
      assert.equal(r.ajusteCentavos, 0);
      assert.ok(cerca(adultos * r.tarifaAdulto * 100 + ninos * r.tarifaNino * 100, r.totalCentavos), `${adultos}A ${ninos}N +${extra}`);
    }
  });
  test("determinista", () => {
    const e = { adultos: 2, ninos: 1, baseAdultoCentavos: 1, baseNinoCentavos: 1, adicionales: [{ nombre: "S", centavos: 1, pax: 3 }] };
    assert.deepEqual(tarifaPaquete(e), tarifaPaquete(e));
  });
});
