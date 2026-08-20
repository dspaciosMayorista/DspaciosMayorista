import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cotizarUnidadAlojamiento,
  construirSnapshotAlojamiento,
  clasificarMenores,
  determinarCantidadUnidades,
  derivarOcupacionTotal,
  validarFormaEntrada,
  validarCoherenciaTarifa,
  validarCoherenciaCapacidad,
  resultadoBloqueado,
  type TarifaAlojamiento,
  type DistribucionUnidades,
  type ResultadoValido,
  type EntradaCotizacion,
} from "../lib/calc/unidadAlojamiento.ts";

// ─────────────────────────────────────────────────────────────────────────
// § Inventario real de políticas de menores en el PDF Bernalo (punto 2 de
// la ronda 3 de revisión) — reproducido aquí porque justifica una decisión
// de este archivo: NO se agregó una unión discriminada de "regla de menor
// no-persona" (sin_cargo/tarifa_categoria/cargo_fijo_siempre/
// cargo_solo_si_adicional). Se releyó el PDF completo (pdftotext -layout,
// no de memoria) y se verificó CADA UNO de los 27 hoteles:
//
//   PAREJA (2 hoteles) — Mumu Hotel (pág. 13), Okai Hotel & Resort (pág.
//   14): ninguno de los dos tiene una sola línea de política de menores en
//   su sección. Ambos son "hoteles de pareja" por diseño.
//
//   HABITACIÓN (10 hoteles, todos con la nota "Precio [por] habitación por
//   noche") — Casa Amanzi (pág. 27), Llanogrande Airport (28), Leviu Hotel
//   (29), Braná Hotel (30), Uukam (31), Cavalta Hotel (32), Hotel Tik
//   Medellín (33), Fence Hotel (34), Lexum Hotel (35), Mangata Living (36,
//   apartamentos con cocina, pero publicados "por habitación"): NINGUNO
//   tiene política de menores.
//
//   PERSONA (15 hoteles, incluidos los dos que descriptivamente hablan de
//   "apartamentos"/"suites" pero facturan por persona: Mauku Beach Hotel
//   —"apartamentos para 6 personas", pág. 25— y Talam House Hotel —suites,
//   pág. 21): los 15 traen la MISMA cláusula de 3 tramos ("Niños y niñas de
//   0-3 años $30.000 seguro hotelero... comparten cama con los padres";
//   "4 a 10 años 70% de la tarifa de adulto... cama independiente"; "11 en
//   adelante pagan tarifa normal"). Es decir: la única cláusula "comparte
//   cama pero paga" (el 0-3) existe SOLO en hoteles por persona, nunca en
//   pareja/habitación/apartamento.
//
// Respuesta a las 3 preguntas del punto 2:
//   - ¿Algún hotel pareja/habitación/apartamento cobra un menor dentro de
//     paxIncluidos? NO, en ningún caso.
//   - ¿Alguno permite compartir cama pero aun así cobra? Esa cláusula
//     existe, pero solo en hoteles POR PERSONA.
//   - ¿Alguno distingue menor incluido de menor adicional? NO — la única
//     distinción "incluido vs. adicional" del documento es de PAX en
//     general (recargo por sencilla de LOA, pág. 24-25 — un hotel POR
//     PERSONA), no de menores.
//
// Conclusión: el motor actual (menor dentro de `paxIncluidos` = gratis,
// fuera de `paxIncluidos` = requiere suplemento explícito) representa
// correctamente los 27 hoteles reales. La ampliación queda documentada
// como diferida — no se construye sin un caso real que la necesite.
// ─────────────────────────────────────────────────────────────────────────

