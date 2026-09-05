// ─────────────────────────────────────────────────────────────────────────
// lib/reservar/pasajerosFilas.ts — operaciones puras compartidas sobre
// arreglos de pasajeros con vínculo de responsable (revisión de alto riesgo,
// ronda 3 — B7/B8). Pruebas de EJECUCIÓN REAL (no inspección de texto):
// demuestran con datos concretos que quitar/truncar/recalcular nunca deja un
// `responsableIndex` apuntando a la fila equivocada, a nadie que ya no
// exista, o a alguien que el servidor (trigger de la migración 167)
// rechazaría.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quitarPasajero, truncarPasajeros, recalcularVinculosPorEdad, normalizarResponsablesPorGrupo } from "../lib/reservar/pasajerosFilas.ts";

type Fila = { nombre: string; fechaNacimiento: string; responsableIndex?: number | null };

const F_ADULTO = "1990-01-01";
const F_INFANTE = "2025-06-01"; // <2 años a 2026-01-01
const F_NINO = "2018-01-01"; // CHD: no infante, pero menor de edad
const HOY = "2026-01-01";

describe("quitarPasajero — B7 #1 y #2 (reindexar / limpiar vínculo del responsable quitado)", () => {
  test("#1 quitar una fila ANTERIOR al responsable reindexa correctamente (nunca deja apuntando a la persona equivocada)", () => {
    // [0]=Niño, [1]=Adulto, [2]=Infante->responsable en 1
    const filas: Fila[] = [
      { nombre: "Niño", fechaNacimiento: F_NINO },
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 1 },
    ];
    const resultado = quitarPasajero(filas, 0); // quita "Niño" (posición 0, ANTES del responsable)
    assert.equal(resultado.length, 2);
    assert.equal(resultado[0].nombre, "Adulto");
    assert.equal(resultado[1].nombre, "Infante");
    // El responsable estaba en la posición 1; tras quitar la posición 0, debe
    // decrementarse a 0 — sigue apuntando al MISMO Adulto, no a otra persona.
    assert.equal(resultado[1].responsableIndex, 0);
    assert.equal(resultado[0], filas[1], "la fila del adulto no debería recrearse si no cambió");
  });

  test("#2 quitar AL RESPONSABLE limpia el vínculo (nunca reasigna silenciosamente a otra persona)", () => {
    const filas: Fila[] = [
      { nombre: "Adulto A", fechaNacimiento: F_ADULTO },
      { nombre: "Adulto B", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
    ];
    const resultado = quitarPasajero(filas, 0); // quita al responsable (Adulto A)
    assert.equal(resultado.length, 2);
    assert.equal(resultado[0].nombre, "Adulto B");
    assert.equal(resultado[1].nombre, "Infante");
    // NUNCA debe quedar apuntando a "Adulto B" (que ahora ocupa la posición 0)
    // solo porque el índice coincide — el vínculo se pierde explícitamente.
    assert.equal(resultado[1].responsableIndex, null, "se reasignó silenciosamente al que quedó en esa posición");
  });

  test("quitar una fila POSTERIOR al responsable no toca el vínculo", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
      { nombre: "Niño", fechaNacimiento: F_NINO },
    ];
    const resultado = quitarPasajero(filas, 2); // quita "Niño" (posterior)
    assert.equal(resultado.length, 2);
    assert.equal(resultado[1].responsableIndex, 0, "un vínculo hacia una posición ANTERIOR no debe cambiar al quitar algo después");
  });

  test("quitar una fila sin ningún vínculo relacionado deja las demás intactas", () => {
    const filas: Fila[] = [
      { nombre: "A", fechaNacimiento: F_ADULTO },
      { nombre: "B", fechaNacimiento: F_ADULTO },
    ];
    const resultado = quitarPasajero(filas, 1);
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0], filas[0]);
  });
});

