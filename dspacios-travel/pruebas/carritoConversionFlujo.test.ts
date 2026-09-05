// ─────────────────────────────────────────────────────────────────────────
// Simulación de EJECUCIÓN REAL del pipeline completo de
// `convertirCotizacionCarrito` (app/(dashboard)/dashboard/reservar/
// actions.ts) para los escenarios obligatorios de la ronda 5 (B12/B13/B14)
// que involucran VARIOS grupos/contratos a la vez — donde una prueba de una
// sola función pura no alcanza a demostrar el comportamiento de punta a
// punta. Compone EXACTAMENTE las mismas funciones puras, en el MISMO orden,
// que usa el servidor real (ver el bloque `for (const { grupo, validados }
// of gruposValidados)` de esa función):
//   1. agruparIndicesPorDestino  (agrupar ítems en "todo" o "por_destino")
//   2. posicionesUnicasDeGrupo   (universo LOCAL de cada grupo)
//   3. normalizarResponsablesPorGrupo + reindexarGrupoLocal (B13 puntos 1-4)
//   4. consolidarReservasSillasPorBloqueo (B14)
// No sustituye a la prueba SQL contra el RPC real (ver
// supabase/scripts/postcheck_167_contrato_pasajero_responsable.sql,
// sección "R5 — B14") ni a las pruebas de wiring (verifican que
// reservar/actions.ts realmente llama a estas funciones en este orden) —
// cierra el hueco de EJECUCIÓN REAL con datos concretos para los escenarios
// que abarcan más de una función pura o más de un grupo.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  agruparIndicesPorDestino,
  posicionesUnicasDeGrupo,
  reindexarGrupoLocal,
  consolidarReservasSillasPorBloqueo,
} from "../lib/reservar/carritoAsignaciones.ts";
import { normalizarResponsablesPorGrupo } from "../lib/reservar/pasajerosFilas.ts";

type Pax = { nombre: string; fechaNacimiento: string; responsableIndex?: number | null };

const ADULTO = (nombre: string): Pax => ({ nombre, fechaNacimiento: "1990-01-01" });

/**
 * Reproduce el cuerpo del `for` de `convertirCotizacionCarrito` para UN
 * grupo — misma secuencia, mismos nombres de variable clave — y devuelve lo
 * que ese grupo terminaría persistiendo (universo local + reservas de
 * silla consolidadas), sin tocar red/DB.
 */
function simularGrupo(
  pasajerosGlobales: readonly Pax[],
  itemsDelGrupo: readonly { bloqueoId: number; holdersMin: number; posicionesGlobal: number[] }[],
  fechaRefGrupo: string | null
) {
  const posicionesGrupoItems = posicionesUnicasDeGrupo(
    itemsDelGrupo.map((it) => it.posicionesGlobal),
    itemsDelGrupo.map((_, i) => i)
  );
  const universoGrupo = posicionesGrupoItems.length ? posicionesGrupoItems : pasajerosGlobales.map((_, i) => i + 1);
  const pasajerosNormalizadosGlobal = normalizarResponsablesPorGrupo(pasajerosGlobales, fechaRefGrupo);
  const { pasajerosLocal, posicionesInvalidas, mapaGlobalALocal } = reindexarGrupoLocal(pasajerosNormalizadosGlobal, universoGrupo);
  const itemsBloqueoLocal = itemsDelGrupo.map((it) => ({
    bloqueoId: it.bloqueoId,
    holdersMin: it.holdersMin,
    posiciones: it.posicionesGlobal.map((posGlobal) => mapaGlobalALocal.get(posGlobal)! + 1),
  }));
  const reservasSillas = consolidarReservasSillasPorBloqueo(itemsBloqueoLocal);
  return { pasajerosLocal, posicionesInvalidas, reservasSillas, paxTotal: pasajerosLocal.length };
}