function esperarValido(r: ReturnType<typeof cotizarUnidadAlojamiento>): asserts r is ResultadoValido {
  assert.equal(r.ok, true, `se esperaba un resultado válido, se obtuvo bloqueo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}

function esperarCodigo(r: ReturnType<typeof cotizarUnidadAlojamiento>, codigo: string) {
  assert.equal(r.ok, false, `se esperaba un bloqueo (${codigo}), se obtuvo un resultado válido`);
  if (!r.ok) assert.equal(r.codigo, codigo);
}

const V = "bernalo-2026"; // versionTarifario de prueba, no un dato real cargado

// ─────────────────────────────────────────────────────────────────────────
// § Persona
// ─────────────────────────────────────────────────────────────────────────
describe("unidad persona", () => {
  const tarifaPersona: TarifaAlojamiento = {
    id: "t-persona-1",
    unidadCobro: "persona",
    versionTarifario: V,
    valores: { adulto: 100_000, nino: 70_000 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 }] },
  };

  test("persona por noche: adultos y niños se mantienen separados por categoría", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 6 }] }] },
      noches: 3,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 270_000);
    assert.equal(r.totalNeto, 810_000);
    assert.equal(r.cantidadUnidades, 2);
    assert.equal(r.menoresClasificados[0].categoria, "nino");
    assert.deepEqual(
      r.desglose.map((l) => l.concepto),
      ["Adultos", "Niños"]
    );
  });

  test("niño con regla aplicable", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 4 }] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.menoresClasificados[0].categoria, "nino");
  });

  test("niño sin regla → edad_fuera_de_regla", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaPersona,
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 15 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "edad_fuera_de_regla");
  });

  test("tarifa ambigua → combinacion_ambigua", () => {
    const reglaAmbigua = {
      reglas: [
        { categoria: "nino" as const, edadMinAnios: 0, edadMaxAnios: 10 },
        { categoria: "infante" as const, edadMinAnios: 0, edadMaxAnios: 3 },
      ],
    };
    const c = clasificarMenores([{ edadAnios: 2 }], reglaAmbigua);
    assert.equal("codigo" in c ? c.codigo : null, "combinacion_ambigua");
    const r = cotizarUnidadAlojamiento({
      tarifa: { ...tarifaPersona, reglaMenores: reglaAmbigua },
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 2 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "combinacion_ambigua");
  });

  test("tarifa_no_encontrada: clasifica bien, pero no hay valor para esa categoría", () => {
    const sinValorNino: TarifaAlojamiento = { ...tarifaPersona, valores: { adulto: 100_000 } };
    const r = cotizarUnidadAlojamiento({
      tarifa: sinValorNino,
      distribucion: { unidades: [{ adultos: 1, menores: [{ edadAnios: 6 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "tarifa_no_encontrada");
  });

  test("tarifa persona con habitación sobreocupada: la capacidad se valida por unidad", () => {
    const conCapacidad: TarifaAlojamiento = { ...tarifaPersona, capacidad: { minPax: 1, maxPax: 2, paxIncluidos: 0 } };
    const r = cotizarUnidadAlojamiento({
      tarifa: conCapacidad,
      distribucion: { unidades: [{ adultos: 3, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Pareja
// ─────────────────────────────────────────────────────────────────────────
describe("unidad pareja", () => {
  const tarifaMumu: TarifaAlojamiento = {
    id: "t-mumu-1",
    unidadCobro: "pareja",
    versionTarifario: V,
    valores: { adulto: 550_000 },
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: [],
    reglaMenores: { reglas: [] },
  };
  const parejaFlexible = (suplementos: TarifaAlojamiento["suplementos"]): TarifaAlojamiento => ({
    ...tarifaMumu,
    id: "t-mumu-flex",
    capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
    suplementos,
  });

  test("pareja exacta: conserva el total publicado sin dividir y volver a multiplicar", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaMumu,
      distribucion: { unidades: [{ adultos: 2, menores: [] }] },
      noches: 2,
    });
    esperarValido(r);
    assert.equal(r.cantidadUnidades, 1);
    assert.equal(r.totalNetoPorNoche, 550_000);
    assert.equal(r.totalNeto, 1_100_000);
  });

  test("1 unidad con persona sola → tarifa persona sola (reemplaza la base)", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 1 });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 400_000);
    assert.equal(r.desglose[0].concepto, "Persona sola");
  });

  test("2 unidades: pareja + persona sola", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 2, menores: [] }, { adultos: 1, menores: [] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_000 + 400_000);
  });

  test("2 unidades: dos personas solas", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 1, menores: [] }, { adultos: 1, menores: [] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 800_000);
  });

  test("falta la tarifa persona sola → falla cerrado", () => {
    const tarifa = parejaFlexible([]);
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "tarifa_no_encontrada");
  });

  test("pareja con ocupación no configurada: 3 adultos sin adulto_adicional", () => {
    const tarifa = parejaFlexible([]);
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 3, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "tarifa_no_encontrada");
  });

  test("dos adultos con un menor: exige menor_adicional o falla cerrado", () => {
    const sinSuplemento: TarifaAlojamiento = {
      ...parejaFlexible([]),
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
    };
    esperarCodigo(
      cotizarUnidadAlojamiento({ tarifa: sinSuplemento, distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }] }, noches: 1 }),
      "tarifa_no_encontrada"
    );
    const conSuplemento: TarifaAlojamiento = { ...sinSuplemento, suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 90_000 }] };
    const r = cotizarUnidadAlojamiento({ tarifa: conSuplemento, distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }] }, noches: 1 });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_000 + 90_000);
  });

  test("pareja que supera maxPax por menores", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: { ...tarifaMumu, reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] } },
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
  });

  test("varias unidades mezclando pareja/persona sola", () => {
    const tarifa = parejaFlexible([{ tipo: "persona_sola", valor: 400_000 }]);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 2, menores: [] }, { adultos: 1, menores: [] }, { adultos: 2, menores: [] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_000 + 400_000 + 550_000);
  });

  test("CONTROL NEGATIVO — dividir y volver a multiplicar cambiaría el total", () => {
    const tarifaImpar: TarifaAlojamiento = { ...tarifaMumu, id: "t-impar", valores: { adulto: 550_001 } };
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaImpar, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 550_001);
    assert.notEqual(r.totalNetoPorNoche, Math.round(550_001 / 2) * 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Habitación — Casa Amanzi, trazado desde Corporativa (ver ronda 1/2)
// ─────────────────────────────────────────────────────────────────────────
describe("unidad habitación — compatibilidad con Corporativa (Casa Amanzi)", () => {
  function tarifaHabitacion(pax: 1 | 2 | 3 | 4, valorUnidad: number): TarifaAlojamiento {
    return {
      id: `t-amanzi-${pax}`,
      unidadCobro: "habitacion",
      versionTarifario: V,
      categoria: "estandar",
      valores: { adulto: valorUnidad },
      capacidad: { minPax: pax, maxPax: pax, paxIncluidos: pax },
      suplementos: [],
      reglaMenores: { reglas: [] },
      fuente: { documento: "revista-hoteles-2026-FINAL-comerciales", pagina: 28 },
    };
  }

  const casos: { nombre: string; pax: 1 | 2 | 3 | 4; netoCorporativa: number; totalEsperado: number }[] = [
    { nombre: "SGL", pax: 1, netoCorporativa: 500_000, totalEsperado: 500_000 },
    { nombre: "DBL", pax: 2, netoCorporativa: 250_000, totalEsperado: 500_000 },
    { nombre: "TPL", pax: 3, netoCorporativa: 166_667, totalEsperado: 500_001 },
    { nombre: "múltiple (4 pax)", pax: 4, netoCorporativa: 125_000, totalEsperado: 500_000 },
  ];

  for (const c of casos) {
    test(`habitación ${c.nombre}: conserva el total de rack (± redondeo ya existente en Corporativa)`, () => {
      const valorUnidad = c.netoCorporativa * c.pax;
      const tarifa = tarifaHabitacion(c.pax, valorUnidad);
      const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: c.pax, menores: [] }] }, noches: 1 });
      esperarValido(r);
      assert.equal(r.suplementosAplicados.length, 0);
      assert.equal(c.totalEsperado, valorUnidad);
      assert.equal(r.totalNetoPorNoche, c.totalEsperado);
      assert.equal(r.cantidadUnidades, 1);
    });
  }

  test("dos habitaciones con dos adultos cada una", () => {
    const tarifa = tarifaHabitacion(2, 300_000);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 2, menores: [] }, { adultos: 2, menores: [] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.cantidadUnidades, 2);
    assert.equal(r.totalNetoPorNoche, 600_000);
  });

  test("dos habitaciones 3+1: detecta la PRIMERA sobre su capacidad", () => {
    const tarifa = tarifaHabitacion(2, 300_000);
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 3, menores: [] }, { adultos: 1, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
    if (!r.ok) assert.equal(r.contexto?.indice, 0);
  });

  test("dos habitaciones 3+1: con capacidad ampliada detecta que la SEGUNDA incumple el mínimo", () => {
    const tarifa: TarifaAlojamiento = { ...tarifaHabitacion(2, 300_000), capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 3 } };
    const r = cotizarUnidadAlojamiento({
      tarifa,
      distribucion: { unidades: [{ adultos: 3, menores: [] }, { adultos: 1, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
    if (!r.ok) assert.equal(r.contexto?.indice, 1);
  });

  test("CONTROL NEGATIVO — multiplicar la tarifa por los pasajeros sobrecobraría", () => {
    const tarifa = tarifaHabitacion(2, 500_000);
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 });
    esperarValido(r);
    assert.notEqual(r.totalNetoPorNoche, tarifa.valores.adulto * 2);
  });

  test("CONTROL NEGATIVO — 3 pax en una DBL sin suplemento falla cerrado", () => {
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaHabitacion(2, 500_000), distribucion: { unidades: [{ adultos: 3, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "ocupacion_no_permitida");
  });

  test("suplemento explícito / faltante", () => {
    const ampliada: TarifaAlojamiento = {
      ...tarifaHabitacion(2, 500_000),
      capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 80_000 }],
    };
    const conSuplemento = cotizarUnidadAlojamiento({ tarifa: ampliada, distribucion: { unidades: [{ adultos: 3, menores: [] }] }, noches: 1 });
    esperarValido(conSuplemento);
    assert.equal(conSuplemento.totalNetoPorNoche, 580_000);

    const sinSuplemento = cotizarUnidadAlojamiento({
      tarifa: { ...ampliada, suplementos: [] },
      distribucion: { unidades: [{ adultos: 3, menores: [] }] },
      noches: 1,
    });
    esperarCodigo(sinSuplemento, "tarifa_no_encontrada");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Apartamento
// ─────────────────────────────────────────────────────────────────────────
describe("unidad apartamento", () => {
  const tarifaApto: TarifaAlojamiento = {
    id: "t-apto-1",
    unidadCobro: "apartamento",
    versionTarifario: V,
    valores: { adulto: 800_000 },
    capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 6 },
    suplementos: [],
    reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
  };

  test("dentro de capacidad", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaApto,
      distribucion: { unidades: [{ adultos: 4, menores: [{ edadAnios: 8 }, { edadAnios: 10 }] }] },
      noches: 1,
    });
    esperarValido(r);
    assert.equal(r.totalNetoPorNoche, 800_000);
  });

  test("sobre capacidad", () => {
    const r = cotizarUnidadAlojamiento({
      tarifa: tarifaApto,
      distribucion: { unidades: [{ adultos: 5, menores: [{ edadAnios: 8 }, { edadAnios: 10 }, { edadAnios: 6 }] }] },
      noches: 1,
    });
    esperarCodigo(r, "ocupacion_no_permitida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 3 — Coherencia de la tarifa por unidadCobro
// ─────────────────────────────────────────────────────────────────────────
describe("coherencia de la tarifa por unidadCobro", () => {
  test("persona con suplementos configurados → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "persona",
      versionTarifario: V,
      valores: { adulto: 100_000 },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
      suplementos: [{ tipo: "adulto_adicional", valor: 1 }],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaTarifa(tarifa)?.codigo, "configuracion_invalida");
    esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 1 }), "configuracion_invalida");
  });

  test("pareja con valores.nino cargado (se ignoraría en silencio) → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "pareja",
      versionTarifario: V,
      valores: { adulto: 550_000, nino: 100_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 }), "configuracion_invalida");
  });

  test("habitación con valores.infante cargado → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 500_000, infante: 0 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 }), "configuracion_invalida");
  });

  test("habitación con suplemento persona_sola (no admitido — una SGL es otra tarifa) → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [{ tipo: "persona_sola", valor: 300_000 }],
      reglaMenores: { reglas: [] },
    };
    esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 }), "configuracion_invalida");
  });

  test("apartamento con suplemento persona_sola → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "apartamento",
      versionTarifario: V,
      valores: { adulto: 800_000 },
      capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 6 },
      suplementos: [{ tipo: "persona_sola", valor: 1 }],
      reglaMenores: { reglas: [] },
    };
    esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 }), "configuracion_invalida");
  });

  test("pareja con adulto_adicional/persona_sola/menor_adicional: combinación válida, no bloqueada por coherencia", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "pareja",
      versionTarifario: V,
      valores: { adulto: 550_000 },
      capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
      suplementos: [
        { tipo: "adulto_adicional", valor: 1 },
        { tipo: "persona_sola", valor: 1 },
        { tipo: "menor_adicional", categoriaMenor: "nino", valor: 1 },
      ],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaTarifa(tarifa), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 4 — validación de forma en runtime (datos externos, `unknown`)
// ─────────────────────────────────────────────────────────────────────────
describe("validación de forma en runtime (datos externos)", () => {
  function tarifaValidaObj(): TarifaAlojamiento {
    return {
      id: "t-forma",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 500_000 },
      capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 50_000 }],
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
      fuente: { documento: "doc", pagina: 5 },
    };
  }
  function entradaValidaObj(): EntradaCotizacion {
    return { tarifa: tarifaValidaObj(), distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 };
  }

  const casosMalformados: { nombre: string; construir: () => unknown }[] = [
    { nombre: "entrada no es objeto (string)", construir: () => "no soy un objeto" },
    { nombre: "entrada es null", construir: () => null },
    { nombre: "entrada es undefined", construir: () => undefined },
    { nombre: "tarifa es null", construir: () => ({ ...entradaValidaObj(), tarifa: null }) },
    { nombre: "tarifa.valores es null", construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), valores: null } }) },
    { nombre: "tarifa.capacidad es null", construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), capacidad: null } }) },
    { nombre: "tarifa.suplementos es null", construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), suplementos: null } }) },
    {
      nombre: "tarifa.reglaMenores.reglas es null",
      construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), reglaMenores: { reglas: null } } }),
    },
    { nombre: "distribucion.unidades es null", construir: () => ({ ...entradaValidaObj(), distribucion: { unidades: null } }) },
    { nombre: "una unidad no es objeto", construir: () => ({ ...entradaValidaObj(), distribucion: { unidades: [null] } }) },
    {
      nombre: "menores de una unidad es null",
      construir: () => ({ ...entradaValidaObj(), distribucion: { unidades: [{ adultos: 1, menores: null }] } }),
    },
    {
      nombre: "un menor no es objeto",
      construir: () => ({ ...entradaValidaObj(), distribucion: { unidades: [{ adultos: 1, menores: [null] }] } }),
    },
    {
      nombre: "un suplemento no es objeto",
      construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), suplementos: [null] } }),
    },
    {
      nombre: "una regla de menores no es objeto",
      construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), reglaMenores: { reglas: [null] } } }),
    },
    { nombre: "noches no es número", construir: () => ({ ...entradaValidaObj(), noches: "1" }) },
    { nombre: "tarifa.id falta", construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), id: "" } }) },
    { nombre: "tarifa.versionTarifario falta", construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), versionTarifario: "" } }) },
    { nombre: "tarifa.unidadCobro desconocido", construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), unidadCobro: "mensual" } }) },
    {
      nombre: "tarifa.fuente.documento vacío",
      construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), fuente: { documento: "", pagina: 1 } } }),
    },
    {
      nombre: "tarifa.fuente.pagina decimal",
      construir: () => ({ ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), fuente: { documento: "doc", pagina: 1.5 } } }),
    },
  ];

  for (const caso of casosMalformados) {
    test(`${caso.nombre} → configuracion_invalida, nunca TypeError`, () => {
      const entrada = caso.construir();
      assert.doesNotThrow(() => cotizarUnidadAlojamiento(entrada));
      esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
    });
  }

  test("entrada bien formada (aunque desconocida) pasa la validación de forma y llega a calcular", () => {
    const forma = validarFormaEntrada(entradaValidaObj());
    assert.equal("entrada" in forma, true);
    const r = cotizarUnidadAlojamiento(entradaValidaObj());
    esperarValido(r);
  });

  test("fuente ausente y fuente null son válidas (opcional)", () => {
    const sinFuente = { ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), fuente: undefined } };
    esperarValido(cotizarUnidadAlojamiento(sinFuente));
    const fuenteNull = { ...entradaValidaObj(), tarifa: { ...tarifaValidaObj(), fuente: null } };
    esperarValido(cotizarUnidadAlojamiento(fuenteNull));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 1 — el snapshot solo puede construirse desde SU propio resultado
// ─────────────────────────────────────────────────────────────────────────
describe("snapshot ligado al cálculo — mezclar fuentes es imposible por construcción", () => {
  function tarifaA(): TarifaAlojamiento {
    return {
      id: "tarifa-A",
      unidadCobro: "habitacion",
      versionTarifario: "version-A",
      categoria: "estandar-A",
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
      fuente: { documento: "doc-A", pagina: 1 },
    };
  }
  function tarifaB(): TarifaAlojamiento {
    return {
      id: "tarifa-B",
      unidadCobro: "habitacion",
      versionTarifario: "version-B",
      categoria: "estandar-B",
      valores: { adulto: 900_000 },
      capacidad: { minPax: 3, maxPax: 3, paxIncluidos: 3 },
      suplementos: [],
      reglaMenores: { reglas: [] },
      fuente: { documento: "doc-B", pagina: 2 },
    };
  }
  const distribucionA: DistribucionUnidades = { unidades: [{ adultos: 2, menores: [] }] };
  const distribucionB: DistribucionUnidades = { unidades: [{ adultos: 3, menores: [] }] };

  test("dos cotizaciones independientes producen snapshots que nunca comparten datos", () => {
    const rA = cotizarUnidadAlojamiento({ tarifa: tarifaA(), distribucion: distribucionA, noches: 2 });
    const rB = cotizarUnidadAlojamiento({ tarifa: tarifaB(), distribucion: distribucionB, noches: 3 });
    esperarValido(rA);
    esperarValido(rB);

    const snapA = construirSnapshotAlojamiento(rA);
    const snapB = construirSnapshotAlojamiento(rB);

    assert.equal(snapA.tarifaId, "tarifa-A");
    assert.equal(snapB.tarifaId, "tarifa-B");
    assert.equal(snapA.versionTarifario, "version-A");
    assert.equal(snapB.versionTarifario, "version-B");
    assert.equal(snapA.noches, 2);
    assert.equal(snapB.noches, 3);
    assert.equal(snapA.totalNeto, 1_000_000); // 500.000 × 2 noches
    assert.equal(snapB.totalNeto, 2_700_000); // 900.000 × 3 noches
    assert.notDeepEqual(snapA.distribucion, snapB.distribucion);
    assert.notEqual(snapA.fuente?.documento, snapB.fuente?.documento);
  });

  test("la función pública no tiene parámetro por el que colar tarifa/distribución/noches de otro cálculo", () => {
    // `construirSnapshotAlojamiento` declara un único parámetro — llamarla
    // con más de uno es un error de TypeScript (TS2554, exceso de
    // argumentos), verificado con `tsc --noEmit` en este PR. En runtime,
    // como JS ignora argumentos sobrantes, la llamada de abajo simplemente
    // construye el snapshot de `rA` — lo cual es la prueba misma: no existe
    // ninguna forma de que `tarifaB`/`distribucionB` influyan en el
    // resultado, ni por error ni a propósito.
    const rA = cotizarUnidadAlojamiento({ tarifa: tarifaA(), distribucion: distribucionA, noches: 2 });
    esperarValido(rA);
    assert.equal(construirSnapshotAlojamiento.length, 1, "construirSnapshotAlojamiento debe declarar un solo parámetro");

    // @ts-expect-error — construirSnapshotAlojamiento ya no acepta tarifa/distribución por separado.
    const snapIgnorandoExtras = construirSnapshotAlojamiento(rA, tarifaB(), distribucionB);
    assert.equal(snapIgnorandoExtras.tarifaId, "tarifa-A", "los argumentos extra no tienen ningún efecto");
  });

  test("noches del snapshot siempre coincide con las noches de la entrada que produjo ese resultado", () => {
    const rDosNoches = cotizarUnidadAlojamiento({ tarifa: tarifaA(), distribucion: distribucionA, noches: 2 });
    const rTresNoches = cotizarUnidadAlojamiento({ tarifa: tarifaA(), distribucion: distribucionA, noches: 3 });
    esperarValido(rDosNoches);
    esperarValido(rTresNoches);
    assert.equal(construirSnapshotAlojamiento(rDosNoches).noches, 2);
    assert.equal(construirSnapshotAlojamiento(rTresNoches).noches, 3);
    assert.equal(construirSnapshotAlojamiento(rDosNoches).totalNeto, 1_000_000);
    assert.equal(construirSnapshotAlojamiento(rTresNoches).totalNeto, 1_500_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Funciones puras aisladas
// ─────────────────────────────────────────────────────────────────────────
test("determinarCantidadUnidades", () => {
  const base: TarifaAlojamiento = {
    id: "t",
    unidadCobro: "persona",
    versionTarifario: V,
    valores: { adulto: 1 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [] },
  };
  assert.equal(determinarCantidadUnidades(base, { unidades: [{ adultos: 2, menores: [] }, { adultos: 1, menores: [] }] }), 3);
  assert.equal(
    determinarCantidadUnidades({ ...base, unidadCobro: "habitacion" }, { unidades: [{ adultos: 2, menores: [] }, { adultos: 2, menores: [] }] }),
    2
  );
});

test("derivarOcupacionTotal: agregado de solo-lectura, nunca un segundo estado editable", () => {
  const distribucion: DistribucionUnidades = { unidades: [{ adultos: 2, menores: [{ edadAnios: 5 }] }, { adultos: 1, menores: [] }] };
  const total = derivarOcupacionTotal(distribucion);
  assert.equal(total.adultos, 3);
  assert.equal(total.menores.length, 1);
  total.menores.push({ edadAnios: 99 });
  assert.equal(distribucion.unidades[0].menores.length, 1);
});

test("requiere_cotizacion_manual: la forma existe y es utilizable, aunque este motor no la dispara todavía", () => {
  const r = resultadoBloqueado("requiere_cotizacion_manual", "El periodo solicitado solo tiene tarifa de paquete.");
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "requiere_cotizacion_manual");
});

test("producto no soportado: day use (0 noches)", () => {
  const tarifa: TarifaAlojamiento = {
    id: "t",
    unidadCobro: "persona",
    versionTarifario: V,
    valores: { adulto: 100_000 },
    capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
    suplementos: [],
    reglaMenores: { reglas: [] },
  };
  esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 0 }), "producto_no_soportado");
});

// ─────────────────────────────────────────────────────────────────────────
// § Validación fail-closed numérica (ronda 2, sigue vigente)
// ─────────────────────────────────────────────────────────────────────────
describe("validación fail-closed numérica", () => {
  function tarifaValida(): TarifaAlojamiento {
    return {
      id: "t-valida",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 500_000 },
      capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 50_000 }],
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 12 }] },
    };
  }
  function entradaValida(): EntradaCotizacion {
    return { tarifa: tarifaValida(), distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 };
  }

  test("dos habitaciones agregadas que parecen válidas, pero la segunda está sobreocupada", () => {
    const entrada = entradaValida();
    entrada.tarifa.capacidad = { minPax: 1, maxPax: 2, paxIncluidos: 2 };
    entrada.distribucion = { unidades: [{ adultos: 2, menores: [] }, { adultos: 5, menores: [] }] };
    const r = cotizarUnidadAlojamiento(entrada);
    esperarCodigo(r, "ocupacion_no_permitida");
    if (!r.ok) assert.equal(r.contexto?.indice, 1);
  });

  test("1.5 noches → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.noches = 1.5;
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("2.5 adultos → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.distribucion = { unidades: [{ adultos: 2.5, menores: [] }] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("edad de un menor: NaN, Infinity o decimal → configuracion_invalida", () => {
    for (const edadInvalida of [NaN, Infinity, 4.5]) {
      const entrada = entradaValida();
      entrada.distribucion = { unidades: [{ adultos: 1, menores: [{ edadAnios: edadInvalida }] }] };
      esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
    }
  });

  test("tarifa: negativa, NaN o Infinity → configuracion_invalida", () => {
    for (const valorInvalido of [-100_000, NaN, Infinity]) {
      const entrada = entradaValida();
      entrada.tarifa = { ...entrada.tarifa, valores: { adulto: valorInvalido } };
      esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
    }
  });

  test("capacidad maxPax < minPax → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.capacidad = { minPax: 3, maxPax: 2, paxIncluidos: 0 };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("paxIncluidos fuera de la capacidad → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.capacidad = { minPax: 1, maxPax: 2, paxIncluidos: 5 };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("regla de edad con mínimo > máximo → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.reglaMenores = { reglas: [{ categoria: "nino", edadMinAnios: 10, edadMaxAnios: 5 }] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("suplementos duplicados: dos 'adulto_adicional' → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.suplementos = [
      { tipo: "adulto_adicional", valor: 50_000 },
      { tipo: "adulto_adicional", valor: 999_999 },
    ];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("suplementos duplicados: dos 'menor_adicional' para la misma categoría → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.tarifa.suplementos = [
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 40_000 },
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 999_999 },
    ];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("distribución vacía → configuracion_invalida", () => {
    const entrada = entradaValida();
    entrada.distribucion = { unidades: [] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Snapshot — copia profunda, sin comisión inventada
// ─────────────────────────────────────────────────────────────────────────
describe("snapshot", () => {
  function tarifaBase(): TarifaAlojamiento {
    return {
      id: "t-amanzi-2",
      unidadCobro: "habitacion",
      versionTarifario: "bernalo-2026",
      categoria: "estandar",
      alimentacion: "Solo alojamiento",
      temporada: "BAJA",
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
      fuente: { documento: "revista-hoteles-2026-FINAL-comerciales", pagina: 28 },
    };
  }
  function distribucionBase(): DistribucionUnidades {
    return { unidades: [{ adultos: 2, menores: [] }] };
  }

  test("ajusteComercial siempre null: este PR no inventa un total de venta", () => {
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaBase(), distribucion: distribucionBase(), noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r);
    assert.equal(snap.ajusteComercial, null);
    assert.equal(snap.totalNeto, 1_000_000);
    assert.equal("totalVenta" in snap, false);
    assert.equal("comision" in snap, false);
  });

  test("serializable: sobrevive un round-trip JSON.stringify/parse", () => {
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaBase(), distribucion: distribucionBase(), noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r);
    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  });

  test("mutación profunda posterior al snapshot: tarifa, distribución y resultado pueden mutar sin afectarlo", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t-amanzi-3",
      unidadCobro: "habitacion",
      versionTarifario: "bernalo-2026",
      categoria: "estandar",
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 80_000 }],
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 0, edadMaxAnios: 10 }] },
      fuente: { documento: "revista-hoteles-2026-FINAL-comerciales", pagina: 28 },
    };
    const distribucion: DistribucionUnidades = { unidades: [{ adultos: 3, menores: [] }] };

    const r = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: 1 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r);
    const copiaAntesDeMutar = JSON.parse(JSON.stringify(snap));

    tarifa.valores.adulto = 999_999_999;
    tarifa.capacidad.maxPax = 999;
    tarifa.reglaMenores.reglas.push({ categoria: "infante", edadMinAnios: 0, edadMaxAnios: 1 });
    tarifa.suplementos.push({ tipo: "persona_sola", valor: 1 } as never);
    (tarifa.suplementos[0] as { valor: number }).valor = 1;
    tarifa.fuente!.pagina = 999;
    distribucion.unidades[0].adultos = 999;
    distribucion.unidades[0].menores.push({ edadAnios: 5 });
    r.desglose[0].valorTotal = -1;
    r.suplementosAplicados[0].valorTotal = -1;
    r.menoresClasificados.push({ edadAnios: 1, categoria: "infante" });
    r.capacidadUtilizada[0].adultos = -1;
    r.datosFuente.valores.adulto = -1;
    r.datosFuente.distribucion.unidades[0].adultos = -1;

    assert.deepEqual(JSON.parse(JSON.stringify(snap)), copiaAntesDeMutar, "el snapshot debe quedar exactamente igual byte por byte");
    assert.equal(snap.valores.adulto, 500_000);
    assert.equal(snap.reglaMenoresAplicada.reglas.length, 1);
    assert.equal(snap.suplementosAplicados[0].valorTotal, 80_000);
    assert.equal(snap.distribucion.unidades[0].adultos, 3);
    assert.equal(snap.fuente?.pagina, 28);
    assert.equal(snap.desglose[0].valorTotal, 500_000);
    assert.equal(snap.capacidadUtilizada[0].adultos, 3);
  });

  test("contiene distribución completa, desglose completo, capacidad utilizada y versión del tarifario", () => {
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaBase(), distribucion: distribucionBase(), noches: 2 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r);
    assert.equal(snap.distribucion.unidades.length, 1);
    assert.equal(snap.desglose.length, r.desglose.length);
    assert.equal(snap.capacidadUtilizada.length, 1);
    assert.equal(snap.versionTarifario, "bernalo-2026");
    assert.equal(snap.fuente?.pagina, 28);
  });

  // Punto 5 (ronda 4): el snapshot debe incluir la capacidad completa
  // (minPax/maxPax/paxIncluidos), para poder explicar el total SIN volver a
  // consultar la tarifa original.
  test("incluye la capacidad completa (minPax/maxPax/paxIncluidos) y la unidad de cobro", () => {
    const r = cotizarUnidadAlojamiento({ tarifa: tarifaBase(), distribucion: distribucionBase(), noches: 1 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r);
    assert.deepEqual(snap.capacidad, { minPax: 2, maxPax: 2, paxIncluidos: 2 });
    assert.equal(snap.unidadCobro, "habitacion");
  });

  test("el snapshot explica el total: base + ocupantes incluidos + ocupantes adicionales × suplemento", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t-auditable",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: 80_000 }],
      reglaMenores: { reglas: [] },
    };
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 3, menores: [] }] }, noches: 1 });
    esperarValido(r);
    const snap = construirSnapshotAlojamiento(r);

    // Reconstruido ÚNICAMENTE desde el snapshot — sin volver a mirar `r` ni `tarifa`.
    const lineaBase = snap.desglose.find((l) => l.tipo === "base")!;
    const lineaSuplemento = snap.desglose.find((l) => l.tipo === "suplemento")!;
    const unidad = snap.distribucion.unidades[0];
    const totalPax = unidad.adultos + unidad.menores.length;
    const ocupantesIncluidos = Math.min(totalPax, snap.capacidad.paxIncluidos);
    const ocupantesAdicionales = totalPax - ocupantesIncluidos;

    assert.equal(ocupantesIncluidos, 2);
    assert.equal(ocupantesAdicionales, 1);
    assert.equal(lineaBase.valorTotal, 500_000);
    assert.equal(lineaSuplemento.cantidad, ocupantesAdicionales);
    assert.equal(lineaSuplemento.valorTotal, ocupantesAdicionales * lineaSuplemento.valorUnitario);
    assert.equal(lineaBase.valorTotal + lineaSuplemento.valorTotal, snap.totalNetoPorNoche);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 1 (ronda 4) — `tarifa.valores.adulto` es SIEMPRE obligatorio.
// Antes de esta ronda, ninguno de estos casos era rechazado: el bucle
// genérico sobre `Object.entries(tarifa.valores)` simplemente no
// encontraba nada que objetar en un objeto vacío o con `adulto: undefined`,
// y el cálculo seguía adelante hasta `totalAdultos * tarifa.valores.adulto`
// — que en JS da `NaN` — y el motor respondía `ok: true` con
// `totalNetoPorNoche: NaN`. Ninguno de los casos de abajo puede producir
// un `ResultadoValido`.
// ─────────────────────────────────────────────────────────────────────────
describe("valor base obligatorio (tarifa.valores.adulto)", () => {
  function tarifaSinAdulto(valores: Record<string, unknown>): unknown {
    return {
      tarifa: {
        id: "t",
        unidadCobro: "persona",
        versionTarifario: V,
        valores,
        capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        suplementos: [],
        reglaMenores: { reglas: [] },
      },
      distribucion: { unidades: [{ adultos: 1, menores: [] }] },
      noches: 1,
    };
  }

  const casos: { nombre: string; valores: Record<string, unknown> }[] = [
    { nombre: "valores: {}", valores: {} },
    { nombre: "adulto: undefined", valores: { adulto: undefined } },
    { nombre: "adulto: NaN", valores: { adulto: NaN } },
    { nombre: "adulto: Infinity", valores: { adulto: Infinity } },
    { nombre: "adulto > Number.MAX_SAFE_INTEGER", valores: { adulto: Number.MAX_SAFE_INTEGER + 2 } },
  ];

  for (const c of casos) {
    test(`${c.nombre} → nunca produce un ResultadoValido (antes producía ok:true con NaN)`, () => {
      const entrada = tarifaSinAdulto(c.valores);
      const r = cotizarUnidadAlojamiento(entrada);
      assert.equal(r.ok, false, `se esperaba un bloqueo; se obtuvo ${JSON.stringify(r)}`);
      if (!r.ok) {
        assert.equal(r.codigo, "configuracion_invalida");
        assert.notEqual(r.codigo, "tarifa_no_encontrada", "un valor mal formado no es lo mismo que 'no hay precio configurado'");
      }
      // Ni siquiera existe la posibilidad de leer un `totalNetoPorNoche: NaN`.
      assert.equal("totalNetoPorNoche" in r, false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 2 (ronda 4) — enteros seguros: cada multiplicación/suma de dinero
// se recalcula con `Number.isSafeInteger` antes de devolver `ok:true`
// (`verificarConsistenciaResultado`). Antes de esta ronda, superar
// `Number.MAX_SAFE_INTEGER` en cualquiera de estos pasos simplemente
// perdía precisión en silencio (el motor no lo detectaba: JS no lanza en
// ese caso, solo redondea mal) y el resultado quedaba `ok:true` con un
// número YA INCORRECTO, no con `Infinity` — el bug era más peligroso que
// un crash, porque parecía un total válido.
// ─────────────────────────────────────────────────────────────────────────
describe("enteros seguros — desbordamiento de Number.MAX_SAFE_INTEGER", () => {
  test("límite exacto: Number.MAX_SAFE_INTEGER como tarifa persona × 1 noche SÍ se acepta", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "persona",
      versionTarifario: V,
      valores: { adulto: Number.MAX_SAFE_INTEGER },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 1 });
    esperarValido(r);
    assert.equal(r.totalNeto, Number.MAX_SAFE_INTEGER);
  });

  test("valor × cantidad (línea base persona) desborda → configuracion_invalida, no un número impreciso", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "persona",
      versionTarifario: V,
      valores: { adulto: Number.MAX_SAFE_INTEGER },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    // 2 adultos × Number.MAX_SAFE_INTEGER ya no es representable con exactitud.
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "configuracion_invalida");
  });

  test("suplemento × cantidad (pareja, adulto_adicional) desborda → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "pareja",
      versionTarifario: V,
      valores: { adulto: 2 },
      capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
      suplementos: [{ tipo: "adulto_adicional", valor: Number.MAX_SAFE_INTEGER }],
      reglaMenores: { reglas: [] },
    };
    // diff = 4 - 2 = 2 adultos adicionales × Number.MAX_SAFE_INTEGER.
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 4, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "configuracion_invalida");
  });

  test("suplemento × cantidad (habitación, adulto_adicional) desborda → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 1 },
      capacidad: { minPax: 1, maxPax: 10, paxIncluidos: 1 },
      suplementos: [{ tipo: "adulto_adicional", valor: Number.MAX_SAFE_INTEGER }],
      reglaMenores: { reglas: [] },
    };
    // paxIncluidos=1, 5 adultos → 4 adicionales × Number.MAX_SAFE_INTEGER.
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 5, menores: [] }] }, noches: 1 });
    esperarCodigo(r, "configuracion_invalida");
  });

  test("totalNetoPorNoche × noches desborda → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "persona",
      versionTarifario: V,
      valores: { adulto: Number.MAX_SAFE_INTEGER },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    // 1 adulto × Number.MAX_SAFE_INTEGER (seguro) × 2 noches (ya no es seguro).
    const r = cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 2 });
    esperarCodigo(r, "configuracion_invalida");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 3 (ronda 4) — coherencia de capacidad por unidadCobro. Antes de
// esta ronda, `capacidad.paxIncluidos` podía tener CUALQUIER valor en una
// tarifa "persona" o "pareja" sin que el motor se quejara — parecía
// configurable, pero nunca se usaba (persona) o el motor asumía 2 sin
// importar lo que dijera `paxIncluidos` (pareja); y una habitación con
// `minPax:2, paxIncluidos:0` pasaba de largo, pese a no poder venderse ni
// en su ocupación mínima sin un suplemento.
// ─────────────────────────────────────────────────────────────────────────
describe("coherencia de capacidad por unidadCobro", () => {
  test("persona: paxIncluidos distinto de 0 → configuracion_invalida (antes se aceptaba cualquier valor, sin efecto real)", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "persona",
      versionTarifario: V,
      valores: { adulto: 100_000 },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 3 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaCapacidad(tarifa)?.codigo, "configuracion_invalida");
    esperarCodigo(cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 1, menores: [] }] }, noches: 1 }), "configuracion_invalida");
  });

  test("pareja: minPax > 2 → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "pareja",
      versionTarifario: V,
      valores: { adulto: 550_000 },
      capacidad: { minPax: 3, maxPax: 4, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaCapacidad(tarifa)?.codigo, "configuracion_invalida");
  });

  test("pareja: maxPax < 2 → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "pareja",
      versionTarifario: V,
      valores: { adulto: 550_000 },
      capacidad: { minPax: 1, maxPax: 1, paxIncluidos: 1 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaCapacidad(tarifa)?.codigo, "configuracion_invalida");
  });

  test("pareja: paxIncluidos distinto de 2 → configuracion_invalida (antes se aceptaba, pero el motor siempre asumía 2)", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "pareja",
      versionTarifario: V,
      valores: { adulto: 550_000 },
      capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 3 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaCapacidad(tarifa)?.codigo, "configuracion_invalida");
  });

  test("habitación: minPax:2, paxIncluidos:0 → configuracion_invalida (caso explícito del encargo)", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "habitacion",
      versionTarifario: V,
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 0 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaCapacidad(tarifa)?.codigo, "configuracion_invalida");
    esperarCodigo(
      cotizarUnidadAlojamiento({ tarifa, distribucion: { unidades: [{ adultos: 2, menores: [] }] }, noches: 1 }),
      "configuracion_invalida"
    );
  });

  test("apartamento: paxIncluidos < minPax → configuracion_invalida", () => {
    const tarifa: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "apartamento",
      versionTarifario: V,
      valores: { adulto: 800_000 },
      capacidad: { minPax: 3, maxPax: 6, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    assert.equal(validarCoherenciaCapacidad(tarifa)?.codigo, "configuracion_invalida");
  });

  test("combinaciones coherentes por unidad pasan sin bloqueo", () => {
    const persona: TarifaAlojamiento = {
      id: "t",
      unidadCobro: "persona",
      versionTarifario: V,
      valores: { adulto: 1 },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
      suplementos: [],
      reglaMenores: { reglas: [] },
    };
    const pareja: TarifaAlojamiento = { ...persona, unidadCobro: "pareja", capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 } };
    const habitacion: TarifaAlojamiento = { ...persona, unidadCobro: "habitacion", capacidad: { minPax: 2, maxPax: 3, paxIncluidos: 2 } };
    assert.equal(validarCoherenciaCapacidad(persona), null);
    assert.equal(validarCoherenciaCapacidad(pareja), null);
    assert.equal(validarCoherenciaCapacidad(habitacion), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Punto 4 (ronda 4) — discriminantes en runtime: enums/uniones se
// verifican exhaustivamente contra datos `unknown`. Siempre
// configuracion_invalida, nunca tarifa_no_encontrada ni TypeError.
// ─────────────────────────────────────────────────────────────────────────
describe("discriminantes en runtime", () => {
  function base(): { tarifa: Record<string, unknown>; distribucion: unknown; noches: number } {
    return {
      tarifa: {
        id: "t",
        unidadCobro: "pareja",
        versionTarifario: V,
        valores: { adulto: 550_000 },
        capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
        suplementos: [],
        reglaMenores: { reglas: [] },
      },
      distribucion: { unidades: [{ adultos: 2, menores: [] }] },
      noches: 1,
    };
  }

  test("ReglaEdadMenor.categoria desconocida → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { reglaMenores: unknown }).reglaMenores = { reglas: [{ categoria: "adolescente", edadMinAnios: 0, edadMaxAnios: 5 }] };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("suplemento.tipo desconocido → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { suplementos: unknown }).suplementos = [{ tipo: "descuento_fidelidad", valor: 1 }];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("menor_adicional sin categoriaMenor → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { suplementos: unknown }).suplementos = [{ tipo: "menor_adicional", valor: 1 }];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("menor_adicional con categoriaMenor inválida → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { suplementos: unknown }).suplementos = [{ tipo: "menor_adicional", categoriaMenor: "adulto", valor: 1 }];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("adulto_adicional con categoriaMenor puesto (no debería tenerla) → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { suplementos: unknown }).suplementos = [{ tipo: "adulto_adicional", categoriaMenor: "nino", valor: 1 }];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("persona_sola con categoriaMenor puesto → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { suplementos: unknown }).suplementos = [{ tipo: "persona_sola", categoriaMenor: "infante", valor: 1 }];
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });

  test("temporada/categoria/alimentacion deben ser string o null", () => {
    for (const campo of ["temporada", "categoria", "alimentacion"] as const) {
      for (const valorInvalido of [123, {}, [], true]) {
        const entrada = base();
        (entrada.tarifa as Record<string, unknown>)[campo] = valorInvalido;
        esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
      }
    }
  });

  test("tarifa.valores con una clave desconocida → configuracion_invalida", () => {
    const entrada = base();
    (entrada.tarifa as { valores: unknown }).valores = { adulto: 550_000, descuento: 10 };
    esperarCodigo(cotizarUnidadAlojamiento(entrada), "configuracion_invalida");
  });
});
