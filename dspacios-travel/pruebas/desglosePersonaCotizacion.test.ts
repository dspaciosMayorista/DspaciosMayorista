import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularResidualServiciosIncluidosPorGrupo } from "../lib/reservar/desglosePersonaCotizacion.ts";

// ─────────────────────────────────────────────────────────────────────────
// Prueba NUMÉRICA real (node --test, sin inspección de código fuente) del
// helper puro que decide cuánto de `precioVenta` no cubren las filas
// per-cápita de la cotización (habitaciones + Niño 1/2 + Infante) — el
// residual real, no una afirmación de texto sobre el código.
// ─────────────────────────────────────────────────────────────────────────

describe("calcularResidualServiciosIncluidosPorGrupo", () => {
  test("2 adultos × $295.000 (1 habitación doble) = $590.000, sin menores ni servicio de grupo → residual $0", () => {
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta: 590_000,
      lineasHab: [{ pax: 2, pvp: 295_000 }],
      numNinos: 0, tarifaNino: undefined,
      numNinos2: 0, tarifaNino2: undefined,
      numInfantes: 0, tarifaInfante: undefined,
    });
    assert.deepEqual(r, { ok: true, residual: 0 });
  });

  test("adultos + Niño 1 + Niño 2 + Infante: precioVenta es EXACTAMENTE la suma de las 4 partidas → residual $0", () => {
    const precioVenta = 2 * 295_000 + 1 * 150_000 + 1 * 120_000 + 1 * 0;
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta,
      lineasHab: [{ pax: 2, pvp: 295_000 }],
      numNinos: 1, tarifaNino: 150_000,
      numNinos2: 1, tarifaNino2: 120_000,
      numInfantes: 1, tarifaInfante: 0,
    });
    assert.deepEqual(r, { ok: true, residual: 0 });
  });

  test("precioVenta con $100.000 adicionales de un servicio incluido por grupo (no cubierto por lineasHab/menores) → residual $100.000", () => {
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta: 590_000 + 100_000,
      lineasHab: [{ pax: 2, pvp: 295_000 }],
      numNinos: 0, tarifaNino: undefined,
      numNinos2: 0, tarifaNino2: undefined,
      numInfantes: 0, tarifaInfante: undefined,
    });
    assert.deepEqual(r, { ok: true, residual: 100_000 });
  });

  test("subtotal visible SUPERIOR a precioVenta → falla cerrado (nunca se guarda una cotización cuyas filas visibles sumen de más)", () => {
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta: 500_000,
      lineasHab: [{ pax: 2, pvp: 295_000 }], // 590.000 > 500.000
      numNinos: 0, tarifaNino: undefined,
      numNinos2: 0, tarifaNino2: undefined,
      numInfantes: 0, tarifaInfante: undefined,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Inconsistencia interna/);
  });

  test("la suma de TODAS las filas visibles (habitaciones + menores + la línea de residual, si existe) coincide EXACTAMENTE con precioVenta", () => {
    const casos = [
      { precioVenta: 590_000, lineasHab: [{ pax: 2, pvp: 295_000 }], numNinos: 0, numNinos2: 0, numInfantes: 0, tarifaNino: undefined, tarifaNino2: undefined, tarifaInfante: undefined },
      { precioVenta: 590_000 + 150_000 + 100_000, lineasHab: [{ pax: 2, pvp: 295_000 }], numNinos: 1, tarifaNino: 150_000, numNinos2: 0, tarifaNino2: undefined, numInfantes: 0, tarifaInfante: undefined },
    ];
    for (const c of casos) {
      const r = calcularResidualServiciosIncluidosPorGrupo(c);
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      const subtotalVisible =
        c.lineasHab.reduce((s, l) => s + l.pax * l.pvp, 0) +
        (c.numNinos > 0 && c.tarifaNino != null ? c.numNinos * c.tarifaNino : 0) +
        (c.numNinos2 > 0 && c.tarifaNino2 != null ? c.numNinos2 * c.tarifaNino2 : 0) +
        (c.numInfantes > 0 && c.tarifaInfante != null ? c.numInfantes * c.tarifaInfante : 0);
      assert.equal(subtotalVisible + r.residual, c.precioVenta);
    }
  });

  test("ninos/ninos2/infantes declarados pero SIN tarifa configurada (tarifa null/undefined) no se suman al subtotal — el residual absorbe esa diferencia sin fallar", () => {
    // Mismo criterio que computo.ts (pvpPorAcom["nino"] == null ⇒ no se cobra):
    // si el hotel no configuró tarifa de infante, ese menor no debe generar
    // NaN ni bloquear el cálculo.
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta: 590_000,
      lineasHab: [{ pax: 2, pvp: 295_000 }],
      numNinos: 0, tarifaNino: undefined,
      numNinos2: 0, tarifaNino2: undefined,
      numInfantes: 1, tarifaInfante: null,
    });
    assert.deepEqual(r, { ok: true, residual: 0 });
  });
});
