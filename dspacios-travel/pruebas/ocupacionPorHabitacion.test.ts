import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirHabitacionesUI,
  idsHabitacionesPorConteo,
  sincronizarHabitaciones,
  ajustarCantidadEdadesHabitacion,
  establecerEdad,
  construirPayloadHabitaciones,
  validarHabitacionesOcupacion,
  type EdadesPorHabitacion,
} from "../lib/reservar/ocupacionPorHabitacion.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3D Bernalo — captura y transporte de la asociación habitación↔edades
// (`lib/reservar/ocupacionPorHabitacion.ts`). Módulo puro: la MISMA función
// de validación se usa en la UI (preview) y en el servidor (autoridad).
// ─────────────────────────────────────────────────────────────────────────

describe("construirHabitacionesUI / idsHabitacionesPorConteo — ids estables por tipo", () => {
  test("2 dobles + 1 triple produce 3 ids independientes en orden ACOM_ROOMS", () => {
    const ui = construirHabitacionesUI({ doble: 2, triple: 1 });
    assert.deepEqual(ui.map((h) => h.id), ["doble-0", "doble-1", "triple-0"]);
    assert.deepEqual(idsHabitacionesPorConteo({ doble: 2, triple: 1 }), ["doble-0", "doble-1", "triple-0"]);
  });

  test("conteos en 0/negativos/no numéricos se ignoran, nunca producen ids", () => {
    const ui = construirHabitacionesUI({ doble: 0, triple: -1, sencilla: NaN });
    assert.deepEqual(ui, []);
  });
});

describe("validarHabitacionesOcupacion — una habitación SIN menores", () => {
  test("cantidadMenores 0 y edadesMenores [] es válida", () => {
    const r = validarHabitacionesOcupacion([{ id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] }]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.habitaciones.length, 1);
      assert.deepEqual(r.habitaciones[0].edadesMenores, []);
    }
  });
});

describe("validarHabitacionesOcupacion — una habitación con DOS menores y edades diferentes", () => {
  test("ambas edades quedan asociadas a la misma habitación, en orden", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 2, edadesMenores: [5, 9] },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones[0].edadesMenores, [5, 9]);
  });
});

describe("validarHabitacionesOcupacion — dos habitaciones con UN menor cada una", () => {
  test("cada habitación conserva su propia edad, asociaciones independientes", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [5] },
      { id: "doble-1", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [9] },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      const h0 = r.habitaciones.find((h) => h.id === "doble-0")!;
      const h1 = r.habitaciones.find((h) => h.id === "doble-1")!;
      assert.deepEqual(h0.edadesMenores, [5]);
      assert.deepEqual(h1.edadesMenores, [9]);
    }
  });
});

describe("sincronizarHabitaciones — cambiar/eliminar una habitación no mueve edades a otra", () => {
  test("quitar la 2ª doble descarta SUS edades, la 1ª doble conserva las suyas intactas", () => {
    const estado: EdadesPorHabitacion = { "doble-0": ["5"], "doble-1": ["9"] };
    const siguiente = sincronizarHabitaciones(estado, idsHabitacionesPorConteo({ doble: 1 }));
    assert.deepEqual(siguiente, { "doble-0": ["5"] });
    assert.equal(Object.prototype.hasOwnProperty.call(siguiente, "doble-1"), false);
  });

  test("agregar una nueva habitación no altera las edades de las existentes; la nueva nace vacía", () => {
    const estado: EdadesPorHabitacion = { "doble-0": ["5"] };
    const siguiente = sincronizarHabitaciones(estado, idsHabitacionesPorConteo({ doble: 2 }));
    assert.deepEqual(siguiente, { "doble-0": ["5"], "doble-1": [] });
  });

  test("cambiar totalmente de tipo (doble → triple) descarta todas las edades viejas, nunca las reasigna al nuevo tipo", () => {
    const estado: EdadesPorHabitacion = { "doble-0": ["5"], "doble-1": ["9"] };
    const siguiente = sincronizarHabitaciones(estado, idsHabitacionesPorConteo({ triple: 2 }));
    assert.deepEqual(siguiente, { "triple-0": [], "triple-1": [] });
  });
});

