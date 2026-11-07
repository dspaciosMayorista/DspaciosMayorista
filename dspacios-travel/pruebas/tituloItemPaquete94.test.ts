// Ítem por defecto «Paquete Turístico {Destino}»: normaliza espacios sin tocar letras ni tildes (regresión: /s+/g borraba las «s»).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tituloItemPaquete, tituloPaqueteEditado, tituloPaqueteTuristico } from "../lib/contrato/paqueteTuristicoDocumento.ts";

describe("tituloItemPaquete", () => {
  test("San Andrés conserva letras y tilde", () => assert.equal(tituloItemPaquete("San Andrés"), "Paquete Turístico San Andrés"));
  test("San Jose conserva las «s»", () => assert.equal(tituloItemPaquete("San Jose"), "Paquete Turístico San Jose"));
  test("espacios iniciales, finales y repetidos se normalizan (también tabuladores y saltos)", () => {
    assert.equal(tituloItemPaquete("  San   Andrés  "), "Paquete Turístico San Andrés");
    assert.equal(tituloItemPaquete("\tSanta \n Marta\t"), "Paquete Turístico Santa Marta");
  });
  test("mayúsculas del catálogo se respetan y sin destino queda el texto base", () => {
    assert.equal(tituloItemPaquete("CARTAGENA"), "Paquete Turístico CARTAGENA");
    assert.equal(tituloItemPaquete(""), "Paquete Turístico");
    assert.equal(tituloItemPaquete(null), "Paquete Turístico");
    assert.equal(tituloItemPaquete(undefined), "Paquete Turístico");
  });
  test("la variante con duración usa la misma normalización", () => {
    assert.equal(tituloPaqueteTuristico("  San   Andrés ", "2030-03-01", "2030-03-04"), "Paquete Turístico San Andrés 4 días/3 noches");
  });
});

describe("tituloPaqueteEditado (texto del asesor, validación vigente)", () => {
  test("se conserva con sus letras y tildes, normalizando solo los espacios", () => {
    assert.equal(tituloPaqueteEditado("Escapada  a San Andrés   2030 "), "Escapada a San Andrés 2030");
    assert.equal(tituloPaqueteEditado("Paquete Turístico San Jose"), "Paquete Turístico San Jose");
  });
  test("rechaza lo inválido: demasiado corto, demasiado largo, caracteres de control o no texto", () => {
    assert.equal(tituloPaqueteEditado("ab"), null);
    assert.equal(tituloPaqueteEditado("   x   "), null);
    assert.equal(tituloPaqueteEditado("a".repeat(201)), null);
    assert.equal(tituloPaqueteEditado("Hola\u0007mundo"), null);
    assert.equal(tituloPaqueteEditado(123), null);
    assert.equal(tituloPaqueteEditado(null), null);
  });
  test("límites: 3 y 200 caracteres son válidos", () => {
    assert.equal(tituloPaqueteEditado("abc"), "abc");
    assert.equal(tituloPaqueteEditado("s".repeat(200)), "s".repeat(200));
  });
});
