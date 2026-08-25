import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { distribuirPorHabitaciones, type ConfigCapacidadHabitacion, type HabitacionConsultada } from "../lib/reservar/distribucionHabitaciones.ts";

// ───────────────────────────────────────────────────────────────────────────
// Distribución de Niño 1/Niño 2/infante ENTRE LAS HABITACIONES consultadas.
// Corrige el defecto real de la primera ronda de este cambio: el reparto NO
// es un límite de 2 niños en TODA la reserva — es un límite de 2 (Niño 1 +
// Niño 2) POR HABITACIÓN. Con 2 habitaciones caben hasta 4; con 3, hasta 6.
// Un niño de más solo se rechaza si NINGUNA habitación consultada tiene cupo.
//
// Ronda 4: corrige un SEGUNDO defecto — el reparto voraz por orden de
// captura llenaba cada habitación hasta su máximo ANTES de reservar los
// mínimos (`chd_min`/`inf_min`) de las demás, produciendo falsos rechazos
// aunque existiera una distribución válida. Ahora: fase 1 valida que cada
// configuración sea coherente en sí misma ("configuración inválida" si no);
// fase 2 reserva el mínimo de cada habitación; fase 3 rechaza si ni sumando
// todos los mínimos alcanza lo declarado; fase 4 reparte el resto por orden
// de captura hasta el máximo de cada habitación.
// ───────────────────────────────────────────────────────────────────────────

function cfg(overrides: Partial<ConfigCapacidadHabitacion> = {}): ConfigCapacidadHabitacion {
  return {
    pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 4,
    chd_min: 0, chd_max: 4, inf_min: 0, inf_max: 4,
    ...overrides,
  };
}
function hab(overrides: Partial<ConfigCapacidadHabitacion> & { acom?: HabitacionConsultada["acom"] } = {}): HabitacionConsultada {
  const { acom, ...cfgOverrides } = overrides;
  return { acom: acom ?? "doble", config: cfg(cfgOverrides) };
}

describe("1. Una habitación + 1 niño → Niño 1 = 1", () => {
  test("nino=1, nino2=0", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 1, infantes: 0, habitaciones: [hab({ chd_max: 2 })] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.habitaciones[0].nino, 1);
      assert.equal(r.habitaciones[0].nino2, 0);
      assert.deepEqual(r.totales, { adultos: 2, nino: 1, nino2: 0, infantes: 0 });
    }
  });
});

describe("2. Una habitación + 2 niños → Niño 1 = 1, Niño 2 = 1", () => {
  test("nino=1, nino2=1", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 2, infantes: 0, habitaciones: [hab({ chd_max: 2 })] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.habitaciones[0].nino, 1);
      assert.equal(r.habitaciones[0].nino2, 1);
      assert.deepEqual(r.totales, { adultos: 2, nino: 1, nino2: 1, infantes: 0 });
    }
  });
});

describe("3. Una habitación + 3 niños → rechazo (conservado)", () => {
  test("capacidad máxima 2 en una sola habitación", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 3, infantes: 0, habitaciones: [hab({ chd_max: 2 })] });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "seleccion_invalida"); assert.match(r.error, /habitación seleccionada admite máximo 2 niño/); }
  });
});

describe("4. Dos habitaciones + 3 niños → Niño 1 = 2, Niño 2 = 1 (conservado)", () => {
  test("primera habitación llena (1+2), segunda recibe el 3º como Niño 1", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 3, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.habitaciones.map((h) => [h.nino, h.nino2]), [[1, 1], [1, 0]]);
      assert.deepEqual(r.totales, { adultos: 4, nino: 2, nino2: 1, infantes: 0 });
    }
  });
});

describe("5. Dos habitaciones + 4 niños → Niño 1 = 2, Niño 2 = 2 (conservado)", () => {
  test("cada habitación toma un Niño 1 y un Niño 2", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 4, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.habitaciones.map((h) => [h.nino, h.nino2]), [[1, 1], [1, 1]]);
      assert.deepEqual(r.totales, { adultos: 4, nino: 2, nino2: 2, infantes: 0 });
    }
  });
});