describe("truncarPasajeros — B7 #3 (nunca reasigna silenciosamente al recortar)", () => {
  test("#3 truncar pasajeros nunca reasigna silenciosamente a otra persona: limpia el vínculo de la fila recortada", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 2 }, // apunta a la posición 2 (será recortada)
      { nombre: "Otro Adulto", fechaNacimiento: F_ADULTO },
    ];
    const resultado = truncarPasajeros(filas, 2); // se queda con posiciones 0 y 1
    assert.equal(resultado.length, 2);
    assert.equal(resultado[1].responsableIndex, null, "quedó apuntando a una fila recortada — nunca debe reasignarse en silencio");
  });

  test("truncar conserva un vínculo que sigue dentro del rango, SIN reindexar (a diferencia de quitarPasajero)", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
      { nombre: "Sobra", fechaNacimiento: F_ADULTO },
    ];
    const resultado = truncarPasajeros(filas, 2);
    assert.equal(resultado.length, 2);
    assert.equal(resultado[1].responsableIndex, 0, "un vínculo que sigue dentro del rango recortado debe conservarse tal cual");
    assert.equal(resultado[0], filas[0]);
  });

  test("truncar a 0 limpia todos los vínculos y no revienta con arreglo vacío", () => {
    const filas: Fila[] = [{ nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 }];
    const resultado = truncarPasajeros(filas, 0);
    assert.deepEqual(resultado, []);
  });
});

describe("recalcularVinculosPorEdad — B8 #4 y #5 (transiciones de categoría/edad)", () => {
  test("#4 INF→adulto (fecha de nacimiento corregida) limpia responsableIndex — el pasajero ya no debe pedir/tener responsable", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Ya no es infante", fechaNacimiento: "1995-01-01", responsableIndex: 0 }, // corregido: en realidad es adulto
    ];
    const resultado = recalcularVinculosPorEdad(filas, HOY);
    assert.equal(resultado[1].responsableIndex, null, "un pasajero que dejó de ser infante no debe conservar un responsableIndex");
    assert.equal(resultado[0], filas[0], "la fila no afectada no debería recrearse");
  });

  test("#5 responsable adulto→menor (fecha de nacimiento corregida) invalida el vínculo del infante que lo señalaba", () => {
    const filas: Fila[] = [
      { nombre: "Resultó ser un niño", fechaNacimiento: F_NINO }, // corregido: en realidad es menor de edad
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
    ];
    const resultado = recalcularVinculosPorEdad(filas, HOY);
    assert.equal(resultado[1].responsableIndex, null, "el vínculo debe invalidarse cuando el responsable deja de ser mayor de edad");
  });

  test("un vínculo VÁLIDO (sigue infante, responsable sigue adulto) se conserva exactamente igual (misma referencia)", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
    ];
    const resultado = recalcularVinculosPorEdad(filas, HOY);
    assert.equal(resultado[1].responsableIndex, 0);
    assert.equal(resultado[1], filas[1], "un vínculo que sigue siendo válido no debe generar un objeto nuevo");
  });

  test("cambiar la fecha de REFERENCIA (fecha de salida) también recalcula: un viaje muy futuro puede volver adulto a quien hoy es infante", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante hoy, adulto en el viaje", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
    ];
    // Viaje muy lejano: para esa fecha, "F_INFANTE" ya tiene más de 2 años.
    const resultado = recalcularVinculosPorEdad(filas, "2029-01-01");
    assert.equal(resultado[1].responsableIndex, null, "un cambio en la fecha de referencia debe recalcular la categoría, no solo la fecha de nacimiento");
  });

  test("un infante sin responsable (null) permanece sin responsable — nunca se le inventa uno", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: null },
    ];
    const resultado = recalcularVinculosPorEdad(filas, HOY);
    assert.equal(resultado[1].responsableIndex, null);
  });

  test("responsableIndex apuntando a una posición que ya no existe (arreglo más corto) se invalida sin lanzar", () => {
    const filas: Fila[] = [{ nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 5 }];
    const resultado = recalcularVinculosPorEdad(filas, HOY);
    assert.equal(resultado[0].responsableIndex, null);
  });

  test("auto-referencia (responsableIndex === la propia posición) se invalida", () => {
    const filas: Fila[] = [{ nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 }];
    const resultado = recalcularVinculosPorEdad(filas, HOY);
    assert.equal(resultado[0].responsableIndex, null);
  });
});

