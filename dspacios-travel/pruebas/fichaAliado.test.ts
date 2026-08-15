import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolverFichaAliado,
  explicarFicha,
  resolverAliadoIdContrato,
  listarTodosLosCandidatos,
  type CandidatoAliado,
  type FichaAliado,
  type DepsResolverFicha,
  type PaginaCandidatos,
} from "../lib/finanzas/fichaAliado.ts";

// ───────────────────────────────────────────────────────────────────────────
// De qué ficha del catálogo salen los datos BANCARIOS de una cuenta de cobro.
// Elegir mal no es cosmético: es imprimir la cuenta de otra persona en un
// documento de pago.
//
// `resolverFichaAliado` es la orquestación de las DOS consultas (contar sin
// datos bancarios, y solo con una candidata pedir su ficha completa), así que
// estas son pruebas de FLUJO —con dependencias falsas que simulan lo que la
// base de datos devolvería en cada fase—, no solo de una función pura aislada.
// ───────────────────────────────────────────────────────────────────────────

const ficha = (p: Partial<FichaAliado>): FichaAliado => ({
  id: 1,
  nombre: "Ana Gómez",
  tipo_documento: "CC",
  nit: "123",
  direccion: null,
  telefono: null,
  email: null,
  banco: "Bancolombia",
  tipo_cuenta: "ahorros",
  numero_cuenta: "0001",
  ...p,
});

/**
 * Deps falsos que simulan el catálogo. `porId` son las fichas completas
 * (bancarias) indexadas por id — solo se consultan cuando `resolverFichaAliado`
 * decide pedirlas, así que si el flujo pide un id de más, se nota porque la
 * prueba puede contar las llamadas.
 */
function catalogoFalso(candidatos: CandidatoAliado[], porId: Record<number, FichaAliado>) {
  let llamadasListar = 0;
  const llamadasPorId: number[] = [];
  const deps: DepsResolverFicha = {
    listarIdsYNombres: async () => {
      llamadasListar++;
      return candidatos;
    },
    buscarFichaPorId: async (id) => {
      llamadasPorId.push(id);
      return porId[id] ?? null;
    },
  };
  return { deps, llamadasListar: () => llamadasListar, llamadasPorId: () => llamadasPorId };
}

// ── Con id: manda el id, siempre, sin tocar el catálogo por nombre ────────

test("con id, resuelve por id sin listar el catálogo por nombre", async () => {
  const f = ficha({ id: 7 });
  const { deps, llamadasListar } = catalogoFalso([], { 7: f });
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: 7, nombre: "Ana Gómez" });
  assert.equal(r.ficha, f);
  assert.equal(r.motivo, "por_id");
  assert.equal(llamadasListar(), 0, "con id no debe consultar el catálogo por nombre en absoluto");
});

test("con id pero la ficha no existe (borrada/mal enlazada): null, no cae al nombre", async () => {
  const { deps, llamadasListar } = catalogoFalso(
    [{ id: 9, nombre: "Ana Gómez" }],
    {}
  );
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: 7, nombre: "Ana Gómez" });
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "por_id_inexistente");
  assert.equal(llamadasListar(), 0, "un id roto no es excusa para adivinar por texto");
});

test("con id, un homónimo exacto en el catálogo nunca se consulta ni se usa", async () => {
  const f = ficha({ id: 7, nombre: "Ana Gómez" });
  const { deps } = catalogoFalso([{ id: 8, nombre: "Ana Gómez" }], { 7: f, 8: ficha({ id: 8 }) });
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: 7, nombre: "Ana Gómez" });
  assert.equal(r.ficha?.id, 7);
});

// ── EL BUG CENTRAL: un .eq() que "ya encontró una" ocultaba un homónimo ───
// normalizado. Aquí el catálogo falso tiene dos fichas cuyo nombre solo
// difiere en mayúsculas/espacios: "Ana Gómez" y " ANA GÓMEZ ". Cualquier
// resolución que se conforme con la primera coincidencia literal (un
// `.eq("nombre", "Ana Gómez")` puntual) encontraría solo la primera y la
// daría por única. `resolverFichaAliado` SIEMPRE lista el catálogo entero y
// cuenta en memoria, así que las detecta a las dos.

