import { test } from "node:test";
import assert from "node:assert/strict";
import { elegirFichaAliado, explicarFicha, resolverAliadoIdContrato, type FichaAliado } from "../lib/finanzas/fichaAliado.ts";

// ───────────────────────────────────────────────────────────────────────────
// De qué ficha del catálogo salen los datos BANCARIOS de una cuenta de cobro.
// Elegir mal no es cosmético: es imprimir la cuenta de otra persona en un
// documento de pago.
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

// ── Con id: manda el id, siempre ──────────────────────────────────────────

test("con id, devuelve la ficha leída por id", () => {
  const f = ficha({ id: 7 });
  const r = elegirFichaAliado(f, true, "Ana Gómez", []);
  assert.equal(r.ficha, f);
  assert.equal(r.motivo, "por_id");
});

test("con id pero la ficha no existe (borrada/mal enlazada): null, no cae al nombre", () => {
  // Este es el caso que el código viejo no distinguía: `aliadoB2B?.aliadoId`
  // truthy pero sin fila. Antes no había este camino explícito; ahora es
  // intencional que NO se adivine por texto solo porque el id resultó roto.
  const r = elegirFichaAliado(null, true, "Ana Gómez", [ficha({ id: 9, nombre: "Ana Gómez" })]);
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "por_id_inexistente");
});

test("con id, el nombre nunca se consulta ni se usa aunque haya candidatas", () => {
  const f = ficha({ id: 7, nombre: "Ana Gómez" });
  const otra = ficha({ id: 8, nombre: "Ana Gómez" }); // homónimo exacto
  const r = elegirFichaAliado(f, true, "Ana Gómez", [otra]);
  assert.equal(r.ficha?.id, 7, "debe ganar la del id, no cualquiera de las del nombre");
});

// ── Sin id: legacy, exige coincidencia exacta y única ─────────────────────

test("sin id, una sola coincidencia exacta: la usa", () => {
  const f = ficha({ id: 3, nombre: "Ana Gómez" });
  const r = elegirFichaAliado(null, false, "Ana Gómez", [f]);
  assert.equal(r.ficha, f);
  assert.equal(r.motivo, "legacy_unica");
});

test("sin id, normaliza mayúsculas y espacios antes de comparar", () => {
  const f = ficha({ id: 3, nombre: "ana gómez" });
  const r = elegirFichaAliado(null, false, "  Ana Gómez  ", [f]);
  assert.equal(r.ficha, f);
});

test("HOMÓNIMOS: sin id y con dos fichas del mismo nombre, no elige ninguna", () => {
  const a = ficha({ id: 3, nombre: "Ana Gómez", numero_cuenta: "cuenta-A" });
  const b = ficha({ id: 4, nombre: "Ana Gómez", numero_cuenta: "cuenta-B" });
  const r = elegirFichaAliado(null, false, "Ana Gómez", [a, b]);
  assert.equal(r.ficha, null, "con homónimos no se debe imprimir la cuenta bancaria de ninguno de los dos");
  assert.equal(r.motivo, "legacy_ambigua");
  assert.deepEqual(r.candidatas?.sort(), [3, 4]);
});

test("sin id y sin ninguna coincidencia: null con motivo explícito", () => {
  const r = elegirFichaAliado(null, false, "Nadie Conocido", []);
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "legacy_sin_coincidencia");
});

test("sin id y sin nombre: null, no se intenta nada", () => {
  for (const n of [null, "", "   "]) {
    const r = elegirFichaAliado(null, false, n, [ficha({})]);
    assert.equal(r.ficha, null, JSON.stringify(n));
    assert.equal(r.motivo, "sin_nombre");
  }
});

test("EL FILTRO ES EXACTO, NO POR SUBCADENA: una candidata parcial no cuenta", () => {
  // El resolver de comisionResolver.ts puede traer de más de la consulta (por
  // ejemplo si en algún momento se decide ampliar la búsqueda); esta función es
  // la última línea y filtra ella misma por igualdad exacta normalizada.
  const parcial = ficha({ id: 5, nombre: "Ana Gómez Torres" });
  const r = elegirFichaAliado(null, false, "Ana Gómez", [parcial]);
  assert.equal(r.ficha, null);
  assert.equal(r.motivo, "legacy_sin_coincidencia");
});

// ── El caso de los comodines: no son responsabilidad de esta función, pero si
//    alguna vez volviera un `ilike` en el llamador, esto documenta por qué
//    nunca debe pasar candidatas obtenidas así. ──────────────────────────────

test("un nombre con % o _ se compara LITERAL, no como patrón", () => {
  const conPorcentaje = ficha({ id: 6, nombre: "AGENCIA 100% VIAJES" });
  // Si alguien buscara con ilike("nombre", "AGENCIA 100% VIAJES"), "100%"
  // actuaría como comodín y podría traer fichas que no son esta. Aquí, con la
  // candidata ya en la lista, la comparación es cadena contra cadena.
  const r = elegirFichaAliado(null, false, "AGENCIA 100% VIAJES", [conPorcentaje]);
  assert.equal(r.ficha, conPorcentaje);

  const otraCosaQueEmpatariaConIlike = ficha({ id: 99, nombre: "AGENCIA 100X VIAJES" });
  const r2 = elegirFichaAliado(null, false, "AGENCIA 100% VIAJES", [otraCosaQueEmpatariaConIlike]);
  assert.equal(r2.ficha, null, "no debe emparejar por patrón, solo por igualdad");
});

// ── explicarFicha: no debe hablar cuando todo salió bien ──────────────────

test("explicarFicha no dice nada cuando la elección fue por id o única", () => {
  assert.equal(explicarFicha({ ficha: ficha({}), motivo: "por_id" }, "Ana"), null);
  assert.equal(explicarFicha({ ficha: ficha({}), motivo: "legacy_unica" }, "Ana"), null);
});

test("explicarFicha da un motivo legible en los tres casos de falla", () => {
  const casos: Array<Parameters<typeof explicarFicha>[0]> = [
    { ficha: null, motivo: "por_id_inexistente" },
    { ficha: null, motivo: "legacy_ambigua", candidatas: [3, 4] },
    { ficha: null, motivo: "legacy_sin_coincidencia" },
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
