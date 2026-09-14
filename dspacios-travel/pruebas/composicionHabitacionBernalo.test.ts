import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { construirComposicionHabitacionesPublica } from "../lib/reservar/composicionHabitacionBernalo.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) de la composición pública (adultos/niños/
// infantes) construida desde el resultado AUTORITATIVO de
// `computarReservaBernalo` — ver la cabecera de
// `lib/reservar/composicionHabitacionBernalo.ts`.
// ─────────────────────────────────────────────────────────────────────────

describe("construirComposicionHabitacionesPublica — clasificación autoritativa", () => {
  test("2 adultos + 1 menor clasificado 'nino' → adultos:2, ninos:1, infantes:0", () => {
    const r = construirComposicionHabitacionesPublica([
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "nino" }] } },
    ]);
    assert.deepEqual(r, [{ habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 0 }]);
  });

  test("2 adultos + 1 menor clasificado 'infante' → adultos:2, ninos:0, infantes:1", () => {
    const r = construirComposicionHabitacionesPublica([
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "infante" }] } },
    ]);
    assert.deepEqual(r, [{ habitacionId: "doble-0", adultos: 2, ninos: 0, infantes: 1 }]);
  });

  test("un menor clasificado 'adulto' (regla Bernalo 11+: paga tarifa normal) se SUMA a adultos, nunca aparece como niño/infante", () => {
    const r = construirComposicionHabitacionesPublica([
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "adulto" }] } },
    ]);
    assert.deepEqual(r, [{ habitacionId: "doble-0", adultos: 3, ninos: 0, infantes: 0 }]);
  });

  test("dos niños en la misma habitación → conteo correcto (nunca colapsado a 1)", () => {
    const r = construirComposicionHabitacionesPublica([
      {
        habitacionId: "doble-0", ocupacion: { adultos: 2 },
        resultado: { menoresClasificados: [{ categoriaTarifaria: "nino" }, { categoriaTarifaria: "nino" }] },
      },
    ]);
    assert.deepEqual(r, [{ habitacionId: "doble-0", adultos: 2, ninos: 2, infantes: 0 }]);
  });

  test("mezcla de nino + infante + adulto en la misma habitación se clasifica cada uno por separado", () => {
    const r = construirComposicionHabitacionesPublica([
      {
        habitacionId: "doble-0", ocupacion: { adultos: 1 },
        resultado: { menoresClasificados: [{ categoriaTarifaria: "nino" }, { categoriaTarifaria: "infante" }, { categoriaTarifaria: "adulto" }] },
      },
    ]);
    assert.deepEqual(r, [{ habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 1 }]);
  });

  test("varias habitaciones: la composición es POR HABITACIÓN, nunca un agregado del hotel", () => {
    const r = construirComposicionHabitacionesPublica([
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "nino" }] } },
      { habitacionId: "doble-1", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "infante" }] } },
    ]);
    assert.deepEqual(r, [
      { habitacionId: "doble-0", adultos: 2, ninos: 1, infantes: 0 },
      { habitacionId: "doble-1", adultos: 2, ninos: 0, infantes: 1 },
    ]);
  });

  test("sin menores → ninos:0, infantes:0, adultos = los declarados", () => {
    const r = construirComposicionHabitacionesPublica([
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [] } },
    ]);
    assert.deepEqual(r, [{ habitacionId: "doble-0", adultos: 2, ninos: 0, infantes: 0 }]);
  });

  test("entrada vacía → salida vacía, nunca lanza", () => {
    assert.deepEqual(construirComposicionHabitacionesPublica([]), []);
  });

  test("solo expone habitacionId/adultos/ninos/infantes — ningún campo adicional (netos/comisión/proveedor/snapshot nunca cruzan esta frontera)", () => {
    const r = construirComposicionHabitacionesPublica([
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "nino" }] } },
    ]);
    assert.deepEqual(Object.keys(r[0]).sort(), ["adultos", "habitacionId", "infantes", "ninos"]);
  });

  test("no muta la entrada recibida", () => {
    const habitaciones = [
      { habitacionId: "doble-0", ocupacion: { adultos: 2 }, resultado: { menoresClasificados: [{ categoriaTarifaria: "nino" as const }] } },
    ];
    const copia = JSON.parse(JSON.stringify(habitaciones));
    construirComposicionHabitacionesPublica(habitaciones);
    assert.deepEqual(habitaciones, copia);
  });
});
