import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolverFichaAliado,
  explicarFicha,
  resolverAliadoIdContrato,
  type CandidatoAliado,
  type FichaAliado,
  type DepsResolverFicha,
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
