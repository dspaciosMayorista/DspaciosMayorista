// Frontera y regla única de modalidad por alcance (262): la validan el carrito/checkout (entrada), el precio y el costo/CxP con la MISMA función.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modalidadAlcance, parseAlcanceVenta } from "../lib/calc/servicioAlcance.ts";
import { validarTourInput } from "../lib/reservar/edadesMenores.ts";

const tourBase = { servicioId: 10, paqueteId: 1, fechaIda: "2030-05-10", fechaRegreso: "2030-05-14", pax: 2 };

test("parseAlcanceVenta: ausente es válido; solo llegada | salida | ida_regreso; cualquier otra cosa se rechaza (no se normaliza)", () => {
  assert.deepEqual(parseAlcanceVenta(undefined), { ok: true, alcance: undefined });
  assert.deepEqual(parseAlcanceVenta(null), { ok: true, alcance: undefined });
  for (const a of ["llegada", "salida", "ida_regreso"]) assert.deepEqual(parseAlcanceVenta(a), { ok: true, alcance: a });
  for (const malo of ["", "ida", "IDA_REGRESO", "mitad", 1, true, {}, []]) assert.deepEqual(parseAlcanceVenta(malo), { ok: false }, String(JSON.stringify(malo)));
});

test("validarTourInput: acepta y conserva el alcance; uno ajeno invalida el servicio; sin alcance no inventa ninguno", () => {
  const ok = validarTourInput({ ...tourBase, alcance: "ida_regreso" }, 0);
  assert.equal(ok.ok && ok.tour.alcance, "ida_regreso");
  const sin = validarTourInput(tourBase, 0);
  assert.equal(sin.ok && "alcance" in sin.tour, false);
  const malo = validarTourInput({ ...tourBase, alcance: "mitad" }, 0);
  assert.equal(malo.ok, false); assert.match(!malo.ok ? malo.error : "", /alcance de traslado inválido/);
});

test("modalidadAlcance: traslado exige alcance; el resto lo rechaza; el legado no cambia; el combo limita el suplemento a su tramo", () => {
  assert.deepEqual(modalidadAlcance({ tipo_receptivo: "traslado" }, undefined), { ok: false, motivo: "alcance_requerido" });
  assert.deepEqual(modalidadAlcance({ tipo_receptivo: "traslado" }, "salida"), { ok: true, usaAlcance: true, alcance: "salida" });
  for (const c of [{ tipo_receptivo: "tour" as const }, { tipo_receptivo: "asistencia_medica" as const }, { tipo_receptivo: null }, null, undefined]) {
    assert.deepEqual(modalidadAlcance(c, "llegada"), { ok: false, motivo: "alcance_no_aplica" });
    assert.deepEqual(modalidadAlcance(c, undefined), { ok: true, usaAlcance: false });
  }
  assert.deepEqual(modalidadAlcance({ tipo_receptivo: "combo", combo_incluye_traslado: true, combo_traslado_alcance: "trayecto_salida" }, undefined), { ok: true, usaAlcance: false, tramosCombo: ["salida"] });
  assert.deepEqual(modalidadAlcance({ tipo_receptivo: "combo", combo_incluye_traslado: true, combo_traslado_alcance: "ida_regreso" }, undefined), { ok: true, usaAlcance: false, tramosCombo: ["llegada", "salida"] });
  assert.deepEqual(modalidadAlcance({ tipo_receptivo: "combo", combo_incluye_traslado: false }, undefined), { ok: true, usaAlcance: false });
});