describe("6. Dos habitaciones + 5 niños → rechazo", () => {
  test("capacidad máxima 4 entre las dos habitaciones", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 5, infantes: 0, habitaciones });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "seleccion_invalida"); assert.match(r.error, /2 habitaciones seleccionadas admiten máximo 4 niño/); }
  });
});

describe("7. Habitación con chd_max=1 nunca recibe Niño 2", () => {
  test("1 niño → solo Niño 1", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 1, ninos: 1, infantes: 0, habitaciones: [hab({ acom: "sencilla", pax_tarifa: 1, pax_max: 2, chd_max: 1 })] });
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.habitaciones[0].nino, 1); assert.equal(r.habitaciones[0].nino2, 0); }
  });
  test("2 niños en esa misma habitación se rechazan (nunca se le fuerza un Niño 2)", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 1, ninos: 2, infantes: 0, habitaciones: [hab({ acom: "sencilla", pax_tarifa: 1, pax_max: 2, chd_max: 1 })] });
    assert.equal(r.ok, false);
  });
});

describe("8. Habitaciones con capacidades infantiles diferentes", () => {
  test("3 infantes repartidos según inf_max de cada habitación (1 + 2)", () => {
    const habitaciones = [hab({ inf_max: 1 }), hab({ inf_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 0, infantes: 3, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.habitaciones.map((h) => h.infantes), [1, 2]);
      assert.equal(r.totales.infantes, 3);
    }
  });
});

describe("9. Infantes respetan inf_max", () => {
  test("una habitación con inf_max=2 rechaza 3 infantes", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 3, habitaciones: [hab({ inf_max: 2 })] });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "seleccion_invalida"); assert.match(r.error, /máximo 2 infante\(s\); hay 3/); }
  });
  test("el infante NO consume el cupo de niño (usa su propio inf_max)", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 2, infantes: 2, habitaciones: [hab({ chd_max: 2, inf_max: 2 })] });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.totales, { adultos: 2, nino: 1, nino2: 1, infantes: 2 });
  });
});

describe("10. Adultos respetan adt_min, adt_max (POR HABITACIÓN, no suma) y capacidad total", () => {
  test("adultos declarados distinto al implícito de las habitaciones (pax_tarifa) se rechaza como selección inválida", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2 })] });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "seleccion_invalida"); assert.match(r.error, /Las habitaciones elegidas son para 2 adulto\(s\); declaraste 3/); }
  });
  test("una habitación cuyo pax_tarifa cae fuera de su propio adt_min/adt_max es CONFIGURACIÓN INVÁLIDA (no una mala elección del cliente)", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2, adt_min: 3, adt_max: 4 })] });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /admite entre 3 y 4 adulto\(s\); está configurada para 2/); }
  });
  test("adultos que sí cuadran con pax_tarifa y adt_min/adt_max pasa", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2, adt_min: 1, adt_max: 2 })] });
    assert.equal(r.ok, true);
  });
  test("una habitación bien configurada NO se ve afectada por otra habitación mal configurada (chequeo per-room, no agregado)", () => {
    const habitaciones = [hab({ pax_tarifa: 1, adt_min: 1, adt_max: 1 }), hab({ pax_tarifa: 2, adt_min: 3, adt_max: 4 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 0, infantes: 0, habitaciones });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /admite entre 3 y 4 adulto\(s\); está configurada para 2/); }
  });
});

