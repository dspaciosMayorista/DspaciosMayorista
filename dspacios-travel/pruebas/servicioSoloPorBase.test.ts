import { test } from "node:test";
import assert from "node:assert/strict";
import { servicioSeleccionable, servicioSoloPorBase, tarifaBaseIncluible } from "../lib/paquetes/armadoPestanas.ts";

const HOY = "2026-11-04";
const VIG = { nombre: "V", fecha_inicio: "2026-12-01", fecha_fin: "2027-06-30", precio_persona: 45000 };
test("un tour/traslado con base válida y sin vigencia se puede agregar como INCLUIDO, no por el camino de opcionales", () => {
  const tour = { categoria: "tour_traslado", precio_persona: 30000, servicio_temporadas: [], servicio_tarifa_pax: [] };
  assert.equal(servicioSoloPorBase(tour, HOY), true);
  assert.equal(servicioSeleccionable(tour, HOY), false, "como opcional (o en «Seleccionar todos») la base no habilita nada");
  assert.equal(servicioSeleccionable(tour, HOY, true), true, "como incluido sí");
});
test("la base por grupo (rangos GENERAL) también habilita el incluido; base 0, NULL o sin rangos no", () => {
  assert.equal(servicioSoloPorBase({ categoria: "otro", precio_persona: null, servicio_temporadas: [], servicio_tarifa_pax: [{ temporada: "GENERAL" }] }, HOY), true);
  for (const p of [0, null, undefined]) assert.equal(servicioSoloPorBase({ categoria: "tour_traslado", precio_persona: p as never, servicio_temporadas: [], servicio_tarifa_pax: [] }, HOY), false, String(p));
  assert.deepEqual(tarifaBaseIncluible({ precio_persona: 0, servicio_tarifa_pax: [] }), { persona: false, grupo: false });
});
test("con vigencia vendible no es «solo base»; una vigencia vencida no cuenta y la base sigue valiendo como incluido", () => {
  assert.equal(servicioSoloPorBase({ categoria: "tour_traslado", precio_persona: 30000, servicio_temporadas: [VIG], servicio_tarifa_pax: [] }, HOY), false);
  const vencida = { nombre: "V", fecha_inicio: "2020-01-01", fecha_fin: "2020-12-31", precio_persona: 45000 };
  assert.equal(servicioSoloPorBase({ categoria: "tour_traslado", precio_persona: 30000, servicio_temporadas: [vencida], servicio_tarifa_pax: [] }, HOY), true);
  assert.equal(servicioSeleccionable({ categoria: "tour_traslado", precio_persona: 30000, servicio_temporadas: [vencida], servicio_tarifa_pax: [] }, HOY), false, "como opcional una vigencia vencida no habilita nada");
});
test("la asistencia permanente conserva su regla (selecciónable siempre)", () => {
  assert.equal(servicioSeleccionable({ categoria: "asistencia", precio_persona: 20000, servicio_temporadas: [], servicio_tarifa_pax: [] }, HOY), true);
  assert.equal(servicioSoloPorBase({ categoria: "asistencia", precio_persona: 20000, servicio_temporadas: [], servicio_tarifa_pax: [] }, HOY), false);
});
