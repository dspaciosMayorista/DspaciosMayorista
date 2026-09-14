import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatearComposicionHabitacionBernalo,
  resumenHabitacionesBernalo,
} from "../lib/cart/resumenHabitacionBernalo.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) del resumen de habitaciones unidad en el
// carrito — antes solo mostraba "Doble (2 adt)", ahora "Doble (2 adt + 1
// chd)" cuando el ítem trae la composición saneada. Ver la cabecera de
// `lib/cart/resumenHabitacionBernalo.ts`.
// ─────────────────────────────────────────────────────────────────────────

describe("formatearComposicionHabitacionBernalo", () => {
  test("2 adultos + 1 niño (edad 8, clasificado 'nino') → '2 adt + 1 chd'", () => {
    const r = formatearComposicionHabitacionBernalo({ habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 0 }, 2);
    assert.equal(r, "2 adt + 1 chd");
  });

  test("2 adultos + 1 infante (edad 1, clasificado 'infante') → '2 adt + 1 inf'", () => {
    const r = formatearComposicionHabitacionBernalo({ habitacionId: "doble-0", adultos: 2, ninos: 0, infantes: 1 }, 2);
    assert.equal(r, "2 adt + 1 inf");
  });

  test("dos niños → '2 adt + 2 chd' (conteo correcto, nunca colapsado)", () => {
    const r = formatearComposicionHabitacionBernalo({ habitacionId: "doble-0", adultos: 2, ninos: 2, infantes: 0 }, 2);
    assert.equal(r, "2 adt + 2 chd");
  });

  test("niño + infante juntos → '2 adt + 1 chd + 1 inf'", () => {
    const r = formatearComposicionHabitacionBernalo({ habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 1 }, 2);
    assert.equal(r, "2 adt + 1 chd + 1 inf");
  });

  test("sin niños ni infantes → solo '2 adt' (sin '+' colgando)", () => {
    const r = formatearComposicionHabitacionBernalo({ habitacionId: "doble-0", adultos: 2, ninos: 0, infantes: 0 }, 2);
    assert.equal(r, "2 adt");
  });

  test("sin composición (ítem legacy) → cae al conteo de adultos plano, comportamiento de SIEMPRE", () => {
    const r = formatearComposicionHabitacionBernalo(undefined, 2);
    assert.equal(r, "2 adt");
  });
});

describe("resumenHabitacionesBernalo — varias habitaciones, emparejamiento por habitacionId", () => {
  test("una habitación con composición → 'Doble (2 adt + 1 chd)'", () => {
    const r = resumenHabitacionesBernalo(
      [{ id: "doble-0", acom: "doble", adultos: 2 }],
      [{ habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 0 }]
    );
    assert.equal(r, "Doble (2 adt + 1 chd)");
  });

  test("dos habitaciones, cada una con su propia composición — el emparejamiento es por id, nunca posicional", () => {
    const r = resumenHabitacionesBernalo(
      [{ id: "doble-0", acom: "doble", adultos: 2 }, { id: "doble-1", acom: "doble", adultos: 2 }],
      [
        { habitacionId: "doble-1", adultos: 2, ninos: 0, infantes: 1 }, // orden invertido a propósito
        { habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 0 },
      ]
    );
    assert.equal(r, "Doble (2 adt + 1 chd) · Doble (2 adt + 1 inf)");
  });

  test("ítem LEGACY sin composicionHabitaciones (undefined) no rompe — renderiza '(N adt)' para todas las habitaciones", () => {
    const r = resumenHabitacionesBernalo([{ id: "doble-0", acom: "doble", adultos: 2 }, { id: "triple-0", acom: "triple", adultos: 3 }], undefined);
    assert.equal(r, "Doble (2 adt) · Triple (3 adt)");
  });

  test("composicionHabitaciones presente pero SIN entrada para una habitación puntual → esa habitación cae a su propio fallback, no rompe ni usa la de otra", () => {
    const r = resumenHabitacionesBernalo(
      [{ id: "doble-0", acom: "doble", adultos: 2 }, { id: "triple-0", acom: "triple", adultos: 3 }],
      [{ habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 0 }] // solo trae la primera
    );
    assert.equal(r, "Doble (2 adt + 1 chd) · Triple (3 adt)");
  });

  test("acomodación desconocida usa su propio texto como label (no lanza)", () => {
    const r = resumenHabitacionesBernalo([{ id: "x-0", acom: "inexistente", adultos: 1 }], []);
    assert.equal(r, "inexistente (1 adt)");
  });

  test("sin habitaciones → cadena vacía", () => {
    assert.equal(resumenHabitacionesBernalo([], []), "");
  });
});
