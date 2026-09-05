// ─────────────────────────────────────────────────────────────────────────
// lib/reservar/carritoAsignaciones.ts — operaciones puras del checkout de
// carrito multi-ítem (revisión de alto riesgo, ronda 5 — B12/B13/B14).
// Pruebas de EJECUCIÓN REAL con datos concretos, cubriendo los 12
// escenarios obligatorios en la parte que corresponde a funciones puras.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  agruparIndicesPorDestino,
  posicionesUnicasDeGrupo,
  posicionesAsignadasEnAlgunItem,
  posicionesSinAsignar,
  reindexarGrupoLocal,
  consolidarReservasSillasPorBloqueo,
  fechaContratoDePasajero,
  comparteGrupo,
  agregarPosicionAUniverso,
  quitarPosicionDeUniverso,
} from "../lib/reservar/carritoAsignaciones.ts";

describe("agruparIndicesPorDestino", () => {
  test("modo 'todo': un solo grupo con TODOS los índices, sin importar destino", () => {
    const r = agruparIndicesPorDestino(["CTG", "SMR", "CTG"], "todo");
    assert.deepEqual(r, [[0, 1, 2]]);
  });

  test("un solo ítem: siempre un solo grupo, aunque el modo sea por_destino", () => {
    const r = agruparIndicesPorDestino(["CTG"], "por_destino");
    assert.deepEqual(r, [[0]]);
  });

  test("por_destino: agrupa por destino preservando el orden de primera aparición", () => {
    const r = agruparIndicesPorDestino(["CTG", "SMR", "CTG", "SMR"], "por_destino");
    assert.deepEqual(r, [[0, 2], [1, 3]]);
  });

  test("por_destino: null se agrupa como su propio destino ('—'), no se descarta", () => {
    const r = agruparIndicesPorDestino(["CTG", null, null], "por_destino");
    assert.deepEqual(r, [[0], [1, 2]]);
  });
});

describe("posicionesUnicasDeGrupo / posicionesAsignadasEnAlgunItem / posicionesSinAsignar — B12/B13 #1 #2 #6", () => {
  test("#1 dos ítems pax=2, cuatro viajeros COMPLETAMENTE distintos: unión = las 4 posiciones", () => {
    const asignaciones = [[1, 2], [3, 4]];
    assert.deepEqual(posicionesUnicasDeGrupo(asignaciones, [0, 1]), [1, 2, 3, 4]);
  });

  test("#2 dos ítems pax=2 con solapamiento parcial [1,2] y [2,3]: unión = [1,2,3] (nunca duplica la posición 2)", () => {
    const asignaciones = [[1, 2], [2, 3]];
    assert.deepEqual(posicionesUnicasDeGrupo(asignaciones, [0, 1]), [1, 2, 3]);
  });

  test("posicionesUnicasDeGrupo solo considera los ítems del grupo indicado, no todos", () => {
    const asignaciones = [[1, 2], [3, 4], [5]];
    assert.deepEqual(posicionesUnicasDeGrupo(asignaciones, [0]), [1, 2]);
    assert.deepEqual(posicionesUnicasDeGrupo(asignaciones, [2]), [5]);
  });

  test("#6 pasajero no asignado a NINGÚN ítem: se detecta como sobrante", () => {
    // Universo de 4 pasajeros, pero la posición 4 no aparece en ningún ítem.
    const asignaciones = [[1, 2], [2, 3]];
    assert.deepEqual(posicionesSinAsignar(asignaciones, 4), [4]);
    assert.deepEqual([...posicionesAsignadasEnAlgunItem(asignaciones)].sort(), [1, 2, 3]);
  });

  test("sin sobrantes cuando todo el universo declarado está cubierto", () => {
    const asignaciones = [[1, 2], [3, 4]];
    assert.deepEqual(posicionesSinAsignar(asignaciones, 4), []);
  });
});