describe("normalizarResponsablesPorGrupo — B10 (ronda 3): discrepancia temporal entre la UI (fecha conservadora) y la fecha REAL de cada grupo/contrato", () => {
  // Cumple 2 años exactamente el 2026-04-01 (nace 2024-03-01, referencia
  // 2026-01-01 -> 1 año, infante; referencia 2026-06-01 -> 2 años, CHD).
  const F_CRUZA_INFANTE_A_NINO = "2024-03-01";
  const GRUPO_TEMPRANO = "2026-01-01"; // aquí SIGUE siendo infante
  const GRUPO_TARDIO = "2026-06-01"; // aquí YA es niño (CHD), no infante

  test("#1 INF hoy (fecha conservadora) pero CHD a la fecha REAL del viaje: limpia el responsableIndex para ESE grupo", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Bebé que ya no es tan bebé", fechaNacimiento: F_CRUZA_INFANTE_A_NINO, responsableIndex: 0 },
    ];
    // La UI (referencia conservadora, GRUPO_TEMPRANO) lo marcó como infante
    // y capturó el vínculo — correcto para GRUPO_TEMPRANO...
    const paraGrupoTemprano = normalizarResponsablesPorGrupo(filas, GRUPO_TEMPRANO);
    assert.equal(paraGrupoTemprano[1].responsableIndex, 0, "sigue siendo infante en el grupo temprano: el vínculo se conserva");
    // ...pero para un grupo con fecha real MÁS TARDÍA, ya no es infante: el
    // vínculo "sobrante" no debe llegar al RPC de ese grupo.
    const paraGrupoTardio = normalizarResponsablesPorGrupo(filas, GRUPO_TARDIO);
    assert.equal(paraGrupoTardio[1].responsableIndex, null, "ya no es infante en el grupo tardío: el responsable sobrante debe limpiarse");
  });

  test("#3 el mismo pasajero puede ser INF en un grupo y CHD en otro (carrito multi-destino, 'por_destino'): cada grupo se normaliza de forma independiente", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Pasajero frontera", fechaNacimiento: F_CRUZA_INFANTE_A_NINO, responsableIndex: 0 },
    ];
    const grupoA = normalizarResponsablesPorGrupo(filas, GRUPO_TEMPRANO); // destino con fecha temprana
    const grupoB = normalizarResponsablesPorGrupo(filas, GRUPO_TARDIO); // destino con fecha tardía
    assert.equal(grupoA[1].responsableIndex, 0, "grupo con fecha temprana: sigue infante, conserva el vínculo");
    assert.equal(grupoB[1].responsableIndex, null, "grupo con fecha tardía: ya no es infante, el vínculo no debe llegar a este grupo");
    // Ninguna llamada modifica la otra (arreglos independientes, sin estado compartido).
    assert.equal(filas[1].responsableIndex, 0, "la fila original no se muta");
  });

  test("un responsable que SIGUE siendo válido para el grupo (pasajero sigue infante) nunca se limpia por error", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante", fechaNacimiento: F_INFANTE, responsableIndex: 0 },
    ];
    const resultado = normalizarResponsablesPorGrupo(filas, HOY);
    assert.equal(resultado[1].responsableIndex, 0);
    assert.equal(resultado[1], filas[1], "no debe recrear el objeto si el vínculo sigue siendo válido");
  });

  test("un pasajero sin responsable (null) permanece sin responsable — nunca se le inventa uno para ningún grupo", () => {
    const filas: Fila[] = [
      { nombre: "Adulto", fechaNacimiento: F_ADULTO },
      { nombre: "Infante sin vincular todavía", fechaNacimiento: F_INFANTE, responsableIndex: null },
    ];
    const resultado = normalizarResponsablesPorGrupo(filas, GRUPO_TARDIO);
    assert.equal(resultado[1].responsableIndex, null);
  });

  test("filas sin ningún responsableIndex no se tocan (misma referencia de objeto)", () => {
    const filas: Fila[] = [{ nombre: "Adulto", fechaNacimiento: F_ADULTO }];
    const resultado = normalizarResponsablesPorGrupo(filas, GRUPO_TARDIO);
    assert.equal(resultado[0], filas[0]);
  });
});
