import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoItinerario, itinerarioConNochesExtra, type DiaItinerario } from "../lib/programas/estanciaHotel88.ts";

const tramo = (dia: number, tipo_tramo: DiaItinerario["tipo_tramo"] = "dia"): DiaItinerario => ({
  dia, tipo_tramo, titulo: `Tramo ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: null,
});

test("un traslado previo o posterior no reemplaza un día turístico", () => {
  assert.equal(estadoItinerario([tramo(0, "traslado_previo"), ...[1, 2, 3, 4, 5].map((n) => tramo(n))], 5).completo, true);
  assert.equal(estadoItinerario([...Array.from({ length: 5 }, (_, i) => tramo(i + 1)), tramo(6, "traslado_posterior")], 5).completo, true);
  assert.deepEqual(estadoItinerario([tramo(0, "traslado_previo"), tramo(1), tramo(2), tramo(3), tramo(4)], 5).faltantes, [5]);
  assert.equal(estadoItinerario([tramo(0, "traslado_previo"), tramo(0, "traslado_previo"), ...[1, 2, 3, 4, 5].map((n) => tramo(n))], 5).completo, false);
  assert.equal(estadoItinerario([...Array.from({ length: 5 }, (_, i) => tramo(i + 1)), tramo(7, "traslado_posterior")], 5).completo, false);
});

test("el itinerario fechado conserva el traslado anterior y desplaza el posterior al añadir noches", () => {
  const dias = [tramo(0, "traslado_previo"), tramo(1), tramo(2), tramo(3), tramo(4), tramo(5), tramo(6, "traslado_posterior")];
  const salida = itinerarioConNochesExtra(dias, 1, "2027-03-01", "Hotel", 5);
  assert.ok(salida);
  assert.deepEqual(salida.map((d) => [d.dia, d.tipo_tramo ?? "dia", d.fecha]), [
    [0, "traslado_previo", "2027-02-28"], [1, "dia", "2027-03-01"], [2, "dia", "2027-03-02"],
    [3, "dia", "2027-03-03"], [4, "dia", "2027-03-04"], [5, "dia", "2027-03-05"],
    [6, "dia", "2027-03-06"], [7, "traslado_posterior", "2027-03-07"],
  ]);
  assert.equal(salida.filter((d) => d.libre).length, 1);
});