describe("reindexarGrupoLocal — B13 #4 #5 (reindexado local y responsable fuera del contrato)", () => {
  type Fila = { nombre: string; responsableIndex?: number | null };

  test("#4 reindexa responsableIndex a LOCAL cuando el adulto cambia de posición (universo global != local)", () => {
    // Universo global: [Niño(no viaja), Adulto, Infante] — el grupo NO incluye
    // la posición 1 (niño ajeno), así que en el contrato local el Adulto pasa
    // de índice global 1 (posición 2) a índice LOCAL 0.
    const globales: Fila[] = [
      { nombre: "Niño ajeno" },
      { nombre: "Adulto" },
      { nombre: "Infante", responsableIndex: 1 }, // apunta al Adulto por índice GLOBAL (0-based) = 1
    ];
    const posicionesGrupo = [2, 3]; // Adulto (pos 2) e Infante (pos 3) — el niño ajeno (pos 1) no está en este grupo
    const { pasajerosLocal, posicionesInvalidas } = reindexarGrupoLocal(globales, posicionesGrupo);
    assert.deepEqual(posicionesInvalidas, []);
    assert.equal(pasajerosLocal.length, 2);
    assert.equal(pasajerosLocal[0].nombre, "Adulto");
    assert.equal(pasajerosLocal[1].nombre, "Infante");
    // El Infante queda en el índice LOCAL 1; su responsable (Adulto) debe
    // apuntar al índice LOCAL 0 — nunca al índice global 1, que ya no
    // corresponde a la misma persona en el arreglo local.
    assert.equal(pasajerosLocal[1].responsableIndex, 0, "no reindexó responsableIndex a la posición LOCAL correcta");
  });

  test("#5 INF cuyo responsable NO pertenece al mismo grupo/contrato: reportado como posición inválida", () => {
    const globales: Fila[] = [
      { nombre: "Adulto en OTRO contrato" },
      { nombre: "Infante", responsableIndex: 0 }, // responsable = posición global 1 (índice 0)
    ];
    // El grupo de este contrato SOLO incluye al Infante (posición 2) — su
    // responsable (posición 1) terminó en un contrato distinto.
    const posicionesGrupo = [2];
    const { pasajerosLocal, posicionesInvalidas } = reindexarGrupoLocal(globales, posicionesGrupo);
    assert.deepEqual(posicionesInvalidas, [2], "no detecta que el responsable del infante en la posición 2 no está en este grupo");
    assert.equal(pasajerosLocal[0].responsableIndex, null, "nunca debe dejar un responsableIndex apuntando fuera del arreglo local");
  });

  test("un vínculo válido dentro del mismo grupo se conserva reindexado, nunca se pierde", () => {
    const globales: Fila[] = [
      { nombre: "Adulto" },
      { nombre: "Infante", responsableIndex: 0 },
    ];
    const { pasajerosLocal, posicionesInvalidas } = reindexarGrupoLocal(globales, [1, 2]);
    assert.deepEqual(posicionesInvalidas, []);
    assert.equal(pasajerosLocal[1].responsableIndex, 0);
  });

  test("mapaGlobalALocal expone la correspondencia posición global (1-based) -> índice local (0-based)", () => {
    const globales: Fila[] = [{ nombre: "A" }, { nombre: "B" }, { nombre: "C" }];
    const { mapaGlobalALocal } = reindexarGrupoLocal(globales, [2, 3]);
    assert.equal(mapaGlobalALocal.get(2), 0);
    assert.equal(mapaGlobalALocal.get(3), 1);
    assert.equal(mapaGlobalALocal.get(1), undefined, "la posición 1 no pertenece a este grupo");
  });

  test("un pasajero sin responsable (null) nunca se le inventa uno al reindexar", () => {
    const globales: Fila[] = [{ nombre: "Adulto" }, { nombre: "Infante", responsableIndex: null }];
    const { pasajerosLocal, posicionesInvalidas } = reindexarGrupoLocal(globales, [1, 2]);
    assert.equal(pasajerosLocal[1].responsableIndex, null);
    assert.deepEqual(posicionesInvalidas, []);
  });
});