describe("10b. chd_min/inf_min — mínimos por habitación, reparto en dos fases (ronda 4)", () => {
  test("REGRESIÓN corregida: 2 habitaciones (chd_min 0 y 1), 1 niño total → antes se rechazaba por reparto voraz; ahora encuentra [0,1]", () => {
    const habitaciones = [hab({ chd_max: 2, chd_min: 0 }), hab({ chd_max: 2, chd_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 1, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.habitaciones.map((h) => h.nino + h.nino2), [0, 1]);
      assert.ok(r.habitaciones[1].nino + r.habitaciones[1].nino2 >= 1); // cubre su propio mínimo
    }
  });
  test("con niños suficientes para cubrir el mínimo de cada habitación y sobrar, pasa y reparte el resto por orden de captura", () => {
    const habitaciones = [hab({ chd_max: 2, chd_min: 0 }), hab({ chd_max: 2, chd_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 3, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.habitaciones.map((h) => h.nino + h.nino2), [2, 1]);
      assert.ok(r.habitaciones[1].nino + r.habitaciones[1].nino2 >= 1);
    }
  });
  test("chd_min=0 (default) nunca restringe una habitación sin menores", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ chd_min: 0 })] });
    assert.equal(r.ok, true);
  });
  test("inf_min=0 (default) nunca restringe una habitación sin infantes", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ inf_min: 0 })] });
    assert.equal(r.ok, true);
  });
  test("inf_min por encima de inf_max es CONFIGURACIÓN INVÁLIDA (no un rechazo por selección del cliente)", () => {
    const habitaciones = [hab({ inf_max: 2, inf_min: 0 }), hab({ inf_max: 0, inf_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 0, infantes: 1, habitaciones });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /inf_min \(1\) mayor que inf_max \(0\)/); }
  });
});

describe("11. Sin habitaciones consultadas se rechaza", () => {
  test("arreglo vacío de habitaciones", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "seleccion_invalida");
  });
});

describe("14. Orden de captura produce una distribución determinista", () => {
  test("mismo input, mismo resultado siempre (determinista)", () => {
    const habitaciones = [hab({ chd_max: 1, pax_tarifa: 1, pax_max: 2, adt_min: 1, adt_max: 1 }), hab({ chd_max: 2 })];
    const r1 = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 3, infantes: 0, habitaciones });
    const r2 = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 3, infantes: 0, habitaciones });
    assert.deepEqual(r1, r2);
  });
  test("invertir el orden de las habitaciones cambia CUÁL habitación recibe cada niño (mismo agregado)", () => {
    const roomChico = hab({ acom: "sencilla", chd_max: 1, pax_tarifa: 1, pax_max: 2, adt_min: 1, adt_max: 1 });
    const roomGrande = hab({ chd_max: 2, pax_tarifa: 2, adt_min: 2, adt_max: 2 });
    const rA = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 3, infantes: 0, habitaciones: [roomChico, roomGrande] });
    const rB = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 3, infantes: 0, habitaciones: [roomGrande, roomChico] });
    assert.equal(rA.ok, true);
    assert.equal(rB.ok, true);
    if (rA.ok && rB.ok) {
      assert.deepEqual(rA.totales, rB.totales);
      assert.deepEqual(rA.habitaciones[0].acom, "sencilla");
      assert.deepEqual(rB.habitaciones[1].acom, "sencilla");
    }
  });
});

