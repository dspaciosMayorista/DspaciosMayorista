import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { distribuirPorHabitaciones, type ConfigCapacidadHabitacion, type HabitacionConsultada } from "../lib/reservar/distribucionHabitaciones.ts";

// ───────────────────────────────────────────────────────────────────────────
// Distribución de Niño 1/Niño 2/infante ENTRE LAS HABITACIONES consultadas.
// Corrige el defecto real de la primera ronda de este cambio: el reparto NO
// es un límite de 2 niños en TODA la reserva — es un límite de 2 (Niño 1 +
// Niño 2) POR HABITACIÓN. Con 2 habitaciones caben hasta 4; con 3, hasta 6.
// Un niño de más solo se rechaza si NINGUNA habitación consultada tiene cupo.
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

describe("3. Una habitación + 3 niños → rechazo", () => {
  test("capacidad máxima 2 en una sola habitación", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 3, infantes: 0, habitaciones: [hab({ chd_max: 2 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /habitación seleccionada admite máximo 2 niño/);
  });
});

describe("4. Dos habitaciones + 3 niños → Niño 1 = 2, Niño 2 = 1", () => {
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

describe("5. Dos habitaciones + 4 niños → Niño 1 = 2, Niño 2 = 2", () => {
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
    if (!r.ok) assert.match(r.error, /2 habitaciones seleccionadas admiten máximo 4 niño/);
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
    if (!r.ok) assert.match(r.error, /máximo 2 infante\(s\); hay 3/);
  });
  test("el infante NO consume el cupo de niño (usa su propio inf_max)", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 2, infantes: 2, habitaciones: [hab({ chd_max: 2, inf_max: 2 })] });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.totales, { adultos: 2, nino: 1, nino2: 1, infantes: 2 });
  });
});

describe("10. Adultos respetan adt_min, adt_max y capacidad total", () => {
  test("adultos declarados distinto al implícito de las habitaciones (pax_tarifa) se rechaza", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Las habitaciones elegidas son para 2 adulto\(s\); declaraste 3/);
  });
  test("adultos dentro del implícito pero fuera de adt_min/adt_max agregado se rechaza", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2, adt_min: 3, adt_max: 4 })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no admite 2 adulto\(s\)/);
  });
  test("adultos que sí cuadran con pax_tarifa y adt_min/adt_max pasa", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [hab({ pax_tarifa: 2, adt_min: 1, adt_max: 2 })] });
    assert.equal(r.ok, true);
  });
});

describe("11. Sin habitaciones consultadas se rechaza", () => {
  test("arreglo vacío de habitaciones", () => {
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 0, infantes: 0, habitaciones: [] });
    assert.equal(r.ok, false);
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
      // El total agregado es el mismo (2 Niño1 + 1 Niño2)...
      assert.deepEqual(rA.totales, rB.totales);
      // ...pero la asignación POR HABITACIÓN sigue el orden de captura: la
      // habitación chica va primero en rA y segunda en rB.
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