describe("consolidarReservasSillasPorBloqueo — B14 + B15 (piso = personas únicas con silla, nunca la suma)", () => {
  test("B15 #1 dos ítems con el MISMO bloqueo y los MISMOS pasajeros con silla: piso = 2 (no 4, que era la suma)", () => {
    const r = consolidarReservasSillasPorBloqueo([
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1, 2] },
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1, 2] },
    ]);
    assert.equal(r.length, 1, "debe consolidarse en UNA sola entrada (el RPC rechaza bloqueoId repetido)");
    assert.equal(r[0].bloqueoId, 10);
    assert.deepEqual(r[0].posiciones, [1, 2], "nunca duplica una posición aunque aparezca en los dos ítems");
    assert.equal(r[0].holdersMin, 2, "piso = |unión de posicionesConSilla| = 2 personas, NUNCA la suma (4) que sobre-reservaba");
  });

  test("B15 #2 solapamiento parcial [1,2]+[2,3] con silla: piso = 3 (la posición compartida no se duplica)", () => {
    const r = consolidarReservasSillasPorBloqueo([
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1, 2] },
      { bloqueoId: 10, posiciones: [2, 3], posicionesConSilla: [2, 3] },
    ]);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].posiciones, [1, 2, 3], "la posición 2 (compartida) no debe duplicarse en la unión");
    assert.equal(r[0].holdersMin, 3, "|{1,2,3}| = 3");
  });

  test("B15 #3 grupos DISJUNTOS [1,2]+[3,4] con silla: piso = 4 (el máximo sub-reservaría a 2)", () => {
    const r = consolidarReservasSillasPorBloqueo([
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1, 2] },
      { bloqueoId: 10, posiciones: [3, 4], posicionesConSilla: [3, 4] },
    ]);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].posiciones, [1, 2, 3, 4]);
    assert.equal(r[0].holdersMin, 4, "|{1,2,3,4}| = 4 — ni el máximo (2) ni algún otro atajo que sub-reserve");
  });

  test("B15 #4 un INF no va en posicionesConSilla: no cuenta para el piso, pero sí aparece en posiciones", () => {
    // posición 2 = infante (no ocupa silla) en los dos ítems del mismo bloqueo.
    const r = consolidarReservasSillasPorBloqueo([
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1] },
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1] },
    ]);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].posiciones, [1, 2], "el infante sigue en posiciones (el RPC recalcula él mismo su es_infante)");
    assert.equal(r[0].holdersMin, 1, "solo el adulto ocupa silla → piso = 1");
  });

  test("#9 dos bloqueos DISTINTOS con pasajeros compartidos: cada uno conserva su propia entrada (nunca se fusionan)", () => {
    const r = consolidarReservasSillasPorBloqueo([
      { bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1, 2] },
      { bloqueoId: 20, posiciones: [1, 2], posicionesConSilla: [1, 2] }, // misma gente, bloqueo DISTINTO — válido
    ]);
    assert.equal(r.length, 2, "bloqueos distintos nunca deben consolidarse entre sí");
    const porId = new Map(r.map((x) => [x.bloqueoId, x]));
    assert.deepEqual(porId.get(10)?.posiciones, [1, 2]);
    assert.deepEqual(porId.get(20)?.posiciones, [1, 2]);
    assert.equal(porId.get(10)?.holdersMin, 2);
    assert.equal(porId.get(20)?.holdersMin, 2);
  });

  test("una sola entrada por bloqueo se conserva tal cual (caso normal, sin repetición)", () => {
    const r = consolidarReservasSillasPorBloqueo([{ bloqueoId: 10, posiciones: [1, 2], posicionesConSilla: [1, 2] }]);
    assert.deepEqual(r, [{ bloqueoId: 10, holdersMin: 2, posiciones: [1, 2] }]);
  });

  test("arreglo vacío (grupo sin ítems tipo bloqueo) no revienta y devuelve vacío", () => {
    assert.deepEqual(consolidarReservasSillasPorBloqueo([]), []);
  });
});

describe("fechaContratoDePasajero — B16 (fecha del CONTRATO, no del ítem del pasajero)", () => {
  // Grupo (modo "todo") con dos unidades: A en enero, B en diciembre.
  const grupoTodo = [[0, 1]];
  const asigTodo = [[1], [2]]; // pax1 -> unidad A ; pax2 -> SOLO unidad B
  const fechas = ["2027-01-01", "2027-12-01"];

  test("un pasajero SOLO en la unidad tardía usa la fecha del CONTRATO (la más temprana del grupo), no la de su unidad", () => {
    // El servidor pone ventas.fecha_salida = min(enero, diciembre) = enero para
    // TODO el contrato, y clasifica a pax2 contra enero. La UI debe coincidir.
    assert.equal(fechaContratoDePasajero(2, grupoTodo, asigTodo, fechas, null), "2027-01-01");
    assert.equal(fechaContratoDePasajero(1, grupoTodo, asigTodo, fechas, null), "2027-01-01");
  });

  test("por_destino: cada pasajero usa la fecha de SU contrato (destino), la más temprana de las unidades de ese destino", () => {
    // Unidad 0 y 1 = destino A (enero, marzo) ; unidad 2 = destino B (diciembre).
    const grupos = [[0, 1], [2]];
    const asig = [[1], [2], [3]]; // pax1->A(ene), pax2->A(mar), pax3->B(dic)
    const fechasPd = ["2027-01-01", "2027-03-01", "2027-12-01"];
    // pax2 solo viaja en la unidad de marzo, pero su contrato (destino A) sale
    // en enero → se clasifica contra enero, igual que el servidor.
    assert.equal(fechaContratoDePasajero(2, grupos, asig, fechasPd, null), "2027-01-01");
    assert.equal(fechaContratoDePasajero(1, grupos, asig, fechasPd, null), "2027-01-01");
    assert.equal(fechaContratoDePasajero(3, grupos, asig, fechasPd, null), "2027-12-01");
  });

  test("un pasajero en DOS contratos usa la fecha MÁS TEMPRANA de ellos (conservadora: captura responsable si algún contrato lo exige)", () => {
    const grupos = [[0], [1]]; // dos destinos/contratos
    const asig = [[1], [1]]; // pax1 viaja en AMBOS contratos
    const fechasDos = ["2027-12-01", "2027-01-01"];
    assert.equal(fechaContratoDePasajero(1, grupos, asig, fechasDos, null), "2027-01-01");
  });

  test("sin ninguna asignación todavía cae al fallback (no rompe la UI a mitad de edición)", () => {
    assert.equal(fechaContratoDePasajero(1, [[0, 1]], [[2], [3]], ["2026-01-01", "2026-02-01"], "2025-01-01"), "2025-01-01");
  });
});

