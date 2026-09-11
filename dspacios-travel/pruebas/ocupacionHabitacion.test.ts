import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  cotizarHabitaciones,
  adaptarOcupacionDesdeReservar,
  type HabitacionOcupacion,
  type ItemCotizarHabitacion,
  type ResultadoColeccionCotizada,
  type ResultadoColeccionBloqueada,
} from "../lib/calc/ocupacionHabitacion.ts";
import type { TarifaAlojamiento } from "../lib/calc/unidadAlojamiento.ts";
import type { AsignacionHabitacion } from "../lib/reservar/distribucionHabitaciones.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3A Bernalo — contrato canónico de ocupación por habitación/unidad
// (`lib/calc/ocupacionHabitacion.ts`). Ver el informe de la tarea para el
// alcance exacto: SOLO el contrato de ocupación + la cotización pura que lo
// consume, llamando una vez al motor (`cotizarUnidadAlojamiento`) por
// habitación. Nada de contratos/CxP/UI se toca aquí.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteOcupacionHabitacion = readFileSync(join(raiz, "lib/calc/ocupacionHabitacion.ts"), "utf8");

const V = "bernalo-2026-fase3a";

function esperarValida(r: ResultadoColeccionCotizada | ResultadoColeccionBloqueada): asserts r is ResultadoColeccionCotizada {
  assert.equal(r.ok, true, `se esperaba una cotización válida, se obtuvo bloqueo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}

function esperarBloqueada(r: ResultadoColeccionCotizada | ResultadoColeccionBloqueada): asserts r is ResultadoColeccionBloqueada {
  assert.equal(r.ok, false, "se esperaba un bloqueo, se obtuvo una cotización válida");
}

const tarifaHabitacion = (valorUnidad: number, pax: number, reglas: TarifaAlojamiento["reglaMenores"]["reglas"] = []): TarifaAlojamiento => ({
  id: `t-hab-${pax}-${valorUnidad}`,
  unidadCobro: "habitacion",
  comisionPct: 20,
  versionTarifario: V,
  categoria: "estandar",
  alimentacion: "PC",
  valores: { adulto: valorUnidad },
  capacidad: { minPax: pax, maxPax: pax + 2, paxIncluidos: pax },
  suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 50_000 }],
  reglaMenores: { reglas },
});

const REGLA_NINO_0_12 = [{ categoria: "nino" as const, edadMinAnios: 0, edadMaxAnios: 12 }];

describe("cotizarHabitaciones — una habitación con dos niños", () => {
  test("clasifica ambos niños DENTRO de esa habitación (Niño 1 y Niño 2 de la misma unidad)", () => {
    const habitacion: HabitacionOcupacion = {
      id: "hab-1", adultos: 2, menores: [{ edadAnios: 5 }, { edadAnios: 8 }],
      categoria: "estandar", alimentacion: "PC", noches: 2,
    };
    const items: ItemCotizarHabitacion[] = [{ habitacion, tarifa: tarifaHabitacion(300_000, 2, REGLA_NINO_0_12) }];
    const r = cotizarHabitaciones(items);
    esperarValida(r);
    assert.equal(r.porHabitacion.length, 1);
    const { resultado } = r.porHabitacion[0];
    assert.equal(resultado.menoresClasificados.length, 2);
    assert.ok(resultado.menoresClasificados.every((m) => m.categoriaTarifaria === "nino"));
    // Ambos niños contribuyen al desglose de ESA misma unidad (índice 0).
    const lineasMenor = resultado.desglose.filter((l) => l.tipo === "suplemento" && l.unidadIndex === 0);
    assert.equal(lineasMenor.length, 1); // agrupado por categoría dentro de la unidad
    assert.equal(lineasMenor[0].cantidad, 2);
  });
});

describe("cotizarHabitaciones — dos habitaciones con un niño cada una", () => {
  test("cada niño es el PRIMERO de su propia habitación — nunca se agregan globalmente", () => {
    const hab1: HabitacionOcupacion = { id: "hab-1", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "hab-2", adultos: 2, menores: [{ edadAnios: 9 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const tarifa = tarifaHabitacion(300_000, 2, REGLA_NINO_0_12);
    const r = cotizarHabitaciones([
      { habitacion: hab1, tarifa },
      { habitacion: hab2, tarifa },
    ]);
    esperarValida(r);
    assert.equal(r.porHabitacion.length, 2);
    for (const ph of r.porHabitacion) {
      assert.equal(ph.resultado.menoresClasificados.length, 1);
      assert.equal(ph.resultado.menoresClasificados[0].categoriaTarifaria, "nino");
      // Cada habitación paga su PROPIO suplemento de niño (no se divide ni
      // se comparte entre habitaciones).
      const supNino = ph.resultado.suplementosAplicados.find((s) => s.tipo === "menor_adicional");
      assert.ok(supNino);
      assert.equal(supNino!.cantidad, 1);
    }
    // Total = 2 habitaciones × (base 300.000 + suplemento 50.000) bruto,
    // nunca "1 niño 1 + 1 niño 2" agregados en una sola habitación.
    assert.equal(r.totalBruto, 2 * (300_000 + 50_000));
  });
});

describe("cotizarHabitaciones — edades permanecen vinculadas a su habitación", () => {
  test("una edad fuera de regla en una habitación no contamina otra habitación válida", () => {
    const habOk: HabitacionOcupacion = { id: "hab-ok", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habMala: HabitacionOcupacion = { id: "hab-mala", adultos: 2, menores: [{ edadAnios: 40 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const tarifa = tarifaHabitacion(300_000, 2, REGLA_NINO_0_12);
    const rMala = cotizarHabitaciones([{ habitacion: habMala, tarifa }]);
    esperarBloqueada(rMala);
    assert.equal(rMala.codigo, "edad_fuera_de_regla");
    assert.equal(rMala.habitacionId, "hab-mala");

    const rOk = cotizarHabitaciones([{ habitacion: habOk, tarifa }]);
    esperarValida(rOk);
    assert.equal(rOk.porHabitacion[0].resultado.menoresClasificados[0].edadAnios, 5);
  });
});

describe("cotizarHabitaciones — una habitación bloqueada bloquea el cálculo completo", () => {
  test("la colección entera se bloquea si CUALQUIER habitación falla (fail-closed, no parcial)", () => {
    const habOk: HabitacionOcupacion = { id: "hab-ok", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habBloqueada: HabitacionOcupacion = { id: "hab-bloqueada", adultos: 2, menores: [{ edadAnios: 99 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const tarifa = tarifaHabitacion(300_000, 2, REGLA_NINO_0_12);
    const r = cotizarHabitaciones([
      { habitacion: habOk, tarifa },
      { habitacion: habBloqueada, tarifa },
    ]);
    esperarBloqueada(r);
    assert.equal(r.habitacionId, "hab-bloqueada");
    // No hay resultado parcial: el tipo de retorno de la función bloqueada
    // no tiene `porHabitacion` — no existe forma de leer un cálculo a medias.
    assert.equal((r as unknown as { porHabitacion?: unknown }).porHabitacion, undefined);
  });
});

describe("cotizarHabitaciones — la suma neta coincide exactamente con la suma del motor", () => {
  test("totalNeto/totalBruto/totalComision son sumas literales de cada resultado, sin redondeo adicional", () => {
    const habs: HabitacionOcupacion[] = [
      { id: "hab-1", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 3 },
      { id: "hab-2", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 3 },
      { id: "hab-3", adultos: 2, menores: [{ edadAnios: 2 }, { edadAnios: 7 }], categoria: "estandar", alimentacion: "PC", noches: 3 },
    ];
    const tarifa: TarifaAlojamiento = {
      ...tarifaHabitacion(333_333, 2, [
        { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
        { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 12 },
      ]),
      suplementos: [
        { tipo: "menor_adicional", categoriaMenor: "nino", valor: 50_000 },
        { tipo: "menor_adicional", categoriaMenor: "infante", valor: 30_000 },
      ],
      capacidad: { minPax: 2, maxPax: 5, paxIncluidos: 2 },
    };
    const items: ItemCotizarHabitacion[] = habs.map((habitacion) => ({ habitacion, tarifa }));
    const r = cotizarHabitaciones(items);
    esperarValida(r);
    const sumaNeta = r.porHabitacion.reduce((s, ph) => s + ph.resultado.totalNeto, 0);
    const sumaBruta = r.porHabitacion.reduce((s, ph) => s + ph.resultado.totalBruto, 0);
    const sumaComision = r.porHabitacion.reduce((s, ph) => s + ph.resultado.valorComision, 0);
    assert.equal(r.totalNeto, sumaNeta);
    assert.equal(r.totalBruto, sumaBruta);
    assert.equal(r.totalComision, sumaComision);
  });
});

describe("cotizarHabitaciones — comisión y suplementos no se recalculan fuera del motor", () => {
  test("el código fuente del módulo no reimplementa la fórmula de comisión ni de suplementos", () => {
    const fuente = fuenteOcupacionHabitacion;
    // Ninguna multiplicación/resta manual de comisionPct fuera de leer los
    // campos ya calculados por el motor (`resultado.totalBruto`/
    // `valorComision`/`totalNeto`).
    assert.doesNotMatch(fuente, /comisionPct\s*[/*]/);
    assert.doesNotMatch(fuente, /1\s*-\s*.*comisionPct/);
    // Solo se suma lo que el motor ya devolvió — nunca se construye un
    // `SuplementoAplicado`/desglose a mano.
    assert.doesNotMatch(fuente, /suplementosAplicados\s*[:=]\s*\[/);
    assert.doesNotMatch(fuente, /desglose\s*[:=]\s*\[/);
  });

  test("el total sumado es exactamente la suma de campos leídos del motor (control numérico)", () => {
    const tarifa = tarifaHabitacion(500_000, 2, REGLA_NINO_0_12);
    const habitacion: HabitacionOcupacion = { id: "hab-1", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const r = cotizarHabitaciones([{ habitacion, tarifa }]);
    esperarValida(r);
    const { resultado } = r.porHabitacion[0];
    // bruto = 550.000 (base 500.000 + suplemento niño 50.000); comisión 20%.
    assert.equal(resultado.totalBruto, 550_000);
    assert.equal(resultado.comisionPct, 20);
    assert.equal(resultado.totalNeto, Math.round(550_000 * 0.8));
    assert.equal(resultado.valorComision, resultado.totalBruto - resultado.totalNeto);
    assert.equal(r.totalNeto, resultado.totalNeto);
  });
});

describe("cotizarHabitaciones — persona/pareja/habitación/apartamento pasan por el mismo contrato", () => {
  const casos: { nombre: string; tarifa: TarifaAlojamiento; habitacion: HabitacionOcupacion }[] = [
    {
      nombre: "persona",
      tarifa: {
        id: "t-persona", unidadCobro: "persona", comisionPct: 10, versionTarifario: V,
        valores: { adulto: 100_000, nino: 70_000 }, capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        suplementos: [], reglaMenores: { reglas: REGLA_NINO_0_12 },
      },
      habitacion: { id: "hab-persona", adultos: 2, menores: [{ edadAnios: 6 }], categoria: null, alimentacion: null, noches: 2 },
    },
    {
      nombre: "pareja",
      tarifa: {
        id: "t-pareja", unidadCobro: "pareja", comisionPct: 15, versionTarifario: V,
        valores: { adulto: 400_000 }, capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
        suplementos: [], reglaMenores: { reglas: [] },
      },
      habitacion: { id: "hab-pareja", adultos: 2, menores: [], categoria: null, alimentacion: null, noches: 1 },
    },
    {
      nombre: "habitacion",
      tarifa: tarifaHabitacion(300_000, 2, REGLA_NINO_0_12),
      habitacion: { id: "hab-habitacion", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 1 },
    },
    {
      nombre: "apartamento",
      tarifa: {
        id: "t-apto", unidadCobro: "apartamento", comisionPct: 12, versionTarifario: V,
        valores: { adulto: 600_000 }, capacidad: { minPax: 2, maxPax: 6, paxIncluidos: 4 },
        suplementos: [{ tipo: "adulto_adicional", valor: 80_000 }], reglaMenores: { reglas: [] },
      },
      habitacion: { id: "hab-apto", adultos: 5, menores: [], categoria: null, alimentacion: null, noches: 1 },
    },
  ];

  for (const c of casos) {
    test(`unidadCobro "${c.nombre}" cotiza con el mismo HabitacionOcupacion/ItemCotizarHabitacion`, () => {
      const r = cotizarHabitaciones([{ habitacion: c.habitacion, tarifa: c.tarifa }]);
      esperarValida(r);
      assert.equal(r.porHabitacion[0].resultado.unidadCobro, c.tarifa.unidadCobro);
      assert.equal(r.porHabitacion[0].habitacionId, c.habitacion.id);
    });
  }
});

describe("HabitacionOcupacion — una habitación física por entrada, sin campo de cantidad", () => {
  test("dos unidades adultas idénticas (misma ocupación) producen DOS llamadas y DOS snapshots independientes", () => {
    const tarifa = tarifaHabitacion(300_000, 2);
    // Dos habitaciones físicas, mismos adultos, cero menores — cada una es
    // su propio elemento de `items`, no una sola entrada con "cantidad: 2".
    const hab1: HabitacionOcupacion = { id: "hab-doble-0", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "hab-doble-1", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const r = cotizarHabitaciones([
      { habitacion: hab1, tarifa },
      { habitacion: hab2, tarifa },
    ]);
    esperarValida(r);
    assert.equal(r.porHabitacion.length, 2);
    assert.deepEqual(r.porHabitacion.map((ph) => ph.habitacionId).sort(), ["hab-doble-0", "hab-doble-1"]);
    // Dos snapshots DISTINTOS (uno por llamada al motor) — no el mismo
    // objeto reutilizado ni un snapshot agregado para las dos.
    assert.notEqual(r.porHabitacion[0].snapshot, r.porHabitacion[1].snapshot);
    assert.equal(r.porHabitacion[0].resultado.cantidadUnidades, 1);
    assert.equal(r.porHabitacion[1].resultado.cantidadUnidades, 1);
    // El total es la suma de las DOS llamadas, cada una a 300.000 bruto —
    // nunca una sola llamada con distribucion.unidades de longitud 2.
    assert.equal(r.totalBruto, 2 * 300_000);
  });

  test("dos habitaciones con un niño cada una producen dos cálculos INDEPENDIENTES (no una sola llamada con 2 unidades)", () => {
    const tarifa = tarifaHabitacion(300_000, 2, REGLA_NINO_0_12);
    const hab1: HabitacionOcupacion = { id: "hab-a", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const hab2: HabitacionOcupacion = { id: "hab-b", adultos: 2, menores: [{ edadAnios: 9 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const r = cotizarHabitaciones([
      { habitacion: hab1, tarifa },
      { habitacion: hab2, tarifa },
    ]);
    esperarValida(r);
    assert.equal(r.porHabitacion.length, 2);
    for (const ph of r.porHabitacion) {
      // Cada resultado del motor describe UNA sola unidad (cantidadUnidades
      // === 1) — si se hubieran agrupado las dos habitaciones en una sola
      // llamada, esto sería 2.
      assert.equal(ph.resultado.cantidadUnidades, 1);
      assert.equal(ph.resultado.menoresClasificados.length, 1);
      assert.equal(ph.resultado.capacidadUtilizada.length, 1);
    }
  });

  test('el contrato canónico NO tiene "cantidadUnidadesEquivalentes" (representa exactamente una habitación física)', () => {
    const lineasNoComentario = fuenteOcupacionHabitacion
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    assert.doesNotMatch(lineasNoComentario, /cantidadUnidadesEquivalentes/);
    // Control positivo: una HabitacionOcupacion con un campo desconocido de
    // "cantidad" no debería compilar contra el tipo real — verificado aquí
    // en tiempo de ejecución comprobando que el objeto que SÍ acepta la
    // función no necesita (ni usa) ningún campo de cantidad para producir
    // el resultado correcto (ver los dos tests anteriores, que cotizan 2
    // habitaciones con 2 llamadas, nunca con un multiplicador).
    const habitacion: HabitacionOcupacion = { id: "hab-1", adultos: 2, menores: [], categoria: null, alimentacion: null, noches: 1 };
    assert.deepEqual(Object.keys(habitacion).sort(), ["adultos", "alimentacion", "categoria", "id", "menores", "noches"]);
  });

  test("ningún resultado se multiplica fuera de cotizarUnidadAlojamiento: 2 habitaciones con suplementos DISTINTOS no se pueden explicar con un solo resultado × 2", () => {
    // Si el código multiplicara "un resultado × N" en vez de sumar N
    // llamadas independientes, este caso lo delataría: las dos habitaciones
    // tienen la MISMA tarifa base pero un niño solo en una — un ×2 sobre
    // cualquiera de los dos resultados individuales NO puede dar el total
    // real (300.000+300.000+50.000), solo la suma de las dos llamadas sí.
    const tarifa = tarifaHabitacion(300_000, 2, REGLA_NINO_0_12);
    const habSinNino: HabitacionOcupacion = { id: "hab-a", adultos: 2, menores: [], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const habConNino: HabitacionOcupacion = { id: "hab-b", adultos: 2, menores: [{ edadAnios: 5 }], categoria: "estandar", alimentacion: "PC", noches: 1 };
    const r = cotizarHabitaciones([
      { habitacion: habSinNino, tarifa },
      { habitacion: habConNino, tarifa },
    ]);
    esperarValida(r);
    const totalEsperado = 300_000 + (300_000 + 50_000);
    assert.equal(r.totalBruto, totalEsperado);
    assert.notEqual(r.totalBruto, r.porHabitacion[0].resultado.totalBrutoPorNoche * 2);
    assert.notEqual(r.totalBruto, r.porHabitacion[1].resultado.totalBrutoPorNoche * 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// § Adaptador desde la entrada actual de Reservar
// ─────────────────────────────────────────────────────────────────────────
describe("adaptarOcupacionDesdeReservar — entrada ambigua sin vínculo menor↔habitación falla cerrada", () => {
  test("reparto manual legado (sin distribucionMenores) con menores declarados: bloquea, nunca reparte", () => {
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 2 },
      paxTarifaPorTipo: { doble: 2 },
      distribucionMenores: null,
      edadesMenoresUsadas: null,
      totalMenoresDeclarados: 1,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 2,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "configuracion_invalida");
  });

  test("dos habitaciones con menores en la distribución moderna: la edad exacta no se puede vincular — bloquea", () => {
    const distribucion: AsignacionHabitacion[] = [
      { indice: 0, acom: "doble", adultos: 2, nino: 1, nino2: 0, infantes: 0 },
      { indice: 1, acom: "doble", adultos: 2, nino: 1, nino2: 0, infantes: 0 },
    ];
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 2 },
      paxTarifaPorTipo: { doble: 2 },
      distribucionMenores: distribucion,
      edadesMenoresUsadas: [5, 9],
      totalMenoresDeclarados: 2,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "combinacion_ambigua");
  });

  test("distribución inconsistente (conteo de menores no cuadra con las edades recibidas): bloquea", () => {
    const distribucion: AsignacionHabitacion[] = [{ indice: 0, acom: "doble", adultos: 2, nino: 1, nino2: 0, infantes: 0 }];
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 1 },
      paxTarifaPorTipo: { doble: 2 },
      distribucionMenores: distribucion,
      edadesMenoresUsadas: [5, 9], // 2 edades, pero la distribución solo cuenta 1 menor
      totalMenoresDeclarados: 1,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "configuracion_invalida");
  });
});

describe("adaptarOcupacionDesdeReservar — casos sin ambigüedad", () => {
  test("sin menores en toda la solicitud: expande CADA habitación física en su propia entrada (ids estables, sin agrupar)", () => {
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 2, triple: 1 },
      paxTarifaPorTipo: { doble: 2, triple: 3 },
      distribucionMenores: null,
      edadesMenoresUsadas: null,
      totalMenoresDeclarados: 0,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 3,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      // 2 dobles + 1 triple = 3 habitaciones físicas independientes, nunca
      // 2 entradas agrupadas por tipo.
      assert.equal(r.habitaciones.length, 3);
      const ids = r.habitaciones.map((h) => h.id).sort();
      assert.deepEqual(ids, ["hab-doble-0", "hab-doble-1", "hab-triple-0"]);
      for (const h of r.habitaciones.filter((h) => h.id.startsWith("hab-doble"))) {
        assert.equal(h.adultos, 2);
        assert.deepEqual(h.menores, []);
      }
    }
  });

  test("una sola habitación con menores en la distribución moderna: se asocia sin ambigüedad", () => {
    const distribucion: AsignacionHabitacion[] = [
      { indice: 0, acom: "doble", adultos: 2, nino: 1, nino2: 1, infantes: 0 },
      { indice: 1, acom: "sencilla", adultos: 1, nino: 0, nino2: 0, infantes: 0 },
    ];
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 1, sencilla: 1 },
      paxTarifaPorTipo: { doble: 2, sencilla: 1 },
      distribucionMenores: distribucion,
      edadesMenoresUsadas: [4, 9],
      totalMenoresDeclarados: 2,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 2,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      const hab0 = r.habitaciones.find((h) => h.id === "hab-0");
      const hab1 = r.habitaciones.find((h) => h.id === "hab-1");
      assert.deepEqual(hab0?.menores.map((m) => m.edadAnios).sort(), [4, 9]);
      assert.deepEqual(hab1?.menores, []);
    }
  });

  test("todas las habitaciones sin menores en la distribución moderna: cada una queda con menores: []", () => {
    const distribucion: AsignacionHabitacion[] = [
      { indice: 0, acom: "doble", adultos: 2, nino: 0, nino2: 0, infantes: 0 },
      { indice: 1, acom: "doble", adultos: 2, nino: 0, nino2: 0, infantes: 0 },
    ];
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 2 },
      paxTarifaPorTipo: { doble: 2 },
      distribucionMenores: distribucion,
      edadesMenoresUsadas: [],
      totalMenoresDeclarados: 0,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 1,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.habitaciones.every((h) => h.menores.length === 0));
  });
});

describe("adaptarOcupacionDesdeReservar — Caso C (Fase 3D): asociación explícita habitación↔edades", () => {
  test("dos habitaciones con menores, cada una con su propia edad EXPLÍCITA: ya NO bloquea por ambigüedad (a diferencia del Caso B legado)", () => {
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: {},
      paxTarifaPorTipo: {},
      distribucionMenores: null,
      edadesMenoresUsadas: null,
      totalMenoresDeclarados: 0,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 2,
      habitacionesExplicitas: [
        { id: "doble-0", adultos: 2, edadesMenores: [5] },
        { id: "doble-1", adultos: 2, edadesMenores: [9] },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      const h0 = r.habitaciones.find((h) => h.id === "doble-0")!;
      const h1 = r.habitaciones.find((h) => h.id === "doble-1")!;
      assert.deepEqual(h0.menores.map((m) => m.edadAnios), [5]);
      assert.deepEqual(h1.menores.map((m) => m.edadAnios), [9]);
    }
  });

  test("habitacionesExplicitas tiene PRIORIDAD sobre distribucionMenores/edadesMenoresUsadas — no se mezclan las dos fuentes", () => {
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: {},
      paxTarifaPorTipo: {},
      // Datos legados presentes pero deliberadamente IGNORADOS: si el
      // adaptador los mezclara, produciría un resultado distinto (o
      // bloquearía por ambigüedad, como en el Caso B).
      distribucionMenores: [{ indice: 0, acom: "doble", adultos: 2, nino: 1, nino2: 0, infantes: 0 }],
      edadesMenoresUsadas: [99],
      totalMenoresDeclarados: 1,
      categoria: "estandar",
      alimentacion: "PC",
      noches: 1,
      habitacionesExplicitas: [{ id: "doble-0", adultos: 2, edadesMenores: [5] }],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones[0].menores.map((m) => m.edadAnios), [5]);
  });

  test("id repetido entre habitaciones explícitas: bloquea", () => {
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: {}, paxTarifaPorTipo: {}, distribucionMenores: null, edadesMenoresUsadas: null,
      totalMenoresDeclarados: 0, categoria: null, alimentacion: null, noches: 1,
      habitacionesExplicitas: [
        { id: "doble-0", adultos: 2, edadesMenores: [] },
        { id: "doble-0", adultos: 2, edadesMenores: [] },
      ],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "configuracion_invalida");
  });

  test("colección explícita vacía: bloquea", () => {
    const r = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: {}, paxTarifaPorTipo: {}, distribucionMenores: null, edadesMenoresUsadas: null,
      totalMenoresDeclarados: 0, categoria: null, alimentacion: null, noches: 1,
      habitacionesExplicitas: [],
    });
    assert.equal(r.ok, false);
  });

  test("habitacionesExplicitas ausente (undefined) o null: sigue el camino legado sin cambios (Casos A/B intactos)", () => {
    const sinCampo = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 1 }, paxTarifaPorTipo: { doble: 2 }, distribucionMenores: null,
      edadesMenoresUsadas: null, totalMenoresDeclarados: 0, categoria: "estandar", alimentacion: "PC", noches: 1,
    });
    const conNull = adaptarOcupacionDesdeReservar({
      habitacionesPorTipo: { doble: 1 }, paxTarifaPorTipo: { doble: 2 }, distribucionMenores: null,
      edadesMenoresUsadas: null, totalMenoresDeclarados: 0, categoria: "estandar", alimentacion: "PC", noches: 1,
      habitacionesExplicitas: null,
    });
    assert.equal(sinCampo.ok, true);
    assert.equal(conNull.ok, true);
    if (sinCampo.ok && conNull.ok) assert.deepEqual(sinCampo.habitaciones, conNull.habitaciones);
  });
});

describe("ocupacionHabitacion.ts — módulo puro, sin Supabase/Next/contratos/CxP/UI", () => {
  test("no importa ninguno de esos módulos", () => {
    // Se revisan solo las líneas de import/require reales — el resto del
    // archivo (comentarios) SÍ nombra "Supabase"/"contratos"/"CxP" para
    // explicar qué queda fuera de alcance, y eso no cuenta como importarlos.
    const lineasImport = fuenteOcupacionHabitacion
      .split(/\r?\n/)
      .filter((l) => /^\s*import\b/.test(l) || /require\(/.test(l));
    const bloque = lineasImport.join("\n");
    assert.doesNotMatch(bloque, /supabase/i);
    assert.doesNotMatch(bloque, /\bnext\//);
    assert.doesNotMatch(bloque, /contrato_items|cuentas_por_pagar|\bcxp\b/i);
    const lineasNoComentario = fuenteOcupacionHabitacion
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l));
    assert.doesNotMatch(lineasNoComentario.join("\n"), /"use (server|client)"/);
  });
});