describe("B12/B13 #1 — dos ítems pax=2, cuatro viajeros COMPLETAMENTE distintos", () => {
  test("cada ítem se asigna a SU propio par; ningún pasajero queda fuera y ninguno se comparte", () => {
    const pasajeros: Pax[] = [ADULTO("P1"), ADULTO("P2"), ADULTO("P3"), ADULTO("P4")];
    // ítem A -> posiciones [1,2], ítem B -> posiciones [3,4] (universo declarado: 4)
    const r = simularGrupo(
      pasajeros,
      [
        { bloqueoId: 10, holdersMin: 2, posicionesGlobal: [1, 2] },
        { bloqueoId: 20, holdersMin: 2, posicionesGlobal: [3, 4] },
      ],
      "2027-01-01"
    );
    assert.equal(r.paxTotal, 4, "las 4 personas distintas deben quedar en el universo local (nunca 2, el máximo de un solo ítem)");
    assert.deepEqual(r.pasajerosLocal.map((p) => p.nombre), ["P1", "P2", "P3", "P4"]);
    assert.equal(r.reservasSillas.length, 2, "dos bloqueos distintos -> dos reservas, sin consolidar entre sí");
    assert.deepEqual(r.reservasSillas.find((x) => x.bloqueoId === 10)?.posiciones, [1, 2]);
    assert.deepEqual(r.reservasSillas.find((x) => x.bloqueoId === 20)?.posiciones, [3, 4]);
  });
});

describe("B12/B13 #2 — dos ítems pax=2 con SOLAPAMIENTO PARCIAL ([1,2] y [2,3])", () => {
  test("el universo local son 3 personas (no 2, no 4) y la posición compartida no se duplica", () => {
    const pasajeros: Pax[] = [ADULTO("P1"), ADULTO("P2 (compartido)"), ADULTO("P3")];
    const r = simularGrupo(
      pasajeros,
      [
        { bloqueoId: 10, holdersMin: 2, posicionesGlobal: [1, 2] },
        { bloqueoId: 10, holdersMin: 2, posicionesGlobal: [2, 3] }, // mismo bloqueo -> debe consolidar (B14)
      ],
      "2027-01-01"
    );
    assert.equal(r.paxTotal, 3, "P2 no debe contarse dos veces en el universo local del grupo");
    assert.equal(r.reservasSillas.length, 1, "mismo bloqueoId en los dos ítems -> UNA sola reserva consolidada (B14)");
    assert.deepEqual(r.reservasSillas[0].posiciones, [1, 2, 3], "la unión de posiciones locales debe cubrir a las 3 personas, sin duplicar a P2");
    assert.equal(r.reservasSillas[0].holdersMin, 4, "holdersMin se SUMA (2+2) — el núcleo SQL aplica greatest() contra el conteo real si hiciera falta");
  });
});

describe("B13 #3 — 'por_destino': cada contrato recibe SOLO la unión de SUS propios ítems", () => {
  test("un carrito con 2 destinos reparte los pasajeros en 2 grupos disjuntos, cada uno con su propio universo local", () => {
    // 4 ítems repartidos en dos destinos: CTG (índices 0,1) y SMR (índices 2,3).
    const destinos = ["CTG", "CTG", "SMR", "SMR"];
    const grupos = agruparIndicesPorDestino(destinos, "por_destino");
    assert.deepEqual(grupos, [[0, 1], [2, 3]]);

    const pasajeros: Pax[] = [ADULTO("Familia A - P1"), ADULTO("Familia A - P2"), ADULTO("Familia B - P1"), ADULTO("Familia B - P2")];
    const itemsTodos = [
      { bloqueoId: 10, holdersMin: 1, posicionesGlobal: [1] }, // CTG item 0
      { bloqueoId: 11, holdersMin: 1, posicionesGlobal: [2] }, // CTG item 1
      { bloqueoId: 20, holdersMin: 1, posicionesGlobal: [3] }, // SMR item 0
      { bloqueoId: 21, holdersMin: 1, posicionesGlobal: [4] }, // SMR item 1
    ];

    const grupoCtg = simularGrupo(pasajeros, grupos[0].map((i) => itemsTodos[i]), "2027-01-01");
    const grupoSmr = simularGrupo(pasajeros, grupos[1].map((i) => itemsTodos[i]), "2027-03-01");

    assert.deepEqual(grupoCtg.pasajerosLocal.map((p) => p.nombre), ["Familia A - P1", "Familia A - P2"], "el contrato de CTG no debe incluir a la Familia B");
    assert.deepEqual(grupoSmr.pasajerosLocal.map((p) => p.nombre), ["Familia B - P1", "Familia B - P2"], "el contrato de SMR no debe incluir a la Familia A");
    assert.equal(grupoCtg.paxTotal, 2);
    assert.equal(grupoSmr.paxTotal, 2);
  });
});