test("EL BUG: dos fichas que solo difieren en mayúsculas/espacios → AMBIGUO, no 'única'", async () => {
  const a = ficha({ id: 3, nombre: "Ana Gómez", numero_cuenta: "cuenta-A" });
  const b = ficha({ id: 4, nombre: " ANA GÓMEZ ", numero_cuenta: "cuenta-B" });
  const { deps, llamadasPorId } = catalogoFalso(
    [
      { id: 3, nombre: a.nombre },
      { id: 4, nombre: b.nombre },
    ],
    { 3: a, 4: b }
  );
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Ana Gómez" });
  assert.equal(r.ficha, null, "con dos candidatas normalizadas iguales no se debe imprimir la cuenta de ninguna");
  assert.equal(r.motivo, "legacy_ambigua");
  assert.deepEqual(r.candidatas?.sort(), [3, 4]);
  assert.deepEqual(llamadasPorId(), [], "ambiguo: NUNCA se piden datos bancarios de ninguna candidata");
});

test("CONTROL NEGATIVO: el atajo viejo (una consulta .eq() que se detiene al encontrar una) sí se equivocaba aquí", () => {
  // Reproduce el bug tal como estaba: `.eq("nombre", aliadoNombre)` es
  // comparación LITERAL — "Ana Gómez" no es igual a " ANA GÓMEZ " para SQL— así
  // que devolvía exactamente una fila y el código viejo la daba por única SIN
  // escanear el resto del catálogo.
  const catalogo = [
    { id: 3, nombre: "Ana Gómez" },
    { id: 4, nombre: " ANA GÓMEZ " },
  ];
  const comparacionLiteralSQL = (nombreBuscado: string) =>
    catalogo.filter((c) => c.nombre === nombreBuscado); // === , no normalizado: así es `.eq()`

  const resultadoViejo = comparacionLiteralSQL("Ana Gómez");
  assert.equal(resultadoViejo.length, 1, "el .eq() puntual SÍ encontraba una sola fila");
  assert.equal(resultadoViejo[0].id, 3, "y la daba por única, sin ver la #4");
  // resolverFichaAliado, con el mismo catálogo, la detecta como ambigua (ver
  // la prueba de arriba) — ahí está la diferencia que corrige el bug.
});

// ── Sin id, una sola coincidencia normalizada: la usa ─────────────────────

test("sin id, una sola coincidencia exacta: pide su ficha y la usa", async () => {
  const f = ficha({ id: 3, nombre: "Ana Gómez" });
  const { deps, llamadasPorId } = catalogoFalso([{ id: 3, nombre: "Ana Gómez" }], { 3: f });
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Ana Gómez" });
  assert.equal(r.ficha, f);
  assert.equal(r.motivo, "legacy_unica");
  assert.deepEqual(llamadasPorId(), [3], "solo pide la ficha bancaria de la única candidata, ninguna más");
});

test("sin id, normaliza mayúsculas y espacios antes de comparar", async () => {
  const f = ficha({ id: 3, nombre: "ana gómez" });
  const { deps } = catalogoFalso([{ id: 3, nombre: "ana gómez" }], { 3: f });
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "  Ana Gómez  " });
  assert.equal(r.ficha, f);
  assert.equal(r.motivo, "legacy_unica");
});

test("sin id y sin ninguna coincidencia: null, y no se pide ninguna ficha", async () => {
  const { deps, llamadasPorId } = catalogoFalso([], {});
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Nadie Conocido" });
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "legacy_sin_coincidencia");
  assert.deepEqual(llamadasPorId(), []);
});

test("sin id y sin nombre: null, no se consulta el catálogo en absoluto", async () => {
  for (const n of [null, "", "   "]) {
    const { deps, llamadasListar } = catalogoFalso([{ id: 1, nombre: "Ana" }], {});
    const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: n });
    assert.equal(r.ficha, null, JSON.stringify(n));
    assert.equal(r.motivo, "sin_nombre");
    assert.equal(llamadasListar(), 0);
  }
});

