import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { claveOrigen, etiquetaOrigen } from "../lib/iata.ts";
import { filaDinamicaVisibleEnPaquetes, origenesDinamicos, salidasDinamicasSelector } from "../lib/tarifario/dinamicoBooking.ts";

const LIBRE = { origenSel: "", salidaSel: null, destinoSel: "" };
const din = (salida_id: number) => ({ modulo: "dinamico", salida_id, destino_nombre: "CARTAGENA" });

describe("origen canónico del paquete", () => {
  test("misma ciudad en dos fuentes (código y nombre) → una sola opción legible", () => {
    assert.equal(claveOrigen("MDE"), claveOrigen("MEDELLÍN"));
    assert.equal(claveOrigen("medellin"), "MDE");
    assert.equal(etiquetaOrigen(claveOrigen("MEDELLÍN")), "Medellín");
    assert.deepEqual(origenesDinamicos([din(1), din(2)], { 1: "MDE", 2: "MEDELLÍN" }), ["MDE"]);
  });
  test("ciudades distintas siguen separadas", () => {
    assert.notEqual(claveOrigen("BOG"), claveOrigen("MDE"));
    assert.deepEqual(origenesDinamicos([din(1), din(2)], { 1: "BOG", 2: "MDE" }), ["BOG", "MDE"]);
  });
  test("origen sin correspondencia confiable conserva su valor, sin adivinar", () => {
    assert.equal(claveOrigen("Tumaco"), "TUMACO");
    assert.equal(etiquetaOrigen("TUMACO"), "TUMACO");
    assert.equal(claveOrigen("XYZ"), "XYZ");
    assert.equal(claveOrigen("  "), "");
  });
  test("elegir la ciudad filtra salidas dinámicas de cualquier fuente, y respeta destino", () => {
    const ORI = { 1: "MDE", 2: "MEDELLÍN", 3: "BOG" };
    assert.equal(filaDinamicaVisibleEnPaquetes(din(1), { ...LIBRE, origenSel: "MDE", origenPorSalida: ORI }), true);
    assert.equal(filaDinamicaVisibleEnPaquetes(din(2), { ...LIBRE, origenSel: "MDE", origenPorSalida: ORI }), true);
    assert.equal(filaDinamicaVisibleEnPaquetes(din(3), { ...LIBRE, origenSel: "MDE", origenPorSalida: ORI }), false);
    const sel = salidasDinamicasSelector([din(1), din(2), din(3)], { origenSel: "MDE", destinoSel: "CARTAGENA", origenPorSalida: ORI });
    assert.deepEqual(sel.map((s) => s.id), [1, 2]);
    assert.equal(sel[1].origen, "MEDELLÍN", "el dato propio de la salida no se reescribe");
  });
});