describe("B13 #10 — ventas.pax (paxTotal) nunca duplica viajeros compartidos entre ítems del MISMO grupo", () => {
  test("3 ítems del mismo grupo, todos con el MISMO viajero único: paxTotal=1, nunca 3", () => {
    const pasajeros: Pax[] = [ADULTO("Único viajero")];
    const r = simularGrupo(
      pasajeros,
      [
        { bloqueoId: 10, holdersMin: 1, posicionesGlobal: [1] },
        { bloqueoId: 20, holdersMin: 1, posicionesGlobal: [1] },
        { bloqueoId: 30, holdersMin: 1, posicionesGlobal: [1] },
      ],
      "2027-01-01"
    );
    assert.equal(r.paxTotal, 1, "sumar el pax de cada ítem (1+1+1=3) sería incorrecto — es la MISMA persona en los 3 ítems");
  });
});

describe("B13 #4/#5 — reindexado de responsable al cambiar de posición local + rechazo si el responsable queda fuera del grupo", () => {
  test("#4 el adulto responsable cambia de posición GLOBAL a LOCAL y el vínculo del infante lo sigue correctamente", () => {
    // Universo global: [Extra (no viaja en este grupo), Adulto, Infante].
    // El grupo solo incluye posiciones 2 y 3 (Adulto e Infante) — el Adulto
    // pasa de índice global 1 (0-based) a índice local 0.
    const pasajeros: Pax[] = [
      { nombre: "Extra (otro grupo)", fechaNacimiento: "1990-01-01" },
      { nombre: "Adulto", fechaNacimiento: "1990-01-01" },
      { nombre: "Infante", fechaNacimiento: "2026-06-01", responsableIndex: 1 }, // apunta al Adulto (índice GLOBAL 1)
    ];
    const r = simularGrupo(pasajeros, [{ bloqueoId: 10, holdersMin: 2, posicionesGlobal: [2, 3] }], "2027-01-01");
    assert.equal(r.posicionesInvalidas.length, 0);
    assert.deepEqual(r.pasajerosLocal.map((p) => p.nombre), ["Adulto", "Infante"]);
    assert.equal(r.pasajerosLocal[1].responsableIndex, 0, "el Infante (ahora índice local 1) debe apuntar al Adulto en su nueva posición LOCAL 0, no en la global 1");
  });

  test("#5 INF asignado a este grupo sin que su responsable también esté en el grupo: rechazo explícito (posicionesInvalidas)", () => {
    const pasajeros: Pax[] = [
      { nombre: "Adulto (viaja en OTRO ítem/grupo)", fechaNacimiento: "1990-01-01" },
      { nombre: "Infante", fechaNacimiento: "2026-06-01", responsableIndex: 0 },
    ];
    // El grupo solo incluye al Infante (posición 2) — su responsable (posición 1) no viaja en este grupo.
    const r = simularGrupo(pasajeros, [{ bloqueoId: 10, holdersMin: 1, posicionesGlobal: [2] }], "2027-01-01");
    assert.deepEqual(r.posicionesInvalidas, [2], "debe señalar la posición GLOBAL del infante cuyo responsable quedó fuera del grupo");
  });
});

describe("B14 #9 — dos bloqueos DISTINTOS con un pasajero compartido: válido, nunca se fusionan entre sí", () => {
  test("la misma persona reserva una silla en CADA bloqueo por separado (2 reservas, no 1 consolidada)", () => {
    const pasajeros: Pax[] = [ADULTO("Viajero en ambos vuelos")];
    const r = simularGrupo(
      pasajeros,
      [
        { bloqueoId: 10, holdersMin: 1, posicionesGlobal: [1] },
        { bloqueoId: 20, holdersMin: 1, posicionesGlobal: [1] },
      ],
      "2027-01-01"
    );
    assert.equal(r.reservasSillas.length, 2, "bloqueos distintos nunca se consolidan entre sí, aunque compartan pasajero");
    assert.deepEqual(r.reservasSillas.find((x) => x.bloqueoId === 10)?.posiciones, [1]);
    assert.deepEqual(r.reservasSillas.find((x) => x.bloqueoId === 20)?.posiciones, [1]);
  });
});
