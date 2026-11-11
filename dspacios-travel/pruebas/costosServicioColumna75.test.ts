// #75 · columna de costo de un servicio = la de su CxP (la asistencia médica no es costo receptivo). Función pura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { columnaCostoServicio, costosServicioPorColumna, tipoProveedorCxpServicio } from "../lib/reservar/serviciosPaquete.ts";
import { faltantesCxP } from "../lib/reservar/cxpCobertura.ts";

test("la columna sigue al tipo de la CxP: asistencia → costo_asistencia; receptivo y «otro» → costo_receptivo (como siempre)", () => {
  assert.equal(columnaCostoServicio(tipoProveedorCxpServicio("asistencia")), "costo_asistencia");
  assert.equal(columnaCostoServicio(tipoProveedorCxpServicio("tour_traslado")), "costo_receptivo");
  assert.equal(columnaCostoServicio(tipoProveedorCxpServicio("otro")), "costo_receptivo");
  assert.equal(columnaCostoServicio(null), "costo_receptivo");
});

test("hotel + asistencia SIN receptivo: la asistencia queda en su columna y el receptivo en 0", () => {
  assert.deepEqual(costosServicioPorColumna([{ tipoCxp: "asistencia", costo: 60_000 }]), { costo_receptivo: 0, costo_asistencia: 60_000 });
});

test("control con receptivo + asistencia: cada uno en su columna; el total se conserva; valores no finitos o negativos no suman", () => {
  const r = costosServicioPorColumna([
    { tipoCxp: "receptivo", costo: 80_000 }, { tipoCxp: "asistencia", costo: 60_000 }, { tipoCxp: "otro", costo: 10_000 },
    { tipoCxp: "asistencia", costo: Number.NaN }, { tipoCxp: "receptivo", costo: -5 },
  ]);
  assert.deepEqual(r, { costo_receptivo: 90_000, costo_asistencia: 60_000 });
  assert.equal(r.costo_receptivo + r.costo_asistencia, 150_000);
});

test("la cobertura de CxP no cambia al repartir: las CxP de servicio del contrato cubren las dos columnas (sin faltantes ni duplicados)", () => {
  const cxp = [{ tipo_proveedor: "hotel", valor_total: 600_000 }, { tipo_proveedor: "asistencia", valor_total: 60_000 }, { tipo_proveedor: "receptivo", valor_total: 80_000 }];
  const antes = faltantesCxP(cxp, { costo_hotel: 600_000, costo_aereo: 0, costo_receptivo: 140_000, costo_asistencia: 0, otros_costos: 0 });
  const ahora = faltantesCxP(cxp, { costo_hotel: 600_000, costo_aereo: 0, costo_receptivo: 80_000, costo_asistencia: 60_000, otros_costos: 0 });
  assert.deepEqual(antes, []);
  assert.deepEqual(ahora, []);
});
