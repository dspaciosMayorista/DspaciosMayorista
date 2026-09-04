// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS de la resolución de componentes de una cotización MANUAL
// (lib/cotizacion/componentesManual.ts) y de su cierre matemático en el
// snapshot (lib/cotizacion/snapshotCondiciones.ts). Sin Supabase.
// `npm run test:unit`.
//
// Cubre (Commit 4):
//   · mapeo de tipo_servicio → componente 164 (aereo→aereo_empaquetado,
//     hotel→hotel, traslado/asistencia/otro→servicio);
//   · conserva valor y fecha de viaje; descarta servicios de valor 0;
//   · referencias legibles (nombre o etiqueta del tipo);
//   · cierre: aéreo empaquetado exige 100% de SU PROPIO valor, hotel/servicio
//     su % normal (30%) → monto mínimo total determinista.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { componentesDeManual } from "../lib/cotizacion/componentesManual.ts";
import { construirSnapshot } from "../lib/cotizacion/snapshotCondiciones.ts";

describe("componentesDeManual — mapeo de servicios a componentes", () => {
  test("aereo→aereo_empaquetado, hotel→hotel, traslado/asistencia/otro→servicio", () => {
    const comps = componentesDeManual(
      [
        { id: 1, tipo_servicio: "aereo", valor: 2_000_000, nombre_servicio: "Tiquete aéreo" },
        { id: 2, tipo_servicio: "hotel", valor: 4_000_000, nombre_servicio: "Hotel Centro" },
        { id: 3, tipo_servicio: "traslado", valor: 500_000, nombre_servicio: null },
        { id: 4, tipo_servicio: "asistencia", valor: 300_000, nombre_servicio: null },
        { id: 5, tipo_servicio: "otro", valor: 100_000, nombre_servicio: null },
      ],
      "2026-12-01",
    );
    assert.equal(comps.length, 5);
    assert.equal(comps[0].tipo, "aereo_empaquetado");
    assert.equal(comps[1].tipo, "hotel");
    assert.equal(comps[2].tipo, "servicio");
    assert.equal(comps[3].tipo, "servicio");
    assert.equal(comps[4].tipo, "servicio");
    assert.equal(comps[0].valor, 2_000_000);
    assert.equal(comps[0].referencia, "Tiquete aéreo");
  });

  test("referencia cae a la etiqueta del tipo cuando el nombre es vacío", () => {
    const comps = componentesDeManual([{ id: 9, tipo_servicio: "traslado", valor: 1, nombre_servicio: "  " }], null);
    assert.equal(comps[0].referencia, "Traslado");
  });

  test("servicios de valor 0 se descartan; los demás conservan id y fechaViaje", () => {
    const comps = componentesDeManual(
      [
        { id: 10, tipo_servicio: "hotel", valor: 0, nombre_servicio: "Gratis" },
        { id: 11, tipo_servicio: "hotel", valor: 999, nombre_servicio: "Hotel X" },
      ],
      "2026-11-10",
    );
    assert.equal(comps.length, 1);
    assert.equal(comps[0].id, "s11");
    assert.equal(comps[0].fechaViaje, "2026-11-10");
    assert.equal(comps[0].restriccionComercial, "normal");
  });

  test("lista vacía → sin componentes", () => {
    assert.deepEqual(componentesDeManual([], null), []);
  });
});

describe("cierre del snapshot — aéreo 100% propio + hotel/servicio % normal", () => {
  test("hotel + aéreo empaquetado → monto mínimo determinista", () => {
    const comps = componentesDeManual(
      [
        { id: 1, tipo_servicio: "hotel", valor: 4_000_000, nombre_servicio: "Hotel A" },
        { id: 2, tipo_servicio: "aereo", valor: 2_000_000, nombre_servicio: "Vuelo" },
      ],
      "2026-12-01",
    );
    const snap = construirSnapshot(comps, {
      fechaPago: "2026-09-01", // lejano al viaje → sin bump de cierre
      precioTotalMoneda: 6_000_000,
      trm: 1,
    });
    // hotel 30% = 1.200.000 · aéreo 100% = 2.000.000 → total 3.200.000
    assert.equal(snap.resumen.monto_exigido_total, 3_200_000);
    assert.equal(snap.resumen.monto_exigido_total_cop, 3_200_000);
    assert.equal(snap.resumen.pct_efectivo_informativo, 53.33);
    assert.equal(snap.filas.length, 2);

    const hotel = snap.filas.find((f) => f.tipo_componente === "hotel");
    const aereo = snap.filas.find((f) => f.tipo_componente === "aereo_empaquetado");
    assert.ok(hotel);
    assert.ok(aereo);
    assert.equal(hotel.monto_exigido, 1_200_000);
    assert.equal(aereo.monto_exigido, 2_000_000);
    assert.equal(hotel.condicion_pago_tipo, "sin_condicion"); // neutro
  });

  test("snapshot en USD respeta la TRM para el total en COP", () => {
    const comps = componentesDeManual([{ id: 7, tipo_servicio: "aereo", valor: 500, nombre_servicio: null }], null);
    const snap = construirSnapshot(comps, { fechaPago: "2026-09-01", precioTotalMoneda: 500, trm: 4_200 });
    // aéreo 100% de 500 USD = 500 USD → COP = 500 × 4.200 = 2.100.000
    assert.equal(snap.resumen.monto_exigido_total, 500);
    assert.equal(snap.resumen.monto_exigido_total_cop, 2_100_000);
  });
});