describe("ajustarCantidadEdadesHabitacion / establecerEdad — edición por habitación", () => {
  test("aumentar la cantidad en una habitación agrega campos vacíos SOLO ahí, sin tocar otras habitaciones", () => {
    let estado: EdadesPorHabitacion = { "doble-0": ["5"], "doble-1": ["9"] };
    estado = ajustarCantidadEdadesHabitacion(estado, "doble-0", 2);
    assert.deepEqual(estado["doble-0"], ["5", ""]);
    assert.deepEqual(estado["doble-1"], ["9"]);
  });

  test("establecerEdad escribe solo en el índice/habitación indicados", () => {
    let estado: EdadesPorHabitacion = { "doble-0": ["", ""] };
    estado = establecerEdad(estado, "doble-0", 1, "7");
    assert.deepEqual(estado["doble-0"], ["", "7"]);
  });
});

describe("construirPayloadHabitaciones — el servidor recibe la asociación habitación↔edad completa", () => {
  test("arma un payload con id/acom/adultos/cantidadMenores/edadesMenores por cada habitación física", () => {
    const habs = { doble: 2 };
    const paxTarifaPorTipo = { doble: 2 };
    const edadesPorHabitacion: EdadesPorHabitacion = { "doble-0": ["5"], "doble-1": ["9", "2"] };
    const payload = construirPayloadHabitaciones(habs, paxTarifaPorTipo, edadesPorHabitacion);
    assert.deepEqual(payload, [
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [5] },
      { id: "doble-1", acom: "doble", adultos: 2, cantidadMenores: 2, edadesMenores: [9, 2] },
    ]);
  });
});

describe("validarHabitacionesOcupacion — conteo y edades inconsistentes bloquean", () => {
  test("cantidadMenores no coincide con la longitud real de edadesMenores: bloquea con mensaje claro", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 2, edadesMenores: [5] },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errores.length, 1);
      assert.equal(r.errores[0].habitacionId, "doble-0");
      assert.match(r.errores[0].mensaje, /declara 2 menor\(es\) pero llegaron 1/);
    }
  });
});

describe("validarHabitacionesOcupacion — edad vacía/decimal/negativa/fuera de rango bloquea", () => {
  test("edad vacía (null, tal como la transporta construirPayloadHabitaciones): bloquea", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [null] },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errores[0].mensaje, /obligatoria/);
  });

  test("edad decimal: bloquea (no es entera)", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [5.5] },
    ]);
    assert.equal(r.ok, false);
  });

  test("edad negativa: bloquea", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [-1] },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errores[0].mensaje, /negativa/);
  });

  test("edad fuera de rango (18, ya no es menor): bloquea", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [18] },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errores[0].mensaje, /no corresponde a un menor de edad/);
  });

  test("varias habitaciones con distintos problemas: TODOS los errores se reportan, no solo el primero", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [-1] },
      { id: "doble-1", acom: "doble", adultos: 2, cantidadMenores: 1, edadesMenores: [99] },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errores.length, 2);
      assert.deepEqual(r.errores.map((e) => e.habitacionId).sort(), ["doble-0", "doble-1"]);
    }
  });
});

describe("validarHabitacionesOcupacion — forma general", () => {
  test("arreglo vacío: bloquea (no hay habitaciones)", () => {
    const r = validarHabitacionesOcupacion([]);
    assert.equal(r.ok, false);
  });

  test("id repetido entre dos habitaciones: bloquea", () => {
    const r = validarHabitacionesOcupacion([
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] },
      { id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errores[0].mensaje, /repetido/);
  });

  test("payload que no es un arreglo: bloquea", () => {
    const r = validarHabitacionesOcupacion({ no: "es un arreglo" });
    assert.equal(r.ok, false);
  });
});
