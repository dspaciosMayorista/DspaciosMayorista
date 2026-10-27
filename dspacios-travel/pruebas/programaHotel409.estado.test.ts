// PR #409 — estado del editor: clonar, conflictos visibles, quitar incompatibles solo por acción explícita, resumen compacto.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aPayload, clonarHotel, conflictosDe, hotelNuevo, incompatiblesDe, netosVacios, nombreRepetido, quitarIncompatibles, resumenVigencias,
  type HotelState,
} from "../app/(dashboard)/dashboard/producto/programas/[id]/hotelEstado.ts";

const netos = (o: Record<string, string> = {}) => ({ ...netosVacios(), ...o });
const hotel = (over: Partial<HotelState> = {}): HotelState => ({
  id: 7, nombre: "Hotel Centro", zona: "Centro", tipoHabitacion: "Estándar", maxPax: "4", maxMenores: "2", proveedorId: 9,
  base: [
    { desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netos({ doble: "600", triple: "520" }) },
    { desde: "2027-03-01", hasta: "2027-03-31", modalidad: "regular", bajoSolicitud: false, neto: netos({ doble: "450", triple: "400" }) },
  ],
  noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netos({ doble: "100", triple: "90", nino: "50" }) }],
  ...over,
});

test("clonar: identidad nueva, nombre único, todo copiado, y el original NO cambia", () => {
  const original = hotel();
  const foto = JSON.stringify(original);
  const clon = clonarHotel(original, ["Hotel Centro"]);
  assert.equal(clon.id, null);
  assert.equal(clon.nombre, "Hotel Centro (copia)");
  assert.deepEqual(clon.base, original.base);
  assert.deepEqual(clon.noches, original.noches);
  assert.notEqual(clon.base[0], original.base[0], "copia profunda");
  clon.base[0].neto.doble = "999";
  clon.noches[0].neto.doble = "999";
  assert.equal(JSON.stringify(original), foto, "editar el clon no altera el original");
  assert.equal(clonarHotel(original, ["Hotel Centro", "Hotel Centro (copia)"]).nombre, "Hotel Centro (copia 2)");
  assert.equal(clonarHotel(original, ["hotel centro", "HOTEL CENTRO (COPIA)"]).nombre, "Hotel Centro (copia 2)", "sin distinguir mayúsculas");
});

test("nombre único: se exige distinto de los demás hoteles (sin distinguir mayúsculas)", () => {
  assert.equal(nombreRepetido("hotel centro", ["Hotel Centro"]), true);
  assert.equal(nombreRepetido("  Hotel Centro ", ["Hotel Centro"]), true);
  assert.equal(nombreRepetido("Hotel Playa", ["Hotel Centro"]), false);
  assert.equal(nombreRepetido("", ["Hotel Centro"]), false);
});

test("bajar el máximo a 2 deja las tarifas Triple a la vista como conflicto, sin descartarlas; quitarlas es una acción explícita", () => {
  const h = hotel({ maxPax: "2", maxMenores: "0" });
  assert.deepEqual(incompatiblesDe(h).map((i) => `${i.donde}${i.indice}:${i.clave}`).sort(), ["base0:triple", "base1:triple", "noche0:nino", "noche0:triple"]);
  assert.ok(conflictosDe(h).length >= 4, "cada una se reporta");
  assert.equal(h.base[0].neto.triple, "520", "nada se borró solo");
  const limpio = quitarIncompatibles(h);
  assert.equal(limpio.base[0].neto.triple, "");
  assert.equal(limpio.noches[0].neto.nino, "");
  assert.equal(limpio.base[0].neto.doble, "600", "lo compatible se conserva");
  assert.deepEqual(incompatiblesDe(limpio), []);
  assert.deepEqual(conflictosDe(limpio), []);
});

test("una noche por habitación no se marca incompatible por el campo de menor (va incluido y no se guarda)", () => {
  const h = hotel({ maxMenores: "0", noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "habitacion", neto: netos({ doble: "180", nino: "40" }) }] });
  assert.deepEqual(incompatiblesDe(h).filter((i) => i.donde === "noche"), []);
});

test("noches ligadas: una tarifa con fechas que no son de ninguna vigencia base es conflicto; elegir la vigencia lo resuelve", () => {
  const h = hotel({ noches: [{ desde: "2027-03-05", hasta: "2027-03-20", unidad: "persona", neto: netos({ doble: "100" }) }] });
  assert.match(conflictosDe(h).join(" "), /vigencia base/);
  const ligado = { ...h, noches: [{ ...h.noches[0], desde: "2027-03-01", hasta: "2027-03-31" }] };
  assert.deepEqual(conflictosDe(ligado), []);
});

test("resumen compacto: vigencias base únicas (privado+regular con las mismas fechas cuentan UNA) y noches", () => {
  const r = resumenVigencias(hotel());
  assert.match(r.base, /^1 vigencia base: 01\/03\/2027–31\/03\/2027$/);
  assert.match(r.noches, /^1 tarifa de noche adicional$/);
  assert.equal(resumenVigencias(hotelNuevo()).base, "Sin vigencias base");
});

test("aPayload conserva la forma que recibe guardarHoteles", () => {
  const p = aPayload(hotel());
  assert.equal(p.id, 7);
  assert.equal(p.maxPaxHabitacion, "4");
  assert.equal(p.noches[0].desde, "2027-03-01");
});