test("EL FILTRO ES EXACTO, NO POR SUBCADENA: una candidata parcial no cuenta", async () => {
  const { deps } = catalogoFalso([{ id: 5, nombre: "Ana Gómez Torres" }], {});
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Ana Gómez" });
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "legacy_sin_coincidencia");
});

test("la única candidata desaparece entre las dos consultas: motivo específico, no se inventa nada", async () => {
  // Caso límite: pasó el conteo (1 candidata) pero para cuando se pide su
  // ficha completa, ya no está (borrada a mitad de camino). No debe
  // confundirse con "por_id_inexistente" (ese es del camino con id).
  const { deps } = catalogoFalso([{ id: 3, nombre: "Ana Gómez" }], {});
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Ana Gómez" });
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "legacy_desaparecio");
});

// ── Comodines: % y _ se comparan literal, nunca como patrón SQL ───────────

test("un nombre con % o _ se compara LITERAL, no como patrón", async () => {
  const conPorcentaje = ficha({ id: 6, nombre: "AGENCIA 100% VIAJES" });
  const { deps } = catalogoFalso([{ id: 6, nombre: conPorcentaje.nombre }], { 6: conPorcentaje });
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "AGENCIA 100% VIAJES" });
  assert.equal(r.ficha, conPorcentaje);

  const { deps: deps2 } = catalogoFalso([{ id: 99, nombre: "AGENCIA 100X VIAJES" }], {});
  const r2 = await resolverFichaAliado(deps2, { aliadoIdContrato: null, nombre: "AGENCIA 100% VIAJES" });
  assert.equal(r2.ficha, null, "no debe emparejar por patrón, solo por igualdad");
  assert.equal(r2.motivo, "legacy_sin_coincidencia");
});

test("un nombre con guion bajo tampoco actúa como comodín de un carácter", async () => {
  const conGuion = ficha({ id: 10, nombre: "AGENCIA_VIAJES" });
  const { deps } = catalogoFalso([{ id: 10, nombre: conGuion.nombre }, { id: 11, nombre: "AGENCIAXVIAJES" }], {
    10: conGuion,
    11: ficha({ id: 11, nombre: "AGENCIAXVIAJES" }),
  });
  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "AGENCIA_VIAJES" });
  assert.equal(r.ficha, conGuion, "el guion bajo debe emparejar solo con el literal, no con 'AGENCIAXVIAJES'");
});

// ── listarTodosLosCandidatos: paginación por CURSOR (id ascendente) ──────
//
// PostgREST puede limitar la cantidad máxima de filas por respuesta (Settings
// → API → Max rows), y ese límite puede quedar POR DEBAJO del tamaño de
// página que se pida. Una paginación por offset/`.range()` que se diera por
// terminada en la primera página "incompleta" (menos filas de las pedidas) se
// equivocaría justo ahí: pedir 1000 con el servidor topado en, digamos, 2, ya
// da una primera página "incompleta" (2 < 1000) aunque queden miles de filas
// más. Por eso la única señal de fin válida es una página VACÍA — nunca el
// tamaño de la página recibida.

/** Simula un servidor que SIEMPRE topa cada respuesta a `tope` filas, sin
 *  importar cuántas se pidan (`tamanoPaginaPedido` puede ser mucho mayor).
 *  Ordena por id y respeta `id > cursor`, igual que exige el contrato. */
function servidorConTope(catalogo: CandidatoAliado[], tope: number) {
  const ordenado = [...catalogo].sort((a, b) => a.id - b.id);
  const cursoresVistos: (number | null)[] = [];
  const tamanosPedidos: number[] = [];
  const fn = async (cursor: number | null, tamanoPaginaPedido: number): Promise<PaginaCandidatos> => {
    cursoresVistos.push(cursor);
    tamanosPedidos.push(tamanoPaginaPedido);
    const resto = cursor === null ? ordenado : ordenado.filter((c) => c.id > cursor);
    return { datos: resto.slice(0, tope), error: null }; // el servidor manda, no lo pedido
  };
  return { leerPagina: fn, cursoresVistos, tamanosPedidos, llamadas: () => cursoresVistos.length };
}

