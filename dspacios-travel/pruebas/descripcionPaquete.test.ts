// lib/tarifario/descripcionPaquete.ts — descripción manual del paquete
// (migración 169): reemplaza la generación automática de "Incluye".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lineasDeTexto, seccionesDescripcion, descripcionVacia, type DescripcionPaqueteRaw } from "../lib/tarifario/descripcionPaquete.ts";

describe("lineasDeTexto — un elemento por línea, solo líneas no vacías", () => {
  test("null/undefined/'' → []", () => {
    assert.deepEqual(lineasDeTexto(null), []);
    assert.deepEqual(lineasDeTexto(undefined), []);
    assert.deepEqual(lineasDeTexto(""), []);
  });

  test("texto simple de varias líneas", () => {
    assert.deepEqual(lineasDeTexto("Desayuno buffet\nTraslados\nImpuestos"), [
      "Desayuno buffet",
      "Traslados",
      "Impuestos",
    ]);
  });

  test("líneas vacías intermedias se descartan (no generan ítems vacíos)", () => {
    assert.deepEqual(lineasDeTexto("A\n\nB\n\n\nC"), ["A", "B", "C"]);
  });

  test("líneas de solo espacios se tratan como vacías", () => {
    assert.deepEqual(lineasDeTexto("A\n   \nB"), ["A", "B"]);
  });

  test("recorta espacios al inicio/fin de cada línea, pero conserva tildes y caracteres internos", () => {
    assert.deepEqual(lineasDeTexto("  Traslado aeropuerto-hotel  \n  Alimentación (PAM)  "), [
      "Traslado aeropuerto-hotel",
      "Alimentación (PAM)",
    ]);
  });

  test("acepta CRLF (\\r\\n) igual que LF", () => {
    assert.deepEqual(lineasDeTexto("Uno\r\nDos\r\nTres"), ["Uno", "Dos", "Tres"]);
  });

  test("texto de una sola línea sin salto", () => {
    assert.deepEqual(lineasDeTexto("Solo una línea"), ["Solo una línea"]);
  });
});

describe("seccionesDescripcion — encabezados fijos, solo las secciones con contenido", () => {
  test("las 4 secciones vacías/null → []", () => {
    assert.deepEqual(seccionesDescripcion(null), []);
    assert.deepEqual(seccionesDescripcion(undefined), []);
    assert.deepEqual(
      seccionesDescripcion({ incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null }),
      []
    );
    assert.deepEqual(
      seccionesDescripcion({ incluye: "", noIncluye: "  ", tarifasEspeciales: null, condicionesComerciales: undefined as unknown as string }),
      []
    );
  });

  test("REQUERIDO: solo 'incluye' configurado → una sola sección 'El programa incluye'", () => {
    const d: DescripcionPaqueteRaw = { incluye: "Desayuno\nTraslados", noIncluye: null, tarifasEspeciales: null, condicionesComerciales: null };
    assert.deepEqual(seccionesDescripcion(d), [{ titulo: "El programa incluye", items: ["Desayuno", "Traslados"] }]);
  });

  test("REQUERIDO: las 4 secciones con contenido, en orden fijo El programa incluye/El programa no incluye/Tarifas especiales/Condiciones comerciales", () => {
    const d: DescripcionPaqueteRaw = {
      incluye: "A",
      noIncluye: "B",
      tarifasEspeciales: "C",
      condicionesComerciales: "D",
    };
    assert.deepEqual(seccionesDescripcion(d), [
      { titulo: "El programa incluye", items: ["A"] },
      { titulo: "El programa no incluye", items: ["B"] },
      { titulo: "Tarifas especiales", items: ["C"] },
      { titulo: "Condiciones comerciales", items: ["D"] },
    ]);
  });

  test("una sección vacía en medio de otras con contenido se omite (nunca un encabezado con lista vacía)", () => {
    const d: DescripcionPaqueteRaw = { incluye: "A", noIncluye: null, tarifasEspeciales: "C", condicionesComerciales: null };
    assert.deepEqual(seccionesDescripcion(d), [
      { titulo: "El programa incluye", items: ["A"] },
      { titulo: "Tarifas especiales", items: ["C"] },
    ]);
  });
});

describe("descripcionVacia — true solo si las 4 secciones no tienen contenido", () => {
  test("null/undefined → true", () => {
    assert.equal(descripcionVacia(null), true);
    assert.equal(descripcionVacia(undefined), true);
  });

  test("las 4 en blanco (null o solo espacios) → true", () => {
    assert.equal(
      descripcionVacia({ incluye: null, noIncluye: "   ", tarifasEspeciales: "", condicionesComerciales: null }),
      true
    );
  });

  test("con al menos una línea real en cualquiera de las 4 → false", () => {
    assert.equal(
      descripcionVacia({ incluye: null, noIncluye: null, tarifasEspeciales: null, condicionesComerciales: "No reembolsable" }),
      false
    );
  });
});