describe("comparteGrupo — filtra candidatos a responsable por CONTRATO real (B13 punto 5)", () => {
  test("dos pasajeros en el mismo destino (mismo grupo en modo por_destino) comparten grupo", () => {
    const gruposIndices = [[0], [1]]; // ítem 0 = destino A, ítem 1 = destino B
    const asignaciones = [[1, 2], [3]]; // destino A: pax 1,2 · destino B: pax 3
    assert.equal(comparteGrupo(1, 2, gruposIndices, asignaciones), true);
    assert.equal(comparteGrupo(1, 3, gruposIndices, asignaciones), false, "pax 1 y 3 terminan en contratos distintos");
  });

  test("en modo 'todo' (un solo grupo) cualquier par de pasajeros asignados comparte grupo", () => {
    const gruposIndices = [[0, 1]];
    const asignaciones = [[1, 2], [3]];
    assert.equal(comparteGrupo(1, 3, gruposIndices, asignaciones), true);
  });
});

describe("agregarPosicionAUniverso — B12: universo editable, agregar", () => {
  test("agrega la fila al final y `false` a cada ítem (nadie viaja por defecto en la nueva fila)", () => {
    const filas = [{ nombre: "A" }, { nombre: "B" }];
    const asign = [[true, false], [false, true]];
    const r = agregarPosicionAUniverso(filas, asign, { nombre: "C" });
    assert.deepEqual(r.filas, [{ nombre: "A" }, { nombre: "B" }, { nombre: "C" }]);
    assert.deepEqual(r.asignacionesPorItem, [[true, false, false], [false, true, false]]);
  });

  test("universo vacío: agregar la primera fila deja cada ítem con una sola columna en false", () => {
    const r = agregarPosicionAUniverso<{ nombre: string }>([], [[], []], { nombre: "A" });
    assert.deepEqual(r.filas, [{ nombre: "A" }]);
    assert.deepEqual(r.asignacionesPorItem, [[false], [false]]);
  });
});

describe("quitarPosicionDeUniverso — B12: universo editable, quitar", () => {
  type FilaN = { n: string; responsableIndex?: number | null };

  test("quita la fila y la columna correspondiente de cada ítem", () => {
    const filas: FilaN[] = [{ n: "A" }, { n: "B" }, { n: "C" }];
    const asign = [[true, true, false], [false, true, true]];
    const r = quitarPosicionDeUniverso(filas, asign, 1); // quita B (índice 1)
    assert.deepEqual(r.filas, [{ n: "A" }, { n: "C" }]);
    assert.deepEqual(r.asignacionesPorItem, [[true, false], [false, true]]);
  });

  test("un responsableIndex que apuntaba a la fila quitada queda null (nunca se reasigna a otra persona)", () => {
    const filas: FilaN[] = [{ n: "A", responsableIndex: 1 }, { n: "B (adulto)", responsableIndex: null }, { n: "C" }];
    const r = quitarPosicionDeUniverso(filas, [[true, true, true]], 1);
    assert.deepEqual(r.filas, [{ n: "A", responsableIndex: null }, { n: "C" }]);
  });

  test("un responsableIndex posterior a la fila quitada se decrementa 1 (sigue señalando a la misma persona)", () => {
    const filas: FilaN[] = [{ n: "INF", responsableIndex: 2 }, { n: "B" }, { n: "ADT (responsable)" }];
    const r = quitarPosicionDeUniverso(filas, [[true, true, true]], 1); // quita B (índice 1)
    assert.deepEqual(r.filas, [{ n: "INF", responsableIndex: 1 }, { n: "ADT (responsable)" }]);
  });

  test("un responsableIndex anterior a la fila quitada queda intacto", () => {
    const filas: FilaN[] = [{ n: "ADT (responsable)" }, { n: "B" }, { n: "INF", responsableIndex: 0 }];
    const r = quitarPosicionDeUniverso(filas, [[true, true, true]], 1); // quita B (índice 1)
    assert.deepEqual(r.filas, [{ n: "ADT (responsable)" }, { n: "INF", responsableIndex: 0 }]);
  });
});