test("PAGINACIÓN: una sola página vacía basta y se detiene ahí", async () => {
  const s = servidorConTope([], 10);
  const r = await listarTodosLosCandidatos(s, 10);
  assert.deepEqual(r, []);
  assert.equal(s.llamadas(), 1);
});

test("PAGINACIÓN: el SERVIDOR limita cada respuesta muy por debajo de lo pedido, y aun así trae TODO", async () => {
  // Se piden páginas de 1000; el servidor simulado jamás entrega más de 2 por
  // vuelta, sea cual sea el tamaño pedido. Con la paginación vieja (offset,
  // "para en la primera incompleta") esto se habría detenido después de la
  // PRIMERA llamada, con solo 2 de 5 candidatos.
  const catalogo = [
    { id: 1, nombre: "A" }, { id: 2, nombre: "B" }, { id: 3, nombre: "C" },
    { id: 4, nombre: "D" }, { id: 5, nombre: "E" },
  ];
  const s = servidorConTope(catalogo, 2);
  const r = await listarTodosLosCandidatos(s, 1000);
  assert.deepEqual(r.map((c) => c.id).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  // [1,2] → cursor 2 · [3,4] → cursor 4 · [5] (parcial: 1 < 2, pero SIGUE) →
  // cursor 5 · [] → para. Cuatro llamadas, no una sola por "primera incompleta".
  assert.equal(s.llamadas(), 4);
  assert.deepEqual(s.cursoresVistos, [null, 2, 4, 5]);
  assert.deepEqual(s.tamanosPedidos, [1000, 1000, 1000, 1000], "siempre se pide el tamaño configurado, 1000");
});

test("PAGINACIÓN: el CURSOR avanza correctamente, id > último visto en cada vuelta — incluida una página PARCIAL que no debe darse por terminada", async () => {
  const catalogo = [{ id: 5, nombre: "E" }, { id: 1, nombre: "A" }, { id: 3, nombre: "C" }, { id: 2, nombre: "B" }, { id: 4, nombre: "D" }];
  const s = servidorConTope(catalogo, 2); // desordenado a propósito; servidorConTope ordena por id
  const r = await listarTodosLosCandidatos(s, 2);
  assert.deepEqual(r.map((c) => c.id).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  // [1,2] → cursor 2 · [3,4] → cursor 4 · [5] (PARCIAL: 1 fila de 2 pedidas,
  // pero no es la señal de fin — SIGUE) → cursor 5 · [] → recién ahí para.
  assert.deepEqual(s.cursoresVistos, [null, 2, 4, 5]);
});

test("PAGINACIÓN: catálogo vacío devuelve [] sin insistir", async () => {
  const s = servidorConTope([], 10);
  const r = await listarTodosLosCandidatos(s, 10);
  assert.deepEqual(r, []);
  assert.equal(s.llamadas(), 1);
});

test("PAGINACIÓN: deduplica por id de todas formas, aunque con cursor no debería hacer falta", async () => {
  // Ver la nota en el docstring de listarTodosLosCandidatos: con cursor
  // estrictamente creciente un id no puede repetirse entre páginas. Esta
  // prueba comprueba la red de seguridad igual, simulando un `leerPagina` que
  // NO respeta el contrato (repite el id 2).
  const paginas: CandidatoAliado[][] = [
    [{ id: 1, nombre: "A" }, { id: 2, nombre: "B" }],
    [{ id: 2, nombre: "B" }, { id: 3, nombre: "C" }], // repite el 2, y aun así avanza (3 > 2)
    [],
  ];
  let i = 0;
  const r = await listarTodosLosCandidatos({ leerPagina: async () => ({ datos: paginas[i++] ?? [], error: null }) }, 2);
  assert.equal(r.length, 3, "el id 2 solo debe contarse una vez");
  assert.deepEqual(r.map((c) => c.id).sort(), [1, 2, 3]);
});

test("PAGINACIÓN: un error en una página POSTERIOR (no la primera) FALLA CERRADO, no se trata como fin del catálogo", async () => {
  let llamada = 0;
  const conError = {
    leerPagina: async (cursor: number | null) => {
      llamada++;
      if (cursor === null) return { datos: [{ id: 1, nombre: "A" }, { id: 2, nombre: "B" }], error: null };
      return { datos: [], error: { message: "timeout de red" } };
    },
  };
  await assert.rejects(
    () => listarTodosLosCandidatos(conError, 2),
    /No se pudo leer el catálogo de aliados.*después del id 2.*timeout de red/
  );
  assert.equal(llamada, 2, "debió intentar la segunda página (con cursor 2) antes de fallar");
});

test("PAGINACIÓN: si el cursor NO AVANZA, falla cerrado en vez de repetir la misma página para siempre", async () => {
  // `leerPagina` roto: siempre devuelve la MISMA fila sin importar el cursor
  // (no respeta `id > cursor`). Sin el chequeo de avance, esto sería un bucle
  // infinito silencioso.
  const roto = {
    leerPagina: async () => ({ datos: [{ id: 1, nombre: "A" }], error: null }),
  };
  await assert.rejects(
    () => listarTodosLosCandidatos(roto, 10),
    /no avanzó \(cursor 1 → 1\)/
  );
});

test("PAGINACIÓN: si el cursor RETROCEDE, también falla cerrado", async () => {
  const paginas: CandidatoAliado[][] = [
    [{ id: 5, nombre: "E" }],
    [{ id: 3, nombre: "C" }], // 3 < 5: retrocede
  ];
  let i = 0;
  await assert.rejects(
    () => listarTodosLosCandidatos({ leerPagina: async () => ({ datos: paginas[i++] ?? [], error: null }) }, 10),
    /no avanzó \(cursor 5 → 3\)/
  );
});

// ── EL FLUJO COMPLETO con paginación real, a través de resolverFichaAliado ─

test("PAGINACIÓN + FLUJO: 1000 pedidas, el SERVIDOR limita a 2 por respuesta, homónimo normalizado en página posterior → ambiguo, CERO llamadas a buscarFichaPorId", async () => {
  // Exactamente el escenario que motivó la corrección: se piden 1000 filas
  // por página (el default de producción), pero el servidor simulado nunca
  // entrega más de 2 —como pasaría con Max Rows configurado bajo—. El
  // homónimo normalizado (" ANA GÓMEZ ") queda en la tercera página, mucho
  // después de donde una paginación por offset ya se habría dado por
  // terminada.
  const catalogo: CandidatoAliado[] = [
    { id: 1, nombre: "Ana Gómez" },
    { id: 2, nombre: "Otro Aliado" },
    { id: 3, nombre: "Tercero" },
    { id: 4, nombre: "Cuarto" },
    { id: 5, nombre: " ANA GÓMEZ " }, // el homónimo, en la página 3
  ];
  const s = servidorConTope(catalogo, 2);
  const llamadasFicha: number[] = [];
  const deps: DepsResolverFicha = {
    listarIdsYNombres: () => listarTodosLosCandidatos(s, 1000), // se PIDEN 1000
    buscarFichaPorId: async (id) => {
      llamadasFicha.push(id);
      return null;
    },
  };

  const r = await resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Ana Gómez" });
  assert.equal(r.ficha, null, "con la ambigüedad en una página posterior, tampoco se debe imprimir ninguna cuenta");
  assert.equal(r.motivo, "legacy_ambigua");
  assert.deepEqual(r.candidatas?.sort((a, b) => a - b), [1, 5]);
  assert.deepEqual(llamadasFicha, [], "ambiguo: CERO llamadas a buscarFichaPorId");
  assert.ok(s.llamadas() >= 3, "tuvo que pasar de la primera página para encontrar el homónimo");
  assert.deepEqual(s.tamanosPedidos, s.tamanosPedidos.map(() => 1000), "siempre pidió 1000, sin importar lo que el servidor devolviera");
});

test("PAGINACIÓN + FLUJO: un error de red en una página POSTERIOR hace fallar TODA la resolución, no 'sin coincidencia'", async () => {
  let llamada = 0;
  const deps: DepsResolverFicha = {
    listarIdsYNombres: () =>
      listarTodosLosCandidatos(
        {
          leerPagina: async (cursor: number | null) => {
            llamada++;
            if (cursor === null) return { datos: [{ id: 1, nombre: "Ana Gómez" }, { id: 2, nombre: "Otro" }], error: null };
            return { datos: [], error: { message: "la conexión se cayó" } };
          },
        },
        2
      ),
    buscarFichaPorId: async () => {
      throw new Error("no debía llegar a pedir ninguna ficha: el listado falló antes");
    },
  };

  // NO debe resolver a { motivo: "legacy_sin_coincidencia" } ni a ningún
  // resultado normal: el catálogo quedó truncado por un error, y tratarlo
  // como "no hay más candidatos" podría convertir una ambigüedad real en un
  // falso "única" o un falso "sin coincidencia".
  await assert.rejects(
    () => resolverFichaAliado(deps, { aliadoIdContrato: null, nombre: "Ana Gómez" }),
    /No se pudo leer el catálogo de aliados.*la conexión se cayó/
  );
  assert.equal(llamada, 2, "debió intentar la segunda página, y detenerse ahí — no fingir que ya terminó");
});

// ── explicarFicha: no debe hablar cuando todo salió bien ──────────────────

test("explicarFicha no dice nada cuando la elección fue por id o única", () => {
  assert.equal(explicarFicha({ ficha: ficha({}), motivo: "por_id" }, "Ana"), null);
  assert.equal(explicarFicha({ ficha: ficha({}), motivo: "legacy_unica" }, "Ana"), null);
});

test("explicarFicha da un motivo legible en los cuatro casos de falla", () => {
  const casos: Array<Parameters<typeof explicarFicha>[0]> = [
    { ficha: null, motivo: "por_id_inexistente" },
    { ficha: null, motivo: "legacy_ambigua", candidatas: [3, 4] },
    { ficha: null, motivo: "legacy_sin_coincidencia" },
    { ficha: null, motivo: "legacy_desaparecio" },
  ];
  for (const c of casos) {
    const msg = explicarFicha(c, "Ana Gómez");
    assert.ok(msg && msg.length > 0, c.motivo);
  }
});

// ── resolverAliadoIdContrato: de cuál columna sale el id, según el flujo ──

test("FLUJO TARIFARIO: usa ventas.aliado_id", () => {
  const r = resolverAliadoIdContrato({
    esVentasB2B: true,
    aliadoIdVentas: 42,
    aliadoIdComisionManual: 999, // no debe mirarse en este flujo
  });
  assert.equal(r, 42);
});

test("FLUJO TARIFARIO: sin ventas.aliado_id, da null (no cae a aliados_b2b)", () => {
  const r = resolverAliadoIdContrato({
    esVentasB2B: true,
    aliadoIdVentas: null,
    aliadoIdComisionManual: 999,
  });
  assert.equal(r, null, "el flujo tarifario no tiene fila en aliados_b2b que mirar");
});

test("COMISIÓN MANUAL: usa aliados_b2b.aliado_id", () => {
  const r = resolverAliadoIdContrato({
    esVentasB2B: false,
    aliadoIdVentas: null,
    aliadoIdComisionManual: 7,
  });
  assert.equal(r, 7);
});

test("COMISIÓN MANUAL: sin aliados_b2b.aliado_id, cae a ventas.aliado_id como respaldo", () => {
  const r = resolverAliadoIdContrato({
    esVentasB2B: false,
    aliadoIdVentas: 42,
    aliadoIdComisionManual: null,
  });
  assert.equal(r, 42);
});

test("COMISIÓN MANUAL: si aliados_b2b.aliado_id existe, gana sobre ventas.aliado_id", () => {
  const r = resolverAliadoIdContrato({
    esVentasB2B: false,
    aliadoIdVentas: 42,
    aliadoIdComisionManual: 7,
  });
  assert.equal(r, 7, "aliados_b2b es la fuente más específica para este flujo");
});

test("sin ningún id en ningún lado: null, cae al camino legacy más adelante", () => {
  const r = resolverAliadoIdContrato({
    esVentasB2B: false,
    aliadoIdVentas: null,
    aliadoIdComisionManual: null,
  });
  assert.equal(r, null);
});