describe("15. Múltiples habitaciones no pierden ni duplican menores", () => {
  test("3 habitaciones amplias, 5 niños y 3 infantes: la suma se conserva exacta", () => {
    const habitaciones = [hab({ chd_max: 4 }), hab({ chd_max: 4 }), hab({ chd_max: 4 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 6, ninos: 5, infantes: 3, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      const ninoSum = r.habitaciones.reduce((s, h) => s + h.nino + h.nino2, 0);
      const infSum = r.habitaciones.reduce((s, h) => s + h.infantes, 0);
      assert.equal(ninoSum, 5);
      assert.equal(infSum, 3);
      assert.equal(r.totales.nino + r.totales.nino2, 5);
      assert.equal(r.totales.infantes, 3);
    }
  });
});

describe("22. Control negativo del límite global de 2 niños (defecto de la 1a ronda, ya corregido)", () => {
  test("2 habitaciones con capacidad para 2 niños cada una SÍ aceptan 4 niños (2 Niño1 + 2 Niño2) — nunca se rechaza por un tope global de 2", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 4, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.totales.nino + r.totales.nino2, 4);
  });
  test("3 habitaciones con capacidad para 2 niños cada una aceptan hasta 6 niños", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 6, ninos: 6, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.totales.nino + r.totales.nino2, 6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 23. Ronda 4 — pruebas obligatorias explícitas del pedido de corrección
// ───────────────────────────────────────────────────────────────────────────
describe("23. Ronda 4: dos habitaciones min=1 y 2 niños → [1,1], no rechazo", () => {
  test("cada habitación se queda exactamente con su mínimo, sin sobrante que repartir", () => {
    const habitaciones = [hab({ chd_max: 2, chd_min: 1 }), hab({ chd_max: 2, chd_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 2, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.habitaciones.map((h) => h.nino + h.nino2), [1, 1]);
      assert.equal(r.totales.nino + r.totales.nino2, 2);
    }
  });
});

describe("24. Ronda 4: dos habitaciones min=1 y 3 niños → [2,1]", () => {
  test("mínimos reservados primero ([1,1]), el sobrante (1) va a la primera habitación por orden de captura", () => {
    const habitaciones = [hab({ chd_max: 2, chd_min: 1 }), hab({ chd_max: 2, chd_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 3, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones.map((h) => h.nino + h.nino2), [2, 1]);
  });
});

describe("25. Ronda 4: suma de mínimos mayor a niños → rechazo (selección inválida, no configuración)", () => {
  test("2 habitaciones con chd_min=2 cada una (config coherente: chd_max=2) exigen 4 en total; solo hay 3", () => {
    const habitaciones = [hab({ chd_max: 2, chd_min: 2 }), hab({ chd_max: 2, chd_min: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 3, infantes: 0, habitaciones });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "seleccion_invalida"); assert.match(r.error, /exigen un mínimo de 4 niño\(s\) en total; hay 3/); }
  });
});

describe("26. Ronda 4: min mayor al máximo efectivo → configuración inválida", () => {
  test("chd_min excede min(chd_max, 2, pax_max−adultos): pax_max=pax_tarifa (sin espacio para niños) pero chd_min=1", () => {
    const habitaciones = [hab({ pax_tarifa: 4, pax_max: 4, adt_min: 4, adt_max: 4, chd_max: 2, chd_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 0, infantes: 0, habitaciones });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /exige chd_min \(1\) por encima de su capacidad efectiva de niño \(0/); }
  });
});

describe("27. Ronda 4: infantes con mínimos equivalentes → sin rechazo", () => {
  test("2 habitaciones inf_min=1/inf_max=3 cada una, 2 infantes en total → [1,1]", () => {
    const habitaciones = [hab({ inf_max: 3, inf_min: 1 }), hab({ inf_max: 3, inf_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 0, infantes: 2, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones.map((h) => h.infantes), [1, 1]);
  });
  test("mismos mínimos, 3 infantes (1 de sobra) → el sobrante va por orden de captura a la primera habitación", () => {
    const habitaciones = [hab({ inf_max: 3, inf_min: 1 }), hab({ inf_max: 3, inf_min: 1 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 0, infantes: 3, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones.map((h) => h.infantes), [2, 1]);
  });
});

describe("28. Ronda 4: 1 habitación / 3 niños sigue rechazado (conservado explícitamente)", () => {
  test("no cambia con el nuevo algoritmo de dos fases", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 3, infantes: 0, habitaciones: [hab({ chd_max: 2, chd_min: 0 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "seleccion_invalida");
  });
});

describe("29. Ronda 4: 2 habitaciones / 3 y 4 niños siguen aceptados (conservado explícitamente)", () => {
  test("3 niños → [2,1]", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 3, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones.map((h) => h.nino + h.nino2), [2, 1]);
  });
  test("4 niños → [2,2]", () => {
    const habitaciones = [hab({ chd_max: 2 }), hab({ chd_max: 2 })];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 4, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones.map((h) => h.nino + h.nino2), [2, 2]);
  });
});

describe("30. Ronda 4: validación de forma de la configuración (enteros seguros, no negativos)", () => {
  test("un campo no entero es configuración inválida", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ chd_max: 2.5 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
  test("un campo negativo es configuración inválida", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ chd_min: -1 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
  test("adt_min mayor que adt_max es configuración inválida", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2, adt_min: 3, adt_max: 2 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
  test("pax_tarifa mayor que pax_max es configuración inválida", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 5, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 5, pax_max: 4, adt_min: 5, adt_max: 5 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
});
