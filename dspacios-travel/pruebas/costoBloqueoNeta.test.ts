// Bloqueo: costo/CxP aéreo = tarifa_neta; tarifa_para_empaquetar es solo la reventa comercial.
// Caso calculado a mano: neta 300.000, reventa 349.000, 2 pax con silla → costo 600.000 (NO 698.000).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso } from "./support/fakeSupabase.ts";
import { datosVueloBloqueo } from "../lib/reservar/empaquetadoOrigen.ts";
import { costoAereoBloqueo, costoVueloBernalo } from "../lib/reservar/costosObligacionesCarrito.ts";

const bloqueo = (extra: Record<string, unknown> = {}) => ({
  id: 7, record: "L93FYZ", aerolinea: "Avianca", ruta: "BOG-ADZ", moneda: "COP",
  tarifa_neta: 300_000, tarifa_para_empaquetar: 349_000, fee_infante: 0, proveedor_id: null, ...extra,
});
const sb = (b: Record<string, unknown>) => crearClienteFalso({ bloqueos_vuelo: [b] }, {});

describe("bloqueo: costo aéreo desde tarifa_neta", () => {
  test("2 pax con silla: 600.000 con neta, no 698.000 con la reventa", async () => {
    const r = await datosVueloBloqueo(sb(bloqueo()), 7);
    assert.ok(r.ok);
    assert.equal(r.data.costo_neto, 300_000);
    assert.equal(r.data.tarifa_para_empaquetar, 349_000, "la reventa se conserva para el PVP comercial");
    assert.equal(r.data.costo_neto * 2 + r.data.fee_infante * 0, 600_000);
    assert.equal(costoVueloBernalo(r.data, 2, 2), 600_000);
    assert.equal(costoAereoBloqueo({ tarifa_neta: 300_000, fee_infante: 0 }, 2, 0), 600_000);
  });
  test("infante sin silla: solo fee_infante (no la neta); 2 adultos + 1 infante con fee 80.500", async () => {
    assert.equal(costoAereoBloqueo({ tarifa_neta: 300_000, fee_infante: 80_500 }, 2, 1), 680_500);
    const r = await datosVueloBloqueo(sb(bloqueo({ fee_infante: 80_500 })), 7);
    assert.ok(r.ok);
    assert.equal(costoVueloBernalo(r.data, 3, 2), 680_500);
  });
  for (const neta of [null, 0, undefined]) {
    test(`sin neta (${String(neta)}) se rechaza: ni reventa ni cero`, async () => {
      const r = await datosVueloBloqueo(sb(bloqueo({ tarifa_neta: neta })), 7);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /tarifa neta/);
      assert.throws(() => costoAereoBloqueo({ tarifa_neta: neta, fee_infante: 0 }, 2, 0), /tarifa neta/);
    });
  }
});
